import type { DataField, DataFieldType } from './page-data'
import type { DataTypeLibrary } from './data-types'
import { findDataTypeDef } from '../utils/named-type-fields'
import {
  buildDataTypeTsContext,
  dataTypeToTs,
} from '../utils/data-type-ts'
import {
  createEmptyProcessorTypeExpr,
  type ProcessorTypeExpr,
} from './backend-services'

export type MethodParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'map'
  | 'any'

export type MethodReturnType = MethodParamType | 'void'

export interface MethodParam {
  name: string
  type: MethodParamType
  /** 精确 TS 类型（优先于 type 映射，如 GoodsItem[]） */
  tsType?: string
  /** 精确类型表达式（级联绑定 / 类型匹配） */
  typeExpr?: ProcessorTypeExpr
  /** 引用 types/ 库具名类型（对象） */
  typeRef?: string
  /** type === 'array' 时的元素类型 */
  itemType?: DataFieldType
  itemTypeRef?: string
  /** itemType === 'array' 时，内层数组的元素类型 */
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}

/** MethodParam.type ↔ 数据池 DataFieldType（对象用 object / json） */
export function methodParamToDataFieldType(type: MethodParamType): DataFieldType {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'array'
    case 'object':
      return 'json'
    case 'map':
      return 'map'
    case 'any':
      return 'any'
    default:
      return 'string'
  }
}

/** 按 emit / 方法形参类型规范化取值（字符串 JSON → 对象等） */
export function coerceEmitParamValue(
  type: MethodParamType,
  raw: unknown,
): unknown {
  if (type === 'any') {
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (
        (text.startsWith('{') && text.endsWith('}')) ||
        (text.startsWith('[') && text.endsWith(']'))
      ) {
        try {
          return JSON.parse(text)
        } catch {
          return raw
        }
      }
    }
    return raw
  }
  if (type === 'object') {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed
        }
      } catch {
        // ignore
      }
    }
    return {}
  }
  if (type === 'array') {
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed
      } catch {
        // ignore
      }
    }
    return []
  }
  if (type === 'number') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    const s = String(raw ?? '').trim().toLowerCase()
    if (s === 'true' || s === '1') return true
    if (s === 'false' || s === '0' || s === '') return false
    return Boolean(raw)
  }
  if (raw == null) return ''
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw)
    } catch {
      return String(raw)
    }
  }
  return String(raw)
}

/** 数据池字段类型 → 方法 ambient / 形参类型 */
export function dataFieldToMethodParamType(type: DataFieldType): MethodParamType {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'array'
    case 'json':
      return 'object'
    case 'map':
      return 'map'
    case 'any':
      return 'any'
    default:
      // string / time / date / datetime / icon / color / ref / resource
      return 'string'
  }
}

function namedTypeName(
  typeRef: string | undefined,
  library: DataTypeLibrary | null | undefined,
): string | null {
  if (!typeRef) return null
  const def = findDataTypeDef(library, typeRef)
  const name = def?.name?.trim()
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null
  return name
}

function primitiveTsType(type: DataFieldType | undefined | null): string {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
      return 'Record<string, any>'
    case 'array':
      return 'any[]'
    case 'map':
      return 'Record<string, any>'
    case 'any':
      return 'any'
    case 'time':
    case 'date':
    case 'datetime':
    case 'icon':
    case 'color':
    case 'ref':
    case 'string':
    case 'api':
      return 'string'
    case 'resource':
      return 'URI'
    default:
      return 'string'
  }
}

/** 数据池字段 → 精确 TypeScript 类型（含具名类型与泛型实参） */
export function dataFieldToTsType(
  field: Pick<
    DataField,
    | 'type'
    | 'typeRef'
    | 'genericArgs'
    | 'itemType'
    | 'itemTypeRef'
    | 'itemItemType'
    | 'itemItemTypeRef'
  >,
  library?: DataTypeLibrary | null,
): string {
  const args = field.genericArgs
  if (field.type === 'array') {
    if (field.itemType === 'array') {
      const inner =
        (field.itemItemTypeRef
          ? namedTypeWithGenerics(field.itemItemTypeRef, args, library)
          : null) ?? primitiveTsType(field.itemItemType)
      return `${inner}[][]`
    }
    const elem =
      (field.itemTypeRef
        ? namedTypeWithGenerics(field.itemTypeRef, args, library)
        : null) ?? primitiveTsType(field.itemType)
    return `${elem}[]`
  }
  if (field.type === 'json') {
    if (field.typeRef) {
      return (
        namedTypeWithGenerics(field.typeRef, args, library) ??
        'Record<string, any>'
      )
    }
    return 'Record<string, any>'
  }
  return primitiveTsType(field.type)
}

/** 将类型库全部声明为 ambient，供方法体编辑器识别具名类型 */
export function buildTypeLibraryAmbientDeclarations(
  library: DataTypeLibrary | null | undefined,
): string {
  if (!library?.groups?.length) return ''
  const ctx = buildDataTypeTsContext(library)
  const parts: string[] = []
  for (const group of library.groups) {
    for (const def of group.types) {
      if (!def.name?.trim()) continue
      const src = dataTypeToTs(def, ctx).trim()
      if (src) parts.push(src)
    }
  }
  return parts.join('\n\n')
}

/** 具名类型 + 泛型实参 → QueryPageVo<GoodsItem> */
function namedTypeWithGenerics(
  typeRef: string,
  genericArgs: Record<string, string> | undefined,
  library: DataTypeLibrary | null | undefined,
): string | null {
  const def = findDataTypeDef(library, typeRef)
  const name = def?.name?.trim()
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null
  const gens = def?.generics ?? []
  if (!gens.length) return name
  const inner = gens
    .map((g) => {
      const argId = (genericArgs?.[g.name] ?? '').trim()
      if (!argId) return 'any'
      return namedTypeName(argId, library) ?? 'any'
    })
    .join(', ')
  return `${name}<${inner}>`
}

/** 处理器方法入参/出参类型 → 精确 TS 类型字符串 */
export function processorTypeExprToTs(
  expr: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): string {
  if (!expr) return 'any'
  const args = expr.genericArgs ?? {}
  if (expr.type === 'map') {
    const key = expr.keyType === 'number' ? 'number' : 'string'
    if (expr.itemType === 'array') {
      const leaf =
        namedTypeWithGenerics(expr.itemItemTypeRef, args, library) ??
        primitiveTsType((expr.itemItemType || 'string') as DataFieldType)
      return `Map<${key}, ${leaf}[]>`
    }
    const leaf =
      namedTypeWithGenerics(expr.itemTypeRef, args, library) ??
      primitiveTsType((expr.itemType || 'string') as DataFieldType)
    return `Map<${key}, ${leaf}>`
  }
  if (expr.type === 'array') {
    if (expr.itemType === 'array') {
      const leaf =
        namedTypeWithGenerics(expr.itemItemTypeRef, args, library) ??
        primitiveTsType((expr.itemItemType || 'string') as DataFieldType)
      return `${leaf}[][]`
    }
    const leaf =
      namedTypeWithGenerics(expr.itemTypeRef, args, library) ??
      primitiveTsType((expr.itemType || 'string') as DataFieldType)
    return `${leaf}[]`
  }
  if (expr.typeRef) {
    return (
      namedTypeWithGenerics(expr.typeRef, args, library) ??
      (expr.type === 'json' ? 'Record<string, any>' : primitiveTsType(expr.type as DataFieldType))
    )
  }
  if (expr.type === 'json') return 'Record<string, any>'
  return primitiveTsType((expr.type || 'any') as DataFieldType)
}

/** 处理器类型表达式 → MethodParam 粗粒度 type */
export function processorTypeExprToMethodParamType(
  expr: ProcessorTypeExpr | null | undefined,
): MethodParamType {
  if (!expr) return 'any'
  if (expr.type === 'array') return 'array'
  if (expr.type === 'map') return 'map'
  if (expr.type === 'json' || expr.typeRef) return 'object'
  return dataFieldToMethodParamType((expr.type || 'any') as DataFieldType)
}

/** 数据池字段 → ProcessorTypeExpr（供 TypedBinding 类型匹配） */
export function dataFieldToProcessorTypeExpr(
  field: Pick<
    DataField,
    | 'type'
    | 'typeRef'
    | 'genericArgs'
    | 'itemType'
    | 'itemTypeRef'
    | 'itemItemType'
    | 'itemItemTypeRef'
    | 'keyType'
  >,
): ProcessorTypeExpr {
  const genericArgs = { ...(field.genericArgs ?? {}) }
  if (field.type === 'array') {
    return {
      ...createEmptyProcessorTypeExpr('array'),
      itemType: field.itemType || 'any',
      itemTypeRef: field.itemTypeRef || '',
      itemItemType: field.itemItemType || '',
      itemItemTypeRef: field.itemItemTypeRef || '',
      genericArgs,
    }
  }
  if (field.type === 'map') {
    return {
      ...createEmptyProcessorTypeExpr('map'),
      keyType: field.keyType === 'number' ? 'number' : 'string',
      itemType: field.itemType || 'any',
      itemTypeRef: field.itemTypeRef || '',
      itemItemType: field.itemItemType || '',
      itemItemTypeRef: field.itemItemTypeRef || '',
      genericArgs,
    }
  }
  if (field.typeRef) {
    return {
      ...createEmptyProcessorTypeExpr('json'),
      typeRef: field.typeRef,
      genericArgs,
    }
  }
  if (field.type === 'json') {
    return createEmptyProcessorTypeExpr('json')
  }
  if (field.type === 'any') return createEmptyProcessorTypeExpr('any')
  if (
    field.type === 'number' ||
    field.type === 'boolean' ||
    field.type === 'string'
  ) {
    return createEmptyProcessorTypeExpr(field.type)
  }
  // icon / color / ref → string 语义
  return createEmptyProcessorTypeExpr('string')
}

/** 数据池字段 → Monaco ambient 变量（合法标识符；ref 见 buildRefAmbientDeclarations） */
export function dataFieldsToAmbientVars(
  fields: DataField[] | undefined,
  library?: DataTypeLibrary | null,
): MethodParam[] {
  const result: MethodParam[] = []
  const seen = new Set<string>()
  for (const field of fields ?? []) {
    if (field.type === 'ref') continue
    const name = field.name.trim()
    if (!name || seen.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name)) continue
    seen.add(name)
    result.push({
      name,
      type: dataFieldToMethodParamType(field.type),
      tsType: dataFieldToTsType(field, library),
      typeExpr: dataFieldToProcessorTypeExpr(field),
    })
  }
  return result
}

export interface PageMethod {
  /** 方法名，同时作为文件名 */
  name: string
  params: MethodParam[]
  returnType: MethodReturnType
  /** 方法体（不含函数签名） */
  body: string
  /** 预置只读方法 */
  builtin?: boolean
  /** 预置方法列表中的作用说明 */
  summary?: string
}

export const METHOD_PARAM_TYPE_OPTIONS: Array<{
  label: string
  value: MethodParamType
}> = [
  { label: '字符串', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: 'object', value: 'object' },
  { label: '[]', value: 'array' },
  { label: '映射', value: 'map' },
  { label: '任意', value: 'any' },
]

export const METHOD_RETURN_TYPE_OPTIONS: Array<{
  label: string
  value: MethodReturnType
}> = [
  { label: '无返回值', value: 'void' },
  ...METHOD_PARAM_TYPE_OPTIONS,
]

export const BUILTIN_METHODS: PageMethod[] = [
  {
    name: 'navigateTo',
    params: [
      { name: 'to', type: 'string' },
      { name: 'params', type: 'object' },
    ],
    returnType: 'void',
    body: '// 跳转到指定页面\n// to: 页面 id；params: 路由参数对象',
    builtin: true,
    summary: '跳转到指定页面，可携带路由参数',
  },
  {
    name: 'navigateBack',
    params: [],
    returnType: 'void',
    body: '// 返回上一页',
    builtin: true,
    summary: '返回上一页（预览栈或运行时历史）',
  },
  {
    name: 'setData',
    params: [
      { name: 'prop', type: 'string' },
      { name: 'value', type: 'any' },
    ],
    returnType: 'void',
    body: '// 写入数据池字段\n// prop: 字段名；value: 任意值',
    builtin: true,
    summary: '写入当前页/组件数据池字段',
  },
  {
    name: 'showToast',
    params: [
      { name: 'message', type: 'string' },
      { name: 'duration', type: 'string' },
    ],
    returnType: 'void',
    body:
      '// 弹出 Toast 提示\n' +
      "// message: 提示内容\n" +
      "// duration: 'short'（短，默认）或 'long'（长）",
    builtin: true,
    summary: '弹出 Toast 提示（duration 为 short / long）',
  },
  {
    name: 'getDeviceInfo',
    params: [],
    returnType: 'object',
    body:
      '// 获取设备信息\n' +
      '// 返回：\n' +
      '// - statusBarHeight: 状态栏高度（px）\n' +
      '// - userAgent: 手机 UA\n' +
      '// - menuButton: 微信小程序胶囊位置与大小（H5 为 null）\n' +
      '// - platform: \'h5\' | \'miniprogram\'\n' +
      '// 用法：const info = getDeviceInfo()',
    builtin: true,
    summary: '获取设备信息（状态栏高度、平台、胶囊等）',
  },
]

/** 仅组件 function 目录注入的预置方法 */
export const COMPONENT_BUILTIN_METHODS: PageMethod[] = [
  {
    name: 'emit',
    params: [
      { name: 'event', type: 'string' },
      { name: '...args', type: 'any' },
    ],
    returnType: 'void',
    body:
      '// 向父页面抛出组件事件\n' +
      "// 用法：emit(事件名, ...事件参数)\n" +
      "// 事件名对应组件设置里「事件方法」的名称；其后参数按该事件定义的参数依次传入\n" +
      "// 例如事件 onClick 定义了参数 id，则：emit('onClick', id)",
    builtin: true,
    summary: '向父级抛出组件事件（事件名与参数见组件设置）',
  },
  {
    name: 'updateProps',
    params: [
      { name: 'prop', type: 'string' },
      { name: 'value', type: 'any' },
    ],
    returnType: 'void',
    body:
      '// 更新「可更新」入参并通知父级（入参仍可传常量，不必双向绑定）\n' +
      "// 用法：updateProps(参数名, 新值)\n" +
      '// 参数名须为组件设置中开启「可更新」的参数；新值类型与该参数一致\n' +
      "// 例如：updateProps('data', list)",
    builtin: true,
    summary: '更新已开启「可更新」的入参，并通知父级',
  },
]

export function builtinsForRoot(root: 'pages' | 'components'): PageMethod[] {
  if (root === 'components') {
    return [
      ...BUILTIN_METHODS.map((item) => ({ ...item, builtin: true as const })),
      ...COMPONENT_BUILTIN_METHODS.map((item) => ({ ...item, builtin: true as const })),
    ]
  }
  return BUILTIN_METHODS.map((item) => ({ ...item, builtin: true as const }))
}

export function isBuiltinMethodName(
  name: string,
  root: 'pages' | 'components' = 'pages',
): boolean {
  return builtinsForRoot(root).some((item) => item.name === name)
}

export function isValidMethodName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
}

export function createEmptyMethod(): PageMethod {
  return {
    name: '',
    params: [],
    returnType: 'void',
    body: '',
    builtin: false,
  }
}

/** 写入 .ts 文件的内容 */
export function serializeMethodFile(method: PageMethod): string {
  const meta = {
    name: method.name,
    params: method.params,
    returnType: method.returnType,
  }
  return `/*@voider-method\n${JSON.stringify(meta, null, 2)}\n*/\n\n${method.body.trimEnd()}\n`
}

/** 从 .ts 文件内容解析 */
export function parseMethodFile(raw: string, fallbackName: string): PageMethod {
  const trimmed = raw.replace(/^\uFEFF/, '')
  const match = trimmed.match(/^\/\*@voider-method\s*([\s\S]*?)\*\//)
  let meta: Partial<PageMethod> = { name: fallbackName }
  let body = trimmed

  if (match) {
    try {
      meta = { ...meta, ...(JSON.parse(match[1]) as Partial<PageMethod>) }
    } catch {
      // ignore
    }
    body = trimmed.slice(match[0].length).replace(/^\s*\n/, '')
  }

  const name =
    typeof meta.name === 'string' && meta.name.trim()
      ? meta.name.trim()
      : fallbackName

  const params = Array.isArray(meta.params)
    ? meta.params
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          name: String((item as MethodParam).name ?? '').trim(),
          type: normalizeParamType((item as MethodParam).type),
        }))
        .filter((item) => item.name)
    : []

  return {
    name,
    params,
    returnType: normalizeReturnType(meta.returnType),
    body: body.replace(/\s+$/, '\n') || '',
    builtin: false,
  }
}

function normalizeParamType(value: unknown): MethodParamType {
  const allowed: MethodParamType[] = [
    'string',
    'number',
    'boolean',
    'object',
    'array',
    'map',
    'any',
  ]
  return allowed.includes(value as MethodParamType)
    ? (value as MethodParamType)
    : 'any'
}

function normalizeReturnType(value: unknown): MethodReturnType {
  if (value === 'void') return 'void'
  return normalizeParamType(value)
}

function mapAmbientTsType(type: string): string {
  switch (type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'Record<string, unknown>'
    case 'array':
      return 'unknown[]'
    case 'map':
      return 'Map<string, unknown>'
    case 'void':
      return 'void'
    default:
      return 'any'
  }
}

/**
 * 根据组件「事件方法」生成 emit 的 ambient 声明，供方法体编辑器提示。
 * emit(eventName, ...该事件定义的参数)
 */
export function buildEmitAmbientDeclarations(
  events: Array<{ name: string; params: MethodParam[] }>,
  library?: DataTypeLibrary | null,
): string {
  const lines: string[] = [
    '/** 向父页面抛出组件事件：emit(事件名, ...事件参数) */',
  ]
  for (const event of events) {
    const eventName = event.name.trim()
    if (!eventName || !/^[A-Za-z_$][\w$]*$/.test(eventName)) continue
    const params = (event.params ?? [])
      .filter((item) => item.name.trim())
      .map((item) => {
        const name = item.name.trim().replace(/^\.\.\./, '')
        const safe = /^[A-Za-z_$][\w$]*$/.test(name) ? name : 'arg'
        const ts =
          item.tsType?.trim() ||
          dataFieldToTsType(
            {
              type: methodParamToDataFieldType(item.type),
              typeRef: item.typeRef,
              itemType: item.itemType,
              itemTypeRef: item.itemTypeRef,
              itemItemType: item.itemItemType,
              itemItemTypeRef: item.itemItemTypeRef,
            },
            library,
          )
        return `${safe}: ${ts}`
      })
    const paramList = params.length ? `, ${params.join(', ')}` : ''
    lines.push(`declare function emit(event: '${eventName}'${paramList}): void;`)
  }
  lines.push('declare function emit(event: string, ...args: any[]): void;')
  return `${lines.join('\n')}\n`
}

/**
 * 当前页面/组件的自定义方法 ambient，供事件/方法体里互相调用（如 loadData()）。
 */
export function buildLocalMethodsAmbientDeclarations(
  methods: PageMethod[] | undefined,
  library?: DataTypeLibrary | null,
): string {
  const lines: string[] = []
  for (const method of methods ?? []) {
    if (method.builtin) continue
    const name = method.name.trim()
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue
    const params = (method.params ?? [])
      .filter((item) => {
        const n = item.name.trim()
        return n && !n.startsWith('...')
      })
      .map((item) => {
        const safe = item.name.trim()
        const ts =
          item.tsType?.trim() ||
          dataFieldToTsType(
            {
              type: methodParamToDataFieldType(item.type),
              typeRef: item.typeRef,
              itemType: item.itemType,
              itemTypeRef: item.itemTypeRef,
              itemItemType: item.itemItemType,
              itemItemTypeRef: item.itemItemTypeRef,
            },
            library,
          )
        return `${safe}: ${ts}`
      })
    const ret =
      method.returnType === 'void'
        ? 'void'
        : mapAmbientTsType(method.returnType || 'void')
    lines.push(
      `declare function ${name}(${params.join(', ')}): ${ret};`,
    )
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

/** 事件绑定：内联自定义方法体（下拉里的「自定义」） */
export const CUSTOM_EVENT_METHOD = '__custom__'

/** 事件绑定：单个方法调用 */
export interface EventMethodBinding {
  id: string
  method: string
  /** 参数名 → 字面量/表达式字符串 */
  args: Record<string, string>
  /** method === CUSTOM_EVENT_METHOD 时的 TypeScript 方法体 */
  body?: string
}

export function isCustomEventMethod(method: string | undefined): boolean {
  return method === CUSTOM_EVENT_METHOD
}

const eventBindingsCache = new Map<string, EventMethodBinding[]>()
const EVENT_BINDINGS_CACHE_MAX = 256

export function parseEventBindings(raw: string | undefined): EventMethodBinding[] {
  if (!raw?.trim()) return []
  const hit = eventBindingsCache.get(raw)
  if (hit) return hit

  let result: EventMethodBinding[] = []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      // 兼容旧纯字符串：当作无参方法名
      const name = raw.trim()
      if (!name) return []
      result = [
        {
          id: `bind_${Date.now()}`,
          method: name.includes(':') ? name.split(':')[0]! : name,
          args: {},
        },
      ]
    } else {
      result = parsed
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => {
          const row = item as Partial<EventMethodBinding>
          const method = String(row.method ?? '').trim()
          const body =
            typeof row.body === 'string' ? row.body : undefined
          return {
            id: row.id || `bind_${index}_${Date.now()}`,
            method,
            args:
              row.args && typeof row.args === 'object' && !Array.isArray(row.args)
                ? Object.fromEntries(
                    Object.entries(row.args).map(([k, v]) => [
                      k,
                      v == null ? '' : String(v),
                    ]),
                  )
                : {},
            ...(method === CUSTOM_EVENT_METHOD || body != null
              ? { body: body ?? '' }
              : {}),
          }
        })
        .filter((item) => item.method)
    }
  } catch {
    const name = raw.trim()
    if (!name) return []
    result = [{ id: `bind_${Date.now()}`, method: name, args: {} }]
  }

  if (eventBindingsCache.size >= EVENT_BINDINGS_CACHE_MAX) {
    const first = eventBindingsCache.keys().next().value
    if (first != null) eventBindingsCache.delete(first)
  }
  eventBindingsCache.set(raw, result)
  return result
}

export function serializeEventBindings(bindings: EventMethodBinding[]): string {
  const list = bindings
    .filter((item) => item.method.trim())
    .map((item) => {
      const row: EventMethodBinding = {
        id: item.id,
        method: item.method.trim(),
        args: item.args ?? {},
      }
      if (item.method.trim() === CUSTOM_EVENT_METHOD) {
        row.body = typeof item.body === 'string' ? item.body : ''
      }
      return row
    })
  if (!list.length) return ''
  return JSON.stringify(list)
}

export function countEventBindings(raw: string | undefined): number {
  return parseEventBindings(raw).length
}

export const INTERACTION_EVENT_KEYS = [
  'onClick',
  'onLongClick',
  'onScroll',
  'onScrollToLower',
  'onScrollToUpper',
  'onTouchStart',
  'onTouchMove',
  'onTouchEnd',
] as const

export function countNodeEventBindings(
  attrs: Record<string, string | undefined>,
  extraKeys: string[] = [],
): number {
  const keys = [...new Set<string>([...INTERACTION_EVENT_KEYS, ...extraKeys])]
  return keys.reduce((sum, key) => sum + countEventBindings(attrs[key]), 0)
}
