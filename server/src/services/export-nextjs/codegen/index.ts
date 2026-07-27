import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  readBackendServiceLibrary,
  readServiceControllers,
  readServiceProcessors,
} from '../../backend-services.js'
import { readDataTypeLibrary } from '../../data-types.js'
import { readMysqlLibrary } from '../../mysql.js'
import { emitAllTypeFiles, emitServiceModules } from './emit-module.js'
import { buildIdToName } from './emit-types.js'
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

  for (const service of services) {
    const moduleSlug = slugify(service.name || service.id, 'service')
    const [controllers, dataProcessors, businessProcessors] = await Promise.all(
      [
        readServiceControllers(projectPath, service.id),
        readServiceProcessors(projectPath, service.id, 'data'),
        readServiceProcessors(projectPath, service.id, 'business'),
      ],
    )

    const emitted = emitServiceModules({
      moduleSlug,
      dataProcessors,
      businessProcessors,
      controllers,
      typeLibrary: typeLib,
      idToName,
      typeIdToGroupStem,
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
