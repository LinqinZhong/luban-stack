import type {
  DataMethodConfig,
  DataMethodFieldMapping,
  ProcessorMethod,
  ProcessorTypeExpr,
  ServiceProcessor,
} from '../types/backend-services.js'
import { CUSTOM_CONDITION_FIELD } from '../types/backend-services.js'
import type { DataTypeDef, DataTypeLibrary } from '../types/data-types.js'
import type { MysqlDatabaseConfig } from '../types/mysql.js'
import { ProjectError } from './project.js'
import {
  mysqlDatabaseToPayload,
  readMysqlLibrary,
  runMysqlQuery,
} from './mysql.js'
import {
  readBackendServiceLibrary,
  readServiceProcessors,
} from './backend-services.js'
import { readDataTypeLibrary } from './data-types.js'

function findTypeDef(
  library: DataTypeLibrary,
  id: string,
): DataTypeDef | null {
  if (!id) return null
  for (const group of library.groups ?? []) {
    const hit = group.types.find((t) => t.id === id)
    if (hit) return hit
  }
  return null
}

function leafNamedRef(expr: ProcessorTypeExpr): string {
  if (expr.type === 'array') {
    if (expr.itemType === 'array') return expr.itemItemTypeRef || ''
    return expr.itemTypeRef || ''
  }
  return expr.typeRef || ''
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '')}\``
}

function sqlLiteral(value: unknown): string {
  if (value == null) return 'NULL'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
  }
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

function resolveTableName(
  processor: ServiceProcessor,
  library: DataTypeLibrary,
): string {
  const entity = findTypeDef(library, processor.entityRef)
  const table =
    entity?.tableName?.trim() ||
    entity?.name?.trim() ||
    ''
  if (!table) {
    throw new ProjectError('处理器未绑定实体或实体未设置表名', 400)
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new ProjectError(`表名不合法：${table}`, 400)
  }
  return table
}

function pickPageMeta(
  params: Record<string, unknown>,
  pageParam: string,
): { current: number; pageSize: number; enabled: boolean } {
  const key = pageParam.trim()
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

function buildQuerySql(
  table: string,
  config: DataMethodConfig,
  params: Record<string, unknown>,
): { sql: string; current: number; pageSize: number; paginated: boolean } {
  const fields =
    config.queryFields.length > 0 ? config.queryFields : ['*']
  for (const f of fields) {
    if (f !== '*' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f)) {
      throw new ProjectError(`查询字段不合法：${f}`, 400)
    }
  }
  const cols =
    fields[0] === '*'
      ? '*'
      : fields.map((f) => quoteIdent(f)).join(', ')
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

function buildWhereClause(
  groups: DataMethodConfig['conditionGroups'],
  params: Record<string, unknown>,
): string {
  if (!groups?.length) return ''

  const groupSqls: string[] = []
  for (const group of groups) {
    const parts: string[] = []
    for (const cond of group.conditions ?? []) {
      const colName =
        cond.field === CUSTOM_CONDITION_FIELD || cond.field === ''
          ? cond.customField.trim()
          : cond.field.trim()
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
        const text = raw.trim()
        if (cond.valueKind === 'param') {
          return resolvePath(params, text)
        }
        if (text === '') return undefined
        // 尝试解析 JSON（数字/布尔/数组），否则当字符串
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
      if (v === undefined || v === null || v === '') continue

      if (op === 'eq') parts.push(`${col} = ${sqlLiteral(v)}`)
      else if (op === 'ne') parts.push(`${col} <> ${sqlLiteral(v)}`)
      else if (op === 'gt') parts.push(`${col} > ${sqlLiteral(v)}`)
      else if (op === 'gte') parts.push(`${col} >= ${sqlLiteral(v)}`)
      else if (op === 'lt') parts.push(`${col} < ${sqlLiteral(v)}`)
      else if (op === 'lte') parts.push(`${col} <= ${sqlLiteral(v)}`)
      else if (op === 'like') {
        const s = String(v)
        parts.push(`${col} LIKE ${sqlLiteral(`%${s}%`)}`)
      } else if (op === 'notLike') {
        const s = String(v)
        parts.push(`${col} NOT LIKE ${sqlLiteral(`%${s}%`)}`)
      } else if (op === 'in' || op === 'notIn') {
        const list = Array.isArray(v)
          ? v
          : String(v)
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
        if (!list.length) continue
        const inner = list.map((x) => sqlLiteral(x)).join(', ')
        parts.push(
          op === 'in' ? `${col} IN (${inner})` : `${col} NOT IN (${inner})`,
        )
      }
    }
    if (parts.length) {
      groupSqls.push(parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`)
    }
  }
  if (!groupSqls.length) return ''
  if (groupSqls.length === 1) return ` WHERE ${groupSqls[0]}`
  return ` WHERE ${groupSqls.join(' OR ')}`
}

/**
 * 自定义 SQL：对齐 MyBatis 常用写法
 * - #{name}       → 安全字面量（带引号）
 * - ${name}       → 直接拼接
 * - {TABLE_NAME} / ${TABLE_NAME} → 绑定实体表名（反引号）
 * - <if test="...">...</if> → 动态片段
 */
function applyCustomSql(
  template: string,
  params: Record<string, unknown>,
  tableName: string,
): string {
  const tableIdent = quoteIdent(tableName)
  let sql = applyMybatisIfTags(template, params)

  // 表名：{TABLE_NAME} 与 MyBatis ${TABLE_NAME}
  sql = sql.replace(/\$\{\s*TABLE_NAME\s*\}/gi, tableIdent)
  sql = sql.replace(/\{\s*TABLE_NAME\s*\}/gi, tableIdent)

  // #{name} / #{a.b} → 安全字面量
  sql = sql.replace(
    /#\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}/g,
    (_, key: string) => sqlLiteral(resolveParamValue(params, key)),
  )

  // ${name} → 直接拼接
  sql = sql.replace(/\$\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}/g, (_, key: string) => {
    if (key.toUpperCase() === 'TABLE_NAME') return tableIdent
    const v = resolveParamValue(params, key)
    return v == null ? '' : String(v)
  })

  return sql
}

function resolveParamValue(
  params: Record<string, unknown>,
  key: string,
): unknown {
  if (key.includes('.')) return resolvePath(params, key)
  return params[key]
}

/** 简易 MyBatis <if test>：支持 null/空串比较与 and/or */
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

function evalMybatisIfTest(
  test: string,
  params: Record<string, unknown>,
): boolean {
  if (!test) return false
  // 支持 and / or 与 && / ||（MyBatis OGNL 常见写法）
  const orParts = test.split(/\s*(?:\|\||\bor\b)\s*/i)
  return orParts.some((orPart) =>
    orPart
      .split(/\s*(?:&&|\band\b)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .every((atom) => evalMybatisIfAtom(atom, params)),
  )
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
  const nameOnly = atom.match(/^([A-Za-z_][A-Za-z0-9_.]*)$/)
  if (nameOnly) {
    const val = resolveParamValue(params, nameOnly[1]!)
    return val != null && val !== '' && val !== false
  }
  return false
}

/** 解析入参路径：data / data.name */
function resolvePath(params: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return undefined
  let cur: unknown = params
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) {
      return undefined
    }
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function activeInsertMappings(
  mappings: DataMethodFieldMapping[],
): DataMethodFieldMapping[] {
  return mappings
    .map((m) => ({
      field: m.field.trim(),
      column: m.column.trim(),
    }))
    .filter((m) => m.field && m.column && /^[A-Za-z_][A-Za-z0-9_]*$/.test(m.field))
}

function buildInsertSql(
  table: string,
  mappings: DataMethodFieldMapping[],
  params: Record<string, unknown>,
): string {
  const list = activeInsertMappings(mappings)
  if (!list.length) {
    throw new ProjectError('请先配置插入字段映射', 400)
  }
  const cols = list.map((m) => quoteIdent(m.field))
  const values = list.map((m) => sqlLiteral(resolvePath(params, m.column)))
  return `INSERT INTO ${quoteIdent(table)} (${cols.join(', ')}) VALUES (${values.join(', ')})`
}

function buildDeleteSql(
  table: string,
  config: DataMethodConfig,
  params: Record<string, unknown>,
): string {
  const where = buildWhereClause(config.conditionGroups, params)
  if (!where) {
    throw new ProjectError('删除操作必须配置有效的查询条件', 400)
  }
  return `DELETE FROM ${quoteIdent(table)}${where}`
}

function buildBatchInsertSql(
  table: string,
  mappings: DataMethodFieldMapping[],
  params: Record<string, unknown>,
  batchSourceParam: string,
): string {
  const list = activeInsertMappings(mappings)
  if (!list.length) {
    throw new ProjectError('请先配置批量插入字段映射', 400)
  }

  const configured = batchSourceParam.trim()
  // 源路径形如 items.name → 数组参数名 items；优先使用显式配置的源数组
  const roots = new Set(
    list.map((m) => m.column.split('.')[0]!.trim()).filter(Boolean),
  )
  if (configured) {
    if ([...roots].some((r) => r !== configured)) {
      throw new ProjectError(
        `批量插入源字段须来自源数组「${configured}」`,
        400,
      )
    }
  } else if (roots.size !== 1) {
    throw new ProjectError('请先选择批量插入的源数组', 400)
  }
  const arrayName = configured || [...roots][0]!
  const arr = params[arrayName]
  if (!Array.isArray(arr) || !arr.length) {
    throw new ProjectError(`入参「${arrayName}」需为非空数组`, 400)
  }

  const cols = list.map((m) => quoteIdent(m.field))
  const valueRows = arr.map((item, index) => {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ProjectError(
        `入参「${arrayName}[${index}]」需为对象`,
        400,
      )
    }
    const row = item as Record<string, unknown>
    const vals = list.map((m) => {
      const parts = m.column.split('.')
      const fieldName = parts.slice(1).join('.')
      if (!fieldName) {
        // 源为整个数组元素（标量数组）
        return sqlLiteral(item)
      }
      return sqlLiteral(resolvePath(row, fieldName))
    })
    return `(${vals.join(', ')})`
  })

  return `INSERT INTO ${quoteIdent(table)} (${cols.join(', ')}) VALUES ${valueRows.join(', ')}`
}

/** 批量插入出参：按出参类型回显全部自增 id */
function wrapBatchInsertOutput(
  method: ProcessorMethod,
  insertIds: number[],
  affectedRows: number,
): unknown {
  const expr = method.output
  if (expr.type === 'array') {
    const item = expr.itemType || 'number'
    if (item === 'string') return insertIds.map(String)
    if (item === 'boolean') return insertIds.map(() => true)
    return insertIds
  }
  if (expr.type === 'string') {
    return insertIds.join(',')
  }
  if (expr.type === 'number') {
    return insertIds[0] ?? 0
  }
  if (expr.type === 'boolean') {
    return affectedRows > 0
  }
  // 对象 / 具名类型：一并带回 insertIds
  return {
    affectedRows,
    insertId: insertIds[0] ?? 0,
    insertIds,
  }
}

function wrapOutput(
  method: ProcessorMethod,
  library: DataTypeLibrary,
  rows: Record<string, unknown>[],
  meta: { current: number; pageSize: number; total: number },
): unknown {
  const named = leafNamedRef(method.output)
  const def = findTypeDef(library, named)
  const mappings = (method.dataConfig?.fieldMappings ?? [])
    .map((m) => ({
      field: m.field.trim(),
      column: m.column.trim(),
    }))
    .filter((m) => m.field && m.column)
  const operation = method.dataConfig?.operation

  // 查询：按出参类型包装行集（非数组空结果为 null）
  if (operation === 'query') {
    if (method.output.type === 'array') {
      return rows
    }
    if (def?.kind === 'interface') {
      const hasRecords = def.fields.some((f) => f.name === 'records')
      if (hasRecords) {
        return {
          current: meta.current,
          pageSize: meta.pageSize,
          hasNext: meta.current * meta.pageSize < meta.total,
          total: meta.total,
          records: rows,
        }
      }
    }
    if (method.output.type === 'number' && !named) {
      return meta.total
    }
    if (method.output.type === 'boolean' && !named) {
      return meta.total > 0
    }
    if (method.output.type === 'string' && !named) {
      const single = rows.length ? rows[0] : null
      return JSON.stringify(single)
    }
    // 对象 / 具名类型：单条或 null，不出数组
    return rows.length ? rows[0]! : null
  }

  // 标量出参：按字段映射取列，或取首行首列
  const scalarTypes = new Set(['number', 'string', 'boolean'])
  if (scalarTypes.has(method.output.type) && !named) {
    const row = rows[0] ?? {}
    const mapped = mappings.find((m) => m.field === 'value')
    let raw: unknown
    if (mapped) {
      raw = row[mapped.column]
    } else {
      const keys = Object.keys(row)
      raw = keys.length ? row[keys[0]!] : undefined
    }
    if (method.output.type === 'number') {
      const n = Number(raw)
      return Number.isFinite(n) ? n : 0
    }
    if (method.output.type === 'boolean') {
      return Boolean(raw) && raw !== 0 && raw !== '0'
    }
    return raw == null ? '' : String(raw)
  }

  // 接口出参 + 自定义字段映射：按映射组装对象
  if (def?.kind === 'interface' && mappings.length && operation === 'custom') {
    const hasRecords = def.fields.some((f) => f.name === 'records')
    if (!hasRecords) {
      const row = rows[0] ?? {}
      const obj: Record<string, unknown> = {}
      for (const m of mappings) {
        obj[m.field] = row[m.column]
      }
      return obj
    }
  }

  if (method.output.type === 'array') {
    return rows
  }

  if (def?.kind === 'interface') {
    const hasRecords = def.fields.some((f) => f.name === 'records')
    if (hasRecords) {
      return {
        current: meta.current,
        pageSize: meta.pageSize,
        hasNext: meta.current * meta.pageSize < meta.total,
        total: meta.total,
        records: rows,
      }
    }
  }

  return rows.length ? rows[0]! : null
}

export type DataMethodDebugResult = {
  sql: string
  raw: unknown
  output: unknown
  /** 试运行：事务已回滚，未真正落库 */
  dryRun?: boolean
}

export async function debugDataLayerMethod(payload: {
  projectPath: string
  serviceId: string
  processorId: string
  methodId: string
  params?: Record<string, unknown>
  /** 默认 true：写入在事务中执行后回滚 */
  dryRun?: boolean
}): Promise<DataMethodDebugResult> {
  const { projectPath, serviceId, processorId, methodId } = payload
  const params = payload.params ?? {}
  const dryRun = payload.dryRun !== false

  const processors = await readServiceProcessors(projectPath, serviceId, 'data')
  const processor = processors.find((p) => p.id === processorId)
  if (!processor) throw new ProjectError('处理器不存在', 404)
  const method = processor.methods.find((m) => m.id === methodId)
  if (!method) throw new ProjectError('方法不存在', 404)

  const config = method.dataConfig
  if (config.source !== 'mysql') {
    throw new ProjectError('当前仅支持 MySQL 调试', 400)
  }

  const [services, mysqlLib, typeLib] = await Promise.all([
    readBackendServiceLibrary(projectPath),
    readMysqlLibrary(projectPath),
    readDataTypeLibrary(projectPath),
  ])
  const service = services.services.find((s) => s.id === serviceId)
  if (!service) throw new ProjectError('服务不存在', 404)
  const mysqlId = service.testMysqlId?.trim()
  if (!mysqlId) {
    throw new ProjectError('请先在服务配置中绑定测试环境 MySQL', 400)
  }
  const db = mysqlLib.databases.find((d) => d.id === mysqlId) as
    | MysqlDatabaseConfig
    | undefined
  if (!db) throw new ProjectError('测试环境 MySQL 配置不存在', 400)

  const table = resolveTableName(processor, typeLib)
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
  } else if (config.operation === 'custom') {
    if (!config.sql.trim()) throw new ProjectError('请先配置自定义 SQL', 400)
    sql = applyCustomSql(config.sql, params, table)
  } else {
    throw new ProjectError(
      `操作「${config.operation}」调试稍后实现，请先使用查询、插入、删除或自定义`,
      400,
    )
  }

  // 写入默认走事务回滚；查询试运行无副作用，仍可包一层便于统一
  const useDryRun = dryRun && (isWrite || config.operation === 'custom')
  const connPayload = mysqlDatabaseToPayload(db)
  const exec = await runMysqlQuery(connPayload, sql, { dryRun: useDryRun })

  if (isWrite) {
    const base = exec.meta ?? { affectedRows: 0, insertId: 0 }
    const affectedRows = Number(base.affectedRows ?? 0) || 0
    const insertId = Number(base.insertId ?? 0) || 0
    /** MySQL 多行 INSERT 只返回首个自增 id，按连续自增推算全部 id */
    const insertIds =
      config.operation === 'batchInsert' && insertId > 0 && affectedRows > 0
        ? Array.from({ length: affectedRows }, (_, i) => insertId + i)
        : insertId > 0
          ? [insertId]
          : []
    const raw = {
      affectedRows,
      insertId,
      insertIds,
      ...(useDryRun ? { dryRun: true } : {}),
    }

    let output: unknown = raw
    if (config.operation === 'batchInsert') {
      output = wrapBatchInsertOutput(method, insertIds, affectedRows)
    } else if (config.operation === 'delete') {
      if (method.output.type === 'string') {
        output = String(affectedRows)
      } else if (method.output.type === 'number') {
        output = affectedRows
      } else if (method.output.type === 'boolean') {
        output = affectedRows > 0
      }
    } else if (method.output.type === 'string') {
      output = String(insertId || '')
    } else if (method.output.type === 'number') {
      output = insertId
    } else if (method.output.type === 'boolean') {
      output = affectedRows > 0
    }
    return { sql, raw, output, dryRun: useDryRun }
  }

  const rows = exec.rows
  let total = rows.length
  if (config.operation === 'query' && paginated) {
    if (rows.length < pageSize) {
      total = (current - 1) * pageSize + rows.length
    } else {
      try {
        const countSql = `SELECT COUNT(*) AS cnt FROM ${quoteIdent(table)}`
        const countRes = await runMysqlQuery(connPayload, countSql)
        total = Number(countRes.rows[0]?.cnt ?? rows.length) || rows.length
      } catch {
        total = (current - 1) * pageSize + rows.length
      }
    }
  }

  const output = wrapOutput(method, typeLib, rows, {
    current,
    pageSize,
    total,
  })

  return {
    sql,
    raw: rows,
    output,
    dryRun: useDryRun,
  }
}
