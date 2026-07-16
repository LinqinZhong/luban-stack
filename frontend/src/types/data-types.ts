/** 项目级数据类型库（types/ 目录，每分组一个英文名 .json） */

export const DATA_TYPES_DIR = 'types'
/** @deprecated 旧版单文件，读取时自动迁移到 types/ */
export const DATA_TYPES_LEGACY_FILE = 'types.json'

export type DataTypeKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'interface'
  | 'enum'
  | 'combination'

export const DATA_TYPE_KIND_OPTIONS: Array<{ label: string; value: DataTypeKind }> = [
  { label: '数字', value: 'number' },
  { label: '字符串', value: 'string' },
  { label: '布尔值', value: 'boolean' },
  { label: '接口', value: 'interface' },
  { label: '枚举', value: 'enum' },
  { label: '组合', value: 'combination' },
]

/** 类型表达式中的原子引用 */
export type TypeAtomKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'named'
  | 'generic'
  | 'any'
  | 'unknown'

export interface TypeAtom {
  kind: TypeAtomKind
  /** named → 类型 id；generic → 泛型参数名 */
  ref?: string
}

/** tabs = | 的各个分支 */
export interface TypeUnion {
  alternatives: TypeAtom[]
}

/**
 * 引用表达式：外层列表 = `&`，每一项内 tabs = `|`
 * 例：(A | B) & C
 */
export interface TypeExpr {
  intersections: TypeUnion[]
}

export interface TypeGenericParam {
  id: string
  name: string
  constraint: TypeExpr | null
  default: TypeExpr | null
}

export interface InterfaceField {
  id: string
  name: string
  type: TypeExpr
  remark: string
  optional: boolean
}

export interface EnumMember {
  id: string
  name: string
  /** 空字符串表示由运行时/导出侧推断 */
  value: string
}

export interface DataTypeDef {
  id: string
  name: string
  kind: DataTypeKind
  remark: string
  generics: TypeGenericParam[]
  fields: InterfaceField[]
  enumMembers: EnumMember[]
  combination: TypeExpr
}

export interface DataTypeGroup {
  id: string
  name: string
  types: DataTypeDef[]
}

export interface DataTypeLibrary {
  groups: DataTypeGroup[]
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyTypeAtom(): TypeAtom {
  return { kind: 'string' }
}

export function createEmptyTypeUnion(): TypeUnion {
  return { alternatives: [createEmptyTypeAtom()] }
}

export function createEmptyTypeExpr(): TypeExpr {
  return { intersections: [createEmptyTypeUnion()] }
}

export function createEmptyGenericParam(): TypeGenericParam {
  return {
    id: uid('gen'),
    name: 'T',
    constraint: null,
    default: null,
  }
}

export function createEmptyInterfaceField(): InterfaceField {
  return {
    id: uid('field'),
    name: '',
    type: createEmptyTypeExpr(),
    remark: '',
    optional: false,
  }
}

export function createEmptyEnumMember(): EnumMember {
  return {
    id: uid('enum'),
    name: '',
    value: '',
  }
}

export function createEmptyDataType(kind: DataTypeKind = 'string'): DataTypeDef {
  return {
    id: uid('type'),
    name: '',
    kind,
    remark: '',
    generics: [],
    fields: kind === 'interface' ? [createEmptyInterfaceField()] : [],
    enumMembers: kind === 'enum' ? [createEmptyEnumMember()] : [],
    combination: createEmptyTypeExpr(),
  }
}

export function createEmptyDataTypeGroup(name = 'Group'): DataTypeGroup {
  return {
    id: uid('group'),
    name,
    types: [],
  }
}

export function createEmptyDataTypeLibrary(): DataTypeLibrary {
  return { groups: [] }
}

/** 类型名：字母/下划线开头 */
export function isValidTypeName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

/** 分组名：纯英文（字母开头，仅字母数字下划线），对应 types/{name}.json */
export function isValidGroupName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name)
}

export function kindNeedsConfig(kind: DataTypeKind): boolean {
  return kind === 'interface' || kind === 'enum' || kind === 'combination'
}

export function kindLabel(kind: DataTypeKind): string {
  return DATA_TYPE_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAtom(input: unknown): TypeAtom {
  if (!isPlainObject(input)) return createEmptyTypeAtom()
  const kind = String(input.kind ?? 'string') as TypeAtomKind
  const allowed: TypeAtomKind[] = [
    'number',
    'string',
    'boolean',
    'named',
    'generic',
    'any',
    'unknown',
  ]
  const safeKind = allowed.includes(kind) ? kind : 'string'
  const ref = typeof input.ref === 'string' ? input.ref.trim() : ''
  return {
    kind: safeKind,
    ...(safeKind === 'named' || safeKind === 'generic' ? { ref } : {}),
  }
}

function normalizeUnion(input: unknown): TypeUnion {
  if (!isPlainObject(input) || !Array.isArray(input.alternatives) || !input.alternatives.length) {
    return createEmptyTypeUnion()
  }
  return { alternatives: input.alternatives.map(normalizeAtom) }
}

export function normalizeTypeExpr(input: unknown): TypeExpr {
  if (!isPlainObject(input) || !Array.isArray(input.intersections) || !input.intersections.length) {
    return createEmptyTypeExpr()
  }
  return { intersections: input.intersections.map(normalizeUnion) }
}

function normalizeGeneric(input: unknown): TypeGenericParam | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return null
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('gen'),
    name,
    constraint: input.constraint == null ? null : normalizeTypeExpr(input.constraint),
    default: input.default == null ? null : normalizeTypeExpr(input.default),
  }
}

function normalizeField(input: unknown): InterfaceField | null {
  if (!isPlainObject(input)) return null
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('field'),
    name: typeof input.name === 'string' ? input.name.trim() : '',
    type: normalizeTypeExpr(input.type),
    remark: typeof input.remark === 'string' ? input.remark : '',
    optional: Boolean(input.optional),
  }
}

function normalizeEnumMember(input: unknown): EnumMember | null {
  if (!isPlainObject(input)) return null
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('enum'),
    name: typeof input.name === 'string' ? input.name.trim() : '',
    value: typeof input.value === 'string' ? input.value : '',
  }
}

function normalizeTypeDef(input: unknown): DataTypeDef | null {
  if (!isPlainObject(input)) return null
  const kindRaw = String(input.kind ?? 'string') as DataTypeKind
  const kind = DATA_TYPE_KIND_OPTIONS.some((o) => o.value === kindRaw)
    ? kindRaw
    : 'string'
  const generics = Array.isArray(input.generics)
    ? input.generics.map(normalizeGeneric).filter((x): x is TypeGenericParam => Boolean(x))
    : []
  const fields = Array.isArray(input.fields)
    ? input.fields.map(normalizeField).filter((x): x is InterfaceField => Boolean(x))
    : []
  const enumMembers = Array.isArray(input.enumMembers)
    ? input.enumMembers.map(normalizeEnumMember).filter((x): x is EnumMember => Boolean(x))
    : []
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('type'),
    name: typeof input.name === 'string' ? input.name.trim() : '',
    kind,
    remark: typeof input.remark === 'string' ? input.remark : '',
    generics,
    fields,
    enumMembers,
    combination: normalizeTypeExpr(input.combination),
  }
}

function normalizeGroup(input: unknown): DataTypeGroup | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!isValidGroupName(name)) return null
  const types = Array.isArray(input.types)
    ? input.types.map(normalizeTypeDef).filter((x): x is DataTypeDef => Boolean(x))
    : []
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('group'),
    name,
    types,
  }
}

/** 从 types/{name}.json 文件内容还原分组（文件名即分组名） */
export function normalizeTypeGroupFile(
  input: unknown,
  fileName: string,
): DataTypeGroup | null {
  if (!isValidGroupName(fileName)) return null
  if (!isPlainObject(input)) {
    return {
      id: uid('group'),
      name: fileName,
      types: [],
    }
  }
  const types = Array.isArray(input.types)
    ? input.types.map(normalizeTypeDef).filter((x): x is DataTypeDef => Boolean(x))
    : []
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('group'),
    name: fileName,
    types,
  }
}

export function normalizeDataTypeLibrary(input: unknown): DataTypeLibrary {
  if (!isPlainObject(input) || !Array.isArray(input.groups)) {
    return createEmptyDataTypeLibrary()
  }
  return {
    groups: input.groups.map(normalizeGroup).filter((x): x is DataTypeGroup => Boolean(x)),
  }
}

/** 单原子类型（非 | / & 组合） */
export function isSimpleTypeExpr(expr: TypeExpr): boolean {
  return (
    expr.intersections.length === 1 &&
    (expr.intersections[0]?.alternatives.length ?? 0) === 1
  )
}

/** 字段类型下拉：simple 原子 / combination 联合 */
export function typeExprToSelectValue(expr: TypeExpr): string {
  if (!isSimpleTypeExpr(expr)) return 'combination'
  const atom = expr.intersections[0]!.alternatives[0]!
  if (atom.kind === 'named') return `named:${atom.ref ?? ''}`
  if (atom.kind === 'generic') return `generic:${atom.ref ?? ''}`
  return atom.kind
}

export function selectValueToTypeExpr(value: string): TypeExpr {
  if (value === 'combination') return createEmptyTypeExpr()
  if (value.startsWith('named:')) {
    return {
      intersections: [{ alternatives: [{ kind: 'named', ref: value.slice(6) }] }],
    }
  }
  if (value.startsWith('generic:')) {
    return {
      intersections: [{ alternatives: [{ kind: 'generic', ref: value.slice(8) }] }],
    }
  }
  const kind = value as TypeAtomKind
  const allowed: TypeAtomKind[] = [
    'number',
    'string',
    'boolean',
    'any',
    'unknown',
  ]
  return {
    intersections: [
      {
        alternatives: [
          { kind: allowed.includes(kind) ? kind : 'string' },
        ],
      },
    ],
  }
}

/** 将类型表达式格式化为简短预览（用于表格） */
export function formatTypeExprPreview(
  expr: TypeExpr,
  namedLookup?: (id: string) => string,
): string {
  if (!expr.intersections.length) return '—'
  return expr.intersections
    .map((union) => {
      const parts = union.alternatives.map((atom) => {
        if (atom.kind === 'named') {
          const id = atom.ref ?? ''
          return namedLookup?.(id) || id || '?'
        }
        if (atom.kind === 'generic') return atom.ref || 'T'
        return atom.kind
      })
      return parts.length > 1 ? `(${parts.join(' | ')})` : parts[0] || '?'
    })
    .join(' & ')
}

export function cloneTypeExpr(expr: TypeExpr): TypeExpr {
  return JSON.parse(JSON.stringify(expr)) as TypeExpr
}

export function cloneDataTypeDef(def: DataTypeDef): DataTypeDef {
  return JSON.parse(JSON.stringify(def)) as DataTypeDef
}
