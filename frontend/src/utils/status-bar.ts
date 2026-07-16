import type { PageData } from '../types/page-data'
import { interpolateDataBindings } from './dynamic-style-runtime'

/** 控件树 / 画布选中用的状态栏虚拟节点 id */
export const STATUS_BAR_NODE_ID = '__statusBar__'

/** 小程序 navigationBarTextStyle：黑字 / 白字 */
export type StatusBarTextStyle = 'black' | 'white'

/**
 * 页面 config 中的状态栏配置。
 * 字段可为静态值，或数据池绑定如 `{titleTextStyle}` / `{titleBarColor}`。
 */
export interface StatusBarConfig {
  /** black / white，或 `{字段}` */
  textStyle: string
  /** 色值，或 `{字段}` */
  backgroundColor: string
  /**
   * 是否与页面内容重叠（沉浸式）。
   * 布尔，或 `'true'` / `'false'`，或 `{字段}`。
   */
  cover: boolean | string
}

/** 解析绑定后用于画布渲染的结果 */
export interface ResolvedStatusBarConfig {
  textStyle: StatusBarTextStyle
  backgroundColor: string
  cover: boolean
}

export const DEFAULT_STATUS_BAR_CONFIG: StatusBarConfig = {
  textStyle: 'black',
  backgroundColor: '#ffffff',
  cover: false,
}

function looksLikeBinding(raw: string): boolean {
  return /\{[^{}]+\}/.test(raw)
}

/** 持久化用：保留绑定表达式，兼容旧 boolean cover */
export function normalizeStatusBarConfig(
  raw: Partial<StatusBarConfig> | null | undefined,
): StatusBarConfig {
  const textRaw =
    typeof raw?.textStyle === 'string' ? raw.textStyle.trim() : ''
  let textStyle = DEFAULT_STATUS_BAR_CONFIG.textStyle
  if (textRaw) {
    if (looksLikeBinding(textRaw) || textRaw === 'black' || textRaw === 'white') {
      textStyle = textRaw
    } else if (textRaw.toLowerCase() === 'white') {
      textStyle = 'white'
    } else {
      textStyle = 'black'
    }
  }

  const backgroundColor =
    typeof raw?.backgroundColor === 'string' && raw.backgroundColor.trim()
      ? raw.backgroundColor.trim()
      : DEFAULT_STATUS_BAR_CONFIG.backgroundColor

  let cover: boolean | string = DEFAULT_STATUS_BAR_CONFIG.cover
  if (typeof raw?.cover === 'boolean') {
    cover = raw.cover
  } else if (typeof raw?.cover === 'string') {
    const c = raw.cover.trim()
    if (!c) cover = false
    else if (looksLikeBinding(c) || c === 'true' || c === 'false') cover = c
    else cover = c === '1' || c.toLowerCase() === 'true'
  }

  return { textStyle, backgroundColor, cover }
}

function resolveBindingString(
  raw: string,
  pageData: PageData | undefined,
): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (!looksLikeBinding(trimmed)) return trimmed
  return interpolateDataBindings(trimmed, pageData).trim()
}

function resolveTextStyle(raw: string, pageData: PageData | undefined): StatusBarTextStyle {
  const resolved = resolveBindingString(raw, pageData).toLowerCase()
  if (resolved === 'white' || resolved.includes('white')) return 'white'
  if (resolved === '白' || resolved === '白字') return 'white'
  return 'black'
}

function resolveCover(raw: boolean | string, pageData: PageData | undefined): boolean {
  if (typeof raw === 'boolean') return raw
  const resolved = resolveBindingString(String(raw), pageData).toLowerCase()
  if (!resolved) return false
  if (resolved === 'true' || resolved === '1') return true
  if (resolved === 'false' || resolved === '0') return false
  return Boolean(resolved) && resolved !== 'false'
}

/** 结合数据池解析绑定，得到画布可用的状态栏样式 */
export function resolveStatusBarConfig(
  raw: Partial<StatusBarConfig> | null | undefined,
  pageData?: PageData,
): ResolvedStatusBarConfig {
  const cfg = normalizeStatusBarConfig(raw)
  const backgroundColor =
    resolveBindingString(cfg.backgroundColor, pageData) ||
    DEFAULT_STATUS_BAR_CONFIG.backgroundColor
  return {
    textStyle: resolveTextStyle(cfg.textStyle, pageData),
    backgroundColor,
    cover: resolveCover(cfg.cover, pageData),
  }
}

export function isStatusBarNodeId(id: string | undefined | null): boolean {
  return id === STATUS_BAR_NODE_ID
}

export function statusBarCoverIsOn(cover: boolean | string): boolean {
  if (typeof cover === 'boolean') return cover
  const c = cover.trim().toLowerCase()
  if (looksLikeBinding(cover)) return false
  return c === 'true' || c === '1'
}
