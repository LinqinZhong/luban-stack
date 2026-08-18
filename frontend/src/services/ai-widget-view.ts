import {
  INTERACTION_EVENT_KEYS,
  parseEventBindings,
  serializeEventBindings,
  type EventMethodBinding,
} from '../types/page-method'
import {
  DYNAMIC_STYLES_ATTR,
  assertDynamicStylesHaveOverrides,
  convertLegacyDynamicStylesArray,
  liftDynamicStylesFromScenarios,
  parseDynamicStyles,
  serializeDynamicStyles,
} from '../types/dynamic-styles'
import { parsePageXml, type XmlNode } from '../utils/xml'

const EVENT_ATTR_ALIASES: Record<string, string> = {
  click: 'onClick',
  longclick: 'onLongClick',
  longClick: 'onLongClick',
  onlongclick: 'onLongClick',
}

const EVENT_ATTR_SET = new Set<string>([
  ...INTERACTION_EVENT_KEYS,
  ...Object.keys(EVENT_ATTR_ALIASES),
  ...Object.values(EVENT_ATTR_ALIASES),
])

function isEventAttrName(name: string): boolean {
  return EVENT_ATTR_SET.has(name) || name.startsWith('on')
}

function newBindId(): string {
  return `bind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function paramsArrayToArgs(
  method: string,
  params: unknown[],
): Record<string, string> {
  if (method === 'inputDigit' && params[0] != null) {
    return { digit: String(params[0]) }
  }
  if (method === 'inputOperator' && params[0] != null) {
    return { op: String(params[0]) }
  }
  if (params.length === 1 && params[0] != null) {
    return { value: String(params[0]) }
  }
  const out: Record<string, string> = {}
  params.forEach((p, i) => {
    if (p != null) out[`arg${i}`] = String(p)
  })
  return out
}

function coerceBinding(item: unknown, index: number): EventMethodBinding | null {
  if (typeof item === 'string') {
    const method = item.trim()
    if (!method) return null
    return { id: newBindId(), method, args: {} }
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const row = item as Record<string, unknown>
  const method = String(row.method ?? row.name ?? '').trim()
  if (!method) return null

  let args: Record<string, string> = {}
  if (row.args && typeof row.args === 'object' && !Array.isArray(row.args)) {
    args = Object.fromEntries(
      Object.entries(row.args as Record<string, unknown>).map(([k, v]) => [
        k,
        v == null ? '' : String(v),
      ]),
    )
  } else if (Array.isArray(row.params)) {
    args = paramsArrayToArgs(method, row.params)
  }

  const binding: EventMethodBinding = {
    id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : newBindId(),
    method,
    args,
  }
  if (method === '__custom__' || typeof row.body === 'string') {
    binding.body = typeof row.body === 'string' ? row.body : ''
  }
  // 丢弃 type:call 等无效字段；index 仅用于稳定 id 回退
  void index
  return binding
}

/** 把 AI 常见的错误事件 JSON 纠正为平台 EventMethodBinding 序列化结果 */
export function normalizeEventBindingsRaw(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === 'object') {
        const one = coerceBinding(parsed, 0)
        return one ? serializeEventBindings([one]) : trimmed
      }
      if (typeof parsed === 'string' && parsed.trim()) {
        return serializeEventBindings([
          { id: newBindId(), method: parsed.trim(), args: {} },
        ])
      }
      return trimmed
    }
    const list = parsed
      .map((item, i) => coerceBinding(item, i))
      .filter((item): item is EventMethodBinding => Boolean(item))
    return list.length ? serializeEventBindings(list) : ''
  } catch {
    // 纯方法名
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
      return serializeEventBindings([
        { id: newBindId(), method: trimmed, args: {} },
      ])
    }
    return trimmed
  }
}

/**
 * 写入前规范化控件属性：
 * - click → onClick 等别名
 * - 事件值纠正为 [{ id, method, args }]
 */
export function normalizeWidgetAttrsForAi(
  attrs: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(attrs)) {
    const key = EVENT_ATTR_ALIASES[rawKey] ?? rawKey
    if (!rawValue) {
      next[key] = ''
      continue
    }
    if (isEventAttrName(key) || isEventAttrName(rawKey)) {
      next[key] = normalizeEventBindingsRaw(rawValue)
      continue
    }
    next[key] = rawValue
  }
  // 平台控件背景属性是 background；backgroundColor 仅用于状态栏等配置
  if (Object.prototype.hasOwnProperty.call(next, 'backgroundColor')) {
    const bg = (next.backgroundColor ?? '').trim()
    if (bg && !(next.background ?? '').trim()) {
      next.background = bg
    }
    delete next.backgroundColor
  }

  if (Object.prototype.hasOwnProperty.call(next, DYNAMIC_STYLES_ATTR)) {
    next[DYNAMIC_STYLES_ATTR] = normalizeDynamicStylesRaw(
      next[DYNAMIC_STYLES_ATTR] ?? '',
    )
  }
  return next
}

/** 纠正 AI 误写的 dynamicStyles；无法识别或 styles 空时抛错，避免静默无效果 */
export function normalizeDynamicStylesRaw(raw: string): string {
  const text = (raw ?? '').trim()
  if (!text) return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(
      'dynamicStyles 必须是合法 JSON。正确格式：{"states":[{"id":"s1","name":"按压","scenarios":[{"id":"sc1","name":"匹配","conditions":[{"field":"pressedKey","op":"eq","value":"7"}]}],"styles":{"background":"#555555"}}]}',
    )
  }
  if (Array.isArray(parsed)) {
    const converted = convertLegacyDynamicStylesArray(parsed)
    if (!converted) {
      throw new Error(
        'dynamicStyles 数组无法识别。请改用 {"states":[{...}]}；每项需含条件字段与 styles/attrs',
      )
    }
    assertDynamicStylesHaveOverrides(converted)
    return serializeDynamicStyles(converted)
  }
  const lifted = liftDynamicStylesFromScenarios(parsed)
  const standard = parseDynamicStyles(JSON.stringify(lifted))
  if (!standard.states.length) {
    throw new Error(
      'dynamicStyles 无效或 states 为空。正确格式：{"states":[{"id":"s1","name":"状态1","scenarios":[{"id":"sc1","name":"场景1","conditions":[{"field":"字段","op":"eq","value":"值"}]}],"styles":{"background":"#333"}}]}',
    )
  }
  assertDynamicStylesHaveOverrides(standard)
  return serializeDynamicStyles(standard)
}

export { liftDynamicStylesFromScenarios } from '../types/dynamic-styles'

/**
 * 按控件类型补齐合理尺寸，避免 AI 写 width/height=0 导致坍塌看不见。
 * fillDefaults=true（新建）时：未写 height → wrap_content；更新时只纠正已出现的 0 尺寸。
 */
export function ensureSensibleWidgetAttrs(
  attrs: Record<string, string>,
  tag?: string,
  options?: { fillDefaults?: boolean },
): Record<string, string> {
  const next = { ...attrs }
  const fillDefaults = options?.fillDefaults !== false
  const t = (tag ?? '').trim()
  const width = (next.width ?? '').trim()
  const weight = (next.weight ?? '').trim()

  // width=0 在无 weight 时几乎不可见；有 weight 时改为 match_parent 更稳妥
  if (isCollapsedSize(width)) {
    next.width = weight ? 'match_parent' : 'wrap_content'
  }

  // height=0 会把内容区塌成一条线；固定高度禁止写 0，一律改为 wrap_content
  if (isCollapsedSize((next.height ?? '').trim())) {
    next.height = 'wrap_content'
  }

  if (!fillDefaults) return next

  // 新建：未指定高度一律 wrap_content（需要固定高时 AI 须写正数像素）
  if (!next.height?.trim()) {
    next.height = 'wrap_content'
  }

  if (t === 'Button') {
    if (!next.width?.trim()) next.width = 'match_parent'
    if (!next.marginTop?.trim() && !next.margin?.trim()) {
      next.marginTop = '8'
    }
  } else if (t === 'Text') {
    if (!next.width?.trim()) next.width = 'wrap_content'
    if (!next.textColor?.trim() && !next.color?.trim()) {
      next.textColor = '#303133'
    }
  } else if (t === 'Input') {
    if (!next.width?.trim()) next.width = 'match_parent'
  } else if (t === 'Image' || t === 'Icon') {
    if (!next.width?.trim()) next.width = 'wrap_content'
  } else if (
    t === 'LinearLayout' ||
    t === 'RelativeLayout' ||
    t === 'Swiper' ||
    t === 'MultiWindow' ||
    t === 'Component'
  ) {
    if (!next.width?.trim()) next.width = 'match_parent'
  }

  return next
}

/** 固定尺寸写成 0 / 0px / 0% 时会导致布局坍塌 */
function isCollapsedSize(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v) return false
  if (v === '0' || v === '0px' || v === '0%') return true
  const n = Number(v)
  return Number.isFinite(n) && n === 0
}

const OUTLINE_ATTR_KEYS = [
  'name',
  'text',
  'value',
  'orientation',
  'width',
  'height',
  'weight',
  'background',
  'textColor',
  'componentId',
  'repeat',
  'slot',
] as const

export type AiWidgetOutlineNode = {
  nodeId: string
  tag: string
  attrs?: Record<string, string>
  /** 已解析的事件绑定；含误用 click 时会标在 click_invalid */
  events?: Record<string, EventMethodBinding[] | string>
  children?: AiWidgetOutlineNode[]
}

function collectEvents(node: XmlNode): Record<string, EventMethodBinding[] | string> | undefined {
  const events: Record<string, EventMethodBinding[] | string> = {}
  for (const key of INTERACTION_EVENT_KEYS) {
    const raw = node.attrs[key]
    if (!raw?.trim()) continue
    events[key] = parseEventBindings(raw)
  }
  // 暴露误用的 click，便于助手自检
  if (node.attrs.click?.trim()) {
    events.click_invalid = node.attrs.click
  }
  if (node.attrs.longClick?.trim()) {
    events.longClick_invalid = node.attrs.longClick
  }
  return Object.keys(events).length ? events : undefined
}

function pickOutlineAttrs(attrs: Record<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const key of OUTLINE_ATTR_KEYS) {
    const v = attrs[key]
    if (v != null && v !== '') out[key] = v
  }
  // 兼容历史误写的 backgroundColor，统一展示为 background
  const legacyBg = attrs.backgroundColor?.trim()
  if (legacyBg && !out.background) out.background = legacyBg
  return Object.keys(out).length ? out : undefined
}

function walkOutline(node: XmlNode, path: string): AiWidgetOutlineNode {
  const children = node.children.map((child, index) =>
    walkOutline(child, `${path}/${index}:${child.tag}`),
  )
  const item: AiWidgetOutlineNode = {
    nodeId: path,
    tag: node.tag,
  }
  const attrs = pickOutlineAttrs(node.attrs)
  if (attrs) item.attrs = attrs
  const events = collectEvents(node)
  if (events) item.events = events
  if (children.length) item.children = children
  return item
}

/** 供 get_page / get_component：紧凑界面树（含 nodeId 与事件），避免整份 XML 截断 */
export function buildWidgetTreeForAi(xml: string): AiWidgetOutlineNode | null {
  try {
    const root = parsePageXml(xml)
    return walkOutline(root, `0:${root.tag}`)
  } catch {
    return null
  }
}

export type AiWidgetDetail = {
  nodeId: string
  tag: string
  attrs: Record<string, string>
  events: Record<string, EventMethodBinding[]>
  /** 非标准事件属性（如 click），运行时无效 */
  invalidEventAttrs?: Record<string, string>
  children: Array<{ nodeId: string; tag: string }>
}

export function getWidgetDetailForAi(
  xml: string,
  nodeId: string,
): AiWidgetDetail {
  const root = parsePageXml(xml)
  const segments = nodeId.split('/')
  let current: XmlNode | null = null

  for (let i = 0; i < segments.length; i += 1) {
    const match = /^(\d+):(.+)$/.exec(segments[i] ?? '')
    if (!match) throw new Error('nodeId 格式无效')
    const index = Number(match[1])
    const tag = match[2]!
    if (i === 0) {
      if (index !== 0 || root.tag !== tag) throw new Error('未找到选中节点')
      current = root
      continue
    }
    if (!current?.children[index] || current.children[index]!.tag !== tag) {
      throw new Error('未找到选中节点')
    }
    current = current.children[index]!
  }
  if (!current) throw new Error('未找到选中节点')

  const events: Record<string, EventMethodBinding[]> = {}
  const invalidEventAttrs: Record<string, string> = {}
  const attrs: Record<string, string> = { ...current.attrs }

  for (const [key, value] of Object.entries(current.attrs)) {
    if (key === 'click' || key === 'longClick') {
      invalidEventAttrs[key] = value
      continue
    }
    if (INTERACTION_EVENT_KEYS.includes(key as (typeof INTERACTION_EVENT_KEYS)[number])) {
      events[key] = parseEventBindings(value)
    }
  }

  const detail: AiWidgetDetail = {
    nodeId,
    tag: current.tag,
    attrs,
    events,
    children: current.children.map((child, index) => ({
      nodeId: `${nodeId}/${index}:${child.tag}`,
      tag: child.tag,
    })),
  }
  if (Object.keys(invalidEventAttrs).length) {
    detail.invalidEventAttrs = invalidEventAttrs
  }
  return detail
}
