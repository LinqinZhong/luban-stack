import {
  defaultValue,
  type DataFieldType,
  type DataFieldValue,
} from '../types/page-data'
import type { ComponentConfig, ComponentPropDef } from '../types/component'
import { dataFieldToMethodParamType } from '../types/page-method'

/** 组件入参运行时命名空间；数据池字段禁止使用此名 */
export const DOLLAR_PROPS_NAME = '$props'

export function isReservedDataFieldName(name: string): boolean {
  return name.trim() === DOLLAR_PROPS_NAME
}

function mapAmbientTsType(type: DataFieldType): string {
  switch (dataFieldToMethodParamType(type)) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'unknown[]'
    case 'object':
      return 'Record<string, unknown>'
    default:
      return 'string'
  }
}

/**
 * Monaco ambient：`declare const $props: { ... }`，按组件参数定义生成属性提示。
 * 页面（无参数定义）时声明为空对象，与运行时一致。
 */
export function buildDollarPropsAmbientDeclaration(
  defs: ComponentPropDef[] | null | undefined,
): string {
  const props = (defs ?? []).filter((item) => {
    const name = item.name.trim()
    return Boolean(name) && /^[A-Za-z_$][\w$]*$/.test(name)
  })
  if (!props.length) {
    return 'declare const $props: Record<string, never>;'
  }
  const fields = props
    .map((item) => `  ${item.name.trim()}: ${mapAmbientTsType(item.type)};`)
    .join('\n')
  return [`interface VoiderDollarProps {`, fields, `}`, `declare const $props: VoiderDollarProps;`].join(
    '\n',
  )
}

/** 将配置里的默认值规范成运行时类型（尤其避免布尔被存成字符串 "false"） */
export function normalizePropDefaultValue(
  type: DataFieldType,
  value: unknown,
): DataFieldValue {
  if (type === 'boolean') {
    if (value === true || value === 1) return true
    if (value === false || value === 0) return false
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase()
      if (s === 'true' || s === '1') return true
      if (s === 'false' || s === '0' || s === '') return false
    }
    if (value == null) return false
    // 禁止 Boolean("false") === true
    return false
  }
  if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  if (type === 'string' || type === 'icon' || type === 'color' || type === 'ref') {
    if (value == null || typeof value === 'object') return ''
    return String(value)
  }
  if (type === 'array') {
    return Array.isArray(value) ? value : []
  }
  if (type === 'json') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return {}
  }
  if (value === undefined) return defaultValue(type)
  return value as DataFieldValue
}

function coercePropValue(type: DataFieldType, raw: unknown): DataFieldValue {
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    const s = String(raw ?? '').trim().toLowerCase()
    if (s === 'true' || s === '1') return true
    if (s === 'false' || s === '0' || s === '') return false
    return false
  }
  const str = raw == null ? '' : String(raw)
  if (type === 'string' || type === 'icon' || type === 'color' || type === 'ref') {
    return str
  }
  if (type === 'number') {
    const n = Number(str)
    return Number.isFinite(n) ? n : 0
  }
  if (!str.trim()) return defaultValue(type)
  try {
    return JSON.parse(str) as DataFieldValue
  } catch {
    return str as unknown as DataFieldValue
  }
}

function defaultsFromDefs(defs: ComponentPropDef[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const def of defs) {
    const name = def.name.trim()
    if (!name) continue
    result[name] =
      def.defaultValue !== undefined
        ? normalizePropDefaultValue(def.type, def.defaultValue)
        : defaultValue(def.type)
  }
  return result
}

/**
 * 组装组件运行时 `$props`：
 * - 先用 config.props 的 defaultValue
 * - 再用 Component 实例属性中与「已声明 prop」同名的值覆盖（字符串按类型转换）
 * - 实例属性留空（或未写）则保留默认值；布尔 false 也能正确覆盖默认 true
 * - 与宿主布局属性同名时（如 background）仍写入 $props，因为控件树里用 {$props.background}
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
    const def = byName.get(key)
    if (!def) continue
    // 留空 = 使用默认值（与属性面板「留空则用默认」一致）
    // 注意：不能把空串收成 false，否则会盖掉默认 true
    if (raw == null || String(raw).trim() === '') continue
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
