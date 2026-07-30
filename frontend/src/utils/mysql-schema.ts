import type {
  MysqlColumnDef,
  MysqlIndexDef,
  MysqlTableSchemaFile,
} from '../types/mysql'

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

/** 比较两边表结构是否一致（忽略 resource / logicDelete / originalName） */
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

/** 是否可用于逻辑删除的数字列类型 */
export function isMysqlNumericColumnType(mysqlType: string): boolean {
  const t = mysqlType.trim().toLowerCase()
  if (!t) return false
  return (
    /^(tiny|small|medium|big)?int\b/.test(t) ||
    /^integer\b/.test(t) ||
    /^bigint\b/.test(t) ||
    /^float\b/.test(t) ||
    /^double\b/.test(t) ||
    /^real\b/.test(t) ||
    /^decimal\b/.test(t) ||
    /^numeric\b/.test(t) ||
    /^dec\b/.test(t) ||
    /^bit\b/.test(t) ||
    /^year\b/.test(t) ||
    t === 'bool' ||
    t === 'boolean'
  )
}

/** 默认二级索引名 */
export function secondaryIndexName(columnNames: string | string[]): string {
  const cols = Array.isArray(columnNames) ? columnNames : [columnNames]
  return `idx_${cols.filter(Boolean).join('_')}`
}

/** 逻辑删除是否可选 */
export function canSetLogicDelete(
  col: MysqlColumnDef,
  indexes?: MysqlIndexDef[],
): boolean {
  if (col.primaryKey) return false
  if (col.name.trim().toLowerCase() === 'id') return false
  if (indexes?.some((i) => i.columns.includes(col.name))) return false
  return isMysqlNumericColumnType(col.type)
}

/** 可作为索引列的候选（非主键、非逻辑删） */
export function indexableColumnNames(
  columns: MysqlColumnDef[],
): string[] {
  return columns
    .filter((c) => c.name.trim() && !c.primaryKey && !c.logicDelete)
    .map((c) => c.name.trim())
}

/**
 * 合并本地元数据（resource / logicDelete）到远程列。
 */
export function mergeMysqlResourceFlags(
  remote: MysqlColumnDef[],
  local: MysqlColumnDef[] | null | undefined,
): MysqlColumnDef[] {
  if (!local?.length) {
    return remote.map((c) => ({
      ...c,
      resource: false,
      logicDelete: false,
    }))
  }
  const byName = new Map(
    local.map((c) => [
      c.name,
      {
        resource: Boolean(c.resource),
        logicDelete: Boolean(c.logicDelete),
      },
    ]),
  )
  return remote.map((c) => {
    const meta = byName.get(c.name)
    return {
      ...c,
      resource: meta?.resource ?? false,
      logicDelete: meta?.logicDelete ?? false,
    }
  })
}

export function formatMysqlColumnSummary(col: MysqlColumnDef): string {
  const flags: string[] = []
  if (col.primaryKey) flags.push('PK')
  if (col.autoIncrement) flags.push('AI')
  if (!col.nullable) flags.push('NOT NULL')
  if (col.resource) flags.push('资源')
  if (col.logicDelete) flags.push('逻辑删')
  const flagText = flags.length ? ` [${flags.join(', ')}]` : ''
  const def =
    col.defaultValue.trim() !== '' ? ` default=${col.defaultValue.trim()}` : ''
  const remark = col.comment.trim() ? ` // ${col.comment.trim()}` : ''
  return `${col.name}: ${col.type}${flagText}${def}${remark}`
}

function migrateIndexedColumnsToIndexes(
  columns: MysqlColumnDef[],
  indexes: MysqlIndexDef[],
): { columns: MysqlColumnDef[]; indexes: MysqlIndexDef[] } {
  const nextCols = columns.map((c) => {
    const { indexed: _drop, ...rest } = c
    return rest
  })
  const existingKeys = new Set(
    indexes.map((i) => `${i.name}\0${i.columns.join(',')}`),
  )
  const nextIndexes = [...indexes]
  for (const col of columns) {
    if (!col.indexed || col.primaryKey) continue
    const name = secondaryIndexName(col.name)
    const key = `${name}\0${col.name}`
    if (existingKeys.has(key)) continue
    if (nextIndexes.some((i) => i.name === name)) continue
    nextIndexes.push({ name, columns: [col.name], remark: '' })
    existingKeys.add(key)
  }
  return { columns: nextCols, indexes: nextIndexes }
}

export function normalizeMysqlIndexDef(input: unknown): MysqlIndexDef | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const row = input as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!name) return null
  const colsRaw = Array.isArray(row.columns) ? row.columns : []
  const columns = colsRaw
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter(Boolean)
  if (!columns.length) return null
  return {
    name,
    columns,
    remark: typeof row.remark === 'string' ? row.remark : '',
  }
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
      indexed: Boolean(row.indexed),
      logicDelete: Boolean(row.logicDelete),
    })
  }
  const indexesRaw = Array.isArray(raw.indexes) ? raw.indexes : []
  const indexes: MysqlIndexDef[] = []
  for (const item of indexesRaw) {
    const idx = normalizeMysqlIndexDef(item)
    if (idx) indexes.push(idx)
  }
  const migrated = migrateIndexedColumnsToIndexes(columns, indexes)
  return {
    name,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    columns: migrated.columns,
    indexes: migrated.indexes,
    syncedAt:
      raw.syncedAt == null || raw.syncedAt === ''
        ? null
        : Number(raw.syncedAt) || null,
  }
}
