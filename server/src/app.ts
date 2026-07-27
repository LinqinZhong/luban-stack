import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { env } from './config/env.js'
import apiRouter from './routes/index.js'

const app = express()

app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  }),
)
app.use(express.json({ limit: '40mb' }))
app.use('/api', apiRouter)

if (env.staticDir) {
  app.use(express.static(env.staticDir, { index: false }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(env.staticDir, 'index.html'), (err) => {
      if (err) next(err)
    })
  })
}

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err)
    res.status(500).json({ message: 'Internal Server Error' })
  },
)

export default app
