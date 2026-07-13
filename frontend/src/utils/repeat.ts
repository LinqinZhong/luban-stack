import type { PageData } from '../types/page-data'
import type { XmlNode } from './xml'

function cloneNode(node: XmlNode): XmlNode {
  return {
    tag: node.tag,
    attrs: { ...node.attrs },
    text: node.text,
    children: node.children.map(cloneNode),
  }
}

function getByPath(source: unknown, path: string): unknown {
  if (!path) return undefined
  const parts = path.split('.')
  let current: unknown = source
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * 仅替换 {item.xxx} / {item} / {index}；其他文本原样保留。
 * 示例：text="{item.name}" → "小明"；text="标题" → "标题"
 */
export function interpolateTemplate(
  template: string,
  item: unknown,
  index: number,
): string {
  if (!template || !template.includes('{')) return template
  return template.replace(/\{([^{}]+)\}/g, (match, rawExpr: string) => {
    const expr = rawExpr.trim()
    if (expr === 'index') return String(index)
    if (expr === 'item') {
      return item == null
        ? ''
        : typeof item === 'object'
          ? JSON.stringify(item)
          : String(item)
    }
    if (expr.startsWith('item.')) {
      const value = getByPath(item, expr.slice('item.'.length))
      return value == null ? '' : String(value)
    }
    // 未识别的 {xxx} 原样保留
    return match
  })
}

function applyItemScope(node: XmlNode, item: unknown, index: number): XmlNode {
  const attrs: Record<string, string> = {}
  for (const [key, value] of Object.entries(node.attrs)) {
    if (key === 'repeat' || key === 'repeatIndex') continue
    attrs[key] = interpolateTemplate(value, item, index)
  }
  return {
    tag: node.tag,
    attrs,
    text: interpolateTemplate(node.text, item, index),
    children: node.children.map((child) => applyItemScope(child, item, index)),
  }
}

function resolveArrayValue(pageData: PageData | undefined, name: string): unknown[] {
  if (!pageData || !name) return []
  const field = pageData.fields.find((item) => item.name.trim() === name)
  if (!field || field.type !== 'array') return []
  return Array.isArray(field.value) ? field.value : []
}

/**
 * 按 repeat / repeatIndex 展开子树（预览用，类似 v-for）。
 * - repeat: 数据池数组字段名
 * - repeatIndex: 可选，填写数字时只渲染该项；不填则按数组顺序全部渲染
 */
export function expandRepeatTree(
  root: XmlNode,
  pageData: PageData | undefined,
): XmlNode {
  return expandNode(root, pageData)
}

function expandNode(node: XmlNode, pageData: PageData | undefined): XmlNode {
  const next = cloneNode(node)
  next.children = expandChildren(next.children, pageData)
  return next
}

function expandChildren(
  children: XmlNode[],
  pageData: PageData | undefined,
): XmlNode[] {
  const result: XmlNode[] = []

  for (const child of children) {
    const listName = child.attrs.repeat?.trim()
    if (!listName) {
      result.push(expandNode(child, pageData))
      continue
    }

    const items = resolveArrayValue(pageData, listName)
    const indexAttr = child.attrs.repeatIndex?.trim() ?? ''

    if (indexAttr !== '') {
      const fixed = Number(indexAttr)
      if (Number.isInteger(fixed) && fixed >= 0 && fixed < items.length) {
        result.push(applyItemScope(expandNode(child, pageData), items[fixed], fixed))
      }
      continue
    }

    items.forEach((item, index) => {
      result.push(applyItemScope(expandNode(child, pageData), item, index))
    })
  }

  return result
}
