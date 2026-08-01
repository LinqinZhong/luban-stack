import type { ComponentConfig } from '../types/component'
import type { PageData } from '../types/page-data'
import { hydrateApiDollarProps } from './api-prop'
import { buildDollarProps } from './component-props'
import {
  interpolateDataBindings,
  resolveAttrBindingValue,
  type DynamicStyleScope,
} from './dynamic-style-runtime'

/**
 * 让 Vue computed 订阅 attrs 里 `{expr}` 用到的数据池字段。
 * setData / updateProps 原地改 field.value 时，若未显式 touch，实例 $props 会卡在旧值
 *（如 Pager 的 loading 已回 false，但 $props.loading 仍为 true → vShow「加载中」不消失）。
 */
export function trackPageDataBindingsInAttrs(
  attrs: Record<string, string> | null | undefined,
  pageData: PageData | null | undefined,
): void {
  void buildHostBoundAttrsDepsKey(attrs, pageData)
}

/**
 * 宿主 `{field}` 绑定值的依赖键。读 field.value，供 computed 稳定订阅；
 * 比单纯 void touch 更稳——键变了一定会重算 $props。
 */
export function buildHostBoundAttrsDepsKey(
  attrs: Record<string, string> | null | undefined,
  pageData: PageData | null | undefined,
): string {
  const fields = pageData?.fields
  if (!attrs || !fields?.length) return ''
  const byName = new Map(
    fields.map((item) => [item.name.trim(), item] as const),
  )
  const parts: unknown[] = []
  for (const [key, raw] of Object.entries(attrs)) {
    if (!raw || !raw.includes('{')) continue
    for (const match of raw.matchAll(/\{([^{}]+)\}/g)) {
      const expr = match[1]?.trim()
      if (!expr) continue
      for (const [name, field] of byName) {
        if (!name) continue
        if (
          expr === name ||
          expr.startsWith(`${name}.`) ||
          expr.startsWith(`${name}[`) ||
          new RegExp(`(^|[^\\w$])${name}(?=$|[^\\w$])`).test(expr)
        ) {
          parts.push(key, name, field.value)
        }
      }
    }
  }
  if (!parts.length) return ''
  try {
    return JSON.stringify(parts)
  } catch {
    return String(parts.length)
  }
}

/**
 * 由页面/父组件上的 Component 实例属性 + 宿主数据池，组装可运行的 $props
 *（含 api 类型参数 hydrate 为可调用函数）。
 * 与 XmlNodeView.instanceDollarProps 规则对齐，供 ref 调暴露方法等非画布路径复用。
 */
export function resolveComponentInstanceDollarProps(options: {
  config: ComponentConfig | null | undefined
  hostAttrs?: Record<string, string> | null
  pageData?: PageData | null
  routeParams?: Record<string, unknown> | null
  /** repeat 作用域等 */
  scope?: Pick<DynamicStyleScope, 'item' | 'index'> | null
  projectPath?: string | null
  dryRun?: boolean
}): Record<string, unknown> {
  const config = options.config
  const hostAttrs = options.hostAttrs ?? {}
  const pageData = options.pageData ?? { fields: [] }
  const routeParams = options.routeParams ?? {}
  const scope: DynamicStyleScope = {
    ...(options.scope ?? {}),
    $route: routeParams,
    $query: routeParams,
  }

  trackPageDataBindingsInAttrs(hostAttrs, pageData)

  const propDefs = config?.props ?? []
  const propNames = new Set(
    propDefs.map((p) => p.name.trim()).filter(Boolean),
  )
  const resolved: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(hostAttrs)) {
    if (!propNames.has(key)) {
      resolved[key] = interpolateDataBindings(value, pageData, scope)
      continue
    }
    const def = propDefs.find((p) => p.name.trim() === key)
    if (
      def &&
      (def.type === 'array' ||
        def.type === 'json' ||
        def.type === 'boolean' ||
        def.type === 'number')
    ) {
      const native = resolveAttrBindingValue(value, pageData, scope)
      if (native !== undefined) resolved[key] = native
      continue
    }
    resolved[key] = interpolateDataBindings(value, pageData, scope)
  }

  const built = buildDollarProps(config, resolved)
  const fields = pageData.fields ?? []
  return hydrateApiDollarProps(built, propDefs, options.projectPath, {
    dryRun: options.dryRun ?? true,
    getPageScope: () => ({
      ...Object.fromEntries(
        fields
          .map((f) => [f.name.trim(), f.value] as const)
          .filter(([n]) => Boolean(n)),
      ),
      $query: routeParams,
      $route: routeParams,
    }),
  })
}
