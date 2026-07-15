import {
  CUSTOM_EVENT_METHOD,
  isCustomEventMethod,
  parseEventBindings,
  type EventMethodBinding,
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
import { interpolateDollarProps } from './component-props'

export type PreviewEventKey = 'onClick' | 'onLongClick' | 'onAppear'

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
   */
  componentEmit?: {
    events: import('../types/component').ComponentEventDef[]
    hostAttrs: Record<string, string>
    hostScope?: { item: unknown; index: number }
  }
}

export interface RunEventBindingsContext {
  pageData: PageData
  scope?: EventScope | null
  eventArgs?: Record<string, unknown>
  /** 组件实例 $props */
  dollarProps?: Record<string, unknown>
  /** 页面是否存在 */
  hasPage: (pageId: string) => boolean
  navigateTo: (pageId: string, params?: Record<string, unknown>) => void | Promise<void>
  navigateBack: () => void | Promise<void>
  setData: (prop: string, value: DataFieldValue) => void
  /** Toast 提示 */
  showToast?: (message: string, duration: 'short' | 'long') => void
  /** 打开遮罩（按 name 入栈，仅栈顶可见） */
  openMask?: (name: string) => void
  /** 关闭遮罩；不传 name 关闭栈顶 */
  closeMask?: (name?: string) => void
  /** 清空遮罩堆栈 */
  closeAllMasks?: () => void
  /** 组件内向父级抛事件（自定义方法体里的 emit(...)） */
  emit?: (event: string, ...args: unknown[]) => void
  /**
   * 组件内置方法绑定 emit：参数为命名表（含 event + 事件形参）。
   * 与 EventBindDialog 里选择「emit」预置方法对应。
   */
  emitWithArgs?: (event: string, args: Record<string, string>) => void
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

export function coerceFieldValue(
  type: DataFieldType,
  raw: string,
): DataFieldValue {
  if (type === 'string' || type === 'icon' || type === 'color') return raw
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
  args: Record<string, string>,
  ctx: RunEventBindingsContext,
): Promise<boolean> {
  if (name === 'navigateTo') {
    const to = (args.to ?? '').trim()
    if (!to) return true
    if (!ctx.hasPage(to)) {
      ctx.onUnknownMethod?.(`navigateTo: 页面「${to}」不存在`)
      return true
    }
    await ctx.navigateTo(to, parseParamsObject(args.params ?? ''))
    return true
  }
  if (name === 'navigateBack') {
    await ctx.navigateBack()
    return true
  }
  if (name === 'setData') {
    const prop = (args.prop ?? '').trim()
    if (!prop) return true
    const field = findField(ctx.pageData, prop)
    const type = field?.type ?? 'string'
    const value = coerceFieldValue(type, args.value ?? '')
    ctx.setData(prop, value)
    return true
  }
  if (name === 'showToast') {
    const message = args.message ?? ''
    const durationRaw = (args.duration ?? 'short').trim().toLowerCase()
    const duration: 'short' | 'long' = durationRaw === 'long' ? 'long' : 'short'
    ctx.showToast?.(message, duration)
    return true
  }
  if (name === 'openMask') {
    const maskName = (args.name ?? '').trim()
    if (!maskName) {
      ctx.onUnknownMethod?.('openMask: 请传入遮罩 name')
      return true
    }
    ctx.openMask?.(maskName)
    return true
  }
  if (name === 'closeMask') {
    const maskName = (args.name ?? '').trim()
    ctx.closeMask?.(maskName || undefined)
    return true
  }
  if (name === 'closeAllMasks') {
    ctx.closeAllMasks?.()
    return true
  }
  if (name === 'emit') {
    const eventName = (args.event ?? '').trim()
    if (!eventName) return true
    const rest: Record<string, string> = {}
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

function buildCustomScope(ctx: RunEventBindingsContext): Record<string, unknown> {
  const item =
    ctx.scope?.item && typeof ctx.scope.item === 'object' && !Array.isArray(ctx.scope.item)
      ? (ctx.scope.item as Record<string, unknown>)
      : {}

  const scope: Record<string, unknown> = {
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
    showToast: (message?: string, duration?: string) => {
      const d = String(duration ?? 'short').toLowerCase() === 'long' ? 'long' : 'short'
      ctx.showToast?.(String(message ?? ''), d)
    },
    openMask: (name?: string) => {
      ctx.openMask?.(String(name ?? '').trim())
    },
    closeMask: (name?: string) => {
      const id = name == null ? '' : String(name).trim()
      ctx.closeMask?.(id || undefined)
    },
    closeAllMasks: () => {
      ctx.closeAllMasks?.()
    },
  }

  if (ctx.emit) {
    scope.emit = ctx.emit
  }

  return scope
}

function runCustomBinding(
  binding: EventMethodBinding,
  ctx: RunEventBindingsContext,
): void {
  const body = (binding.body ?? '').trim()
  if (!body) return
  try {
    runComputeBody(body, buildCustomScope(ctx))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.onUnknownMethod?.(`自定义方法执行失败：${msg}`)
  }
}

/** 按顺序执行事件绑定：预置方法 + 内联自定义方法体 */
export async function runEventBindings(
  raw: string | undefined,
  ctx: RunEventBindingsContext,
): Promise<void> {
  const list = parseEventBindings(raw)
  for (const binding of list) {
    if (isCustomEventMethod(binding.method)) {
      runCustomBinding(binding, ctx)
      continue
    }
    const args = resolveBindingArgs(
      binding,
      ctx.scope,
      ctx.eventArgs,
      ctx.dollarProps,
    )
    const handled = await runBuiltin(binding.method, args, ctx)
    if (!handled) {
      ctx.onUnknownMethod?.(binding.method)
    }
  }
}

export { CUSTOM_EVENT_METHOD }
