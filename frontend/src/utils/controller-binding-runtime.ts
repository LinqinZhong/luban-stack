import {
  getServiceControllers,
  getServiceProcessors,
} from '../api/projects'
import type {
  ServiceApi,
  ServiceController,
  ServiceProcessor,
} from '../types/backend-services'
import type { DataTypeLibrary } from '../types/data-types'
import type {
  ControllerBindingConfig,
  ControllerInputParamConfig,
  DataField,
  DataFieldValue,
  PageData,
} from '../types/page-data'
import { fillNamedInterfaceDefaults } from './named-type-fields'
import {
  extractFlowReturnValue,
  runFlowToEnd,
} from '../components/editor/method-flow/method-flow-debug'
import { runComputeBody } from './compute-runtime'
import { useWorkspaceSettingsStore } from '../stores/workspace-settings'

type ServiceBundle = {
  controllers: ServiceController[]
  businessProcessors: ServiceProcessor[]
  dataProcessors: ServiceProcessor[]
}

export type ControllerBindingRuntimeOptions = {
  projectPath: string
  /** 触发字段上配置的加载事件；eventArgs 含成功/失败的 res */
  runEvents?: (
    raw: string,
    eventArgs?: Record<string, unknown>,
    meta?: { hook?: string },
  ) => void | Promise<void>
  /** 预览写操作是否 dryRun；默认 true */
  dryRun?: boolean
  /**
   * 用于解析 binding 入参的数据池 scope（通常为当前页 fields 的值）。
   * 未传时从 loadControllerBoundPageData 的 fields 自动构建。
   */
  pageScope?: Record<string, unknown>
  /** 具名类型库：回填 json 字段时补齐 interface 缺省值（如 number → 0） */
  typeLibrary?: DataTypeLibrary | null
}

function cloneValue<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

function findApi(
  controllers: ServiceController[],
  controllerId: string,
  apiId: string,
): ServiceApi | null {
  const ctrl = controllers.find((c) => c.id === controllerId)
  return ctrl?.apis.find((a) => a.id === apiId) ?? null
}

/** 数据池字段 → 绑定求值用的 scope */
export function seedPageScope(fields: DataField[]): Record<string, unknown> {
  const scope: Record<string, unknown> = {}
  for (const field of fields) {
    const name = field.name.trim()
    if (!name || !isValidIdent(name)) continue
    scope[name] = cloneValue(field.value)
  }
  return scope
}

function evalInScope(expression: string, scope: Record<string, unknown>): unknown {
  const expr = expression.trim()
  if (!expr) return undefined
  const keys = Object.keys(scope).filter(isValidIdent)
  const values = keys.map((k) => scope[k])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict"; return (${expr});`)
  return fn(...values)
}

function resolveInputValue(
  cfg: ControllerInputParamConfig | undefined,
  varName: string,
  api: ServiceApi,
  pageScope: Record<string, unknown>,
): unknown {
  const debug = api.debugParams ?? {}
  if (!cfg) {
    return varName in debug ? cloneValue(debug[varName]) : undefined
  }
  if (cfg.source === 'binding') {
    const path = (cfg.binding ?? '').trim()
    if (!path) return undefined
    try {
      return evalInScope(path, pageScope)
    } catch {
      return undefined
    }
  }
  if ('literal' in cfg) return cloneValue(cfg.literal)
  return varName in debug ? cloneValue(debug[varName]) : undefined
}

function coerceApiInputValue(
  value: unknown,
  inp: { type?: string; typeExpr?: { type?: string } | null },
): unknown {
  const t = (inp.typeExpr?.type || inp.type || '').trim()
  if (t === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value)
      if (Number.isFinite(n)) return n
    }
    return value
  }
  if (t === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase()
      if (s === 'true' || s === '1') return true
      if (s === 'false' || s === '0') return false
    }
    if (typeof value === 'number') return value !== 0
    return value
  }
  if (t === 'string') {
    if (value == null) return value
    if (typeof value === 'string') return value
    return String(value)
  }
  return value
}

/**
 * 按 API inputs + 绑定配置组装 flow 初始 scope。
 * 无配置回退 api.debugParams；必填缺失则抛错。
 */
export function assembleControllerApiScope(
  api: ServiceApi,
  inputs: Record<string, ControllerInputParamConfig> | undefined,
  pageScope: Record<string, unknown>,
): Record<string, unknown> {
  const scope: Record<string, unknown> = {
    ...cloneValue(api.debugParams ?? {}),
  }
  for (const inp of api.inputs ?? []) {
    const name = inp.varName.trim()
    if (!name) continue
    const value = resolveInputValue(inputs?.[name], name, api, pageScope)
    const missing =
      value === undefined ||
      value === null ||
      (!(inp.type === 'json' || inp.typeRef) && value === '')
    if (missing) {
      if (inp.required) {
        throw new Error(`${name}不能为空`)
      }
      if (value === undefined) continue
    }
    scope[name] = coerceApiInputValue(value, inp)
  }
  return scope
}

/**
 * 若业务层偶发返回整包 Result，解包 data；否则原样返回（API flow 通常已是 Result.data）。
 */
function unwrapResultData(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = raw as Record<string, unknown>
  if (!('data' in obj)) return raw
  const keys = Object.keys(obj)
  const looksLikeResult =
    'code' in obj || 'message' in obj || 'msg' in obj || keys.length <= 4
  return looksLikeResult ? obj.data : raw
}

function runParseBody(body: string, data: unknown): unknown {
  const trimmed = body.trim()
  if (!trimmed) return data
  return runComputeBody(trimmed, { data })
}

async function loadServiceBundle(
  projectPath: string,
  serviceId: string,
  cache: Map<string, ServiceBundle>,
): Promise<ServiceBundle> {
  const hit = cache.get(serviceId)
  if (hit) return hit
  const [ctrlRes, biz, data] = await Promise.all([
    getServiceControllers(projectPath, serviceId),
    getServiceProcessors(projectPath, serviceId, 'business'),
    getServiceProcessors(projectPath, serviceId, 'data'),
  ])
  const bundle: ServiceBundle = {
    controllers: ctrlRes.controllers ?? [],
    businessProcessors: biz.processors ?? [],
    dataProcessors: data.processors ?? [],
  }
  cache.set(serviceId, bundle)
  return bundle
}

async function fetchApiData(
  projectPath: string,
  serviceId: string,
  api: ServiceApi,
  bundle: ServiceBundle,
  dryRun: boolean,
  initialScope: Record<string, unknown>,
): Promise<unknown> {
  const flow = api.flow
  if (!flow?.nodes?.length) {
    throw new Error(`API「${api.name || api.id}」未配置流程`)
  }
  const snap = await runFlowToEnd(
    {
      projectPath,
      serviceId,
      flow,
      dataProcessors: bundle.dataProcessors,
      businessProcessors: bundle.businessProcessors,
      dryRun,
    },
    initialScope,
  )
  const value = extractFlowReturnValue(flow, snap, api.output)
  await applyPreviewApiLatency()
  return value
}

/** 工作区「模拟 API 延迟」：预览返回前再等一段时间 */
async function applyPreviewApiLatency() {
  try {
    const ms = useWorkspaceSettingsStore().apiLatencyMs
    if (typeof ms === 'number' && ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
  } catch {
    // pinia 未就绪时忽略
  }
}

async function loadOneField(
  field: DataField,
  cfg: ControllerBindingConfig,
  options: ControllerBindingRuntimeOptions,
  cache: Map<string, ServiceBundle>,
  pageScope: Record<string, unknown>,
): Promise<DataFieldValue> {
  const { projectPath, runEvents, dryRun = true } = options
  const serviceId = cfg.serviceId.trim()
  const controllerId = cfg.controllerId.trim()
  const apiId = cfg.apiId.trim()
  if (!serviceId || !controllerId || !apiId) {
    throw new Error('控制器绑定未选择完整 API')
  }

  if (cfg.onLoading.trim() && runEvents) {
    await runEvents(cfg.onLoading, undefined, { hook: 'onLoading' })
  }

  try {
    const bundle = await loadServiceBundle(projectPath, serviceId, cache)
    const api = findApi(bundle.controllers, controllerId, apiId)
    if (!api) {
      throw new Error('找不到绑定的 API（可能已被删除）')
    }
    const initialScope = assembleControllerApiScope(
      api,
      cfg.inputs,
      pageScope,
    )
    const raw = await fetchApiData(
      projectPath,
      serviceId,
      api,
      bundle,
      dryRun,
      initialScope,
    )
    const data = unwrapResultData(raw)
    const parsed = runParseBody(cfg.parseBody, data)
    const filled =
      field.type === 'json' &&
      field.typeRef &&
      parsed != null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
        ? fillNamedInterfaceDefaults(
            parsed,
            field.typeRef,
            options.typeLibrary,
          )
        : parsed
    if (cfg.onSuccess.trim() && runEvents) {
      await runEvents(cfg.onSuccess, { res: filled }, { hook: 'onSuccess' })
    }
    return filled as DataFieldValue
  } catch (err) {
    if (cfg.onError.trim() && runEvents) {
      await runEvents(cfg.onError, { res: err }, { hook: 'onError' })
    }
    throw err
  } finally {
    if (cfg.onFinally?.trim() && runEvents) {
      await runEvents(cfg.onFinally, undefined, { hook: 'onFinally' })
    }
  }
}

/**
 * 预览态：执行数据池中 binding === 'controller' 的字段（跑 API flow + 自定义解析）。
 * 返回带写入值的 PageData 副本；计算字段仍由 resolveComputedPageData 二次处理。
 */
export async function loadControllerBoundPageData(
  data: PageData | undefined | null,
  options: ControllerBindingRuntimeOptions,
): Promise<PageData> {
  const fields: DataField[] = (data?.fields ?? []).map((item) => ({
    ...item,
    arrayFields: item.arrayFields ? [...item.arrayFields] : undefined,
    objectFields: item.objectFields ? [...item.objectFields] : undefined,
  }))

  const targets = fields.filter(
    (f) => f.binding === 'controller' && f.controllerBinding,
  )
  if (!targets.length) return { fields }

  const cache = new Map<string, ServiceBundle>()
  const pageScope = options.pageScope ?? seedPageScope(fields)

  await Promise.all(
    targets.map(async (field) => {
      const cfg = field.controllerBinding!
      const name = field.name.trim() || '?'
      try {
        const value = await loadOneField(
          field,
          cfg,
          options,
          cache,
          pageScope,
        )
        field.value = value as DataFieldValue
        if (name && isValidIdent(name)) {
          pageScope[name] = cloneValue(value)
        }
      } catch (err) {
        console.warn(`[luban] 控制器字段「${name}」加载失败:`, err)
      }
    }),
  )

  return { fields }
}

/** 是否存在需要预览拉取的控制器绑定字段 */
export function hasControllerBoundFields(
  data: PageData | undefined | null,
): boolean {
  return (data?.fields ?? []).some(
    (f) =>
      f.binding === 'controller' &&
      Boolean(f.controllerBinding?.apiId?.trim()) &&
      isValidIdent(f.name.trim()),
  )
}

/**
 * 组件 api 参数：按绑定直接调用控制器 API。
 * `args` 中与 API inputs 同名的字段作为字面量入参；
 * `binding.paramBindings` 从 pageScope 解析或使用常量补齐（调用方 args 优先）。
 */
export async function invokeBoundControllerApi(
  binding: {
    serviceId: string
    controllerId: string
    apiId: string
    paramBindings?: Record<
      string,
      | string
      | { source?: string; binding?: string; literal?: string }
    >
  },
  args: Record<string, unknown> | undefined | null,
  options: ControllerBindingRuntimeOptions,
): Promise<unknown> {
  const serviceId = binding.serviceId.trim()
  const controllerId = binding.controllerId.trim()
  const apiId = binding.apiId.trim()
  if (!serviceId || !controllerId || !apiId) {
    throw new Error('API 参数未选择完整接口')
  }
  const cache = new Map<string, ServiceBundle>()
  const bundle = await loadServiceBundle(options.projectPath, serviceId, cache)
  const api = findApi(bundle.controllers, controllerId, apiId)
  if (!api) {
    throw new Error('找不到绑定的 API（可能已被删除）')
  }
  const callArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const pageScope = options.pageScope ?? {}
  const inputs: Record<string, ControllerInputParamConfig> = {}
  for (const [key, raw] of Object.entries(binding.paramBindings ?? {})) {
    const name = key.trim()
    if (!name) continue
    if (Object.prototype.hasOwnProperty.call(callArgs, name)) continue
    if (typeof raw === 'string') {
      const expr = raw.trim()
      if (!expr) continue
      inputs[name] = { source: 'binding', binding: expr }
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    if (raw.source === 'literal') {
      inputs[name] = { source: 'literal', literal: raw.literal ?? '' }
      continue
    }
    const expr = String(raw.binding ?? '').trim()
    if (!expr) continue
    inputs[name] = { source: 'binding', binding: expr }
  }
  for (const [key, value] of Object.entries(callArgs)) {
    if (!key.trim()) continue
    inputs[key] = { source: 'literal', literal: value }
  }
  const initialScope = assembleControllerApiScope(api, inputs, {
    ...pageScope,
    ...callArgs,
  })
  const raw = await fetchApiData(
    options.projectPath,
    serviceId,
    api,
    bundle,
    options.dryRun ?? true,
    initialScope,
  )
  return unwrapResultData(raw)
}
