export interface ApiInfo {
  message: string
  version: string
}

export interface HealthStatus {
  status: string
  service: string
  timestamp: string
}

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function getApiInfo() {
  return request<ApiInfo>('/api')
}

export function getHealthStatus() {
  return request<HealthStatus>('/api/health')
}
