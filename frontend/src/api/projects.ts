import { request } from './index'
import type { IconDefinition, IconLibrary } from '../types/icon-library'
import type { DataTypeGroup, DataTypeLibrary } from '../types/data-types'
import type {
  MysqlColumnDef,
  MysqlConnectionPayload,
  MysqlDatabaseConfig,
  MysqlLibrary,
  MysqlTableDef,
} from '../types/mysql'
import type {
  BackendService,
  BackendServiceLibrary,
  ProcessorLayerKind,
  ServiceController,
  ServiceProcessor,
} from '../types/backend-services'

export type { IconDefinition, IconLibrary }
export type { DataTypeGroup, DataTypeLibrary }
export type { MysqlDatabaseConfig, MysqlLibrary, MysqlColumnDef, MysqlTableDef }
export type {
  BackendService,
  BackendServiceLibrary,
  ProcessorLayerKind,
  ServiceController,
  ServiceProcessor,
}

export interface VoiderProjectConfig {
  name: string
  version: string
  author: string
  engineVersion: string
  canvas: {
    width: number
  }
  /** 入口页面 id */
  entryPage?: string
  /** 微信小程序 AppID */
  wechatAppId?: string
}

export interface ProjectResult {
  path: string
  config: VoiderProjectConfig
}

export interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface BrowseResult {
  path: string
  parent: string | null
  entries: BrowseEntry[]
}

export interface ProjectMeta {
  engineVersion: string
  defaultCanvasWidth: number
  configFile: string
}

export interface CreateProjectPayload {
  path: string
  name: string
  author?: string
  version?: string
  engineVersion?: string
  canvasWidth?: number
}

export function getProjectMeta() {
  return request<ProjectMeta>('/api/projects/meta')
}

export function browseProjectDirectory(dirPath?: string) {
  const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''
  return request<BrowseResult>(`/api/projects/browse${query}`)
}

export function openProject(projectPath: string) {
  return request<ProjectResult>('/api/projects/open', {
    method: 'POST',
    body: JSON.stringify({ path: projectPath }),
  })
}

export function createProject(payload: CreateProjectPayload) {
  return request<ProjectResult>('/api/projects/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getIconLibrary(projectPath: string) {
  return request<IconLibrary>(
    `/api/projects/icons?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveIconLibrary(payload: {
  projectPath: string
  icons: IconDefinition[]
}) {
  return request<IconLibrary>('/api/projects/icons', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getDataTypeLibrary(projectPath: string) {
  return request<DataTypeLibrary>(
    `/api/projects/types?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveDataTypeLibrary(payload: {
  projectPath: string
  groups: DataTypeGroup[]
}) {
  return request<DataTypeLibrary>('/api/projects/types', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getMysqlLibrary(projectPath: string) {
  return request<MysqlLibrary>(
    `/api/projects/mysql?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveMysqlLibrary(payload: {
  projectPath: string
  databases: MysqlDatabaseConfig[]
}) {
  return request<MysqlLibrary>('/api/projects/mysql', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getBackendServiceLibrary(projectPath: string) {
  return request<BackendServiceLibrary>(
    `/api/projects/services?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveBackendServiceLibrary(payload: {
  projectPath: string
  services: BackendService[]
}) {
  return request<BackendServiceLibrary>('/api/projects/services', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getServiceControllers(projectPath: string, serviceId: string) {
  return request<{ controllers: ServiceController[] }>(
    `/api/projects/services/controllers?projectPath=${encodeURIComponent(projectPath)}&serviceId=${encodeURIComponent(serviceId)}`,
  )
}

export function saveServiceControllers(payload: {
  projectPath: string
  serviceId: string
  controllers: ServiceController[]
}) {
  return request<{ controllers: ServiceController[] }>(
    '/api/projects/services/controllers',
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
}

export function getServiceProcessors(
  projectPath: string,
  serviceId: string,
  layer: ProcessorLayerKind,
) {
  return request<{ processors: ServiceProcessor[] }>(
    `/api/projects/services/processors?projectPath=${encodeURIComponent(projectPath)}&serviceId=${encodeURIComponent(serviceId)}&layer=${encodeURIComponent(layer)}`,
  )
}

export function saveServiceProcessors(payload: {
  projectPath: string
  serviceId: string
  layer: ProcessorLayerKind
  processors: ServiceProcessor[]
}) {
  return request<{ processors: ServiceProcessor[] }>(
    '/api/projects/services/processors',
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
}

export function debugDataLayerMethod(payload: {
  projectPath: string
  serviceId: string
  processorId: string
  methodId: string
  params: Record<string, unknown>
  /** 默认 true：写入在事务中执行后回滚 */
  dryRun?: boolean
}) {
  return request<{
    sql: string
    raw: unknown
    output: unknown
    dryRun?: boolean
  }>('/api/projects/services/processors/debug', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function testMysqlConnection(payload: MysqlConnectionPayload) {
  return request<{
    ok: true
    message: string
    tables: MysqlLibrary['databases'][number]['tables']
    serverVersion: string
  }>('/api/projects/mysql/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listMysqlDatabases(payload: {
  host: string
  port: number
  username: string
  password: string
  database?: string
}) {
  return request<{ databases: string[] }>('/api/projects/mysql/databases', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      database: payload.database ?? '',
      ssh: {
        enabled: false,
        host: '',
        port: 22,
        username: '',
        authType: 'password',
        password: '',
        privateKey: '',
        passphrase: '',
      },
    }),
  })
}

function mysqlTableRequest<T>(path: string, payload: Record<string, unknown>) {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listMysqlTables(payload: MysqlConnectionPayload) {
  return mysqlTableRequest<{ tables: MysqlLibrary['databases'][number]['tables'] }>(
    '/api/projects/mysql/tables/list',
    payload,
  )
}

export function getMysqlTableColumns(
  payload: MysqlConnectionPayload & { tableName: string },
) {
  return mysqlTableRequest<{ columns: MysqlColumnDef[] }>(
    '/api/projects/mysql/tables/columns',
    payload,
  )
}

export function createMysqlTable(
  payload: MysqlConnectionPayload & { table: MysqlTableDef },
) {
  return mysqlTableRequest<{ tables: MysqlLibrary['databases'][number]['tables'] }>(
    '/api/projects/mysql/tables/create',
    payload,
  )
}

export function updateMysqlTableMeta(
  payload: MysqlConnectionPayload & {
    tableName: string
    name: string
    remark: string
  },
) {
  return mysqlTableRequest<{ tables: MysqlLibrary['databases'][number]['tables'] }>(
    '/api/projects/mysql/tables/update',
    payload,
  )
}

export function designMysqlTable(
  payload: MysqlConnectionPayload & {
    tableName: string
    columns: MysqlColumnDef[]
  },
) {
  return mysqlTableRequest<{ tables: MysqlLibrary['databases'][number]['tables'] }>(
    '/api/projects/mysql/tables/design',
    payload,
  )
}

export function dropMysqlTable(
  payload: MysqlConnectionPayload & { tableName: string },
) {
  return mysqlTableRequest<{ tables: MysqlLibrary['databases'][number]['tables'] }>(
    '/api/projects/mysql/tables/drop',
    payload,
  )
}

export function truncateMysqlTable(
  payload: MysqlConnectionPayload & { tableName: string },
) {
  return mysqlTableRequest<{ tables: MysqlLibrary['databases'][number]['tables'] }>(
    '/api/projects/mysql/tables/truncate',
    payload,
  )
}

export function listMysqlTableRows(
  payload: MysqlConnectionPayload & {
    tableName: string
    current?: number
    pageSize?: number
  },
) {
  return mysqlTableRequest<{
    columns: MysqlColumnDef[]
    keyColumns: string[]
    keyName: string | null
    rows: Record<string, unknown>[]
    total: number
    current: number
    pageSize: number
  }>('/api/projects/mysql/tables/rows', payload)
}

export function updateMysqlTableRow(
  payload: MysqlConnectionPayload & {
    tableName: string
    key: Record<string, unknown>
    values: Record<string, unknown>
  },
) {
  return mysqlTableRequest<{ ok: boolean }>(
    '/api/projects/mysql/tables/rows/update',
    payload,
  )
}

export function deleteMysqlTableRow(
  payload: MysqlConnectionPayload & {
    tableName: string
    key: Record<string, unknown>
  },
) {
  return mysqlTableRequest<{ ok: boolean }>(
    '/api/projects/mysql/tables/rows/delete',
    payload,
  )
}

export function insertMysqlTableRow(
  payload: MysqlConnectionPayload & {
    tableName: string
    values: Record<string, unknown>
  },
) {
  return mysqlTableRequest<{ ok: boolean }>(
    '/api/projects/mysql/tables/rows/insert',
    payload,
  )
}

export function setProjectEntryPage(payload: {
  projectPath: string
  pageId: string | null
}) {
  return request<ProjectResult>('/api/projects/entry', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function patchProjectConfig(payload: {
  projectPath: string
  wechatAppId?: string | null
}) {
  return request<ProjectResult>('/api/projects/config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function exportProjectVue3(projectPath: string) {
  return request<{
    outputPath: string
    pages: number
    components: number
  }>('/api/projects/export/vue3', {
    method: 'POST',
    body: JSON.stringify({ projectPath }),
  })
}
