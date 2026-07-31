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

export const DATA_TYPE_KIND_OPTIONS: Array<{ label: string; value: DataTypeKind }> = [
  { label: '数字', value: 'number' },
  { label: '字符串', value: 'string' },
  { label: '布尔值', value: 'boolean' },
  { label: '接口', value: 'interface' },
  { label: '枚举', value: 'enum' },
]

/** 类型用途分类 */
export type DataTypeCategory = 'entity' | 'dto' | 'vo' | 'other'

export const DATA_TYPE_CATEGORY_OPTIONS: Array<{
  label: string
  value: DataTypeCategory
}> = [
  { label: '实体', value: 'entity' },
  { label: '数据传输对象', value: 'dto' },
  { label: '视图对象', value: 'vo' },
  { label: '其它', value: 'other' },
]

/** 类型表达式中的原子引用 */
export type TypeAtomKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'time'
  | 'date'
  | 'datetime'
  | 'named'
  | 'generic'
  | 'any'
  | 'array'
  /** 映射 Map<K, T> */
  | 'map'

export interface TypeAtom {
  kind: TypeAtomKind
  /** named → 类型 id；generic → 泛型参数名 */
  ref?: string
  /** array → 元素类型；map → 值类型 */
  item?: TypeAtom
  /** map → 键类型（默认 string） */
  key?: 'string' | 'number'
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
  /** 关联数据表名（可选） */
  tableName: string
  /**
   * 类型用途分类：
   * entity 实体 / dto 数据传输对象 / vo 视图对象 / other 其它
   */
  category: DataTypeCategory
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
    tableName: '',
    category: 'other',
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

export const COMMON_GROUP_NAME = 'common'

/** 系统预设类型 id（不可修改 / 删除） */
export const COMMON_PRESET_TYPE_IDS = [
  'type_common_ResultCode',
  'type_common_Result',
  'type_common_QueryPageDto',
  'type_common_QueryPageVo',
  'type_common_URI',
] as const

/** 系统预设类型名 */
export const COMMON_PRESET_TYPE_NAMES = [
  'ResultCode',
  'Result',
  'QueryPageDto',
  'QueryPageVo',
  'URI',
] as const

const COMMON_PRESET_ID_SET = new Set<string>(COMMON_PRESET_TYPE_IDS)
const COMMON_PRESET_NAME_SET = new Set<string>(COMMON_PRESET_TYPE_NAMES)

/** 是否为系统预设类型（按稳定 id；仅这些只读） */
export function isSystemCommonType(
  type: Pick<DataTypeDef, 'id' | 'name'> | null | undefined,
): boolean {
  if (!type?.id) return false
  return COMMON_PRESET_ID_SET.has(type.id)
}

/** 是否占用了系统预设类型名（新建 / 重命名时禁止） */
export function isReservedCommonTypeName(name: string): boolean {
  return COMMON_PRESET_NAME_SET.has(name.trim())
}

function typeAtomExpr(
  kind: Exclude<TypeAtomKind, 'array'>,
  ref?: string,
): TypeExpr {
  return {
    intersections: [
      {
        alternatives: [
          kind === 'named' || kind === 'generic'
            ? { kind, ref: ref ?? '' }
            : { kind },
        ],
      },
    ],
  }
}

/** 数组类型：如 T[] */
function typeArrayExpr(item: TypeAtom): TypeExpr {
  return {
    intersections: [{ alternatives: [{ kind: 'array', item }] }],
  }
}

function field(
  id: string,
  name: string,
  type: TypeExpr,
  remark = '',
): InterfaceField {
  return { id, name, type, remark, optional: false }
}

/** 系统预设：common 分组（Result / 分页等） */
export function createCommonDataTypeGroup(): DataTypeGroup {
  const resultCodeId = 'type_common_ResultCode'
  const resultId = 'type_common_Result'
  const queryPageDtoId = 'type_common_QueryPageDto'
  const queryPageVoId = 'type_common_QueryPageVo'

  const resultCode: DataTypeDef = {
    id: resultCodeId,
    name: 'ResultCode',
    kind: 'enum',
    remark: '通用响应码',
    tableName: '',
    category: 'other',
    generics: [],
    fields: [],
    enumMembers: [
      { id: 'enum_common_ResultCode_OK', name: 'OK', value: '200' },
      { id: 'enum_common_ResultCode_BAD_REQUEST', name: 'BAD_REQUEST', value: '400' },
      {
        id: 'enum_common_ResultCode_INTERNAL_ERROR',
        name: 'INTERNAL_ERROR',
        value: '500',
      },
    ],
    combination: createEmptyTypeExpr(),
  }

  const result: DataTypeDef = {
    id: resultId,
    name: 'Result',
    kind: 'interface',
    remark: '通用响应包装',
    tableName: '',
    category: 'other',
    generics: [
      {
        id: 'gen_common_Result_T',
        name: 'T',
        constraint: null,
        default: null,
      },
    ],
    fields: [
      field(
        'field_common_Result_code',
        'code',
        typeAtomExpr('named', resultCodeId),
        '响应码',
      ),
      field(
        'field_common_Result_message',
        'message',
        typeAtomExpr('string'),
        '提示信息',
      ),
      field(
        'field_common_Result_error',
        'error',
        typeAtomExpr('string'),
        '错误信息',
      ),
      field(
        'field_common_Result_data',
        'data',
        typeAtomExpr('generic', 'T'),
        '业务数据',
      ),
    ],
    enumMembers: [],
    combination: createEmptyTypeExpr(),
  }

  const queryPageDto: DataTypeDef = {
    id: queryPageDtoId,
    name: 'QueryPageDto',
    kind: 'interface',
    remark: '分页查询入参',
    tableName: '',
    category: 'dto',
    generics: [],
    fields: [
      field(
        'field_common_QueryPageDto_current',
        'current',
        typeAtomExpr('number'),
        '当前页',
      ),
      field(
        'field_common_QueryPageDto_pageSize',
        'pageSize',
        typeAtomExpr('number'),
        '每页条数',
      ),
    ],
    enumMembers: [],
    combination: createEmptyTypeExpr(),
  }

  const queryPageVo: DataTypeDef = {
    id: queryPageVoId,
    name: 'QueryPageVo',
    kind: 'interface',
    remark: '分页查询出参',
    tableName: '',
    category: 'vo',
    generics: [
      {
        id: 'gen_common_QueryPageVo_T',
        name: 'T',
        constraint: null,
        default: null,
      },
    ],
    fields: [
      field(
        'field_common_QueryPageVo_current',
        'current',
        typeAtomExpr('number'),
        '当前页',
      ),
      field(
        'field_common_QueryPageVo_pageSize',
        'pageSize',
        typeAtomExpr('number'),
        '每页条数',
      ),
      field(
        'field_common_QueryPageVo_hasNext',
        'hasNext',
        typeAtomExpr('boolean'),
        '是否有下一页',
      ),
      field(
        'field_common_QueryPageVo_total',
        'total',
        typeAtomExpr('number'),
        '总条数',
      ),
      field(
        'field_common_QueryPageVo_records',
        'records',
        typeArrayExpr({ kind: 'generic', ref: 'T' }),
        '当前页数据',
      ),
    ],
    enumMembers: [],
    combination: createEmptyTypeExpr(),
  }

  const uri: DataTypeDef = {
    id: 'type_common_URI',
    name: 'URI',
    kind: 'string',
    remark: '资源外链（type URI = string）',
    tableName: '',
    category: 'other',
    generics: [],
    fields: [],
    enumMembers: [],
    combination: createEmptyTypeExpr(),
  }

  return {
    id: 'group_common',
    name: COMMON_GROUP_NAME,
    types: [resultCode, result, queryPageDto, queryPageVo, uri],
  }
}

/** 保证 common 在最前；缺失则插入；系统 id 类型与预设同步 */
export function ensureCommonGroupFirst(groups: DataTypeGroup[]): DataTypeGroup[] {
  const preset = createCommonDataTypeGroup()
  const idx = groups.findIndex((g) => g.name === COMMON_GROUP_NAME)
  if (idx < 0) {
    return [preset, ...groups]
  }
  const existing = groups[idx]!
  const presetById = new Map(preset.types.map((t) => [t.id, t]))
  const presetByName = new Map(preset.types.map((t) => [t.name, t]))
  const seenNames = new Set<string>()
  const nextTypes: DataTypeDef[] = []

  for (const t of existing.types) {
    const sys = presetById.get(t.id) ?? presetByName.get(t.name)
    if (sys && (t.id === sys.id || t.name === sys.name)) {
      nextTypes.push(JSON.parse(JSON.stringify(sys)) as DataTypeDef)
      seenNames.add(sys.name)
    } else {
      nextTypes.push(t)
      if (t.name) seenNames.add(t.name)
    }
  }
  for (const t of preset.types) {
    if (!seenNames.has(t.name)) {
      nextTypes.push(JSON.parse(JSON.stringify(t)) as DataTypeDef)
      seenNames.add(t.name)
    }
  }

  const merged: DataTypeGroup = {
    ...existing,
    id: existing.id || preset.id,
    types: nextTypes,
  }
  const changed =
    idx !== 0 ||
    JSON.stringify(existing.types) !== JSON.stringify(merged.types)
  if (!changed) return groups
  const rest = groups.filter((_, i) => i !== idx)
  return [merged, ...rest]
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
  return kind === 'interface' || kind === 'enum'
}

export function kindLabel(kind: DataTypeKind): string {
  return DATA_TYPE_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind
}

export function categoryLabel(category: DataTypeCategory): string {
  return DATA_TYPE_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category
}

function normalizeCategory(input: unknown): DataTypeCategory {
  const raw = typeof input === 'string' ? input.trim() : ''
  return DATA_TYPE_CATEGORY_OPTIONS.some((o) => o.value === raw)
    ? (raw as DataTypeCategory)
    : 'other'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAtom(input: unknown): TypeAtom {
  if (!isPlainObject(input)) return createEmptyTypeAtom()
  let kind = String(input.kind ?? 'string') as TypeAtomKind | 'unknown'
  if ((kind as string) === 'dict') kind = 'map'
  // 旧版 unknown → any；不再支持
  if (kind === 'unknown') kind = 'any'
  const allowed: TypeAtomKind[] = [
    'number',
    'string',
    'boolean',
    'time',
    'date',
    'datetime',
    'named',
    'generic',
    'any',
    'array',
    'map',
  ]
  const safeKind = allowed.includes(kind as TypeAtomKind)
    ? (kind as TypeAtomKind)
    : 'string'
  if (safeKind === 'array') {
    return {
      kind: 'array',
      item: input.item != null ? normalizeAtom(input.item) : { kind: 'any' },
    }
  }
  if (safeKind === 'map') {
    return {
      kind: 'map',
      key: input.key === 'number' ? 'number' : 'string',
      item: input.item != null ? normalizeAtom(input.item) : { kind: 'any' },
    }
  }
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
  // 仅保留单原子类型，丢弃旧版 | / & 组合
  const firstUnion = normalizeUnion(input.intersections[0])
  const firstAtom = firstUnion.alternatives[0] ?? createEmptyTypeAtom()
  return { intersections: [{ alternatives: [firstAtom] }] }
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
  let kindRaw = String(input.kind ?? 'string')
  // 旧版「组合」迁移为接口
  if (kindRaw === 'combination') kindRaw = 'interface'
  const kind = DATA_TYPE_KIND_OPTIONS.some((o) => o.value === kindRaw)
    ? (kindRaw as DataTypeKind)
    : 'string'
  const generics = Array.isArray(input.generics)
    ? input.generics.map(normalizeGeneric).filter((x): x is TypeGenericParam => Boolean(x))
    : []
  let fields = Array.isArray(input.fields)
    ? input.fields.map(normalizeField).filter((x): x is InterfaceField => Boolean(x))
    : []
  if (kind === 'interface' && !fields.length) {
    fields = [createEmptyInterfaceField()]
  }
  const enumMembers = Array.isArray(input.enumMembers)
    ? input.enumMembers.map(normalizeEnumMember).filter((x): x is EnumMember => Boolean(x))
    : []
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('type'),
    name: typeof input.name === 'string' ? input.name.trim() : '',
    kind,
    remark: typeof input.remark === 'string' ? input.remark : '',
    tableName: typeof input.tableName === 'string' ? input.tableName.trim() : '',
    category: kind === 'enum' ? 'other' : normalizeCategory(input.category),
    generics,
    fields,
    enumMembers,
    combination: createEmptyTypeExpr(),
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

/** 未选择类型（清空后） */
export function createEmptyClearedTypeExpr(): TypeExpr {
  return { intersections: [] }
}

export function isTypeExprCleared(expr: TypeExpr): boolean {
  return !expr.intersections[0]?.alternatives[0]
}

/** 字段类型下拉：仅单原子；清空时返回空字符串 */
export function typeExprToSelectValue(expr: TypeExpr): string {
  if (isTypeExprCleared(expr)) return ''
  const atom = expr.intersections[0]!.alternatives[0]!
  if (atom.kind === 'array') {
    const item = atom.item ?? { kind: 'any' as const }
    const inner =
      item.kind === 'named'
        ? `named:${item.ref ?? ''}`
        : item.kind === 'generic'
          ? `generic:${item.ref ?? ''}`
          : item.kind
    return `array:${inner}`
  }
  if (atom.kind === 'map') {
    const key = atom.key === 'number' ? 'number' : 'string'
    const item = atom.item ?? { kind: 'any' as const }
    const inner =
      item.kind === 'named'
        ? `named:${item.ref ?? ''}`
        : item.kind === 'generic'
          ? `generic:${item.ref ?? ''}`
          : item.kind
    return `map:${key}:${inner}`
  }
  if (atom.kind === 'named') return `named:${atom.ref ?? ''}`
  if (atom.kind === 'generic') return `generic:${atom.ref ?? ''}`
  return atom.kind
}

export function selectValueToTypeExpr(value: string): TypeExpr {
  if (!value) return createEmptyClearedTypeExpr()
  if (value.startsWith('array:')) {
    const inner = selectValueToTypeExpr(value.slice(6))
    const item = inner.intersections[0]?.alternatives[0] ?? { kind: 'any' as const }
    return typeArrayExpr(item)
  }
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
  if (value.startsWith('map:')) {
    const rest = value.slice(4)
    const colon = rest.indexOf(':')
    const keyRaw = colon >= 0 ? rest.slice(0, colon) : 'string'
    const innerRaw = colon >= 0 ? rest.slice(colon + 1) : 'any'
    const inner = selectValueToTypeExpr(innerRaw)
    const item =
      inner.intersections[0]?.alternatives[0] ?? ({ kind: 'any' } as const)
    return {
      intersections: [
        {
          alternatives: [
            {
              kind: 'map',
              key: keyRaw === 'number' ? 'number' : 'string',
              item,
            },
          ],
        },
      ],
    }
  }
  const kind = value as TypeAtomKind
  const allowed: TypeAtomKind[] = [
    'number',
    'string',
    'boolean',
    'time',
    'date',
    'datetime',
    'any',
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

function formatAtomPreview(
  atom: TypeAtom,
  namedLookup?: (id: string) => string,
): string {
  if (atom.kind === 'array') {
    return `${formatAtomPreview(atom.item ?? { kind: 'any' }, namedLookup)}[]`
  }
  if (atom.kind === 'named') {
    const id = atom.ref ?? ''
    return namedLookup?.(id) || id || '?'
  }
  if (atom.kind === 'generic') return atom.ref || 'T'
  return atom.kind
}

/** 将类型表达式格式化为简短预览（用于表格） */
export function formatTypeExprPreview(
  expr: TypeExpr,
  namedLookup?: (id: string) => string,
): string {
  if (isTypeExprCleared(expr)) return '—'
  const atom = expr.intersections[0]!.alternatives[0]!
  return formatAtomPreview(atom, namedLookup)
}

/** 剥掉外层数组，得到元素原子类型 */
export function unwrapArrayAtom(atom: TypeAtom): TypeAtom {
  let cur = atom
  while (cur.kind === 'array' && cur.item) cur = cur.item
  return cur
}

export function cloneTypeExpr(expr: TypeExpr): TypeExpr {
  return JSON.parse(JSON.stringify(expr)) as TypeExpr
}

export function cloneDataTypeDef(def: DataTypeDef): DataTypeDef {
  return JSON.parse(JSON.stringify(def)) as DataTypeDef
}
