import type { XmlNode } from './xml'
import { FRAGMENT_TAG, isFragmentTag, parsePageXml } from './xml'

export type WidgetTag =
  | 'Text'
  | 'Button'
  | 'Input'
  | 'Image'
  | 'Icon'
  | 'LinearLayout'
  | 'RelativeLayout'
  | 'Swiper'
  | 'MultiWindow'
  | 'Modal'
  | 'Component'
  | 'Slot'

export type MovePosition = 'before' | 'after' | 'inner'

const CONTAINER_TAGS = new Set<string>([
  'LinearLayout',
  'RelativeLayout',
  'Swiper',
  'MultiWindow',
  'Modal',
])

export function isContainerTag(tag: string): boolean {
  return CONTAINER_TAGS.has(tag)
}

/** 可挂子节点：布局容器 / Fragment / Component（插槽内容） */
export function canAcceptChildWidgets(tag: string): boolean {
  return isContainerTag(tag) || isFragmentTag(tag) || tag === 'Component'
}

/**
 * @deprecated 组件已正式支持 Fragment 多根，不再自动卸壳。
 * 保留函数以免旧调用方报错；始终原样返回。
 */
export function unwrapLegacyFragmentRoot(xml: string): {
  xml: string
  changed: boolean
} {
  return { xml, changed: false }
}

/** 将非 Fragment 根包进 Fragment，便于组件添加多个顶层节点 */
function ensureFragmentRoot(doc: Document): Element {
  const root = doc.documentElement
  if (!root) throw new Error('XML 缺少根节点')
  if (isFragmentTag(root.tagName)) return root

  const fragment = doc.createElement(FRAGMENT_TAG)
  doc.replaceChild(fragment, root)
  fragment.appendChild(root)
  return fragment
}

function isAppendParentAllowed(tag: string): boolean {
  return canAcceptChildWidgets(tag)
}

/**
 * 兼容旧标签 Mask → Modal：
 * - 重命名标签
 * - 去掉 gravity（改由相对定位 layout_*）
 * - 无 layout_* 的子节点按原 gravity 写入相对定位（默认居中）
 */
export function migrateLegacyMaskToModal(xml: string): {
  xml: string
  changed: boolean
} {
  if (!xml.trim() || (!xml.includes('<Mask') && !xml.includes('</Mask>'))) {
    return { xml, changed: false }
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) return { xml, changed: false }

  const masks = Array.from(doc.getElementsByTagName('Mask'))
  if (!masks.length) return { xml, changed: false }

  for (const el of masks) {
    const gravity = el.getAttribute('gravity')?.trim() || 'center'
    const modal = doc.createElement('Modal')
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'gravity') continue
      modal.setAttribute(attr.name, attr.value)
    }
    while (el.firstChild) {
      modal.appendChild(el.firstChild)
    }
    for (const child of Array.from(modal.children)) {
      const hasLayout = Array.from(child.attributes).some((a) =>
        a.name.startsWith('layout_'),
      )
      if (!hasLayout) applyGravityAsRelativeAttrs(child, gravity)
    }
    el.parentNode?.replaceChild(modal, el)
  }

  return { xml: serializeDoc(doc), changed: true }
}

function applyGravityAsRelativeAttrs(el: Element, gravity: string) {
  const g = gravity.trim() || 'center'
  if (g === 'center') {
    el.setAttribute('layout_centerInParent', 'true')
    return
  }
  if (g.includes('center_horizontal') || g === 'center') {
    el.setAttribute('layout_centerHorizontal', 'true')
  }
  if (g.includes('center_vertical')) {
    el.setAttribute('layout_centerVertical', 'true')
  }
  if (g.includes('left') || g.includes('start')) {
    el.setAttribute('layout_alignParentLeft', 'true')
  }
  if (g.includes('right') || g.includes('end')) {
    el.setAttribute('layout_alignParentRight', 'true')
  }
  if (g.includes('top') && !g.includes('center')) {
    el.setAttribute('layout_alignParentTop', 'true')
  }
  if (g.includes('bottom')) {
    el.setAttribute('layout_alignParentBottom', 'true')
  }
  if (
    !el.hasAttribute('layout_centerInParent') &&
    !el.hasAttribute('layout_centerHorizontal') &&
    !el.hasAttribute('layout_centerVertical') &&
    !el.hasAttribute('layout_alignParentLeft') &&
    !el.hasAttribute('layout_alignParentRight') &&
    !el.hasAttribute('layout_alignParentTop') &&
    !el.hasAttribute('layout_alignParentBottom')
  ) {
    el.setAttribute('layout_centerInParent', 'true')
  }
}

export const WIDGET_OPTIONS: Array<{
  tag: WidgetTag
  label: string
  description: string
}> = [
  { tag: 'Text', label: '文本 Text', description: '显示一段文本' },
  { tag: 'Button', label: '按钮 Button', description: '可点击按钮' },
  { tag: 'Input', label: '文本输入框 Input', description: '单行文本输入' },
  { tag: 'Image', label: '图片 Image', description: '显示网络或本地图片' },
  { tag: 'Icon', label: '图标 Icon', description: '引用图标库中的 SVG 符号' },
  { tag: 'LinearLayout', label: '线性布局 LinearLayout', description: '水平或垂直排列子控件' },
  { tag: 'RelativeLayout', label: '相对布局 RelativeLayout', description: '相对父容器定位子控件' },
  { tag: 'Swiper', label: '滑动窗口 Swiper', description: '多页横滑轮播，子控件各为一页' },
  {
    tag: 'MultiWindow',
    label: '多窗口 MultiWindow',
    description: '按数据池激活项切换显示窗口，每个子控件对应一个窗口',
  },
  {
    tag: 'Modal',
    label: '弹层 Modal',
    description: '全屏弹层（相对布局）；数据池引用后可用 .show() / .hide()',
  },
  {
    tag: 'Slot',
    label: '插槽 Slot',
    description: '组件内容插槽；父页面通过 Component 子节点注入',
  },
]

export const IMAGE_OBJECT_FIT_OPTIONS = [
  { value: 'fill', label: 'fill' },
  { value: 'contain', label: 'contain' },
  { value: 'cover', label: 'cover' },
  { value: 'none', label: 'none' },
  { value: 'scale-down', label: 'scale-down' },
] as const

export const IMAGE_LOADING_OPTIONS = [
  { value: 'eager', label: 'eager' },
  { value: 'lazy', label: 'lazy' },
] as const

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
  } else if (tag === 'Input') {
    el.setAttribute('value', '')
    el.setAttribute('placeholder', '请输入')
    el.setAttribute('textSize', '14')
    el.setAttribute('textColor', '#303133')
    el.setAttribute('background', '#ffffff')
    el.setAttribute('borderWidth', '1')
    el.setAttribute('borderColor', '#dcdfe6')
    el.setAttribute('borderRadius', '4')
    el.setAttribute('paddingLeft', '12')
    el.setAttribute('paddingRight', '12')
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', '40')
    el.setAttribute('marginTop', '8')
  } else if (tag === 'Image') {
    el.setAttribute('src', '')
    el.setAttribute('alt', '图片')
    el.setAttribute('objectFit', 'cover')
    el.setAttribute('width', '120')
    el.setAttribute('height', '80')
  } else if (tag === 'Icon') {
    el.setAttribute('iconId', 'home')
    el.setAttribute('size', '24')
    el.setAttribute('color', '#303133')
    el.setAttribute('width', 'wrap_content')
    el.setAttribute('height', 'wrap_content')
  } else if (tag === 'LinearLayout') {
    el.setAttribute('orientation', 'vertical')
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', 'wrap_content')
    el.setAttribute('padding', '8')
  } else if (tag === 'RelativeLayout') {
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', '120')
    el.setAttribute('padding', '8')
  } else if (tag === 'Swiper') {
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', '160')
    el.setAttribute('indicatorDots', 'true')
    el.setAttribute('circular', 'true')
    el.setAttribute('autoplay', 'false')
    el.setAttribute('interval', '3000')
    el.setAttribute('duration', '280')
    el.setAttribute('current', '0')
  } else if (tag === 'MultiWindow') {
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', 'match_parent')
    el.setAttribute('active', '')
  } else if (tag === 'Modal') {
    const used = new Set(
      Array.from(doc.getElementsByTagName('Modal')).map(
        (item) => item.getAttribute('name')?.trim() || '',
      ),
    )
    let name = 'modal'
    let n = 1
    while (used.has(name)) {
      n += 1
      name = `modal_${n}`
    }
    el.setAttribute('name', name)
    // Modal 始终全屏铺满，无 width/height；子节点用相对定位
    el.setAttribute('background', 'rgba(0,0,0,0.45)')
    el.setAttribute('padding', '24')
    el.setAttribute('closeOnClick', 'true')
  } else if (tag === 'Component') {
    el.setAttribute('componentId', '')
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', 'wrap_content')
  } else if (tag === 'Slot') {
    el.setAttribute('name', 'default')
    el.setAttribute('params', '[]')
    el.setAttribute('width', 'match_parent')
    el.setAttribute('height', 'wrap_content')
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
 * - allowRootSiblings（组件）：未选中时追加为顶层根节点（必要时自动包 Fragment）
 */
export function appendWidget(
  xml: string,
  selectedId: string,
  tag: WidgetTag,
  options?: {
    allowRootSiblings?: boolean
    slot?: string
    /** 选中 Slot 时：作为插槽调试子节点追加（不走父容器回退） */
    intoSlotDebug?: boolean
  },
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

  if (!selectedId && options?.allowRootSiblings) {
    parentEl = ensureFragmentRoot(doc)
    parentId = `0:${FRAGMENT_TAG}`
  } else if (!selectedId) {
    parentEl = root
    parentId = `0:${root.tagName}`
  } else {
    const selected = elementAtPath(doc, selectedId)
    if (!selected) {
      throw new Error('未找到选中节点')
    }

    if (options?.intoSlotDebug) {
      if (selected.tagName !== 'Slot') {
        throw new Error('请先选中插槽节点再添加调试元素')
      }
      parentEl = selected
      parentId = selectedId
    } else if (isAppendParentAllowed(selected.tagName) && !isFragmentTag(selected.tagName)) {
      // Fragment 不在控件树中展示，不能作为「选中容器」追加；走子节点的父级逻辑
      parentEl = selected
      parentId = selectedId
    } else if (selectedId.includes('/')) {
      parentId = selectedId.slice(0, selectedId.lastIndexOf('/'))
      parentEl = elementAtPath(doc, parentId)
    } else if (options?.allowRootSiblings) {
      // 选中真实文档根时，改为新增顶层兄弟
      parentEl = ensureFragmentRoot(doc)
      parentId = `0:${FRAGMENT_TAG}`
    } else {
      throw new Error('根节点不是布局容器，无法添加子控件，请先选中布局节点')
    }
  }

  if (!parentEl) {
    throw new Error('未找到可添加的父容器')
  }

  if (
    !isAppendParentAllowed(parentEl.tagName) &&
    !(options?.intoSlotDebug && parentEl.tagName === 'Slot')
  ) {
    throw new Error(
      '只能向 LinearLayout / RelativeLayout / Swiper / MultiWindow / Modal / Component 添加子控件',
    )
  }

  const widget = createWidgetElement(doc, tag)
  // Modal 为相对布局：新建子节点默认居中，避免弹层内容落在角落
  if (parentEl.tagName === 'Modal') {
    widget.setAttribute('layout_centerInParent', 'true')
  }
  // Component 子节点为插槽内容
  if (parentEl.tagName === 'Component') {
    const slotName = options?.slot?.trim() || 'default'
    widget.setAttribute('slot', slotName)
  }
  // MultiWindow 子节点需绑定窗口项名
  if (parentEl.tagName === 'MultiWindow') {
    const used = new Set(
      Array.from(parentEl.children).map(
        (item) => item.getAttribute('windowKey')?.trim() || '',
      ),
    )
    let key = 'window1'
    let n = 1
    while (used.has(key)) {
      n += 1
      key = `window${n}`
    }
    widget.setAttribute('windowKey', key)
    if (!widget.getAttribute('width')) {
      widget.setAttribute('width', 'match_parent')
    }
    if (!widget.getAttribute('height')) {
      widget.setAttribute('height', 'match_parent')
    }
  }
  parentEl.appendChild(widget)
  const index = parentEl.children.length - 1
  const newNodeId = childPathId(parentId, index, tag)

  return {
    xml: serializeDoc(doc),
    newNodeId,
  }
}

/** 向页面插入组件实例节点 */
export function appendComponent(
  xml: string,
  selectedId: string,
  options: {
    componentId: string
    name?: string
    width?: string
    height?: string
    allowRootSiblings?: boolean
    slot?: string
    intoSlotDebug?: boolean
  },
): { xml: string; newNodeId: string } {
  const result = appendWidget(xml, selectedId, 'Component', {
    allowRootSiblings: options.allowRootSiblings,
    slot: options.intoSlotDebug ? undefined : options.slot,
    intoSlotDebug: options.intoSlotDebug,
  })
  const patched = setNodeAttributes(result.xml, result.newNodeId, {
    componentId: options.componentId,
    name: options.name || options.componentId,
    width: options.width || 'match_parent',
    height: options.height || 'wrap_content',
  })
  return { xml: patched, newNodeId: result.newNodeId }
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

  const parent = el.parentElement
  const parentId = nodeId.slice(0, nodeId.lastIndexOf('/'))
  const siblings = Array.from(parent.children)
  const index = siblings.indexOf(el)
  parent.removeChild(el)

  // Fragment 不在控件树中：删顶层根后改选相邻兄弟，避免选中隐藏的 Fragment
  let nextSelectedId = parentId
  if (isFragmentTag(parent.tagName)) {
    const left = Array.from(parent.children)
    if (!left.length) {
      nextSelectedId = ''
    } else {
      const pick = left[Math.min(index, left.length - 1)]!
      nextSelectedId = pathIdForElement(pick)
    }
  }

  return {
    xml: serializeDoc(doc),
    parentId: nextSelectedId,
  }
}

function pathIdForElement(el: Element): string {
  const segments: string[] = []
  let current: Element | null = el
  const root = el.ownerDocument.documentElement

  while (current) {
    if (current === root) {
      segments.unshift(`0:${current.tagName}`)
      break
    }
    const parent = current.parentElement
    if (!parent) break
    const index = Array.from(parent.children).indexOf(current)
    segments.unshift(`${index}:${current.tagName}`)
    current = parent
  }

  return segments.join('/')
}

function isAncestorId(ancestorId: string, descendantId: string): boolean {
  return descendantId === ancestorId || descendantId.startsWith(`${ancestorId}/`)
}

/** 校验拖拽落点是否合法（与控件树 allow-drop 规则一致） */
export function canMoveWidget(
  sourceId: string,
  targetId: string,
  position: MovePosition,
  targetTag: string,
): string | null {
  if (!sourceId || !targetId) return '缺少拖拽节点'
  if (!sourceId.includes('/')) return '根节点不能拖拽'
  if (sourceId === targetId) return '不能拖到自身'
  if (isAncestorId(sourceId, targetId)) return '不能拖到自身的子节点内'
  if (position === 'inner') {
    if (!isContainerTag(targetTag) && targetTag !== 'Component') {
      return `${targetTag} 不支持子节点`
    }
  } else if (!targetId.includes('/')) {
    // 单根文档不可同级；组件 Fragment 下的顶层节点 id 含 /，可互为兄弟
    return '不能把控件放到根节点同级'
  }
  return null
}

/**
 * 移动控件：before/after 为同级插入，inner 为插入到目标容器末尾。
 */
export function moveWidget(
  xml: string,
  sourceId: string,
  targetId: string,
  position: MovePosition,
  options?: { slot?: string },
): { xml: string; newNodeId: string } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('XML 解析失败，无法移动控件')
  }

  const sourceEl = elementAtPath(doc, sourceId)
  const targetEl = elementAtPath(doc, targetId)
  if (!sourceEl || !targetEl) {
    throw new Error('未找到拖拽节点')
  }

  const err = canMoveWidget(sourceId, targetId, position, targetEl.tagName)
  if (err) throw new Error(err)

  // 无实际变化：已在目标容器末尾且 inner；或 before/after 相邻且已是该位置
  if (position === 'inner' && sourceEl.parentElement === targetEl) {
    const children = Array.from(targetEl.children)
    if (children[children.length - 1] === sourceEl) {
      return { xml, newNodeId: sourceId }
    }
  }
  if (position === 'before' && sourceEl.nextElementSibling === targetEl) {
    return { xml, newNodeId: sourceId }
  }
  if (position === 'after' && targetEl.nextElementSibling === sourceEl) {
    return { xml, newNodeId: sourceId }
  }

  sourceEl.parentElement?.removeChild(sourceEl)

  if (position === 'inner') {
    targetEl.appendChild(sourceEl)
    if (targetEl.tagName === 'Component') {
      const slotName = options?.slot?.trim()
      if (slotName) {
        sourceEl.setAttribute('slot', slotName)
      } else if (!sourceEl.hasAttribute('slot')) {
        sourceEl.setAttribute('slot', 'default')
      }
    }
  } else if (position === 'before') {
    targetEl.parentElement?.insertBefore(sourceEl, targetEl)
  } else {
    targetEl.parentElement?.insertBefore(sourceEl, targetEl.nextSibling)
  }

  return {
    xml: serializeDoc(doc),
    newNodeId: pathIdForElement(sourceEl),
  }
}

export const INTERACTION_EVENTS = [
  { key: 'onClick', label: '点击 (onClick)' },
  { key: 'onLongClick', label: '长按 (onLongClick)' },
] as const

const SCROLL_EVENT_PARAMS = [
  { name: 'scrollTop', type: 'number' },
  { name: 'scrollLeft', type: 'number' },
  { name: 'scrollHeight', type: 'number' },
  { name: 'scrollWidth', type: 'number' },
  { name: 'clientHeight', type: 'number' },
  { name: 'clientWidth', type: 'number' },
] as const

const TOUCH_EVENT_PARAMS = [
  { name: 'clientX', type: 'number' },
  { name: 'clientY', type: 'number' },
  { name: 'pageX', type: 'number' },
  { name: 'pageY', type: 'number' },
] as const

/** 仅 overflow=scroll 的布局容器可配置 */
export const SCROLL_INTERACTION_EVENTS = [
  { key: 'onScroll', label: '滚动', params: SCROLL_EVENT_PARAMS },
  { key: 'onScrollToLower', label: '触底', params: SCROLL_EVENT_PARAMS },
  { key: 'onScrollToUpper', label: '触顶', params: SCROLL_EVENT_PARAMS },
  { key: 'onTouchStart', label: '触摸开始', params: TOUCH_EVENT_PARAMS },
  { key: 'onTouchMove', label: '触摸移动', params: TOUCH_EVENT_PARAMS },
  { key: 'onTouchEnd', label: '触摸结束', params: TOUCH_EVENT_PARAMS },
] as const

/** @deprecated 使用 SCROLL_INTERACTION_EVENTS */
export const SCROLL_INTERACTION_EVENT = SCROLL_INTERACTION_EVENTS[0]!

export type InteractionEventKey =
  | (typeof INTERACTION_EVENTS)[number]['key']
  | (typeof SCROLL_INTERACTION_EVENTS)[number]['key']

/** 内置交互事件形参（绑定对话框 / 自定义方法签名） */
export function interactionEventParams(
  key: string,
): Array<{ name: string; type: 'number' | 'string' | 'boolean' | 'object' | 'array' | 'any' }> {
  const scroll = SCROLL_INTERACTION_EVENTS.find((item) => item.key === key)
  if (!scroll) return []
  return scroll.params.map((item) => ({ name: item.name, type: item.type }))
}

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
