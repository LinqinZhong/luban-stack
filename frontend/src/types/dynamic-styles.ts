export type StyleConditionOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'empty'
  | 'notEmpty'

export const STYLE_CONDITION_OP_OPTIONS: Array<{
  value: StyleConditionOp
  label: string
}> = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'contains', label: '包含' },
  { value: 'empty', label: '为空' },
  { value: 'notEmpty', label: '不为空' },
]

export interface StyleCondition {
  field: string
  op: StyleConditionOp
  value: string
}

export interface StyleScenario {
  id: string
  name: string
  conditions: StyleCondition[]
}

/** 动态样式覆盖项（与 XML 属性同名） */
export type StyleOverrides = Record<string, string>

export interface DynamicStyleState {
  id: string
  name: string
  scenarios: StyleScenario[]
  styles: StyleOverrides
}

export interface DynamicStylesConfig {
  states: DynamicStyleState[]
}

export const DYNAMIC_STYLES_ATTR = 'dynamicStyles'

/** 显示条件（不成立时隐藏但仍保留节点），JSON：{ scenarios: StyleScenario[] } */
export const V_SHOW_ATTR = 'vShow'
/** 挂载条件（不成立时不创建节点），JSON：{ scenarios: StyleScenario[] } */
export const V_IF_ATTR = 'vIf'

export interface VisibilityConditionConfig {
  scenarios: StyleScenario[]
}

export function createEmptyCondition(): StyleCondition {
  return { field: '', op: 'eq', value: '' }
}

export function createEmptyScenario(index = 1): StyleScenario {
  return {
    id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: `场景${index}`,
    conditions: [createEmptyCondition()],
  }
}

function normalizeScenario(scene: StyleScenario, index: number): StyleScenario {
  return {
    id: scene.id || `scene_${index}`,
    name: scene.name?.trim() || `场景${index}`,
    conditions: Array.isArray(scene.conditions) && scene.conditions.length
      ? scene.conditions.map((cond) => ({
          field: cond.field ?? '',
          op: (cond.op || 'eq') as StyleConditionOp,
          value: cond.value ?? '',
        }))
      : [createEmptyCondition()],
  }
}

export function parseVisibilityConditions(
  raw: string | undefined,
): VisibilityConditionConfig {
  if (!raw?.trim()) return { scenarios: [] }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return { scenarios: [] }
    const obj = parsed as {
      scenarios?: StyleScenario[]
      conditions?: StyleCondition[]
    }

    // 兼容旧格式：仅顶层 conditions → 转为单场景
    if (!Array.isArray(obj.scenarios) && Array.isArray(obj.conditions)) {
      return {
        scenarios: [
          normalizeScenario(
            {
              id: 'scene_1',
              name: '场景1',
              conditions: obj.conditions,
            },
            1,
          ),
        ],
      }
    }

    if (!Array.isArray(obj.scenarios)) return { scenarios: [] }
    return {
      scenarios: obj.scenarios
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => normalizeScenario(item, index + 1)),
    }
  } catch {
    return { scenarios: [] }
  }
}

export function serializeVisibilityConditions(
  config: VisibilityConditionConfig,
): string {
  const scenarios = (config.scenarios ?? [])
    .map((scene, index) => ({
      id: scene.id || `scene_${index + 1}`,
      name: scene.name?.trim() || `场景${index + 1}`,
      conditions: (scene.conditions ?? [])
        .filter((cond) => cond.field.trim())
        .map((cond) => ({
          field: cond.field.trim(),
          op: cond.op,
          value: cond.value,
        })),
    }))
    .filter((scene) => scene.conditions.length > 0)

  if (!scenarios.length) return ''
  return JSON.stringify({ scenarios })
}

export function createEmptyVisibilityConfig(): VisibilityConditionConfig {
  return { scenarios: [createEmptyScenario(1)] }
}

export function createEmptyState(index = 1): DynamicStyleState {
  return {
    id: `state_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: `状态${index}`,
    scenarios: [createEmptyScenario(1)],
    styles: {},
  }
}

export function parseDynamicStyles(raw: string | undefined): DynamicStylesConfig {
  if (!raw?.trim()) return { states: [] }
  try {
    const parsed = JSON.parse(raw) as unknown
    // AI 常见误写：顶层数组 [{ condition/attrs }] 或 [{ field, op, value, styles }]
    if (Array.isArray(parsed)) {
      const converted = convertLegacyDynamicStylesArray(parsed)
      if (converted) return converted
      return { states: [] }
    }
    if (!parsed || typeof parsed !== 'object') return { states: [] }
    const obj = parsed as DynamicStylesConfig & {
      states?: DynamicStyleState[]
    }
    if (!Array.isArray(obj.states)) {
      // 单对象误写成无 states 包装
      if (
        Array.isArray((obj as unknown as DynamicStyleState).scenarios) ||
        (obj as unknown as DynamicStyleState).styles
      ) {
        return {
          states: [normalizeState(obj as unknown as DynamicStyleState, 1)],
        }
      }
      return { states: [] }
    }
    return {
      states: obj.states
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => normalizeState(item, index + 1)),
    }
  } catch {
    return { states: [] }
  }
}

/** 将 AI 误写的数组形态转为标准 states 配置 */
export function convertLegacyDynamicStylesArray(
  rows: unknown[],
): DynamicStylesConfig | null {
  if (!rows.length) return null
  const states: DynamicStyleState[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const item = row as Record<string, unknown>

    let field = ''
    let op: StyleConditionOp = 'eq'
    let value = ''
    let styles: StyleOverrides = {}

    if (item.styles && typeof item.styles === 'object' && !Array.isArray(item.styles)) {
      styles = Object.fromEntries(
        Object.entries(item.styles as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string' && String(v).trim())
          .map(([k, v]) => [k, String(v).trim()]),
      )
    } else if (item.attrs && typeof item.attrs === 'object' && !Array.isArray(item.attrs)) {
      styles = Object.fromEntries(
        Object.entries(item.attrs as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string' && String(v).trim())
          .map(([k, v]) => {
            const key = k === 'backgroundColor' ? 'background' : k
            return [key, String(v).trim()]
          }),
      )
    }

    if (typeof item.field === 'string' && item.field.trim()) {
      field = item.field.trim()
      op = (typeof item.op === 'string' ? item.op : 'eq') as StyleConditionOp
      value = item.value == null ? '' : String(item.value)
    } else if (item.condition && typeof item.condition === 'object' && !Array.isArray(item.condition)) {
      const cond = item.condition as Record<string, unknown>
      field = typeof cond.field === 'string' ? cond.field.trim() : ''
      op = (typeof cond.op === 'string' ? cond.op : 'eq') as StyleConditionOp
      value = cond.value == null ? '' : String(cond.value)
    } else if (typeof item.condition === 'string' && item.condition.trim()) {
      const m = item.condition
        .trim()
        .match(/^([A-Za-z_][\w]*)\s*(==|=|!=|>=|<=|>|<)\s*(.+)$/)
      if (m) {
        field = m[1]!
        const sym = m[2]!
        op =
          sym === '!='
            ? 'neq'
            : sym === '>'
              ? 'gt'
              : sym === '>='
                ? 'gte'
                : sym === '<'
                  ? 'lt'
                  : sym === '<='
                    ? 'lte'
                    : 'eq'
        value = m[3]!.replace(/^['"]|['"]$/g, '').trim()
      }
    }

    if (!field || !Object.keys(styles).length) continue
    states.push(
      normalizeState(
        {
          id: `state_${i + 1}`,
          name: `状态${i + 1}`,
          scenarios: [
            {
              id: `scene_${i + 1}`,
              name: '场景1',
              conditions: [{ field, op, value }],
            },
          ],
          styles,
        },
        i + 1,
      ),
    )
  }
  return states.length ? { states } : null
}

function normalizeState(item: DynamicStyleState, fallbackIndex: number): DynamicStyleState {
  const scenarios = Array.isArray(item.scenarios) && item.scenarios.length
    ? item.scenarios.map((scene, i) => ({
        id: scene.id || `scene_${i + 1}`,
        name: scene.name?.trim() || `场景${i + 1}`,
        conditions: Array.isArray(scene.conditions)
          ? scene.conditions.map((cond) => ({
              field: cond.field ?? '',
              op: (cond.op || 'eq') as StyleConditionOp,
              value: cond.value ?? '',
            }))
          : [createEmptyCondition()],
      }))
    : [createEmptyScenario(1)]

  const styles: StyleOverrides = {}
  if (item.styles && typeof item.styles === 'object') {
    for (const [key, value] of Object.entries(item.styles)) {
      if (typeof value === 'string' && value.trim()) styles[key] = value.trim()
    }
  }

  return {
    id: item.id || `state_${fallbackIndex}`,
    name: item.name?.trim() || `状态${fallbackIndex}`,
    scenarios,
    styles,
  }
}

export function serializeDynamicStyles(config: DynamicStylesConfig): string {
  if (!config.states.length) return ''
  return JSON.stringify({
    states: config.states.map((state) => ({
      id: state.id,
      name: state.name,
      scenarios: state.scenarios.map((scene) => ({
        id: scene.id,
        name: scene.name,
        conditions: scene.conditions
          .filter((cond) => cond.field.trim())
          .map((cond) => ({
            field: cond.field.trim(),
            op: cond.op,
            value: cond.value,
          })),
      })),
      styles: Object.fromEntries(
        Object.entries(state.styles).filter(([, value]) => value?.trim()),
      ),
    })),
  })
}

/** 把误写在 scenario 内的 styles 提升到 state 级（运行时只认 state.styles） */
export function liftDynamicStylesFromScenarios(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed
  const obj = parsed as { states?: unknown[] }
  if (!Array.isArray(obj.states)) return parsed
  return {
    ...obj,
    states: obj.states.map((state) => {
      if (!state || typeof state !== 'object' || Array.isArray(state)) return state
      const s = state as Record<string, unknown>
      const existing = collectStyleOverrides(s.styles)
      if (Object.keys(existing).length) return state

      const scenarios = Array.isArray(s.scenarios) ? s.scenarios : []
      let lifted: StyleOverrides | null = null
      const cleaned = scenarios.map((sc) => {
        if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return sc
        const scene = { ...(sc as Record<string, unknown>) }
        const fromScene = collectStyleOverrides(scene.styles)
        if (Object.keys(fromScene).length && !lifted) lifted = fromScene
        delete scene.styles
        return scene
      })
      if (!lifted) return state
      return { ...s, scenarios: cleaned, styles: lifted }
    }),
  }
}

function collectStyleOverrides(raw: unknown): StyleOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: StyleOverrides = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim()
  }
  return out
}

/** 有条件却无 styles 覆盖 → 视为无效（AI 常写出空 styles:{}） */
export function assertDynamicStylesHaveOverrides(config: DynamicStylesConfig): void {
  for (const state of config.states) {
    const hasCondition = state.scenarios.some((sc) =>
      sc.conditions.some((c) => c.field.trim()),
    )
    if (!hasCondition) continue
    const keys = Object.keys(state.styles).filter((k) => state.styles[k]?.trim())
    if (keys.length) continue
    throw new Error(
      `dynamicStyles 状态「${state.name || state.id}」有条件但 styles 为空。styles 必须与 scenarios 平级且非空，例如 "styles":{"background":"#ffd700"}。禁止只写 conditions 不写覆盖样式（写入会被拒绝）。`,
    )
  }
}

/** StyleEditor 关心的可覆盖字段 */
export const STYLE_OVERRIDE_KEYS = [
  'width',
  'height',
  'margin',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom',
  'padding',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'background',
  'gravity',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'borderWidth',
  'borderColor',
  'overflow',
  'zIndex',
  'text',
  'textSize',
  'textColor',
  'value',
  'placeholder',
  'color',
  'rotateX',
  'rotateY',
  'rotateZ',
] as const

export type StyleOverrideKey = (typeof STYLE_OVERRIDE_KEYS)[number]
