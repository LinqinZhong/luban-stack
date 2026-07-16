import type { XmlNode } from './xml'
import { FRAGMENT_TAG, isFragmentTag, parsePageXml } from './xml'
import { countNodeEventBindings } from '../types/page-method'
import { STATUS_BAR_NODE_ID } from './status-bar'

export interface TreeNodeData {
  id: string
  label: string
  tag: string
  hasRepeat?: boolean
  eventBindingCount?: number
  children?: TreeNodeData[]
}

function statusBarTreeNode(): TreeNodeData {
  return {
    id: STATUS_BAR_NODE_ID,
    label: '状态栏 StatusBar',
    tag: 'StatusBar',
    children: [],
  }
}

function nodeLabel(node: XmlNode): string {
  const name = node.attrs.name?.trim()
  if (name) {
    return name.length > 20 ? `${name.slice(0, 20)}…` : name
  }
  const text = node.attrs.text || node.text
  if (text) {
    const short = text.length > 16 ? `${text.slice(0, 16)}…` : text
    return `${node.tag} · ${short}`
  }
  if (node.tag === 'Image') {
    const label = node.attrs.alt || node.attrs.src
    if (label) {
      const short = label.length > 16 ? `${label.slice(0, 16)}…` : label
      return `${node.tag} · ${short}`
    }
  }
  if (node.tag === 'Icon') {
    const iconId = node.attrs.iconId?.trim()
    if (iconId) {
      const short = iconId.length > 16 ? `${iconId.slice(0, 16)}…` : iconId
      return `${node.tag} · ${short}`
    }
  }
  if (node.tag === 'Component') {
    const id = node.attrs.componentId?.trim() || node.attrs.name?.trim()
    if (id) {
      const short = id.length > 16 ? `${id.slice(0, 16)}…` : id
      return `${node.tag} · ${short}`
    }
  }
  if (node.tag === 'LinearLayout') {
    const orientation = node.attrs.orientation || 'vertical'
    return `${node.tag} (${orientation})`
  }
  if (node.tag === 'Swiper') {
    const n = node.children.length
    return n ? `${node.tag} · ${n}页` : node.tag
  }
  if (node.tag === 'Modal') {
    return '弹层 Modal'
  }
  return node.tag
}

function toTreeNode(node: XmlNode, path: string): TreeNodeData {
  return {
    id: path,
    label: nodeLabel(node),
    tag: node.tag,
    hasRepeat: Boolean(node.attrs.repeat?.trim()),
    eventBindingCount: countNodeEventBindings(node.attrs),
    children: node.children.map((child, index) =>
      toTreeNode(child, `${path}/${index}:${child.tag}`),
    ),
  }
}

export function buildWidgetTree(
  xml: string,
  options?: { includeStatusBar?: boolean },
): {
  tree: TreeNodeData[]
  error: string
} {
  if (!xml.trim()) {
    return { tree: [], error: '页面 XML 为空' }
  }

  try {
    const root = parsePageXml(xml)
    const includeStatusBar = Boolean(options?.includeStatusBar)
    // Fragment 多根：树中平铺顶层子节点
    if (isFragmentTag(root.tag)) {
      const children = root.children.map((child, index) =>
        toTreeNode(child, `0:${FRAGMENT_TAG}/${index}:${child.tag}`),
      )
      return {
        tree: includeStatusBar ? [statusBarTreeNode(), ...children] : children,
        error: '',
      }
    }
    const pageTree = [toTreeNode(root, `0:${root.tag}`)]
    return {
      tree: includeStatusBar ? [statusBarTreeNode(), ...pageTree] : pageTree,
      error: '',
    }
  } catch (err) {
    return {
      tree: [],
      error: err instanceof Error ? err.message : 'XML 解析失败',
    }
  }
}

/** el-tree-select / 级联选择用 */
export interface WidgetTreeSelectNode {
  value: string
  label: string
  children?: WidgetTreeSelectNode[]
}

function toSelectNode(node: TreeNodeData): WidgetTreeSelectNode {
  return {
    value: node.id,
    label: node.label,
    children: node.children?.length
      ? node.children.map(toSelectNode)
      : undefined,
  }
}

/** 将控件树转为 TreeSelect 数据；值为节点 path id */
export function buildWidgetTreeSelectData(xml: string): WidgetTreeSelectNode[] {
  const { tree } = buildWidgetTree(xml)
  return tree.map(toSelectNode)
}
