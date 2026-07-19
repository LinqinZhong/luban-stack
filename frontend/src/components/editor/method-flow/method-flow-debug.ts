import { debugDataLayerMethod } from '../../../api/projects'
import type {
  FlowEdge,
  FlowNode,
  MethodFlow,
  ProcessorMethod,
  ProcessorMethodParam,
  ServiceProcessor,
} from '../../../types/backend-services'
import type { DataTypeLibrary } from '../../../types/data-types'
import {
  processorTypeExprToMethodParamType,
  processorTypeExprToTs,
} from '../../../types/page-method'
import type { MethodParam, MethodParamType, MethodReturnType } from '../../../types/page-method'
import { flowDraftToTypeExpr } from '../../../utils/flow-type-select'

export type FlowDebugSnapshot = {
  cursorNodeId: string
  scope: Record<string, unknown>
  visitedNodeIds: string[]
  /** 各已执行节点的打印文案 */
  printByNode?: Record<string, string>
}

export type FlowAmbientVar = MethodParam & {
  /** 运行时值；未执行到则为 undefined */
  value?: unknown
  /** 是否已有运行时值 */
  hasValue: boolean
}

function asRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  return data as Record<string, unknown>
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === 'string' ? v.trim() : ''
}

function cloneScope(scope: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(scope)
  } catch {
    return JSON.parse(JSON.stringify(scope)) as Record<string, unknown>
  }
}

export function findStartNode(flow: MethodFlow): FlowNode | null {
  return flow.nodes.find((n) => n.kind === 'start') ?? flow.nodes[0] ?? null
}

export function findNode(flow: MethodFlow, id: string): FlowNode | null {
  return flow.nodes.find((n) => n.id === id) ?? null
}

/** 能到达 target 的前驱集合（含 target） */
export function collectAncestorIds(flow: MethodFlow, targetId: string): Set<string> {
  const incoming = new Map<string, string[]>()
  for (const e of flow.edges) {
    const list = incoming.get(e.target) ?? []
    list.push(e.source)
    incoming.set(e.target, list)
  }
  const ancestors = new Set<string>()
  const queue = [targetId]
  while (queue.length) {
    const id = queue.shift()!
    if (ancestors.has(id)) continue
    ancestors.add(id)
    for (const src of incoming.get(id) ?? []) queue.push(src)
  }
  return ancestors
}

function findProcessorMethod(
  processors: ServiceProcessor[],
  processorId: string,
  methodId: string,
): ProcessorMethod | null {
  if (!processorId || !methodId) return null
  const proc = processors.find((p) => p.id === processorId)
  return proc?.methods.find((m) => m.id === methodId) ?? null
}

function varFromNode(
  node: FlowNode,
  dataProcessors: ServiceProcessor[],
  library: DataTypeLibrary | null | undefined,
  businessProcessors: ServiceProcessor[] = [],
): MethodParam | null {
  const data = asRecord(node.data)
  if (node.kind === 'input') {
    const varName = str(data, 'varName')
    if (!varName) return null
    const dataSource = str(data, 'dataSource')
    if (dataSource === 'request_header') {
      return { name: varName, type: 'string', tsType: 'string' }
    }
    const method =
      findProcessorMethod(
        dataProcessors,
        str(data, 'dataProcessorId'),
        str(data, 'dataMethodId'),
      ) ??
      findProcessorMethod(
        businessProcessors,
        str(data, 'dataProcessorId'),
        str(data, 'dataMethodId'),
      )
    if (method?.output) {
      return {
        name: varName,
        type: processorTypeExprToMethodParamType(method.output),
        tsType: processorTypeExprToTs(method.output, library),
        typeExpr: method.output,
      }
    }
    return { name: varName, type: 'any' }
  }
  if (node.kind === 'define') {
    const varName = str(data, 'varName')
    if (!varName) return null
    const valueType = (str(data, 'valueType') || 'any') as MethodParamType
    const genericArgsRaw = asRecord(data.valueGenericArgs)
    const genericArgs: Record<string, string> = {}
    for (const [k, v] of Object.entries(genericArgsRaw)) {
      if (typeof v === 'string') genericArgs[k] = v
    }
    const typeExpr = flowDraftToTypeExpr({
      type: valueType,
      typeRef: str(data, 'valueTypeRef'),
      itemType: str(data, 'valueItemType'),
      itemTypeRef: str(data, 'valueItemTypeRef'),
      itemItemType: str(data, 'valueItemItemType'),
      itemItemTypeRef: str(data, 'valueItemItemTypeRef'),
      genericArgs,
    })
    const tsType = processorTypeExprToTs(typeExpr, library)
    return {
      name: varName,
      type: valueType,
      typeExpr,
      ...(tsType ? { tsType } : {}),
    }
  }
  if (node.kind === 'action') {
    const varName = str(data, 'outputVarName')
    if (!varName) return null
    const outputType = (str(data, 'outputType') || 'void') as MethodReturnType
    const outputTypeRef = str(data, 'outputTypeRef')
    if (outputType === 'void' && !outputTypeRef) return null
    const type =
      outputType === 'void' ? 'object' : (outputType as MethodParam['type'])
    const genericArgsRaw = asRecord(data.outputGenericArgs)
    const genericArgs: Record<string, string> = {}
    for (const [k, v] of Object.entries(genericArgsRaw)) {
      if (typeof v === 'string') genericArgs[k] = v
    }
    const typeExpr = flowDraftToTypeExpr({
      type: outputType === 'void' ? 'object' : outputType,
      typeRef: outputTypeRef,
      itemType: str(data, 'outputItemType'),
      itemTypeRef: str(data, 'outputItemTypeRef'),
      itemItemType: str(data, 'outputItemItemType'),
      itemItemTypeRef: str(data, 'outputItemItemTypeRef'),
      genericArgs,
    })
    const tsType = processorTypeExprToTs(typeExpr, library)
    return {
      name: varName,
      type,
      typeExpr,
      ...(tsType ? { tsType } : {}),
    }
  }
  if (node.kind === 'output') {
    const varName = str(data, 'resultVarName')
    if (!varName) return null
    const method = findProcessorMethod(
      dataProcessors,
      str(data, 'dataProcessorId'),
      str(data, 'dataMethodId'),
    )
    if (method?.output) {
      return {
        name: varName,
        type: processorTypeExprToMethodParamType(method.output),
        tsType: processorTypeExprToTs(method.output, library),
        typeExpr: method.output,
      }
    }
    return { name: varName, type: 'any' }
  }
  return null
}

/** 选中节点时：方法入参 + 前驱节点产生的变量（含当前节点已定义的） */
export function ambientVarsAtNode(options: {
  flow: MethodFlow
  nodeId: string | null
  methodParams: ProcessorMethodParam[]
  dataProcessors: ServiceProcessor[]
  businessProcessors?: ServiceProcessor[]
  typeLibrary?: DataTypeLibrary | null
  scope?: Record<string, unknown>
}): FlowAmbientVar[] {
  const {
    flow,
    nodeId,
    methodParams,
    dataProcessors,
    businessProcessors = [],
    typeLibrary,
    scope = {},
  } = options

  const vars: FlowAmbientVar[] = []
  const push = (p: MethodParam) => {
    if (!p.name || vars.some((v) => v.name === p.name)) return
    const hasValue = Object.prototype.hasOwnProperty.call(scope, p.name)
    vars.push({
      ...p,
      hasValue,
      ...(hasValue ? { value: scope[p.name] } : {}),
    })
  }

  for (const p of methodParams) {
    const name = p.name.trim()
    if (!name) continue
    push({
      name,
      type: processorTypeExprToMethodParamType(p.typeExpr),
      tsType: processorTypeExprToTs(p.typeExpr, typeLibrary),
      typeExpr: p.typeExpr,
    })
  }

  if (!nodeId) return vars

  const ancestors = collectAncestorIds(flow, nodeId)
  for (const n of flow.nodes) {
    if (!ancestors.has(n.id)) continue
    // 当前节点产生的变量在「执行完当前」后才可见；选中查看时包含自身定义
    const param = varFromNode(
      n,
      dataProcessors,
      typeLibrary,
      businessProcessors,
    )
    if (param) push(param)
  }

  // 运行时多出来的键也展示
  for (const key of Object.keys(scope)) {
    if (vars.some((v) => v.name === key)) continue
    push({ name: key, type: 'any' })
  }

  return vars
}

/**
 * 从 API / 方法 flow 的 end.returnExpr 推断返回值类型。
 * 仅当 returnExpr 为合法标识符且能对应前驱变量时给出精确类型，否则 any。
 */
export function resolveFlowReturnMethodParam(options: {
  flow: MethodFlow | null | undefined
  dataProcessors?: ServiceProcessor[]
  businessProcessors?: ServiceProcessor[]
  typeLibrary?: DataTypeLibrary | null
  methodParams?: ProcessorMethodParam[]
}): MethodParam {
  const flow = options.flow
  const fallback: MethodParam = { name: 'data', type: 'any', tsType: 'any' }
  if (!flow?.nodes?.length) return fallback

  const end =
    flow.nodes.find((n) => {
      if (n.kind !== 'end') return false
      return Boolean(str(asRecord(n.data), 'returnExpr'))
    }) ?? flow.nodes.find((n) => n.kind === 'end')
  if (!end) return fallback

  const returnExpr = str(asRecord(end.data), 'returnExpr')
  if (!returnExpr || !/^[A-Za-z_$][\w$]*$/.test(returnExpr)) return fallback

  const vars = ambientVarsAtNode({
    flow,
    nodeId: end.id,
    methodParams: options.methodParams ?? [],
    dataProcessors: options.dataProcessors ?? [],
    businessProcessors: options.businessProcessors ?? [],
    typeLibrary: options.typeLibrary,
  })
  const hit = vars.find((v) => v.name === returnExpr)
  if (!hit) return fallback
  return {
    name: 'data',
    type: hit.type,
    tsType: hit.tsType || 'any',
    typeExpr: hit.typeExpr,
  }
}

function evalInScope(expression: string, scope: Record<string, unknown>): unknown {
  const expr = expression.trim()
  if (!expr) return undefined
  const keys = Object.keys(scope)
  const values = keys.map((k) => scope[k])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict"; return (${expr});`)
  return fn(...values)
}

function runActionCode(code: string, scope: Record<string, unknown>): unknown {
  const body = code.trim()
  if (!body) return undefined
  // 仅合法标识符可作为参数；赋值后写回 scope，避免 `x = …` 只改局部变量
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k))
  const writeBack = keys
    .map((k) => `scope[${JSON.stringify(k)}] = ${k};`)
    .join('\n')
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    ...keys,
    'scope',
    `"use strict";\n${body}\n${writeBack}`,
  )
  const values = keys.map((k) => scope[k])
  return fn(...values, scope)
}

/** 节点「打印」配置：按 console.log 多参求值，多项换行展示 */
export function evalPrintExpr(
  printExpr: string,
  scope: Record<string, unknown>,
): string | null {
  const expr = printExpr.trim()
  if (!expr) return null

  function formatOne(value: unknown): string {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  try {
    const keys = Object.keys(scope)
    const values = keys.map((k) => scope[k])
    // 与 console.log(a, b) 一致：逗号分隔多参 → 气泡中换行
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return [${expr}];`)
    const parts = fn(...values) as unknown
    if (Array.isArray(parts)) {
      if (!parts.length) return ''
      return parts.map(formatOne).join('\n')
    }
    return formatOne(parts)
  } catch (err) {
    try {
      return formatOne(evalInScope(expr, scope))
    } catch {
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

function resolvePrintText(
  data: Record<string, unknown>,
  scope: Record<string, unknown>,
): string | null {
  return evalPrintExpr(str(data, 'printExpr'), scope)
}

function withPrint(
  result: FlowStepResult,
  data: Record<string, unknown>,
  scope: Record<string, unknown>,
): FlowStepResult {
  const printText = resolvePrintText(data, scope)
  if (printText == null) return result
  return { ...result, printText }
}

function resolveParamBindings(
  bindings: Record<string, string>,
  scope: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [param, expr] of Object.entries(bindings)) {
    const raw = expr.trim()
    if (!raw) continue
    try {
      out[param] = evalInScope(raw, scope)
    } catch {
      // 字面量回退：无引号字符串直接当值
      out[param] = raw
    }
  }
  return out
}

export function extractFlowReturnValue(
  flow: MethodFlow,
  snap: FlowDebugSnapshot,
): unknown {
  for (let i = snap.visitedNodeIds.length - 1; i >= 0; i--) {
    const node = findNode(flow, snap.visitedNodeIds[i]!)
    if (node?.kind !== 'end') continue
    const returnExpr = str(asRecord(node.data), 'returnExpr')
    if (!returnExpr) return undefined
    try {
      return evalInScope(returnExpr, snap.scope)
    } catch (err) {
      throw new Error(
        `业务方法返回值求值失败：${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
  const end = flow.nodes.find((n) => n.kind === 'end')
  if (!end) return undefined
  const returnExpr = str(asRecord(end.data), 'returnExpr')
  if (!returnExpr) return undefined
  try {
    return evalInScope(returnExpr, snap.scope)
  } catch {
    return undefined
  }
}

/** 调试执行业务方法工作流，返回终止节点配置的返回值 */
async function debugRunBusinessMethod(
  ctx: FlowStepContext,
  processorId: string,
  methodId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const stackKey = `${processorId}::${methodId}`
  const stack = ctx.businessCallStack ?? []
  if (stack.includes(stackKey)) {
    throw new Error(`业务方法循环调用：${stackKey}`)
  }
  if (stack.length >= 16) {
    throw new Error('业务方法调用嵌套过深')
  }
  const method = findProcessorMethod(
    ctx.businessProcessors ?? [],
    processorId,
    methodId,
  )
  if (!method) {
    throw new Error(`业务方法不存在：${stackKey}`)
  }
  const flow = method.flow
  if (!flow?.nodes?.length) {
    throw new Error(
      `业务方法「${method.name || methodId}」尚未配置工作流`,
    )
  }
  const snap = await runFlowToEnd(
    {
      ...ctx,
      flow,
      businessCallStack: [...stack, stackKey],
    },
    params,
  )
  return extractFlowReturnValue(flow, snap)
}

function defaultForType(type: string): unknown {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'array') return []
  if (type === 'object' || type === 'json') return {}
  if (type === 'string') return ''
  return null
}

export type FlowStepContext = {
  projectPath: string
  serviceId: string
  flow: MethodFlow
  dataProcessors: ServiceProcessor[]
  /** 业务层处理器（输入节点「业务」来源） */
  businessProcessors?: ServiceProcessor[]
  dryRun: boolean
  /** 调试用请求头（输入节点「请求头」来源） */
  requestHeaders?: Record<string, unknown>
  debugHeaders?: Record<string, unknown>
  /** 业务方法调用栈，防止循环 */
  businessCallStack?: string[]
}

export type FlowStepResult = {
  scope: Record<string, unknown>
  /** 下一步节点；终止时为 null */
  nextNodeId: string | null
  /** 分支选择等日志 */
  log?: string
  /** console.log 打印文案 */
  printText?: string | null
}

function outgoingEdges(flow: MethodFlow, sourceId: string): FlowEdge[] {
  return flow.edges.filter((e) => e.source === sourceId)
}

function pickNext(
  flow: MethodFlow,
  node: FlowNode,
  scope: Record<string, unknown>,
): { nextId: string | null; log?: string } {
  const edges = outgoingEdges(flow, node.id)
  if (!edges.length) return { nextId: null }

  if (node.kind === 'branch') {
    const expression = str(asRecord(node.data), 'expression')
    let truthy = false
    try {
      truthy = Boolean(evalInScope(expression || 'false', scope))
    } catch (err) {
      throw new Error(
        `判断表达式失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const handle = truthy ? 'true' : 'false'
    const hit =
      edges.find((e) => (e.sourceHandle || 'default') === handle) ??
      edges.find((e) => !e.sourceHandle || e.sourceHandle === 'default')
    return {
      nextId: hit?.target ?? null,
      log: `判断 → ${truthy ? '是' : '否'}`,
    }
  }

  const def =
    edges.find((e) => !e.sourceHandle || e.sourceHandle === 'default') ??
    edges[0]
  return { nextId: def?.target ?? null }
}

/** 执行单个节点，返回更新后的 scope 与下一节点 */
export async function executeFlowNode(
  ctx: FlowStepContext,
  nodeId: string,
  scopeIn: Record<string, unknown>,
): Promise<FlowStepResult> {
  const node = findNode(ctx.flow, nodeId)
  if (!node) throw new Error(`节点不存在：${nodeId}`)

  const scope = cloneScope(scopeIn)
  const data = asRecord(node.data)
  let result: FlowStepResult

  if (node.kind === 'start') {
    const next = pickNext(ctx.flow, node, scope)
    result = { scope, nextNodeId: next.nextId }
  } else if (node.kind === 'define') {
    const varName = str(data, 'varName')
    const initExpr = str(data, 'initExpr')
    const valueType = str(data, 'valueType') || 'any'
    if (varName) {
      if (initExpr) {
        try {
          scope[varName] = evalInScope(initExpr, scope)
        } catch (err) {
          throw new Error(
            `定义数据「${varName}」初始化失败：${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        }
      } else if (!Object.prototype.hasOwnProperty.call(scope, varName)) {
        scope[varName] = defaultForType(valueType)
      }
    }
    const next = pickNext(ctx.flow, node, scope)
    result = { scope, nextNodeId: next.nextId, log: next.log }
  } else if (node.kind === 'input') {
    const varName = str(data, 'varName')
    const dataSource = str(data, 'dataSource') || 'other_data'
    if (!varName) throw new Error('输入节点未配置变量名')

    if (dataSource === 'request_header') {
      const headerField = str(data, 'headerField') || 'user-id'
      const headers = {
        ...asRecord(ctx.debugHeaders),
        ...asRecord(ctx.requestHeaders),
      }
      const headerVal = headers[headerField]
      scope[varName] = headerVal != null ? headerVal : ''
      const next = pickNext(ctx.flow, node, scope)
      result = { scope, nextNodeId: next.nextId, log: next.log }
    } else if (
      dataSource === 'current_business' ||
      dataSource === 'other_business'
    ) {
      const processorId = str(data, 'dataProcessorId')
      const methodId = str(data, 'dataMethodId')
      if (!processorId || !methodId) {
        throw new Error('输入节点未配置业务方法')
      }
      const bindingsRaw = asRecord(data.paramBindings)
      const bindings: Record<string, string> = {}
      for (const [k, v] of Object.entries(bindingsRaw)) {
        if (typeof v === 'string') bindings[k] = v
      }
      const params = resolveParamBindings(bindings, scope)
      scope[varName] = await debugRunBusinessMethod(
        ctx,
        processorId,
        methodId,
        params,
      )
      const next = pickNext(ctx.flow, node, scope)
      result = { scope, nextNodeId: next.nextId, log: next.log }
    } else {
      const processorId = str(data, 'dataProcessorId')
      const methodId = str(data, 'dataMethodId')
      if (!processorId || !methodId) throw new Error('输入节点未配置数据方法')

      const bindingsRaw = asRecord(data.paramBindings)
      const bindings: Record<string, string> = {}
      for (const [k, v] of Object.entries(bindingsRaw)) {
        if (typeof v === 'string') bindings[k] = v
      }
      const params = resolveParamBindings(bindings, scope)
      const apiResult = await debugDataLayerMethod({
        projectPath: ctx.projectPath,
        serviceId: ctx.serviceId,
        processorId,
        methodId,
        params,
        dryRun: ctx.dryRun,
      })
      scope[varName] = apiResult.output
      const next = pickNext(ctx.flow, node, scope)
      result = { scope, nextNodeId: next.nextId, log: next.log }
    }
  } else if (node.kind === 'action') {
    const code = str(data, 'code')
    const outputVar = str(data, 'outputVarName')
    try {
      const ret = runActionCode(code, scope)
      if (outputVar) scope[outputVar] = ret
    } catch (err) {
      throw new Error(
        `操作节点执行失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const next = pickNext(ctx.flow, node, scope)
    result = { scope, nextNodeId: next.nextId, log: next.log }
  } else if (node.kind === 'branch') {
    const next = pickNext(ctx.flow, node, scope)
    result = { scope, nextNodeId: next.nextId, log: next.log }
  } else if (node.kind === 'output') {
    const processorId = str(data, 'dataProcessorId')
    const methodId = str(data, 'dataMethodId')
    if (!processorId || !methodId) throw new Error('输出节点未配置数据层写入方法')

    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    const params = resolveParamBindings(bindings, scope)
    const apiResult = await debugDataLayerMethod({
      projectPath: ctx.projectPath,
      serviceId: ctx.serviceId,
      processorId,
      methodId,
      params,
      dryRun: ctx.dryRun,
    })
    const resultVar = str(data, 'resultVarName')
    if (resultVar) scope[resultVar] = apiResult.output
    const next = pickNext(ctx.flow, node, scope)
    result = { scope, nextNodeId: next.nextId, log: next.log }
  } else if (node.kind === 'end') {
    const next = pickNext(ctx.flow, node, scope)
    result = { scope, nextNodeId: next.nextId, log: next.log }
  } else {
    const next = pickNext(ctx.flow, node, scope)
    result = { scope, nextNodeId: next.nextId, log: next.log }
  }

  return withPrint(result, data, result.scope)
}

function mergePrint(
  prev: Record<string, string> | undefined,
  nodeId: string,
  printText: string | null | undefined,
): Record<string, string> {
  const next = { ...(prev ?? {}) }
  if (printText != null && printText !== '') next[nodeId] = printText
  return next
}

/** 任选一条从 start 到 target 的简单路径（节点 id 序列） */
function findPathToNode(flow: MethodFlow, targetNodeId: string): string[] | null {
  const start = findStartNode(flow)
  if (!start) return null
  if (start.id === targetNodeId) return [start.id]

  const outgoing = new Map<string, string[]>()
  for (const e of flow.edges) {
    const list = outgoing.get(e.source) ?? []
    list.push(e.target)
    outgoing.set(e.source, list)
  }

  const parent = new Map<string, string>()
  const queue = [start.id]
  const seen = new Set<string>([start.id])
  while (queue.length) {
    const id = queue.shift()!
    for (const next of outgoing.get(id) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      parent.set(next, id)
      if (next === targetNodeId) {
        const path = [targetNodeId]
        let cur = targetNodeId
        while (parent.has(cur)) {
          cur = parent.get(cur)!
          path.push(cur)
        }
        path.reverse()
        return path
      }
      queue.push(next)
    }
  }
  return null
}

/** 从 start 执行到 target（含），沿通往目标的路径执行 */
export async function runFlowToNode(
  ctx: FlowStepContext,
  targetNodeId: string,
  initialScope: Record<string, unknown>,
): Promise<FlowDebugSnapshot> {
  if (!findNode(ctx.flow, targetNodeId)) {
    throw new Error('目标节点不存在')
  }
  const path = findPathToNode(ctx.flow, targetNodeId)
  if (!path?.length) {
    throw new Error('无法从开始节点到达当前节点')
  }

  let scope = cloneScope(initialScope)
  const visited: string[] = []
  let printByNode: Record<string, string> = {}

  for (const nodeId of path) {
    const step = await executeFlowNode(ctx, nodeId, scope)
    scope = step.scope
    visited.push(nodeId)
    printByNode = mergePrint(printByNode, nodeId, step.printText)
  }

  return {
    cursorNodeId: targetNodeId,
    scope,
    visitedNodeIds: visited,
    printByNode,
  }
}

/** 在已执行完 cursor 的前提下，根据当前 scope 推断下一节点 */
export function peekNextNodeId(
  flow: MethodFlow,
  cursorNodeId: string,
  scope: Record<string, unknown>,
): string | null {
  const node = findNode(flow, cursorNodeId)
  if (!node) return null
  return pickNext(flow, node, scope).nextId
}

/**
 * 执行「下一个」节点：当前 cursor 已执行过，推进并执行后继。
 * 若尚无快照，传入 start + 初始 scope 且 visited 为空时，先执行 start。
 */
export async function runFlowNext(
  ctx: FlowStepContext,
  snapshot: FlowDebugSnapshot,
): Promise<FlowDebugSnapshot> {
  const alreadyDone = snapshot.visitedNodeIds.includes(snapshot.cursorNodeId)

  if (!alreadyDone) {
    const step = await executeFlowNode(ctx, snapshot.cursorNodeId, snapshot.scope)
    return {
      cursorNodeId: snapshot.cursorNodeId,
      scope: step.scope,
      visitedNodeIds: [...snapshot.visitedNodeIds, snapshot.cursorNodeId],
      printByNode: mergePrint(
        snapshot.printByNode,
        snapshot.cursorNodeId,
        step.printText,
      ),
    }
  }

  const nextId = peekNextNodeId(ctx.flow, snapshot.cursorNodeId, snapshot.scope)
  if (!nextId) {
    throw new Error('已经没有下一个节点')
  }
  const step = await executeFlowNode(ctx, nextId, snapshot.scope)
  return {
    cursorNodeId: nextId,
    scope: step.scope,
    visitedNodeIds: [...snapshot.visitedNodeIds, nextId],
    printByNode: mergePrint(snapshot.printByNode, nextId, step.printText),
  }
}

/** 从开始节点一路执行到流程结束（列表调试「执行」） */
export async function runFlowToEnd(
  ctx: FlowStepContext,
  initialScope: Record<string, unknown>,
): Promise<FlowDebugSnapshot> {
  const start = findStartNode(ctx.flow)
  if (!start) throw new Error('工作流缺少开始节点')

  let snap: FlowDebugSnapshot = {
    cursorNodeId: start.id,
    scope: cloneScope(initialScope),
    visitedNodeIds: [],
    printByNode: {},
  }

  const maxSteps = Math.max(64, ctx.flow.nodes.length * 4)
  for (let i = 0; i < maxSteps; i++) {
    const done = snap.visitedNodeIds.includes(snap.cursorNodeId)
    if (done) {
      const nextId = peekNextNodeId(ctx.flow, snap.cursorNodeId, snap.scope)
      if (!nextId) return snap
    }
    snap = await runFlowNext(ctx, snap)
  }
  throw new Error('执行步数过多，请检查工作流是否存在环')
}

/** 类型标签（调试面板展示） */
export function ambientTypeLabel(v: FlowAmbientVar): string {
  if (v.tsType) return v.tsType
  return v.type || 'any'
}

export function formatAmbientValue(value: unknown): string {
  if (value === undefined) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}