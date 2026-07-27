import dotenv from 'dotenv'

dotenv.config()

export const env = {
  port: Number(process.env.PORT) || 3000,
  /** 微信小程序本地联调网关端口（开发者工具可代理到此） */
  mpGatewayPort: Number(process.env.MP_GATEWAY_PORT) || 6630,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
}
