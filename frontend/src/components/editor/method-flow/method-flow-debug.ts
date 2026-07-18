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
import type { MethodParam } from '../../../types/page-method'

export type FlowDebugSnapshot = {
  cursorNodeId: string
  scope: Record<string, unknown>
  visitedNodeIds: string[]
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

function namedTypeTs(
  typeRef: string,
  library: DataTypeLibrary | null | undefined,
): string {
  if (!typeRef) return ''
  for (const group of library?.groups ?? []) {
    const hit = group.types.find((t) => t.id === typeRef)
    const name = hit?.name?.trim()
    if (name) return name
  }
  return ''
}

function findDataMethod(
  dataProcessors: ServiceProcessor[],
  processorId: string,
  methodId: string,
): ProcessorMethod | null {
  if (!processorId || !methodId) return null
  const proc = dataProcessors.find((p) => p.id === processorId)
  return proc?.methods.find((m) => m.id === methodId) ?? null
}

function varFromNode(
  node: FlowNode,
  dataProcessors: ServiceProcessor[],
  library: DataTypeLibrary | null | undefined,
): MethodParam | null {
  const data = asRecord(node.data)
  if (node.kind === 'input') {
    const varName = str(data, 'varName')
    if (!varName) return null
    const method = findDataMethod(
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
  if (node.kind === 'define') {
    const varName = str(data, 'varName')
    if (!varName) return null
    const valueType = str(data, 'valueType') || 'any'
    const valueTypeRef = str(data, 'valueTypeRef')
    const tsType = namedTypeTs(valueTypeRef, library)
    return {
      name: varName,
      type: valueType as MethodParam['type'],
      typeExpr: {
        type: valueType === 'object' ? 'json' : valueType,
        typeRef: valueTypeRef,
        itemType: valueType === 'array' ? 'any' : '',
        itemTypeRef: '',
        itemItemType: '',
        itemItemTypeRef: '',
        genericArgs: {},
      },
      ...(tsType ? { tsType } : {}),
    }
  }
  if (node.kind === 'action') {
    const varName = str(data, 'outputVarName')
    if (!varName) return null
    const outputType = str(data, 'outputType') || 'void'
    const outputTypeRef = str(data, 'outputTypeRef')
    if (outputType === 'void' && !outputTypeRef) return null
    const tsType = namedTypeTs(outputTypeRef, library)
    const type =
      outputType === 'void' ? 'object' : (outputType as MethodParam['type'])
    return {
      name: varName,
      type,
      typeExpr: {
        type: type === 'object' ? 'json' : type,
        typeRef: outputTypeRef,
        itemType: type === 'array' ? 'any' : '',
        itemTypeRef: '',
        itemItemType: '',
        itemItemTypeRef: '',
        genericArgs: {},
      },
      ...(tsType ? { tsType } : {}),
    }
  }
  if (node.kind === 'output') {
    const varName = str(data, 'resultVarName')
    if (!varName) return null
    const method = findDataMethod(
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
  typeLibrary?: DataTypeLibrary | null
  scope?: Record<string, unknown>
}): FlowAmbientVar[] {
  const {
    flow,
    nodeId,
    methodParams,
    dataProcessors,
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
    const param = varFromNode(n, dataProcessors, typeLibrary)
    if (param) push(param)
  }

  // 运行时多出来的键也展示
  for (const key of Object.keys(scope)) {
    if (vars.some((v) => v.name === key)) continue
    push({ name: key, type: 'any' })
  }

  return vars
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
  const keys = Object.keys(scope)
  const values = keys.map((k) => scope[k])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict";\n${body}`)
  return fn(...values)
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
  dryRun: boolean
}

export type FlowStepResult = {
  scope: Record<string, unknown>
  /** 下一步节点；终止时为 null */
  nextNodeId: string | null
  /** 分支选择等日志 */
  log?: string
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

  if (node.kind === 'start') {
    const next = pickNext(ctx.flow, node, scope)
    return { scope, nextNodeId: next.nextId }
  }

  if (node.kind === 'define') {
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
    return { scope, nextNodeId: next.nextId, log: next.log }
  }

  if (node.kind === 'input') {
    const varName = str(data, 'varName')
    const processorId = str(data, 'dataProcessorId')
    const methodId = str(data, 'dataMethodId')
    if (!varName) throw new Error('输入节点未配置变量名')
    if (!processorId || !methodId) throw new Error('输入节点未配置数据方法')

    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    const params = resolveParamBindings(bindings, scope)
    const result = await debugDataLayerMethod({
      projectPath: ctx.projectPath,
      serviceId: ctx.serviceId,
      processorId,
      methodId,
      params,
      dryRun: ctx.dryRun,
    })
    scope[varName] = result.output
    const next = pickNext(ctx.flow, node, scope)
    return { scope, nextNodeId: next.nextId, log: next.log }
  }

  if (node.kind === 'action') {
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
    return { scope, nextNodeId: next.nextId, log: next.log }
  }

  if (node.kind === 'branch') {
    const next = pickNext(ctx.flow, node, scope)
    return { scope, nextNodeId: next.nextId, log: next.log }
  }

  if (node.kind === 'output') {
    const processorId = str(data, 'dataProcessorId')
    const methodId = str(data, 'dataMethodId')
    if (!processorId || !methodId) throw new Error('输出节点未配置数据层写入方法')

    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    const params = resolveParamBindings(bindings, scope)
    const result = await debugDataLayerMethod({
      projectPath: ctx.projectPath,
      serviceId: ctx.serviceId,
      processorId,
      methodId,
      params,
      dryRun: ctx.dryRun,
    })
    const resultVar = str(data, 'resultVarName')
    if (resultVar) scope[resultVar] = result.output
    const next = pickNext(ctx.flow, node, scope)
    return { scope, nextNodeId: next.nextId, log: next.log }
  }

  if (node.kind === 'end') {
    const next = pickNext(ctx.flow, node, scope)
    return { scope, nextNodeId: next.nextId, log: next.log }
  }

  const next = pickNext(ctx.flow, node, scope)
  return { scope, nextNodeId: next.nextId, log: next.log }
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

  for (const nodeId of path) {
    const step = await executeFlowNode(ctx, nodeId, scope)
    scope = step.scope
    visited.push(nodeId)
  }

  return {
    cursorNodeId: targetNodeId,
    scope,
    visitedNodeIds: visited,
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
  }
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