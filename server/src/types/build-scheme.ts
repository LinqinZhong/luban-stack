/** 项目级构建方案（build.json） */

export const BUILD_FILE = 'build.json'

/** 构建名 / 服务名 / 应用名：字母开头，允许数字、_、- */
export function isValidBuildName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(name)
}

export type BuildFrontendType = 'vue3' | 'mp-wx'
export type BuildBackendType = 'nestjs'

export interface BuildBackendService {
  /** 输出目录名，如 service1 */
  name: string
  /** 后端框架 */
  type: BuildBackendType
  /** Nest 监听端口 */
  port: number
  /** 绑定的模块 id（services/<id>） */
  moduleIds: string[]
  /**
   * 是否在本服务挂载 OSS 模块（POST /oss/sign）。
   * 同一构建方案建议只开启一个；未配置时构建期默认落在第一个后端。
   */
  includeOss?: boolean
}

export interface BuildFrontendApp {
  /** 输出目录名，如 app1 */
  name: string
  type: BuildFrontendType
  /** H5（vue3）开发端口 */
  port?: number
  /** 微信小程序 AppID */
  wechatAppId?: string
  /** 包含的页面 id */
  pageIds: string[]
  /** 入口页面 id（须属于 pageIds） */
  entryPage?: string
}

export interface BuildScheme {
  id: string
  /** 输出根目录名 output/<name>/ */
  name: string
  description: string
  backends: BuildBackendService[]
  frontends: BuildFrontendApp[]
}

export interface BuildSchemeLibrary {
  schemes: BuildScheme[]
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyBuildScheme(name = 'build1'): BuildScheme {
  const safe = isValidBuildName(name) ? name : 'build1'
  return {
    id: uid('bld'),
    name: safe,
    description: '',
    backends: [],
    frontends: [],
  }
}

export function createEmptyBuildSchemeLibrary(): BuildSchemeLibrary {
  return { schemes: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const t = item.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export function normalizeBuildBackend(
  input: unknown,
): BuildBackendService | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!isValidBuildName(name)) return null
  const type = input.type === 'nestjs' || input.type == null ? 'nestjs' : null
  if (!type) return null
  const port = Number(input.port)
  return {
    name,
    type,
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 3030,
    moduleIds: normalizeStringArray(input.moduleIds),
    includeOss: input.includeOss === true,
  }
}

export function normalizeBuildFrontend(
  input: unknown,
): BuildFrontendApp | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!isValidBuildName(name)) return null
  const type = input.type === 'mp-wx' || input.type === 'vue3' ? input.type : null
  if (!type) return null
  const pageIds = normalizeStringArray(input.pageIds)
  const rawEntry =
    typeof input.entryPage === 'string' ? input.entryPage.trim() : ''
  const entryPage =
    rawEntry && pageIds.includes(rawEntry) ? rawEntry : pageIds[0]
  const app: BuildFrontendApp = { name, type, pageIds }
  if (entryPage) app.entryPage = entryPage
  if (type === 'vue3') {
    const port = Number(input.port)
    app.port = Number.isFinite(port) && port > 0 ? Math.floor(port) : 5173
  }
  if (type === 'mp-wx') {
    app.wechatAppId =
      typeof input.wechatAppId === 'string' ? input.wechatAppId.trim() : ''
  }
  return app
}

export function normalizeBuildScheme(input: unknown): BuildScheme | null {
  if (!isPlainObject(input)) return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!isValidBuildName(name)) return null
  const id =
    typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : uid('bld')
  const description =
    typeof input.description === 'string' ? input.description : ''
  const backends = Array.isArray(input.backends)
    ? input.backends
        .map((b) => normalizeBuildBackend(b))
        .filter((b): b is BuildBackendService => Boolean(b))
    : []
  const frontends = Array.isArray(input.frontends)
    ? input.frontends
        .map((f) => normalizeBuildFrontend(f))
        .filter((f): f is BuildFrontendApp => Boolean(f))
    : []
  return { id, name, description, backends, frontends }
}

export function normalizeBuildSchemeLibrary(
  input: unknown,
): BuildSchemeLibrary {
  if (!isPlainObject(input) || !Array.isArray(input.schemes)) {
    return createEmptyBuildSchemeLibrary()
  }
  return {
    schemes: input.schemes
      .map((s) => normalizeBuildScheme(s))
      .filter((s): s is BuildScheme => Boolean(s)),
  }
}

export type BuildSchemeValidationIssue = {
  path: string
  message: string
}

/**
 * 校验方案：命名唯一、模块全覆盖且互斥、前端类型字段完整。
 * @param allModuleIds 项目中全部模块 id
 */
export function validateBuildScheme(
  scheme: BuildScheme,
  allModuleIds: string[],
): BuildSchemeValidationIssue[] {
  const issues: BuildSchemeValidationIssue[] = []
  if (!isValidBuildName(scheme.name)) {
    issues.push({
      path: 'name',
      message: '构建名称须以字母开头，仅含字母、数字、_、-',
    })
  }

  const backendNames = new Set<string>()
  const claimedModules = new Map<string, string>()
  for (let i = 0; i < scheme.backends.length; i++) {
    const b = scheme.backends[i]!
    if (!isValidBuildName(b.name)) {
      issues.push({
        path: `backends[${i}].name`,
        message: '服务名称须以字母开头，仅含字母、数字、_、-',
      })
    }
    if (b.type !== 'nestjs') {
      issues.push({
        path: `backends[${i}].type`,
        message: '暂不支持的后端框架',
      })
    }
    if (backendNames.has(b.name)) {
      issues.push({
        path: `backends[${i}].name`,
        message: `后端服务名重复：${b.name}`,
      })
    }
    backendNames.add(b.name)
    if (!(b.port > 0 && b.port <= 65535)) {
      issues.push({
        path: `backends[${i}].port`,
        message: '端口无效',
      })
    }
    if (!b.moduleIds.length) {
      issues.push({
        path: `backends[${i}].moduleIds`,
        message: '至少勾选一个模块',
      })
    }
    for (const mid of b.moduleIds) {
      if (!allModuleIds.includes(mid)) {
        issues.push({
          path: `backends[${i}].moduleIds`,
          message: `未知模块：${mid}`,
        })
        continue
      }
      const prev = claimedModules.get(mid)
      if (prev) {
        issues.push({
          path: `backends[${i}].moduleIds`,
          message: `模块 ${mid} 已被服务 ${prev} 勾选`,
        })
      } else {
        claimedModules.set(mid, b.name)
      }
    }
  }

  const ossHosts = scheme.backends.filter((b) => b.includeOss)
  if (ossHosts.length > 1) {
    issues.push({
      path: 'backends',
      message: `OSS 模块只能挂在一个后端服务上，当前：${ossHosts.map((b) => b.name).join('、')}`,
    })
  }

  for (const mid of allModuleIds) {
    if (!claimedModules.has(mid)) {
      issues.push({
        path: 'backends',
        message: `模块 ${mid} 未被任何后端服务勾选`,
      })
    }
  }

  if (allModuleIds.length > 0 && scheme.backends.length === 0) {
    issues.push({
      path: 'backends',
      message: '至少添加一个后端服务以覆盖全部模块',
    })
  }

  const frontendNames = new Set<string>()
  for (let i = 0; i < scheme.frontends.length; i++) {
    const f = scheme.frontends[i]!
    if (!isValidBuildName(f.name)) {
      issues.push({
        path: `frontends[${i}].name`,
        message: '应用名称须以字母开头，仅含字母、数字、_、-',
      })
    }
    if (frontendNames.has(f.name)) {
      issues.push({
        path: `frontends[${i}].name`,
        message: `前端应用名重复：${f.name}`,
      })
    }
    frontendNames.add(f.name)
    if (!f.pageIds.length) {
      issues.push({
        path: `frontends[${i}].pageIds`,
        message: '至少选择一个页面',
      })
    }
    if (f.pageIds.length) {
      const entry = f.entryPage?.trim()
      if (!entry) {
        issues.push({
          path: `frontends[${i}].entryPage`,
          message: '请选择入口页',
        })
      } else if (!f.pageIds.includes(entry)) {
        issues.push({
          path: `frontends[${i}].entryPage`,
          message: '入口页须属于已选页面',
        })
      }
    }
    if (f.type === 'vue3') {
      const port = Number(f.port)
      if (!(port > 0 && port <= 65535)) {
        issues.push({
          path: `frontends[${i}].port`,
          message: 'H5 应用须配置有效端口',
        })
      }
    }
    if (f.type === 'mp-wx') {
      if (!f.wechatAppId?.trim()) {
        issues.push({
          path: `frontends[${i}].wechatAppId`,
          message: '微信小程序须配置 AppID',
        })
      }
    }
  }

  return issues
}

/**
 * 解析 OSS 应挂在哪个后端：显式 includeOss，否则默认第一个。
 */
export function resolveOssBackendIndex(
  backends: BuildBackendService[],
): number {
  if (!backends.length) return -1
  const explicit = backends.findIndex((b) => b.includeOss === true)
  if (explicit >= 0) return explicit
  return 0
}

export function backendShouldIncludeOss(
  backends: BuildBackendService[],
  index: number,
): boolean {
  return resolveOssBackendIndex(backends) === index
}
