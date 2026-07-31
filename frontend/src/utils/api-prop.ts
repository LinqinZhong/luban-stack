import type {
  ProcessorTypeExpr,
  ServiceApi,
  ServiceApiParam,
} from '../types/backend-services'
import {
  createEmptyProcessorTypeExpr,
  normalizeProcessorTypeExpr,
} from '../types/backend-services'
import type { ComponentPropDef } from '../types/component'
import type { DataTypeLibrary } from '../types/data-types'
import {
  dataFieldToTsType,
  methodParamToDataFieldType,
  type MethodParam,
} from '../types/page-method'
import { invokeBoundControllerApi } from './controller-binding-runtime'

/** 父级在 Component 节点上绑定的后端 API 引用（写入 XML 属性 JSON） */
export type ApiPropParamBinding = {
  source: 'binding' | 'literal'
  /** source=binding：数据池 / $query 表达式 */
  binding?: string
  /** source=literal：常量（字符串存，调用时按入参类型转换） */
  literal?: string
}

export interface ApiPropBinding {
  serviceId: string
  controllerId: string
  apiId: string
  /**
   * API 额外入参绑定（组件形参之外的 API inputs）。
   * key = API 入参变量名
   */
  paramBindings?: Record<string, ApiPropParamBinding>
}

/** 下拉「常量」选项的哨兵值（不写入持久化） */
export const API_PROP_LITERAL_SELECT = '__voider_literal__'

export function createEmptyApiPropBinding(): ApiPropBinding {
  return { serviceId: '', controllerId: '', apiId: '', paramBindings: {} }
}

export function normalizeApiPropParamBinding(
  raw: unknown,
): ApiPropParamBinding | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return null
    return { source: 'binding', binding: s }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (row.source === 'literal') {
    const literal =
      typeof row.literal === 'string'
        ? row.literal
        : row.literal == null
          ? ''
          : String(row.literal)
    return { source: 'literal', literal }
  }
  const binding =
    typeof row.binding === 'string'
      ? row.binding.trim()
      : typeof row.binding === 'number' || typeof row.binding === 'boolean'
        ? String(row.binding)
        : ''
  if (!binding && typeof row.source !== 'string') {
    // 兼容误存成纯表达式对象
    return null
  }
  if (!binding) return { source: 'binding', binding: '' }
  return { source: 'binding', binding }
}

export function parseApiPropBinding(raw: string | undefined | null): ApiPropBinding | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const row = parsed as Record<string, unknown>
    const serviceId = typeof row.serviceId === 'string' ? row.serviceId.trim() : ''
    const controllerId =
      typeof row.controllerId === 'string' ? row.controllerId.trim() : ''
    const apiId = typeof row.apiId === 'string' ? row.apiId.trim() : ''
    if (!serviceId || !controllerId || !apiId) return null
    const paramBindings: Record<string, ApiPropParamBinding> = {}
    const rawBindings = row.paramBindings
    if (rawBindings && typeof rawBindings === 'object' && !Array.isArray(rawBindings)) {
      for (const [k, v] of Object.entries(rawBindings as Record<string, unknown>)) {
        const key = k.trim()
        if (!key) continue
        const normalized = normalizeApiPropParamBinding(v)
        if (!normalized) continue
        if (
          normalized.source === 'binding' &&
          !(normalized.binding ?? '').trim()
        ) {
          continue
        }
        paramBindings[key] = normalized
      }
    }
    return { serviceId, controllerId, apiId, paramBindings }
  } catch {
    return null
  }
}

export function serializeApiPropBinding(binding: ApiPropBinding): string {
  const paramBindings: Record<string, ApiPropParamBinding> = {}
  for (const [k, v] of Object.entries(binding.paramBindings ?? {})) {
    const key = k.trim()
    if (!key || !v) continue
    if (v.source === 'literal') {
      paramBindings[key] = {
        source: 'literal',
        literal: String(v.literal ?? ''),
      }
      continue
    }
    const expr = String(v.binding ?? '').trim()
    if (!expr) continue
    paramBindings[key] = { source: 'binding', binding: expr }
  }
  return JSON.stringify({
    serviceId: binding.serviceId.trim(),
    controllerId: binding.controllerId.trim(),
    apiId: binding.apiId.trim(),
    ...(Object.keys(paramBindings).length ? { paramBindings } : {}),
  })
}

/** 入参绑定是否已配置（必填校验） */
export function isApiPropParamBoundConfigured(
  cfg: ApiPropParamBinding | undefined | null,
): boolean {
  if (!cfg) return false
  if (cfg.source === 'literal') return true
  return Boolean((cfg.binding ?? '').trim())
}

function normalizeGenericArgs(
  raw: Record<string, string> | undefined | null,
): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    const k = key.trim()
    if (!k) continue
    out[k] = typeof value === 'string' ? value.trim() : ''
  }
  return out
}

function genericArgsKey(args: Record<string, string>): string {
  return Object.keys(args)
    .sort()
    .map((k) => `${k}=${args[k] || 'any'}`)
    .join(';')
}

/** 规范化类型指纹，用于入参/出参一致性比较 */
export function typeFingerprint(opts: {
  type?: string | null
  typeRef?: string | null
  itemType?: string | null
  itemTypeRef?: string | null
  itemItemType?: string | null
  itemItemTypeRef?: string | null
  genericArgs?: Record<string, string> | null
}): string {
  const typeRef = (opts.typeRef ?? '').trim()
  const type = (opts.type ?? '').trim() || (typeRef ? 'json' : 'string')
  const args = normalizeGenericArgs(opts.genericArgs)

  if (type === 'any') return 'any'

  if (type === 'array') {
    const itemType = (opts.itemType ?? '').trim() || 'string'
    if (itemType === 'array') {
      const innerRef = (opts.itemItemTypeRef ?? '').trim()
      const innerType = (opts.itemItemType ?? '').trim() || (innerRef ? 'json' : 'string')
      const leaf = innerRef
        ? `named:${innerRef}<${genericArgsKey(args)}>`
        : `prim:${innerType === 'json' || innerType === 'object' ? 'object' : innerType}`
      return `array:array:${leaf}`
    }
    const itemRef = (opts.itemTypeRef ?? '').trim()
    const leaf = itemRef
      ? `named:${itemRef}<${genericArgsKey(args)}>`
      : `prim:${itemType === 'json' || itemType === 'object' ? 'object' : itemType}`
    return `array:${leaf}`
  }

  if (typeRef) {
    return `named:${typeRef}<${genericArgsKey(args)}>`
  }

  const prim =
    type === 'json' || type === 'object' || type === 'record'
      ? 'object'
      : type || 'string'
  return `prim:${prim}`
}

export function serviceApiParamFingerprint(inp: ServiceApiParam): string {
  return typeFingerprint({
    type: inp.type,
    typeRef: inp.typeRef,
    genericArgs: inp.genericArgs,
  })
}

export function methodParamFingerprint(param: MethodParam): string {
  const expr = param.typeExpr
  if (expr) {
    return typeFingerprint({
      type: expr.type || methodParamToDataFieldType(param.type),
      typeRef: expr.typeRef || param.typeRef,
      itemType: expr.itemType || param.itemType,
      itemTypeRef: expr.itemTypeRef || param.itemTypeRef,
      itemItemType: expr.itemItemType || param.itemItemType,
      itemItemTypeRef: expr.itemItemTypeRef || param.itemItemTypeRef,
      genericArgs: expr.genericArgs,
    })
  }
  return typeFingerprint({
    type: methodParamToDataFieldType(param.type),
    typeRef: param.typeRef,
    itemType: param.itemType,
    itemTypeRef: param.itemTypeRef,
    itemItemType: param.itemItemType,
    itemItemTypeRef: param.itemItemTypeRef,
  })
}

export function processorTypeExprFingerprint(
  expr: ProcessorTypeExpr | null | undefined,
): string {
  if (!expr) return 'any'
  const type = (expr.type ?? '').trim()
  const typeRef = (expr.typeRef ?? '').trim()
  if ((!type || type === 'any') && !typeRef) return 'any'
  return typeFingerprint({
    type: type || (typeRef ? 'json' : 'any'),
    typeRef,
    itemType: expr.itemType,
    itemTypeRef: expr.itemTypeRef,
    itemItemType: expr.itemItemType,
    itemItemTypeRef: expr.itemItemTypeRef,
    genericArgs: expr.genericArgs,
  })
}

export function isEmptyApiReturnType(
  expr: ProcessorTypeExpr | null | undefined,
): boolean {
  return processorTypeExprFingerprint(expr) === 'any'
}

function normalizeMethodParam(row: Partial<MethodParam>): MethodParam | null {
  const name = String(row.name ?? '').trim()
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return null
  const type = (row.type as MethodParam['type']) || 'any'
  const param: MethodParam = { name, type }
  if (typeof row.typeRef === 'string' && row.typeRef.trim()) {
    param.typeRef = row.typeRef.trim()
  }
  if (row.itemType) param.itemType = row.itemType
  if (typeof row.itemTypeRef === 'string' && row.itemTypeRef.trim()) {
    param.itemTypeRef = row.itemTypeRef.trim()
  }
  if (row.itemItemType) param.itemItemType = row.itemItemType
  if (typeof row.itemItemTypeRef === 'string' && row.itemItemTypeRef.trim()) {
    param.itemItemTypeRef = row.itemItemTypeRef.trim()
  }
  if (row.typeExpr) {
    param.typeExpr = normalizeProcessorTypeExpr(row.typeExpr)
  } else if (param.typeRef || param.itemTypeRef || param.itemItemTypeRef) {
    param.typeExpr = {
      ...createEmptyProcessorTypeExpr(methodParamToDataFieldType(type)),
      type: methodParamToDataFieldType(type),
      typeRef: param.typeRef ?? '',
      itemType: param.itemType ?? '',
      itemTypeRef: param.itemTypeRef ?? '',
      itemItemType: param.itemItemType ?? '',
      itemItemTypeRef: param.itemItemTypeRef ?? '',
      genericArgs: {},
    }
  }
  return param
}

export function normalizeApiParams(raw: unknown): MethodParam[] {
  if (!Array.isArray(raw)) return []
  const out: MethodParam[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const param = normalizeMethodParam(item as Partial<MethodParam>)
    if (param) out.push(param)
  }
  return out
}

export function normalizeApiReturnType(raw: unknown): ProcessorTypeExpr {
  if (raw == null) {
    return createEmptyProcessorTypeExpr('any')
  }
  return normalizeProcessorTypeExpr(raw)
}

export type ApiPropConstraint = {
  apiParams?: MethodParam[] | null
  apiReturnType?: ProcessorTypeExpr | null
}

/**
 * 组件 api 参数 ↔ 控制器 API 匹配：
 * 1. 组件声明的每个形参：API 上必须有同名入参，且类型一致
 * 2. API 可有额外入参（含必填）——由页面通过通用 params 等在调用时补齐
 * 3. 出参类型须一致（双方均为 any/空则视为一致）
 */
export function apiMatchesApiPropConstraint(
  api: ServiceApi | null | undefined,
  constraint: ApiPropConstraint,
): boolean {
  if (!api) return false
  const params = normalizeApiParams(constraint.apiParams)
  const apiByName = new Map(
    (api.inputs ?? [])
      .map((inp) => [(inp.varName ?? '').trim(), inp] as const)
      .filter(([name]) => Boolean(name)),
  )

  for (const formal of params) {
    const name = formal.name.trim()
    if (!name) continue
    const inp = apiByName.get(name)
    if (!inp) return false
    if (serviceApiParamFingerprint(inp) !== methodParamFingerprint(formal)) {
      return false
    }
  }

  const wantReturn = processorTypeExprFingerprint(constraint.apiReturnType)
  const apiReturn = processorTypeExprFingerprint(api.output)
  return returnTypesCompatible(wantReturn, apiReturn)
}

/** QueryPageVo 未锁定 T 时，接受任意 T；双方均为 any 也视为一致 */
function returnTypesCompatible(want: string, apiReturn: string): boolean {
  if (want === apiReturn) return true
  if (want === 'any' && apiReturn === 'any') return true
  const pageVo = /^named:type_common_QueryPageVo<(.*)>$/
  const wm = pageVo.exec(want)
  const am = pageVo.exec(apiReturn)
  if (wm && am) {
    const wArgs = (wm[1] || '').trim()
    // 组件未声明 T（或 T=any）→ 任意分页元素类型均可
    if (!wArgs || wArgs === 'T=any') return true
    return wArgs === (am[1] || '').trim()
  }
  return false
}

/** @deprecated 使用 apiMatchesApiPropConstraint */
export function apiInputsMatchParamSubset(
  api: ServiceApi | null | undefined,
  apiParams: MethodParam[] | undefined | null,
  apiReturnType?: ProcessorTypeExpr | null,
): boolean {
  return apiMatchesApiPropConstraint(api, { apiParams, apiReturnType })
}

function processorTypeExprToTs(
  expr: ProcessorTypeExpr | null | undefined,
  typeLibrary?: DataTypeLibrary | null,
): string {
  if (!expr || isEmptyApiReturnType(expr)) return 'any'
  return dataFieldToTsType(
    {
      type: (expr.type || 'any') as import('../types/page-data').DataFieldType,
      typeRef: expr.typeRef || undefined,
      itemType: (expr.itemType || undefined) as
        | import('../types/page-data').DataFieldType
        | undefined,
      itemTypeRef: expr.itemTypeRef || undefined,
      itemItemType: (expr.itemItemType || undefined) as
        | import('../types/page-data').DataFieldType
        | undefined,
      itemItemTypeRef: expr.itemItemTypeRef || undefined,
      genericArgs: expr.genericArgs,
    },
    typeLibrary,
  )
}

/** $props.xxx 的 TS 可调用签名：出参配置为 T，调用返回 Promise<T> */
export function buildApiPropTsType(
  apiParams: MethodParam[] | undefined | null,
  typeLibrary?: DataTypeLibrary | null,
  apiReturnType?: ProcessorTypeExpr | null,
): string {
  const params = normalizeApiParams(apiParams)
  const ret = processorTypeExprToTs(apiReturnType, typeLibrary)
  if (!params.length) {
    return `((args?: Record<string, any>) => Promise<${ret}>)`
  }
  const fields = params
    .map((p) => {
      const expr = p.typeExpr
      const ts = expr
        ? processorTypeExprToTs(expr, typeLibrary)
        : dataFieldToTsType(
            {
              type: methodParamToDataFieldType(p.type),
              typeRef: p.typeRef,
              itemType: p.itemType,
              itemTypeRef: p.itemTypeRef,
              itemItemType: p.itemItemType,
              itemItemTypeRef: p.itemItemTypeRef,
              genericArgs: p.typeExpr?.genericArgs,
            },
            typeLibrary,
          )
      return `  ${p.name}: ${ts};`
    })
    .join('\n')
  return `((args: {\n${fields}\n}) => Promise<${ret}>)`
}

export function isApiPropDef(def: ComponentPropDef | null | undefined): boolean {
  return def?.type === 'api'
}

/** 挂在可调用函数上，供 depsKey / 调试识别绑定 */
export const API_PROP_BINDING_MARK = '__voiderApiBinding'

export type ApiPropInvoker = ((
  args?: Record<string, unknown>,
) => Promise<unknown>) & {
  [API_PROP_BINDING_MARK]?: string
}

/**
 * 将 $props 中 type=api 的字符串绑定替换为可调用函数（预览 / 自定义代码）。
 * 未绑定或缺少 projectPath 时提供会抛错的 stub，保证签名仍是函数。
 */
export function hydrateApiDollarProps(
  dollarProps: Record<string, unknown>,
  defs: ComponentPropDef[] | null | undefined,
  projectPath: string | null | undefined,
  options?: {
    dryRun?: boolean
    /** 解析 paramBindings 时的页面作用域（数据池 + $query 等） */
    getPageScope?: () => Record<string, unknown>
  },
): Record<string, unknown> {
  const list = defs ?? []
  if (!list.some((d) => d.type === 'api')) return dollarProps

  const dryRun = options?.dryRun ?? true
  const path = projectPath?.trim() || ''
  const result = { ...dollarProps }

  for (const def of list) {
    if (def.type !== 'api') continue
    const name = def.name.trim()
    if (!name) continue

    const raw = result[name]
    if (typeof raw === 'function') continue

    const binding =
      typeof raw === 'string' ? parseApiPropBinding(raw) : null
    const mark = binding ? serializeApiPropBinding(binding) : ''

    const invoker: ApiPropInvoker = async (args) => {
      if (!path) {
        throw new Error(`组件参数「${name}」无法调用：未打开项目`)
      }
      if (!binding) {
        throw new Error(`组件参数「${name}」未绑定后端 API`)
      }
      return invokeBoundControllerApi(binding, args ?? {}, {
        projectPath: path,
        dryRun,
        pageScope: options?.getPageScope?.() ?? {},
      })
    }
    invoker[API_PROP_BINDING_MARK] = mark
    result[name] = invoker
  }
  return result
}
