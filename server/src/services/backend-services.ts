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
  isValidControllerId,
  isValidProcessorId,
  isValidServiceId,
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

  const list = Array.isArray(controllersInput) ? controllersInput : []
  const controllers: ServiceController[] = []
  const ids = new Set<string>()
  const names = new Set<string>()

  for (const item of list) {
    const ctrl = normalizeServiceController(item)
    if (!ctrl) {
      throw new ProjectError('控制器数据不合法', 400)
    }
    if (!isValidControllerId(ctrl.id)) {
      throw new ProjectError(`控制器 ID 不合法：${ctrl.id}`, 400)
    }
    if (ids.has(ctrl.id)) {
      throw new ProjectError(`控制器 ID 重复：${ctrl.id}`, 400)
    }
    ids.add(ctrl.id)
    const nameKey = ctrl.name.trim().toLowerCase()
    if (names.has(nameKey)) {
      throw new ProjectError(`控制器名称重复：${ctrl.name}`, 400)
    }
    names.add(nameKey)
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

  return readServiceControllers(projectPath, serviceId)
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

export async function saveServiceProcessors(
  projectPath: string,
  serviceId: string,
  kind: ProcessorLayerKind,
  processorsInput: unknown,
): Promise<ServiceProcessor[]> {
  await assertServiceExists(projectPath, serviceId)

  const list = Array.isArray(processorsInput) ? processorsInput : []
  const processors: ServiceProcessor[] = []
  const ids = new Set<string>()
  const names = new Set<string>()

  for (const item of list) {
    const proc = normalizeServiceProcessor(item)
    if (!proc) {
      throw new ProjectError('处理器数据不合法', 400)
    }
    if (!isValidProcessorId(proc.id)) {
      throw new ProjectError(`处理器 ID 不合法：${proc.id}`, 400)
    }
    if (ids.has(proc.id)) {
      throw new ProjectError(`处理器 ID 重复：${proc.id}`, 400)
    }
    ids.add(proc.id)
    const nameKey = proc.name.trim().toLowerCase()
    if (names.has(nameKey)) {
      throw new ProjectError(`处理器名称重复：${proc.name}`, 400)
    }
    names.add(nameKey)
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

  return readServiceProcessors(projectPath, serviceId, kind)
}
