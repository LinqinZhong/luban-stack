/**
 * Entity 字段（小驼峰）↔ 数据表列名（下划线）互转。
 * 已是下划线且无大写时保持原样，避免二次改写。
 */

export function camelToSnake(name: string): string {
  const raw = name.trim()
  if (!raw) return raw
  if (!/[A-Z]/.test(raw)) return raw
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

export function snakeToCamel(name: string): string {
  const raw = name.trim()
  if (!raw) return raw
  if (!raw.includes('_')) return raw
  return raw.replace(/_([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** 将查询结果行的下划线列名转为小驼峰，便于对齐 entity */
export function mapRowKeysToCamel(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[snakeToCamel(key)] = value
  }
  return out
}
