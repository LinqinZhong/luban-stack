import {
  type DataField,
  type DataFieldValue,
  type PageData,
} from '../types/page-data'
import type { ColorPalette } from '../types/color-palette'
import { buildDollarColor } from '../types/color-palette'
import {
  getDeviceInfo as defaultGetDeviceInfo,
  type DeviceInfo,
} from './device-info'

export interface ResolveComputedOptions {
  /** 覆盖默认 getDeviceInfo（编辑器可按画布场景注入） */
  getDeviceInfo?: () => DeviceInfo
  /** 组件入参 $props（页面为空对象） */
  dollarProps?: Record<string, unknown>
  /** 页面 Query / 路由参数（$query 与 $route 同值） */
  dollarQuery?: Record<string, unknown>
  /** 画板颜色（$color.xxx） */
  colorPalette?: ColorPalette | null
}

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

function cloneValue<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

/** 在隔离函数中执行计算体；scope 中的字段名可作为自由变量引用 */
export function runComputeBody(
  body: string,
  scope: Record<string, unknown>,
): unknown {
  const names = Object.keys(scope).filter(isValidIdent)
  const values = names.map((name) => scope[name])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, `"use strict";\n${body}`)
  return fn(...values)
}

function seedScope(fields: DataField[]): Record<string, unknown> {
  const scope: Record<string, unknown> = {}
  for (const field of fields) {
    const name = field.name.trim()
    if (!name || !isValidIdent(name)) continue
    scope[name] = cloneValue(field.value)
  }
  return scope
}

export function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return Object.is(a, b)
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 计算体里实际读到的同级普通字段名（不含自身） */
function collectPlainDepsFromComputeBodies(fields: DataField[]): Set<string> {
  const names = fields
    .map((item) => item.name.trim())
    .filter((name) => Boolean(name) && isValidIdent(name))
  const deps = new Set<string>()
  for (const field of fields) {
    if (field.binding !== 'computed') continue
    const body = field.computeBody ?? ''
    if (!body.trim()) continue
    const self = field.name.trim()
    for (const name of names) {
      if (name === self) continue
      if (new RegExp(`(^|[^\\w$])${escapeRegExp(name)}(?![\\w$])`).test(body)) {
        deps.add(name)
      }
    }
  }
  return deps
}

function buildBuiltinScope(options?: ResolveComputedOptions): Record<string, unknown> {
  const query = { ...(options?.dollarQuery ?? {}) }
  return {
    getDeviceInfo: (): DeviceInfo =>
      options?.getDeviceInfo?.() ?? defaultGetDeviceInfo(),
    $color: buildDollarColor(options?.colorPalette),
    $props: options?.dollarProps ?? {},
    $query: query,
    $route: query,
  }
}

/**
 * 执行数据池中 binding === 'computed' 的字段，返回带计算结果的 PageData 副本。
 * 多趟求值，使互相依赖的计算字段有机会拿到最新值。
 */
export function resolveComputedPageData(
  data: PageData | undefined | null,
  options?: ResolveComputedOptions,
): PageData {
  const source = data?.fields ?? []
  const fields: DataField[] = source.map((item) => ({
    ...item,
    arrayFields: item.arrayFields ? [...item.arrayFields] : undefined,
    objectFields: item.objectFields ? [...item.objectFields] : undefined,
  }))

  const computedCount = fields.filter((item) => item.binding === 'computed').length
  if (!computedCount) return { fields }

  const scope = { ...buildBuiltinScope(options), ...seedScope(fields) }
  const maxPass = computedCount + 1

  for (let pass = 0; pass < maxPass; pass++) {
    let changed = false
    for (const field of fields) {
      if (field.binding !== 'computed') continue
      const body = field.computeBody?.trim()
      if (!body) continue
      const name = field.name.trim()
      try {
        // 每趟用最新字段值，并保证内置方法不被同名字段覆盖
        Object.assign(scope, seedScope(fields), buildBuiltinScope(options))
        const next = runComputeBody(body, scope) as DataFieldValue
        const prev = name && isValidIdent(name) ? scope[name] : field.value
        field.value = next as DataFieldValue
        if (name && isValidIdent(name)) {
          scope[name] = cloneValue(next)
        }
        if (!sameJson(prev, next)) changed = true
      } catch (err) {
        console.warn(`[voider] 计算字段「${name || '?'}」执行失败:`, err)
      }
    }
    if (!changed) break
  }

  return { fields }
}

/** 取单个字段在计算解析后的值（用于数据池预览） */
export function resolveFieldComputedValue(
  data: PageData,
  fieldName: string,
  options?: ResolveComputedOptions,
): DataFieldValue | undefined {
  const resolved = resolveComputedPageData(data, options)
  return resolved.fields.find((item) => item.name.trim() === fieldName.trim())?.value
}

/**
 * 从计算体中收集 `$props.xxx` 依赖。
 * - 返回 `null`：依赖整个 `$props`（如直接用 `$props` / 动态访问）
 * - 返回 Set：仅这些键变化时才需要重算
 */
export function collectDollarPropsKeysFromComputeBodies(
  data: PageData | undefined | null,
): Set<string> | null {
  const keys = new Set<string>()
  let usesWholeProps = false
  for (const field of data?.fields ?? []) {
    if (field.binding !== 'computed') continue
    const body = field.computeBody ?? ''
    if (!body.includes('$props')) continue
    for (const match of body.matchAll(/\$props\.([A-Za-z_$][\w$]*)/g)) {
      keys.add(match[1]!)
    }
    // `$props` 后不是 `.ident`（整对象或动态）→ 保守视为依赖全部
    if (/(^|[^.\w$])\$props(?!\.[A-Za-z_$])/.test(body)) {
      usesWholeProps = true
    }
  }
  if (usesWholeProps) return null
  return keys
}

/** api 可调用等不可 JSON 化的值 → 稳定可序列化标记 */
function serializeDollarPropForDeps(value: unknown): unknown {
  if (typeof value === 'function') {
    const mark = (value as { __voiderApiBinding?: string }).__voiderApiBinding
    return mark != null ? { __api: mark } : { __fn: true }
  }
  return value
}

/**
 * 从计算体中收集 `$query.xxx` / `$route.xxx` 依赖。
 * - 返回 `null`：依赖整个 query 对象
 * - 返回 Set：仅这些键变化时才需要重算
 */
export function collectDollarQueryKeysFromComputeBodies(
  data: PageData | undefined | null,
): Set<string> | null {
  const keys = new Set<string>()
  let usesWhole = false
  for (const field of data?.fields ?? []) {
    if (field.binding !== 'computed') continue
    const body = field.computeBody ?? ''
    if (!body.includes('$query') && !body.includes('$route')) continue
    for (const match of body.matchAll(/\$query\.([A-Za-z_$][\w$]*)/g)) {
      keys.add(match[1]!)
    }
    for (const match of body.matchAll(/\$route\.([A-Za-z_$][\w$]*)/g)) {
      keys.add(match[1]!)
    }
    if (/(^|[^.\w$])\$query(?!\.[A-Za-z_$])/.test(body)) usesWhole = true
    if (/(^|[^.\w$])\$route(?!\.[A-Za-z_$])/.test(body)) usesWhole = true
  }
  if (usesWhole) return null
  return keys
}

/** 供 Vue 缓存：仅当计算字段真正依赖的输入变化时字符串才变 */
export function buildComputeDepsKey(
  data: PageData | undefined | null,
  dollarProps: Record<string, unknown> | undefined | null,
  deviceInfo?: DeviceInfo | null,
  dollarQuery?: Record<string, unknown> | null,
  colorPalette?: ColorPalette | null,
): string {
  const fields = data?.fields ?? []
  const propKeys = collectDollarPropsKeysFromComputeBodies(data)
  let propsSlice: unknown
  if (!dollarProps) {
    propsSlice = null
  } else if (propKeys == null) {
    const all: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(dollarProps)) {
      all[key] = serializeDollarPropForDeps(value)
    }
    propsSlice = all
  } else {
    const slice: Record<string, unknown> = {}
    for (const key of [...propKeys].sort()) {
      slice[key] = serializeDollarPropForDeps(dollarProps[key])
    }
    propsSlice = slice
  }
  const queryKeys = collectDollarQueryKeysFromComputeBodies(data)
  let querySlice: unknown
  if (!dollarQuery) {
    querySlice = null
  } else if (queryKeys == null) {
    querySlice = { ...dollarQuery }
  } else {
    const slice: Record<string, unknown> = {}
    for (const key of [...queryKeys].sort()) {
      slice[key] = dollarQuery[key]
    }
    querySlice = slice
  }
  const deviceSlice = deviceInfo
    ? {
        platform: deviceInfo.platform,
        statusBarHeight: deviceInfo.statusBarHeight,
        menuButton: deviceInfo.menuButton,
      }
    : null
  const usesColor = fields.some(
    (item) =>
      item.binding === 'computed' &&
      (item.computeBody ?? '').includes('$color'),
  )
  const paletteSlice = usesColor
    ? (colorPalette?.colors ?? []).map((c) => [c.name, c.value])
    : null
  const bodies = fields
    .filter((item) => item.binding === 'computed')
    .map((item) => [item.name.trim(), item.computeBody ?? ''])
  // 只跟踪计算体真正读到的普通字段，避免滚动改 isReachTop 等无关标量时整池重算
  const plainDeps = collectPlainDepsFromComputeBodies(fields)
  const plain = fields
    .filter(
      (item) =>
        item.binding !== 'computed' &&
        item.type !== 'ref' &&
        plainDeps.has(item.name.trim()),
    )
    .map((item) => [item.name.trim(), item.value])
  try {
    return JSON.stringify({
      props: propsSlice,
      query: querySlice,
      device: deviceSlice,
      palette: paletteSlice,
      bodies,
      plain,
    })
  } catch {
    return String(Date.now())
  }
}
