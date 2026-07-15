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

export function createDefaultComponentConfig(name: string): ComponentConfig {
  return {
    name,
    title: name,
    width: 'match_parent',
    height: 'wrap_content',
    props: [],
    events: [],
    exposedMethods: [],
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
          return {
            name: propName,
            type: (row.type as DataFieldType) || 'string',
            remark: String(row.remark ?? ''),
            defaultValue: (row.defaultValue ?? '') as DataFieldValue,
            twoWay: Boolean(row.twoWay),
            required: Boolean(row.required),
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
  }
}
