import { queryRows } from './db'

export type DataMethodCondition = {
  id?: string
  field: string
  customField: string
  op: string
  valueKind: string
  value: string
  valueTo: string
}

export type DataMethodConfig = {
  source: string
  operation: string
  queryFields: string[]
  sql: string
  fieldMappings: Array<{ field: string; column: string }>
  batchSourceParam: string
  pageParam: string
  conditionGroups: Array<{ id?: string; conditions: DataMethodCondition[] }>
}

export type DataMethodOutputMeta = {
  type: string
  typeRef: string
  itemType: string
  itemTypeRef: string
  keyType?: string
}

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '') + '`'
}

/** entity 小驼峰 → 表列下划线 */
function camelToSnake(name: string): string {
  const raw = String(name || '').trim()
  if (!raw) return raw
  if (!/[A-Z]/.test(raw)) return raw
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function snakeToCamel(name: string): string {
  const raw = String(name || '').trim()
  if (!raw || !raw.includes('_')) return raw
  return raw.replace(/_([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase())
}

function mapRowKeysToCamel(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[snakeToCamel(key)] = value
  }
  return out
}

function sqlLiteral(value: unknown): string {
  if (value == null) return 'NULL'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'object') {
    return (
      "'" +
      JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "''") +
      "'"
    )
  }
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'"
}

function resolvePath(
  params: Record<string, unknown>,
  pathExpr: string,
): unknown {
  const parts = pathExpr
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
  let cur: unknown = params
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) {
      return undefined
    }
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function pickPageMeta(
  params: Record<string, unknown>,
  pageParam: string,
) {
  const key = (pageParam || '').trim()
  if (!key) {
    return { current: 1, pageSize: 10, enabled: false }
  }
  const resolved = resolvePath(params, key)
  const src =
    resolved && typeof resolved === 'object' && !Array.isArray(resolved)
      ? (resolved as Record<string, unknown>)
      : null
  if (!src) {
    return { current: 1, pageSize: 10, enabled: true }
  }
  const current = Math.max(1, Number(src.current ?? src.page ?? 1) || 1)
  const pageSize = Math.max(
    1,
    Math.min(200, Number(src.pageSize ?? src.size ?? 10) || 10),
  )
  return { current, pageSize, enabled: true }
}

function buildWhereClause(
  groups: DataMethodConfig['conditionGroups'],
  params: Record<string, unknown>,
): string {
  if (!groups?.length) return ''
  const groupSqls: string[] = []
  for (const group of groups) {
    const parts: string[] = []
    for (const cond of group.conditions ?? []) {
      const colNameRaw =
        !cond.field || cond.field === '__custom__'
          ? (cond.customField || '').trim()
          : cond.field.trim()
      const colName =
        !cond.field || cond.field === '__custom__'
          ? colNameRaw
          : camelToSnake(colNameRaw)
      if (!colName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(colName)) continue
      const col = quoteIdent(colName)
      const op = cond.op
      if (op === 'isNull') {
        parts.push(`${col} IS NULL`)
        continue
      }
      if (op === 'isNotNull') {
        parts.push(`${col} IS NOT NULL`)
        continue
      }
      const resolveVal = (raw: string): unknown => {
        const text = (raw || '').trim()
        if (cond.valueKind === 'param') return resolvePath(params, text)
        if (!text) return undefined
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
      const v = resolveVal(cond.value ?? '')
      if (op === 'between') {
        const v2 = resolveVal(cond.valueTo ?? '')
        if (v === undefined || v2 === undefined) continue
        parts.push(`${col} BETWEEN ${sqlLiteral(v)} AND ${sqlLiteral(v2)}`)
        continue
      }
      // 属于 / 不属于：空数组或未传参时不能丢掉条件（否则变成全表扫描）
      if (op === 'in' || op === 'notIn') {
        const list = Array.isArray(v)
          ? v
          : v === undefined || v === null || v === ''
            ? []
            : String(v)
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
        if (!list.length) {
          parts.push(op === 'in' ? '0=1' : '1=1')
        } else {
          const inner = list.map((x) => sqlLiteral(x)).join(', ')
          parts.push(
            op === 'in' ? `${col} IN (${inner})` : `${col} NOT IN (${inner})`,
          )
        }
        continue
      }
      if (v === undefined || v === null || v === '') continue
      if (op === 'eq') parts.push(`${col} = ${sqlLiteral(v)}`)
      else if (op === 'ne') parts.push(`${col} <> ${sqlLiteral(v)}`)
      else if (op === 'gt') parts.push(`${col} > ${sqlLiteral(v)}`)
      else if (op === 'gte') parts.push(`${col} >= ${sqlLiteral(v)}`)
      else if (op === 'lt') parts.push(`${col} < ${sqlLiteral(v)}`)
      else if (op === 'lte') parts.push(`${col} <= ${sqlLiteral(v)}`)
      else if (op === 'like') {
        parts.push(`${col} LIKE ${sqlLiteral(`%${String(v)}%`)}`)
      } else if (op === 'notLike') {
        parts.push(`${col} NOT LIKE ${sqlLiteral(`%${String(v)}%`)}`)
      }
    }
    if (parts.length) {
      groupSqls.push(
        parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`,
      )
    }
  }
  if (!groupSqls.length) return ''
  if (groupSqls.length === 1) return ` WHERE ${groupSqls[0]}`
  return ` WHERE ${groupSqls.join(' OR ')}`
}

function resolveParamValue(
  params: Record<string, unknown>,
  key: string,
): unknown {
  if (key.includes('.')) return resolvePath(params, key)
  return params[key]
}

function evalMybatisIfAtom(
  atom: string,
  params: Record<string, unknown>,
): boolean {
  const cmp = atom.match(
    /^([A-Za-z_][A-Za-z0-9_.]*)\s*(!=|==)\s*(null|''|"")\s*$/i,
  )
  if (cmp) {
    const val = resolveParamValue(params, cmp[1]!)
    const op = cmp[2]!
    const rhs = cmp[3]!.toLowerCase()
    if (rhs === 'null') {
      const isNull = val == null
      return op === '!=' ? !isNull : isNull
    }
    const empty = val == null || String(val) === ''
    return op === '!=' ? !empty : empty
  }
  const litCmp = atom.match(
    /^([A-Za-z_][A-Za-z0-9_.]*)\s*(!=|==)\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))\s*$/,
  )
  if (litCmp) {
    const val = resolveParamValue(params, litCmp[1]!)
    const op = litCmp[2]!
    const rhsStr = litCmp[3] ?? litCmp[4]
    const rhsNum = litCmp[5]
    let eq: boolean
    if (rhsNum != null) {
      eq = Number(val) === Number(rhsNum)
    } else {
      eq = String(val ?? '') === String(rhsStr ?? '')
    }
    return op === '!=' ? !eq : eq
  }
  const nameOnly = atom.match(/^([A-Za-z_][A-Za-z0-9_.]*)$/)
  if (nameOnly) {
    const val = resolveParamValue(params, nameOnly[1]!)
    return val != null && val !== '' && val !== false
  }
  return false
}

function evalMybatisIfTest(
  test: string,
  params: Record<string, unknown>,
): boolean {
  if (!test) return false
  const orParts = test.split(/\s*(?:\|\||\bor\b)\s*/i)
  return orParts.some((orPart) =>
    orPart
      .split(/\s*(?:&&|\band\b)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .every((atom) => evalMybatisIfAtom(atom, params)),
  )
}

function applyMybatisIfTags(
  sql: string,
  params: Record<string, unknown>,
): string {
  const re = /<if\s+test\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/if>/gi
  let prev = ''
  let cur = sql
  let guard = 0
  while (prev !== cur && guard < 32) {
    prev = cur
    guard += 1
    cur = cur.replace(re, (_m, test: string, body: string) =>
      evalMybatisIfTest(String(test).trim(), params) ? body : '',
    )
  }
  return cur
}

function applyCustomSql(
  template: string,
  params: Record<string, unknown>,
  tableName: string,
): string {
  const tableIdent = quoteIdent(tableName)
  let sql = applyMybatisIfTags(template, params)
  sql = sql.replace(/\$\{\s*TABLE_NAME\s*\}/gi, tableIdent)
  sql = sql.replace(/\{\s*TABLE_NAME\s*\}/gi, tableIdent)
  sql = sql.replace(
    /#\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}/g,
    (_m, key: string) => sqlLiteral(resolveParamValue(params, key)),
  )
  sql = sql.replace(
    /\$\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}/g,
    (_m, key: string) => {
      if (String(key).toUpperCase() === 'TABLE_NAME') return tableIdent
      const v = resolveParamValue(params, key)
      return v == null ? '' : String(v)
    },
  )
  return sql
}

function buildQuerySql(
  table: string,
  config: DataMethodConfig,
  params: Record<string, unknown>,
) {
  const fields = config.queryFields?.length ? config.queryFields : ['*']
  const cols =
    fields[0] === '*'
      ? '*'
      : fields
          .map((f) => {
            const col = camelToSnake(f)
            if (col === f) return quoteIdent(f)
            return `${quoteIdent(col)} AS ${quoteIdent(f)}`
          })
          .join(', ')
  const page = pickPageMeta(params, config.pageParam ?? '')
  const where = buildWhereClause(config.conditionGroups, params)
  let sql = `SELECT ${cols} FROM ${quoteIdent(table)}${where}`
  if (page.enabled) {
    const offset = (page.current - 1) * page.pageSize
    sql += ` LIMIT ${page.pageSize} OFFSET ${offset}`
  }
  return {
    sql,
    current: page.current,
    pageSize: page.pageSize,
    paginated: page.enabled,
  }
}

function buildInsertSql(
  table: string,
  mappings: DataMethodConfig['fieldMappings'],
  params: Record<string, unknown>,
) {
  const list = (mappings || [])
    .map((m) => ({ field: m.field.trim(), column: m.column.trim() }))
    .filter((m) => m.field && m.column)
  if (!list.length) throw new Error('请先配置插入字段映射')
  const cols = list.map((m) => quoteIdent(camelToSnake(m.field)))
  const values = list.map((m) => sqlLiteral(resolvePath(params, m.column)))
  return `INSERT INTO ${quoteIdent(table)} (${cols.join(', ')}) VALUES (${values.join(', ')})`
}

function buildDeleteSql(
  table: string,
  config: DataMethodConfig,
  params: Record<string, unknown>,
) {
  const where = buildWhereClause(config.conditionGroups, params)
  if (!where) throw new Error('删除操作必须配置有效的查询条件')
  return `DELETE FROM ${quoteIdent(table)}${where}`
}

function buildUpdateSql(
  table: string,
  config: DataMethodConfig,
  params: Record<string, unknown>,
) {
  const list = (config.fieldMappings || [])
    .map((m) => ({ field: m.field.trim(), column: m.column.trim() }))
    .filter((m) => m.field && m.column)
  if (!list.length) throw new Error('请先配置修改字段映射')
  const sets = list.map(
    (m) =>
      `${quoteIdent(camelToSnake(m.field))} = ${sqlLiteral(resolvePath(params, m.column))}`,
  )
  const where = buildWhereClause(config.conditionGroups, params)
  if (!where) throw new Error('修改操作必须配置有效的查询条件')
  return `UPDATE ${quoteIdent(table)} SET ${sets.join(', ')}${where}`
}

function isCustomWriteSql(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)
}

function buildBatchInsertSql(
  table: string,
  mappings: DataMethodConfig['fieldMappings'],
  params: Record<string, unknown>,
  batchSourceParam: string,
) {
  const list = (mappings || [])
    .map((m) => ({ field: m.field.trim(), column: m.column.trim() }))
    .filter((m) => m.field && m.column)
  if (!list.length) throw new Error('请先配置批量插入字段映射')
  const configured = (batchSourceParam || '').trim()
  const roots = new Set(
    list.map((m) => m.column.split('.')[0]!.trim()).filter(Boolean),
  )
  const arrayName = configured || [...roots][0]
  if (!arrayName) throw new Error('请先选择批量插入的源数组')
  const arr = params[arrayName]
  if (!Array.isArray(arr) || !arr.length) {
    throw new Error(`入参「${arrayName}」需为非空数组`)
  }
  const cols = list.map((m) => quoteIdent(camelToSnake(m.field)))
  const valueRows = arr.map((item) => {
    const row = item as Record<string, unknown>
    const vals = list.map((m) => {
      const parts = m.column.split('.')
      const fieldName = parts.slice(1).join('.')
      if (!fieldName) return sqlLiteral(item)
      return sqlLiteral(resolvePath(row, fieldName))
    })
    return `(${vals.join(', ')})`
  })
  return `INSERT INTO ${quoteIdent(table)} (${cols.join(', ')}) VALUES ${valueRows.join(', ')}`
}

function wrapOutput(
  output: DataMethodOutputMeta,
  config: DataMethodConfig,
  rows: Record<string, unknown>[],
  meta: { current: number; pageSize: number; total: number },
): unknown {
  const mappings = (config.fieldMappings || [])
    .map((m) => ({ field: m.field.trim(), column: m.column.trim() }))
    .filter((m) => m.field && m.column)
  const named = (output.typeRef || '').trim()
  const scalar = new Set(['number', 'string', 'boolean'])

  // 查询：按出参包装；自定义 SELECT 仅数组/映射走此分支（标量走下方字段映射）
  if (config.operation === 'query' || config.operation === 'custom') {
    if (output.type === 'array') return rows
    if (output.type === 'map') {
      const keyMap = mappings.find((m) => m.field === 'key')
      if (!keyMap) return new Map()
      const valueMaps = mappings.filter((m) => m.field !== 'key')
      const valueIsArray = output.itemType === 'array'
      const keyIsNumber = output.keyType === 'number'
      const out = new Map<string | number, unknown>()
      for (const row of rows) {
        const rawKey = row[keyMap.column]
        if (rawKey == null || rawKey === '') continue
        const key: string | number = keyIsNumber
          ? Number(rawKey)
          : String(rawKey)
        if (keyIsNumber && Number.isNaN(key)) continue
        let entry: unknown
        if (valueMaps.length === 1 && valueMaps[0]!.field === 'value') {
          entry = row[valueMaps[0]!.column]
        } else {
          const obj: Record<string, unknown> = {}
          for (const m of valueMaps) {
            obj[m.field] = row[m.column]
          }
          entry = obj
        }
        if (valueIsArray) {
          const list = (out.get(key) as unknown[] | undefined) ?? []
          list.push(entry)
          out.set(key, list)
        } else {
          out.set(key, entry)
        }
      }
      return out
    }
    if (config.operation === 'custom') {
      // 自定义标量：交给下方 fieldMappings
    } else {
      if (output.type === 'number' && !named) return meta.total
      if (output.type === 'boolean' && !named) return meta.total > 0
      if (output.type === 'string' && !named) {
        const single = rows.length ? rows[0] : null
        return JSON.stringify(single)
      }
      return rows.length ? rows[0]! : null
    }
  }

  if (scalar.has(output.type) && !named) {
    const row = rows[0] ?? {}
    const mapped = mappings.find((m) => m.field === 'value')
    let raw: unknown
    if (mapped) raw = row[mapped.column]
    else {
      const keys = Object.keys(row)
      raw = keys.length ? row[keys[0]!] : undefined
    }
    if (output.type === 'number') {
      const n = Number(raw)
      return Number.isFinite(n) ? n : 0
    }
    if (output.type === 'boolean') {
      return Boolean(raw) && raw !== 0 && raw !== '0'
    }
    return raw == null ? '' : String(raw)
  }

  if (output.type === 'array') return rows
  return rows.length ? rows[0]! : null
}

export async function runDataMethod(options: {
  table: string
  config: DataMethodConfig
  params: Record<string, unknown>
  output: DataMethodOutputMeta
  dryRun?: boolean
}): Promise<unknown> {
  const { table, config, params, output } = options
  let sql = ''
  let current = 1
  let pageSize = 10
  let paginated = false
  let isWrite = false

  if (config.operation === 'query') {
    const built = buildQuerySql(table, config, params)
    sql = built.sql
    current = built.current
    pageSize = built.pageSize
    paginated = built.paginated
  } else if (config.operation === 'insert') {
    sql = buildInsertSql(table, config.fieldMappings, params)
    isWrite = true
  } else if (config.operation === 'batchInsert') {
    sql = buildBatchInsertSql(
      table,
      config.fieldMappings,
      params,
      config.batchSourceParam,
    )
    isWrite = true
  } else if (config.operation === 'delete') {
    sql = buildDeleteSql(table, config, params)
    isWrite = true
  } else if (config.operation === 'update') {
    sql = buildUpdateSql(table, config, params)
    isWrite = true
  } else if (config.operation === 'custom') {
    if (!config.sql?.trim()) throw new Error('请先配置自定义 SQL')
    sql = applyCustomSql(config.sql, params, table)
    if (isCustomWriteSql(sql)) {
      isWrite = true
    } else {
      const page = pickPageMeta(params, config.pageParam ?? '')
      if (page.enabled) {
        const offset = (page.current - 1) * page.pageSize
        sql += ` LIMIT ${page.pageSize} OFFSET ${offset}`
        current = page.current
        pageSize = page.pageSize
        paginated = true
      }
    }
  } else {
    throw new Error(`不支持的操作：${config.operation}`)
  }

  const exec = await queryRows(sql)

  if (isWrite) {
    const affectedRows = exec.meta.affectedRows
    const insertId = exec.meta.insertId
    if (config.operation === 'batchInsert') {
      const insertIds =
        insertId > 0 && affectedRows > 0
          ? Array.from({ length: affectedRows }, (_, i) => insertId + i)
          : []
      if (output.type === 'array') return insertIds
      return insertIds[0] ?? 0
    }
    if (
      config.operation === 'delete' ||
      config.operation === 'update' ||
      (config.operation === 'custom' && insertId <= 0)
    ) {
      if (output.type === 'number') return affectedRows
      if (output.type === 'boolean') return affectedRows > 0
      return affectedRows
    }
    if (output.type === 'string') return String(insertId || '')
    if (output.type === 'number') return insertId
    if (output.type === 'boolean') return affectedRows > 0
    return { affectedRows, insertId }
  }

  const rows =
    config.operation === 'query' || (config.operation === 'custom' && !isWrite)
      ? exec.rows.map((row) => mapRowKeysToCamel(row))
      : exec.rows
  let total = rows.length
  if (
    (config.operation === 'query' || config.operation === 'custom') &&
    paginated
  ) {
    if (rows.length < pageSize) {
      total = (current - 1) * pageSize + rows.length
    } else {
      try {
        const countSql = `SELECT COUNT(*) AS cnt FROM ${quoteIdent(table)}`
        const countRes = await queryRows(countSql)
        total = Number(countRes.rows[0]?.cnt ?? rows.length) || rows.length
      } catch {
        total = (current - 1) * pageSize + rows.length
      }
    }
  }

  return wrapOutput(output, config, rows, { current, pageSize, total })
}
