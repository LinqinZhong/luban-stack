import {
  defaultValue,
  type DataFieldType,
  type DataFieldValue,
} from '../types/page-data'
import type { ComponentConfig, ComponentPropDef } from '../types/component'

/** 组件入参运行时命名空间；数据池字段禁止使用此名 */
export const DOLLAR_PROPS_NAME = '$props'

/** Component 节点上的布局/元数据属性，不会当作 prop 覆盖值 */
const COMPONENT_HOST_ATTRS = new Set([
  'componentId',
  'name',
  'width',
  'height',
  'margin',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom',
  'padding',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'background',
  'gravity',
  'orientation',
  'gap',
  'borderRadius',
  'borderWidth',
  'borderColor',
  'repeat',
  'repeatIndex',
  'layout_marginLeft',
  'layout_marginTop',
  'layout_marginRight',
  'layout_marginBottom',
  'layout_alignParentLeft',
  'layout_alignParentRight',
  'layout_alignParentTop',
  'layout_alignParentBottom',
  'layout_centerHorizontal',
  'layout_centerVertical',
  'layout_centerInParent',
  'layout_toLeftOf',
  'layout_toRightOf',
  'layout_above',
  'layout_below',
  'onClick',
  'onLongClick',
  'onAppear',
  'v-if',
  'v-show',
  'dynamicStyles',
])

export function isReservedDataFieldName(name: string): boolean {
  return name.trim() === DOLLAR_PROPS_NAME
}

function coercePropValue(type: DataFieldType, raw: string): DataFieldValue {
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
    return raw as unknown as DataFieldValue
  }
}

function defaultsFromDefs(defs: ComponentPropDef[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const def of defs) {
    const name = def.name.trim()
    if (!name) continue
    result[name] =
      def.defaultValue !== undefined ? def.defaultValue : defaultValue(def.type)
  }
  return result
}

/**
 * 组装组件运行时 `$props`：
 * - 先用 config.props 的 defaultValue
 * - 再用 Component 实例属性中与 prop 同名的值覆盖（字符串按类型转换）
 */
export function buildDollarProps(
  config: ComponentConfig | null | undefined,
  instanceAttrs?: Record<string, string>,
): Record<string, unknown> {
  const defs = config?.props ?? []
  const result = defaultsFromDefs(defs)
  if (!instanceAttrs) return result

  const byName = new Map(
    defs
      .filter((item) => item.name.trim())
      .map((item) => [item.name.trim(), item] as const),
  )

  for (const [key, raw] of Object.entries(instanceAttrs)) {
    if (COMPONENT_HOST_ATTRS.has(key)) continue
    const def = byName.get(key)
    if (!def) continue
    result[key] = coercePropValue(def.type, raw)
  }
  return result
}

function getByPath(source: unknown, path: string): unknown {
  if (!path) return source
  const parts = path.split('.').filter(Boolean)
  let current: unknown = source
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function formatValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

/**
 * 替换模板中的 {$props} / {$props.xxx}（兼容历史写法 {props.xxx}）
 * 其它占位符原样保留。
 */
export function interpolateDollarProps(
  template: string,
  dollarProps: Record<string, unknown> | undefined | null,
): string {
  if (!template || !template.includes('{') || !dollarProps) return template
  return template.replace(/\{([^{}]+)\}/g, (match, rawExpr: string) => {
    const expr = rawExpr.trim()
    if (expr === '$props' || expr === 'props') {
      return formatValue(dollarProps)
    }
    if (expr.startsWith('$props.')) {
      return formatValue(getByPath(dollarProps, expr.slice('$props.'.length)))
    }
    if (expr.startsWith('props.')) {
      return formatValue(getByPath(dollarProps, expr.slice('props.'.length)))
    }
    return match
  })
}

export function resolveDollarPropsPath(
  path: string,
  dollarProps: Record<string, unknown> | undefined | null,
): unknown {
  const raw = path.trim()
  if (!dollarProps) return undefined
  if (raw === '$props' || raw === 'props') return dollarProps
  if (raw.startsWith('$props.')) {
    return getByPath(dollarProps, raw.slice('$props.'.length))
  }
  if (raw.startsWith('props.')) {
    return getByPath(dollarProps, raw.slice('props.'.length))
  }
  return undefined
}
