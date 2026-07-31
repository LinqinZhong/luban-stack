import type { ProcessorTypeExpr } from '../types/backend-services'
import type { DataTypeLibrary } from '../types/data-types'
import type { MethodParam } from '../types/page-method'
import { findDataTypeDef } from './named-type-fields'
import {
  buildAutoFieldMappings,
  listInterfaceFieldNames,
  mergeSavedFieldMappings,
  readFieldMappings,
  type PageMapFieldMapping,
} from './page-map-flow'

export type ObjectMapFieldMapping = PageMapFieldMapping

export type ObjectMapApplyConfig = {
  sourcePath: string
  targetVarName: string
  fieldMappings: ObjectMapFieldMapping[]
}

/** 是否为具名 interface 对象类型（非数组） */
export function isObjectInterfaceTypeExpr(
  expr: ProcessorTypeExpr | null | undefined,
  library: DataTypeLibrary | null | undefined,
): boolean {
  if (!expr || expr.type === 'array') return false
  const ref = (expr.typeRef || '').trim()
  if (!ref) return false
  const def = findDataTypeDef(library, ref)
  return def?.kind === 'interface'
}

export function resolveObjectTypeRef(
  expr: ProcessorTypeExpr | null | undefined,
): string {
  if (!expr || expr.type === 'array') return ''
  return (expr.typeRef || '').trim()
}

export function filterObjectAmbientVars(
  vars: MethodParam[],
  library: DataTypeLibrary | null | undefined,
): MethodParam[] {
  return vars.filter(
    (v) => v.typeExpr && isObjectInterfaceTypeExpr(v.typeExpr, library),
  )
}

export function resolveObjectFieldNames(
  expr: ProcessorTypeExpr,
  library: DataTypeLibrary | null | undefined,
): string[] {
  const ref = resolveObjectTypeRef(expr)
  if (!ref) return []
  return listInterfaceFieldNames(ref, library)
}

export {
  buildAutoFieldMappings,
  listInterfaceFieldNames,
  mergeSavedFieldMappings,
  readFieldMappings,
}

export function readObjectMapApplyConfig(
  data: Record<string, unknown>,
): ObjectMapApplyConfig | null {
  const sourcePath =
    typeof data.sourcePath === 'string' ? data.sourcePath.trim() : ''
  const targetVarName =
    (typeof data.targetVarName === 'string'
      ? data.targetVarName.trim()
      : '') ||
    (typeof data.targetPath === 'string' ? data.targetPath.trim() : '')
  if (!sourcePath || !targetVarName) return null
  return {
    sourcePath,
    targetVarName,
    fieldMappings: readFieldMappings(data.fieldMappings),
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function evalPath(scope: Record<string, unknown>, path: string): unknown {
  const expr = path.trim()
  if (!expr) return undefined
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k))
  const values = keys.map((k) => scope[k])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict"; return (${expr});`)
  return fn(...values)
}

/** 将源对象按字段映射写入目标对象并写回 scope */
export function applyObjectMap(
  scope: Record<string, unknown>,
  config: ObjectMapApplyConfig,
): void {
  const { sourcePath, targetVarName, fieldMappings } = config
  if (!sourcePath.trim() || !targetVarName.trim()) return

  const src = asRecord(evalPath(scope, sourcePath))
  const out: Record<string, unknown> = {}
  for (const m of fieldMappings) {
    const targetField = m.targetField.trim()
    const sourceField = m.sourceField.trim()
    if (!targetField || !sourceField) continue
    if (Object.prototype.hasOwnProperty.call(src, sourceField)) {
      out[targetField] = src[sourceField]
    }
  }
  scope[targetVarName.trim()] = out
}
