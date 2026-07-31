import {
  CUSTOM_EVENT_METHOD,
  isCustomEventMethod,
  parseEventBindings,
  type EventMethodBinding,
  type PageMethod,
} from '../types/page-method'
import {
  defaultValue,
  type DataField,
  type DataFieldType,
  type DataFieldValue,
  type PageData,
} from '../types/page-data'
import { interpolateTemplate } from './repeat'
import { sameJson } from './compute-runtime'
import { interpolateDollarProps, resolveDollarPropsPath } from './component-props'
import type { ComponentRenderMap } from '../types/component-render'
import {
  resolveRefFieldValue,
  type ComponentMethodsMap,
  type ModalStackLike,
} from './widget-ref'
import { getDeviceInfo as defaultGetDeviceInfo, type DeviceInfo } from './device-info'
import type { ColorPalette } from '../types/color-palette'
import { buildDollarColor } from '../types/color-palette'

export type PreviewEventKey =
  | 'onClick'
  | 'onLongClick'
  | 'onScroll'
  | 'onScrollToLower'
  | 'onScrollToUpper'
  | 'onTouchStart'
  | 'onTouchMove'
  | 'onTouchEnd'

export interface EventScope {
  item?: unknown
  index?: number
}

export interface PreviewInteractPayload {
  eventKey: string
  raw: string
  scope?: { item: unknown; index: number }
  /** 组件 emit / 事件参数 */
  eventArgs?: Record<string, unknown>
  /** 组件实例 $props（解析 {$props.xxx}） */
  dollarProps?: Record<string, unknown>
  /**
   * 来自页面内嵌 Component 实例内部的交互：
   * 方法体里的 emit(事件名, …) 需回写到该实例在页面上的事件绑定。
   * outer 指向外层 Component（嵌套组件再 emit 时沿链查找）。
   */
  componentEmit?: ComponentEmitContext
  /**
   * 事件写在宿主投影进 Slot 的 XML 上（非组件定义内部）。
   * setData / 方法解析应走宿主数据池；勿把外包 Component 当成数据归属。
   */
  fromSlotHost?: boolean
}

/** 组件实例 emit 回写上下文（可嵌套 outer） */
export interface ComponentEmitContext {
  /** 当前 Component 的 componentId */
  componentId: string
  events: import('../types/component').ComponentEventDef[]
  hostAttrs: Record<string, string>
  hostScope?: { item: unknown; index: number }
  /**
   * 仅因 Slot 投影挂上的外层（供 emit 链）；
   * updateProps 回写数据池时须跳过，避免写到插槽宿主组件。
   */
  slotHost?: boolean
  /** 外层 Component（GoodsCard → Pager → GoodsList） */
  outer?: ComponentEmitContext
}

export interface RunEventBindingsContext {
  pageData: PageData
  /**
   * 实时数据池（每次读取最新）。
   * setData 会替换 previewRuntimeData 引用时，必须用此回调，否则同链 loadData / setTimeout 仍读到旧快照。
   */
  getPageData?: () => PageData
  /** 当前页面/组件 XML，用于解析数据池「引用」字段 */
  xml?: string
  /** Modal 堆栈（引用字段 .show / .hide） */
  modalStack?: ModalStackLike
  /** 页面内嵌组件详情（引用指向 Component 时解析暴露方法） */
  componentMap?: ComponentRenderMap
  /** 各组件的方法列表 */
  componentMethodsMap?: ComponentMethodsMap
  /**
   * 执行组件暴露方法（父页/组件引用 xxx.open()）。
   * 应在目标组件自身数据池与方法作用域内运行。
   * hostAttrs：页面上该 Component 实例属性（fetchApi / data 绑定等）。
   */
  runComponentMethod?: (
    componentId: string,
    methodName: string,
    args: unknown[],
    options?: { hostAttrs?: Record<string, string>; hostNodePath?: string },
  ) => void
  /** 查找页面/组件自定义方法（按方法名） */
  resolveMethod?: (name: string) => PageMethod | undefined
  /**
   * 当前作用域可互相调用的自定义方法列表（注入为同名函数，如 loadData()）。
   * 不含预置方法。
   */
  localMethods?: PageMethod[]
  scope?: EventScope | null
  eventArgs?: Record<string, unknown>
  /** 组件实例 $props */
  dollarProps?: Record<string, unknown>
  /** 页面是否存在 */
  hasPage: (pageId: string) => boolean
  navigateTo: (pageId: string, params?: Record<string, unknown>) => void | Promise<void>
  navigateBack: () => void | Promise<void>
  setData: (prop: string, value: DataFieldValue) => void
  /**
   * 更新双向绑定（model）参数。
   * 预览：回写调试 Props / 父级数据池绑定；导出：emit(`update:${prop}`, value)。
   */
  updateProps?: (prop: string, value: unknown) => void
  /** Toast 提示 */
  showToast?: (message: string, duration: 'short' | 'long') => void
  /** 设备信息（状态栏高度 / UA / 小程序胶囊） */
  getDeviceInfo?: () => DeviceInfo
  /** 画板颜色（$color.xxx） */
  colorPalette?: ColorPalette | null
  /** 组件内向父级抛事件（自定义方法体里的 emit(...)） */
  emit?: (event: string, ...args: unknown[]) => void
  /**
   * 组件内置方法绑定 emit：参数为命名表（含 event + 事件形参）。
   * 与 EventBindDialog 里选择「emit」预置方法对应。
   * 值为原生类型（对象/数组不再被 stringify）。
   */
  emitWithArgs?: (event: string, args: Record<string, unknown>) => void
  /**
   * 运行日志用的位置/时机前缀，如「页面 · 事件 onClick」「组件 Pager · 暴露方法 refresh」
   */
  logLocation?: string
  /** 未实现的自定义方法回调（可选提示） */
  onUnknownMethod?: (
    message: string,
    detail?: { location?: string },
  ) => void
}

function looksLikeTemplate(value: string): boolean {
  return /\{[^{}]+\}/.test(value)
}

function getByPath(source: unknown, path: string): unknown {
  if (!path) return source
  const parts = path.split('.')
  let current: unknown = source
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function formatArgValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** 替换 {形参名} / {形参.路径}（来自 emit / 事件参数） */
function interpolateEventArgs(
  template: string,
  eventArgs: Record<string, unknown>,
): string {
  if (!template.includes('{')) return template
  return template.replace(/\{([^{}]+)\}/g, (match, rawExpr: string) => {
    const expr = rawExpr.trim()
    if (!expr) return match
    if (Object.prototype.hasOwnProperty.call(eventArgs, expr)) {
      return formatArgValue(eventArgs[expr])
    }
    const value = getByPath(eventArgs, expr)
    if (value !== undefined) return formatArgValue(value)
    return match
  })
}

export function resolveEventArg(
  raw: string | undefined,
  scope?: EventScope | null,
  eventArgs?: Record<string, unknown> | null,
  dollarProps?: Record<string, unknown> | null,
): string {
  if (raw == null) return ''
  if (!looksLikeTemplate(raw)) return raw
  let result = interpolateTemplate(raw, scope?.item, scope?.index ?? 0)
  if (dollarProps && result.includes('{')) {
    result = interpolateDollarProps(result, dollarProps)
  }
  if (eventArgs && Object.keys(eventArgs).length > 0 && result.includes('{')) {
    result = interpolateEventArgs(result, eventArgs)
  }
  return result
}

/**
 * 解析事件绑定参数为原生值。
 * - 整段为单个 `{expr}` → 返回对象/数组等原值（不 stringify）
 * - 否则走字符串插值
 */
export function resolveEventArgValue(
  raw: string | undefined,
  scope?: EventScope | null,
  eventArgs?: Record<string, unknown> | null,
  dollarProps?: Record<string, unknown> | null,
): unknown {
  if (raw == null) return ''
  const text = raw.trim()
  const single = text.match(/^\{([^{}]+)\}$/)
  if (single) {
    const expr = single[1]!.trim()
    if (!expr) return undefined

    if (expr === 'index') return scope?.index
    if (expr === 'item') return scope?.item
    if (expr.startsWith('item.')) {
      return getByPath(scope?.item, expr.slice('item.'.length))
    }

    const fromProps = resolveDollarPropsPath(expr, dollarProps)
    if (fromProps !== undefined) return fromProps

    if (eventArgs) {
      if (Object.prototype.hasOwnProperty.call(eventArgs, expr)) {
        return eventArgs[expr]
      }
      const nested = getByPath(eventArgs, expr)
      if (nested !== undefined) return nested
    }

    return undefined
  }
  return resolveEventArg(raw, scope, eventArgs, dollarProps)
}

export function resolveBindingArgs(
  binding: EventMethodBinding,
  scope?: EventScope | null,
  eventArgs?: Record<string, unknown> | null,
  dollarProps?: Record<string, unknown> | null,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(binding.args ?? {})) {
    next[key] = resolveEventArg(value, scope, eventArgs, dollarProps)
  }
  return next
}

/** emit 绑定：参数按原生值解析 */
export function resolveEmitBindingArgs(
  binding: EventMethodBinding,
  scope?: EventScope | null,
  eventArgs?: Record<string, unknown> | null,
  dollarProps?: Record<string, unknown> | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(binding.args ?? {})) {
    next[key] = resolveEventArgValue(value, scope, eventArgs, dollarProps)
  }
  return next
}

export function coerceFieldValue(
  type: DataFieldType,
  raw: string,
): DataFieldValue {
  if (type === 'string' || type === 'icon' || type === 'color' || type === 'ref' || type === 'resource')
    return raw
  if (type === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  if (type === 'boolean') {
    if (raw === 'true' || raw === '1') return true
    if (raw === 'false' || raw === '0' || raw === '') return false
    return Boolean(raw)
  }
  if (!raw.trim()) return defaultValue(type)
  try {
    return JSON.parse(raw) as DataFieldValue
  } catch {
    return defaultValue(type)
  }
}

function findField(pageData: PageData, prop: string): DataField | undefined {
  const name = prop.trim()
  if (!name) return undefined
  return pageData.fields.find((item) => item.name === name)
}

function livePageData(ctx: RunEventBindingsContext): PageData {
  try {
    return ctx.getPageData?.() ?? ctx.pageData
  } catch {
    return ctx.pageData
  }
}

function parseParamsObject(raw: string): Record<string, unknown> | undefined {
  if (!raw.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  // 兼容 query 风格：id=1&name=x
  if (!raw.trim().startsWith('{') && raw.includes('=')) {
    const obj: Record<string, unknown> = {}
    for (const part of raw.split(/[&,]/)) {
      const i = part.indexOf('=')
      if (i < 0) continue
      const key = part.slice(0, i).trim()
      if (!key) continue
      obj[key] = part.slice(i + 1).trim()
    }
    return Object.keys(obj).length ? obj : undefined
  }
  return undefined
}

async function runBuiltin(
  name: string,
  args: Record<string, unknown>,
  ctx: RunEventBindingsContext,
): Promise<boolean> {
  const str = (key: string) => String(args[key] ?? '')
  if (name === 'navigateTo') {
    const to = str('to').trim()
    if (!to) return true
    if (!ctx.hasPage(to)) {
      ctx.onUnknownMethod?.(`navigateTo: 页面「${to}」不存在`)
      return true
    }
    const paramsRaw = args.params
    const params =
      paramsRaw && typeof paramsRaw === 'object' && !Array.isArray(paramsRaw)
        ? (paramsRaw as Record<string, unknown>)
        : parseParamsObject(str('params'))
    await ctx.navigateTo(to, params)
    return true
  }
  if (name === 'navigateBack') {
    await ctx.navigateBack()
    return true
  }
  if (name === 'setData') {
    const prop = str('prop').trim()
    if (!prop) return true
    const field = findField(ctx.pageData, prop)
    const type = field?.type ?? 'string'
    const rawValue = args.value
    const value =
      typeof rawValue === 'string'
        ? coerceFieldValue(type, rawValue)
        : (rawValue as DataFieldValue)
    ctx.setData(prop, value)
    return true
  }
  if (name === 'updateProps') {
    const prop = str('prop').trim()
    if (!prop) return true
    if (!ctx.updateProps) {
      ctx.onUnknownMethod?.('updateProps: 仅可在组件内使用')
      return true
    }
    ctx.updateProps(prop, args.value)
    return true
  }
  if (name === 'showToast') {
    const message = str('message')
    const durationRaw = str('duration').trim().toLowerCase()
    const duration: 'short' | 'long' = durationRaw === 'long' ? 'long' : 'short'
    ctx.showToast?.(message, duration)
    return true
  }
  if (name === 'emit') {
    const eventName = str('event').trim()
    if (!eventName) return true
    const rest: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args)) {
      if (key === 'event') continue
      rest[key] = value
    }
    if (ctx.emitWithArgs) {
      ctx.emitWithArgs(eventName, rest)
      return true
    }
    if (ctx.emit) {
      // 按对象 key 顺序不够稳，但作为无 events 表时的兜底
      ctx.emit(eventName, ...Object.values(rest))
      return true
    }
    ctx.onUnknownMethod?.('emit: 仅可在页面嵌入的组件内部触发')
    return true
  }
  return false
}

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

function buildCustomScope(ctx: RunEventBindingsContext): Record<string, unknown> {
  const item =
    ctx.scope?.item && typeof ctx.scope.item === 'object' && !Array.isArray(ctx.scope.item)
      ? (ctx.scope.item as Record<string, unknown>)
      : {}

  /** 数据池字段作为自由变量（引用 → Modal.show/hide 或组件暴露方法） */
  const data = livePageData(ctx)
  const dataVars: Record<string, unknown> = {}
  for (const field of data.fields ?? []) {
    const name = field.name.trim()
    if (!name || !isValidIdent(name)) continue
    dataVars[name] =
      field.type === 'ref'
        ? resolveRefFieldValue(field, {
            xml: ctx.xml,
            modalStack: ctx.modalStack,
            componentMap: ctx.componentMap,
            componentMethodsMap: ctx.componentMethodsMap,
            runComponentMethod: ctx.runComponentMethod,
          })
        : field.value
  }

  const scope: Record<string, unknown> = {
    ...dataVars,
    ...item,
    ...(ctx.eventArgs ?? {}),
    item: ctx.scope?.item,
    index: ctx.scope?.index ?? 0,
    $props: ctx.dollarProps ?? {},
    navigateTo: (to: string, params?: Record<string, unknown>) =>
      ctx.navigateTo(String(to ?? ''), params),
    navigateBack: () => ctx.navigateBack(),
    setData: (prop: string, value: unknown) => {
      const name = String(prop ?? '').trim()
      if (!name) return
      const live = livePageData(ctx)
      const field = findField(live, name)
      const next: DataFieldValue =
        typeof value === 'string' && field
          ? coerceFieldValue(field.type, value)
          : (value as DataFieldValue)
      // 先判等再写入：若先改 field.value 再交给宿主，宿主 sameJson 会误判跳过，
      // 计算字段（如 pullText 依赖 refreshing）就不会重算，界面停在「刷新中...」
      if (field && sameJson(field.value, next)) return
      ctx.setData(name, next)
      // 宿主替换引用后，再同步旧快照上的同名字段，保证同链读取一致
      const after = findField(livePageData(ctx), name)
      if (after) after.value = next
      const snap = findField(ctx.pageData, name)
      if (snap && snap !== after) snap.value = next
    },
    updateProps: (prop: string, value: unknown) => {
      const name = String(prop ?? '').trim()
      if (!name) return
      if (ctx.dollarProps && typeof ctx.dollarProps === 'object') {
        ;(ctx.dollarProps as Record<string, unknown>)[name] = value
      }
      if (ctx.updateProps) {
        ctx.updateProps(name, value)
        return
      }
      ctx.onUnknownMethod?.(
        `updateProps: 仅可在组件内更新双向绑定参数（未找到「${name}」）`,
      )
    },
    showToast: (message?: string, duration?: string) => {
      const d = String(duration ?? 'short').toLowerCase() === 'long' ? 'long' : 'short'
      ctx.showToast?.(String(message ?? ''), d)
    },
    getDeviceInfo: (): DeviceInfo =>
      ctx.getDeviceInfo?.() ?? defaultGetDeviceInfo(),
    $color: buildDollarColor(ctx.colorPalette),
  }

  if (ctx.emit) {
    scope.emit = ctx.emit
  }

  const reserved = new Set(Object.keys(scope))
  for (const method of ctx.localMethods ?? []) {
    if (method.builtin) continue
    const name = method.name.trim()
    if (!name || !isValidIdent(name) || reserved.has(name)) continue
    scope[name] = (...args: unknown[]) => {
      const named: Record<string, string> = {}
      ;(method.params ?? []).forEach((param, index) => {
        const key = param.name.trim()
        if (!key || key.startsWith('...')) return
        const value = args[index]
        if (value == null) {
          named[key] = ''
          return
        }
        if (typeof value === 'object') {
          try {
            named[key] = JSON.stringify(value)
          } catch {
            named[key] = String(value)
          }
          return
        }
        named[key] = String(value)
      })
      runPageMethod(method, named, ctx)
    }
    reserved.add(name)
  }

  return scope
}

function extractCustomBodyLine(err: unknown): string {
  if (!(err instanceof Error) || !err.stack) return ''
  // new Function('__env', `with (__env) {\n${body}\n}`) → 正文从第 2 行起
  const m = err.stack.match(/<anonymous>:(\d+)(?::\d+)?/)
  if (!m) return ''
  const line = Number(m[1]) - 1
  if (!Number.isFinite(line) || line < 1) return ''
  return `第 ${line} 行`
}

function reportCustomBodyError(
  err: unknown,
  ctx: RunEventBindingsContext,
  methodLabel?: string,
): void {
  const msg = err instanceof Error ? err.message : String(err)
  const parts = [
    ctx.logLocation?.trim() || '',
    methodLabel?.trim()
      ? `方法 ${methodLabel.trim()}`
      : '内联自定义',
    extractCustomBodyLine(err),
  ].filter(Boolean)
  ctx.onUnknownMethod?.(`自定义方法执行失败：${msg}`, {
    location: parts.join(' · ') || undefined,
  })
}

/** 编译缓存：同一段自定义方法体不重复 new Function（滚动 onScroll 等高频路径） */
const customBodyFnCache = new Map<string, (env: object) => void>()
const CUSTOM_BODY_FN_CACHE_MAX = 128

function getCustomBodyFn(body: string): (env: object) => void {
  const cached = customBodyFnCache.get(body)
  if (cached) return cached
  // eslint-disable-next-line no-new-func
  const fn = new Function('__env', `with (__env) {\n${body}\n}`) as (
    env: object,
  ) => void
  if (customBodyFnCache.size >= CUSTOM_BODY_FN_CACHE_MAX) {
    const first = customBodyFnCache.keys().next().value
    if (first != null) customBodyFnCache.delete(first)
  }
  customBodyFnCache.set(body, fn)
  return fn
}

function runCustomBody(
  body: string,
  ctx: RunEventBindingsContext,
  extraScope?: Record<string, unknown>,
  methodLabel?: string,
): void {
  const trimmed = body.trim()
  if (!trimmed) return
  try {
    const base = { ...buildCustomScope(ctx), ...extraScope }
    /**
     * 用 with + Proxy 做数据池实时读：
     * - setData 后同链的 loadData() 能读到新值
     * - setTimeout / Promise 回调里访问 pagination 等也不会锁死旧快照
     * （不用 "use strict"，否则 with 非法）
     */
    const env = new Proxy(base, {
      has(target, prop) {
        if (typeof prop !== 'string') return Reflect.has(target, prop)
        if (Reflect.has(target, prop)) return true
        return Boolean(findField(livePageData(ctx), prop))
      },
      get(target, prop, receiver) {
        if (typeof prop === 'string' && isValidIdent(prop)) {
          // 每次从最新数据池读取，避免 setData 后仍用启动快照
          const field = findField(livePageData(ctx), prop)
          if (field) {
            if (field.type === 'ref') {
              return resolveRefFieldValue(field, {
                xml: ctx.xml,
                modalStack: ctx.modalStack,
                componentMap: ctx.componentMap,
                componentMethodsMap: ctx.componentMethodsMap,
                runComponentMethod: ctx.runComponentMethod,
              })
            }
            return field.value
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    getCustomBodyFn(trimmed)(env)
  } catch (err) {
    reportCustomBodyError(err, ctx, methodLabel)
  }
}

function runPageMethod(
  method: PageMethod,
  args: Record<string, string>,
  ctx: RunEventBindingsContext,
): void {
  const extra: Record<string, unknown> = {}
  for (const param of method.params ?? []) {
    const name = param.name.trim()
    if (!name || name.startsWith('...')) continue
    extra[name] = args[name] ?? ''
  }
  runCustomBody(method.body ?? '', ctx, extra, method.name)
}

/** 按顺序执行事件绑定：预置方法 + 页面方法 + 内联自定义方法体 */
export async function runEventBindings(
  raw: string | undefined,
  ctx: RunEventBindingsContext,
): Promise<void> {
  const list = parseEventBindings(raw)
  for (const binding of list) {
    if (isCustomEventMethod(binding.method)) {
      runCustomBody(binding.body ?? '', ctx, undefined, '内联')
      continue
    }
    const args =
      binding.method === 'emit'
        ? resolveEmitBindingArgs(
            binding,
            ctx.scope,
            ctx.eventArgs,
            ctx.dollarProps,
          )
        : resolveBindingArgs(
            binding,
            ctx.scope,
            ctx.eventArgs,
            ctx.dollarProps,
          )
    const handled = await runBuiltin(binding.method, args, ctx)
    if (handled) continue
    const pageMethod = ctx.resolveMethod?.(binding.method)
    if (pageMethod && !pageMethod.builtin) {
      runPageMethod(
        pageMethod,
        Object.fromEntries(
          Object.entries(args).map(([k, v]) => [k, String(v ?? '')]),
        ),
        ctx,
      )
      continue
    }
    ctx.onUnknownMethod?.(binding.method, {
      location: ctx.logLocation?.trim() || undefined,
    })
  }
}

export { CUSTOM_EVENT_METHOD }
