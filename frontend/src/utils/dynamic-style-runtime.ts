import type { PageData } from '../types/page-data'
import {
  DYNAMIC_STYLES_ATTR,
  parseDynamicStyles,
  type StyleCondition,
  type StyleConditionOp,
  type StyleOverrides,
  type StyleScenario,
} from '../types/dynamic-styles'
import type { XmlNode } from './xml'
import { DOLLAR_PROPS_NAME } from './component-props'
import {
  evaluateBindingExpression,
  isSimpleBindingPath,
  scanBindingSpans,
  unwrapWholeBinding,
} from './binding-expr'

export interface DynamicStyleScope {
  item?: unknown
  index?: number
  /** 组件入参：$props.xxx */
  $props?: Record<string, unknown>
  /** 路由参数：$route.xxx / $query.xxx */
  $route?: Record<string, unknown>
  $query?: Record<string, unknown>
}

type PathToken = { kind: 'key'; value: string } | { kind: 'index'; value: number }

function tokenizePath(path: string): PathToken[] {
  const tokens: PathToken[] = []
  const re = /([^.\[\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(path))) {
    if (match[1] != null) tokens.push({ kind: 'key', value: match[1] })
    else if (match[2] != null) tokens.push({ kind: 'index', value: Number(match[2]) })
  }
  return tokens
}

function walkTokens(source: unknown, tokens: PathToken[]): unknown {
  let current: unknown = source
  for (const token of tokens) {
    if (current == null) return undefined
    if (token.kind === 'index') {
      if (!Array.isArray(current)) return undefined
      current = current[token.value]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[token.value]
  }
  return current
}

/** 解析条件字段：index / item.xxx / $props.xxx / 数据池路径（含 list[0].a） */
export function resolveConditionValue(
  path: string,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): unknown {
  const raw = path.trim()
  if (!raw) return undefined

  if (raw === 'index') return scope?.index
  if (raw === 'item') return scope?.item
  if (raw.startsWith('item.')) {
    return walkTokens(scope?.item, tokenizePath(raw.slice('item.'.length)))
  }
  if (raw === '$props' || raw === 'props') return scope?.$props
  if (raw.startsWith('$props.')) {
    return walkTokens(scope?.$props, tokenizePath(raw.slice('$props.'.length)))
  }
  if (raw.startsWith('props.')) {
    return walkTokens(scope?.$props, tokenizePath(raw.slice('props.'.length)))
  }
  if (raw === '$route' || raw === 'route' || raw === '$query' || raw === 'query') {
    return scope?.$route ?? scope?.$query
  }
  if (raw.startsWith('$route.')) {
    return walkTokens(
      scope?.$route ?? scope?.$query,
      tokenizePath(raw.slice('$route.'.length)),
    )
  }
  if (raw.startsWith('route.')) {
    return walkTokens(
      scope?.$route ?? scope?.$query,
      tokenizePath(raw.slice('route.'.length)),
    )
  }
  if (raw.startsWith('$query.')) {
    return walkTokens(
      scope?.$query ?? scope?.$route,
      tokenizePath(raw.slice('$query.'.length)),
    )
  }
  if (raw.startsWith('query.')) {
    return walkTokens(
      scope?.$query ?? scope?.$route,
      tokenizePath(raw.slice('query.'.length)),
    )
  }

  if (!pageData) return undefined
  const tokens = tokenizePath(raw)
  if (!tokens.length || tokens[0].kind !== 'key') return undefined
  if (
    tokens[0].value === DOLLAR_PROPS_NAME ||
    tokens[0].value === '$route' ||
    tokens[0].value === '$query'
  ) {
    return undefined
  }
  const field = pageData.fields.find((item) => item.name.trim() === tokens[0].value)
  if (!field) return undefined
  return walkTokens(field.value, tokens.slice(1))
}

function formatBindingValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

function isValidScopeIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

function buildBindingEvalScope(
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of pageData?.fields ?? []) {
    const name = field.name.trim()
    if (!name || !isValidScopeIdent(name)) continue
    out[name] = field.value
  }
  if (scope?.item !== undefined) out.item = scope.item
  if (scope?.index !== undefined) out.index = scope.index
  if (scope?.$props !== undefined) {
    out.$props = scope.$props
    out.props = scope.$props
  }
  const route = scope?.$route ?? scope?.$query
  const query = scope?.$query ?? scope?.$route
  if (route !== undefined) {
    out.$route = route
    out.route = route
  }
  if (query !== undefined) {
    out.$query = query
    out.query = query
  }
  return out
}

/**
 * 替换属性/文本中的 `{字段}` / `{表达式}`：数据池 / item / 三元 / 模板字符串等。
 * 解析不到的占位符原样保留（如待后续处理的 {$props.xxx}）。
 */
export function interpolateDataBindings(
  template: string,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): string {
  if (!template || !template.includes('{')) return template
  const spans = scanBindingSpans(template)
  if (!spans.length) return template

  const evalScope = buildBindingEvalScope(pageData, scope)
  let out = ''
  let cursor = 0
  for (const span of spans) {
    out += template.slice(cursor, span.start)
    const expr = span.expr
    cursor = span.end

    if (!expr) {
      out += template.slice(span.start, span.end)
      continue
    }

    // 整段简单 {$props.xxx}：留给 interpolateDollarProps
    if (
      expr === '$props' ||
      expr === 'props' ||
      (isSimpleBindingPath(expr) &&
        (expr.startsWith('$props.') || expr.startsWith('props.')))
    ) {
      out += template.slice(span.start, span.end)
      continue
    }

    if (isSimpleBindingPath(expr)) {
      const value = resolveConditionValue(expr, pageData, scope)
      if (value === undefined) {
        out += template.slice(span.start, span.end)
      } else {
        out += formatBindingValue(value)
      }
      continue
    }

    // 复杂表达式：三元、比较、模板字符串等
    const evaluated = evaluateBindingExpression(expr, evalScope)
    if (!evaluated.ok) {
      out += template.slice(span.start, span.end)
      continue
    }
    out += formatBindingValue(evaluated.value)
  }
  out += template.slice(cursor)
  return out
}

/**
 * 解析属性绑定为原生值（用于 Component 的 array/json props）。
 * - 整段为单个 `{expr}` → 返回 resolve 后的原值（数组/对象不 stringify）
 * - 已是 JSON 字面量（如 repeat 误 stringify 的结果）→ JSON.parse
 * - 否则走字符串插值
 * - 解析不到时返回 undefined（调用方保留默认值）
 */
export function resolveAttrBindingValue(
  raw: string,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): unknown {
  const text = raw?.trim() ?? ''
  if (!text) return undefined

  // 整段单个绑定（可含嵌套 {} / 表达式）
  const whole = unwrapWholeBinding(text)
  if (whole != null) {
    if (isSimpleBindingPath(whole) || whole === '$props' || whole === 'props') {
      const value = resolveConditionValue(whole, pageData, scope)
      if (value !== undefined) return value
    } else {
      const evaluated = evaluateBindingExpression(
        whole,
        buildBindingEvalScope(pageData, scope),
      )
      if (evaluated.ok) return evaluated.value
    }
  }

  // JSON 对象/数组字面量（含 repeat 展开后的 stringify 结果）
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    try {
      return JSON.parse(text) as unknown
    } catch {
      // fall through
    }
  }

  const interpolated = interpolateDataBindings(text, pageData, scope)
  if (interpolated === text && text.includes('{')) return undefined
  return interpolated
}

function isEmptyBindingValue(left: unknown): boolean {
  if (left == null || left === '') return true
  if (Array.isArray(left)) return left.length === 0
  if (typeof left === 'object') return Object.keys(left as object).length === 0
  return false
}

function compareValues(op: StyleConditionOp, left: unknown, right: string): boolean {
  switch (op) {
    case 'empty':
      return isEmptyBindingValue(left)
    case 'notEmpty':
      return !isEmptyBindingValue(left)
    case 'contains':
      return String(left ?? '').includes(right)
    case 'eq':
      return String(left ?? '') === String(right)
    case 'neq':
      return String(left ?? '') !== String(right)
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    default:
      return false
  }
}

export function evaluateCondition(
  condition: StyleCondition,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): boolean {
  if (!condition.field.trim()) return true
  const left = resolveConditionValue(condition.field, pageData, scope)
  return compareValues(condition.op, left, condition.value)
}

function conditionNeedsRepeatScope(field: string): boolean {
  const raw = field.trim()
  return raw === 'index' || raw === 'item' || raw.startsWith('item.')
}

/** scope 是否带有可解析的 repeat 项（仅有 $props/$route 不算） */
function hasRepeatItemScope(scope?: DynamicStyleScope): boolean {
  return scope != null && scope.item !== undefined
}

/**
 * 条件列表：全部 AND。
 * 无有效条件 → true。
 * 缺 repeat item 时，依赖 index/item 的条件跳过（视为 true），避免误藏模板节点。
 */
export function evaluateConditionList(
  conditions: StyleCondition[] | undefined,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): boolean {
  const active = (conditions ?? []).filter((cond) => cond.field.trim())
  if (!active.length) return true
  return active.every((cond) => {
    if (conditionNeedsRepeatScope(cond.field) && !hasRepeatItemScope(scope)) {
      return true
    }
    return evaluateCondition(cond, pageData, scope)
  })
}

/**
 * 场景列表：场景之间 OR，场景内条件 AND。
 * 无有效场景/条件 → true（不限制）。
 */
export function evaluateScenarios(
  scenarios: StyleScenario[] | undefined,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): boolean {
  const active = (scenarios ?? [])
    .map((scene) => ({
      ...scene,
      conditions: (scene.conditions ?? []).filter((cond) => cond.field.trim()),
    }))
    .filter((scene) => scene.conditions.length > 0)

  if (!active.length) return true

  return active.some((scene) =>
    evaluateConditionList(scene.conditions, pageData, scope),
  )
}

/** 命中的第一个状态样式（按配置顺序） */
export function resolveMatchingStyleOverrides(
  dynamicStylesRaw: string | undefined,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): StyleOverrides {
  const config = parseDynamicStyles(dynamicStylesRaw)
  for (const state of config.states) {
    const scenarios = state.scenarios.filter((scene) =>
      scene.conditions.some((cond) => cond.field.trim()),
    )
    if (!scenarios.length) continue

    const matched = scenarios.some((scene) =>
      scene.conditions
        .filter((cond) => cond.field.trim())
        .every((cond) => evaluateCondition(cond, pageData, scope)),
    )
    if (!matched) continue

    return { ...state.styles }
  }
  return {}
}

/** 将命中的动态样式合并进节点 attrs */
export function applyDynamicStyleOverrides(
  node: XmlNode,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): XmlNode {
  const overrides = resolveMatchingStyleOverrides(
    node.attrs[DYNAMIC_STYLES_ATTR],
    pageData,
    scope,
  )
  if (!Object.keys(overrides).length) return node
  return {
    ...node,
    attrs: {
      ...node.attrs,
      ...overrides,
    },
  }
}
