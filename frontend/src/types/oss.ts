/** 项目级 OSS（S3 兼容）连接配置（oss.json） */

export const OSS_FILE = 'oss.json'

export interface OssBucketInfo {
  name: string
  /** 创建时间 ISO 字符串 */
  creationDate: string | null
  /** 约略对象数（列表时可能为空） */
  objectCount: number | null
  region: string
  /** 桶访问级别：公有可读 / 私有（需签名） */
  access?: 'public' | 'private'
}

export interface OssObjectInfo {
  key: string
  size: number
  lastModified: string | null
  etag: string
  storageClass: string
  /** 是否为公共前缀（目录） */
  isPrefix: boolean
}

export interface OssConnectionConfig {
  id: string
  /** 显示名称 */
  name: string
  /** Endpoint，如 https://oss-cn-hangzhou.aliyuncs.com 或 http://127.0.0.1:9000 */
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** MinIO 等需开启 path-style */
  forcePathStyle: boolean
  /** 最近一次成功拉取的桶列表 */
  buckets: OssBucketInfo[]
  /** 最近一次测试成功时间戳 */
  lastTestedAt: number | null
}

export interface OssLibrary {
  connections: OssConnectionConfig[]
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyOssConnection(name = '对象存储'): OssConnectionConfig {
  return {
    id: uid('oss'),
    name,
    endpoint: '',
    region: 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: true,
    buckets: [],
    lastTestedAt: null,
  }
}

export function createEmptyOssLibrary(): OssLibrary {
  return { connections: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBucket(input: unknown): OssBucketInfo | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return null
  return {
    name,
    creationDate:
      typeof input.creationDate === 'string' && input.creationDate
        ? input.creationDate
        : null,
    objectCount:
      input.objectCount == null || input.objectCount === ''
        ? null
        : Number.isFinite(Number(input.objectCount))
          ? Number(input.objectCount)
          : null,
    region: typeof input.region === 'string' ? input.region : '',
    access: input.access === 'public' ? 'public' : 'private',
  }
}

function normalizeConnection(input: unknown): OssConnectionConfig | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return null
  const buckets = Array.isArray(input.buckets)
    ? input.buckets.map(normalizeBucket).filter((b): b is OssBucketInfo => Boolean(b))
    : []
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('oss'),
    name,
    endpoint: typeof input.endpoint === 'string' ? input.endpoint.trim() : '',
    region:
      typeof input.region === 'string' && input.region.trim()
        ? input.region.trim()
        : 'us-east-1',
    accessKeyId: typeof input.accessKeyId === 'string' ? input.accessKeyId.trim() : '',
    secretAccessKey: typeof input.secretAccessKey === 'string' ? input.secretAccessKey : '',
    forcePathStyle: input.forcePathStyle !== false,
    buckets,
    lastTestedAt:
      input.lastTestedAt == null || input.lastTestedAt === ''
        ? null
        : Number(input.lastTestedAt) || null,
  }
}

export function normalizeOssLibrary(input: unknown): OssLibrary {
  if (!isPlainObject(input) || !Array.isArray(input.connections)) {
    return createEmptyOssLibrary()
  }
  return {
    connections: input.connections
      .map(normalizeConnection)
      .filter((c): c is OssConnectionConfig => Boolean(c)),
  }
}

/** 测试连接 / 操作桶用的连接参数（可不带 id/buckets） */
export interface OssConnectionPayload {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}
