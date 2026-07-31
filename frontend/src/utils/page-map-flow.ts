import {
  createEmptyProcessorTypeExpr,
  type ProcessorTypeExpr,
} from '../types/backend-services'
import type { DataTypeLibrary, TypeAtom, TypeExpr } from '../types/data-types'
import type { MethodParam } from '../types/page-method'
import { findDataTypeDef } from './named-type-fields'

export const PAGE_META_FIELDS = [
  'current',
  'pageSize',
  'total',
  'hasNext',
] as const

export const PAGE_RECORDS_FIELD = 'records'

export const QUERY_PAGE_VO_TYPE_ID = 'type_common_QueryPageVo'

export type PageMapSourceKind = 'page' | 'array'

export type PageMapFieldMapping = {
  targetField: string
  sourceField: string
}

export type PageMapApplyConfig = {
  sourceKind: PageMapSourceKind
  sourcePath: string
  currentExpr: string
  pageSizeExpr: string
  totalExpr: string
  hasNextExpr: string
  targetVarName: string
  fieldMappings: PageMapFieldMapping[]
}

function primaryAtom(expr: TypeExpr): TypeAtom {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'any' }
}

function namedRefOf(expr: ProcessorTypeExpr): string {
  return (expr.typeRef || '').trim()
}

/** 是否为分页对象类型（QueryPageVo 或含 records + 分页 meta 的 interface） */
export function isPageTypeExpr(
  expr: ProcessorTypeExpr | null | undefined,
  library: DataTypeLibrary | null | undefined,
): boolean {
  if (!expr) return false
  const ref = namedRefOf(expr)
  if (!ref) return false
  const def = findDataTypeDef(library, ref)
  if (!def || def.kind !== 'interface') return false
  if (def.name.trim() === 'QueryPageVo') return true
  const fieldNames = new Set(def.fields.map((f) => f.name.trim()))
  return (
    fieldNames.has(PAGE_RECORDS_FIELD) &&
    PAGE_META_FIELDS.some((m) => fieldNames.has(m))
  )
}

export function isArrayTypeExpr(
  expr: ProcessorTypeExpr | null | undefined,
): boolean {
  return expr?.type === 'array'
}

/** 从分页类型解析 records 元素 interface id */
export function resolveRecordsItemTypeRef(
  expr: ProcessorTypeExpr,
  library: DataTypeLibrary | null | undefined,
): string {
  const ref = namedRefOf(expr)
  const def = findDataTypeDef(library, ref)
  if (!def) return ''
  const recordsField = def.fields.find(
    (f) => f.name.trim() === PAGE_RECORDS_FIELD,
  )
  if (!recordsField) return ''
  const genericArgs = expr.genericArgs ?? {}
  const atom = primaryAtom(recordsField.type)
  if (atom.kind !== 'array' || !atom.item) return ''
  if (atom.item.kind === 'generic') {
    return (genericArgs[atom.item.ref ?? ''] ?? '').trim()
  }
  if (atom.item.kind === 'named') {
    return (atom.item.ref ?? '').trim()
  }
  return ''
}

/** 从数组类型解析元素 interface id（itemTypeRef / 嵌套 array） */
export function resolveArrayItemTypeRef(
  expr: ProcessorTypeExpr,
  _library: DataTypeLibrary | null | undefined,
): string {
  if (expr.type !== 'array') return ''
  if (expr.itemType === 'array') {
    return (expr.itemItemTypeRef || '').trim()
  }
  return (expr.itemTypeRef || '').trim()
}

export function listInterfaceFieldNames(
  typeRef: string,
  library: DataTypeLibrary | null | undefined,
): string[] {
  const def = findDataTypeDef(library, typeRef)
  if (!def || def.kind !== 'interface') return []
  return def.fields.map((f) => f.name.trim()).filter(Boolean)
}

/** 类型库中所有分页具名类型 id */
export function listPageTypeIds(
  library: DataTypeLibrary | null | undefined,
): string[] {
  const out: string[] = []
  for (const group of library?.groups ?? []) {
    for (const t of group.types ?? []) {
      const id = t.id?.trim()
      if (!id) continue
      const probe: ProcessorTypeExpr = {
        ...createEmptyProcessorTypeExpr('json'),
        typeRef: id,
      }
      if (isPageTypeExpr(probe, library)) out.push(id)
    }
  }
  return out
}

/** 类型库中所有非分页具名类型 id（供 DataFieldTypeTreeSelect excludeNamedIds） */
export function listNonPageTypeIds(
  library: DataTypeLibrary | null | undefined,
): string[] {
  const pageIds = new Set(listPageTypeIds(library))
  const out: string[] = []
  for (const group of library?.groups ?? []) {
    for (const t of group.types ?? []) {
      const id = t.id?.trim()
      if (!id || pageIds.has(id)) continue
      out.push(id)
    }
  }
  return out
}

/** QueryPageVo 的泛型参数名（默认 T） */
export function resolveQueryPageVoGenericName(
  library: DataTypeLibrary | null | undefined,
): string {
  const def = findDataTypeDef(library, QUERY_PAGE_VO_TYPE_ID)
  const name = def?.generics?.[0]?.name?.trim()
  return name || 'T'
}

/** 从已存配置解析 records 元素类型 id（T） */
export function resolvePageMapItemTypeRef(
  data: {
    targetTypeRef?: string
    targetGenericArgs?: Record<string, string>
    targetItemTypeRef?: string
  },
  library: DataTypeLibrary | null | undefined,
): string {
  const direct =
    typeof data.targetItemTypeRef === 'string'
      ? data.targetItemTypeRef.trim()
      : ''
  if (direct) return direct
  const typeRef =
    typeof data.targetTypeRef === 'string' ? data.targetTypeRef.trim() : ''
  const args = data.targetGenericArgs ?? {}
  if (typeRef === QUERY_PAGE_VO_TYPE_ID || namedRefIsQueryPageVo(typeRef, library)) {
    const g = resolveQueryPageVoGenericName(library)
    return (args[g] || args.T || '').trim()
  }
  // 兼容旧配置：若直接存了非分页类型，视为 T
  if (typeRef) {
    const probe: ProcessorTypeExpr = {
      ...createEmptyProcessorTypeExpr('json'),
      typeRef,
    }
    if (!isPageTypeExpr(probe, library)) return typeRef
    const g = resolveQueryPageVoGenericName(library)
    return (args[g] || args.T || Object.values(args)[0] || '').trim()
  }
  return ''
}

function namedRefIsQueryPageVo(
  typeRef: string,
  library: DataTypeLibrary | null | undefined,
): boolean {
  if (!typeRef) return false
  if (typeRef === QUERY_PAGE_VO_TYPE_ID) return true
  return findDataTypeDef(library, typeRef)?.name?.trim() === 'QueryPageVo'
}

/** 构造 QueryPageVo<T> 的 ProcessorTypeExpr */
export function buildQueryPageVoTypeExpr(
  itemTypeRef: string,
  library: DataTypeLibrary | null | undefined,
): ProcessorTypeExpr {
  const g = resolveQueryPageVoGenericName(library)
  return {
    ...createEmptyProcessorTypeExpr('json'),
    typeRef: QUERY_PAGE_VO_TYPE_ID,
    genericArgs: itemTypeRef.trim() ? { [g]: itemTypeRef.trim() } : {},
  }
}

/** 分页 records 元素的可映射字段名 */
export function resolveItemFieldNames(
  pageExpr: ProcessorTypeExpr,
  library: DataTypeLibrary | null | undefined,
): string[] {
  const itemRef = resolveRecordsItemTypeRef(pageExpr, library)
  if (!itemRef) return []
  return listInterfaceFieldNames(itemRef, library)
}

/** 数组元素的可映射字段名 */
export function resolveArrayItemFieldNames(
  arrayExpr: ProcessorTypeExpr,
  library: DataTypeLibrary | null | undefined,
): string[] {
  const itemRef = resolveArrayItemTypeRef(arrayExpr, library)
  if (!itemRef) return []
  return listInterfaceFieldNames(itemRef, library)
}

export function filterPageAmbientVars(
  vars: MethodParam[],
  library: DataTypeLibrary | null | undefined,
): MethodParam[] {
  return vars.filter((v) => v.typeExpr && isPageTypeExpr(v.typeExpr, library))
}

export function filterArrayAmbientVars(vars: MethodParam[]): MethodParam[] {
  return vars.filter((v) => v.typeExpr && isArrayTypeExpr(v.typeExpr))
}

export function readFieldMappings(raw: unknown): PageMapFieldMapping[] {
  if (!Array.isArray(raw)) return []
  const out: PageMapFieldMapping[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const targetField =
      typeof (item as PageMapFieldMapping).targetField === 'string'
        ? (item as PageMapFieldMapping).targetField.trim()
        : ''
    const sourceField =
      typeof (item as PageMapFieldMapping).sourceField === 'string'
        ? (item as PageMapFieldMapping).sourceField.trim()
        : ''
    if (!targetField) continue
    out.push({ targetField, sourceField })
  }
  return out
}

export function readPageMapApplyConfig(
  data: Record<string, unknown>,
): PageMapApplyConfig | null {
  const sourcePath =
    typeof data.sourcePath === 'string' ? data.sourcePath.trim() : ''
  const targetVarName =
    (typeof data.targetVarName === 'string'
      ? data.targetVarName.trim()
      : '') ||
    (typeof data.targetPath === 'string' ? data.targetPath.trim() : '')
  if (!sourcePath || !targetVarName) return null
  const sourceKind: PageMapSourceKind =
    data.sourceKind === 'array' ? 'array' : 'page'
  return {
    sourceKind,
    sourcePath,
    currentExpr:
      typeof data.currentExpr === 'string' ? data.currentExpr.trim() : '',
    pageSizeExpr:
      typeof data.pageSizeExpr === 'string' ? data.pageSizeExpr.trim() : '',
    totalExpr: typeof data.totalExpr === 'string' ? data.totalExpr.trim() : '',
    hasNextExpr:
      typeof data.hasNextExpr === 'string' ? data.hasNextExpr.trim() : '',
    targetVarName,
    fieldMappings: readFieldMappings(data.fieldMappings),
  }
}

/** 按同名字段自动映射；未匹配的目标字段 sourceField 留空 */
export function buildAutoFieldMappings(
  targetFields: string[],
  sourceFields: string[],
): PageMapFieldMapping[] {
  const sourceSet = new Set(sourceFields)
  return targetFields.map((targetField) => ({
    targetField,
    sourceField: sourceSet.has(targetField) ? targetField : '',
  }))
}

/** 打开已有配置时：保留已保存映射，仅对缺失行做同名补全 */
export function mergeSavedFieldMappings(
  targetFields: string[],
  sourceFields: string[],
  saved: PageMapFieldMapping[],
): PageMapFieldMapping[] {
  const savedByTarget = new Map(
    saved.map((m) => [m.targetField, m.sourceField] as const),
  )
  const sourceSet = new Set(sourceFields)
  return targetFields.map((targetField) => {
    const prev = savedByTarget.get(targetField)
    if (prev !== undefined) {
      return { targetField, sourceField: prev }
    }
    return {
      targetField,
      sourceField: sourceSet.has(targetField) ? targetField : '',
    }
  })
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function evalPath(scope: Record<string, unknown>, path: string): unknown {
  const expr = path.trim()
  if (!expr) return undefined
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k))
  const values = keys.map((k) => scope[k])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict"; return (${expr});`)
  return fn(...values)
}

function mapRecords(
  srcRecords: unknown[],
  fieldMappings: PageMapFieldMapping[],
): unknown[] {
  return srcRecords.map((item) => {
    const row: Record<string, unknown> = {}
    const srcItem = asRecord(item)
    for (const m of fieldMappings) {
      const targetField = m.targetField.trim()
      const sourceField = m.sourceField.trim()
      if (!targetField || !sourceField) continue
      if (Object.prototype.hasOwnProperty.call(srcItem, sourceField)) {
        row[targetField] = srcItem[sourceField]
      }
    }
    return row
  })
}

function applyArrayMeta(
  scope: Record<string, unknown>,
  out: Record<string, unknown>,
  config: PageMapApplyConfig,
): void {
  if (config.currentExpr) out.current = evalPath(scope, config.currentExpr)
  if (config.pageSizeExpr) out.pageSize = evalPath(scope, config.pageSizeExpr)
  if (config.totalExpr) out.total = evalPath(scope, config.totalExpr)
  if (config.hasNextExpr) {
    out.hasNext = evalPath(scope, config.hasNextExpr)
    return
  }
  const cur = Number(out.current)
  const ps = Number(out.pageSize)
  const tot = Number(out.total)
  if (!Number.isNaN(cur) && !Number.isNaN(ps) && !Number.isNaN(tot)) {
    out.hasNext = cur * ps < tot
  }
}

/** 将源分页或数组映射到目标分页对象并写回 scope（调试 / 运行共用语义） */
export function applyPageMap(
  scope: Record<string, unknown>,
  config: PageMapApplyConfig,
): void {
  const { sourceKind, sourcePath, targetVarName, fieldMappings } = config
  if (!sourcePath.trim() || !targetVarName.trim()) return

  const out: Record<string, unknown> = {}
  let srcRecords: unknown[] = []

  if (sourceKind === 'page') {
    const src = evalPath(scope, sourcePath)
    const srcObj = asRecord(src)
    for (const key of PAGE_META_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(srcObj, key)) {
        out[key] = srcObj[key]
      }
    }
    srcRecords = Array.isArray(srcObj[PAGE_RECORDS_FIELD])
      ? (srcObj[PAGE_RECORDS_FIELD] as unknown[])
      : []
  } else {
    const raw = evalPath(scope, sourcePath)
    srcRecords = Array.isArray(raw) ? raw : []
    applyArrayMeta(scope, out, config)
  }

  out[PAGE_RECORDS_FIELD] = mapRecords(srcRecords, fieldMappings)
  scope[targetVarName.trim()] = out
}

