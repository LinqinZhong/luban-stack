import type { PageData } from '../../types/page-data.js'
import type { ComponentConfig } from '../../types/component.js'
import type { LifecycleConfig } from '../../types/lifecycle.js'
import type { PageMethod } from '../../types/page-method.js'
import type { ColorPalette } from '../../types/color-palette.js'
import {
  findPaletteColor,
  resolvePaletteColorForCss,
} from '../../types/color-palette.js'
import type { XmlNode } from '../export-vue3/xml-parser.js'
import { DEFAULT_CANVAS_WIDTH } from '../../types/luban-project.js'
import {
  isSimpleBindingPath,
  normalizeBindingOperators,
  scanBindingSpans,
  templateLiteralsToConcat,
  rewriteWxmlGlobalCalls,
  unwrapWholeBinding,
} from './binding-expr.js'
import {
  parseApiPropBinding,
  toApiPropDataValue,
  type MpApiBinding,
} from './api-runtime.js'
import { codeUsesIdent, lineComment } from './js-comments.js'
import {
  generateComponentAttached,
  generateComponentMethodFn,
  generateComputedObservers,
  generateControllerBoundPageLoad,
  generatePageSyncHandlers,
} from './method-codegen.js'
import {
  ClassRegistry,
  classAttr,
  hasWidthClass,
  hasHeightClass,
} from './wx-tw.js'
import {
  collectMpRefFields,
  modalVisibleDataKey,
  renderRefLocalVars,
  type MpRefField,
} from './wx-refs.js'

export { ClassRegistry } from './wx-tw.js'

/** 当前 codegen 使用的调色板 */
let activeColorPalette: ColorPalette | undefined

export function withColorPalette<T>(
  palette: ColorPalette | undefined,
  fn: () => T,
): T {
  const prev = activeColorPalette
  activeColorPalette = palette
  try {
    return fn()
  } finally {
    activeColorPalette = prev
  }
}

function toCssColor(value: string): string {
  return resolvePaletteColorForCss(value, activeColorPalette) ?? value
}

/** SVG tint / 导航栏等需要具体色值，不能用 var() */
function toConcreteColor(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  const varMatch = /^var\(--([a-zA-Z][a-zA-Z0-9_-]*)\)$/.exec(trimmed)
  if (varMatch) {
    const found = findPaletteColor(activeColorPalette, varMatch[1])
    if (found) return found.value
  }
  const found = findPaletteColor(activeColorPalette, trimmed)
  return found ? found.value : value
}

/** 绑定色 → WXS palette.color（CSS var） */
function wrapCssColorExpr(expr: string): string {
  return `palette.color(${expr})`
}

/** 绑定色 → WXS palette.value（具体色值） */
function wrapConcreteColorExpr(expr: string): string {
  return `palette.value(${expr})`
}

const PALETTE_WXS_IMPORT =
  '<wxs src="../../utils/palette.wxs" module="palette" />\n'
const UTIL_WXS_IMPORT =
  '<wxs src="../../utils/util.wxs" module="util" />\n'
const PAGE_WXS_IMPORTS = `${PALETTE_WXS_IMPORT}${UTIL_WXS_IMPORT}`

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 设计稿 px → 相对视口宽度（生成时算好数值）。
 * 画布宽 375、尺寸 20 → 5.333333vw（即 20/375*100）
 * 设备实测尺寸（状态栏等）勿走此函数，应保留 px。
 */
function pxToVw(value: number, designWidth: number): string {
  const w = designWidth > 0 ? designWidth : DEFAULT_CANVAS_WIDTH
  if (!Number.isFinite(value) || value === 0) return '0'
  const vw = (value / w) * 100
  return `${formatVwNumber(vw)}vw`
}

/** 绑定设计稿尺寸：预计算 100/designWidth 系数，运行时 {{expr*k}}vw */
function pxBindToVw(expr: string, designWidth: number): string {
  const w = designWidth > 0 ? designWidth : DEFAULT_CANVAS_WIDTH
  const k = formatVwNumber(100 / w)
  return `{{${expr}*${k}}}vw`
}

function formatVwNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  // 去掉多余尾零，最多保留 6 位小数
  return String(Number(n.toFixed(6)))
}

function parseSize(raw: string | undefined, designWidth: number): string | null {
  if (!raw?.trim()) return null
  const v = raw.trim()
  if (v.includes('{')) return null
  if (v === 'match_parent') return '100%'
  if (v === 'wrap_content') return 'auto'
  const n = Number(v.replace(/px$/i, ''))
  if (Number.isFinite(n)) return pxToVw(n, designWidth)
  return v
}

function isBinding(raw: string | undefined): boolean {
  return Boolean(raw && /\{[^{}]+\}/.test(raw))
}

/** `{height}` / `{$props.background}` ? ?????? null */
function styleBindingExpr(raw: string | undefined): string | null {
  if (!raw?.trim() || !isBinding(raw)) return null
  const inner = raw.trim().slice(1, -1).trim()
  if (!/^[A-Za-z_$][\w.$]*$/.test(inner)) return null
  return normalizeExpr(inner)
}

/** ????????`[{ "method": "emit", ... }]`??????WXML ???*/
function isEventBindingValue(raw: string | undefined): boolean {
  const text = raw?.trim() ?? ''
  if (!text.startsWith('[')) return false
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed) || !parsed.length) return false
    return parsed.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as { method?: unknown }).method === 'string',
    )
  } catch {
    return false
  }
}

/** ????????style?????? props */
const LAYOUT_ATTR_KEYS = new Set([
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
  'gap',
  'overflow',
  'orientation',
  'borderRadius',
  'borderWidth',
  'borderColor',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'zIndex',
  'contentShadow',
  'rotateX',
  'rotateY',
  'rotateZ',
  'name',
])

function shouldSkipComponentAttr(
  key: string,
  value: string,
  config?: ComponentConfig,
): boolean {
  if (
    key === 'componentId' ||
    key === 'repeat' ||
    key === 'repeatIndex' ||
    key === 'dynamicStyles' ||
    key === 'vIf' ||
    key === 'vShow' ||
    key === 'windowKey' ||
    key === 'active'
  ) {
    return true
  }
  if (key.startsWith('on') || key.startsWith('layout_')) return true
  if (LAYOUT_ATTR_KEYS.has(key)) {
    // TitleBar.background ??????????? prop?????
    if (config?.props?.some((p) => p.name === key)) return false
    return true
  }
  if (isEventBindingValue(value)) return true
  return false
}

type VisibilityCondition = { field: string; op: string; value: string }
type VisibilityScenario = { conditions?: VisibilityCondition[] }

function escapeWxmlStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function visibilityFieldExpr(field: string): string {
  const raw = field.trim()
  if (!raw) return "''"
  if (raw === 'index' || raw === 'item') return raw
  if (raw.startsWith('item.')) return raw
  return normalizeExpr(raw)
}

/** ????????WXML ????????????Array.isArray / String()??*/
function visibilityConditionExpr(cond: VisibilityCondition): string {
  const left = visibilityFieldExpr(cond.field)
  const right = cond.value ?? ''
  const rightLit = `'${escapeWxmlStr(right)}'`
  switch (cond.op) {
    case 'empty':
      return `(${left} == null || ${left} === '' || ${left}.length === 0)`
    case 'notEmpty':
      return `!(${left} == null || ${left} === '' || ${left}.length === 0)`
    case 'contains':
      return `((${left} + '').indexOf(${rightLit}) >= 0)`
    case 'eq':
      // 布尔：直接 loading / !loading，不再展开成 (x === true) || …
      if (right === 'true') return left
      if (right === 'false') return `!${left}`
      return `((${left} + '') === ${rightLit})`
    case 'neq':
      if (right === 'true') return `!${left}`
      if (right === 'false') return left
      return `((${left} + '') !== ${rightLit})`
    case 'gt':
      return `(${left} > ${Number(right) || 0})`
    case 'gte':
      return `(${left} >= ${Number(right) || 0})`
    case 'lt':
      return `(${left} < ${Number(right) || 0})`
    case 'lte':
      return `(${left} <= ${Number(right) || 0})`
    default:
      return 'false'
  }
}

function compileVisibilityExpr(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as { scenarios?: VisibilityScenario[] }
    return compileScenariosOrExpr(parsed.scenarios ?? [])
  } catch {
    return null
  }
}

interface DynamicStyleStateParsed {
  scenarios: VisibilityScenario[]
  styles: Record<string, string>
}

function parseDynamicStylesStates(
  raw: string | undefined,
): DynamicStyleStateParsed[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as {
      states?: Array<{
        scenarios?: VisibilityScenario[]
        styles?: Record<string, string>
      }>
    }
    if (!Array.isArray(parsed.states)) return []
    return parsed.states
      .filter((s) => s && typeof s === 'object')
      .map((s) => ({
        scenarios: Array.isArray(s.scenarios) ? s.scenarios : [],
        styles:
          s.styles && typeof s.styles === 'object'
            ? Object.fromEntries(
                Object.entries(s.styles).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === 'string' && !!entry[1].trim(),
                ),
              )
            : {},
      }))
  } catch {
    return []
  }
}

function compileScenariosOrExpr(
  scenarios: VisibilityScenario[] | undefined,
): string | null {
  const active = (scenarios ?? []).filter((s) =>
    (s.conditions ?? []).some((c) => c.field?.trim()),
  )
  if (!active.length) return null
  const sceneExprs = active.map((scene) => {
    const conds = (scene.conditions ?? [])
      .filter((c) => c.field?.trim())
      .map((c) => visibilityConditionExpr(c))
    if (!conds.length) return 'true'
    if (conds.length === 1) return conds[0]!
    return `(${conds.join(' && ')})`
  })
  if (sceneExprs.length === 1) return sceneExprs[0]!
  return `(${sceneExprs.join(' || ')})`
}

/** 静态值 / 绑定 / dynamicStyles → WXML {{ }} 内表达式 */
function resolveDynamicStyleExpr(
  styleKey: string,
  baseRaw: string | undefined,
  attrs: Record<string, string>,
  fallback: string,
  options?: { concrete?: boolean },
): { static?: string; expr: string } {
  const mapColor = options?.concrete ? toConcreteColor : toCssColor
  const base = baseRaw && baseRaw !== 'null' ? baseRaw.trim() : ''
  const baseCss =
    base && !isBinding(base) ? mapColor(base) : base
    const baseExpr = baseCss
    ? isBinding(base)
      ? `(${normalizeExpr(
          templateLiteralsToConcat(
            normalizeBindingOperators(
              unwrapWholeBinding(base) ??
                base.replace(/^\{/, '').replace(/\}$/, ''),
            ),
          ),
        )})`
      : `'${escapeWxmlStr(baseCss)}'`
    : `'${escapeWxmlStr(fallback)}'`

  const states = parseDynamicStylesStates(attrs.dynamicStyles).filter((s) =>
    s.styles[styleKey]?.trim(),
  )
  if (!states.length) {
    if (base && !isBinding(base)) return { static: baseCss, expr: baseExpr }
    return { expr: baseExpr }
  }

  let expr = baseExpr
  for (let i = states.length - 1; i >= 0; i--) {
    const state = states[i]!
    const override = state.styles[styleKey]!.trim()
    const overrideCss = isBinding(override) ? override : mapColor(override)
    const overrideExpr = isBinding(override)
      ? `(${normalizeExpr(
          templateLiteralsToConcat(
            normalizeBindingOperators(
              unwrapWholeBinding(override) ??
                override.replace(/^\{/, '').replace(/\}$/, ''),
            ),
          ),
        )})`
      : `'${escapeWxmlStr(overrideCss)}'`
    const when = compileScenariosOrExpr(state.scenarios) ?? 'true'
    expr = `(${when}) ? ${overrideExpr} : (${expr})`
  }
  return { expr }
}

/**
 * vIf / vShow → wx:if。
 * 不使用 hidden：小程序里 inline style 的 display:flex 会盖掉 hidden（display:none），导致“条件为假仍显示”。
 */
function visibilityWxmlAttrs(attrs: Record<string, string>): string[] {
  const ifExpr = attrs.vIf?.trim()
    ? (compileVisibilityExpr(attrs.vIf) ?? 'true')
    : null
  const showExpr = attrs.vShow?.trim()
    ? (compileVisibilityExpr(attrs.vShow) ?? 'true')
    : null
  if (ifExpr && showExpr) {
    return [`wx:if="{{(${ifExpr}) && (${showExpr})}}"`]
  }
  if (ifExpr) return [`wx:if="{{${ifExpr}}}"`]
  if (showExpr) return [`wx:if="{{${showExpr}}}"`]
  return []
}

function parseBoolAttr(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw === '') return defaultValue
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return defaultValue
}

function bindingToActiveExpr(raw: string): string {
  const text = raw.trim()
  if (!text) return "''"
  if (isBinding(text) && /^\{[A-Za-z_$][\w.$]*\}$/.test(text)) {
    return normalizeExpr(text.slice(1, -1).trim())
  }
  if (/^[A-Za-z_$][\w.$]*$/.test(text)) return normalizeExpr(text)
  return `'${escapeWxmlStr(text)}'`
}

type EvtBinding = {
  method?: string
  args?: Record<string, string>
  body?: string
}

function parseEvtBindings(raw: string | undefined): EvtBinding[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as EvtBinding).method === 'string',
    ) as EvtBinding[]
  } catch {
    return []
  }
}

/** 事件名 → 小程序 bind* */
const WX_EVENT_BIND: Record<
  string,
  { bind: string; kind: 'scroll' | 'touch' | 'tap' | 'plain' }
> = {
  onClick: { bind: 'bindtap', kind: 'tap' },
  onScroll: { bind: 'bindscroll', kind: 'scroll' },
  onScrollToLower: { bind: 'bindscrolltolower', kind: 'plain' },
  onScrollToUpper: { bind: 'bindscrolltoupper', kind: 'plain' },
  onTouchStart: { bind: 'bindtouchstart', kind: 'touch' },
  onTouchMove: { bind: 'bindtouchmove', kind: 'touch' },
  onTouchEnd: { bind: 'bindtouchend', kind: 'touch' },
  onTouchCancel: { bind: 'bindtouchcancel', kind: 'touch' },
}

function buildEventHandlerPrelude(
  kind: 'scroll' | 'touch' | 'tap' | 'plain',
  ctx: RenderCtx,
  body: string,
): string[] {
  const uses = (ident: string) => codeUsesIdent(body, ident)
  const lines: string[] = []
  lines.push(`    var that = this`)

  const needSetData = uses('setData')
  const needShowToast = uses('showToast')
  const needNavigateTo = uses('navigateTo')
  const needNavigateBack = uses('navigateBack')
  const needRuntime =
    needSetData || needShowToast || needNavigateTo || needNavigateBack
  if (needRuntime) {
    lines.push(`    var runtime = require('../../utils/runtime.js')`)
  }
  if (needShowToast) {
    lines.push(`    var showToast = runtime.showToast`)
  }
  if (needNavigateTo) {
    lines.push(`    var navigateTo = runtime.navigateTo`)
  }
  if (needNavigateBack) {
    lines.push(`    var navigateBack = runtime.navigateBack`)
  }
  if (needSetData) {
    lines.push(`    var setData = runtime.createSetData(that)`)
  }
  for (const name of ctx.siblingMethodNames) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue
    if (!uses(name)) continue
    lines.push(
      `    var ${name} = function () { return that.${name}.apply(that, arguments) }`,
    )
  }
  const usedRefs = (ctx.refFields ?? []).filter((f) => uses(f.name))
  const refNames = new Set(usedRefs.map((f) => f.name))
  lines.push(...renderRefLocalVars(usedRefs))
  for (const field of ctx.dataFieldNames) {
    if (!/^[A-Za-z_$][\w$]*$/.test(field)) continue
    if (ctx.siblingMethodNames.includes(field)) continue
    if (refNames.has(field)) continue
    if (!uses(field)) continue
    lines.push(`    var ${field} = that.data.${field}`)
  }
  if (kind === 'scroll') {
    if (uses('scrollTop')) {
      lines.push(
        `    var scrollTop = e && e.detail && e.detail.scrollTop != null ? e.detail.scrollTop : 0`,
      )
    }
    if (uses('scrollLeft')) {
      lines.push(
        `    var scrollLeft = e && e.detail && e.detail.scrollLeft != null ? e.detail.scrollLeft : 0`,
      )
    }
    if (uses('scrollHeight')) {
      lines.push(
        `    var scrollHeight = e && e.detail && e.detail.scrollHeight != null ? e.detail.scrollHeight : 0`,
      )
    }
  }
  if (kind === 'touch') {
    const needTouch =
      uses('clientX') ||
      uses('clientY') ||
      uses('pageX') ||
      uses('pageY')
    if (needTouch) {
      lines.push(
        `    var __touch = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0]) || {}`,
      )
      if (uses('clientX')) {
        lines.push(`    var clientX = __touch.clientX || 0`)
      }
      if (uses('clientY')) {
        lines.push(`    var clientY = __touch.clientY || 0`)
      }
      if (uses('pageX')) {
        lines.push(`    var pageX = __touch.pageX || 0`)
      }
      if (uses('pageY')) {
        lines.push(`    var pageY = __touch.pageY || 0`)
      }
    }
  }
  return lines
}

function registerCustomEventHandler(
  eventKey: string,
  raw: string,
  ctx: RenderCtx,
  eventParamNames: string[] = [],
): string | null {
  const meta = WX_EVENT_BIND[eventKey]
  if (!meta) return null
  if (!raw?.trim() || !isEventBindingValue(raw)) return null
  const bindings = parseEvtBindings(raw)
  if (!bindings.length) return null

  // ??__custom__????body
  if (bindings.every((b) => (b.method || '').trim() === '__custom__')) {
    const body = bindings
      .map((b) => (b.body || '').trim())
      .filter(Boolean)
      .join('\n')
    if (!body) return null
    const finalName = `__${eventKey}_${ctx.handlerSeq.n++}`
    const bodyIndented = body
      .split('\n')
      .map((line) => (line.trim() ? `    ${line}` : ''))
      .join('\n')
    // 滚动 / 触摸高频：不在末尾再全量重算；createSetData 写入时已按 prop 选择性重算
    const prelude = buildEventHandlerPrelude(meta.kind, ctx, body)
    const paramLocals = injectComponentEventParamLocals(body, eventParamNames)
    if (eventKey === 'onScrollToLower') {
      prelude.push(
        `    if (that.data.loading || that.data.refreshing) return`,
      )
      prelude.push(`    that.__lubanAtLower = true`)
    }
    ctx.pageHandlers.push({
      name: finalName,
      body: `${[...prelude, ...paramLocals].join('\n')}\n${bodyIndented}`,
    })
    return `${meta.bind}="${finalName}"`
  }

  // ?????????? onClick??
  if (eventKey === 'onClick') {
    return null // ?? collectClickEventAttrs
  }

  // ??????????????
  const first = bindings[0]
  const method = (first?.method || '').trim()
  if (method && ctx.siblingMethodNames.includes(method)) {
    return `${meta.bind}="${method}"`
  }

  return null
}

/** 组件 emit → triggerEvent({ args })；自定义脚本里的 value 等事件形参 */
function injectComponentEventParamLocals(
  body: string,
  paramNames: string[],
): string[] {
  const names = paramNames
    .map((n) => n.trim())
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && codeUsesIdent(body, n))
  if (!names.length) return []
  const lines: string[] = [
    `    var __payload = (e && e.detail) || {}`,
    `    var __args = Array.isArray(__payload.args) ? __payload.args : []`,
  ]
  for (let i = 0; i < paramNames.length; i++) {
    const name = paramNames[i]!.trim()
    if (!names.includes(name)) continue
    lines.push(
      `    var ${name} = __args[${i}] !== undefined ? __args[${i}] : __payload[${JSON.stringify(name)}]`,
    )
  }
  return lines
}

/**
 * onClick → bindtap + methods
 * setData 的 `{item.key}` 走 data-*；组件 emit 用 triggerEvent
 */
function collectClickEventAttrs(
  attrs: Record<string, string>,
  ctx: RenderCtx,
): string[] {
  const raw = attrs.onClick?.trim()
  if (!raw || !isEventBindingValue(raw)) return []
  return buildPresetEventBindAttrs(raw, ctx, { bindName: 'bindtap' })
}

/**
 * 组件用法上的自定义事件（如 GoodsCard 的 select="[{emit...}]"）
 * → bind:select="handler"
 */
function collectComponentCustomEventAttrs(
  eventName: string,
  raw: string | undefined,
  ctx: RenderCtx,
  eventParamNames: string[] = [],
): string[] {
  const trimmed = raw?.trim()
  if (!trimmed || !isEventBindingValue(trimmed)) return []
  if (!/^[A-Za-z_][\w.-]*$/.test(eventName)) return []
  return buildPresetEventBindAttrs(trimmed, ctx, {
    bindName: `bind:${eventName}`,
    /** 子组件 triggerEvent 的 detail 作为 payload */
    payloadFromDetail: true,
    eventParamNames,
  })
}

/**
 * 将编辑器预设事件绑定编译为 WXML bind* + Page/Component methods
 */
function buildPresetEventBindAttrs(
  raw: string,
  ctx: RenderCtx,
  options: {
    bindName: string
    payloadFromDetail?: boolean
    /** onScroll 等：{scrollTop} → e.detail.scrollTop */
    isScroll?: boolean
    /** 组件事件形参名（对应 emit 的 args / detail 字段） */
    eventParamNames?: string[]
  },
): string[] {
  const bindings = parseEvtBindings(raw)
  if (!bindings.length) return []

  if (bindings.every((b) => (b.method || '').trim() === '__custom__')) {
    // 自定义脚本：走 registerCustomEventHandler（仅 onClick 键名用于命名）
    const a = registerCustomEventHandler(
      'onClick',
      raw,
      ctx,
      options.eventParamNames ?? [],
    )
    if (!a) return []
    // registerCustomEventHandler 返回 bindtap="..."，替换 bind 名
    const m = a.match(/^(\w+(?::[\w.-]+)?)=(".*")$/)
    if (m) return [`${options.bindName}=${m[2]}`]
    return [a.replace(/^bindtap=/, `${options.bindName}=`)]
  }

  const dataAttrs: string[] = []
  const stmts: string[] = []
  let dataIdx = 0
  const fromDetail = Boolean(options.payloadFromDetail)
  const isScroll = Boolean(options.isScroll)
  const scrollDetailKeys = new Set([
    'scrollTop',
    'scrollLeft',
    'scrollHeight',
    'scrollWidth',
    'deltaX',
    'deltaY',
  ])

  if (fromDetail) {
    stmts.push(`var __payload = (e && e.detail) || {}`)
  }

  for (const bind of bindings) {
    const method = (bind.method || '').trim()
    const args = bind.args ?? {}

    if (method === 'setData') {
      const prop = String(args.prop ?? '').trim()
      if (!prop || !/^[A-Za-z_$][\w$]*$/.test(prop)) continue
      const valueRaw = String(args.value ?? '').trim()
      const bindMatch = valueRaw.match(/^\{([A-Za-z_$][\w.$]*)\}$/)
      if (bindMatch) {
        const path = bindMatch[1]!
        if (isScroll && scrollDetailKeys.has(path) && !path.includes('.')) {
          stmts.push(
            `this.setData({ ${prop}: (e && e.detail && e.detail.${path} != null) ? e.detail.${path} : 0 })`,
          )
        } else if (fromDetail) {
          stmts.push(
            `this.setData({ ${prop}: ${detailPathExpr(path)} })`,
          )
        } else {
          const i = dataIdx++
          const expr = normalizeExpr(path)
          dataAttrs.push(`data-val${i}="{{${expr}}}"`)
          stmts.push(
            `this.setData({ ${prop}: e.currentTarget.dataset.val${i} })`,
          )
        }
      } else {
        let valueExpr: string
        try {
          valueExpr = JSON.stringify(JSON.parse(valueRaw))
        } catch {
          valueExpr = JSON.stringify(valueRaw)
        }
        stmts.push(`this.setData({ ${prop}: ${valueExpr} })`)
      }
      continue
    }

    if (method === 'updateProps') {
      const prop = String(args.prop ?? '').trim()
      if (!prop || !/^[A-Za-z_$][\w$]*$/.test(prop)) continue
      const valueRaw = String(args.value ?? '').trim()
      const bindMatch = valueRaw.match(/^\{([A-Za-z_$][\w.$]*)\}$/)
      let valueExpr: string
      if (bindMatch) {
        const path = bindMatch[1]!
        if (fromDetail) {
          valueExpr = detailPathExpr(path)
        } else {
          const expr = normalizeExpr(path)
          if (expr === 'item' || expr === 'index' || expr.startsWith('item.')) {
            const i = dataIdx++
            dataAttrs.push(`data-val${i}="{{${expr}}}"`)
            valueExpr = `e.currentTarget.dataset.val${i}`
          } else {
            valueExpr = runtimePropExpr(expr)
          }
        }
      } else {
        try {
          valueExpr = JSON.stringify(JSON.parse(valueRaw))
        } catch {
          valueExpr = JSON.stringify(valueRaw)
        }
      }
      const vVar = `__up${dataIdx++}`
      stmts.push(`var ${vVar} = ${valueExpr}`)
      stmts.push(
        `if (typeof ${vVar} === 'string' && ${vVar} !== '' && !isNaN(Number(${vVar}))) ${vVar} = Number(${vVar})`,
      )
      stmts.push(`var __upPatch${dataIdx} = {}`)
      stmts.push(`__upPatch${dataIdx}[${JSON.stringify(prop)}] = ${vVar}`)
      stmts.push(`this.setData(__upPatch${dataIdx})`)
      stmts.push(
        `if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed([${JSON.stringify(prop)}])`,
      )
      stmts.push(
        `this.triggerEvent('update:' + ${JSON.stringify(prop)}, { value: ${vVar} })`,
      )
      continue
    }

    if (method === 'navigateTo') {
      const to = String(args.to ?? '').trim()
      if (!to) continue

      let urlBaseExpr: string
      const toBind = to.match(/^\{([A-Za-z_$][\w.$]*)\}$/)
      if (toBind) {
        if (fromDetail) {
          urlBaseExpr = `'/pages/' + ${detailPathExpr(toBind[1]!)} + '/index'`
        } else {
          const i = dataIdx++
          dataAttrs.push(`data-val${i}="{{${normalizeExpr(toBind[1]!)}}}"`)
          urlBaseExpr = `'/pages/' + e.currentTarget.dataset.val${i} + '/index'`
        }
      } else {
        urlBaseExpr = JSON.stringify(`/pages/${to}/index`)
      }

      const paramsRaw = String(args.params ?? '').trim()
      let paramsObj: Record<string, unknown> | null = null
      if (paramsRaw) {
        try {
          const parsed = JSON.parse(paramsRaw) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            paramsObj = parsed as Record<string, unknown>
          }
        } catch {
          // ignore
        }
      }

      if (paramsObj && Object.keys(paramsObj).length) {
        const qsVar = `__navQs${dataIdx}`
        const urlVar = `__navUrl${dataIdx}`
        stmts.push(`var ${qsVar} = []`)
        for (const [key, value] of Object.entries(paramsObj)) {
          const k = key.trim()
          if (!k) continue
          const valueRaw = value == null ? '' : String(value).trim()
          const bindMatch = valueRaw.match(/^\{([A-Za-z_$][\w.$]*)\}$/)
          let valueExpr: string
          if (bindMatch) {
            const path = bindMatch[1]!
            if (fromDetail) {
              valueExpr = detailPathExpr(path)
            } else {
              const expr = normalizeExpr(path)
              if (
                expr === 'item' ||
                expr === 'index' ||
                expr.startsWith('item.')
              ) {
                const i = dataIdx++
                dataAttrs.push(`data-val${i}="{{${expr}}}"`)
                valueExpr = `e.currentTarget.dataset.val${i}`
              } else {
                valueExpr = runtimePropExpr(expr)
              }
            }
          } else {
            try {
              valueExpr = JSON.stringify(JSON.parse(valueRaw))
            } catch {
              valueExpr = JSON.stringify(valueRaw)
            }
          }
          const vVar = `__navV${dataIdx++}`
          stmts.push(`var ${vVar} = ${valueExpr}`)
          stmts.push(
            `if (${vVar} != null && ${vVar} !== '') ${qsVar}.push(${JSON.stringify(`${k}=`)} + encodeURIComponent(String(${vVar})))`,
          )
        }
        stmts.push(
          `var ${urlVar} = ${urlBaseExpr} + (${qsVar}.length ? '?' + ${qsVar}.join('&') : '')`,
        )
        stmts.push(`wx.navigateTo({ url: ${urlVar} })`)
      } else {
        stmts.push(`wx.navigateTo({ url: ${urlBaseExpr} })`)
      }
      continue
    }

    if (method === 'navigateBack') {
      stmts.push(`wx.navigateBack()`)
      continue
    }

    if (method === 'showToast') {
      const message = String(args.message ?? '').trim()
      const msgBind = message.match(/^\{([A-Za-z_$][\w.$]*)\}$/)
      if (msgBind) {
        if (fromDetail) {
          stmts.push(
            `wx.showToast({ title: String(${detailPathExpr(msgBind[1]!)} || ''), icon: 'none' })`,
          )
        } else {
          const i = dataIdx++
          dataAttrs.push(`data-val${i}="{{${normalizeExpr(msgBind[1]!)}}}"`)
          stmts.push(
            `wx.showToast({ title: String(e.currentTarget.dataset.val${i} || ''), icon: 'none' })`,
          )
        }
      } else {
        stmts.push(
          `wx.showToast({ title: ${JSON.stringify(message)}, icon: 'none' })`,
        )
      }
      continue
    }

    if (method === 'emit') {
      const eventName = String(args.event ?? '').trim()
      if (!eventName || !/^[A-Za-z_][\w.-]*$/.test(eventName)) continue
      const detailParts: string[] = []
      for (const [key, value] of Object.entries(args)) {
        if (key === 'event') continue
        const safeKey = /^[A-Za-z_][\w]*$/.test(key) ? key : JSON.stringify(key)
        const valueRaw = String(value ?? '').trim()
        const bindMatch = valueRaw.match(/^\{([A-Za-z_$][\w.$]*)\}$/)
        if (bindMatch) {
          const path = bindMatch[1]!
          if (fromDetail) {
            detailParts.push(`${safeKey}: ${detailPathExpr(path)}`)
          } else {
            const expr = normalizeExpr(path)
            // 列表 item 仍走 data-*；props/data 在 handler 里读，避免对象被 dataset 串化
            if (expr === 'item' || expr === 'index' || expr.startsWith('item.')) {
              const i = dataIdx++
              dataAttrs.push(`data-val${i}="{{${expr}}}"`)
              detailParts.push(`${safeKey}: e.currentTarget.dataset.val${i}`)
            } else {
              detailParts.push(`${safeKey}: ${runtimePropExpr(expr)}`)
            }
          }
        } else {
          let valueExpr: string
          try {
            valueExpr = JSON.stringify(JSON.parse(valueRaw))
          } catch {
            valueExpr = JSON.stringify(valueRaw)
          }
          detailParts.push(`${safeKey}: ${valueExpr}`)
        }
      }
      stmts.push(
        `this.triggerEvent(${JSON.stringify(eventName)}, { ${detailParts.join(', ')} })`,
      )
      continue
    }

    // 同级自定义方法
    if (method && ctx.siblingMethodNames.includes(method)) {
      stmts.push(`if (typeof this.${method} === 'function') this.${method}(e)`)
      continue
    }
  }

  if (!stmts.length) return []

  // 收集本 handler 写入的 data key，在 setData 回调里按依赖选择性重算
  const changedKeys: string[] = []
  for (const s of stmts) {
    const m = s.match(/this\.setData\(\{\s*([A-Za-z_$][\w$]*)\s*:/)
    if (m && m[1] && !changedKeys.includes(m[1])) changedKeys.push(m[1]!)
  }
  if (changedKeys.length) {
    // 把最后一个 this.setData({...}) 改成带回调重算（避免 this.data 尚未刷新）
    for (let i = stmts.length - 1; i >= 0; i--) {
      const s = stmts[i]!
      if (!/this\.setData\(\{/.test(s)) continue
      if (s.includes('function')) break
      const keysLit =
        changedKeys.length === 1
          ? `[${JSON.stringify(changedKeys[0])}]`
          : JSON.stringify(changedKeys)
      stmts[i] = s.replace(
        /this\.setData\((\{[\s\S]*\})\)\s*$/,
        `this.setData($1, function () { if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed(${keysLit}) })`,
      )
      break
    }
  }

  const name = `__onEvt_${ctx.handlerSeq.n++}`
  ctx.pageHandlers.push({
    name,
    body: stmts.map((s) => `    ${s}`).join('\n'),
  })
  return [`${options.bindName}="${name}"`, ...dataAttrs]
}

/** 事件 detail / payload 字段访问：goods → __payload.goods；item.x 仍按路径 */
function detailPathExpr(path: string): string {
  const p = path.trim()
  if (!p) return 'undefined'
  if (p === 'item' || p === 'index') return p
  if (p.startsWith('item.') || p.startsWith('index.')) return p
  const norm = normalizeExpr(p)
  if (norm === '$props') return '__payload'
  return `__payload.${norm}`
}

/** 组件 props / 页面 data 运行时读取（保留对象引用） */
function runtimePropExpr(expr: string): string {
  const parts = expr.split('.').filter(Boolean)
  if (!parts.length || !parts.every((p) => /^[A-Za-z_$][\w$]*$/.test(p))) {
    return 'undefined'
  }
  const root = parts[0]!
  const rootExpr = `(this.properties.${root} !== undefined ? this.properties.${root} : this.data.${root})`
  if (parts.length === 1) return rootExpr
  return `((${rootExpr}) || {}).${parts.slice(1).join('.')}`
}

/**
 * enhanced scroll-view 慢滑到底时 bindscrolltolower 经常不触发。
 * 用 bindscroll / binddragend 做边缘检测；优先用事件 detail，并用 id + fields 校准。
 */
function wireScrollToLowerFallback(
  ctx: RenderCtx,
  scrollTouchAttrs: string[],
  enabled: boolean,
): { attrs: string[]; scrollId: string | null } {
  if (!enabled) return { attrs: scrollTouchAttrs, scrollId: null }

  const lowerAttr = scrollTouchAttrs.find((a) =>
    a.startsWith('bindscrolltolower='),
  )
  if (!lowerAttr) return { attrs: scrollTouchAttrs, scrollId: null }
  const lowerFn = lowerAttr.match(/="([^"]+)"/)?.[1]
  if (!lowerFn || !/^[A-Za-z_$][\w$]*$/.test(lowerFn)) {
    return { attrs: scrollTouchAttrs, scrollId: null }
  }

  const scrollAttr = scrollTouchAttrs.find((a) => a.startsWith('bindscroll='))
  const scrollFn = scrollAttr?.match(/="([^"]+)"/)?.[1]
  if (scrollFn && !/^[A-Za-z_$][\w$]*$/.test(scrollFn)) {
    return { attrs: scrollTouchAttrs, scrollId: null }
  }

  const seq = ctx.handlerSeq.n++
  const wrapName = `__onScrollWithLower_${seq}`
  const scrollId = `lubanScrollY${seq}`
  const threshold = 150
  const bodyLines = [
    `    var that = this`,
    `    var d = (e && e.detail) || {}`,
    `    var scrollTop = Number(d.scrollTop)`,
    `    var scrollHeight = Number(d.scrollHeight)`,
    `    if (!isFinite(scrollTop)) scrollTop = 0`,
    `    if (!isFinite(scrollHeight)) scrollHeight = 0`,
  ]
  if (scrollFn) {
    bodyLines.push(
      `    if (typeof that.${scrollFn} === 'function') that.${scrollFn}(e)`,
    )
  }
  bodyLines.push(
    `    var tryFire = function (viewH, st, sh) {`,
    `      if (!(viewH > 0) || !(sh > viewH + 1)) {`,
    `        that.__lubanAtLower = false`,
    `        return`,
    `      }`,
    `      if (that.__lubanLastScrollH && sh > that.__lubanLastScrollH + 8) {`,
    `        that.__lubanAtLower = false`,
    `      }`,
    `      that.__lubanLastScrollH = sh`,
    `      var nowLower = st >= sh - viewH - ${threshold}`,
    `      if (nowLower && !that.__lubanAtLower) {`,
    `        that.__lubanAtLower = true`,
    `        if (typeof that.${lowerFn} === 'function') that.${lowerFn}(e)`,
    `        setTimeout(function () { that.__lubanAtLower = false }, 400)`,
    `      } else if (!nowLower) {`,
    `        that.__lubanAtLower = false`,
    `      }`,
    `    }`,
    `    var viewH = that.__lubanScrollViewH || 0`,
    `    if (viewH > 0 && scrollHeight > 0) tryFire(viewH, scrollTop, scrollHeight)`,
    `    var now = Date.now()`,
    `    if (viewH > 0 && that.__lubanScrollLowerTs && now - that.__lubanScrollLowerTs < 100) return`,
    `    that.__lubanScrollLowerTs = now`,
    `    wx.createSelectorQuery()`,
    `      .in(that)`,
    `      .select(${JSON.stringify('#' + scrollId)})`,
    `      .fields({ size: true, scrollOffset: true })`,
    `      .exec(function (res) {`,
    `        var info = res && res[0]`,
    `        if (!info) return`,
    `        if (info.height) that.__lubanScrollViewH = info.height`,
    `        var st = info.scrollTop != null ? Number(info.scrollTop) : scrollTop`,
    `        var sh = info.scrollHeight != null ? Number(info.scrollHeight) : scrollHeight`,
    `        if (!isFinite(st)) st = scrollTop`,
    `        if (!isFinite(sh)) sh = scrollHeight`,
    `        tryFire(that.__lubanScrollViewH || 0, st, sh)`,
    `      })`,
  )

  ctx.pageHandlers.push({
    name: wrapName,
    body: bodyLines.join('\n'),
  })

  const next = scrollTouchAttrs.filter((a) => !a.startsWith('bindscroll='))
  next.push(`bindscroll="${wrapName}"`)
  next.push(`binddragend="${wrapName}"`)
  return { attrs: next, scrollId }
}

/** ?? / ?? / ???? ??bind* + methods */
function collectScrollTouchEventAttrs(
  attrs: Record<string, string>,
  ctx: RenderCtx,
  options?: { skipTouch?: boolean },
): string[] {
  const out: string[] = []
  const keys = [
    'onScroll',
    'onScrollToLower',
    'onScrollToUpper',
    'onTouchStart',
    'onTouchMove',
    'onTouchEnd',
    'onTouchCancel',
  ] as const
  for (const key of keys) {
    if (
      options?.skipTouch &&
      (key === 'onTouchStart' ||
        key === 'onTouchMove' ||
        key === 'onTouchEnd' ||
        key === 'onTouchCancel')
    ) {
      continue
    }
    const raw = attrs[key]
    if (!raw?.trim()) continue
    const meta = WX_EVENT_BIND[key]
    if (!meta) continue

    // setData / navigate / emit 等预设绑定（含 onScroll → titleBarOpacity）
    if (isEventBindingValue(raw)) {
      const bindings = parseEvtBindings(raw)
      const isAllCustom = bindings.every(
        (b) => (b.method || '').trim() === '__custom__',
      )
      if (!isAllCustom) {
        const preset = buildPresetEventBindAttrs(raw, ctx, {
          bindName: meta.bind,
          isScroll: meta.kind === 'scroll',
        })
        if (preset.length) {
          out.push(...preset)
          continue
        }
      }
    }

    const bind = registerCustomEventHandler(key, raw, ctx)
    if (bind) out.push(bind)
  }
  return out
}

/**
 * 下拉刷新：pullHeight + touch + refresh
 * 优先 scroll-view 原生 touch；否则用 refresher
 * 自定义 slot="refresher" 时渲染 UI
 */
function shouldUseNativeCustomRefresher(
  attrs: Record<string, string>,
  ctx: RenderCtx,
): boolean {
  const hasTouch =
    Boolean(attrs.onTouchMove?.trim()) || Boolean(attrs.onTouchEnd?.trim())
  if (!hasTouch) return false
  const hasRefresh =
    ctx.siblingMethodNames.includes('refresh') ||
    ctx.siblingMethodNames.includes('pullRefresh') ||
    ctx.dataFieldNames.includes('refreshing')
  const hasPull =
    ctx.dataFieldNames.includes('pullHeight') ||
    /pullRefresh\s*\(/.test(attrs.onTouchEnd || '') ||
    /refresh\s*\(/.test(attrs.onTouchEnd || '')
  return hasRefresh && hasPull
}

function ensureNativeCustomRefresherHandlers(ctx: RenderCtx): void {
  if (ctx.pageHandlers.some((h) => h.name === '__onRefresherPulling')) return

  ctx.pageHandlers.push({
    name: '__onRefresherPulling',
    body: [
      `    var that = this`,
      `    var dy = e && e.detail && e.detail.dy != null ? Number(e.detail.dy) : 0`,
      `    if (!(dy > 0)) dy = 0`,
      `    // ??????????????? sin ??`,
      `    var maxPull = 200`,
      `    var t = Math.min(1, dy / 500)`,
      `    var h = maxPull * Math.sin(t * Math.PI * 0.5)`,
      `    that.setData({ pullHeight: h })`,
      `    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed(['pullHeight'])`,
    ].join('\n'),
  })

  ctx.pageHandlers.push({
    name: '__onRefresherRefresh',
    body: [
      `    var that = this`,
      `    if (that.data.loading) {`,
      `      that.setData({ refreshing: false, pullHeight: 0 })`,
      `      if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed(['refreshing', 'pullHeight'])`,
      `      return`,
      `    }`,
      `    that.setData({ pullHeight: 40 })`,
      `    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed(['pullHeight'])`,
      // Pager 等组件：实际逻辑在 pullRefresh；refresh 可能是空的对外方法
      `    if (typeof that.pullRefresh === 'function') that.pullRefresh()`,
      `    else if (typeof that.refresh === 'function') that.refresh()`,
      `    else that.setData({ refreshing: true })`,
    ].join('\n'),
  })

  ctx.pageHandlers.push({
    name: '__onRefresherRestore',
    body: [
      `    var that = this`,
      `    that.setData({ pullHeight: 0 })`,
      `    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed(['pullHeight'])`,
    ].join('\n'),
  })
}

/** `{foo}` / `hello {name}` / 三元与模板字符串 */
function toWxmlText(raw: string): string {
  if (!raw) return ''
  const whole = unwrapWholeBinding(raw)
  if (whole != null) {
    const expr = rewriteWxmlGlobalCalls(
      templateLiteralsToConcat(normalizeBindingOperators(whole)),
    )
    return `{{${normalizeExpr(expr)}}}`
  }
  const spans = scanBindingSpans(raw)
  if (!spans.length) return raw
  let out = ''
  let cursor = 0
  for (const span of spans) {
    out += raw.slice(cursor, span.start)
    cursor = span.end
    const expr = rewriteWxmlGlobalCalls(
      templateLiteralsToConcat(normalizeBindingOperators(span.expr)),
    )
    out += `{{${normalizeExpr(expr)}}}`
  }
  out += raw.slice(cursor)
  return out
}

function normalizeExpr(expr: string): string {
  // WXML {{}} 统一出口：Number/String/Boolean/Array.isArray → util.*（WXS）
  let e = rewriteWxmlGlobalCalls(expr)
  if (e === '$props' || e === 'props') return '$props'
  if (e.startsWith('$props.')) return e.slice('$props.'.length)
  if (e.startsWith('props.')) return e.slice('props.'.length)
  return e
}

/**
 * 组件 prop 可写入 WXML 的绑定。
 * 允许简单路径、! / !! 取反，以及 || / && / 比较 / .length 等复合表达式
 *（如 empty="{!remarkList || displayList.length === 0}"）。
 * 排除 JSON 对象字面量，避免与 api 绑定混淆。
 */
function isWxmlComponentPropExpr(expr: string): boolean {
  const e = expr.trim()
  if (!e) return false
  if (looksLikeJsonObjectLiteral(e)) return false
  if (isSimpleBindingPath(e)) return true
  const not = e.match(/^!{1,2}\s*(.+)$/)
  if (not && isSimpleBindingPath(not[1]!.trim())) return true
  // 复合布尔 / 比较 / 三元 / 成员（.length）等
  if (
    /(?:\|\||&&|===|!==|==|!=|<=|>=|<|>|\?|:|\.length\b)/.test(e) ||
    /^!{1,2}\s*\(/.test(e)
  ) {
    return true
  }
  return false
}

function looksLikeJsonObjectLiteral(expr: string): boolean {
  const t = expr.trim()
  if (!t.startsWith('{')) return false
  try {
    const v = JSON.parse(t) as unknown
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}

/** 表达式内的 $props.x → x（页面/组件 WXML 数据域） */
function normalizeWxmlPropExpr(expr: string): string {
  const normalized = rewriteWxmlGlobalCalls(
    templateLiteralsToConcat(normalizeBindingOperators(expr.trim())),
  )
  if (isSimpleBindingPath(normalized)) return normalizeExpr(normalized)
  const not = normalized.match(/^(!{1,2})\s*(.+)$/)
  if (not && isSimpleBindingPath(not[2]!)) {
    return `${not[1]}${normalizeExpr(not[2]!)}`
  }
  return normalized
    .replace(/\b\$props\./g, '')
    .replace(/\bprops\./g, '')
}

/** 与编辑器 / vue3 一致：Modal 或全 Modal Fragment 不占文档流 */
function isOutOfFlowTree(node: XmlNode): boolean {
  if (node.tag === 'Modal') return true
  if (node.tag === 'Fragment') {
    return (
      node.children.length > 0 &&
      node.children.every((child) => isOutOfFlowTree(child))
    )
  }
  return false
}

const OUT_OF_FLOW_HOST_CLASSES = [
  'absolute',
  'top-0',
  'left-0',
  'w-0',
  'h-0',
  'm-0',
  'overflow-visible',
  'pointer-events-none',
] as const

function isTrueAttr(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1'
}

type LayoutResult = { classes: string[]; style: string }

const SPACING_TW: Record<string, { prefix: string; prop: string }> = {
  padding: { prefix: 'p', prop: 'padding' },
  paddingLeft: { prefix: 'pl', prop: 'padding-left' },
  paddingRight: { prefix: 'pr', prop: 'padding-right' },
  paddingTop: { prefix: 'pt', prop: 'padding-top' },
  paddingBottom: { prefix: 'pb', prop: 'padding-bottom' },
  margin: { prefix: 'm', prop: 'margin' },
  marginLeft: { prefix: 'ml', prop: 'margin-left' },
  marginRight: { prefix: 'mr', prop: 'margin-right' },
  marginTop: { prefix: 'mt', prop: 'margin-top' },
  marginBottom: { prefix: 'mb', prop: 'margin-bottom' },
}

/** 与编辑器 marginValues 一致：单侧缺省时回退到统一 margin */
function marginPxValues(attrs: Record<string, string>): {
  top: number
  right: number
  bottom: number
  left: number
} {
  const allRaw = attrs.margin?.trim()
  const allN =
    allRaw && !isBinding(allRaw)
      ? Number(allRaw.replace(/px$/i, ''))
      : NaN
  const all = Number.isFinite(allN) ? allN : 0
  const hasAll = Boolean(allRaw && !isBinding(allRaw) && Number.isFinite(allN))
  const side = (key: string): number => {
    const raw = attrs[key]?.trim()
    if (!raw || raw === 'null') return hasAll ? all : 0
    if (isBinding(raw)) return hasAll ? all : 0
    const n = Number(raw.replace(/px$/i, ''))
    return Number.isFinite(n) ? n : hasAll ? all : 0
  }
  return {
    top: side('marginTop'),
    right: side('marginRight'),
    bottom: side('marginBottom'),
    left: side('marginLeft'),
  }
}

/** match_parent 扣除 margin，避免 100% + margin 溢出（对齐编辑器 matchParentAxisSize） */
function matchParentSizeCss(
  axis: 'width' | 'height',
  attrs: Record<string, string>,
  designWidth: number,
): string {
  const m = marginPxValues(attrs)
  const offsetPx = axis === 'width' ? m.left + m.right : m.top + m.bottom
  if (!(offsetPx > 0)) return '100%'
  return `calc(100% - ${pxToVw(offsetPx, designWidth)})`
}

function attrLayout(
  attrs: Record<string, string>,
  reg: ClassRegistry,
  options?: {
    flexParent?: 'row' | 'column'
    isComponent?: boolean
    isRelativeChild?: boolean
    designWidth?: number
  },
): LayoutResult {
  const designWidth = options?.designWidth ?? DEFAULT_CANVAS_WIDTH
  const classes: string[] = []
  const parts: string[] = []
  const pushKnown = (...names: string[]) => {
    classes.push(...reg.useMany(names))
  }
  const pushArb = (prefix: string, prop: string, value: string) => {
    const cssValue =
      prop === 'background' ||
      prop === 'color' ||
      prop === 'border-color' ||
      prop === 'background-color'
        ? toCssColor(value)
        : value
    classes.push(reg.arb(prefix, prop, cssValue))
  }

  const wRaw = attrs.width?.trim()
  const hRaw = attrs.height?.trim()
  const isRelativeChild = Boolean(options?.isRelativeChild)
  const isScrollContainer = (attrs.overflow || '').trim().toLowerCase() === 'scroll'
  const hasRelativeEdge =
    isTrueAttr(attrs.layout_alignParentLeft) ||
    isTrueAttr(attrs.layout_alignParentStart) ||
    isTrueAttr(attrs.layout_alignParentRight) ||
    isTrueAttr(attrs.layout_alignParentEnd) ||
    isTrueAttr(attrs.layout_alignParentTop) ||
    isTrueAttr(attrs.layout_alignParentBottom) ||
    isTrueAttr(attrs.layout_centerInParent) ||
    isTrueAttr(attrs.layout_centerHorizontal) ||
    isTrueAttr(attrs.layout_centerVertical) ||
    (['layout_marginLeft', 'layout_marginRight', 'layout_marginTop', 'layout_marginBottom'] as const).some(
      (k) => {
        const raw = attrs[k]?.trim()
        return Boolean(raw) && raw !== 'null'
      },
    )
  const useRelativeInset =
    isRelativeChild &&
    isScrollContainer &&
    wRaw === 'match_parent' &&
    hRaw === 'match_parent' &&
    !hasRelativeEdge

  const wBind = styleBindingExpr(wRaw)
  if (useRelativeInset) {
    /* width 由 inset 承担 */
  } else if (wBind) {
    parts.push(`width:{{${wBind}}}px`)
  } else if (wRaw === 'match_parent' && options?.flexParent === 'row') {
    pushKnown('flex-1', 'min-w-0', 'w-0')
  } else if (wRaw === 'match_parent') {
    const size = matchParentSizeCss('width', attrs, designWidth)
    if (size === '100%') pushKnown('w-full', 'min-w-0')
    else {
      pushArb('w', 'width', size)
      pushKnown('min-w-0')
    }
  } else if (wRaw === 'wrap_content') {
    pushKnown('w-fit', 'max-w-full')
  } else {
    const w = parseSize(wRaw, designWidth)
    if (w && w !== '100%' && w !== 'auto') pushArb('w', 'width', w)
    else if (w === '100%') pushKnown('w-full')
    else if (w === 'auto') pushKnown('w-auto')
  }

  const hBind = styleBindingExpr(hRaw)
  if (useRelativeInset) {
    /* height 由 inset 承担 */
  } else if (hBind) {
    parts.push(`height:{{${hBind}}}px`)
  } else if (hRaw === 'match_parent' && options?.flexParent === 'column') {
    pushKnown('flex-1', 'min-h-0', 'h-0')
  } else if (
    // match_parent 组件需拉满父级（如 LoadingPlaceholder 插槽）；h-auto 会导致内部 scroll-view 高度塌缩
    hRaw === 'match_parent' &&
    options?.isComponent &&
    !options?.flexParent &&
    !isRelativeChild
  ) {
    pushKnown('h-full', 'min-h-0')
  } else if (hRaw === 'match_parent') {
    const size = matchParentSizeCss('height', attrs, designWidth)
    if (size === '100%') pushKnown('h-full', 'min-h-0')
    else {
      pushArb('h', 'height', size)
      pushKnown('min-h-0')
    }
  } else if (hRaw === 'wrap_content') {
    pushKnown('h-fit')
  } else {
    const h = parseSize(hRaw, designWidth)
    if (h && h !== '100%' && h !== 'auto') pushArb('h', 'height', h)
    else if (h === '100%') pushKnown('h-full')
    else if (h === 'auto') pushKnown('h-auto')
  }

  const pad = attrs.padding?.trim()
  const padBind = styleBindingExpr(pad)
  if (padBind) {
    parts.push(`padding:{{${padBind}}}px`)
  } else if (pad && !isBinding(pad)) {
    const n = Number(pad.replace(/px$/i, ''))
    if (Number.isFinite(n)) pushArb('p', 'padding', pxToVw(n, designWidth))
  }
  for (const [key, meta] of Object.entries(SPACING_TW)) {
    if (key === 'padding') continue
    const raw = attrs[key]?.trim()
    if (!raw) continue
    const bind = styleBindingExpr(raw)
    if (bind) {
      parts.push(`${meta.prop}:{{${bind}}}px`)
      continue
    }
    if (isBinding(raw)) continue
    const n = Number(raw.replace(/px$/i, ''))
    if (Number.isFinite(n)) pushArb(meta.prefix, meta.prop, pxToVw(n, designWidth))
  }

  const overflow = (attrs.overflow || '').trim().toLowerCase()
  if (overflow === 'hidden') pushKnown('overflow-hidden')
  else if (overflow === 'visible') pushKnown('overflow-visible')

  const bg = attrs.background?.trim()
  const bgBind = styleBindingExpr(bg)
  const bgDyn = parseDynamicStylesStates(attrs.dynamicStyles).some((s) =>
    s.styles.background?.trim(),
  )
  if (bgDyn) {
    const res = resolveDynamicStyleExpr(
      'background',
      bg,
      attrs,
      'transparent',
    )
    parts.push(`background:{{${wrapCssColorExpr(res.expr)}}}`)
  } else if (bgBind) {
    parts.push(`background:{{${wrapCssColorExpr(bgBind)}}}`)
  } else if (bg && bg !== 'transparent' && !isBinding(bg)) {
    pushArb('bg', 'background', bg)
  }
  const radius = attrs.borderRadius?.trim()
  const cornerKeys = [
    ['borderTopLeftRadius', 'rounded-tl', 'border-top-left-radius'],
    ['borderTopRightRadius', 'rounded-tr', 'border-top-right-radius'],
    ['borderBottomRightRadius', 'rounded-br', 'border-bottom-right-radius'],
    ['borderBottomLeftRadius', 'rounded-bl', 'border-bottom-left-radius'],
  ] as const
  const hasCornerAttr = cornerKeys.some(([key]) => {
    const raw = attrs[key]?.trim()
    return Boolean(raw) && raw !== 'null' && !isBinding(raw)
  })
  const uniformN =
    radius && radius !== 'null' && !isBinding(radius)
      ? Number(radius.replace(/px$/i, ''))
      : NaN
  const uniform = Number.isFinite(uniformN) ? uniformN : null
  if (hasCornerAttr) {
    // 分角优先；未单独设置的角回退统一 borderRadius，再回退 0（对齐编辑器）
    // 勿再写 border-radius 简写，否则会盖掉分角
    for (const [key, prefix, prop] of cornerKeys) {
      const raw = attrs[key]?.trim()
      let n = 0
      if (raw && raw !== 'null' && !isBinding(raw)) {
        const v = Number(raw.replace(/px$/i, ''))
        if (Number.isFinite(v)) n = v
      } else if (uniform != null) {
        n = uniform
      }
      pushArb(prefix, prop, pxToVw(n, designWidth))
    }
  } else if (uniform != null) {
    pushArb('rounded', 'border-radius', pxToVw(uniform, designWidth))
  }
  const contentShadow = attrs.contentShadow?.trim()
  if (contentShadow && contentShadow !== 'null' && !isBinding(contentShadow)) {
    parts.push(`box-shadow:${contentShadow}`)
  }
  const textColorRaw = attrs.textColor?.trim()
  const colorRaw = attrs.color?.trim()
  const hasTextColorDyn = parseDynamicStylesStates(attrs.dynamicStyles).some(
    (s) => s.styles.textColor?.trim(),
  )
  const hasColorDyn = parseDynamicStylesStates(attrs.dynamicStyles).some((s) =>
    s.styles.color?.trim(),
  )
  if (hasTextColorDyn || (textColorRaw && textColorRaw !== 'null')) {
    const res = resolveDynamicStyleExpr(
      'textColor',
      textColorRaw && textColorRaw !== 'null' ? textColorRaw : undefined,
      attrs,
      '#303133',
    )
    if (res.static && !hasTextColorDyn) {
      pushArb('text', 'color', res.static)
    } else {
      parts.push(`color:{{${wrapCssColorExpr(res.expr)}}}`)
    }
  } else if (hasColorDyn) {
    const res = resolveDynamicStyleExpr('color', colorRaw, attrs, '#303133')
    parts.push(`color:{{${wrapCssColorExpr(res.expr)}}}`)
  } else {
    const color = textColorRaw || colorRaw
    const colorBind = styleBindingExpr(color)
    if (colorBind) {
      parts.push(`color:{{${wrapCssColorExpr(colorBind)}}}`)
    } else if (color && color !== 'null' && isBinding(color)) {
      // 复杂表达式（含 Number() 等）：走 normalizeExpr 统一改写
      const whole =
        unwrapWholeBinding(color) ??
        color.trim().replace(/^\{/, '').replace(/\}$/, '')
      const expr = normalizeExpr(
        templateLiteralsToConcat(normalizeBindingOperators(whole)),
      )
      parts.push(`color:{{${wrapCssColorExpr(`(${expr})`)}}`)
    } else if (color && color !== 'null' && !isBinding(color)) {
      pushArb('text', 'color', color)
    }
  }
  const fontSize = attrs.textSize?.trim() || attrs.size?.trim()
  if (fontSize && !isBinding(fontSize)) {
    const n = Number(fontSize.replace(/px$/i, ''))
    // 字号用 text-size-[…] 避免与 text-[#color] 冲突
    if (Number.isFinite(n)) {
      pushArb('text-size', 'font-size', pxToVw(n, designWidth))
    }
  }

  const transformFns = buildTransformFunctions(attrs)
  let centerTranslate: 'xy' | 'x' | 'y' | null = null

  if (isTrueAttr(attrs.layout_centerInParent)) {
    pushKnown('absolute', 'left-1/2', 'top-1/2')
    centerTranslate = 'xy'
  } else if (isRelativeChild || hasRelativeEdge) {
    pushKnown('absolute')
    if (useRelativeInset) {
      pushKnown('inset-0')
    } else {
      if (
        isTrueAttr(attrs.layout_alignParentLeft) ||
        isTrueAttr(attrs.layout_alignParentStart)
      ) {
        pushKnown('left-0')
      }
      if (
        isTrueAttr(attrs.layout_alignParentRight) ||
        isTrueAttr(attrs.layout_alignParentEnd)
      ) {
        pushKnown('right-0')
      }
      if (isTrueAttr(attrs.layout_alignParentTop)) pushKnown('top-0')
      if (isTrueAttr(attrs.layout_alignParentBottom)) pushKnown('bottom-0')
      if (isTrueAttr(attrs.layout_centerHorizontal)) {
        // layout_marginLeft/Right 会写死 left/right，勿再叠 translateX
        if (!attrs.layout_marginLeft?.trim() && !attrs.layout_marginRight?.trim()) {
          pushKnown('left-1/2')
          centerTranslate = 'x'
        }
      }
      if (isTrueAttr(attrs.layout_centerVertical)) {
        // layout_marginTop/Bottom 会写死 top/bottom；若仍保留 -translate-y-1/2 会整体上移半高
        if (!attrs.layout_marginTop?.trim() && !attrs.layout_marginBottom?.trim()) {
          pushKnown('top-1/2')
          centerTranslate = centerTranslate === 'x' ? 'xy' : 'y'
        }
      }
    }
  }

  for (const [attrKey, css] of [
    ['layout_marginLeft', 'left'],
    ['layout_marginRight', 'right'],
    ['layout_marginTop', 'top'],
    ['layout_marginBottom', 'bottom'],
  ] as const) {
    const raw = attrs[attrKey]?.trim()
    if (!raw || raw === 'null') continue
    const bind = styleBindingExpr(raw)
    if (bind) {
      parts.push(`${css}:{{${bind}}}px`)
      continue
    }
    if (isBinding(raw)) continue
    const n = Number(raw.replace(/px$/i, ''))
    if (Number.isFinite(n)) {
      const vw = pxToVw(n, designWidth)
      pushArb(css, css, vw)
    }
  }

  const zIndex = attrs.zIndex?.trim()
  if (zIndex && zIndex !== 'null' && !isBinding(zIndex)) {
    const n = Number(zIndex)
    if (Number.isFinite(n)) pushArb('z', 'z-index', String(n))
  }

  // 仅有居中 translate、无旋转：用工具类；否则合并进 style
  if (centerTranslate && !transformFns.length) {
    if (centerTranslate === 'xy') {
      classes.push(
        reg.shell(
          '-translate-xy-1-2',
          '-webkit-transform:translate(-50%,-50%);transform:translate(-50%,-50%)',
        ),
      )
    } else if (centerTranslate === 'x') {
      pushKnown('-translate-x-1/2')
    } else {
      pushKnown('-translate-y-1/2')
    }
  } else {
    const fns = [...transformFns]
    if (centerTranslate === 'xy') fns.push('translate(-50%,-50%)')
    else if (centerTranslate === 'x') fns.push('translateX(-50%)')
    else if (centerTranslate === 'y') fns.push('translateY(-50%)')
    if (fns.length) {
      const t = fns.join(' ')
      parts.push(`-webkit-transform:${t}`, `transform:${t}`)
    }
  }

  return {
    classes,
    style: parts.join(';'),
  }
}

/** @deprecated 兼容旧调用：仅返回 style 字符串（无 registry 时退回纯 style） */
function attrStyle(
  attrs: Record<string, string>,
  options?: {
    flexParent?: 'row' | 'column'
    isComponent?: boolean
    isRelativeChild?: boolean
    designWidth?: number
    registry?: ClassRegistry
  },
): string {
  if (!options?.registry) {
    // 无 registry：走临时 registry，丢弃类（不应再走到）
    const tmp = new ClassRegistry()
    return attrLayout(attrs, tmp, options).style
  }
  return attrLayout(attrs, options.registry, options).style
}

/** 解析 rotateX/Y/Z → transform 函数列表（支持 {angle} 绑定） */
function buildTransformFunctions(attrs: Record<string, string>): string[] {
  const parseAxis = (
    raw: string | undefined,
  ): { kind: 'static'; n: number } | { kind: 'bind'; expr: string } | null => {
    const t = raw?.trim()
    if (!t) return null
    const bind = styleBindingExpr(t)
    if (bind) return { kind: 'bind', expr: bind }
    if (isBinding(t)) return null
    const n = Number(t.replace(/deg$/i, ''))
    if (!Number.isFinite(n) || n === 0) return null
    return { kind: 'static', n }
  }

  const x = parseAxis(attrs.rotateX)
  const y = parseAxis(attrs.rotateY)
  const z = parseAxis(attrs.rotateZ)
  if (!x && !y && !z) return []

  const deg = (
    axis: { kind: 'static'; n: number } | { kind: 'bind'; expr: string },
  ): string =>
    axis.kind === 'bind' ? `{{${axis.expr}}}deg` : `${axis.n}deg`

  const t: string[] = []
  if (x || y) t.push('perspective(800px)')
  if (x) t.push(`rotateX(${deg(x)})`)
  if (y) t.push(`rotateY(${deg(y)})`)
  if (z) {
    // 仅 Z：用 2D rotate，兼容性更好；有 X/Y 时保留 rotateZ
    t.push(x || y ? `rotateZ(${deg(z)})` : `rotate(${deg(z)})`)
  }
  return t
}

function flexClasses(attrs: Record<string, string>, reg: ClassRegistry): string[] {
  const orientation = (attrs.orientation || 'vertical').toLowerCase()
  const horizontal = orientation === 'horizontal'
  const classes = reg.useMany([
    'flex',
    horizontal ? 'flex-row' : 'flex-col',
  ])
  // 与编辑器 / vue 导出 mapGravityMain、mapGravityCross 一致
  const gravity = (attrs.gravity || '').toLowerCase().trim()
  if (!gravity) return classes

  if (horizontal) {
    if (gravity.includes('right') || gravity.includes('end')) {
      classes.push(reg.use('justify-end'))
    } else if (gravity.includes('left') || gravity.includes('start')) {
      classes.push(reg.use('justify-start'))
    } else if (gravity.includes('center_horizontal') || gravity === 'center') {
      classes.push(reg.use('justify-center'))
    }

    if (gravity.includes('bottom')) {
      classes.push(reg.use('items-end'))
    } else if (gravity.includes('top')) {
      classes.push(reg.use('items-start'))
    } else if (gravity.includes('center_vertical') || gravity === 'center') {
      classes.push(reg.use('items-center'))
    }
  } else {
    if (gravity.includes('bottom')) {
      classes.push(reg.use('justify-end'))
    } else if (gravity.includes('top')) {
      classes.push(reg.use('justify-start'))
    } else if (gravity.includes('center_vertical') || gravity === 'center') {
      classes.push(reg.use('justify-center'))
    }

    if (gravity.includes('right') || gravity.includes('end')) {
      classes.push(reg.use('items-end'))
    } else if (gravity.includes('left') || gravity.includes('start')) {
      classes.push(reg.use('items-start'))
    } else if (gravity.includes('center_horizontal') || gravity === 'center') {
      classes.push(reg.use('items-center'))
    }
  }
  return classes
}

function parseGapPx(attrs: Record<string, string>): number | undefined {
  const gap = attrs.gap?.trim()
  if (!gap || isBinding(gap)) return undefined
  const n = Number(gap.replace(/px$/i, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** 组件 spacing wrap：静态 padding/margin → 工具类 */
function spacingClassesFromAttrs(
  attrs: Record<string, string>,
  reg: ClassRegistry,
  designWidth: number,
): string[] {
  const classes: string[] = []
  const pad = attrs.padding?.trim()
  if (pad && !isBinding(pad)) {
    const n = Number(pad.replace(/px$/i, ''))
    if (Number.isFinite(n)) {
      classes.push(reg.arb('p', 'padding', pxToVw(n, designWidth)))
    }
  }
  for (const [key, meta] of Object.entries(SPACING_TW)) {
    if (key === 'padding') continue
    const raw = attrs[key]?.trim()
    if (!raw || isBinding(raw)) continue
    const n = Number(raw.replace(/px$/i, ''))
    if (Number.isFinite(n)) {
      classes.push(reg.arb(meta.prefix, meta.prop, pxToVw(n, designWidth)))
    }
  }
  return classes
}

function siblingGapClasses(
  ctx: RenderCtx,
  options?: { everyItem?: boolean },
): string[] {
  if (ctx.flexGapPx == null) return []
  if (!(ctx.flexGapPx > 0)) return []
  if (!options?.everyItem && ctx.isLastFlexChild) return []
  const gap = pxToVw(ctx.flexGapPx, ctx.designWidth)
  if (ctx.parentFlex === 'row') {
    return [ctx.classRegistry.arb('mr', 'margin-right', gap)]
  }
  if (ctx.parentFlex === 'column') {
    return [ctx.classRegistry.arb('mb', 'margin-bottom', gap)]
  }
  return []
}

function mergeStyle(...chunks: Array<string | null | undefined>): string {
  return chunks
    .filter(Boolean)
    .join(';')
    .replace(/;+/g, ';')
    .replace(/^;|;$/g, '')
}

function styleAttr(style: string): string {
  if (!style) return ''
  // style 里常有 color:{{ a && b ? ... }}；若把 && 写成 &amp;&amp;，WXML 会报 unexpected ';'
  // 双引号属性内只需转义 "，mustache 表达式保持原样
  return ` style="${style.replace(/"/g, '&quot;')}"`
}

/** class + 可选动态 style */
function classStyleAttrs(
  classes: Array<string | null | undefined>,
  style?: string | null,
  extraClass?: string | null,
): string[] {
  const list = [...classes.filter(Boolean), extraClass].filter(
    (c): c is string => Boolean(c),
  )
  const out: string[] = []
  const c = classAttr(list)
  if (c) out.push(c)
  const s = styleAttr(style || '').trim()
  if (s) out.push(s)
  return out
}

type SyncHandler = { handlerName: string; fieldName: string }

type PageHandler = { name: string; body: string }

type RenderCtx = {
  indent: number
  usedComponents: Map<string, string>
  kind: 'page' | 'component'
  componentConfigs: Map<string, ComponentConfig>
  componentRoots: Map<string, XmlNode>
  resolveApi: (raw: string) => MpApiBinding | null
  apiData: Record<string, MpApiBinding>
  apiDataSeq: { n: number }
  syncHandlers: SyncHandler[]
  pageHandlers: PageHandler[]
  handlerSeq: { n: number }
  siblingMethodNames: string[]
  dataFieldNames: string[]
  designWidth: number
  /** 全局工具类注册表 */
  classRegistry: ClassRegistry
  /** 当前节点路径（0:Tag/1:Tag） */
  nodePath?: string
  /** path → 数据池 ref 字段名 */
  refPathMap?: Map<string, string>
  /** 数据池 type=ref */
  refFields?: MpRefField[]
  /** 已注册的 Modal 显隐 data key */
  modalVisibleKeys?: Set<string>
  parentFlex?: 'row' | 'column'
  parentIsRelative?: boolean
  inScrollColumn?: boolean
  flexGapPx?: number
  isLastFlexChild?: boolean
  /**
   * RelativeLayout 内与 overflow=scroll 同级、贴底的浮层：
   * 抬高 z-index，避免被 enhanced scroll-view 盖住（对齐编辑器叠层）
   */
  overlayAboveScroll?: boolean
}

/** 从布局结果拆出 padding，供 scroll-view 挪到内容包裹层 */
function extractPaddingFromLayout(
  classes: string[],
  style: string,
): {
  restClasses: string[]
  restStyle: string
  padClasses: string[]
  padStyle: string
} {
  const padClasses: string[] = []
  const restClasses: string[] = []
  for (const c of classes) {
    if (/^(p|pt|pr|pb|pl)(-|$)/.test(c)) padClasses.push(c)
    else restClasses.push(c)
  }
  const padStyleParts: string[] = []
  const restStyleParts: string[] = []
  for (const part of String(style || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (/^padding(-top|-right|-bottom|-left)?\s*:/i.test(part)) {
      padStyleParts.push(part)
    } else {
      restStyleParts.push(part)
    }
  }
  return {
    restClasses,
    restStyle: restStyleParts.join(';'),
    padClasses,
    padStyle: padStyleParts.join(';'),
  }
}

/** 统一布局：静态 → class，绑定 → style */
function layoutResult(
  attrs: Record<string, string>,
  ctx: RenderCtx,
  options?: { isComponent?: boolean },
): LayoutResult {
  const base = attrLayout(attrs, ctx.classRegistry, {
    flexParent: ctx.parentIsRelative ? undefined : ctx.parentFlex,
    isRelativeChild: Boolean(ctx.parentIsRelative),
    isComponent: options?.isComponent,
    designWidth: ctx.designWidth,
  })
  const classes = [...base.classes]
  if (ctx.inScrollColumn && ctx.parentFlex !== 'row') {
    classes.push(ctx.classRegistry.use('shrink-0'))
  }
  // 贴底操作栏等浮层压过 scroll-view 原生层
  if (
    ctx.overlayAboveScroll &&
    !classes.some((c) => c === 'z-arb-20' || /^z-arb-/.test(c) || c.startsWith('z-'))
  ) {
    classes.push(ctx.classRegistry.arb('z', 'z-index', '20'))
  }
  return { classes, style: base.style }
}

/** @deprecated 仅返回 style 字符串的旧接口 */
function layoutAttrStyle(
  attrs: Record<string, string>,
  ctx: RenderCtx,
  options?: { isComponent?: boolean },
): string {
  return layoutResult(attrs, ctx, options).style
}

function pad(n: number): string {
  return '  '.repeat(n)
}

function renderChildren(children: XmlNode[], ctx: RenderCtx): string {
  const parentPath = ctx.nodePath || ''
  const entries = children
    .map((child, index) => ({ child, index }))
    .filter(
      ({ child }) =>
        child.tag !== '#text' || Boolean((child.text || '').trim()),
    )
  const hasScrollSibling =
    Boolean(ctx.parentIsRelative) &&
    entries.some(
      ({ child }) =>
        (child.attrs?.overflow || '').trim().toLowerCase() === 'scroll',
    )
  return entries
    .map(({ child, index }, i) => {
      const childPath = parentPath
        ? `${parentPath}/${index}:${child.tag}`
        : `0:${child.tag}`
      const attrs = child.attrs || {}
      const overlayAboveScroll =
        hasScrollSibling &&
        isTrueAttr(attrs.layout_alignParentBottom) &&
        !(attrs.zIndex || '').trim()
      return renderNode(child, {
        ...ctx,
        nodePath: childPath,
        isLastFlexChild: i === entries.length - 1,
        overlayAboveScroll,
      })
    })
    .filter(Boolean)
    .join('\n')
}

function openTag(
  tag: string,
  attrs: string[],
  indent: number,
  selfClosing = false,
): string {
  const a = attrs.filter(Boolean).join(' ')
  const space = a ? ` ${a}` : ''
  return `${pad(indent)}<${tag}${space}${selfClosing ? ' />' : '>'}`
}

export function renderNode(node: XmlNode, ctx: RenderCtx): string {
  if (node.tag === '#text') {
    const text = node.text?.trim()
    if (!text) return ''
    return `${pad(ctx.indent)}<text>${escapeXml(toWxmlText(text))}</text>`
  }

  if (node.tag === 'Fragment') {
    return renderChildren(node.children, ctx)
  }

  const attrs = node.attrs
  const repeat = attrs.repeat?.trim()
  const forAttrs: string[] = []
  if (repeat) {
    const listExpr = normalizeExpr(repeat.replace(/^\{|\}$/g, '').trim() || repeat)
    forAttrs.push(`wx:for="{{${listExpr}}}"`, 'wx:for-item="item"', 'wx:for-index="index"', 'wx:key="index"')
  }

  // Slot????????????slot
  if (node.tag === 'Slot') {
    const name = attrs.name?.trim() || 'default'
    const inner = renderChildren(node.children, { ...ctx, indent: ctx.indent + 1 })
    if (ctx.kind === 'component') {
      const slotAttr = name === 'default' ? '' : ` name="${escapeXml(name)}"`
      if (!inner.trim()) {
        return `${pad(ctx.indent)}<slot${slotAttr} />`
      }
      return `${pad(ctx.indent)}<slot${slotAttr}>\n${inner}\n${pad(ctx.indent)}</slot>`
    }
    return inner
  }

  if (node.tag === 'Modal') {
    const modalName = attrs.name?.trim() || `modal_${ctx.indent}`
    const dataKey = modalVisibleDataKey(modalName)
    ctx.modalVisibleKeys?.add(dataKey)
    const hideName = `__hideModal_${dataKey}`
    if (!ctx.pageHandlers.some((h) => h.name === hideName)) {
      ctx.pageHandlers.push({
        name: hideName,
        body: `    var p = {}; p[${JSON.stringify(dataKey)}] = false; this.setData(p)`,
      })
    }
    if (!ctx.pageHandlers.some((h) => h.name === '__modalNoop')) {
      ctx.pageHandlers.push({
        name: '__modalNoop',
        body: `    /* catchtap: 阻止冒泡关闭 */`,
      })
    }
    const closeOnClick =
      attrs.closeOnClick == null ||
      attrs.closeOnClick === '' ||
      attrs.closeOnClick === 'true' ||
      attrs.closeOnClick === '1'
    const bg = (attrs.background || 'rgba(0,0,0,0.45)').trim()
    const overlayClasses = ctx.classRegistry.useMany([
      'absolute',
      'inset-0',
      'box-border',
    ])
    // fixed 脱出零尺寸宿主；pointer-events 覆盖父级 none
    const overlayStyle = mergeStyle(
      `position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;pointer-events:auto;background:${toCssColor(bg)}`,
    )
    const panelClasses = ctx.classRegistry.useMany([
      'relative',
      'w-full',
      'h-full',
      'min-h-0',
      'overflow-hidden',
      'box-border',
    ])
    // 与 vue @click.self 一致：点空白遮罩关闭；仅内容根节点 catchtap 拦截
    const contentChildren = node.children.filter(
      (c) => c.tag !== '#text' || Boolean((c.text || '').trim()),
    )
    const inner = contentChildren
      .map((child, i) => {
        const childPath = ctx.nodePath
          ? `${ctx.nodePath}/${node.children.indexOf(child)}:${child.tag}`
          : `0:${child.tag}`
        const rendered = renderNode(child, {
          ...ctx,
          indent: ctx.indent + 2,
          nodePath: childPath,
          parentFlex: undefined,
          parentIsRelative: true,
          flexGapPx: undefined,
          isLastFlexChild: i === contentChildren.length - 1,
        })
        if (!closeOnClick || !rendered.trim()) return rendered
        return rendered.replace(
          /^( *)<([\w-]+)/,
          `$1<$2 catchtap="__modalNoop"`,
        )
      })
      .filter(Boolean)
      .join('\n')
    // bindtap：空白区冒泡到遮罩关闭；内容 catchtap 不会冒泡
    const overlayTap = closeOnClick ? `bindtap="${hideName}"` : ''
    const open = openTag(
      'view',
      [
        `wx:if="{{${dataKey}}}"`,
        overlayTap,
        ...classStyleAttrs(overlayClasses, overlayStyle),
      ],
      ctx.indent,
    )
    const panelOpen = openTag(
      'view',
      [...classStyleAttrs(panelClasses, '')],
      ctx.indent + 1,
    )
    return `${open}\n${panelOpen}\n${inner}\n${pad(ctx.indent + 1)}</view>\n${pad(ctx.indent)}</view>`
  }

  if (node.tag === 'Component') {
    const id = attrs.componentId?.trim()
    if (!id) return `${pad(ctx.indent)}<!-- Component ?? componentId -->`
    const tagName = toComponentTag(id)
    ctx.usedComponents.set(id, `/components/${id}/index`)
    const config = ctx.componentConfigs.get(id)
    const componentRoot = ctx.componentRoots.get(id)
    const outOfFlow = Boolean(componentRoot && isOutOfFlowTree(componentRoot))
    const gapClasses = siblingGapClasses(ctx, { everyItem: Boolean(repeat) })
    // 自定义组件上的 class/style 常不生效（virtualHost / 样式隔离）→ 一律外包 view
    const layout = outOfFlow
      ? {
          classes: ctx.classRegistry.useMany([...OUT_OF_FLOW_HOST_CLASSES]),
          style: '',
        }
      : layoutResult(attrs, ctx, { isComponent: true })
    const wrapClasses = outOfFlow
      ? layout.classes
      : [...layout.classes, ...gapClasses, ctx.classRegistry.use('box-border')]

    // 组件根上的 zIndex 必须落到页面外包 view：小程序里组件内 z-index
    // 无法压过同级 Absolute 兄弟（否则 LoadingPlaceholder 会盖住 TitleBar）
    if (!outOfFlow) {
      const usageZ = attrs.zIndex?.trim()
      const rootZ = componentRoot?.attrs?.zIndex?.trim()
      const zRaw =
        usageZ && usageZ !== 'null' && !isBinding(usageZ)
          ? usageZ
          : rootZ && rootZ !== 'null' && !isBinding(rootZ)
            ? rootZ
            : ''
      if (zRaw) {
        const n = Number(zRaw)
        if (Number.isFinite(n)) {
          const zClass = ctx.classRegistry.arb('z', 'z-index', String(n))
          if (!wrapClasses.includes(zClass)) wrapClasses.push(zClass)
        }
      }
    }

    const propAttrs: string[] = []
    const wrapExtraAttrs: string[] = []
    const refName = ctx.nodePath
      ? ctx.refPathMap?.get(ctx.nodePath)
      : undefined
    if (refName) {
      propAttrs.push(`id="${escapeXml(refName)}"`)
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'slot') {
        const slotName = String(value || '').trim()
        if (slotName && slotName !== 'default') {
          // slot 必须在外包 view 上，否则包一层后插槽失效
          wrapExtraAttrs.push(`slot="${escapeXml(slotName)}"`)
        }
        continue
      }
      if (shouldSkipComponentAttr(key, value, config)) continue
      const propDef = config?.props.find((p) => p.name === key)

      const wxmlProp = propDef ? toWxmlPropName(key) : key
      if (propDef?.type === 'api' || parseApiPropBinding(value)) {
        const binding = ctx.resolveApi(value)
        if (!binding) continue
        const dataKey = `__api_${key}_${ctx.apiDataSeq.n++}`
        ctx.apiData[dataKey] = binding
        propAttrs.push(`${wxmlProp}="{{${dataKey}}}"`)
        continue
      }

      if (isBinding(value)) {
        const trimmedVal = value.trim()
        const whole = unwrapWholeBinding(trimmedVal)
        if (whole == null) {
          // 非整段 {expr}（混合文案 / JSON 字面量等）暂不导出为 prop
          continue
        }
        const expr = normalizeBindingOperators(whole)
        if (!isWxmlComponentPropExpr(expr)) continue
        propAttrs.push(`${wxmlProp}="{{${normalizeWxmlPropExpr(expr)}}}"`)
        if (
          ctx.kind === 'page' &&
          propDef?.twoWay &&
          isSimpleBindingPath(expr) &&
          /^[A-Za-z_$][\w$]*$/.test(expr)
        ) {
          const handlerName = `__sync_${key}_${expr}`
          if (!ctx.syncHandlers.some((h) => h.handlerName === handlerName)) {
            ctx.syncHandlers.push({ handlerName, fieldName: expr })
          }
          const evt = `update:${key}`
          propAttrs.push(`bind:${evt}="${handlerName}"`)
        }
      } else if (propDef?.type === 'boolean') {
        const b = parseBoolAttr(value, false)
        propAttrs.push(`${wxmlProp}="{{${b}}}"`)
      } else if (value != null && value !== '') {
        propAttrs.push(`${wxmlProp}="${escapeXml(value)}"`)
      }
    }
    for (const evt of config?.events ?? []) {
      const evtName = evt.name?.trim()
      if (!evtName) continue
      const eventParamNames = (evt.params ?? [])
        .map((p) => String(p.name ?? '').trim())
        .filter(Boolean)
      propAttrs.push(
        ...collectComponentCustomEventAttrs(
          evtName,
          attrs[evtName],
          ctx,
          eventParamNames,
        ),
      )
    }

    // virtualHost:false 时 host 默认撑开内容高；match_parent 需显式拉满外包 view，
    // 否则内部 scroll-view 的 h-full 没有约束高度，页面又 disableScroll → 无法滚动
    if (!outOfFlow) {
      const hRaw = (attrs.height || config?.height || '').trim()
      const wRaw = (attrs.width || config?.width || '').trim()
      const hostStyle: string[] = []
      if (wRaw === 'match_parent') hostStyle.push('width:100%')
      if (hRaw === 'match_parent') {
        hostStyle.push(
          'height:100%',
          'min-height:0',
          'display:flex',
          'flex-direction:column',
        )
      }
      if (hostStyle.length) {
        propAttrs.push(`style="${hostStyle.join(';')}"`)
      }
    }

    const tagIndent = ctx.indent + 1
    const inner = renderChildren(node.children, {
      ...ctx,
      indent: tagIndent + 1,
      parentFlex: undefined,
      parentIsRelative: false,
      flexGapPx: undefined,
    })
    const open = openTag(tagName, propAttrs, tagIndent)
    const block = !inner.trim()
      ? openTag(tagName, propAttrs, tagIndent, true)
      : `${open}\n${inner}\n${pad(tagIndent)}</${tagName}>`

    const wrapAttrs = [
      ...forAttrs,
      ...wrapExtraAttrs,
      ...visibilityWxmlAttrs(attrs),
      ...classStyleAttrs(wrapClasses, layout.style),
    ]
    const wrapOpen = openTag('view', wrapAttrs, ctx.indent)
    return `${wrapOpen}\n${block}\n${pad(ctx.indent)}</view>`
  }

  return renderWidget(node, ctx, forAttrs)
}

function toComponentTag(componentId: string): string {
  // ????????????????
  const kebab = componentId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
  return kebab.includes('-') ? kebab : `c-${kebab}`
}

/** properties 用驼峰；wxml 传参须连字符（官方约定），否则布尔默认值不会被覆盖 */
function toWxmlPropName(propName: string): string {
  const name = propName.trim()
  if (!name) return name
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

function renderWidget(
  node: XmlNode,
  ctx: RenderCtx,
  forAttrs: string[],
): string {
  const attrs = node.attrs
  const vis = visibilityWxmlAttrs(attrs)

  if (node.tag === 'Swiper') {
    const layout = layoutResult(attrs, ctx)
    const classes = [...layout.classes, ...siblingGapClasses(ctx)]
    // 已有明确宽高（含 w-arb-*）时不要再塞 w-full/h-full，否则样式表排序会盖掉尺寸
    if (!hasWidthClass(classes)) {
      classes.push(ctx.classRegistry.use('w-full'))
    }
    if (!hasHeightClass(classes)) {
      classes.push(ctx.classRegistry.use('h-full'))
    }
    if (!classes.includes('overflow-hidden')) {
      classes.push(ctx.classRegistry.use('overflow-hidden'))
    }
    const indicator = parseBoolAttr(attrs.indicatorDots, true)
    const autoplay = parseBoolAttr(attrs.autoplay, false)
    const circular = parseBoolAttr(attrs.circular, true)
    const interval = attrs.interval?.trim() || '3000'
    const duration = attrs.duration?.trim() || '500'
    const current = attrs.current?.trim() || '0'
    const indicatorColor = toConcreteColor(
      (attrs.indicatorColor || '').trim() || 'rgba(0,0,0,.3)',
    )
    const indicatorActiveColor = toConcreteColor(
      (attrs.indicatorActiveColor || '').trim() || '#409eff',
    )
    const clickAttrs = collectClickEventAttrs(attrs, ctx)
    const slides = node.children
      .filter((c) => c.tag !== '#text')
      .map((child) => {
        const inner = renderNode(child, {
          ...ctx,
          indent: ctx.indent + 2,
          parentFlex: undefined,
          parentIsRelative: false,
        })
        return `${pad(ctx.indent + 1)}<swiper-item>\n${inner}\n${pad(ctx.indent + 1)}</swiper-item>`
      })
      .filter(Boolean)
      .join('\n')
    const open = openTag(
      'swiper',
      [
        ...forAttrs,
        ...vis,
        ...clickAttrs,
        `indicator-dots="${indicator}"`,
        `autoplay="${autoplay}"`,
        `circular="${circular}"`,
        `interval="${escapeXml(interval)}"`,
        `duration="${escapeXml(duration)}"`,
        `current="${escapeXml(current)}"`,
        `indicator-color="${escapeXml(indicatorColor)}"`,
        `indicator-active-color="${escapeXml(indicatorActiveColor)}"`,
        ...classStyleAttrs(classes, layout.style),
      ],
      ctx.indent,
    )
    if (!slides) return `${open}</swiper>`
    return `${open}\n${slides}\n${pad(ctx.indent)}</swiper>`
  }

  if (node.tag === 'MultiWindow') {
    const activeExpr = bindingToActiveExpr(attrs.active || '')
    const layout = layoutResult(attrs, ctx)
    const classes = [
      ...layout.classes,
      ...ctx.classRegistry.useMany(['relative', 'min-h-0', 'overflow-hidden']),
    ]
    const paneClass = ctx.classRegistry.shell(
      'mw-pane',
      'position:absolute;left:0;top:0;right:0;bottom:0;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box',
    )
    // active 计算字段首帧常为空：先显示第一窗，避免白屏等待 attached 重算。
    // 用 hidden 而非 wx:if：窗格内若有 <slot>（如 LoadingPlaceholder），wx:if
    // 晚挂载会导致插槽内容空白 → 白屏；hidden 保持节点与插槽始终在树上。
    const activeEmpty = `(${activeExpr} == null || (${activeExpr} + '') === '')`
    const panes = node.children
      .filter((c) => c.tag !== '#text')
      .map((child, index) => {
        const windowKey = (child.attrs.windowKey || '').trim()
        const match = windowKey
          ? `(${activeExpr} + '') === '${escapeWxmlStr(windowKey)}'`
          : 'false'
        const showExpr = windowKey
          ? index === 0
            ? `${match} || ${activeEmpty}`
            : match
          : 'false'
        const hiddenAttr = `hidden="{{!(${showExpr})}}"`
        const childCtx: RenderCtx = {
          ...ctx,
          indent: ctx.indent + 2,
          parentFlex: 'column',
        }
        const inner = renderNode(child, childCtx)
        return `${pad(ctx.indent + 1)}<view ${hiddenAttr} class="${paneClass}">\n${inner}\n${pad(ctx.indent + 1)}</view>`
      })
      .filter(Boolean)
      .join('\n')
    const open = openTag(
      'view',
      [...forAttrs, ...vis, ...classStyleAttrs(classes, layout.style)],
      ctx.indent,
    )
    if (!panes) return `${open}</view>`
    return `${open}\n${panes}\n${pad(ctx.indent)}</view>`
  }

  if (node.tag === 'Text') {
    const raw = attrs.text || node.text || ''
    const content = bindingAwareEscape(toWxmlText(raw))
    const layout = layoutResult(attrs, ctx)
    const classes = [...layout.classes, ...siblingGapClasses(ctx)]
    const clickAttrs = collectClickEventAttrs(attrs, ctx)
    const open = openTag(
      'text',
      [
        ...forAttrs,
        ...vis,
        ...clickAttrs,
        ...classStyleAttrs(classes, layout.style),
      ],
      ctx.indent,
    )
    return `${open}${content}</text>`
  }

  if (node.tag === 'Button') {
    const raw = attrs.text || 'Button'
    const content = bindingAwareEscape(toWxmlText(raw))
    const layout = layoutResult(attrs, ctx)
    const classes = [
      ...layout.classes,
      ...siblingGapClasses(ctx),
      ...ctx.classRegistry.useMany(['flex', 'items-center', 'justify-center']),
    ]
    // 默认蓝底白字仅在未配置时补上；勿写进 shell，否则会盖过 bg-*/text-* 工具类
    const bgRaw = attrs.background?.trim()
    const hasBg =
      Boolean(bgRaw && bgRaw !== 'transparent' && bgRaw !== 'null') ||
      layout.classes.some((c) => c.startsWith('bg-')) ||
      /\bbackground\s*:/.test(layout.style)
    const colorRaw = attrs.textColor?.trim() || attrs.color?.trim()
    const hasColor =
      Boolean(colorRaw && colorRaw !== 'null') ||
      layout.classes.some((c) => c.startsWith('text-arb-')) ||
      /(?:^|;)\s*color\s*:/.test(layout.style)
    if (!hasBg) {
      classes.push(ctx.classRegistry.arb('bg', 'background', '#409eff'))
    }
    if (!hasColor) {
      classes.push(ctx.classRegistry.arb('text', 'color', '#ffffff'))
    }
    if (!attrs.borderRadius?.trim()) {
      classes.push(
        ctx.classRegistry.arb(
          'rounded',
          'border-radius',
          pxToVw(4, ctx.designWidth),
        ),
      )
    }
    const hasPadding =
      Boolean(attrs.padding?.trim()) ||
      Boolean(attrs.paddingLeft?.trim()) ||
      Boolean(attrs.paddingRight?.trim()) ||
      Boolean(attrs.paddingTop?.trim()) ||
      Boolean(attrs.paddingBottom?.trim())
    if (!hasPadding) {
      classes.push(
        ctx.classRegistry.shell(
          'app-button',
          `padding:${pxToVw(8, ctx.designWidth)} ${pxToVw(14, ctx.designWidth)}`,
        ),
      )
    }
    const clickAttrs = collectClickEventAttrs(attrs, ctx)
    const open = openTag(
      'view',
      [
        ...forAttrs,
        ...vis,
        ...clickAttrs,
        ...classStyleAttrs(classes, layout.style),
      ],
      ctx.indent,
    )
    return `${open}${content}</view>`
  }

  if (node.tag === 'Input') {
    const value = attrs.value?.trim() || ''
    const placeholder = attrs.placeholder || ''
    const layout = layoutResult(attrs, ctx)
    const classes = [...layout.classes, ...siblingGapClasses(ctx)]
    const valueAttr = isBinding(value)
      ? `value="{{${normalizeExpr(value.replace(/^\{|\}$/g, ''))}}}"`
      : `value="${escapeXml(value)}"`
    return openTag(
      'input',
      [
        ...forAttrs,
        ...vis,
        valueAttr,
        `placeholder="${escapeXml(placeholder)}"`,
        ...classStyleAttrs(classes, layout.style),
      ],
      ctx.indent,
      true,
    )
  }

  if (node.tag === 'Image') {
    const src = attrs.src?.trim() || ''
    const layout = layoutResult(attrs, ctx)
    const classes = [...layout.classes, ...siblingGapClasses(ctx)]
    const mode =
      attrs.objectFit === 'contain'
        ? 'aspectFit'
        : attrs.objectFit === 'fill'
          ? 'scaleToFill'
          : 'aspectFill'
    const srcAttr = isBinding(src)
      ? `src="{{${normalizeExpr(
          templateLiteralsToConcat(
            normalizeBindingOperators(
              unwrapWholeBinding(src) ??
                src.replace(/^\{/, '').replace(/\}$/, ''),
            ),
          ),
        )}}}"`
      : `src="${escapeXml(src)}"`
    const clickAttrs = collectClickEventAttrs(attrs, ctx).map((a) =>
      a.startsWith('bindtap=') ? a.replace(/^bindtap=/, 'catchtap=') : a,
    )
    return openTag(
      'image',
      [
        ...forAttrs,
        ...vis,
        ...clickAttrs,
        srcAttr,
        `mode="${mode}"`,
        ...classStyleAttrs(classes, layout.style),
      ],
      ctx.indent,
      true,
    )
  }

  if (node.tag === 'Icon') {
    const iconId = attrs.iconId?.trim() || ''
    const size = attrs.size?.trim()
    const sizeBind = styleBindingExpr(size)
    const dimClasses: string[] = []
    let dimStyle = ''
    if (sizeBind) {
      dimStyle = `width:${pxBindToVw(sizeBind, ctx.designWidth)};height:${pxBindToVw(sizeBind, ctx.designWidth)}`
    } else {
      const n = size ? Number(size.replace(/px$/i, '')) : 24
      const dim = Number.isFinite(n)
        ? pxToVw(n, ctx.designWidth)
        : pxToVw(24, ctx.designWidth)
      dimClasses.push(
        ctx.classRegistry.arb('w', 'width', dim),
        ctx.classRegistry.arb('h', 'height', dim),
      )
    }
    const rotateFns = buildTransformFunctions(attrs)
    // size/color/iconId 不参与布局；width/height=wrap_content 会生成 w-fit 盖掉尺寸
    const layoutOnly = { ...attrs }
    delete layoutOnly.rotateX
    delete layoutOnly.rotateY
    delete layoutOnly.rotateZ
    delete layoutOnly.iconId
    delete layoutOnly.size
    delete layoutOnly.color
    delete layoutOnly.width
    delete layoutOnly.height
    delete layoutOnly.textSize
    delete layoutOnly.dynamicStyles
    const clickAttrs = collectClickEventAttrs(attrs, ctx).map((a) =>
      a.startsWith('bindtap=') ? a.replace(/^bindtap=/, 'catchtap=') : a,
    )
    const wrapLayout = layoutResult(layoutOnly, ctx)
    const wrapClasses = [
      ...wrapLayout.classes,
      ...siblingGapClasses(ctx),
      ...dimClasses,
      ...ctx.classRegistry.useMany(['inline-flex', 'shrink-0']),
    ]
    const hasRadius =
      Boolean(attrs.borderRadius?.trim()) ||
      Boolean(attrs.borderTopLeftRadius?.trim()) ||
      Boolean(attrs.borderTopRightRadius?.trim()) ||
      Boolean(attrs.borderBottomRightRadius?.trim()) ||
      Boolean(attrs.borderBottomLeftRadius?.trim())
    if (hasRadius) {
      wrapClasses.push(ctx.classRegistry.use('overflow-hidden'))
    }
    const wrapStyle = mergeStyle(
      wrapLayout.style,
      dimStyle,
      rotateFns.length
        ? `-webkit-transform:${rotateFns.join(' ')};transform:${rotateFns.join(' ')}`
        : '',
    )

    ctx.usedComponents.set('app-icon', '/components/app-icon/index')
    const nameAttr = isBinding(iconId)
      ? `name="{{${normalizeExpr(iconId.replace(/^\{|\}$/g, ''))}}}"`
      : `name="${escapeXml(iconId)}"`
    const colorRes = resolveDynamicStyleExpr(
      'color',
      attrs.color?.trim() || undefined,
      attrs,
      '#333333',
      { concrete: true },
    )
    // Icon 走 SVG fill，必须用具体色值（不能 var()）；再经 palette.value 兜底绑定 key
    const colorAttr = colorRes.static
      ? `color="${escapeXml(colorRes.static)}"`
      : `color="{{${wrapConcreteColorExpr(colorRes.expr)}}}"`
    const iconOpen = openTag(
      'app-icon',
      [nameAttr, colorAttr],
      ctx.indent + 1,
      true,
    )
    const open = openTag(
      'view',
      [
        ...forAttrs,
        ...vis,
        ...clickAttrs,
        ...classStyleAttrs(wrapClasses, wrapStyle),
      ],
      ctx.indent,
    )
    return `${open}\n${iconOpen}\n${pad(ctx.indent)}</view>`
  }

  const overflow = (attrs.overflow || '').toLowerCase()
  const isScroll = overflow === 'scroll'
  const isLinear = node.tag === 'LinearLayout'
  const isRelative = node.tag === 'RelativeLayout'
  const useNativeRefresher =
    isScroll && shouldUseNativeCustomRefresher(attrs, ctx)
  /**
   * 纵向 scroll-view：不要把 padding / flex 直接打在 scroll-view 上。
   * enhanced + enable-flex 时 padding-bottom 常不计入滚动高度，和编辑器 CSS overflow 不一致。
   * 改为内层内容列承载 padding+flex，scroll-view 只负责视口滚动。
   */
  const wrapScrollContent =
    isScroll &&
    isLinear &&
    attrs.orientation !== 'horizontal' &&
    !useNativeRefresher
  const layout = layoutResult(attrs, ctx)
  let scrollClasses = [...layout.classes]
  let scrollStyle = layout.style
  let contentPadClasses: string[] = []
  let contentPadStyle = ''
  if (wrapScrollContent) {
    const split = extractPaddingFromLayout(scrollClasses, scrollStyle)
    scrollClasses = split.restClasses
    scrollStyle = split.restStyle
    contentPadClasses = split.padClasses
    contentPadStyle = split.padStyle
  }
  const linearFlexClasses =
    isLinear && !useNativeRefresher
      ? flexClasses(attrs, ctx.classRegistry)
      : []
  const classes = [
    ...scrollClasses,
    ...siblingGapClasses(ctx),
    ...(wrapScrollContent ? [] : linearFlexClasses),
  ]
  if (isRelative) {
    classes.push(...ctx.classRegistry.useMany(['relative', 'box-border']))
  }
  if (isScroll && !isLinear) {
    classes.push(ctx.classRegistry.use('h-full'))
  }

  const tag = isScroll ? 'scroll-view' : 'view'

  // ??????pullHeight ?? refresher slot????? touch ??
  let pullBarNode: XmlNode | null = null
  let scrollChildren = node.children
  if (useNativeRefresher) {
    const solid = node.children.filter(
      (c) => c.tag !== '#text' || Boolean((c.text || '').trim()),
    )
    const first = solid[0]
    if (first && /pullHeight/.test(first.attrs?.height || '')) {
      pullBarNode = first
      const skip = new Set([first])
      scrollChildren = node.children.filter((c) => !skip.has(c))
    }
  }

  const childFlex: 'row' | 'column' | undefined = isLinear
    ? attrs.orientation === 'horizontal'
      ? 'row'
      : 'column'
    : isRelative
      ? undefined
      : ctx.parentFlex

  const scrollAttrs: string[] = []
  if (isScroll) {
    const vertical = attrs.orientation !== 'horizontal'
    if (vertical) {
      scrollAttrs.push('scroll-y="true"')
    } else {
      scrollAttrs.push('scroll-x="true"')
    }
    scrollAttrs.push('enhanced="true"')
    scrollAttrs.push('show-scrollbar="false"')
    // 纵向内容已包内层 flex 列，勿再 enable-flex（padding 失效 / 滚动高度异常）
    if (isLinear && !useNativeRefresher && !wrapScrollContent) {
      scrollAttrs.push('enable-flex="true"')
    }
    if (attrs.onScrollToLower?.trim()) {
      scrollAttrs.push('lower-threshold="150"')
    }
    if (attrs.onScrollToUpper?.trim()) {
      scrollAttrs.push('upper-threshold="50"')
    }
    if (useNativeRefresher) {
      ensureNativeCustomRefresherHandlers(ctx)
      scrollAttrs.push('refresher-enabled="{{true}}"')
      scrollAttrs.push('refresher-threshold="{{100}}"')
      scrollAttrs.push('refresher-default-style="none"')
      scrollAttrs.push('refresher-triggered="{{refreshing}}"')
      scrollAttrs.push('bindrefresherpulling="__onRefresherPulling"')
      scrollAttrs.push('bindrefresherrefresh="__onRefresherRefresh"')
      scrollAttrs.push('bindrefresherrestore="__onRefresherRestore"')
      scrollAttrs.push('bindrefresherabort="__onRefresherRestore"')
    }
  }
  const clickAttrs = collectClickEventAttrs(attrs, ctx)
  const scrollTouchAttrs = collectScrollTouchEventAttrs(attrs, ctx, {
    skipTouch: useNativeRefresher,
  })
  // enhanced scroll-view 慢滑触底时常不触发 bindscrolltolower → 用 bindscroll 边缘检测兜底
  const scrollLowerWired = wireScrollToLowerFallback(
    ctx,
    scrollTouchAttrs,
    Boolean(attrs.onScrollToLower?.trim()),
  )
  const scrollTouchWired = scrollLowerWired.attrs
  if (scrollLowerWired.scrollId) {
    scrollAttrs.push(`id="${scrollLowerWired.scrollId}"`)
  }

  const childCtx: RenderCtx = {
    ...ctx,
    indent: ctx.indent + (isRelative || wrapScrollContent ? 2 : 1),
    parentFlex: childFlex,
    parentIsRelative: isRelative,
    inScrollColumn:
      Boolean(ctx.inScrollColumn) ||
      (isScroll && attrs.orientation !== 'horizontal'),
    flexGapPx: isLinear ? parseGapPx(attrs) : undefined,
  }
  const contentInner = renderChildren(scrollChildren, childCtx)

  let refresherSlot = ''
  if (useNativeRefresher && pullBarNode) {
    const bar = renderNode(pullBarNode, {
      ...ctx,
      indent: ctx.indent + 1,
      parentFlex: 'column',
    })
    refresherSlot = bar.replace(/^( *)<(\w+)/, (_m, sp: string, tagName: string) => {
      return `${sp}<${tagName} slot="refresher"`
    })
    refresherSlot = refresherSlot.replace(/style="([^"]*)"/, (_m, style: string) => {
      let s = style
      if (!/width\s*:/.test(s)) s = `width:100%;${s}`
      if (!/box-sizing\s*:/.test(s)) s += ';box-sizing:border-box'
      return `style="${s}"`
    })
  }

  const open = openTag(
    tag,
    [
      ...forAttrs,
      ...vis,
      ...scrollAttrs,
      ...clickAttrs,
      ...scrollTouchWired,
      ...classStyleAttrs(classes, scrollStyle),
    ],
    ctx.indent,
  )
  // RelativeLayout：内层再开一层 relative，使 padding（如 statusBar）压缩内容区
  let bodyInner = contentInner
  if (wrapScrollContent && contentInner.trim()) {
    const innerPad = pad(ctx.indent + 1)
    const wrapClasses = [
      ...ctx.classRegistry.useMany(['w-full', 'box-border']),
      ...linearFlexClasses,
      ...contentPadClasses,
    ]
    const wrapOpen = openTag(
      'view',
      classStyleAttrs(wrapClasses, contentPadStyle),
      ctx.indent + 1,
    )
    bodyInner = `${wrapOpen}\n${contentInner}\n${innerPad}</view>`
  } else if (isRelative && contentInner.trim()) {
    const innerPad = pad(ctx.indent + 1)
    const innerClass = ctx.classRegistry.shell(
      'relative-inner',
      'position:relative;width:100%;height:100%;min-height:0;box-sizing:border-box',
    )
    bodyInner = `${innerPad}<view class="${innerClass}">\n${contentInner}\n${innerPad}</view>`
  }
  const parts = [refresherSlot, bodyInner].filter((p) => p.trim())
  if (!parts.length) return `${open}</${tag}>`
  return `${open}\n${parts.join('\n')}\n${pad(ctx.indent)}</${tag}>`
}

function bindingAwareEscape(text: string): string {
  // ?? {{expr}}???? XML ??
  const parts: string[] = []
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('{{', i)
    if (start === -1) {
      parts.push(escapeXml(text.slice(i)))
      break
    }
    parts.push(escapeXml(text.slice(i, start)))
    const end = text.indexOf('}}', start)
    if (end === -1) {
      parts.push(escapeXml(text.slice(start)))
      break
    }
    parts.push(text.slice(start, end + 2))
    i = end + 2
  }
  return parts.join('')
}

function pageDataObject(data: PageData | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of data?.fields ?? []) {
    const name = field.name.trim()
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue
    if (field.binding === 'computed') {
      // 计算字段初始占位；onLoad 后会重算
      out[name] = field.value ?? null
      continue
    }
    if (field.type === 'ref' || field.type === 'api') continue
    // 控制器 json 等允许显式 null（拉取前占位，配合 notEmpty）
    out[name] = field.value === undefined ? null : field.value
  }
  return out
}

/** data: { ... } 字面量；有 remark 的字段带 // 注释 */
function formatPageDataLiteral(
  data: PageData | undefined,
  extras: Record<string, unknown>,
  indent: string,
): string {
  const remarkByName = new Map<string, string>()
  for (const field of data?.fields ?? []) {
    const name = field.name.trim()
    const remark = (field.remark || '').trim()
    if (name && remark) remarkByName.set(name, remark)
  }
  const base = pageDataObject(data)
  const merged: Record<string, unknown> = { ...base, ...extras }
  const keys = Object.keys(merged)
  if (!keys.length) return '{}'

  const lines: string[] = ['{']
  for (const key of keys) {
    const remark = remarkByName.get(key)
    if (remark) {
      const c = lineComment(remark, `${indent}  `)
      if (c) lines.push(c)
    }
    const raw = JSON.stringify(merged[key], null, 2)
    const value = raw
      .split('\n')
      .map((l, i) => (i === 0 ? l : `${indent}  ${l}`))
      .join('\n')
    lines.push(`${indent}  ${JSON.stringify(key)}: ${value},`)
  }
  lines.push(`${indent}}`)
  return lines.join('\n')
}

/** statusBar.textStyle="{statusBarColor}" → 字段名；静态 white/black 返回 null */
function parseStatusBarTextStyleField(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  const t = raw.trim()
  const m = t.match(/^\{([A-Za-z_$][\w$]*)\}$/)
  return m ? m[1]! : null
}

export function generatePageFiles(options: {
  pageId: string
  title: string
  root: XmlNode | null
  data: PageData
  componentConfigs: Map<string, ComponentConfig>
  componentRoots?: Map<string, XmlNode>
  resolveApi: (raw: string) => MpApiBinding | null
  /** 画布设计宽度（项目 canvas.width） */
  designWidth?: number
  /** 全局工具类注册表（跨页面/组件共享） */
  classRegistry?: ClassRegistry
  /** ?? statusBar ???????????? */
  statusBar?: {
    textStyle?: string
    backgroundColor?: string
    cover?: boolean | string
    navigationBar?: boolean | string
  } | null
}): { wxml: string; wxss: string; js: string; json: string; usedComponents: Map<string, string>; usedApis: MpApiBinding[] } {
  const designWidth =
    options.designWidth && options.designWidth > 0
      ? options.designWidth
      : DEFAULT_CANVAS_WIDTH
  const classRegistry = options.classRegistry ?? new ClassRegistry()
  const usedComponents = new Map<string, string>()
  const apiData: Record<string, MpApiBinding> = {}
  const syncHandlers: SyncHandler[] = []
  const pageHandlers: PageHandler[] = []
  const modalVisibleKeys = new Set<string>()
  const refFields = collectMpRefFields(
    options.data?.fields,
    options.root,
    options.componentConfigs,
  )
  const refPathMap = new Map(
    refFields.map((f) => [f.nodePath, f.name] as const),
  )
  const rootPath = options.root ? `0:${options.root.tag}` : ''
  const ctx: RenderCtx = {
    indent: 0,
    usedComponents,
    kind: 'page',
    componentConfigs: options.componentConfigs,
    componentRoots: options.componentRoots ?? new Map(),
    resolveApi: options.resolveApi,
    apiData,
    apiDataSeq: { n: 0 },
    syncHandlers,
    pageHandlers,
    handlerSeq: { n: 0 },
    siblingMethodNames: [],
    dataFieldNames: (options.data?.fields ?? [])
      .map((f) => f.name.trim())
      .filter(Boolean),
    designWidth,
    classRegistry,
    nodePath: rootPath || undefined,
    refPathMap,
    refFields,
    modalVisibleKeys,
  }
  const body = options.root
    ? renderNode(options.root, ctx)
    : '<!-- empty page -->'

  const controllerLoad = generateControllerBoundPageLoad({
    fields: options.data?.fields ?? [],
    resolveApi: options.resolveApi,
  })
  // 组件 api prop：{ key, paramBindings? }；key 指向 apis/index，paramBindings 运行时从当前页解析
  const apiPropData: Record<string, ReturnType<typeof toApiPropDataValue>> = {}
  for (const [key, binding] of Object.entries(apiData)) {
    apiPropData[key] = toApiPropDataValue(binding)
  }
  const usedApis: MpApiBinding[] = [
    ...controllerLoad.usedApis,
    ...Object.values(apiData),
  ]

  const dataObj: Record<string, unknown> = {
    ...apiPropData,
  }
  for (const key of modalVisibleKeys) {
    dataObj[key] = false
  }
  const using: Record<string, string> = {}
  for (const [id, path] of usedComponents) {
    using[toComponentTag(id)] = path
  }

  const syncCode = generatePageSyncHandlers(syncHandlers)
  const eventCode = pageHandlers
    .map((h) => `  ${h.name}(e) {\n${h.body}\n  }`)
    .join(',\n')

  // 页面计算字段（标题栏颜色随滚动等）；Page 无 observers，靠 onLoad + setData 后手动重算
  const { recomputeMethod, hasComputed } = generateComputedObservers({
    fields: options.data?.fields ?? [],
    propNames: [],
  })
  const statusBarTextField = parseStatusBarTextStyleField(options.statusBar?.textStyle)
  let recomputeForPage = recomputeMethod
  if (hasComputed && statusBarTextField) {
    // 在 setData(patch) 之后同步系统状态栏前景色（自定义导航仍生效）
    recomputeForPage = recomputeMethod.replace(
      /    if \(__hasPatch\) this\.setData\(patch\)\n  \}/,
      [
        `    if (__hasPatch) this.setData(patch)`,
        `    try {`,
        `      var __sb = patch[${JSON.stringify(statusBarTextField)}]`,
        `      if (__sb === undefined) __sb = that.data[${JSON.stringify(statusBarTextField)}]`,
        `      var __front = (__sb === 'black' || __sb === '#000000') ? '#000000' : '#ffffff'`,
        `      wx.setNavigationBarColor({ frontColor: __front, backgroundColor: '#ffffff' })`,
        `    } catch (err) {}`,
        `  }`,
      ].join('\n'),
    )
  }

  const onLoadLines: string[] = []
  // 先写入路由 query，再重算依赖 $query 的计算字段，最后拉控制器（可引用重算后的字段）
  if (hasComputed || controllerLoad.hasLoader) {
    onLoadLines.push(`    this.__pageQuery = options || {}`)
  }
  if (hasComputed) {
    onLoadLines.push(`    this.__recomputeComputed()`)
  }
  if (controllerLoad.hasLoader) {
    onLoadLines.push(`    this.__loadControllerBoundData(options)`)
  }

  const extraHandlers = [
    syncCode,
    eventCode,
    hasComputed ? recomputeForPage : '',
    controllerLoad.hasLoader ? controllerLoad.methods : '',
  ]
    .filter(Boolean)
    .join(',\n')
  const dataLiteral = formatPageDataLiteral(options.data, dataObj, '  ')
  const js = `Page({
  data: ${dataLiteral},
  onLoad(options) {${onLoadLines.length ? `\n${onLoadLines.join('\n')}` : ''}
  },
  onShow() {},
  onReady() {},${extraHandlers ? `\n${extraHandlers},` : ''}
})
`

  const json: Record<string, unknown> = {
    navigationBarTitleText: options.title || options.pageId,
    usingComponents: using,
  }

  const sb = options.statusBar
  const bgRaw =
    typeof sb?.backgroundColor === 'string' && sb.backgroundColor.trim()
      ? sb.backgroundColor.trim()
      : ''
  // 导航栏需要真实色值；调色板 key 解析为实际颜色
  const bg = findPaletteColor(activeColorPalette, bgRaw)?.value.trim() || bgRaw
  // ???? hexColor?transparent / ??????????
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(bg)) {
    json.navigationBarBackgroundColor = bg
  }
  const textStyleRaw =
    typeof sb?.textStyle === 'string' ? sb.textStyle.trim().toLowerCase() : ''
  if (textStyleRaw === 'white' || textStyleRaw === 'black') {
    json.navigationBarTextStyle = textStyleRaw
  } else if (statusBarTextField) {
    // 动态绑定：初始用 white（沉浸式常见），滚动后由 __recomputeComputed 更新
    json.navigationBarTextStyle = 'white'
  }

  // navigationBar === false ??????????
  const navRaw = sb?.navigationBar
  let showNav = true
  if (typeof navRaw === 'boolean') showNav = navRaw
  else if (typeof navRaw === 'string') {
    const n = navRaw.trim().toLowerCase()
    if (n === 'false' || n === '0') showNav = false
    else if (n === 'true' || n === '1') showNav = true
    // ??????????????????????
  }
  if (!showNav) {
    json.navigationStyle = 'custom'
    json.disableScroll = true
  }

  return {
    wxml: `${PAGE_WXS_IMPORTS}${body}\n`,
    wxss: `/* pages/${options.pageId}/index.wxss — utilities live in app.wxss */\n`,
    js,
    json: `${JSON.stringify(json, null, 2)}\n`,
    usedComponents,
    usedApis,
  }
}

export function generateComponentFiles(options: {
  componentId: string
  root: XmlNode | null
  data: PageData
  config: ComponentConfig
  methods: PageMethod[]
  lifecycle?: LifecycleConfig
  componentConfigs?: Map<string, ComponentConfig>
  componentRoots?: Map<string, XmlNode>
  /** 画布设计宽度（项目 canvas.width） */
  designWidth?: number
  classRegistry?: ClassRegistry
}): { wxml: string; wxss: string; js: string; json: string } {
  const designWidth =
    options.designWidth && options.designWidth > 0
      ? options.designWidth
      : DEFAULT_CANVAS_WIDTH
  const classRegistry = options.classRegistry ?? new ClassRegistry()
  const usedComponents = new Map<string, string>()
  const customMethods = (options.methods ?? []).filter((m) => !m.builtin)
  const methodNames = customMethods.map((m) => m.name.trim()).filter(Boolean)
  const dataFieldNames = (options.data?.fields ?? [])
    .map((f) => f.name.trim())
    .filter(Boolean)

  const pageHandlers: PageHandler[] = []
  const modalVisibleKeys = new Set<string>()
  const refFields = collectMpRefFields(
    options.data?.fields,
    options.root,
    options.componentConfigs ?? new Map(),
  )
  const refPathMap = new Map(
    refFields.map((f) => [f.nodePath, f.name] as const),
  )
  const rootPath = options.root ? `0:${options.root.tag}` : ''
  const ctx: RenderCtx = {
    indent: 0,
    usedComponents,
    kind: 'component',
    componentConfigs: options.componentConfigs ?? new Map(),
    componentRoots: options.componentRoots ?? new Map(),
    resolveApi: () => null,
    apiData: {},
    apiDataSeq: { n: 0 },
    syncHandlers: [],
    pageHandlers,
    handlerSeq: { n: 0 },
    siblingMethodNames: methodNames,
    dataFieldNames,
    designWidth,
    classRegistry,
    nodePath: rootPath || undefined,
    refPathMap,
    refFields,
    modalVisibleKeys,
  }
  const body = options.root
    ? renderNode(options.root, ctx)
    : '<!-- empty component -->'

  const propDefs = options.config.props ?? []
  const propNames = propDefs.map((p) => p.name.trim()).filter(Boolean)
  const apiPropNames = propDefs
    .filter((p) => p.type === 'api')
    .map((p) => p.name.trim())
    .filter(Boolean)
  const arrayPropNames = propDefs
    .filter((p) => p.type === 'array')
    .map((p) => p.name.trim())
    .filter(Boolean)

  const properties: Record<string, unknown> = {}
  for (const def of propDefs) {
    const name = def.name.trim()
    if (!name) continue
    if (def.type === 'api') {
      // 父页传入 { key, paramBindings? }；key 如 shop/goods.page
      properties[name] = { type: Object, value: null }
    } else if (def.type === 'array') {
      properties[name] = { type: Array, value: [] }
    } else if (def.type === 'boolean') {
      const dv = def.defaultValue
      const boolDefault =
        dv === true || dv === 'true' || dv === 1 || dv === '1'
      properties[name] = { type: Boolean, value: boolDefault }
    } else if (def.type === 'number') {
      const n = Number(def.defaultValue)
      properties[name] = {
        type: Number,
        value: Number.isFinite(n) ? n : 0,
      }
    } else if (def.type === 'json' || (def.type as string) === 'object') {
      properties[name] = { type: Object, value: null }
    } else {
      // string / time / date / datetime / icon / color / ref / resource 等
      const dv = def.defaultValue
      const strDefault =
        dv == null || dv === ''
          ? ''
          : typeof dv === 'string'
            ? dv
            : String(dv)
      properties[name] = { type: String, value: strDefault }
    }
  }

  const { observersJs, recomputeMethod, hasComputed } = generateComputedObservers({
    fields: options.data?.fields ?? [],
    propNames,
  })

  const methodFns = customMethods
    .map((m) =>
      generateComponentMethodFn(m, {
        dataFieldNames,
        propNames,
        apiPropNames,
        arrayPropNames,
        siblingMethodNames: methodNames,
        refFields,
      }),
    )
    .filter(Boolean)

  for (const h of pageHandlers) {
    methodFns.push(`  ${h.name}(e) {\n${h.body}\n  }`)
  }

  if (hasComputed && recomputeMethod) {
    methodFns.push(recomputeMethod)
  }

  const attached = generateComponentAttached(options.lifecycle, methodNames, {
    recomputeOnAttach: hasComputed,
  })

  const using: Record<string, string> = {}
  for (const [id, path] of usedComponents) {
    if (id === options.componentId) continue
    using[toComponentTag(id)] = path
  }

  const methodsBlock = methodFns.length
    ? `{\n${methodFns.join(',\n')}\n  }`
    : '{}'

  // properties ??type: Object/Array ?? JSON.stringify????
  const propRemarkByName = new Map<string, string>()
  for (const def of propDefs) {
    const name = def.name.trim()
    const remark = (def.remark || '').trim()
    if (name && remark) propRemarkByName.set(name, remark)
  }

  const propLines = Object.entries(properties)
    .map(([name, def]) => {
      const d = def as { type: unknown; value: unknown }
      const remark = propRemarkByName.get(name)
      const remarkLine = remark
        ? `${lineComment(remark, '    ')}\n`
        : ''
      let body: string
      if (d.type === Object) {
        body = `    ${JSON.stringify(name)}: {\n      type: Object,\n      value: null\n    }`
      } else if (d.type === Array) {
        body = `    ${JSON.stringify(name)}: {\n      type: Array,\n      value: []\n    }`
      } else if (d.type === Boolean) {
        body = `    ${JSON.stringify(name)}: {\n      type: Boolean,\n      value: ${d.value ? 'true' : 'false'}\n    }`
      } else if (d.type === Number) {
        body = `    ${JSON.stringify(name)}: {\n      type: Number,\n      value: ${Number(d.value) || 0}\n    }`
      } else if (d.type === String) {
        body = `    ${JSON.stringify(name)}: {\n      type: String,\n      value: ${JSON.stringify(String(d.value ?? ''))}\n    }`
      } else {
        body = `    ${JSON.stringify(name)}: {\n      type: null,\n      value: null\n    }`
      }
      return `${remarkLine}${body}`
    })
    .join(',\n')

  const hasExposed = (options.config.exposedMethods ?? []).some(Boolean)
  const hostWidth = (options.config.width || 'match_parent').trim()
  const hostHeight = (options.config.height || 'match_parent').trim()
  const hostWidthCss =
    hostWidth === 'match_parent' ? '  width: 100%;\n' : ''
  const hostHeightCss =
    hostHeight === 'match_parent'
      ? '  height: 100%;\n  flex: 1;\n  min-height: 0;\n'
      : '  min-height: 0;\n'
  const dataLiteral = formatPageDataLiteral(
    options.data,
    Object.fromEntries(
      [...modalVisibleKeys].map((k) => [k, false] as const),
    ),
    '  ',
  )
  const js = `Component({
  options: {
    multipleSlots: true,
    // 有对外方法时不能 virtualHost，否则页面 selectComponent 取不到实例
    virtualHost: ${hasExposed ? 'false' : 'true'},
    // 允许使用 app.wxss / 页面工具类（默认 isolated 会导致 class 全部失效）
    styleIsolation: 'apply-shared',
  },
  properties: {
${propLines}
  },
  data: ${dataLiteral},
${observersJs ? `${observersJs}\n` : ''}  lifetimes: {
${attached}
  },
  methods: ${methodsBlock},
})
`

  return {
    wxml: `${PAGE_WXS_IMPORTS}${body}\n`,
    wxss: `/* components/${options.componentId}/index.wxss */
@import "../../styles/utilities.wxss";

:host {
  display: flex;
  flex-direction: column;
${hostWidthCss}${hostHeightCss}  box-sizing: border-box;
}
`,
    js,
    json: `${JSON.stringify(
      {
        component: true,
        styleIsolation: 'apply-shared',
        usingComponents: using,
      },
      null,
      2,
    )}\n`,
  }
}

export { toComponentTag }
