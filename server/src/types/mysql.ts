/** 项目级 MySQL 连接配置（mysql.json） */

export const MYSQL_FILE = 'mysql.json'
/** 每张表的结构元数据目录：mysql/{tableName}.json */
export const MYSQL_SCHEMA_DIR = 'mysql'

export type MysqlSshAuthType = 'password' | 'privateKey'

export interface MysqlSshConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  authType: MysqlSshAuthType
  password: string
  privateKey: string
  passphrase: string
}

export interface MysqlTableInfo {
  name: string
  remark: string
  /** 引擎，如 InnoDB */
  engine: string
  /** 约略行数 */
  rows: number | null
}

/** 建表 / 改表用的列定义 */
export interface MysqlColumnDef {
  name: string
  /** 如 varchar(255)、bigint、datetime */
  type: string
  nullable: boolean
  primaryKey: boolean
  autoIncrement: boolean
  defaultValue: string
  comment: string
  /** 是否资源外链列（存于 mysql/{table}.json，非 DDL） */
  resource?: boolean
  /** 编辑时：原列名，用于 CHANGE COLUMN */
  originalName?: string
}

/** 本地持久化的表结构（mysql/{tableName}.json） */
export interface MysqlTableSchemaFile {
  name: string
  remark: string
  columns: MysqlColumnDef[]
  syncedAt: number | null
}

export interface MysqlTableDef {
  name: string
  remark: string
  columns: MysqlColumnDef[]
}

export interface MysqlDatabaseConfig {
  id: string
  /** 显示名称 */
  name: string
  host: string
  port: number
  username: string
  password: string
  /** 连接后使用的库名 */
  database: string
  ssh: MysqlSshConfig
  /** 最近一次成功拉取的表列表 */
  tables: MysqlTableInfo[]
  /** 最近一次测试成功时间戳 */
  lastTestedAt: number | null
}

export interface MysqlLibrary {
  databases: MysqlDatabaseConfig[]
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptySshConfig(): MysqlSshConfig {
  return {
    enabled: false,
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    password: '',
    privateKey: '',
    passphrase: '',
  }
}

export function createEmptyMysqlDatabase(name = 'mysql'): MysqlDatabaseConfig {
  return {
    id: uid('mysql'),
    name,
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    password: '',
    database: '',
    ssh: createEmptySshConfig(),
    tables: [],
    lastTestedAt: null,
  }
}

export function createEmptyMysqlLibrary(): MysqlLibrary {
  return { databases: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSsh(input: unknown): MysqlSshConfig {
  const base = createEmptySshConfig()
  if (!isPlainObject(input)) return base
  return {
    enabled: Boolean(input.enabled),
    host: typeof input.host === 'string' ? input.host.trim() : '',
    port: Number(input.port) > 0 ? Number(input.port) : 22,
    username: typeof input.username === 'string' ? input.username.trim() : '',
    authType: input.authType === 'privateKey' ? 'privateKey' : 'password',
    password: typeof input.password === 'string' ? input.password : '',
    privateKey: typeof input.privateKey === 'string' ? input.privateKey : '',
    passphrase: typeof input.passphrase === 'string' ? input.passphrase : '',
  }
}

function normalizeTable(input: unknown): MysqlTableInfo | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return null
  return {
    name,
    remark: typeof input.remark === 'string' ? input.remark : '',
    engine: typeof input.engine === 'string' ? input.engine : '',
    rows:
      input.rows == null || input.rows === ''
        ? null
        : Number.isFinite(Number(input.rows))
          ? Number(input.rows)
          : null,
  }
}

function normalizeDatabase(input: unknown): MysqlDatabaseConfig | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return null
  const tables = Array.isArray(input.tables)
    ? input.tables.map(normalizeTable).filter((t): t is MysqlTableInfo => Boolean(t))
    : []
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('mysql'),
    name,
    host: typeof input.host === 'string' && input.host.trim() ? input.host.trim() : '127.0.0.1',
    port: Number(input.port) > 0 ? Number(input.port) : 3306,
    username: typeof input.username === 'string' ? input.username.trim() : 'root',
    password: typeof input.password === 'string' ? input.password : '',
    database: typeof input.database === 'string' ? input.database.trim() : '',
    ssh: normalizeSsh(input.ssh),
    tables,
    lastTestedAt:
      input.lastTestedAt == null || input.lastTestedAt === ''
        ? null
        : Number(input.lastTestedAt) || null,
  }
}

export function normalizeMysqlLibrary(input: unknown): MysqlLibrary {
  if (!isPlainObject(input) || !Array.isArray(input.databases)) {
    return createEmptyMysqlLibrary()
  }
  return {
    databases: input.databases
      .map(normalizeDatabase)
      .filter((d): d is MysqlDatabaseConfig => Boolean(d)),
  }
}

/** 测试连接用的连接参数（可不带 id/tables） */
export interface MysqlConnectionPayload {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssh: MysqlSshConfig
}
