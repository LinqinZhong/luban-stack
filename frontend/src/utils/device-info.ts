/** 与画布 `.device-status-bar` 高度一致 */
export const EDITOR_STATUS_BAR_HEIGHT = 22

/** 与画布 `.mp-capsule` 大致一致（微信胶囊布局） */
export const EDITOR_MENU_BUTTON = {
  width: 87,
  height: 32,
  /** 相对屏幕顶部 */
  top: 26,
  /** 距屏幕右缘 */
  marginRight: 7,
} as const

export type DevicePlatform = 'h5' | 'miniprogram'

/** 对齐微信 `wx.getMenuButtonBoundingClientRect()` */
export interface MenuButtonBoundingClientRect {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export interface DeviceInfo {
  /** 状态栏高度（px） */
  statusBarHeight: number
  /** User-Agent */
  userAgent: string
  /**
   * 微信小程序右上角胶囊位置与尺寸。
   * H5 / 非小程序环境为 `null`。
   */
  menuButton: MenuButtonBoundingClientRect | null
  /** 当前判定的平台 */
  platform: DevicePlatform
}

export interface GetDeviceInfoOptions {
  /**
   * 编辑器画布场景：显式传入时优先于环境探测。
   * - `h5` → menuButton 恒为 null
   * - `miniprogram` → 返回与画布一致的胶囊模拟数据
   */
  platform?: DevicePlatform
  /** 画布/视口宽度，用于计算胶囊 left/right（默认 375） */
  windowWidth?: number
}

function readUserAgent(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    return navigator.userAgent
  }
  return ''
}

function isWxMiniProgramRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & {
    __wxjs_environment?: string
    wx?: {
      getMenuButtonBoundingClientRect?: () => MenuButtonBoundingClientRect
      getWindowInfo?: () => { statusBarHeight?: number }
      getSystemInfoSync?: () => { statusBarHeight?: number }
    }
  }
  if (w.__wxjs_environment === 'miniprogram') return true
  if (w.wx && typeof w.wx.getMenuButtonBoundingClientRect === 'function') {
    return true
  }
  const ua = readUserAgent()
  return /miniProgram/i.test(ua) || /MiniProgramEnv/i.test(ua)
}

function readWxStatusBarHeight(): number | null {
  if (typeof window === 'undefined') return null
  const wx = (window as Window & { wx?: Record<string, unknown> }).wx
  if (!wx || typeof wx !== 'object') return null
  try {
    const getWindowInfo = wx.getWindowInfo as (() => { statusBarHeight?: number }) | undefined
    if (typeof getWindowInfo === 'function') {
      const n = Number(getWindowInfo()?.statusBarHeight)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch {
    // ignore
  }
  try {
    const getSystemInfoSync = wx.getSystemInfoSync as
      | (() => { statusBarHeight?: number })
      | undefined
    if (typeof getSystemInfoSync === 'function') {
      const n = Number(getSystemInfoSync()?.statusBarHeight)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch {
    // ignore
  }
  return null
}

function readWxMenuButton(): MenuButtonBoundingClientRect | null {
  if (typeof window === 'undefined') return null
  const wx = (window as Window & { wx?: Record<string, unknown> }).wx
  const fn = wx?.getMenuButtonBoundingClientRect as
    | (() => MenuButtonBoundingClientRect)
    | undefined
  if (typeof fn !== 'function') return null
  try {
    const rect = fn()
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

function buildEditorMenuButton(windowWidth: number): MenuButtonBoundingClientRect {
  const { width, height, top, marginRight } = EDITOR_MENU_BUTTON
  const right = Math.max(width, windowWidth - marginRight)
  const left = right - width
  return {
    width,
    height,
    top,
    right,
    bottom: top + height,
    left,
  }
}

function readH5StatusBarHeight(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0
  try {
    const el = document.createElement('div')
    el.style.cssText =
      'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);'
    document.body.appendChild(el)
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0
    document.body.removeChild(el)
    return pad > 0 ? Math.round(pad) : 0
  } catch {
    return 0
  }
}

/**
 * 获取设备信息：状态栏高度、UA、微信小程序胶囊（H5 下胶囊为 null）。
 */
export function getDeviceInfo(options?: GetDeviceInfoOptions): DeviceInfo {
  const explicit = options?.platform
  const windowWidth = Math.max(1, Number(options?.windowWidth) || 375)
  const ua = readUserAgent()

  if (explicit === 'h5') {
    return {
      statusBarHeight: EDITOR_STATUS_BAR_HEIGHT,
      userAgent: ua || 'VoiderEditor/H5',
      menuButton: null,
      platform: 'h5',
    }
  }

  if (explicit === 'miniprogram') {
    return {
      statusBarHeight: EDITOR_STATUS_BAR_HEIGHT,
      userAgent: ua || 'VoiderEditor/MiniProgram',
      menuButton: buildEditorMenuButton(windowWidth),
      platform: 'miniprogram',
    }
  }

  // 运行时自动探测（导出工程 / 真机）
  if (isWxMiniProgramRuntime()) {
    const menuButton = readWxMenuButton()
    const statusBarHeight = readWxStatusBarHeight() ?? EDITOR_STATUS_BAR_HEIGHT
    return {
      statusBarHeight,
      userAgent: ua,
      menuButton,
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

/** Monaco / 方法体 ambient */
export function buildGetDeviceInfoAmbientDeclaration(): string {
  return [
    'interface MenuButtonBoundingClientRect {',
    '  width: number',
    '  height: number',
    '  top: number',
    '  right: number',
    '  bottom: number',
    '  left: number',
    '}',
    'interface DeviceInfo {',
    '  statusBarHeight: number',
    '  userAgent: string',
    '  menuButton: MenuButtonBoundingClientRect | null',
    "  platform: 'h5' | 'miniprogram'",
    '}',
    'declare function getDeviceInfo(): DeviceInfo;',
  ].join('\n')
}
