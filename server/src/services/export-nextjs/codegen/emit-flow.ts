import type {
  MethodFlow,
  FlowNode,
  ProcessorMethod,
  ProcessorTypeExpr,
  ServiceProcessor,
} from '../../../types/backend-services.js'
import { safeIdent, slugify, toCamelCase } from './names.js'
import { processorTypeExprToTs, type IdToName } from './emit-types.js'
import {
  PAGE_META_FIELDS,
  PAGE_RECORDS_FIELD,
  readPageMapFieldMappings,
} from '../../../utils/page-map-flow.js'
import { readObjectMapFieldMappings } from '../../../utils/object-map-flow.js'
import { defaultEmptyReturnCode } from '../../../utils/empty-return-value.js'

export interface FlowEmitContext {
  /** processorId → resource slug */
  processorSlugById: Map<string, string>
  /** processorId → 'data' | 'business' */
  processorLayerById: Map<string, 'data' | 'business'>
  /** processorId → 域模块 slug（如 shop / user） */
  processorModuleSlugById?: Map<string, string>
  /** 当前类内资源 slug */
  selfResourceSlug: string
  mode: 'service' | 'controller'
  idToName: IdToName
  methodById: Map<string, { processorId: string; method: ProcessorMethod }>
  /** 当前正在导出的方法/API 出参类型（终止节点空返回时用） */
  methodOutput?: ProcessorTypeExpr
  /** 当前 BackendService id；跨模块输入节点查找用 */
  currentServiceId?: string
  /** 当前域模块 slug */
  currentModuleSlug?: string
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function indent(level: number): string {
  return '  '.repeat(level)
}

function findStart(flow: MethodFlow): FlowNode | null {
  return flow.nodes.find((n) => n.kind === 'start') ?? null
}

function edgesFrom(flow: MethodFlow, nodeId: string) {
  return flow.edges.filter((e) => e.source === nodeId)
}

function pickDefaultNext(flow: MethodFlow, nodeId: string): string | null {
  const outs = edgesFrom(flow, nodeId)
  const def =
    outs.find((e) => !e.sourceHandle || e.sourceHandle === 'default') ??
    outs.find((e) => e.sourceHandle !== 'true' && e.sourceHandle !== 'false')
  return def?.target ?? null
}

function pickBranchNext(
  flow: MethodFlow,
  nodeId: string,
  handle: 'true' | 'false',
): string | null {
  const outs = edgesFrom(flow, nodeId)
  const hit = outs.find((e) => e.sourceHandle === handle)
  return hit?.target ?? null
}

function emitCallArgs(
  method: ProcessorMethod,
  bindings: Record<string, string>,
): string {
  return (method.params ?? [])
    .map((p) => {
      const expr = bindings[p.name]
      return expr && expr.trim() ? expr.trim() : 'undefined'
    })
    .join(', ')
}

function emitMethodCall(
  ctx: FlowEmitContext,
  processorId: string,
  methodId: string,
  bindings: Record<string, string>,
  opts?: { serviceId?: string },
): string {
  const targetServiceId = opts?.serviceId?.trim() || ''
  const meta = ctx.methodById.get(methodId)
  const method = meta?.method
  if (!method) {
    const cross = targetServiceId
      ? ` (serviceId=${targetServiceId})`
      : ''
    return `/* missing method ${methodId}${cross}; cross-module call not emitted */ undefined as never`
  }

  // 预置方法 id（如 preset_oneById）跨表重复，必须以节点上的 processorId 定位资源
  const slug = ctx.processorSlugById.get(processorId) || 'resource'
  const layer = ctx.processorLayerById.get(processorId) || 'data'
  const methodName = safeIdent(method.name, 'method')
  const args = emitCallArgs(method, bindings)

  if (layer === 'data') {
    if (ctx.mode === 'service' && slug === ctx.selfResourceSlug) {
      return `await this.repo.${methodName}(${args})`
    }
    const repo = `${toCamelCase(slug)}Repo`
    return `await this.${repo}.${methodName}(${args})`
  }

  if (ctx.mode === 'controller') {
    const svc = `${toCamelCase(slug)}Service`
    return `await this.${svc}.${methodName}(${args})`
  }
  if (slug === ctx.selfResourceSlug) {
    return `await this.${methodName}(${args})`
  }
  const svc = `${toCamelCase(slug)}Service`
  return `await this.${svc}.${methodName}(${args})`
}

/** 业务/控制器流中引用的外部资源（跨 resource / 跨域模块） */
export type ExternalInjectDep = {
  resourceSlug: string
  moduleSlug: string
  layer: 'data' | 'business'
}

export function collectExternalInjectDeps(
  flows: Array<MethodFlow | null | undefined>,
  ctx: Pick<
    FlowEmitContext,
    | 'processorSlugById'
    | 'processorLayerById'
    | 'processorModuleSlugById'
    | 'methodById'
    | 'selfResourceSlug'
    | 'currentModuleSlug'
  >,
): ExternalInjectDep[] {
  const out = new Map<string, ExternalInjectDep>()
  for (const flow of flows) {
    for (const node of flow?.nodes ?? []) {
      if (node.kind !== 'input' && node.kind !== 'output') continue
      const data = asRecord(node.data)
      if (node.kind === 'input' && str(data, 'dataSource') === 'request_header') {
        continue
      }
      const processorId = str(data, 'dataProcessorId')
      if (!processorId) continue
      const resourceSlug = ctx.processorSlugById.get(processorId) || ''
      if (!resourceSlug) continue
      const moduleSlug =
        ctx.processorModuleSlugById?.get(processorId) ||
        ctx.currentModuleSlug ||
        ''
      const layer = ctx.processorLayerById.get(processorId) || 'data'
      const sameResource = resourceSlug === ctx.selfResourceSlug
      const sameModule =
        !moduleSlug ||
        !ctx.currentModuleSlug ||
        moduleSlug === ctx.currentModuleSlug
      if (sameResource && sameModule) continue
      const key = `${moduleSlug}/${resourceSlug}/${layer}`
      if (!out.has(key)) {
        out.set(key, { resourceSlug, moduleSlug, layer })
      }
    }
  }
  return [...out.values()]
}

function emitNodeBlock(
  flow: MethodFlow,
  nodeId: string | null,
  ctx: FlowEmitContext,
  level: number,
  stack: Set<string>,
): string {
  if (!nodeId) return `${indent(level)}return undefined\n`
  if (stack.has(nodeId)) {
    return `${indent(level)}throw new Error(${JSON.stringify(`流程循环：${nodeId}`)})\n`
  }
  const node = flow.nodes.find((n) => n.id === nodeId)
  if (!node) return `${indent(level)}return undefined\n`

  const nextStack = new Set(stack)
  nextStack.add(nodeId)
  const data = asRecord(node.data)
  const pad = indent(level)

  if (node.kind === 'start') {
    return emitNodeBlock(
      flow,
      pickDefaultNext(flow, node.id),
      ctx,
      level,
      nextStack,
    )
  }

  if (node.kind === 'end') {
    const returnExpr = str(data, 'returnExpr').trim()
    const fallback = defaultEmptyReturnCode(ctx.methodOutput)
    return `${pad}return ${returnExpr || fallback};\n`
  }

  if (node.kind === 'throw') {
    const messageExpr = str(data, 'messageExpr').trim() || "'业务异常'"
    return `${pad}throw Object.assign(new Error(String(${messageExpr})), { statusCode: 400 })\n`
  }

  if (node.kind === 'define') {
    const varName = safeIdent(str(data, 'varName'), 'v')
    const initExpr = str(data, 'initExpr').trim()
    let line: string
    if (initExpr) {
      const normalized = initExpr
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l, i) => (i === 0 ? l : `${pad}${l}`))
        .join('\n')
      line = `${pad}let ${varName}: any = ${normalized};\n`
    } else {
      line = `${pad}let ${varName}: any = null;\n`
    }
    return (
      line +
      emitNodeBlock(
        flow,
        pickDefaultNext(flow, node.id),
        ctx,
        level,
        nextStack,
      )
    )
  }

  if (node.kind === 'input') {
    const varName = safeIdent(str(data, 'varName'), 'v')
    const dataSource = str(data, 'dataSource') || 'data'
    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    let assign: string
    if (dataSource === 'request_header') {
      assign = `${pad}const ${varName} = '';\n`
    } else {
      const processorId = str(data, 'dataProcessorId')
      const methodId = str(data, 'dataMethodId')
      const targetServiceId = str(data, 'serviceId')
      const call = emitMethodCall(ctx, processorId, methodId, bindings, {
        serviceId: targetServiceId,
      })
      assign = `${pad}const ${varName} = ${call};\n`
    }
    return (
      assign +
      emitNodeBlock(
        flow,
        pickDefaultNext(flow, node.id),
        ctx,
        level,
        nextStack,
      )
    )
  }

  if (node.kind === 'output') {
    const processorId = str(data, 'dataProcessorId')
    const methodId = str(data, 'dataMethodId')
    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    const resultVar = safeIdent(
      str(data, 'resultVarName') || '_writeResult',
      '_writeResult',
    )
    const call = emitMethodCall(ctx, processorId, methodId, bindings)
    return (
      `${pad}const ${resultVar} = ${call};\n` +
      emitNodeBlock(
        flow,
        pickDefaultNext(flow, node.id),
        ctx,
        level,
        nextStack,
      )
    )
  }

  if (node.kind === 'pageMap') {
    const sourceKind = str(data, 'sourceKind') === 'array' ? 'array' : 'page'
    const sourcePath = str(data, 'sourcePath').trim()
    const targetVarName = safeIdent(
      str(data, 'targetVarName') || str(data, 'targetPath'),
      '_pageTarget',
    )
    const mappings = readPageMapFieldMappings(data.fieldMappings)
    const metaKeys = PAGE_META_FIELDS.map((k) => JSON.stringify(k)).join(', ')

    let block =
      `${pad}let ${targetVarName}: any;\n` +
      `${pad}{\n` +
      `${pad}  const _pageOut: Record<string, unknown> = {};\n`

    if (sourceKind === 'page') {
      block +=
        `${pad}  const _srcPage = ${sourcePath || 'undefined'};\n` +
        `${pad}  if (_srcPage && typeof _srcPage === 'object') {\n` +
        `${pad}    for (const _k of [${metaKeys}] as const) {\n` +
        `${pad}      if (_k in (_srcPage as object)) _pageOut[_k] = (_srcPage as unknown as Record<string, unknown>)[_k];\n` +
        `${pad}    }\n` +
        `${pad}  }\n` +
        `${pad}  const _srcRecords = Array.isArray((_srcPage as unknown as Record<string, unknown>)?.${PAGE_RECORDS_FIELD}) ? ((_srcPage as unknown as Record<string, unknown>).${PAGE_RECORDS_FIELD} as unknown[]) : [];\n`
    } else {
      const currentExpr = str(data, 'currentExpr').trim() || 'undefined'
      const pageSizeExpr = str(data, 'pageSizeExpr').trim() || 'undefined'
      const totalExpr = str(data, 'totalExpr').trim() || 'undefined'
      const hasNextExpr = str(data, 'hasNextExpr').trim()
      block +=
        `${pad}  const _srcRecords = Array.isArray(${sourcePath || 'undefined'}) ? (${sourcePath || 'undefined'} as unknown[]) : [];\n` +
        `${pad}  _pageOut.current = ${currentExpr};\n` +
        `${pad}  _pageOut.pageSize = ${pageSizeExpr};\n` +
        `${pad}  _pageOut.total = ${totalExpr};\n`
      if (hasNextExpr) {
        block += `${pad}  _pageOut.hasNext = ${hasNextExpr};\n`
      } else {
        block +=
          `${pad}  {\n` +
          `${pad}    const _cur = Number(_pageOut.current);\n` +
          `${pad}    const _ps = Number(_pageOut.pageSize);\n` +
          `${pad}    const _tot = Number(_pageOut.total);\n` +
          `${pad}    if (!Number.isNaN(_cur) && !Number.isNaN(_ps) && !Number.isNaN(_tot)) {\n` +
          `${pad}      _pageOut.hasNext = _cur * _ps < _tot;\n` +
          `${pad}    }\n` +
          `${pad}  }\n`
      }
    }

    block += `${pad}  _pageOut.${PAGE_RECORDS_FIELD} = _srcRecords.map((_item) => {\n` +
      `${pad}    const _row: Record<string, unknown> = {};\n`
    for (const m of mappings) {
      const targetField = m.targetField.trim()
      const sourceField = m.sourceField.trim()
      if (!targetField || !sourceField) continue
      block +=
        `${pad}    if (_item && typeof _item === 'object' && ${JSON.stringify(sourceField)} in (_item as object)) {\n` +
        `${pad}      _row[${JSON.stringify(targetField)}] = (_item as unknown as Record<string, unknown>)[${JSON.stringify(sourceField)}];\n` +
        `${pad}    }\n`
    }
    block +=
      `${pad}    return _row;\n` +
      `${pad}  });\n` +
      `${pad}  ${targetVarName} = _pageOut;\n` +
      `${pad}}\n`
    return (
      block +
      emitNodeBlock(
        flow,
        pickDefaultNext(flow, node.id),
        ctx,
        level,
        nextStack,
      )
    )
  }

  if (node.kind === 'objectMap') {
    const sourcePath = str(data, 'sourcePath').trim()
    const targetVarName = safeIdent(
      str(data, 'targetVarName') || str(data, 'targetPath'),
      '_objectTarget',
    )
    const mappings = readObjectMapFieldMappings(data.fieldMappings)
    let block =
      `${pad}let ${targetVarName}: any;\n` +
      `${pad}{\n` +
      `${pad}  const _srcObj = ${sourcePath || 'undefined'};\n` +
      `${pad}  const _objOut: Record<string, unknown> = {};\n` +
      `${pad}  if (_srcObj && typeof _srcObj === 'object') {\n`
    for (const m of mappings) {
      const targetField = m.targetField.trim()
      const sourceField = m.sourceField.trim()
      if (!targetField || !sourceField) continue
      block +=
        `${pad}    if (${JSON.stringify(sourceField)} in (_srcObj as object)) {\n` +
        `${pad}      _objOut[${JSON.stringify(targetField)}] = (_srcObj as unknown as Record<string, unknown>)[${JSON.stringify(sourceField)}];\n` +
        `${pad}    }\n`
    }
    block +=
      `${pad}  }\n` +
      `${pad}  ${targetVarName} = _objOut;\n` +
      `${pad}}\n`
    return (
      block +
      emitNodeBlock(
        flow,
        pickDefaultNext(flow, node.id),
        ctx,
        level,
        nextStack,
      )
    )
  }

  if (node.kind === 'action') {
    const code = str(data, 'code').trim()
    const outputVarRaw = str(data, 'outputVarName').trim()
    const outputVar = outputVarRaw ? safeIdent(outputVarRaw, 'v') : ''
    let block = ''
    if (code) {
      // 与调试运行时一致：action 内 return 是节点出参，不能泄漏成方法 return
      // 前导分号避免上一行无分号时与 IIFE 发生 ASI 粘连
      const inner = code
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => `${pad}  ${l}`)
        .join('\n')
      if (outputVar) {
        block =
          `${pad}const ${outputVar}: any = (() => {\n` +
          `${inner}\n` +
          `${pad}})();\n`
      } else {
        block = `${pad};(() => {\n${inner}\n${pad}})();\n`
      }
    } else if (outputVar) {
      block = `${pad}const ${outputVar}: any = undefined;\n`
    }
    return (
      block +
      emitNodeBlock(
        flow,
        pickDefaultNext(flow, node.id),
        ctx,
        level,
        nextStack,
      )
    )
  }

  if (node.kind === 'branch') {
    const expression = str(data, 'expression').trim() || 'false'
    const trueNext = pickBranchNext(flow, node.id, 'true')
    const falseNext = pickBranchNext(flow, node.id, 'false')
    return (
      `${pad}if (${expression}) {\n` +
      emitNodeBlock(flow, trueNext, ctx, level + 1, nextStack) +
      `${pad}} else {\n` +
      emitNodeBlock(flow, falseNext, ctx, level + 1, nextStack) +
      `${pad}}\n`
    )
  }

  return emitNodeBlock(
    flow,
    pickDefaultNext(flow, node.id),
    ctx,
    level,
    nextStack,
  )
}

export function emitFlowMethodBody(
  flow: MethodFlow | null | undefined,
  ctx: FlowEmitContext,
  level = 2,
): string {
  if (!flow?.nodes?.length) {
    return `${indent(level)}return undefined\n`
  }
  const start = findStart(flow)
  if (!start) {
    return `${indent(level)}throw new Error('工作流缺少开始节点')\n`
  }
  return emitNodeBlock(flow, start.id, ctx, level, new Set())
}

export function emitMethodSignature(
  method: ProcessorMethod,
  idToName: IdToName,
): { params: string; returnType: string } {
  const params = (method.params ?? [])
    .map((p) => {
      const name = safeIdent(p.name, 'param')
      const ty = processorTypeExprToTs(p.typeExpr, idToName)
      return `${name}: ${ty}`
    })
    .join(', ')
  const returnType = processorTypeExprToTs(method.output, idToName)
  return { params, returnType }
}

export function buildMethodIndex(
  dataProcessors: ServiceProcessor[],
  businessProcessors: ServiceProcessor[],
): Map<string, { processorId: string; method: ProcessorMethod }> {
  const map = new Map<
    string,
    { processorId: string; method: ProcessorMethod }
  >()
  for (const p of [...dataProcessors, ...businessProcessors]) {
    for (const m of p.methods ?? []) {
      map.set(m.id, { processorId: p.id, method: m })
    }
  }
  return map
}

export function buildProcessorMaps(
  dataProcessors: ServiceProcessor[],
  businessProcessors: ServiceProcessor[],
): {
  processorSlugById: Map<string, string>
  processorLayerById: Map<string, 'data' | 'business'>
} {
  const processorSlugById = new Map<string, string>()
  const processorLayerById = new Map<string, 'data' | 'business'>()
  for (const p of dataProcessors) {
    processorSlugById.set(p.id, slugify(p.name || p.id, 'resource'))
    processorLayerById.set(p.id, 'data')
  }
  for (const p of businessProcessors) {
    processorSlugById.set(p.id, slugify(p.name || p.id, 'resource'))
    processorLayerById.set(p.id, 'business')
  }
  return { processorSlugById, processorLayerById }
}
