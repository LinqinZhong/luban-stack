import type { MysqlDatabaseConfig, MysqlLibrary } from '../../types/mysql.js'
import type { OssConnectionConfig, OssLibrary } from '../../types/oss.js'
import type { BackendService } from '../../types/backend-services.js'

export type NestEnvProfile = 'development' | 'production'

export type MysqlEnvSlot = {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  database: string
  /** 引用该库的模块名（展示用） */
  moduleNames: string[]
}

function escapeEnv(value: string): string {
  if (!/[^\w.@:/=+-]/.test(value)) return value
  return JSON.stringify(value)
}

function looksLike(name: string, kinds: 'test' | 'prod'): boolean {
  const n = name.trim().toLowerCase()
  if (kinds === 'test') {
    return /测试|test|dev|开发|staging|stage/.test(n)
  }
  return /生产|prod|production|线上|正式/.test(n)
}

/** 按环境收集模块绑定的去重 MySQL 数据源 */
export function collectMysqlSlots(
  library: MysqlLibrary,
  services: BackendService[],
  profile: NestEnvProfile,
): MysqlEnvSlot[] {
  const byId = new Map(library.databases.map((d) => [d.id, d]))
  const slots = new Map<string, MysqlEnvSlot>()

  for (const svc of services) {
    const ref =
      profile === 'production'
        ? svc.productionMysqlId?.trim()
        : svc.testMysqlId?.trim()
    if (!ref) continue
    const db = byId.get(ref)
    if (!db) continue
    const existing = slots.get(db.id)
    const modName = svc.name?.trim() || svc.id
    if (existing) {
      if (!existing.moduleNames.includes(modName)) {
        existing.moduleNames.push(modName)
      }
      continue
    }
    slots.set(db.id, {
      id: db.id,
      name: db.name,
      host: db.host?.trim() || '',
      port: db.port || 3306,
      username: db.username?.trim() || '',
      password: db.password ?? '',
      database: db.database?.trim() || '',
      moduleNames: [modName],
    })
  }

  if (slots.size === 0 && profile === 'development') {
    const named =
      library.databases.find((d) => looksLike(d.name, 'test')) ||
      library.databases[0]
    if (named) {
      slots.set(named.id, {
        id: named.id,
        name: named.name,
        host: named.host?.trim() || '',
        port: named.port || 3306,
        username: named.username?.trim() || '',
        password: named.password ?? '',
        database: named.database?.trim() || '',
        moduleNames: [],
      })
    }
  }

  return [...slots.values()]
}

/** @deprecated 用 collectMysqlSlots；单库时取首项 */
export function pickMysqlForEnv(
  library: MysqlLibrary,
  services: BackendService[],
  profile: NestEnvProfile,
): MysqlDatabaseConfig | null {
  const slots = collectMysqlSlots(library, services, profile)
  const first = slots[0]
  if (!first) return null
  return (
    library.databases.find((d) => d.id === first.id) ?? null
  )
}

export function pickOssForEnv(
  library: OssLibrary,
  profile: NestEnvProfile,
): OssConnectionConfig | null {
  if (!library.connections.length) return null
  if (profile === 'production') {
    const named = library.connections.find((c) => looksLike(c.name, 'prod'))
    if (named) return named
    if (library.connections.length === 1) {
      const only = library.connections[0]!
      if (!looksLike(only.name, 'test')) return only
    }
    return null
  }
  const named = library.connections.find((c) => looksLike(c.name, 'test'))
  if (named) return named
  return library.connections[0] ?? null
}

function formatOssBlock(
  oss: OssConnectionConfig | null,
  options: { ossName?: string; missingOss?: boolean },
): string[] {
  const lines: string[] = ['# OSS（S3 兼容）']
  if (options.ossName) lines.push(`# 来源：${options.ossName}`)
  if (options.missingOss) lines.push('# 未找到生产 OSS 连接，请按需填写：')
  lines.push(
    `OSS_CONNECTION_ID=${escapeEnv(oss?.id?.trim() || '')}`,
    `OSS_ENDPOINT=${escapeEnv(oss?.endpoint?.trim() || '')}`,
    `OSS_REGION=${escapeEnv(oss?.region?.trim() || 'us-east-1')}`,
    `OSS_ACCESS_KEY_ID=${escapeEnv(oss?.accessKeyId?.trim() || '')}`,
    `OSS_SECRET_ACCESS_KEY=${escapeEnv(oss?.secretAccessKey ?? '')}`,
    `OSS_FORCE_PATH_STYLE=${escapeEnv(
      oss ? (oss.forcePathStyle !== false ? 'true' : 'false') : 'true',
    )}`,
    `OSS_SIGN_EXPIRES_IN=604800`,
    '',
  )
  return lines
}

function formatMysqlSingle(slot: MysqlEnvSlot | null, missing: boolean): string[] {
  const lines: string[] = ['# MySQL']
  if (slot?.name) {
    const mods =
      slot.moduleNames.length > 0
        ? `（模块：${slot.moduleNames.join(', ')}）`
        : ''
    lines.push(`# 来源：${slot.name}${mods}`)
  }
  if (missing) {
    lines.push('# 未配置 MySQL，请按需填写：')
  }
  lines.push(
    `MYSQL_HOST=${escapeEnv(slot?.host || '')}`,
    `MYSQL_PORT=${escapeEnv(String(slot?.port || 3306))}`,
    `MYSQL_USER=${escapeEnv(slot?.username || '')}`,
    `MYSQL_PASSWORD=${escapeEnv(slot?.password ?? '')}`,
    `MYSQL_DATABASE=${escapeEnv(slot?.database || '')}`,
  )
  if (slot?.id) {
    lines.push(`MYSQL_ID=${escapeEnv(slot.id)}`)
  }
  lines.push('')
  return lines
}

function formatMysqlMulti(slots: MysqlEnvSlot[]): string[] {
  const lines: string[] = [
    `# MySQL 多数据源（共 ${slots.length} 个）`,
    '# 运行时按 MYSQL_ID_N 或序号选择连接池',
    '',
  ]
  slots.forEach((slot, i) => {
    const n = i + 1
    const mods =
      slot.moduleNames.length > 0
        ? ` · 模块 ${slot.moduleNames.join(', ')}`
        : ''
    lines.push(`# 数据源 ${n} · ${slot.name || slot.id}${mods}`)
    lines.push(
      `MYSQL_HOST_${n}=${escapeEnv(slot.host)}`,
      `MYSQL_PORT_${n}=${escapeEnv(String(slot.port || 3306))}`,
      `MYSQL_USER_${n}=${escapeEnv(slot.username)}`,
      `MYSQL_PASSWORD_${n}=${escapeEnv(slot.password)}`,
      `MYSQL_DATABASE_${n}=${escapeEnv(slot.database)}`,
      `MYSQL_ID_${n}=${escapeEnv(slot.id)}`,
      '',
    )
  })
  return lines
}

export function formatNestEnvFile(options: {
  profile: NestEnvProfile
  port: number
  mysqlSlots: MysqlEnvSlot[]
  oss: OssConnectionConfig | null
  ossName?: string
  missingOss?: boolean
}): string {
  const lines: string[] = [
    `# ${options.profile === 'production' ? '生产' : '开发/测试'}环境 · NestJS`,
    `# NODE_ENV=${options.profile}`,
    '',
    `PORT=${escapeEnv(String(options.port || 3030))}`,
    '',
  ]

  if (options.mysqlSlots.length >= 2) {
    lines.push(...formatMysqlMulti(options.mysqlSlots))
  } else {
    lines.push(
      ...formatMysqlSingle(
        options.mysqlSlots[0] ?? null,
        options.mysqlSlots.length === 0,
      ),
    )
  }

  lines.push(
    ...formatOssBlock(options.oss, {
      ossName: options.ossName,
      missingOss: options.missingOss,
    }),
  )
  return lines.join('\n')
}

export function formatNestEnvExample(): string {
  return [
    '# 环境变量示例（复制为 .env.development / .env.production 后填写）',
    '# npm run start:dev  → NODE_ENV=development → .env.development',
    '# npm run start:prod → NODE_ENV=production  → .env.production',
    '',
    'PORT=3030',
    '',
    '# 单数据源',
    'MYSQL_HOST=',
    'MYSQL_PORT=3306',
    'MYSQL_USER=',
    'MYSQL_PASSWORD=',
    'MYSQL_DATABASE=',
    'MYSQL_ID=',
    '',
    '# 多数据源时改为 MYSQL_HOST_1 / MYSQL_HOST_2 … 与 MYSQL_ID_1 …',
    '',
    '# OSS（S3 兼容）',
    'OSS_CONNECTION_ID=',
    'OSS_ENDPOINT=',
    'OSS_REGION=us-east-1',
    'OSS_ACCESS_KEY_ID=',
    'OSS_SECRET_ACCESS_KEY=',
    'OSS_FORCE_PATH_STYLE=true',
    'OSS_SIGN_EXPIRES_IN=604800',
    '',
  ].join('\n')
}

/** @deprecated */
export function buildNestEnvValues(_options: {
  mysql: MysqlDatabaseConfig | null
  oss: OssConnectionConfig | null
  port?: number
}): Record<string, string> {
  return {}
}
