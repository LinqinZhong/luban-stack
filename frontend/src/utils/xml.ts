export type LayoutSize = number | 'match_parent' | 'wrap_content'

export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
  /** 预览展开 repeat 时挂载的作用域（不写入 XML） */
  scope?: { item: unknown; index: number }
}

/** 组件多根：透明容器（控件树平铺子节点；不进控件面板） */
export const FRAGMENT_TAG = 'Fragment'

const SUPPORTED_TAGS = new Set([
  'Text',
  'Button',
  'Image',
  'Icon',
  'LinearLayout',
  'RelativeLayout',
  'Swiper',
  'Modal',
  'Component',
  FRAGMENT_TAG,
])

export function isFragmentTag(tag: string): boolean {
  return tag === FRAGMENT_TAG
}

/**
 * 整棵子树是否都应脱离文档流（不占位、不挤开兄弟）：
 * - Modal（Teleport 全屏）
 * - Fragment 且每个子节点也都是 out-of-flow
 */
export function isOutOfFlowTree(node: XmlNode): boolean {
  if (node.tag === 'Modal') return true
  if (isFragmentTag(node.tag)) {
    return (
      node.children.length > 0 && node.children.every((child) => isOutOfFlowTree(child))
    )
  }
  return false
}

export function parsePageXml(xml: string): XmlNode {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(parseError.textContent?.trim() || 'XML 解析失败')
  }

  const root = doc.documentElement
  if (!root) {
    throw new Error('XML 缺少根节点')
  }

  return elementToNode(root)
}

function elementToNode(el: Element): XmlNode {
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    attrs[attr.name] = attr.value
  }

  const children: XmlNode[] = []
  for (const child of Array.from(el.children)) {
    children.push(elementToNode(child))
  }

  return {
    tag: el.tagName,
    attrs,
    children,
    text: el.childElementCount === 0 ? (el.textContent || '').trim() : '',
  }
}

export function isSupportedTag(tag: string): boolean {
  return SUPPORTED_TAGS.has(tag)
}

export function parseSize(value: string | undefined, fallback: LayoutSize = 'wrap_content'): LayoutSize {
  if (!value) return fallback
  if (value === 'match_parent' || value === 'wrap_content') return value
  const num = Number(value.replace(/px$/i, ''))
  return Number.isFinite(num) ? num : fallback
}

export function parseNumber(value: string | undefined, fallback = 0): number {
  if (!value) return fallback
  const num = Number(value.replace(/px$/i, ''))
  return Number.isFinite(num) ? num : fallback
}

export function parseBool(value: string | undefined): boolean {
  return value === 'true'
}

export function sizeToCss(
  size: LayoutSize,
  axis: 'width' | 'height',
  parentIsHorizontal = false,
): Record<string, string> {
  if (size === 'match_parent') {
    if (axis === 'width') {
      return parentIsHorizontal
        ? { flex: '1 1 0', minWidth: '0' }
        : { width: '100%', alignSelf: 'stretch' }
    }
    return parentIsHorizontal
      ? { alignSelf: 'stretch', height: 'auto', minHeight: '100%' }
      : { height: '100%', minHeight: '100%', alignSelf: 'stretch' }
  }
  if (size === 'wrap_content') {
    return axis === 'width'
      ? { width: 'fit-content', maxWidth: '100%', flexShrink: '0' }
      : { height: 'fit-content', flexShrink: '0' }
  }
  return axis === 'width'
    ? { width: `${size}px`, flexShrink: '0' }
    : { height: `${size}px`, flexShrink: '0' }
}

export function spacingStyle(attrs: Record<string, string>): Record<string, string> {
  return {
    ...marginStyle(attrs),
    ...paddingStyle(attrs),
  }
}

export function marginStyle(attrs: Record<string, string>): Record<string, string> {
  const style: Record<string, string> = {}
  const margin = attrs.margin
  if (margin) style.margin = `${parseNumber(margin)}px`
  if (attrs.marginLeft) style.marginLeft = `${parseNumber(attrs.marginLeft)}px`
  if (attrs.marginRight) style.marginRight = `${parseNumber(attrs.marginRight)}px`
  if (attrs.marginTop) style.marginTop = `${parseNumber(attrs.marginTop)}px`
  if (attrs.marginBottom) style.marginBottom = `${parseNumber(attrs.marginBottom)}px`
  return style
}

export function paddingStyle(attrs: Record<string, string>): Record<string, string> {
  const style: Record<string, string> = {}
  const padding = attrs.padding
  if (padding) style.padding = `${parseNumber(padding)}px`
  if (attrs.paddingLeft) style.paddingLeft = `${parseNumber(attrs.paddingLeft)}px`
  if (attrs.paddingRight) style.paddingRight = `${parseNumber(attrs.paddingRight)}px`
  if (attrs.paddingTop) style.paddingTop = `${parseNumber(attrs.paddingTop)}px`
  if (attrs.paddingBottom) style.paddingBottom = `${parseNumber(attrs.paddingBottom)}px`
  return style
}

export function marginValues(attrs: Record<string, string>) {
  const all = parseNumber(attrs.margin, 0)
  return {
    top: parseNumber(attrs.marginTop, attrs.margin ? all : 0),
    right: parseNumber(attrs.marginRight, attrs.margin ? all : 0),
    bottom: parseNumber(attrs.marginBottom, attrs.margin ? all : 0),
    left: parseNumber(attrs.marginLeft, attrs.margin ? all : 0),
  }
}

export function hasMargin(attrs: Record<string, string>): boolean {
  const m = marginValues(attrs)
  return m.top > 0 || m.right > 0 || m.bottom > 0 || m.left > 0
}

/** match_parent 时扣除 margin，避免 100% + margin 溢出父容器 */
export function matchParentAxisSize(
  axis: 'width' | 'height',
  attrs: Record<string, string>,
): string {
  const m = marginValues(attrs)
  const offset = axis === 'width' ? m.left + m.right : m.top + m.bottom
  return offset > 0 ? `calc(100% - ${offset}px)` : '100%'
}

const BORDER_CORNER_ATTRS = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
] as const

/** 任一圆角属性有值时裁切内容（含四角独立圆角） */
export function hasBorderRadius(attrs: Record<string, string>): boolean {
  if (attrs.borderRadius != null && attrs.borderRadius !== '') return true
  return BORDER_CORNER_ATTRS.some(
    (key) => attrs[key] != null && attrs[key] !== '',
  )
}

export function borderStyle(attrs: Record<string, string>): Record<string, string> {
  const style: Record<string, string> = {}

  const uniform =
    attrs.borderRadius != null && attrs.borderRadius !== ''
      ? parseNumber(attrs.borderRadius)
      : null

  const corner = (key: (typeof BORDER_CORNER_ATTRS)[number]) => {
    const raw = attrs[key]
    if (raw != null && raw !== '') return parseNumber(raw)
    return uniform
  }

  const tl = corner('borderTopLeftRadius')
  const tr = corner('borderTopRightRadius')
  const br = corner('borderBottomRightRadius')
  const bl = corner('borderBottomLeftRadius')

  if (tl != null || tr != null || br != null || bl != null) {
    // 分角优先；未单独设置的角回退到统一 borderRadius，再回退 0
    style.borderTopLeftRadius = `${tl ?? 0}px`
    style.borderTopRightRadius = `${tr ?? 0}px`
    style.borderBottomRightRadius = `${br ?? 0}px`
    style.borderBottomLeftRadius = `${bl ?? 0}px`
  }

  if (attrs.borderWidth) {
    style.borderStyle = 'solid'
    style.borderWidth = `${parseNumber(attrs.borderWidth)}px`
    style.borderColor = attrs.borderColor || '#dcdfe6'
  } else if (attrs.borderColor) {
    style.border = `1px solid ${attrs.borderColor}`
  }

  return style
}

/** 布局容器溢出策略：hidden | visible | scroll，默认 hidden */
export type OverflowStrategy = 'hidden' | 'visible' | 'scroll'

export const OVERFLOW_OPTIONS: Array<{ label: string; value: OverflowStrategy }> = [
  { label: '隐藏', value: 'hidden' },
  { label: '显示', value: 'visible' },
  { label: '滚动', value: 'scroll' },
]

export function parseOverflow(
  value: string | undefined,
  fallback: OverflowStrategy = 'hidden',
): OverflowStrategy {
  const raw = value?.trim().toLowerCase()
  if (raw === 'hidden' || raw === 'visible' || raw === 'scroll') return raw
  return fallback
}

/** scroll → 纵向可滚（移动端手感），横轴默认不泄出 */
export function overflowStyle(
  attrs: Record<string, string>,
  fallback: OverflowStrategy | null = 'hidden',
): Record<string, string> {
  const raw = attrs.overflow?.trim().toLowerCase()
  const strategy =
    raw === 'hidden' || raw === 'visible' || raw === 'scroll'
      ? raw
      : fallback
  if (!strategy) return {}
  if (strategy === 'scroll') {
    return {
      overflowX: 'hidden',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      WebkitOverflowScrolling: 'touch',
      touchAction: 'pan-y',
    }
  }
  return { overflow: strategy }
}
