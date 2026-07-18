import { useRouter } from 'vue-router'

let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastEl: HTMLDivElement | null = null

function ensureToastHost(): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('showToast requires DOM')
  }
  const page = document.querySelector('.voider-page') as HTMLElement | null
  return page ?? document.body
}

/** 页面内 Toast（对齐编辑器预览；挂在 .voider-page 上随设计稿缩放） */
export function showToast(message?: string, duration: 'short' | 'long' = 'short') {
  if (typeof document === 'undefined') return
  const text = String(message ?? '').trim() || ' '
  const host = ensureToastHost()
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative'
  }
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'voider-toast'
    toastEl.setAttribute('role', 'status')
  }
  toastEl.textContent = text
  if (toastEl.parentElement !== host) {
    host.appendChild(toastEl)
  }
  // 触发重排以便重复弹出时重新播放过渡
  toastEl.classList.remove('is-visible')
  void toastEl.offsetWidth
  toastEl.classList.add('is-visible')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(
    () => {
      toastEl?.classList.remove('is-visible')
      toastTimer = null
    },
    duration === 'long' ? 4500 : 2000,
  )
}

export interface MenuButtonBoundingClientRect {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export interface DeviceInfo {
  statusBarHeight: number
  userAgent: string
  /** 微信小程序胶囊；H5 为 null */
  menuButton: MenuButtonBoundingClientRect | null
  platform: 'h5' | 'miniprogram'
}

function readUserAgent(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent) return navigator.userAgent
  return ''
}

function isWxMiniProgramRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as any
  if (w.__wxjs_environment === 'miniprogram') return true
  if (w.wx && typeof w.wx.getMenuButtonBoundingClientRect === 'function') return true
  const ua = readUserAgent()
  return /miniProgram/i.test(ua) || /MiniProgramEnv/i.test(ua)
}

function readWxStatusBarHeight(): number | null {
  const wx = (typeof window !== 'undefined' ? (window as any).wx : null) as any
  if (!wx) return null
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const n = Number(wx.getWindowInfo()?.statusBarHeight)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch {
    // ignore
  }
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      const n = Number(wx.getSystemInfoSync()?.statusBarHeight)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch {
    // ignore
  }
  return null
}

function readWxMenuButton(): MenuButtonBoundingClientRect | null {
  const wx = (typeof window !== 'undefined' ? (window as any).wx : null) as any
  if (!wx || typeof wx.getMenuButtonBoundingClientRect !== 'function') return null
  try {
    const rect = wx.getMenuButtonBoundingClientRect()
    if (!rect || typeof rect !== 'object') return null
    return {
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
      top: Number(rect.top) || 0,
      right: Number(rect.right) || 0,
      bottom: Number(rect.bottom) || 0,
      left: Number(rect.left) || 0,
    }
  } catch {
    return null
  }
}

function readH5StatusBarHeight(): number {
  if (typeof document === 'undefined') return 0
  try {
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);'
    document.body.appendChild(el)
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0
    document.body.removeChild(el)
    return pad > 0 ? Math.round(pad) : 0
  } catch {
    return 0
  }
}

/**
 * 获取设备信息：
 * - statusBarHeight
 * - userAgent
 * - menuButton（微信小程序胶囊；纯 H5 为 null）
 */
export function getDeviceInfo(): DeviceInfo {
  const ua = readUserAgent()
  if (isWxMiniProgramRuntime()) {
    return {
      statusBarHeight: readWxStatusBarHeight() ?? 0,
      userAgent: ua,
      menuButton: readWxMenuButton(),
      platform: 'miniprogram',
    }
  }
  return {
    statusBarHeight: readH5StatusBarHeight(),
    userAgent: ua,
    menuButton: null,
    platform: 'h5',
  }
}

/** 页面/组件内导航（须在 setup 中调用） */
export function useNavigation() {
  const router = useRouter()

  function navigateTo(to: string, params?: Record<string, any>) {
    router.push({
      path: '/' + String(to).replace(/^\//, ''),
      query: (params ?? {}) as Record<string, string>,
    })
  }

  function navigateBack() {
    router.back()
  }

  return { router, navigateTo, navigateBack }
}
