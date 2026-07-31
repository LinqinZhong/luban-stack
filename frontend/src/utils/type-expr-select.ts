import type { TypeSelectPayload } from '../components/editor/DataFieldTypeTreeSelect.vue'
import {
  createEmptyClearedTypeExpr,
  isTypeExprCleared,
  type TypeAtom,
  type TypeExpr,
} from '../types/data-types'
import type { DataFieldType } from '../types/page-data'

/** 类型库 TypeExpr 选择器：不含数据池专有类型 */
export const TYPE_EXPR_EXCLUDE_TYPES: DataFieldType[] = [
  'icon',
  'color',
  'ref',
  'api',
  'json',
  'resource',
]

function leafAtomFromPayload(
  type: DataFieldType | 'generic' | 'void' | undefined,
  typeRef?: string,
): TypeAtom {
  if (type === 'generic' && typeRef) {
    return { kind: 'generic', ref: typeRef }
  }
  if (type === 'json' && typeRef) {
    return { kind: 'named', ref: typeRef }
  }
  if (typeRef) {
    return { kind: 'named', ref: typeRef }
  }
  if (type === 'number' || type === 'boolean' || type === 'any') {
    return { kind: type }
  }
  return { kind: 'string' }
}

function atomFromPayload(payload: TypeSelectPayload): TypeAtom {
  if (payload.type === 'map') {
    const key = payload.keyType === 'number' ? 'number' : 'string'
    if (payload.itemType === 'array') {
      return {
        kind: 'map',
        key,
        item: {
          kind: 'array',
          item: leafAtomFromPayload(
            payload.itemItemType,
            payload.itemItemTypeRef,
          ),
        },
      }
    }
    return {
      kind: 'map',
      key,
      item: leafAtomFromPayload(payload.itemType, payload.itemTypeRef),
    }
  }
  if (payload.type === 'array') {
    if (payload.itemType === 'array') {
      return {
        kind: 'array',
        item: {
          kind: 'array',
          item: leafAtomFromPayload(
            payload.itemItemType,
            payload.itemItemTypeRef,
          ),
        },
      }
    }
    return {
      kind: 'array',
      item: leafAtomFromPayload(payload.itemType, payload.itemTypeRef),
    }
  }
  return leafAtomFromPayload(payload.type, payload.typeRef)
}

/** Cascader payload → TypeExpr */
export function selectPayloadToTypeExpr(payload: TypeSelectPayload): TypeExpr {
  if (payload.cleared || payload.type === 'void') {
    return createEmptyClearedTypeExpr()
  }
  return { intersections: [{ alternatives: [atomFromPayload(payload)] }] }
}

function leafPayloadFromAtom(atom: TypeAtom): {
  type: DataFieldType | 'generic'
  typeRef?: string
} {
  if (atom.kind === 'named') {
    return { type: 'json', typeRef: atom.ref || undefined }
  }
  if (atom.kind === 'generic') {
    return { type: 'generic', typeRef: atom.ref || undefined }
  }
  if (
    atom.kind === 'number' ||
    atom.kind === 'boolean' ||
    atom.kind === 'any'
  ) {
    return { type: atom.kind }
  }
  return { type: 'string' }
}

/** TypeExpr → Cascader payload（供 DataFieldTypeTreeSelect） */
export function typeExprToSelectPayload(
  expr: TypeExpr | null | undefined,
): TypeSelectPayload {
  if (!expr || isTypeExprCleared(expr)) {
    return { type: 'string', cleared: true }
  }
  const atom = expr.intersections[0]!.alternatives[0]!
  if (atom.kind === 'map') {
    const keyType = atom.key === 'number' ? 'number' : 'string'
    const item = atom.item ?? { kind: 'any' as const }
    if (item.kind === 'array') {
      const leaf = leafPayloadFromAtom(item.item ?? { kind: 'any' })
      return {
        type: 'map',
        keyType,
        itemType: 'array',
        itemItemType: leaf.type,
        itemItemTypeRef: leaf.typeRef,
      }
    }
    const leaf = leafPayloadFromAtom(item)
    return {
      type: 'map',
      keyType,
      itemType: leaf.type,
      itemTypeRef: leaf.typeRef,
    }
  }
  if (atom.kind === 'array') {
    const item = atom.item ?? { kind: 'any' as const }
    if (item.kind === 'array') {
      const leaf = leafPayloadFromAtom(item.item ?? { kind: 'any' })
      return {
        type: 'array',
        itemType: 'array',
        itemItemType: leaf.type,
        itemItemTypeRef: leaf.typeRef,
      }
    }
    const leaf = leafPayloadFromAtom(item)
    return {
      type: 'array',
      itemType: leaf.type,
      itemTypeRef: leaf.typeRef,
    }
  }
  const leaf = leafPayloadFromAtom(atom)
  return { type: leaf.type, typeRef: leaf.typeRef }
}
