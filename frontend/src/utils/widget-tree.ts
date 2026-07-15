import type { XmlNode } from './xml'
import { parsePageXml } from './xml'
import { countNodeEventBindings } from '../types/page-method'

export interface TreeNodeData {
  id: string
  label: string
  tag: string
  hasRepeat?: boolean
  eventBindingCount?: number
  children?: TreeNodeData[]
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

export function buildWidgetTree(xml: string): {
  tree: TreeNodeData[]
  error: string
} {
  if (!xml.trim()) {
    return { tree: [], error: '页面 XML 为空' }
  }

  try {
    const root = parsePageXml(xml)
    return {
      tree: [toTreeNode(root, `0:${root.tag}`)],
      error: '',
    }
  } catch (err) {
    return {
      tree: [],
      error: err instanceof Error ? err.message : 'XML 解析失败',
    }
  }
}
