import {
  createEmptyDataType,
  createEmptyTypeExpr,
  type DataTypeDef,
  type InterfaceField,
  type TypeAtomKind,
  type TypeExpr,
} from '../types/data-types'
import type { MysqlColumnDef } from '../types/mysql'

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function atomExpr(kind: TypeAtomKind): TypeExpr {
  const base = createEmptyTypeExpr()
  base.intersections[0]!.alternatives[0] = { kind }
  return base
}

/** 表名 → 合法 PascalCase 类型名 */
export function tableNameToTypeName(tableName: string): string {
  const parts = tableName
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (!parts.length) return 'Table'
  const pascal = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(pascal)) return pascal
  return `T${pascal.replace(/[^A-Za-z0-9_]/g, '')}` || 'Table'
}

/** 列名 → 合法字段名 */
export function columnNameToFieldName(columnName: string): string {
  const raw = columnName.trim()
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) return raw
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_')
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) return cleaned
  return `f_${cleaned}`
}

/**
 * MySQL 列类型 → 类型库原子 kind
 * tinyint(1) / bool → boolean；整型/浮点 → number；其余 → string
 */
export function mysqlColumnTypeToAtomKind(mysqlType: string): TypeAtomKind {
  const t = mysqlType.trim().toLowerCase()
  if (!t) return 'string'

  if (
    t === 'bool' ||
    t === 'boolean' ||
    /^tinyint\s*\(\s*1\s*\)/.test(t)
  ) {
    return 'boolean'
  }

  if (
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
    /^year\b/.test(t)
  ) {
    return 'number'
  }

  if (/^json\b/.test(t)) return 'any'

  return 'string'
}

export function mysqlColumnsToInterfaceFields(
  columns: MysqlColumnDef[],
): InterfaceField[] {
  return buildMysqlInterfaceFields(columns).fields
}

function buildMysqlInterfaceFields(columns: MysqlColumnDef[]): {
  fields: InterfaceField[]
  preview: Array<{ column: string; field: string; kind: string; optional: boolean }>
} {
  const fields: InterfaceField[] = []
  const preview: Array<{
    column: string
    field: string
    kind: string
    optional: boolean
  }> = []
  const seen = new Set<string>()

  for (const col of columns) {
    let name = columnNameToFieldName(col.name)
    if (!name) continue
    if (seen.has(name)) {
      let i = 2
      while (seen.has(`${name}_${i}`)) i += 1
      name = `${name}_${i}`
    }
    seen.add(name)

    const kind = mysqlColumnTypeToAtomKind(col.type)
    const optional = Boolean(col.nullable) && !col.primaryKey
    fields.push({
      id: uid('field'),
      name,
      type: atomExpr(kind),
      remark: (col.comment || '').trim(),
      optional,
    })
    preview.push({ column: col.name, field: name, kind, optional })
  }

  return { fields, preview }
}

/** 将数据表列转为 interface 类型定义 */
export function mysqlTableToDataType(options: {
  tableName: string
  tableRemark?: string
  columns: MysqlColumnDef[]
  typeName?: string
}): DataTypeDef {
  const name = (options.typeName || tableNameToTypeName(options.tableName)).trim()
  const def = createEmptyDataType('interface')
  def.name = name
  def.tableName = options.tableName.trim()
  def.category = 'entity'
  def.remark = (options.tableRemark || '').trim() || `来自数据表 ${options.tableName}`
  def.fields = buildMysqlInterfaceFields(options.columns).fields
  if (!def.fields.length) {
    def.fields = [
      {
        id: uid('field'),
        name: 'id',
        type: atomExpr('string'),
        remark: '',
        optional: false,
      },
    ]
  }
  return def
}

export function previewMysqlColumnMapping(
  columns: MysqlColumnDef[],
): Array<{ column: string; field: string; kind: string; optional: boolean }> {
  return buildMysqlInterfaceFields(columns).preview
}
