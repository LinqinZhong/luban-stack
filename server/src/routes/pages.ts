import { Router } from 'express'
import { ProjectError } from '../services/project.js'
import {
  copyPage,
  createPage,
  deletePage,
  getPage,
  listPages,
  savePageConfig,
  savePageData,
  savePageXml,
} from '../services/pages.js'
import {
  deletePageMethod,
  listPageMethods,
  savePageMethod,
} from '../services/functions.js'
import { getLifecycle, saveLifecycle } from '../services/lifecycle.js'

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

router.post('/:pageId/copy', async (req, res) => {
  try {
    const page = await copyPage({
      projectPath: getProjectPath(req),
      pageId: req.params.pageId,
      newId: req.body?.newId,
      name: req.body?.name,
      title: req.body?.title,
    })
    res.status(201).json(page)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:pageId/config', async (req, res) => {
  try {
    const page = await savePageConfig({
      projectPath: getProjectPath(req),
      pageId: req.params.pageId,
      name: req.body?.name,
      title: req.body?.title,
      statusBar: req.body?.statusBar,
      queryParams: req.body?.queryParams,
      debugQuery: req.body?.debugQuery,
    })
    res.json(page)
  } catch (err) {
    handleError(res, err)
  }
})

router.delete('/:pageId', async (req, res) => {
  try {
    const result = await deletePage({
      projectPath: getProjectPath(req),
      pageId: req.params.pageId,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/:pageId/functions', async (req, res) => {
  try {
    const result = await listPageMethods(getProjectPath(req), req.params.pageId)
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:pageId/functions/:name', async (req, res) => {
  try {
    const method = await savePageMethod({
      projectPath: getProjectPath(req),
      pageId: req.params.pageId,
      previousName: req.body?.previousName,
      method: {
        ...(req.body?.method ?? {}),
        name: req.params.name,
      },
    })
    res.json({ method })
  } catch (err) {
    handleError(res, err)
  }
})

router.delete('/:pageId/functions/:name', async (req, res) => {
  try {
    await deletePageMethod({
      projectPath: getProjectPath(req),
      pageId: req.params.pageId,
      name: req.params.name,
    })
    res.json({ ok: true })
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

router.get('/:pageId/lifecycle', async (req, res) => {
  try {
    const result = await getLifecycle(
      getProjectPath(req),
      req.params.pageId,
      'pages',
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:pageId/lifecycle', async (req, res) => {
  try {
    const result = await saveLifecycle({
      projectPath: getProjectPath(req),
      id: req.params.pageId,
      root: 'pages',
      lifecycle: req.body?.lifecycle,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

export default router
