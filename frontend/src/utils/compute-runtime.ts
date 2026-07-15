import {
  type DataField,
  type DataFieldValue,
  type PageData,
} from '../types/page-data'

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

function cloneValue<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

/** 在隔离函数中执行计算体；scope 中的字段名可作为自由变量引用 */
export function runComputeBody(
  body: string,
  scope: Record<string, unknown>,
): unknown {
  const names = Object.keys(scope).filter(isValidIdent)
  const values = names.map((name) => scope[name])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, `"use strict";\n${body}`)
  return fn(...values)
}

function seedScope(fields: DataField[]): Record<string, unknown> {
  const scope: Record<string, unknown> = {}
  for (const field of fields) {
    const name = field.name.trim()
    if (!name || !isValidIdent(name)) continue
    scope[name] = cloneValue(field.value)
  }
  return scope
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return Object.is(a, b)
  }
}

/**
 * 执行数据池中 binding === 'computed' 的字段，返回带计算结果的 PageData 副本。
 * 多趟求值，使互相依赖的计算字段有机会拿到最新值。
 */
export function resolveComputedPageData(data: PageData | undefined | null): PageData {
  const source = data?.fields ?? []
  const fields: DataField[] = source.map((item) => ({
    ...item,
    arrayFields: item.arrayFields ? [...item.arrayFields] : undefined,
    objectFields: item.objectFields ? [...item.objectFields] : undefined,
  }))

  const computedCount = fields.filter((item) => item.binding === 'computed').length
  if (!computedCount) return { fields }

  const scope = seedScope(fields)
  const maxPass = computedCount + 1

  for (let pass = 0; pass < maxPass; pass++) {
    let changed = false
    for (const field of fields) {
      if (field.binding !== 'computed') continue
      const body = field.computeBody?.trim()
      if (!body) continue
      const name = field.name.trim()
      try {
        const next = runComputeBody(body, scope) as DataFieldValue
        const prev = name && isValidIdent(name) ? scope[name] : field.value
        field.value = next as DataFieldValue
        if (name && isValidIdent(name)) {
          scope[name] = cloneValue(next)
        }
        if (!sameJson(prev, next)) changed = true
      } catch (err) {
        console.warn(`[voider] 计算字段「${name || '?'}」执行失败:`, err)
      }
    }
    if (!changed) break
  }

  return { fields }
}

/** 取单个字段在计算解析后的值（用于数据池预览） */
export function resolveFieldComputedValue(
  data: PageData,
  fieldName: string,
): DataFieldValue | undefined {
  const resolved = resolveComputedPageData(data)
  return resolved.fields.find((item) => item.name.trim() === fieldName.trim())?.value
}
