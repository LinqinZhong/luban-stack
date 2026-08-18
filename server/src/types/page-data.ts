export type DataFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'array'
  /** 映射：Record<K, T>，K 为 string | number */
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
  /** 后端控制器 API（组件参数） */
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

export interface ObjectSubField {
  name: string
  type: DataFieldType
  value?: DataFieldValue
  typeRef?: string
  itemType?: DataFieldType
  keyType?: MapKeyType
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

/** 数据源绑定：控制器 = 绑定后端 API；计算 = 方法体 return 值；对象存储 = 选资源外链 */
export type DataSourceBinding = '' | 'controller' | 'computed' | 'oss'

/** 控制器绑定：API 入参来源 */
export type ControllerInputSource = 'literal' | 'binding'

/** 控制器绑定：单个 API 入参配置 */
export interface ControllerInputParamConfig {
  source: ControllerInputSource
  literal?: unknown
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

/** 对象存储资源绑定（数据池 resource 类型） */
export interface OssBindingConfig {
  connectionId: string
  bucketName: string
  objectKey: string
  /** 资源外链 URI */
  url: string
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
  /** 引用 types/ 库中的具名类型 id */
  typeRef?: string
  /** 具名泛型实参：形参名 → 类型库 type id */
  genericArgs?: Record<string, string>
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

export function normalizeDataSourceBinding(raw: unknown): DataSourceBinding {
  if (raw === 'computed' || raw === 'controller' || raw === 'oss') return raw
  return ''
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

function defaultControllerParseBody(_type: DataField['type']): string {
  return `// data 为接口 Result.data\n// return 的值写入本数据池字段\nreturn data\n`
}

function normalizeControllerInputParam(
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

function normalizeControllerInputs(
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
  fieldType: DataField['type'] = 'string',
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
