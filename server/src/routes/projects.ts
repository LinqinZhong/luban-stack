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
import { readColorPalette, saveColorPalette } from '../services/palette.js'
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
  getMysqlTableColumnsWithSchema,
  resolveMysqlTableSchemaConflict,
  refreshMysqlTables,
  listMysqlTableRows,
  updateMysqlTableRow,
  deleteMysqlTableRow,
  insertMysqlTableRow,
  readMysqlTableSchema,
} from '../services/mysql.js'
import {
  readOssLibrary,
  saveOssLibrary,
  testOssConnection,
  listOssBuckets,
  createOssBucket,
  deleteOssBucket,
  listOssObjects,
  uploadOssObject,
  deleteOssObject,
  getOssObjectMeta,
  setOssBucketAccess,
  signOssObject,
  signOssObjectByConnectionId,
} from '../services/oss.js'
import {
  readBackendServiceLibrary,
  readServiceControllers,
  readServiceProcessors,
  saveBackendServiceLibrary,
  saveServiceControllers,
  saveServiceProcessors,
} from '../services/backend-services.js'
import { debugDataLayerMethod } from '../services/data-method-debug.js'
import { jsonSafeValue } from '../utils/runtime-map.js'
import { exportVue3Project } from '../services/export-vue3.js'
import { exportMpWxProject } from '../services/export-mp-wx.js'
import { exportNestJsProject } from '../services/export-nextjs.js'
import {
  readBuildSchemeLibrary,
  writeBuildSchemeLibrary,
} from '../services/build-schemes.js'
import { buildProject } from '../services/build-project.js'
import {
  DEFAULT_CANVAS_WIDTH,
  ENGINE_VERSION,
  LUBAN_CONFIG_FILE,
} from '../types/luban-project.js'

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
    configFile: LUBAN_CONFIG_FILE,
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
    const patch: {
      wechatAppId?: string | null
      canvasScene?: 'h5' | 'miniprogram' | null
    } = {}
    if ('wechatAppId' in (req.body ?? {})) {
      const raw = req.body.wechatAppId
      patch.wechatAppId =
        raw === null || raw === undefined ? null : String(raw)
    }
    if ('canvasScene' in (req.body ?? {})) {
      const raw = req.body.canvasScene
      if (raw === null || raw === undefined || raw === '') {
        patch.canvasScene = null
      } else if (raw === 'h5' || raw === 'miniprogram') {
        patch.canvasScene = raw
      } else {
        res.status(400).json({ message: 'canvasScene 须为 h5 或 miniprogram' })
        return
      }
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

router.get('/palette', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await readColorPalette(projectPath.trim())
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

router.post('/export/nestjs', async (req, res) => {
  try {
    const projectPath =
      typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const result = await exportNestJsProject(projectPath.trim())
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

/** @deprecated */
router.post('/export/nextjs', async (req, res) => {
  try {
    const projectPath =
      typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const result = await exportNestJsProject(projectPath.trim())
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/build-schemes', async (req, res) => {
  try {
    const projectPath =
      typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await readBuildSchemeLibrary(projectPath.trim())
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/build-schemes', async (req, res) => {
  try {
    const projectPath =
      typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await writeBuildSchemeLibrary(
      projectPath.trim(),
      req.body?.library ?? { schemes: req.body?.schemes ?? [] },
    )
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/build', async (req, res) => {
  try {
    const projectPath =
      typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
    const schemeName =
      typeof req.body?.schemeName === 'string' ? req.body.schemeName : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    if (!schemeName.trim()) {
      res.status(400).json({ message: '请提供 schemeName' })
      return
    }
    const backendNames = Array.isArray(req.body?.backendNames)
      ? req.body.backendNames.filter((n: unknown) => typeof n === 'string')
      : undefined
    const frontendNames = Array.isArray(req.body?.frontendNames)
      ? req.body.frontendNames.filter((n: unknown) => typeof n === 'string')
      : undefined
    const result = await buildProject(projectPath.trim(), schemeName.trim(), {
      ...(backendNames !== undefined ? { backendNames } : {}),
      ...(frontendNames !== undefined ? { frontendNames } : {}),
    })
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

router.put('/palette', async (req, res) => {
  try {
    const { projectPath, colors } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await saveColorPalette(projectPath.trim(), { colors })
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
    // Map 无法经 JSON 传输，先摊成普通对象；前端再按出参类型还原为 Map
    res.json({
      ...result,
      output: jsonSafeValue(result.output),
      raw: jsonSafeValue(result.raw),
    })
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/oss', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
    if (!projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await readOssLibrary(projectPath.trim())
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/oss', async (req, res) => {
  try {
    const { projectPath, connections } = req.body ?? {}
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    const library = await saveOssLibrary(projectPath.trim(), { connections })
    res.json(library)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/test', async (req, res) => {
  try {
    const result = await testOssConnection(parseOssConnection(req.body ?? {}))
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/buckets/list', async (req, res) => {
  try {
    const buckets = await listOssBuckets(parseOssConnection(req.body ?? {}))
    res.json({ buckets })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/buckets/create', async (req, res) => {
  try {
    const body = req.body ?? {}
    const buckets = await createOssBucket(
      parseOssConnection(body),
      String(body.bucketName ?? ''),
    )
    res.json({ buckets })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/buckets/delete', async (req, res) => {
  try {
    const body = req.body ?? {}
    const buckets = await deleteOssBucket(
      parseOssConnection(body),
      String(body.bucketName ?? ''),
    )
    res.json({ buckets })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/buckets/set-access', async (req, res) => {
  try {
    const body = req.body ?? {}
    const access = body.access === 'public' ? 'public' : 'private'
    const result = await setOssBucketAccess(
      parseOssConnection(body),
      String(body.bucketName ?? ''),
      access,
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/objects/list', async (req, res) => {
  try {
    const body = req.body ?? {}
    const result = await listOssObjects(
      parseOssConnection(body),
      String(body.bucketName ?? ''),
      {
        prefix: typeof body.prefix === 'string' ? body.prefix : '',
        continuationToken:
          typeof body.continuationToken === 'string' ? body.continuationToken : undefined,
        maxKeys: body.maxKeys,
      },
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/objects/upload', async (req, res) => {
  try {
    const body = req.body ?? {}
    const result = await uploadOssObject(
      parseOssConnection(body),
      String(body.bucketName ?? ''),
      {
        key: String(body.key ?? ''),
        contentBase64: String(body.contentBase64 ?? ''),
        contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
      },
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/objects/delete', async (req, res) => {
  try {
    const body = req.body ?? {}
    const result = await deleteOssObject(
      parseOssConnection(body),
      String(body.bucketName ?? ''),
      String(body.key ?? ''),
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/objects/meta', async (req, res) => {
  try {
    const body = req.body ?? {}
    const result = await getOssObjectMeta(
      parseOssConnection(body),
      String(body.bucketName ?? ''),
      String(body.key ?? ''),
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/oss/objects/sign', async (req, res) => {
  try {
    const body = req.body ?? {}
    const expiresIn =
      body.expiresIn == null ? 7 * 24 * 3600 : Number(body.expiresIn)
    const projectPath =
      typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    const connectionId =
      typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
    if (projectPath && connectionId) {
      const result = await signOssObjectByConnectionId(
        projectPath,
        connectionId,
        String(body.bucketName ?? ''),
        String(body.key ?? body.objectKey ?? ''),
        expiresIn,
      )
      res.json(result)
      return
    }
    const result = await signOssObject(
      parseOssConnection(body),
      String(body.bucketName ?? ''),
      String(body.key ?? body.objectKey ?? ''),
      expiresIn,
    )
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
    const projectPath = String(body.projectPath ?? '')
    const result = await getMysqlTableColumnsWithSchema(
      projectPath,
      parseMysqlConnection(body),
      tableName,
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

/** 仅读本地 mysql/{table}.json，不连库（供数据层预置方法等使用） */
router.post('/mysql/tables/schema/local', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const projectPath = String(body.projectPath ?? '')
    if (!projectPath.trim()) {
      res.status(400).json({ error: '缺少项目路径' })
      return
    }
    const schema = await readMysqlTableSchema(projectPath, tableName)
    res.json({
      columns: schema?.columns ?? [],
      indexes: schema?.indexes ?? [],
      remark: schema?.remark ?? '',
      name: schema?.name ?? tableName,
      syncedAt: schema?.syncedAt ?? null,
    })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/schema/resolve', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const projectPath = String(body.projectPath ?? '')
    const adopt = body.adopt === 'local' ? 'local' : 'remote'
    const result = await resolveMysqlTableSchemaConflict(
      projectPath,
      parseMysqlConnection(body),
      tableName,
      adopt,
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/create', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tables = await createMysqlTable(
      parseMysqlConnection(body),
      body.table,
      String(body.projectPath ?? ''),
    )
    res.json({ tables })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/mysql/tables/update', async (req, res) => {
  try {
    const body = req.body ?? {}
    const tableName = String(body.tableName ?? '')
    const tables = await updateMysqlTableMeta(
      parseMysqlConnection(body),
      tableName,
      {
        name: String(body.name ?? ''),
        remark: String(body.remark ?? ''),
      },
      String(body.projectPath ?? ''),
    )
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
      String(body.projectPath ?? ''),
      String(body.remark ?? ''),
      body.indexes,
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
    const tables = await dropMysqlTable(
      parseMysqlConnection(body),
      tableName,
      String(body.projectPath ?? ''),
    )
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
    const result = await listMysqlTableRows(
      parseMysqlConnection(body),
      tableName,
      {
        current: body.current,
        pageSize: body.pageSize,
      },
      String(body.projectPath ?? ''),
    )
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

function parseOssConnection(body: any) {
  return {
    endpoint: String(body.endpoint ?? ''),
    region: String(body.region ?? 'us-east-1'),
    accessKeyId: String(body.accessKeyId ?? ''),
    secretAccessKey: String(body.secretAccessKey ?? ''),
    forcePathStyle: body.forcePathStyle !== false,
  }
}

export default router
