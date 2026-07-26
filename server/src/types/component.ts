import type { DataFieldType, DataFieldValue } from './page-data.js'
import type { MethodParam } from './page-method.js'

/** 组件公开参数：twoWay=false 为 Props，true 为 model（双向） */
export interface ComponentPropDef {
  name: string
  type: DataFieldType
  remark: string
  defaultValue: DataFieldValue
  twoWay: boolean
  /** 父页面配置组件实例时是否必填 */
  required?: boolean
  /** 引用 types/ 库中的具名类型 id */
  typeRef?: string
  /** type === 'array' 时的元素类型 */
  itemType?: DataFieldType
  /** 元素类型的具名引用 */
  itemTypeRef?: string
  /** itemType === 'array' 时，内层数组的元素类型 */
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}

export interface ComponentEventDef {
  name: string
  /** 事件载荷参数 */
  params: MethodParam[]
}

export interface ComponentConfig {
  name: string
  title?: string
  /** 组件默认宽高（写入宿主 Component 节点时可作默认） */
  width: string
  height: string
  props: ComponentPropDef[]
  events: ComponentEventDef[]
  /** 从 function/ 中选中的可对外调用方法名 */
  exposedMethods: string[]
  /**
   * 组件预览调试用的 $props 覆盖值（按 prop 名持久化，写入 config.json）
   * 与后端方法 debugParams 同理
   */
  debugProps?: Record<string, unknown>
}

export interface ComponentSummary {
  id: string
  name: string
  title: string
  path: string
}

export function createEmptyComponentProp(): ComponentPropDef {
  return {
    name: '',
    type: 'string',
    remark: '',
    defaultValue: '',
    twoWay: false,
    required: false,
  }
}

export function createEmptyComponentEvent(): ComponentEventDef {
  return {
    name: '',
    params: [],
  }
}

/** 规范化 prop 默认值；布尔必须是真正的 boolean，避免 "false" 被当成真值 */
function normalizePropDefault(
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
    return false
  }
  if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  if (type === 'array') {
    return Array.isArray(value) ? (value as unknown[]) : []
  }
  if (type === 'json') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return {}
  }
  if (value == null || typeof value === 'object') return ''
  return String(value)
}

/** 规范化调试 Props（仅保留合法键名） */
export function normalizeComponentDebugProps(
  input: unknown,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const name = key.trim()
    if (!name) continue
    out[name] = value
  }
  return out
}

export function createDefaultComponentConfig(name: string): ComponentConfig {
  return {
    name,
    title: name,
    width: 'match_parent',
    height: 'wrap_content',
    props: [],
    events: [],
    exposedMethods: [],
    debugProps: {},
  }
}

export function normalizeComponentConfig(
  raw: unknown,
  fallbackName: string,
): ComponentConfig {
  const base = createDefaultComponentConfig(fallbackName)
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>

  const name =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim()
      : fallbackName
  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : name

  const width =
    obj.width == null || obj.width === ''
      ? base.width
      : String(obj.width)
  const height =
    obj.height == null || obj.height === ''
      ? base.height
      : String(obj.height)

  const props = Array.isArray(obj.props)
    ? obj.props
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const row = item as Partial<ComponentPropDef>
          const propName = String(row.name ?? '').trim()
          const type = (row.type as DataFieldType) || 'string'
          const typeRef =
            typeof row.typeRef === 'string' && row.typeRef.trim()
              ? row.typeRef.trim()
              : undefined
          const itemType =
            typeof row.itemType === 'string' && row.itemType.trim()
              ? (row.itemType as DataFieldType)
              : undefined
          const itemTypeRef =
            typeof row.itemTypeRef === 'string' && row.itemTypeRef.trim()
              ? row.itemTypeRef.trim()
              : undefined
          const itemItemType =
            typeof row.itemItemType === 'string' && row.itemItemType.trim()
              ? (row.itemItemType as DataFieldType)
              : undefined
          const itemItemTypeRef =
            typeof row.itemItemTypeRef === 'string' && row.itemItemTypeRef.trim()
              ? row.itemItemTypeRef.trim()
              : undefined
          return {
            name: propName,
            type,
            remark: String(row.remark ?? ''),
            defaultValue: normalizePropDefault(type, row.defaultValue),
            twoWay: Boolean(row.twoWay),
            required: Boolean(row.required),
            ...(typeRef ? { typeRef } : {}),
            ...(type === 'array' && itemType ? { itemType } : {}),
            ...(type === 'array' && itemTypeRef ? { itemTypeRef } : {}),
            ...(type === 'array' && itemType === 'array' && itemItemType
              ? { itemItemType }
              : {}),
            ...(type === 'array' && itemType === 'array' && itemItemTypeRef
              ? { itemItemTypeRef }
              : {}),
          }
        })
    : []

  const events = Array.isArray(obj.events)
    ? obj.events
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const row = item as Partial<ComponentEventDef>
          const eventName = String(row.name ?? '').trim()
          const params = Array.isArray(row.params)
            ? row.params
                .filter((p) => p && typeof p === 'object')
                .map((p) => ({
                  name: String((p as MethodParam).name ?? '').trim(),
                  type: ((p as MethodParam).type as MethodParam['type']) || 'any',
                }))
            : []
          return { name: eventName, params }
        })
    : []

  const exposedMethods = Array.isArray(obj.exposedMethods)
    ? obj.exposedMethods
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
    : []

  return {
    name,
    title,
    width,
    height,
    props,
    events,
    exposedMethods,
    debugProps: normalizeComponentDebugProps(obj.debugProps),
  }
}
