import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  createEmptyOssLibrary,
  normalizeOssLibrary,
  OSS_FILE,
  type OssBucketInfo,
  type OssConnectionPayload,
  type OssLibrary,
  type OssObjectInfo,
} from '../types/oss.js'
import { ProjectError } from './project.js'

const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

function ossPath(projectPath: string): string {
  return path.join(projectPath, OSS_FILE)
}

export async function readOssLibrary(projectPath: string): Promise<OssLibrary> {
  const filePath = ossPath(projectPath)
  try {
    await access(filePath, constants.R_OK)
  } catch {
    const initial = createEmptyOssLibrary()
    try {
      await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')
    } catch {
      // ignore
    }
    return initial
  }

  try {
    const raw = await readFile(filePath, 'utf-8')
    return normalizeOssLibrary(JSON.parse(raw))
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ProjectError(`${OSS_FILE} 不是合法 JSON`, 400)
    }
    throw new ProjectError(`无法读取 ${OSS_FILE}`, 500)
  }
}

export async function saveOssLibrary(
  projectPath: string,
  library: unknown,
): Promise<OssLibrary> {
  const normalized = normalizeOssLibrary(library)
  const names = new Set<string>()
  for (const conn of normalized.connections) {
    if (names.has(conn.name)) {
      throw new ProjectError(`对象存储连接名称重复：${conn.name}`, 400)
    }
    names.add(conn.name)
  }
  try {
    await writeFile(
      ossPath(projectPath),
      `${JSON.stringify(normalized, null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(`无法写入 ${OSS_FILE}`, 500)
  }
  return normalized
}

export async function ensureOssLibraryFile(projectPath: string): Promise<void> {
  const filePath = ossPath(projectPath)
  try {
    await access(filePath, constants.F_OK)
  } catch {
    const initial = createEmptyOssLibrary()
    await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')
  }
}

function validateConnectionPayload(payload: OssConnectionPayload): void {
  if (!payload.endpoint?.trim()) throw new ProjectError('请填写 Endpoint', 400)
  if (!payload.accessKeyId?.trim()) throw new ProjectError('请填写 AccessKeyId', 400)
  if (!payload.secretAccessKey?.trim()) {
    throw new ProjectError('请填写 SecretAccessKey', 400)
  }
  try {
    // eslint-disable-next-line no-new
    new URL(payload.endpoint.trim())
  } catch {
    throw new ProjectError('Endpoint 格式无效，请包含协议，如 http://127.0.0.1:9000', 400)
  }
}

function createClient(payload: OssConnectionPayload): S3Client {
  validateConnectionPayload(payload)
  return new S3Client({
    endpoint: payload.endpoint.trim(),
    region: payload.region?.trim() || 'us-east-1',
    credentials: {
      accessKeyId: payload.accessKeyId.trim(),
      secretAccessKey: payload.secretAccessKey,
    },
    forcePathStyle: payload.forcePathStyle !== false,
  })
}

function wrapS3Error(err: unknown, fallback: string): never {
  if (err instanceof ProjectError) throw err
  const message =
    err && typeof err === 'object' && 'message' in err && typeof (err as Error).message === 'string'
      ? (err as Error).message
      : fallback
  const name =
    err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string'
      ? (err as { name: string }).name
      : ''
  throw new ProjectError(name ? `${name}: ${message}` : message || fallback, 400)
}

function mapBuckets(
  buckets: { Name?: string; CreationDate?: Date }[] | undefined,
  region: string,
): OssBucketInfo[] {
  return (buckets ?? [])
    .filter((b) => Boolean(b.Name))
    .map((b) => ({
      name: b.Name!,
      creationDate: b.CreationDate ? b.CreationDate.toISOString() : null,
      objectCount: null,
      region,
      access: 'private' as const,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 刷新远端桶列表时保留本地记录的 access */
export function mergeBucketAccess(
  remote: OssBucketInfo[],
  local: OssBucketInfo[] | undefined,
): OssBucketInfo[] {
  const prev = new Map((local ?? []).map((b) => [b.name, b.access]))
  return remote.map((b) => ({
    ...b,
    access: prev.get(b.name) === 'public' ? 'public' : 'private',
  }))
}

function publicBucketPolicy(bucketName: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'VoiderPublicRead',
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucketName}/*`],
      },
    ],
  })
}

export async function setOssBucketAccess(
  payload: OssConnectionPayload,
  bucketName: string,
  access: 'public' | 'private',
): Promise<{ ok: true; access: 'public' | 'private' }> {
  const name = assertBucketName(bucketName)
  if (access !== 'public' && access !== 'private') {
    throw new ProjectError('access 须为 public 或 private', 400)
  }
  const client = createClient(payload)
  try {
    await client.send(new HeadBucketCommand({ Bucket: name }))
    if (access === 'public') {
      await client.send(
        new PutBucketPolicyCommand({
          Bucket: name,
          Policy: publicBucketPolicy(name),
        }),
      )
    } else {
      try {
        await client.send(new DeleteBucketPolicyCommand({ Bucket: name }))
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'name' in err
            ? String((err as { name: unknown }).name)
            : ''
        // 无策略时视为已是私有
        if (
          code !== 'NoSuchBucketPolicy' &&
          code !== 'NoSuchPolicy' &&
          !/NoSuchBucketPolicy|NoSuchPolicy/i.test(
            err instanceof Error ? err.message : '',
          )
        ) {
          throw err
        }
      }
    }
    return { ok: true, access }
  } catch (err) {
    wrapS3Error(err, access === 'public' ? '设为公有失败' : '设为私有失败')
  } finally {
    client.destroy()
  }
}

const DEFAULT_SIGN_EXPIRES_IN = 7 * 24 * 3600

export async function signOssObject(
  payload: OssConnectionPayload,
  bucketName: string,
  key: string,
  expiresIn = DEFAULT_SIGN_EXPIRES_IN,
): Promise<{ signedUrl: string; publicUrl: string; expiresIn: number }> {
  const name = assertBucketName(bucketName)
  const objectKey = key.trim()
  if (!objectKey) throw new ProjectError('请提供对象 Key', 400)
  const ttl = Math.min(
    Math.max(Number(expiresIn) || DEFAULT_SIGN_EXPIRES_IN, 60),
    DEFAULT_SIGN_EXPIRES_IN,
  )
  const client = createClient(payload)
  try {
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: name, Key: objectKey }),
      { expiresIn: ttl },
    )
    return {
      signedUrl,
      publicUrl: buildOssPublicUrl(payload, name, objectKey),
      expiresIn: ttl,
    }
  } catch (err) {
    wrapS3Error(err, '生成签名链接失败')
  } finally {
    client.destroy()
  }
}

export async function signOssObjectByConnectionId(
  projectPath: string,
  connectionId: string,
  bucketName: string,
  key: string,
  expiresIn = DEFAULT_SIGN_EXPIRES_IN,
): Promise<{ signedUrl: string; publicUrl: string; expiresIn: number }> {
  const lib = await readOssLibrary(projectPath)
  const conn = lib.connections.find((c) => c.id === connectionId)
  if (!conn) throw new ProjectError('对象存储连接不存在', 404)
  return signOssObject(
    {
      endpoint: conn.endpoint,
      region: conn.region,
      accessKeyId: conn.accessKeyId,
      secretAccessKey: conn.secretAccessKey,
      forcePathStyle: conn.forcePathStyle,
    },
    bucketName,
    key,
    expiresIn,
  )
}

export async function testOssConnection(payload: OssConnectionPayload): Promise<{
  ok: true
  message: string
  buckets: OssBucketInfo[]
}> {
  const client = createClient(payload)
  try {
    const result = await client.send(new ListBucketsCommand({}))
    const buckets = mapBuckets(result.Buckets, payload.region?.trim() || 'us-east-1')
    return {
      ok: true,
      message: `连接成功，共 ${buckets.length} 个桶`,
      buckets,
    }
  } catch (err) {
    wrapS3Error(err, '对象存储连接失败')
  } finally {
    client.destroy()
  }
}

export async function listOssBuckets(
  payload: OssConnectionPayload,
): Promise<OssBucketInfo[]> {
  const client = createClient(payload)
  try {
    const result = await client.send(new ListBucketsCommand({}))
    return mapBuckets(result.Buckets, payload.region?.trim() || 'us-east-1')
  } catch (err) {
    wrapS3Error(err, '列出桶失败')
  } finally {
    client.destroy()
  }
}

function assertBucketName(name: string): string {
  const bucket = name.trim()
  if (!bucket) throw new ProjectError('请填写桶名称', 400)
  if (!BUCKET_NAME_RE.test(bucket) || bucket.includes('..')) {
    throw new ProjectError(
      '桶名称不合法：3–63 字符，小写字母/数字/点/连字符，且不能以点或连字符开头结尾',
      400,
    )
  }
  return bucket
}

export async function createOssBucket(
  payload: OssConnectionPayload,
  bucketName: string,
): Promise<OssBucketInfo[]> {
  const name = assertBucketName(bucketName)
  const client = createClient(payload)
  try {
    const region = payload.region?.trim() || 'us-east-1'
    // 多数 S3 兼容服务（MinIO / 阿里云 OSS S3）无需 LocationConstraint；
    // AWS 非 us-east-1 才需要。
    if (!region || region === 'us-east-1') {
      await client.send(new CreateBucketCommand({ Bucket: name }))
    } else {
      try {
        await client.send(
          new CreateBucketCommand({
            Bucket: name,
            CreateBucketConfiguration: {
              LocationConstraint: region as never,
            },
          }),
        )
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: name }))
      }
    }
    return await listOssBuckets(payload)
  } catch (err) {
    wrapS3Error(err, '创建桶失败')
  } finally {
    client.destroy()
  }
}

export async function deleteOssBucket(
  payload: OssConnectionPayload,
  bucketName: string,
): Promise<OssBucketInfo[]> {
  const name = assertBucketName(bucketName)
  const client = createClient(payload)
  try {
    await client.send(new HeadBucketCommand({ Bucket: name }))
    // 先检查是否为空
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 }),
    )
    if ((listed.KeyCount ?? 0) > 0 || (listed.Contents?.length ?? 0) > 0) {
      throw new ProjectError('桶不为空，请先删除所有对象后再删除桶', 400)
    }
    await client.send(new DeleteBucketCommand({ Bucket: name }))
    return await listOssBuckets(payload)
  } catch (err) {
    wrapS3Error(err, '删除桶失败')
  } finally {
    client.destroy()
  }
}

export async function listOssObjects(
  payload: OssConnectionPayload,
  bucketName: string,
  options: { prefix?: string; continuationToken?: string; maxKeys?: number } = {},
): Promise<{
  objects: OssObjectInfo[]
  prefixes: OssObjectInfo[]
  prefix: string
  isTruncated: boolean
  nextContinuationToken: string | null
}> {
  const name = assertBucketName(bucketName)
  const prefix = typeof options.prefix === 'string' ? options.prefix : ''
  const client = createClient(payload)
  try {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: name,
        Prefix: prefix || undefined,
        Delimiter: '/',
        ContinuationToken: options.continuationToken || undefined,
        MaxKeys: Math.min(Math.max(Number(options.maxKeys) || 100, 1), 1000),
      }),
    )

    const prefixes: OssObjectInfo[] = (result.CommonPrefixes ?? [])
      .filter((p) => Boolean(p.Prefix))
      .map((p) => ({
        key: p.Prefix!,
        size: 0,
        lastModified: null,
        etag: '',
        storageClass: '',
        isPrefix: true,
      }))

    const objects: OssObjectInfo[] = (result.Contents ?? [])
      .filter((obj) => Boolean(obj.Key) && obj.Key !== prefix)
      .map((obj) => ({
        key: obj.Key!,
        size: Number(obj.Size) || 0,
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
        etag: (obj.ETag ?? '').replaceAll('"', ''),
        storageClass: obj.StorageClass ?? '',
        isPrefix: false,
      }))

    return {
      objects,
      prefixes,
      prefix,
      isTruncated: Boolean(result.IsTruncated),
      nextContinuationToken: result.NextContinuationToken ?? null,
    }
  } catch (err) {
    wrapS3Error(err, '列出对象失败')
  } finally {
    client.destroy()
  }
}

export async function uploadOssObject(
  payload: OssConnectionPayload,
  bucketName: string,
  options: {
    key: string
    /** base64 内容 */
    contentBase64: string
    contentType?: string
  },
): Promise<{ ok: true; key: string; size: number }> {
  const name = assertBucketName(bucketName)
  const key = options.key.trim().replace(/^\/+/, '')
  if (!key) throw new ProjectError('请填写对象 Key', 400)
  if (!options.contentBase64) throw new ProjectError('请提供文件内容', 400)

  let body: Buffer
  try {
    body = Buffer.from(options.contentBase64, 'base64')
  } catch {
    throw new ProjectError('文件内容不是合法 base64', 400)
  }
  if (body.length > 32 * 1024 * 1024) {
    throw new ProjectError('单次上传不超过 32MB', 400)
  }

  const client = createClient(payload)
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: name,
        Key: key,
        Body: body,
        ContentType: options.contentType || 'application/octet-stream',
      }),
    )
    return { ok: true, key, size: body.length }
  } catch (err) {
    wrapS3Error(err, '上传对象失败')
  } finally {
    client.destroy()
  }
}

export async function deleteOssObject(
  payload: OssConnectionPayload,
  bucketName: string,
  key: string,
): Promise<{ ok: true }> {
  const name = assertBucketName(bucketName)
  const objectKey = key.trim()
  if (!objectKey) throw new ProjectError('请提供对象 Key', 400)

  const client = createClient(payload)
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: name,
        Key: objectKey,
      }),
    )
    return { ok: true }
  } catch (err) {
    wrapS3Error(err, '删除对象失败')
  } finally {
    client.destroy()
  }
}

function encodeObjectKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

/** 拼接公开访问外链（需桶/对象本身可读） */
export function buildOssPublicUrl(
  payload: OssConnectionPayload,
  bucketName: string,
  key: string,
): string {
  const endpoint = payload.endpoint.trim().replace(/\/+$/, '')
  const encodedKey = encodeObjectKey(key.replace(/^\/+/, ''))
  if (payload.forcePathStyle !== false) {
    return `${endpoint}/${bucketName}/${encodedKey}`
  }
  const url = new URL(endpoint)
  return `${url.protocol}//${bucketName}.${url.host}/${encodedKey}`
}

function isImageObject(key: string, contentType: string): boolean {
  if (contentType.toLowerCase().startsWith('image/')) return true
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(key)
}

export async function getOssObjectMeta(
  payload: OssConnectionPayload,
  bucketName: string,
  key: string,
): Promise<{
  key: string
  size: number
  contentType: string
  lastModified: string | null
  etag: string
  publicUrl: string
  signedUrl: string
  isImage: boolean
}> {
  const name = assertBucketName(bucketName)
  const objectKey = key.trim()
  if (!objectKey) throw new ProjectError('请提供对象 Key', 400)

  const client = createClient(payload)
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: name,
        Key: objectKey,
      }),
    )
    const contentType = result.ContentType ?? 'application/octet-stream'
    const isImage = isImageObject(objectKey, contentType)
    const publicUrl = buildOssPublicUrl(payload, name, objectKey)
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: name, Key: objectKey }),
      { expiresIn: 3600 },
    )
    return {
      key: objectKey,
      size: Number(result.ContentLength) || 0,
      contentType,
      lastModified: result.LastModified ? result.LastModified.toISOString() : null,
      etag: (result.ETag ?? '').replaceAll('"', ''),
      publicUrl,
      signedUrl,
      isImage,
    }
  } catch (err) {
    wrapS3Error(err, '获取对象信息失败')
  } finally {
    client.destroy()
  }
}

export async function getOssObjectPublicUrl(
  payload: OssConnectionPayload,
  bucketName: string,
  key: string,
): Promise<{ publicUrl: string }> {
  const name = assertBucketName(bucketName)
  const objectKey = key.trim()
  if (!objectKey) throw new ProjectError('请提供对象 Key', 400)
  return {
    publicUrl: buildOssPublicUrl(payload, name, objectKey),
  }
}
