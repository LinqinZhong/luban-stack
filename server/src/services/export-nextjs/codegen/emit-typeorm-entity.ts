import type { DataTypeDef, TypeAtom, TypeExpr } from '../../../types/data-types.js'
import type { MysqlColumnDef } from '../../../types/mysql.js'
import { isArrayTypeExpr } from '../../../utils/comma-array-fields.js'
import { snakeToCamel } from '../../../utils/sql-naming.js'
import { typeExprToTs, type IdToName } from './emit-types.js'

function collectNamedRefsFromAtom(atom: TypeAtom | undefined, out: Set<string>) {
  if (!atom) return
  if (atom.kind === 'named' && atom.ref) out.add(atom.ref)
  if (atom.kind === 'array' || atom.kind === 'map') {
    collectNamedRefsFromAtom(atom.item, out)
  }
}

function collectNamedRefsFromExpr(expr: TypeExpr | undefined, out: Set<string>) {
  for (const u of expr?.intersections ?? []) {
    for (const a of u.alternatives ?? []) collectNamedRefsFromAtom(a, out)
  }
}

function isStringColumn(col: MysqlColumnDef): boolean {
  const t = col.type.trim().toLowerCase()
  return (
    t.startsWith('varchar') ||
    t.startsWith('char') ||
    t.startsWith('text') ||
    t.startsWith('tinytext') ||
    t.startsWith('mediumtext') ||
    t.startsWith('longtext') ||
    t.startsWith('blob')
  )
}

function fieldIsArray(def: DataTypeDef, fieldName: string): boolean {
  const field = def.fields?.find((f) => f.name === fieldName)
  return field ? isArrayTypeExpr(field.type) : false
}

function mysqlColumnOptions(
  col: MysqlColumnDef,
  fieldName: string,
  asCommaArray: boolean,
): string {
  const opts: string[] = []
  const colName = col.name
  if (colName !== fieldName) {
    opts.push(`name: ${JSON.stringify(colName)}`)
  }

  const mysqlType = col.type.trim().toLowerCase()
  const varchar = mysqlType.match(/^varchar\((\d+)\)/)
  if (varchar) {
    opts.push("type: 'varchar'", `length: ${varchar[1]}`)
  } else if (
    /^(tiny|small|medium|big)?int\b/.test(mysqlType) ||
    mysqlType === 'integer'
  ) {
    opts.push(`type: '${mysqlType.split('(')[0]}'`)
  } else if (mysqlType.startsWith('tinyint')) {
    opts.push("type: 'tinyint'", 'width: 1')
  } else if (mysqlType.startsWith('decimal') || mysqlType.startsWith('numeric')) {
    opts.push(`type: '${mysqlType.split('(')[0]}'`)
  } else if (mysqlType === 'datetime' || mysqlType === 'timestamp') {
    opts.push(`type: '${mysqlType}'`)
  } else if (mysqlType.startsWith('text') || mysqlType.startsWith('json')) {
    opts.push(`type: '${mysqlType.split('(')[0]}'`)
  } else {
    opts.push(`type: '${mysqlType.split('(')[0] || 'varchar'}'`)
  }

  if (col.nullable) opts.push('nullable: true')
  if (col.defaultValue.trim() !== '') {
    const dv = col.defaultValue.trim()
    if (/^-?\d+(\.\d+)?$/.test(dv)) {
      opts.push(`default: ${dv}`)
    } else if (dv.toLowerCase() === 'null') {
      opts.push('default: null')
    } else if (dv.toLowerCase() === 'current_timestamp') {
      opts.push('default: () => "CURRENT_TIMESTAMP"')
    } else {
      opts.push(`default: ${JSON.stringify(dv)}`)
    }
  }

  if (asCommaArray) {
    opts.push(`transformer: {
      to: (v: unknown) => (Array.isArray(v) ? v.join(',') : v),
      from: (v: unknown) => {
        if (v == null) return null
        if (Array.isArray(v)) return v
        const s = String(v)
        if (!s) return []
        return s.split(',').map((x) => x.trim()).filter(Boolean)
      },
    }`)
  }

  return `{ ${opts.join(', ')} }`
}

function fieldTsType(
  def: DataTypeDef,
  fieldName: string,
  col: MysqlColumnDef,
  idToName: IdToName,
): string {
  const field = def.fields?.find((f) => f.name === fieldName)
  if (field) {
    const ty = typeExprToTs(field.type, idToName)
    if (field.optional || col.nullable) {
      if (!ty.includes('null') && !ty.includes('undefined')) {
        return `${ty} | null`
      }
    }
    return ty
  }
  if (col.nullable) return 'string | null'
  return 'string'
}

function columnDecorator(
  col: MysqlColumnDef,
  fieldName: string,
  asCommaArray: boolean,
): string {
  if (col.primaryKey && col.autoIncrement) {
    const mysqlType = col.type.trim().toLowerCase()
    const type = mysqlType.includes('bigint') ? 'bigint' : 'int'
    const nameOpt =
      col.name !== fieldName ? `, name: ${JSON.stringify(col.name)}` : ''
    return `@PrimaryGeneratedColumn({ type: '${type}'${nameOpt} })`
  }
  return `@Column(${mysqlColumnOptions(col, fieldName, asCommaArray)})`
}

export function emitTypeOrmEntityFile(options: {
  entityDef: DataTypeDef
  tableName: string
  columns: MysqlColumnDef[]
  idToName: IdToName
  typeIdToGroupStem?: Map<string, string>
}): string {
  const { entityDef, tableName, columns, idToName, typeIdToGroupStem } = options
  const className = entityDef.name.trim() || 'Entity'

  const orderedCols =
    columns.length > 0
      ? columns
      : (entityDef.fields ?? []).map((f) => ({
          name: f.name,
          type: 'varchar(255)',
          nullable: f.optional,
          primaryKey: f.name === 'id',
          autoIncrement: f.name === 'id',
          defaultValue: '',
          comment: '',
        }))

  const namedRefs = new Set<string>()
  for (const f of entityDef.fields ?? []) {
    collectNamedRefsFromExpr(f.type, namedRefs)
  }
  const byGroup = new Map<string, Set<string>>()
  for (const ref of namedRefs) {
    const name = idToName.get(ref)
    const stem = typeIdToGroupStem?.get(ref)
    if (!name || !stem || name === className) continue
    if (!byGroup.has(stem)) byGroup.set(stem, new Set())
    byGroup.get(stem)!.add(name)
  }
  const typeImports = [...byGroup.entries()]
    .map(
      ([stem, names]) =>
        `import type { ${[...names].sort().join(', ')} } from '../../../types/${stem}'`,
    )
    .join('\n')

  const props = orderedCols
    .map((col) => {
      const fieldName = snakeToCamel(col.name)
      const asCommaArray =
        fieldIsArray(entityDef, fieldName) && isStringColumn(col)
      const tsType = fieldTsType(entityDef, fieldName, col, idToName)
      return `  ${columnDecorator(col, fieldName, asCommaArray)}\n  ${fieldName}!: ${tsType}`
    })
    .join('\n\n')

  return `/** ${className} · TypeORM 实体 */
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'
${typeImports ? typeImports + '\n' : ''}
@Entity(${JSON.stringify(tableName)})
export class ${className} {
${props}
}
`
}
