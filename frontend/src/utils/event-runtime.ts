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
import { runComputeBody } from './compute-runtime'
import { interpolateDollarProps, resolveDollarPropsPath } from './component-props'
import type { ComponentRenderMap } from '../types/component-render'
import {
  resolveRefFieldValue,
  type ComponentMethodsMap,
  type ModalStackLike,
} from './widget-ref'
import { getDeviceInfo as defaultGetDeviceInfo, type DeviceInfo } from './device-info'

export type PreviewEventKey =
  | 'onClick'
  | 'onLongClick'
  | 'onScroll'
  | 'onScrollToLower'
  | 'onScrollToUpper'
  | 'onTouchStart'

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
}

/** 组件实例 emit 回写上下文（可嵌套 outer） */
export interface ComponentEmitContext {
  /** 当前 Component 的 componentId */
  componentId: string
  events: import('../types/component').ComponentEventDef[]
  hostAttrs: Record<string, string>
  hostScope?: { item: unknown; index: number }
  /** 外层 Component（GoodsCard → Pager → GoodsList） */
  outer?: ComponentEmitContext
}

export interface RunEventBindingsContext {
  pageData: PageData
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
   */
  runComponentMethod?: (
    componentId: string,
    methodName: string,
    args: unknown[],
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
  /** 组件内向父级抛事件（自定义方法体里的 emit(...)） */
  emit?: (event: string, ...args: unknown[]) => void
  /**
   * 组件内置方法绑定 emit：参数为命名表（含 event + 事件形参）。
   * 与 EventBindDialog 里选择「emit」预置方法对应。
   * 值为原生类型（对象/数组不再被 stringify）。
   */
  emitWithArgs?: (event: string, args: Record<string, unknown>) => void
  /** 未实现的自定义方法回调（可选提示） */
  onUnknownMethod?: (name: string) => void
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
  if (type === 'string' || type === 'icon' || type === 'color' || type === 'ref')
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
  const dataVars: Record<string, unknown> = {}
  for (const field of ctx.pageData.fields ?? []) {
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
      const field = findField(ctx.pageData, name)
      if (typeof value === 'string' && field) {
        ctx.setData(name, coerceFieldValue(field.type, value))
      } else {
        ctx.setData(name, value as DataFieldValue)
      }
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

function runCustomBody(
  body: string,
  ctx: RunEventBindingsContext,
  extraScope?: Record<string, unknown>,
): void {
  const trimmed = body.trim()
  if (!trimmed) return
  try {
    runComputeBody(trimmed, { ...buildCustomScope(ctx), ...extraScope })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.onUnknownMethod?.(`自定义方法执行失败：${msg}`)
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
  runCustomBody(method.body ?? '', ctx, extra)
}

/** 按顺序执行事件绑定：预置方法 + 页面方法 + 内联自定义方法体 */
export async function runEventBindings(
  raw: string | undefined,
  ctx: RunEventBindingsContext,
): Promise<void> {
  const list = parseEventBindings(raw)
  for (const binding of list) {
    if (isCustomEventMethod(binding.method)) {
      runCustomBody(binding.body ?? '', ctx)
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
    ctx.onUnknownMethod?.(binding.method)
  }
}

export { CUSTOM_EVENT_METHOD }
