import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { Client, type ConnectConfig } from 'ssh2'
import {
  createEmptyMysqlLibrary,
  MYSQL_FILE,
  MYSQL_SCHEMA_DIR,
  normalizeMysqlLibrary,
  type MysqlColumnDef,
  type MysqlConnectionPayload,
  type MysqlIndexDef,
  type MysqlLibrary,
  type MysqlSshConfig,
  type MysqlTableDef,
  type MysqlTableInfo,
  type MysqlTableSchemaFile,
} from '../types/mysql.js'
import { ProjectError } from './project.js'

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const TYPE_RE = /^[A-Za-z][A-Za-z0-9_(),\s]*$/

function mysqlPath(projectPath: string): string {
  return path.join(projectPath, MYSQL_FILE)
}

function schemaDir(projectPath: string): string {
  return path.join(projectPath, MYSQL_SCHEMA_DIR)
}

function schemaFilePath(projectPath: string, tableName: string): string {
  return path.join(schemaDir(projectPath), `${tableName}.json`)
}

function stripColumnMeta(col: MysqlColumnDef): MysqlColumnDef {
  return {
    name: col.name,
    type: col.type,
    nullable: col.nullable,
    primaryKey: col.primaryKey,
    autoIncrement: col.autoIncrement,
    defaultValue: col.defaultValue ?? '',
    comment: col.comment ?? '',
    ...(col.resource ? { resource: true } : {}),
    ...(col.logicDelete ? { logicDelete: true } : {}),
  }
}

function stripIndexMeta(idx: MysqlIndexDef): MysqlIndexDef {
  return {
    name: idx.name,
    columns: [...idx.columns],
    remark: idx.remark ?? '',
  }
}

/** 是否可用于逻辑删除的数字列类型 */
export function isMysqlNumericColumnType(mysqlType: string): boolean {
  const t = mysqlType.trim().toLowerCase()
  if (!t) return false
  return (
    /^(tiny|small|medium|big)?int\b/.test(t) ||
    /^integer\b/.test(t) ||
    /^bigint\b/.test(t) ||
    /^float\b/.test(t) ||
    /^double\b/.test(t) ||
    /^real\b/.test(t) ||
    /^decimal\b/.test(t) ||
    /^numeric\b/.test(t) ||
    /^dec\b/.test(t) ||
    /^bit\b/.test(t) ||
    /^year\b/.test(t) ||
    t === 'bool' ||
    t === 'boolean'
  )
}

export function secondaryIndexName(columnNames: string | string[]): string {
  const cols = Array.isArray(columnNames) ? columnNames : [columnNames]
  return `idx_${cols.join('_')}`
}

function normalizeIndexInput(input: unknown, index: number): MysqlIndexDef {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProjectError(`第 ${index + 1} 个索引定义无效`, 400)
  }
  const row = input as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!name || !IDENT_RE.test(name)) {
    throw new ProjectError(`第 ${index + 1} 个索引名不合法`, 400)
  }
  if (name.toUpperCase() === 'PRIMARY') {
    throw new ProjectError('索引名不能为 PRIMARY', 400)
  }
  const colsRaw = Array.isArray(row.columns) ? row.columns : []
  const columns = colsRaw
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter(Boolean)
  if (!columns.length) {
    throw new ProjectError(`索引「${name}」请至少选择一列`, 400)
  }
  for (const col of columns) {
    if (!IDENT_RE.test(col)) {
      throw new ProjectError(`索引「${name}」含不合法列名「${col}」`, 400)
    }
  }
  return {
    name,
    columns,
    remark: typeof row.remark === 'string' ? row.remark : '',
  }
}

function migrateIndexedColumnsToIndexes(
  columns: MysqlColumnDef[],
  indexes: MysqlIndexDef[],
): { columns: MysqlColumnDef[]; indexes: MysqlIndexDef[] } {
  const nextCols = columns.map((c) => {
    const { indexed: _drop, ...rest } = c
    return rest
  })
  const existingKeys = new Set(
    indexes.map((i) => `${i.name}\0${i.columns.join(',')}`),
  )
  const nextIndexes = [...indexes]
  for (const col of columns) {
    if (!col.indexed || col.primaryKey) continue
    const name = secondaryIndexName(col.name)
    const key = `${name}\0${col.name}`
    if (existingKeys.has(key)) continue
    if (nextIndexes.some((i) => i.name === name)) continue
    nextIndexes.push({ name, columns: [col.name], remark: '' })
    existingKeys.add(key)
  }
  return { columns: nextCols, indexes: nextIndexes }
}

function assertColumnFlags(
  columns: MysqlColumnDef[],
  indexes: MysqlIndexDef[] = [],
): void {
  const indexedColNames = new Set(indexes.flatMap((i) => i.columns))
  let logicDeleteCount = 0
  for (const col of columns) {
    if (col.primaryKey && col.logicDelete) {
      throw new ProjectError(`列「${col.name}」是主键，不能设为逻辑删除`, 400)
    }
    if (col.logicDelete) {
      logicDeleteCount += 1
      if (col.name.toLowerCase() === 'id') {
        throw new ProjectError('列「id」不能设为逻辑删除', 400)
      }
      if (indexedColNames.has(col.name)) {
        throw new ProjectError(
          `列「${col.name}」已在索引中，不能设为逻辑删除`,
          400,
        )
      }
      if (!isMysqlNumericColumnType(col.type)) {
        throw new ProjectError(
          `列「${col.name}」非数字类型，不能设为逻辑删除`,
          400,
        )
      }
    }
  }
  if (logicDeleteCount > 1) {
    throw new ProjectError('一张表只能有一列逻辑删除', 400)
  }

  const colNames = new Set(columns.map((c) => c.name))
  const indexNames = new Set<string>()
  for (const idx of indexes) {
    if (indexNames.has(idx.name)) {
      throw new ProjectError(`索引名重复：${idx.name}`, 400)
    }
    indexNames.add(idx.name)
    for (const c of idx.columns) {
      if (!colNames.has(c)) {
        throw new ProjectError(`索引「${idx.name}」引用了不存在的列「${c}」`, 400)
      }
      const col = columns.find((x) => x.name === c)
      if (col?.primaryKey) {
        throw new ProjectError(
          `索引「${idx.name}」不能包含主键列「${c}」`,
          400,
        )
      }
      if (col?.logicDelete) {
        throw new ProjectError(
          `索引「${idx.name}」不能包含逻辑删除列「${c}」`,
          400,
        )
      }
    }
  }
}

function structuralKey(col: MysqlColumnDef): string {
  const type = col.type.trim().toLowerCase().replace(/\s+/g, '')
  return [
    col.name.trim(),
    type,
    col.nullable ? '1' : '0',
    col.primaryKey ? '1' : '0',
    col.autoIncrement ? '1' : '0',
    (col.defaultValue ?? '').trim(),
    (col.comment ?? '').trim(),
  ].join('\0')
}

export function mysqlSchemasStructurallyEqual(
  a: MysqlColumnDef[],
  b: MysqlColumnDef[],
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (structuralKey(a[i]!) !== structuralKey(b[i]!)) return false
  }
  return true
}

/**
 * 合并本地元数据（resource / logicDelete）到远程列。
 * indexed 已迁移到表级 indexes，不再合并到列上。
 */
export function mergeMysqlResourceFlags(
  remote: MysqlColumnDef[],
  local: MysqlColumnDef[] | null | undefined,
): MysqlColumnDef[] {
  if (!local?.length) {
    return remote.map((c) => ({
      ...c,
      resource: false,
      logicDelete: false,
    }))
  }
  const byName = new Map(
    local.map((c) => [
      c.name,
      {
        resource: Boolean(c.resource),
        logicDelete: Boolean(c.logicDelete),
      },
    ]),
  )
  return remote.map((c) => {
    const meta = byName.get(c.name)
    return {
      ...c,
      resource: meta?.resource ?? false,
      logicDelete: meta?.logicDelete ?? false,
    }
  })
}

function normalizeSchemaFile(
  input: unknown,
  fallbackName = '',
): MysqlTableSchemaFile | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : fallbackName.trim()
  if (!name || !IDENT_RE.test(name)) return null
  const columnsRaw = Array.isArray(raw.columns) ? raw.columns : []
  const columns: MysqlColumnDef[] = []
  for (const item of columnsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const colName = typeof row.name === 'string' ? row.name.trim() : ''
    const type = typeof row.type === 'string' ? row.type.trim() : ''
    if (!colName || !IDENT_RE.test(colName) || !type) continue
    columns.push({
      name: colName,
      type,
      nullable: Boolean(row.nullable),
      primaryKey: Boolean(row.primaryKey),
      autoIncrement: Boolean(row.autoIncrement),
      defaultValue: typeof row.defaultValue === 'string' ? row.defaultValue : '',
      comment: typeof row.comment === 'string' ? row.comment : '',
      ...(row.resource ? { resource: true } : {}),
      ...(row.indexed ? { indexed: true } : {}),
      ...(row.logicDelete ? { logicDelete: true } : {}),
    })
  }
  const indexesRaw = Array.isArray(raw.indexes) ? raw.indexes : []
  const indexes: MysqlIndexDef[] = []
  for (const item of indexesRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const indexName = typeof row.name === 'string' ? row.name.trim() : ''
    if (!indexName || !IDENT_RE.test(indexName)) continue
    const cols = Array.isArray(row.columns)
      ? row.columns
          .map((c) => (typeof c === 'string' ? c.trim() : ''))
          .filter((c) => IDENT_RE.test(c))
      : []
    if (!cols.length) continue
    indexes.push({
      name: indexName,
      columns: cols,
      remark: typeof row.remark === 'string' ? row.remark : '',
    })
  }
  const migrated = migrateIndexedColumnsToIndexes(columns, indexes)
  return {
    name,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    columns: migrated.columns,
    indexes: migrated.indexes,
    syncedAt:
      raw.syncedAt == null || raw.syncedAt === ''
        ? null
        : Number(raw.syncedAt) || null,
  }
}

export async function ensureMysqlSchemaDir(projectPath: string): Promise<void> {
  await mkdir(schemaDir(projectPath), { recursive: true })
}

export async function readMysqlTableSchema(
  projectPath: string,
  tableName: string,
): Promise<MysqlTableSchemaFile | null> {
  if (!IDENT_RE.test(tableName)) return null
  const filePath = schemaFilePath(projectPath, tableName)
  try {
    await access(filePath, constants.R_OK)
  } catch {
    return null
  }
  try {
    const raw = await readFile(filePath, 'utf-8')
    return normalizeSchemaFile(JSON.parse(raw), tableName)
  } catch {
    return null
  }
}

export async function writeMysqlTableSchema(
  projectPath: string,
  tableName: string,
  schema: {
    remark?: string
    columns: MysqlColumnDef[]
    indexes?: MysqlIndexDef[]
  },
): Promise<MysqlTableSchemaFile> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  await ensureMysqlSchemaDir(projectPath)
  const migrated = migrateIndexedColumnsToIndexes(
    schema.columns,
    schema.indexes ?? [],
  )
  const file: MysqlTableSchemaFile = {
    name: tableName,
    remark: schema.remark ?? '',
    columns: migrated.columns.map(stripColumnMeta),
    indexes: migrated.indexes.map(stripIndexMeta),
    syncedAt: Date.now(),
  }
  try {
    await writeFile(
      schemaFilePath(projectPath, tableName),
      `${JSON.stringify(file, null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(`无法写入 ${MYSQL_SCHEMA_DIR}/${tableName}.json`, 500)
  }
  return file
}

export async function deleteMysqlTableSchema(
  projectPath: string,
  tableName: string,
): Promise<void> {
  if (!IDENT_RE.test(tableName)) return
  try {
    await rm(schemaFilePath(projectPath, tableName), { force: true })
  } catch {
    // ignore
  }
}

export async function renameMysqlTableSchema(
  projectPath: string,
  fromName: string,
  toName: string,
): Promise<void> {
  if (!IDENT_RE.test(fromName) || !IDENT_RE.test(toName) || fromName === toName) {
    return
  }
  const from = schemaFilePath(projectPath, fromName)
  const to = schemaFilePath(projectPath, toName)
  try {
    await access(from, constants.F_OK)
  } catch {
    return
  }
  const existing = await readMysqlTableSchema(projectPath, fromName)
  if (existing) {
    await writeMysqlTableSchema(projectPath, toName, {
      remark: existing.remark,
      columns: existing.columns,
    })
    await deleteMysqlTableSchema(projectPath, fromName)
    return
  }
  try {
    await rename(from, to)
  } catch {
    // ignore
  }
}

export async function readMysqlLibrary(projectPath: string): Promise<MysqlLibrary> {
  const filePath = mysqlPath(projectPath)
  try {
    await access(filePath, constants.R_OK)
  } catch {
    const initial = createEmptyMysqlLibrary()
    try {
      await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')
    } catch {
      // ignore
    }
    return initial
  }

  try {
    const raw = await readFile(filePath, 'utf-8')
    return normalizeMysqlLibrary(JSON.parse(raw))
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ProjectError(`${MYSQL_FILE} 不是合法 JSON`, 400)
    }
    throw new ProjectError(`无法读取 ${MYSQL_FILE}`, 500)
  }
}

export async function saveMysqlLibrary(
  projectPath: string,
  library: unknown,
): Promise<MysqlLibrary> {
  const normalized = normalizeMysqlLibrary(library)
  const names = new Set<string>()
  for (const db of normalized.databases) {
    if (names.has(db.name)) {
      throw new ProjectError(`数据库名称重复：${db.name}`, 400)
    }
    names.add(db.name)
  }
  try {
    await writeFile(
      mysqlPath(projectPath),
      `${JSON.stringify(normalized, null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(`无法写入 ${MYSQL_FILE}`, 500)
  }
  return normalized
}

export async function ensureMysqlLibraryFile(projectPath: string): Promise<void> {
  const filePath = mysqlPath(projectPath)
  try {
    await access(filePath, constants.F_OK)
  } catch {
    const initial = createEmptyMysqlLibrary()
    await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')
  }
  await ensureMysqlSchemaDir(projectPath)
}

function validateConnectionPayload(payload: MysqlConnectionPayload): void {
  if (!payload.host?.trim()) throw new ProjectError('请填写 MySQL 主机', 400)
  if (!payload.port || payload.port <= 0) throw new ProjectError('请填写有效的 MySQL 端口', 400)
  if (!payload.username?.trim()) throw new ProjectError('请填写 MySQL 用户名', 400)
  if (payload.ssh?.enabled) {
    if (!payload.ssh.host?.trim()) throw new ProjectError('请填写 SSH 主机', 400)
    if (!payload.ssh.port || payload.ssh.port <= 0) {
      throw new ProjectError('请填写有效的 SSH 端口', 400)
    }
    if (!payload.ssh.username?.trim()) throw new ProjectError('请填写 SSH 用户名', 400)
    if (payload.ssh.authType === 'password' && !payload.ssh.password) {
      throw new ProjectError('请填写 SSH 密码', 400)
    }
    if (payload.ssh.authType === 'privateKey' && !payload.ssh.privateKey?.trim()) {
      throw new ProjectError('请填写 SSH 私钥', 400)
    }
  }
}

async function listenLocalPort(): Promise<{ server: Server; port: number }> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address() as AddressInfo
  return { server, port: addr.port }
}

function buildSshConfig(ssh: MysqlSshConfig): ConnectConfig {
  const config: ConnectConfig = {
    host: ssh.host.trim(),
    port: ssh.port || 22,
    username: ssh.username.trim(),
    readyTimeout: 15000,
  }
  if (ssh.authType === 'privateKey') {
    config.privateKey = ssh.privateKey
    if (ssh.passphrase) config.passphrase = ssh.passphrase
  } else {
    config.password = ssh.password
  }
  return config
}

interface TunnelHandle {
  localPort: number
  close: () => Promise<void>
}

async function openSshTunnel(
  ssh: MysqlSshConfig,
  remoteHost: string,
  remotePort: number,
): Promise<TunnelHandle> {
  const { server, port: localPort } = await listenLocalPort()
  const sshClient = new Client()

  await new Promise<void>((resolve, reject) => {
    sshClient
      .on('ready', () => resolve())
      .on('error', reject)
      .connect(buildSshConfig(ssh))
  })

  server.on('connection', (socket) => {
    sshClient.forwardOut(
      '127.0.0.1',
      0,
      remoteHost,
      remotePort,
      (err, stream) => {
        if (err) {
          socket.destroy()
          return
        }
        socket.pipe(stream)
        stream.pipe(socket)
        socket.on('error', () => stream.end())
        stream.on('error', () => socket.destroy())
      },
    )
  })

  return {
    localPort,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      sshClient.end()
    },
  }
}

function quoteIdent(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new ProjectError(`非法标识符：${name}`, 400)
  }
  return `\`${name.replace(/`/g, '``')}\``
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function useDatabase(connection: mysql.Connection, database: string): Promise<void> {
  if (!database.trim()) {
    throw new ProjectError('请先配置默认数据库名后再操作表', 400)
  }
  await connection.query(`USE ${quoteIdent(database.trim())}`)
}

async function listTables(
  connection: mysql.Connection,
  database: string,
): Promise<MysqlTableInfo[]> {
  if (database.trim()) {
    await connection.query(`USE ${quoteIdent(database.trim())}`)
  }
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS name,
            TABLE_COMMENT AS remark,
            ENGINE AS engine,
            TABLE_ROWS AS tableRows
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME`,
  )
  const list = Array.isArray(rows) ? rows : []
  return list.map((row: any) => ({
    name: String(row.name ?? ''),
    remark: String(row.remark ?? ''),
    engine: String(row.engine ?? ''),
    rows:
      row.tableRows == null || row.tableRows === ''
        ? null
        : Number(row.tableRows),
  })).filter((t) => t.name)
}

async function withMysqlConnection<T>(
  payload: MysqlConnectionPayload,
  fn: (connection: mysql.Connection) => Promise<T>,
): Promise<T> {
  validateConnectionPayload(payload)

  let tunnel: TunnelHandle | null = null
  let connection: mysql.Connection | null = null

  try {
    let host = payload.host.trim()
    let port = payload.port

    if (payload.ssh?.enabled) {
      tunnel = await openSshTunnel(payload.ssh, host, port)
      host = '127.0.0.1'
      port = tunnel.localPort
    }

    connection = await mysql.createConnection({
      host,
      port,
      user: payload.username.trim(),
      password: payload.password,
      database: payload.database.trim() || undefined,
      connectTimeout: 15000,
      multipleStatements: false,
    })

    return await fn(connection)
  } catch (err) {
    if (err instanceof ProjectError) throw err
    const message = err instanceof Error ? err.message : '操作失败'
    throw new ProjectError(`MySQL 操作失败：${message}`, 400)
  } finally {
    if (connection) {
      try {
        await connection.end()
      } catch {
        // ignore
      }
    }
    if (tunnel) {
      try {
        await tunnel.close()
      } catch {
        // ignore
      }
    }
  }
}

function normalizeColumnInput(input: unknown, index: number): MysqlColumnDef {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProjectError(`第 ${index + 1} 列定义无效`, 400)
  }
  const row = input as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const type = typeof row.type === 'string' ? row.type.trim() : ''
  if (!name || !IDENT_RE.test(name)) {
    throw new ProjectError(`第 ${index + 1} 列名不合法`, 400)
  }
  if (!type || !TYPE_RE.test(type)) {
    throw new ProjectError(`第 ${index + 1} 列类型不合法`, 400)
  }
  const originalName =
    typeof row.originalName === 'string' && row.originalName.trim()
      ? row.originalName.trim()
      : undefined
  if (originalName && !IDENT_RE.test(originalName)) {
    throw new ProjectError(`第 ${index + 1} 列原名不合法`, 400)
  }
  return {
    name,
    type,
    nullable: Boolean(row.nullable),
    primaryKey: Boolean(row.primaryKey),
    autoIncrement: Boolean(row.autoIncrement),
    defaultValue: typeof row.defaultValue === 'string' ? row.defaultValue : '',
    comment: typeof row.comment === 'string' ? row.comment : '',
    ...(row.resource ? { resource: true } : {}),
    ...(row.logicDelete ? { logicDelete: true } : {}),
    originalName,
  }
}

function normalizeTableDef(input: unknown): MysqlTableDef {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProjectError('表定义无效', 400)
  }
  const row = input as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!name || !IDENT_RE.test(name)) {
    throw new ProjectError('表名不合法，仅支持字母、数字、下划线，且不能以数字开头', 400)
  }
  const columnsRaw = Array.isArray(row.columns) ? row.columns : []
  if (!columnsRaw.length) {
    throw new ProjectError('请至少添加一列', 400)
  }
  const columns = columnsRaw.map((c, i) => normalizeColumnInput(c, i))
  const names = new Set<string>()
  for (const col of columns) {
    if (names.has(col.name)) {
      throw new ProjectError(`列名重复：${col.name}`, 400)
    }
    names.add(col.name)
  }
  const indexesRaw = Array.isArray(row.indexes) ? row.indexes : []
  const indexes = indexesRaw.map((c, i) => normalizeIndexInput(c, i))
  const migrated = migrateIndexedColumnsToIndexes(columns, indexes)
  return {
    name,
    remark: typeof row.remark === 'string' ? row.remark : '',
    columns: migrated.columns,
    indexes: migrated.indexes,
  }
}

function columnSql(
  col: MysqlColumnDef,
  options?: { autoIncrement?: boolean },
): string {
  const useAi =
    options?.autoIncrement !== undefined
      ? options.autoIncrement
      : col.autoIncrement
  const parts = [`${quoteIdent(col.name)} ${col.type}`]
  if (useAi) parts.push('AUTO_INCREMENT')
  parts.push(col.nullable ? 'NULL' : 'NOT NULL')
  if (col.defaultValue !== '' && !useAi) {
    const raw = col.defaultValue.trim()
    if (/^(NULL|CURRENT_TIMESTAMP(\(\d+\))?)$/i.test(raw)) {
      parts.push(`DEFAULT ${raw}`)
    } else {
      parts.push(`DEFAULT '${escapeString(raw)}'`)
    }
  }
  if (col.comment) {
    parts.push(`COMMENT '${escapeString(col.comment)}'`)
  }
  return parts.join(' ')
}

export interface MysqlTestResult {
  ok: true
  message: string
  tables: MysqlTableInfo[]
  serverVersion: string
}

export async function testMysqlConnection(
  payload: MysqlConnectionPayload,
): Promise<MysqlTestResult> {
  return withMysqlConnection(payload, async (connection) => {
    const [verRows] = await connection.query('SELECT VERSION() AS version')
    const version =
      Array.isArray(verRows) && verRows[0]
        ? String((verRows[0] as any).version ?? '')
        : ''

    const tables = await listTables(connection, payload.database)

    return {
      ok: true,
      message: '连接成功',
      tables,
      serverVersion: version,
    }
  })
}

/** 列出服务器上的库名（不依赖已选 database） */
export async function listMysqlDatabases(
  payload: MysqlConnectionPayload,
): Promise<string[]> {
  return withMysqlConnection(
    { ...payload, database: '' },
    async (connection) => {
      const [rows] = await connection.query('SHOW DATABASES')
      const list = Array.isArray(rows) ? rows : []
      const names = list
        .map((row: any) => {
          const key = Object.keys(row ?? {})[0]
          return key ? String(row[key] ?? '').trim() : ''
        })
        .filter(Boolean)
        // 过滤系统库
        .filter(
          (name) =>
            !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(
              name.toLowerCase(),
            ),
        )
      return names.sort((a, b) => a.localeCompare(b, 'en'))
    },
  )
}

export async function refreshMysqlTables(
  payload: MysqlConnectionPayload,
): Promise<MysqlTableInfo[]> {
  return withMysqlConnection(payload, (connection) =>
    listTables(connection, payload.database),
  )
}

export async function getMysqlTableColumns(
  payload: MysqlConnectionPayload,
  tableName: string,
): Promise<MysqlColumnDef[]> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    return getColumnsOnConnection(connection, tableName)
  })
}

export interface MysqlTableColumnsResult {
  columns: MysqlColumnDef[]
  indexes: MysqlIndexDef[]
  conflict: boolean
  local: MysqlColumnDef[] | null
  remote: MysqlColumnDef[]
  localRemark: string
  remoteRemark: string
}

function mergeIndexes(
  remote: MysqlIndexDef[],
  local: MysqlIndexDef[] | null | undefined,
): MysqlIndexDef[] {
  if (!local?.length) {
    return remote.map((i) => ({ ...i, remark: i.remark || '' }))
  }
  const byName = new Map(local.map((i) => [i.name, i]))
  const result: MysqlIndexDef[] = remote.map((i) => ({
    ...i,
    remark: byName.get(i.name)?.remark ?? i.remark ?? '',
  }))
  const seen = new Set(result.map((i) => i.name))
  for (const loc of local) {
    if (seen.has(loc.name)) continue
    result.push({
      name: loc.name,
      columns: [...loc.columns],
      remark: loc.remark || '',
    })
    seen.add(loc.name)
  }
  return result
}

/** 拉取远程列并与本地 mysql/{table}.json 比对；冲突时不自动合并 */
export async function getMysqlTableColumnsWithSchema(
  projectPath: string,
  payload: MysqlConnectionPayload,
  tableName: string,
): Promise<MysqlTableColumnsResult> {
  const remote = await getMysqlTableColumns(payload, tableName)
  const remoteIndexes = await withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    return listSecondaryIndexes(connection, tableName)
  })
  const localFile = projectPath.trim()
    ? await readMysqlTableSchema(projectPath, tableName)
    : null
  const local = localFile?.columns ?? null
  const indexes = mergeIndexes(remoteIndexes, localFile?.indexes)
  if (!local) {
    return {
      columns: remote.map((c) => ({
        ...c,
        resource: false,
        logicDelete: false,
      })),
      indexes,
      conflict: false,
      local: null,
      remote,
      localRemark: '',
      remoteRemark: '',
    }
  }
  if (mysqlSchemasStructurallyEqual(local, remote)) {
    return {
      columns: mergeMysqlResourceFlags(remote, local),
      indexes,
      conflict: false,
      local,
      remote,
      localRemark: localFile?.remark ?? '',
      remoteRemark: '',
    }
  }
  return {
    columns: remote.map((c) => ({
      ...c,
      resource: false,
      logicDelete: false,
    })),
    indexes,
    conflict: true,
    local,
    remote,
    localRemark: localFile?.remark ?? '',
    remoteRemark: '',
  }
}

/** 解决本地与数据库表结构冲突 */
export async function resolveMysqlTableSchemaConflict(
  projectPath: string,
  payload: MysqlConnectionPayload,
  tableName: string,
  adopt: 'local' | 'remote',
): Promise<MysqlTableColumnsResult> {
  if (!projectPath.trim()) {
    throw new ProjectError('缺少项目路径', 400)
  }
  if (adopt === 'remote') {
    const remote = await getMysqlTableColumns(payload, tableName)
    const remoteIndexes = await withMysqlConnection(payload, async (connection) => {
      await useDatabase(connection, payload.database)
      return listSecondaryIndexes(connection, tableName)
    })
    const localFile = await readMysqlTableSchema(projectPath, tableName)
    const columns = mergeMysqlResourceFlags(remote, localFile?.columns)
    const indexes = mergeIndexes(remoteIndexes, localFile?.indexes)
    await writeMysqlTableSchema(projectPath, tableName, {
      remark: localFile?.remark ?? '',
      columns,
      indexes,
    })
    return {
      columns,
      indexes,
      conflict: false,
      local: columns,
      remote,
      localRemark: localFile?.remark ?? '',
      remoteRemark: '',
    }
  }

  const localFile = await readMysqlTableSchema(projectPath, tableName)
  if (!localFile?.columns.length) {
    throw new ProjectError('本地无表结构可采纳', 400)
  }
  await updateMysqlTableSchema(
    payload,
    tableName,
    localFile.columns,
    projectPath,
    localFile.remark,
    localFile.indexes,
  )
  const remote = await getMysqlTableColumns(payload, tableName)
  const columns = mergeMysqlResourceFlags(remote, localFile.columns)
  return {
    columns,
    indexes: localFile.indexes ?? [],
    conflict: false,
    local: localFile.columns,
    remote,
    localRemark: localFile.remark,
    remoteRemark: '',
  }
}

export async function createMysqlTable(
  payload: MysqlConnectionPayload,
  tableInput: unknown,
  projectPath?: string,
): Promise<MysqlTableInfo[]> {
  const table = normalizeTableDef(tableInput)
  for (const col of table.columns) {
    if (col.autoIncrement && !col.primaryKey) {
      throw new ProjectError(
        `列「${col.name}」设置了自增，必须同时设为主键`,
        400,
      )
    }
  }
  if (table.columns.filter((c) => c.autoIncrement).length > 1) {
    throw new ProjectError('一张表只能有一列自增', 400)
  }
  const indexes = table.indexes ?? []
  assertColumnFlags(table.columns, indexes)
  const tables = await withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    const colSql = table.columns.map((c) => columnSql(c)).join(',\n  ')
    const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name))
    const pkSql = pkCols.length ? `,\n  PRIMARY KEY (${pkCols.join(', ')})` : ''
    const indexSql = indexes
      .map((idx) => {
        const cols = idx.columns.map((c) => quoteIdent(c)).join(', ')
        return `,\n  KEY ${quoteIdent(idx.name)} (${cols})`
      })
      .join('')
    const commentSql = table.remark
      ? ` COMMENT='${escapeString(table.remark)}'`
      : ''
    await connection.query(
      `CREATE TABLE ${quoteIdent(table.name)} (\n  ${colSql}${pkSql}${indexSql}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${commentSql}`,
    )
    return listTables(connection, payload.database)
  })
  if (projectPath?.trim()) {
    await writeMysqlTableSchema(projectPath, table.name, {
      remark: table.remark,
      columns: table.columns,
      indexes,
    })
  }
  return tables
}

export async function updateMysqlTableMeta(
  payload: MysqlConnectionPayload,
  tableName: string,
  meta: { name: string; remark: string },
  projectPath?: string,
): Promise<MysqlTableInfo[]> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('原表名不合法', 400)
  }
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  if (!name || !IDENT_RE.test(name)) {
    throw new ProjectError('表名不合法，仅支持字母、数字、下划线，且不能以数字开头', 400)
  }
  const remark = typeof meta.remark === 'string' ? meta.remark : ''

  const tables = await withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    await connection.query(
      `ALTER TABLE ${quoteIdent(tableName)} COMMENT = '${escapeString(remark)}'`,
    )
    if (name !== tableName) {
      await connection.query(
        `RENAME TABLE ${quoteIdent(tableName)} TO ${quoteIdent(name)}`,
      )
    }
    return listTables(connection, payload.database)
  })
  if (projectPath?.trim()) {
    if (name !== tableName) {
      await renameMysqlTableSchema(projectPath, tableName, name)
    }
    const existing = await readMysqlTableSchema(projectPath, name)
    if (existing) {
      await writeMysqlTableSchema(projectPath, name, {
        remark,
        columns: existing.columns,
      })
    }
  }
  return tables
}

export async function updateMysqlTableSchema(
  payload: MysqlConnectionPayload,
  tableName: string,
  columnsInput: unknown,
  projectPath?: string,
  remark = '',
  indexesInput?: unknown,
): Promise<MysqlTableInfo[]> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  if (!Array.isArray(columnsInput) || !columnsInput.length) {
    throw new ProjectError('请至少保留一列', 400)
  }
  const columns = columnsInput.map((c, i) => normalizeColumnInput(c, i))
  const names = new Set<string>()
  for (const col of columns) {
    if (names.has(col.name)) {
      throw new ProjectError(`列名重复：${col.name}`, 400)
    }
    names.add(col.name)
  }
  for (const col of columns) {
    if (col.autoIncrement && !col.primaryKey) {
      throw new ProjectError(
        `列「${col.name}」设置了自增，必须同时设为主键`,
        400,
      )
    }
  }
  const autoCount = columns.filter((c) => c.autoIncrement).length
  if (autoCount > 1) {
    throw new ProjectError('一张表只能有一列自增', 400)
  }
  const indexesRaw = Array.isArray(indexesInput) ? indexesInput : []
  const indexes = indexesRaw.map((c, i) => normalizeIndexInput(c, i))
  const migrated = migrateIndexedColumnsToIndexes(columns, indexes)
  assertColumnFlags(migrated.columns, migrated.indexes)

  const tables = await withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)

    const existing = await getColumnsOnConnection(connection, tableName)
    const existingNames = new Set(existing.map((c) => c.name))
    const existingByName = new Map(existing.map((c) => [c.name, c]))

    const nextOriginals = new Set(
      migrated.columns
        .map((c) => c.originalName || c.name)
        .filter((n) => existingNames.has(n)),
    )

    // 1) 先去掉现有自增，否则无法 DROP PRIMARY KEY
    for (const old of existing) {
      if (!old.autoIncrement) continue
      if (!nextOriginals.has(old.name) && !existingNames.has(old.name)) continue
      await connection.query(
        `ALTER TABLE ${quoteIdent(tableName)} MODIFY COLUMN ${columnSql(
          { ...old, autoIncrement: false },
          { autoIncrement: false },
        )}`,
      )
    }

    // 2) 删除已移除的列
    for (const old of existing) {
      if (!nextOriginals.has(old.name)) {
        await connection.query(
          `ALTER TABLE ${quoteIdent(tableName)} DROP COLUMN ${quoteIdent(old.name)}`,
        )
      }
    }

    // 3) 增改列（暂不带 AUTO_INCREMENT）
    for (const col of migrated.columns) {
      const from =
        col.originalName && existingNames.has(col.originalName)
          ? col.originalName
          : existingNames.has(col.name)
            ? col.name
            : null

      const sqlWithoutAi = columnSql(col, { autoIncrement: false })

      if (!from) {
        await connection.query(
          `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${sqlWithoutAi}`,
        )
        continue
      }

      if (from !== col.name) {
        await connection.query(
          `ALTER TABLE ${quoteIdent(tableName)} CHANGE COLUMN ${quoteIdent(from)} ${sqlWithoutAi}`,
        )
      } else {
        const prev = existingByName.get(from)
        const needModify =
          !prev ||
          prev.type !== col.type ||
          prev.nullable !== col.nullable ||
          prev.defaultValue !== col.defaultValue ||
          prev.comment !== col.comment ||
          prev.autoIncrement
        if (needModify) {
          await connection.query(
            `ALTER TABLE ${quoteIdent(tableName)} MODIFY COLUMN ${sqlWithoutAi}`,
          )
        }
      }
    }

    // 4) 重建主键
    const [pkRows] = await connection.query(
      `SELECT CONSTRAINT_NAME AS name
       FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND CONSTRAINT_TYPE = 'PRIMARY KEY'`,
      [tableName],
    )
    if (Array.isArray(pkRows) && pkRows.length) {
      await connection.query(
        `ALTER TABLE ${quoteIdent(tableName)} DROP PRIMARY KEY`,
      )
    }
    const pkCols = migrated.columns
      .filter((c) => c.primaryKey)
      .map((c) => quoteIdent(c.name))
    if (pkCols.length) {
      await connection.query(
        `ALTER TABLE ${quoteIdent(tableName)} ADD PRIMARY KEY (${pkCols.join(', ')})`,
      )
    }

    // 5) 主键就绪后再加 AUTO_INCREMENT
    for (const col of migrated.columns) {
      if (!col.autoIncrement) continue
      await connection.query(
        `ALTER TABLE ${quoteIdent(tableName)} MODIFY COLUMN ${columnSql(col, {
          autoIncrement: true,
        })}`,
      )
    }

    // 6) 同步二级索引
    await syncSecondaryIndexes(connection, tableName, migrated.indexes)

    return listTables(connection, payload.database)
  })

  if (projectPath?.trim()) {
    await writeMysqlTableSchema(projectPath, tableName, {
      remark,
      columns: migrated.columns,
      indexes: migrated.indexes,
    })
  }
  return tables
}

/**
 * 读取表上全部非 PRIMARY 二级索引
 */
async function listSecondaryIndexes(
  connection: mysql.Connection,
  tableName: string,
): Promise<MysqlIndexDef[]> {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS indexName,
            COLUMN_NAME AS columnName,
            SEQ_IN_INDEX AS seqInIndex
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       AND INDEX_NAME <> 'PRIMARY'
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [tableName],
  )
  const list = Array.isArray(rows) ? (rows as any[]) : []
  const byIndex = new Map<string, { seq: number; column: string }[]>()
  for (const row of list) {
    const indexName = String(row.indexName ?? '')
    const column = String(row.columnName ?? '')
    if (!indexName || !column || !IDENT_RE.test(column)) continue
    const bucket = byIndex.get(indexName) ?? []
    bucket.push({ seq: Number(row.seqInIndex) || 0, column })
    byIndex.set(indexName, bucket)
  }
  const result: MysqlIndexDef[] = []
  for (const [indexName, cols] of byIndex) {
    const ordered = [...cols]
      .sort((a, b) => a.seq - b.seq)
      .map((c) => c.column)
    if (!ordered.length) continue
    result.push({ name: indexName, columns: ordered, remark: '' })
  }
  return result
}

async function syncSecondaryIndexes(
  connection: mysql.Connection,
  tableName: string,
  indexes: MysqlIndexDef[],
): Promise<void> {
  const existing = await listSecondaryIndexes(connection, tableName)
  const wantByName = new Map(indexes.map((i) => [i.name, i]))
  const existingByName = new Map(existing.map((i) => [i.name, i]))

  for (const old of existing) {
    const want = wantByName.get(old.name)
    if (
      !want ||
      want.columns.join('\0') !== old.columns.join('\0')
    ) {
      await connection.query(
        `ALTER TABLE ${quoteIdent(tableName)} DROP INDEX ${quoteIdent(old.name)}`,
      )
    }
  }

  const afterDrop = await listSecondaryIndexes(connection, tableName)
  const afterNames = new Set(afterDrop.map((i) => i.name))
  for (const idx of indexes) {
    if (afterNames.has(idx.name)) continue
    const cols = idx.columns.map((c) => quoteIdent(c)).join(', ')
    await connection.query(
      `ALTER TABLE ${quoteIdent(tableName)} ADD INDEX ${quoteIdent(idx.name)} (${cols})`,
    )
  }
}

async function getColumnsOnConnection(
  connection: mysql.Connection,
  tableName: string,
): Promise<MysqlColumnDef[]> {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME AS name,
            COLUMN_TYPE AS type,
            IS_NULLABLE AS nullable,
            COLUMN_KEY AS columnKey,
            EXTRA AS extra,
            COLUMN_DEFAULT AS defaultValue,
            COLUMN_COMMENT AS comment
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [tableName],
  )
  const list = Array.isArray(rows) ? rows : []
  return list.map((row: any) => {
    const name = String(row.name ?? '')
    return {
      name,
      type: String(row.type ?? ''),
      nullable: String(row.nullable ?? '').toUpperCase() === 'YES',
      primaryKey: String(row.columnKey ?? '') === 'PRI',
      autoIncrement: String(row.extra ?? '').toLowerCase().includes('auto_increment'),
      defaultValue: row.defaultValue == null ? '' : String(row.defaultValue),
      comment: String(row.comment ?? ''),
      originalName: name,
    }
  })
}

export async function dropMysqlTable(
  payload: MysqlConnectionPayload,
  tableName: string,
  projectPath?: string,
): Promise<MysqlTableInfo[]> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  const tables = await withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    await connection.query(`DROP TABLE ${quoteIdent(tableName)}`)
    return listTables(connection, payload.database)
  })
  if (projectPath?.trim()) {
    await deleteMysqlTableSchema(projectPath, tableName)
  }
  return tables
}

export async function truncateMysqlTable(
  payload: MysqlConnectionPayload,
  tableName: string,
): Promise<MysqlTableInfo[]> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    await connection.query(`TRUNCATE TABLE ${quoteIdent(tableName)}`)
    return listTables(connection, payload.database)
  })
}

function serializeCellValue(value: unknown): unknown {
  if (value == null) return null
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return value.toString('base64')
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return String(value)
    }
  }
  return value
}

function normalizeRowRecord(row: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    next[key] = serializeCellValue(value)
  }
  return next
}

/** 解析唯一键列：优先 PRIMARY，否则第一个 UNIQUE 索引 */
async function resolveUniqueKeyColumns(
  connection: mysql.Connection,
  tableName: string,
): Promise<{ keyName: string; columns: string[] } | null> {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS indexName,
            COLUMN_NAME AS columnName,
            SEQ_IN_INDEX AS seqInIndex,
            NON_UNIQUE AS nonUnique
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0
     ORDER BY CASE WHEN INDEX_NAME = 'PRIMARY' THEN 0 ELSE 1 END,
              INDEX_NAME,
              SEQ_IN_INDEX`,
    [tableName],
  )
  const list = Array.isArray(rows) ? (rows as any[]) : []
  if (!list.length) return null

  const byIndex = new Map<string, { seq: number; column: string }[]>()
  for (const row of list) {
    const indexName = String(row.indexName ?? '')
    const column = String(row.columnName ?? '')
    if (!indexName || !column || !IDENT_RE.test(column)) continue
    const bucket = byIndex.get(indexName) ?? []
    bucket.push({ seq: Number(row.seqInIndex) || 0, column })
    byIndex.set(indexName, bucket)
  }

  const preferredName = byIndex.has('PRIMARY')
    ? 'PRIMARY'
    : [...byIndex.keys()].sort((a, b) => a.localeCompare(b))[0]
  if (!preferredName) return null
  const preferred = byIndex.get(preferredName)
  if (!preferred?.length) return null

  const columns = [...preferred]
    .sort((a, b) => a.seq - b.seq)
    .map((item) => item.column)
  return { keyName: preferredName, columns }
}

function parsePositiveInt(value: unknown, fallback: number, max?: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  const i = Math.floor(n)
  return max != null ? Math.min(i, max) : i
}

function assertKeyValues(
  keyColumns: string[],
  key: unknown,
): Record<string, unknown> {
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    throw new ProjectError('缺少唯一键取值', 400)
  }
  const source = key as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const col of keyColumns) {
    if (!(col in source)) {
      throw new ProjectError(`唯一键缺少列「${col}」`, 400)
    }
    result[col] = source[col]
  }
  return result
}

function buildWhereByKey(keyValues: Record<string, unknown>): {
  sql: string
  params: unknown[]
} {
  const cols = Object.keys(keyValues)
  const parts: string[] = []
  const params: unknown[] = []
  for (const col of cols) {
    const value = keyValues[col]
    if (value == null) {
      parts.push(`${quoteIdent(col)} IS NULL`)
    } else {
      parts.push(`${quoteIdent(col)} = ?`)
      params.push(value)
    }
  }
  return { sql: parts.join(' AND '), params }
}

export async function listMysqlTableRows(
  payload: MysqlConnectionPayload,
  tableName: string,
  pagination: { current?: unknown; pageSize?: unknown },
  projectPath?: string,
): Promise<{
  columns: MysqlColumnDef[]
  keyColumns: string[]
  keyName: string | null
  rows: Record<string, unknown>[]
  total: number
  current: number
  pageSize: number
  conflict: boolean
  local: MysqlColumnDef[] | null
  remote: MysqlColumnDef[]
}> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  const current = parsePositiveInt(pagination.current, 1)
  const pageSize = parsePositiveInt(pagination.pageSize, 20, 200)
  const offset = (current - 1) * pageSize

  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    const remote = await getColumnsOnConnection(connection, tableName)
    if (!remote.length) {
      throw new ProjectError(`表「${tableName}」不存在或无列`, 404)
    }
    const localFile = projectPath?.trim()
      ? await readMysqlTableSchema(projectPath, tableName)
      : null
    const local = localFile?.columns ?? null
    const conflict = Boolean(
      local && !mysqlSchemasStructurallyEqual(local, remote),
    )
    const columns = conflict
      ? remote.map((c) => ({
          ...c,
          resource: false,
          logicDelete: false,
        }))
      : mergeMysqlResourceFlags(remote, local)

    const unique = await resolveUniqueKeyColumns(connection, tableName)
    const keyColumns = unique?.columns ?? []

    const [countRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM ${quoteIdent(tableName)}`,
    )
    const totalRaw = Array.isArray(countRows) ? (countRows[0] as any)?.total : 0
    const total = Number(totalRaw) || 0

    const [dataRows] = await connection.query(
      `SELECT * FROM ${quoteIdent(tableName)} LIMIT ? OFFSET ?`,
      [pageSize, offset],
    )
    const rows = (Array.isArray(dataRows) ? dataRows : []).map((row) =>
      normalizeRowRecord(row as Record<string, unknown>),
    )

    return {
      columns,
      keyColumns,
      keyName: unique?.keyName ?? null,
      rows,
      total,
      current,
      pageSize,
      conflict,
      local,
      remote,
    }
  })
}

export async function updateMysqlTableRow(
  payload: MysqlConnectionPayload,
  tableName: string,
  input: { key: unknown; values: unknown },
): Promise<void> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)) {
    throw new ProjectError('缺少更新字段', 400)
  }

  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    const unique = await resolveUniqueKeyColumns(connection, tableName)
    if (!unique?.columns.length) {
      throw new ProjectError('该表没有唯一键，无法编辑行', 400)
    }
    const keyValues = assertKeyValues(unique.columns, input.key)
    const columns = await getColumnsOnConnection(connection, tableName)
    const colNames = new Set(columns.map((c) => c.name))
    const keySet = new Set(unique.columns)

    const sets: string[] = []
    const params: unknown[] = []
    for (const [name, value] of Object.entries(input.values as Record<string, unknown>)) {
      if (!colNames.has(name) || !IDENT_RE.test(name)) continue
      if (keySet.has(name)) continue
      sets.push(`${quoteIdent(name)} = ?`)
      params.push(value)
    }
    if (!sets.length) {
      throw new ProjectError('没有可更新的字段', 400)
    }

    const where = buildWhereByKey(keyValues)
    const [result] = await connection.query(
      `UPDATE ${quoteIdent(tableName)} SET ${sets.join(', ')} WHERE ${where.sql} LIMIT 1`,
      [...params, ...where.params],
    )
    const affected = (result as { affectedRows?: number })?.affectedRows ?? 0
    if (!affected) {
      throw new ProjectError('未找到要更新的行，可能已被删除', 404)
    }
  })
}

export async function deleteMysqlTableRow(
  payload: MysqlConnectionPayload,
  tableName: string,
  key: unknown,
): Promise<void> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }

  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    const unique = await resolveUniqueKeyColumns(connection, tableName)
    if (!unique?.columns.length) {
      throw new ProjectError('该表没有唯一键，无法删除行', 400)
    }
    const keyValues = assertKeyValues(unique.columns, key)
    const where = buildWhereByKey(keyValues)
    const [result] = await connection.query(
      `DELETE FROM ${quoteIdent(tableName)} WHERE ${where.sql} LIMIT 1`,
      where.params,
    )
    const affected = (result as { affectedRows?: number })?.affectedRows ?? 0
    if (!affected) {
      throw new ProjectError('未找到要删除的行，可能已被删除', 404)
    }
  })
}

export async function insertMysqlTableRow(
  payload: MysqlConnectionPayload,
  tableName: string,
  valuesInput: unknown,
): Promise<void> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  if (
    !valuesInput ||
    typeof valuesInput !== 'object' ||
    Array.isArray(valuesInput)
  ) {
    throw new ProjectError('缺少插入字段', 400)
  }

  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    const columns = await getColumnsOnConnection(connection, tableName)
    if (!columns.length) {
      throw new ProjectError(`表「${tableName}」不存在或无列`, 404)
    }
    const colNames = new Set(columns.map((c) => c.name))
    const autoCols = new Set(
      columns.filter((c) => c.autoIncrement).map((c) => c.name),
    )

    const names: string[] = []
    const params: unknown[] = []
    for (const [name, value] of Object.entries(
      valuesInput as Record<string, unknown>,
    )) {
      if (!colNames.has(name) || !IDENT_RE.test(name)) continue
      if (autoCols.has(name) && (value == null || value === '')) continue
      names.push(name)
      params.push(value)
    }
    if (!names.length) {
      throw new ProjectError('没有可插入的字段', 400)
    }

    await connection.query(
      `INSERT INTO ${quoteIdent(tableName)} (${names
        .map((n) => quoteIdent(n))
        .join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
      params,
    )
  })
}

export function mysqlDatabaseToPayload(
  db: import('../types/mysql.js').MysqlDatabaseConfig,
): MysqlConnectionPayload {
  return {
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
    ssh: db.ssh,
  }
}

export async function runMysqlQuery(
  payload: MysqlConnectionPayload,
  sql: string,
  options?: { dryRun?: boolean },
): Promise<{
  rows: Record<string, unknown>[]
  fields: string[]
  meta?: Record<string, unknown>
}> {
  const text = sql.trim()
  if (!text) throw new ProjectError('SQL 不能为空', 400)
  return withMysqlConnection(payload, async (connection) => {
    if (payload.database?.trim()) {
      await useDatabase(connection, payload.database)
    }

    const dryRun = options?.dryRun === true
    if (dryRun) {
      await connection.beginTransaction()
      try {
        const [result, fieldPackets] = await connection.query(text)
        const parsed = parseMysqlQueryResult(result, fieldPackets)
        await connection.rollback()
        return {
          ...parsed,
          meta: {
            ...(parsed.meta ?? {}),
            dryRun: true,
          },
        }
      } catch (err) {
        try {
          await connection.rollback()
        } catch {
          // ignore
        }
        throw err
      }
    }

    const [result, fieldPackets] = await connection.query(text)
    return parseMysqlQueryResult(result, fieldPackets)
  })
}

function parseMysqlQueryResult(
  result: unknown,
  fieldPackets: unknown,
): {
  rows: Record<string, unknown>[]
  fields: string[]
  meta?: Record<string, unknown>
} {
  if (Array.isArray(result)) {
    const fields = Array.isArray(fieldPackets)
      ? fieldPackets
          .map((f) =>
            f && typeof f === 'object' && 'name' in f ? String(f.name) : '',
          )
          .filter(Boolean)
      : []
    return { rows: result as Record<string, unknown>[], fields }
  }
  const header = result as {
    affectedRows?: number
    insertId?: number
    warningStatus?: number
  }
  return {
    rows: [],
    fields: [],
    meta: {
      affectedRows: header.affectedRows ?? 0,
      insertId: header.insertId ?? 0,
    },
  }
}
