import type { DataField, DataFieldType } from './page-data'
import type { DataTypeLibrary } from './data-types'
import { findDataTypeDef } from '../utils/named-type-fields'
import {
  buildDataTypeTsContext,
  dataTypeToTs,
} from '../utils/data-type-ts'
import type { ProcessorTypeExpr } from './backend-services'

export type MethodParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'any'

export type MethodReturnType = MethodParamType | 'void'

export interface MethodParam {
  name: string
  type: MethodParamType
  /** 精确 TS 类型（优先于 type 映射，如 GoodsItem[]） */
  tsType?: string
  /** 精确类型表达式（级联绑定 / 类型匹配） */
  typeExpr?: ProcessorTypeExpr
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
    case 'any':
      return 'any'
    default:
      // string / icon / color / ref
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
    case 'any':
      return 'any'
    case 'icon':
    case 'color':
    case 'ref':
    case 'string':
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
  if (expr.type === 'json' || expr.typeRef) return 'object'
  return dataFieldToMethodParamType((expr.type || 'any') as DataFieldType)
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
}

export const METHOD_PARAM_TYPE_OPTIONS: Array<{
  label: string
  value: MethodParamType
}> = [
  { label: '字符串', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: '对象', value: 'object' },
  { label: '数组', value: 'array' },
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
  },
  {
    name: 'navigateBack',
    params: [],
    returnType: 'void',
    body: '// 返回上一页',
    builtin: true,
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
        return `${safe}: ${mapAmbientTsType(item.type)}`
      })
    const paramList = params.length ? `, ${params.join(', ')}` : ''
    lines.push(`declare function emit(event: '${eventName}'${paramList}): void;`)
  }
  lines.push('declare function emit(event: string, ...args: any[]): void;')
  return `${lines.join('\n')}\n`
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

export function parseEventBindings(raw: string | undefined): EventMethodBinding[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      // 兼容旧纯字符串：当作无参方法名
      const name = raw.trim()
      if (!name) return []
      return [
        {
          id: `bind_${Date.now()}`,
          method: name.includes(':') ? name.split(':')[0] : name,
          args: {},
        },
      ]
    }
    return parsed
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
  } catch {
    const name = raw.trim()
    if (!name) return []
    return [{ id: `bind_${Date.now()}`, method: name, args: {} }]
  }
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

export const INTERACTION_EVENT_KEYS = ['onClick', 'onLongClick', 'onScroll'] as const

export function countNodeEventBindings(
  attrs: Record<string, string | undefined>,
  extraKeys: string[] = [],
): number {
  const keys = [...new Set<string>([...INTERACTION_EVENT_KEYS, ...extraKeys])]
  return keys.reduce((sum, key) => sum + countEventBindings(attrs[key]), 0)
}
