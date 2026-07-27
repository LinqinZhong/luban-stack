import type { MysqlColumnDef, MysqlTableSchemaFile } from '../types/mysql'

function normType(type: string): string {
  return type.trim().toLowerCase().replace(/\s+/g, '')
}

function structuralKey(col: MysqlColumnDef): string {
  return [
    col.name.trim(),
    normType(col.type),
    col.nullable ? '1' : '0',
    col.primaryKey ? '1' : '0',
    col.autoIncrement ? '1' : '0',
    (col.defaultValue ?? '').trim(),
    (col.comment ?? '').trim(),
  ].join('\0')
}

/** 比较两边表结构是否一致（忽略 resource / originalName） */
export function mysqlSchemasStructurallyEqual(
  a: MysqlColumnDef[] | null | undefined,
  b: MysqlColumnDef[] | null | undefined,
): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (structuralKey(left[i]!) !== structuralKey(right[i]!)) return false
  }
  return true
}

/** 把本地 resource 标记按列名合并到远程列上 */
export function mergeMysqlResourceFlags(
  remote: MysqlColumnDef[],
  local: MysqlColumnDef[] | null | undefined,
): MysqlColumnDef[] {
  if (!local?.length) {
    return remote.map((c) => ({ ...c, resource: false }))
  }
  const byName = new Map(local.map((c) => [c.name, Boolean(c.resource)]))
  return remote.map((c) => ({
    ...c,
    resource: byName.get(c.name) ?? false,
  }))
}

export function formatMysqlColumnSummary(col: MysqlColumnDef): string {
  const flags: string[] = []
  if (col.primaryKey) flags.push('PK')
  if (col.autoIncrement) flags.push('AI')
  if (!col.nullable) flags.push('NOT NULL')
  if (col.resource) flags.push('资源')
  const flagText = flags.length ? ` [${flags.join(', ')}]` : ''
  const def =
    col.defaultValue.trim() !== '' ? ` default=${col.defaultValue.trim()}` : ''
  const remark = col.comment.trim() ? ` // ${col.comment.trim()}` : ''
  return `${col.name}: ${col.type}${flagText}${def}${remark}`
}

export function normalizeMysqlTableSchemaFile(
  input: unknown,
  fallbackName = '',
): MysqlTableSchemaFile | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : fallbackName.trim()
  if (!name) return null
  const columnsRaw = Array.isArray(raw.columns) ? raw.columns : []
  const columns: MysqlColumnDef[] = []
  for (const item of columnsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const colName = typeof row.name === 'string' ? row.name.trim() : ''
    const type = typeof row.type === 'string' ? row.type.trim() : ''
    if (!colName || !type) continue
    columns.push({
      name: colName,
      type,
      nullable: Boolean(row.nullable),
      primaryKey: Boolean(row.primaryKey),
      autoIncrement: Boolean(row.autoIncrement),
      defaultValue: typeof row.defaultValue === 'string' ? row.defaultValue : '',
      comment: typeof row.comment === 'string' ? row.comment : '',
      resource: Boolean(row.resource),
    })
  }
  return {
    name,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    columns,
    syncedAt:
      raw.syncedAt == null || raw.syncedAt === ''
        ? null
        : Number(raw.syncedAt) || null,
  }
}
