import type {
  MethodFlow,
  FlowNode,
  ProcessorMethod,
  ServiceProcessor,
} from '../../../types/backend-services.js'
import { safeIdent, slugify, toCamelCase } from './names.js'
import { processorTypeExprToTs, type IdToName } from './emit-types.js'

export interface FlowEmitContext {
  /** processorId → resource slug */
  processorSlugById: Map<string, string>
  /** processorId → 'data' | 'business' */
  processorLayerById: Map<string, 'data' | 'business'>
  /** 当前类内资源 slug */
  selfResourceSlug: string
  mode: 'service' | 'controller'
  idToName: IdToName
  methodById: Map<string, { processorId: string; method: ProcessorMethod }>
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
): string {
  const meta = ctx.methodById.get(methodId)
  const method = meta?.method
  if (!method) return `/* missing method ${methodId} */ undefined as never`

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
    const returnExpr = str(data, 'returnExpr').trim() || 'undefined'
    return `${pad}return ${returnExpr}\n`
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
      line = `${pad}let ${varName}: any = ${normalized}\n`
    } else {
      line = `${pad}let ${varName}: any = null\n`
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
    const dataSource = str(data, 'dataSource') || 'other_data'
    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    let assign: string
    if (dataSource === 'request_header') {
      assign = `${pad}const ${varName} = ''\n`
    } else {
      const processorId = str(data, 'dataProcessorId')
      const methodId = str(data, 'dataMethodId')
      const call = emitMethodCall(ctx, processorId, methodId, bindings)
      assign = `${pad}const ${varName} = ${call}\n`
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
      `${pad}const ${resultVar} = ${call}\n` +
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
    let block = ''
    if (code) {
      block += code
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => `${pad}${l}`)
        .join('\n')
      block += '\n'
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
