import type {
  DataMethodCondition,
  DataMethodConditionGroup,
} from '../types/backend-services.js'
import { CUSTOM_CONDITION_FIELD } from '../types/backend-services.js'

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
  const parts = path
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return undefined
  let cur: unknown = scope
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function columnName(cond: DataMethodCondition): string {
  if (cond.field === CUSTOM_CONDITION_FIELD || !cond.field) {
    return (cond.customField ?? '').trim()
  }
  return cond.field.trim()
}

/**
 * 调用侧：按启用条件过滤，并把 param 路径解析成 literal。
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
      if (!columnName(c)) continue
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
      out.push({ id: g.id, enableCondition: '', conditions })
    }
  }
  return out
}
