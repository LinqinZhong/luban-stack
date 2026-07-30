export const PAGE_META_FIELDS = [
  'current',
  'pageSize',
  'total',
  'hasNext',
] as const

export const PAGE_RECORDS_FIELD = 'records'

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

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

export function readPageMapFieldMappings(raw: unknown): PageMapFieldMapping[] {
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
    fieldMappings: readPageMapFieldMappings(data.fieldMappings),
  }
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

/** 将源分页或数组映射到目标分页对象并写回 scope */
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

