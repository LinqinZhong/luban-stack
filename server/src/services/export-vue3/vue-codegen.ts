import type { ComponentConfig, ComponentEventDef } from '../../types/component.js'
import type { PageData } from '../../types/page-data.js'
import type { ColorPalette } from '../../types/color-palette.js'
import { resolvePaletteColorForCss } from '../../types/color-palette.js'
import type { XmlNode } from './xml-parser.js'
import { escapeHtmlAttr, escapeHtmlText, escapeTsString, escapeVueExprAttr } from './escape.js'
import {
  isSimpleBindingPath,
  normalizeBindingOperators,
  scanBindingSpans,
  unwrapWholeBinding,
} from './binding-expr.js'
import {
  componentIdToFileName,
  componentIdToVarName,
  pageIdToStoreFile,
  pageIdToStoreName,
  pageIdToViewName,
} from './naming.js'
import {
  generateControllerBoundPageMounted,
  generatePageDataSource,
  generatePageStoreAdapter,
  type VueApiBinding,
} from './page-data-codegen.js'

const LAYOUT_ATTRS = new Set([
  'width',
  'height',
  'padding',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'margin',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom',
  'background',
  'gravity',
  'gap',
  'orientation',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'borderWidth',
  'borderColor',
  'overflow',
  'contentShadow',
  'layout_alignParentLeft',
  'layout_alignParentRight',
  'layout_alignParentTop',
  'layout_alignParentBottom',
  'layout_alignParentStart',
  'layout_alignParentEnd',
  'layout_centerInParent',
  'layout_centerHorizontal',
  'layout_centerVertical',
  'layout_marginLeft',
  'layout_marginRight',
  'layout_marginTop',
  'layout_marginBottom',
  'repeat',
  'name',
  'componentId',
  'vShow',
  'vIf',
  'dynamicStyles',
  'closeOnClick',
])

const INTERACTION_ATTRS = new Set([
  'onClick',
  'onLongClick',
  'onScroll',
  'onScrollToLower',
  'onScrollToUpper',
  'onTouchStart',
  'onTouchMove',
  'onTouchEnd',
])

const NON_SCROLL_INTERACTION_ATTRS = [
  'onClick',
  'onLongClick',
  'onTouchStart',
  'onTouchMove',
  'onTouchEnd',
] as const

const TEXT_STYLE_ATTRS = new Set(['textSize', 'textColor', 'color'])

/** 当前 codegen 使用的调色板（generate* 入口设置） */
let activeColorPalette: ColorPalette | undefined

function withColorPalette<T>(palette: ColorPalette | undefined, fn: () => T): T {
  const prev = activeColorPalette
  activeColorPalette = palette
  try {
    return fn()
  } finally {
    activeColorPalette = prev
  }
}

export interface PageRefField {
  name: string
  nodePath: string
  kind: 'component' | 'modal'
  /** kind=component */
  componentId?: string
  exposedMethods: string[]
  /** kind=modal：弹层 name 属性 */
  modalName?: string
}

export interface GeneratedMethod {
  name: string
  /** 函数参数列表，如 `item: Record<string, any>, index: number, payload?: Record<string, any>` */
  params: string
  body: string
}

export interface CodegenContext {
  kind: 'page' | 'component'
  id: string
  storeName: string
  /** 页面数据池字段名（ref/computed），页面级不用 Pinia */
  dataFieldNames: string[]
  componentImports: Map<string, string>
  componentConfigs: Map<string, ComponentConfig>
  /** 组件 XML 根节点（用于判断仅 Modal 等 out-of-flow） */
  componentRoots: Map<string, XmlNode>
  modalNames: Set<string>
  refPathMap: Map<string, string>
  refFields: PageRefField[]
  methods: GeneratedMethod[]
  methodSeq: number
  /** 事件辅助脚本（如滚动触边状态） */
  extraScript: string[]
  indent: number
  /** 是否使用导出的 AppIcon 组件 */
  needsAppIcon: boolean
  /** 是否使用导出的 AppSwiper 组件 */
  needsAppSwiper: boolean
  /** 项目调色板（颜色 key → CSS var） */
  colorPalette?: ColorPalette
}

/** 与编辑器 isOutOfFlowTree 一致：仅 Modal / 全 Modal Fragment 不占文档流 */
function isOutOfFlowTree(node: XmlNode): boolean {
  if (node.tag === 'Modal') return true
  if (node.tag === 'Fragment') {
    return (
      node.children.length > 0 && node.children.every((child) => isOutOfFlowTree(child))
    )
  }
  return false
}

interface EventBinding {
  id: string
  method: string
  args: Record<string, string>
  body?: string
}

function parseBindings(raw: string | undefined): EventBinding[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as any
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => {
        const row = item as Partial<EventBinding>
        return {
          id: String(row.id || `bind_${index}`),
          method: String(row.method ?? '').trim(),
          args:
            row.args && typeof row.args === 'object' && !Array.isArray(row.args)
              ? Object.fromEntries(
                  Object.entries(row.args).map(([k, v]) => [k, v == null ? '' : String(v)]),
                )
              : {},
          body: typeof row.body === 'string' ? row.body : undefined,
        }
      })
      .filter((item) => item.method)
  } catch {
    return []
  }
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false
  return value === 'true' || value === '1'
}

/** 与编辑器一致：未写 closeOnClick 时默认可点遮罩关闭 */
function parseCloseOnClick(value: string | undefined): boolean {
  if (value == null || value === '') return true
  return parseBool(value)
}

function parseNumber(value: string | undefined): number | null {
  if (!value || value === 'null') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 静态尺寸 → Tailwind 任意值 class */
function sizeClass(
  value: string | undefined,
  axis: 'w' | 'h',
  options?: {
    /** 处于纵向滚动列内：match_parent 高度按内容堆叠，才能撑出滚动 */
    stackHeight?: boolean
    /** 自身为滚动容器 */
    isScrollContainer?: boolean
    /** 父级为纵向 LinearLayout，用 flex-1 占满剩余高度 */
    flexFillHeight?: boolean
    /** 父级为横向 LinearLayout，用 flex-1 占满剩余宽度（与编辑器一致） */
    flexFillWidth?: boolean
    /** 父级为横向 LinearLayout */
    parentHorizontal?: boolean
  },
): string | undefined {
  if (!value || value === 'null') return undefined
  if (value === 'match_parent') {
    if (axis === 'w') {
      // 横向线性布局：match_parent = 吃掉剩余空间，勿用 w-full
      if (options?.flexFillWidth) return 'flex-1 min-w-0'
      return 'w-full min-w-0'
    }
    if (options?.stackHeight) return 'h-fit'
    if (options?.isScrollContainer) {
      return options.flexFillHeight
        ? 'flex-1 min-h-0 max-h-full'
        : 'h-full min-h-0 max-h-full'
    }
    if (options?.flexFillHeight) return 'flex-1 min-h-0 h-full'
    return 'h-full min-h-0'
  }
  if (value === 'wrap_content') {
    if (axis === 'w') {
      return options?.parentHorizontal ? 'w-fit max-w-full shrink-0' : 'w-fit max-w-full'
    }
    return 'h-fit'
  }
  const n = parseNumber(value)
  if (n != null) {
    if (axis === 'w' && options?.parentHorizontal) return `w-[${n}px] shrink-0`
    return `${axis}-[${n}px]`
  }
  return undefined
}

function parseOverflowStrategy(
  value: string | undefined,
): 'hidden' | 'visible' | 'scroll' {
  const raw = value?.trim().toLowerCase()
  if (raw === 'hidden' || raw === 'visible' || raw === 'scroll') return raw
  return 'visible'
}

function pxClass(prefix: string, value: string | undefined): string | undefined {
  const n = parseNumber(value)
  if (n == null) return undefined
  return `${prefix}-[${n}px]`
}

function colorClass(
  prefix: string,
  value: string | undefined,
  palette?: ColorPalette,
): string | undefined {
  if (!value || value === 'null') return undefined
  if (value.includes('{')) return undefined
  const cssValue =
    resolvePaletteColorForCss(value, palette ?? activeColorPalette) ?? value
  // Tailwind 任意值里空格/逗号用下划线
  const normalized = cssValue.trim().replace(/\s+/g, '_').replace(/,/g, '_')
  return `${prefix}-[${normalized}]`
}

function isStaticBinding(raw: string): boolean {
  return !raw.includes('{')
}

/** 属性：静态写普通 attr，动态写 :attr */
function attrBinding(
  name: string,
  raw: string,
  ctx: CodegenContext,
  inRepeat: boolean,
): string {
  const trimmed = raw.trim()
  if (isStaticBinding(trimmed)) {
    if (trimmed === 'true' || trimmed === 'false') return `:${name}="${trimmed}"`
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `:${name}="${trimmed}"`
    return `${name}="${escapeHtmlAttr(trimmed)}"`
  }
  return `:${name}="${bindingToExpr(trimmed, ctx, inRepeat)}"`
}

function bindingToExpr(
  raw: string,
  ctx: CodegenContext,
  inRepeat: boolean,
): string {
  const trimmed = raw.trim()
  if (!trimmed.includes('{')) {
    if (trimmed === 'true' || trimmed === 'false') return trimmed
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
    return `'${escapeTsString(trimmed)}'`
  }

  const whole = unwrapWholeBinding(trimmed)
  if (whole != null) {
    const inner = normalizeBindingOperators(whole)
    if (inner.startsWith('$props.') || inner === '$props') {
      const path = inner === '$props' ? '' : inner.slice(7)
      return path ? `props.${path}` : 'props'
    }
    if (inner.startsWith('$route.') || inner === '$route') {
      const path = inner === '$route' ? '' : inner.slice(7)
      return path ? `route.params.${path}` : 'route.params'
    }
    if (inner.startsWith('$query.') || inner === '$query') {
      const path = inner === '$query' ? '' : inner.slice(7)
      return path ? `(route.query.${path} as string)` : 'route.query'
    }
    if (inner === 'index' && inRepeat) return 'index'
    if (inner === 'item' && inRepeat) return 'item'
    if (inner.startsWith('item.') && inRepeat) return `item.${inner.slice(5)}`
    if (inner.startsWith('item.') && !inRepeat) return 'undefined'
    // 简单字段或嵌套路径：goodsInfo / goodsInfo.deliveryFee
    if (isSimpleBindingPath(inner)) {
      const root = inner.split(/[.\[]/)[0]!
      if (ctx.kind === 'page' || ctx.dataFieldNames.includes(root)) return inner
      return `store.${inner}`
    }
    // 复杂表达式（三元 / 模板字符串等）→ 直接写入模板
    return `(${rewriteBindingExprForVue(inner)})`
  }

  // 混合文案（含嵌套 {} 的表达式）→ runtime interpolate
  if (scanBindingSpans(trimmed).length) {
    const scopeExpr = inRepeat ? '{ item, index }' : 'undefined'
    const propsExpr =
      ctx.kind === 'component' ? 'props as Record<string, any>' : 'undefined'
    const storeExpr = ctx.kind === 'page' ? 'pageStore' : 'store'
    return `interpolate('${escapeTsString(trimmed)}', { store: ${storeExpr}, scope: ${scopeExpr}, props: ${propsExpr}, route: { ...route.params, ...route.query } as Record<string, any> })`
  }

  return `'${escapeTsString(trimmed)}'`
}

/** 模板内表达式：规范化 $query / $route / $props */
function rewriteBindingExprForVue(expr: string): string {
  return normalizeBindingOperators(expr)
    .replace(/\b\$query\b/g, 'route.query')
    .replace(/\b\$route\b/g, 'route.params')
    .replace(/\b\$props\b/g, 'props')
}

/** v-for 列表表达式：数据池字段或 $props.xxx */
function repeatListExpr(field: string, ctx: CodegenContext): string {
  const trimmed = field.trim()
  if (trimmed.startsWith('$props.')) {
    const path = trimmed.slice('$props.'.length).trim()
    return path ? `props.${path}` : 'props'
  }
  if (ctx.kind === 'page' || ctx.dataFieldNames.includes(trimmed)) return trimmed
  return `store.${trimmed}`
}

/** 布局属性 → Tailwind class（不写 style） */
function buildTwClasses(
  attrs: Record<string, string>,
  options?: {
    isRelativeChild?: boolean
    extra?: string[]
    inScrollColumn?: boolean
    /** 父级 LinearLayout 的 orientation */
    parentOrientation?: string
    parentTag?: string
    colorPalette?: ColorPalette
  },
): string {
  const classes: string[] = [...(options?.extra ?? [])]
  const overflow = parseOverflowStrategy(attrs.overflow)
  const isScrollContainer = overflow === 'scroll'
  const flexFillHeight =
    options?.parentTag === 'LinearLayout' &&
    options.parentOrientation !== 'horizontal' &&
    !options?.isRelativeChild &&
    !options?.inScrollColumn

  // 纵向滚动列内禁止纵向压缩；横向线性布局仍需可压缩，否则 match_parent 多列无法并排
  if (options?.inScrollColumn && options?.parentOrientation !== 'horizontal') {
    classes.push('shrink-0')
  }

  // 注意：attrs.gravity 只表示容器内子项对齐（见 flexClasses / Text textAlign），
  // 与编辑器一致，不要当成 layout_gravity 给自身加 mt-auto / my-auto。

  if (options?.isRelativeChild) {
    classes.push('absolute')
    const hasEdge =
      parseBool(attrs.layout_alignParentLeft) ||
      parseBool(attrs.layout_alignParentStart) ||
      parseBool(attrs.layout_alignParentRight) ||
      parseBool(attrs.layout_alignParentEnd) ||
      parseBool(attrs.layout_alignParentTop) ||
      parseBool(attrs.layout_alignParentBottom) ||
      parseBool(attrs.layout_centerInParent) ||
      parseBool(attrs.layout_centerHorizontal) ||
      parseBool(attrs.layout_centerVertical) ||
      attrs.layout_marginLeft != null ||
      attrs.layout_marginTop != null ||
      attrs.layout_marginRight != null ||
      attrs.layout_marginBottom != null

    if (parseBool(attrs.layout_alignParentLeft) || parseBool(attrs.layout_alignParentStart)) {
      classes.push('left-0')
    }
    if (parseBool(attrs.layout_alignParentRight) || parseBool(attrs.layout_alignParentEnd)) {
      classes.push('right-0')
    }
    if (parseBool(attrs.layout_alignParentTop)) classes.push('top-0')
    if (parseBool(attrs.layout_alignParentBottom)) classes.push('bottom-0')
    if (parseBool(attrs.layout_centerInParent)) {
      classes.push('left-1/2', 'top-1/2', '-translate-x-1/2', '-translate-y-1/2')
    } else {
      const hasMl = Boolean(attrs.layout_marginLeft?.trim())
      const hasMr = Boolean(attrs.layout_marginRight?.trim())
      const hasMt = Boolean(attrs.layout_marginTop?.trim())
      const hasMb = Boolean(attrs.layout_marginBottom?.trim())
      if (parseBool(attrs.layout_centerHorizontal) && !hasMl && !hasMr) {
        classes.push('left-1/2', '-translate-x-1/2')
      }
      if (parseBool(attrs.layout_centerVertical) && !hasMt && !hasMb) {
        classes.push('top-1/2', '-translate-y-1/2')
      }
    }
    const ml = pxClass('left', attrs.layout_marginLeft)
    if (ml) classes.push(ml)
    const mt = pxClass('top', attrs.layout_marginTop)
    if (mt) classes.push(mt)
    const mr = pxClass('right', attrs.layout_marginRight)
    if (mr) classes.push(mr)
    const mb = pxClass('bottom', attrs.layout_marginBottom)
    if (mb) classes.push(mb)

    // 相对布局中铺满且可滚：用 inset 固定视口，避免高度随内容撑开导致无法滚动
    if (
      !hasEdge &&
      isScrollContainer &&
      attrs.width === 'match_parent' &&
      attrs.height === 'match_parent'
    ) {
      classes.push('inset-0')
    }
  }

  const parentHorizontal =
    options?.parentTag === 'LinearLayout' && options.parentOrientation === 'horizontal'
  const flexFillWidth = parentHorizontal && !options?.isRelativeChild
  const w = sizeClass(attrs.width, 'w', { flexFillWidth, parentHorizontal })
  if (w) classes.push(...w.split(' '))

  const skipHeight =
    options?.isRelativeChild &&
    isScrollContainer &&
    attrs.width === 'match_parent' &&
    attrs.height === 'match_parent' &&
    classes.includes('inset-0')

  if (!skipHeight) {
    const h = sizeClass(attrs.height, 'h', {
      // Swiper / MultiWindow 窗内仍按父级定高，勿因外层滚动列改成 h-fit
      stackHeight:
        Boolean(options?.inScrollColumn) &&
        !isScrollContainer &&
        options?.parentTag !== 'Swiper' &&
        options?.parentTag !== 'MultiWindow',
      isScrollContainer,
      flexFillHeight,
    })
    if (h) classes.push(...h.split(' '))
  }

  const spacingMap: Array<[string, string]> = [
    ['margin', 'm'],
    ['marginLeft', 'ml'],
    ['marginRight', 'mr'],
    ['marginTop', 'mt'],
    ['marginBottom', 'mb'],
    ['padding', 'p'],
    ['paddingLeft', 'pl'],
    ['paddingRight', 'pr'],
    ['paddingTop', 'pt'],
    ['paddingBottom', 'pb'],
  ]
  for (const [attr, prefix] of spacingMap) {
    const cls = pxClass(prefix, attrs[attr])
    if (cls) classes.push(cls)
  }

  const bg = colorClass('bg', attrs.background, options?.colorPalette)
  if (bg) classes.push(bg)

  const br = pxClass('rounded', attrs.borderRadius)
  if (br) classes.push(br)
  const tl = pxClass('rounded-tl', attrs.borderTopLeftRadius)
  if (tl) classes.push(tl)
  const tr = pxClass('rounded-tr', attrs.borderTopRightRadius)
  if (tr) classes.push(tr)
  const brr = pxClass('rounded-br', attrs.borderBottomRightRadius)
  if (brr) classes.push(brr)
  const bl = pxClass('rounded-bl', attrs.borderBottomLeftRadius)
  if (bl) classes.push(bl)

  const bw = parseNumber(attrs.borderWidth)
  if (bw != null && bw > 0) {
    classes.push(bw === 1 ? 'border' : `border-[${bw}px]`)
    classes.push('border-solid')
  }
  const bc = colorClass('border', attrs.borderColor)
  if (bc) classes.push(bc)

  // 与编辑器一致：未声明时默认 visible（不写 class）；仅显式 hidden/scroll/visible 时输出
  const overflowExplicit = (attrs.overflow ?? '').trim().toLowerCase()
  const extraHasOverflow = (options?.extra ?? []).some(
    (c) => c === 'overflow-hidden' || c === 'overflow-visible' || c.startsWith('overflow-'),
  )
  if (!extraHasOverflow) {
    if (overflow === 'scroll') {
      classes.push(
        'overflow-x-hidden',
        'overflow-y-auto',
        'min-h-0',
        'overscroll-contain',
        'touch-pan-y',
      )
    } else if (overflowExplicit === 'hidden') {
      classes.push('overflow-hidden')
    } else if (overflowExplicit === 'visible') {
      classes.push('overflow-visible')
    }
  } else if (overflow === 'scroll') {
    classes.push('overflow-x-hidden', 'overflow-y-auto', 'min-h-0', 'overscroll-contain')
  } else if (overflowExplicit === 'visible') {
    classes.push('overflow-visible')
  } else if (overflowExplicit === 'hidden') {
    classes.push('overflow-hidden')
  }

  return classes.filter(Boolean).join(' ')
}

function flexClasses(tag: string, attrs: Record<string, string>): string {
  if (tag !== 'LinearLayout') return ''
  const classes: string[] = ['flex']
  const horizontal = attrs.orientation === 'horizontal'
  classes.push(horizontal ? 'flex-row' : 'flex-col')
  const gap = parseNumber(attrs.gap)
  if (gap != null && gap > 0) classes.push(`gap-[${gap}px]`)

  // 与编辑器 mapGravityMain / mapGravityCross 一致
  const gravity = (attrs.gravity ?? '').toLowerCase().trim()
  if (gravity) {
    const isSpaceBetween =
      gravity.includes('space_between') || gravity.includes('space-between')
    if (horizontal) {
      if (isSpaceBetween) classes.push('justify-between')
      else if (gravity.includes('right') || gravity.includes('end')) classes.push('justify-end')
      else if (gravity.includes('left') || gravity.includes('start')) classes.push('justify-start')
      else if (gravity.includes('center_horizontal') || gravity === 'center') {
        classes.push('justify-center')
      }

      if (gravity.includes('bottom')) classes.push('items-end')
      else if (gravity.includes('top')) classes.push('items-start')
      else if (
        gravity.includes('center_vertical') ||
        gravity === 'center' ||
        (isSpaceBetween && gravity.includes('center'))
      ) {
        classes.push('items-center')
      }
    } else {
      if (isSpaceBetween) classes.push('justify-between')
      else if (gravity.includes('bottom')) classes.push('justify-end')
      else if (gravity.includes('top')) classes.push('justify-start')
      else if (gravity.includes('center_vertical') || gravity === 'center') {
        classes.push('justify-center')
      }

      if (gravity.includes('right') || gravity.includes('end')) classes.push('items-end')
      else if (gravity.includes('left') || gravity.includes('start')) classes.push('items-start')
      else if (
        gravity.includes('center_horizontal') ||
        gravity === 'center' ||
        (isSpaceBetween && gravity.includes('center'))
      ) {
        classes.push('items-center')
      }
    }
  }
  return classes.join(' ')
}

function classAttr(classes: string): string {
  const trimmed = classes.trim().replace(/\s+/g, ' ')
  return trimmed ? `class="${trimmed}"` : ''
}

/** 单行软限制：超出则属性换行并缩进 */
const TAG_LINE_LIMIT = 100

/**
 * 格式化 Vue 标签：属性过多/过长时换行，子属性相对标签多缩进 2 空格
 */
function formatVueElement(options: {
  pad: string
  tag: string
  attrs?: Array<string | false | null | undefined>
  selfClosing?: boolean
  /** 标签内文本或子节点 HTML（已含缩进） */
  inner?: string
}): string {
  const { pad, tag, selfClosing = false } = options
  const attrs = (options.attrs ?? [])
    .flatMap((item) => {
      if (!item) return []
      // 兼容误传入的多属性空格拼接
      return item
        .trim()
        .split(/\s+(?=[@:#]?[\w.-]+=)/)
        .map((s) => s.trim())
        .filter(Boolean)
    })
    .filter(Boolean)

  const inlineOpen = `${pad}<${tag}${attrs.map((a) => ` ${a}`).join('')}${
    selfClosing ? ' />' : '>'
  }`
  const breakAttrs = inlineOpen.length > TAG_LINE_LIMIT && attrs.length >= 2

  let open: string
  if (!breakAttrs) {
    open = inlineOpen
  } else {
    const attrPad = `${pad}  `
    open = [`${pad}<${tag}`, ...attrs.map((a) => `${attrPad}${a}`), `${pad}${selfClosing ? '/>' : '>'}`].join(
      '\n',
    )
  }

  if (selfClosing) return open

  const inner = options.inner ?? ''
  if (!inner.trim()) {
    return breakAttrs ? `${open}\n${pad}</${tag}>` : `${open}</${tag}>`
  }

  const innerIsBlock = inner.includes('\n')
  if (!innerIsBlock) {
    const trimmedInner = inner.trim()
    const oneLine = `${open}${trimmedInner}</${tag}>`
    if (!breakAttrs && oneLine.length <= TAG_LINE_LIMIT) return oneLine
    // 已带缩进的子标签保留原缩进；纯文本再缩进一级
    const childLine = /^\s*</.test(inner) ? inner.replace(/^\n+/, '') : `${pad}  ${trimmedInner}`
    return `${open}\n${childLine}\n${pad}</${tag}>`
  }

  return `${open}\n${inner}\n${pad}</${tag}>`
}

interface VisibilityCondition {
  field: string
  op: string
  value: string
}

interface VisibilityScenario {
  conditions?: VisibilityCondition[]
}

function visibilityFieldExpr(
  field: string,
  ctx: CodegenContext,
  inRepeat: boolean,
): string {
  const raw = field.trim()
  if (!raw) return 'undefined'
  if (raw === 'index') return inRepeat ? 'index' : '0'
  if (raw === 'item') return inRepeat ? 'item' : 'undefined'
  if (raw.startsWith('item.')) {
    return inRepeat ? `item.${raw.slice(5)}` : 'undefined'
  }
  if (raw.startsWith('$props.') || raw.startsWith('props.')) {
    const path = raw.replace(/^\$?props\./, '')
    return `props.${path}`
  }
  if (raw.startsWith('$route.') || raw.startsWith('route.')) {
    const path = raw.replace(/^\$?route\./, '')
    return `route.params.${path}`
  }
  if (raw.startsWith('$query.') || raw.startsWith('query.')) {
    const path = raw.replace(/^\$?query\./, '')
    return `route.query.${path}`
  }
  if (ctx.kind === 'page' || ctx.dataFieldNames.includes(raw)) return raw
  return `store.${raw}`
}

function visibilityConditionExpr(
  cond: VisibilityCondition,
  ctx: CodegenContext,
  inRepeat: boolean,
): string {
  const left = visibilityFieldExpr(cond.field, ctx, inRepeat)
  const right = cond.value ?? ''
  const rightLit = `'${escapeTsString(right)}'`
  switch (cond.op) {
    case 'empty':
      return `(${left} == null || ${left} === '' || (Array.isArray(${left}) && ${left}.length === 0))`
    case 'notEmpty':
      return `!(${left} == null || ${left} === '' || (Array.isArray(${left}) && ${left}.length === 0))`
    case 'contains':
      return `String(${left} ?? '').includes(${rightLit})`
    case 'eq':
      return `String(${left} ?? '') === ${rightLit}`
    case 'neq':
      return `String(${left} ?? '') !== ${rightLit}`
    case 'gt':
      return `Number(${left}) > Number(${rightLit})`
    case 'gte':
      return `Number(${left}) >= Number(${rightLit})`
    case 'lt':
      return `Number(${left}) < Number(${rightLit})`
    case 'lte':
      return `Number(${left}) <= Number(${rightLit})`
    default:
      return 'false'
  }
}

/** vShow / vIf JSON → 模板条件表达式 */
function compileVisibilityExpr(
  raw: string | undefined,
  ctx: CodegenContext,
  inRepeat: boolean,
): string | null {
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
        .map((c) => visibilityConditionExpr(c, ctx, inRepeat))
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

function visibilityAttrs(
  attrs: Record<string, string>,
  ctx: CodegenContext,
  inRepeat: boolean,
): string[] {
  const parts: string[] = []
  if (attrs.vShow?.trim()) {
    const expr = compileVisibilityExpr(attrs.vShow, ctx, inRepeat) ?? 'true'
    parts.push(`v-show="${expr}"`)
  }
  if (attrs.vIf?.trim()) {
    const expr = compileVisibilityExpr(attrs.vIf, ctx, inRepeat) ?? 'true'
    parts.push(`v-if="${expr}"`)
  }
  return parts
}

interface DynamicStyleStateParsed {
  scenarios: VisibilityScenario[]
  styles: Record<string, string>
}

function parseDynamicStylesStates(raw: string | undefined): DynamicStyleStateParsed[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as { states?: Array<{ scenarios?: VisibilityScenario[]; styles?: Record<string, string> }> }
    if (!Array.isArray(parsed.states)) return []
    return parsed.states
      .filter((s) => s && typeof s === 'object')
      .map((s) => ({
        scenarios: Array.isArray(s.scenarios) ? s.scenarios : [],
        styles:
          s.styles && typeof s.styles === 'object'
            ? Object.fromEntries(
                Object.entries(s.styles).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim(),
                ),
              )
            : {},
      }))
  } catch {
    return []
  }
}

function compileScenariosOrExpr(
  scenarios: VisibilityScenario[],
  ctx: CodegenContext,
  inRepeat: boolean,
): string {
  const active = scenarios.filter((s) =>
    (s.conditions ?? []).some((c) => c.field?.trim()),
  )
  if (!active.length) return 'true'
  const sceneExprs = active.map((scene) => {
    const conds = (scene.conditions ?? [])
      .filter((c) => c.field?.trim())
      .map((c) => visibilityConditionExpr(c, ctx, inRepeat))
    if (!conds.length) return 'true'
    if (conds.length === 1) return conds[0]!
    return `(${conds.join(' && ')})`
  })
  if (sceneExprs.length === 1) return sceneExprs[0]!
  return `(${sceneExprs.join(' || ')})`
}

/** 静态色用 Tailwind；绑定 / dynamicStyles 用表达式 */
function resolveColorExpr(
  attrName: string,
  baseRaw: string | undefined,
  attrs: Record<string, string>,
  ctx: CodegenContext,
  inRepeat: boolean,
  fallback = '#333',
): { static?: string; expr: string } {
  const base = baseRaw && baseRaw !== 'null' ? baseRaw.trim() : ''
  const baseCss =
    base && isStaticBinding(base)
      ? resolvePaletteColorForCss(base, activeColorPalette) ?? base
      : base
  const baseExpr = baseCss
    ? isStaticBinding(base)
      ? `'${escapeTsString(baseCss)}'`
      : `String(${bindingToExpr(base, ctx, inRepeat)} ?? '')`
    : `'${escapeTsString(fallback)}'`

  const states = parseDynamicStylesStates(attrs.dynamicStyles).filter(
    (s) => s.styles[attrName]?.trim(),
  )
  if (!states.length) {
    if (base && isStaticBinding(base)) return { static: baseCss, expr: baseExpr }
    return { expr: baseExpr }
  }

  let expr = baseExpr
  for (let i = states.length - 1; i >= 0; i--) {
    const state = states[i]!
    const override = state.styles[attrName]!.trim()
    const overrideCss =
      isStaticBinding(override)
        ? resolvePaletteColorForCss(override, activeColorPalette) ?? override
        : override
    const overrideExpr = isStaticBinding(override)
      ? `'${escapeTsString(overrideCss)}'`
      : `String(${bindingToExpr(override, ctx, inRepeat)} ?? '')`
    const when = compileScenariosOrExpr(state.scenarios, ctx, inRepeat)
    expr = `(${when}) ? ${overrideExpr} : (${expr})`
  }
  return { expr }
}

function styleAttr(styleEntries: string[]): string {
  const filtered = styleEntries.filter(Boolean)
  if (!filtered.length) return ''
  return `:style="{ ${filtered.join(', ')} }"`
}

/** rotateX/Y/Z（度）→ transform 样式片段，支持静态数字与数据池绑定 */
function rotateStyleEntries(
  attrs: Record<string, string>,
  ctx: CodegenContext,
  inRepeat: boolean,
): string[] {
  const xRaw = attrs.rotateX?.trim() ?? ''
  const yRaw = attrs.rotateY?.trim() ?? ''
  const zRaw = attrs.rotateZ?.trim() ?? ''
  if (!xRaw && !yRaw && !zRaw) return []

  const dynamic = [xRaw, yRaw, zRaw].some((raw) => raw.includes('{'))
  if (!dynamic) {
    const x = parseNumber(xRaw) ?? 0
    const y = parseNumber(yRaw) ?? 0
    const z = parseNumber(zRaw) ?? 0
    if (!x && !y && !z) return []
    const parts: string[] = []
    if (x || y) parts.push('perspective(800px)')
    if (x) parts.push(`rotateX(${x}deg)`)
    if (y) parts.push(`rotateY(${y}deg)`)
    if (z) parts.push(`rotateZ(${z}deg)`)
    return [`transform: '${parts.join(' ')}'`]
  }

  const degExpr = (raw: string): string => {
    if (!raw) return `'0deg'`
    if (raw.includes('{')) {
      return `(Number(${bindingToExpr(raw, ctx, inRepeat)}) || 0) + 'deg'`
    }
    return `'${parseNumber(raw) ?? 0}deg'`
  }

  const parts: string[] = []
  if (xRaw || yRaw) parts.push(`'perspective(800px)'`)
  if (xRaw) parts.push(`'rotateX(' + ${degExpr(xRaw)} + ')'`)
  if (yRaw) parts.push(`'rotateY(' + ${degExpr(yRaw)} + ')'`)
  if (zRaw) parts.push(`'rotateZ(' + ${degExpr(zRaw)} + ')'`)
  return [`transform: [${parts.join(', ')}].join(' ')`]
}

/** 宽高/间距绑定变量 → :style（静态数字仍走 Tailwind class） */
function dynamicPxStyleEntries(
  attrs: Record<string, string>,
  ctx: CodegenContext,
  inRepeat: boolean,
): string[] {
  const map: Array<[string, string]> = [
    ['width', 'width'],
    ['height', 'height'],
    ['padding', 'padding'],
    ['paddingLeft', 'paddingLeft'],
    ['paddingRight', 'paddingRight'],
    ['paddingTop', 'paddingTop'],
    ['paddingBottom', 'paddingBottom'],
    ['margin', 'margin'],
    ['marginLeft', 'marginLeft'],
    ['marginRight', 'marginRight'],
    ['marginTop', 'marginTop'],
    ['marginBottom', 'marginBottom'],
  ]
  const out: string[] = []
  for (const [attr, css] of map) {
    const raw = attrs[attr]?.trim()
    if (!raw || !raw.includes('{')) continue
    if (raw === 'match_parent' || raw === 'wrap_content') continue
    out.push(`${css}: (Number(${bindingToExpr(raw, ctx, inRepeat)}) || 0) + 'px'`)
  }
  return out
}

function twWithRelative(
  attrs: Record<string, string>,
  parentTag: string,
  extra?: string[],
  options?: {
    inScrollColumn?: boolean
    parentOrientation?: string
  },
): string {
  return buildTwClasses(attrs, {
    isRelativeChild: parentTag === 'RelativeLayout',
    extra,
    inScrollColumn: options?.inScrollColumn,
    parentTag,
    parentOrientation: options?.parentOrientation,
  })
}

function vueEventName(key: string): string {
  if (key === 'onClick') return 'click'
  if (key === 'onLongClick') return 'contextmenu.prevent'
  if (key === 'onScroll') return 'scroll'
  if (key === 'onScrollToLower') return 'scroll'
  if (key === 'onScrollToUpper') return 'scroll'
  if (key === 'onTouchStart') return 'touchstart'
  if (key === 'onTouchMove') return 'touchmove'
  if (key === 'onTouchEnd') return 'touchend'
  return key.replace(/^on/, '').replace(/^[A-Z]/, (c) => c.toLowerCase())
}

/** 绑定参数模板 → 方法体内表达式（codegen 时展开） */
function templateToExpr(raw: string, inRepeat: boolean, hasPayload: boolean, ctx: CodegenContext): string {
  const trimmed = raw.trim()
  if (!trimmed.includes('{')) {
    if (trimmed === 'true' || trimmed === 'false') return trimmed
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
    return `'${escapeTsString(trimmed)}'`
  }

  if (/^\{[^{}]+\}$/.test(trimmed)) {
    const inner = trimmed.slice(1, -1).trim()
    if (inner === 'index') return inRepeat ? 'index' : '0'
    if (inner === 'item') return inRepeat ? 'item' : 'undefined'
    if (inner.startsWith('item.')) {
      return inRepeat ? `item.${inner.slice(5)}` : 'undefined'
    }
    if (inner.startsWith('$props.')) return `props.${inner.slice(7)}`
    if (inner.startsWith('$route.')) return `String(route.params.${inner.slice(7)} ?? '')`
    if (inner.startsWith('$query.')) return `String(route.query.${inner.slice(7)} ?? '')`
    if (/^[A-Za-z_][\w.]*$/.test(inner)) {
      const root = inner.split('.')[0]!
      const parts: string[] = []
      if (hasPayload) parts.push(`payload?.${inner}`)
      if (inRepeat) parts.push(`item?.${inner}`)
      if (ctx.dataFieldNames.includes(root)) {
        parts.push(
          inner.includes('.')
            ? `${root}.value.${inner.slice(root.length + 1)}`
            : `${root}.value`,
        )
      } else if (ctx.kind === 'component') {
        parts.push(`store.$state.${inner}`)
      } else if (!parts.length) {
        parts.push(inner)
      }
      return parts.join(' ?? ')
    }
  }

  // 混合文案 / 复杂插值，退回 runtime interpolate
  const storeExpr = ctx.kind === 'page' ? 'pageStore' : 'store'
  return `interpolate('${escapeTsString(trimmed)}', {
    store: ${storeExpr},
    scope: ${inRepeat ? '{ item, index }' : 'undefined'},
    props: typeof props !== 'undefined' ? (props as Record<string, any>) : undefined,
    route: { ...route.params, ...route.query } as Record<string, any>,
  })`
}

function transformCustomSetData(line: string, fieldNames: readonly string[]): string {
  return line.replace(
    /\bsetData\s*\(\s*['"]([\w$]+)['"]\s*,\s*([\s\S]*?)\s*\)\s*;?/g,
    (_match, prop: string, value: string) => {
      if (fieldNames.includes(prop)) {
        return `${prop}.value = ${value.trim()}`
      }
      return `pageStore.setData('${prop}', ${value.trim()})`
    },
  )
}

/** 组件内 updateProps('x', v) → emit('update:x', v) */
function transformCustomUpdateProps(line: string, kind: 'page' | 'component'): string {
  if (kind !== 'component') {
    return line.replace(
      /\bupdateProps\s*\(/g,
      '(() => { throw new Error("updateProps 仅可在组件内使用") })(',
    )
  }
  return line.replace(
    /\bupdateProps\s*\(\s*['"]([\w$]+)['"]\s*,\s*([\s\S]*?)\s*\)\s*;?/g,
    (_match, prop: string, value: string) =>
      `emit('update:${prop}' as any, ${value.trim()})`,
  )
}

function transformCustomRefAccess(line: string, refNames: readonly string[]): string {
  let result = line
  for (const name of refNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(
      new RegExp(`\\b${escaped}\\.(\\w+)\\s*\\(`, 'g'),
      `${name}.value?.$1(`,
    )
  }
  return result
}

function transformCustomDataReads(line: string, fieldNames: readonly string[]): string {
  let result = line
  // 独立标识 → .value；已是 .value / 属性访问成员 / 赋值左侧则跳过
  const sorted = [...fieldNames].sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(
      new RegExp(`(?<!\\.)\\b${escaped}\\b(?!\\s*\\.value\\b)(?!\\s*=)`, 'g'),
      `${name}.value`,
    )
  }
  return result
}

function renderComponentRefDeclarations(refFields: PageRefField[]): string {
  const componentFields = refFields.filter((f) => f.kind === 'component')
  if (!componentFields.length) return ''
  const lines = componentFields.map((field) => {
    const methods = field.exposedMethods.filter((m) => /^[A-Za-z_$][\w$]*$/.test(m))
    const typeMembers = methods.map((m) => `${m}?: () => void`).join('; ')
    const type = typeMembers ? `{ ${typeMembers} }` : 'Record<string, any>'
    return `const ${field.name} = ref<${type} | null>(null)`
  })
  return `\n${lines.join('\n')}\n`
}

function renderModalRefDeclarations(refFields: PageRefField[]): string {
  const modalFields = refFields.filter((f) => f.kind === 'modal' && f.modalName)
  if (!modalFields.length) return ''
  const lines = modalFields.map((field) => {
    const key = escapeTsString(field.modalName!)
    return `const ${field.name} = ref({
  show: () => { modalVisible['${key}'] = true },
  hide: () => { modalVisible['${key}'] = false },
})`
  })
  return `\n${lines.join('\n')}\n`
}

function transformCustomLine(
  line: string,
  ctx: CodegenContext,
): string {
  const refNames = ctx.refFields.map((f) => f.name)
  let next = transformCustomRefAccess(line, refNames)
  next = transformCustomUpdateProps(next, ctx.kind)
  if (ctx.kind === 'page') {
    next = transformCustomSetData(next, ctx.dataFieldNames)
    next = transformCustomDataReads(next, ctx.dataFieldNames)
  }
  return next
}

/** script 里的 .value → 模板中自动解包 */
function scriptExprToTemplate(expr: string, ctx: CodegenContext): string {
  let result = expr
  const names = [
    ...ctx.refFields.map((f) => f.name),
    ...ctx.dataFieldNames,
  ]
  const sorted = [...names].sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`\\b${escaped}\\.value\\b`, 'g'), name)
  }
  return result
}

/**
 * 事件绑定 → 模板内联；无法内联时返回 null
 */
function tryInlineEventHandler(
  bindings: EventBinding[],
  options: { inRepeat: boolean; hasPayload: boolean; isScroll?: boolean },
  ctx: CodegenContext,
): string | null {
  if (!bindings.length) return null

  // 纯自定义：走专用逻辑（含 $props 等）
  if (bindings.every((b) => b.method === '__custom__')) {
    return tryInlineCustomHandler(bindings, options, ctx)
  }

  const statements = bindings.flatMap((b) =>
    emitBindingStatements(b, options.inRepeat, options.hasPayload, ctx, {
      isScroll: options.isScroll,
    }),
  )
  if (!statements.length) return null

  // 含 TypeScript 断言过多、或多行复杂逻辑时，滚动事件仍可内联（去掉 as）
  const bodyLines = statements
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => scriptExprToTemplate(line, ctx))
    .map((line) => cleanTemplateStatement(line))

  if (!bodyLines.length) return null

  let arrowParams = '()'
  if (options.isScroll && options.inRepeat) arrowParams = '(e)'
  else if (options.isScroll) arrowParams = '(e)'
  else if (options.hasPayload && options.inRepeat) arrowParams = '(payload)'
  else if (options.hasPayload) arrowParams = '(payload)'
  // v-for 下 item/index 已在作用域，箭头无需再声明

  if (bodyLines.length === 1) {
    return `${arrowParams} => ${bodyLines[0]}`
  }
  return `${arrowParams} => { ${bodyLines.join('; ')} }`
}

/** 去掉模板中不合法的 TS 语法，并简化字面量 */
function cleanTemplateStatement(stmt: string): string {
  return stmt
    .replace(/\s+as\s+typeof\s+[\w.$]+/g, '')
    .replace(/\s+as\s+HTMLElement/g, '')
    .replace(/\s+as\s+never/g, '')
    .replace(/\s+as\s+Record<string,\s*any>/g, '')
    .replace(/\(item as Record<string, any>\)\?/g, 'item?')
    .replace(/String\('([^'\\]*)'\)/g, "'$1'")
    .replace(/String\("([^"\\]*)"\)/g, '"$1"')
    .replace(/;$/, '')
}

/**
 * 纯自定义绑定 → 模板内联表达式；无法内联时返回 null
 */
function tryInlineCustomHandler(
  bindings: EventBinding[],
  options: { inRepeat: boolean; hasPayload: boolean; isScroll?: boolean },
  ctx: CodegenContext,
): string | null {
  if (!bindings.length) return null
  if (!bindings.every((b) => b.method === '__custom__')) return null

  const body = bindings
    .map((b) => b.body?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!body) return null

  const usesItem = /(^|[^.\w$])item([^.\w$]|$)/.test(body)
  const usesIndex = /(^|[^.\w$])index([^.\w$]|$)/.test(body)
  const usesProps = /\$props\b/.test(body)
  const usesPayload = /(^|[^.\w$])payload([^.\w$]|$)/.test(body)

  const prelude: string[] = []
  if (!options.inRepeat && usesItem) prelude.push('const item = undefined')
  if (!options.inRepeat && usesIndex) prelude.push('const index = 0')
  if (usesProps) {
    prelude.push(ctx.kind === 'component' ? 'const $props = props' : 'const $props = {}')
  }

  const bodyLines = body
    .split('\n')
    .map((line) => scriptExprToTemplate(transformCustomLine(line, ctx), ctx).trim())
    .filter(Boolean)
    .map((line) => line.replace(/;$/, ''))

  if (!bodyLines.length) return null

  let arrowParams = ''
  if (options.isScroll && options.inRepeat) arrowParams = '(item, index, e)'
  else if (options.isScroll) arrowParams = '(e)'
  else if (options.hasPayload && options.inRepeat) arrowParams = '(item, index, payload)'
  else if (options.hasPayload || usesPayload) arrowParams = '(payload)'
  else if (options.inRepeat && (usesItem || usesIndex)) arrowParams = '()'
  else arrowParams = '()'

  // v-for 作用域已有 item/index，箭头可不接参
  if (options.inRepeat && !options.isScroll && !options.hasPayload) {
    arrowParams = '()'
  }

  if (!prelude.length && bodyLines.length === 1) {
    return `${arrowParams} => ${bodyLines[0]}`
  }

  const blockLines = [...prelude, ...bodyLines.map((l) => `${l}`)]
  return `${arrowParams} => { ${blockLines.join('; ')} }`
}

function emitBindingStatements(
  binding: EventBinding,
  inRepeat: boolean,
  hasPayload: boolean,
  ctx: CodegenContext,
  options?: { isScroll?: boolean },
): string[] {
  const lines: string[] = []
  const method = binding.method

  if (method === '__custom__') {
    const body = binding.body?.trim()
    if (!body) return lines

    const usesItem = /(^|[^.\w$])item([^.\w$]|$)/.test(body)
    const usesIndex = /(^|[^.\w$])index([^.\w$]|$)/.test(body)
    const usesProps = /\$props\b/.test(body)

    const prelude: string[] = []
    if (!inRepeat && usesItem) prelude.push(`    const item = undefined`)
    if (!inRepeat && usesIndex) prelude.push(`    const index = 0`)
    if (usesProps) {
      prelude.push(
        ctx.kind === 'component' ? `    const $props = props` : `    const $props = {}`,
      )
    }

    const bodyLines: string[] = []
    for (const line of body.split('\n')) {
      bodyLines.push(`    ${transformCustomLine(line, ctx)}`)
    }

    if (!prelude.length) {
      for (const line of bodyLines) {
        lines.push(line.replace(/^ {4}/, '  '))
      }
      return lines
    }

    lines.push(`  {`)
    lines.push(...prelude)
    lines.push(...bodyLines)
    lines.push(`  }`)
    return lines
  }

  if (method === 'navigateTo') {
    const toExpr = templateToExpr(binding.args.to?.trim() || '', inRepeat, hasPayload, ctx)
    const paramsRaw = binding.args.params?.trim() || ''
    if (paramsRaw) {
      try {
        const parsed = JSON.parse(paramsRaw) as Record<string, any>
        const entries = Object.entries(parsed).map(([k, v]) => {
          const expr =
            typeof v === 'string'
              ? `String(${templateToExpr(v, inRepeat, hasPayload, ctx)} ?? '')`
              : `String(${JSON.stringify(v)} ?? '')`
          return `${/^[A-Za-z_][\w]*$/.test(k) ? k : JSON.stringify(k)}: ${expr}`
        })
        lines.push(`  navigateTo(${toExpr}, { ${entries.join(', ')} })`)
        return lines
      } catch {
        // fall through
      }
    }
    lines.push(`  navigateTo(${toExpr})`)
    return lines
  }

  if (method === 'navigateBack') {
    lines.push(`  navigateBack()`)
    return lines
  }

  if (method === 'setData') {
    const propRaw = binding.args.prop?.trim() || ''
    const valueRaw = binding.args.value ?? ''
    let valueExpr: string
    if (valueRaw.trim() === '{scrollTop}' && options?.isScroll) {
      valueExpr = '(e.currentTarget as HTMLElement).scrollTop'
    } else if (valueRaw.includes('{')) {
      valueExpr = templateToExpr(valueRaw, inRepeat, hasPayload, ctx)
    } else {
      try {
        valueExpr = JSON.stringify(JSON.parse(valueRaw))
      } catch {
        valueExpr = `'${escapeTsString(valueRaw)}'`
      }
    }

    // 静态字段名 → xxx.value = ...
    if (
      propRaw &&
      !propRaw.includes('{') &&
      ctx.dataFieldNames.includes(propRaw)
    ) {
      lines.push(`  ${propRaw}.value = ${valueExpr}`)
      return lines
    }

    // `{prop}` 形式
    if (/^\{([A-Za-z_][\w]*)\}$/.test(propRaw)) {
      const name = propRaw.slice(1, -1)
      if (ctx.dataFieldNames.includes(name)) {
        lines.push(`  ${name}.value = ${valueExpr}`)
        return lines
      }
    }

    const propExpr = templateToExpr(propRaw, inRepeat, hasPayload, ctx)
    if (ctx.kind === 'page') {
      lines.push(`  pageStore.setData(String(${propExpr}), ${valueExpr})`)
    } else {
      lines.push(`  store.setData(String(${propExpr}), ${valueExpr})`)
    }
    return lines
  }

  if (method === 'showToast') {
    const msg = templateToExpr(binding.args.message ?? '', inRepeat, hasPayload, ctx)
    const duration = (binding.args.duration ?? 'short').trim() || 'short'
    const durLit = duration === 'long' ? "'long'" : "'short'"
    lines.push(`  showToast(String(${msg}), ${durLit})`)
    return lines
  }

  if (method === 'emit') {
    const eventName = binding.args.event?.trim() || ''
    const payloadEntries = Object.entries(binding.args)
      .filter(([k]) => k !== 'event')
      .map(([k, v]) => `${/^[A-Za-z_][\w]*$/.test(k) ? k : JSON.stringify(k)}: ${templateToExpr(v, inRepeat, hasPayload, ctx)}`)
    lines.push(`  emit(${JSON.stringify(eventName)} as never, { ${payloadEntries.join(', ')} })`)
    return lines
  }

  if (method === 'updateProps') {
    const propRaw = binding.args.prop?.trim() || ''
    const valueRaw = binding.args.value ?? ''
    let valueExpr: string
    if (valueRaw.includes('{')) {
      valueExpr = templateToExpr(valueRaw, inRepeat, hasPayload, ctx)
    } else {
      try {
        valueExpr = JSON.stringify(JSON.parse(valueRaw))
      } catch {
        valueExpr = `'${escapeTsString(valueRaw)}'`
      }
    }
    if (ctx.kind !== 'component') {
      lines.push(`  console.warn('updateProps 仅可在组件内使用')`)
      return lines
    }
    if (propRaw && !propRaw.includes('{')) {
      lines.push(`  emit('update:${escapeTsString(propRaw)}' as any, ${valueExpr})`)
      return lines
    }
    const propExpr = templateToExpr(propRaw, inRepeat, hasPayload, ctx)
    lines.push(`  emit(('update:' + String(${propExpr})) as any, ${valueExpr})`)
    return lines
  }

  lines.push(`  console.warn('unknown method: ${escapeTsString(method)}')`)
  return lines
}

function registerEventMethod(
  ctx: CodegenContext,
  nameHint: string,
  raw: string,
  options: {
    inRepeat: boolean
    hasPayload: boolean
    isScroll?: boolean
    /** 从 payload 展开的具名形参（如触摸 clientX） */
    payloadLocals?: string[]
  },
): string {
  ctx.methodSeq += 1
  const safeHint = nameHint.replace(/[^A-Za-z0-9_]/g, '') || 'event'
  const name = `on${safeHint[0]!.toUpperCase()}${safeHint.slice(1)}${ctx.methodSeq}`
  const bindings = parseBindings(raw)
  const statements = bindings.flatMap((b) =>
    emitBindingStatements(b, options.inRepeat, options.hasPayload, ctx, {
      isScroll: options.isScroll,
    }),
  )

  const locals = (options.payloadLocals ?? []).filter((item) => /^[A-Za-z_]\w*$/.test(item))
  const localPrelude = locals.length
    ? locals.map((key) => `  const ${key} = payload?.${key}`).join('\n')
    : ''

  let params = ''
  if (options.isScroll) {
    params = options.inRepeat
      ? 'item: Record<string, any>, index: number, e: Event'
      : 'e: Event'
  } else if (options.inRepeat && options.hasPayload) {
    params = 'item: Record<string, any>, index: number, payload?: Record<string, any>'
  } else if (options.inRepeat) {
    params = 'item: Record<string, any>, index: number'
  } else if (options.hasPayload) {
    params = 'payload?: Record<string, any>'
  }

  const bodyParts = [
    localPrelude,
    statements.length ? statements.join('\n') : '  // empty binding',
  ].filter(Boolean)

  ctx.methods.push({
    name,
    params,
    body: bodyParts.join('\n'),
  })
  return name
}

function eventHandler(
  eventKey: string,
  raw: string | undefined,
  inRepeat: boolean,
  ctx: CodegenContext,
): string {
  if (!raw?.trim()) return ''
  const isScroll =
    eventKey === 'onScroll' ||
    eventKey === 'onScrollToLower' ||
    eventKey === 'onScrollToUpper'
  const isTouch =
    eventKey === 'onTouchStart' ||
    eventKey === 'onTouchMove' ||
    eventKey === 'onTouchEnd'
  const bindings = parseBindings(raw)

  if (isTouch) {
    const domEvent = vueEventName(eventKey)
    const methodName = registerEventMethod(ctx, domEvent, raw, {
      inRepeat,
      hasPayload: true,
      isScroll: false,
      /** 触摸形参展开为具名变量，与编辑器自定义方法签名一致 */
      payloadLocals: ['clientX', 'clientY', 'pageX', 'pageY'],
    })
    // touchend 时 touches 可能为空，优先 changedTouches
    const touchExpr =
      eventKey === 'onTouchEnd'
        ? '(e.changedTouches?.[0] ?? e.touches?.[0])'
        : '(e.touches?.[0] ?? e.changedTouches?.[0])'
    const payloadExpr = `{ clientX: ${touchExpr}?.clientX ?? 0, clientY: ${touchExpr}?.clientY ?? 0, pageX: ${touchExpr}?.pageX ?? 0, pageY: ${touchExpr}?.pageY ?? 0 }`
    if (inRepeat) {
      return `@${domEvent}="(e) => ${methodName}(item, index, ${payloadExpr})"`
    }
    return `@${domEvent}="(e) => ${methodName}(${payloadExpr})"`
  }

  const inline = tryInlineEventHandler(
    bindings,
    { inRepeat, hasPayload: false, isScroll },
    ctx,
  )
  if (inline) {
    return `@${vueEventName(eventKey)}="${escapeVueExprAttr(inline)}"`
  }

  const methodName = registerEventMethod(
    ctx,
    vueEventName(eventKey).replace(/\./g, '_'),
    raw,
    { inRepeat, hasPayload: false, isScroll },
  )
  if (isScroll) {
    if (inRepeat) {
      return `@${vueEventName(eventKey)}="(e) => ${methodName}(item, index, e)"`
    }
    return `@${vueEventName(eventKey)}="${methodName}"`
  }
  if (inRepeat) {
    return `@${vueEventName(eventKey)}="() => ${methodName}(item, index)"`
  }
  return `@${vueEventName(eventKey)}="${methodName}"`
}

/** 合并 onScroll / 触底 / 触顶，避免多个 @scroll 冲突 */
function mergedScrollEventHandler(
  attrs: Record<string, string>,
  inRepeat: boolean,
  ctx: CodegenContext,
): string {
  const hasScroll = Boolean(attrs.onScroll?.trim())
  const hasLower = Boolean(attrs.onScrollToLower?.trim())
  const hasUpper = Boolean(attrs.onScrollToUpper?.trim())
  if (!hasScroll && !hasLower && !hasUpper) return ''

  if (hasScroll && !hasLower && !hasUpper) {
    return eventHandler('onScroll', attrs.onScroll, inRepeat, ctx)
  }

  const scrollName = hasScroll
    ? registerEventMethod(ctx, 'scroll', attrs.onScroll!, {
        inRepeat,
        hasPayload: false,
        isScroll: true,
      })
    : null
  const lowerName = hasLower
    ? registerEventMethod(ctx, 'scrollToLower', attrs.onScrollToLower!, {
        inRepeat,
        hasPayload: false,
        isScroll: true,
      })
    : null
  const upperName = hasUpper
    ? registerEventMethod(ctx, 'scrollToUpper', attrs.onScrollToUpper!, {
        inRepeat,
        hasPayload: false,
        isScroll: true,
      })
    : null

  ctx.methodSeq += 1
  const edgeVar = `_scrollEdge${ctx.methodSeq}`
  const dispatchName = `onScrollDispatch${ctx.methodSeq}`
  ctx.extraScript.push(`const ${edgeVar} = { atLower: false, atUpper: true }`)

  const lines: string[] = [
    '  const el = e.currentTarget as HTMLElement | null',
    '  if (!el) return',
  ]
  if (scrollName) {
    lines.push(inRepeat ? `  ${scrollName}(item, index, e)` : `  ${scrollName}(e)`)
  }
  if (hasLower || hasUpper) {
    lines.push('  const threshold = 50')
    lines.push('  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)')
    lines.push('  const nowLower = maxScroll > 0 && el.scrollTop >= maxScroll - threshold')
    lines.push('  const nowUpper = el.scrollTop <= threshold')
  }
  if (lowerName) {
    lines.push(`  if (nowLower && !${edgeVar}.atLower) {`)
    lines.push(inRepeat ? `    ${lowerName}(item, index, e)` : `    ${lowerName}(e)`)
    lines.push('  }')
    lines.push(`  ${edgeVar}.atLower = nowLower`)
  }
  if (upperName) {
    lines.push(`  if (nowUpper && !${edgeVar}.atUpper) {`)
    lines.push(inRepeat ? `    ${upperName}(item, index, e)` : `    ${upperName}(e)`)
    lines.push('  }')
    lines.push(`  ${edgeVar}.atUpper = nowUpper`)
  }

  const params = inRepeat
    ? 'item: Record<string, any>, index: number, e: Event'
    : 'e: Event'

  ctx.methods.push({
    name: dispatchName,
    params,
    body: lines.join('\n'),
  })

  if (inRepeat) {
    return `@scroll="(e) => ${dispatchName}(item, index, e)"`
  }
  return `@scroll="${dispatchName}"`
}

function collectInteractionEventAttrs(
  attrs: Record<string, string>,
  inRepeat: boolean,
  ctx: CodegenContext,
): string[] {
  const out: string[] = []
  for (const key of NON_SCROLL_INTERACTION_ATTRS) {
    const h = eventHandler(key, attrs[key], inRepeat, ctx)
    if (h) out.push(h)
  }
  const scroll = mergedScrollEventHandler(attrs, inRepeat, ctx)
  if (scroll) out.push(scroll)
  return out
}

function componentEventHandler(
  eventName: string,
  raw: string | undefined,
  inRepeat: boolean,
  ctx: CodegenContext,
): string {
  if (!raw?.trim()) return ''
  const bindings = parseBindings(raw)
  const inline = tryInlineEventHandler(
    bindings,
    { inRepeat, hasPayload: true },
    ctx,
  )
  if (inline) {
    return `@${eventName}="${escapeVueExprAttr(inline)}"`
  }

  const methodName = registerEventMethod(ctx, eventName, raw, {
    inRepeat,
    hasPayload: true,
  })
  if (inRepeat) {
    return `@${eventName}="(payload) => ${methodName}(item, index, payload)"`
  }
  return `@${eventName}="${methodName}"`
}

function renderGeneratedMethods(methods: GeneratedMethod[]): string {
  if (!methods.length) return ''
  return (
    '\n' +
    methods
      .map((m) => `function ${m.name}(${m.params}) {\n${m.body}\n}\n`)
      .join('\n')
  )
}

function renderExtraScript(lines: string[]): string {
  if (!lines.length) return ''
  return '\n' + lines.join('\n') + '\n'
}

function renderChildren(
  children: XmlNode[],
  ctx: CodegenContext,
  parentTag: string,
  inRepeat: boolean,
  scopeVar: string,
  depth: number,
  parentPath: string,
  inScrollColumn: boolean,
  parentOrientation?: string,
): string {
  return children
    .map((child, index) => {
      if (child.tag === '#text' && !child.text?.trim()) return ''
      const childPath = `${parentPath}/${index}:${child.tag}`
      return renderNode(
        child,
        ctx,
        parentTag,
        inRepeat,
        scopeVar,
        depth,
        childPath,
        inScrollColumn,
        parentOrientation,
      )
    })
    .filter(Boolean)
    .join('\n')
}

function parseSlotParams(
  raw: string | undefined,
): Array<{ name: string; type: string; typeRef?: string }> {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const rows: Array<{ name: string; type: string; typeRef?: string }> = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      if (!name) continue
      const type = typeof row.type === 'string' ? row.type : 'any'
      const typeRef =
        typeof row.typeRef === 'string' && row.typeRef.trim()
          ? row.typeRef.trim()
          : undefined
      rows.push(typeRef ? { name, type, typeRef } : { name, type })
    }
    return rows
  } catch {
    return []
  }
}

function findSlotNode(root: XmlNode | undefined, slotName: string): XmlNode | null {
  if (!root) return null
  if (root.tag === 'Slot') {
    const name = root.attrs.name?.trim() || 'default'
    if (name === slotName) return root
  }
  for (const child of root.children) {
    const found = findSlotNode(child, slotName)
    if (found) return found
  }
  return null
}

function stripSlotAttr(node: XmlNode): XmlNode {
  if (!node.attrs.slot) return node
  const { slot: _slot, ...rest } = node.attrs
  return { ...node, attrs: rest }
}

function groupChildrenBySlot(children: XmlNode[]): Map<string, XmlNode[]> {
  const map = new Map<string, XmlNode[]>()
  for (const child of children) {
    if (child.tag === '#text' && !child.text?.trim()) continue
    const name = child.attrs.slot?.trim() || 'default'
    const list = map.get(name) ?? []
    list.push(stripSlotAttr(child))
    map.set(name, list)
  }
  return map
}

function renderNode(
  node: XmlNode,
  ctx: CodegenContext,
  parentTag: string,
  inRepeat: boolean,
  scopeVar: string,
  depth: number,
  nodePath: string,
  inScrollColumn = false,
  parentOrientation?: string,
): string {
  const pad = '  '.repeat(depth)
  const attrs = node.attrs
  const tag = node.tag
  const twOpts = { inScrollColumn, parentOrientation }

  if (tag === 'Fragment') {
    return renderChildren(
      node.children,
      ctx,
      tag,
      inRepeat,
      scopeVar,
      depth,
      nodePath,
      inScrollColumn,
      parentOrientation,
    )
  }

  if (tag === '#text') {
    return `${pad}${node.text}`
  }

  if (attrs.repeat?.trim()) {
    const field = attrs.repeat.trim()
    const innerCtx = { ...attrs }
    delete innerCtx.repeat
    const innerNode: XmlNode = { ...node, attrs: innerCtx }
    const inner = renderNode(
      innerNode,
      ctx,
      parentTag,
      true,
      '{ item, index }',
      depth + 1,
      nodePath,
      inScrollColumn,
      parentOrientation,
    )
    return `${pad}<template v-for="(item, index) in ${
      repeatListExpr(field, ctx)
    }" :key="index">
${inner}
${pad}</template>`
  }

  const isScrollContainer = parseOverflowStrategy(attrs.overflow) === 'scroll'
  const childScrollColumn =
    inScrollColumn ||
    (isScrollContainer && attrs.orientation !== 'horizontal')

  if (tag === 'Slot') {
    const slotName = attrs.name?.trim() || 'default'
    const params = parseSlotParams(attrs.params)
    const scopedBinds = params.map((p) => `:${p.name}="${p.name}"`)
    return formatVueElement({
      pad,
      tag: 'slot',
      attrs: [
        slotName === 'default' ? '' : `name="${escapeHtmlAttr(slotName)}"`,
        ...scopedBinds,
      ],
      selfClosing: true,
    })
  }

  if (tag === 'Component') {
    const componentId = attrs.componentId?.trim()
    if (!componentId) return `${pad}<!-- Component missing componentId -->`
    const compName = componentIdToVarName(componentId)
    ctx.componentImports.set(componentId, compName)
    const config = ctx.componentConfigs.get(componentId)
    const propAttrs: string[] = []
    for (const [key, value] of Object.entries(attrs)) {
      if (INTERACTION_ATTRS.has(key)) continue
      if (key === 'componentId' || key === 'name') continue
      if (config?.events.some((e) => e.name === key)) continue
      const isLayout = LAYOUT_ATTRS.has(key)
      const propDef = config?.props.find((p) => p.name === key)
      const isDeclaredProp = Boolean(propDef)
      if (isLayout && !isDeclaredProp) continue
      // 可更新入参 + `{field}` → v-model:prop（父级可监听更新）
      if (
        propDef?.twoWay &&
        propDef.type !== 'api' &&
        /^\{\s*[A-Za-z_$][\w$]*\s*\}$/.test(value.trim())
      ) {
        const field = value.trim().slice(1, -1).trim()
        const expr =
          ctx.kind === 'page' || ctx.dataFieldNames.includes(field)
            ? field
            : `store.${field}`
        propAttrs.push(`v-model:${key}="${expr}"`)
        continue
      }
      propAttrs.push(attrBinding(key, value, ctx, inRepeat))
    }
    const eventAttrs: string[] = []
    for (const evt of config?.events ?? []) {
      const raw = attrs[evt.name]
      if (raw?.trim()) {
        eventAttrs.push(componentEventHandler(evt.name, raw, inRepeat, ctx))
      }
    }
    eventAttrs.push(...collectInteractionEventAttrs(attrs, inRepeat, ctx))
    const componentRoot = ctx.componentRoots.get(componentId)
    const outOfFlow = Boolean(componentRoot && isOutOfFlowTree(componentRoot))
    const tw = outOfFlow
      ? 'absolute top-0 left-0 w-0 h-0 m-0 overflow-visible pointer-events-none'
      : twWithRelative(attrs, parentTag, undefined, twOpts)
    const refName = ctx.refPathMap.get(nodePath)
    const slotGroups = groupChildrenBySlot(node.children)
    const slotInnerPad = depth + 1
    const slotTemplates: string[] = []
    for (const [slotName, kids] of slotGroups) {
      const inner = renderChildren(
        kids,
        ctx,
        compName,
        inRepeat,
        scopeVar,
        slotInnerPad + 1,
        nodePath,
        childScrollColumn,
        parentOrientation,
      )
      const hashName = slotName === 'default' ? 'default' : slotName
      const slotDef = findSlotNode(componentRoot, slotName)
      const slotParams = parseSlotParams(slotDef?.attrs.params)
        .map((p) => p.name)
        .filter(Boolean)
      const slotBind = slotParams.length
        ? `#${hashName}="{ ${slotParams.join(', ')} }"`
        : `#${hashName}`
      slotTemplates.push(
        formatVueElement({
          pad: '  '.repeat(slotInnerPad),
          tag: 'template',
          attrs: [slotBind],
          inner,
        }),
      )
    }
    return formatVueElement({
      pad,
      tag: compName,
      attrs: [
        refName ? `ref="${refName}"` : '',
        classAttr(tw),
        ...visibilityAttrs(attrs, ctx, inRepeat),
        ...propAttrs,
        ...eventAttrs,
      ],
      selfClosing: slotTemplates.length === 0,
      inner: slotTemplates.length ? slotTemplates.join('\n') : undefined,
    })
  }

  if (tag === 'Modal') {
    const modalName = attrs.name?.trim() || `modal_${depth}`
    ctx.modalNames.add(modalName)
    const surfaceAttrs: Record<string, string> = {
      padding: attrs.padding ?? '',
      paddingLeft: attrs.paddingLeft ?? '',
      paddingRight: attrs.paddingRight ?? '',
      paddingTop: attrs.paddingTop ?? '',
      paddingBottom: attrs.paddingBottom ?? '',
      background: attrs.background?.trim() || 'rgba(0,0,0,0.45)',
      borderRadius: attrs.borderRadius ?? '',
      borderTopLeftRadius: attrs.borderTopLeftRadius ?? '',
      borderTopRightRadius: attrs.borderTopRightRadius ?? '',
      borderBottomRightRadius: attrs.borderBottomRightRadius ?? '',
      borderBottomLeftRadius: attrs.borderBottomLeftRadius ?? '',
      borderWidth: attrs.borderWidth ?? '',
      borderColor: attrs.borderColor ?? '',
    }
    const surfaceTw = buildTwClasses(surfaceAttrs, {
      extra: ['absolute', 'inset-0', 'z-50', 'box-border'],
    })
    const panel = renderChildren(
      node.children,
      ctx,
      'RelativeLayout',
      inRepeat,
      scopeVar,
      depth + 2,
      nodePath,
      false,
    )
    const closeOnClick = parseCloseOnClick(attrs.closeOnClick)
    const closeHandler = closeOnClick
      ? `@click.self="modalVisible['${escapeTsString(modalName)}'] = false"`
      : ''
    const overlay = formatVueElement({
      pad: `${pad}  `,
      tag: 'div',
      attrs: [
        `v-if="modalVisible['${escapeTsString(modalName)}']"`,
        classAttr(surfaceTw),
        closeHandler,
      ],
      inner: formatVueElement({
        pad: `${pad}    `,
        tag: 'div',
        attrs: [
          'class="relative w-full h-full min-h-0 overflow-hidden"',
          closeHandler,
        ],
        inner: panel,
      }),
    })
    // 挂到 .app-page，随设计稿缩放；勿 Teleport 到 body（会逃出 scale）
    return `${pad}<Teleport to=".app-page">\n${overlay}\n${pad}</Teleport>`
  }

  if (tag === 'Swiper') {
    ctx.needsAppSwiper = true
    const slideNodes = node.children.filter((c) => c.tag !== '#text')
    const slideCount = slideNodes.length
    const indicator =
      attrs.indicatorDots == null ||
      attrs.indicatorDots === '' ||
      parseBool(attrs.indicatorDots)
    const autoplay = parseBool(attrs.autoplay)
    const circular = attrs.circular == null || attrs.circular === '' || parseBool(attrs.circular)
    const interval = parseNumber(attrs.interval) ?? 3000
    const duration = parseNumber(attrs.duration) ?? 280
    const current = parseNumber(attrs.current) ?? 0
    const indicatorColor = (attrs.indicatorColor || '').trim() || 'rgba(0,0,0,0.25)'
    const indicatorActiveColor = (attrs.indicatorActiveColor || '').trim() || '#409eff'
    // 外层承载布局尺寸/绝对定位（与编辑器 WidgetSelectShell 一致），
    // 避免 AppSwiper 内部 position/height:100% 盖掉 absolute / 固定宽高
    const shellTw = twWithRelative(attrs, parentTag, ['overflow-hidden'], twOpts)
    const slides = slideNodes
      .map((child, i) => {
        const childIndex = node.children.indexOf(child)
        const childPath = `${nodePath}/${childIndex}:${child.tag}`
        const slide = renderNode(
          child,
          ctx,
          'Swiper',
          inRepeat,
          scopeVar,
          depth + 3,
          childPath,
          inScrollColumn,
        )
        return formatVueElement({
          pad: `${pad}    `,
          tag: 'div',
          attrs: ['class="app-swiper-slide"', `:key="${i}"`],
          inner: slide,
        })
      })
      .filter(Boolean)
      .join('\n')
    const swiper = formatVueElement({
      pad: `${pad}  `,
      tag: 'AppSwiper',
      attrs: [
        'class="w-full h-full min-h-0"',
        `:slide-count="${slideCount}"`,
        `:indicator="${indicator}"`,
        `indicator-color="${escapeHtmlAttr(indicatorColor)}"`,
        `indicator-active-color="${escapeHtmlAttr(indicatorActiveColor)}"`,
        `:autoplay="${autoplay}"`,
        `:circular="${circular}"`,
        `:interval="${interval}"`,
        `:duration="${duration}"`,
        `:current="${current}"`,
      ],
      inner: slides,
    })
    return formatVueElement({
      pad,
      tag: 'div',
      attrs: [classAttr(shellTw), ...visibilityAttrs(attrs, ctx, inRepeat)],
      inner: swiper,
    })
  }

  if (tag === 'MultiWindow') {
    const activeRaw = (attrs.active || '').trim()
    const activeExpr = activeRaw
      ? `String(${bindingToExpr(activeRaw, ctx, inRepeat)} ?? '')`
      : `''`
    const overflowHidden = parseOverflowStrategy(attrs.overflow) === 'hidden'
    const shellTw = twWithRelative(
      attrs,
      parentTag,
      [
        overflowHidden ? 'overflow-hidden' : 'overflow-visible',
        'relative',
        'min-h-0',
      ],
      twOpts,
    )
    const panes = node.children
      .filter((c) => c.tag !== '#text')
      .map((child, paneIndex) => {
        const childIndex = node.children.indexOf(child)
        const childPath = `${nodePath}/${childIndex}:${child.tag}`
        const windowKey = (child.attrs.windowKey || '').trim()
        // active 计算字段首帧可能为空：先显示第一窗，避免白屏
        const showAttr = windowKey
          ? paneIndex === 0
            ? `v-show="${activeExpr} === '${escapeTsString(windowKey)}' || !${activeExpr}"`
            : `v-show="${activeExpr} === '${escapeTsString(windowKey)}'"`
          : 'v-show="false"'
        const pane = renderNode(
          child,
          ctx,
          'MultiWindow',
          inRepeat,
          scopeVar,
          depth + 2,
          childPath,
          inScrollColumn,
        )
        return formatVueElement({
          pad: `${pad}  `,
          tag: 'div',
          attrs: [
            // 与 RelativeLayout 一致：窗内容可溢出，不强制裁切
            'class="absolute inset-0 flex flex-col min-w-0 min-h-0 overflow-visible"',
            showAttr,
            `:key="'${childIndex}:${escapeTsString(windowKey)}'"`,
          ],
          inner: pane,
        })
      })
      .filter(Boolean)
      .join('\n')
    return formatVueElement({
      pad,
      tag: 'div',
      attrs: [classAttr(shellTw), ...visibilityAttrs(attrs, ctx, inRepeat)],
      inner: panes,
    })
  }

  if (tag === 'Text') {
    const textRaw = attrs.text ?? ''
    const textContent = isStaticBinding(textRaw)
      ? escapeHtmlText(textRaw)
      : `{{ ${bindingToExpr(textRaw, ctx, inRepeat)} }}`
    const textExtra: string[] = []
    const ts = parseNumber(attrs.textSize)
    if (ts != null) textExtra.push(`text-[${ts}px]`)
    const colorRes = resolveColorExpr('textColor', attrs.textColor, attrs, ctx, inRepeat, '#303133')
    if (colorRes.static) {
      const tc = colorClass('text', colorRes.static)
      if (tc) textExtra.push(tc)
    }
    const tw = twWithRelative(attrs, parentTag, textExtra, twOpts)
    const events = collectInteractionEventAttrs(attrs, inRepeat, ctx)
    const styleParts: string[] = []
    if (!colorRes.static) styleParts.push(`color: ${colorRes.expr}`)
    styleParts.push(...rotateStyleEntries(attrs, ctx, inRepeat))
    const style = styleAttr(styleParts)
    return formatVueElement({
      pad,
      tag: 'span',
      attrs: [classAttr(tw), style, ...visibilityAttrs(attrs, ctx, inRepeat), ...events],
      inner: textContent,
    })
  }

  if (tag === 'Button') {
    const textRaw = attrs.text ?? 'Button'
    const textContent = isStaticBinding(textRaw)
      ? escapeHtmlText(textRaw)
      : `{{ ${bindingToExpr(textRaw, ctx, inRepeat)} }}`
    const extra: string[] = [
      'inline-flex',
      'items-center',
      'justify-center',
      'border-none',
      'cursor-pointer',
      'rounded-[4px]',
    ]
    const bgRaw = attrs.background && attrs.background !== 'null' ? attrs.background : '#409eff'
    const colorRes = resolveColorExpr(
      'textColor',
      attrs.textColor && attrs.textColor !== 'null' ? attrs.textColor : '#ffffff',
      attrs,
      ctx,
      inRepeat,
      '#ffffff',
    )
    if (!bgRaw.includes('{')) {
      const bg = colorClass('bg', bgRaw)
      if (bg) extra.push(bg)
    }
    if (colorRes.static) {
      const tc = colorClass('text', colorRes.static)
      if (tc) extra.push(tc)
    }
    const ts = parseNumber(attrs.textSize)
    if (ts != null) extra.push(`text-[${ts}px]`)
    else extra.push('text-[14px]')
    const tw = twWithRelative(attrs, parentTag, extra, twOpts)
    const events = collectInteractionEventAttrs(attrs, inRepeat, ctx)
    const styleParts: string[] = []
    if (bgRaw.includes('{')) {
      styleParts.push(`backgroundColor: String(${bindingToExpr(bgRaw, ctx, inRepeat)} ?? '')`)
    }
    if (!colorRes.static) styleParts.push(`color: ${colorRes.expr}`)
    const style = styleAttr(styleParts)
    return formatVueElement({
      pad,
      tag: 'button',
      attrs: [
        'type="button"',
        classAttr(tw),
        style,
        ...visibilityAttrs(attrs, ctx, inRepeat),
        ...events,
      ],
      inner: textContent,
    })
  }

  if (tag === 'Input') {
    const valueRaw = attrs.value ?? ''
    const placeholderRaw = attrs.placeholder ?? ''
    const extra: string[] = [
      'box-border',
      'w-full',
      'outline-none',
      'border-solid',
    ]
    const bgRaw =
      attrs.background && attrs.background !== 'null' ? attrs.background : '#ffffff'
    const colorRes = resolveColorExpr(
      'textColor',
      attrs.textColor && attrs.textColor !== 'null' ? attrs.textColor : '#303133',
      attrs,
      ctx,
      inRepeat,
      '#303133',
    )
    if (!bgRaw.includes('{')) {
      const bg = colorClass('bg', bgRaw)
      if (bg) extra.push(bg)
    }
    if (colorRes.static) {
      const tc = colorClass('text', colorRes.static)
      if (tc) extra.push(tc)
    }
    const borderColor =
      attrs.borderColor && attrs.borderColor !== 'null'
        ? attrs.borderColor
        : '#dcdfe6'
    if (!borderColor.includes('{')) {
      const bc = colorClass('border', borderColor)
      if (bc) extra.push(bc)
    }
    const bw = parseNumber(attrs.borderWidth) ?? 1
    extra.push(`border-[${bw}px]`)
    const br = parseNumber(attrs.borderRadius) ?? 4
    extra.push(`rounded-[${br}px]`)
    const ts = parseNumber(attrs.textSize)
    if (ts != null) extra.push(`text-[${ts}px]`)
    else extra.push('text-[14px]')
    const tw = twWithRelative(attrs, parentTag, extra, twOpts)
    const events = collectInteractionEventAttrs(attrs, inRepeat, ctx)
    const styleParts: string[] = []
    if (bgRaw.includes('{')) {
      styleParts.push(`backgroundColor: String(${bindingToExpr(bgRaw, ctx, inRepeat)} ?? '')`)
    }
    if (!colorRes.static) styleParts.push(`color: ${colorRes.expr}`)
    if (borderColor.includes('{')) {
      styleParts.push(
        `borderColor: String(${bindingToExpr(borderColor, ctx, inRepeat)} ?? '')`,
      )
    }
    const style = styleAttr(styleParts)
    const valueAttr = attrBinding('value', valueRaw, ctx, inRepeat)
    const placeholderAttr = placeholderRaw
      ? attrBinding('placeholder', placeholderRaw, ctx, inRepeat)
      : ''
    return formatVueElement({
      pad,
      tag: 'input',
      attrs: [
        'type="text"',
        valueAttr,
        placeholderAttr,
        classAttr(tw),
        style,
        ...visibilityAttrs(attrs, ctx, inRepeat),
        ...events,
      ].filter(Boolean),
      selfClosing: true,
    })
  }

  if (tag === 'Image') {
    const srcRaw = attrs.src ?? ''
    const srcTrimmed = srcRaw.trim()
    const events = collectInteractionEventAttrs(attrs, inRepeat, ctx)
    const extra: string[] = []
    if (attrs.objectFit && attrs.objectFit !== 'null') {
      const fit = attrs.objectFit.trim()
      if (fit === 'cover') extra.push('object-cover')
      else if (fit === 'contain') extra.push('object-contain')
      else if (fit === 'fill') extra.push('object-fill')
      else if (fit === 'none') extra.push('object-none')
      else extra.push(`object-[${fit}]`)
    }
    if (attrs.onClick?.trim()) extra.push('cursor-pointer')
    const tw = twWithRelative(attrs, parentTag, extra, twOpts)
    const altText = (attrs.alt || '图片').trim() || '图片'
    const phTw = twWithRelative(
      attrs,
      parentTag,
      [
        'flex',
        'items-center',
        'justify-center',
        'text-xs',
        'text-[#909399]',
        attrs.background?.trim() ? '' : 'bg-[#f2f3f5]',
      ].filter(Boolean),
      twOpts,
    )
    const rotateStyle = styleAttr(rotateStyleEntries(attrs, ctx, inRepeat))
    // 空 src：与编辑器一致用占位，避免浏览器破碎图
    if (!srcTrimmed) {
      return formatVueElement({
        pad,
        tag: 'div',
        attrs: [
          classAttr(phTw),
          rotateStyle,
          ...visibilityAttrs(attrs, ctx, inRepeat),
          ...events,
        ],
        inner: `${pad}  ${escapeHtmlText(altText)}`,
      })
    }
    const srcAttr = attrBinding('src', srcRaw, ctx, inRepeat)
    const alt = `alt="${escapeHtmlAttr(altText)}"`
    const img = formatVueElement({
      pad: isStaticBinding(srcTrimmed) ? pad : `${pad}  `,
      tag: 'img',
      attrs: [
        srcAttr,
        alt,
        classAttr(tw),
        rotateStyle,
        ...visibilityAttrs(attrs, ctx, inRepeat),
        ...events,
      ],
      selfClosing: true,
    })
    if (isStaticBinding(srcTrimmed)) return img
    // 动态 src 为空时走占位
    const srcExpr = bindingToExpr(srcTrimmed, ctx, inRepeat)
    const phNested = formatVueElement({
      pad: `${pad}  `,
      tag: 'div',
      attrs: [
        classAttr(phTw),
        rotateStyle,
        ...visibilityAttrs(attrs, ctx, inRepeat),
        ...events,
      ],
      inner: `${pad}    ${escapeHtmlText(altText)}`,
    })
    return `${pad}<template v-if="!(${srcExpr})">\n${phNested}\n${pad}</template>\n${pad}<template v-else>\n${img}\n${pad}</template>`
  }

  if (tag === 'Icon') {
    ctx.needsAppIcon = true
    const iconRaw = attrs.iconId ?? 'help'
    const size = parseNumber(attrs.size) ?? 16
    const colorRes = resolveColorExpr('color', attrs.color, attrs, ctx, inRepeat, '#333')
    const events = collectInteractionEventAttrs(attrs, inRepeat, ctx)
    const hasRadius =
      Boolean(attrs.borderRadius?.trim()) ||
      Boolean(attrs.borderTopLeftRadius?.trim()) ||
      Boolean(attrs.borderTopRightRadius?.trim()) ||
      Boolean(attrs.borderBottomRightRadius?.trim()) ||
      Boolean(attrs.borderBottomLeftRadius?.trim())
    const tw = twWithRelative(
      attrs,
      parentTag,
      [
        'inline-flex',
        'items-center',
        'justify-center',
        'shrink-0',
        hasRadius ? 'overflow-hidden' : '',
      ].filter(Boolean),
      twOpts,
    )
    const nameAttr = isStaticBinding(iconRaw)
      ? `name="${escapeHtmlAttr(iconRaw.trim() || 'help')}"`
      : `:name="String(${bindingToExpr(iconRaw, ctx, inRepeat)} ?? '')"`
    const colorAttr = colorRes.static
      ? `color="${escapeHtmlAttr(colorRes.static)}"`
      : `:color="${colorRes.expr}"`
    const shadow = attrs.contentShadow?.trim()
    const styleEntries = [
      ...rotateStyleEntries(attrs, ctx, inRepeat),
      shadow && shadow !== 'null'
        ? `boxShadow: ${JSON.stringify(shadow)}`
        : '',
    ]
    return formatVueElement({
      pad,
      tag: 'AppIcon',
      attrs: [
        nameAttr,
        `:size="${size}"`,
        colorAttr,
        classAttr(tw),
        styleAttr(styleEntries),
        ...visibilityAttrs(attrs, ctx, inRepeat),
        ...events,
      ],
      selfClosing: true,
    })
  }

  const isRelative = tag === 'RelativeLayout'
  const htmlTag = 'div'
  const isRelativeChild = parentTag === 'RelativeLayout'
  const layoutExtra = [
    isRelative ? 'relative' : '',
    flexClasses(tag, attrs),
  ].filter(Boolean)

  const bgRaw = attrs.background && attrs.background !== 'null' ? attrs.background : ''
  const bgDynamic =
    bgRaw.includes('{') ||
    parseDynamicStylesStates(attrs.dynamicStyles).some((s) => s.styles.background)
  const layoutAttrs = bgDynamic
    ? Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'background'))
    : attrs
  const bgRes = bgDynamic
    ? resolveColorExpr('background', attrs.background, attrs, ctx, inRepeat, 'transparent')
    : null

  const tw = buildTwClasses(layoutAttrs, {
    isRelativeChild,
    extra: layoutExtra,
    inScrollColumn,
    parentTag,
    parentOrientation,
  })
  const events = collectInteractionEventAttrs(attrs, inRepeat, ctx)

  const childPad = depth + 1
  const childrenHtml = renderChildren(
    node.children,
    ctx,
    tag,
    inRepeat,
    scopeVar,
    isRelative ? childPad + 1 : childPad,
    nodePath,
    childScrollColumn,
    attrs.orientation,
  )

  const bgStyle =
    bgRes && !bgRes.static ? `backgroundColor: ${bgRes.expr}` : ''
  const layoutStyle = styleAttr([
    bgStyle,
    ...dynamicPxStyleEntries(attrs, ctx, inRepeat),
  ])

  // Absolute kids ignore parent padding; nest a relative content box (same as editor).
  const inner = isRelative
    ? formatVueElement({
        pad: '  '.repeat(childPad),
        tag: 'div',
        attrs: [classAttr('relative w-full h-full min-h-0 min-w-0')],
        inner: childrenHtml,
      })
    : childrenHtml

  return formatVueElement({
    pad,
    tag: htmlTag,
    attrs: [classAttr(tw), layoutStyle, ...visibilityAttrs(attrs, ctx, inRepeat), ...events],
    inner,
  })
}

export function generateViewSfc(options: {
  pageId: string
  xml: string
  data: PageData
  componentConfigs: Map<string, ComponentConfig>
  componentRoots?: Map<string, XmlNode>
  pageRefFields: PageRefField[]
  rootNodes: XmlNode[]
  resolveApi?: (raw: string) => VueApiBinding | null
  colorPalette?: ColorPalette
}): string {
  return withColorPalette(options.colorPalette, () =>
    generateViewSfcInner(options),
  )
}

function generateViewSfcInner(options: {
  pageId: string
  xml: string
  data: PageData
  componentConfigs: Map<string, ComponentConfig>
  componentRoots?: Map<string, XmlNode>
  pageRefFields: PageRefField[]
  rootNodes: XmlNode[]
  resolveApi?: (raw: string) => VueApiBinding | null
}): string {
  const storeName = pageIdToStoreName(options.pageId)
  const pageData = generatePageDataSource(options.data.fields)
  const controllerMounted = generateControllerBoundPageMounted({
    fields: options.data.fields,
    resolveApi: options.resolveApi ?? (() => null),
  })
  const refPathMap = new Map(
    options.pageRefFields
      .filter((f) => f.kind === 'component')
      .map((f) => [f.nodePath, f.name]),
  )
  const ctx: CodegenContext = {
    kind: 'page',
    id: options.pageId,
    storeName,
    dataFieldNames: pageData.fieldNames,
    componentImports: new Map(),
    componentConfigs: options.componentConfigs,
    componentRoots: options.componentRoots ?? new Map(),
    modalNames: new Set(),
    refPathMap,
    refFields: options.pageRefFields,
    methods: [],
    methodSeq: 0,
    extraScript: [],
    indent: 0,
    needsAppIcon: false,
    needsAppSwiper: false,
  }

  for (const field of options.pageRefFields) {
    if (field.kind === 'modal' && field.modalName) {
      ctx.modalNames.add(field.modalName)
    }
  }

  const root = options.rootNodes[0]
  const rootPath = root ? `0:${root.tag}` : ''
  const templateBody = root
    ? renderNode(root, ctx, '', false, 'undefined', 2, rootPath)
    : '    <div>Empty page</div>'

  const imports = [
    ...[...ctx.componentImports.entries()].map(
      ([id, name]) => `import ${name} from '../components/${componentIdToFileName(id)}.vue'`,
    ),
    ctx.needsAppIcon ? `import AppIcon from '../components/AppIcon.vue'` : '',
    ctx.needsAppSwiper ? `import AppSwiper from '../components/AppSwiper.vue'` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const modalInit = [...ctx.modalNames]
    .map((n) => `  '${escapeTsString(n)}': false,`)
    .join('\n')

  const methodsSource = `${renderExtraScript(ctx.extraScript)}${renderGeneratedMethods(ctx.methods)}`
  const scriptAndTemplate = `${methodsSource}\n${templateBody}\n${pageData.source}\n${controllerMounted.source}`
  const needsInterpolate = scriptAndTemplate.includes('interpolate(')
  const needsEvalVShow = templateBody.includes('evalVShow(')
  const needsEvalVIf = templateBody.includes('evalVIf(')
  const needsAppRuntime = needsEvalVShow || needsEvalVIf || needsInterpolate
  const needsNavigateTo = /\bnavigateTo\s*\(/.test(scriptAndTemplate)
  const needsNavigateBack = /\bnavigateBack\s*\(/.test(scriptAndTemplate)
  const needsShowToast = /\bshowToast\s*\(/.test(scriptAndTemplate)
  const needsGetDeviceInfo = /\bgetDeviceInfo\s*\(/.test(scriptAndTemplate)
  const needsNavigation = needsNavigateTo || needsNavigateBack
  const needsRoute =
    controllerMounted.needsRoute ||
    /\broute\./.test(scriptAndTemplate) ||
    (needsAppRuntime && (/\$route/.test(options.xml) || /\$query/.test(options.xml)))
  const hasPageRefs = options.pageRefFields.length > 0
  const needsRef = pageData.needsRef || hasPageRefs
  const needsModal = ctx.modalNames.size > 0
  const needsReactive = needsModal
  const vueImports = [
    needsReactive ? 'reactive' : '',
    needsRef ? 'ref' : '',
    pageData.needsComputed ? 'computed' : '',
    controllerMounted.needsOnMounted ? 'onMounted' : '',
  ]
    .filter(Boolean)
    .join(', ')

  const helperImports = [
    needsNavigation ? 'useNavigation' : '',
    needsShowToast ? 'showToast' : '',
    needsGetDeviceInfo ? 'getDeviceInfo' : '',
    controllerMounted.needsInvoke ? 'invoke' : '',
  ]
    .filter(Boolean)
    .join(', ')

  const navBindings = [
    needsNavigateTo ? 'navigateTo' : '',
    needsNavigateBack ? 'navigateBack' : '',
  ]
    .filter(Boolean)
    .join(', ')

  const appImports = [
    needsEvalVIf ? 'evalVIf' : '',
    needsEvalVShow ? 'evalVShow' : '',
    needsInterpolate ? 'interpolate' : '',
    needsAppRuntime ? 'type EventScope' : '',
  ]
    .filter(Boolean)
    .join(', ')

  const importLines = [
    vueImports ? `import { ${vueImports} } from 'vue'` : '',
    needsRoute ? `import { useRoute } from 'vue-router'` : '',
    helperImports ? `import { ${helperImports} } from '../runtime/helpers'` : '',
    appImports ? `import { ${appImports} } from '../runtime/app'` : '',
    imports,
  ]
    .filter(Boolean)
    .join('\n')

  const setupLines = [
    needsNavigation ? `const { ${navBindings} } = useNavigation()` : '',
    needsRoute ? `const route = useRoute()` : '',
    pageData.source.trimEnd(),
    needsAppRuntime
      ? generatePageStoreAdapter(pageData.fieldNames, pageData.writableFieldNames).trimEnd()
      : '',
    needsModal
      ? `const modalVisible = reactive<Record<string, boolean>>({\n${modalInit}\n})`
      : '',
    hasPageRefs ? renderComponentRefDeclarations(options.pageRefFields).trim() : '',
    hasPageRefs ? renderModalRefDeclarations(options.pageRefFields).trim() : '',
    needsAppRuntime
      ? `function visibilityCtx(scope?: EventScope) {
  return {
    store: pageStore,
    scope,
    route: ${needsRoute ? 'route.params as Record<string, any>' : '{}'},
  }
}`
      : '',
    methodsSource.trimEnd(),
    controllerMounted.source.trimEnd(),
  ]
    .filter(Boolean)
    .join('\n\n')

  return `<script setup lang="ts">
${importLines}

${setupLines}
</script>

<template>
  <div class="w-full h-full">
${templateBody}
  </div>
</template>
`
}

export function generateComponentSfc(options: {
  componentId: string
  config: ComponentConfig
  xml: string
  data: PageData
  componentConfigs: Map<string, ComponentConfig>
  componentRoots?: Map<string, XmlNode>
  rootNodes: XmlNode[]
  colorPalette?: ColorPalette
}): string {
  return withColorPalette(options.colorPalette, () =>
    generateComponentSfcInner(options),
  )
}

function generateComponentSfcInner(options: {
  componentId: string
  config: ComponentConfig
  xml: string
  data: PageData
  componentConfigs: Map<string, ComponentConfig>
  componentRoots?: Map<string, XmlNode>
  rootNodes: XmlNode[]
}): string {
  const pageData = generatePageDataSource(options.data.fields)
  const hasLocalData = pageData.fieldNames.length > 0
  const ctx: CodegenContext = {
    kind: 'component',
    id: options.componentId,
    storeName: pageIdToStoreName(options.componentId),
    dataFieldNames: pageData.fieldNames,
    componentImports: new Map(),
    componentConfigs: options.componentConfigs,
    componentRoots: options.componentRoots ?? new Map(),
    modalNames: new Set(),
    refPathMap: new Map(),
    refFields: [],
    methods: [],
    methodSeq: 0,
    extraScript: [],
    indent: 0,
    needsAppIcon: false,
    needsAppSwiper: false,
  }

  const root = options.rootNodes[0]
  const rootPath = root ? `0:${root.tag}` : ''
  const templateBody = root
    ? renderNode(root, ctx, '', false, 'undefined', 2, rootPath)
    : '    <div>Empty component</div>'

  const imports = [
    ...[...ctx.componentImports.entries()].map(
      ([id, name]) => `import ${name} from './${componentIdToFileName(id)}.vue'`,
    ),
    ctx.needsAppIcon ? `import AppIcon from './AppIcon.vue'` : '',
    ctx.needsAppSwiper ? `import AppSwiper from './AppSwiper.vue'` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const propsLines = options.config.props
    .filter((p) => p.name.trim())
    .map((p) => {
      const opt = p.required ? '' : '?'
      const tsType = propTsType(p.type)
      return `  ${p.name}${opt}: ${tsType}`
    })

  const defaultEntries = options.config.props
    .filter((p) => p.name.trim() && !p.required)
    .map((p) => {
      const lit = propDefaultLiteral(p.type, p.defaultValue)
      return lit == null ? '' : `  ${p.name}: ${lit},`
    })
    .filter(Boolean)

  const modelEmitLines = options.config.props
    .filter((p) => p.twoWay && p.name.trim() && p.type !== 'api')
    .map((p) => `  'update:${p.name}': [value: ${propTsType(p.type)}]`)

  const eventEmitLines = options.config.events
    .filter((e) => e.name.trim())
    .map((e) => `  ${e.name}: [payload: Record<string, any>]`)

  const emitLines = [...modelEmitLines, ...eventEmitLines].join('\n')

  const modalInit = [...ctx.modalNames]
    .map((n) => `  '${escapeTsString(n)}': false,`)
    .join('\n')

  const methodsSource = `${renderExtraScript(ctx.extraScript)}${renderGeneratedMethods(ctx.methods)}`
  const scriptAndTemplate = `${methodsSource}\n${templateBody}\n${pageData.source}`
  const needsNavigateTo = /\bnavigateTo\s*\(/.test(scriptAndTemplate)
  const needsNavigateBack = /\bnavigateBack\s*\(/.test(scriptAndTemplate)
  const needsNavigation = needsNavigateTo || needsNavigateBack
  const needsShowToast = /\bshowToast\s*\(/.test(scriptAndTemplate)
  const needsGetDeviceInfo =
    /\bgetDeviceInfo\s*\(/.test(scriptAndTemplate) ||
    /\bgetDeviceInfo\s*\(/.test(pageData.source)
  const needsInterpolate = /\binterpolate\s*\(/.test(scriptAndTemplate)
  const needsModal = ctx.modalNames.size > 0
  const needsStoreAdapter =
    hasLocalData &&
    (needsInterpolate ||
      /\bstore\./.test(scriptAndTemplate) ||
      /\bstore\b/.test(methodsSource))
  const needsReactive = needsModal
  const needsVueComputed = pageData.needsComputed
  const needsVueRef = pageData.needsRef

  const exposedMethods = options.config.exposedMethods.filter(Boolean)
  const exposeBlock = exposedMethods.length
    ? `
${exposedMethods.includes('open') ? `
function open() {
  const firstModal = Object.keys(modalVisible)[0]
  if (firstModal) modalVisible[firstModal] = true
}
` : ''}
defineExpose({ ${exposedMethods.join(', ')} })
`
    : ''

  const helperImports = [
    needsNavigation ? 'useNavigation' : '',
    needsShowToast ? 'showToast' : '',
    needsGetDeviceInfo ? 'getDeviceInfo' : '',
  ]
    .filter(Boolean)
    .join(', ')
  const navBindings = [
    needsNavigateTo ? 'navigateTo' : '',
    needsNavigateBack ? 'navigateBack' : '',
  ]
    .filter(Boolean)
    .join(', ')

  const vueImports = [
    needsReactive ? 'reactive' : '',
    needsVueRef ? 'ref' : '',
    needsVueComputed ? 'computed' : '',
  ]
    .filter(Boolean)
    .join(', ')

  const importLines = [
    vueImports ? `import { ${vueImports} } from 'vue'` : '',
    helperImports ? `import { ${helperImports} } from '../runtime/helpers'` : '',
    needsInterpolate ? `import { interpolate } from '../runtime/app'` : '',
    imports,
  ]
    .filter(Boolean)
    .join('\n')

  const propsBlock = defaultEntries.length
    ? `const props = withDefaults(
  defineProps<{
${propsLines.join('\n')}
  }>(),
  {
${defaultEntries.join('\n')}
  },
)`
    : `const props = defineProps<{
${propsLines.join('\n')}
}>()`

  const setupLines = [
    propsBlock,
    `const emit = defineEmits<{
${emitLines || '  // no events'}
}>()`,
    hasLocalData ? 'const $props = props' : '',
    pageData.source.trimEnd(),
    needsStoreAdapter
      ? generatePageStoreAdapter(
          pageData.fieldNames,
          pageData.writableFieldNames,
          'store',
        ).trimEnd()
      : '',
    needsNavigation ? `const { ${navBindings} } = useNavigation()` : '',
    needsModal
      ? `const modalVisible = reactive<Record<string, boolean>>({\n${modalInit}\n})`
      : '',
    methodsSource.trimEnd(),
    exposeBlock.trimEnd(),
  ]
    .filter(Boolean)
    .join('\n\n')

  return `<script setup lang="ts">
${importLines}

${setupLines}
</script>

<template>
  <div>
${templateBody}
  </div>
</template>
`
}

function propTsType(type: string): string {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'any[]'
    case 'json':
      return 'Record<string, any>'
    case 'api':
      return '((args?: Record<string, any>) => Promise<any>)'
    default:
      return 'string'
  }
}

/** withDefaults 字面量；布尔 false 必须能写出，不能被 || 吃掉 */
function propDefaultLiteral(type: string, value: unknown): string | null {
  if (type === 'api') return null
  if (type === 'boolean') {
    if (value === true || value === 'true' || value === 1 || value === '1') return 'true'
    return 'false'
  }
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? String(n) : '0'
  }
  if (type === 'array') {
    try {
      return JSON.stringify(Array.isArray(value) ? value : [])
    } catch {
      return '[]'
    }
  }
  if (type === 'json') {
    try {
      const obj =
        value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      return JSON.stringify(obj)
    } catch {
      return '{}'
    }
  }
  if (value == null) return `''`
  return `'${escapeTsString(String(value))}'`
}

export { pageIdToViewName }
