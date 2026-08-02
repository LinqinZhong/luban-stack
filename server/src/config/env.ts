import dotenv from 'dotenv'
import path from 'node:path'

dotenv.config()

const staticDirRaw =
  process.env.LUBAN_STATIC_DIR?.trim() || process.env.VOIDER_STATIC_DIR?.trim()

export const env = {
  port: Number(process.env.PORT) || 3000,
  /** 微信小程序本地联调网关端口（开发者工具可代理到此） */
  mpGatewayPort: Number(process.env.MP_GATEWAY_PORT) || 6630,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  /** 桌面端/一体化部署时托管前端 dist；未设置则仅提供 API */
  staticDir: staticDirRaw ? path.resolve(staticDirRaw) : '',
}
