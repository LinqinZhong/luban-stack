import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { BadRequestException } from '@nestjs/common'

type OssEnvConfig = {
  connectionId: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

function readOssEnv(): OssEnvConfig {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID?.trim() || ''
  const secretAccessKey = process.env.OSS_SECRET_ACCESS_KEY ?? ''
  if (!accessKeyId || !secretAccessKey) {
    throw new BadRequestException(
      '缺少 OSS 配置（请在 .env.development / .env.production 填写 OSS_ACCESS_KEY_ID / OSS_SECRET_ACCESS_KEY）',
    )
  }
  return {
    connectionId: process.env.OSS_CONNECTION_ID?.trim() || '',
    endpoint: process.env.OSS_ENDPOINT?.trim() || '',
    region: process.env.OSS_REGION?.trim() || 'us-east-1',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: String(process.env.OSS_FORCE_PATH_STYLE ?? 'true') !== 'false',
  }
}

function createClient(conn: OssEnvConfig): S3Client {
  return new S3Client({
    region: conn.region || 'us-east-1',
    endpoint: conn.endpoint || undefined,
    forcePathStyle: conn.forcePathStyle,
    credentials: {
      accessKeyId: conn.accessKeyId,
      secretAccessKey: conn.secretAccessKey,
    },
  })
}

export async function signOssObject(input: {
  connectionId: string
  bucketName: string
  key: string
  expiresIn: number
}): Promise<{ signedUrl: string; expiresIn: number; expiresAt: number }> {
  const connectionId = input.connectionId.trim()
  const bucketName = input.bucketName.trim()
  const key = input.key.trim()
  if (!bucketName) throw new BadRequestException('缺少 bucketName')
  if (!key) throw new BadRequestException('缺少 key')

  const conn = readOssEnv()
  if (
    conn.connectionId &&
    connectionId &&
    connectionId !== conn.connectionId
  ) {
    throw new BadRequestException(
      `OSS connectionId 与当前环境不匹配（期望 ${conn.connectionId}）`,
    )
  }

  const expiresIn = Math.max(60, Math.floor(Number(input.expiresIn) || 3600))
  const client = createClient(conn)
  const signedUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
    { expiresIn },
  )
  return {
    signedUrl,
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
  }
}
