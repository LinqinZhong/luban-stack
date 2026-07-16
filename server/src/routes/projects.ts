import { Router } from 'express'
import {
  browseDirectory,
  createProject,
  openProject,
  ProjectError,
  setEntryPage,
} from '../services/project.js'
import { readIconLibrary, saveIconLibrary } from '../services/icons.js'
import {
  readDataTypeLibrary,
  saveDataTypeLibrary,
} from '../services/data-types.js'
import { exportVue3Project } from '../services/export-vue3.js'
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

export default router
