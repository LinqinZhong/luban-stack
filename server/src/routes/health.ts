import { Router } from 'express'

const router = Router()

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'voider-server',
    timestamp: new Date().toISOString(),
  })
})

export default router
