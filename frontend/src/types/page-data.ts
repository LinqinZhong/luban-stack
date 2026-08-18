export type DataFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'array'
  /** 映射：Map<K, T>，K 为 string | number */
  | 'map'
  | 'icon'
  | 'color'
  /** 时间 HH:mm:ss（字符串） */
  | 'time'
  /** 日期 YYYY-MM-DD（字符串） */
  | 'date'
  /** 日期时间 YYYY-MM-DD HH:mm:ss（字符串） */
  | 'datetime'
  /** 任意类型（常用于 any[]：数组内每项可自选类型） */
  | 'any'
  /** 引用当前页面/组件控件树节点（值为节点 path id） */
  | 'ref'
  /** 后端控制器 API（组件参数：可调用；父级绑定具体接口） */
  | 'api'
  /** 互联网资源 Resource（底层为字符串） */
  | 'resource'

/** 映射键类型 */
export type MapKeyType = 'string' | 'number'

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
  keyType?: MapKeyType
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
  keyType?: MapKeyType
  arrayFields?: ArraySubField[]
  objectFields?: ObjectSubField[]
}

/** 数据源绑定：控制器 = 绑定后端 API；计算 = 方法体 return 值；对象存储 = 选资源外链 */
export type DataSourceBinding = '' | 'controller' | 'computed' | 'oss' | 'literal'

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
  /** 资源地址（互联网资源） */
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
  /** 成功或失败后都会触发（finally） */
  onFinally: string
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
  /** type === 'array' 时的元素类型；type === 'map' 时的值类型 */
  itemType?: DataFieldType
  /** 元素/值类型的具名引用 */
  itemTypeRef?: string
  /** itemType === 'array' 时，内层数组的元素类型 */
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
  /** type === 'map' 时的键类型（默认 string） */
  keyType?: MapKeyType
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
  { label: '时间', value: 'time' },
  { label: '日期', value: 'date' },
  { label: '日期时间', value: 'datetime' },
  { label: '图标', value: 'icon' },
  { label: '颜色', value: 'color' },
  { label: 'Resource', value: 'resource' },
  { label: 'object', value: 'json' },
  { label: '[]', value: 'array' },
  { label: '映射', value: 'map' },
  { label: '任意', value: 'any' },
  { label: '引用', value: 'ref' },
  { label: '后端API', value: 'api' },
]

export const MAP_KEY_TYPE_OPTIONS: { label: string; value: MapKeyType }[] = [
  { label: '字符串', value: 'string' },
  { label: '数值', value: 'number' },
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
  { label: '时间', value: 'time' },
  { label: '日期', value: 'date' },
  { label: '日期时间', value: 'datetime' },
  { label: '图标', value: 'icon' },
  { label: '颜色', value: 'color' },
  { label: 'Resource', value: 'resource' },
  { label: '[]', value: 'array' },
  { label: '映射', value: 'map' },
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
export function defaultControllerParseBody(_type: DataFieldType): string {
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
    onFinally: '',
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
    onFinally: typeof raw.onFinally === 'string' ? raw.onFinally : '',
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
    case 'map':
      return {}
    case 'array':
      return []
    case 'any':
      return ''
    case 'time':
    case 'date':
    case 'datetime':
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

/** undefined 才回落默认值；显式 null 保留 */
function fieldValueOrDefault(
  value: DataFieldValue | undefined,
  type: DataFieldType,
): DataFieldValue {
  return value !== undefined ? value : defaultValue(type)
}

export function resolveObjectSubFieldValue(item: ObjectSubField): DataFieldValue {
  if (item.type === 'array') {
    return (item.arrayFields ?? []).map(resolveArraySubFieldValue)
  }
  if (item.type === 'json') {
    return buildObjectValue(item.objectFields ?? [])
  }
  return fieldValueOrDefault(item.value, item.type)
}

export function resolveArraySubFieldValue(item: ArraySubField): DataFieldValue {
  if (item.type === 'array') {
    return (item.arrayFields ?? []).map(resolveArraySubFieldValue)
  }
  if (item.type === 'json') {
    return buildObjectValue(item.objectFields ?? [])
  }
  return fieldValueOrDefault(item.value, item.type)
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

/** 以字符串存储、需靠 meta 还原的展示类型 */
const STRINGISH_DISPLAY_TYPES: DataFieldType[] = [
  'icon',
  'color',
  'time',
  'date',
  'datetime',
  'resource',
]

/** 保留 arrayFields/objectFields 上的展示类型（icon/color 等），数据以 value 为准 */
function preserveScalarDisplayType(
  meta: {
    type: DataFieldType
    typeRef?: string
    keyType?: MapKeyType
    value?: DataFieldValue
  } | undefined,
  derived: { type: DataFieldType; typeRef?: string; value?: DataFieldValue },
): {
  type: DataFieldType
  typeRef?: string
  keyType?: MapKeyType
  value?: DataFieldValue
} {
  if (!meta) return derived
  // any / ref / api：值形态多变，始终保留声明类型
  if (meta.type === 'any' || meta.type === 'ref' || meta.type === 'api') {
    return {
      type: meta.type,
      typeRef: meta.typeRef,
      value: derived.value !== undefined ? derived.value : meta.value,
    }
  }
  // icon/color/time 等：仅当 JSON 值仍是字符串时保留，否则视为代码模式改了类型
  if (
    STRINGISH_DISPLAY_TYPES.includes(meta.type) &&
    (derived.type === 'string' || typeof derived.value === 'string')
  ) {
    return {
      type: meta.type,
      typeRef: meta.typeRef,
      value: derived.value,
    }
  }
  return derived
}

export function resolveObjectFields(
  fields: ObjectSubField[] | undefined,
  fallbackValue: unknown,
): ObjectSubField[] {
  if (fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue)) {
    const obj = fallbackValue as Record<string, unknown>
    const fromValue = valueToObjectFields(obj)
    if (!fields?.length) return fromValue
    const byName = new Map(
      fields.filter((f) => f.name.trim()).map((f) => [f.name.trim(), f] as const),
    )
    return fromValue.map((v) => {
      const meta = byName.get(v.name.trim())
      if (!meta) return v

      // map 的值是普通 object，推断会变成 json，需按 meta 还原
      if (meta.type === 'map') {
        return {
          name: v.name,
          type: 'map' as const,
          keyType: meta.keyType,
          itemType: meta.itemType,
          itemTypeRef: meta.itemTypeRef,
          value: (obj[v.name] as DataFieldValue) ?? meta.value ?? {},
        }
      }

      if (meta.type === 'json' || v.type === 'json') {
        return {
          name: v.name,
          type: 'json' as const,
          typeRef: meta.type === 'json' ? meta.typeRef : v.typeRef,
          objectFields: resolveObjectFields(
            meta.type === 'json' ? meta.objectFields : undefined,
            obj[v.name],
          ),
        }
      }

      if (meta.type === 'array' || v.type === 'array') {
        return {
          name: v.name,
          type: 'array' as const,
          typeRef: meta.type === 'array' ? meta.typeRef : v.typeRef,
          itemType: meta.type === 'array' ? meta.itemType : v.itemType,
          itemTypeRef: meta.type === 'array' ? meta.itemTypeRef : v.itemTypeRef,
          arrayFields: resolveArrayFields(
            meta.type === 'array' ? meta.arrayFields : undefined,
            obj[v.name],
          ),
        }
      }

      const kept = preserveScalarDisplayType(meta, v)
      return { name: v.name, ...kept }
    })
  }
  return fields?.length ? fields : []
}

export function resolveArrayFields(
  fields: ArraySubField[] | undefined,
  fallbackValue: unknown,
): ArraySubField[] {
  // value 与预览同源，为权威数据；arrayFields 仅补充类型元数据
  if (Array.isArray(fallbackValue)) {
    const fromValue = valueToArrayFields(fallbackValue)
    if (!fields?.length) return fromValue
    return fromValue.map((v, i) => {
      const meta = fields[i]
      if (meta?.type === 'map') {
        return {
          type: 'map' as const,
          keyType: meta.keyType,
          itemType: meta.itemType,
          itemTypeRef: meta.itemTypeRef,
          value: (fallbackValue[i] as DataFieldValue) ?? meta.value ?? {},
        }
      }
      if (v.type === 'json' || meta?.type === 'json') {
        return {
          type: 'json' as const,
          typeRef: meta?.type === 'json' ? meta.typeRef : v.typeRef,
          objectFields: resolveObjectFields(
            meta?.type === 'json' ? meta.objectFields : undefined,
            fallbackValue[i],
          ),
        }
      }
      if (v.type === 'array' || meta?.type === 'array') {
        return {
          type: 'array' as const,
          itemType: meta?.type === 'array' ? meta.itemType : v.itemType,
          itemTypeRef: meta?.type === 'array' ? meta.itemTypeRef : v.itemTypeRef,
          arrayFields: resolveArrayFields(
            meta?.type === 'array' ? meta.arrayFields : undefined,
            fallbackValue[i],
          ),
        }
      }
      const kept = preserveScalarDisplayType(meta, v)
      return kept
    })
  }
  return fields?.length ? fields : []
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
  /** 来自具名类型展开的子字段：结构锁定，仅允许改值 */
  schemaLocked?: boolean
}

/** 递归标记编辑器节点为结构锁定（具名类型展开的子树） */
export function markEditorNodesSchemaLocked(nodes: ObjectEditorNode[], locked = true) {
  for (const node of nodes) {
    node.schemaLocked = locked
    if (node.type === 'array') {
      // 数组字段本身锁定；元素可增删，仅锁定元素内部的对象结构
      for (const item of node.children) {
        if (item.type === 'json' || item.type === 'array') {
          markEditorNodesSchemaLocked(item.children, locked)
        }
      }
      continue
    }
    if (node.children.length) markEditorNodesSchemaLocked(node.children, locked)
  }
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
      node.value = fieldValueOrDefault(item.value, item.type)
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
      node.value = fieldValueOrDefault(item.value, item.type)
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
    value: fieldValueOrDefault(node.value, node.type),
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
    value: fieldValueOrDefault(node.value, node.type),
  }
}

export function editorNodesToObjectFields(nodes: ObjectEditorNode[]): ObjectSubField[] {
  return nodes.map((node) => editorNodeToObjectField(node))
}

export function typeLabel(type: DataFieldType): string {
  return DATA_FIELD_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type
}

/** 代码风格类型名：string / number / Resource；具名类型优先用可读名 */
export function typeCodeLabel(
  type: DataFieldType,
  typeRef?: string | null,
): string {
  const ref = typeRef?.trim()
  if (type === 'resource' || ref === 'type_common_URI') return 'Resource'
  if (ref) {
    if (type === 'array') return arrayTypeLabel(ref)
    return ref
  }
  // 匿名对象：内部存 json，展示用 object（树节点可再隐藏后缀）
  if (type === 'json') return 'object'
  return type
}

/** 数组类型展示：GoodsRemarkVo[] / string[][]；无元素类型时为 [] / [][] */
export function arrayTypeLabel(itemLabel?: string, depth = 1): string {
  const n = Math.max(1, depth)
  const leaf = (itemLabel ?? '').trim()
  if (!leaf) return '[]'.repeat(n)
  return `${leaf}${'[]'.repeat(n)}`
}

export function editorNodeTreeParts(
  node: ObjectEditorNode,
  index: number,
): { name: string; type: string } {
  const name = node.isArrayItem
    ? `[${index}]`
    : node.name.trim() || '未命名字段'
  // 匿名对象：树节点只显示字段名，不跟类型
  if (node.type === 'json' && !node.typeRef?.trim()) {
    return { name, type: '' }
  }
  return { name, type: typeCodeLabel(node.type, node.typeRef) }
}

export function editorNodeTreeLabel(node: ObjectEditorNode, index: number): string {
  const { name, type } = editorNodeTreeParts(node, index)
  return `${name}: ${type}`
}

/**
 * AI 助手写入数据池字段时的强制纠偏。
 * - array/json：把误写成 JSON 文本的 value 解析成真实数组/对象
 * - number/boolean：把 "10" / "false" 等字符串收成真正标量
 * - computed：要求非空 computeBody，禁止空壳计算字段
 * 无法安全纠偏时抛错，避免静默落盘成「0 项」或运行期类型错乱。
 */
export function coerceAiFieldValue(
  name: string,
  type: DataFieldType,
  raw: unknown,
): DataFieldValue {
  if (raw === undefined) return defaultValue(type)

  if (type === 'array') {
    if (raw === null) return []
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!trimmed) return []
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (!Array.isArray(parsed)) {
          throw new Error('not-array')
        }
        return parsed
      } catch {
        throw new Error(
          `字段 ${name} 类型为 array 时，value 必须是 JSON 数组字面量，不能是字符串。正确：[{"emoji":"🍎","name":"苹果"}]；错误："[{\\"emoji\\":...}]"。`,
        )
      }
    }
    throw new Error(`字段 ${name} 类型为 array 时 value 无效：${summarizeBadValue(raw)}`)
  }

  if (type === 'json' || type === 'map') {
    if (raw === null) return {}
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!trimmed) return {}
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not-object')
        }
        return parsed as Record<string, unknown>
      } catch {
        throw new Error(
          `字段 ${name} 类型为 ${type} 时，value 必须是 JSON 对象，不能是字符串化的 JSON。`,
        )
      }
    }
    throw new Error(`字段 ${name} 类型为 ${type} 时 value 无效：${summarizeBadValue(raw)}`)
  }

  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true' || raw === 'false') return raw === 'true'
    if (raw === 1 || raw === 0) return raw === 1
    throw new Error(
      `字段 ${name} 类型为 boolean 时 value 须为 true/false。收到：${summarizeBadValue(raw)}`,
    )
  }

  if (type === 'number') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && raw.trim() !== '') {
      const n = Number(raw)
      if (Number.isFinite(n)) return n
    }
    if (raw === null) return 0
    throw new Error(
      `字段 ${name} 类型为 number 时 value 须为数字。收到：${summarizeBadValue(raw)}`,
    )
  }

  if (raw === null) return defaultValue(type)
  return raw as DataFieldValue
}

function summarizeBadValue(raw: unknown): string {
  try {
    const text = JSON.stringify(raw)
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return String(raw)
  }
}

function inferArrayItemType(value: unknown[]): DataFieldType {
  if (!value.length) return 'string'
  const first = value[0]
  if (Array.isArray(first)) return 'array'
  if (first && typeof first === 'object') return 'json'
  if (typeof first === 'number') return 'number'
  if (typeof first === 'boolean') return 'boolean'
  return 'string'
}

/** 供 upsert_data_field 使用：规范化并纠偏 AI 传入的字段定义 */
export function normalizeAiDataField(raw: Record<string, unknown>): DataField {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) throw new Error('field.name 不能为空')
  const typeRaw = typeof raw.type === 'string' ? raw.type.trim() : 'string'
  const allowed = DATA_FIELD_TYPE_OPTIONS.some((o) => o.value === typeRaw)
  if (!allowed) {
    throw new Error(`不支持的字段类型：${typeRaw}`)
  }
  const type = typeRaw as DataFieldType
  const remark = typeof raw.remark === 'string' ? raw.remark : ''
  const value = coerceAiFieldValue(name, type, raw.value)

  const field: DataField = { name, type, remark, value }

  if ('binding' in raw) {
    field.binding = normalizeDataSourceBinding(raw.binding)
  }
  if ('computeBody' in raw) {
    field.computeBody =
      typeof raw.computeBody === 'string' ? raw.computeBody : ''
  }
  if (field.binding === 'computed') {
    const body = (field.computeBody ?? '').trim()
    if (!body) {
      throw new Error(
        `字段 ${name} 绑定为 computed 时必须提供非空 computeBody（方法体须 return 计算值）。禁止只建空字段名却自称计算字段。`,
      )
    }
  }

  if (typeof raw.typeRef === 'string') field.typeRef = raw.typeRef
  if (raw.genericArgs && typeof raw.genericArgs === 'object') {
    field.genericArgs = raw.genericArgs as Record<string, string>
  }
  if (raw.controllerBinding && typeof raw.controllerBinding === 'object') {
    field.controllerBinding = raw.controllerBinding as ControllerBindingConfig
  }
  if (raw.ossBinding && typeof raw.ossBinding === 'object') {
    field.ossBinding = raw.ossBinding as OssBindingConfig
  }
  if (Array.isArray(raw.objectFields)) {
    field.objectFields = raw.objectFields as ObjectSubField[]
  }
  if (typeof raw.itemType === 'string' && raw.itemType.trim()) {
    field.itemType = raw.itemType.trim() as DataFieldType
  }
  if (typeof raw.itemTypeRef === 'string') field.itemTypeRef = raw.itemTypeRef
  if (typeof raw.itemItemType === 'string') {
    field.itemItemType = raw.itemItemType as DataFieldType
  }
  if (typeof raw.itemItemTypeRef === 'string') {
    field.itemItemTypeRef = raw.itemItemTypeRef
  }
  if (typeof raw.keyType === 'string') {
    field.keyType = raw.keyType as MapKeyType
  }

  if (type === 'array' && Array.isArray(value)) {
    if (!field.itemType) field.itemType = inferArrayItemType(value)
    if (Array.isArray(raw.arrayFields) && raw.arrayFields.length) {
      field.arrayFields = raw.arrayFields as ArraySubField[]
    } else if (value.length) {
      field.arrayFields = valueToArrayFields(value)
    } else {
      field.arrayFields = []
    }
  } else if (Array.isArray(raw.arrayFields)) {
    field.arrayFields = raw.arrayFields as ArraySubField[]
  }

  return field
}
