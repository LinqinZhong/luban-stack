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
  /** 后端控制器 API（组件参数：可调用；父级绑定具体接口） */
  | 'api'
  /** 资源外链 URI（值类型等价 type URI = string） */
  | 'resource'

export type DataFieldValue =
  | string
  | number
  | boolean
  | null
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

/** 数据源绑定：控制器 = 绑定后端 API；计算 = 方法体 return 值；对象存储 = 选资源外链 */
export type DataSourceBinding = '' | 'controller' | 'computed' | 'oss'

export const DATA_SOURCE_BINDING_OPTIONS: {
  label: string
  value: DataSourceBinding
  disabled?: boolean
}[] = [
  { label: '无', value: '' },
  { label: '控制器', value: 'controller' },
  { label: '计算', value: 'computed' },
  { label: '对象存储', value: 'oss' },
]

/** 对象存储资源绑定（数据池 resource 类型） */
export interface OssBindingConfig {
  connectionId: string
  bucketName: string
  objectKey: string
  /** 资源外链 URI */
  url: string
}

export function createEmptyOssBinding(): OssBindingConfig {
  return {
    connectionId: '',
    bucketName: '',
    objectKey: '',
    url: '',
  }
}

export function normalizeOssBinding(input: unknown): OssBindingConfig | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>
  const connectionId =
    typeof raw.connectionId === 'string' ? raw.connectionId.trim() : ''
  const bucketName =
    typeof raw.bucketName === 'string' ? raw.bucketName.trim() : ''
  const objectKey =
    typeof raw.objectKey === 'string' ? raw.objectKey.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (!connectionId && !bucketName && !objectKey && !url) return undefined
  return { connectionId, bucketName, objectKey, url }
}

/** 控制器绑定：API 入参来源 */
export type ControllerInputSource = 'literal' | 'binding'

/** 控制器绑定：单个 API 入参配置（key 外层为 varName） */
export interface ControllerInputParamConfig {
  source: ControllerInputSource
  /** source === 'literal' 时的字面量 */
  literal?: unknown
  /** source === 'binding' 时的绑定路径（如 pageDto / keyword） */
  binding?: string
}

/** 控制器绑定配置（数据池字段） */
export interface ControllerBindingConfig {
  serviceId: string
  controllerId: string
  apiId: string
  /** 形参 data（Result.data），return 解析后的字段值 */
  parseBody: string
  /** EventMethodBinding[] 序列化字符串 */
  onLoading: string
  onSuccess: string
  onError: string
  /** key = API input.varName */
  inputs?: Record<string, ControllerInputParamConfig>
}

export interface DataField {
  name: string
  type: DataFieldType
  remark: string
  value: DataFieldValue
  /** 绑定数据源类型 */
  binding?: DataSourceBinding
  /** binding === 'computed' 时的方法体；return 值即为字段计算值 */
  computeBody?: string
  /** binding === 'controller' 时的控制器配置 */
  controllerBinding?: ControllerBindingConfig
  /** binding === 'oss' 时的对象存储资源配置 */
  ossBinding?: OssBindingConfig
  /** 引用 types/ 库中的具名类型 id（展示用；值按 type 处理，多为 json） */
  typeRef?: string
  /**
   * 具名泛型实参：泛型形参名 → 类型库 type id。
   * 未填时 ambient / 计算编辑器按 any（如 QueryPageVo<any>）。
   */
  genericArgs?: Record<string, string>
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
  { label: '资源', value: 'resource' },
  { label: '对象', value: 'json' },
  { label: '数组', value: 'array' },
  { label: '任意', value: 'any' },
  { label: '引用', value: 'ref' },
  { label: '后端API', value: 'api' },
]

/** 组件参数 / 数组项等：不含「引用」（引用仅数据池顶层） */
export const COMPOSABLE_FIELD_TYPE_OPTIONS = DATA_FIELD_TYPE_OPTIONS.filter(
  (item) => item.value !== 'ref',
)

/** 数据池顶层可选类型：不含后端 API（API 仅作组件参数） */
export const DATA_POOL_FIELD_TYPE_OPTIONS = DATA_FIELD_TYPE_OPTIONS.filter(
  (item) => item.value !== 'api',
)

/** 对象字段可选类型（对象内不再嵌套「对象」） */
export const NESTED_FIELD_TYPE_OPTIONS: { label: string; value: DataFieldType }[] = [
  { label: '字符串', value: 'string' },
  { label: '数值', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: '图标', value: 'icon' },
  { label: '颜色', value: 'color' },
  { label: '资源', value: 'resource' },
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

/** 控制器绑定：自定义解析默认方法体（形参 data = Result.data） */
export function defaultControllerParseBody(type: DataFieldType): string {
  return `// data 为接口 Result.data\n// return 的值写入本数据池字段\nreturn data\n`
}

export function createEmptyControllerBinding(
  type: DataFieldType = 'string',
): ControllerBindingConfig {
  return {
    serviceId: '',
    controllerId: '',
    apiId: '',
    parseBody: defaultControllerParseBody(type),
    onLoading: '',
    onSuccess: '',
    onError: '',
    inputs: {},
  }
}

/** 绑到控制器时的字段初始值：对象/数组用 null，便于 notEmpty 等在拉数前隐藏 UI */
export function defaultControllerFieldValue(
  type: DataFieldType,
): DataFieldValue {
  if (type === 'json' || type === 'array') return null
  return defaultValue(type)
}

export function normalizeDataSourceBinding(raw: unknown): DataSourceBinding {
  if (raw === 'computed' || raw === 'controller' || raw === 'oss') return raw
  // 旧版「接口」视为未绑定
  return ''
}

export function normalizeControllerInputParam(
  raw: unknown,
): ControllerInputParamConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  const source: ControllerInputSource =
    item.source === 'binding' ? 'binding' : 'literal'
  const out: ControllerInputParamConfig = { source }
  if ('literal' in item) out.literal = item.literal
  if (typeof item.binding === 'string') out.binding = item.binding.trim()
  return out
}

export function normalizeControllerInputs(
  raw: unknown,
): Record<string, ControllerInputParamConfig> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, ControllerInputParamConfig> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const varName = key.trim()
    if (!varName) continue
    const param = normalizeControllerInputParam(value)
    if (param) out[varName] = param
  }
  return Object.keys(out).length ? out : undefined
}

export function normalizeControllerBinding(
  input: unknown,
  fieldType: DataFieldType = 'string',
): ControllerBindingConfig | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>
  const inputs = normalizeControllerInputs(raw.inputs)
  return {
    serviceId: typeof raw.serviceId === 'string' ? raw.serviceId.trim() : '',
    controllerId:
      typeof raw.controllerId === 'string' ? raw.controllerId.trim() : '',
    apiId: typeof raw.apiId === 'string' ? raw.apiId.trim() : '',
    parseBody:
      typeof raw.parseBody === 'string' && raw.parseBody.trim()
        ? raw.parseBody
        : defaultControllerParseBody(fieldType),
    onLoading: typeof raw.onLoading === 'string' ? raw.onLoading : '',
    onSuccess: typeof raw.onSuccess === 'string' ? raw.onSuccess : '',
    onError: typeof raw.onError === 'string' ? raw.onError : '',
    ...(inputs ? { inputs } : {}),
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
    case 'any':
      return ''
    case 'icon':
    case 'color':
    case 'ref':
    case 'api':
    case 'resource':
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
