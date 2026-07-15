import {
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

export type PreviewEventKey = 'onClick' | 'onLongClick' | 'onAppear'

export interface EventScope {
  item?: unknown
  index?: number
}

export interface PreviewInteractPayload {
  eventKey: PreviewEventKey
  raw: string
  scope?: { item: unknown; index: number }
}

export interface RunEventBindingsContext {
  pageData: PageData
  scope?: EventScope | null
  /** 页面是否存在 */
  hasPage: (pageId: string) => boolean
  navigateTo: (pageId: string, params?: Record<string, unknown>) => void | Promise<void>
  navigateBack: () => void | Promise<void>
  setData: (prop: string, value: DataFieldValue) => void
  /** 未实现的自定义方法回调（可选提示） */
  onUnknownMethod?: (name: string) => void
}

function looksLikeTemplate(value: string): boolean {
  return /\{[^{}]+\}/.test(value)
}

export function resolveEventArg(
  raw: string | undefined,
  scope?: EventScope | null,
): string {
  if (raw == null) return ''
  if (!looksLikeTemplate(raw)) return raw
  return interpolateTemplate(raw, scope?.item, scope?.index ?? 0)
}

export function resolveBindingArgs(
  binding: EventMethodBinding,
  scope?: EventScope | null,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(binding.args ?? {})) {
    next[key] = resolveEventArg(value, scope)
  }
  return next
}

export function coerceFieldValue(
  type: DataFieldType,
  raw: string,
): DataFieldValue {
  if (type === 'string' || type === 'icon') return raw
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
  return false
}

/** 按顺序执行事件绑定；仅内置方法生效，自定义方法忽略 */
export async function runEventBindings(
  raw: string | undefined,
  ctx: RunEventBindingsContext,
): Promise<void> {
  const list = parseEventBindings(raw)
  for (const binding of list) {
    const args = resolveBindingArgs(binding, ctx.scope)
    const handled = await runBuiltin(binding.method, args, ctx)
    if (!handled) {
      ctx.onUnknownMethod?.(binding.method)
    }
  }
}
