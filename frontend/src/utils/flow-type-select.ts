import type { DataFieldType } from '../types/page-data'
import type { MethodParamType, MethodReturnType } from '../types/page-method'
import {
  createEmptyProcessorTypeExpr,
  type ProcessorTypeExpr,
} from '../types/backend-services'

/** 与 DataFieldTypeTreeSelect 的 change payload 对齐 */
export type FlowTypeSelectPayload = {
  type: DataFieldType | 'void' | 'generic'
  typeRef?: string
  itemType?: DataFieldType | 'generic'
  itemTypeRef?: string
  itemItemType?: DataFieldType | 'generic'
  itemItemTypeRef?: string
  cleared?: boolean
}

/** 流程节点类型选择：与后端方法一致，排除 UI 专用类型 */
export const FLOW_TYPE_EXCLUDE: DataFieldType[] = ['color', 'ref', 'icon', 'resource']

export function dataFieldToMethodParamType(
  type: DataFieldType | 'void' | 'generic',
): MethodParamType {
  if (type === 'void' || type === 'generic') return 'any'
  if (type === 'json') return 'object'
  if (type === 'icon' || type === 'color' || type === 'ref' || type === 'resource') {
    return 'string'
  }
  return type as MethodParamType
}

/** Cascader payload 叶子 → 数据字段类型（泛型/void 落为 any） */
export function resolvePayloadFieldType(
  type: DataFieldType | 'void' | 'generic' | undefined | null,
): DataFieldType {
  if (!type || type === 'void' || type === 'generic') return 'any'
  return type
}

export function methodTypeToDataField(
  type: MethodParamType | MethodReturnType,
  typeRef?: string,
): DataFieldType | 'void' {
  if (type === 'void') return 'void'
  if (typeRef || type === 'object') return 'json'
  return type as DataFieldType
}

export function leafNamedRefFromPayload(payload: FlowTypeSelectPayload): string {
  if (payload.type === 'array') {
    if (payload.itemType === 'array') return payload.itemItemTypeRef || ''
    return payload.itemTypeRef || ''
  }
  return payload.typeRef || ''
}

export function applyPayloadToGenericArgs(
  payload: FlowTypeSelectPayload,
  prevNamed: string,
  prevGenericArgs: Record<string, string>,
  genericNames: string[],
): Record<string, string> {
  const named = leafNamedRefFromPayload(payload)
  if (!named || !genericNames.length) return {}
  if (named === prevNamed) {
    const next: Record<string, string> = {}
    for (const n of genericNames) next[n] = prevGenericArgs[n] ?? ''
    return next
  }
  const next: Record<string, string> = {}
  for (const n of genericNames) next[n] = ''
  return next
}

/** 从流程节点草稿字段组装 ProcessorTypeExpr */
export function flowDraftToTypeExpr(fields: {
  type: MethodParamType | MethodReturnType
  typeRef?: string
  itemType?: string
  itemTypeRef?: string
  itemItemType?: string
  itemItemTypeRef?: string
  genericArgs?: Record<string, string>
}): ProcessorTypeExpr {
  if (fields.type === 'void') return createEmptyProcessorTypeExpr('any')
  const type =
    fields.typeRef || fields.type === 'object'
      ? 'json'
      : fields.type === 'array'
        ? 'array'
        : fields.type
  return {
    ...createEmptyProcessorTypeExpr(type),
    type,
    typeRef: fields.typeRef ?? '',
    itemType: fields.itemType ?? '',
    itemTypeRef: fields.itemTypeRef ?? '',
    itemItemType: fields.itemItemType ?? '',
    itemItemTypeRef: fields.itemItemTypeRef ?? '',
    genericArgs: { ...(fields.genericArgs ?? {}) },
  }
}

export function leafNamedRefFromDraft(fields: {
  type: string
  typeRef?: string
  itemType?: string
  itemTypeRef?: string
  itemItemType?: string
  itemItemTypeRef?: string
}): string {
  if (fields.type === 'array') {
    if (fields.itemType === 'array') return fields.itemItemTypeRef || ''
    return fields.itemTypeRef || ''
  }
  return fields.typeRef || ''
}
