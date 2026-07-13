export interface ApiInfo {
  message: string
  version: string
}

export interface HealthStatus {
  status: string
  service: string
  timestamp: string
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  let data: unknown = null
  const text = await response.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `请求失败: ${response.status}`
    throw new ApiError(message, response.status)
  }

  return data as T
}

export function getApiInfo() {
  return request<ApiInfo>('/api')
}

export function getHealthStatus() {
  return request<HealthStatus>('/api/health')
}

export { request }
