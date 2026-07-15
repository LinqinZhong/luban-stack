import type { DataFieldType, DataFieldValue } from './page-data'
import type { MethodParam } from './page-method'

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
