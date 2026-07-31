import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  readBackendServiceLibrary,
  readServiceControllers,
  readServiceProcessors,
} from '../../backend-services.js'
import { readDataTypeLibrary } from '../../data-types.js'
import { readMysqlLibrary, readMysqlTableSchema } from '../../mysql.js'
import type { MysqlColumnDef, MysqlIndexDef } from '../../../types/mysql.js'
import type { ProcessorMethod } from '../../../types/backend-services.js'
import { buildPresetMethods } from '../../../utils/data-preset-methods.js'
import { findTypeDef, buildIdToName } from './emit-types.js'
import { emitAllTypeFiles, emitServiceModules } from './emit-module.js'
import {
  buildMethodIndex,
  buildProcessorMaps,
} from './emit-flow.js'
import { collectUsedDataMethodIds } from './emit-repository.js'
import { slugify } from './names.js'

export interface CodegenResult {
  files: Record<string, string>
  routes: Array<{ method: string; path: string; name: string; serviceName: string }>
  defaultMysqlId: string
  services: number
  rootModuleImports: Array<{ className: string; importPath: string }>
}

function groupStemFromFilename(file: string): string {
  return file.replace(/\.json$/i, '')
}

export async function generateNestJsModules(
  projectPath: string,
  options?: { moduleIds?: string[] },
): Promise<CodegenResult> {
  const [serviceLib, typeLib, mysqlLib] = await Promise.all([
    readBackendServiceLibrary(projectPath),
    readDataTypeLibrary(projectPath),
    readMysqlLibrary(projectPath),
  ])

  const filterIds = options?.moduleIds?.map((id) => id.trim()).filter(Boolean)
  const services = filterIds?.length
    ? serviceLib.services.filter((s) => filterIds.includes(s.id))
    : serviceLib.services

  const idToName = buildIdToName(typeLib)
  const typeIdToGroupStem = new Map<string, string>()
  const groupStemById = new Map<string, string>()

  let typeFiles: string[] = []
  try {
    typeFiles = (await readdir(path.join(projectPath, 'types'))).filter((f) =>
      f.endsWith('.json'),
    )
  } catch {
    typeFiles = []
  }

  for (const file of typeFiles) {
    const stem = groupStemFromFilename(file)
    try {
      const raw = JSON.parse(
        await readFile(path.join(projectPath, 'types', file), 'utf-8'),
      ) as { id?: string; types?: Array<{ id: string }> }
      if (raw.id) groupStemById.set(raw.id, stem)
      for (const t of raw.types ?? []) {
        if (t.id) typeIdToGroupStem.set(t.id, stem)
      }
    } catch {
      // skip
    }
  }

  for (const group of typeLib.groups ?? []) {
    const stem =
      group.name?.trim() ||
      groupStemById.get(group.id) ||
      (group.id === 'group_common'
        ? 'common'
        : slugify(group.id.replace(/^group_/, ''), 'types'))
    groupStemById.set(group.id, stem)
    for (const t of group.types ?? []) {
      typeIdToGroupStem.set(t.id, stem)
    }
  }

  const files: Record<string, string> = {
    ...emitAllTypeFiles(typeLib, idToName, groupStemById, typeIdToGroupStem),
  }

  const allRoutes: CodegenResult['routes'] = []
  const rootModuleImports: CodegenResult['rootModuleImports'] = []

  let defaultMysqlId =
    services.find((s) => s.testMysqlId)?.testMysqlId ||
    mysqlLib.databases[0]?.id ||
    ''

  // 先加载全部模块处理器，构建跨服务共享索引（支持跨模块 input 调用）
  type ServiceBundle = {
    service: (typeof services)[number]
    moduleSlug: string
    controllers: Awaited<ReturnType<typeof readServiceControllers>>
    dataProcessors: Awaited<ReturnType<typeof readServiceProcessors>>
    businessProcessors: Awaited<ReturnType<typeof readServiceProcessors>>
    tableColumnsByName: Map<string, MysqlColumnDef[]>
    tableIndexesByName: Map<string, MysqlIndexDef[]>
  }

  const bundles: ServiceBundle[] = []
  const sharedMethodById = new Map<
    string,
    { processorId: string; method: ProcessorMethod }
  >()
  const sharedProcessorSlugById = new Map<string, string>()
  const sharedProcessorLayerById = new Map<string, 'data' | 'business'>()
  const sharedProcessorModuleSlugById = new Map<string, string>()
  const sharedUsedByProcessor = new Map<string, Set<string>>()

  for (const service of services) {
    const moduleSlug = slugify(service.name || service.id, 'service')
    const [controllers, dataProcessors, businessProcessors] = await Promise.all(
      [
        readServiceControllers(projectPath, service.id),
        readServiceProcessors(projectPath, service.id, 'data'),
        readServiceProcessors(projectPath, service.id, 'business'),
      ],
    )

    const tableColumnsByName = new Map<string, MysqlColumnDef[]>()
    const tableIndexesByName = new Map<string, MysqlIndexDef[]>()
    for (const proc of dataProcessors) {
      const entity = findTypeDef(typeLib, proc.entityRef)
      const tableName =
        entity?.tableName?.trim() || entity?.name?.trim() || ''
      if (!tableName || tableColumnsByName.has(tableName)) continue
      const schema = await readMysqlTableSchema(projectPath, tableName)
      tableColumnsByName.set(tableName, schema?.columns ?? [])
      tableIndexesByName.set(tableName, schema?.indexes ?? [])
    }

    const maps = buildProcessorMaps(dataProcessors, businessProcessors)
    for (const [id, slug] of maps.processorSlugById) {
      sharedProcessorSlugById.set(id, slug)
      sharedProcessorModuleSlugById.set(id, moduleSlug)
    }
    for (const [id, layer] of maps.processorLayerById) {
      sharedProcessorLayerById.set(id, layer)
    }

    const methodIndex = buildMethodIndex(dataProcessors, businessProcessors)
    for (const [id, meta] of methodIndex) {
      sharedMethodById.set(id, meta)
    }
    for (const proc of dataProcessors) {
      const entity = findTypeDef(typeLib, proc.entityRef)
      const tableName =
        entity?.tableName?.trim() || entity?.name?.trim() || ''
      const columns = tableName
        ? tableColumnsByName.get(tableName) ?? []
        : []
      const indexes = tableName
        ? tableIndexesByName.get(tableName) ?? []
        : []
      for (const m of buildPresetMethods({ entity, columns, indexes })) {
        if (m.disabled) continue
        if (!sharedMethodById.has(m.id)) {
          sharedMethodById.set(m.id, { processorId: proc.id, method: m })
        }
      }
    }

    const used = collectUsedDataMethodIds(businessProcessors)
    for (const [procId, set] of used) {
      if (!sharedUsedByProcessor.has(procId)) {
        sharedUsedByProcessor.set(procId, new Set())
      }
      for (const mid of set) sharedUsedByProcessor.get(procId)!.add(mid)
    }

    bundles.push({
      service,
      moduleSlug,
      controllers,
      dataProcessors,
      businessProcessors,
      tableColumnsByName,
      tableIndexesByName,
    })
  }

  for (const bundle of bundles) {
    const {
      service,
      moduleSlug,
      controllers,
      dataProcessors,
      businessProcessors,
      tableColumnsByName,
      tableIndexesByName,
    } = bundle

    const emitted = emitServiceModules({
      moduleSlug,
      serviceId: service.id,
      dataProcessors,
      businessProcessors,
      controllers,
      typeLibrary: typeLib,
      idToName,
      typeIdToGroupStem,
      tableColumnsByName,
      tableIndexesByName,
      sharedMethodById,
      sharedProcessorSlugById,
      sharedProcessorLayerById,
      sharedProcessorModuleSlugById,
      sharedUsedByProcessor,
    })
    Object.assign(files, emitted.files)

    for (const r of emitted.routes) {
      allRoutes.push({
        method: r.httpMethod,
        path: r.httpPath,
        name: r.apiMethodName,
        serviceName: service.name,
      })
    }

    if (emitted.domainModule) {
      rootModuleImports.push(emitted.domainModule)
    }

    if (!defaultMysqlId && service.testMysqlId) {
      defaultMysqlId = service.testMysqlId
    }
  }

  return {
    files,
    routes: allRoutes,
    defaultMysqlId,
    services: services.length,
    rootModuleImports,
  }
}

/** @deprecated 使用 generateNestJsModules */
export const generateNextJsModules = generateNestJsModules
