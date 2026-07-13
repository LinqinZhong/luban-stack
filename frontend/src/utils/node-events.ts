import type { XmlNode } from './xml'
import { parsePageXml } from './xml'

const EVENT_ATTRS = new Set([
  'onClick',
  'onLongClick',
  'onFocus',
  'onBlur',
  'onChange',
  'click',
  'longClick',
])

export interface NodeEvent {
  name: string
  handler: string
}

export function findNodeByPath(root: XmlNode, path: string): XmlNode | null {
  if (!path) return null
  const segments = path.split('/')
  let current: XmlNode | null = null

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    const match = /^(\d+):(.+)$/.exec(segment)
    if (!match) return null

    const index = Number(match[1])
    const tag = match[2]

    if (i === 0) {
      if (index !== 0 || root.tag !== tag) return null
      current = root
      continue
    }

    if (!current || !current.children[index] || current.children[index].tag !== tag) {
      return null
    }
    current = current.children[index]
  }

  return current
}

export function listNodeEvents(node: XmlNode): NodeEvent[] {
  return Object.entries(node.attrs)
    .filter(([name]) => EVENT_ATTRS.has(name) || name.startsWith('on'))
    .map(([name, handler]) => ({ name, handler }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function upsertNodeEvent(node: XmlNode, name: string, handler: string): void {
  node.attrs[name] = handler
}

export function removeNodeEvent(node: XmlNode, name: string): void {
  delete node.attrs[name]
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function serializeNode(node: XmlNode, indent = 0): string {
  const pad = '  '.repeat(indent)
  const attrText = Object.entries(node.attrs)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ')
  const open = attrText ? `<${node.tag} ${attrText}` : `<${node.tag}`

  if (!node.children.length && !node.text) {
    return `${pad}${open} />`
  }

  if (!node.children.length) {
    return `${pad}${open}>${escapeXml(node.text)}</${node.tag}>`
  }

  const children = node.children.map((child) => serializeNode(child, indent + 1)).join('\n')
  return `${pad}${open}>\n${children}\n${pad}</${node.tag}>`
}

export function serializePageXml(root: XmlNode): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n${serializeNode(root)}\n`
}

export function updateXmlNodeEvents(
  xml: string,
  path: string,
  events: NodeEvent[],
): string {
  const root = parsePageXml(xml)
  const node = findNodeByPath(root, path)
  if (!node) {
    throw new Error('未找到选中节点')
  }

  for (const key of Object.keys(node.attrs)) {
    if (EVENT_ATTRS.has(key) || key.startsWith('on')) {
      delete node.attrs[key]
    }
  }

  for (const event of events) {
    const name = event.name.trim()
    const handler = event.handler.trim()
    if (!name) continue
    node.attrs[name] = handler
  }

  return serializePageXml(root)
}

export const COMMON_EVENTS = [
  'onClick',
  'onLongClick',
  'onFocus',
  'onBlur',
  'onChange',
] as const
