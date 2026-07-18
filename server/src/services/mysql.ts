import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { Client, type ConnectConfig } from 'ssh2'
import {
  createEmptyMysqlLibrary,
  MYSQL_FILE,
  normalizeMysqlLibrary,
  type MysqlColumnDef,
  type MysqlConnectionPayload,
  type MysqlLibrary,
  type MysqlSshConfig,
  type MysqlTableDef,
  type MysqlTableInfo,
} from '../types/mysql.js'
import { ProjectError } from './project.js'

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const TYPE_RE = /^[A-Za-z][A-Za-z0-9_(),\s]*$/

function mysqlPath(projectPath: string): string {
  return path.join(projectPath, MYSQL_FILE)
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
  return {
    name,
    remark: typeof row.remark === 'string' ? row.remark : '',
    columns,
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
        defaultValue:
          row.defaultValue == null ? '' : String(row.defaultValue),
        comment: String(row.comment ?? ''),
        originalName: name,
      }
    })
  })
}

export async function createMysqlTable(
  payload: MysqlConnectionPayload,
  tableInput: unknown,
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
  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    const colSql = table.columns.map((c) => columnSql(c)).join(',\n  ')
    const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name))
    const pkSql = pkCols.length ? `,\n  PRIMARY KEY (${pkCols.join(', ')})` : ''
    const commentSql = table.remark
      ? ` COMMENT='${escapeString(table.remark)}'`
      : ''
    await connection.query(
      `CREATE TABLE ${quoteIdent(table.name)} (\n  ${colSql}${pkSql}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${commentSql}`,
    )
    return listTables(connection, payload.database)
  })
}

export async function updateMysqlTableMeta(
  payload: MysqlConnectionPayload,
  tableName: string,
  meta: { name: string; remark: string },
): Promise<MysqlTableInfo[]> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('原表名不合法', 400)
  }
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  if (!name || !IDENT_RE.test(name)) {
    throw new ProjectError('表名不合法，仅支持字母、数字、下划线，且不能以数字开头', 400)
  }
  const remark = typeof meta.remark === 'string' ? meta.remark : ''

  return withMysqlConnection(payload, async (connection) => {
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
}

export async function updateMysqlTableSchema(
  payload: MysqlConnectionPayload,
  tableName: string,
  columnsInput: unknown,
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

  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)

    const existing = await getColumnsOnConnection(connection, tableName)
    const existingNames = new Set(existing.map((c) => c.name))
    const existingByName = new Map(existing.map((c) => [c.name, c]))

    const nextOriginals = new Set(
      columns
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
    for (const col of columns) {
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
        // 类型/可空/默认/备注有变化，或此前有自增（已在步骤1去掉）时再 MODIFY
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
    const pkCols = columns.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name))
    if (pkCols.length) {
      await connection.query(
        `ALTER TABLE ${quoteIdent(tableName)} ADD PRIMARY KEY (${pkCols.join(', ')})`,
      )
    }

    // 5) 主键就绪后再加 AUTO_INCREMENT
    for (const col of columns) {
      if (!col.autoIncrement) continue
      await connection.query(
        `ALTER TABLE ${quoteIdent(tableName)} MODIFY COLUMN ${columnSql(col, {
          autoIncrement: true,
        })}`,
      )
    }

    return listTables(connection, payload.database)
  })
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
): Promise<MysqlTableInfo[]> {
  if (!IDENT_RE.test(tableName)) {
    throw new ProjectError('表名不合法', 400)
  }
  return withMysqlConnection(payload, async (connection) => {
    await useDatabase(connection, payload.database)
    await connection.query(`DROP TABLE ${quoteIdent(tableName)}`)
    return listTables(connection, payload.database)
  })
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
