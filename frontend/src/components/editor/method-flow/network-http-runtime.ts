import { proxyHttpRequest } from '../../../api/projects'
import {
  coerceNetworkConstant,
  evalNetworkComputedValue,
  isFormUrlEncoded,
  normalizeNetworkInputConfig,
  normalizeNetworkRequestConfig,
  type NetworkParamRow,
} from './dialogs/network-request'

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  return {}
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
    // fall through
  }
  return raw.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const v = scope[name]
    return v == null ? '' : String(v)
  })
}

function resolveParamRows(
  rows: NetworkParamRow[],
  scope: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    if (row.valueKind === 'variable') {
      const varName = row.value.trim()
      if (!varName) continue
      const v = scope[varName]
      out[name] = v == null ? '' : String(v)
    } else if (row.valueKind === 'computed') {
      out[name] = evalNetworkComputedValue(row.value, scope)
    } else {
      out[name] = String(
        coerceNetworkConstant(row.value, row.constantType ?? 'string'),
      )
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
  if (isFormUrlEncoded(mt)) {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(formParams)) sp.set(k, v)
    return { body: sp.toString(), contentType: mt }
  }
  const varName = bodyVarName.trim()
  if (!varName) return { body: null, contentType: mt }
  const value = scope[varName]
  if (value == null) return { body: '', contentType: mt }
  if (typeof value === 'string') return { body: value, contentType: mt }
  try {
    return { body: JSON.stringify(value), contentType: mt }
  } catch {
    return { body: String(value), contentType: mt }
  }
}

export type ResolvedNetworkHttp = {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
  contentType: string
}

export function resolveNetworkHttpFromNodeData(
  data: Record<string, unknown>,
  scope: Record<string, unknown>,
): ResolvedNetworkHttp {
  const networkRaw = asRecord(data.network)
  const src = Object.keys(networkRaw).length ? networkRaw : data
  const cfg = normalizeNetworkRequestConfig(src)
  const apiUrl = resolveUrl(cfg.apiUrl, scope)
  if (!apiUrl) throw new Error('网络节点未配置 API 地址')
  const headers = resolveParamRows(cfg.headers, scope)
  const query = resolveParamRows(cfg.queryParams, scope)
  const formParams = resolveParamRows(cfg.formParams, scope)
  const url = appendQuery(apiUrl, query)
  const { body, contentType } = serializeBody(
    cfg.mediaType,
    formParams,
    cfg.bodyVarName,
    scope,
  )
  return {
    url,
    method: cfg.httpMethod,
    headers,
    body,
    contentType,
  }
}

export async function executeNetworkHttpViaProxy(
  data: Record<string, unknown>,
  scope: Record<string, unknown>,
): Promise<{
  status: number
  headers: Record<string, string>
  bodyText: string
}> {
  const resolved = resolveNetworkHttpFromNodeData(data, scope)
  let result: {
    status: number
    headers: Record<string, string>
    bodyText: string
  }
  try {
    result = await proxyHttpRequest({
      url: resolved.url,
      method: resolved.method,
      headers: resolved.headers,
      body: resolved.body,
      contentType: resolved.contentType,
    })
  } catch (err) {
    throw new Error(
      `外部接口请求失败：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (result.status < 200 || result.status >= 300) {
    const snippet = (result.bodyText || '').trim().slice(0, 300)
    throw new Error(
      `外部接口请求失败（HTTP ${result.status}）${
        snippet ? `：${snippet}` : ''
      }`,
    )
  }
  return result
}

export function applyNetworkInputToScope(
  data: Record<string, unknown>,
  scope: Record<string, unknown>,
  result: { status: number; headers: Record<string, string>; bodyText: string },
): void {
  const networkRaw = asRecord(data.network)
  const src = Object.keys(networkRaw).length ? networkRaw : data
  const cfg = normalizeNetworkInputConfig(src)
  const bodyVar =
    cfg.responseBodyVarName.trim() ||
    (typeof data.varName === 'string' ? data.varName.trim() : '')
  if (bodyVar) {
    if (cfg.responseBodyType === 'json') {
      try {
        scope[bodyVar] = JSON.parse(result.bodyText || 'null')
      } catch {
        scope[bodyVar] = result.bodyText
      }
    } else {
      scope[bodyVar] = result.bodyText
    }
  }
  const headerVar = cfg.responseHeaderVarName.trim()
  if (headerVar) scope[headerVar] = { ...result.headers }
  const statusVar = cfg.statusCodeVarName.trim()
  if (statusVar) scope[statusVar] = result.status
}
