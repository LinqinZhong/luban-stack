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

export interface DynamicStyleScope {
  item?: unknown
  index?: number
  /** 组件入参：$props.xxx */
  $props?: Record<string, unknown>
  /** 路由参数：$route.xxx */
  $route?: Record<string, unknown>
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
  if (raw === '$route' || raw === 'route') return scope?.$route
  if (raw.startsWith('$route.')) {
    return walkTokens(scope?.$route, tokenizePath(raw.slice('$route.'.length)))
  }
  if (raw.startsWith('route.')) {
    return walkTokens(scope?.$route, tokenizePath(raw.slice('route.'.length)))
  }

  if (!pageData) return undefined
  const tokens = tokenizePath(raw)
  if (!tokens.length || tokens[0].kind !== 'key') return undefined
  if (tokens[0].value === DOLLAR_PROPS_NAME || tokens[0].value === '$route') {
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

/**
 * 替换属性/文本中的 `{字段}`：数据池 / item / index / $route 等。
 * 解析不到的占位符原样保留（如待后续处理的 {$props.xxx}）。
 */
export function interpolateDataBindings(
  template: string,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): string {
  if (!template || !template.includes('{')) return template
  return template.replace(/\{([^{}]+)\}/g, (match, rawExpr: string) => {
    const expr = rawExpr.trim()
    if (!expr) return match
    // $props 留给 interpolateDollarProps，避免宿主组装 $props 时自引用
    if (
      expr === '$props' ||
      expr === 'props' ||
      expr.startsWith('$props.') ||
      expr.startsWith('props.')
    ) {
      return match
    }
    const value = resolveConditionValue(expr, pageData, scope)
    if (value === undefined) return match
    return formatBindingValue(value)
  })
}

function compareValues(op: StyleConditionOp, left: unknown, right: string): boolean {
  switch (op) {
    case 'empty':
      return left == null || left === '' || (Array.isArray(left) && left.length === 0)
    case 'notEmpty':
      return !(left == null || left === '' || (Array.isArray(left) && left.length === 0))
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

/**
 * 条件列表：全部 AND。
 * 无有效条件 → true。
 * 编辑态缺 scope 时，依赖 index/item 的条件跳过（视为 true），避免误藏模板节点。
 */
export function evaluateConditionList(
  conditions: StyleCondition[] | undefined,
  pageData: PageData | undefined,
  scope?: DynamicStyleScope,
): boolean {
  const active = (conditions ?? []).filter((cond) => cond.field.trim())
  if (!active.length) return true
  return active.every((cond) => {
    if (!scope && conditionNeedsRepeatScope(cond.field)) return true
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
