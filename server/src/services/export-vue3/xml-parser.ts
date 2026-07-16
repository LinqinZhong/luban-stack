export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text?: string
}

function isWhitespace(text: string): boolean {
  return !text || /^\s+$/.test(text)
}

function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g
  let match: RegExpExecArray | null
  while ((match = re.exec(input))) {
    const name = match[1]
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[name] = value
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }
  return attrs
}

function findTagEnd(xml: string, start: number): number {
  let i = start
  let quote: '"' | "'" | null = null
  while (i < xml.length) {
    const ch = xml[i]
    if (quote) {
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      i++
      continue
    }
    if (ch === '>') return i
    i++
  }
  return -1
}

function parseNodes(xml: string, pos: number): { nodes: XmlNode[]; pos: number } {
  const nodes: XmlNode[] = []
  let i = pos

  while (i < xml.length) {
    while (i < xml.length && /\s/.test(xml[i])) i++
    if (i >= xml.length) break

    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i)
      i = end === -1 ? xml.length : end + 3
      continue
    }

    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i)
      const text = (next === -1 ? xml.slice(i) : xml.slice(i, next)).trim()
      if (text) {
        nodes.push({ tag: '#text', attrs: {}, children: [], text })
      }
      i = next === -1 ? xml.length : next
      continue
    }

    if (xml.startsWith('</', i)) {
      const end = xml.indexOf('>', i)
      return { nodes, pos: end === -1 ? xml.length : end + 1 }
    }

    const tagEnd = findTagEnd(xml, i + 1)
    if (tagEnd === -1) break

    const header = xml.slice(i + 1, tagEnd)
    const selfClosing = /\/\s*$/.test(header)
    const headerBody = header.replace(/\/\s*$/, '').trim()
    const spaceIdx = headerBody.search(/\s/)
    const tag = (spaceIdx === -1 ? headerBody : headerBody.slice(0, spaceIdx)).trim()
    const attrPart = spaceIdx === -1 ? '' : headerBody.slice(spaceIdx)
    const attrs = parseAttributes(attrPart)

    i = tagEnd + 1

    if (selfClosing) {
      nodes.push({ tag, attrs, children: [] })
      continue
    }

    const childResult = parseNodes(xml, i)
    i = childResult.pos
    nodes.push({ tag, attrs, children: childResult.nodes })
  }

  return { nodes, pos: i }
}

/** Simple XML parser (no DOMParser) returning { tag, attrs, children, text } */
export function parseXml(xml: string): XmlNode[] {
  let source = xml.trim()
  if (source.startsWith('<?xml')) {
    const end = source.indexOf('?>')
    source = end === -1 ? source : source.slice(end + 2).trim()
  }
  return parseNodes(source, 0).nodes
}

export function findRootNode(nodes: XmlNode[]): XmlNode | null {
  for (const node of nodes) {
    if (node.tag !== '#text') return node
  }
  return null
}
