import type { DataFieldType, DataFieldValue } from './page-data'

/** 页面 Query 入参定义（URL ?key= / 小程序 onLoad options） */
export interface PageQueryParamDef {
  name: string
  /** 基础类型；query 串以字符串传入，调试时可按类型转换 */
  type: Extract<DataFieldType, 'string' | 'number' | 'boolean'>
  remark: string
  required?: boolean
  defaultValue?: DataFieldValue
}

export function createEmptyPageQueryParam(name = ''): PageQueryParamDef {
  return {
    name,
    type: 'string',
    remark: '',
    required: false,
    defaultValue: '',
  }
}

export function normalizePageQueryParam(input: unknown): PageQueryParamDef | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name || !/^[A-Za-z_][\w]*$/.test(name)) return null
  const type =
    raw.type === 'number' || raw.type === 'boolean' ? raw.type : 'string'
  let defaultValue: DataFieldValue = ''
  if (type === 'number') {
    defaultValue =
      typeof raw.defaultValue === 'number' && Number.isFinite(raw.defaultValue)
        ? raw.defaultValue
        : 0
  } else if (type === 'boolean') {
    defaultValue = Boolean(raw.defaultValue)
  } else {
    defaultValue =
      raw.defaultValue == null
        ? ''
        : typeof raw.defaultValue === 'string'
          ? raw.defaultValue
          : String(raw.defaultValue)
  }
  return {
    name,
    type,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    required: Boolean(raw.required),
    defaultValue,
  }
}

export function normalizePageQueryParams(input: unknown): PageQueryParamDef[] {
  if (!Array.isArray(input)) return []
  const out: PageQueryParamDef[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const p = normalizePageQueryParam(item)
    if (!p || seen.has(p.name)) continue
    seen.add(p.name)
    out.push(p)
  }
  return out
}

export function normalizeDebugQuery(
  input: unknown,
): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = k.trim()
    if (!key || !/^[A-Za-z_][\w]*$/.test(key)) continue
    out[key] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** 由定义 + 调试/运行时值组装 $query 对象 */
export function buildQueryObject(
  defs: PageQueryParamDef[] | undefined | null,
  values?: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const def of defs ?? []) {
    const name = def.name.trim()
    if (!name) continue
    if (values && Object.prototype.hasOwnProperty.call(values, name)) {
      out[name] = values[name]
    } else {
      out[name] = def.defaultValue ?? (def.type === 'number' ? 0 : def.type === 'boolean' ? false : '')
    }
  }
  if (values) {
    for (const [k, v] of Object.entries(values)) {
      if (!(k in out)) out[k] = v
    }
  }
  return out
}
