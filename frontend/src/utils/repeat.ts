import type { PageData } from '../types/page-data'
import {
  DYNAMIC_STYLES_ATTR,
  V_IF_ATTR,
  V_SHOW_ATTR,
} from '../types/dynamic-styles'
import { INTERACTION_EVENT_KEYS } from '../types/page-method'
import { isSimpleBindingPath } from './binding-expr'
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
 * 仅替换简单 {item.xxx} / {item} / {index}；带 || / 三元等表达式原样保留，
 * 交给运行时 interpolateDataBindings 求值（展开期误当成路径会变成空串）。
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
    if (expr.startsWith('item.') && isSimpleBindingPath(expr)) {
      const value = getByPath(item, expr.slice('item.'.length))
      return value == null ? '' : String(value)
    }
    return match
  })
}

/**
 * 属性插值：整段 `{item}` 且值为对象时保留占位符，交给运行时按 scope 取原生对象
 *（避免 stringify 后再被误当成绑定表达式）。
 * 整段 `{item.xxx}` 若值为 number/boolean，也保留占位符，供 Component 的 number/boolean
 * props 走 resolveAttrBindingValue 取原生值（避免先烤成字符串再丢精度/空串）。
 * 非整段简单路径的表达式（如 `{item.nickname || '匿名用户'}`）原样保留。
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
  const whole = trimmed.match(/^\{([^{}]+)\}$/)
  if (whole) {
    const expr = whole[1]!.trim()
    // 复杂表达式：展开期不动，留给运行时求值
    if (!isSimpleBindingPath(expr) && expr !== 'item' && expr !== 'index') {
      return trimmed
    }
    if (expr.startsWith('item.')) {
      const value = getByPath(item, expr.slice('item.'.length))
      if (typeof value === 'number' || typeof value === 'boolean') {
        return trimmed
      }
    }
  }
  return interpolateTemplate(template, item, index)
}

function applyItemScope(node: XmlNode, item: unknown, index: number): XmlNode {
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

  // 不在此处套 dynamicStyles：展开结果会被缓存，烤死的 height 等无法随 refreshing 回退。
  // XmlNodeView 渲染时按 pageData + scope 实时套用。
  return {
    tag: node.tag,
    attrs,
    text: interpolateTemplate(node.text, item, index),
    scope: { item, index },
    children: node.children.map((child) => applyItemScope(child, item, index)),
  }
}

/**
 * 编辑态未展开 repeat：挂上列表首项 scope，保留 repeat 属性（徽章 / 选中路径）。
 * 不把 {item.xxx} 烤成字面量，交给 XmlNodeView 实时插值。
 */
function withRepeatItemScope(
  node: XmlNode,
  item: unknown,
  index: number,
): XmlNode {
  return {
    tag: node.tag,
    attrs: { ...node.attrs },
    text: node.text,
    scope: { item, index },
    children: node.children.map((child) => withRepeatItemScope(child, item, index)),
  }
}

/** 编辑态：对带 repeat 的模板节点注入首项，使 {item.size} 等布局绑定生效 */
export function applyEditRepeatPreviewScope(
  node: XmlNode,
  pageData: PageData | undefined,
  dollarProps?: Record<string, unknown>,
): XmlNode {
  const listName = node.attrs.repeat?.trim()
  if (!listName) return node
  if (node.scope?.item !== undefined) return node
  const items = resolveArrayValue(pageData, listName, dollarProps)
  if (!items.length) return node
  return withRepeatItemScope(node, items[0], 0)
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

/** 数组引用身份：同引用同 length 时视为未变，避免滚动 setData 触发整表 re-expand */
const arrayEpochMap = new WeakMap<object, number>()
let arrayEpochSeq = 0

function arrayEpoch(value: unknown): string {
  if (!Array.isArray(value)) return '0'
  let id = arrayEpochMap.get(value)
  if (id == null) {
    id = ++arrayEpochSeq
    arrayEpochMap.set(value, id)
  }
  return `${id}:${value.length}`
}

/**
 * repeat 展开缓存键：仅数组型数据池字段与 $props 数组。
 * 标量（如 pullHeight / isReachTop）变化不应触发商品列表重建。
 */
export function buildRepeatExpandKey(
  pageData: PageData | undefined,
  dollarProps?: Record<string, unknown> | null,
): string {
  const parts: string[] = []
  for (const field of pageData?.fields ?? []) {
    const name = field.name.trim()
    if (!name || !Array.isArray(field.value)) continue
    parts.push(`d:${name}:${arrayEpoch(field.value)}`)
  }
  if (dollarProps) {
    for (const key of Object.keys(dollarProps).sort()) {
      const value = dollarProps[key]
      if (!Array.isArray(value)) continue
      parts.push(`p:${key}:${arrayEpoch(value)}`)
    }
  }
  return parts.join('|')
}

/**
 * 按 repeat / repeatIndex 展开子树（预览用）。
 * 仅克隆结构并写入 item scope；dynamicStyles 留给 XmlNodeView 按实时数据池套用，
 * 避免与 expand 缓存叠加后把 height 等绑死成字面量。
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
  return next
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
        result.push(applyItemScope(prepared, items[fixed], fixed))
      }
      continue
    }

    items.forEach((item, index) => {
      result.push(applyItemScope(clonePrepared(prepared), item, index))
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
