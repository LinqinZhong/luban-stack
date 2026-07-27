import type { PageData } from '../../types/page-data.js'
import type { ComponentConfig } from '../../types/component.js'
import type { LifecycleConfig } from '../../types/lifecycle.js'
import type { PageMethod } from '../../types/page-method.js'
import type { XmlNode } from '../export-vue3/xml-parser.js'
import {
  parseApiPropBinding,
  type MpApiBinding,
} from './api-runtime.js'
import {
  generateComponentAttached,
  generateComponentMethodFn,
  generateComputedObservers,
  generatePageSyncHandlers,
} from './method-codegen.js'

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** ????px ??rpx?? 375 ??1px ??1rpx ??????????????? 750??*/
function pxToRpx(value: number): string {
  return `${Math.round(value * 2)}rpx`
}

function parseSize(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  const v = raw.trim()
  if (v.includes('{')) return null
  if (v === 'match_parent') return '100%'
  if (v === 'wrap_content') return 'auto'
  const n = Number(v.replace(/px$/i, ''))
  if (Number.isFinite(n)) return pxToRpx(n)
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
    const active = (parsed.scenarios ?? []).filter((s) =>
      (s.conditions ?? []).some((c) => c.field?.trim()),
    )
    if (!active.length) return 'true'
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
  } catch {
    return null
  }
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

/** Voider ???????????bind* */
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
): string[] {
  const lines: string[] = []
  lines.push(`    var that = this`)
  lines.push(`    var setData = function (prop, value) {`)
  lines.push(`      var patch = {}`)
  lines.push(`      patch[prop] = value`)
  lines.push(`      that.setData(patch)`)
  lines.push(`    }`)
  lines.push(`    var showToast = function (message, duration) {`)
  lines.push(
    `      wx.showToast({ title: String(message == null ? '' : message), icon: 'none', duration: duration === 'long' ? 3000 : 1500 })`,
  )
  lines.push(`    }`)
  for (const name of ctx.siblingMethodNames) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue
    lines.push(
      `    var ${name} = function () { return that.${name}.apply(that, arguments) }`,
    )
  }
  for (const field of ctx.dataFieldNames) {
    if (!/^[A-Za-z_$][\w$]*$/.test(field)) continue
    if (ctx.siblingMethodNames.includes(field)) continue
    lines.push(`    var ${field} = that.data.${field}`)
  }
  if (kind === 'scroll') {
    lines.push(
      `    var scrollTop = e && e.detail && e.detail.scrollTop != null ? e.detail.scrollTop : 0`,
    )
    lines.push(
      `    var scrollLeft = e && e.detail && e.detail.scrollLeft != null ? e.detail.scrollLeft : 0`,
    )
    lines.push(
      `    var scrollHeight = e && e.detail && e.detail.scrollHeight != null ? e.detail.scrollHeight : 0`,
    )
  }
  if (kind === 'touch') {
    lines.push(
      `    var __touch = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0]) || {}`,
    )
    lines.push(`    var clientX = __touch.clientX || 0`)
    lines.push(`    var clientY = __touch.clientY || 0`)
    lines.push(`    var pageX = __touch.pageX || 0`)
    lines.push(`    var pageY = __touch.pageY || 0`)
  }
  return lines
}

function registerCustomEventHandler(
  eventKey: string,
  raw: string,
  ctx: RenderCtx,
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
    const prelude = buildEventHandlerPrelude(meta.kind, ctx)
    if (eventKey === 'onScrollToLower') {
      prelude.push(
        `    if (that.data.loading || that.data.refreshing) return`,
      )
    }
    const bodyIndented = body
      .split('\n')
      .map((line) => (line.trim() ? `    ${line}` : ''))
      .join('\n')
    ctx.pageHandlers.push({
      name: finalName,
      body: `${prelude.join('\n')}\n${bodyIndented}`,
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

/**
 * onClick ??bindtap + Page methods??
 * setData ??`{item.key}` ??? data-* ????????MultiWindow ????active ????
 */
function collectClickEventAttrs(
  attrs: Record<string, string>,
  ctx: RenderCtx,
): string[] {
  const raw = attrs.onClick?.trim()
  if (!raw || !isEventBindingValue(raw)) return []
  const bindings = parseEvtBindings(raw)
  if (!bindings.length) return []

  // ???????????
  if (bindings.every((b) => (b.method || '').trim() === '__custom__')) {
    const a = registerCustomEventHandler('onClick', raw, ctx)
    return a ? [a] : []
  }

  const dataAttrs: string[] = []
  const stmts: string[] = []
  let dataIdx = 0

  for (const bind of bindings) {
    const method = (bind.method || '').trim()
    const args = bind.args ?? {}

    if (method === 'setData') {
      const prop = String(args.prop ?? '').trim()
      if (!prop || !/^[A-Za-z_$][\w$]*$/.test(prop)) continue
      const valueRaw = String(args.value ?? '').trim()
      const bindMatch = valueRaw.match(/^\{([A-Za-z_$][\w.$]*)\}$/)
      if (bindMatch) {
        const i = dataIdx++
        const expr = normalizeExpr(bindMatch[1]!)
        dataAttrs.push(`data-voider-v${i}="{{${expr}}}"`)
        stmts.push(
          `this.setData({ ${prop}: e.currentTarget.dataset.voiderV${i} })`,
        )
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

    if (method === 'navigateTo') {
      const to = String(args.to ?? '').trim()
      if (!to) continue
      const toBind = to.match(/^\{([A-Za-z_$][\w.$]*)\}$/)
      if (toBind) {
        const i = dataIdx++
        dataAttrs.push(`data-voider-v${i}="{{${normalizeExpr(toBind[1]!)}}}"`)
        stmts.push(
          `wx.navigateTo({ url: '/pages/' + e.currentTarget.dataset.voiderV${i} + '/index' })`,
        )
      } else {
        stmts.push(
          `wx.navigateTo({ url: ${JSON.stringify(`/pages/${to}/index`)} })`,
        )
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
        const i = dataIdx++
        dataAttrs.push(`data-voider-v${i}="{{${normalizeExpr(msgBind[1]!)}}}"`)
        stmts.push(
          `wx.showToast({ title: String(e.currentTarget.dataset.voiderV${i} || ''), icon: 'none' })`,
        )
      } else {
        stmts.push(
          `wx.showToast({ title: ${JSON.stringify(message)}, icon: 'none' })`,
        )
      }
      continue
    }
  }

  if (!stmts.length) return []

  const name = `__onTap_${ctx.handlerSeq.n++}`
  ctx.pageHandlers.push({
    name,
    body: stmts.map((s) => `    ${s}`).join('\n'),
  })
  return [`bindtap="${name}"`, ...dataAttrs]
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
    const bind = registerCustomEventHandler(key, raw, ctx)
    if (bind) out.push(bind)
  }
  return out
}

/**
 * ?? Voider ????????pullHeight + touch + refresh??
 * ???? scroll-view ??? touch????????????? refresher?
 * ???????? slot="refresher" ??????? UI?
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
    ctx.dataFieldNames.includes('refreshing')
  const hasPull =
    ctx.dataFieldNames.includes('pullHeight') ||
    /refresh\s*\(/.test(attrs.onTouchEnd || '')
  return hasRefresh && hasPull
}

function ensureNativeCustomRefresherHandlers(ctx: RenderCtx): void {
  if (ctx.pageHandlers.some((h) => h.name === '__onRefresherPulling')) return

  const recompute =
    `    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()`

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
      recompute,
    ].join('\n'),
  })

  ctx.pageHandlers.push({
    name: '__onRefresherRefresh',
    body: [
      `    var that = this`,
      `    if (that.data.loading) {`,
      `      that.setData({ refreshing: false, pullHeight: 0 })`,
      `      if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()`,
      `      return`,
      `    }`,
      `    that.setData({ pullHeight: 40 })`,
      `    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()`,
      `    if (typeof that.refresh === 'function') that.refresh()`,
      `    else that.setData({ refreshing: true })`,
    ].join('\n'),
  })

  ctx.pageHandlers.push({
    name: '__onRefresherRestore',
    body: [
      `    var that = this`,
      `    that.setData({ pullHeight: 0 })`,
      recompute,
    ].join('\n'),
  })
}

/** `{foo}` / `hello {name}` ????????*/
function toWxmlText(raw: string): string {
  if (!raw) return ''
  if (/^\{([^{}]+)\}$/.test(raw.trim())) {
    const expr = raw.trim().slice(1, -1).trim()
    return `{{${normalizeExpr(expr)}}}`
  }
  return raw.replace(/\{([^{}]+)\}/g, (_, expr: string) => `{{${normalizeExpr(expr.trim())}}}`)
}

function normalizeExpr(expr: string): string {
  // ????$props???? $props.x ??properties / data
  if (expr === '$props' || expr === 'props') return '$props'
  if (expr.startsWith('$props.')) return expr.slice('$props.'.length)
  if (expr.startsWith('props.')) return expr.slice('props.'.length)
  return expr
}

function attrStyle(
  attrs: Record<string, string>,
  options?: { flexParent?: 'row' | 'column'; isComponent?: boolean },
): string {
  const parts: string[] = []
  const wRaw = attrs.width?.trim()
  const hRaw = attrs.height?.trim()
  const wBind = styleBindingExpr(wRaw)
  if (wBind) {
    parts.push(`width:{{${wBind}}}px`)
  } else if (wRaw === 'match_parent' && options?.flexParent === 'row') {
    parts.push('flex:1', 'min-width:0', 'width:0')
  } else {
    const w = parseSize(wRaw)
    if (w) parts.push(`width:${w}`)
  }
  const hBind = styleBindingExpr(hRaw)
  if (hBind) {
    parts.push(`height:{{${hBind}}}px`)
  } else if (hRaw === 'match_parent' && options?.flexParent === 'column') {
    parts.push('flex:1', 'min-height:0', 'height:0')
  } else if (
    hRaw === 'match_parent' &&
    options?.isComponent &&
    !options?.flexParent
  ) {
    parts.push('height:auto')
  } else {
    const h = parseSize(hRaw)
    if (h) parts.push(`height:${h}`)
  }

  const pad = attrs.padding?.trim()
  const padBind = styleBindingExpr(pad)
  if (padBind) {
    parts.push(`padding:{{${padBind}}}px`)
  } else if (pad && !isBinding(pad)) {
    const n = Number(pad.replace(/px$/i, ''))
    if (Number.isFinite(n)) parts.push(`padding:${pxToRpx(n)}`)
  }
  for (const [key, css] of [
    ['paddingLeft', 'padding-left'],
    ['paddingRight', 'padding-right'],
    ['paddingTop', 'padding-top'],
    ['paddingBottom', 'padding-bottom'],
    ['margin', 'margin'],
    ['marginLeft', 'margin-left'],
    ['marginRight', 'margin-right'],
    ['marginTop', 'margin-top'],
    ['marginBottom', 'margin-bottom'],
  ] as const) {
    const raw = attrs[key]?.trim()
    if (!raw) continue
    const bind = styleBindingExpr(raw)
    if (bind) {
      parts.push(`${css}:{{${bind}}}px`)
      continue
    }
    if (isBinding(raw)) continue
    const n = Number(raw.replace(/px$/i, ''))
    if (Number.isFinite(n)) parts.push(`${css}:${pxToRpx(n)}`)
  }

  const overflow = (attrs.overflow || '').trim().toLowerCase()
  if (overflow === 'hidden') parts.push('overflow:hidden')
  else if (overflow === 'scroll') {
    /* scroll ? scroll-view???? overflow */
  } else if (overflow === 'visible') parts.push('overflow:visible')

  const bg = attrs.background?.trim()
  const bgBind = styleBindingExpr(bg)
  if (bgBind) {
    parts.push(`background:{{${bgBind}}}`)
  } else if (bg && bg !== 'transparent' && !isBinding(bg)) {
    parts.push(`background:${bg}`)
  }
  const radius = attrs.borderRadius?.trim()
  if (radius && !isBinding(radius)) {
    const n = Number(radius.replace(/px$/i, ''))
    if (Number.isFinite(n)) parts.push(`border-radius:${pxToRpx(n)}`)
  }
  const color = attrs.textColor?.trim() || attrs.color?.trim()
  const colorBind = styleBindingExpr(color)
  if (colorBind) {
    parts.push(`color:{{${colorBind}}}`)
  } else if (color && !isBinding(color)) {
    parts.push(`color:${color}`)
  }
  const fontSize = attrs.textSize?.trim() || attrs.size?.trim()
  if (fontSize && !isBinding(fontSize)) {
    const n = Number(fontSize.replace(/px$/i, ''))
    if (Number.isFinite(n)) parts.push(`font-size:${pxToRpx(n)}`)
  }

  // transform：小程序需 -webkit-；仅 Z 轴时用 rotate()（rotateZ 真机常不生效）
  const transformFns = buildTransformFunctions(attrs)
  // RelativeLayout 定位
  const relative: string[] = []
  const hasLayoutMargin = (
    ['layout_marginLeft', 'layout_marginRight', 'layout_marginTop', 'layout_marginBottom'] as const
  ).some((k) => {
    const raw = attrs[k]?.trim()
    return Boolean(raw) && raw !== 'null'
  })
  if (attrs.layout_centerInParent === 'true') {
    relative.push('position:absolute', 'left:50%', 'top:50%')
    transformFns.push('translate(-50%,-50%)')
  } else {
    if (
      attrs.layout_alignParentLeft === 'true' ||
      attrs.layout_alignParentRight === 'true' ||
      attrs.layout_alignParentTop === 'true' ||
      attrs.layout_alignParentBottom === 'true' ||
      attrs.layout_centerHorizontal === 'true' ||
      attrs.layout_centerVertical === 'true' ||
      hasLayoutMargin
    ) {
      relative.push('position:absolute')
    }
    if (attrs.layout_alignParentLeft === 'true') relative.push('left:0')
    if (attrs.layout_alignParentRight === 'true') relative.push('right:0')
    if (attrs.layout_alignParentTop === 'true') relative.push('top:0')
    if (attrs.layout_alignParentBottom === 'true') relative.push('bottom:0')
    if (attrs.layout_centerHorizontal === 'true') {
      relative.push('left:50%')
      transformFns.push('translateX(-50%)')
    }
    if (attrs.layout_centerVertical === 'true') {
      relative.push('top:50%')
      transformFns.push('translateY(-50%)')
    }
  }
  // layout_margin*：相对父边缘的偏移（覆盖 left:0 / bottom:0 等）；忽略字面量 "null"
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
      relative.push(`${css}:{{${bind}}}px`)
      continue
    }
    if (isBinding(raw)) continue
    const n = Number(raw.replace(/px$/i, ''))
    if (Number.isFinite(n)) relative.push(`${css}:${pxToRpx(n)}`)
  }
  const zIndex = attrs.zIndex?.trim()
  if (zIndex && zIndex !== 'null' && !isBinding(zIndex)) {
    const n = Number(zIndex)
    if (Number.isFinite(n)) relative.push(`z-index:${n}`)
  }
  parts.push(...relative)
  if (transformFns.length) {
    const t = transformFns.join(' ')
    parts.push(`-webkit-transform:${t}`, `transform:${t}`)
  }

  return parts.join(';')
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

function flexStyle(attrs: Record<string, string>): string {
  const orientation = (attrs.orientation || 'vertical').toLowerCase()
  const parts = [
    'display:flex',
    orientation === 'horizontal' ? 'flex-direction:row' : 'flex-direction:column',
  ]
  // ?? CSS gap??? WebView ??????????? margin ??
  const gravity = attrs.gravity || ''
  if (gravity.includes('center')) {
    parts.push('align-items:center', 'justify-content:center')
  } else if (gravity.includes('right') || gravity.includes('end')) {
    parts.push(
      orientation === 'horizontal' ? 'justify-content:flex-end' : 'align-items:flex-end',
    )
  }
  return parts.join(';')
}

function parseGapPx(attrs: Record<string, string>): number | undefined {
  const gap = attrs.gap?.trim()
  if (!gap || isBinding(gap)) return undefined
  const n = Number(gap.replace(/px$/i, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** padding / margin ?????virtualHost ???? style ?? padding ????? */
function spacingStyleFromAttrs(attrs: Record<string, string>): string {
  const parts: string[] = []
  const pad = attrs.padding?.trim()
  if (pad && !isBinding(pad)) {
    const n = Number(pad.replace(/px$/i, ''))
    if (Number.isFinite(n)) parts.push(`padding:${pxToRpx(n)}`)
  }
  for (const [key, css] of [
    ['paddingLeft', 'padding-left'],
    ['paddingRight', 'padding-right'],
    ['paddingTop', 'padding-top'],
    ['paddingBottom', 'padding-bottom'],
    ['margin', 'margin'],
    ['marginLeft', 'margin-left'],
    ['marginRight', 'margin-right'],
    ['marginTop', 'margin-top'],
    ['marginBottom', 'margin-bottom'],
  ] as const) {
    const raw = attrs[key]?.trim()
    if (!raw || isBinding(raw)) continue
    const n = Number(raw.replace(/px$/i, ''))
    if (Number.isFinite(n)) parts.push(`${css}:${pxToRpx(n)}`)
  }
  return parts.join(';')
}

function siblingGapMarginStyle(
  ctx: RenderCtx,
  options?: { everyItem?: boolean },
): string | null {
  if (ctx.flexGapPx == null) return null
  if (!(ctx.flexGapPx > 0)) return null
  if (!options?.everyItem && ctx.isLastFlexChild) return null
  if (ctx.parentFlex === 'row') return `margin-right:${pxToRpx(ctx.flexGapPx)}`
  if (ctx.parentFlex === 'column') return `margin-bottom:${pxToRpx(ctx.flexGapPx)}`
  return null
}

function withSiblingGap(
  style: string,
  ctx: RenderCtx,
  options?: { everyItem?: boolean },
): string {
  return mergeStyle(style, siblingGapMarginStyle(ctx, options))
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
  return ` style="${escapeXml(style)}"`
}

type SyncHandler = { handlerName: string; fieldName: string }

type PageHandler = { name: string; body: string }

type RenderCtx = {
  indent: number
  /** ???????????? componentId ???? */
  usedComponents: Map<string, string>
  kind: 'page' | 'component'
  /** componentId ??????????type=api / twoWay??*/
  componentConfigs: Map<string, ComponentConfig>
  /** ?? API ?? ????method/path ??????*/
  resolveApi: (raw: string) => MpApiBinding | null
  /** ?? Page.data ??API ???? */
  apiData: Record<string, MpApiBinding>
  apiDataSeq: { n: number }
  /** ?? prop ?? handler */
  syncHandlers: SyncHandler[]
  /** ??/?????onClick / onScroll / onTouch* ?? */
  pageHandlers: PageHandler[]
  handlerSeq: { n: number }
  /** ???????????? loadData / refresh??*/
  siblingMethodNames: string[]
  /** ?????????????????? */
  dataFieldNames: string[]
  /** LinearLayout ????match_parent ? flex:1 */
  parentFlex?: 'row' | 'column'
  /** ?? gap?px?????? margin ????? flex gap ????? */
  flexGapPx?: number
  /** ???? flex ??????????????? gap margin? */
  isLastFlexChild?: boolean
}

function pad(n: number): string {
  return '  '.repeat(n)
}

function renderChildren(children: XmlNode[], ctx: RenderCtx): string {
  const list = children.filter(
    (c) => c.tag !== '#text' || Boolean((c.text || '').trim()),
  )
  return list
    .map((child, i) =>
      renderNode(child, {
        ...ctx,
        isLastFlexChild: i === list.length - 1,
      }),
    )
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
    // v1????????????????
    return `${pad(ctx.indent)}<!-- Modal??{escapeXml(attrs.name || '')}?????????? -->`
  }

  if (node.tag === 'Component') {
    const id = attrs.componentId?.trim()
    if (!id) return `${pad(ctx.indent)}<!-- Component ?? componentId -->`
    const tagName = toComponentTag(id)
    ctx.usedComponents.set(id, `/components/${id}/index`)
    const config = ctx.componentConfigs.get(id)
    const gapMargin = siblingGapMarginStyle(ctx, { everyItem: Boolean(repeat) })
    const spacing = spacingStyleFromAttrs(attrs)
    // virtualHost：padding/margin（含 gap 换算的兄弟边距）写在组件 style 上常不生效 → 外包一层 view
    const useSpacingWrap = Boolean(spacing) || Boolean(gapMargin)
    // 外包时 wx:for 必须在 wrapper 上，否则边距只包一层、列表项之间仍无 gap
    const propAttrs: string[] = useSpacingWrap ? [] : [...forAttrs]
    for (const [key, value] of Object.entries(attrs)) {
      // ????? <slot> ???? slot ?? slot ????slot="default" ???????
      if (key === 'slot') {
        const slotName = String(value || '').trim()
        if (slotName && slotName !== 'default') {
          propAttrs.push(`slot="${escapeXml(slotName)}"`)
        }
        continue
      }
      if (shouldSkipComponentAttr(key, value, config)) continue
      const propDef = config?.props.find((p) => p.name === key)

      // type=api????data??? wx.request ???? utils/voider-api.js??
      if (propDef?.type === 'api' || parseApiPropBinding(value)) {
        const binding = ctx.resolveApi(value)
        if (!binding) continue
        const dataKey = `__api_${key}_${ctx.apiDataSeq.n++}`
        ctx.apiData[dataKey] = binding
        propAttrs.push(`${key}="{{${dataKey}}}"`)
        continue
      }

      if (isBinding(value)) {
        const trimmedVal = value.trim()
        // ????`{field}` ??JSON ??/???????
        if (
          (trimmedVal.startsWith('{') || trimmedVal.startsWith('[')) &&
          !/^\{[A-Za-z_$][\w.$]*\}$/.test(trimmedVal)
        ) {
          continue
        }
        const expr = trimmedVal.replace(/^\{|\}$/g, '').trim()
        if (!/^[\w.$\[\]]+$/.test(expr)) continue
        propAttrs.push(`${key}="{{${normalizeExpr(expr)}}}"`)
        // ????
        if (
          ctx.kind === 'page' &&
          propDef?.twoWay &&
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
        propAttrs.push(`${key}="{{${b}}}"`)
      } else if (value != null && value !== '') {
        propAttrs.push(`${key}="${escapeXml(value)}"`)
      }
    }
    const layoutStyle = withSiblingGap(
      mergeStyle(
        attrStyle(attrs, { flexParent: ctx.parentFlex, isComponent: true }),
      ),
      ctx,
      { everyItem: Boolean(repeat) },
    )
    const hostStyle = useSpacingWrap
      ? layoutStyle.includes('flex:1') || /(?:^|;)height:0(?:;|$)/.test(layoutStyle)
        ? 'width:100%;height:100%;min-height:0;box-sizing:border-box'
        : 'width:100%;height:auto;box-sizing:border-box'
      : layoutStyle
    if (hostStyle) propAttrs.push(`style="${escapeXml(hostStyle)}"`)
    propAttrs.push(...visibilityWxmlAttrs(attrs))
    const tagIndent = ctx.indent + (useSpacingWrap ? 1 : 0)
    const inner = renderChildren(node.children, {
      ...ctx,
      indent: tagIndent + 1,
      parentFlex: undefined,
      flexGapPx: undefined,
    })
    const open = openTag(tagName, propAttrs, tagIndent)
    const block = !inner.trim()
      ? openTag(tagName, propAttrs, tagIndent, true)
      : `${open}\n${inner}\n${pad(tagIndent)}</${tagName}>`
    if (!useSpacingWrap) return block
    const wrapStyle = mergeStyle(layoutStyle, 'box-sizing:border-box')
    const wrapAttrs = [...forAttrs, `style="${escapeXml(wrapStyle)}"`]
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

function renderWidget(
  node: XmlNode,
  ctx: RenderCtx,
  forAttrs: string[],
): string {
  const attrs = node.attrs
  const vis = visibilityWxmlAttrs(attrs)

  if (node.tag === 'Swiper') {
    const base = attrStyle(attrs, { flexParent: ctx.parentFlex })
    const style = mergeStyle(
      base,
      base.includes('width:') ? null : 'width:100%',
      base.includes('height:') ? null : 'height:100%',
      'overflow:hidden',
    )
    const indicator = parseBoolAttr(attrs.indicatorDots, true)
    const autoplay = parseBoolAttr(attrs.autoplay, false)
    const circular = parseBoolAttr(attrs.circular, true)
    const interval = attrs.interval?.trim() || '3000'
    const duration = attrs.duration?.trim() || '500'
    const current = attrs.current?.trim() || '0'
    const indicatorColor = (attrs.indicatorColor || '').trim() || 'rgba(0,0,0,.3)'
    const indicatorActiveColor =
      (attrs.indicatorActiveColor || '').trim() || '#409eff'
    const clickAttrs = collectClickEventAttrs(attrs, ctx)
    const slides = node.children
      .filter((c) => c.tag !== '#text')
      .map((child) => {
        const inner = renderNode(child, { ...ctx, indent: ctx.indent + 2 })
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
        styleAttr(style).trim(),
      ],
      ctx.indent,
    )
    if (!slides) return `${open}</swiper>`
    return `${open}\n${slides}\n${pad(ctx.indent)}</swiper>`
  }

  if (node.tag === 'MultiWindow') {
    // ??active ?????? {currentNav}???? windowKey ????????
    const activeExpr = bindingToActiveExpr(attrs.active || '')
    const overflow = (attrs.overflow || '').toLowerCase()
    const style = mergeStyle(
      attrStyle(attrs, { flexParent: ctx.parentFlex }),
      'position:relative',
      'min-height:0',
      'overflow:hidden',
    )
    const panes = node.children
      .filter((c) => c.tag !== '#text')
      .map((child) => {
        const windowKey = (child.attrs.windowKey || '').trim()
        // wx:if ????????????hidden ??display:flex ??
        const ifAttr = windowKey
          ? `wx:if="{{(${activeExpr} + '') === '${escapeWxmlStr(windowKey)}'}}"`
          : `wx:if="{{false}}"`
        const paneStyle =
          'position:absolute;left:0;top:0;right:0;bottom:0;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box'
        const childCtx: RenderCtx = {
          ...ctx,
          indent: ctx.indent + 2,
          parentFlex: 'column',
        }
        const inner = renderNode(child, childCtx)
        return `${pad(ctx.indent + 1)}<view ${ifAttr} style="${paneStyle}">\n${inner}\n${pad(ctx.indent + 1)}</view>`
      })
      .filter(Boolean)
      .join('\n')
    const open = openTag(
      'view',
      [...forAttrs, ...vis, styleAttr(style).trim()],
      ctx.indent,
    )
    if (!panes) return `${open}</view>`
    return `${open}\n${panes}\n${pad(ctx.indent)}</view>`
  }

  if (node.tag === 'Text') {
    const raw = attrs.text || node.text || ''
    const content = bindingAwareEscape(toWxmlText(raw))
    const style = mergeStyle(attrStyle(attrs, { flexParent: ctx.parentFlex }))
    const clickAttrs = collectClickEventAttrs(attrs, ctx)
    const open = openTag(
      'text',
      [...forAttrs, ...vis, ...clickAttrs, styleAttr(style).trim()],
      ctx.indent,
    )
    return `${open}${content}</text>`
  }

  if (node.tag === 'Button') {
    const raw = attrs.text || 'Button'
    const content = bindingAwareEscape(toWxmlText(raw))
    const style = mergeStyle(
      attrStyle(attrs, { flexParent: ctx.parentFlex }),
      'display:flex',
      'align-items:center',
      'justify-content:center',
    )
    const clickAttrs = collectClickEventAttrs(attrs, ctx)
    const open = openTag(
      'view',
      [
        ...forAttrs,
        ...vis,
        ...clickAttrs,
        styleAttr(style).trim(),
        'class="voider-button"',
      ],
      ctx.indent,
    )
    return `${open}${content}</view>`
  }

  if (node.tag === 'Input') {
    const value = attrs.value?.trim() || ''
    const placeholder = attrs.placeholder || ''
    const style = mergeStyle(attrStyle(attrs, { flexParent: ctx.parentFlex }))
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
        styleAttr(style).trim(),
      ],
      ctx.indent,
      true,
    )
  }

  if (node.tag === 'Image') {
    const src = attrs.src?.trim() || ''
    const style = mergeStyle(attrStyle(attrs, { flexParent: ctx.parentFlex }))
    const mode =
      attrs.objectFit === 'contain'
        ? 'aspectFit'
        : attrs.objectFit === 'fill'
          ? 'scaleToFill'
          : 'aspectFill'
    const srcAttr = isBinding(src)
      ? `src="{{${normalizeExpr(src.replace(/^\{|\}$/g, ''))}}}"`
      : `src="${escapeXml(src)}"`
    // swiper-item 内 bindtap 常被滑动手势吞掉，改用 catchtap
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
        styleAttr(style).trim(),
      ],
      ctx.indent,
      true,
    )
  }

  if (node.tag === 'Icon') {
    const iconId = attrs.iconId?.trim() || ''
    const size = attrs.size?.trim()
    const sizeBind = styleBindingExpr(size)
    // size 支持 {arrowSize} 等绑定；设计稿 px → rpx（×2）
    const dimStyle = sizeBind
      ? `width:{{(${sizeBind}) * 2}}rpx;height:{{(${sizeBind}) * 2}}rpx`
      : (() => {
          const n = size ? Number(size.replace(/px$/i, '')) : 24
          const dim = Number.isFinite(n) ? pxToRpx(n) : '48rpx'
          return `width:${dim};height:${dim}`
        })()
    // image 上 transform 真机常失效：旋转放到外层 view
    const rotateFns = buildTransformFunctions(attrs)
    const attrsNoRotate = { ...attrs }
    delete attrsNoRotate.rotateX
    delete attrsNoRotate.rotateY
    delete attrsNoRotate.rotateZ
    const clickAttrs = collectClickEventAttrs(attrs, ctx).map((a) =>
      a.startsWith('bindtap=') ? a.replace(/^bindtap=/, 'catchtap=') : a,
    )
    const imageStyle = mergeStyle(
      attrStyle(attrsNoRotate, { flexParent: ctx.parentFlex }),
      rotateFns.length ? 'width:100%;height:100%' : dimStyle,
    )
    const srcAttr = isBinding(iconId)
      ? `src="{{'/assets/icons/' + (${normalizeExpr(iconId.replace(/^\{|\}$/g, ''))}) + '.svg'}}"`
      : `src="${escapeXml(iconId ? `/assets/icons/${iconId}.svg` : '')}"`
    const imageOpen = openTag(
      'image',
      [
        ...(rotateFns.length ? [] : forAttrs),
        ...(rotateFns.length ? [] : vis),
        ...(rotateFns.length ? [] : clickAttrs),
        srcAttr,
        'mode="aspectFit"',
        styleAttr(imageStyle).trim(),
      ],
      rotateFns.length ? ctx.indent + 1 : ctx.indent,
      true,
    )
    if (!rotateFns.length) return imageOpen
    const t = rotateFns.join(' ')
    // 定位/边距留在 attrStyle 里会丢：有旋转时布局属性挂到外包 view
    const layoutOnly = { ...attrs }
    delete layoutOnly.rotateX
    delete layoutOnly.rotateY
    delete layoutOnly.rotateZ
    delete layoutOnly.iconId
    delete layoutOnly.size
    delete layoutOnly.color
    delete layoutOnly.width
    delete layoutOnly.height
    const wrapStyle = mergeStyle(
      attrStyle(layoutOnly, { flexParent: ctx.parentFlex }),
      dimStyle,
      'display:inline-flex',
      'flex-shrink:0',
      `-webkit-transform:${t}`,
      `transform:${t}`,
    )
    const open = openTag(
      'view',
      [...forAttrs, ...vis, ...clickAttrs, styleAttr(wrapStyle).trim()],
      ctx.indent,
    )
    return `${open}\n${imageOpen}\n${pad(ctx.indent)}</view>`
  }

  const overflow = (attrs.overflow || '').toLowerCase()
  const isScroll = overflow === 'scroll'
  const isLinear = node.tag === 'LinearLayout'
  const isRelative = node.tag === 'RelativeLayout'
  const useNativeRefresher =
    isScroll && shouldUseNativeCustomRefresher(attrs, ctx)
  const baseStyle = withSiblingGap(
    mergeStyle(
      attrStyle(attrs, { flexParent: ctx.parentFlex }),
      isLinear && !useNativeRefresher ? flexStyle(attrs) : null,
      isRelative ? 'position:relative;box-sizing:border-box' : null,
      isScroll && !isLinear ? 'height:100%' : null,
    ),
    ctx,
  )

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
    // enable-flex ?? slot ? match_parent ??????????????????????????
    if (isLinear && !useNativeRefresher) scrollAttrs.push('enable-flex="true"')
    if (attrs.onScrollToLower?.trim()) {
      scrollAttrs.push('lower-threshold="80"')
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

  const childCtx: RenderCtx = {
    ...ctx,
    indent: ctx.indent + (isRelative ? 2 : 1),
    parentFlex: childFlex,
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
      ...scrollTouchAttrs,
      styleAttr(baseStyle).trim(),
    ],
    ctx.indent,
  )
  // RelativeLayout：内层再开一层 relative，使 padding（如 statusBar）压缩内容区，
  // absolute 子节点的 top:50% 相对内容区居中（与编辑器 / vue3 一致）
  let bodyInner = contentInner
  if (isRelative && contentInner.trim()) {
    const innerPad = pad(ctx.indent + 1)
    bodyInner = `${innerPad}<view style="position:relative;width:100%;height:100%;min-height:0;box-sizing:border-box">\n${contentInner}\n${innerPad}</view>`
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
      // ?????????????
      out[name] = field.value ?? null
      continue
    }
    if (field.type === 'ref' || field.type === 'api') continue
    out[name] = field.value ?? null
  }
  return out
}

export function generatePageFiles(options: {
  pageId: string
  title: string
  root: XmlNode | null
  data: PageData
  componentConfigs: Map<string, ComponentConfig>
  resolveApi: (raw: string) => MpApiBinding | null
  /** ?? statusBar ???????????? */
  statusBar?: {
    textStyle?: string
    backgroundColor?: string
    cover?: boolean | string
    navigationBar?: boolean | string
  } | null
}): { wxml: string; wxss: string; js: string; json: string; usedComponents: Map<string, string> } {
  const usedComponents = new Map<string, string>()
  const apiData: Record<string, MpApiBinding> = {}
  const syncHandlers: SyncHandler[] = []
  const pageHandlers: PageHandler[] = []
  const ctx: RenderCtx = {
    indent: 0,
    usedComponents,
    kind: 'page',
    componentConfigs: options.componentConfigs,
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
  }
  const body = options.root
    ? renderNode(options.root, ctx)
    : '<!-- empty page -->'

  const dataObj = {
    ...pageDataObject(options.data),
    ...apiData,
  }
  const using: Record<string, string> = {}
  for (const [id, path] of usedComponents) {
    using[toComponentTag(id)] = path
  }

  const syncCode = generatePageSyncHandlers(syncHandlers)
  const eventCode = pageHandlers
    .map((h) => `  ${h.name}(e) {\n${h.body}\n  }`)
    .join(',\n')
  const extraHandlers = [syncCode, eventCode].filter(Boolean).join(',\n')
  const js = `Page({
  data: ${JSON.stringify(dataObj, null, 2).replace(/\n/g, '\n  ')},
  onLoad() {},
  onShow() {},
  onReady() {},${extraHandlers ? `\n${extraHandlers},` : ''}
})
`

  const json: Record<string, unknown> = {
    navigationBarTitleText: options.title || options.pageId,
    usingComponents: using,
  }

  const sb = options.statusBar
  const bg =
    typeof sb?.backgroundColor === 'string' && sb.backgroundColor.trim()
      ? sb.backgroundColor.trim()
      : ''
  // ???? hexColor?transparent / ??????????
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(bg)) {
    json.navigationBarBackgroundColor = bg
  }
  const textStyleRaw =
    typeof sb?.textStyle === 'string' ? sb.textStyle.trim().toLowerCase() : ''
  if (textStyleRaw === 'white' || textStyleRaw === 'black') {
    json.navigationBarTextStyle = textStyleRaw
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
    wxml: `${body}\n`,
    wxss: `/* pages/${options.pageId}/index.wxss */\n.voider-button {\n  background: #409eff;\n  color: #ffffff;\n  border-radius: 8rpx;\n  padding: 16rpx 28rpx;\n}\n`,
    js,
    json: `${JSON.stringify(json, null, 2)}\n`,
    usedComponents,
  }
}

export function generateComponentFiles(options: {
  componentId: string
  root: XmlNode | null
  data: PageData
  config: ComponentConfig
  methods: PageMethod[]
  lifecycle?: LifecycleConfig
}): { wxml: string; wxss: string; js: string; json: string } {
  const usedComponents = new Map<string, string>()
  const customMethods = (options.methods ?? []).filter((m) => !m.builtin)
  const methodNames = customMethods.map((m) => m.name.trim()).filter(Boolean)
  const dataFieldNames = (options.data?.fields ?? [])
    .map((f) => f.name.trim())
    .filter(Boolean)

  const pageHandlers: PageHandler[] = []
  const ctx: RenderCtx = {
    indent: 0,
    usedComponents,
    kind: 'component',
    componentConfigs: new Map(),
    resolveApi: () => null,
    apiData: {},
    apiDataSeq: { n: 0 },
    syncHandlers: [],
    pageHandlers,
    handlerSeq: { n: 0 },
    siblingMethodNames: methodNames,
    dataFieldNames,
  }
  const body = options.root
    ? renderNode(options.root, ctx)
    : '<!-- empty component -->'

  const dataObj = pageDataObject(options.data)
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
    } else if (def.type === 'json' || def.type === 'object') {
      properties[name] = { type: Object, value: null }
    } else {
      // string / icon / color / ref 等：带上 config 默认值，避免 {{prop}} 渲染出 "null"
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
  const propLines = Object.entries(properties)
    .map(([name, def]) => {
      const d = def as { type: unknown; value: unknown }
      if (d.type === Object) {
        return `    ${JSON.stringify(name)}: {\n      type: Object,\n      value: null\n    }`
      }
      if (d.type === Array) {
        return `    ${JSON.stringify(name)}: {\n      type: Array,\n      value: []\n    }`
      }
      if (d.type === Boolean) {
        return `    ${JSON.stringify(name)}: {\n      type: Boolean,\n      value: ${d.value ? 'true' : 'false'}\n    }`
      }
      if (d.type === Number) {
        return `    ${JSON.stringify(name)}: {\n      type: Number,\n      value: ${Number(d.value) || 0}\n    }`
      }
      if (d.type === String) {
        return `    ${JSON.stringify(name)}: {\n      type: String,\n      value: ${JSON.stringify(String(d.value ?? ''))}\n    }`
      }
      return `    ${JSON.stringify(name)}: {\n      type: null,\n      value: null\n    }`
    })
    .join(',\n')

  const js = `Component({
  options: {
    multipleSlots: true,
    virtualHost: true,
  },
  properties: {
${propLines}
  },
  data: ${JSON.stringify(dataObj, null, 2).replace(/\n/g, '\n  ')},
${observersJs ? `${observersJs}\n` : ''}  lifetimes: {
${attached}
  },
  methods: ${methodsBlock},
})
`

  return {
    wxml: `${body}\n`,
    wxss: `/* components/${options.componentId}/index.wxss */
:host {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  box-sizing: border-box;
}
`,
    js,
    json: `${JSON.stringify(
      {
        component: true,
        usingComponents: using,
      },
      null,
      2,
    )}\n`,
  }
}

export { toComponentTag }
