/** 项目级后端服务（services/<id>/config.json）——对应后端「服务」，非服务层 */

export const SERVICES_DIR = 'services'
export const SERVICE_CONFIG_FILE = 'config.json'
/** @deprecated 旧版单文件，读取时自动迁移到 services/ */
export const SERVICES_LEGACY_FILE = 'services.json'

/** 服务目录 id：字母开头，字母/数字/下划线/连字符 */
export function isValidServiceId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(id)
}

export interface BackendService {
  /** 目录名，如 goods */
  id: string
  /** 模块显示名（原「服务」） */
  name: string
  /**
   * @deprecated 端口改由构建方案里的后端服务配置；读写仍兼容旧数据
   */
  port?: number
  /**
   * 测试环境数据库：引用 mysql.json 中 databases[].id
   */
  testMysqlId: string
  /**
   * 生产环境数据库：引用 mysql.json 中 databases[].id
   */
  productionMysqlId: string
}

export interface BackendServiceLibrary {
  services: BackendService[]
}

export function createEmptyBackendService(id = 'service'): BackendService {
  const safeId = isValidServiceId(id) ? id : 'service'
  return {
    id: safeId,
    name: safeId,
    testMysqlId: '',
    productionMysqlId: '',
  }
}

export function createEmptyBackendServiceLibrary(): BackendServiceLibrary {
  return { services: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 兼容旧版内嵌连接配置 / 新版 mysqlId 字符串 */
function normalizeMysqlRef(input: unknown): string {
  if (typeof input === 'string') return input.trim()
  if (isPlainObject(input)) {
    if (typeof input.mysqlId === 'string') return input.mysqlId.trim()
    if (typeof input.id === 'string') return input.id.trim()
  }
  return ''
}

export function normalizeBackendService(
  input: unknown,
  fallbackId?: string,
): BackendService | null {
  if (!isPlainObject(input)) return null
  const rawId =
    typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : (fallbackId ?? '')
  if (!isValidServiceId(rawId)) return null
  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : rawId

  const testMysqlId =
    typeof input.testMysqlId === 'string'
      ? input.testMysqlId.trim()
      : normalizeMysqlRef(input.test)

  const productionRaw =
    input.productionMysqlId != null
      ? input.productionMysqlId
      : input.production != null
        ? input.production
        : input.development
  const productionMysqlId =
    typeof productionRaw === 'string'
      ? productionRaw.trim()
      : normalizeMysqlRef(productionRaw)

  return {
    id: rawId,
    name,
    testMysqlId,
    productionMysqlId,
  }
}

export function normalizeBackendServiceLibrary(input: unknown): BackendServiceLibrary {
  if (!isPlainObject(input) || !Array.isArray(input.services)) {
    return createEmptyBackendServiceLibrary()
  }
  return {
    services: input.services
      .map((item) => normalizeBackendService(item))
      .filter((item): item is BackendService => Boolean(item)),
  }
}

/** 写入磁盘的 config.json */
export function serializeServiceConfig(service: BackendService): Record<string, unknown> {
  return {
    id: service.id,
    name: service.name,
    testMysqlId: service.testMysqlId,
    productionMysqlId: service.productionMysqlId,
  }
}

// ——— 控制器 ———

export const CONTROLLERS_DIR = 'controllers'
export const CONTROLLER_CONFIG_FILE = 'config.json'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/** 控制器 API 入参来源 */
export type ServiceApiParamLocation =
  | 'query'
  | 'param'
  | 'httpHeader'
  | 'body'

/** 控制器 API 入参项 */
export interface ServiceApiParam {
  id: string
  /** 变量名（同时作为 HTTP 入参名） */
  varName: string
  location: ServiceApiParamLocation
  /** 基础类型：string / number / boolean / json / time / date / datetime … */
  type: string
  /** 具名类型 id（如 DTO）；type 为 json 时可用 */
  typeRef: string
  /** 具名类型的泛型实参；空串表示 any */
  genericArgs?: Record<string, string>
  required: boolean
  remark: string
}

/** @deprecated 旧版请求头，归一化时迁入 inputs */
export interface ServiceApiHeader {
  id: string
  name: string
  required: boolean
  remark: string
}

export type ProcessorMethodScope = 'private' | 'public'

/** 控制器下的 API */
export interface ServiceApi {
  id: string
  name: string
  path: string
  remark: string
  method: HttpMethod
  /** 入参列表（含 query / param / header / body） */
  inputs: ServiceApiParam[]
  /** 出参类型 */
  output: ProcessorTypeExpr
  requireAuth: boolean
  /** 作用域：私有 / 公共 */
  scope: ProcessorMethodScope
  /** 调试入参（按变量名持久化） */
  debugParams: Record<string, unknown>
  /** API 编排工作流（直接绑定业务方法时自动生成） */
  flow: MethodFlow
}

export interface ServiceController {
  /** 目录名 */
  id: string
  name: string
  /** 路由前缀，如 /goods */
  path: string
  /** 说明 */
  remark: string
  apis: ServiceApi[]
}

export function isValidControllerId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(id)
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyServiceApiParam(
  partial?: Partial<ServiceApiParam>,
): ServiceApiParam {
  return {
    id: uid('ain'),
    varName: '',
    location: 'query',
    type: 'string',
    typeRef: '',
    required: false,
    remark: '',
    ...partial,
  }
}

export function createEmptyServiceApiHeader(
  name = '',
): ServiceApiHeader {
  return {
    id: uid('hdr'),
    name,
    required: false,
    remark: '',
  }
}

export function createEmptyServiceApi(name = ''): ServiceApi {
  return {
    id: uid('api'),
    name,
    path: '/',
    remark: '',
    method: 'GET',
    inputs: [],
    output: {
      type: 'any',
      typeRef: '',
      itemType: '',
      itemTypeRef: '',
      itemItemType: '',
      itemItemTypeRef: '',
      keyType: '',
      genericArgs: {},
    },
    requireAuth: false,
    scope: 'public',
    debugParams: {},
    flow: createDefaultMethodFlow(),
  }
}

export function createEmptyServiceController(name = '控制器'): ServiceController {
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return {
    id,
    name: name.trim() || id,
    path: '',
    remark: '',
    apis: [],
  }
}

function normalizeHttpMethod(value: unknown): HttpMethod {
  const raw = String(value ?? 'GET').toUpperCase()
  const allowed: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  return allowed.includes(raw as HttpMethod) ? (raw as HttpMethod) : 'GET'
}

export function normalizeServiceApiHeader(input: unknown): ServiceApiHeader | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('hdr'),
    name,
    required: Boolean(input.required),
    remark: typeof input.remark === 'string' ? input.remark : '',
  }
}

function normalizeServiceApiHeaders(input: unknown): ServiceApiHeader[] {
  if (Array.isArray(input)) {
    return input
      .map(normalizeServiceApiHeader)
      .filter((x): x is ServiceApiHeader => Boolean(x))
  }
  if (typeof input === 'string' && input.trim()) {
    return [createEmptyServiceApiHeader(input.trim())]
  }
  return []
}

function normalizeServiceApiParamLocation(
  input: unknown,
): ServiceApiParamLocation {
  if (
    input === 'query' ||
    input === 'param' ||
    input === 'httpHeader' ||
    input === 'body'
  ) {
    return input
  }
  return 'query'
}

export function normalizeServiceApiParam(input: unknown): ServiceApiParam | null {
  if (!isPlainObject(input)) return null
  const varName =
    typeof input.varName === 'string'
      ? input.varName.trim()
      : typeof input.paramName === 'string' && input.paramName.trim()
        ? input.paramName.trim()
        : typeof input.name === 'string'
          ? input.name.trim()
          : ''
  const typeRef =
    typeof input.typeRef === 'string' ? input.typeRef.trim() : ''
  let type =
    typeof input.type === 'string' && input.type.trim()
      ? input.type.trim()
      : 'string'
  if (typeRef && type === 'string') type = 'json'
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('ain'),
    varName,
    location: normalizeServiceApiParamLocation(input.location),
    type,
    typeRef,
    genericArgs: normalizeGenericArgs(input.genericArgs),
    required: Boolean(input.required),
    remark: typeof input.remark === 'string' ? input.remark : '',
  }
}

function migrateLegacyApiInputs(input: Record<string, unknown>): ServiceApiParam[] {
  const inputs: ServiceApiParam[] = []
  const dtoRef =
    typeof input.inputDtoRef === 'string' ? input.inputDtoRef.trim() : ''
  if (dtoRef) {
    inputs.push(
      createEmptyServiceApiParam({
        varName: 'body',
        location: 'body',
        type: 'json',
        typeRef: dtoRef,
        required: true,
        remark: '',
      }),
    )
  }
  for (const h of normalizeServiceApiHeaders(input.headers)) {
    if (!h.name) continue
    inputs.push(
      createEmptyServiceApiParam({
        id: h.id || uid('ain'),
        varName: h.name,
        location: 'httpHeader',
        type: 'string',
        typeRef: '',
        required: h.required,
        remark: h.remark,
      }),
    )
  }
  return inputs
}

function normalizeServiceApiInputs(input: Record<string, unknown>): ServiceApiParam[] {
  if (Array.isArray(input.inputs)) {
    const list = input.inputs
      .map(normalizeServiceApiParam)
      .filter((x): x is ServiceApiParam => Boolean(x))
    if (list.length) return list
  }
  return migrateLegacyApiInputs(input)
}

export function normalizeServiceApi(input: unknown): ServiceApi | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('api'),
    name,
    path: typeof input.path === 'string' ? input.path.trim() : '',
    remark: typeof input.remark === 'string' ? input.remark : '',
    method: normalizeHttpMethod(input.method),
    inputs: normalizeServiceApiInputs(input),
    output:
      input.output != null ||
      (typeof input.outputRef === 'string' && Boolean(input.outputRef.trim()))
        ? normalizeProcessorTypeExpr(
            input.output,
            typeof input.outputRef === 'string' ? input.outputRef : undefined,
          )
        : createEmptyProcessorTypeExpr('any'),
    requireAuth: Boolean(input.requireAuth),
    scope: normalizeProcessorMethodScope(input.scope),
    debugParams: normalizeDebugParams(input.debugParams),
    flow: normalizeMethodFlow(input.flow),
  }
}

export function normalizeServiceController(
  input: unknown,
  fallbackId?: string,
): ServiceController | null {
  if (!isPlainObject(input)) return null
  const rawId =
    typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : (fallbackId ?? '')
  if (!isValidControllerId(rawId)) return null
  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : rawId
  const apis = Array.isArray(input.apis)
    ? input.apis.map(normalizeServiceApi).filter((x): x is ServiceApi => Boolean(x))
    : []
  return {
    id: rawId,
    name,
    path: typeof input.path === 'string' ? input.path.trim() : '',
    remark: typeof input.remark === 'string' ? input.remark : '',
    apis,
  }
}

export function serializeControllerConfig(
  controller: ServiceController,
): Record<string, unknown> {
  return {
    id: controller.id,
    name: controller.name,
    path: controller.path,
    remark: controller.remark,
    apis: controller.apis,
  }
}

// ——— 业务层 / 数据层：处理器 + 方法 ———

export type ProcessorLayerKind = 'business' | 'data'

export const BUSINESS_DIR = 'business'
export const DATA_LAYER_DIR = 'data'
export const PROCESSOR_CONFIG_FILE = 'config.json'

export function processorLayerDirName(kind: ProcessorLayerKind): string {
  return kind === 'business' ? BUSINESS_DIR : DATA_LAYER_DIR
}

export function isValidProcessorId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(id)
}

/** 方法入参 / 出参类型（级联：基础类型 + 数组 + types 分组） */
export interface ProcessorTypeExpr {
  type: string
  typeRef: string
  itemType: string
  itemTypeRef: string
  itemItemType: string
  itemItemTypeRef: string
  /** type === 'map' 时的键类型：string | number */
  keyType: string
  /** 具名类型的泛型实参；空串表示 any */
  genericArgs: Record<string, string>
}

/** 方法入参 */
export interface ProcessorMethodParam {
  id: string
  name: string
  remark: string
  typeExpr: ProcessorTypeExpr
  /** 控制器 API 入参必传（调试 / 生成校验用） */
  required?: boolean
}

/** 数据层方法：数据源种类（先实现 MySQL） */
export type DataMethodSourceKind = 'mysql' | 'redis' | 'stream'

/** 数据层方法：操作类型 */
export type DataMethodOperation =
  | 'query'
  | 'insert'
  | 'batchInsert'
  | 'delete'
  | 'update'
  | 'custom'

export const DATA_METHOD_SOURCE_OPTIONS: Array<{
  label: string
  value: DataMethodSourceKind
  disabled?: boolean
}> = [
  { label: 'MySQL', value: 'mysql' },
  { label: 'Redis', value: 'redis', disabled: true },
  { label: '流', value: 'stream', disabled: true },
]

export const DATA_METHOD_OPERATION_OPTIONS: Array<{
  label: string
  value: DataMethodOperation
}> = [
  { label: '查询', value: 'query' },
  { label: '插入', value: 'insert' },
  { label: '批量插入', value: 'batchInsert' },
  { label: '删除', value: 'delete' },
  { label: '修改', value: 'update' },
  { label: '自定义', value: 'custom' },
]

/**
 * 字段映射：
 * - 自定义：field=出参字段，column=列/表达式
 * - 插入/批量插入：field=目标列，column=源入参路径（如 data.name / items.name）
 */
export interface DataMethodFieldMapping {
  field: string
  column: string
}

/** 查询条件运算符 */
export type DataMethodConditionOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'notLike'
  | 'in'
  | 'notIn'
  | 'isNull'
  | 'isNotNull'
  | 'between'

export const DATA_METHOD_CONDITION_OP_OPTIONS: Array<{
  label: string
  value: DataMethodConditionOp
  needsValue?: boolean
  needsValueTo?: boolean
}> = [
  { label: '等于', value: 'eq', needsValue: true },
  { label: '不等于', value: 'ne', needsValue: true },
  { label: '大于', value: 'gt', needsValue: true },
  { label: '大于等于', value: 'gte', needsValue: true },
  { label: '小于', value: 'lt', needsValue: true },
  { label: '小于等于', value: 'lte', needsValue: true },
  { label: 'LIKE', value: 'like', needsValue: true },
  { label: 'NOT LIKE', value: 'notLike', needsValue: true },
  { label: '属于', value: 'in', needsValue: true },
  { label: '不属于', value: 'notIn', needsValue: true },
  { label: '为空', value: 'isNull' },
  { label: '不为空', value: 'isNotNull' },
  { label: '介于', value: 'between', needsValue: true, needsValueTo: true },
]

export type DataMethodConditionValueKind = 'literal' | 'param'

export interface DataMethodCondition {
  id: string
  field: string
  customField: string
  op: DataMethodConditionOp
  valueKind: DataMethodConditionValueKind
  value: string
  valueTo: string
}

export interface DataMethodConditionGroup {
  id: string
  conditions: DataMethodCondition[]
}

export const CUSTOM_CONDITION_FIELD = '__custom__'

export function createEmptyDataMethodCondition(): DataMethodCondition {
  return {
    id: `cond_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    field: '',
    customField: '',
    op: 'eq',
    valueKind: 'literal',
    value: '',
    valueTo: '',
  }
}

export function createEmptyDataMethodConditionGroup(): DataMethodConditionGroup {
  return {
    id: `cg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    conditions: [createEmptyDataMethodCondition()],
  }
}

function normalizeConditionOp(input: unknown): DataMethodConditionOp {
  const ok = DATA_METHOD_CONDITION_OP_OPTIONS.some((o) => o.value === input)
  return ok ? (input as DataMethodConditionOp) : 'eq'
}

function normalizeCondition(input: unknown): DataMethodCondition | null {
  if (!isPlainObject(input)) return null
  const field = typeof input.field === 'string' ? input.field.trim() : ''
  const customField =
    typeof input.customField === 'string' ? input.customField.trim() : ''
  if (!field && !customField) return null
  return {
    id:
      typeof input.id === 'string' && input.id.trim()
        ? input.id.trim()
        : createEmptyDataMethodCondition().id,
    field: field || CUSTOM_CONDITION_FIELD,
    customField,
    op: normalizeConditionOp(input.op),
    valueKind: input.valueKind === 'param' ? 'param' : 'literal',
    value: typeof input.value === 'string' ? input.value : '',
    valueTo: typeof input.valueTo === 'string' ? input.valueTo : '',
  }
}

function normalizeConditionGroup(input: unknown): DataMethodConditionGroup | null {
  if (!isPlainObject(input)) return null
  const conditions = Array.isArray(input.conditions)
    ? input.conditions
        .map(normalizeCondition)
        .filter((x): x is DataMethodCondition => Boolean(x))
    : []
  return {
    id:
      typeof input.id === 'string' && input.id.trim()
        ? input.id.trim()
        : createEmptyDataMethodConditionGroup().id,
    conditions,
  }
}

/** 数据层方法执行配置（业务层方法可忽略） */
export interface DataMethodConfig {
  source: DataMethodSourceKind
  operation: DataMethodOperation
  /** 查询模式下勾选的出参字段名 */
  queryFields: string[]
  /** 自定义 SQL */
  sql: string
  /** 自定义 / 插入字段映射 */
  fieldMappings: DataMethodFieldMapping[]
  /** 批量插入：选用的数组入参名 */
  batchSourceParam: string
  /** 查询：分页入参名（如 pageDto）；未绑定则不分页 */
  pageParam: string
  /** 非插入操作的查询条件（组内 AND，组间 OR） */
  conditionGroups: DataMethodConditionGroup[]
}

export function createEmptyDataMethodConfig(): DataMethodConfig {
  return {
    source: 'mysql',
    operation: 'query',
    queryFields: [],
    sql: '',
    fieldMappings: [],
    batchSourceParam: '',
    pageParam: '',
    conditionGroups: [],
  }
}

export function normalizeDataMethodConfig(input: unknown): DataMethodConfig {
  const empty = createEmptyDataMethodConfig()
  if (!isPlainObject(input)) return empty
  const source =
    input.source === 'mysql' ||
    input.source === 'redis' ||
    input.source === 'stream'
      ? input.source
      : empty.source
  const operation =
    input.operation === 'query' ||
    input.operation === 'insert' ||
    input.operation === 'batchInsert' ||
    input.operation === 'delete' ||
    input.operation === 'update' ||
    input.operation === 'custom'
      ? input.operation
      : empty.operation
  const queryFields = Array.isArray(input.queryFields)
    ? input.queryFields
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
    : []
  const fieldMappings = Array.isArray(input.fieldMappings)
    ? input.fieldMappings
        .filter((x): x is Record<string, unknown> => isPlainObject(x))
        .map((x) => ({
          field: typeof x.field === 'string' ? x.field.trim() : '',
          column: typeof x.column === 'string' ? x.column.trim() : '',
        }))
        .filter((x) => x.field)
    : []
  const conditionGroups = Array.isArray(input.conditionGroups)
    ? input.conditionGroups
        .map(normalizeConditionGroup)
        .filter((x): x is DataMethodConditionGroup => Boolean(x))
    : []
  return {
    source,
    operation,
    queryFields,
    sql: typeof input.sql === 'string' ? input.sql : '',
    fieldMappings,
    batchSourceParam:
      typeof input.batchSourceParam === 'string'
        ? input.batchSourceParam.trim()
        : '',
    pageParam:
      typeof input.pageParam === 'string' ? input.pageParam.trim() : '',
    conditionGroups,
  }
}

export function normalizeDebugParams(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const name = key.trim()
    if (!name) continue
    out[name] = value
  }
  return out
}

export const PROCESSOR_METHOD_SCOPE_OPTIONS: Array<{
  label: string
  value: ProcessorMethodScope
}> = [
  { label: '私有', value: 'private' },
  { label: '公共', value: 'public' },
]

export interface ProcessorMethod {
  id: string
  name: string
  /** 说明 */
  remark: string
  /** 作用域：私有 / 公共 */
  scope: ProcessorMethodScope
  params: ProcessorMethodParam[]
  output: ProcessorTypeExpr
  /** 数据层方法配置 */
  dataConfig: DataMethodConfig
  /**
   * 调试入参（按参数名持久化）
   */
  debugParams: Record<string, unknown>
  /** 业务层等方法工作流 */
  flow: MethodFlow
  /** 虚拟预置方法（不落盘） */
  preset?: boolean
  /** 预置方法不可用（如未配置逻辑删除时的 deleteById） */
  disabled?: boolean
}

/** 工作流节点种类 */
export type FlowNodeKind =
  | 'start'
  | 'input'
  | 'branch'
  | 'action'
  | 'output'
  | 'define'
  | 'pageMap'
  | 'objectMap'
  | 'throw'
  | 'end'

export interface FlowNodePosition {
  x: number
  y: number
}

export interface FlowNode {
  id: string
  kind: FlowNodeKind
  position: FlowNodePosition
  data: Record<string, unknown>
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  label?: string
}

export interface MethodFlow {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export function createDefaultMethodFlow(): MethodFlow {
  return {
    nodes: [
      {
        id: 'start',
        kind: 'start',
        position: { x: 280, y: 40 },
        data: {},
      },
    ],
    edges: [],
  }
}

export function normalizeMethodFlow(input: unknown): MethodFlow {
  if (!isPlainObject(input)) return createDefaultMethodFlow()
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : []
  const nodes: FlowNode[] = []
  for (const item of rawNodes) {
    if (!isPlainObject(item)) continue
    const kind = item.kind
    if (
      kind !== 'start' &&
      kind !== 'input' &&
      kind !== 'branch' &&
      kind !== 'action' &&
      kind !== 'output' &&
      kind !== 'define' &&
      kind !== 'pageMap' &&
      kind !== 'objectMap' &&
      kind !== 'throw' &&
      kind !== 'end'
    ) {
      continue
    }
    const id =
      typeof item.id === 'string' && item.id.trim() ? item.id.trim() : uid('node')
    const pos = isPlainObject(item.position) ? item.position : {}
    const x = Number(pos.x)
    const y = Number(pos.y)
    const data = isPlainObject(item.data) ? { ...item.data } : {}
    nodes.push({
      id,
      kind,
      position: {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
      },
      data,
    })
  }
  if (!nodes.some((n) => n.kind === 'start')) {
    nodes.unshift({
      id: 'start',
      kind: 'start',
      position: { x: 280, y: 40 },
      data: {},
    })
  }
  const rawEdges = Array.isArray(input.edges) ? input.edges : []
  const edges: FlowEdge[] = []
  const nodeIds = new Set(nodes.map((n) => n.id))
  for (const item of rawEdges) {
    if (!isPlainObject(item)) continue
    const source = typeof item.source === 'string' ? item.source.trim() : ''
    const target = typeof item.target === 'string' ? item.target.trim() : ''
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
      continue
    }
    const id =
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim()
        : uid('edge')
    const edge: FlowEdge = { id, source, target }
    if (typeof item.sourceHandle === 'string' && item.sourceHandle.trim()) {
      edge.sourceHandle = item.sourceHandle.trim()
    }
    if (typeof item.label === 'string' && item.label.trim()) {
      edge.label = item.label.trim()
    }
    edges.push(edge)
  }
  return { nodes, edges }
}

/** 处理器（业务层 / 数据层共用结构） */
export interface ServiceProcessor {
  id: string
  name: string
  remark: string
  /**
   * 数据层：绑定实体（types 中 category=entity 的类型 id），创建时必填
   * 业务层：一般为空
   */
  entityRef: string
  /**
   * 业务层：可选绑定的数据层处理器 id
   * 数据层：一般为空
   */
  dataProcessorRef: string
  methods: ProcessorMethod[]
}

function normalizeGenericArgs(input: unknown): Record<string, string> {
  if (!isPlainObject(input)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!key.trim()) continue
    out[key] = typeof value === 'string' ? value.trim() : ''
  }
  return out
}

export function createEmptyProcessorTypeExpr(
  type = 'string',
): ProcessorTypeExpr {
  return {
    type,
    typeRef: '',
    itemType: '',
    itemTypeRef: '',
    itemItemType: '',
    itemItemTypeRef: '',
    keyType: type === 'map' ? 'string' : '',
    genericArgs: {},
  }
}

/** 兼容旧版：仅存 typeRef / outputRef 字符串 */
export function normalizeProcessorTypeExpr(
  input: unknown,
  legacyRef?: string,
): ProcessorTypeExpr {
  if (typeof input === 'string' && input.trim()) {
    return {
      ...createEmptyProcessorTypeExpr('json'),
      typeRef: input.trim(),
    }
  }
  if (isPlainObject(input)) {
    let type =
      typeof input.type === 'string' && input.type.trim()
        ? input.type.trim()
        : input.typeRef || legacyRef
          ? 'json'
          : 'string'
    if (type === 'dict') type = 'map'
    const keyRaw =
      typeof input.keyType === 'string' ? input.keyType.trim() : ''
    return {
      type,
      typeRef:
        typeof input.typeRef === 'string'
          ? input.typeRef.trim()
          : (legacyRef ?? '').trim(),
      itemType: typeof input.itemType === 'string' ? input.itemType.trim() : '',
      itemTypeRef:
        typeof input.itemTypeRef === 'string' ? input.itemTypeRef.trim() : '',
      itemItemType:
        typeof input.itemItemType === 'string' ? input.itemItemType.trim() : '',
      itemItemTypeRef:
        typeof input.itemItemTypeRef === 'string'
          ? input.itemItemTypeRef.trim()
          : '',
      keyType: keyRaw === 'number' ? 'number' : keyRaw === 'string' ? 'string' : type === 'map' ? 'string' : '',
      genericArgs: normalizeGenericArgs(
        input.genericArgs ?? input.outputGenericArgs,
      ),
    }
  }
  if (legacyRef?.trim()) {
    return {
      ...createEmptyProcessorTypeExpr('json'),
      typeRef: legacyRef.trim(),
    }
  }
  return createEmptyProcessorTypeExpr()
}

export function createEmptyProcessorMethodParam(
  name = '',
): ProcessorMethodParam {
  return {
    id: uid('param'),
    name,
    remark: '',
    typeExpr: createEmptyProcessorTypeExpr(),
  }
}

export function createEmptyProcessorMethod(name = ''): ProcessorMethod {
  return {
    id: uid('method'),
    name,
    remark: '',
    scope: 'public',
    params: [],
    output: createEmptyProcessorTypeExpr(),
    dataConfig: createEmptyDataMethodConfig(),
    debugParams: {},
    flow: createDefaultMethodFlow(),
  }
}

export function createEmptyServiceProcessor(name = '处理器'): ServiceProcessor {
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return {
    id,
    name: name.trim() || id,
    remark: '',
    entityRef: '',
    dataProcessorRef: '',
    methods: [],
  }
}

export function normalizeProcessorMethodParam(
  input: unknown,
): ProcessorMethodParam | null {
  if (!isPlainObject(input)) return null
  const legacyRef =
    typeof input.typeRef === 'string' ? input.typeRef.trim() : ''
  const typeExpr = input.typeExpr
    ? normalizeProcessorTypeExpr(input.typeExpr, legacyRef)
    : normalizeProcessorTypeExpr(
        {
          type: input.type,
          typeRef: input.typeRef,
          itemType: input.itemType,
          itemTypeRef: input.itemTypeRef,
          itemItemType: input.itemItemType,
          itemItemTypeRef: input.itemItemTypeRef,
          genericArgs: input.genericArgs,
        },
        legacyRef,
      )
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('param'),
    name: typeof input.name === 'string' ? input.name.trim() : '',
    remark: typeof input.remark === 'string' ? input.remark : '',
    typeExpr,
    required: Boolean(input.required),
  }
}

function normalizeProcessorMethodScope(input: unknown): ProcessorMethodScope {
  return input === 'private' ? 'private' : 'public'
}

export function normalizeProcessorMethod(input: unknown): ProcessorMethod | null {
  if (!isPlainObject(input)) return null
  const params = Array.isArray(input.params)
    ? input.params
        .map(normalizeProcessorMethodParam)
        .filter((x): x is ProcessorMethodParam => Boolean(x))
    : []
  const legacyOut =
    typeof input.outputRef === 'string' ? input.outputRef.trim() : ''
  const output = input.output
    ? normalizeProcessorTypeExpr(input.output, legacyOut)
    : normalizeProcessorTypeExpr(
        {
          type: input.outputType,
          typeRef: input.outputRef,
          itemType: input.outputItemType,
          itemTypeRef: input.outputItemTypeRef,
          itemItemType: input.outputItemItemType,
          itemItemTypeRef: input.outputItemItemTypeRef,
          genericArgs: input.outputGenericArgs,
        },
        legacyOut,
      )
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('method'),
    name: typeof input.name === 'string' ? input.name.trim() : '',
    remark: typeof input.remark === 'string' ? input.remark : '',
    scope: normalizeProcessorMethodScope(input.scope),
    params,
    output,
    dataConfig: normalizeDataMethodConfig(input.dataConfig),
    debugParams: normalizeDebugParams(input.debugParams),
    flow: normalizeMethodFlow(input.flow),
  }
}

export function normalizeServiceProcessor(
  input: unknown,
  fallbackId?: string,
): ServiceProcessor | null {
  if (!isPlainObject(input)) return null
  const rawId =
    typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : (fallbackId ?? '')
  if (!isValidProcessorId(rawId)) return null
  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : rawId
  const methods = Array.isArray(input.methods)
    ? input.methods
        .map(normalizeProcessorMethod)
        .filter((x): x is ProcessorMethod => Boolean(x))
    : []
  return {
    id: rawId,
    name,
    remark: typeof input.remark === 'string' ? input.remark : '',
    entityRef: typeof input.entityRef === 'string' ? input.entityRef.trim() : '',
    dataProcessorRef:
      typeof input.dataProcessorRef === 'string'
        ? input.dataProcessorRef.trim()
        : '',
    methods,
  }
}

export function serializeProcessorConfig(
  processor: ServiceProcessor,
): Record<string, unknown> {
  return {
    id: processor.id,
    name: processor.name,
    remark: processor.remark,
    entityRef: processor.entityRef,
    dataProcessorRef: processor.dataProcessorRef,
    methods: processor.methods,
  }
}
