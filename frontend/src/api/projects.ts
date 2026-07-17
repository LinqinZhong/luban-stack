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

export type { IconDefinition, IconLibrary }
export type { DataTypeGroup, DataTypeLibrary }
export type { MysqlDatabaseConfig, MysqlLibrary, MysqlColumnDef, MysqlTableDef }

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

export function setProjectEntryPage(payload: {
  projectPath: string
  pageId: string | null
}) {
  return request<ProjectResult>('/api/projects/entry', {
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
