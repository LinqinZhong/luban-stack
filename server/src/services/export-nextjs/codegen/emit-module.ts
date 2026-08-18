import type {
  ProcessorMethod,
  ServiceApi,
  ServiceController,
  ServiceProcessor,
} from '../../../types/backend-services.js'
import type { DataTypeLibrary } from '../../../types/data-types.js'
import type { MysqlColumnDef, MysqlIndexDef } from '../../../types/mysql.js'
import { buildPresetMethods } from '../../../utils/data-preset-methods.js'
import {
  buildMethodIndex,
  buildProcessorMaps,
  collectExternalInjectDeps,
  collectFlowUsesObjectMap,
  emitFlowMethodBody,
  emitMethodSignature,
  type ExternalInjectDep,
  type FlowEmitContext,
} from './emit-flow.js'
import {
  collectUsedDataMethodIds,
  emitRepositoryFile,
} from './emit-repository.js'
import { emitTypeOrmEntityFile } from './emit-typeorm-entity.js'
import {
  dataTypeToTs,
  findTypeDef,
  type IdToName,
} from './emit-types.js'
import { safeIdent, slugify, toCamelCase, toPascalCase } from './names.js'
import { methodJsDoc } from './js-comments.js'

export interface ModuleEmitResult {
  files: Record<string, string>
  routes: Array<{
    httpMethod: string
    httpPath: string
    moduleSlug: string
    resourceSlug: string
    controllerClass: string
    controllerExport: string
    apiMethodName: string
    api: ServiceApi
  }>
  /** 域模块，如 ShopModule */
  domainModule: { className: string; importPath: string } | null
}

function typeImportLines(
  idToName: IdToName,
  typeIdToGroupStem: Map<string, string>,
  refs: string[],
): string {
  const byGroup = new Map<string, Set<string>>()
  for (const ref of refs) {
    if (!ref) continue
    const name = idToName.get(ref)
    const stem = typeIdToGroupStem.get(ref)
    if (!name || !stem) continue
    if (!byGroup.has(stem)) byGroup.set(stem, new Set())
    byGroup.get(stem)!.add(name)
  }
  return [...byGroup.entries()]
    .map(
      ([stem, names]) =>
        `import type { ${[...names].sort().join(', ')} } from '../../../types/${stem}'`,
    )
    .join('\n')
}

function collectApiTypeRefs(api: ServiceApi): string[] {
  const refs: string[] = []
  const push = (r?: string) => {
    if (r) refs.push(r)
  }
  push(api.output?.typeRef)
  push(api.output?.itemTypeRef)
  for (const v of Object.values(api.output?.genericArgs || {})) push(v)
  for (const inp of api.inputs ?? []) {
    push(inp.typeRef)
    for (const v of Object.values(inp.genericArgs || {})) push(v)
  }
  return refs
}

function relativeResourceImport(
  fromModule: string,
  fromResource: string,
  toModule: string,
  toResource: string,
  fileStem: string,
): string {
  // from: modules/{fromModule}/{fromResource}/{fromResource}.service.ts
  // to:   modules/{toModule}/{toResource}/{toResource}.{fileStem}.ts
  if (fromModule === toModule) {
    return `../${toResource}/${toResource}.${fileStem}`
  }
  return `../../${toModule}/${toResource}/${toResource}.${fileStem}`
}

function emitServiceFile(options: {
  resourceSlug: string
  moduleSlug: string
  processor: ServiceProcessor
  dataProcessor: ServiceProcessor | null
  idToName: IdToName
  typeIdToGroupStem: Map<string, string>
  flowCtxBase: Omit<FlowEmitContext, 'selfResourceSlug' | 'mode'>
}): string {
  const {
    resourceSlug,
    moduleSlug,
    processor,
    dataProcessor,
    idToName,
    typeIdToGroupStem,
    flowCtxBase,
  } = options
  const className = `${toPascalCase(resourceSlug)}Service`
  const pascal = toPascalCase(resourceSlug)

  const refs: string[] = []
  for (const m of processor.methods ?? []) {
    refs.push(
      m.output?.typeRef || '',
      m.output?.itemTypeRef || '',
      ...Object.values(m.output?.genericArgs || {}),
    )
    for (const p of m.params ?? []) {
      refs.push(
        p.typeExpr?.typeRef || '',
        p.typeExpr?.itemTypeRef || '',
        ...Object.values(p.typeExpr?.genericArgs || {}),
      )
    }
  }

  const imports = typeImportLines(idToName, typeIdToGroupStem, refs)
  const usesObjectMap = collectFlowUsesObjectMap(
    (processor.methods ?? []).map((m) => m.flow),
  )
  const objectMapImport = usesObjectMap
    ? `import { mapObjectFields } from '../../../common/object-map'\n`
    : ''

  const flowCtx: FlowEmitContext = {
    ...flowCtxBase,
    selfResourceSlug: resourceSlug,
    mode: 'service',
  }

  const externalDeps = collectExternalInjectDeps(
    (processor.methods ?? []).map((m) => m.flow),
    flowCtx,
  )

  const injectImports: string[] = []
  const ctorParams: string[] = []
  if (dataProcessor) {
    injectImports.push(
      `import { ${pascal}Repository } from './${resourceSlug}.repository'`,
    )
    ctorParams.push(`private readonly repo: ${pascal}Repository`)
  }
  for (const dep of externalDeps) {
    const depPascal = toPascalCase(dep.resourceSlug)
    const depCamel = toCamelCase(dep.resourceSlug)
    if (dep.layer === 'data') {
      const rel = relativeResourceImport(
        moduleSlug,
        resourceSlug,
        dep.moduleSlug,
        dep.resourceSlug,
        'repository',
      )
      injectImports.push(`import { ${depPascal}Repository } from '${rel}'`)
      ctorParams.push(
        `private readonly ${depCamel}Repo: ${depPascal}Repository`,
      )
    } else {
      const rel = relativeResourceImport(
        moduleSlug,
        resourceSlug,
        dep.moduleSlug,
        dep.resourceSlug,
        'service',
      )
      injectImports.push(`import { ${depPascal}Service } from '${rel}'`)
      ctorParams.push(
        `private readonly ${depCamel}Service: ${depPascal}Service`,
      )
    }
  }

  const ctor = ctorParams.length
    ? `  constructor(\n${ctorParams.map((p) => `    ${p},`).join('\n')}\n  ) {}\n`
    : ''

  const methods = (processor.methods ?? [])
    .map((m) => {
      const name = safeIdent(m.name, 'method')
      const { params, returnType } = emitMethodSignature(m, idToName)
      const remark = methodJsDoc(
        m.remark,
        (m.params ?? []).map((p) => ({
          name: safeIdent(p.name, 'param'),
          remark: p.remark,
        })),
      )
      const body = emitFlowMethodBody(
        m.flow,
        { ...flowCtx, methodOutput: m.output },
        2,
      )
      return `${remark}  async ${name}(${params}): Promise<${returnType}> {\n${body}  }`
    })
    .join('\n\n')

  return `/** 业务处理器「${processor.name}」 */
import { Injectable } from '@nestjs/common'
${injectImports.join('\n')}${injectImports.length ? '\n' : ''}${objectMapImport}${imports ? imports + '\n' : ''}
@Injectable()
export class ${className} {
${ctor}
${methods || '  // no methods\n'}
}
`
}

function nestHttpDecorator(method: string): string {
  const m = method.toUpperCase()
  if (m === 'POST') return 'Post'
  if (m === 'PUT') return 'Put'
  if (m === 'PATCH') return 'Patch'
  if (m === 'DELETE') return 'Delete'
  return 'Get'
}

function stripSlash(p: string): string {
  return (p || '').trim().replace(/^\/+|\/+$/g, '')
}

function emitControllerFile(options: {
  resourceSlug: string
  controller: ServiceController
  businessBySlug: Map<string, ServiceProcessor>
  idToName: IdToName
  typeIdToGroupStem: Map<string, string>
  flowCtxBase: Omit<FlowEmitContext, 'selfResourceSlug' | 'mode'>
}): string {
  const {
    resourceSlug,
    controller,
    businessBySlug,
    idToName,
    typeIdToGroupStem,
    flowCtxBase,
  } = options
  const className = `${toPascalCase(resourceSlug)}Controller`
  const camel = toCamelCase(resourceSlug)
  const pascal = toPascalCase(resourceSlug)
  const controllerPath = stripSlash(controller.path || resourceSlug)

  const business = businessBySlug.get(resourceSlug)
  const serviceImport = business
    ? `import { ${pascal}Service } from './${resourceSlug}.service'\n`
    : ''

  const refs = (controller.apis ?? []).flatMap(collectApiTypeRefs)
  const imports = typeImportLines(idToName, typeIdToGroupStem, refs)
  const usesObjectMap = collectFlowUsesObjectMap(
    (controller.apis ?? []).map((api) => api.flow),
  )
  const objectMapImport = usesObjectMap
    ? `import { mapObjectFields } from '../../../common/object-map'\n`
    : ''

  const flowCtx: FlowEmitContext = {
    ...flowCtxBase,
    selfResourceSlug: resourceSlug,
    mode: 'controller',
  }

  const nestImports = new Set<string>(['Controller'])
  for (const api of controller.apis ?? []) {
    nestImports.add(nestHttpDecorator(api.method || 'GET'))
    for (const inp of api.inputs ?? []) {
      const loc = (inp.location || 'query').toLowerCase()
      if (loc === 'body') nestImports.add('Body')
      else if (loc === 'param') nestImports.add('Param')
      else nestImports.add('Query')
    }
  }
  nestImports.add('BadRequestException')
  nestImports.add('HttpException')

  const ctor = business
    ? `  constructor(private readonly ${camel}Service: ${pascal}Service) {}\n`
    : ''

  const methods = (controller.apis ?? [])
    .map((api) => {
      const name = safeIdent(api.name || api.id, 'handler')
      const httpDec = nestHttpDecorator(api.method || 'GET')
      const routePath = stripSlash(api.path || '')
      const routeArg = routePath ? `'${routePath}'` : ''

      const paramDecls: string[] = []
      const prepLines: string[] = []

      for (const inp of api.inputs ?? []) {
        const n = safeIdent(inp.varName, 'input')
        const loc = (inp.location || 'query').toLowerCase()
        const rawName = `${n}Raw`
        let decorator = `@Query('${inp.varName}')`
        if (loc === 'body') decorator = `@Body('${inp.varName}')`
        if (loc === 'param') decorator = `@Param('${inp.varName}')`

        let ty = 'unknown'
        if (inp.type === 'string' || inp.type === 'number' || inp.type === 'boolean') {
          ty = inp.type
        } else if (inp.typeRef) {
          ty = idToName.get(inp.typeRef) || 'Record<string, unknown>'
        } else if (inp.type === 'json') {
          ty = idToName.get(inp.typeRef) || 'Record<string, unknown>'
        }

        paramDecls.push(`${decorator} ${rawName}?: unknown`)

        if (inp.type === 'number') {
          prepLines.push(`      const ${n} = Number(${rawName})`)
        } else if (inp.type === 'boolean') {
          prepLines.push(
            `      const ${n} = String(${rawName}) === 'true' || ${rawName} === '1' || ${rawName} === true`,
          )
        } else if (inp.type === 'json' || inp.typeRef) {
          prepLines.push(`      const ${n} = parseMaybeJson(${rawName}) as ${ty}`)
        } else {
          prepLines.push(
            inp.required
              ? `      const ${n} = (parseMaybeJson(${rawName}) as string)`
              : `      const ${n} = ((parseMaybeJson(${rawName}) as string | undefined) ?? '')`,
          )
        }

        if (inp.required) {
          if (inp.type === 'number') {
            prepLines.push(
              `      if (${rawName} === undefined || ${rawName} === null || ${rawName} === '' || Number.isNaN(${n})) {\n        throw new BadRequestException(${JSON.stringify(`${inp.varName}不能为空`)})\n      }`,
            )
          } else if (inp.type === 'json' || inp.typeRef) {
            prepLines.push(
              `      if (${n} === undefined || ${n} === null) {\n        throw new BadRequestException(${JSON.stringify(`${inp.varName}不能为空`)})\n      }`,
            )
          } else if (inp.type === 'boolean') {
            prepLines.push(
              `      if (${rawName} === undefined || ${rawName} === null || ${rawName} === '') {\n        throw new BadRequestException(${JSON.stringify(`${inp.varName}不能为空`)})\n      }`,
            )
          } else {
            prepLines.push(
              `      if (${n} === undefined || ${n} === null || ${n} === '') {\n        throw new BadRequestException(${JSON.stringify(`${inp.varName}不能为空`)})\n      }`,
            )
          }
        }
      }

      const remark = methodJsDoc(
        api.remark?.trim()
          ? api.remark
          : api.requireAuth
            ? 'TODO: requireAuth'
            : '',
        (api.inputs ?? []).map((inp) => ({
          name: safeIdent(inp.varName, 'input'),
          remark: inp.remark,
        })),
      )
      const flowBody = emitFlowMethodBody(
        api.flow,
        { ...flowCtx, methodOutput: api.output },
        6,
      )
      const decoLine = routeArg
        ? `  @${httpDec}(${routeArg})`
        : `  @${httpDec}()`

      return `${remark}${decoLine}
  async ${name}(
${paramDecls.map((p) => `    ${p}`).join(',\n')}
  ): Promise<Result> {
    try {
${prepLines.join('\n')}
      const data = await (async () => {
${flowBody}      })()
      return success(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : '内部错误'
      const code =
        err instanceof HttpException
          ? err.getStatus()
          : typeof (err as { statusCode?: unknown })?.statusCode === 'number'
            ? (err as { statusCode: number }).statusCode
            : 500
      return fail(message, code)
    }
  }`
    })
    .join('\n\n')

  return `/** 控制器「${controller.name}」· /${controllerPath} */
import {
  ${[...nestImports].sort().join(',\n  ')},
} from '@nestjs/common'
${serviceImport}import { success, fail, type Result } from '../../../common/result'
import { parseMaybeJson } from '../../../common/http'
${objectMapImport}${imports ? imports + '\n' : ''}
@Controller('${controllerPath}')
export class ${className} {
${ctor}
${methods || '  // no apis\n'}
}
`
}

function emitResourceModuleFile(options: {
  resourceSlug: string
  moduleSlug: string
  hasController: boolean
  hasService: boolean
  hasRepository: boolean
  entityClassName?: string
  externalDeps: ExternalInjectDep[]
}): string {
  const {
    resourceSlug,
    moduleSlug,
    hasController,
    hasService,
    hasRepository,
    entityClassName,
    externalDeps,
  } = options
  const pascal = toPascalCase(resourceSlug)
  const imports: string[] = [`import { Module } from '@nestjs/common'`]
  const nestImports: string[] = []
  const controllers: string[] = []
  const providers: string[] = []
  const exportsList: string[] = []

  if (hasRepository && entityClassName) {
    imports.push(`import { TypeOrmModule } from '@nestjs/typeorm'`)
    imports.push(
      `import { ${entityClassName} } from './${resourceSlug}.entity'`,
    )
    nestImports.push(`TypeOrmModule.forFeature([${entityClassName}])`)
  }

  if (hasController) {
    imports.push(
      `import { ${pascal}Controller } from './${resourceSlug}.controller'`,
    )
    controllers.push(`${pascal}Controller`)
  }
  if (hasService) {
    imports.push(`import { ${pascal}Service } from './${resourceSlug}.service'`)
    providers.push(`${pascal}Service`)
    exportsList.push(`${pascal}Service`)
  }
  if (hasRepository) {
    imports.push(
      `import { ${pascal}Repository } from './${resourceSlug}.repository'`,
    )
    providers.push(`${pascal}Repository`)
    exportsList.push(`${pascal}Repository`)
  }

  for (const dep of externalDeps) {
    const depPascal = toPascalCase(dep.resourceSlug)
    const importPath =
      dep.moduleSlug === moduleSlug
        ? `../${dep.resourceSlug}/${dep.resourceSlug}.module`
        : `../../${dep.moduleSlug}/${dep.resourceSlug}/${dep.resourceSlug}.module`
    const alias =
      depPascal === pascal
        ? `${depPascal}RemoteModule`
        : `${depPascal}Module`
    imports.push(`import { ${depPascal}Module as ${alias} } from '${importPath}'`)
    nestImports.push(alias)
  }

  return `${imports.join('\n')}

@Module({
  imports: [${nestImports.join(', ')}],
  controllers: [${controllers.join(', ')}],
  providers: [${providers.join(', ')}],
  exports: [${exportsList.join(', ')}],
})
export class ${pascal}Module {}
`
}

function emitDomainModuleFile(
  moduleSlug: string,
  resourceSlugs: string[],
): string {
  const pascalDomain = toPascalCase(moduleSlug)
  const importLines: string[] = []
  const importNames: string[] = []
  for (const slug of resourceSlugs) {
    const p = toPascalCase(slug)
    if (p === pascalDomain) {
      const alias = `${p}ResourceModule`
      importLines.push(
        `import { ${p}Module as ${alias} } from './${slug}/${slug}.module'`,
      )
      importNames.push(alias)
    } else {
      importLines.push(
        `import { ${p}Module } from './${slug}/${slug}.module'`,
      )
      importNames.push(`${p}Module`)
    }
  }
  const list = importNames.join(', ')
  return `import { Module } from '@nestjs/common'
${importLines.join('\n')}

@Module({
  imports: [${list}],
  exports: [${list}],
})
export class ${pascalDomain}Module {}
`
}

function emitDtoFile(
  resourceSlug: string,
  controller: ServiceController | null,
  idToName: IdToName,
  typeIdToGroupStem: Map<string, string>,
  typeLibrary: DataTypeLibrary,
): string {
  const refs = controller
    ? (controller.apis ?? []).flatMap(collectApiTypeRefs)
    : []
  const imports = typeImportLines(idToName, typeIdToGroupStem, refs)
  const reExports = [...new Set(refs)]
    .map((r) => idToName.get(r))
    .filter(Boolean)
    .map((n) => n!)

  // Also inline simple param interfaces if needed - for now re-export
  const unique = [...new Set(reExports)]
  if (!unique.length && !imports) {
    return `/** DTO placeholder for ${resourceSlug} */\nexport {}\n`
  }

  // Prefer re-export from types
  const byGroup = new Map<string, string[]>()
  for (const ref of refs) {
    const name = idToName.get(ref)
    const stem = typeIdToGroupStem.get(ref)
    if (!name || !stem) continue
    if (!byGroup.has(stem)) byGroup.set(stem, [])
    if (!byGroup.get(stem)!.includes(name)) byGroup.get(stem)!.push(name)
  }
  const lines = [...byGroup.entries()].map(
    ([stem, names]) =>
      `export type { ${names.sort().join(', ')} } from '../../../types/${stem}'`,
  )
  return `/** ${resourceSlug} DTO */\n${lines.join('\n')}\n`
}

function emitEntityFile(
  resourceSlug: string,
  dataProcessor: ServiceProcessor | null,
  typeLibrary: DataTypeLibrary,
  idToName: IdToName,
  tableColumns: MysqlColumnDef[] = [],
  typeIdToGroupStem?: Map<string, string>,
): string {
  if (!dataProcessor?.entityRef) {
    return `/** ${resourceSlug} entity placeholder */\nexport {}\n`
  }
  const def = findTypeDef(typeLibrary, dataProcessor.entityRef)
  if (!def) {
    return `/** ${resourceSlug} entity placeholder */\nexport {}\n`
  }
  const tableName =
    def.tableName?.trim() || def.name?.trim() || resourceSlug
  return emitTypeOrmEntityFile({
    entityDef: def,
    tableName,
    columns: tableColumns,
    idToName,
    typeIdToGroupStem,
  })
}

export function emitServiceModules(options: {
  moduleSlug: string
  /** BackendService.id；跨模块输入节点降级用 */
  serviceId?: string
  dataProcessors: ServiceProcessor[]
  businessProcessors: ServiceProcessor[]
  controllers: ServiceController[]
  typeLibrary: DataTypeLibrary
  idToName: IdToName
  typeIdToGroupStem: Map<string, string>
  /** tableName → columns / indexes（含 logicDelete） */
  tableColumnsByName?: Map<string, MysqlColumnDef[]>
  tableIndexesByName?: Map<string, MysqlIndexDef[]>
  /** 跨服务共享的方法/处理器索引（同一次后端打包内） */
  sharedMethodById?: Map<
    string,
    { processorId: string; method: ProcessorMethod }
  >
  sharedProcessorSlugById?: Map<string, string>
  sharedProcessorLayerById?: Map<string, 'data' | 'business'>
  sharedProcessorModuleSlugById?: Map<string, string>
  /** 全局已收集的 dataMethod 引用（含跨服务） */
  sharedUsedByProcessor?: Map<string, Set<string>>
}): ModuleEmitResult {
  const {
    moduleSlug,
    serviceId,
    dataProcessors,
    businessProcessors,
    controllers,
    typeLibrary,
    idToName,
    typeIdToGroupStem,
    tableColumnsByName,
    tableIndexesByName,
    sharedMethodById,
    sharedProcessorSlugById,
    sharedProcessorLayerById,
    sharedProcessorModuleSlugById,
    sharedUsedByProcessor,
  } = options

  const files: Record<string, string> = {}
  const routes: ModuleEmitResult['routes'] = []

  const localUsed = collectUsedDataMethodIds(businessProcessors)
  const usedByProcessor = sharedUsedByProcessor
    ? mergeUsedMethodMaps(sharedUsedByProcessor, localUsed)
    : localUsed

  const localMaps = buildProcessorMaps(dataProcessors, businessProcessors)
  const processorSlugById = sharedProcessorSlugById
    ? new Map([...sharedProcessorSlugById, ...localMaps.processorSlugById])
    : localMaps.processorSlugById
  const processorLayerById = sharedProcessorLayerById
    ? new Map([...sharedProcessorLayerById, ...localMaps.processorLayerById])
    : localMaps.processorLayerById
  const processorModuleSlugById = new Map(
    sharedProcessorModuleSlugById ?? [],
  )
  for (const p of [...dataProcessors, ...businessProcessors]) {
    processorModuleSlugById.set(p.id, moduleSlug)
  }

  const methodById = sharedMethodById
    ? new Map(sharedMethodById)
    : buildMethodIndex(dataProcessors, businessProcessors)
  // 预置方法也要进索引，便于业务流 codegen 解析签名
  for (const proc of dataProcessors) {
    const entity = findTypeDef(typeLibrary, proc.entityRef)
    const tableName =
      entity?.tableName?.trim() || entity?.name?.trim() || ''
    const columns = tableName
      ? tableColumnsByName?.get(tableName) ?? []
      : []
    const indexes = tableName
      ? tableIndexesByName?.get(tableName) ?? []
      : []
    for (const m of buildPresetMethods({ entity, columns, indexes })) {
      if (m.disabled) continue
      if (!methodById.has(m.id)) {
        methodById.set(m.id, { processorId: proc.id, method: m })
      }
    }
  }
  const flowCtxBase = {
    processorSlugById,
    processorLayerById,
    processorModuleSlugById,
    idToName,
    methodById,
    currentServiceId: serviceId,
    currentModuleSlug: moduleSlug,
  }

  const dataBySlug = new Map<string, ServiceProcessor>()
  for (const p of dataProcessors) {
    dataBySlug.set(slugify(p.name || p.id, 'resource'), p)
  }
  const businessBySlug = new Map<string, ServiceProcessor>()
  for (const p of businessProcessors) {
    businessBySlug.set(slugify(p.name || p.id, 'resource'), p)
  }

  const resourceSlugs = new Set<string>([
    ...dataBySlug.keys(),
    ...businessBySlug.keys(),
    ...controllers.map((c) => slugify(c.name || c.id, 'resource')),
  ])

  const emittedResources: string[] = []

  for (const resourceSlug of resourceSlugs) {
    const base = `src/modules/${moduleSlug}/${resourceSlug}`
    const dataP = dataBySlug.get(resourceSlug) ?? null
    const bizP = businessBySlug.get(resourceSlug) ?? null
    const ctrl =
      controllers.find(
        (c) => slugify(c.name || c.id, 'resource') === resourceSlug,
      ) ?? null

    const externalDeps = bizP
      ? collectExternalInjectDeps(
          (bizP.methods ?? []).map((m) => m.flow),
          {
            ...flowCtxBase,
            selfResourceSlug: resourceSlug,
          },
        )
      : []

    const tableColumns = dataP
      ? (() => {
          const entity = findTypeDef(typeLibrary, dataP.entityRef)
          const tableName =
            entity?.tableName?.trim() || entity?.name?.trim() || ''
          return tableName
            ? tableColumnsByName?.get(tableName) ?? []
            : []
        })()
      : []

    if (dataP) {
      const entity = findTypeDef(typeLibrary, dataP.entityRef)
      const tableName =
        entity?.tableName?.trim() || entity?.name?.trim() || ''
      files[`${base}/${resourceSlug}.repository.ts`] = emitRepositoryFile({
        resourceSlug,
        processor: dataP,
        typeLibrary,
        idToName,
        typeIdToGroupStem,
        usedMethodIds: usedByProcessor.get(dataP.id),
        tableColumns: tableName
          ? tableColumnsByName?.get(tableName) ?? []
          : [],
        tableIndexes: tableName
          ? tableIndexesByName?.get(tableName) ?? []
          : [],
      })
    }
    if (bizP) {
      files[`${base}/${resourceSlug}.service.ts`] = emitServiceFile({
        resourceSlug,
        moduleSlug,
        processor: bizP,
        dataProcessor: dataP,
        idToName,
        typeIdToGroupStem,
        flowCtxBase,
      })
    }
    if (ctrl) {
      files[`${base}/${resourceSlug}.controller.ts`] = emitControllerFile({
        resourceSlug,
        controller: ctrl,
        businessBySlug,
        idToName,
        typeIdToGroupStem,
        flowCtxBase,
      })
      files[`${base}/${resourceSlug}.dto.ts`] = emitDtoFile(
        resourceSlug,
        ctrl,
        idToName,
        typeIdToGroupStem,
        typeLibrary,
      )
    }
    files[`${base}/${resourceSlug}.entity.ts`] = emitEntityFile(
      resourceSlug,
      dataP,
      typeLibrary,
      idToName,
      tableColumns,
      typeIdToGroupStem,
    )

    const entityClassName =
      dataP && findTypeDef(typeLibrary, dataP.entityRef)?.name?.trim()

    files[`${base}/${resourceSlug}.module.ts`] = emitResourceModuleFile({
      resourceSlug,
      moduleSlug,
      hasController: Boolean(ctrl),
      hasService: Boolean(bizP),
      hasRepository: Boolean(dataP),
      entityClassName: entityClassName || undefined,
      externalDeps,
    })
    emittedResources.push(resourceSlug)

    if (ctrl) {
      for (const api of ctrl.apis ?? []) {
        routes.push({
          httpMethod: (api.method || 'GET').toUpperCase(),
          httpPath: joinPath(ctrl.path || '', api.path || ''),
          moduleSlug,
          resourceSlug,
          controllerClass: `${toPascalCase(resourceSlug)}Controller`,
          controllerExport: `${toCamelCase(resourceSlug)}Controller`,
          apiMethodName: safeIdent(api.name || api.id, 'handler'),
          api,
        })
      }
    }
  }

  if (emittedResources.length) {
    files[`src/modules/${moduleSlug}/${moduleSlug}.module.ts`] =
      emitDomainModuleFile(moduleSlug, emittedResources)
  }

  return {
    files,
    routes,
    domainModule: emittedResources.length
      ? {
          className: `${toPascalCase(moduleSlug)}Module`,
          importPath: `./modules/${moduleSlug}/${moduleSlug}.module`,
        }
      : null,
  }
}

function mergeUsedMethodMaps(
  a: Map<string, Set<string>>,
  b: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const src of [a, b]) {
    for (const [k, set] of src) {
      if (!out.has(k)) out.set(k, new Set())
      for (const id of set) out.get(k)!.add(id)
    }
  }
  return out
}

function joinPath(a: string, b: string): string {
  const left = (a || '').trim().replace(/\/+$/, '')
  const right = (b || '').trim()
  if (!right) return left || '/'
  if (/^https?:\/\//i.test(right)) return right
  if (right.startsWith('/')) return `${left}${right}` || right
  return left ? `${left}/${right}` : `/${right}`
}

export function emitAllTypeFiles(
  typeLibrary: DataTypeLibrary,
  idToName: IdToName,
  groupStemById: Map<string, string>,
  typeIdToGroupStem: Map<string, string>,
): Record<string, string> {
  const files: Record<string, string> = {}
  for (const group of typeLibrary.groups ?? []) {
    const stem = groupStemById.get(group.id) || group.name || 'types'
    const refs = new Set<string>()
    for (const t of group.types ?? []) {
      collectNamedRefsFromType(t, refs)
    }
    // Cross-group imports (named types from other groups)
    const byGroup = new Map<string, Set<string>>()
    for (const ref of refs) {
      const name = idToName.get(ref)
      const refStem = typeIdToGroupStem.get(ref)
      if (!name || !refStem || refStem === stem) continue
      if (!byGroup.has(refStem)) byGroup.set(refStem, new Set())
      byGroup.get(refStem)!.add(name)
    }
    const importLines = [...byGroup.entries()]
      .map(
        ([s, names]) =>
          `import type { ${[...names].sort().join(', ')} } from './${s}'`,
      )
      .join('\n')

    files[`src/types/${stem}.ts`] = `/** types/${stem} */\n${
      importLines ? importLines + '\n\n' : '\n'
    }${(group.types ?? []).map((t) => dataTypeToTs(t, idToName)).join('\n')}`
  }
  return files
}

function collectNamedRefsFromType(
  def: import('../../../types/data-types.js').DataTypeDef,
  out: Set<string>,
): void {
  const walkExpr = (expr: import('../../../types/data-types.js').TypeExpr | null | undefined) => {
    if (!expr) return
    for (const u of expr.intersections ?? []) {
      for (const a of u.alternatives ?? []) {
        if (a.kind === 'named' && a.ref) out.add(a.ref)
        if (a.kind === 'array') {
          const item = a.item
          if (item?.kind === 'named' && item.ref) out.add(item.ref)
        }
      }
    }
  }
  for (const f of def.fields ?? []) walkExpr(f.type)
  for (const g of def.generics ?? []) {
    walkExpr(g.constraint)
    walkExpr(g.default)
  }
  walkExpr(def.combination)
}
