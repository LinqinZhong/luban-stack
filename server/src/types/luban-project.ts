/** luban.json 项目配置 */
export interface LubanProjectConfig {
  /** 项目名称 */
  name: string
  /** 项目版本号 */
  version: string
  /** 作者 */
  author: string
  /** 引擎版本号 */
  engineVersion: string
  /** 画布配置 */
  canvas: {
    /** 画布宽度（px） */
    width: number
    /** 预览场景：H5 / 微信小程序 */
    scene?: 'h5' | 'miniprogram'
  }
  /** 入口页面 id（pages/ 下目录名） */
  entryPage?: string
  /**
   * @deprecated 微信 AppID 改由构建方案中的小程序应用配置
   */
  wechatAppId?: string
  /**
   * 导出前端 API 根地址字典（key: serviceName / `default` / `oss`）。
   * 构建时也可由方案 backends 生成。
   */
  apiBaseUrls?: Record<string, string>
  /**
   * @deprecated 请用 apiBaseUrls.default；仍兼容写入 default
   * 微信小程序 / 导出前端默认 API 基址
   */
  wechatApiBaseUrl?: string
}

export const ENGINE_VERSION = '1.0.0'
export const DEFAULT_CANVAS_WIDTH = 375
export const DEFAULT_PROJECT_VERSION = '0.1.0'
/** 当前项目配置文件名 */
export const LUBAN_CONFIG_FILE = 'luban.json'
/** 旧版配置文件名（打开时自动迁移） */
export const LEGACY_CONFIG_FILE = 'voider.json'

/** @deprecated 使用 LUBAN_CONFIG_FILE */
export const VOIDER_CONFIG_FILE = LUBAN_CONFIG_FILE

/** @deprecated 使用 LubanProjectConfig */
export type VoiderProjectConfig = LubanProjectConfig

export function createDefaultConfig(
  overrides: Partial<
    Pick<LubanProjectConfig, 'name' | 'version' | 'author' | 'engineVersion'>
  > & { canvasWidth?: number } = {},
): LubanProjectConfig {
  return {
    name: overrides.name?.trim() || '未命名项目',
    version: overrides.version?.trim() || DEFAULT_PROJECT_VERSION,
    author: overrides.author?.trim() || '',
    engineVersion: overrides.engineVersion?.trim() || ENGINE_VERSION,
    canvas: {
      width: overrides.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    },
  }
}

export function isValidProjectConfig(value: unknown): value is LubanProjectConfig {
  if (!value || typeof value !== 'object') return false

  const config = value as Record<string, unknown>
  const canvas = config.canvas as Record<string, unknown> | undefined

  if (
    typeof config.name !== 'string' ||
    typeof config.version !== 'string' ||
    typeof config.author !== 'string' ||
    typeof config.engineVersion !== 'string' ||
    !canvas ||
    typeof canvas.width !== 'number' ||
    !Number.isFinite(canvas.width) ||
    canvas.width <= 0
  ) {
    return false
  }

  if (
    config.entryPage !== undefined &&
    (typeof config.entryPage !== 'string' || !config.entryPage.trim())
  ) {
    return false
  }

  if (
    canvas.scene !== undefined &&
    canvas.scene !== 'h5' &&
    canvas.scene !== 'miniprogram'
  ) {
    return false
  }

  if (
    config.wechatAppId !== undefined &&
    typeof config.wechatAppId !== 'string'
  ) {
    return false
  }

  if (
    config.wechatApiBaseUrl !== undefined &&
    typeof config.wechatApiBaseUrl !== 'string'
  ) {
    return false
  }

  if (config.apiBaseUrls !== undefined) {
    if (
      !config.apiBaseUrls ||
      typeof config.apiBaseUrls !== 'object' ||
      Array.isArray(config.apiBaseUrls)
    ) {
      return false
    }
    for (const [key, value] of Object.entries(config.apiBaseUrls)) {
      if (typeof key !== 'string' || !key.trim()) return false
      if (typeof value !== 'string') return false
    }
  }

  return true
}
