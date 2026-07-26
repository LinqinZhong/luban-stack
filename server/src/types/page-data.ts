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

/** 数据源绑定：控制器 = 绑定后端 API；计算 = 方法体 return 值 */
export type DataSourceBinding = '' | 'controller' | 'computed'

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
  if (raw === 'computed' || raw === 'controller') return raw
  return ''
}

function defaultControllerParseBody(type: DataField['type']): string {
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
  return `// data 为接口 Result.data\n// return 的值写入本数据池字段\nreturn data ?? ${sample}\n`
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
    ...(inputs ? { inputs } : {}),
  }
}
