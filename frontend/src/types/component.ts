import type { DataFieldType, DataFieldValue } from './page-data'
import type { MethodParam } from './page-method'
import type { ProcessorTypeExpr } from './backend-services'

/** 组件公开参数：twoWay=false 普通入参；true 可 updateProps 回写并通知父级（仍可传常量） */
export interface ComponentPropDef {
  name: string
  type: DataFieldType
  remark: string
  defaultValue: DataFieldValue
  twoWay: boolean
  /** 父页面配置组件实例时是否必填 */
  required?: boolean
  /** 引用 types/ 库具名类型 */
  typeRef?: string
  /** type === 'array' 时的元素类型 */
  itemType?: DataFieldType
  itemTypeRef?: string
  /** itemType === 'array' 时，内层数组的元素类型 */
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
  /**
   * type === 'api'：组件调用该参数时传入的形参约束。
   * 匹配规则：组件声明的形参须出现在 API 入参中且类型一致；API 可有额外入参（调用方补齐）；出参须一致。
   */
  apiParams?: MethodParam[]
  /** type === 'api'：期望的出参类型（含泛型实参） */
  apiReturnType?: ProcessorTypeExpr
}

export interface ComponentEventDef {
  name: string
  params: MethodParam[]
}

export interface ComponentConfig {
  name: string
  title?: string
  width: string
  height: string
  props: ComponentPropDef[]
  events: ComponentEventDef[]
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
