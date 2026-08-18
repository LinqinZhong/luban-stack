import {
  CUSTOM_CONDITION_FIELD,
  type DataMethodCondition,
  type DataMethodConditionGroup,
} from '../types/backend-services'
import type { DataTypeLibrary, TypeExpr } from '../types/data-types'
import { findDataTypeDef, typeExprToDataFieldType } from './named-type-fields'
import { DM } from '../components/editor/edit-data-method-copy'

export type ConditionValueUi = 'string' | 'number' | 'boolean' | 'datetime'

export type ConditionFieldOption = {
  value: string
  label: string
  valueUi: ConditionValueUi
}

function inferValueUi(
  fieldName: string,
  typeExpr: TypeExpr | undefined,
  library: DataTypeLibrary | null | undefined,
): ConditionValueUi {
  if (typeExpr) {
    const mapped = typeExprToDataFieldType(typeExpr, library)
    if (mapped.type === 'number') return 'number'
    if (mapped.type === 'boolean') return 'boolean'
    if (mapped.typeRef) {
      const def = findDataTypeDef(library, mapped.typeRef)
      const n = (def?.name || '').toLowerCase()
      if (n.includes('date') || n.includes('time')) return 'datetime'
    }
  }
  const n = fieldName.toLowerCase()
  if (
    n.includes('time') ||
    n.includes('date') ||
    n.endsWith('at') ||
    n.includes('datetime')
  ) {
    return 'datetime'
  }
  return 'string'
}

/** 按实体 interface 字段生成条件字段选项 */
export function buildConditionFieldOptions(
  typeLibrary: DataTypeLibrary | null | undefined,
  entityRef: string,
): ConditionFieldOption[] {
  const def = findDataTypeDef(typeLibrary, entityRef)
  const opts: ConditionFieldOption[] = []
  if (def?.kind === 'interface') {
    for (const f of def.fields) {
      const name = f.name.trim()
      if (!name) continue
      opts.push({
        value: name,
        label: f.remark?.trim() ? `${name}${DM.mid}${f.remark.trim()}` : name,
        valueUi: inferValueUi(name, f.type, typeLibrary),
      })
    }
  }
  opts.push({
    value: CUSTOM_CONDITION_FIELD,
    label: DM.custom,
    valueUi: 'string',
  })
  return opts
}

export function conditionColumnName(cond: DataMethodCondition): string {
  if (cond.field === CUSTOM_CONDITION_FIELD || !cond.field) {
    return cond.customField.trim()
  }
  return cond.field.trim()
}

/** 序列化可落盘的条件组（去掉空字段行） */
export function serializeConditionGroups(
  groups: DataMethodConditionGroup[],
): DataMethodConditionGroup[] {
  return groups
    .map((g) => ({
      id: g.id,
      enableCondition: (g.enableCondition ?? '').trim(),
      conditions: g.conditions
        .map((c) => ({
          ...c,
          field: c.field.trim() || CUSTOM_CONDITION_FIELD,
          customField: c.customField.trim(),
          value: c.value,
          valueTo: c.valueTo,
          enableCondition: (c.enableCondition ?? '').trim(),
        }))
        .filter((c) => Boolean(conditionColumnName(c))),
    }))
    .filter((g) => g.conditions.length > 0)
}

function evalEnable(
  expression: string | undefined,
  scope: Record<string, unknown>,
): boolean {
  const body = (expression ?? '').trim()
  if (!body) return true
  try {
    const keys = Object.keys(scope).filter((k) =>
      /^[A-Za-z_$][\w$]*$/.test(k),
    )
    const values = keys.map((k) => scope[k])
    // 存的是 function condition() 方法体；兼容旧版单行表达式
    const hasReturn = /\breturn\b/.test(body)
    const inner = hasReturn ? body : `return (${body});`
    const code = `"use strict";\nfunction condition() {\n${inner}\n}\nreturn condition();`
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, code)
    return Boolean(fn(...values))
  } catch {
    return false
  }
}

function resolvePath(scope: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return undefined
  let cur: unknown = scope
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/**
 * 调用侧：按启用条件过滤，并把 param 路径解析成 literal，供 debug API 的 extraConditionGroups 使用。
 */
export function resolveConditionGroupsForInvoke(
  groups: DataMethodConditionGroup[] | undefined | null,
  scope: Record<string, unknown>,
): DataMethodConditionGroup[] {
  if (!groups?.length) return []
  const out: DataMethodConditionGroup[] = []
  for (const g of groups) {
    if (!evalEnable(g.enableCondition, scope)) continue
    const conditions: DataMethodCondition[] = []
    for (const c of g.conditions ?? []) {
      if (!evalEnable(c.enableCondition, scope)) continue
      if (!conditionColumnName(c)) continue
      if (c.valueKind === 'param') {
        const v = resolvePath(scope, c.value)
        const vTo =
          c.op === 'between' ? resolvePath(scope, c.valueTo) : undefined
        conditions.push({
          ...c,
          valueKind: 'literal',
          value:
            v === undefined || v === null
              ? ''
              : typeof v === 'string'
                ? v
                : JSON.stringify(v),
          valueTo:
            vTo === undefined || vTo === null
              ? ''
              : typeof vTo === 'string'
                ? vTo
                : JSON.stringify(vTo),
          enableCondition: '',
        })
      } else {
        conditions.push({ ...c, enableCondition: '' })
      }
    }
    if (conditions.length) {
      out.push({
        id: g.id,
        enableCondition: '',
        conditions,
      })
    }
  }
  return out
}

export function readConditionGroupsFromData(
  data: Record<string, unknown>,
): DataMethodConditionGroup[] {
  const raw = data.conditionGroups
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    .map((g) => ({
      id:
        typeof g.id === 'string' && g.id.trim()
          ? g.id.trim()
          : `cg_${Math.random().toString(36).slice(2, 8)}`,
      enableCondition:
        typeof g.enableCondition === 'string' ? g.enableCondition : '',
      conditions: Array.isArray(g.conditions)
        ? g.conditions
            .filter(
              (c): c is Record<string, unknown> =>
                Boolean(c) && typeof c === 'object',
            )
            .map((c) => ({
              id:
                typeof c.id === 'string' && c.id.trim()
                  ? c.id.trim()
                  : `cond_${Math.random().toString(36).slice(2, 8)}`,
              field: typeof c.field === 'string' ? c.field : '',
              customField:
                typeof c.customField === 'string' ? c.customField : '',
              op: (typeof c.op === 'string' ? c.op : 'eq') as DataMethodCondition['op'],
              valueKind: c.valueKind === 'param' ? 'param' : 'literal',
              value: typeof c.value === 'string' ? c.value : '',
              valueTo: typeof c.valueTo === 'string' ? c.valueTo : '',
              enableCondition:
                typeof c.enableCondition === 'string' ? c.enableCondition : '',
            }))
        : [],
    }))
}
