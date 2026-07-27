import mysql from 'mysql2/promise'

type MysqlSlotConfig = {
  id: string
  host: string
  port: number
  user: string
  password: string
  database: string
  index: number
}

const pools = new Map<string, mysql.Pool>()

function readSlotsFromEnv(): MysqlSlotConfig[] {
  const slots: MysqlSlotConfig[] = []
  // 多数据源 MYSQL_HOST_1 …
  for (let i = 1; i <= 32; i++) {
    const host = process.env[`MYSQL_HOST_${i}`]?.trim() || ''
    if (!host) {
      if (i === 1) break
      continue
    }
    slots.push({
      index: i,
      id: process.env[`MYSQL_ID_${i}`]?.trim() || `ds_${i}`,
      host,
      port: Number(process.env[`MYSQL_PORT_${i}`]) || 3306,
      user: process.env[`MYSQL_USER_${i}`]?.trim() || '',
      password: process.env[`MYSQL_PASSWORD_${i}`] ?? '',
      database: process.env[`MYSQL_DATABASE_${i}`]?.trim() || '',
    })
  }
  if (slots.length) return slots

  const host = process.env.MYSQL_HOST?.trim() || ''
  if (!host) return []
  return [
    {
      index: 0,
      id: process.env.MYSQL_ID?.trim() || 'default',
      host,
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER?.trim() || '',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE?.trim() || '',
    },
  ]
}

function pickSlot(mysqlId?: string): MysqlSlotConfig {
  const slots = readSlotsFromEnv()
  if (!slots.length) {
    throw new Error(
      '缺少 MySQL 配置（请在 .env.development / .env.production 填写 MYSQL_HOST 或 MYSQL_HOST_1）',
    )
  }
  const want = mysqlId?.trim()
  if (want) {
    const found = slots.find((s) => s.id === want)
    if (found) return found
    throw new Error(`未找到 MySQL 数据源 id=${want}`)
  }
  return slots[0]!
}

export async function getMysqlPool(mysqlId?: string): Promise<mysql.Pool> {
  const cfg = pickSlot(mysqlId)
  const key = cfg.id || `idx_${cfg.index}`
  const existing = pools.get(key)
  if (existing) return existing
  if (!cfg.user || !cfg.database) {
    throw new Error(
      `MySQL 数据源 ${key} 缺少 MYSQL_USER / MYSQL_DATABASE`,
    )
  }
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
  })
  pools.set(key, pool)
  return pool
}

export async function queryRows(
  sql: string,
  mysqlId?: string,
): Promise<{
  rows: Record<string, unknown>[]
  meta: { affectedRows: number; insertId: number }
}> {
  const p = await getMysqlPool(mysqlId)
  const [result] = await p.query(sql)
  if (Array.isArray(result)) {
    return {
      rows: result as Record<string, unknown>[],
      meta: { affectedRows: 0, insertId: 0 },
    }
  }
  const header = result as mysql.ResultSetHeader
  return {
    rows: [],
    meta: {
      affectedRows: Number(header.affectedRows ?? 0) || 0,
      insertId: Number(header.insertId ?? 0) || 0,
    },
  }
}
