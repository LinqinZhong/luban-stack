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
