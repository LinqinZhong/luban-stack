export type DataFieldType = 'string' | 'number' | 'boolean' | 'json' | 'array'

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
  arrayFields?: ArraySubField[]
  objectFields?: ObjectSubField[]
}

export interface ArraySubField {
  type: DataFieldType
  value?: DataFieldValue
  arrayFields?: ArraySubField[]
  objectFields?: ObjectSubField[]
}

export interface DataField {
  name: string
  type: DataFieldType
  remark: string
  value: DataFieldValue
  binding?: string
}

export interface PageData {
  fields: DataField[]
}

export function createDefaultPageData(): PageData {
  return { fields: [] }
}
