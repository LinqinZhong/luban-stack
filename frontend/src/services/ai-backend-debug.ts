/**
 * AI 用后端调试：数据层走 HTTP；业务层 / 控制器层走工作流调试运行时。
 */
import {
  debugDataLayerMethod,
  getServiceControllers,
  getServiceProcessors,
} from '../api/projects'
import type {
  MethodFlow,
  ProcessorMethod,
  ServiceApi,
  ServiceProcessor,
} from '../types/backend-services'
import {
  createDefaultMethodFlow,
  createEmptyDataMethodConfig,
  createEmptyProcessorTypeExpr,
} from '../types/backend-services'
import {
  BusinessException,
  extractFlowReturnValue,
  runFlowToEnd,
} from '../components/editor/method-flow/method-flow-debug'

export type BackendDebugLayer = 'data' | 'business' | 'controller'

export type BackendTestCase = {
  /** 用例名 */
  name: string
  layer: BackendDebugLayer
  serviceId: string
  /** data/business：处理器 id；controller：控制器 id */
  targetId: string
  /** data/business：方法 id；controller：API id */
  methodId: string
  /** 入参 */
  params?: Record<string, unknown>
  /** 请求头（控制器/业务可选） */
  headers?: Record<string, unknown>
  /** 默认 true：写操作事务回滚 */
  dryRun?: boolean
  /**
   * 期望：
   * - ok:true 表示应成功
   * - ok:false 表示应失败（可配 errorContains）
   * - equals: 与返回值深度相等（JSON）
   * - contains: 返回值 JSON 字符串应包含该片段
   */
  expect?: {
    ok?: boolean
    errorContains?: string
    equals?: unknown
    contains?: string
  }
}

export type BackendDebugCaseResult = {
  name: string
  layer: BackendDebugLayer
  serviceId: string
  targetId: string
  methodId: string
  passed: boolean
  error?: string
  output?: unknown
  sql?: string
  dryRun?: boolean
  visitedNodeIds?: string[]
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function evaluateExpect(
  expect: BackendTestCase['expect'] | undefined,
  outcome: { ok: boolean; error?: string; output?: unknown },
): { passed: boolean; reason?: string } {
  const wantOk = expect?.ok !== false
  if (wantOk && !outcome.ok) {
    return { passed: false, reason: outcome.error || '执行失败' }
  }
  if (!wantOk && outcome.ok) {
    return { passed: false, reason: '期望失败但执行成功' }
  }
  if (!wantOk && expect?.errorContains) {
    const msg = outcome.error || ''
    if (!msg.includes(expect.errorContains)) {
      return {
        passed: false,
        reason: `错误信息不含「${expect.errorContains}」：${msg || '（空）'}`,
      }
    }
  }
  if (wantOk && expect && 'equals' in expect) {
    if (stableJson(outcome.output) !== stableJson(expect.equals)) {
      return {
        passed: false,
        reason: `返回值不符合 equals 期望。实际：${stableJson(outcome.output)}`,
      }
    }
  }
  if (wantOk && expect?.contains) {
    const text = stableJson(outcome.output) ?? ''
    if (!text.includes(expect.contains)) {
      return {
        passed: false,
        reason: `返回值不含「${expect.contains}」`,
      }
    }
  }
  return { passed: true }
}

function findProcessorMethod(
  processors: ServiceProcessor[],
  processorId: string,
  methodId: string,
): { processor: ServiceProcessor; method: ProcessorMethod } | null {
  const processor = processors.find((p) => p.id === processorId)
  if (!processor) return null
  const method = (processor.methods ?? []).find((m) => m.id === methodId)
  if (!method) return null
  return { processor, method }
}

function apiAsProcessorMethod(api: ServiceApi): ProcessorMethod {
  return {
    id: api.id,
    name: api.name,
    remark: api.remark,
    scope: api.scope === 'private' ? 'private' : 'public',
    params: [],
    output: api.output ?? createEmptyProcessorTypeExpr(),
    dataConfig: createEmptyDataMethodConfig(),
    debugParams: api.debugParams ?? {},
    flow: api.flow ?? createDefaultMethodFlow(),
  }
}

async function loadServiceFlows(projectPath: string, serviceId: string) {
  const [biz, data] = await Promise.all([
    getServiceProcessors(projectPath, serviceId, 'business'),
    getServiceProcessors(projectPath, serviceId, 'data'),
  ])
  return {
    businessProcessors: biz.processors ?? [],
    dataProcessors: data.processors ?? [],
  }
}

async function runFlowMethod(options: {
  projectPath: string
  serviceId: string
  flow: MethodFlow
  params: Record<string, unknown>
  headers?: Record<string, unknown>
  dryRun: boolean
  output?: ProcessorMethod['output']
}): Promise<{
  output: unknown
  visitedNodeIds: string[]
  businessError?: { message: string; code: number }
}> {
  const { businessProcessors, dataProcessors } = await loadServiceFlows(
    options.projectPath,
    options.serviceId,
  )
  if (!options.flow?.nodes?.length) {
    throw new Error('工作流为空，无法调试')
  }
  const snap = await runFlowToEnd(
    {
      projectPath: options.projectPath,
      serviceId: options.serviceId,
      flow: options.flow,
      dataProcessors,
      businessProcessors,
      dryRun: options.dryRun,
      requestHeaders: options.headers,
      debugHeaders: options.headers,
    },
    options.params,
  )
  if (snap.businessError) {
    return {
      output: undefined,
      visitedNodeIds: snap.visitedNodeIds,
      businessError: snap.businessError,
    }
  }
  const output = extractFlowReturnValue(
    options.flow,
    snap,
    options.output ?? null,
  )
  return { output, visitedNodeIds: snap.visitedNodeIds }
}

export async function debugDataMethodForAi(options: {
  projectPath: string
  serviceId: string
  processorId: string
  methodId: string
  params?: Record<string, unknown>
  dryRun?: boolean
}): Promise<BackendDebugCaseResult> {
  const name = `data:${options.serviceId}/${options.processorId}/${options.methodId}`
  try {
    const res = await debugDataLayerMethod({
      projectPath: options.projectPath,
      serviceId: options.serviceId,
      processorId: options.processorId,
      methodId: options.methodId,
      params: options.params ?? {},
      dryRun: options.dryRun !== false,
    })
    return {
      name,
      layer: 'data',
      serviceId: options.serviceId,
      targetId: options.processorId,
      methodId: options.methodId,
      passed: true,
      output: res.output,
      sql: res.sql,
      dryRun: res.dryRun,
    }
  } catch (err) {
    return {
      name,
      layer: 'data',
      serviceId: options.serviceId,
      targetId: options.processorId,
      methodId: options.methodId,
      passed: false,
      error: err instanceof Error ? err.message : '数据层调试失败',
    }
  }
}

export async function debugBusinessMethodForAi(options: {
  projectPath: string
  serviceId: string
  processorId: string
  methodId: string
  params?: Record<string, unknown>
  headers?: Record<string, unknown>
  dryRun?: boolean
}): Promise<BackendDebugCaseResult> {
  const name = `business:${options.serviceId}/${options.processorId}/${options.methodId}`
  try {
    const { businessProcessors } = await loadServiceFlows(
      options.projectPath,
      options.serviceId,
    )
    const hit = findProcessorMethod(
      businessProcessors,
      options.processorId,
      options.methodId,
    )
    if (!hit) {
      throw new Error(
        `业务方法不存在：${options.processorId}/${options.methodId}`,
      )
    }
    const flow = hit.method.flow ?? createDefaultMethodFlow()
    const ran = await runFlowMethod({
      projectPath: options.projectPath,
      serviceId: options.serviceId,
      flow,
      params: options.params ?? {},
      headers: options.headers,
      dryRun: options.dryRun !== false,
      output: hit.method.output,
    })
    if (ran.businessError) {
      throw new BusinessException(ran.businessError.message)
    }
    return {
      name,
      layer: 'business',
      serviceId: options.serviceId,
      targetId: options.processorId,
      methodId: options.methodId,
      passed: true,
      output: ran.output,
      visitedNodeIds: ran.visitedNodeIds,
      dryRun: options.dryRun !== false,
    }
  } catch (err) {
    return {
      name,
      layer: 'business',
      serviceId: options.serviceId,
      targetId: options.processorId,
      methodId: options.methodId,
      passed: false,
      error: err instanceof Error ? err.message : '业务层调试失败',
    }
  }
}

export async function debugControllerApiForAi(options: {
  projectPath: string
  serviceId: string
  controllerId: string
  apiId: string
  params?: Record<string, unknown>
  headers?: Record<string, unknown>
  dryRun?: boolean
}): Promise<BackendDebugCaseResult> {
  const name = `controller:${options.serviceId}/${options.controllerId}/${options.apiId}`
  try {
    const res = await getServiceControllers(
      options.projectPath,
      options.serviceId,
    )
    const controller = (res.controllers ?? []).find(
      (c) => c.id === options.controllerId,
    )
    if (!controller) throw new Error(`未找到控制器：${options.controllerId}`)
    const api = (controller.apis ?? []).find((a) => a.id === options.apiId)
    if (!api) throw new Error(`未找到 API：${options.apiId}`)
    const method = apiAsProcessorMethod(api)
    const ran = await runFlowMethod({
      projectPath: options.projectPath,
      serviceId: options.serviceId,
      flow: method.flow,
      params: options.params ?? {},
      headers: options.headers,
      dryRun: options.dryRun !== false,
      output: method.output,
    })
    if (ran.businessError) {
      throw new BusinessException(ran.businessError.message)
    }
    return {
      name,
      layer: 'controller',
      serviceId: options.serviceId,
      targetId: options.controllerId,
      methodId: options.apiId,
      passed: true,
      output: ran.output,
      visitedNodeIds: ran.visitedNodeIds,
      dryRun: options.dryRun !== false,
    }
  } catch (err) {
    return {
      name,
      layer: 'controller',
      serviceId: options.serviceId,
      targetId: options.controllerId,
      methodId: options.apiId,
      passed: false,
      error: err instanceof Error ? err.message : '控制器调试失败',
    }
  }
}

export async function runBackendTestCase(
  projectPath: string,
  testCase: BackendTestCase,
): Promise<BackendDebugCaseResult> {
  const dryRun = testCase.dryRun !== false
  let raw: BackendDebugCaseResult
  if (testCase.layer === 'data') {
    raw = await debugDataMethodForAi({
      projectPath,
      serviceId: testCase.serviceId,
      processorId: testCase.targetId,
      methodId: testCase.methodId,
      params: testCase.params,
      dryRun,
    })
  } else if (testCase.layer === 'business') {
    raw = await debugBusinessMethodForAi({
      projectPath,
      serviceId: testCase.serviceId,
      processorId: testCase.targetId,
      methodId: testCase.methodId,
      params: testCase.params,
      headers: testCase.headers,
      dryRun,
    })
  } else {
    raw = await debugControllerApiForAi({
      projectPath,
      serviceId: testCase.serviceId,
      controllerId: testCase.targetId,
      apiId: testCase.methodId,
      params: testCase.params,
      headers: testCase.headers,
      dryRun,
    })
  }

  const judged = evaluateExpect(testCase.expect, {
    ok: raw.passed,
    error: raw.error,
    output: raw.output,
  })
  return {
    ...raw,
    name: testCase.name || raw.name,
    passed: judged.passed,
    error: judged.passed ? undefined : judged.reason || raw.error,
  }
}

export async function runBackendTestSuite(options: {
  projectPath: string
  cases: BackendTestCase[]
}): Promise<{
  passed: boolean
  total: number
  passedCount: number
  failedCount: number
  results: BackendDebugCaseResult[]
}> {
  if (!options.cases.length) {
    throw new Error('cases 不能为空：请生成全面测试用例后再调用')
  }
  const results: BackendDebugCaseResult[] = []
  for (const item of options.cases) {
    results.push(await runBackendTestCase(options.projectPath, item))
  }
  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.length - passedCount
  return {
    passed: failedCount === 0,
    total: results.length,
    passedCount,
    failedCount,
    results,
  }
}

/** 后端写操作工具：调用后必须再跑测试套件 */
export function isBackendMutatingTool(tool: string): boolean {
  return (
    tool.startsWith('upsert_backend_') ||
    tool.startsWith('delete_backend_') ||
    tool.startsWith('upsert_service_') ||
    tool.startsWith('delete_service_') ||
    tool.startsWith('upsert_processor_') ||
    tool.startsWith('delete_processor_') ||
    tool === 'upsert_service_controller' ||
    tool === 'delete_service_controller' ||
    tool === 'upsert_service_api' ||
    tool === 'delete_service_api' ||
    tool === 'upsert_service_processor' ||
    tool === 'delete_service_processor'
  )
}

export function isBackendTestTool(tool: string): boolean {
  return (
    tool === 'run_backend_tests' ||
    tool === 'debug_data_layer_method' ||
    tool === 'debug_business_method' ||
    tool === 'debug_controller_api'
  )
}
