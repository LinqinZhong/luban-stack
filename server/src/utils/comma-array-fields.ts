import type { DataTypeDef, TypeExpr } from '../types/data-types.js'

/** 字段类型是否为数组（如 URI[] / string[]） */
export function isArrayTypeExpr(expr: TypeExpr | null | undefined): boolean {
  const atom = expr?.intersections?.[0]?.alternatives?.[0]
  return atom?.kind === 'array'
}

/** 接口中声明为数组的字段名（varchar 存库时用逗号拼接） */
export function listCommaArrayFieldNames(
  def: DataTypeDef | null | undefined,
): string[] {
  if (!def || def.kind !== 'interface') return []
  return (def.fields ?? [])
    .filter((f) => isArrayTypeExpr(f.type))
    .map((f) => f.name.trim())
    .filter(Boolean)
}

/** 库中的逗号分隔字符串 → 数组；已是数组则原样返回 */
export function coerceCommaArrayValue(value: unknown): unknown {
  if (value == null) return value
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    if (!value) return []
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return value
}

/** 按字段列表把行内字符串拆成数组（查库结果后处理） */
export function coerceCommaArrayFields(
  row: Record<string, unknown>,
  fieldNames: readonly string[],
): Record<string, unknown> {
  if (!fieldNames.length) return row
  if (!fieldNames.some((n) => n in row)) return row
  const cloned: Record<string, unknown> = { ...row }
  for (const name of fieldNames) {
    if (name in cloned) {
      cloned[name] = coerceCommaArrayValue(cloned[name])
    }
  }
  return cloned
}

/** 写入库：数组 → 逗号拼接字符串 */
export function serializeCommaArrayValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((x) => String(x ?? '').trim()).filter(Boolean).join(',')
}
