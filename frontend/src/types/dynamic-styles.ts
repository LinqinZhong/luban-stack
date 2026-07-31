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
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as DynamicStylesConfig).states)) {
      return { states: [] }
    }
    return {
      states: (parsed as DynamicStylesConfig).states
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => normalizeState(item, index + 1)),
    }
  } catch {
    return { states: [] }
  }
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
