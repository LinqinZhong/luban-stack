import { Router } from 'express'
import {
  browseDirectory,
  createProject,
  openProject,
  ProjectError,
  setEntryPage,
  patchProjectConfig,
} from '../services/project.js'
import { readIconLibrary, saveIconLibrary } from '../services/icons.js'
import {
  readDataTypeLibrary,
  saveDataTypeLibrary,
} from '../services/data-types.js'
import {
  readMysqlLibrary,
  saveMysqlLibrary,
  testMysqlConnection,
  listMysqlDatabases,
  createMysqlTable,
  updateMysqlTableMeta,
  updateMysqlTableSchema,
  dropMysqlTable,
  truncateMysqlTable,
  getMysqlTableColumns,
  refreshMysqlTables,
  listMysqlTableRows,
  updateMysqlTableRow,
  deleteMysqlTableRow,
  insertMysqlTableRow,
} from '../services/mysql.js'
import {
  readBackendServiceLibrary,
  readServiceControllers,
  readServiceProcessors,
  saveBackendServiceLibrary,
  saveServiceControllers,
  saveServiceProcessors,
} from '../services/backend-services.js'
import { debugDataLayerMethod } from '../services/data-method-debug.js'
import { exportVue3Project } from '../services/export-vue3.js'
import { exportMpWxProject } from '../services/export-mp-wx.js'
import { DEFAULT_CANVAS_WIDTH, ENGINE_VERSION } from '../types/voider-project.js'

const router = Router()

function handleError(res: import('express').Response, err: unknown) {
  if (err instanceof ProjectError) {
    res.status(err.status).json({ message: err.message })
    return
  }

  console.error(err)
  res.status(500).json({ message: '服务器内部错误' })
}

router.get('/meta', (_req, res) => {
  res.json({
    engineVersion: ENGINE_VERSION,
    defaultCanvasWidth: DEFAULT_CANVAS_WIDTH,
    configFile: 'voider.json',
  })
})

router.get('/browse', async (req, res) => {
  try {
    const dirPath = typeof req.query.path === 'string' ? req.query.path : undefined
    const result = await browseDirectory(dirPath)
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/open', async (req, res) => {
  try {
    const { path: projectPath } = req.body ?? {}
    const result = await openProject(projectPath)
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/create', async (req, res) => {
  try {
    const {
      path: projectPath,
      name,
      author,
      version,
      engineVersion,
      canvasWidth,
    } = req.body ?? {}

    const result = await createProject({
      path: projectPath,
      name,
      author,
      version,
      engineVersion,
      canvasWidth,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/entry', async (req, res) => {
  try {
    const projectPath =
      typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
    const pageId =
      req.body?.pageId === null || req.body?.pageId === undefined
        ? null
        : String(req.body.pageId)
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const result = await setEntryPage(projectPath.trim(), pageId)
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/config', async (req, res) => {
  try {
    const projectPath =
      typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const patch: { wechatAppId?: string | null } = {}
    if ('wechatAppId' in (req.body ?? {})) {
      const raw = req.body.wechatAppId
      patch.wechatAppId =
        raw === null || raw === undefined ? null : String(raw)
    }
    const result = await patchProjectConfig(projectPath.trim(), patch)
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/icons', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await readIconLibrary(projectPath.trim())
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/export/vue3', async (req, res) => {
  try {
    const projectPath =
      typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const result = await exportVue3Project(projectPath.trim())
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/export/mp-wx', async (req, res) => {
  try {
    const projectPath =
      typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const result = await exportMpWxProject(projectPath.trim())
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/icons', async (req, res) => {
  try {
    const { projectPath, icons } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await saveIconLibrary(projectPath.trim(), { icons })
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/types', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await readDataTypeLibrary(projectPath.trim())
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/types', async (req, res) => {
  try {
    const { projectPath, groups } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await saveDataTypeLibrary(projectPath.trim(), { groups })
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/mysql', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await readMysqlLibrary(projectPath.trim())
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/mysql', async (req, res) => {
  try {
    const { projectPath, databases } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await saveMysqlLibrary(projectPath.trim(), { databases })
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/services', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await readBackendServiceLibrary(projectPath.trim())
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/services', async (req, res) => {
  try {
    const { projectPath, services } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await saveBackendServiceLibrary(projectPath.trim(), { services })
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/services/controllers', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    if (!serviceId.trim()) {
      res.status(400).json({ message: '请提供 serviceId' })
      return
    }
    const controllers = await readServiceControllers(
      projectPath.trim(),
      serviceId.trim(),
    )
    res.json({ controllers })
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/services/controllers', async (req, res) => {
  try {
    const { projectPath, serviceId, controllers } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    if (!serviceId || typeof serviceId !== 'string' || !serviceId.trim()) {
      res.status(400).json({ message: '请提供 serviceId' })
      return
    }
    const next = await saveServiceControllers(
      projectPath.trim(),
      serviceId.trim(),
      controllers,
    )
    res.json({ controllers: next })
  } catch (err) {
    handleError(res, err)
  }
})

function parseProcessorLayer(raw: unknown): 'business' | 'data' | null {
  return raw === 'business' || raw === 'data' ? raw : null
}

router.get('/services/processors', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId : ''
    const layer = parseProcessorLayer(req.query.layer)
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    if (!serviceId.trim()) {
      res.status(400).json({ message: '请提供 serviceId' })
      return
    }
    if (!layer) {
      res.status(400).json({ message: '请提供 layer（business | data）' })
      return
    }
    const processors = await readServiceProcessors(
      projectPath.trim(),
      serviceId.trim(),
      layer,
    )
    res.json({ processors })
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/services/processors', async (req, res) => {
  try {
    const { projectPath, serviceId, layer, processors } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    if (!serviceId || typeof serviceId !== 'string' || !serviceId.trim()) {
      res.status(400).json({ message: '请提供 serviceId' })
      return
    }
    const kind = parseProcessorLayer(layer)
    if (!kind) {
      res.status(400).json({ message: '请提供 layer（business | data）' })
      return
    }
    const next = await saveServiceProcessors(
      projectPath.trim(),
      serviceId.trim(),
      kind,
      processors,
    )
    res.json({ processors: next })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/services/processors/debug', async (req, res) => {
  try {
    const {
      projectPath,
      serviceId,
      processorId,
      methodId,
      params,
      dryRun,
    } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    if (!serviceId || typeof serviceId !== 'string' || !serviceId.trim()) {
      res.status(400).json({ message: '请提供 serviceId' })
      return
    }
    if (!processorId || typeof processorId !== 'string' || !processorId.trim()) {
      res.status(400).json({ message: '请提供 processorId' })
      return
    }
    if (!methodId || typeof methodId !== 'string' || !methodId.trim()) {
      res.status(400).json({ message: '请提供 methodId' })
      return
    }
    const result = await debugDataLayerMethod({
      projectPath: projectPath.trim(),
      serviceId: serviceId.trim(),
      processorId: processorId.trim(),
      methodId: methodId.trim(),
      params:
        params && typeof params === 'object' && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {},
      dryRun: dryRun !== false,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/test', async (req, res) => {
  try {
    const body = req.body ?? {}
    const result = await testMysqlConnection(parseMysqlConnection(body))
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/databases', async (req, res) => {
  try {
    const databases = await listMysqlDatabases(parseMysqlConnection(req.body ?? {}))
    res.json({ databases })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/list', async (req, res) => {
  try {
    const tables = await refreshMysqlTables(parseMysqlConnection(req.body ?? {}))
    res.json({ tables })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/columns', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const columns = await getMysqlTableColumns(parseMysqlConnection(body), tableName)
    res.json({ columns })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/create', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tables = await createMysqlTable(parseMysqlConnection(body), body.table)
    res.json({ tables })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/update', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const tables = await updateMysqlTableMeta(parseMysqlConnection(body), tableName, {
      name: String(body.name ?? ''),
      remark: String(body.remark ?? ''),
    })
    res.json({ tables })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/design', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const tables = await updateMysqlTableSchema(
      parseMysqlConnection(body),
      tableName,
      body.columns,
    )
    res.json({ tables })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/drop', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const tables = await dropMysqlTable(parseMysqlConnection(body), tableName)
    res.json({ tables })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/truncate', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const tables = await truncateMysqlTable(parseMysqlConnection(body), tableName)
    res.json({ tables })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/rows', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const result = await listMysqlTableRows(parseMysqlConnection(body), tableName, {
      current: body.current,
      pageSize: body.pageSize,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/rows/update', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    await updateMysqlTableRow(parseMysqlConnection(body), tableName, {
      key: body.key,
      values: body.values,
    })
    res.json({ ok: true })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/rows/delete', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    await deleteMysqlTableRow(parseMysqlConnection(body), tableName, body.key)
    res.json({ ok: true })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/rows/insert', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    await insertMysqlTableRow(parseMysqlConnection(body), tableName, body.values)
    res.json({ ok: true })
  } catch (err) {
    handleError(res, err)
  }
})

function parseMysqlConnection(body: any) {
  return {
    host: String(body.host ?? ''),
    port: Number(body.port) || 3306,
    username: String(body.username ?? ''),
    password: String(body.password ?? ''),
    database: String(body.database ?? ''),
    ssh: {
      enabled: Boolean(body.ssh?.enabled),
      host: String(body.ssh?.host ?? ''),
      port: Number(body.ssh?.port) || 22,
      username: String(body.ssh?.username ?? ''),
      authType: body.ssh?.authType === 'privateKey' ? 'privateKey' as const : 'password' as const,
      password: String(body.ssh?.password ?? ''),
      privateKey: String(body.ssh?.privateKey ?? ''),
      passphrase: String(body.ssh?.passphrase ?? ''),
    },
  }
}

export default router
