import cors from 'cors'
import express from 'express'
import { ProjectError } from './services/project.js'
import {
  findApiByHttpPath,
  invokeMatchedApi,
} from './services/mp-gateway/invoke.js'

/** 微信小程序本地联调网关（默认 6630） */
export function createMpGatewayApp() {
  const app = express()
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '4mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.get('/__voider/health', (_req, res) => {
    res.json({ ok: true, service: 'voider-mp-gateway' })
  })

  app.use(async (req, res) => {
    try {
      // 兼容开发者工具「代理」把绝对 URL 塞进 req.url 的情况
      let reqPath = req.path || '/'
      const rawUrl = req.url || ''
      if (/^https?:\/\//i.test(rawUrl)) {
        try {
          reqPath = new URL(rawUrl).pathname
        } catch {
          // keep req.path
        }
      }

      const projectPath =
        String(req.headers['x-voider-project'] || '').trim() ||
        String(req.query.projectPath || '').trim()
      if (!projectPath) {
        res.status(400).json({
          code: 400,
          message:
            '缺少项目路径：请在请求头 X-Voider-Project 中带上导出时的 projectPath',
          data: null,
        })
        return
      }

      const method = (req.method || 'GET').toUpperCase()
      const match = await findApiByHttpPath(projectPath, method, reqPath)
      if (!match) {
        res.status(404).json({
          code: 404,
          message: `未找到 API：${method} ${reqPath}`,
          data: null,
        })
        return
      }

      const query: Record<string, unknown> = { ...req.query }
      delete query.projectPath
      const body =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {}

      const data = await invokeMatchedApi({
        projectPath,
        match,
        query,
        body,
        dryRun: false,
      })

      res.json({
        code: 0,
        message: 'ok',
        data,
      })
    } catch (err) {
      if (err instanceof ProjectError) {
        res.status(err.status || 400).json({
          code: err.status || 400,
          message: err.message,
          data: null,
        })
        return
      }
      console.error('[mp-gateway]', err)
      res.status(500).json({
        code: 500,
        message: err instanceof Error ? err.message : '网关内部错误',
        data: null,
      })
    }
  })

  return app
}
