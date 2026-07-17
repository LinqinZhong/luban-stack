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

/** 对象内的字段（字段名 + 类型 + 值） */
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

/** 数组每一项的类型与数据值（按顺序，无字段名） */
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

export const DATA_SOURCE_BINDING_OPTIONS: {
  label: string
  value: DataSourceBinding
  disabled?: boolean
}[] = [
  { label: '无', value: '' },
  { label: '接口', value: 'api', disabled: true },
  { label: '计算', value: 'computed' },
]

export interface DataField {
  name: string
  type: DataFieldType
  remark: string
  value: DataFieldValue
  /** 绑定数据源类型 */
  binding?: DataSourceBinding
  /** binding === 'computed' 时的方法体；return 值即为字段计算值 */
  computeBody?: string
  /** 引用 types/ 库中的具名类型 id（展示用；值按 type 处理，多为 json） */
  typeRef?: string
  /** type === 'array' 时的元素类型 */
  itemType?: DataFieldType
  /** 元素类型的具名引用 */
  itemTypeRef?: string
  /** itemType === 'array' 时，内层数组的元素类型 */
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
  /** 数组结构（含嵌套类型，用于保留 icon 等元数据） */
  arrayFields?: ArraySubField[]
  /** 对象结构（含嵌套类型，用于保留 icon 等元数据） */
  objectFields?: ObjectSubField[]
}

export interface PageData {
  fields: DataField[]
}

/** 深拷贝数据池（预览态与编辑态隔离） */
export function clonePageData(data: PageData | undefined | null): PageData {
  const fields = data?.fields ?? []
  try {
    return structuredClone({ fields })
  } catch {
    return JSON.parse(JSON.stringify({ fields })) as PageData
  }
}

export const DATA_FIELD_TYPE_OPTIONS: { label: string; value: DataFieldType }[] = [
  { label: '字符串', value: 'string' },
  { label: '数值', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: '图标', value: 'icon' },
  { label: '颜色', value: 'color' },
  { label: '对象', value: 'json' },
  { label: '数组', value: 'array' },
  { label: '任意', value: 'any' },
  { label: '引用', value: 'ref' },
]

/** 组件参数 / 数组项等：不含「引用」（引用仅数据池顶层） */
export const COMPOSABLE_FIELD_TYPE_OPTIONS = DATA_FIELD_TYPE_OPTIONS.filter(
  (item) => item.value !== 'ref',
)

/** 对象字段可选类型（对象内不再嵌套「对象」） */
export const NESTED_FIELD_TYPE_OPTIONS: { label: string; value: DataFieldType }[] = [
  { label: '字符串', value: 'string' },
  { label: '数值', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: '图标', value: 'icon' },
  { label: '颜色', value: 'color' },
  { label: '数组', value: 'array' },
]

/** 数组项可选类型（含对象，不含引用） */
export const ARRAY_ITEM_TYPE_OPTIONS = COMPOSABLE_FIELD_TYPE_OPTIONS

export function createEmptyDataField(): DataField {
  return {
    name: '',
    type: 'string',
    remark: '',
    value: '',
    binding: '',
    computeBody: '',
  }
}

/** 计算绑定的默认方法体 */
export function defaultComputeBody(type: DataFieldType): string {
  const sample =
    type === 'number'
      ? '0'
      : type === 'boolean'
        ? 'false'
        : type === 'array'
          ? '[]'
          : type === 'json'
            ? '{}'
            : "''"
  return `// 可直接使用同级数据池字段名作为变量（无需形参）\n// return 的值即为该字段的计算值\nreturn ${sample}\n`
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
    case 'any':
      return ''
    case 'icon':
    case 'color':
    case 'ref':
      return ''
    default:
      return ''
  }
}

/** 树形类型选择：编码 / 解码（具名类型 → named:<id>） */
export function encodeTypeSelection(
  type: DataFieldType,
  typeRef?: string | null,
): string {
  if (typeRef) return `named:${typeRef}`
  return type
}

export function decodeTypeSelection(value: string): {
  type: DataFieldType
  typeRef?: string
} {
  if (value.startsWith('named:')) {
    const typeRef = value.slice(6)
    return { type: 'json', typeRef }
  }
  const allowed = DATA_FIELD_TYPE_OPTIONS.some((o) => o.value === value)
  return { type: (allowed ? value : 'string') as DataFieldType }
}

export interface DataFieldTypeTreeNode {
  value: string
  label: string
  disabled?: boolean
  children?: DataFieldTypeTreeNode[]
}

export function buildDataFieldTypeTree(options?: {
  /** 基本类型列表，默认全量 */
  baseOptions?: Array<{ label: string; value: DataFieldType }>
  /** 项目数据类型库 */
  library?: { groups: Array<{ id: string; name: string; types: Array<{ id: string; name: string }> }> } | null
  allowNamed?: boolean
}): DataFieldTypeTreeNode[] {
  const base = options?.baseOptions ?? DATA_FIELD_TYPE_OPTIONS
  const nodes: DataFieldTypeTreeNode[] = base.map((o) => ({
    value: o.value,
    label: o.label,
  }))

  if (options?.allowNamed === false) return nodes

  const groups = options?.library?.groups ?? []
  for (const group of groups) {
    const children = (group.types ?? [])
      .filter((t) => t.name?.trim())
      .map((t) => ({
        value: `named:${t.id}`,
        label: t.name.trim(),
      }))
    if (!children.length) continue
    nodes.push({
      value: `__group__:${group.id}`,
      label: group.name,
      disabled: true,
      children,
    })
  }
  return nodes
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
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
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
    node.typeRef = item.typeRef
    node.itemType = item.itemType
    node.itemTypeRef = item.itemTypeRef
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
    node.typeRef = item.typeRef
    node.itemType = item.itemType
    node.itemTypeRef = item.itemTypeRef
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
      typeRef: node.typeRef,
      objectFields: editorNodesToObjectFields(node.children),
    }
  }
  if (node.type === 'array') {
    return {
      type: 'array',
      typeRef: node.typeRef,
      itemType: node.itemType,
      itemTypeRef: node.itemTypeRef,
      arrayFields: editorNodesToArrayFields(node.children),
    }
  }
  return {
    type: node.type,
    typeRef: node.typeRef,
    value: node.value ?? defaultValue(node.type),
  }
}

function editorNodeToObjectField(node: ObjectEditorNode): ObjectSubField {
  if (node.type === 'json') {
    return {
      name: node.name,
      type: 'json',
      typeRef: node.typeRef,
      objectFields: editorNodesToObjectFields(node.children),
    }
  }
  if (node.type === 'array') {
    return {
      name: node.name,
      type: 'array',
      typeRef: node.typeRef,
      itemType: node.itemType,
      itemTypeRef: node.itemTypeRef,
      arrayFields: editorNodesToArrayFields(node.children),
    }
  }
  return {
    name: node.name,
    type: node.type,
    typeRef: node.typeRef,
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
