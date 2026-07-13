import type { XmlNode } from './xml'
import { parsePageXml } from './xml'

export type WidgetTag = 'Text' | 'Button' | 'LinearLayout' | 'RelativeLayout'

export const WIDGET_OPTIONS: Array<{
  tag: WidgetTag
  label: string
  description: string
}> = [
  { tag: 'Text', label: '文本 Text', description: '显示一段文本' },
  { tag: 'Button', label: '按钮 Button', description: '可点击按钮' },
  { tag: 'LinearLayout', label: '线性布局 LinearLayout', description: '水平或垂直排列子控件' },
  { tag: 'RelativeLayout', label: '相对布局 RelativeLayout', description: '相对父容器定位子控件' },
]

/** path id 形如 0:LinearLayout/1:Button */
export function findXmlNodeById(root: XmlNode, id: string): XmlNode | null {
  if (!id) return null

  const segments = id.split('/')
  let current: XmlNode = root

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    const colon = segment.indexOf(':')
    const index = Number(segment.slice(0, colon === -1 ? undefined : colon))
    const tag = colon === -1 ? segment : segment.slice(colon + 1)

    if (!Number.isInteger(index)) return null

    if (i === 0) {
      if (index !== 0 || current.tag !== tag) return null
      continue
    }

    const next = current.children.at(index)
    if (!next || next.tag !== tag) return null
    current = next
  }

  return current
}

export function findNodeFromXml(xml: string, id: string): XmlNode | null {
  try {
    const root = parsePageXml(xml)
    return findXmlNodeById(root, id)
  } catch {
    return null
  }
}

/** 选中节点的父节点 tag，根节点返回 null */
export function findParentTagFromXml(xml: string, id: string): string | null {
  if (!id || !id.includes('/')) return null
  const parentId = id.slice(0, id.lastIndexOf('/'))
  return findNodeFromXml(xml, parentId)?.tag ?? null
}

function elementAtPath(doc: Document, id: string): Element | null {
  const segments = id.split('/')
  const root = doc.documentElement
  if (!root) return null

  let current: Element = root

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    const colon = segment.indexOf(':')
    const index = Number(segment.slice(0, colon === -1 ? undefined : colon))
    const tag = colon === -1 ? segment : segment.slice(colon + 1)

    if (!Number.isInteger(index)) return null

    if (i === 0) {
      if (index !== 0 || current.tagName !== tag) return null
      continue
    }

    const next = current.children.item(index)
    if (!next || next.tagName !== tag) return null
    current = next
  }

  return current
}

function serializeDoc(doc: Document): string {
  const serialized = new XMLSerializer().serializeToString(doc)
  return serialized.startsWith('<?xml')
    ? serialized
    : `<?xml version="1.0" encoding="utf-8"?>\n${serialized}`
}

export function setNodeAttribute(
  xml: string,
  nodeId: string,
  name: string,
  value: string,
): string {
  return setNodeAttributes(xml, nodeId, { [name]: value })
}

export function setNodeAttributes(
  xml: string,
  nodeId: string,
  attrs: Record<string, string>,
): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('XML 解析失败，无法更新属性')
  }

  const el = elementAtPath(doc, nodeId)
  if (!el) {
    throw new Error('未找到选中节点')
  }

  for (const [name, value] of Object.entries(attrs)) {
    if (!value) {
      el.removeAttribute(name)
    } else {
      el.setAttribute(name, value)
    }
  }

  return serializeDoc(doc)
}

function createWidgetElement(doc: Document, tag: WidgetTag): Element {
  const el = doc.createElement(tag)

  if (tag === 'Text') {
    el.setAttribute('text', '文本')
    el.setAttribute('textSize', '14')
    el.setAttribute('textColor', '#303133')
    el.setAttribute('width', 'wrap_content')
    el.setAttribute('height', 'wrap_content')
  } else if (tag === 'Button') {
    el.setAttribute('text', '按钮')
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', '44')
    el.setAttribute('marginTop', '8')
  } else if (tag === 'LinearLayout') {
    el.setAttribute('orientation', 'vertical')
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', 'wrap_content')
    el.setAttribute('padding', '8')
  } else if (tag === 'RelativeLayout') {
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', '120')
    el.setAttribute('padding', '8')
  }

  return el
}

function childPathId(parentId: string, index: number, tag: string): string {
  return `${parentId}/${index}:${tag}`
}

/**
 * 向容器追加子控件。
 * - 选中布局容器：追加到该容器
 * - 选中叶子控件：追加到其父容器
 * - 未选中：追加到根（根必须是布局）
 */
export function appendWidget(
  xml: string,
  selectedId: string,
  tag: WidgetTag,
): { xml: string; newNodeId: string } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('XML 解析失败，无法添加控件')
  }

  const root = doc.documentElement
  if (!root) {
    throw new Error('XML 缺少根节点')
  }

  let parentEl: Element | null = null
  let parentId = ''

  if (!selectedId) {
    parentEl = root
    parentId = `0:${root.tagName}`
  } else {
    const selected = elementAtPath(doc, selectedId)
    if (!selected) {
      throw new Error('未找到选中节点')
    }

    if (selected.tagName === 'LinearLayout' || selected.tagName === 'RelativeLayout') {
      parentEl = selected
      parentId = selectedId
    } else if (selectedId.includes('/')) {
      parentId = selectedId.slice(0, selectedId.lastIndexOf('/'))
      parentEl = elementAtPath(doc, parentId)
    } else {
      throw new Error('根节点不是布局容器，无法添加子控件，请先选中布局节点')
    }
  }

  if (!parentEl) {
    throw new Error('未找到可添加的父容器')
  }

  if (parentEl.tagName !== 'LinearLayout' && parentEl.tagName !== 'RelativeLayout') {
    throw new Error('只能向 LinearLayout / RelativeLayout 添加子控件')
  }

  const widget = createWidgetElement(doc, tag)
  parentEl.appendChild(widget)
  const index = parentEl.children.length - 1
  const newNodeId = childPathId(parentId, index, tag)

  return {
    xml: serializeDoc(doc),
    newNodeId,
  }
}

/** 是否允许删除（根节点不可删） */
export function canDeleteNode(nodeId: string): boolean {
  return Boolean(nodeId && nodeId.includes('/'))
}

/**
 * 删除控件节点，返回新 XML 与建议选中的父节点 id。
 */
export function removeWidget(
  xml: string,
  nodeId: string,
): { xml: string; parentId: string } {
  if (!canDeleteNode(nodeId)) {
    throw new Error('根节点不能删除')
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('XML 解析失败，无法删除控件')
  }

  const el = elementAtPath(doc, nodeId)
  if (!el?.parentElement) {
    throw new Error('未找到要删除的节点')
  }

  const parentId = nodeId.slice(0, nodeId.lastIndexOf('/'))
  el.parentElement.removeChild(el)

  return {
    xml: serializeDoc(doc),
    parentId,
  }
}

export const INTERACTION_EVENTS = [
  { key: 'onClick', label: '点击 (onClick)' },
  { key: 'onLongClick', label: '长按 (onLongClick)' },
  { key: 'onAppear', label: '出现 (onAppear)' },
] as const

export type InteractionEventKey = (typeof INTERACTION_EVENTS)[number]['key']

export const SIZE_OPTIONS = [
  { label: 'match_parent', value: 'match_parent' },
  { label: 'wrap_content', value: 'wrap_content' },
  { label: '固定值 (px)', value: 'fixed' },
] as const

export const ORIENTATION_OPTIONS = [
  { label: '垂直 vertical', value: 'vertical' },
  { label: '水平 horizontal', value: 'horizontal' },
] as const

export const GRAVITY_OPTIONS = [
  { label: '默认', value: '' },
  { label: 'left', value: 'left' },
  { label: 'center', value: 'center' },
  { label: 'right', value: 'right' },
  { label: 'top', value: 'top' },
  { label: 'bottom', value: 'bottom' },
  { label: 'center_horizontal', value: 'center_horizontal' },
  { label: 'center_vertical', value: 'center_vertical' },
] as const

export const RELATIVE_BOOL_ATTRS = [
  { key: 'layout_alignParentLeft', label: '贴父左' },
  { key: 'layout_alignParentRight', label: '贴父右' },
  { key: 'layout_alignParentTop', label: '贴父顶' },
  { key: 'layout_alignParentBottom', label: '贴父底' },
  { key: 'layout_centerInParent', label: '居中于父' },
  { key: 'layout_centerHorizontal', label: '水平居中' },
  { key: 'layout_centerVertical', label: '垂直居中' },
] as const
