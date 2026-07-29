import type {
  DataTypeDef,
  DataTypeLibrary,
  TypeAtom,
  TypeExpr,
} from '../types/data-types'
import {
  defaultValue,
  type DataFieldType,
  type DataFieldValue,
  type ObjectSubField,
} from '../types/page-data'

export function findDataTypeDef(
  library: DataTypeLibrary | null | undefined,
  id: string,
): DataTypeDef | null {
  if (!id) return null
  for (const group of library?.groups ?? []) {
    const found = group.types.find((t) => t.id === id)
    if (found) return found
  }
  return null
}

function primaryAtom(expr: TypeExpr | undefined | null): TypeAtom {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' }
}

/** 将类型库表达式映射为数据池字段类型 */
export function typeExprToDataFieldType(
  expr: TypeExpr,
  library?: DataTypeLibrary | null,
): {
  type: DataFieldType
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
} {
  const atom = primaryAtom(expr)
  switch (atom.kind) {
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'named':
      return resolveNamedTypeAsField(atom.ref ?? '', library)
    case 'any':
      return { type: 'any' }
    case 'array': {
      const itemExpr: TypeExpr = {
        intersections: [
          { alternatives: [atom.item ?? { kind: 'any' }] },
        ],
      }
      const itemMapped = typeExprToDataFieldType(itemExpr, library)
      return {
        type: 'array',
        itemType: itemMapped.type,
        itemTypeRef: itemMapped.typeRef,
      }
    }
    default:
      return { type: 'string' }
  }
}

/**
 * 具名类型作为字段/数组元素时的落点：
 * - interface → json + typeRef
 * - enum / 原始 kind → 对应标量
 */
export function resolveNamedTypeAsField(
  typeRef: string,
  library: DataTypeLibrary | null | undefined,
): { type: DataFieldType; typeRef?: string } {
  const def = findDataTypeDef(library, typeRef)
  if (!def) return { type: 'json', typeRef }
  switch (def.kind) {
    case 'interface':
      return { type: 'json', typeRef }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'string':
      if (def.name === 'URI' || def.id === 'type_common_URI') {
        return { type: 'resource' }
      }
      return { type: 'string' }
    case 'enum':
    default:
      return { type: 'string' }
  }
}

function pickExistingValue(
  prev: ObjectSubField | undefined,
  type: DataFieldType,
): DataFieldValue | undefined {
  if (!prev || prev.type !== type) return undefined
  return prev.value
}

/**
 * 按 interface 定义生成可编辑字段；保留同名同类型已有值。
 * 嵌套具名 interface 会递归展开 objectFields。
 */
export function objectFieldsFromTypeRef(
  typeRef: string,
  library: DataTypeLibrary | null | undefined,
  existing?: ObjectSubField[],
): ObjectSubField[] {
  const def = findDataTypeDef(library, typeRef)
  if (!def || def.kind !== 'interface') {
    return existing?.length ? existing.map((f) => ({ ...f })) : []
  }

  const byName = new Map(
    (existing ?? [])
      .filter((f) => f.name.trim())
      .map((f) => [f.name.trim(), f] as const),
  )

  return def.fields
    .filter((f) => f.name.trim())
    .map((f) => {
      const name = f.name.trim()
      const prev = byName.get(name)
      const atom = primaryAtom(f.type)

      if (atom.kind === 'named' && atom.ref) {
        const resolved = resolveNamedTypeAsField(atom.ref, library)
        if (resolved.type === 'json' && resolved.typeRef) {
          return {
            name,
            type: 'json' as const,
            typeRef: resolved.typeRef,
            objectFields: objectFieldsFromTypeRef(
              resolved.typeRef,
              library,
              prev?.type === 'json' ? prev.objectFields : undefined,
            ),
          }
        }
        return {
          name,
          type: resolved.type,
          value: pickExistingValue(prev, resolved.type) ?? defaultValue(resolved.type),
        }
      }

      const mapped = typeExprToDataFieldType(f.type, library)
      if (mapped.type === 'array') {
        return {
          name,
          type: 'array' as const,
          itemType: mapped.itemType,
          itemTypeRef: mapped.itemTypeRef,
          arrayFields:
            prev?.type === 'array' ? (prev.arrayFields ?? []).map((x) => ({ ...x })) : [],
        }
      }
      if (mapped.type === 'json' && mapped.typeRef) {
        return {
          name,
          type: 'json' as const,
          typeRef: mapped.typeRef,
          objectFields: objectFieldsFromTypeRef(
            mapped.typeRef,
            library,
            prev?.type === 'json' ? prev.objectFields : undefined,
          ),
        }
      }

      return {
        name,
        type: mapped.type,
        value: pickExistingValue(prev, mapped.type) ?? defaultValue(mapped.type),
      }
    })
}

/** 数组元素默认类型是否锁定（非 any[]） */
export function isArrayItemTypeLocked(
  defaultItemType?: DataFieldType | null,
): boolean {
  return Boolean(defaultItemType) && defaultItemType !== 'any'
}

/**
 * 按 interface 定义补齐对象上缺失的字段（不覆盖已有键，含 0 / false / null / ''）。
 * 用于控制器回填后与调试面板一致，避免 `{goods.deliveryFee}` 因缺键无法插值，
 * 而数字输入框却用 `?? 0` 显示成 0。
 *
 * `null` / `undefined` 表示尚未加载，原样返回，勿造空对象——否则 `!goodsInfo` 等
 * loading 判断会失效（LoadingPlaceholder 进不了加载态）。
 */
export function fillNamedInterfaceDefaults(
  value: unknown,
  typeRef: string | null | undefined,
  library: DataTypeLibrary | null | undefined,
): unknown {
  if (value == null) return value
  const ref = typeRef?.trim()
  if (!ref) return value
  const def = findDataTypeDef(library, ref)
  if (!def || def.kind !== 'interface') return value

  const base: Record<string, unknown> =
    typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {}

  for (const f of def.fields) {
    const name = f.name.trim()
    if (!name) continue

    const atom = primaryAtom(f.type)
    const nestedRef =
      atom.kind === 'named' && atom.ref
        ? resolveNamedTypeAsField(atom.ref, library)
        : typeExprToDataFieldType(f.type, library)

    if (Object.prototype.hasOwnProperty.call(base, name)) {
      if (nestedRef.type === 'json' && nestedRef.typeRef) {
        base[name] = fillNamedInterfaceDefaults(
          base[name],
          nestedRef.typeRef,
          library,
        )
      }
      continue
    }

    if (nestedRef.type === 'json' && nestedRef.typeRef) {
      base[name] = fillNamedInterfaceDefaults({}, nestedRef.typeRef, library)
    } else if (nestedRef.type === 'array') {
      base[name] = []
    } else {
      base[name] = defaultValue(nestedRef.type)
    }
  }

  return base
}
