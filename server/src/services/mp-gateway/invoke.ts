import type {
  FlowEdge,
  FlowNode,
  MethodFlow,
  ServiceApi,
  ServiceController,
  ServiceProcessor,
} from '../../types/backend-services.js'
import {
  readBackendServiceLibrary,
  readServiceControllers,
  readServiceProcessors,
} from '../backend-services.js'
import { debugDataLayerMethod } from '../data-method-debug.js'
import { ProjectError } from '../project.js'
import { joinControllerApiPath } from '../export-mp-wx/api-runtime.js'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
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

function evalInScope(expression: string, scope: Record<string, unknown>): unknown {
  const expr = expression.trim()
  if (!expr) return undefined
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k))
  const values = keys.map((k) => scope[k])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict"; return (${expr});`)
  return fn(...values)
}

function runActionCode(code: string, scope: Record<string, unknown>): unknown {
  const body = code.trim()
  if (!body) return undefined
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
  return fn(...keys.map((k) => scope[k]), scope)
}

function findNode(flow: MethodFlow, id: string): FlowNode | null {
  return flow.nodes.find((n) => n.id === id) ?? null
}

function findStart(flow: MethodFlow): FlowNode | null {
  return flow.nodes.find((n) => n.kind === 'start') ?? null
}

function findProcessorMethod(
  processors: ServiceProcessor[],
  processorId: string,
  methodId: string,
) {
  const proc = processors.find((p) => p.id === processorId)
  return proc?.methods.find((m) => m.id === methodId) ?? null
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
      out[param] = raw
    }
  }
  return out
}

function pickNext(
  flow: MethodFlow,
  node: FlowNode,
  scope: Record<string, unknown>,
): string | null {
  const edges = flow.edges.filter((e) => e.source === node.id)
  if (!edges.length) return null
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
      edges.find((e: FlowEdge) => (e.sourceHandle || 'default') === handle) ??
      edges.find((e) => !e.sourceHandle || e.sourceHandle === 'default')
    return hit?.target ?? null
  }
  const def =
    edges.find((e) => !e.sourceHandle || e.sourceHandle === 'default') ??
    edges[0]
  return def?.target ?? null
}

function extractReturnValue(
  flow: MethodFlow,
  visited: string[],
  scope: Record<string, unknown>,
): unknown {
  for (let i = visited.length - 1; i >= 0; i--) {
    const node = findNode(flow, visited[i]!)
    if (node?.kind !== 'end') continue
    const returnExpr = str(asRecord(node.data), 'returnExpr')
    if (!returnExpr) return undefined
    return evalInScope(returnExpr, scope)
  }
  const end = flow.nodes.find((n) => n.kind === 'end')
  if (!end) return undefined
  const returnExpr = str(asRecord(end.data), 'returnExpr')
  if (!returnExpr) return undefined
  try {
    return evalInScope(returnExpr, scope)
  } catch {
    return undefined
  }
}

type RunnerCtx = {
  projectPath: string
  serviceId: string
  flow: MethodFlow
  dataProcessors: ServiceProcessor[]
  businessProcessors: ServiceProcessor[]
  dryRun: boolean
  businessCallStack: string[]
}

async function runBusinessMethod(
  ctx: RunnerCtx,
  processorId: string,
  methodId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const stackKey = `${processorId}::${methodId}`
  if (ctx.businessCallStack.includes(stackKey)) {
    throw new Error(`业务方法循环调用：${stackKey}`)
  }
  if (ctx.businessCallStack.length >= 16) {
    throw new Error('业务方法调用嵌套过深')
  }
  const method = findProcessorMethod(ctx.businessProcessors, processorId, methodId)
  if (!method) throw new Error(`业务方法不存在：${stackKey}`)
  const flow = method.flow
  if (!flow?.nodes?.length) {
    throw new Error(`业务方法「${method.name || methodId}」尚未配置工作流`)
  }
  return runFlowToEnd(
    {
      ...ctx,
      flow,
      businessCallStack: [...ctx.businessCallStack, stackKey],
    },
    params,
  )
}

async function executeNode(
  ctx: RunnerCtx,
  nodeId: string,
  scopeIn: Record<string, unknown>,
): Promise<{ scope: Record<string, unknown>; nextId: string | null }> {
  const node = findNode(ctx.flow, nodeId)
  if (!node) throw new Error(`节点不存在：${nodeId}`)
  const scope = cloneScope(scopeIn)
  const data = asRecord(node.data)

  if (node.kind === 'start' || node.kind === 'end') {
    return { scope, nextId: pickNext(ctx.flow, node, scope) }
  }

  if (node.kind === 'define') {
    const varName = str(data, 'varName')
    const initExpr = str(data, 'initExpr')
    if (varName && initExpr) {
      scope[varName] = evalInScope(initExpr, scope)
    } else if (varName && !Object.prototype.hasOwnProperty.call(scope, varName)) {
      scope[varName] = null
    }
    return { scope, nextId: pickNext(ctx.flow, node, scope) }
  }

  if (node.kind === 'input') {
    const varName = str(data, 'varName')
    if (!varName) throw new Error('输入节点未配置变量名')
    const dataSource = str(data, 'dataSource') || 'other_data'
    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    const params = resolveParamBindings(bindings, scope)

    if (dataSource === 'request_header') {
      scope[varName] = ''
    } else if (
      dataSource === 'current_business' ||
      dataSource === 'other_business'
    ) {
      const processorId = str(data, 'dataProcessorId')
      const methodId = str(data, 'dataMethodId')
      if (!processorId || !methodId) throw new Error('输入节点未配置业务方法')
      scope[varName] = await runBusinessMethod(ctx, processorId, methodId, params)
    } else {
      const processorId = str(data, 'dataProcessorId')
      const methodId = str(data, 'dataMethodId')
      if (!processorId || !methodId) throw new Error('输入节点未配置数据方法')
      const apiResult = await debugDataLayerMethod({
        projectPath: ctx.projectPath,
        serviceId: ctx.serviceId,
        processorId,
        methodId,
        params,
        dryRun: ctx.dryRun,
      })
      scope[varName] = apiResult.output
    }
    return { scope, nextId: pickNext(ctx.flow, node, scope) }
  }

  if (node.kind === 'action') {
    const code = str(data, 'code')
    const outputVar = str(data, 'outputVarName')
    const ret = runActionCode(code, scope)
    if (outputVar) scope[outputVar] = ret
    return { scope, nextId: pickNext(ctx.flow, node, scope) }
  }

  if (node.kind === 'branch') {
    return { scope, nextId: pickNext(ctx.flow, node, scope) }
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
    return { scope, nextId: pickNext(ctx.flow, node, scope) }
  }

  return { scope, nextId: pickNext(ctx.flow, node, scope) }
}

async function runFlowToEnd(
  ctx: RunnerCtx,
  initialScope: Record<string, unknown>,
): Promise<unknown> {
  const start = findStart(ctx.flow)
  if (!start) throw new Error('工作流缺少开始节点')

  let scope = cloneScope(initialScope)
  let cursor = start.id
  const visited: string[] = []
  const maxSteps = Math.max(64, ctx.flow.nodes.length * 4)

  for (let i = 0; i < maxSteps; i++) {
    const step = await executeNode(ctx, cursor, scope)
    scope = step.scope
    visited.push(cursor)
    if (!step.nextId) break
    cursor = step.nextId
  }

  return extractReturnValue(ctx.flow, visited, scope)
}

function normalizeReqPath(raw: string): string {
  const pathOnly = raw.split('?')[0] || '/'
  if (!pathOnly || pathOnly === '/') return '/'
  return pathOnly.startsWith('/') ? pathOnly.replace(/\/+$/, '') || '/' : `/${pathOnly}`
}

export type MpInvokeMatch = {
  serviceId: string
  controller: ServiceController
  api: ServiceApi
  path: string
}

/** 在项目中按 HTTP method + path 查找控制器 API */
export async function findApiByHttpPath(
  projectPath: string,
  method: string,
  requestPath: string,
): Promise<MpInvokeMatch | null> {
  const wantMethod = method.toUpperCase()
  const wantPath = normalizeReqPath(requestPath)
  const library = await readBackendServiceLibrary(projectPath)

  for (const svc of library.services) {
    let controllers: ServiceController[]
    try {
      controllers = await readServiceControllers(projectPath, svc.id)
    } catch {
      continue
    }
    for (const ctrl of controllers) {
      for (const api of ctrl.apis ?? []) {
        const full = normalizeReqPath(
          joinControllerApiPath(ctrl.path || '', api.path || ''),
        )
        const apiMethod = (api.method || 'GET').toUpperCase()
        if (full === wantPath && apiMethod === wantMethod) {
          return {
            serviceId: svc.id,
            controller: ctrl,
            api,
            path: full,
          }
        }
      }
    }
  }
  return null
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const t = value.trim()
  if (!t) return value
  if (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']'))
  ) {
    try {
      return JSON.parse(t)
    } catch {
      return value
    }
  }
  return value
}

/** 从 query/body 组装 API 入参 scope */
export function assembleApiScope(
  api: ServiceApi,
  query: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const scope: Record<string, unknown> = {
    ...cloneScope(api.debugParams ?? {}),
  }
  for (const inp of api.inputs ?? []) {
    const name = (inp.varName || '').trim()
    if (!name) continue
    const location = (inp.location || 'query').toLowerCase()
    const bag = location === 'body' ? body : query
    if (Object.prototype.hasOwnProperty.call(bag, name)) {
      scope[name] = parseMaybeJson(bag[name])
    } else if (Object.prototype.hasOwnProperty.call(body, name)) {
      scope[name] = parseMaybeJson(body[name])
    } else if (Object.prototype.hasOwnProperty.call(query, name)) {
      scope[name] = parseMaybeJson(query[name])
    } else if (inp.required && !(name in scope)) {
      throw new ProjectError(`缺少必填入参「${name}」`, 400)
    }
  }
  // 也合并未声明的 body/query，方便调试
  for (const [k, v] of Object.entries({ ...query, ...body })) {
    if (!(k in scope)) scope[k] = parseMaybeJson(v)
  }
  return scope
}

export async function invokeMatchedApi(options: {
  projectPath: string
  match: MpInvokeMatch
  query: Record<string, unknown>
  body: Record<string, unknown>
  dryRun?: boolean
}): Promise<unknown> {
  const { projectPath, match } = options
  const dryRun = options.dryRun === true
  const api = match.api
  if (!api.flow?.nodes?.length) {
    throw new ProjectError(`API「${api.name || api.id}」未配置流程`, 400)
  }

  const [businessProcessors, dataProcessors] = await Promise.all([
    readServiceProcessors(projectPath, match.serviceId, 'business'),
    readServiceProcessors(projectPath, match.serviceId, 'data'),
  ])

  const initialScope = assembleApiScope(api, options.query, options.body)
  const value = await runFlowToEnd(
    {
      projectPath,
      serviceId: match.serviceId,
      flow: api.flow,
      dataProcessors,
      businessProcessors,
      dryRun,
      businessCallStack: [],
    },
    initialScope,
  )
  return value
}
