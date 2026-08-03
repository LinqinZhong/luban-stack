export type HttpProxyRequest = {
  url: string
  method: string
  headers?: Record<string, string>
  /** 已编码或原始 body；与 contentType 配合 */
  body?: string | null
  contentType?: string | null
}

export type HttpProxyResult = {
  status: number
  headers: Record<string, string>
  bodyText: string
}

function assertHttpUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`无效的 API 地址：${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http/https 地址')
  }
  return parsed
}

/**
 * 服务端代发 HTTP 请求（流程网络节点调试 / 网关共用）
 */
export async function executeHttpProxy(
  req: HttpProxyRequest,
): Promise<HttpProxyResult> {
  const url = String(req.url ?? '').trim()
  if (!url) throw new Error('请提供 API 地址')
  assertHttpUrl(url)

  const method = String(req.method ?? 'GET').trim().toUpperCase() || 'GET'
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const key = k.trim()
    if (!key) continue
    headers[key] = String(v ?? '')
  }
  const contentType = (req.contentType ?? '').trim()
  if (contentType && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = contentType
  }

  const init: RequestInit = {
    method,
    headers,
  }
  if (method !== 'GET' && method !== 'HEAD' && req.body != null && req.body !== '') {
    init.body = req.body
  }

  const res = await fetch(url, init)
  const bodyText = await res.text()
  const outHeaders: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    outHeaders[key] = value
  })
  return {
    status: res.status,
    headers: outHeaders,
    bodyText,
  }
}
