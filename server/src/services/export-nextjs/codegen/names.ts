/** 可读标识符工具 */

export function slugify(name: string, fallback = 'resource'): string {
  const s = name
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || fallback
}

export function toPascalCase(name: string, fallback = 'Resource'): string {
  const parts = slugify(name, fallback).split('-').filter(Boolean)
  if (!parts.length) return fallback
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

export function toCamelCase(name: string, fallback = 'resource'): string {
  const pascal = toPascalCase(name, fallback)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/** 合法 TS 标识符 */
export function safeIdent(name: string, fallback = 'value'): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_$]/g, '_')
  if (!cleaned) return fallback
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`
  return cleaned
}
