import {
  defaultValue,
  type ArraySubField,
  type DataFieldType,
  type DataFieldValue,
  type ObjectSubField,
} from '../types/page-data'
import type { DataTypeLibrary } from '../types/data-types'
import {
  findDataTypeDef,
  objectFieldsFromTypeRef,
} from './named-type-fields'
import {
  buildDataTypeTsContext,
  dataTypeToTs,
} from './data-type-ts'

/** 特殊类型包装器（静态标注，非运行时调用） */
export const SPECIAL_WRAPPERS = [
  'Color',
  'Time',
  'Date',
  'Datetime',
  'Icon',
  'Resource',
] as const

export type SpecialWrapper = (typeof SPECIAL_WRAPPERS)[number]

export type ObjectTsCodeOptions = {
  typeLibrary?: DataTypeLibrary | null
}

export type ArrayTsCodeOptions = ObjectTsCodeOptions & {
  itemType?: DataFieldType
  itemTypeRef?: string
}

const WRAPPER_TO_TYPE: Record<SpecialWrapper, DataFieldType> = {
  Color: 'color',
  Time: 'time',
  Date: 'date',
  Datetime: 'datetime',
  Icon: 'icon',
  Resource: 'resource',
}

const TYPE_TO_WRAPPER: Partial<Record<DataFieldType, SpecialWrapper>> = {
  color: 'Color',
  time: 'Time',
  date: 'Date',
  datetime: 'Datetime',
  icon: 'Icon',
  resource: 'Resource',
}

const MARKER = '__voiderSpecial'
const NAMED_MARKER = '__voiderNamed'

/** 格式化/解析时使用的类型库（避免层层传参） */
let activeTypeLibrary: DataTypeLibrary | null = null

function withTypeLibrary<T>(
  library: DataTypeLibrary | null | undefined,
  fn: () => T,
): T {
  const prev = activeTypeLibrary
  activeTypeLibrary = library ?? null
  try {
    return fn()
  } finally {
    activeTypeLibrary = prev
  }
}

/** Monaco ambient：仅声明包装函数，关闭其它全局提示时配合 noLib */
export const OBJECT_TS_AMBIENT_ALIASES = SPECIAL_WRAPPERS.map(
  (name) => `declare function ${name}(value: string): string;`,
).join('\n')

function sanitizeConstName(name: string | undefined | null): string {
  const n = (name ?? '').trim() || 'value'
  return /^[A-Za-z_$][\w$]*$/.test(n) ? n : 'value'
}

function isIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

function formatKey(name: string): string {
  return isIdent(name) ? name : JSON.stringify(name)
}

function escapeString(value: string): string {
  return JSON.stringify(value)
}

function wrapperForType(type: DataFieldType): SpecialWrapper | null {
  return TYPE_TO_WRAPPER[type] ?? null
}

function typeForWrapper(name: string): DataFieldType | null {
  // 兼容旧代码里的 URI(...)
  if (name === 'URI') return 'resource'
  if ((SPECIAL_WRAPPERS as readonly string[]).includes(name)) {
    return WRAPPER_TO_TYPE[name as SpecialWrapper]
  }
  return null
}

/** typeRef → 代码里的 @group.TypeName */
export function namedTypeDisplayName(
  typeRef?: string | null,
  library?: DataTypeLibrary | null,
): string | null {
  return namedTypeDisplayPath(typeRef, library)
}

/** typeRef → `common.QueryPageDto`（含分组） */
export function namedTypeDisplayPath(
  typeRef?: string | null,
  library?: DataTypeLibrary | null,
): string | null {
  const ref = typeRef?.trim()
  if (!ref) return null
  const lib = library ?? activeTypeLibrary
  for (const group of lib?.groups ?? []) {
    const found = group.types.find((t) => t.id === ref)
    const typeName = found?.name?.trim()
    const groupName = group.name?.trim()
    if (typeName && isIdent(typeName) && groupName && isIdent(groupName)) {
      return `${groupName}.${typeName}`
    }
    if (typeName && isIdent(typeName)) return typeName
  }
  if (isIdent(ref)) return ref
  return null
}

/**
 * `@common.QueryPageDto` / `@QueryPageDto` → typeRef id
 * path 可为 `group.Name` 或仅 `Name`（兼容旧写法）
 */
export function namedTypeRefFromName(
  typeName: string,
  library?: DataTypeLibrary | null,
  preferredRef?: string | null,
): string {
  const path = typeName.trim()
  const lib = library ?? activeTypeLibrary
  const preferred = preferredRef?.trim()

  const dot = path.indexOf('.')
  if (dot > 0) {
    const groupName = path.slice(0, dot)
    const name = path.slice(dot + 1)
    if (isIdent(groupName) && isIdent(name)) {
      if (preferred) {
        for (const group of lib?.groups ?? []) {
          if (group.name !== groupName) continue
          const def = group.types.find((t) => t.id === preferred)
          if (def?.name?.trim() === name) return preferred
        }
      }
      for (const group of lib?.groups ?? []) {
        if (group.name !== groupName) continue
        const found = group.types.find((t) => t.name?.trim() === name)
        if (found) return found.id
      }
    }
  }

  const name = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : path
  if (preferred) {
    const def = findDataTypeDef(lib, preferred)
    if (def?.name?.trim() === name) return preferred
  }
  for (const group of lib?.groups ?? []) {
    const found = group.types.find((t) => t.name?.trim() === name)
    if (found) return found.id
  }
  return preferred || path
}

/** 收集可作为 @group.TypeName 的路径 */
export function collectNamedTypeNames(
  library?: DataTypeLibrary | null,
): string[] {
  return collectNamedTypeEntries(library).map((e) => e.path)
}

export type NamedTypeCodeEntry = {
  path: string
  kind: 'interface' | 'enum'
  typeRef: string
}

export function collectNamedTypeEntries(
  library?: DataTypeLibrary | null,
): NamedTypeCodeEntry[] {
  const entries: NamedTypeCodeEntry[] = []
  const seen = new Set<string>()
  for (const group of library?.groups ?? []) {
    const groupName = group.name?.trim()
    if (!groupName || !isIdent(groupName)) continue
    for (const t of group.types ?? []) {
      const n = t.name?.trim()
      if (!n || !isIdent(n)) continue
      if (t.kind !== 'interface' && t.kind !== 'enum') continue
      const path = `${groupName}.${n}`
      if (seen.has(path)) continue
      seen.add(path)
      entries.push({ path, kind: t.kind, typeRef: t.id })
    }
  }
  return entries
}

export function collectNamedTypePaths(
  library?: DataTypeLibrary | null,
): string[] {
  return collectNamedTypeEntries(library).map((e) => e.path)
}

export function isNamedEnumTypeRef(
  typeRef?: string | null,
  library?: DataTypeLibrary | null,
): boolean {
  const ref = typeRef?.trim()
  if (!ref) return false
  const def = findDataTypeDef(library ?? activeTypeLibrary, ref)
  return def?.kind === 'enum'
}

/** 光标落在 `@group.Type` 上时，解析对应具名类型 */
export function findNamedTypeAtOffset(
  full: string,
  offset: number,
  library?: DataTypeLibrary | null,
): {
  path: string
  typeRef: string
  kind: 'interface' | 'enum'
  start: number
  end: number
} | null {
  const normalized = full.replace(/\r\n/g, '\n')
  const lib = library ?? activeTypeLibrary
  let i = 0
  while (i < normalized.length) {
    const ch = normalized[i]!
    if (ch === '"' || ch === "'") {
      i = skipStringAt(normalized, i)
      continue
    }
    if (ch === '@' && /[A-Za-z_$]/.test(normalized[i + 1] ?? '')) {
      const scanned = scanAtQualifiedPath(normalized, i)
      if (scanned) {
        if (offset >= i && offset < scanned.end) {
          const entry = collectNamedTypeEntries(lib).find(
            (e) => e.path === scanned.path,
          )
          if (!entry) return null
          return {
            path: entry.path,
            typeRef: entry.typeRef,
            kind: entry.kind,
            start: i,
            end: scanned.end,
          }
        }
        i = scanned.end
        continue
      }
    }
    i += 1
  }
  return null
}

/** 具名类型定义的 TypeScript 源码（供悬停预览） */
export function formatNamedTypeDefinitionSource(
  typeRef: string,
  library?: DataTypeLibrary | null,
): string | null {
  const lib = library ?? activeTypeLibrary
  const def = findDataTypeDef(lib, typeRef)
  if (!def) return null
  const ctx = buildDataTypeTsContext(lib ?? { groups: [] })
  return dataTypeToTs(def, ctx).trimEnd()
}

/** 枚举成员可选项（存 name） */
export function enumMemberOptions(
  typeRef?: string | null,
  library?: DataTypeLibrary | null,
): Array<{ label: string; value: string }> {
  const ref = typeRef?.trim()
  if (!ref) return []
  const def = findDataTypeDef(library ?? activeTypeLibrary, ref)
  if (!def || def.kind !== 'enum') return []
  return def.enumMembers
    .map((m) => m.name.trim())
    .filter(Boolean)
    .map((name) => ({ label: name, value: name }))
}

export function defaultEnumMemberValue(
  typeRef?: string | null,
  library?: DataTypeLibrary | null,
): string {
  return enumMemberOptions(typeRef, library)[0]?.value ?? ''
}

/** 从 `@` 起扫描限定名：group.Type 或 Type，返回 path 与结束下标 */
function scanAtQualifiedPath(
  src: string,
  atIndex: number,
): { path: string; end: number } | null {
  if (src[atIndex] !== '@') return null
  let i = atIndex + 1
  if (!/[A-Za-z_$]/.test(src[i] ?? '')) return null
  const parts: string[] = []
  while (i < src.length) {
    if (!/[A-Za-z_$]/.test(src[i]!)) break
    const start = i
    i += 1
    while (i < src.length && /[\w$]/.test(src[i]!)) i += 1
    parts.push(src.slice(start, i))
    if (src[i] === '.') {
      i += 1
      continue
    }
    break
  }
  if (!parts.length) return null
  return { path: parts.join('.'), end: i }
}

type ValueExprField = {
  type: DataFieldType
  value?: DataFieldValue
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  objectFields?: ObjectSubField[]
  arrayFields?: ArraySubField[]
}

/** 按字段类型写出静态值表达式 */
export function formatFieldValueExpr(
  field: ObjectSubField | ValueExprField,
  indent = 0,
): string {
  const wrap = wrapperForType(field.type)

  if (wrap) {
    const raw =
      field.value == null ? '' : String(field.value as string | number | boolean)
    return `${wrap}(${escapeString(raw)})`
  }

  // 具名枚举：@common.ResultCode("OK")
  if (field.typeRef?.trim() && isNamedEnumTypeRef(field.typeRef)) {
    const path = namedTypeDisplayPath(field.typeRef)
    const raw =
      field.value == null ? '' : String(field.value as string | number | boolean)
    if (path) return `@${path}(${escapeString(raw)})`
  }

  if (field.type === 'json') {
    const kids = field.objectFields ?? []
    let body: string
    if (kids.length) {
      body = formatFieldsObjectLiteral(kids, indent)
    } else {
      const v = field.value
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        body = formatPlainObject(v as Record<string, unknown>, indent)
      } else {
        body = '{}'
      }
    }
    const typePath = namedTypeDisplayPath(field.typeRef)
    if (typePath) return `@${typePath}(${body})`
    return body
  }

  if (field.type === 'array') {
    if (field.arrayFields?.length) {
      return formatArrayFieldsLiteral(field.arrayFields, indent)
    }
    const v = Array.isArray(field.value) ? field.value : []
    return formatJsLiteral(v, indent)
  }

  if (field.type === 'map') {
    const v =
      field.value && typeof field.value === 'object' && !Array.isArray(field.value)
        ? (field.value as Record<string, unknown>)
        : {}
    return formatPlainObject(v, indent)
  }

  return formatJsLiteral(
    field.value !== undefined ? field.value : defaultValue(field.type),
    indent,
  )
}

export function formatArrayFieldsLiteral(
  items: ArraySubField[],
  indent = 0,
): string {
  const pad = ' '.repeat(indent)
  if (!items.length) return indent === 0 ? '[\n  \n]' : '[]'
  const lines = items.map(
    (item) =>
      `${' '.repeat(indent + 2)}${formatFieldValueExpr(item, indent + 2)}`,
  )
  return `[\n${lines.join(',\n')}\n${pad}]`
}

export function formatJsLiteral(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)
  if (value === null) return 'null'
  if (typeof value === 'string') return escapeString(value)
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null'
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    const items = value.map(
      (item) => `${' '.repeat(indent + 2)}${formatJsLiteral(item, indent + 2)}`,
    )
    return `[\n${items.join(',\n')}\n${pad}]`
  }
  if (value && typeof value === 'object') {
    return formatPlainObject(value as Record<string, unknown>, indent)
  }
  return 'null'
}

function formatPlainObject(
  value: Record<string, unknown>,
  indent = 0,
): string {
  const pad = ' '.repeat(indent)
  const innerPad = ' '.repeat(indent + 2)
  const keys = Object.keys(value)
  if (!keys.length) return '{}'
  const lines = keys.map(
    (k) => `${innerPad}${formatKey(k)}: ${formatJsLiteral(value[k], indent + 2)}`,
  )
  if (indent === 0) return `{\n${lines.join(',\n')}\n}`
  return `{\n${lines.join(',\n')}\n${pad}}`
}

export function formatFieldsObjectLiteral(
  fields: ObjectSubField[],
  indent = 0,
): string {
  const pad = ' '.repeat(indent)
  const innerPad = ' '.repeat(indent + 2)
  const named = fields.filter((f) => f.name.trim())
  if (!named.length) return indent === 0 ? '{\n  \n}' : '{}'
  const lines = named.map((f) => {
    const expr = formatFieldValueExpr(f, indent + 2)
    return `${innerPad}${formatKey(f.name.trim())}: ${expr}`
  })
  if (indent === 0) return `{\n${lines.join(',\n')}\n}`
  return `{\n${lines.join(',\n')}\n${pad}}`
}

export function composeObjectTsCode(
  fields: ObjectSubField[],
  _value?: Record<string, unknown>,
  constName?: string | null,
  options?: ObjectTsCodeOptions,
): string {
  return withTypeLibrary(options?.typeLibrary, () => {
    const name = sanitizeConstName(constName)
    // 优先按 fields 元数据输出（含特殊类型 / @具名类型包装）；无结构时退回纯 value
    if (fields.length) {
      return `const ${name} = ${formatFieldsObjectLiteral(fields, 0)}`
    }
    const value = _value ?? {}
    return `const ${name} = ${formatPlainObject(value, 0)}`
  })
}

/** 兼容旧调用：仅 header 无意义，返回 `const name = ` */
export function buildObjectTsHeader(
  _fields: ObjectSubField[],
  constName?: string | null,
): string {
  return `const ${sanitizeConstName(constName)} = `
}

export function extractObjectTsValueLiteral(full: string): string | null {
  const text = full.replace(/\r\n/g, '\n').trim()
  const m = text.match(/^const\s+[A-Za-z_$][\w$]*\s*=\s*/)
  if (!m) return null
  const lit = text.slice(m[0].length).trim()
  if (!lit.startsWith('{')) return null
  return lit
}

/**
 * 去掉字符串字面量，便于静态检查（用空格占位保持长度可选，这里直接删除内容）
 */
function stripStringLiterals(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '"' || ch === "'") {
      const quote = ch
      out += '""'
      i += 1
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (ch === '`') {
      // 模板字符串一律不允许
      out += '`'
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 校验：仅静态字面量 + 特殊类型包装器 + @具名类型包装器 */
export function validateStaticObjectExpr(expr: string): string | null {
  const raw = expr.trim()
  if (!raw.startsWith('{')) return '需要对象字面量 { ... }'
  if (/`/.test(raw)) return '不允许使用模板字符串'
  if (/\bnew\s+/.test(raw)) return '不允许使用 new（只能写静态数据）'
  if (/\bfunction\b|\b=>\b/.test(raw)) return '不允许使用函数'

  let transformed: string
  try {
    transformed = stripAllowedWrappers(raw)
  } catch (e) {
    return e instanceof Error ? e.message : '包装器语法错误'
  }

  const stripped = stripStringLiterals(transformed)
  if (/\b[A-Za-z_$][\w$]*\s*\(/.test(stripped)) {
    return '不允许调用方法或创建对象，只能写静态数据（特殊类型用 Color()；自定义类型用 @common.GoodsItem({...})）'
  }
  if (/@/.test(stripped)) {
    return '自定义类型须写成 @group.Type({ ... }) 或 @group.Enum("成员")'
  }
  if (/\bnew\b/.test(stripped)) return '不允许使用 new'
  return null
}

/** 去掉合法包装器，便于检查是否还有非法调用 */
function stripAllowedWrappers(src: string): string {
  // 先去掉特殊类型 Color("...")
  const wrapperNames = [...SPECIAL_WRAPPERS, 'URI']
  const wrapperRe = new RegExp(
    `\\b(${wrapperNames.join('|')})\\s*\\(\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')\\s*\\)`,
    'g',
  )
  const illegalWrapperArg = new RegExp(
    `\\b(${wrapperNames.join('|')})\\s*\\((?!\\s*["'])`,
  )
  if (illegalWrapperArg.test(src)) {
    throw new Error('特殊类型包装器只能传入字符串字面量，例如 Color("#fff")')
  }
  let transformed = src.replace(wrapperRe, '0')
  // 再去掉 @TypeName({...})
  transformed = stripNamedTypeCalls(transformed)
  return transformed
}

/**
 * 扫描并去掉 @Type(...)，替换为 0。
 * 对象类型参数为 { ... }；枚举参数为字符串字面量。
 */
function stripNamedTypeCalls(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '"' || ch === "'") {
      const quote = ch
      out += ch
      i += 1
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i]! + (src[i + 1] ?? '')
          i += 2
          continue
        }
        out += src[i]!
        if (src[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (ch === '@' && /[A-Za-z_$]/.test(src[i + 1] ?? '')) {
      const scanned = scanAtQualifiedPath(src, i)
      if (!scanned) {
        out += ch
        i += 1
        continue
      }
      const typePath = scanned.path
      let k = scanned.end
      while (k < src.length && /\s/.test(src[k]!)) k += 1
      if (src[k] !== '(') {
        throw new Error(`自定义类型 @${typePath} 后需要 (...)`)
      }
      k += 1
      const argStart = k
      let depth = 1
      while (k < src.length && depth > 0) {
        const c = src[k]!
        if (c === '"' || c === "'") {
          const quote = c
          k += 1
          while (k < src.length) {
            if (src[k] === '\\') {
              k += 2
              continue
            }
            if (src[k] === quote) {
              k += 1
              break
            }
            k += 1
          }
          continue
        }
        if (c === '(') depth += 1
        else if (c === ')') {
          depth -= 1
          if (depth === 0) break
        }
        k += 1
      }
      if (depth !== 0) {
        throw new Error(`@${typePath}(...) 括号未闭合`)
      }
      const arg = src.slice(argStart, k).trim()
      const isObj = arg.startsWith('{') && arg.endsWith('}')
      const isStr =
        (arg.startsWith('"') && arg.endsWith('"')) ||
        (arg.startsWith("'") && arg.endsWith("'"))
      if (!isObj && !isStr) {
        throw new Error(
          `自定义类型须写成 @${typePath}({ ... }) 或 @${typePath}("成员")`,
        )
      }
      if (isObj) stripNamedTypeCalls(arg)
      i = k + 1
      out += '0'
      continue
    }
    out += ch
    i += 1
  }
  return out
}

function parseStringLiteral(lit: string): string {
  if (lit.startsWith('"')) {
    try {
      return JSON.parse(lit) as string
    } catch {
      return lit.slice(1, -1)
    }
  }
  // 单引号
  return lit
    .slice(1, -1)
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
}

function transformWrappersToMarkers(src: string): string {
  const wrapperNames = [...SPECIAL_WRAPPERS, 'URI']
  const wrapperRe = new RegExp(
    `\\b(${wrapperNames.join('|')})\\s*\\(\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')\\s*\\)`,
    'g',
  )
  const withSpecial = src.replace(wrapperRe, (_, name: string, lit: string) => {
    const value = parseStringLiteral(lit)
    return `({${MARKER}:true,t:${JSON.stringify(name)},v:${JSON.stringify(value)}})`
  })
  return transformNamedTypeWrappers(withSpecial)
}

/** @group.TypeName({...}) → ({__voiderNamed:true,n:"group.TypeName",v:{...}}) */
function transformNamedTypeWrappers(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '"' || ch === "'") {
      const quote = ch
      out += ch
      i += 1
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i]! + (src[i + 1] ?? '')
          i += 2
          continue
        }
        out += src[i]!
        if (src[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (ch === '@' && /[A-Za-z_$]/.test(src[i + 1] ?? '')) {
      const scanned = scanAtQualifiedPath(src, i)
      if (!scanned) {
        out += ch
        i += 1
        continue
      }
      const typePath = scanned.path
      let k = scanned.end
      while (k < src.length && /\s/.test(src[k]!)) k += 1
      if (src[k] !== '(') {
        out += src.slice(i, scanned.end)
        i = scanned.end
        continue
      }
      k += 1
      const argStart = k
      let depth = 1
      while (k < src.length && depth > 0) {
        const c = src[k]!
        if (c === '"' || c === "'") {
          const quote = c
          k += 1
          while (k < src.length) {
            if (src[k] === '\\') {
              k += 2
              continue
            }
            if (src[k] === quote) {
              k += 1
              break
            }
            k += 1
          }
          continue
        }
        if (c === '(') depth += 1
        else if (c === ')') {
          depth -= 1
          if (depth === 0) break
        }
        k += 1
      }
      if (depth !== 0) throw new Error(`@${typePath}(...) 括号未闭合`)
      const arg = src.slice(argStart, k).trim()
      if (
        (arg.startsWith('"') && arg.endsWith('"')) ||
        (arg.startsWith("'") && arg.endsWith("'"))
      ) {
        const value = parseStringLiteral(arg)
        out += `({${NAMED_MARKER}:true,n:${JSON.stringify(typePath)},v:${JSON.stringify(value)}})`
      } else {
        const inner = transformNamedTypeWrappers(arg)
        out += `({${NAMED_MARKER}:true,n:${JSON.stringify(typePath)},v:${inner}})`
      }
      i = k + 1
      continue
    }
    out += ch
    i += 1
  }
  return out
}

type MarkerObj = { [MARKER]: true; t: string; v: string }
type NamedMarkerObj = {
  [NAMED_MARKER]: true
  n: string
  v: Record<string, unknown> | string
}

function isMarker(v: unknown): v is MarkerObj {
  return Boolean(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      (v as MarkerObj)[MARKER] === true,
  )
}

function isNamedMarker(v: unknown): v is NamedMarkerObj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const m = v as NamedMarkerObj
  if (m[NAMED_MARKER] !== true || typeof m.n !== 'string') return false
  if (typeof m.v === 'string') return true
  return Boolean(m.v && typeof m.v === 'object' && !Array.isArray(m.v))
}

function valueToFields(
  value: Record<string, unknown>,
  previous?: ObjectSubField[],
): ObjectSubField[] {
  const prevByName = new Map(
    (previous ?? []).filter((f) => f.name.trim()).map((f) => [f.name.trim(), f]),
  )
  return Object.keys(value).map((name) =>
    decodeValueToField(name, value[name], prevByName.get(name)),
  )
}

function decodeValueToField(
  name: string,
  raw: unknown,
  prev?: ObjectSubField,
): ObjectSubField {
  if (isMarker(raw)) {
    const type = typeForWrapper(raw.t) || 'string'
    return {
      name,
      type,
      value: raw.v,
    }
  }
  if (isNamedMarker(raw)) {
    const typeRef = namedTypeRefFromName(raw.n, activeTypeLibrary, prev?.typeRef)
    if (typeof raw.v === 'string') {
      return {
        name,
        type: 'string',
        typeRef,
        value: raw.v,
      }
    }
    const kids = valueToFields(raw.v, prev?.objectFields)
    return {
      name,
      type: 'json',
      typeRef,
      objectFields: kids,
    }
  }
  if (typeof raw === 'boolean') return { name, type: 'boolean', value: raw }
  if (typeof raw === 'number') return { name, type: 'number', value: raw }
  if (raw === null) return { name, type: 'any', value: null }
  if (Array.isArray(raw)) {
    return {
      name,
      type: 'array',
      itemType: prev?.itemType || 'any',
      itemTypeRef: prev?.itemTypeRef,
      value: raw.map((item) => decodeMarkerDeep(item)) as DataFieldValue,
      arrayFields: decodeArrayItems(raw, prev?.arrayFields, prev?.itemTypeRef),
    }
  }
  if (raw && typeof raw === 'object') {
    const kids = valueToFields(raw as Record<string, unknown>, prev?.objectFields)
    return {
      name,
      type: 'json',
      typeRef: prev?.typeRef,
      objectFields: kids,
    }
  }
  // 普通字符串：若旧类型是特殊类型但丢掉了包装，尽量保留旧类型
  if (typeof raw === 'string' && prev && wrapperForType(prev.type)) {
    return { name, type: prev.type, typeRef: prev.typeRef, value: raw }
  }
  return { name, type: 'string', value: raw == null ? '' : String(raw) }
}

function decodeArrayItems(
  raw: unknown[],
  previous?: ArraySubField[],
  itemTypeRef?: string,
): ArraySubField[] {
  return raw.map((item, index) => {
    const prev = previous?.[index]
    if (isNamedMarker(item)) {
      const typeRef = namedTypeRefFromName(
        item.n,
        activeTypeLibrary,
        prev?.typeRef || itemTypeRef,
      )
      if (typeof item.v === 'string') {
        return {
          type: 'string' as const,
          typeRef,
          value: item.v,
        }
      }
      return {
        type: 'json' as const,
        typeRef,
        objectFields: valueToFields(item.v, prev?.objectFields),
      }
    }
    if (isMarker(item)) {
      const type = typeForWrapper(item.t) || 'string'
      return { type, value: item.v }
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return {
        type: 'json' as const,
        typeRef: prev?.typeRef || itemTypeRef,
        objectFields: valueToFields(
          item as Record<string, unknown>,
          prev?.objectFields,
        ),
      }
    }
    if (Array.isArray(item)) {
      return {
        type: 'array' as const,
        itemType: prev?.itemType || 'any',
        itemTypeRef: prev?.itemTypeRef,
        arrayFields: decodeArrayItems(item, prev?.arrayFields, prev?.itemTypeRef),
      }
    }
    if (typeof item === 'boolean') return { type: 'boolean' as const, value: item }
    if (typeof item === 'number') return { type: 'number' as const, value: item }
    if (item === null) return { type: 'any' as const, value: null }
    if (typeof item === 'string' && prev && wrapperForType(prev.type)) {
      return { type: prev.type, typeRef: prev.typeRef, value: item }
    }
    return {
      type: (prev?.type || 'string') as DataFieldType,
      typeRef: prev?.typeRef,
      value: item as DataFieldValue,
    }
  })
}

function decodeMarkerDeep(raw: unknown): unknown {
  if (isMarker(raw)) return raw.v
  if (isNamedMarker(raw)) {
    if (typeof raw.v === 'string') return raw.v
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw.v)) {
      out[k] = decodeMarkerDeep(v)
    }
    return out
  }
  if (Array.isArray(raw)) return raw.map(decodeMarkerDeep)
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = decodeMarkerDeep(v)
    }
    return out
  }
  return raw
}

function fieldsToPlainValue(fields: ObjectSubField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const name = f.name.trim()
    if (!name) continue
    if (f.type === 'json' && f.objectFields?.length) {
      out[name] = fieldsToPlainValue(f.objectFields)
    } else if (wrapperForType(f.type)) {
      out[name] = f.value ?? ''
    } else {
      out[name] = f.value ?? defaultValue(f.type)
    }
  }
  return out
}

export type ParsedObjectTsCode = {
  constName: string
  fields: ObjectSubField[]
  value: Record<string, unknown>
}

export function parseObjectTsCode(
  full: string,
  previous?: ObjectSubField[],
  options?: ObjectTsCodeOptions,
): ParsedObjectTsCode | null {
  return withTypeLibrary(options?.typeLibrary, () => {
    const text = full.replace(/\r\n/g, '\n').trim()
    const m = text.match(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*/)
    if (!m) return null
    const lit = text.slice(m[0].length).trim()
    const err = validateStaticObjectExpr(lit)
    if (err) return null

    let transformed: string
    try {
      transformed = transformWrappersToMarkers(lit)
    } catch {
      return null
    }

    let evaluated: unknown
    try {
      evaluated = new Function(`"use strict"; return (${transformed})`)()
    } catch {
      return null
    }
    if (!evaluated || typeof evaluated !== 'object' || Array.isArray(evaluated)) {
      return null
    }

    const fields = valueToFields(
      evaluated as Record<string, unknown>,
      previous,
    )
    return {
      constName: m[1]!,
      fields,
      value: fieldsToPlainValue(fields),
    }
  })
}

export function parseObjectTsCodeValue(
  full: string,
  previous?: ObjectSubField[],
  options?: ObjectTsCodeOptions,
): Record<string, unknown> | null {
  return parseObjectTsCode(full, previous, options)?.value ?? null
}

export function parseObjectLiteral(
  text: string,
  options?: ObjectTsCodeOptions,
): Record<string, unknown> | null {
  return withTypeLibrary(options?.typeLibrary, () => {
    const err = validateStaticObjectExpr(text)
    if (err) return null
    try {
      const transformed = transformWrappersToMarkers(text.trim())
      const evaluated = new Function(`"use strict"; return (${transformed})`)()
      if (!evaluated || typeof evaluated !== 'object' || Array.isArray(evaluated)) {
        return null
      }
      return fieldsToPlainValue(
        valueToFields(evaluated as Record<string, unknown>),
      )
    } catch {
      return null
    }
  })
}

export function objectTsStructureIntact(
  full: string,
  constName?: string | null,
): boolean {
  const text = full.replace(/\r\n/g, '\n').trim()
  const name = sanitizeConstName(constName)
  if (!new RegExp(`^const\\s+${name}\\s*=\\s*\\{`).test(text)) return false
  const lit = extractObjectTsValueLiteral(text)
  if (!lit) return false
  // 括号平衡
  let depth = 0
  for (const ch of lit) {
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

export function objectTsShellIntact(
  full: string,
  _fields: ObjectSubField[],
  constName?: string | null,
): boolean {
  return objectTsStructureIntact(full, constName)
}

/** 只读：首行 const、末行 } */
export function objectTsReadonlyLineRanges(
  full: string,
  _typesLocked = false,
): Array<{ startLine: number; endLine: number }> {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (!lines.length) return []
  const last = lines.length
  if (last === 1) return [{ startLine: 1, endLine: 1 }]
  return [
    { startLine: 1, endLine: 1 },
    { startLine: last, endLine: last },
  ]
}

export function objectTsEditableLineBounds(
  full: string,
  _typesLocked = false,
): Array<{ first: number; last: number }> {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  const last = lines.length
  if (last < 3) return []
  return [{ first: 2, last: last - 1 }]
}

export function composeArrayTsCode(
  fields: ArraySubField[],
  constName?: string | null,
  options?: ArrayTsCodeOptions,
): string {
  return withTypeLibrary(options?.typeLibrary, () => {
    const name = sanitizeConstName(constName ?? 'items')
    return `const ${name} = ${formatArrayFieldsLiteral(fields, 0)}`
  })
}

export function extractArrayTsValueLiteral(full: string): string | null {
  const text = full.replace(/\r\n/g, '\n').trim()
  const m = text.match(/^const\s+[A-Za-z_$][\w$]*\s*=\s*/)
  if (!m) return null
  const lit = text.slice(m[0].length).trim()
  if (!lit.startsWith('[')) return null
  return lit
}

/** 校验：仅静态字面量 + 特殊类型包装器 + @具名类型包装器（根为数组） */
export function validateStaticArrayExpr(expr: string): string | null {
  const raw = expr.trim()
  if (!raw.startsWith('[')) return '需要数组字面量 [ ... ]'
  if (/`/.test(raw)) return '不允许使用模板字符串'
  if (/\bnew\s+/.test(raw)) return '不允许使用 new（只能写静态数据）'
  if (/\bfunction\b|\b=>\b/.test(raw)) return '不允许使用函数'

  let transformed: string
  try {
    transformed = stripAllowedWrappers(raw)
  } catch (e) {
    return e instanceof Error ? e.message : '包装器语法错误'
  }

  const stripped = stripStringLiterals(transformed)
  if (/\b[A-Za-z_$][\w$]*\s*\(/.test(stripped)) {
    return '不允许调用方法或创建对象，只能写静态数据（特殊类型用 Color()；自定义类型用 @common.GoodsItem({...})）'
  }
  if (/@/.test(stripped)) {
    return '自定义类型须写成 @group.Type({ ... }) 或 @group.Enum("成员")'
  }
  if (/\bnew\b/.test(stripped)) return '不允许使用 new'
  return null
}

export function arrayTsStructureIntact(
  full: string,
  constName?: string | null,
): boolean {
  const text = full.replace(/\r\n/g, '\n').trim()
  const name = sanitizeConstName(constName ?? 'items')
  if (!new RegExp(`^const\\s+${name}\\s*=\\s*\\[`).test(text)) return false
  const lit = extractArrayTsValueLiteral(text)
  if (!lit) return false
  let depth = 0
  for (const ch of lit) {
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

/** 只读：首行 const、末行 ] */
export function arrayTsReadonlyLineRanges(
  full: string,
  _typesLocked = false,
): Array<{ startLine: number; endLine: number }> {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (!lines.length) return []
  const last = lines.length
  if (last === 1) return [{ startLine: 1, endLine: 1 }]
  return [
    { startLine: 1, endLine: 1 },
    { startLine: last, endLine: last },
  ]
}

export function arrayTsEditableLineBounds(
  full: string,
  _typesLocked = false,
): Array<{ first: number; last: number }> {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  const last = lines.length
  if (last < 3) return []
  return [{ first: 2, last: last - 1 }]
}

export type ParsedArrayTsCode = {
  constName: string
  fields: ArraySubField[]
  value: unknown[]
}

export function parseArrayTsCode(
  full: string,
  previous?: ArraySubField[],
  options?: ArrayTsCodeOptions,
): ParsedArrayTsCode | null {
  return withTypeLibrary(options?.typeLibrary, () => {
    const text = full.replace(/\r\n/g, '\n').trim()
    const m = text.match(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*/)
    if (!m) return null
    const lit = text.slice(m[0].length).trim()
    const err = validateStaticArrayExpr(lit)
    if (err) return null

    let transformed: string
    try {
      transformed = transformWrappersToMarkers(lit)
    } catch {
      return null
    }

    let evaluated: unknown
    try {
      evaluated = new Function(`"use strict"; return (${transformed})`)()
    } catch {
      return null
    }
    if (!Array.isArray(evaluated)) return null

    const fields = decodeArrayItems(
      evaluated,
      previous,
      options?.itemTypeRef,
    )
    return {
      constName: m[1]!,
      fields,
      value: evaluated.map(decodeMarkerDeep) as unknown[],
    }
  })
}

/**
 * 具名 interface 补全片段：自动带上类型定义中的全部字段。
 */
export function composeNamedInterfaceSnippet(
  path: string,
  typeRef: string,
  library?: DataTypeLibrary | null,
): string {
  return withTypeLibrary(library, () => {
    const fields = objectFieldsFromTypeRef(typeRef, library)
    if (!fields.length) return `@${path}({\n  $0\n})`
    const body = formatFieldsObjectLiteral(fields, 0)
    // 在闭合 `}` 前插入光标，便于继续改值
    if (body.endsWith('}')) {
      return `@${path}(${body.slice(0, -1)}$0})`
    }
    return `@${path}(${body}$0)`
  })
}

/**
 * 把空的 `@Type({})` 自动展开为带齐字段的字面量（仅空白体时）。
 */
export function autofillEmptyNamedInterfaces(
  full: string,
  library?: DataTypeLibrary | null,
): string {
  return withTypeLibrary(library, () => {
    const normalized = full.replace(/\r\n/g, '\n')
    const entries = collectNamedTypeEntries(library).filter(
      (e) => e.kind === 'interface',
    )
    if (!entries.length) return normalized

    let out = ''
    let i = 0
    let changed = false
    while (i < normalized.length) {
      const ch = normalized[i]!
      if (ch === '"' || ch === "'") {
        const end = skipStringAt(normalized, i)
        out += normalized.slice(i, end)
        i = end
        continue
      }
      if (ch === '@' && /[A-Za-z_$]/.test(normalized[i + 1] ?? '')) {
        const scanned = scanAtQualifiedPath(normalized, i)
        if (scanned) {
          const entry = entries.find((e) => e.path === scanned.path)
          let k = skipWsAndComments(normalized, scanned.end)
          if (entry && normalized[k] === '(') {
            const argStart = skipWsAndComments(normalized, k + 1)
            if (normalized[argStart] === '{') {
              const close = findMatchingBrace(normalized, argStart)
              if (close > argStart) {
                const inner = normalized.slice(argStart + 1, close).trim()
                if (!inner) {
                  const fields = objectFieldsFromTypeRef(entry.typeRef, library)
                  const body = formatFieldsObjectLiteral(fields, 0)
                  out += `@${entry.path}(${body})`
                  i = skipWsAndComments(normalized, close + 1)
                  if (normalized[i] === ')') i += 1
                  changed = true
                  continue
                }
              }
            }
          }
        }
      }
      out += ch
      i += 1
    }
    return changed ? out : normalized
  })
}

/** 数组编辑器：与 autofillEmptyNamedInterfaces 相同，扫描 @Type({}) 并补全 */
export const autofillEmptyNamedArrayItems = autofillEmptyNamedInterfaces

export type ObjectTsTextEdit = {
  start: number
  end: number
  text: string
}

export type ObjectTsQuickFix = {
  title: string
  edits: ObjectTsTextEdit[]
}

export type ObjectTsDiagnostic = {
  message: string
  /** 相对规范化全文（\n）的 0-based 偏移 */
  start: number
  end: number
  code?: 'missing-field' | 'duplicate-field' | 'empty-value' | 'extra-field' | 'syntax'
  fixes?: ObjectTsQuickFix[]
}

function skipWsAndComments(src: string, from: number): number {
  let i = from
  while (i < src.length) {
    const ch = src[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      i += 2
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i = Math.min(src.length, i + 2)
      continue
    }
    break
  }
  return i
}

function skipStringAt(src: string, from: number): number {
  const quote = src[from]
  if (quote !== '"' && quote !== "'") return from
  let i = from + 1
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === quote) return i + 1
    i += 1
  }
  return src.length
}

/** 跳过一个值表达式，返回结束下标（不含后续逗号） */
function skipValueExpr(src: string, from: number): number {
  let i = skipWsAndComments(src, from)
  if (i >= src.length) return i
  const ch = src[i]!
  if (ch === '"' || ch === "'") return skipStringAt(src, i)
  if (ch === '{') {
    let depth = 1
    i += 1
    while (i < src.length && depth > 0) {
      const c = src[i]!
      if (c === '"' || c === "'") {
        i = skipStringAt(src, i)
        continue
      }
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      i += 1
    }
    return i
  }
  if (ch === '[') {
    let depth = 1
    i += 1
    while (i < src.length && depth > 0) {
      const c = src[i]!
      if (c === '"' || c === "'") {
        i = skipStringAt(src, i)
        continue
      }
      if (c === '[') depth += 1
      else if (c === ']') depth -= 1
      i += 1
    }
    return i
  }
  if (ch === '@' && /[A-Za-z_$]/.test(src[i + 1] ?? '')) {
    const scanned = scanAtQualifiedPath(src, i)
    if (scanned) {
      i = scanned.end
      i = skipWsAndComments(src, i)
      if (src[i] === '(') {
        let depth = 1
        i += 1
        while (i < src.length && depth > 0) {
          const c = src[i]!
          if (c === '"' || c === "'") {
            i = skipStringAt(src, i)
            continue
          }
          if (c === '(') depth += 1
          else if (c === ')') depth -= 1
          i += 1
        }
      }
      return i
    }
  }
  if (/[A-Za-z_$]/.test(ch)) {
    const start = i
    i += 1
    while (i < src.length && /[\w$]/.test(src[i]!)) i += 1
    const name = src.slice(start, i)
    const after = skipWsAndComments(src, i)
    if (
      (SPECIAL_WRAPPERS as readonly string[]).includes(name) ||
      name === 'URI'
    ) {
      if (src[after] === '(') {
        let depth = 1
        i = after + 1
        while (i < src.length && depth > 0) {
          const c = src[i]!
          if (c === '"' || c === "'") {
            i = skipStringAt(src, i)
            continue
          }
          if (c === '(') depth += 1
          else if (c === ')') depth -= 1
          i += 1
        }
        return i
      }
    }
    return i
  }
  if (ch === '-' || ch === '+' || /\d/.test(ch)) {
    i += 1
    while (i < src.length && /[\d._]/.test(src[i]!)) i += 1
    return i
  }
  // 未知：推进一格避免死循环
  return i + 1
}

type ScannedProp = {
  name: string
  nameStart: number
  nameEnd: number
  valueStart: number
  valueEnd: number
  emptyValue: boolean
}

/** 解析 `{ ... }` 顶层属性；openBrace 指向 `{` */
function scanObjectProperties(
  src: string,
  openBrace: number,
): { props: ScannedProp[]; closeBrace: number } | null {
  if (src[openBrace] !== '{') return null
  const props: ScannedProp[] = []
  let i = openBrace + 1
  while (i < src.length) {
    i = skipWsAndComments(src, i)
    if (i >= src.length) return null
    if (src[i] === '}') return { props, closeBrace: i }
    if (src[i] === ',') {
      i += 1
      continue
    }

    let name = ''
    let nameStart = i
    let nameEnd = i
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i]!
      nameStart = i
      i = skipStringAt(src, i)
      nameEnd = i
      try {
        name =
          quote === '"'
            ? (JSON.parse(src.slice(nameStart, nameEnd)) as string)
            : src.slice(nameStart + 1, nameEnd - 1)
      } catch {
        name = src.slice(nameStart + 1, Math.max(nameStart + 1, nameEnd - 1))
      }
    } else if (/[A-Za-z_$]/.test(src[i]!)) {
      nameStart = i
      i += 1
      while (i < src.length && /[\w$]/.test(src[i]!)) i += 1
      nameEnd = i
      name = src.slice(nameStart, nameEnd)
    } else {
      return null
    }

    i = skipWsAndComments(src, i)
    if (src[i] !== ':') return null
    i += 1
    const valueStart = skipWsAndComments(src, i)
    const next = src[valueStart]
    const emptyValue = next === ',' || next === '}' || next === undefined
    const valueEnd = emptyValue ? valueStart : skipValueExpr(src, valueStart)
    props.push({
      name,
      nameStart,
      nameEnd,
      valueStart,
      valueEnd,
      emptyValue,
    })
    i = valueEnd
  }
  return null
}

function findMatchingBrace(src: string, openBrace: number): number {
  if (src[openBrace] !== '{') return -1
  let depth = 1
  let i = openBrace + 1
  while (i < src.length && depth > 0) {
    const c = src[i]!
    if (c === '"' || c === "'") {
      i = skipStringAt(src, i)
      continue
    }
    if (c === '{') depth += 1
    else if (c === '}') depth -= 1
    i += 1
  }
  return depth === 0 ? i - 1 : -1
}

function findMatchingBracket(src: string, openBracket: number): number {
  if (src[openBracket] !== '[') return -1
  let depth = 1
  let i = openBracket + 1
  while (i < src.length && depth > 0) {
    const c = src[i]!
    if (c === '"' || c === "'") {
      i = skipStringAt(src, i)
      continue
    }
    if (c === '[') depth += 1
    else if (c === ']') depth -= 1
    i += 1
  }
  return depth === 0 ? i - 1 : -1
}

function diagnoseArrayTopLevelElements(
  src: string,
  openBracket: number,
  baseOffset: number,
  diags: ObjectTsDiagnostic[],
): void {
  if (src[openBracket] !== '[') return
  let depth = 1
  let j = openBracket + 1
  let elemStart = j
  const to = src.length
  while (j < to && depth > 0) {
    const c = src[j]!
    if (c === '"' || c === "'") {
      j = skipStringAt(src, j)
      continue
    }
    if (c === '[') {
      depth += 1
      j += 1
      continue
    }
    if (c === ']') {
      depth -= 1
      if (depth === 0) {
        diagnoseNestedStructures(src, elemStart, j, baseOffset, diags)
        break
      }
      j += 1
      continue
    }
    if (c === ',' && depth === 1) {
      diagnoseNestedStructures(src, elemStart, j, baseOffset, diags)
      elemStart = j + 1
    }
    j += 1
  }
}

function inferObjectIndents(
  src: string,
  openBrace: number,
  props: ScannedProp[],
): { inner: string; close: string; valueIndent: number } {
  const lineStart = src.lastIndexOf('\n', openBrace) + 1
  const openIndent = src.slice(lineStart, openBrace).match(/^[ \t]*/)?.[0] ?? ''
  let inner = `${openIndent}  `
  if (props.length) {
    const p = props[0]!
    const pLineStart = src.lastIndexOf('\n', p.nameStart) + 1
    const pIndent = src.slice(pLineStart, p.nameStart)
    if (pIndent.length) inner = pIndent
  }
  return {
    inner,
    close: openIndent,
    valueIndent: inner.replace(/\t/g, '  ').length,
  }
}

/** 在对象字面量闭合 `}` 前插入缺失字段 */
function buildInsertFieldsBeforeCloseEdit(
  src: string,
  openBrace: number,
  closeBrace: number,
  props: ScannedProp[],
  fields: ObjectSubField[],
): ObjectTsTextEdit | null {
  if (!fields.length || closeBrace <= openBrace) return null
  const { inner, close, valueIndent } = inferObjectIndents(src, openBrace, props)
  const lines = fields.map((f) => {
    const name = f.name.trim()
    return `${inner}${formatKey(name)}: ${formatFieldValueExpr(f, valueIndent)}`
  })

  if (!props.length) {
    return {
      start: openBrace + 1,
      end: closeBrace,
      text: `\n${lines.join(',\n')}\n${close}`,
    }
  }

  const last = props[props.length - 1]!
  let from = last.valueEnd
  let k = from
  while (k < closeBrace && /[ \t\n\r]/.test(src[k]!)) k += 1
  if (src[k] === ',') {
    from = k + 1
    return {
      start: from,
      end: closeBrace,
      text: `\n${lines.join(',\n')}\n${close}`,
    }
  }
  return {
    start: last.valueEnd,
    end: closeBrace,
    text: `,\n${lines.join(',\n')}\n${close}`,
  }
}

function diagnoseObjectLiteralKeys(
  src: string,
  openBrace: number,
  baseOffset: number,
  diags: ObjectTsDiagnostic[],
  /** 若提供，则校验字段集合必须恰好匹配 */
  allowedFields?: {
    path: string
    typeRef: string
    names: string[]
    required: string[]
  } | null,
): void {
  const scanned = scanObjectProperties(src, openBrace)
  if (!scanned) return
  const seen = new Map<string, ScannedProp>()
  for (const prop of scanned.props) {
    if (prop.emptyValue) {
      diags.push({
        message: `字段 ${prop.name} 缺少值`,
        start: baseOffset + prop.nameStart,
        end: baseOffset + Math.max(prop.nameEnd, prop.valueStart),
        code: 'empty-value',
      })
    }
    const prev = seen.get(prop.name)
    if (prev) {
      diags.push({
        message: `重复字段 ${prop.name}`,
        start: baseOffset + prop.nameStart,
        end: baseOffset + prop.nameEnd,
        code: 'duplicate-field',
      })
    } else {
      seen.set(prop.name, prop)
    }
    if (allowedFields && !allowedFields.names.includes(prop.name)) {
      diags.push({
        message: `@${allowedFields.path} 不允许字段 ${prop.name}`,
        start: baseOffset + prop.nameStart,
        end: baseOffset + prop.nameEnd,
        code: 'extra-field',
      })
    }
  }
  if (allowedFields) {
    const missingNames = allowedFields.required.filter((name) => !seen.has(name))
    if (missingNames.length) {
      const typeFields = objectFieldsFromTypeRef(
        allowedFields.typeRef,
        activeTypeLibrary,
      )
      const byName = new Map(
        typeFields
          .filter((f) => f.name.trim())
          .map((f) => [f.name.trim(), f] as const),
      )
      const missingFields = missingNames
        .map((name) => byName.get(name))
        .filter((f): f is ObjectSubField => Boolean(f))

      const allEdit = buildInsertFieldsBeforeCloseEdit(
        src,
        openBrace,
        scanned.closeBrace,
        scanned.props,
        missingFields,
      )

      for (const name of missingNames) {
        const field = byName.get(name)
        const oneEdit = field
          ? buildInsertFieldsBeforeCloseEdit(
              src,
              openBrace,
              scanned.closeBrace,
              scanned.props,
              [field],
            )
          : null
        const fixes: ObjectTsQuickFix[] = []
        if (oneEdit) {
          fixes.push({
            title: `添加缺少的字段 ${name}`,
            edits: [
              {
                start: baseOffset + oneEdit.start,
                end: baseOffset + oneEdit.end,
                text: oneEdit.text,
              },
            ],
          })
        }
        if (
          allEdit &&
          missingNames.length > 1 &&
          missingFields.length === missingNames.length
        ) {
          fixes.push({
            title: `补全所有缺少字段（${missingNames.join(', ')}）`,
            edits: [
              {
                start: baseOffset + allEdit.start,
                end: baseOffset + allEdit.end,
                text: allEdit.text,
              },
            ],
          })
        }
        diags.push({
          message: `@${allowedFields.path} 缺少字段 ${name}`,
          start: baseOffset + openBrace,
          end: baseOffset + scanned.closeBrace + 1,
          code: 'missing-field',
          fixes,
        })
      }
    }
  }

  // 递归：属性值里的嵌套对象 / @Type({...})
  for (const prop of scanned.props) {
    if (prop.emptyValue) continue
    diagnoseNestedStructures(
      src,
      prop.valueStart,
      prop.valueEnd,
      baseOffset,
      diags,
    )
  }
}

function diagnoseNestedStructures(
  src: string,
  from: number,
  to: number,
  baseOffset: number,
  diags: ObjectTsDiagnostic[],
): void {
  let i = skipWsAndComments(src, from)
  if (i >= to) return
  if (src[i] === '{') {
    diagnoseObjectLiteralKeys(src, i, baseOffset, diags, null)
    return
  }
  if (src[i] === '@') {
    const scanned = scanAtQualifiedPath(src, i)
    if (!scanned) return
    let k = skipWsAndComments(src, scanned.end)
    if (src[k] !== '(') return
    k += 1
    const argStart = skipWsAndComments(src, k)
    if (src[argStart] === '{') {
      const entry = collectNamedTypeEntries(activeTypeLibrary).find(
        (e) => e.path === scanned.path,
      )
      let allowed: {
        path: string
        typeRef: string
        names: string[]
        required: string[]
      } | null = null
      if (entry?.kind === 'interface') {
        const def = findDataTypeDef(activeTypeLibrary, entry.typeRef)
        if (def?.kind === 'interface') {
          allowed = {
            path: scanned.path,
            typeRef: entry.typeRef,
            names: def.fields.map((f) => f.name.trim()).filter(Boolean),
            required: def.fields
              .filter((f) => f.name.trim() && !f.optional)
              .map((f) => f.name.trim()),
          }
        }
      }
      diagnoseObjectLiteralKeys(src, argStart, baseOffset, diags, allowed)
    }
    return
  }
  if (src[i] === '[') {
    let depth = 1
    let j = i + 1
    let elemStart = j
    while (j < to && depth > 0) {
      const c = src[j]!
      if (c === '"' || c === "'") {
        j = skipStringAt(src, j)
        continue
      }
      if (c === '[') {
        depth += 1
        j += 1
        continue
      }
      if (c === ']') {
        depth -= 1
        if (depth === 0) {
          diagnoseNestedStructures(src, elemStart, j, baseOffset, diags)
          break
        }
        j += 1
        continue
      }
      if (c === ',' && depth === 1) {
        diagnoseNestedStructures(src, elemStart, j, baseOffset, diags)
        elemStart = j + 1
      }
      j += 1
    }
  }
}

/**
 * 收集代码诊断（带位置，供编辑器行内标记）。
 */
export function diagnoseObjectTsCode(
  full: string,
  options?: ObjectTsCodeOptions & { constName?: string | null },
): ObjectTsDiagnostic[] {
  return withTypeLibrary(options?.typeLibrary, () => {
    const diags: ObjectTsDiagnostic[] = []
    const normalized = full.replace(/\r\n/g, '\n')
    if (!normalized.trim()) {
      return [{ message: '代码不能为空', start: 0, end: Math.max(1, normalized.length) }]
    }

    const header = normalized.match(/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*/)
    if (!header) {
      return [
        {
          message: '需要形如 const name = { ... }',
          start: 0,
          end: Math.min(normalized.length, 24),
        },
      ]
    }
    const constName = header[1]!
    const expected = options?.constName ? sanitizeConstName(options.constName) : ''
    if (expected && constName !== expected) {
      const nameStart = normalized.indexOf(constName)
      diags.push({
        message: `常量名须为 ${expected}`,
        start: nameStart >= 0 ? nameStart : 0,
        end: nameStart >= 0 ? nameStart + constName.length : header[0].length,
      })
    }

    const litStart = header[0].length
    const lit = normalized.slice(litStart)
    const litTrimStart = lit.search(/\S/)
    if (litTrimStart < 0 || lit[litTrimStart] !== '{') {
      diags.push({
        message: '赋值右侧需要对象字面量 { ... }',
        start: litStart,
        end: normalized.length,
      })
      return diags
    }
    const openBrace = litStart + litTrimStart
    if (!objectTsStructureIntact(normalized.trim(), options?.constName ?? constName)) {
      const close = findMatchingBrace(normalized, openBrace)
      diags.push({
        message: '对象字面量括号不匹配，或结构已损坏',
        start: close >= 0 ? close : openBrace,
        end: (close >= 0 ? close : openBrace) + 1,
      })
      return diags
    }

    const staticErr = validateStaticObjectExpr(normalized.slice(openBrace).trim())
    if (staticErr) {
      diags.push({
        message: staticErr,
        start: openBrace,
        end: Math.min(normalized.length, openBrace + 1),
      })
      return diags
    }

    // 根对象：重复字段 / 缺值；并递归校验 @Type 字段集合
    diagnoseObjectLiteralKeys(normalized, openBrace, 0, diags, null)

    // 再扫一遍全文中的 @Type({...})，根扫描已覆盖嵌套值，但根级旁路调用也兜底
    // （根对象属性值里的 @Type 已在 diagnoseNestedStructures 处理）

    if (diags.length) return diags

    try {
      const litText = extractObjectTsValueLiteral(normalized)
      if (!litText) {
        diags.push({
          message: '赋值右侧需要对象字面量 { ... }',
          start: openBrace,
          end: normalized.length,
        })
        return diags
      }
      const transformed = transformWrappersToMarkers(litText)
      const evaluated = new Function(`"use strict"; return (${transformed})`)()
      if (!evaluated || typeof evaluated !== 'object' || Array.isArray(evaluated)) {
        diags.push({
          message: '赋值右侧必须是对象字面量 { ... }',
          start: openBrace,
          end: normalized.length,
        })
      }
    } catch (e) {
      const message =
        e instanceof Error && e.message
          ? e.message
          : '语法错误，请检查对象字面量'
      // 尽量标在最后一个属性附近
      const scanned = scanObjectProperties(normalized, openBrace)
      if (scanned?.props.length) {
        const last = scanned.props[scanned.props.length - 1]!
        diags.push({
          message,
          start: last.nameStart,
          end: Math.max(last.valueEnd, last.nameEnd),
        })
      } else {
        diags.push({
          message,
          start: openBrace,
          end: Math.min(normalized.length, openBrace + 1),
        })
      }
    }
    return diags
  })
}

export function diagnoseArrayTsCode(
  full: string,
  options?: ArrayTsCodeOptions & { constName?: string | null },
): ObjectTsDiagnostic[] {
  return withTypeLibrary(options?.typeLibrary, () => {
    const diags: ObjectTsDiagnostic[] = []
    const normalized = full.replace(/\r\n/g, '\n')
    if (!normalized.trim()) {
      return [{ message: '代码不能为空', start: 0, end: Math.max(1, normalized.length) }]
    }

    const header = normalized.match(/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*/)
    if (!header) {
      return [
        {
          message: '需要形如 const name = [ ... ]',
          start: 0,
          end: Math.min(normalized.length, 24),
        },
      ]
    }
    const constName = header[1]!
    const expected = options?.constName ? sanitizeConstName(options.constName) : ''
    if (expected && constName !== expected) {
      const nameStart = normalized.indexOf(constName)
      diags.push({
        message: `常量名须为 ${expected}`,
        start: nameStart >= 0 ? nameStart : 0,
        end: nameStart >= 0 ? nameStart + constName.length : header[0].length,
      })
    }

    const litStart = header[0].length
    const lit = normalized.slice(litStart)
    const litTrimStart = lit.search(/\S/)
    if (litTrimStart < 0 || lit[litTrimStart] !== '[') {
      diags.push({
        message: '赋值右侧需要数组字面量 [ ... ]',
        start: litStart,
        end: normalized.length,
      })
      return diags
    }
    const openBracket = litStart + litTrimStart
    if (
      !arrayTsStructureIntact(
        normalized.trim(),
        options?.constName ?? constName,
      )
    ) {
      const close = findMatchingBracket(normalized, openBracket)
      diags.push({
        message: '数组字面量括号不匹配，或结构已损坏',
        start: close >= 0 ? close : openBracket,
        end: (close >= 0 ? close : openBracket) + 1,
      })
      return diags
    }

    const staticErr = validateStaticArrayExpr(normalized.slice(openBracket).trim())
    if (staticErr) {
      diags.push({
        message: staticErr,
        start: openBracket,
        end: Math.min(normalized.length, openBracket + 1),
      })
      return diags
    }

    diagnoseArrayTopLevelElements(normalized, openBracket, 0, diags)

    if (diags.length) return diags

    try {
      const litText = extractArrayTsValueLiteral(normalized)
      if (!litText) {
        diags.push({
          message: '赋值右侧需要数组字面量 [ ... ]',
          start: openBracket,
          end: normalized.length,
        })
        return diags
      }
      const transformed = transformWrappersToMarkers(litText)
      const evaluated = new Function(`"use strict"; return (${transformed})`)()
      if (!Array.isArray(evaluated)) {
        diags.push({
          message: '赋值右侧必须是数组字面量 [ ... ]',
          start: openBracket,
          end: normalized.length,
        })
      }
    } catch (e) {
      const message =
        e instanceof Error && e.message
          ? e.message
          : '语法错误，请检查数组字面量'
      const close = findMatchingBracket(normalized, openBracket)
      diags.push({
        message,
        start: openBracket,
        end: close >= 0 ? close + 1 : Math.min(normalized.length, openBracket + 1),
      })
    }
    return diags
  })
}

/**
 * 完整合法性校验：壳层、静态规则、包装器、可求值对象字面量。
 * 返回可读错误；合法返回 null。
 */
export function getObjectTsCodeError(
  full: string,
  options?: ObjectTsCodeOptions & { constName?: string | null },
): string | null {
  return diagnoseObjectTsCode(full, options)[0]?.message ?? null
}

/** 解析失败时的可读错误 */
export function explainObjectTsParseError(
  full: string,
  options?: ObjectTsCodeOptions & { constName?: string | null },
): string {
  return getObjectTsCodeError(full, options) || '语法错误，请检查对象字面量'
}

export function getArrayTsCodeError(
  full: string,
  options?: ArrayTsCodeOptions & { constName?: string | null },
): string | null {
  return diagnoseArrayTsCode(full, options)[0]?.message ?? null
}

export function explainArrayTsParseError(
  full: string,
  options?: ArrayTsCodeOptions & { constName?: string | null },
): string {
  return getArrayTsCodeError(full, options) || '语法错误，请检查数组字面量'
}

export function mergeObjectTsFieldsAndValue(
  typeFields: ObjectSubField[],
  value: Record<string, unknown>,
  previous?: ObjectSubField[],
): ObjectSubField[] {
  // 新格式以解析出的 fields 为准；此函数保留兼容
  if (typeFields.length) {
    const byName = new Map(typeFields.map((f) => [f.name.trim(), f]))
    const result = [...typeFields]
    const prevByName = new Map(
      (previous ?? []).filter((f) => f.name.trim()).map((f) => [f.name.trim(), f]),
    )
    for (const key of Object.keys(value)) {
      if (byName.has(key)) continue
      const prev = prevByName.get(key)
      result.push(
        prev
          ? { ...prev, value: value[key] as DataFieldValue }
          : decodeValueToField(key, value[key], prev),
      )
    }
    return result
  }
  return valueToFields(value, previous)
}

const CODE_SPECIAL_TYPES = new Set<DataFieldType>([
  'color',
  'time',
  'date',
  'datetime',
  'icon',
  'resource',
])

/**
 * 把代码里 Color()/Time()/@TypeName 等解析出的类型盖到目标字段上（具名类型 schema 合并后会丢包装类型）。
 */
export function overlaySpecialTypesFromCode(
  target: ObjectSubField[],
  fromCode: ObjectSubField[],
): ObjectSubField[] {
  const codeByName = new Map(
    fromCode.filter((f) => f.name.trim()).map((f) => [f.name.trim(), f] as const),
  )
  return target.map((field) => {
    const name = field.name.trim()
    const code = codeByName.get(name)
    if (!code) return field

    const next: ObjectSubField = { ...field }
    if (code.value !== undefined) next.value = code.value

    if (CODE_SPECIAL_TYPES.has(code.type)) {
      next.type = code.type
      next.typeRef = code.typeRef
      return next
    }

    // 具名枚举：string + typeRef
    if (code.type === 'string' && code.typeRef?.trim()) {
      next.type = 'string'
      next.typeRef = code.typeRef
      return next
    }

    if (code.type === 'json' && code.typeRef?.trim()) {
      next.type = 'json'
      next.typeRef = code.typeRef
      if (next.objectFields?.length && code.objectFields?.length) {
        next.objectFields = overlaySpecialTypesFromCode(
          next.objectFields,
          code.objectFields,
        )
      } else if (code.objectFields?.length) {
        next.objectFields = code.objectFields
      }
      return next
    }

    if (
      (next.type === 'json' || code.type === 'json') &&
      next.objectFields?.length &&
      code.objectFields?.length
    ) {
      next.objectFields = overlaySpecialTypesFromCode(
        next.objectFields,
        code.objectFields,
      )
    }
    return next
  })
}

/**
 * 把代码里 Color()/Time()/@TypeName 等解析出的类型盖到目标数组项上（index 对齐）。
 */
export function overlaySpecialTypesFromArrayCode(
  target: ArraySubField[],
  fromCode: ArraySubField[],
): ArraySubField[] {
  return target.map((field, index) => {
    const code = fromCode[index]
    if (!code) return field

    const next: ArraySubField = { ...field }
    if (code.value !== undefined) next.value = code.value

    if (CODE_SPECIAL_TYPES.has(code.type)) {
      next.type = code.type
      next.typeRef = code.typeRef
      return next
    }

    if (code.type === 'string' && code.typeRef?.trim()) {
      next.type = 'string'
      next.typeRef = code.typeRef
      return next
    }

    if (code.type === 'json' && code.typeRef?.trim()) {
      next.type = 'json'
      next.typeRef = code.typeRef
      if (next.objectFields?.length && code.objectFields?.length) {
        next.objectFields = overlaySpecialTypesFromCode(
          next.objectFields,
          code.objectFields,
        )
      } else if (code.objectFields?.length) {
        next.objectFields = code.objectFields
      }
      return next
    }

    if (next.arrayFields?.length && code.arrayFields?.length) {
      next.arrayFields = overlaySpecialTypesFromArrayCode(
        next.arrayFields,
        code.arrayFields,
      )
    } else if (code.arrayFields?.length) {
      next.arrayFields = code.arrayFields
    }

    if (
      (next.type === 'json' || code.type === 'json') &&
      next.objectFields?.length &&
      code.objectFields?.length
    ) {
      next.objectFields = overlaySpecialTypesFromCode(
        next.objectFields,
        code.objectFields,
      )
    }

    return next
  })
}

export function collectNamedTypeRefs(fields: ObjectSubField[]): string[] {
  const refs: string[] = []
  const walk = (list: ObjectSubField[]) => {
    for (const f of list) {
      if (f.typeRef?.trim()) refs.push(f.typeRef.trim())
      if (f.itemTypeRef?.trim()) refs.push(f.itemTypeRef.trim())
      if (f.objectFields?.length) walk(f.objectFields)
    }
  }
  walk(fields)
  return [...new Set(refs)]
}

export function buildNamedTypeAmbient(names: string[]): string {
  return names
    .filter((n) => isIdent(n))
    .map((n) => `declare function ${n}(value: object): object;`)
    .join('\n')
}

/** 旧逻辑占位：新格式不再从类型区补字段 */
export function syncMissingFieldsIntoCode(
  _full: string,
  _constName?: string | null,
): string | null {
  return null
}
