import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import apiRouter from './routes/index.js'

const app = express()

app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  }),
)
app.use(express.json())
app.use('/api', apiRouter)

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
