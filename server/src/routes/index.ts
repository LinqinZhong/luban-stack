import { Router } from 'express'
import healthRouter from './health.js'
import pagesRouter from './pages.js'
import componentsRouter from './components.js'
import projectsRouter from './projects.js'
import aiRouter from './ai.js'

const router = Router()

router.use('/health', healthRouter)
router.use('/projects', projectsRouter)
router.use('/pages', pagesRouter)
router.use('/components', componentsRouter)
router.use('/ai', aiRouter)

router.get('/', (_req, res) => {
  res.json({
    message: 'LubanStack 本地系统 API',
    version: '1.0.0',
  })
})

export default router
