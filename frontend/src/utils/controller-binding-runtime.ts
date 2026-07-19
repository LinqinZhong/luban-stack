import {
  getServiceControllers,
  getServiceProcessors,
} from '../api/projects'
import type {
  ServiceApi,
  ServiceController,
  ServiceProcessor,
} from '../types/backend-services'
import type {
  ControllerBindingConfig,
  DataField,
  DataFieldValue,
  PageData,
} from '../types/page-data'
import {
  extractFlowReturnValue,
  runFlowToEnd,
} from '../components/editor/method-flow/method-flow-debug'
import { runComputeBody } from './compute-runtime'

type ServiceBundle = {
  controllers: ServiceController[]
  businessProcessors: ServiceProcessor[]
  dataProcessors: ServiceProcessor[]
}

export type ControllerBindingRuntimeOptions = {
  projectPath: string
  /** 触发字段上配置的加载事件（onLoading / onSuccess / onError 原始 JSON） */
  runEvents?: (raw: string) => void | Promise<void>
  /** 预览写操作是否 dryRun；默认 true */
  dryRun?: boolean
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
): Promise<unknown> {
  const flow = api.flow
  if (!flow?.nodes?.length) {
    throw new Error(`API「${api.name || api.id}」未配置流程`)
  }
  const initialScope = cloneValue(api.debugParams ?? {}) as Record<
    string,
    unknown
  >
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
  return extractFlowReturnValue(flow, snap)
}

async function loadOneField(
  field: DataField,
  cfg: ControllerBindingConfig,
  options: ControllerBindingRuntimeOptions,
  cache: Map<string, ServiceBundle>,
): Promise<DataFieldValue> {
  const { projectPath, runEvents, dryRun = true } = options
  const serviceId = cfg.serviceId.trim()
  const controllerId = cfg.controllerId.trim()
  const apiId = cfg.apiId.trim()
  if (!serviceId || !controllerId || !apiId) {
    throw new Error('控制器绑定未选择完整 API')
  }

  if (cfg.onLoading.trim() && runEvents) {
    await runEvents(cfg.onLoading)
  }

  try {
    const bundle = await loadServiceBundle(projectPath, serviceId, cache)
    const api = findApi(bundle.controllers, controllerId, apiId)
    if (!api) {
      throw new Error('找不到绑定的 API（可能已被删除）')
    }
    const raw = await fetchApiData(
      projectPath,
      serviceId,
      api,
      bundle,
      dryRun,
    )
    const data = unwrapResultData(raw)
    const parsed = runParseBody(cfg.parseBody, data)
    if (cfg.onSuccess.trim() && runEvents) {
      await runEvents(cfg.onSuccess)
    }
    return parsed as DataFieldValue
  } catch (err) {
    if (cfg.onError.trim() && runEvents) {
      await runEvents(cfg.onError)
    }
    throw err
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

  await Promise.all(
    targets.map(async (field) => {
      const cfg = field.controllerBinding!
      const name = field.name.trim() || '?'
      try {
        const value = await loadOneField(field, cfg, options, cache)
        field.value = value
      } catch (err) {
        console.warn(`[voider] 控制器字段「${name}」加载失败:`, err)
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
