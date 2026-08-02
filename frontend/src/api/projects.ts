import { request } from './index'
import type { IconDefinition, IconLibrary } from '../types/icon-library'
import type { ColorPalette, PaletteColor } from '../types/color-palette'
import type { DataTypeGroup, DataTypeLibrary } from '../types/data-types'
import type {
  MysqlColumnDef,
  MysqlConnectionPayload,
  MysqlDatabaseConfig,
  MysqlLibrary,
  MysqlTableDef,
} from '../types/mysql'
import type {
  OssBucketInfo,
  OssConnectionConfig,
  OssConnectionPayload,
  OssLibrary,
  OssObjectInfo,
} from '../types/oss'
import type {
  BackendService,
  BackendServiceLibrary,
  ProcessorLayerKind,
  ServiceController,
  ServiceProcessor,
} from '../types/backend-services'

export type { IconDefinition, IconLibrary }
export type { ColorPalette, PaletteColor }
export type { DataTypeGroup, DataTypeLibrary }
export type { MysqlDatabaseConfig, MysqlLibrary, MysqlColumnDef, MysqlTableDef }
export type { OssBucketInfo, OssConnectionConfig, OssLibrary, OssObjectInfo }
export type {
  BackendService,
  BackendServiceLibrary,
  ProcessorLayerKind,
  ServiceController,
  ServiceProcessor,
}

export interface LubanProjectConfig {
  name: string
  version: string
  author: string
  engineVersion: string
  canvas: {
    width: number
    /** 预览场景：H5 / 微信小程序 */
    scene?: 'h5' | 'miniprogram'
  }
  /** 入口页面 id */
  entryPage?: string
  /** 微信小程序 AppID */
  wechatAppId?: string
  /** 导出前端 API 根地址字典 */
  apiBaseUrls?: Record<string, string>
  /** @deprecated 请用 apiBaseUrls.default */
  wechatApiBaseUrl?: string
}

export interface ProjectResult {
  path: string
  config: LubanProjectConfig
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

export function getColorPalette(projectPath: string) {
  return request<ColorPalette>(
    `/api/projects/palette?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveColorPalette(payload: {
  projectPath: string
  colors: PaletteColor[]
}) {
  return request<ColorPalette>('/api/projects/palette', {
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

export function getOssLibrary(projectPath: string) {
  return request<OssLibrary>(
    `/api/projects/oss?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveOssLibrary(payload: {
  projectPath: string
  connections: OssConnectionConfig[]
}) {
  return request<OssLibrary>('/api/projects/oss', {
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

function mysqlTableRequest<T>(path: string, payload: object) {
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
  payload: MysqlConnectionPayload & { tableName: string; projectPath?: string },
) {
  return mysqlTableRequest<{
    columns: MysqlColumnDef[]
    indexes: import('../types/mysql').MysqlIndexDef[]
    conflict: boolean
    local: MysqlColumnDef[] | null
    remote: MysqlColumnDef[]
    localRemark: string
    remoteRemark: string
  }>('/api/projects/mysql/tables/columns', payload)
}

/** 仅读本地 mysql/{table}.json */
export function getMysqlLocalTableSchema(payload: {
  projectPath: string
  tableName: string
}) {
  return mysqlTableRequest<{
    columns: MysqlColumnDef[]
    indexes: import('../types/mysql').MysqlIndexDef[]
    remark: string
    name: string
    syncedAt: number | null
  }>('/api/projects/mysql/tables/schema/local', payload)
}

export function resolveMysqlTableSchema(
  payload: MysqlConnectionPayload & {
    tableName: string
    projectPath: string
    adopt: 'local' | 'remote'
  },
) {
  return mysqlTableRequest<{
    columns: MysqlColumnDef[]
    indexes: import('../types/mysql').MysqlIndexDef[]
    conflict: boolean
    local: MysqlColumnDef[] | null
    remote: MysqlColumnDef[]
    localRemark: string
    remoteRemark: string
  }>('/api/projects/mysql/tables/schema/resolve', payload)
}

export function createMysqlTable(
  payload: MysqlConnectionPayload & {
    table: MysqlTableDef
    projectPath?: string
  },
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
    projectPath?: string
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
    indexes?: import('../types/mysql').MysqlIndexDef[]
    projectPath?: string
    remark?: string
  },
) {
  return mysqlTableRequest<{ tables: MysqlLibrary['databases'][number]['tables'] }>(
    '/api/projects/mysql/tables/design',
    payload,
  )
}

export function dropMysqlTable(
  payload: MysqlConnectionPayload & {
    tableName: string
    projectPath?: string
  },
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
    projectPath?: string
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
    conflict: boolean
    local: MysqlColumnDef[] | null
    remote: MysqlColumnDef[]
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

export function testOssConnection(payload: OssConnectionPayload) {
  return request<{
    ok: true
    message: string
    buckets: OssBucketInfo[]
  }>('/api/projects/oss/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

function ossRequest<T>(path: string, payload: object) {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listOssBuckets(payload: OssConnectionPayload) {
  return ossRequest<{ buckets: OssBucketInfo[] }>('/api/projects/oss/buckets/list', payload)
}

export function createOssBucket(
  payload: OssConnectionPayload & { bucketName: string },
) {
  return ossRequest<{ buckets: OssBucketInfo[] }>(
    '/api/projects/oss/buckets/create',
    payload,
  )
}

export function deleteOssBucket(
  payload: OssConnectionPayload & { bucketName: string },
) {
  return ossRequest<{ buckets: OssBucketInfo[] }>(
    '/api/projects/oss/buckets/delete',
    payload,
  )
}

export function setOssBucketAccess(
  payload: OssConnectionPayload & {
    bucketName: string
    access: 'public' | 'private'
  },
) {
  return ossRequest<{ ok: true; access: 'public' | 'private' }>(
    '/api/projects/oss/buckets/set-access',
    payload,
  )
}

export function listOssObjects(
  payload: OssConnectionPayload & {
    bucketName: string
    prefix?: string
    continuationToken?: string
    maxKeys?: number
  },
) {
  return ossRequest<{
    objects: OssObjectInfo[]
    prefixes: OssObjectInfo[]
    prefix: string
    isTruncated: boolean
    nextContinuationToken: string | null
  }>('/api/projects/oss/objects/list', payload)
}

export function uploadOssObject(
  payload: OssConnectionPayload & {
    bucketName: string
    key: string
    contentBase64: string
    contentType?: string
  },
) {
  return ossRequest<{ ok: true; key: string; size: number }>(
    '/api/projects/oss/objects/upload',
    payload,
  )
}

export function deleteOssObject(
  payload: OssConnectionPayload & {
    bucketName: string
    key: string
  },
) {
  return ossRequest<{ ok: true }>('/api/projects/oss/objects/delete', payload)
}

export function getOssObjectMeta(
  payload: OssConnectionPayload & {
    bucketName: string
    key: string
  },
) {
  return ossRequest<{
    key: string
    size: number
    contentType: string
    lastModified: string | null
    etag: string
    publicUrl: string
    signedUrl: string
    isImage: boolean
  }>('/api/projects/oss/objects/meta', payload)
}

export function signOssObject(
  payload: OssConnectionPayload & {
    bucketName: string
    key: string
    expiresIn?: number
  },
) {
  return ossRequest<{
    signedUrl: string
    publicUrl: string
    expiresIn: number
  }>('/api/projects/oss/objects/sign', payload)
}

export function signOssObjectByProject(payload: {
  projectPath: string
  connectionId: string
  bucketName: string
  key: string
  expiresIn?: number
}) {
  return ossRequest<{
    signedUrl: string
    publicUrl: string
    expiresIn: number
  }>('/api/projects/oss/objects/sign', payload)
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
  canvasScene?: 'h5' | 'miniprogram' | null
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

export function exportProjectMpWx(projectPath: string) {
  return request<{
    outputPath: string
    pages: number
    components: number
  }>('/api/projects/export/mp-wx', {
    method: 'POST',
    body: JSON.stringify({ projectPath }),
  })
}

export function exportProjectNestJs(projectPath: string) {
  return request<{
    outputPath: string
    services: number
    routes: number
  }>('/api/projects/export/nestjs', {
    method: 'POST',
    body: JSON.stringify({ projectPath }),
  })
}

/** @deprecated */
export const exportProjectNextJs = exportProjectNestJs

export type BuildFrontendType = 'vue3' | 'mp-wx'
export type BuildBackendType = 'nestjs'

export interface BuildBackendService {
  name: string
  type: BuildBackendType
  port: number
  moduleIds: string[]
  /** 是否在本服务挂载 OSS 模块（/oss/sign） */
  includeOss?: boolean
}

export interface BuildFrontendApp {
  name: string
  type: BuildFrontendType
  port?: number
  wechatAppId?: string
  pageIds: string[]
  /** 入口页面 id（须属于 pageIds） */
  entryPage?: string
}

export interface BuildScheme {
  id: string
  name: string
  description: string
  backends: BuildBackendService[]
  frontends: BuildFrontendApp[]
}

export interface BuildSchemeLibrary {
  schemes: BuildScheme[]
}

export function getBuildSchemes(projectPath: string) {
  return request<BuildSchemeLibrary>(
    `/api/projects/build-schemes?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveBuildSchemes(payload: {
  projectPath: string
  library: BuildSchemeLibrary
}) {
  return request<BuildSchemeLibrary>('/api/projects/build-schemes', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function buildProject(payload: {
  projectPath: string
  schemeName: string
  /** 传入则只构建这些后端（可与 frontendNames 组合做部分构建） */
  backendNames?: string[]
  /** 传入则只构建这些前端 */
  frontendNames?: string[]
}) {
  return request<{
    schemeName: string
    outputRoot: string
    backends: Array<{ name: string; outputPath: string; routes: number }>
    frontends: Array<{ name: string; type: string; outputPath: string }>
  }>('/api/projects/build', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
