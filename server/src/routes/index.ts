import { Router } from 'express'
import healthRouter from './health.js'
import pagesRouter from './pages.js'
import projectsRouter from './projects.js'

const router = Router()

router.use('/health', healthRouter)
router.use('/projects', projectsRouter)
router.use('/pages', pagesRouter)

router.get('/', (_req, res) => {
  res.json({
    message: 'Voider 本地系统 API',
    version: '1.0.0',
  })
})

export default router
