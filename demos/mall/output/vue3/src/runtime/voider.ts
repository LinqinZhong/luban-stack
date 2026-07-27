import type { Router } from 'vue-router'
import { getDeviceInfo, showToast as defaultShowToast } from './helpers'

export interface EventScope {
  item?: any
  index?: number
}

export interface VoiderStoreLike {
  $state: Record<string, any>
  setData: (prop: string, value: any) => void
}

export interface EventContext {
  store: VoiderStoreLike
  router: Router
  route: Record<string, any>
  modalVisible: Record<string, boolean>
  scope?: EventScope
  props?: Record<string, any>
  eventArgs?: Record<string, any>
  componentRefs?: Record<string, { open?: () => void; hide?: () => void; show?: () => void }>
  emit?: (event: string, payload?: Record<string, any>) => void
  showToast?: (message: string, duration?: 'short' | 'long') => void
}

export interface VisibilityConfig {
  scenarios?: Array<{
    conditions?: Array<{ field: string; op: string; value: string }>
  }>
}

function getByPath(source: any, path: string): any {
  if (!path) return source
  const parts = path.split('.')
  let current: any = source
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, any>)[part]
  }
  return current
}

function formatValue(value: any): string {
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

/** Interpolate {name}, {item.x}, {$props.x}, {$route.x}, {index} */
export function interpolate(
  template: string,
  ctx: {
    store?: VoiderStoreLike
    scope?: EventScope
    props?: Record<string, any>
    route?: Record<string, any>
  },
): string {
  if (!template || !template.includes('{')) return template
  return template.replace(/\{([^{}]+)\}/g, (match, rawExpr: string) => {
    const expr = rawExpr.trim()
    if (!expr) return match
    if (expr === 'index') return String(ctx.scope?.index ?? 0)
    if (expr === 'item') return formatValue(ctx.scope?.item)
    if (expr.startsWith('item.')) {
      const value = getByPath(ctx.scope?.item, expr.slice(5))
      return value == null ? '' : formatValue(value)
    }
    if (expr === '$props' || expr === 'props') return formatValue(ctx.props)
    if (expr.startsWith('$props.') || expr.startsWith('props.')) {
      const path = expr.replace(/^\$?props\./, '')
      const value = getByPath(ctx.props, path)
      return value == null ? '' : formatValue(value)
    }
    if (expr === '$route' || expr === 'route') return formatValue(ctx.route)
    if (expr.startsWith('$route.') || expr.startsWith('route.')) {
      const path = expr.replace(/^\$?route\./, '')
      const value = getByPath(ctx.route, path)
      return value == null ? '' : formatValue(value)
    }
    if (ctx.store && expr in ctx.store.$state) {
      return formatValue(ctx.store.$state[expr])
    }
    const nested = getByPath(ctx.store?.$state, expr)
    if (nested !== undefined) return formatValue(nested)
    return match
  })
}

function resolveConditionValue(
  path: string,
  ctx: {
    store?: VoiderStoreLike
    scope?: EventScope
    props?: Record<string, any>
    route?: Record<string, any>
  },
): any {
  const raw = path.trim()
  if (!raw) return undefined
  if (raw === 'index') return ctx.scope?.index
  if (raw === 'item') return ctx.scope?.item
  if (raw.startsWith('item.')) return getByPath(ctx.scope?.item, raw.slice(5))
  if (raw.startsWith('$props.')) return getByPath(ctx.props, raw.slice(7))
  if (raw.startsWith('$route.')) return getByPath(ctx.route, raw.slice(7))
  if (ctx.store && raw in ctx.store.$state) return ctx.store.$state[raw]
  return getByPath(ctx.store?.$state, raw)
}

function compareValues(op: string, left: any, right: string): boolean {
  switch (op) {
    case 'empty':
      return left == null || left === '' || (Array.isArray(left) && left.length === 0)
    case 'notEmpty':
      return !(left == null || left === '' || (Array.isArray(left) && left.length === 0))
    case 'contains':
      return String(left ?? '').includes(right)
    case 'eq':
      return String(left ?? '') === String(right)
    case 'neq':
      return String(left ?? '') !== String(right)
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    default:
      return false
  }
}

function evaluateScenarios(
  scenarios: VisibilityConfig['scenarios'],
  ctx: Parameters<typeof resolveConditionValue>[1],
): boolean {
  const active = (scenarios ?? []).filter((s) => (s.conditions ?? []).some((c) => c.field?.trim()))
  if (!active.length) return true
  return active.some((scene) =>
    (scene.conditions ?? [])
      .filter((c) => c.field?.trim())
      .every((cond) => compareValues(cond.op, resolveConditionValue(cond.field, ctx), cond.value ?? '')),
  )
}

export function evalVShow(raw: string | undefined, ctx: Parameters<typeof resolveConditionValue>[1]): boolean {
  if (!raw?.trim()) return true
  try {
    const parsed = JSON.parse(raw) as VisibilityConfig
    return evaluateScenarios(parsed.scenarios, ctx)
  } catch {
    return true
  }
}

export function evalVIf(raw: string | undefined, ctx: Parameters<typeof resolveConditionValue>[1]): boolean {
  return evalVShow(raw, ctx)
}

interface EventBinding {
  id?: string
  method: string
  args?: Record<string, string>
  body?: string
}

function parseBindings(raw: string | undefined): EventBinding[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as any
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as EventBinding)
      .filter((item) => item.method)
  } catch {
    return []
  }
}

function parseParamsObject(raw: string): Record<string, any> | undefined {
  if (!raw.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as any
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }
  } catch {
    // ignore
  }
  return undefined
}

function resolveArgs(
  args: Record<string, string> | undefined,
  ctx: EventContext,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(args ?? {})) {
    let resolved = interpolate(value, {
      store: ctx.store,
      scope: ctx.scope,
      props: ctx.props,
      route: ctx.route,
    })
    if (resolved.includes('{') && ctx.eventArgs) {
      resolved = resolved.replace(/\{([^{}]+)\}/g, (match, rawExpr: string) => {
        const expr = rawExpr.trim()
        if (!expr) return match
        if (Object.prototype.hasOwnProperty.call(ctx.eventArgs!, expr)) {
          return formatValue(ctx.eventArgs![expr])
        }
        const nested = getByPath(ctx.eventArgs, expr)
        return nested === undefined ? match : formatValue(nested)
      })
    }
    next[key] = resolved
  }
  return next
}

export async function runEventBindings(
  raw: string | undefined,
  ctx: EventContext,
): Promise<void> {
  const bindings = parseBindings(raw)
  for (const binding of bindings) {
    if (binding.method === '__custom__') {
      const body = binding.body?.trim()
      if (!body) continue
      try {
        const scope: Record<string, any> = {
          ...ctx.store.$state,
          item: ctx.scope?.item,
          index: ctx.scope?.index ?? 0,
          $props: ctx.props ?? {},
          navigateTo: (to: string, params?: Record<string, any>) => {
            const path = '/' + String(to).replace(/^\//, '')
            ctx.router.push({ path, query: params as Record<string, string> })
          },
          navigateBack: () => ctx.router.back(),
          setData: (prop: string, value: any) => ctx.store.setData(prop, value),
          updateProps: (prop: string, value: any) => {
            const name = String(prop ?? '').trim()
            if (!name) return
            if (ctx.props && typeof ctx.props === 'object') {
              ;(ctx.props as Record<string, any>)[name] = value
            }
            ctx.emit?.(`update:${name}`, value)
          },
          showToast: (msg?: string, duration?: string) => {
            const d = duration === 'long' ? 'long' : 'short'
            if (ctx.showToast) ctx.showToast(String(msg ?? ''), d)
            else defaultShowToast(String(msg ?? ''), d)
          },
          getDeviceInfo,
          emit: ctx.emit,
        }
        for (const [name, ref] of Object.entries(ctx.componentRefs ?? {})) {
          scope[name] = ref
        }
        const fn = new Function(...Object.keys(scope), body)
        fn(...Object.values(scope))
      } catch (err) {
        console.warn('[voider] custom event failed', err)
      }
      continue
    }

    const args = resolveArgs(binding.args, ctx)
    if (binding.method === 'navigateTo') {
      const to = (args.to ?? '').trim()
      if (!to) continue
      const params = parseParamsObject(args.params ?? '')
      ctx.router.push({ path: '/' + to.replace(/^\//, ''), query: params as Record<string, string> })
      continue
    }
    if (binding.method === 'navigateBack') {
      ctx.router.back()
      continue
    }
    if (binding.method === 'setData') {
      const prop = (args.prop ?? '').trim()
      if (!prop) continue
      let value: any = args.value ?? ''
      try {
        value = JSON.parse(args.value ?? '')
      } catch {
        // keep string
      }
      ctx.store.setData(prop, value)
      continue
    }
    if (binding.method === 'showToast') {
      const d = args.duration === 'long' ? 'long' : 'short'
      if (ctx.showToast) ctx.showToast(args.message ?? '', d)
      else defaultShowToast(args.message ?? '', d)
      continue
    }
    if (binding.method === 'emit') {
      const eventName = (args.event ?? '').trim()
      if (!eventName) continue
      const payload: Record<string, any> = {}
      for (const [key, value] of Object.entries(args)) {
        if (key === 'event') continue
        payload[key] = value
      }
      ctx.emit?.(eventName, payload)
      continue
    }
    if (binding.method === 'updateProps') {
      const prop = (args.prop ?? '').trim()
      if (!prop) continue
      let value: any = args.value ?? ''
      try {
        value = JSON.parse(args.value ?? '')
      } catch {
        // keep string
      }
      if (ctx.props && typeof ctx.props === 'object') {
        ;(ctx.props as Record<string, any>)[prop] = value
      }
      ctx.emit?.(`update:${prop}`, value)
      continue
    }
    console.warn('[voider] unknown event method:', binding.method)
  }
}
