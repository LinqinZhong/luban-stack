import type { XmlNode } from './xml'
import { parsePageXml } from './xml'

export interface TreeNodeData {
  id: string
  label: string
  tag: string
  hasRepeat?: boolean
  children?: TreeNodeData[]
}

function nodeLabel(node: XmlNode): string {
  const text = node.attrs.text || node.text
  if (text) {
    const short = text.length > 16 ? `${text.slice(0, 16)}…` : text
    return `${node.tag} · ${short}`
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
