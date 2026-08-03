import { executeHttpProxy, type HttpProxyResult } from '../http-proxy.js'

type ParamRow = {
  name?: unknown
  valueKind?: unknown
  value?: unknown
  constantType?: unknown
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  return {}
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

function coerceConstant(
  value: string,
  constantType: unknown,
): string | number | boolean {
  if (constantType === 'boolean') {
    const t = value.trim().toLowerCase()
    if (t === 'true' || t === '1') return true
    if (t === 'false' || t === '0') return false
    return Boolean(value)
  }
  if (constantType === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return value
}

function evalInScope(
  expression: string,
  scope: Record<string, unknown>,
): unknown {
  const expr = expression.trim()
  if (!expr) return undefined
  const keys = Object.keys(scope)
  const values = keys.map((k) => scope[k])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict"; return (${expr});`)
  return fn(...values)
}

function resolveUrl(apiUrl: string, scope: Record<string, unknown>): string {
  const raw = apiUrl.trim()
  if (!raw) return ''
  try {
    const v = evalInScope(raw, scope)
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (v != null && typeof v !== 'object') return String(v)
  } catch {
    // 模板 `{var}` 插值
  }
  return raw.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const v = scope[name]
    return v == null ? '' : String(v)
  })
}

function resolveParamRows(
  rows: unknown,
  scope: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(rows)) return out
  for (const item of rows) {
    const row = item as ParamRow
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!name) continue
    if (row.valueKind === 'variable') {
      const varName = typeof row.value === 'string' ? row.value.trim() : ''
      if (!varName) continue
      const v = scope[varName]
      out[name] = v == null ? '' : String(v)
    } else {
      const raw = row.value == null ? '' : String(row.value)
      out[name] = String(coerceConstant(raw, row.constantType))
    }
  }
  return out
}

function appendQuery(url: string, query: Record<string, string>): string {
  if (!Object.keys(query).length) return url
  const u = new URL(url)
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v)
  }
  return u.toString()
}

function serializeBody(
  mediaType: string,
  formParams: Record<string, string>,
  bodyVarName: string,
  scope: Record<string, unknown>,
): { body: string | null; contentType: string } {
  const mt = mediaType.trim() || 'application/json'
  if (mt === 'application/x-www-form-urlencoded') {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(formParams)) sp.set(k, v)
    return { body: sp.toString(), contentType: mt }
  }
  const varName = bodyVarName.trim()
  if (!varName) return { body: null, contentType: mt }
  const value = scope[varName]
  if (value == null) return { body: '', contentType: mt }
  if (typeof value === 'string') return { body: value, contentType: mt }
  if (mt.includes('xml') && typeof value !== 'object') {
    return { body: String(value), contentType: mt }
  }
  try {
    return { body: JSON.stringify(value), contentType: mt }
  } catch {
    return { body: String(value), contentType: mt }
  }
}

export type ResolvedNetworkRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
  contentType: string
}

export function resolveNetworkRequestFromNodeData(
  data: Record<string, unknown>,
  scope: Record<string, unknown>,
): ResolvedNetworkRequest {
  const network = asRecord(data.network)
  const src = Object.keys(network).length ? network : data
  const apiUrl = resolveUrl(str(src, 'apiUrl'), scope)
  if (!apiUrl) throw new Error('网络节点未配置 API 地址')
  const method = (str(src, 'httpMethod') || 'GET').toUpperCase()
  const headers = resolveParamRows(src.headers, scope)
  const query = resolveParamRows(src.queryParams, scope)
  const formParams = resolveParamRows(src.formParams, scope)
  const mediaType = str(src, 'mediaType') || 'application/json'
  const url = appendQuery(apiUrl, query)
  const { body, contentType } = serializeBody(
    mediaType,
    formParams,
    str(src, 'bodyVarName'),
    scope,
  )
  return { url, method, headers, body, contentType }
}

export async function runNetworkRequest(
  data: Record<string, unknown>,
  scope: Record<string, unknown>,
): Promise<HttpProxyResult> {
  const resolved = resolveNetworkRequestFromNodeData(data, scope)
  return executeHttpProxy({
    url: resolved.url,
    method: resolved.method,
    headers: resolved.headers,
    body: resolved.body,
    contentType: resolved.contentType,
  })
}

export function applyNetworkInputResponse(
  data: Record<string, unknown>,
  scope: Record<string, unknown>,
  result: HttpProxyResult,
): void {
  const network = asRecord(data.network)
  const src = Object.keys(network).length ? network : data
  const bodyType = str(src, 'responseBodyType') || 'string'
  const bodyVar =
    str(src, 'responseBodyVarName') || str(data, 'varName')
  if (bodyVar) {
    if (bodyType === 'json') {
      try {
        scope[bodyVar] = JSON.parse(result.bodyText || 'null')
      } catch {
        scope[bodyVar] = result.bodyText
      }
    } else {
      scope[bodyVar] = result.bodyText
    }
  }
  const headerVar = str(src, 'responseHeaderVarName')
  if (headerVar) scope[headerVar] = { ...result.headers }
  const statusVar = str(src, 'statusCodeVarName')
  if (statusVar) scope[statusVar] = result.status
}
