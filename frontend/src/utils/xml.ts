export type LayoutSize = number | 'match_parent' | 'wrap_content'

export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const SUPPORTED_TAGS = new Set([
  'Text',
  'Button',
  'Image',
  'LinearLayout',
  'RelativeLayout',
])

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

export function borderStyle(attrs: Record<string, string>): Record<string, string> {
  const style: Record<string, string> = {}

  if (attrs.borderRadius) {
    style.borderRadius = `${parseNumber(attrs.borderRadius)}px`
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
