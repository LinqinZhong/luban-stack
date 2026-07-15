/** 页面/组件生命周期钩子（顺序与 Vue 近似） */
export const LIFECYCLE_HOOKS = [
  { key: 'onInit', label: '初始化时' },
  { key: 'onBeforeCreate', label: '创建前' },
  { key: 'onCreated', label: '创建完成' },
  { key: 'onBeforeMount', label: '挂载前' },
  { key: 'onMounted', label: '挂载完成' },
  { key: 'onBeforeUpdate', label: '更新前' },
  { key: 'onUpdated', label: '更新完成' },
  { key: 'onBeforeUnmount', label: '即将卸载' },
  { key: 'onUnmounted', label: '卸载完成' },
] as const

export type LifecycleHookKey = (typeof LIFECYCLE_HOOKS)[number]['key']

/** 各钩子存 EventMethodBinding JSON 字符串（与控件事件相同格式） */
export type LifecycleConfig = Partial<Record<LifecycleHookKey, string>>

export const LIFECYCLE_MOUNT_KEYS: LifecycleHookKey[] = [
  'onInit',
  'onBeforeCreate',
  'onCreated',
  'onBeforeMount',
  'onMounted',
]

export const LIFECYCLE_UPDATE_KEYS: LifecycleHookKey[] = [
  'onBeforeUpdate',
  'onUpdated',
]

export const LIFECYCLE_UNMOUNT_KEYS: LifecycleHookKey[] = [
  'onBeforeUnmount',
  'onUnmounted',
]

export function createEmptyLifecycleConfig(): LifecycleConfig {
  return {}
}

export function normalizeLifecycleConfig(input: unknown): LifecycleConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return createEmptyLifecycleConfig()
  }
  const src = input as Record<string, unknown>
  const next: LifecycleConfig = {}
  for (const { key } of LIFECYCLE_HOOKS) {
    const value = src[key]
    if (typeof value === 'string' && value.trim()) {
      next[key] = value
    }
  }
  return next
}
