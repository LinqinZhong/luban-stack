import type { PageData } from '../types/page-data'
import {
  DYNAMIC_STYLES_ATTR,
  V_IF_ATTR,
  V_SHOW_ATTR,
} from '../types/dynamic-styles'
import { INTERACTION_EVENT_KEYS } from '../types/page-method'
import { applyDynamicStyleOverrides } from './dynamic-style-runtime'
import type { XmlNode } from './xml'

const SKIP_INTERPOLATE_ATTRS = new Set<string>([
  'repeat',
  'repeatIndex',
  DYNAMIC_STYLES_ATTR,
  V_SHOW_ATTR,
  V_IF_ATTR,
  ...INTERACTION_EVENT_KEYS,
])

function cloneNode(node: XmlNode): XmlNode {
  return {
    tag: node.tag,
    attrs: { ...node.attrs },
    text: node.text,
    children: node.children.map(cloneNode),
    scope: node.scope ? { ...node.scope } : undefined,
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
    return match
  })
}

/**
 * 属性插值：整段 `{item}` 且值为对象时保留占位符，交给运行时按 scope 取原生对象
 *（避免 stringify 后再被误当成绑定表达式）。
 */
function interpolateAttrTemplate(
  template: string,
  item: unknown,
  index: number,
): string {
  const trimmed = template.trim()
  if (
    trimmed === '{item}' &&
    item != null &&
    typeof item === 'object'
  ) {
    return '{item}'
  }
  return interpolateTemplate(template, item, index)
}

function applyItemScope(
  node: XmlNode,
  item: unknown,
  index: number,
  pageData: PageData | undefined,
): XmlNode {
  const attrs: Record<string, string> = {}
  for (const [key, value] of Object.entries(node.attrs)) {
    if (key === 'repeat' || key === 'repeatIndex') {
      // 展开后去掉，避免二次展开 / 树路径错乱
      continue
    }
    if (SKIP_INTERPOLATE_ATTRS.has(key)) {
      // 事件绑定等延迟到运行时按 scope 解析，避免破坏 JSON
      attrs[key] = value
      continue
    }
    attrs[key] = interpolateAttrTemplate(value, item, index)
  }

  const scoped: XmlNode = {
    tag: node.tag,
    attrs,
    text: interpolateTemplate(node.text, item, index),
    scope: { item, index },
    children: node.children.map((child) =>
      applyItemScope(child, item, index, pageData),
    ),
  }

  return applyDynamicStyleOverrides(scoped, pageData, { item, index })
}

function resolveArrayValue(
  pageData: PageData | undefined,
  name: string,
  dollarProps?: Record<string, unknown>,
): unknown[] {
  const key = name.trim()
  if (!key) return []
  if (key.startsWith('$props.')) {
    const path = key.slice('$props.'.length).trim()
    if (!path) return []
    const value = getByPath(dollarProps, path)
    if (Array.isArray(value)) return value
    // 兼容可迭代的响应式数组代理
    if (value != null && typeof value === 'object' && Symbol.iterator in (value as object)) {
      try {
        return Array.from(value as Iterable<unknown>)
      } catch {
        return []
      }
    }
    return []
  }
  if (!pageData) return []
  const field = pageData.fields.find((item) => item.name.trim() === key)
  if (!field || field.type !== 'array') return []
  return Array.isArray(field.value) ? field.value : []
}

/**
 * 按 repeat / repeatIndex 展开子树（预览用）。
 * 展开后写入 scope，并应用 dynamicStyles。
 * repeat 可为数据池字段名，或 `$props.xxx`（组件入参数组）。
 */
export function expandRepeatTree(
  root: XmlNode,
  pageData: PageData | undefined,
  dollarProps?: Record<string, unknown>,
): XmlNode {
  return expandNode(root, pageData, dollarProps)
}

function expandNode(
  node: XmlNode,
  pageData: PageData | undefined,
  dollarProps?: Record<string, unknown>,
): XmlNode {
  const next = cloneNode(node)
  next.children = expandChildren(next.children, pageData, dollarProps)
  return applyDynamicStyleOverrides(next, pageData, next.scope)
}

function expandChildren(
  children: XmlNode[],
  pageData: PageData | undefined,
  dollarProps?: Record<string, unknown>,
): XmlNode[] {
  const result: XmlNode[] = []

  for (const child of children) {
    const listName = child.attrs.repeat?.trim()
    if (!listName) {
      result.push(expandNode(child, pageData, dollarProps))
      continue
    }

    const items = resolveArrayValue(pageData, listName, dollarProps)
    const indexAttr = child.attrs.repeatIndex?.trim() ?? ''

    // 模板：只克隆结构，不在此处套无 scope 的动态样式
    const template = cloneNode(child)
    // 子树若还有嵌套 repeat，先让子层在 applyItemScope 前展开
    // 通过 expandNode 处理 template 的 children，但跳过自身的 dynamicStyles 无 scope 求值
    const prepared = prepareRepeatTemplate(template, pageData, dollarProps)

    if (indexAttr !== '') {
      const fixed = Number(indexAttr)
      if (Number.isInteger(fixed) && fixed >= 0 && fixed < items.length) {
        result.push(applyItemScope(prepared, items[fixed], fixed, pageData))
      }
      continue
    }

    items.forEach((item, index) => {
      result.push(applyItemScope(clonePrepared(prepared), item, index, pageData))
    })
  }

  return result
}

/** 展开模板内部嵌套 repeat，但不对本节点做无 scope 的动态样式 */
function prepareRepeatTemplate(
  node: XmlNode,
  pageData: PageData | undefined,
  dollarProps?: Record<string, unknown>,
): XmlNode {
  const next = cloneNode(node)
  next.children = expandChildren(next.children, pageData, dollarProps)
  return next
}

function clonePrepared(node: XmlNode): XmlNode {
  return cloneNode(node)
}
