import { Router } from 'express'
import healthRouter from './health.js'

const router = Router()

router.use('/health', healthRouter)

router.get('/', (_req, res) => {
  res.json({
    message: 'Voider 本地系统 API',
    version: '1.0.0',
  })
})

export default router
