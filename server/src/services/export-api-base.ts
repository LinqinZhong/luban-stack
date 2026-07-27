import type { BackendService } from '../types/backend-services.js'
import type { VoiderProjectConfig } from '../types/voider-project.js'

/** 导出前端默认直连 Nest（不再走本地网关 6630） */
export const DEFAULT_EXPORT_API_BASE = 'http://127.0.0.1:3030'

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function readConfiguredMap(
  config: VoiderProjectConfig,
): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = config.apiBaseUrls
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const k = key.trim()
      if (!k || typeof value !== 'string' || !value.trim()) continue
      out[k] = trimBase(value)
    }
  }
  const legacy = config.wechatApiBaseUrl?.trim()
  if (legacy && !out.default) {
    out.default = trimBase(legacy)
  }
  return out
}

/**
 * 由构建方案 backends 生成 apiBaseUrls（name → http://127.0.0.1:port）
 */
export function buildApiBaseUrlsFromBackends(
  backends: Array<{ name: string; port: number }>,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const b of backends) {
    const name = b.name?.trim()
    if (!name) continue
    const port = b.port > 0 ? Math.floor(b.port) : 3030
    map[name] = `http://127.0.0.1:${port}`
  }
  const first = Object.values(map)[0] || DEFAULT_EXPORT_API_BASE
  map.default = first
  return map
}

/**
 * 导出用 baseUrl 字典：key 为 serviceName / `default`（OSS 可另配 `oss`）。
 * 同一服务只保留可读名，不重复写入 serviceId。
 * 若 voider.json 用 serviceId 配置，会归一到对应 serviceName。
 */
export function buildExportApiBaseUrls(
  config: VoiderProjectConfig,
  services: Array<Pick<BackendService, 'id' | 'name'>> = [],
  override?: Record<string, string> | null,
): Record<string, string> {
  if (override && Object.keys(override).length) {
    const map: Record<string, string> = {}
    for (const [k, v] of Object.entries(override)) {
      if (typeof v === 'string' && v.trim()) map[k.trim()] = trimBase(v)
    }
    if (!map.default) {
      map.default =
        Object.values(map)[0] || DEFAULT_EXPORT_API_BASE
    }
    return map
  }
  const configured = readConfiguredMap(config)
  const idToName = new Map<string, string>()
  for (const svc of services) {
    const id = svc.id?.trim()
    if (!id) continue
    idToName.set(id, svc.name?.trim() || id)
  }

  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(configured)) {
    if (key === 'default' || key === 'oss') {
      map[key] = value
      continue
    }
    const asName = idToName.get(key)
    if (asName) {
      if (!map[asName]) map[asName] = value
      continue
    }
    map[key] = value
  }

  const fallback = map.default || DEFAULT_EXPORT_API_BASE
  if (!map.default) map.default = fallback

  for (const svc of services) {
    const name = svc.name?.trim() || svc.id?.trim()
    if (!name) continue
    if (!map[name]) map[name] = fallback
  }

  return map
}

/** 从字典解析某服务的 baseUrl（优先 serviceName） */
export function pickApiBaseUrl(
  map: Record<string, string>,
  serviceId?: string,
  serviceName?: string,
): string {
  const keys = [serviceName, serviceId, 'default', 'oss']
  for (const key of keys) {
    const k = key?.trim()
    if (!k) continue
    const v = map[k]
    if (typeof v === 'string' && v.trim()) return trimBase(v)
  }
  const first = Object.values(map).find((v) => typeof v === 'string' && v.trim())
  return first ? trimBase(first) : DEFAULT_EXPORT_API_BASE
}
