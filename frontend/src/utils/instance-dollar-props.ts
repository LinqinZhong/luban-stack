import type { ComponentConfig } from '../types/component'
import type { DataFieldType, PageData } from '../types/page-data'
import { unwrapWholeBinding } from './binding-expr'
import { hydrateApiDollarProps } from './api-prop'
import {
  buildDollarProps,
  interpolateDollarProps,
  resolveDollarPropsPath,
} from './component-props'
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
 * 让 computed 订阅 attrs 里 `{$props.xxx}` 用到的父级入参。
 * 嵌套 Component（如 StarRate value="{$props.score}"）依赖此键重算。
 */
export function buildParentDollarPropsBoundAttrsDepsKey(
  attrs: Record<string, string> | null | undefined,
  parentDollarProps: Record<string, unknown> | null | undefined,
): string {
  if (!attrs || !parentDollarProps) return ''
  const parts: unknown[] = []
  for (const [key, raw] of Object.entries(attrs)) {
    if (!raw || !raw.includes('{')) continue
    for (const match of raw.matchAll(/\{([^{}]+)\}/g)) {
      const expr = match[1]?.trim()
      if (!expr) continue
      if (
        expr === '$props' ||
        expr === 'props' ||
        expr.startsWith('$props.') ||
        expr.startsWith('props.')
      ) {
        parts.push(key, expr, resolveDollarPropsPath(expr, parentDollarProps))
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

function isEmptyPropForEditFallback(
  value: unknown,
  type: string | undefined,
): boolean {
  if (value === undefined || value === null || value === '') return true
  if (type === 'array' && Array.isArray(value) && value.length === 0) return true
  return false
}

/**
 * 宿主属性是否为动态绑定（数据池 / item / $props 等）。
 * api 配置 JSON、json/array 字面量 JSON 不算动态绑定。
 */
export function isDynamicPropBinding(
  raw: string,
  propType?: DataFieldType | string | null,
): boolean {
  const text = raw.trim()
  if (!text) return false
  if (propType === 'api') return false

  const whole = unwrapWholeBinding(text)
  if (whole != null) {
    if (propType === 'json' || propType === 'array') {
      try {
        JSON.parse(text)
        return false
      } catch {
        return true
      }
    }
    return true
  }

  // 混写：如 `前缀{name}`
  return /\{[^{}\n]+\}/.test(text)
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
  /** 父级/宿主 $props：解析 attrs 上的 {$props.xxx}（嵌套组件入参） */
  parentDollarProps?: Record<string, unknown> | null
  /** repeat 作用域等 */
  scope?: Pick<DynamicStyleScope, 'item' | 'index'> | null
  projectPath?: string | null
  dryRun?: boolean
  /**
   * 编辑画布：动态绑定的 props 改用 config.debugProps（测试入参），
   * 解析结果为空时同样回退，避免列表类组件塌成空壳。
   */
  editCanvasFallback?: boolean
}): Record<string, unknown> {
  const config = options.config
  const hostAttrs = options.hostAttrs ?? {}
  const pageData = options.pageData ?? { fields: [] }
  const routeParams = options.routeParams ?? {}
  const parentDollarProps = options.parentDollarProps ?? undefined
  const scope: DynamicStyleScope = {
    ...(options.scope ?? {}),
    $route: routeParams,
    $query: routeParams,
    ...(parentDollarProps ? { $props: parentDollarProps } : {}),
  }

  trackPageDataBindingsInAttrs(hostAttrs, pageData)
  void buildParentDollarPropsBoundAttrsDepsKey(hostAttrs, parentDollarProps)

  const propDefs = config?.props ?? []
  const propNames = new Set(
    propDefs.map((p) => p.name.trim()).filter(Boolean),
  )
  const resolved: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(hostAttrs)) {
    if (!propNames.has(key)) {
      let text = interpolateDataBindings(value, pageData, scope)
      if (parentDollarProps) {
        text = interpolateDollarProps(text, parentDollarProps)
      }
      resolved[key] = text
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
    let text = interpolateDataBindings(value, pageData, scope)
    if (parentDollarProps) {
      text = interpolateDollarProps(text, parentDollarProps)
    }
    resolved[key] = text
  }

  let built = buildDollarProps(config, resolved)

  if (options.editCanvasFallback && config?.debugProps) {
    const next = { ...built }
    let touched = false
    for (const def of propDefs) {
      const name = def.name.trim()
      if (!name) continue
      if (!(name in config.debugProps)) continue
      const hostRaw = hostAttrs[name]
      const dynamic =
        typeof hostRaw === 'string' &&
        isDynamicPropBinding(hostRaw, def.type)
      if (!dynamic && !isEmptyPropForEditFallback(next[name], def.type)) {
        continue
      }
      next[name] = config.debugProps[name]
      touched = true
    }
    if (touched) built = next
  }

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
      ...(parentDollarProps
        ? { $props: parentDollarProps, props: parentDollarProps }
        : {}),
    }),
  })
}
