export type DataFieldType = 'string' | 'number' | 'boolean' | 'json' | 'array'

export type DataFieldValue =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | unknown[]

/** 对象内的字段（字段名 + 类型 + 值） */
export interface ObjectSubField {
  name: string
  type: DataFieldType
  value?: DataFieldValue
  arrayFields?: ArraySubField[]
  objectFields?: ObjectSubField[]
}

/** 数组每一项的类型与数据值（按顺序，无字段名） */
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

export const DATA_FIELD_TYPE_OPTIONS: { label: string; value: DataFieldType }[] = [
  { label: '字符串', value: 'string' },
  { label: '数值', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: '对象', value: 'json' },
  { label: '数组', value: 'array' },
]

/** 对象编辑器内嵌套字段可选类型（不含对象） */
export const NESTED_FIELD_TYPE_OPTIONS = DATA_FIELD_TYPE_OPTIONS.filter(
  (item) => item.value !== 'json',
)

/** 数组编辑器 / 数组项可选类型（含对象） */
export const ARRAY_ITEM_TYPE_OPTIONS = DATA_FIELD_TYPE_OPTIONS

export function createEmptyDataField(): DataField {
  return {
    name: '',
    type: 'string',
    remark: '',
    value: '',
    binding: '',
  }
}

export function createEmptyObjectSubField(): ObjectSubField {
  return {
    name: '',
    type: 'string',
    value: '',
  }
}

export function defaultValue(type: DataFieldType): DataFieldValue {
  switch (type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'json':
      return {}
    case 'array':
      return []
    default:
      return ''
  }
}

export function inferValueType(value: unknown): DataFieldType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'array'
  if (value && typeof value === 'object') return 'json'
  return 'string'
}

export function valueToArrayFields(value: unknown[]): ArraySubField[] {
  return value.map((item) => {
    const type = inferValueType(item)
    if (type === 'array' && Array.isArray(item)) {
      return { type: 'array', arrayFields: valueToArrayFields(item) }
    }
    if (type === 'json' && item && typeof item === 'object' && !Array.isArray(item)) {
      return {
        type: 'json',
        objectFields: valueToObjectFields(item as Record<string, unknown>),
      }
    }
    return { type, value: item as DataFieldValue }
  })
}

export function valueToObjectFields(value: Record<string, unknown>): ObjectSubField[] {
  return Object.entries(value).map(([name, item]) => {
    const type = inferValueType(item)
    if (type === 'array' && Array.isArray(item)) {
      return { name, type: 'array', arrayFields: valueToArrayFields(item) }
    }
    if (type === 'json' && item && typeof item === 'object' && !Array.isArray(item)) {
      return {
        name,
        type: 'json',
        objectFields: valueToObjectFields(item as Record<string, unknown>),
      }
    }
    return { name, type, value: item as DataFieldValue }
  })
}

export function resolveObjectSubFieldValue(item: ObjectSubField): DataFieldValue {
  if (item.type === 'array') {
    return (item.arrayFields ?? []).map(resolveArraySubFieldValue)
  }
  if (item.type === 'json') {
    return buildObjectValue(item.objectFields ?? [])
  }
  return item.value ?? defaultValue(item.type)
}

export function resolveArraySubFieldValue(item: ArraySubField): DataFieldValue {
  if (item.type === 'array') {
    return (item.arrayFields ?? []).map(resolveArraySubFieldValue)
  }
  if (item.type === 'json') {
    return buildObjectValue(item.objectFields ?? [])
  }
  return item.value ?? defaultValue(item.type)
}

export function buildObjectValue(items: ObjectSubField[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const item of items) {
    if (!item.name.trim()) continue
    result[item.name.trim()] = resolveObjectSubFieldValue(item)
  }
  return result
}

export function buildArrayValue(items: ArraySubField[]): unknown[] {
  return items.map(resolveArraySubFieldValue)
}

export function resolveObjectFields(
  fields: ObjectSubField[] | undefined,
  fallbackValue: unknown,
): ObjectSubField[] {
  if (fields?.length) return fields
  if (fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue)) {
    return valueToObjectFields(fallbackValue as Record<string, unknown>)
  }
  return []
}

export function resolveArrayFields(
  fields: ArraySubField[] | undefined,
  fallbackValue: unknown,
): ArraySubField[] {
  if (fields?.length) return fields
  if (Array.isArray(fallbackValue)) {
    return valueToArrayFields(fallbackValue)
  }
  return []
}

/** 对象编辑器内部树节点 */
export interface ObjectEditorNode {
  key: string
  name: string
  type: DataFieldType
  value?: DataFieldValue
  children: ObjectEditorNode[]
  isArrayItem: boolean
}

export function createEditorNode(isArrayItem = false): ObjectEditorNode {
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: isArrayItem ? '' : '',
    type: 'string',
    value: '',
    children: [],
    isArrayItem,
  }
}

function arrayFieldsToEditorNodes(fields: ArraySubField[]): ObjectEditorNode[] {
  return fields.map((item) => {
    const node = createEditorNode(true)
    node.type = item.type
    if (item.type === 'json') {
      node.children = objectFieldsToEditorNodes(item.objectFields ?? [])
    } else if (item.type === 'array') {
      node.children = arrayFieldsToEditorNodes(item.arrayFields ?? [])
    } else {
      node.value = item.value ?? defaultValue(item.type)
    }
    return node
  })
}

export function objectFieldsToEditorNodes(fields: ObjectSubField[]): ObjectEditorNode[] {
  return fields.map((item) => {
    const node = createEditorNode(false)
    node.name = item.name
    node.type = item.type
    if (item.type === 'json') {
      node.children = objectFieldsToEditorNodes(item.objectFields ?? [])
    } else if (item.type === 'array') {
      node.children = arrayFieldsToEditorNodes(item.arrayFields ?? [])
    } else {
      node.value = item.value ?? defaultValue(item.type)
    }
    return node
  })
}

function editorNodesToArrayFields(nodes: ObjectEditorNode[]): ArraySubField[] {
  return nodes.map((node) => editorNodeToArrayField(node))
}

function editorNodeToArrayField(node: ObjectEditorNode): ArraySubField {
  if (node.type === 'json') {
    return {
      type: 'json',
      objectFields: editorNodesToObjectFields(node.children),
    }
  }
  if (node.type === 'array') {
    return {
      type: 'array',
      arrayFields: editorNodesToArrayFields(node.children),
    }
  }
  return {
    type: node.type,
    value: node.value ?? defaultValue(node.type),
  }
}

function editorNodeToObjectField(node: ObjectEditorNode): ObjectSubField {
  if (node.type === 'json') {
    return {
      name: node.name,
      type: 'json',
      objectFields: editorNodesToObjectFields(node.children),
    }
  }
  if (node.type === 'array') {
    return {
      name: node.name,
      type: 'array',
      arrayFields: editorNodesToArrayFields(node.children),
    }
  }
  return {
    name: node.name,
    type: node.type,
    value: node.value ?? defaultValue(node.type),
  }
}

export function editorNodesToObjectFields(nodes: ObjectEditorNode[]): ObjectSubField[] {
  return nodes.map((node) => editorNodeToObjectField(node))
}

export function typeLabel(type: DataFieldType): string {
  return DATA_FIELD_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type
}

export function editorNodeTreeLabel(node: ObjectEditorNode, index: number): string {
  if (node.isArrayItem) {
    return `[${index}] · ${typeLabel(node.type)}`
  }
  const name = node.name.trim() || '未命名字段'
  return `${name} · ${typeLabel(node.type)}`
}
