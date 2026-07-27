import type {
  ServiceApi,
  ServiceController,
  ServiceProcessor,
} from '../../../types/backend-services.js'
import type { DataTypeLibrary } from '../../../types/data-types.js'
import {
  buildMethodIndex,
  buildProcessorMaps,
  emitFlowMethodBody,
  emitMethodSignature,
  type FlowEmitContext,
} from './emit-flow.js'
import { emitRepositoryFile } from './emit-repository.js'
import {
  dataTypeToTs,
  findTypeDef,
  type IdToName,
} from './emit-types.js'
import { safeIdent, slugify, toCamelCase, toPascalCase } from './names.js'

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

function emitServiceFile(options: {
  resourceSlug: string
  processor: ServiceProcessor
  dataProcessor: ServiceProcessor | null
  idToName: IdToName
  typeIdToGroupStem: Map<string, string>
  flowCtxBase: Omit<FlowEmitContext, 'selfResourceSlug' | 'mode'>
}): string {
  const {
    resourceSlug,
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
  const repoImport = dataProcessor
    ? `import { ${pascal}Repository } from './${resourceSlug}.repository'\n`
    : ''

  const ctor = dataProcessor
    ? `  constructor(private readonly repo: ${pascal}Repository) {}\n`
    : ''

  const flowCtx: FlowEmitContext = {
    ...flowCtxBase,
    selfResourceSlug: resourceSlug,
    mode: 'service',
  }

  const methods = (processor.methods ?? [])
    .map((m) => {
      const name = safeIdent(m.name, 'method')
      const { params, returnType } = emitMethodSignature(m, idToName)
      const remark = m.remark?.trim()
        ? `  /** ${m.remark.trim()} */\n`
        : ''
      const body = emitFlowMethodBody(m.flow, flowCtx, 2)
      return `${remark}  async ${name}(${params}): Promise<${returnType}> {\n${body}  }`
    })
    .join('\n\n')

  return `/** 业务处理器「${processor.name}」 */
import { Injectable } from '@nestjs/common'
${repoImport}${imports ? imports + '\n' : ''}
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

        paramDecls.push(`${decorator} ${rawName}?: string`)

        if (inp.type === 'number') {
          prepLines.push(`    const ${n} = Number(${rawName})`)
        } else if (inp.type === 'boolean') {
          prepLines.push(
            `    const ${n} = String(${rawName}) === 'true' || ${rawName} === '1'`,
          )
        } else if (inp.type === 'json' || inp.typeRef) {
          prepLines.push(`    const ${n} = parseMaybeJson(${rawName}) as ${ty}`)
        } else {
          prepLines.push(
            inp.required
              ? `    const ${n} = (parseMaybeJson(${rawName}) as string)`
              : `    const ${n} = ((parseMaybeJson(${rawName}) as string | undefined) ?? '')`,
          )
        }

        if (inp.required) {
          if (inp.type === 'json' || inp.typeRef) {
            prepLines.push(
              `    if (${n} === undefined || ${n} === null) {\n      throw new BadRequestException(${JSON.stringify(`缺少必填入参「${inp.varName}」`)})\n    }`,
            )
          } else {
            prepLines.push(
              `    if (${n} === undefined || ${n} === null || ${n} === '') {\n      throw new BadRequestException(${JSON.stringify(`缺少必填入参「${inp.varName}」`)})\n    }`,
            )
          }
        }
      }

      const remark = api.remark?.trim()
        ? `  /** ${api.remark.trim()} */\n`
        : api.requireAuth
          ? `  /** TODO: requireAuth */\n`
          : ''
      const flowBody = emitFlowMethodBody(api.flow, flowCtx, 4)
      const decoLine = routeArg
        ? `  @${httpDec}(${routeArg})`
        : `  @${httpDec}()`

      return `${remark}${decoLine}
  async ${name}(
${paramDecls.map((p) => `    ${p}`).join(',\n')}
  ): Promise<Result> {
${prepLines.join('\n')}
    const data = await (async () => {
${flowBody}    })()
    return success(data)
  }`
    })
    .join('\n\n')

  return `/** 控制器「${controller.name}」· /${controllerPath} */
import {
  ${[...nestImports].sort().join(',\n  ')},
} from '@nestjs/common'
${serviceImport}import { success, type Result } from '../../../common/result'
import { parseMaybeJson } from '../../../common/http'
${imports ? imports + '\n' : ''}
@Controller('${controllerPath}')
export class ${className} {
${ctor}
${methods || '  // no apis\n'}
}
`
}

function emitResourceModuleFile(options: {
  resourceSlug: string
  hasController: boolean
  hasService: boolean
  hasRepository: boolean
}): string {
  const { resourceSlug, hasController, hasService, hasRepository } = options
  const pascal = toPascalCase(resourceSlug)
  const imports: string[] = [`import { Module } from '@nestjs/common'`]
  const controllers: string[] = []
  const providers: string[] = []
  const exportsList: string[] = []

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
  }

  return `${imports.join('\n')}

@Module({
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
  const imports = resourceSlugs
    .map((slug) => {
      const p = toPascalCase(slug)
      return `import { ${p}Module } from './${slug}/${slug}.module'`
    })
    .join('\n')
  const list = resourceSlugs.map((s) => `${toPascalCase(s)}Module`).join(', ')
  return `import { Module } from '@nestjs/common'
${imports}

@Module({
  imports: [${list}],
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
  typeIdToGroupStem: Map<string, string>,
): string {
  if (!dataProcessor?.entityRef) {
    return `/** ${resourceSlug} entity placeholder */\nexport {}\n`
  }
  const def = findTypeDef(typeLibrary, dataProcessor.entityRef)
  if (!def) {
    return `/** ${resourceSlug} entity placeholder */\nexport {}\n`
  }
  const stem = typeIdToGroupStem.get(def.id) || 'common'
  return `/** ${resourceSlug} entity */\nexport type { ${def.name} } from '../../../types/${stem}'\n`
}

export function emitServiceModules(options: {
  moduleSlug: string
  dataProcessors: ServiceProcessor[]
  businessProcessors: ServiceProcessor[]
  controllers: ServiceController[]
  typeLibrary: DataTypeLibrary
  idToName: IdToName
  typeIdToGroupStem: Map<string, string>
}): ModuleEmitResult {
  const {
    moduleSlug,
    dataProcessors,
    businessProcessors,
    controllers,
    typeLibrary,
    idToName,
    typeIdToGroupStem,
  } = options

  const files: Record<string, string> = {}
  const routes: ModuleEmitResult['routes'] = []

  const { processorSlugById, processorLayerById } = buildProcessorMaps(
    dataProcessors,
    businessProcessors,
  )
  const methodById = buildMethodIndex(dataProcessors, businessProcessors)
  const flowCtxBase = {
    processorSlugById,
    processorLayerById,
    idToName,
    methodById,
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

    if (dataP) {
      files[`${base}/${resourceSlug}.repository.ts`] = emitRepositoryFile({
        resourceSlug,
        processor: dataP,
        typeLibrary,
        idToName,
        typeIdToGroupStem,
      })
    }
    if (bizP) {
      files[`${base}/${resourceSlug}.service.ts`] = emitServiceFile({
        resourceSlug,
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
      typeIdToGroupStem,
    )

    files[`${base}/${resourceSlug}.module.ts`] = emitResourceModuleFile({
      resourceSlug,
      hasController: Boolean(ctrl),
      hasService: Boolean(bizP),
      hasRepository: Boolean(dataP),
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
    // Cross-group imports (e.g. URI from common)
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
