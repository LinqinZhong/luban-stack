import type { DataTypeDef, DataTypeLibrary, TypeAtom, TypeExpr } from '../types/data-types'
import type { DataFieldType, ObjectSubField } from '../types/page-data'
import { findDataTypeDef, resolveNamedTypeAsField } from './named-type-fields'

/** JSON Schema 草稿（Monaco / 自检共用） */
export type JsonSchema = Record<string, unknown>

function primaryAtom(expr: TypeExpr | undefined | null): TypeAtom {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' }
}

function schemaForAtom(
  atom: TypeAtom,
  library: DataTypeLibrary | null | undefined,
  seen: Set<string>,
): JsonSchema {
  switch (atom.kind) {
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'any':
      return {}
    case 'named':
      return schemaForNamedType(atom.ref ?? '', library, seen) ?? { type: 'string' }
    case 'generic':
      return {}
    default:
      return { type: 'string' }
  }
}

function schemaForNamedType(
  typeRef: string,
  library: DataTypeLibrary | null | undefined,
  seen: Set<string>,
): JsonSchema | null {
  if (!typeRef) return null
  if (seen.has(typeRef)) {
    return { type: 'object', additionalProperties: true }
  }
  const def = findDataTypeDef(library, typeRef)
  if (!def) return { type: 'object', additionalProperties: true }

  if (def.kind === 'interface') {
    seen.add(typeRef)
    const schema = schemaForInterface(def, library, seen)
    seen.delete(typeRef)
    return schema
  }
  if (def.kind === 'enum') {
    const values = def.enumMembers
      .map((m) => {
        const raw = m.value.trim()
        if (!raw) return m.name
        if (raw === 'true') return true
        if (raw === 'false') return false
        if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
        if (
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
        ) {
          return raw.slice(1, -1)
        }
        return raw
      })
      .filter((v) => v !== '')
    if (!values.length) return { type: 'string' }
    const allString = values.every((v) => typeof v === 'string')
    const allNumber = values.every((v) => typeof v === 'number')
    const allBoolean = values.every((v) => typeof v === 'boolean')
    return {
      enum: values,
      ...(allString
        ? { type: 'string' }
        : allNumber
          ? { type: 'number' }
          : allBoolean
            ? { type: 'boolean' }
            : {}),
    }
  }
  if (def.kind === 'number') return { type: 'number' }
  if (def.kind === 'boolean') return { type: 'boolean' }
  return { type: 'string' }
}

function schemaForInterface(
  def: DataTypeDef,
  library: DataTypeLibrary | null | undefined,
  seen: Set<string>,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const field of def.fields) {
    const name = field.name.trim()
    if (!name) continue
    properties[name] = schemaForAtom(primaryAtom(field.type), library, seen)
    if (!field.optional) required.push(name)
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}

function schemaForDataFieldType(
  type: DataFieldType,
  typeRef: string | undefined,
  library: DataTypeLibrary | null | undefined,
  seen: Set<string>,
): JsonSchema {
  if (typeRef) {
    const named = schemaForNamedType(typeRef, library, seen)
    if (named) return named
  }
  switch (type) {
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'array':
      return { type: 'array' }
    case 'json':
      return { type: 'object', additionalProperties: true }
    case 'any':
      return {}
    default:
      return { type: 'string' }
  }
}

/** 对象编辑：具名类型或当前字段结构 */
export function buildObjectJsonSchema(options: {
  typeRef?: string | null
  fields?: ObjectSubField[]
  library?: DataTypeLibrary | null
  schemaLocked?: boolean
}): JsonSchema {
  const typeRef = options.typeRef?.trim()
  if (typeRef) {
    return (
      schemaForNamedType(typeRef, options.library, new Set()) ?? {
        type: 'object',
        additionalProperties: true,
      }
    )
  }
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const field of options.fields ?? []) {
    const name = field.name.trim()
    if (!name) continue
    properties[name] = schemaForDataFieldType(
      field.type,
      field.typeRef,
      options.library,
      new Set(),
    )
    required.push(name)
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: !options.schemaLocked,
  }
}

/** 数组编辑：元素类型 schema 包一层 array */
export function buildArrayJsonSchema(options: {
  itemType?: DataFieldType | null
  itemTypeRef?: string | null
  itemItemType?: DataFieldType | null
  itemItemTypeRef?: string | null
  library?: DataTypeLibrary | null
}): JsonSchema {
  const itemTypeRef = options.itemTypeRef?.trim()
  let items: JsonSchema
  if (options.itemType === 'array') {
    const innerRef = options.itemItemTypeRef?.trim()
    let inner: JsonSchema
    if (innerRef) {
      const resolved = resolveNamedTypeAsField(innerRef, options.library)
      inner = schemaForDataFieldType(
        resolved.type,
        resolved.typeRef ?? innerRef,
        options.library,
        new Set(),
      )
    } else if (options.itemItemType && options.itemItemType !== 'any') {
      inner = schemaForDataFieldType(
        options.itemItemType,
        undefined,
        options.library,
        new Set(),
      )
    } else {
      inner = {}
    }
    items = { type: 'array', items: inner }
  } else if (itemTypeRef) {
    const resolved = resolveNamedTypeAsField(itemTypeRef, options.library)
    items = schemaForDataFieldType(
      resolved.type,
      resolved.typeRef ?? itemTypeRef,
      options.library,
      new Set(),
    )
  } else if (options.itemType && options.itemType !== 'any') {
    items = schemaForDataFieldType(options.itemType, undefined, options.library, new Set())
  } else {
    items = {}
  }
  return {
    type: 'array',
    items,
  }
}

function typeLabel(schema: JsonSchema): string {
  if (schema.enum) return `枚举(${(schema.enum as unknown[]).join(' | ')})`
  const t = schema.type
  if (t === 'string') return '字符串'
  if (t === 'number' || t === 'integer') return '数值'
  if (t === 'boolean') return '布尔值'
  if (t === 'object') return '对象'
  if (t === 'array') return '数组'
  if (t === 'null') return 'null'
  if (Array.isArray(t)) return t.join('|')
  return '任意'
}

function jsTypeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function matchesSchemaType(value: unknown, schemaType: unknown): boolean {
  if (schemaType == null) return true
  const types = Array.isArray(schemaType) ? schemaType : [schemaType]
  return types.some((t) => {
    if (t === 'integer') return typeof value === 'number' && Number.isInteger(value)
    if (t === 'number') return typeof value === 'number' && Number.isFinite(value)
    if (t === 'string') return typeof value === 'string'
    if (t === 'boolean') return typeof value === 'boolean'
    if (t === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    if (t === 'array') return Array.isArray(value)
    if (t === 'null') return value === null
    return true
  })
}

/**
 * 同步校验 value 是否符合 schema，返回中文错误列表。
 * path 形如 `/0/id`
 */
export function validateJsonAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path = '',
): string[] {
  const errors: string[] = []
  const loc = path || '/'

  if (schema.enum && Array.isArray(schema.enum)) {
    const ok = schema.enum.some((item) => Object.is(item, value))
    if (!ok) {
      errors.push(`${formatSchemaPath(loc)} 值不在允许的枚举范围内`)
      return errors
    }
  }

  if (schema.type != null && !matchesSchemaType(value, schema.type)) {
    errors.push(
      `${formatSchemaPath(loc)} 类型应为「${typeLabel(schema)}」，实际为「${jsTypeOf(value)}」`,
    )
    return errors
  }

  if (schema.type === 'object' || (schema.properties && value && typeof value === 'object')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return errors
    }
    const obj = value as Record<string, unknown>
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
    const required = Array.isArray(schema.required)
      ? (schema.required as string[])
      : []

    for (const key of required) {
      if (!(key in obj)) {
        errors.push(`${formatSchemaPath(`${path}/${key}`)} 缺少必填字段`)
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (!(key in obj)) continue
      errors.push(
        ...validateJsonAgainstSchema(obj[key], childSchema, `${path}/${key}`),
      )
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          errors.push(`${formatSchemaPath(`${path}/${key}`)} 不是类型定义中的字段`)
        }
      }
    }
    return errors
  }

  if (schema.type === 'array' || schema.items) {
    if (!Array.isArray(value)) return errors
    const itemsSchema = schema.items as JsonSchema | undefined
    if (itemsSchema && typeof itemsSchema === 'object' && !Array.isArray(itemsSchema)) {
      value.forEach((item, index) => {
        errors.push(
          ...validateJsonAgainstSchema(item, itemsSchema, `${path}/${index}`),
        )
      })
    }
  }

  return errors
}

export function formatSchemaPath(path: string): string {
  if (!path || path === '/') return '根'
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : seg))
    .join('.')
}
