import app from './app.js'
import { createMpGatewayApp } from './mp-gateway.js'
import { env } from './config/env.js'

app.listen(env.port, () => {
  console.log(`Server running at http://localhost:${env.port}`)
  console.log(`Environment: ${env.nodeEnv}`)
})

const mpApp = createMpGatewayApp()
mpApp.listen(env.mpGatewayPort, '0.0.0.0', () => {
  console.log(
    `MP gateway running at http://127.0.0.1:${env.mpGatewayPort} (wx.request → controller path)`,
  )
})
