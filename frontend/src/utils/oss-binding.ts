import { getOssLibrary } from '../api/projects'
import type { OssBindingConfig } from '../types/page-data'
import type { OssConnectionPayload } from '../types/oss'

export function buildIconSvgMarkup(viewBox: string, content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${content}</svg>`
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/** 图标绑定到 OSS 时的对象 key：icon_ 前缀 + 随机串 */
export function createIconOssObjectKey(): string {
  const rand = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  return `icon_${rand}.svg`
}

export function buildOssPublicUrl(
  payload: Pick<OssConnectionPayload, 'endpoint' | 'forcePathStyle'>,
  bucketName: string,
  key: string,
): string | null {
  if (!payload.endpoint?.trim() || !bucketName.trim() || !key.trim()) return null
  const endpoint = payload.endpoint.trim().replace(/\/+$/, '')
  const encodedKey = key
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  try {
    if (payload.forcePathStyle !== false) {
      return `${endpoint}/${bucketName}/${encodedKey}`
    }
    const url = new URL(endpoint)
    return `${url.protocol}//${bucketName}.${url.host}/${encodedKey}`
  } catch {
    return `${endpoint}/${bucketName}/${encodedKey}`
  }
}

export async function resolveOssConnectionPayload(
  projectPath: string,
  binding: Pick<OssBindingConfig, 'connectionId'>,
): Promise<OssConnectionPayload> {
  const lib = await getOssLibrary(projectPath)
  const conn = (lib.connections ?? []).find((c) => c.id === binding.connectionId)
  if (!conn) {
    throw new Error('对象存储连接不存在或已删除')
  }
  return {
    endpoint: conn.endpoint,
    region: conn.region,
    accessKeyId: conn.accessKeyId,
    secretAccessKey: conn.secretAccessKey,
    forcePathStyle: conn.forcePathStyle,
  }
}

export function isOssBound(
  binding: OssBindingConfig | undefined | null,
): binding is OssBindingConfig {
  return Boolean(
    binding?.connectionId?.trim() &&
      binding.bucketName?.trim() &&
      binding.objectKey?.trim(),
  )
}
