/** JSON 安全：Map → 普通对象（键转字符串） */
export function jsonSafeValue(value: unknown): unknown {
  if (value instanceof Map) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of value.entries()) {
      out[String(k)] = jsonSafeValue(v)
    }
    return out
  }
  if (Array.isArray(value)) return value.map(jsonSafeValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonSafeValue(v)
    }
    return out
  }
  return value
}

/** 将普通对象还原为可 .get/.set 的 Map */
export function coerceToRuntimeMap(
  value: unknown,
  keyType?: string | null,
): Map<string | number, unknown> {
  if (value instanceof Map) return value as Map<string | number, unknown>
  const keyIsNumber = keyType === 'number'
  const m = new Map<string | number, unknown>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return m
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keyIsNumber) {
      const n = Number(k)
      if (Number.isNaN(n)) continue
      m.set(n, v)
    } else {
      m.set(k, v)
    }
  }
  return m
}

export function coerceMapTypedOutput(
  value: unknown,
  outputType?: string | null,
  keyType?: string | null,
): unknown {
  if (outputType !== 'map') return value
  return coerceToRuntimeMap(value, keyType)
}
