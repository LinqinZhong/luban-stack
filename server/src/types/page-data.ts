export type DataFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'array'
  | 'icon'
  | 'color'
  /** 任意类型（常用于 any[]：数组内每项可自选类型） */
  | 'any'
  /** 引用当前页面/组件控件树节点（值为节点 path id） */
  | 'ref'

export type DataFieldValue =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | unknown[]

export interface ObjectSubField {
  name: string
  type: DataFieldType
  value?: DataFieldValue
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  arrayFields?: ArraySubField[]
  objectFields?: ObjectSubField[]
}

export interface ArraySubField {
  type: DataFieldType
  value?: DataFieldValue
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  arrayFields?: ArraySubField[]
  objectFields?: ObjectSubField[]
}

/** 数据源绑定：接口暂未实现；计算 = 方法体 return 值 */
export type DataSourceBinding = '' | 'api' | 'computed'

export interface DataField {
  name: string
  type: DataFieldType
  remark: string
  value: DataFieldValue
  /** 绑定数据源类型 */
  binding?: DataSourceBinding
  /** binding === 'computed' 时的方法体；return 值即为字段计算值 */
  computeBody?: string
  /** 引用 types/ 库中的具名类型 id */
  typeRef?: string
  /** type === 'array' 时的元素类型 */
  itemType?: DataFieldType
  /** 元素类型的具名引用 */
  itemTypeRef?: string
  /** itemType === 'array' 时，内层数组的元素类型 */
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
  /** 数组结构元数据（保留嵌套类型如 icon） */
  arrayFields?: ArraySubField[]
  /** 对象结构元数据（保留嵌套类型如 icon） */
  objectFields?: ObjectSubField[]
}

export interface PageData {
  fields: DataField[]
}

export function createDefaultPageData(): PageData {
  return { fields: [] }
}
