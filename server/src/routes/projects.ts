import { Router } from 'express'
import {
  browseDirectory,
  createProject,
  openProject,
  ProjectError,
} from '../services/project.js'
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

export default router
