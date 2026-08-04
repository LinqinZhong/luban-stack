/**
 * 全栈平台工具：类型库 / 图标 / 调色板 / MySQL / OSS / 后端服务。
 * 一律走 HTTP 接口（get→结构化改→save 或专用 POST），不对 AI 暴露磁盘文件读写。
 */
import {
  createMysqlTable,
  createOssBucket,
  deleteMysqlTableRow,
  deleteOssBucket,
  deleteOssObject,
  designMysqlTable,
  dropMysqlTable,
  getBackendServiceLibrary,
  getColorPalette,
  getDataTypeLibrary,
  getIconLibrary,
  getMysqlLibrary,
  getMysqlTableColumns,
  getOssLibrary,
  getServiceControllers,
  getServiceProcessors,
  insertMysqlTableRow,
  listMysqlTableRows,
  listMysqlTables,
  listOssBuckets,
  listOssObjects,
  saveBackendServiceLibrary,
  saveColorPalette,
  saveDataTypeLibrary,
  saveIconLibrary,
  saveMysqlLibrary,
  saveOssLibrary,
  saveServiceControllers,
  saveServiceProcessors,
  signOssObjectByProject,
  testMysqlConnection,
  testOssConnection,
  truncateMysqlTable,
  updateMysqlTableRow,
  uploadOssObject,
  type MysqlDatabaseConfig,
  type OssConnectionConfig,
  type ProcessorLayerKind,
  type ServiceApi,
  type ServiceController,
  type ServiceProcessor,
} from '../api/projects'
import {
  debugBusinessMethodForAi,
  debugControllerApiForAi,
  debugDataMethodForAi,
  runBackendTestSuite,
  type BackendTestCase,
} from './ai-backend-debug'
import type { IconDefinition } from '../types/icon-library'
import type { PaletteColor } from '../types/color-palette'
import type { DataTypeDef, DataTypeGroup } from '../types/data-types'
import type { MysqlConnectionPayload, MysqlTableDef } from '../types/mysql'
import type { BackendService } from '../types/backend-services'
import { createEmptySshConfig } from '../types/mysql'
import { isValidIconId } from '../types/icon-library'
import { isValidPaletteColorName } from '../types/color-palette'
import { isValidServiceId } from '../types/backend-services'

export type AiToolDef = {
  name: string
  label: string
  description: string
  argsHint: string
}

export type AiToolResult =
  | { ok: true; result: string }
  | { ok: false; error: string }

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少参数 ${key}`)
  }
  return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`参数 ${key} 必须是字符串`)
  return value.trim()
}

function requireObject(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`参数 ${key} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (value == null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new Error(`参数 ${key} 必须是数字`)
  return n
}

function summarize(data: unknown, max = 4000): string {
  try {
    const text = JSON.stringify(data, null, 2)
    if (text.length <= max) return text
    return `${text.slice(0, max)}\n…(已截断，共 ${text.length} 字符)`
  } catch {
    return String(data)
  }
}

function mysqlPayloadFromConfig(db: MysqlDatabaseConfig): MysqlConnectionPayload {
  return {
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
    ssh: db.ssh ?? createEmptySshConfig(),
  }
}

function ossPayloadFromConfig(conn: OssConnectionConfig) {
  return {
    endpoint: conn.endpoint,
    region: conn.region,
    accessKeyId: conn.accessKeyId,
    secretAccessKey: conn.secretAccessKey,
    forcePathStyle: conn.forcePathStyle,
  }
}

async function requireMysqlConnection(
  projectPath: string,
  connectionId: string,
): Promise<MysqlDatabaseConfig> {
  const lib = await getMysqlLibrary(projectPath)
  const hit = lib.databases.find((item) => item.id === connectionId)
  if (!hit) throw new Error(`未找到 MySQL 连接：${connectionId}`)
  return hit
}

async function requireOssConnection(
  projectPath: string,
  connectionId: string,
): Promise<OssConnectionConfig> {
  const lib = await getOssLibrary(projectPath)
  const hit = lib.connections.find((item) => item.id === connectionId)
  if (!hit) throw new Error(`未找到 OSS 连接：${connectionId}`)
  return hit
}

function requireLayer(args: Record<string, unknown>): ProcessorLayerKind {
  const layer = requireString(args, 'layer')
  if (layer !== 'business' && layer !== 'data') {
    throw new Error('layer 必须是 business 或 data')
  }
  return layer
}

/** 本身以 s 结尾、不宜当作复数拦截的词 */
const TABLE_NAME_S_ALLOWLIST = new Set([
  'status',
  'address',
  'process',
  'access',
  'goods',
  'news',
  'series',
  'species',
  'analysis',
  'basis',
  'class',
  'pass',
  'progress',
])

/** 表名单数：禁止 orders/users 这类常规复数 */
function assertSingularTableName(name: string) {
  const n = name.trim()
  if (!n) throw new Error('表名不能为空')
  const lower = n.toLowerCase()
  if (TABLE_NAME_S_ALLOWLIST.has(lower)) return
  if (/ies$/i.test(n) || /ses$/i.test(n) || /ches$/i.test(n) || /shes$/i.test(n)) {
    throw new Error(
      `表名「${n}」疑似复数。请改用单数（如 order 而非 orders），并先 ask_user 确认表结构。`,
    )
  }
  if (/s$/i.test(n) && !/ss$/i.test(n)) {
    throw new Error(
      `表名「${n}」疑似复数结尾。请使用单数词根（如 order 而非 orders），并先 ask_user 确认表结构。`,
    )
  }
}

/** 全栈平台工具清单 */
export const PLATFORM_AI_TOOL_CATALOG: AiToolDef[] = [
  // —— 图标 ——
  {
    name: 'upsert_icon',
    label: '新增或更新图标',
    description: '通过接口按 id upsert 图标（SVG content + viewBox）',
    argsHint:
      '{ "icon": { "id": "cart", "label": "购物车", "viewBox": "0 0 24 24", "content": "<path .../>" } }',
  },
  {
    name: 'delete_icon',
    label: '删除图标',
    description: '通过接口按 id 删除图标',
    argsHint: '{ "id": "cart" }',
  },
  // —— 调色板 ——
  {
    name: 'upsert_palette_color',
    label: '新增或更新主题色',
    description: '通过接口按 name upsert 调色板颜色，界面可用 $color.name 引用',
    argsHint:
      '{ "color": { "name": "brand", "description": "品牌色", "value": "#e6a23c" } }',
  },
  {
    name: 'delete_palette_color',
    label: '删除主题色',
    description: '通过接口按 name 删除调色板颜色',
    argsHint: '{ "name": "brand" }',
  },
  // —— 类型库 ——
  {
    name: 'list_data_types',
    label: '列出类型摘要',
    description: '通过接口列出类型库分组与类型摘要（比完整库更短）',
    argsHint: '{}',
  },
  {
    name: 'upsert_data_type_group',
    label: '新增或更新类型分组',
    description: '通过接口 upsert 类型分组元数据（不删已有类型）',
    argsHint: '{ "group": { "id": "order", "name": "订单" } }',
  },
  {
    name: 'delete_data_type_group',
    label: '删除类型分组',
    description: '通过接口删除整个类型分组及其类型',
    argsHint: '{ "groupId": "order" }',
  },
  {
    name: 'upsert_data_type',
    label: '新增或更新类型',
    description: '通过接口在指定分组内 upsert 类型定义',
    argsHint:
      '{ "groupId": "order", "type": { "id": "Order", "name": "Order", "kind": "interface", "category": "entity", "remark": "", "tableName": "orders", "fields": [], "generics": [], "enumMembers": [], "combination": { "intersections": [{ "alternatives": [{ "kind": "string" }] }] } } }',
  },
  {
    name: 'delete_data_type',
    label: '删除类型',
    description: '通过接口删除分组内某个类型',
    argsHint: '{ "groupId": "order", "typeId": "Order" }',
  },
  // —— MySQL ——
  {
    name: 'list_mysql_connections',
    label: '列出 MySQL 连接',
    description: '通过接口列出项目已配置的数据库连接（不含敏感细节时可摘要）',
    argsHint: '{}',
  },
  {
    name: 'upsert_mysql_connection',
    label: '新增或更新 MySQL 连接',
    description: '通过接口保存连接配置；新建可不传 id',
    argsHint:
      '{ "connection": { "id": "mysql_local", "name": "本地", "host": "127.0.0.1", "port": 3306, "username": "root", "password": "", "database": "mall" } }',
  },
  {
    name: 'delete_mysql_connection',
    label: '删除 MySQL 连接',
    description: '通过接口删除连接配置',
    argsHint: '{ "connectionId": "mysql_local" }',
  },
  {
    name: 'test_mysql_connection',
    label: '测试 MySQL 连接',
    description: '通过接口测试连接并拉取表列表',
    argsHint: '{ "connectionId": "mysql_local" }',
  },
  {
    name: 'list_mysql_tables',
    label: '列出数据表',
    description: '通过接口列出连接下的数据表',
    argsHint: '{ "connectionId": "mysql_local" }',
  },
  {
    name: 'get_mysql_table_schema',
    label: '读取表结构',
    description: '通过接口读取表列与索引（含本地/远程冲突信息）',
    argsHint: '{ "connectionId": "mysql_local", "tableName": "orders" }',
  },
  {
    name: 'create_mysql_table',
    label: '创建数据表',
    description:
      '通过接口创建表。表名单数（order 非 orders）。用户未给定完整结构时须先 ask_user 确认表名/字段/索引',
    argsHint:
      '{ "connectionId": "mysql_local", "table": { "name": "order", "remark": "订单", "columns": [{ "name": "id", "type": "bigint", "nullable": false, "primaryKey": true, "autoIncrement": true, "defaultValue": "", "comment": "" }], "indexes": [] } }',
  },
  {
    name: 'design_mysql_table',
    label: '设计/修改表结构',
    description:
      '通过接口修改表列与索引。重大结构调整前先 ask_user 确认字段与索引',
    argsHint:
      '{ "connectionId": "mysql_local", "tableName": "order", "columns": [...], "indexes": [], "remark": "订单" }',
  },
  {
    name: 'drop_mysql_table',
    label: '删除数据表',
    description: '通过接口删除表（危险操作，不确定时先 ask_user）',
    argsHint: '{ "connectionId": "mysql_local", "tableName": "order" }',
  },
  {
    name: 'truncate_mysql_table',
    label: '清空数据表',
    description: '通过接口清空表数据',
    argsHint: '{ "connectionId": "mysql_local", "tableName": "order" }',
  },
  {
    name: 'list_mysql_rows',
    label: '查询表数据',
    description: '通过接口分页读取表行',
    argsHint:
      '{ "connectionId": "mysql_local", "tableName": "order", "current": 1, "pageSize": 20 }',
  },
  {
    name: 'insert_mysql_row',
    label: '插入表行',
    description: '通过接口插入一行',
    argsHint:
      '{ "connectionId": "mysql_local", "tableName": "order", "values": { "status": "pending" } }',
  },
  {
    name: 'update_mysql_row',
    label: '更新表行',
    description: '通过接口按主键更新一行',
    argsHint:
      '{ "connectionId": "mysql_local", "tableName": "order", "key": { "id": 1 }, "values": { "status": "paid" } }',
  },
  {
    name: 'delete_mysql_row',
    label: '删除表行',
    description: '通过接口按主键删除一行',
    argsHint:
      '{ "connectionId": "mysql_local", "tableName": "order", "key": { "id": 1 } }',
  },
  // —— OSS ——
  {
    name: 'list_oss_connections',
    label: '列出对象存储连接',
    description: '通过接口列出 OSS/S3 连接配置',
    argsHint: '{}',
  },
  {
    name: 'upsert_oss_connection',
    label: '新增或更新对象存储连接',
    description: '通过接口保存 OSS 连接',
    argsHint:
      '{ "connection": { "id": "oss_local", "name": "MinIO", "endpoint": "http://127.0.0.1:9000", "region": "us-east-1", "accessKeyId": "minio", "secretAccessKey": "minio123", "forcePathStyle": true } }',
  },
  {
    name: 'delete_oss_connection',
    label: '删除对象存储连接',
    description: '通过接口删除 OSS 连接',
    argsHint: '{ "connectionId": "oss_local" }',
  },
  {
    name: 'test_oss_connection',
    label: '测试对象存储连接',
    description: '通过接口测试并拉取桶列表',
    argsHint: '{ "connectionId": "oss_local" }',
  },
  {
    name: 'list_oss_buckets',
    label: '列出存储桶',
    description: '通过接口列出桶',
    argsHint: '{ "connectionId": "oss_local" }',
  },
  {
    name: 'create_oss_bucket',
    label: '创建存储桶',
    description: '通过接口创建桶',
    argsHint: '{ "connectionId": "oss_local", "bucketName": "mall" }',
  },
  {
    name: 'delete_oss_bucket',
    label: '删除存储桶',
    description: '通过接口删除桶',
    argsHint: '{ "connectionId": "oss_local", "bucketName": "mall" }',
  },
  {
    name: 'list_oss_objects',
    label: '列出对象',
    description: '通过接口列出桶内对象',
    argsHint:
      '{ "connectionId": "oss_local", "bucketName": "mall", "prefix": "icons/" }',
  },
  {
    name: 'upload_oss_object',
    label: '上传对象',
    description: '通过接口上传对象（contentBase64）',
    argsHint:
      '{ "connectionId": "oss_local", "bucketName": "mall", "key": "a.png", "contentBase64": "...", "contentType": "image/png" }',
  },
  {
    name: 'delete_oss_object',
    label: '删除对象',
    description: '通过接口删除对象',
    argsHint:
      '{ "connectionId": "oss_local", "bucketName": "mall", "key": "a.png" }',
  },
  {
    name: 'sign_oss_object',
    label: '签名对象 URL',
    description: '通过接口生成临时访问 URL',
    argsHint:
      '{ "connectionId": "oss_local", "bucketName": "mall", "key": "a.png" }',
  },
  // —— 后端服务 ——
  {
    name: 'list_backend_services',
    label: '列出后端服务',
    description: '通过接口列出后端服务模块',
    argsHint: '{}',
  },
  {
    name: 'upsert_backend_service',
    label: '新增或更新后端服务',
    description: '通过接口创建/更新服务模块（绑定测试/生产 MySQL id）',
    argsHint:
      '{ "service": { "id": "order", "name": "订单服务", "testMysqlId": "mysql_local", "productionMysqlId": "mysql_local" } }',
  },
  {
    name: 'delete_backend_service',
    label: '删除后端服务',
    description: '通过接口删除服务模块',
    argsHint: '{ "serviceId": "order" }',
  },
  {
    name: 'get_service_controllers',
    label: '读取控制器',
    description: '通过接口读取服务下全部控制器与 API',
    argsHint: '{ "serviceId": "order" }',
  },
  {
    name: 'upsert_service_controller',
    label: '新增或更新控制器',
    description: '通过接口 upsert 控制器（保留未改动的 apis 时可只传元数据+apis）',
    argsHint:
      '{ "serviceId": "order", "controller": { "id": "OrderController", "name": "订单", "path": "/order", "remark": "", "apis": [] } }',
  },
  {
    name: 'delete_service_controller',
    label: '删除控制器',
    description: '通过接口删除控制器',
    argsHint: '{ "serviceId": "order", "controllerId": "OrderController" }',
  },
  {
    name: 'upsert_service_api',
    label: '新增或更新 API',
    description: '通过接口在控制器内 upsert 一条 API',
    argsHint:
      '{ "serviceId": "order", "controllerId": "OrderController", "api": { "id": "list", "name": "列表", "path": "/list", "method": "GET", "remark": "", "inputs": [], "requireAuth": false, "scope": "public", "debugParams": {}, "flow": { "nodes": [], "edges": [] } } }',
  },
  {
    name: 'delete_service_api',
    label: '删除 API',
    description: '通过接口删除控制器内一条 API',
    argsHint:
      '{ "serviceId": "order", "controllerId": "OrderController", "apiId": "list" }',
  },
  {
    name: 'get_service_processors',
    label: '读取处理器',
    description: '通过接口读取 business 或 data 层处理器',
    argsHint: '{ "serviceId": "order", "layer": "business" }',
  },
  {
    name: 'upsert_service_processor',
    label: '新增或更新处理器',
    description: '通过接口 upsert 业务层/数据层处理器',
    argsHint:
      '{ "serviceId": "order", "layer": "data", "processor": { "id": "OrderData", "name": "订单数据", "remark": "", "entityRef": "Order", "dataProcessorRef": "", "methods": [] } }',
  },
  {
    name: 'delete_service_processor',
    label: '删除处理器',
    description: '通过接口删除处理器',
    argsHint:
      '{ "serviceId": "order", "layer": "data", "processorId": "OrderData" }',
  },
  {
    name: 'upsert_processor_method',
    label: '新增或更新处理方法',
    description: '通过接口在处理器内 upsert 方法',
    argsHint:
      '{ "serviceId": "order", "layer": "data", "processorId": "OrderData", "method": { "id": "findById", "name": "findById", "remark": "", "scope": "public", "params": [], "debugParams": {} } }',
  },
  {
    name: 'delete_processor_method',
    label: '删除处理方法',
    description: '通过接口删除处理器方法',
    argsHint:
      '{ "serviceId": "order", "layer": "data", "processorId": "OrderData", "methodId": "findById" }',
  },
  {
    name: 'debug_data_layer_method',
    label: '调试数据层方法',
    description: '试跑数据层方法（默认 dryRun 写回滚）。改完后端后须配合用例调试',
    argsHint:
      '{ "serviceId": "order", "processorId": "OrderData", "methodId": "findById", "params": { "id": 1 }, "dryRun": true }',
  },
  {
    name: 'debug_business_method',
    label: '调试业务层方法',
    description: '试跑业务层工作流（可调用数据层，默认 dryRun）',
    argsHint:
      '{ "serviceId": "order", "processorId": "OrderBiz", "methodId": "createOrder", "params": { "skuId": "1" }, "dryRun": true }',
  },
  {
    name: 'debug_controller_api',
    label: '调试控制器 API',
    description: '试跑控制器 API 工作流（可调用业务/数据层，默认 dryRun）',
    argsHint:
      '{ "serviceId": "order", "controllerId": "OrderController", "apiId": "list", "params": {}, "headers": {}, "dryRun": true }',
  },
  {
    name: 'run_backend_tests',
    label: '运行后端测试套件',
    description:
      '批量运行全面测试用例（data/business/controller）。改过后必须调用且全部 passed=true 才允许 finish',
    argsHint:
      '{ "cases": [{ "name": "查订单成功", "layer": "data", "serviceId": "order", "targetId": "OrderData", "methodId": "findById", "params": { "id": 1 }, "expect": { "ok": true } }, { "name": "缺参应失败", "layer": "business", "serviceId": "order", "targetId": "OrderBiz", "methodId": "createOrder", "params": {}, "expect": { "ok": false, "errorContains": "必填" } }] }',
  },
]

const PLATFORM_TOOL_NAMES = new Set(PLATFORM_AI_TOOL_CATALOG.map((t) => t.name))

export function isPlatformAiTool(tool: string): boolean {
  return PLATFORM_TOOL_NAMES.has(tool)
}

export async function executePlatformAiTool(options: {
  projectPath: string
  tool: string
  args?: Record<string, unknown>
}): Promise<AiToolResult | null> {
  if (!isPlatformAiTool(options.tool)) return null
  const args = options.args ?? {}
  const projectPath = options.projectPath
  try {
    switch (options.tool) {
      case 'upsert_icon': {
        const raw = requireObject(args, 'icon')
        const id = String(raw.id ?? '').trim()
        if (!isValidIconId(id)) throw new Error('icon.id 不合法')
        const icon: IconDefinition = {
          id,
          label: String(raw.label ?? id).trim() || id,
          viewBox: String(raw.viewBox ?? '0 0 24 24').trim() || '0 0 24 24',
          content: String(raw.content ?? '').trim(),
          ...(raw.ossBinding && typeof raw.ossBinding === 'object'
            ? { ossBinding: raw.ossBinding as IconDefinition['ossBinding'] }
            : {}),
        }
        if (!icon.content) throw new Error('icon.content 不能为空')
        const lib = await getIconLibrary(projectPath)
        const icons = [...lib.icons]
        const idx = icons.findIndex((item) => item.id === id)
        if (idx >= 0) icons[idx] = { ...icons[idx], ...icon }
        else icons.push(icon)
        const saved = await saveIconLibrary({ projectPath, icons })
        return {
          ok: true,
          result: summarize({
            id,
            action: idx >= 0 ? 'updated' : 'created',
            count: saved.icons.length,
          }),
        }
      }
      case 'delete_icon': {
        const id = requireString(args, 'id')
        const lib = await getIconLibrary(projectPath)
        const icons = lib.icons.filter((item) => item.id !== id)
        if (icons.length === lib.icons.length) throw new Error(`未找到图标：${id}`)
        const saved = await saveIconLibrary({ projectPath, icons })
        return { ok: true, result: summarize({ removed: id, count: saved.icons.length }) }
      }
      case 'upsert_palette_color': {
        const raw = requireObject(args, 'color')
        const name = String(raw.name ?? '').trim()
        if (!isValidPaletteColorName(name)) throw new Error('color.name 不合法')
        const color: PaletteColor = {
          name,
          description: String(raw.description ?? '').trim(),
          value: String(raw.value ?? '').trim(),
        }
        if (!color.value) throw new Error('color.value 不能为空')
        const lib = await getColorPalette(projectPath)
        const colors = [...lib.colors]
        const idx = colors.findIndex((item) => item.name === name)
        if (idx >= 0) colors[idx] = { ...colors[idx], ...color }
        else colors.push(color)
        const saved = await saveColorPalette({ projectPath, colors })
        return {
          ok: true,
          result: summarize({
            name,
            action: idx >= 0 ? 'updated' : 'created',
            count: saved.colors.length,
          }),
        }
      }
      case 'delete_palette_color': {
        const name = requireString(args, 'name')
        const lib = await getColorPalette(projectPath)
        const colors = lib.colors.filter((item) => item.name !== name)
        if (colors.length === lib.colors.length) {
          throw new Error(`未找到主题色：${name}`)
        }
        const saved = await saveColorPalette({ projectPath, colors })
        return {
          ok: true,
          result: summarize({ removed: name, count: saved.colors.length }),
        }
      }
      case 'list_data_types': {
        const lib = await getDataTypeLibrary(projectPath)
        return {
          ok: true,
          result: summarize(
            lib.groups.map((g) => ({
              id: g.id,
              name: g.name,
              types: g.types.map((t) => ({
                id: t.id,
                name: t.name,
                kind: t.kind,
                category: t.category,
                tableName: t.tableName,
              })),
            })),
          ),
        }
      }
      case 'upsert_data_type_group': {
        const raw = requireObject(args, 'group')
        const id = String(raw.id ?? '').trim()
        const name = String(raw.name ?? id).trim()
        if (!id) throw new Error('group.id 不能为空')
        const lib = await getDataTypeLibrary(projectPath)
        const groups = [...lib.groups]
        const idx = groups.findIndex((g) => g.id === id)
        if (idx >= 0) {
          groups[idx] = { ...groups[idx], name: name || groups[idx].name }
        } else {
          groups.push({ id, name: name || id, types: [] })
        }
        const saved = await saveDataTypeLibrary({ projectPath, groups })
        return {
          ok: true,
          result: summarize({
            groupId: id,
            action: idx >= 0 ? 'updated' : 'created',
            groupCount: saved.groups.length,
          }),
        }
      }
      case 'delete_data_type_group': {
        const groupId = requireString(args, 'groupId')
        const lib = await getDataTypeLibrary(projectPath)
        const groups = lib.groups.filter((g) => g.id !== groupId)
        if (groups.length === lib.groups.length) {
          throw new Error(`未找到类型分组：${groupId}`)
        }
        const saved = await saveDataTypeLibrary({ projectPath, groups })
        return {
          ok: true,
          result: summarize({ removed: groupId, groupCount: saved.groups.length }),
        }
      }
      case 'upsert_data_type': {
        const groupId = requireString(args, 'groupId')
        const type = requireObject(args, 'type') as unknown as DataTypeDef
        if (!type?.id?.trim() || !type?.name?.trim()) {
          throw new Error('type.id / type.name 不能为空')
        }
        const lib = await getDataTypeLibrary(projectPath)
        const groups = lib.groups.map((g) => ({ ...g, types: [...g.types] }))
        let group = groups.find((g) => g.id === groupId)
        if (!group) {
          group = { id: groupId, name: groupId, types: [] }
          groups.push(group)
        }
        const idx = group.types.findIndex((t) => t.id === type.id)
        const next: DataTypeDef = {
          id: type.id.trim(),
          name: type.name.trim(),
          kind: type.kind || 'interface',
          remark: type.remark ?? '',
          tableName: type.tableName ?? '',
          category: type.category || 'other',
          generics: type.generics ?? [],
          fields: type.fields ?? [],
          enumMembers: type.enumMembers ?? [],
          combination: type.combination ?? {
            intersections: [{ alternatives: [{ kind: 'string' }] }],
          },
        }
        if (idx >= 0) group.types[idx] = { ...group.types[idx], ...next }
        else group.types.push(next)
        const saved = await saveDataTypeLibrary({ projectPath, groups })
        return {
          ok: true,
          result: summarize({
            groupId,
            typeId: next.id,
            action: idx >= 0 ? 'updated' : 'created',
            groupCount: saved.groups.length,
          }),
        }
      }
      case 'delete_data_type': {
        const groupId = requireString(args, 'groupId')
        const typeId = requireString(args, 'typeId')
        const lib = await getDataTypeLibrary(projectPath)
        const groups: DataTypeGroup[] = lib.groups.map((g) => ({
          ...g,
          types: [...g.types],
        }))
        const group = groups.find((g) => g.id === groupId)
        if (!group) throw new Error(`未找到类型分组：${groupId}`)
        const before = group.types.length
        group.types = group.types.filter((t) => t.id !== typeId)
        if (group.types.length === before) throw new Error(`未找到类型：${typeId}`)
        const saved = await saveDataTypeLibrary({ projectPath, groups })
        return {
          ok: true,
          result: summarize({
            groupId,
            removed: typeId,
            groupCount: saved.groups.length,
          }),
        }
      }
      case 'list_mysql_connections': {
        const lib = await getMysqlLibrary(projectPath)
        return {
          ok: true,
          result: summarize(
            lib.databases.map((d) => ({
              id: d.id,
              name: d.name,
              host: d.host,
              port: d.port,
              database: d.database,
              username: d.username,
              tableCount: d.tables?.length ?? 0,
              lastTestedAt: d.lastTestedAt,
            })),
          ),
        }
      }
      case 'upsert_mysql_connection': {
        const raw = requireObject(args, 'connection')
        const lib = await getMysqlLibrary(projectPath)
        const databases = [...lib.databases]
        let id = String(raw.id ?? '').trim()
        if (!id) id = `mysql_${Date.now().toString(36)}`
        const idx = databases.findIndex((d) => d.id === id)
        const base =
          idx >= 0
            ? databases[idx]
            : ({
                id,
                name: id,
                host: '127.0.0.1',
                port: 3306,
                username: 'root',
                password: '',
                database: '',
                ssh: createEmptySshConfig(),
                tables: [],
                lastTestedAt: null,
              } satisfies MysqlDatabaseConfig)
        const next: MysqlDatabaseConfig = {
          ...base,
          id,
          name: String(raw.name ?? base.name).trim() || id,
          host: String(raw.host ?? base.host).trim() || '127.0.0.1',
          port:
            typeof raw.port === 'number'
              ? raw.port
              : Number(raw.port ?? base.port) || 3306,
          username: String(raw.username ?? base.username),
          password:
            raw.password == null ? base.password : String(raw.password),
          database: String(raw.database ?? base.database),
          ssh:
            raw.ssh && typeof raw.ssh === 'object'
              ? ({ ...base.ssh, ...(raw.ssh as object) } as MysqlDatabaseConfig['ssh'])
              : base.ssh,
        }
        if (idx >= 0) databases[idx] = next
        else databases.push(next)
        const saved = await saveMysqlLibrary({ projectPath, databases })
        return {
          ok: true,
          result: summarize({
            connectionId: id,
            action: idx >= 0 ? 'updated' : 'created',
            count: saved.databases.length,
          }),
        }
      }
      case 'delete_mysql_connection': {
        const connectionId = requireString(args, 'connectionId')
        const lib = await getMysqlLibrary(projectPath)
        const databases = lib.databases.filter((d) => d.id !== connectionId)
        if (databases.length === lib.databases.length) {
          throw new Error(`未找到 MySQL 连接：${connectionId}`)
        }
        const saved = await saveMysqlLibrary({ projectPath, databases })
        return {
          ok: true,
          result: summarize({
            removed: connectionId,
            count: saved.databases.length,
          }),
        }
      }
      case 'test_mysql_connection': {
        const connectionId = requireString(args, 'connectionId')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await testMysqlConnection(mysqlPayloadFromConfig(db))
        return {
          ok: true,
          result: summarize({
            connectionId,
            message: res.message,
            serverVersion: res.serverVersion,
            tables: res.tables,
          }),
        }
      }
      case 'list_mysql_tables': {
        const connectionId = requireString(args, 'connectionId')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await listMysqlTables(mysqlPayloadFromConfig(db))
        return { ok: true, result: summarize({ connectionId, tables: res.tables }) }
      }
      case 'get_mysql_table_schema': {
        const connectionId = requireString(args, 'connectionId')
        const tableName = requireString(args, 'tableName')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await getMysqlTableColumns({
          ...mysqlPayloadFromConfig(db),
          tableName,
          projectPath,
        })
        return { ok: true, result: summarize({ connectionId, tableName, ...res }) }
      }
      case 'create_mysql_table': {
        const connectionId = requireString(args, 'connectionId')
        const table = requireObject(args, 'table') as unknown as MysqlTableDef
        if (!table?.name?.trim()) throw new Error('table.name 不能为空')
        assertSingularTableName(table.name)
        if (!Array.isArray(table.columns) || !table.columns.length) {
          throw new Error('table.columns 不能为空')
        }
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await createMysqlTable({
          ...mysqlPayloadFromConfig(db),
          table,
          projectPath,
        })
        return {
          ok: true,
          result: summarize({ connectionId, table: table.name, tables: res.tables }),
        }
      }
      case 'design_mysql_table': {
        const connectionId = requireString(args, 'connectionId')
        const tableName = requireString(args, 'tableName')
        const columns = args.columns
        if (!Array.isArray(columns) || !columns.length) {
          throw new Error('columns 不能为空')
        }
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await designMysqlTable({
          ...mysqlPayloadFromConfig(db),
          tableName,
          columns: columns as never,
          indexes: Array.isArray(args.indexes) ? (args.indexes as never) : undefined,
          remark: optionalString(args, 'remark'),
          projectPath,
        })
        return {
          ok: true,
          result: summarize({ connectionId, tableName, tables: res.tables }),
        }
      }
      case 'drop_mysql_table': {
        const connectionId = requireString(args, 'connectionId')
        const tableName = requireString(args, 'tableName')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await dropMysqlTable({
          ...mysqlPayloadFromConfig(db),
          tableName,
          projectPath,
        })
        return {
          ok: true,
          result: summarize({ connectionId, dropped: tableName, tables: res.tables }),
        }
      }
      case 'truncate_mysql_table': {
        const connectionId = requireString(args, 'connectionId')
        const tableName = requireString(args, 'tableName')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await truncateMysqlTable({
          ...mysqlPayloadFromConfig(db),
          tableName,
        })
        return {
          ok: true,
          result: summarize({ connectionId, truncated: tableName, tables: res.tables }),
        }
      }
      case 'list_mysql_rows': {
        const connectionId = requireString(args, 'connectionId')
        const tableName = requireString(args, 'tableName')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await listMysqlTableRows({
          ...mysqlPayloadFromConfig(db),
          tableName,
          current: optionalNumber(args, 'current'),
          pageSize: optionalNumber(args, 'pageSize'),
          projectPath,
        })
        return { ok: true, result: summarize({ connectionId, tableName, ...res }) }
      }
      case 'insert_mysql_row': {
        const connectionId = requireString(args, 'connectionId')
        const tableName = requireString(args, 'tableName')
        const values = requireObject(args, 'values')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await insertMysqlTableRow({
          ...mysqlPayloadFromConfig(db),
          tableName,
          values,
        })
        return { ok: true, result: summarize({ connectionId, tableName, ...res }) }
      }
      case 'update_mysql_row': {
        const connectionId = requireString(args, 'connectionId')
        const tableName = requireString(args, 'tableName')
        const key = requireObject(args, 'key')
        const values = requireObject(args, 'values')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await updateMysqlTableRow({
          ...mysqlPayloadFromConfig(db),
          tableName,
          key,
          values,
        })
        return { ok: true, result: summarize({ connectionId, tableName, ...res }) }
      }
      case 'delete_mysql_row': {
        const connectionId = requireString(args, 'connectionId')
        const tableName = requireString(args, 'tableName')
        const key = requireObject(args, 'key')
        const db = await requireMysqlConnection(projectPath, connectionId)
        const res = await deleteMysqlTableRow({
          ...mysqlPayloadFromConfig(db),
          tableName,
          key,
        })
        return { ok: true, result: summarize({ connectionId, tableName, ...res }) }
      }
      case 'list_oss_connections': {
        const lib = await getOssLibrary(projectPath)
        return {
          ok: true,
          result: summarize(
            lib.connections.map((c) => ({
              id: c.id,
              name: c.name,
              endpoint: c.endpoint,
              region: c.region,
              forcePathStyle: c.forcePathStyle,
              bucketCount: c.buckets?.length ?? 0,
              lastTestedAt: c.lastTestedAt,
            })),
          ),
        }
      }
      case 'upsert_oss_connection': {
        const raw = requireObject(args, 'connection')
        const lib = await getOssLibrary(projectPath)
        const connections = [...lib.connections]
        let id = String(raw.id ?? '').trim()
        if (!id) id = `oss_${Date.now().toString(36)}`
        const idx = connections.findIndex((c) => c.id === id)
        const base =
          idx >= 0
            ? connections[idx]
            : ({
                id,
                name: id,
                endpoint: '',
                region: 'us-east-1',
                accessKeyId: '',
                secretAccessKey: '',
                forcePathStyle: true,
                buckets: [],
                lastTestedAt: null,
              } satisfies OssConnectionConfig)
        const next: OssConnectionConfig = {
          ...base,
          id,
          name: String(raw.name ?? base.name).trim() || id,
          endpoint: String(raw.endpoint ?? base.endpoint).trim(),
          region: String(raw.region ?? base.region).trim() || 'us-east-1',
          accessKeyId: String(raw.accessKeyId ?? base.accessKeyId),
          secretAccessKey:
            raw.secretAccessKey == null
              ? base.secretAccessKey
              : String(raw.secretAccessKey),
          forcePathStyle:
            raw.forcePathStyle == null
              ? base.forcePathStyle
              : Boolean(raw.forcePathStyle),
        }
        if (idx >= 0) connections[idx] = next
        else connections.push(next)
        const saved = await saveOssLibrary({ projectPath, connections })
        return {
          ok: true,
          result: summarize({
            connectionId: id,
            action: idx >= 0 ? 'updated' : 'created',
            count: saved.connections.length,
          }),
        }
      }
      case 'delete_oss_connection': {
        const connectionId = requireString(args, 'connectionId')
        const lib = await getOssLibrary(projectPath)
        const connections = lib.connections.filter((c) => c.id !== connectionId)
        if (connections.length === lib.connections.length) {
          throw new Error(`未找到 OSS 连接：${connectionId}`)
        }
        const saved = await saveOssLibrary({ projectPath, connections })
        return {
          ok: true,
          result: summarize({
            removed: connectionId,
            count: saved.connections.length,
          }),
        }
      }
      case 'test_oss_connection': {
        const connectionId = requireString(args, 'connectionId')
        const conn = await requireOssConnection(projectPath, connectionId)
        const res = await testOssConnection(ossPayloadFromConfig(conn))
        return {
          ok: true,
          result: summarize({
            connectionId,
            message: res.message,
            buckets: res.buckets,
          }),
        }
      }
      case 'list_oss_buckets': {
        const connectionId = requireString(args, 'connectionId')
        const conn = await requireOssConnection(projectPath, connectionId)
        const res = await listOssBuckets(ossPayloadFromConfig(conn))
        return {
          ok: true,
          result: summarize({ connectionId, buckets: res.buckets }),
        }
      }
      case 'create_oss_bucket': {
        const connectionId = requireString(args, 'connectionId')
        const bucketName = requireString(args, 'bucketName')
        const conn = await requireOssConnection(projectPath, connectionId)
        const res = await createOssBucket({
          ...ossPayloadFromConfig(conn),
          bucketName,
        })
        return { ok: true, result: summarize({ connectionId, bucketName, ...res }) }
      }
      case 'delete_oss_bucket': {
        const connectionId = requireString(args, 'connectionId')
        const bucketName = requireString(args, 'bucketName')
        const conn = await requireOssConnection(projectPath, connectionId)
        const res = await deleteOssBucket({
          ...ossPayloadFromConfig(conn),
          bucketName,
        })
        return { ok: true, result: summarize({ connectionId, bucketName, ...res }) }
      }
      case 'list_oss_objects': {
        const connectionId = requireString(args, 'connectionId')
        const bucketName = requireString(args, 'bucketName')
        const conn = await requireOssConnection(projectPath, connectionId)
        const res = await listOssObjects({
          ...ossPayloadFromConfig(conn),
          bucketName,
          prefix: optionalString(args, 'prefix'),
        })
        return { ok: true, result: summarize({ connectionId, bucketName, ...res }) }
      }
      case 'upload_oss_object': {
        const connectionId = requireString(args, 'connectionId')
        const bucketName = requireString(args, 'bucketName')
        const key = requireString(args, 'key')
        const contentBase64 = requireString(args, 'contentBase64')
        const conn = await requireOssConnection(projectPath, connectionId)
        const res = await uploadOssObject({
          ...ossPayloadFromConfig(conn),
          bucketName,
          key,
          contentBase64,
          contentType: optionalString(args, 'contentType'),
        })
        return { ok: true, result: summarize({ connectionId, bucketName, key, ...res }) }
      }
      case 'delete_oss_object': {
        const connectionId = requireString(args, 'connectionId')
        const bucketName = requireString(args, 'bucketName')
        const key = requireString(args, 'key')
        const conn = await requireOssConnection(projectPath, connectionId)
        const res = await deleteOssObject({
          ...ossPayloadFromConfig(conn),
          bucketName,
          key,
        })
        return { ok: true, result: summarize({ connectionId, bucketName, key, ...res }) }
      }
      case 'sign_oss_object': {
        const connectionId = requireString(args, 'connectionId')
        const bucketName = requireString(args, 'bucketName')
        const key = requireString(args, 'key')
        const res = await signOssObjectByProject({
          projectPath,
          connectionId,
          bucketName,
          key,
        })
        return { ok: true, result: summarize(res) }
      }
      case 'list_backend_services': {
        const lib = await getBackendServiceLibrary(projectPath)
        return { ok: true, result: summarize(lib.services) }
      }
      case 'upsert_backend_service': {
        const raw = requireObject(args, 'service')
        const id = String(raw.id ?? '').trim()
        if (!isValidServiceId(id)) throw new Error('service.id 不合法')
        const lib = await getBackendServiceLibrary(projectPath)
        const services = [...lib.services]
        const idx = services.findIndex((s) => s.id === id)
        const next: BackendService = {
          id,
          name: String(raw.name ?? id).trim() || id,
          testMysqlId: String(raw.testMysqlId ?? '').trim(),
          productionMysqlId: String(raw.productionMysqlId ?? '').trim(),
        }
        if (idx >= 0) services[idx] = { ...services[idx], ...next }
        else services.push(next)
        const saved = await saveBackendServiceLibrary({ projectPath, services })
        return {
          ok: true,
          result: summarize({
            serviceId: id,
            action: idx >= 0 ? 'updated' : 'created',
            count: saved.services.length,
          }),
        }
      }
      case 'delete_backend_service': {
        const serviceId = requireString(args, 'serviceId')
        const lib = await getBackendServiceLibrary(projectPath)
        const services = lib.services.filter((s) => s.id !== serviceId)
        if (services.length === lib.services.length) {
          throw new Error(`未找到后端服务：${serviceId}`)
        }
        const saved = await saveBackendServiceLibrary({ projectPath, services })
        return {
          ok: true,
          result: summarize({ removed: serviceId, count: saved.services.length }),
        }
      }
      case 'get_service_controllers': {
        const serviceId = requireString(args, 'serviceId')
        const res = await getServiceControllers(projectPath, serviceId)
        return { ok: true, result: summarize(res.controllers) }
      }
      case 'upsert_service_controller': {
        const serviceId = requireString(args, 'serviceId')
        const controller = requireObject(args, 'controller') as unknown as ServiceController
        if (!controller?.id?.trim()) throw new Error('controller.id 不能为空')
        const res = await getServiceControllers(projectPath, serviceId)
        const controllers = [...res.controllers]
        const idx = controllers.findIndex((c) => c.id === controller.id)
        const next: ServiceController = {
          id: controller.id.trim(),
          name: controller.name?.trim() || controller.id,
          path: controller.path?.trim() || `/${controller.id}`,
          remark: controller.remark ?? '',
          apis: Array.isArray(controller.apis)
            ? controller.apis
            : idx >= 0
              ? controllers[idx].apis
              : [],
        }
        if (idx >= 0) controllers[idx] = { ...controllers[idx], ...next }
        else controllers.push(next)
        const saved = await saveServiceControllers({
          projectPath,
          serviceId,
          controllers,
        })
        return {
          ok: true,
          result: summarize({
            serviceId,
            controllerId: next.id,
            action: idx >= 0 ? 'updated' : 'created',
            count: saved.controllers.length,
          }),
        }
      }
      case 'delete_service_controller': {
        const serviceId = requireString(args, 'serviceId')
        const controllerId = requireString(args, 'controllerId')
        const res = await getServiceControllers(projectPath, serviceId)
        const controllers = res.controllers.filter((c) => c.id !== controllerId)
        if (controllers.length === res.controllers.length) {
          throw new Error(`未找到控制器：${controllerId}`)
        }
        const saved = await saveServiceControllers({
          projectPath,
          serviceId,
          controllers,
        })
        return {
          ok: true,
          result: summarize({
            serviceId,
            removed: controllerId,
            count: saved.controllers.length,
          }),
        }
      }
      case 'upsert_service_api': {
        const serviceId = requireString(args, 'serviceId')
        const controllerId = requireString(args, 'controllerId')
        const api = requireObject(args, 'api') as unknown as ServiceApi
        if (!api?.id?.trim()) throw new Error('api.id 不能为空')
        const res = await getServiceControllers(projectPath, serviceId)
        const controllers = res.controllers.map((c) => ({
          ...c,
          apis: [...c.apis],
        }))
        const controller = controllers.find((c) => c.id === controllerId)
        if (!controller) throw new Error(`未找到控制器：${controllerId}`)
        const idx = controller.apis.findIndex((a) => a.id === api.id)
        const next = {
          ...(idx >= 0 ? controller.apis[idx] : {}),
          ...api,
          id: api.id.trim(),
        } as ServiceApi
        if (idx >= 0) controller.apis[idx] = next
        else controller.apis.push(next)
        const saved = await saveServiceControllers({
          projectPath,
          serviceId,
          controllers,
        })
        return {
          ok: true,
          result: summarize({
            serviceId,
            controllerId,
            apiId: next.id,
            action: idx >= 0 ? 'updated' : 'created',
            apiCount: saved.controllers.find((c) => c.id === controllerId)?.apis
              .length,
          }),
        }
      }
      case 'delete_service_api': {
        const serviceId = requireString(args, 'serviceId')
        const controllerId = requireString(args, 'controllerId')
        const apiId = requireString(args, 'apiId')
        const res = await getServiceControllers(projectPath, serviceId)
        const controllers = res.controllers.map((c) => ({
          ...c,
          apis: [...c.apis],
        }))
        const controller = controllers.find((c) => c.id === controllerId)
        if (!controller) throw new Error(`未找到控制器：${controllerId}`)
        const before = controller.apis.length
        controller.apis = controller.apis.filter((a) => a.id !== apiId)
        if (controller.apis.length === before) throw new Error(`未找到 API：${apiId}`)
        const saved = await saveServiceControllers({
          projectPath,
          serviceId,
          controllers,
        })
        return {
          ok: true,
          result: summarize({
            serviceId,
            controllerId,
            removed: apiId,
            apiCount: saved.controllers.find((c) => c.id === controllerId)?.apis
              .length,
          }),
        }
      }
      case 'get_service_processors': {
        const serviceId = requireString(args, 'serviceId')
        const layer = requireLayer(args)
        const res = await getServiceProcessors(projectPath, serviceId, layer)
        return { ok: true, result: summarize({ layer, processors: res.processors }) }
      }
      case 'upsert_service_processor': {
        const serviceId = requireString(args, 'serviceId')
        const layer = requireLayer(args)
        const processor = requireObject(
          args,
          'processor',
        ) as unknown as ServiceProcessor
        if (!processor?.id?.trim()) throw new Error('processor.id 不能为空')
        const res = await getServiceProcessors(projectPath, serviceId, layer)
        const processors = [...res.processors]
        const idx = processors.findIndex((p) => p.id === processor.id)
        const next = {
          ...(idx >= 0 ? processors[idx] : {}),
          ...processor,
          id: processor.id.trim(),
          methods: Array.isArray(processor.methods)
            ? processor.methods
            : idx >= 0
              ? processors[idx].methods
              : [],
        } as ServiceProcessor
        if (idx >= 0) processors[idx] = next
        else processors.push(next)
        const saved = await saveServiceProcessors({
          projectPath,
          serviceId,
          layer,
          processors,
        })
        return {
          ok: true,
          result: summarize({
            serviceId,
            layer,
            processorId: next.id,
            action: idx >= 0 ? 'updated' : 'created',
            count: saved.processors.length,
          }),
        }
      }
      case 'delete_service_processor': {
        const serviceId = requireString(args, 'serviceId')
        const layer = requireLayer(args)
        const processorId = requireString(args, 'processorId')
        const res = await getServiceProcessors(projectPath, serviceId, layer)
        const processors = res.processors.filter((p) => p.id !== processorId)
        if (processors.length === res.processors.length) {
          throw new Error(`未找到处理器：${processorId}`)
        }
        const saved = await saveServiceProcessors({
          projectPath,
          serviceId,
          layer,
          processors,
        })
        return {
          ok: true,
          result: summarize({
            serviceId,
            layer,
            removed: processorId,
            count: saved.processors.length,
          }),
        }
      }
      case 'upsert_processor_method': {
        const serviceId = requireString(args, 'serviceId')
        const layer = requireLayer(args)
        const processorId = requireString(args, 'processorId')
        const method = requireObject(args, 'method') as Record<string, unknown>
        const methodId = String(method.id ?? '').trim()
        if (!methodId) throw new Error('method.id 不能为空')
        const res = await getServiceProcessors(projectPath, serviceId, layer)
        const processors = res.processors.map((p) => ({
          ...p,
          methods: [...(p.methods ?? [])],
        }))
        const processor = processors.find((p) => p.id === processorId)
        if (!processor) throw new Error(`未找到处理器：${processorId}`)
        const idx = processor.methods.findIndex((m) => m.id === methodId)
        const next = {
          ...(idx >= 0 ? processor.methods[idx] : {}),
          ...method,
          id: methodId,
        } as ServiceProcessor['methods'][number]
        if (idx >= 0) processor.methods[idx] = next
        else processor.methods.push(next)
        const saved = await saveServiceProcessors({
          projectPath,
          serviceId,
          layer,
          processors,
        })
        return {
          ok: true,
          result: summarize({
            serviceId,
            layer,
            processorId,
            methodId,
            action: idx >= 0 ? 'updated' : 'created',
            methodCount: saved.processors.find((p) => p.id === processorId)?.methods
              .length,
          }),
        }
      }
      case 'delete_processor_method': {
        const serviceId = requireString(args, 'serviceId')
        const layer = requireLayer(args)
        const processorId = requireString(args, 'processorId')
        const methodId = requireString(args, 'methodId')
        const res = await getServiceProcessors(projectPath, serviceId, layer)
        const processors = res.processors.map((p) => ({
          ...p,
          methods: [...(p.methods ?? [])],
        }))
        const processor = processors.find((p) => p.id === processorId)
        if (!processor) throw new Error(`未找到处理器：${processorId}`)
        const before = processor.methods.length
        processor.methods = processor.methods.filter((m) => m.id !== methodId)
        if (processor.methods.length === before) {
          throw new Error(`未找到方法：${methodId}`)
        }
        const saved = await saveServiceProcessors({
          projectPath,
          serviceId,
          layer,
          processors,
        })
        return {
          ok: true,
          result: summarize({
            serviceId,
            layer,
            processorId,
            removed: methodId,
            methodCount: saved.processors.find((p) => p.id === processorId)?.methods
              .length,
          }),
        }
      }
      case 'debug_data_layer_method': {
        const serviceId = requireString(args, 'serviceId')
        const processorId = requireString(args, 'processorId')
        const methodId = requireString(args, 'methodId')
        const params =
          args.params && typeof args.params === 'object' && !Array.isArray(args.params)
            ? (args.params as Record<string, unknown>)
            : {}
        const res = await debugDataMethodForAi({
          projectPath,
          serviceId,
          processorId,
          methodId,
          params,
          dryRun: args.dryRun !== false,
        })
        if (!res.passed) {
          return { ok: false, error: res.error || '数据层调试失败' }
        }
        return { ok: true, result: summarize(res) }
      }
      case 'debug_business_method': {
        const serviceId = requireString(args, 'serviceId')
        const processorId = requireString(args, 'processorId')
        const methodId = requireString(args, 'methodId')
        const params =
          args.params && typeof args.params === 'object' && !Array.isArray(args.params)
            ? (args.params as Record<string, unknown>)
            : {}
        const headers =
          args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)
            ? (args.headers as Record<string, unknown>)
            : undefined
        const res = await debugBusinessMethodForAi({
          projectPath,
          serviceId,
          processorId,
          methodId,
          params,
          headers,
          dryRun: args.dryRun !== false,
        })
        if (!res.passed) {
          return { ok: false, error: res.error || '业务层调试失败' }
        }
        return { ok: true, result: summarize(res) }
      }
      case 'debug_controller_api': {
        const serviceId = requireString(args, 'serviceId')
        const controllerId = requireString(args, 'controllerId')
        const apiId = requireString(args, 'apiId')
        const params =
          args.params && typeof args.params === 'object' && !Array.isArray(args.params)
            ? (args.params as Record<string, unknown>)
            : {}
        const headers =
          args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)
            ? (args.headers as Record<string, unknown>)
            : undefined
        const res = await debugControllerApiForAi({
          projectPath,
          serviceId,
          controllerId,
          apiId,
          params,
          headers,
          dryRun: args.dryRun !== false,
        })
        if (!res.passed) {
          return { ok: false, error: res.error || '控制器调试失败' }
        }
        return { ok: true, result: summarize(res) }
      }
      case 'run_backend_tests': {
        const rawCases = args.cases
        if (!Array.isArray(rawCases) || !rawCases.length) {
          throw new Error('cases 必须是非空数组')
        }
        const cases: BackendTestCase[] = rawCases.map((item, index) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`cases[${index}] 必须是对象`)
          }
          const row = item as Record<string, unknown>
          const layer = String(row.layer ?? '').trim()
          if (layer !== 'data' && layer !== 'business' && layer !== 'controller') {
            throw new Error(`cases[${index}].layer 必须是 data/business/controller`)
          }
          return {
            name: String(row.name ?? `case_${index + 1}`).trim() || `case_${index + 1}`,
            layer,
            serviceId: String(row.serviceId ?? '').trim(),
            targetId: String(row.targetId ?? '').trim(),
            methodId: String(row.methodId ?? '').trim(),
            params:
              row.params && typeof row.params === 'object' && !Array.isArray(row.params)
                ? (row.params as Record<string, unknown>)
                : {},
            headers:
              row.headers && typeof row.headers === 'object' && !Array.isArray(row.headers)
                ? (row.headers as Record<string, unknown>)
                : undefined,
            dryRun: row.dryRun !== false,
            expect:
              row.expect && typeof row.expect === 'object' && !Array.isArray(row.expect)
                ? (row.expect as BackendTestCase['expect'])
                : { ok: true },
          }
        })
        for (const [index, c] of cases.entries()) {
          if (!c.serviceId || !c.targetId || !c.methodId) {
            throw new Error(
              `cases[${index}] 缺少 serviceId/targetId/methodId`,
            )
          }
        }
        const suite = await runBackendTestSuite({ projectPath, cases })
        return {
          ok: true,
          result: summarize({
            passed: suite.passed,
            total: suite.total,
            passedCount: suite.passedCount,
            failedCount: suite.failedCount,
            results: suite.results,
            message: suite.passed
              ? '全部测试通过，可以 finish'
              : '存在失败用例，请修复后重新 run_backend_tests',
          }),
        }
      }
      default:
        return null
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '操作失败',
    }
  }
}
