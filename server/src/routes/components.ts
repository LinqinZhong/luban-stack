import { Router } from 'express'
import { ProjectError } from '../services/project.js'
import {
  createComponent,
  getComponent,
  listComponents,
  saveComponentConfig,
  saveComponentData,
  saveComponentXml,
} from '../services/components.js'
import {
  deletePageMethod,
  listPageMethods,
  savePageMethod,
} from '../services/functions.js'
import { getLifecycle, saveLifecycle } from '../services/lifecycle.js'

const router = Router()
const ROOT = 'components'

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
    const components = await listComponents(getProjectPath(req))
    res.json({ components })
  } catch (err) {
    handleError(res, err)
  }
})

router.post('/', async (req, res) => {
  try {
    const { id, name, title } = req.body ?? {}
    const component = await createComponent({
      projectPath: getProjectPath(req),
      id,
      name,
      title,
    })
    res.status(201).json(component)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/:componentId/functions', async (req, res) => {
  try {
    const result = await listPageMethods(
      getProjectPath(req),
      req.params.componentId,
      ROOT,
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:componentId/functions/:name', async (req, res) => {
  try {
    const method = await savePageMethod({
      projectPath: getProjectPath(req),
      pageId: req.params.componentId,
      previousName: req.body?.previousName,
      root: ROOT,
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

router.delete('/:componentId/functions/:name', async (req, res) => {
  try {
    await deletePageMethod({
      projectPath: getProjectPath(req),
      pageId: req.params.componentId,
      name: req.params.name,
      root: ROOT,
    })
    res.json({ ok: true })
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/:componentId', async (req, res) => {
  try {
    const component = await getComponent(getProjectPath(req), req.params.componentId)
    res.json(component)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:componentId/config', async (req, res) => {
  try {
    const component = await saveComponentConfig({
      projectPath: getProjectPath(req),
      id: req.params.componentId,
      config: req.body?.config,
    })
    res.json(component)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:componentId/xml', async (req, res) => {
  try {
    const component = await saveComponentXml({
      projectPath: getProjectPath(req),
      id: req.params.componentId,
      xml: req.body?.xml,
    })
    res.json(component)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:componentId/data', async (req, res) => {
  try {
    const component = await saveComponentData({
      projectPath: getProjectPath(req),
      id: req.params.componentId,
      data: req.body?.data,
    })
    res.json(component)
  } catch (err) {
    handleError(res, err)
  }
})

router.get('/:componentId/lifecycle', async (req, res) => {
  try {
    const result = await getLifecycle(
      getProjectPath(req),
      req.params.componentId,
      ROOT,
    )
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

router.put('/:componentId/lifecycle', async (req, res) => {
  try {
    const result = await saveLifecycle({
      projectPath: getProjectPath(req),
      id: req.params.componentId,
      root: ROOT,
      lifecycle: req.body?.lifecycle,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err)
  }
})

export default router
