import type {
  DataMethodCondition,
  DataMethodConditionGroup,
  DataMethodConfig,
  ProcessorMethod,
} from '../../../types/backend-services.js'
import { snakeToCamel } from '../../../utils/sql-naming.js'
import { safeIdent } from './names.js'

type TypeOrmImport =
  | 'In'
  | 'Like'
  | 'Between'
  | 'IsNull'
  | 'Not'
  | 'MoreThan'
  | 'MoreThanOrEqual'
  | 'LessThan'
  | 'LessThanOrEqual'

export type CompileMethodResult = {
  body: string
  imports: TypeOrmImport[]
  /** 是否需要从 common/comma-array 引入 coerce 辅助 */
  needsCommaArrayHelper: boolean
  /** 是否需要从 common/sql-builder 引入 SqlBuilder */
  needsSqlBuilder: boolean
}

export type CompileMethodOptions = {
  returnType?: string
  /** 实体/出参中声明为数组、库中为 varchar 的字段 */
  commaArrayFields?: string[]
}

function parseLiteral(raw: string): string {
  const text = (raw || '').trim()
  if (!text) return 'undefined'
  try {
    const v = JSON.parse(text)
    if (typeof v === 'string') return JSON.stringify(v)
    return String(v)
  } catch {
    if (/^-?\d+(\.\d+)?$/.test(text)) return text
    if (text === 'true' || text === 'false') return text
    return JSON.stringify(text)
  }
}

function paramAccess(paramPath: string): string {
  const parts = paramPath
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return 'undefined'
  let expr = safeIdent(parts[0]!, 'param')
  for (let i = 1; i < parts.length; i++) {
    expr += `.${safeIdent(parts[i]!, 'field')}`
  }
  return expr
}

function resolveConditionValue(cond: DataMethodCondition): string {
  if (cond.valueKind === 'param') {
    return paramAccess(cond.value)
  }
  return parseLiteral(cond.value)
}

function resolveConditionValueTo(cond: DataMethodCondition): string {
  if (cond.valueKind === 'param') {
    return paramAccess(cond.valueTo)
  }
  return parseLiteral(cond.valueTo)
}

function conditionFieldName(cond: DataMethodCondition): string {
  if (!cond.field || cond.field === '__custom__') {
    return cond.customField.trim()
  }
  return cond.field.trim()
}

function emitSingleCondition(
  cond: DataMethodCondition,
  imports: Set<TypeOrmImport>,
): string | null {
  const field = conditionFieldName(cond)
  if (!field || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) return null

  const op = cond.op
  if (op === 'isNull') {
    imports.add('IsNull')
    return `${field}: IsNull()`
  }
  if (op === 'isNotNull') {
    imports.add('IsNull')
    imports.add('Not')
    return `${field}: Not(IsNull())`
  }

  const v = resolveConditionValue(cond)
  if (op === 'between') {
    imports.add('Between')
    const v2 = resolveConditionValueTo(cond)
    return `${field}: Between(${v}, ${v2})`
  }
  if (op === 'in' || op === 'notIn') {
    imports.add('In')
    const paramPath = cond.valueKind === 'param' ? cond.value.trim() : ''
    const paramExpr = paramPath ? paramAccess(paramPath) : v
    if (op === 'in') {
      return `${field}: In(${paramExpr})`
    }
    imports.add('Not')
    return `${field}: Not(In(${paramExpr}))`
  }
  if (op === 'like') {
    imports.add('Like')
    return `${field}: Like(\`%\${String(${v})}%\`)`
  }
  if (op === 'notLike') {
    imports.add('Like')
    imports.add('Not')
    return `${field}: Not(Like(\`%\${String(${v})}%\`))`
  }

  if (op === 'eq') return `${field}: ${v}`
  if (op === 'ne') {
    imports.add('Not')
    return `${field}: Not(${v})`
  }
  if (op === 'gt') {
    imports.add('MoreThan')
    return `${field}: MoreThan(${v})`
  }
  if (op === 'gte') {
    imports.add('MoreThanOrEqual')
    return `${field}: MoreThanOrEqual(${v})`
  }
  if (op === 'lt') {
    imports.add('LessThan')
    return `${field}: LessThan(${v})`
  }
  if (op === 'lte') {
    imports.add('LessThanOrEqual')
    return `${field}: LessThanOrEqual(${v})`
  }
  return `${field}: ${v}`
}

function emitWhereObject(
  group: DataMethodConditionGroup,
  imports: Set<TypeOrmImport>,
): string | null {
  const parts: string[] = []
  for (const cond of group.conditions ?? []) {
    const piece = emitSingleCondition(cond, imports)
    if (piece) parts.push(piece)
  }
  if (!parts.length) return null
  return `{ ${parts.join(', ')} }`
}

function emitWhereClause(
  groups: DataMethodConditionGroup[],
  imports: Set<TypeOrmImport>,
): string | null {
  if (!groups?.length) return null
  const objs = groups
    .map((g) => emitWhereObject(g, imports))
    .filter((x): x is string => Boolean(x))
  if (!objs.length) return null
  if (objs.length === 1) return objs[0]!
  return `[${objs.join(', ')}]`
}

function mappingSourceExpr(columnPath: string): string {
  const parts = columnPath
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return 'undefined'
  if (parts.length === 1) return safeIdent(parts[0]!, 'param')
  let expr = safeIdent(parts[0]!, 'param')
  for (let i = 1; i < parts.length; i++) {
    expr += `.${safeIdent(parts[i]!, 'field')}`
  }
  return expr
}

function emitInsertPayload(
  mappings: DataMethodConfig['fieldMappings'],
): string {
  const list = (mappings || [])
    .map((m) => ({
      field: m.field.trim(),
      column: m.column.trim(),
    }))
    .filter((m) => m.field && m.column)
  if (!list.length) return '{}'
  const lines = list.map(
    (m) => `      ${m.field}: ${mappingSourceExpr(m.column)},`,
  )
  return `{\n${lines.join('\n')}\n    }`
}

function outputMeta(method: ProcessorMethod) {
  return {
    type: method.output?.type || 'json',
    typeRef: method.output?.typeRef || '',
    itemType: method.output?.itemType || '',
    itemTypeRef: method.output?.itemTypeRef || '',
    keyType: method.output?.keyType || '',
  }
}

function emptyInGuard(
  method: ProcessorMethod,
  returnType: string,
): string | null {
  const config = method.dataConfig
  for (const group of config.conditionGroups ?? []) {
    for (const cond of group.conditions ?? []) {
      if (cond.op !== 'in' && cond.op !== 'notIn') continue
      if (cond.valueKind !== 'param') continue
      const param = cond.value.trim()
      if (!param || param.includes('.')) continue
      const name = safeIdent(param, 'param')
      const output = outputMeta(method)
      if (output.type === 'map') {
        return `    if (!${name}.length) return new Map() as ${returnType}\n`
      }
      if (output.type === 'array') {
        return `    if (!${name}.length) return []\n`
      }
      if (output.type === 'number') {
        return `    if (!${name}.length) return 0\n`
      }
    }
  }
  return null
}

function wrapMapOutput(
  method: ProcessorMethod,
  rowsVar: string,
  returnType: string,
  commaArrayFields: string[],
): { code: string; needsHelper: boolean } {
  const config = method.dataConfig
  const output = outputMeta(method)
  const mappings = (config.fieldMappings || [])
    .map((m) => ({ field: m.field.trim(), column: m.column.trim() }))
    .filter((m) => m.field && m.column)
  const keyMap = mappings.find((m) => m.field === 'key')
  const valueMaps = mappings.filter((m) => m.field !== 'key')
  const keyIsNumber = output.keyType === 'number'
  const mappedArrayFields = commaArrayFields.filter((f) =>
    valueMaps.some((m) => m.field === f),
  )

  if (!keyMap) {
    return {
      code: `    return new Map() as ${returnType}`,
      needsHelper: false,
    }
  }
  const keyField = keyMap.column === keyMap.field ? keyMap.field : keyMap.column

  const lines: string[] = [
    `    const out = new Map() as ${returnType}`,
    `    for (const row of ${rowsVar}) {`,
  ]

  lines.push(`      const rawKey = row.${keyField}`)
  // 主键可能是 number / string，统一用空串判断避免 TS2367
  lines.push(`      if (rawKey == null || String(rawKey) === '') continue`)
  lines.push(
    `      const key = ${keyIsNumber ? 'Number(rawKey)' : 'String(rawKey)'}`,
  )
  if (keyIsNumber) lines.push(`      if (Number.isNaN(key)) continue`)

  // Map 值类型常为 VO；实体字段可空，需双重断言
  const mapValueType = mapValueTypeFromReturnType(returnType)

  if (valueMaps.length === 1 && valueMaps[0]!.field === 'value') {
    lines.push(
      `      out.set(key, row.${valueMaps[0]!.column} as unknown as ${mapValueType})`,
    )
  } else {
    lines.push(`      const entry = {`)
    for (const m of valueMaps) {
      const src = m.column === m.field ? m.field : m.column
      lines.push(`        ${m.field}: row.${src},`)
    }
    lines.push(`      }`)
    if (mappedArrayFields.length) {
      lines.push(
        `      out.set(key, coerceCommaArrayFields(entry, ${JSON.stringify(mappedArrayFields)}) as unknown as ${mapValueType})`,
      )
    } else {
      lines.push(`      out.set(key, entry as unknown as ${mapValueType})`)
    }
  }

  lines.push(`    }`)
  lines.push(`    return out`)
  return {
    code: lines.join('\n'),
    needsHelper: mappedArrayFields.length > 0,
  }
}

function softDeleteFieldFromSql(sql: string): string | null {
  const match =
    sql.match(/WHERE\s+`([^`]+)`\s*=\s*0\b/i) ||
    sql.match(/AND\s+`([^`]+)`\s*=\s*0\b/i)
  return match?.[1] ? snakeToCamel(match[1]) : null
}

function tryCompilePresetCustom(
  method: ProcessorMethod,
  imports: Set<TypeOrmImport>,
): string | null {
  if (!method.preset) return null
  const config = method.dataConfig
  const sql = config.sql?.trim() || ''
  const name = method.name.trim()

  if (name === 'count') {
    const softField = softDeleteFieldFromSql(sql)
    if (softField) {
      return `    return this.repo.count({ where: { ${softField}: 0 } as any })`
    }
    return `    return this.repo.count()`
  }

  if (name.startsWith('countBy')) {
    const whereParts = (method.params ?? []).map((p) => {
      const field = safeIdent(p.name, 'field')
      return `${field}: ${field}`
    })
    const softField = softDeleteFieldFromSql(sql)
    if (softField) whereParts.push(`${softField}: 0`)
    if (whereParts.length) {
      return `    return this.repo.count({ where: { ${whereParts.join(', ')} } as any })`
    }
  }

  if (name === 'deleteById') {
    const pkParam = method.params?.[0]?.name
    if (!pkParam) return null
    const pk = safeIdent(pkParam, 'id')
    const setMatch = sql.match(/SET\s+`([^`]+)`\s*=\s*1/i)
    const logicField = setMatch?.[1] ? snakeToCamel(setMatch[1]) : 'isDeleted'
    return `    const result = await this.repo.update({ id: ${pk} } as any, { ${logicField}: 1 } as any)
    return result.affected ?? 0`
  }

  if (name === 'hardDeleteById') {
    const where = whereAsAny(emitWhereClause(config.conditionGroups, imports))
    if (where) {
      return `    const result = await this.repo.delete(${where})
    return result.affected ?? 0`
    }
  }

  return null
}

/** 将 find/findOne/findAndCount 的选项拼成对象字面量，避免多余逗号 */
function emitFindOptions(parts: string[]): string {
  if (!parts.length) return '{}'
  return `{\n      ${parts.join(',\n      ')},\n    }`
}

/** where 字面量与实体字段类型常不一致（如 softDelete: 0 vs boolean），放宽断言 */
function whereAsAny(where: string | null): string | null {
  if (!where) return null
  return `${where} as any`
}

/** `Map<K, V>` → V；解析失败时回退 any */
function mapValueTypeFromReturnType(returnType: string): string {
  const m = returnType.match(/^Map\s*<\s*[^,>]+,\s*([\s\S]+)>$/)
  return m?.[1]?.trim() || 'any'
}

function compileQueryMethod(
  method: ProcessorMethod,
  imports: Set<TypeOrmImport>,
  returnType: string,
  commaArrayFields: string[],
): { body: string; needsHelper: boolean } {
  const config = method.dataConfig
  const output = outputMeta(method)
  const guard = emptyInGuard(method, returnType)
  const where = whereAsAny(emitWhereClause(config.conditionGroups, imports))
  const pageParam = (config.pageParam || '').trim()
  const pageExpr = pageParam ? paramAccess(pageParam) : ''
  const fields = (config.queryFields || []).filter(Boolean)

  const baseParts: string[] = []
  if (where) baseParts.push(`where: ${where}`)
  if (fields.length) baseParts.push(`select: ${JSON.stringify(fields)}`)

  if (pageParam) {
    if (output.type === 'array') {
      const pageParts = [
        ...baseParts,
        'skip: (current - 1) * pageSize',
        'take: pageSize',
      ]
      return {
        body: `${guard || ''}${emitPageMetaLocals(pageExpr)}
    const [rows] = await this.repo.findAndCount(${emitFindOptions(pageParts)})
    return rows as unknown as ${returnType}`,
        needsHelper: false,
      }
    }
  }

  if (output.type === 'map') {
    const mapped = wrapMapOutput(method, 'rows', returnType, commaArrayFields)
    return {
      body: `${guard || ''}    const rows = await this.repo.find(${emitFindOptions(baseParts)})
${mapped.code}`,
      needsHelper: mapped.needsHelper,
    }
  }

  if (output.type === 'array') {
    return {
      body: `${guard || ''}    return this.repo.find(${emitFindOptions(baseParts)}) as unknown as ${returnType}`,
      needsHelper: false,
    }
  }

  // findOne 实际为 T | null；与出参/实体可空差异一并双重断言
  return {
    body: `${guard || ''}    return this.repo.findOne(${emitFindOptions(baseParts)}) as unknown as ${returnType}`,
    needsHelper: false,
  }
}

function compileInsertMethod(method: ProcessorMethod): string {
  const config = method.dataConfig
  const output = outputMeta(method)
  const payload = emitInsertPayload(config.fieldMappings)
  if (output.type === 'number') {
    return `    const result = await this.repo.insert(${payload})
    const raw = result.raw as { insertId?: number }
    return Number(result.identifiers?.[0]?.id ?? raw?.insertId ?? 0) || 0`
  }
  return `    const result = await this.repo.insert(${payload})
    return result`
}

function compileBatchInsertMethod(method: ProcessorMethod): string {
  const config = method.dataConfig
  const output = outputMeta(method)
  const batchParam = (config.batchSourceParam || '').trim()
  const arrayName = safeIdent(
    batchParam ||
      config.fieldMappings?.[0]?.column.split('.')[0]?.trim() ||
      'items',
    'items',
  )
  const mappings = (config.fieldMappings || [])
    .map((m) => ({
      field: m.field.trim(),
      column: m.column.trim(),
    }))
    .filter((m) => m.field && m.column)

  const mapLines = mappings.map((m) => {
    const parts = m.column.split('.').map((p) => p.trim()).filter(Boolean)
    const fieldPath =
      parts.length > 1
        ? parts.slice(1).map((p) => safeIdent(p, 'field')).join('.')
        : m.field
    return `        ${m.field}: item.${fieldPath},`
  })

  return `    if (!${arrayName}.length) {
      return ${output.type === 'array' ? '[]' : '0'}
    }
    const payload = ${arrayName}.map((item) => ({
${mapLines.join('\n')}
    }))
    const result = await this.repo.insert(payload)
    const raw = result.raw as { insertId?: number; affectedRows?: number }
    const insertId = Number(raw?.insertId ?? result.identifiers?.[0]?.id ?? 0) || 0
    const affected = Number(raw?.affectedRows ?? ${arrayName}.length) || ${arrayName}.length
    ${
      output.type === 'array'
        ? 'return Array.from({ length: affected }, (_, i) => insertId + i)'
        : 'return insertId'
    }`
}

function compileUpdateMethod(
  method: ProcessorMethod,
  imports: Set<TypeOrmImport>,
): string {
  const config = method.dataConfig
  const output = outputMeta(method)
  const where = whereAsAny(emitWhereClause(config.conditionGroups, imports))
  const sets = (config.fieldMappings || [])
    .map((m) => `${m.field.trim()}: ${mappingSourceExpr(m.column.trim())}`)
    .filter(Boolean)
    .join(', ')
  const whereExpr = where || '{}'
  const ret =
    output.type === 'boolean'
      ? '(result.affected ?? 0) > 0'
      : 'result.affected ?? 0'
  return `    const result = await this.repo.update(${whereExpr}, { ${sets} } as any)
    return ${ret}`
}

function compileDeleteMethod(
  method: ProcessorMethod,
  imports: Set<TypeOrmImport>,
): string {
  const config = method.dataConfig
  const output = outputMeta(method)
  const where = whereAsAny(emitWhereClause(config.conditionGroups, imports))
  const whereExpr = where || '{}'
  const ret =
    output.type === 'boolean'
      ? '(result.affected ?? 0) > 0'
      : 'result.affected ?? 0'
  return `    const result = await this.repo.delete(${whereExpr})
    return ${ret}`
}

/** MyBatis 风格 test 表达式 → TypeScript */
function compileMybatisIfTest(test: string): string {
  const raw = test.trim()
  if (!raw) return 'false'

  const orParts = raw.split(/\s*(?:\|\||\bor\b)\s*/i)
  return orParts
    .map((orPart) => {
      const andParts = orPart
        .split(/\s*(?:&&|\band\b)\s*/i)
        .map((s) => s.trim())
        .filter(Boolean)
      return andParts
        .map((atom) => {
          const nullCmp = atom.match(
            /^([A-Za-z_][A-Za-z0-9_.]*)\s*(!=|==)\s*(null|''|"")\s*$/i,
          )
          if (nullCmp) {
            const expr = paramAccess(nullCmp[1]!)
            const op = nullCmp[2]!
            const rhs = nullCmp[3]!.toLowerCase()
            if (rhs === 'null') {
              return op === '!=' ? `${expr} != null` : `${expr} == null`
            }
            return op === '!='
              ? `${expr} != null && ${expr} !== ''`
              : `${expr} == null || ${expr} === ''`
          }
          const litCmp = atom.match(
            /^([A-Za-z_][A-Za-z0-9_.]*)\s*(!=|==)\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))\s*$/,
          )
          if (litCmp) {
            const expr = paramAccess(litCmp[1]!)
            const op = litCmp[2]!
            const rhsStr = litCmp[3] ?? litCmp[4]
            const rhsNum = litCmp[5]
            const rhs =
              rhsNum != null ? rhsNum : JSON.stringify(rhsStr ?? '')
            return op === '!=' ? `${expr} != ${rhs}` : `${expr} == ${rhs}`
          }
          const nameOnly = atom.match(/^([A-Za-z_][A-Za-z0-9_.]*)$/)
          if (nameOnly) {
            const expr = paramAccess(nameOnly[1]!)
            return `${expr} != null && ${expr} !== '' && ${expr} !== false`
          }
          return 'false'
        })
        .join(' && ')
    })
    .filter(Boolean)
    .map((p) => (orParts.length > 1 && p.includes('&&') ? `(${p})` : p))
    .join(' || ')
}

/** pageParam 局部变量；兼容 page/size，宽类型避免 QueryPageDto 报错 */
function emitPageMetaLocals(pageExpr: string, indent = '    '): string {
  return (
    `${indent}const pageMeta = ${pageExpr} as { current?: unknown; page?: unknown; pageSize?: unknown; size?: unknown }\n` +
    `${indent}const current = Math.max(1, Number(pageMeta.current ?? pageMeta.page ?? 1) || 1)\n` +
    `${indent}const pageSize = Math.max(1, Math.min(200, Number(pageMeta.pageSize ?? pageMeta.size ?? 10) || 10))`
  )
}

/** 将片段中 #{param} → ?，并收集入参表达式 */
function fragmentToSqlAndParams(fragment: string): {
  sql: string
  paramExprs: string[]
} {
  const paramExprs: string[] = []
  let sql = ''
  const re = /#\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(fragment))) {
    sql += fragment.slice(last, m.index)
    sql += '?'
    paramExprs.push(paramAccess(m[1]!))
    last = m.index + m[0].length
  }
  sql += fragment.slice(last)
  return { sql: sql.replace(/\r\n/g, '\n').trim(), paramExprs }
}

/** 生成可嵌入源码的 SQL 字符串字面量 */
function emitSqlSourceLiteral(sql: string, indent: string): string {
  if (!sql.includes('\n') && !sql.includes('`') && !sql.includes('${')) {
    return JSON.stringify(sql)
  }
  const escaped = sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
  const innerIndent = `${indent}  `
  const body = escaped
    .split('\n')
    .map((line) => `${innerIndent}${line}`)
    .join('\n')
  return `\`${'\n'}${body}\n${indent}\``
}

function emitSqlBuilderCall(
  methodName: 'test' | 'append',
  args: { condition?: string; sql: string; paramExprs: string[] },
  indent: string,
): string {
  const lit = emitSqlSourceLiteral(args.sql, indent)
  const paramTail = args.paramExprs.length
    ? `, ${args.paramExprs.join(', ')}`
    : ''
  if (methodName === 'test') {
    return `${indent}sqlBuilder.test(${args.condition}, ${lit}${paramTail})`
  }
  return `${indent}sqlBuilder.append(${lit}${paramTail})`
}

function wrapCustomSqlResult(
  method: ProcessorMethod,
  returnType: string,
  commaArrayFields: string[],
): { code: string; needsHelper: boolean } {
  const output = outputMeta(method)
  const mappings = (method.dataConfig.fieldMappings || [])
    .map((m) => ({ field: m.field.trim(), column: m.column.trim() }))
    .filter((m) => m.field && m.column)
  const fieldsLit = JSON.stringify(commaArrayFields)

  if (output.type === 'array') {
    if (commaArrayFields.length) {
      return {
        code: `    return coerceCommaArrayRows(rows as Record<string, unknown>[], ${fieldsLit}) as unknown as ${returnType}`,
        needsHelper: true,
      }
    }
    return {
      code: `    return rows as unknown as ${returnType}`,
      needsHelper: false,
    }
  }
  if (output.type === 'number') {
    const col = mappings.find((m) => m.field === 'value')?.column
    if (col) {
      const key = JSON.stringify(col)
      return {
        code: `    const row = (rows[0] ?? {}) as Record<string, unknown>
    return Number(row[${key}] ?? Object.values(row)[0] ?? 0) || 0`,
        needsHelper: false,
      }
    }
    return {
      code: `    const row = (rows[0] ?? {}) as Record<string, unknown>
    return Number(row.cnt ?? Object.values(row)[0] ?? 0) || 0`,
      needsHelper: false,
    }
  }
  if (output.type === 'boolean') {
    return {
      code: `    const row = (rows[0] ?? {}) as Record<string, unknown>
    const v = Object.values(row)[0]
    return Boolean(v) && v !== 0 && v !== '0'`,
      needsHelper: false,
    }
  }
  if (output.type === 'string') {
    return {
      code: `    const row = (rows[0] ?? {}) as Record<string, unknown>
    const v = Object.values(row)[0]
    return v == null ? '' : String(v)`,
      needsHelper: false,
    }
  }
  if (commaArrayFields.length) {
    return {
      code: `    const row = (rows[0] ?? null) as Record<string, unknown> | null
    return (row ? coerceCommaArrayFields(row, ${fieldsLit}) : null) as unknown as ${returnType}`,
      needsHelper: true,
    }
  }
  return {
    code: `    return (rows[0] ?? null) as unknown as ${returnType}`,
    needsHelper: false,
  }
}

function compileCustomSqlToTypeOrm(
  method: ProcessorMethod,
  table: string,
  returnType: string,
  commaArrayFields: string[],
): { body: string; needsHelper: boolean; needsSqlBuilder: boolean } {
  const raw = method.dataConfig.sql?.trim()
  if (!raw) {
    return {
      body: `    throw new Error('未配置自定义 SQL')`,
      needsHelper: false,
      needsSqlBuilder: false,
    }
  }

  let sql = raw
    .replace(/\$\{\s*TABLE_NAME\s*\}/gi, `\`${table}\``)
    .replace(/\{\s*TABLE_NAME\s*\}/gi, `\`${table}\``)
    .replace(/\r\n/g, '\n')

  type SqlPart =
    | { kind: 'base' | 'append'; fragment: string }
    | { kind: 'test'; test: string; fragment: string }

  const parts: SqlPart[] = []
  const ifRe = /<if\s+test\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/if>/gi
  let last = 0
  let match: RegExpExecArray | null
  let sawIf = false
  while ((match = ifRe.exec(sql))) {
    const before = sql.slice(last, match.index).replace(/\s+$/, '')
    if (before.trim()) {
      parts.push({ kind: sawIf ? 'append' : 'base', fragment: before })
    }
    const body = (match[2] || '').trim()
    if (body) {
      parts.push({
        kind: 'test',
        test: compileMybatisIfTest(match[1] || ''),
        fragment: body,
      })
    }
    sawIf = true
    last = match.index + match[0].length
  }
  const tail = sql.slice(last).trim()
  if (tail) {
    parts.push({ kind: sawIf ? 'append' : 'base', fragment: tail })
  }
  if (!parts.length) {
    parts.push({ kind: 'base', fragment: sql.trim() })
  }

  // 第一个非空片段作为构造参数；若以 test 开头则空 base
  const lines: string[] = []
  const indent = '    '
  let baseEmitted = false
  for (const part of parts) {
    if (part.kind === 'base' && !baseEmitted) {
      const { sql: baseSql, paramExprs } = fragmentToSqlAndParams(part.fragment)
      const lit = emitSqlSourceLiteral(baseSql, indent)
      const paramTail = paramExprs.length ? `, ${paramExprs.join(', ')}` : ''
      lines.push(`${indent}const sqlBuilder = new SqlBuilder(${lit}${paramTail})`)
      baseEmitted = true
      continue
    }
    if (!baseEmitted) {
      lines.push(`${indent}const sqlBuilder = new SqlBuilder()`)
      baseEmitted = true
    }
    if (part.kind === 'test') {
      const { sql: fragSql, paramExprs } = fragmentToSqlAndParams(part.fragment)
      if (!fragSql) continue
      lines.push(
        emitSqlBuilderCall(
          'test',
          { condition: part.test, sql: fragSql, paramExprs },
          indent,
        ),
      )
      continue
    }
    const { sql: fragSql, paramExprs } = fragmentToSqlAndParams(part.fragment)
    if (!fragSql) continue
    lines.push(
      emitSqlBuilderCall('append', { sql: fragSql, paramExprs }, indent),
    )
  }
  if (!baseEmitted) {
    lines.push(`${indent}const sqlBuilder = new SqlBuilder()`)
  }

  // 读查询一致：绑定 pageParam 后对只读 SQL 追加 LIMIT/OFFSET
  const pageParam = (method.dataConfig.pageParam || '').trim()
  const looksWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(
    raw.replace(/<if[\s\S]*?<\/if>/gi, ' '),
  )
  if (pageParam && !looksWrite) {
    const pageExpr = paramAccess(pageParam)
    lines.push(...emitPageMetaLocals(pageExpr).split('\n'))
    lines.push(
      `${indent}sqlBuilder.limit(pageSize, (current - 1) * pageSize)`,
    )
  }

  lines.push(`${indent}const { sql, params } = sqlBuilder.build()`)
  lines.push(`${indent}const rows = await this.repo.query(sql, params)`)
  const wrapped = wrapCustomSqlResult(method, returnType, commaArrayFields)
  lines.push(wrapped.code)
  return {
    body: lines.join('\n'),
    needsHelper: wrapped.needsHelper,
    needsSqlBuilder: true,
  }
}

function compileCustomMethod(
  method: ProcessorMethod,
  table: string,
  imports: Set<TypeOrmImport>,
  returnType: string,
  commaArrayFields: string[],
): { body: string; needsHelper: boolean; needsSqlBuilder: boolean } {
  const preset = tryCompilePresetCustom(method, imports)
  if (preset) {
    return { body: preset, needsHelper: false, needsSqlBuilder: false }
  }
  return compileCustomSqlToTypeOrm(method, table, returnType, commaArrayFields)
}

export function compileTypeOrmMethodBody(
  method: ProcessorMethod,
  table: string,
  options: CompileMethodOptions | string = {},
): CompileMethodResult {
  const opts: CompileMethodOptions =
    typeof options === 'string' ? { returnType: options } : options
  const returnType = opts.returnType || 'any'
  const commaArrayFields = opts.commaArrayFields ?? []
  const imports = new Set<TypeOrmImport>()
  const config = method.dataConfig
  let body: string
  let needsCommaArrayHelper = false
  let needsSqlBuilder = false

  if (config.source !== 'mysql') {
    body = `    throw new Error('暂不支持的数据源：${config.source}')`
  } else if (config.operation === 'query') {
    const compiled = compileQueryMethod(
      method,
      imports,
      returnType,
      commaArrayFields,
    )
    body = compiled.body
    needsCommaArrayHelper = compiled.needsHelper
  } else if (config.operation === 'insert') {
    body = compileInsertMethod(method)
  } else if (config.operation === 'batchInsert') {
    body = compileBatchInsertMethod(method)
  } else if (config.operation === 'update') {
    body = compileUpdateMethod(method, imports)
  } else if (config.operation === 'delete') {
    body = compileDeleteMethod(method, imports)
  } else if (config.operation === 'custom') {
    const compiled = compileCustomMethod(
      method,
      table,
      imports,
      returnType,
      commaArrayFields,
    )
    body = compiled.body
    needsCommaArrayHelper = compiled.needsHelper
    needsSqlBuilder = compiled.needsSqlBuilder
  } else {
    body = `    throw new Error('不支持的操作：${config.operation}')`
  }

  return {
    body,
    imports: [...imports],
    needsCommaArrayHelper,
    needsSqlBuilder,
  }
}
