import { app, BrowserWindow, dialog, Menu } from 'electron'
import { ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'

const isDevUi =
  process.env.LUBAN_ELECTRON_DEV === '1' ||
  process.env.VOIDER_ELECTRON_DEV === '1' ||
  !app.isPackaged
const DEV_UI_URL =
  process.env.LUBAN_DEV_UI_URL ||
  process.env.VOIDER_DEV_UI_URL ||
  'http://127.0.0.1:5173'
const HEALTH_TIMEOUT_MS = 30_000
const HEALTH_INTERVAL_MS = 200

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null
let quitting = false

// Windows 任务栏分组 / 图标缓存与 appId 对齐（避免沿用旧 Voider 图标）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.luban.desktop')
}

function repoRoot(): string {
  // desktop/dist/main.js → desktop → repo
  return path.resolve(__dirname, '..', '..')
}

function resourceRoot(): string {
  if (app.isPackaged) return process.resourcesPath
  return repoRoot()
}

/** 窗口图标（exe 任务栏图标由 electron-builder 的 win.icon 嵌入） */
function appIconPath(): string {
  return path.join(__dirname, '..', 'build', 'icon.ico')
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配本地端口'))
        return
      }
      const { port } = address
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
    server.on('error', reject)
  })
}

async function waitForHealth(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/health`
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
      lastError = `HTTP ${res.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS))
  }
  throw new Error(`服务启动超时：${lastError}`)
}

function startPackagedServer(port: number, corsOrigin: string): ChildProcess {
  const root = resourceRoot()
  const serverDir = path.join(root, 'server')
  const entry = path.join(serverDir, 'dist', 'index.js')
  return spawn(process.execPath, [entry], {
    cwd: serverDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      CORS_ORIGIN: corsOrigin,
      NODE_ENV: 'production',
      LUBAN_STATIC_DIR: path.join(root, 'frontend'),
      MP_GATEWAY_PORT: process.env.MP_GATEWAY_PORT || '6630',
    },
    stdio: 'inherit',
    windowsHide: true,
  })
}

function startDevServer(port: number, corsOrigin: string): ChildProcess {
  const root = repoRoot()
  const serverCwd = path.join(root, 'server')
  const tsxBin =
    process.platform === 'win32'
      ? path.join(serverCwd, 'node_modules', '.bin', 'tsx.cmd')
      : path.join(serverCwd, 'node_modules', '.bin', 'tsx')

  return spawn(tsxBin, ['src/index.ts'], {
    cwd: serverCwd,
    env: {
      ...process.env,
      PORT: String(port),
      CORS_ORIGIN: corsOrigin,
      NODE_ENV: 'development',
      MP_GATEWAY_PORT: process.env.MP_GATEWAY_PORT || '6630',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  })
}

function stopServerProcess(): void {
  if (!serverProcess || serverProcess.killed) return
  const child = serverProcess
  serverProcess = null
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    // ignore
  }
}

function createWindow(uiUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'LubanStack',
  })

  win.once('ready-to-show', () => win.show())
  void win.loadURL(uiUrl)

  if (
    process.env.LUBAN_ELECTRON_DEVTOOLS === '1' ||
    process.env.VOIDER_ELECTRON_DEVTOOLS === '1'
  ) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  return win
}

async function boot(): Promise<void> {
  const useVite = isDevUi && !app.isPackaged
  // 开发态固定 3000，与 frontend Vite proxy 一致；打包态分配空闲端口
  const port = useVite
    ? Number(process.env.PORT) || 3000
    : await findFreePort()
  const uiUrl = useVite ? DEV_UI_URL : `http://127.0.0.1:${port}/`
  const corsOrigin = useVite ? DEV_UI_URL : `http://127.0.0.1:${port}`

  serverProcess = app.isPackaged
    ? startPackagedServer(port, corsOrigin)
    : startDevServer(port, corsOrigin)

  serverProcess.on('exit', (code, signal) => {
    if (quitting) return
    const detail = signal ? `signal ${signal}` : `code ${code}`
    void dialog.showErrorBox('LubanStack 服务已退出', `后端进程异常结束（${detail}）`)
    app.quit()
  })

  await waitForHealth(port)
  mainWindow = createWindow(uiUrl)
}

app.whenReady().then(() => {
  // 去掉默认 File/Edit/View 菜单栏，只保留系统标题栏
  Menu.setApplicationMenu(null)
  void boot().catch(async (err) => {
    stopServerProcess()
    const message = err instanceof Error ? err.message : String(err)
    await dialog.showErrorBox('LubanStack 启动失败', message)
    app.quit()
  })
})

app.on('before-quit', () => {
  quitting = true
  stopServerProcess()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && !mainWindow) {
    void boot().catch(() => app.quit())
  }
})
