export type ObjectMapFieldMapping = {
  targetField: string
  sourceField: string
}

export type ObjectMapApplyConfig = {
  sourcePath: string
  targetVarName: string
  fieldMappings: ObjectMapFieldMapping[]
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

export function readObjectMapFieldMappings(
  raw: unknown,
): ObjectMapFieldMapping[] {
  if (!Array.isArray(raw)) return []
  const out: ObjectMapFieldMapping[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const targetField =
      typeof (item as ObjectMapFieldMapping).targetField === 'string'
        ? (item as ObjectMapFieldMapping).targetField.trim()
        : ''
    const sourceField =
      typeof (item as ObjectMapFieldMapping).sourceField === 'string'
        ? (item as ObjectMapFieldMapping).sourceField.trim()
        : ''
    if (!targetField) continue
    out.push({ targetField, sourceField })
  }
  return out
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
    fieldMappings: readObjectMapFieldMappings(data.fieldMappings),
  }
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
