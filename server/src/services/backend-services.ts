import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  CONTROLLER_CONFIG_FILE,
  CONTROLLERS_DIR,
  createEmptyBackendServiceLibrary,
  isProcessorUuid,
  isValidControllerId,
  isValidControllerName,
  isValidProcessorId,
  isValidProcessorName,
  isValidServiceId,
  newProcessorId,
  normalizeBackendService,
  normalizeBackendServiceLibrary,
  normalizeServiceController,
  normalizeServiceProcessor,
  PROCESSOR_CONFIG_FILE,
  processorLayerDirName,
  serializeControllerConfig,
  serializeProcessorConfig,
  serializeServiceConfig,
  SERVICE_CONFIG_FILE,
  SERVICES_DIR,
  SERVICES_LEGACY_FILE,
  toPascalCaseProcessorName,
  type BackendService,
  type BackendServiceLibrary,
  type ProcessorLayerKind,
  type ServiceController,
  type ServiceProcessor,
} from '../types/backend-services.js'
import { ProjectError } from './project.js'

function servicesRoot(projectPath: string): string {
  return path.join(projectPath, SERVICES_DIR)
}

function serviceDir(projectPath: string, serviceId: string): string {
  return path.join(servicesRoot(projectPath), serviceId)
}

function legacyServicesFile(projectPath: string): string {
  return path.join(projectPath, SERVICES_LEGACY_FILE)
}

async function ensureServicesDir(projectPath: string): Promise<string> {
  const root = servicesRoot(projectPath)
  await mkdir(root, { recursive: true })
  return root
}

async function writeServiceConfig(
  projectPath: string,
  service: BackendService,
): Promise<void> {
  if (!isValidServiceId(service.id)) {
    throw new ProjectError(`服务 ID 不合法：${service.id}`, 400)
  }
  const dir = serviceDir(projectPath, service.id)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, SERVICE_CONFIG_FILE)
  try {
    await writeFile(
      filePath,
      `${JSON.stringify(serializeServiceConfig(service), null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(`无法写入 ${SERVICES_DIR}/${service.id}/${SERVICE_CONFIG_FILE}`, 500)
  }
}

async function readServiceFromDir(
  dir: string,
  folderId: string,
): Promise<BackendService | null> {
  const configPath = path.join(dir, SERVICE_CONFIG_FILE)
  try {
    await access(configPath, constants.R_OK)
    const raw = await readFile(configPath, 'utf-8')
    return normalizeBackendService(JSON.parse(raw), folderId)
  } catch {
    return null
  }
}

/** 旧版 services.json → services/<id>/config.json */
async function migrateLegacyServicesFile(
  projectPath: string,
): Promise<BackendServiceLibrary | null> {
  const legacyPath = legacyServicesFile(projectPath)
  try {
    await access(legacyPath, constants.R_OK)
  } catch {
    return null
  }

  let library: BackendServiceLibrary
  try {
    const raw = await readFile(legacyPath, 'utf-8')
    library = normalizeBackendServiceLibrary(JSON.parse(raw))
  } catch {
    return null
  }

  await ensureServicesDir(projectPath)
  for (const svc of library.services) {
    // 旧 id 可能是 svc_xxx，尽量保留；不合法则跳过
    if (!isValidServiceId(svc.id)) {
      const fallback = svc.name.trim()
      if (!isValidServiceId(fallback)) continue
      svc.id = fallback
    }
    await writeServiceConfig(projectPath, svc)
  }

  try {
    await rm(legacyPath, { force: true })
  } catch {
    // ignore
  }

  return library
}

export async function readBackendServiceLibrary(
  projectPath: string,
): Promise<BackendServiceLibrary> {
  await migrateLegacyServicesFile(projectPath)
  const root = await ensureServicesDir(projectPath)

  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    throw new ProjectError(`无法读取 ${SERVICES_DIR} 目录`, 500)
  }

  const services: BackendService[] = []
  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith('.') || !isValidServiceId(name)) return
      const dir = path.join(root, name)
      try {
        const info = await stat(dir)
        if (!info.isDirectory()) return
        const svc = await readServiceFromDir(dir, name)
        if (svc) {
          // 目录名为权威 id
          services.push({ ...svc, id: name })
        }
      } catch {
        // skip
      }
    }),
  )

  services.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  return { services }
}

export async function saveBackendServiceLibrary(
  projectPath: string,
  library: unknown,
): Promise<BackendServiceLibrary> {
  const normalized = normalizeBackendServiceLibrary(library)
  const ids = new Set<string>()
  const names = new Set<string>()

  for (const svc of normalized.services) {
    if (!isValidServiceId(svc.id)) {
      throw new ProjectError(
        `模块 ID 仅允许英文：字母开头，字母/数字/下划线/连字符（当前：${svc.id}）`,
        400,
      )
    }
    if (ids.has(svc.id)) {
      throw new ProjectError(`模块 ID 重复：${svc.id}`, 400)
    }
    ids.add(svc.id)
    if (names.has(svc.name)) {
      throw new ProjectError(`模块名称重复：${svc.name}`, 400)
    }
    names.add(svc.name)
  }

  const root = await ensureServicesDir(projectPath)

  // 删除已不存在的服务目录
  let existing: string[] = []
  try {
    existing = await readdir(root)
  } catch {
    existing = []
  }
  for (const name of existing) {
    if (name.startsWith('.')) continue
    const dir = path.join(root, name)
    try {
      const info = await stat(dir)
      if (!info.isDirectory()) continue
      if (!ids.has(name)) {
        await rm(dir, { recursive: true, force: true })
      }
    } catch {
      // ignore
    }
  }

  for (const svc of normalized.services) {
    await writeServiceConfig(projectPath, svc)
  }

  // 清理遗留单文件
  try {
    await rm(legacyServicesFile(projectPath), { force: true })
  } catch {
    // ignore
  }

  return readBackendServiceLibrary(projectPath)
}

export async function ensureBackendServiceLibraryFile(
  projectPath: string,
): Promise<void> {
  await ensureServicesDir(projectPath)
  // 若仍有旧文件则迁移
  await migrateLegacyServicesFile(projectPath)
}

/** 重命名服务目录（更改 id） */
export async function renameBackendServiceId(
  projectPath: string,
  fromId: string,
  toId: string,
): Promise<BackendService> {
  if (!isValidServiceId(fromId) || !isValidServiceId(toId)) {
    throw new ProjectError('服务 ID 不合法', 400)
  }
  if (fromId === toId) {
    const library = await readBackendServiceLibrary(projectPath)
    const hit = library.services.find((s) => s.id === fromId)
    if (!hit) throw new ProjectError('服务不存在', 404)
    return hit
  }

  const fromDir = serviceDir(projectPath, fromId)
  const toDir = serviceDir(projectPath, toId)
  try {
    await access(fromDir, constants.R_OK)
  } catch {
    throw new ProjectError('服务不存在', 404)
  }
  try {
    await access(toDir, constants.F_OK)
    throw new ProjectError(`服务「${toId}」已存在`, 400)
  } catch (err) {
    if (err instanceof ProjectError) throw err
  }

  try {
    await rename(fromDir, toDir)
  } catch {
    throw new ProjectError('重命名服务目录失败', 500)
  }

  const svc = await readServiceFromDir(toDir, toId)
  if (!svc) throw new ProjectError('无法读取服务配置', 500)
  const next = { ...svc, id: toId }
  await writeServiceConfig(projectPath, next)
  return next
}

// ——— 控制器 ———

function controllersRoot(projectPath: string, serviceId: string): string {
  return path.join(serviceDir(projectPath, serviceId), CONTROLLERS_DIR)
}

function controllerDir(
  projectPath: string,
  serviceId: string,
  controllerId: string,
): string {
  return path.join(controllersRoot(projectPath, serviceId), controllerId)
}

async function assertServiceExists(
  projectPath: string,
  serviceId: string,
): Promise<void> {
  if (!isValidServiceId(serviceId)) {
    throw new ProjectError('服务 ID 不合法', 400)
  }
  const dir = serviceDir(projectPath, serviceId)
  try {
    await access(dir, constants.R_OK)
  } catch {
    throw new ProjectError('服务不存在', 404)
  }
}

async function writeControllerConfig(
  projectPath: string,
  serviceId: string,
  controller: ServiceController,
): Promise<void> {
  if (!isValidControllerId(controller.id)) {
    throw new ProjectError(`控制器 ID 不合法：${controller.id}`, 400)
  }
  const dir = controllerDir(projectPath, serviceId, controller.id)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, CONTROLLER_CONFIG_FILE)
  try {
    await writeFile(
      filePath,
      `${JSON.stringify(serializeControllerConfig(controller), null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(
      `无法写入 ${SERVICES_DIR}/${serviceId}/${CONTROLLERS_DIR}/${controller.id}/${CONTROLLER_CONFIG_FILE}`,
      500,
    )
  }
}

async function readControllerFromDir(
  dir: string,
  folderId: string,
): Promise<ServiceController | null> {
  const configPath = path.join(dir, CONTROLLER_CONFIG_FILE)
  try {
    await access(configPath, constants.R_OK)
    const raw = await readFile(configPath, 'utf-8')
    return normalizeServiceController(JSON.parse(raw), folderId)
  } catch {
    return null
  }
}

export async function readServiceControllers(
  projectPath: string,
  serviceId: string,
): Promise<ServiceController[]> {
  await assertServiceExists(projectPath, serviceId)
  await migrateServiceProcessorIdentities(projectPath, serviceId)
  await migrateServiceControllerIdentities(projectPath, serviceId)
  return listServiceControllersRaw(projectPath, serviceId)
}

async function listServiceControllersRaw(
  projectPath: string,
  serviceId: string,
): Promise<ServiceController[]> {
  const root = controllersRoot(projectPath, serviceId)
  await mkdir(root, { recursive: true })

  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    throw new ProjectError(
      `无法读取 ${SERVICES_DIR}/${serviceId}/${CONTROLLERS_DIR}`,
      500,
    )
  }

  const controllers: ServiceController[] = []
  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith('.') || !isValidControllerId(name)) return
      const dir = path.join(root, name)
      try {
        const info = await stat(dir)
        if (!info.isDirectory()) return
        const ctrl = await readControllerFromDir(dir, name)
        if (ctrl) controllers.push({ ...ctrl, id: name })
      } catch {
        // skip
      }
    }),
  )

  controllers.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return controllers
}

export async function saveServiceControllers(
  projectPath: string,
  serviceId: string,
  controllersInput: unknown,
): Promise<ServiceController[]> {
  await assertServiceExists(projectPath, serviceId)
  await migrateServiceProcessorIdentities(projectPath, serviceId)
  await migrateServiceControllerIdentities(projectPath, serviceId)

  const list = Array.isArray(controllersInput) ? controllersInput : []
  const controllers: ServiceController[] = []
  const ids = new Set<string>()
  const names = new Set<string>()

  for (const item of list) {
    let ctrl = normalizeServiceController(item)
    if (!ctrl) {
      throw new ProjectError('控制器数据不合法', 400)
    }
    if (!isProcessorUuid(ctrl.id)) {
      ctrl = { ...ctrl, id: newProcessorId() }
    }
    if (!isValidControllerName(ctrl.name)) {
      const fallback = controllerNameFallback(ctrl)
      ctrl = {
        ...ctrl,
        name: uniquePascalName(ctrl.name || fallback, names, fallback),
      }
    } else {
      const nameKey = ctrl.name.trim().toLowerCase()
      if (names.has(nameKey)) {
        throw new ProjectError(`控制器名称重复：${ctrl.name}`, 400)
      }
      names.add(nameKey)
    }
    if (!isValidControllerId(ctrl.id)) {
      throw new ProjectError(`控制器 ID 不合法：${ctrl.id}`, 400)
    }
    if (ids.has(ctrl.id)) {
      throw new ProjectError(`控制器 ID 重复：${ctrl.id}`, 400)
    }
    ids.add(ctrl.id)
    controllers.push(ctrl)
  }

  const root = controllersRoot(projectPath, serviceId)
  await mkdir(root, { recursive: true })

  let existing: string[] = []
  try {
    existing = await readdir(root)
  } catch {
    existing = []
  }
  for (const name of existing) {
    if (name.startsWith('.')) continue
    const dir = path.join(root, name)
    try {
      const info = await stat(dir)
      if (!info.isDirectory()) continue
      if (!ids.has(name)) {
        await rm(dir, { recursive: true, force: true })
      }
    } catch {
      // ignore
    }
  }

  for (const ctrl of controllers) {
    await writeControllerConfig(projectPath, serviceId, ctrl)
  }

  return listServiceControllersRaw(projectPath, serviceId)
}

// ——— 业务层 / 数据层：处理器 ———

function processorsRoot(
  projectPath: string,
  serviceId: string,
  kind: ProcessorLayerKind,
): string {
  return path.join(
    serviceDir(projectPath, serviceId),
    processorLayerDirName(kind),
  )
}

function processorDir(
  projectPath: string,
  serviceId: string,
  kind: ProcessorLayerKind,
  processorId: string,
): string {
  return path.join(processorsRoot(projectPath, serviceId, kind), processorId)
}

async function writeProcessorConfig(
  projectPath: string,
  serviceId: string,
  kind: ProcessorLayerKind,
  processor: ServiceProcessor,
): Promise<void> {
  if (!isValidProcessorId(processor.id)) {
    throw new ProjectError(`处理器 ID 不合法：${processor.id}`, 400)
  }
  const dir = processorDir(projectPath, serviceId, kind, processor.id)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, PROCESSOR_CONFIG_FILE)
  const layer = processorLayerDirName(kind)
  try {
    await writeFile(
      filePath,
      `${JSON.stringify(serializeProcessorConfig(processor), null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(
      `无法写入 ${SERVICES_DIR}/${serviceId}/${layer}/${processor.id}/${PROCESSOR_CONFIG_FILE}`,
      500,
    )
  }
}

async function readProcessorFromDir(
  dir: string,
  folderId: string,
): Promise<ServiceProcessor | null> {
  const configPath = path.join(dir, PROCESSOR_CONFIG_FILE)
  try {
    await access(configPath, constants.R_OK)
    const raw = await readFile(configPath, 'utf-8')
    return normalizeServiceProcessor(JSON.parse(raw), folderId)
  } catch {
    return null
  }
}

export async function readServiceProcessors(
  projectPath: string,
  serviceId: string,
  kind: ProcessorLayerKind,
): Promise<ServiceProcessor[]> {
  await assertServiceExists(projectPath, serviceId)
  await migrateServiceProcessorIdentities(projectPath, serviceId)
  return listServiceProcessorsRaw(projectPath, serviceId, kind)
}

async function listServiceProcessorsRaw(
  projectPath: string,
  serviceId: string,
  kind: ProcessorLayerKind,
): Promise<ServiceProcessor[]> {
  const root = processorsRoot(projectPath, serviceId, kind)
  await mkdir(root, { recursive: true })

  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    throw new ProjectError(
      `无法读取 ${SERVICES_DIR}/${serviceId}/${processorLayerDirName(kind)}`,
      500,
    )
  }

  const processors: ServiceProcessor[] = []
  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith('.') || !isValidProcessorId(name)) return
      const dir = path.join(root, name)
      try {
        const info = await stat(dir)
        if (!info.isDirectory()) return
        const proc = await readProcessorFromDir(dir, name)
        if (proc) processors.push({ ...proc, id: name })
      } catch {
        // skip
      }
    }),
  )

  processors.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return processors
}

function uniquePascalName(
  base: string,
  used: Set<string>,
  fallback = 'Processor',
): string {
  let name = toPascalCaseProcessorName(base, fallback)
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase())
    return name
  }
  let i = 2
  while (used.has(`${name}${i}`.toLowerCase())) i += 1
  name = `${name}${i}`
  used.add(name.toLowerCase())
  return name
}

/** 从 path / 旧 id 推断控制器英文名 */
function controllerNameFallback(ctrl: ServiceController): string {
  const pathSeg = (ctrl.path || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')[0]
    ?.trim() || ''
  if (pathSeg && /^[A-Za-z]/.test(pathSeg)) return pathSeg
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(ctrl.id)) return ctrl.id
  return 'Controller'
}

function remapControllerIdInText(
  text: string,
  remap: Map<string, string>,
): string {
  if (!remap.size) return text
  let out = text
  for (const [oldId, newId] of remap) {
    if (oldId === newId) continue
    out = out.split(`"controllerId":"${oldId}"`).join(`"controllerId":"${newId}"`)
    out = out
      .split(`"controllerId": "${oldId}"`)
      .join(`"controllerId": "${newId}"`)
    out = out
      .split(`&quot;controllerId&quot;:&quot;${oldId}&quot;`)
      .join(`&quot;controllerId&quot;:&quot;${newId}&quot;`)
    out = out
      .split(`\\&quot;controllerId\\&quot;:\\&quot;${oldId}\\&quot;`)
      .join(`\\&quot;controllerId\\&quot;:\\&quot;${newId}\\&quot;`)
  }
  return out
}

function remapControllerIdInValue(
  value: unknown,
  remap: Map<string, string>,
): unknown {
  if (!remap.size) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
      trimmed.includes('controllerId')
    ) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        const next = remapControllerIdInValue(parsed, remap)
        return JSON.stringify(next)
      } catch {
        return remapControllerIdInText(value, remap)
      }
    }
    return remapControllerIdInText(value, remap)
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapControllerIdInValue(item, remap))
  }
  if (!value || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'controllerId' && typeof v === 'string' && remap.has(v)) {
      next[k] = remap.get(v)!
    } else {
      next[k] = remapControllerIdInValue(v, remap)
    }
  }
  return next
}

async function remapControllerIdsInProjectFiles(
  projectPath: string,
  remap: Map<string, string>,
): Promise<void> {
  if (!remap.size) return

  const walk = async (dir: string): Promise<void> => {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const full = path.join(dir, name)
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        await walk(full)
        continue
      }
      if (!info.isFile()) continue
      const lower = name.toLowerCase()
      if (
        !lower.endsWith('.json') &&
        !lower.endsWith('.xml') &&
        !lower.endsWith('.html') &&
        !lower.endsWith('.txt')
      ) {
        continue
      }
      let raw: string
      try {
        raw = await readFile(full, 'utf8')
      } catch {
        continue
      }
      if (!raw.includes('controllerId')) continue

      let next = raw
      if (lower.endsWith('.json')) {
        try {
          const parsed = JSON.parse(raw) as unknown
          const remapped = remapControllerIdInValue(parsed, remap)
          next = `${JSON.stringify(remapped, null, 2)}\n`
        } catch {
          next = remapControllerIdInText(raw, remap)
        }
      } else {
        next = remapControllerIdInText(raw, remap)
      }
      if (next !== raw) {
        await writeFile(full, next, 'utf8')
      }
    }
  }

  await walk(path.join(projectPath, 'pages'))
  await walk(path.join(projectPath, 'components'))
}

/**
 * 控制器 id → UUID，名称 → 英文大驼峰；并更新页面/组件中的 controllerId 引用
 */
async function migrateServiceControllerIdentities(
  projectPath: string,
  _serviceId: string,
): Promise<void> {
  const root = servicesRoot(projectPath)
  let serviceIds: string[] = []
  try {
    serviceIds = (await readdir(root)).filter((name) => {
      if (name.startsWith('.') || name === SERVICES_LEGACY_FILE) return false
      return isValidServiceId(name)
    })
  } catch {
    return
  }

  const globalRemap = new Map<string, string>()
  let anyNeed = false

  for (const serviceId of serviceIds) {
    const list = await listServiceControllersRaw(projectPath, serviceId)
    if (
      list.some(
        (c) => !isProcessorUuid(c.id) || !isValidControllerName(c.name),
      )
    ) {
      anyNeed = true
      break
    }
  }
  if (!anyNeed) return

  for (const serviceId of serviceIds) {
    const list = await listServiceControllersRaw(projectPath, serviceId)
    const usedNames = new Set<string>()
    const nextList: ServiceController[] = []

    for (const ctrl of list) {
      const oldId = ctrl.id
      let next: ServiceController = { ...ctrl }
      if (!isProcessorUuid(next.id)) {
        next = { ...next, id: newProcessorId() }
      }
      globalRemap.set(oldId, next.id)
      const fallback = controllerNameFallback({ ...ctrl, id: oldId })
      next = {
        ...next,
        name: uniquePascalName(next.name || fallback, usedNames, fallback),
      }
      nextList.push(next)
    }

    for (const next of nextList) {
      await writeControllerConfig(projectPath, serviceId, next)
    }
    for (const ctrl of list) {
      const newId = globalRemap.get(ctrl.id) ?? ctrl.id
      if (newId === ctrl.id) continue
      const oldDir = controllerDir(projectPath, serviceId, ctrl.id)
      try {
        await rm(oldDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }

  await remapControllerIdsInProjectFiles(projectPath, globalRemap)
}

function remapProcessorIdInValue(
  value: unknown,
  remap: Map<string, string>,
): unknown {
  if (!remap.size) return value
  if (Array.isArray(value)) {
    return value.map((item) => remapProcessorIdInValue(item, remap))
  }
  if (!value || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (
      (k === 'dataProcessorId' || k === 'dataProcessorRef') &&
      typeof v === 'string' &&
      remap.has(v)
    ) {
      next[k] = remap.get(v)!
    } else {
      next[k] = remapProcessorIdInValue(v, remap)
    }
  }
  return next
}

function remapProcessorRefs(
  processor: ServiceProcessor,
  remap: Map<string, string>,
): ServiceProcessor {
  const cloned = JSON.parse(JSON.stringify(processor)) as ServiceProcessor
  if (cloned.dataProcessorRef && remap.has(cloned.dataProcessorRef)) {
    cloned.dataProcessorRef = remap.get(cloned.dataProcessorRef)!
  }
  cloned.methods = (cloned.methods ?? []).map((m) => {
    const flow = m.flow
      ? (remapProcessorIdInValue(m.flow, remap) as typeof m.flow)
      : m.flow
    return { ...m, flow }
  })
  return cloned
}

function remapControllerRefs(
  controller: ServiceController,
  remap: Map<string, string>,
): ServiceController {
  const cloned = JSON.parse(JSON.stringify(controller)) as ServiceController
  cloned.apis = (cloned.apis ?? []).map((api) => {
    const flow = api.flow
      ? (remapProcessorIdInValue(api.flow, remap) as typeof api.flow)
      : api.flow
    return { ...api, flow }
  })
  return cloned
}

/**
 * 旧项目：名称非大驼峰、id 非 UUID → 就地迁移目录与引用。
 * 幂等；已合规则快速返回。
 * 按整个 services 根做全局 remap，避免跨服务 dataProcessorId 断链。
 */
async function migrateServiceProcessorIdentities(
  projectPath: string,
  _serviceId: string,
): Promise<void> {
  const root = servicesRoot(projectPath)
  let serviceIds: string[] = []
  try {
    serviceIds = (await readdir(root)).filter((name) => {
      if (name.startsWith('.') || name === SERVICES_LEGACY_FILE) return false
      return isValidServiceId(name)
    })
  } catch {
    return
  }

  const globalRemap = new Map<string, string>()
  let anyNeed = false

  for (const serviceId of serviceIds) {
    const dataList = await listServiceProcessorsRaw(
      projectPath,
      serviceId,
      'data',
    )
    const bizList = await listServiceProcessorsRaw(
      projectPath,
      serviceId,
      'business',
    )
    if (
      dataList.some(
        (p) => !isProcessorUuid(p.id) || !isValidProcessorName(p.name),
      ) ||
      bizList.some(
        (p) => !isProcessorUuid(p.id) || !isValidProcessorName(p.name),
      )
    ) {
      anyNeed = true
    }
  }
  if (!anyNeed) {
    // 仍可能有遗留跨服务旧 id；轻量扫一遍业务/控制器
    // 若全局已无旧目录名，直接返回
    return
  }

  for (const serviceId of serviceIds) {
    const dataList = await listServiceProcessorsRaw(
      projectPath,
      serviceId,
      'data',
    )
    const bizList = await listServiceProcessorsRaw(
      projectPath,
      serviceId,
      'business',
    )
    const usedNames = new Set<string>()

    const migrateLayer = async (
      kind: ProcessorLayerKind,
      list: ServiceProcessor[],
    ) => {
      const nextList: ServiceProcessor[] = []
      usedNames.clear()
      for (const proc of list) {
        const oldId = proc.id
        let next: ServiceProcessor = { ...proc }
        if (!isProcessorUuid(next.id)) {
          next = { ...next, id: newProcessorId() }
        }
        globalRemap.set(oldId, next.id)
        const entityFb = next.entityRef?.trim() || ''
        const fallback =
          (entityFb && !entityFb.startsWith('type_') ? entityFb : '') ||
          (isProcessorUuid(oldId) ? 'Processor' : oldId) ||
          'Processor'
        next = {
          ...next,
          name: uniquePascalName(next.name || fallback, usedNames, fallback),
        }
        nextList.push(next)
      }
      for (const next of nextList) {
        await writeProcessorConfig(projectPath, serviceId, kind, next)
      }
      for (const proc of list) {
        const newId = globalRemap.get(proc.id) ?? proc.id
        if (newId === proc.id) continue
        const oldDir = processorDir(projectPath, serviceId, kind, proc.id)
        try {
          await rm(oldDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
      return nextList
    }

    await migrateLayer('data', dataList)
    let nextBiz = await migrateLayer('business', bizList)
    nextBiz = nextBiz.map((p) => remapProcessorRefs(p, globalRemap))
    for (const proc of nextBiz) {
      await writeProcessorConfig(projectPath, serviceId, 'business', proc)
    }

    const controllers = await listServiceControllersRaw(projectPath, serviceId)
    for (const ctrl of controllers) {
      const next = remapControllerRefs(ctrl, globalRemap)
      await writeControllerConfig(projectPath, serviceId, next)
    }
  }

  // 第二遍：用完整 globalRemap 再刷一遍业务/控制器引用（跨服务）
  if (!globalRemap.size) return
  for (const serviceId of serviceIds) {
    const bizList = await listServiceProcessorsRaw(
      projectPath,
      serviceId,
      'business',
    )
    for (const proc of bizList) {
      const next = remapProcessorRefs(proc, globalRemap)
      await writeProcessorConfig(projectPath, serviceId, 'business', next)
    }
    const controllers = await listServiceControllersRaw(projectPath, serviceId)
    for (const ctrl of controllers) {
      const next = remapControllerRefs(ctrl, globalRemap)
      await writeControllerConfig(projectPath, serviceId, next)
    }
  }
}

export async function saveServiceProcessors(
  projectPath: string,
  serviceId: string,
  kind: ProcessorLayerKind,
  processorsInput: unknown,
): Promise<ServiceProcessor[]> {
  await assertServiceExists(projectPath, serviceId)
  await migrateServiceProcessorIdentities(projectPath, serviceId)

  const list = Array.isArray(processorsInput) ? processorsInput : []
  const processors: ServiceProcessor[] = []
  const ids = new Set<string>()
  const names = new Set<string>()

  for (const item of list) {
    let proc = normalizeServiceProcessor(item)
    if (!proc) {
      throw new ProjectError('处理器数据不合法', 400)
    }
    if (!isProcessorUuid(proc.id)) {
      proc = { ...proc, id: newProcessorId() }
    }
    if (!isValidProcessorName(proc.name)) {
      const fallback = proc.entityRef?.trim() || proc.id
      proc = {
        ...proc,
        name: uniquePascalName(proc.name || fallback, names, fallback),
      }
    } else {
      const key = proc.name.trim().toLowerCase()
      if (names.has(key)) {
        throw new ProjectError(`处理器名称重复：${proc.name}`, 400)
      }
      names.add(key)
    }
    if (!isValidProcessorId(proc.id)) {
      throw new ProjectError(`处理器 ID 不合法：${proc.id}`, 400)
    }
    if (ids.has(proc.id)) {
      throw new ProjectError(`处理器 ID 重复：${proc.id}`, 400)
    }
    ids.add(proc.id)
    processors.push(proc)
  }

  const root = processorsRoot(projectPath, serviceId, kind)
  await mkdir(root, { recursive: true })

  let existing: string[] = []
  try {
    existing = await readdir(root)
  } catch {
    existing = []
  }
  for (const name of existing) {
    if (name.startsWith('.')) continue
    const dir = path.join(root, name)
    try {
      const info = await stat(dir)
      if (!info.isDirectory()) continue
      if (!ids.has(name)) {
        await rm(dir, { recursive: true, force: true })
      }
    } catch {
      // ignore
    }
  }

  for (const proc of processors) {
    await writeProcessorConfig(projectPath, serviceId, kind, proc)
  }

  return listServiceProcessorsRaw(projectPath, serviceId, kind)
}
