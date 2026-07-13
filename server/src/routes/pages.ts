import { Router } from 'express'
import { ProjectError } from '../services/project.js'
import {
  createPage,
  getPage,
  listPages,
  savePageData,
  savePageXml,
} from '../services/pages.js'

const router = Router()

function handleError(res: import('express').Response, err: unknown) {
  if (err instanceof ProjectError) {
    res.status(err.status).json({ message: err.message })
    return
  }

  console.error(err)
  res.status(500).json({ message: '服务器内部错误' })
}

function getProjectPath(req: import('express').Request): string {
  const fromQuery = typeof req.query.projectPath === 'string' ? req.query.projectPath : ''
  const fromBody = typeof req.body?.projectPath === 'string' ? req.body.projectPath : ''
  return fromBody || fromQuery
}

router.get('/', async (req, res) => {
  try {
    const pages = await listPages(getProjectPath(req))
    res.json({ pages })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/', async (req, res) => {
  try {
    const { id, name, title } = req.body ?? {}
    const page = await createPage({
      projectPath: getProjectPath(req),
      id,
      name,
      title,
    })
    res.status(201).json(page)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/:pageId', async (req, res) => {
  try {
    const page = await getPage(getProjectPath(req), req.params.pageId)
    res.json(page)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:pageId/xml', async (req, res) => {
  try {
    const page = await savePageXml({
      projectPath: getProjectPath(req),
      pageId: req.params.pageId,
      xml: req.body?.xml,
    })
    res.json(page)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:pageId/data', async (req, res) => {
  try {
    const page = await savePageData({
      projectPath: getProjectPath(req),
      pageId: req.params.pageId,
      data: req.body?.data,
    })
    res.json(page)
  } catch (err) {
    handleError(res, err)
  }
})

export default router
