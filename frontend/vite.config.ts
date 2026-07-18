import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        // 用 127.0.0.1 避免 Windows 上 localhost 双栈 (IPv4/IPv6) 触发代理异常
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
