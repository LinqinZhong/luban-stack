/**
 * 预览画布：检测页面内容是否超出手机屏幕，并给出溢出策略提示。
 */
import type { PreviewLayoutNode } from './page-preview-session'

/** 设计器默认手机内容区高度（与 PageCanvas .phone min-height 对齐） */
export const DEFAULT_PHONE_SCREEN_HEIGHT = 667
export const DEFAULT_STATUS_BAR_HEIGHT = 22
export const DEFAULT_NAV_BAR_HEIGHT = 44

export type ViewportOverflowReport = {
  viewportWidth: number
  viewportHeight: number
  contentWidth: number
  contentHeight: number
  overflowX: number
  overflowY: number
  /** 根布局 overflow 属性 */
  rootOverflow: 'visible' | 'hidden' | 'scroll' | ''
  overflowing: boolean
  risks: string[]
  /** 给 AI 的处置建议 */
  hint: string
}

function parseOverflowAttr(
  raw: string | undefined,
): 'visible' | 'hidden' | 'scroll' | '' {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'visible' || v === 'hidden' || v === 'scroll') return v
  return ''
}

function parseFixedPx(raw: string | undefined): number | null {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v || v === 'wrap_content' || v === 'match_parent' || v === 'auto') {
    return null
  }
  const n = Number(v.replace(/px$/i, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 粗估纵向内容高度（固定 height 相加；wrap/match 按子树估算）。
 * 仅作静态预警，真实以 DOM 测量为准。
 */
export function estimateVerticalContentHeight(node: PreviewLayoutNode): number {
  if (node.visible === false) return 0
  const selfH = parseFixedPx(node.height)
  const kids = (node.children ?? []).filter((c) => c.visible !== false)
  if (!kids.length) {
    return selfH ?? (node.tag === 'Text' || node.tag === 'Button' || node.tag === 'Input' ? 40 : 0)
  }

  const orientation = (node.orientation ?? '').trim().toLowerCase()
  const isHorizontal =
    node.tag === 'LinearLayout' && orientation === 'horizontal'
  const childHeights = kids.map((c) => estimateVerticalContentHeight(c))
  const childrenSpan = isHorizontal
    ? Math.max(0, ...childHeights)
    : childHeights.reduce((a, b) => a + b, 0)

  if (selfH != null) return Math.max(selfH, childrenSpan)
  return childrenSpan
}

export function analyzeLayoutOverflowRisks(
  layout: PreviewLayoutNode,
  options?: {
    screenHeight?: number
    statusBarHeight?: number
    navBarHeight?: number
    hasNavigationBar?: boolean
  },
): string[] {
  const screenH = options?.screenHeight ?? DEFAULT_PHONE_SCREEN_HEIGHT
  const statusH = options?.statusBarHeight ?? DEFAULT_STATUS_BAR_HEIGHT
  const navH =
    options?.hasNavigationBar === false
      ? 0
      : (options?.navBarHeight ?? DEFAULT_NAV_BAR_HEIGHT)
  const contentViewport = Math.max(200, screenH - statusH - navH)
  const estimated = estimateVerticalContentHeight(layout)
  const rootOverflow = parseOverflowAttr(layout.overflow)
  const risks: string[] = []
  if (estimated > contentViewport + 24) {
    if (rootOverflow === 'scroll') {
      // 已滚动，不算风险
    } else if (rootOverflow === 'hidden') {
      risks.push(
        `预估内容高度约 ${estimated}px，超过可视区约 ${contentViewport}px，且根布局 overflow=hidden，底部内容会被裁切`,
      )
    } else {
      risks.push(
        `预估内容高度约 ${estimated}px，超过可视区约 ${contentViewport}px，根布局未设 overflow=scroll，可能溢出屏幕`,
      )
    }
  }
  return risks
}

/** 从预览画布 DOM 测量是否溢出 */
export function measurePhoneViewportOverflow(
  root: ParentNode = document,
  options?: { rootOverflowAttr?: string },
): ViewportOverflowReport | null {
  const phone =
    (root.querySelector('.phone.is-preview') as HTMLElement | null) ||
    (root.querySelector('.phone') as HTMLElement | null)
  if (!phone) return null

  const pageLayer =
    (phone.querySelector('.phone-page-layer') as HTMLElement | null) || phone
  const rootWidget = pageLayer.querySelector(
    '[data-widget-node-id]',
  ) as HTMLElement | null

  const viewportWidth = Math.round(pageLayer.clientWidth || phone.clientWidth)
  const viewportHeight = Math.round(pageLayer.clientHeight || phone.clientHeight)
  if (viewportWidth <= 0 || viewportHeight <= 0) return null

  const measureEl = rootWidget ?? pageLayer
  const contentWidth = Math.round(
    Math.max(measureEl.scrollWidth, measureEl.offsetWidth, viewportWidth),
  )
  const contentHeight = Math.round(
    Math.max(measureEl.scrollHeight, measureEl.offsetHeight, viewportHeight),
  )

  const overflowX = Math.max(0, contentWidth - viewportWidth)
  const overflowY = Math.max(0, contentHeight - viewportHeight)

  const hasScrollPort = Boolean(pageLayer.querySelector('.overlay-scroll-port'))
  const attrOverflow = parseOverflowAttr(options?.rootOverflowAttr)
  const rootOverflow: ViewportOverflowReport['rootOverflow'] =
    hasScrollPort || attrOverflow === 'scroll'
      ? 'scroll'
      : attrOverflow || ''

  const risks: string[] = []
  const allowsScroll = rootOverflow === 'scroll'
  const overflowingRaw = overflowY > 8 || overflowX > 8

  if (overflowY > 8 && !allowsScroll) {
    risks.push(
      `内容高度 ${contentHeight}px 超出屏幕可视高度 ${viewportHeight}px（溢出约 ${overflowY}px），且未设 overflow=scroll`,
    )
  }
  if (overflowX > 8) {
    risks.push(
      `内容宽度 ${contentWidth}px 超出屏幕宽度 ${viewportWidth}px（溢出约 ${overflowX}px）`,
    )
  }

  let hint = '内容未明显超出屏幕'
  if (overflowY > 8 && !allowsScroll) {
    hint =
      '纵向溢出：列表/长表单通常给根或内容区 LinearLayout 设 overflow=scroll；单屏仪表盘应压缩高度/用 weight 分配，勿盲目滚动。拿捏不定请 ask_user。'
  } else if (overflowY > 8 && allowsScroll) {
    hint = '纵向超出但根布局已可滚动，一般可接受'
  } else if (overflowX > 8) {
    hint =
      '横向溢出：优先改布局（weight/换行/缩小固定宽），少用横向 scroll；拿捏不定请 ask_user。'
  }

  return {
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    overflowX,
    overflowY,
    rootOverflow,
    overflowing: overflowingRaw && !allowsScroll,
    risks,
    hint,
  }
}

export function mergeOverflowIntoLayoutRisks(
  layoutRisks: string[],
  layout: PreviewLayoutNode | undefined,
  measured: ViewportOverflowReport | null,
): string[] {
  const out = [...layoutRisks]
  if (layout) {
    for (const r of analyzeLayoutOverflowRisks(layout)) {
      if (!out.includes(r)) out.push(r)
    }
  }
  if (measured?.risks.length) {
    for (const r of measured.risks) {
      if (!out.includes(r)) out.push(r)
    }
  }
  return out
}
