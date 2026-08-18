import { ProjectError } from './project.js'

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
    throw new ProjectError(`无效的 API 地址：${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProjectError('仅支持 http/https 地址')
  }
  return parsed
}

function formatFetchFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause && typeof cause === 'object') {
    const c = cause as { code?: string; message?: string }
    if (c.code === 'ECONNREFUSED') return '连接被拒绝（目标服务未启动或地址/端口不正确）'
    if (c.code === 'ENOTFOUND') return '域名无法解析'
    if (c.code === 'ETIMEDOUT' || c.code === 'ECONNABORTED') return '连接超时'
    if (typeof c.message === 'string' && c.message.trim()) return c.message.trim()
  }
  return err.message || '网络错误'
}

/**
 * 服务端代发 HTTP 请求（流程网络节点调试 / 网关共用）
 */
export async function executeHttpProxy(
  req: HttpProxyRequest,
): Promise<HttpProxyResult> {
  const url = String(req.url ?? '').trim()
  if (!url) throw new ProjectError('请提供 API 地址')
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

  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw new ProjectError(`外部接口请求失败：${formatFetchFailure(err)}`)
  }
  const bodyText = await res.text()
  const outHeaders: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    outHeaders[key] = value
  })
  if (!res.ok) {
    const snippet = bodyText.trim().slice(0, 300)
    throw new ProjectError(
      `外部接口请求失败（HTTP ${res.status}）${
        snippet ? `：${snippet}` : ''
      }`,
    )
  }
  return {
    status: res.status,
    headers: outHeaders,
    bodyText,
  }
}
