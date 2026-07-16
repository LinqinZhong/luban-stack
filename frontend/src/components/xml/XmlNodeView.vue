<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, shallowRef, watch, type CSSProperties, type ComputedRef } from 'vue'
import type { IconLibrary } from '../../types/icon-library'
import { findIcon, iconSymbolId } from '../../types/icon-library'
import type { PageData } from '../../types/page-data'
import type { ComponentRenderMap } from '../../types/component-render'
import type { XmlNode } from '../../utils/xml'
import type { PreviewEventKey, PreviewInteractPayload } from '../../utils/event-runtime'
import {
  isFragmentTag,
  isOutOfFlowTree,
  isSupportedTag,
  parseBool,
  parseNumber,
  parseOverflow,
  parsePageXml,
  parseSize,
  borderStyle,
  hasBorderRadius,
  overflowStyle,
  paddingStyle,
} from '../../utils/xml'
import { resolveMatchingStyleOverrides, evaluateScenarios, interpolateDataBindings } from '../../utils/dynamic-style-runtime'
import {
  buildDollarProps,
  interpolateDollarProps,
} from '../../utils/component-props'
import { resolveComputedPageData, buildComputeDepsKey } from '../../utils/compute-runtime'
import { CANVAS_RUNTIME_KEY } from '../../composables/useCanvasRuntime'
import {
  DYNAMIC_STYLES_ATTR,
  V_IF_ATTR,
  V_SHOW_ATTR,
  parseVisibilityConditions,
} from '../../types/dynamic-styles'
import { countEventBindings, countNodeEventBindings, INTERACTION_EVENT_KEYS } from '../../types/page-method'
import { MODAL_HOST_KEY, MODAL_STACK_KEY } from '../../composables/useModalStack'
import WidgetSelectShell from './WidgetSelectShell.vue'
import OverlayScrollPort from './OverlayScrollPort.vue'
import SwiperPort from './SwiperPort.vue'
import XmlNodeView from './XmlNodeView.vue'

/** 纵向滚动列标记：子孙节点 match_parent 高度勿再 flex 抢视口 */
const SCROLL_COLUMN_KEY = 'voiderVerticalScrollColumn'

const SKIP_DOLLAR_PROPS_ATTRS = new Set<string>([
  DYNAMIC_STYLES_ATTR,
  V_SHOW_ATTR,
  V_IF_ATTR,
  ...INTERACTION_EVENT_KEYS,
])

const props = defineProps<{
  node: XmlNode
  nodeId: string
  selectedId?: string
  hoveredId?: string
  selectable?: boolean
  parentHorizontal?: boolean
  /** 父级为纵向 LinearLayout */
  parentVertical?: boolean
  /** 祖先纵向可滚动 LinearLayout（其子节点勿再用 flex:1 抢视口） */
  parentScrollable?: boolean
  /** 页面根节点 */
  isRoot?: boolean
  /** RelativeLayout 子节点定位样式 */
  extraStyle?: CSSProperties
  iconLibrary?: IconLibrary
  pageData?: PageData
  /** 编辑态隐藏的节点（预览不传，不生效） */
  hiddenNodeIds?: string[]
  /** 页面中引用的组件渲染数据 */
  componentMap?: ComponentRenderMap
  /** 组件入参运行时对象（$props） */
  dollarProps?: Record<string, unknown>
  /** 路由参数运行时对象（$route） */
  routeParams?: Record<string, unknown>
  /**
   * 是否执行 onClick / onLongClick / onScroll。
   * 编辑态为 false（含 Component 内部 selectable=false 的节点），避免抢走选中。
   */
  interactEnabled?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  hover: [id: string]
  'open-repeat': [id: string]
  interact: [payload: PreviewInteractPayload]
}>()

const modalStack = inject(MODAL_STACK_KEY, null)
const modalHostRef = inject(MODAL_HOST_KEY, null)
const canvasRuntime = inject(CANVAS_RUNTIME_KEY, null)

const isEditorHidden = computed(() =>
  (props.hiddenNodeIds ?? []).includes(props.nodeId),
)

const runtimeScope = computed(() => ({
  ...(props.node.scope ?? {}),
  $props: props.dollarProps,
  $route: props.routeParams,
}))

const mountAllowed = computed(() => {
  // 编辑态忽略 v-if，始终挂载（仅左侧眼睛可隐藏）
  if (props.selectable) return true
  const config = parseVisibilityConditions(props.node.attrs[V_IF_ATTR])
  return evaluateScenarios(config.scenarios, props.pageData, runtimeScope.value)
})

const showAllowed = computed(() => {
  // 编辑态忽略 v-show，始终显示
  if (props.selectable) return true
  const config = parseVisibilityConditions(props.node.attrs[V_SHOW_ATTR])
  return evaluateScenarios(config.scenarios, props.pageData, runtimeScope.value)
})

/** Modal id：优先 name，否则用节点路径 */
const modalKey = computed(
  () => props.node.attrs.name?.trim() || props.nodeId,
)

const modalIsOpen = computed(() => {
  if (props.node.tag !== 'Modal') return true
  if (props.selectable) return true
  return Boolean(modalStack?.isTop(modalKey.value))
})

/** 编辑态：始终全屏展示；预览态：仅栈顶打开 */
const modalLayerVisible = computed(() => {
  if (props.node.tag !== 'Modal') return false
  if (isEditorHidden.value || !mountAllowed.value) return false
  if (props.selectable) return true
  return showAllowed.value && modalIsOpen.value
})

/** v-show / Modal 栈：条件为假时隐藏但仍挂载 */
const visuallyHidden = computed(
  () => !showAllowed.value || (props.node.tag === 'Modal' && !modalIsOpen.value),
)

const previewClickable = computed(
  () =>
    Boolean(props.interactEnabled) &&
    !props.selectable &&
    countEventBindings(props.node.attrs.onClick) > 0,
)
const previewLongClickable = computed(
  () =>
    Boolean(props.interactEnabled) &&
    !props.selectable &&
    countEventBindings(props.node.attrs.onLongClick) > 0,
)
const previewInteractive = computed(
  () => previewClickable.value || previewLongClickable.value,
)

const componentDetail = computed(() => {
  if (props.node.tag !== 'Component') return null
  const id = props.node.attrs.componentId?.trim()
  if (!id || !props.componentMap) return null
  return props.componentMap[id] ?? null
})

/** 基础 attrs + 动态样式；解析数据池绑定；预览态再替换 $props */
const attrs = computed(() => {
  const base = props.node.attrs
  const overrides = resolveMatchingStyleOverrides(
    base[DYNAMIC_STYLES_ATTR],
    props.pageData,
    runtimeScope.value,
  )
  let merged = Object.keys(overrides).length ? { ...base, ...overrides } : base

  const skipEventKeys = new Set<string>([
    ...SKIP_DOLLAR_PROPS_ATTRS,
    ...(componentDetail.value?.config.events ?? [])
      .map((item) => item.name.trim())
      .filter(Boolean),
  ])
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (skipEventKeys.has(key)) {
      next[key] = value
      continue
    }
    // 编辑态也解析 {数据池字段}，方便画布直接看到绑定效果
    let resolved = interpolateDataBindings(value, props.pageData, runtimeScope.value)
    if (!props.selectable && props.dollarProps) {
      resolved = interpolateDollarProps(resolved, props.dollarProps)
    }
    next[key] = resolved
  }
  return next
})
const width = computed(() => parseSize(attrs.value.width, 'wrap_content'))
const height = computed(() => parseSize(attrs.value.height, 'wrap_content'))
const isSelected = computed(() => props.selectable && props.selectedId === props.nodeId)
const isHovered = computed(() => props.selectable && props.hoveredId === props.nodeId)

/** 纵向父布局中 height=match_parent：占满剩余高度（滚动列内除外） */
const fillRemainingHeight = computed(
  () =>
    height.value === 'match_parent' &&
    Boolean(props.parentVertical) &&
    !Boolean(props.parentScrollable),
)

/**
 * 纵向父布局内、非 match_parent 的子项按内容堆叠；
 * match_parent 由 fillRemainingHeight / linearStyle 撑满剩余空间。
 */
const stackInVerticalParent = computed(
  () => Boolean(props.parentVertical) && height.value !== 'match_parent',
)

const innerSizeStyle = computed(() => {
  const style: Record<string, string> = {}
  const stackHeight =
    insideScrollColumn.value || stackInVerticalParent.value

  if (width.value === 'match_parent') {
    style.width = '100%'
    style.maxWidth = '100%'
    style.minWidth = '0'
  } else if (width.value === 'wrap_content') {
    style.width = 'fit-content'
    style.maxWidth = '100%'
    style.flexShrink = '0'
  } else {
    style.width = `${width.value}px`
    style.flexShrink = '0'
  }

  if (height.value === 'match_parent') {
    if (stackHeight) {
      style.height = 'auto'
      style.maxHeight = 'none'
      style.flexShrink = '0'
    } else {
      style.height = '100%'
      style.maxHeight = '100%'
      style.minHeight = '0'
    }
  } else if (height.value === 'wrap_content') {
    style.height = 'fit-content'
    style.flexShrink = '0'
  } else {
    style.height = `${height.value}px`
    style.flexShrink = '0'
  }

  return style
})

const layoutStyle = computed(() => ({
  ...innerSizeStyle.value,
  ...paddingStyle(attrs.value),
  ...borderStyle(attrs.value),
  boxSizing: 'border-box' as const,
}))

const shellExtraStyle = computed(() => props.extraStyle)

const textContent = computed(() => {
  const raw = attrs.value.text || props.node.text || ''
  if (props.selectable || !props.dollarProps) return raw
  // attrs.text 已插值；裸 text 节点兜底
  if (attrs.value.text) return attrs.value.text
  return interpolateDollarProps(raw, props.dollarProps)
})

const textStyle = computed(() => ({
  ...layoutStyle.value,
  color: attrs.value.textColor || '#303133',
  fontSize: `${parseNumber(attrs.value.textSize, 14)}px`,
  textAlign: (attrs.value.gravity?.includes('center')
    ? 'center'
    : attrs.value.gravity?.includes('right')
      ? 'right'
      : 'left') as 'left' | 'center' | 'right',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
}))

const instanceDollarProps = computed(() => {
  const config = componentDetail.value?.config
  const source = props.node.attrs
  // 编辑/预览都把 {titleBarColor} 等解析进 $props，画布才能看到绑定结果
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    resolved[key] = interpolateDataBindings(value, props.pageData, {
      ...(props.node.scope ?? {}),
      $route: props.routeParams,
    })
  }
  return buildDollarProps(config, resolved)
})

/**
 * 仅当计算体真正用到的 $props / 设备信息变化时才变。
 * 滚动改 titleBarColor 不会让只依赖 isFillScreen 的计算字段重跑。
 */
const componentComputeDepsKey = computed(() => {
  const detail = componentDetail.value
  if (!detail) return ''
  return buildComputeDepsKey(
    detail.data,
    instanceDollarProps.value,
    canvasRuntime?.getDeviceInfo() ?? null,
  )
})

/** 用实例 $props 重新求值组件数据池（避免只用 config 默认值） */
const componentPageData = shallowRef<PageData | undefined>(undefined)

watch(
  componentComputeDepsKey,
  () => {
    const detail = componentDetail.value
    if (!detail) {
      componentPageData.value = props.pageData
      return
    }
    // 仅在 depsKey 变化时求值；此处读 instanceDollarProps 不会额外建依赖
    componentPageData.value = resolveComputedPageData(detail.data, {
      getDeviceInfo: canvasRuntime?.getDeviceInfo,
      dollarProps: instanceDollarProps.value,
    })
  },
  { immediate: true },
)

const componentRoot = computed(() => {
  const detail = componentDetail.value
  if (!detail?.xml?.trim()) return null
  try {
    return parsePageXml(detail.xml)
  } catch {
    return null
  }
})

/** 组件内容仅 Modal（或 Fragment 内全是 Modal）时：不占文档流，避免挤开兄弟 */
const componentOutOfFlow = computed(() =>
  Boolean(componentRoot.value && isOutOfFlowTree(componentRoot.value)),
)

const fragmentOutOfFlow = computed(
  () => isFragmentTag(props.node.tag) && isOutOfFlowTree(props.node),
)

/** 绝对铺满父级、不参与布局；pointer-events:none 让下方内容可点 */
const outOfFlowHostStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  zIndex: 2,
  pointerEvents: 'none',
  margin: 0,
}))

const componentHostWidth = computed(() => {
  if (componentOutOfFlow.value) return 'wrap_content' as const
  const fromAttr = attrs.value.width?.trim()
  if (fromAttr) return parseSize(fromAttr, 'wrap_content')
  const fromConfig = componentDetail.value?.config.width
  return parseSize(fromConfig, 'wrap_content')
})

const componentHostHeight = computed(() => {
  if (componentOutOfFlow.value) return 'wrap_content' as const
  const fromAttr = attrs.value.height?.trim()
  if (fromAttr) return parseSize(fromAttr, 'wrap_content')
  const fromConfig = componentDetail.value?.config.height
  return parseSize(fromConfig, 'wrap_content')
})

const componentShellExtraStyle = computed<CSSProperties>(() => ({
  ...(props.extraStyle ?? {}),
  ...(componentOutOfFlow.value ? outOfFlowHostStyle.value : {}),
}))

const componentStyle = computed(() => {
  if (componentOutOfFlow.value) {
    return {
      display: 'block' as const,
      width: '100%',
      height: '100%',
      boxSizing: 'border-box' as const,
      pointerEvents: 'none' as const,
    }
  }
  const stackHeight =
    insideScrollColumn.value || stackInVerticalParent.value
  return {
    ...layoutStyle.value,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    width: '100%',
    height: stackHeight ? 'auto' : '100%',
    maxHeight: stackHeight ? 'none' : undefined,
    minHeight:
      componentHostHeight.value === 'wrap_content' && !componentRoot.value
        ? '48px'
        : undefined,
    boxSizing: 'border-box' as const,
    overflow: stackHeight ? 'visible' : 'hidden',
  }
})

const componentPlaceholderStyle = computed(() => ({
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'flex-start',
  justifyContent: 'center',
  gap: '4px',
  minHeight: '48px',
  padding: '10px 12px',
  border: '1px dashed #94a3b8',
  borderRadius: '8px',
  background: 'rgba(148, 163, 184, 0.12)',
  color: '#334155',
  boxSizing: 'border-box' as const,
  width: '100%',
}))

const buttonStyle = computed(() => ({
  ...layoutStyle.value,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: '4px',
  background: attrs.value.background || '#409eff',
  color: attrs.value.textColor || '#ffffff',
  fontSize: `${parseNumber(attrs.value.textSize, 14)}px`,
  cursor: props.selectable || previewInteractive.value ? 'pointer' : 'default',
  minHeight: height.value === 'wrap_content' ? '36px' : undefined,
}))

/** 编辑态未展开的 {item.xxx} 等变量，不当作真实 URL 加载 */
function isTemplateSrc(src: string): boolean {
  return /\{[^{}]+\}/.test(src)
}

const imageSrc = computed(() => {
  const src = attrs.value.src?.trim() || ''
  if (!src || isTemplateSrc(src)) return ''
  return src
})
const imageAlt = computed(() => attrs.value.alt || '')
const imageTitle = computed(() => attrs.value.title || undefined)
const imageLoading = computed(() => {
  const value = attrs.value.loading?.trim().toLowerCase()
  return value === 'lazy' || value === 'eager' ? value : undefined
})
const imagePlaceholderLabel = computed(() => {
  const src = attrs.value.src?.trim() || ''
  if (isTemplateSrc(src)) return '图片'
  return imageAlt.value || 'Image'
})

const imageStyle = computed(() => ({
  ...layoutStyle.value,
  display: 'block',
  objectFit: (attrs.value.objectFit || 'cover') as CSSProperties['objectFit'],
  background: attrs.value.background || undefined,
  ...(height.value === 'match_parent'
    ? { width: '100%', height: '100%', minHeight: 0, flex: '1 1 auto' }
    : {}),
  // 图片自身圆角仍需裁切，不受布局 overflow 属性控制
  ...(hasBorderRadius(attrs.value) ? { overflow: 'hidden' as const } : {}),
}))

const imagePlaceholderStyle = computed(() => ({
  ...layoutStyle.value,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: attrs.value.background || '#f2f3f5',
  color: '#909399',
  fontSize: '12px',
  minWidth: width.value === 'wrap_content' ? '80px' : undefined,
  minHeight: height.value === 'wrap_content' ? '60px' : undefined,
  ...(height.value === 'match_parent'
    ? { width: '100%', height: '100%', minHeight: 0, flex: '1 1 auto' }
    : {}),
  ...(hasBorderRadius(attrs.value) ? { overflow: 'hidden' as const } : {}),
}))

/** 编辑态未展开的 {item.xxx} 等变量，不解析图标 */
const iconIdRaw = computed(() => attrs.value.iconId?.trim() || '')
const iconIsTemplate = computed(() => isTemplateSrc(iconIdRaw.value))
const iconDef = computed(() =>
  iconIsTemplate.value ? undefined : findIcon(props.iconLibrary, iconIdRaw.value),
)
const iconSize = computed(() => parseNumber(attrs.value.size, 24))
const iconColor = computed(() => attrs.value.color || '#303133')
const iconHref = computed(() =>
  iconDef.value ? `#${iconSymbolId(iconDef.value.id)}` : '',
)

const iconStyle = computed(() => {
  const size = iconSize.value
  const hasFixedW = width.value !== 'wrap_content'
  const hasFixedH = height.value !== 'wrap_content'
  return {
    ...layoutStyle.value,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: iconColor.value,
    fill: iconColor.value,
    width: hasFixedW ? undefined : `${size}px`,
    height: hasFixedH ? undefined : `${size}px`,
    flexShrink: 0,
    lineHeight: 0,
  }
})

const iconPlaceholderStyle = computed(() => ({
  ...iconStyle.value,
  background: attrs.value.background || (iconIsTemplate.value ? 'transparent' : '#f2f3f5'),
  color: iconIsTemplate.value ? iconColor.value : '#909399',
  fontSize: '11px',
  border: iconIsTemplate.value ? 'none' : '1px dashed #dcdfe6',
  boxSizing: 'border-box' as const,
}))

/**
 * 布局溢出：编辑态一律 visible（完整展示、角标不被裁），
 * 预览态才应用隐藏 / 滚动策略。
 */
const hasScrollAttr = computed(
  () => parseOverflow(attrs.value.overflow, 'visible') === 'scroll',
)

const injectedScrollColumn = inject<ComputedRef<boolean> | undefined>(
  SCROLL_COLUMN_KEY,
  undefined,
)

const ancestorInScrollColumn = computed(() => Boolean(injectedScrollColumn?.value))

/**
 * 向子孙声明「滚动内容列」：仅当自身/祖先为 overflow=scroll 的纵向布局。
 * 勿对所有纵向 LinearLayout 声明，否则内容区 RelativeLayout 会被当成堆叠而高度塌陷。
 */
const inScrollColumn = computed(
  () =>
    ancestorInScrollColumn.value ||
    (hasScrollAttr.value && attrs.value.orientation !== 'horizontal') ||
    Boolean(props.parentScrollable),
)

/** 预览态真正成为滚动容器：仅显式 overflow=scroll（根布局默认可滚会压垮绝对子项高度） */
const isScrollLayout = computed(() => !props.selectable && hasScrollAttr.value)

provide(
  SCROLL_COLUMN_KEY,
  computed(() => inScrollColumn.value),
)

const layoutOverflowStyle = computed(() => {
  // 编辑态始终 visible，避免选中框角标/绝对定位子项被裁切
  if (props.selectable) return { overflow: 'visible' as const }
  return overflowStyle(attrs.value, 'visible')
})

/** 作为子节点：处在祖先滚动列内时，高度按内容堆叠（勿包含普通 parentVertical） */
const insideScrollColumn = computed(
  () => ancestorInScrollColumn.value || Boolean(props.parentScrollable),
)

const linearStyle = computed(() => {
  const horizontal = attrs.value.orientation === 'horizontal'
  const matchHeight = height.value === 'match_parent'
  const matchWidth = width.value === 'match_parent'
  const stackHeight =
    insideScrollColumn.value || stackInVerticalParent.value

  return {
    ...layoutStyle.value,
    ...layoutOverflowStyle.value,
    display: 'flex',
    flexDirection: (horizontal ? 'row' : 'column') as 'row' | 'column',
    alignItems: mapGravityCross(attrs.value.gravity, horizontal),
    justifyContent: mapGravityMain(attrs.value.gravity, horizontal),
    gap: attrs.value.gap ? `${parseNumber(attrs.value.gap)}px` : undefined,
    background: attrs.value.background || 'transparent',
    position: 'relative' as const,
    ...(matchWidth ? { width: '100%', minWidth: 0 } : {}),
    ...(matchHeight
      ? stackHeight
        ? {
            height: 'auto',
            maxHeight: 'none',
            flex: '0 0 auto',
            alignSelf: 'stretch',
          }
        : isScrollLayout.value
          ? {
              flex: '1 1 0%',
              minHeight: 0,
              height: '100%',
              maxHeight: '100%',
              alignSelf: 'stretch',
            }
          : {
              height: '100%',
              flex: '1 1 auto',
              minHeight: 0,
              ...(props.selectable ? {} : { overflow: 'hidden' as const }),
            }
      : isScrollLayout.value
        ? { maxHeight: '100%', minHeight: 0 }
        : {}),
  }
})

const swiperOverflowStyle = computed(() => {
  // 编辑态始终露出相邻页；预览态才用 overflow（默认 visible）
  if (props.selectable) return { overflow: 'visible' as const }
  const strategy = parseOverflow(attrs.value.overflow, 'visible')
  return {
    overflow: (strategy === 'hidden' ? 'hidden' : 'visible') as
      | 'visible'
      | 'hidden',
  }
})

const swiperStyle = computed(() => {
  const matchHeight = height.value === 'match_parent'
  const matchWidth = width.value === 'match_parent'
  const stackHeight =
    insideScrollColumn.value || stackInVerticalParent.value
  return {
    ...layoutStyle.value,
    ...swiperOverflowStyle.value,
    position: 'relative' as const,
    background: attrs.value.background || 'transparent',
    ...(matchWidth ? { width: '100%', minWidth: 0 } : {}),
    ...(matchHeight
      ? stackHeight
        ? {
            height: '160px',
            maxHeight: 'none',
            flex: '0 0 auto',
            alignSelf: 'stretch',
          }
        : {
            height: '100%',
            minHeight: 0,
            flex: '1 1 auto',
            alignSelf: 'stretch',
          }
      : { minHeight: 0 }),
  }
})

const swiperAutoplay = computed(() => parseBool(attrs.value.autoplay))
const swiperCircular = computed(
  () => attrs.value.circular == null || attrs.value.circular === '' || parseBool(attrs.value.circular),
)
const swiperIndicator = computed(
  () =>
    attrs.value.indicatorDots == null ||
    attrs.value.indicatorDots === '' ||
    parseBool(attrs.value.indicatorDots),
)
const swiperInterval = computed(() => parseNumber(attrs.value.interval, 3000))
const swiperDuration = computed(() => parseNumber(attrs.value.duration, 280))
const swiperCurrent = computed(() => parseNumber(attrs.value.current, 0))
const swiperIndicatorColor = computed(
  () => attrs.value.indicatorColor?.trim() || 'rgba(0,0,0,0.25)',
)
const swiperIndicatorActiveColor = computed(
  () => attrs.value.indicatorActiveColor?.trim() || '#409eff',
)

const relativeStyle = computed(() => {
  const matchHeight = height.value === 'match_parent'
  const matchWidth = width.value === 'match_parent'
  // RelativeLayout 不参与「纵向堆叠」；仅真正处于滚动列内才 auto
  const stackHeight = insideScrollColumn.value
  return {
    ...layoutStyle.value,
    ...layoutOverflowStyle.value,
    position: 'relative' as const,
    background: attrs.value.background || 'transparent',
    ...(matchWidth ? { width: '100%' } : {}),
    ...(matchHeight
      ? stackHeight
        ? { height: 'auto', maxHeight: 'none', flex: '0 0 auto', alignSelf: 'stretch' }
        : isScrollLayout.value
          ? {
              flex: '1 1 0%',
              minHeight: 0,
              height: '100%',
              maxHeight: '100%',
              alignSelf: 'stretch',
            }
          : {
              height: '100%',
              ...(props.selectable ? {} : { overflow: 'hidden' as const }),
            }
      : isScrollLayout.value
        ? { maxHeight: '100%', minHeight: 0 }
        : {}),
    minHeight: height.value === 'wrap_content' ? '40px' : undefined,
  }
})

function mapGravityMain(gravity: string | undefined, horizontal: boolean) {
  if (!gravity) return 'flex-start'
  const g = gravity.toLowerCase()

  if (horizontal) {
    if (g.includes('right') || g.includes('end')) return 'flex-end'
    if (g.includes('left') || g.includes('start')) return 'flex-start'
    if (g.includes('center_horizontal') || g === 'center') return 'center'
    return 'flex-start'
  }

  if (g.includes('bottom')) return 'flex-end'
  if (g.includes('top')) return 'flex-start'
  if (g.includes('center_vertical') || g === 'center') return 'center'
  return 'flex-start'
}

function mapGravityCross(gravity: string | undefined, horizontal: boolean) {
  if (!gravity) return 'stretch'
  const g = gravity.toLowerCase()

  if (horizontal) {
    if (g.includes('bottom')) return 'flex-end'
    if (g.includes('top')) return 'flex-start'
    if (g.includes('center_vertical') || g === 'center') return 'center'
    return 'stretch'
  }

  if (g.includes('right') || g.includes('end')) return 'flex-end'
  if (g.includes('left') || g.includes('start')) return 'flex-start'
  if (g.includes('center_horizontal') || g === 'center') return 'center'
  return 'stretch'
}

const modalHostEl = computed(() => modalHostRef?.value ?? null)

const modalSurfaceStyle = computed(() => ({
  ...paddingStyle(attrs.value),
  ...borderStyle(attrs.value),
  background: attrs.value.background || 'rgba(0,0,0,0.45)',
  boxSizing: 'border-box' as const,
}))

/** Modal 始终 Teleport 全屏 */
const modalOverlayStyle = computed(() => ({
  ...modalSurfaceStyle.value,
  position: 'absolute' as const,
  inset: '0',
  width: '100%',
  height: '100%',
  zIndex: props.selectable && isSelected.value ? 3 : 1,
  outline:
    props.selectable && isSelected.value
      ? '2px solid #e6a23c'
      : props.selectable && isHovered.value
        ? '1px dashed #409eff'
        : undefined,
  outlineOffset: '-2px',
}))

/**
 * 内容面板铺满弹层（相对布局根）：子项经 childRelativeStyle 绝对定位。
 * 点到面板空白仍关闭（见 handleModalPanelClick）。
 */
const modalPanelStyle = computed(() => ({
  position: 'relative' as const,
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  maxWidth: '100%',
  maxHeight: '100%',
  boxSizing: 'border-box' as const,
}))

const modalCloseOnClick = computed(
  () =>
    attrs.value.closeOnClick == null ||
    attrs.value.closeOnClick === '' ||
    parseBool(attrs.value.closeOnClick),
)

function childRelativeStyle(child: XmlNode): CSSProperties {
  const a = child.attrs
  const style: CSSProperties = {
    position: 'absolute',
  }

  if (parseBool(a.layout_alignParentLeft) || parseBool(a.layout_alignParentStart)) {
    style.left = 0
  }
  if (parseBool(a.layout_alignParentRight) || parseBool(a.layout_alignParentEnd)) {
    style.right = 0
  }
  if (parseBool(a.layout_alignParentTop)) {
    style.top = 0
  }
  if (parseBool(a.layout_alignParentBottom)) {
    style.bottom = 0
  }
  if (parseBool(a.layout_centerInParent)) {
    style.left = '50%'
    style.top = '50%'
    style.transform = 'translate(-50%, -50%)'
  } else {
    if (parseBool(a.layout_centerHorizontal)) {
      style.left = '50%'
      style.transform = style.transform
        ? `${style.transform} translateX(-50%)`
        : 'translateX(-50%)'
    }
    if (parseBool(a.layout_centerVertical)) {
      style.top = '50%'
      style.transform = style.transform
        ? `${style.transform} translateY(-50%)`
        : 'translateY(-50%)'
    }
  }

  if (a.layout_marginLeft) style.left = `${parseNumber(a.layout_marginLeft)}px`
  if (a.layout_marginTop) style.top = `${parseNumber(a.layout_marginTop)}px`
  if (a.layout_marginRight) style.right = `${parseNumber(a.layout_marginRight)}px`
  if (a.layout_marginBottom) style.bottom = `${parseNumber(a.layout_marginBottom)}px`

  return style
}

const isHorizontalLinear = computed(
  () => props.node.tag === 'LinearLayout' && attrs.value.orientation === 'horizontal',
)

const showRepeatBadge = computed(
  () => Boolean(props.selectable && attrs.value.repeat?.trim()),
)

const eventBadgeCount = computed(() => {
  if (!props.selectable) return 0
  if (props.node.tag === 'Component') {
    const names = (componentDetail.value?.config.events ?? [])
      .map((item) => item.name.trim())
      .filter(Boolean)
    const keys = [...new Set<string>([...INTERACTION_EVENT_KEYS, ...names])]
    return keys.reduce(
      (sum, key) => sum + countEventBindings(attrs.value[key]),
      0,
    )
  }
  return countNodeEventBindings(attrs.value)
})

function childId(index: number, tag: string) {
  return `${props.nodeId}/${index}:${tag}`
}

function emitInteract(
  eventKey: PreviewEventKey,
  eventArgs?: Record<string, unknown>,
) {
  const raw = props.node.attrs[eventKey]
  if (!raw?.trim()) return
  emit('interact', {
    eventKey,
    raw,
    scope: props.node.scope,
    dollarProps: props.dollarProps,
    ...(eventArgs ? { eventArgs } : {}),
  })
}

function handleScroll(detail: {
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  scrollWidth: number
  clientHeight: number
  clientWidth: number
}) {
  if (!props.interactEnabled || props.selectable) return
  if (countEventBindings(props.node.attrs.onScroll) <= 0) return
  emitInteract('onScroll', { ...detail })
}

function handleSelect(event: MouseEvent) {
  if (props.selectable) {
    event.stopPropagation()
    emit('select', props.nodeId)
    return
  }
  if (longPressFired) {
    longPressFired = false
    event.stopPropagation()
    return
  }
  if (!previewClickable.value) return
  event.stopPropagation()
  emitInteract('onClick')
}

function closeModalIfAllowed() {
  if (!modalCloseOnClick.value) return
  modalStack?.close(modalKey.value)
}

function handleModalBackdropClick(event?: MouseEvent) {
  if (props.selectable) {
    if (event) handleSelect(event)
    return
  }
  // 点到半透明背景（非弹层内容）时关闭
  closeModalIfAllowed()
}

function handleModalPanelClick(event: MouseEvent) {
  if (props.selectable) {
    handleSelect(event)
    return
  }
  // 面板铺满时仅「点到面板自身」算点空白；点到子弹窗子控件不关闭
  if (event.target === event.currentTarget) {
    closeModalIfAllowed()
  }
}

function handleMouseEnter() {
  if (!props.selectable) return
  emit('hover', props.nodeId)
}

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressFired = false

function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function handlePointerDown() {
  if (!previewLongClickable.value) return
  longPressFired = false
  clearLongPress()
  longPressTimer = setTimeout(() => {
    longPressFired = true
    emitInteract('onLongClick')
  }, 500)
}

function handlePointerUp(event: MouseEvent) {
  clearLongPress()
  if (longPressFired) {
    event.preventDefault()
    event.stopPropagation()
  }
}

function handlePointerLeave() {
  clearLongPress()
}

function forwardSelect(id: string) {
  emit('select', id)
}

function forwardHover(id: string) {
  emit('hover', id)
}

function handleOpenRepeat() {
  emit('open-repeat', props.nodeId)
}

function forwardOpenRepeat(id: string) {
  emit('open-repeat', id)
}

function forwardInteract(payload: PreviewInteractPayload) {
  emit('interact', payload)
}

/** Component 子树交互：补上 emit 回写上下文后再向上抛 */
function forwardComponentInteract(payload: PreviewInteractPayload) {
  emit('interact', {
    ...payload,
    componentEmit: payload.componentEmit ?? {
      events: componentDetail.value?.config.events ?? [],
      // 用原始节点 attrs，避免动态样式/$props 插值改写事件绑定 JSON
      hostAttrs: { ...props.node.attrs },
      hostScope: props.node.scope,
    },
  })
}

onBeforeUnmount(() => {
  clearLongPress()
})
</script>

<template>
  <template v-if="!isEditorHidden && mountAllowed">
  <div
    v-if="!isSupportedTag(node.tag)"
    class="unsupported"
    :style="visuallyHidden ? { display: 'none' } : undefined"
  >
    不支持的控件：{{ node.tag }}
  </div>

  <!-- Fragment：多根透明容器；仅含 Modal 时脱离文档流 -->
  <div
    v-else-if="isFragmentTag(node.tag)"
    class="fragment-host"
    :class="{ 'is-root': isRoot, 'is-out-of-flow': fragmentOutOfFlow }"
  >
    <XmlNodeView
      v-for="(child, index) in node.children"
      :key="childId(index, child.tag)"
      :node="child"
      :node-id="childId(index, child.tag)"
      :selected-id="selectedId"
      :hovered-id="hoveredId"
      :selectable="selectable"
      :interact-enabled="interactEnabled"
      :parent-horizontal="false"
      :parent-vertical="true"
      :parent-scrollable="parentScrollable"
      :icon-library="iconLibrary"
      :page-data="pageData"
      :hidden-node-ids="hiddenNodeIds"
      :component-map="componentMap"
      :dollar-props="dollarProps"
      :route-params="routeParams"
      @select="emit('select', $event)"
      @hover="emit('hover', $event)"
      @open-repeat="emit('open-repeat', $event)"
      @interact="emit('interact', $event)"
    />
  </div>

  <WidgetSelectShell
    v-else-if="node.tag === 'Text'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="attrs"
    :width="width"
    :height="height"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
    :fill-parent="isRoot"
    :extra-style="shellExtraStyle"
    :repeat-badge="showRepeatBadge"
    :event-badge-count="eventBadgeCount"
    :visually-hidden="visuallyHidden"
    :interactive="previewInteractive"
    :inside-scroll-port="insideScrollColumn"
    :fill-remaining-height="fillRemainingHeight"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointerleave="handlePointerLeave"
    @open-repeat="handleOpenRepeat"
  >
    <div class="widget text" :style="textStyle">
      {{ textContent }}
    </div>
  </WidgetSelectShell>

  <WidgetSelectShell
    v-else-if="node.tag === 'Button'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="attrs"
    :width="width"
    :height="height"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
    :fill-parent="isRoot"
    :extra-style="shellExtraStyle"
    :repeat-badge="showRepeatBadge"
    :event-badge-count="eventBadgeCount"
    :visually-hidden="visuallyHidden"
    :interactive="previewInteractive"
    :inside-scroll-port="insideScrollColumn"
    :fill-remaining-height="fillRemainingHeight"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointerleave="handlePointerLeave"
    @open-repeat="handleOpenRepeat"
  >
    <button type="button" class="widget button" :style="buttonStyle">
      {{ textContent || 'Button' }}
    </button>
  </WidgetSelectShell>

  <WidgetSelectShell
    v-else-if="node.tag === 'Image'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="attrs"
    :width="width"
    :height="height"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
    :fill-parent="isRoot"
    :extra-style="shellExtraStyle"
    :repeat-badge="showRepeatBadge"
    :event-badge-count="eventBadgeCount"
    :visually-hidden="visuallyHidden"
    :interactive="previewInteractive"
    :inside-scroll-port="insideScrollColumn"
    :fill-remaining-height="fillRemainingHeight"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointerleave="handlePointerLeave"
    @open-repeat="handleOpenRepeat"
  >
    <img
      v-if="imageSrc"
      class="widget image"
      :src="imageSrc"
      :alt="imageAlt"
      :title="imageTitle"
      :loading="imageLoading"
      :style="imageStyle"
      draggable="false"
    />
    <div
      v-else
      class="widget image image-placeholder"
      :style="imagePlaceholderStyle"
      :title="imageTitle"
    >
      {{ imagePlaceholderLabel }}
    </div>
  </WidgetSelectShell>

  <WidgetSelectShell
    v-else-if="node.tag === 'Icon'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="attrs"
    :width="width"
    :height="height"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
    :fill-parent="isRoot"
    :extra-style="shellExtraStyle"
    :repeat-badge="showRepeatBadge"
    :event-badge-count="eventBadgeCount"
    :visually-hidden="visuallyHidden"
    :interactive="previewInteractive"
    :inside-scroll-port="insideScrollColumn"
    :fill-remaining-height="fillRemainingHeight"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointerleave="handlePointerLeave"
    @open-repeat="handleOpenRepeat"
  >
    <svg
      v-if="iconHref"
      class="widget icon"
      :style="iconStyle"
      :viewBox="iconDef?.viewBox || '0 0 24 24'"
      aria-hidden="true"
    >
      <use :href="iconHref" />
    </svg>
    <!-- 变量绑定：编辑态用笑脸占位，预览展开后再显示真实图标 -->
    <svg
      v-else-if="iconIsTemplate"
      class="widget icon icon-var-placeholder"
      :style="iconStyle"
      viewBox="0 0 24 24"
      aria-hidden="true"
      aria-label="变量图标占位"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" />
      <circle cx="15" cy="10" r="1.2" fill="currentColor" />
      <path
        d="M8.5 14.5c1.2 1.4 2.6 2 3.5 2s2.3-.6 3.5-2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
    <div
      v-else
      class="widget icon icon-placeholder"
      :style="iconPlaceholderStyle"
    >
      {{ iconIdRaw || 'Icon' }}
    </div>
  </WidgetSelectShell>

  <WidgetSelectShell
    v-else-if="node.tag === 'Component'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="componentOutOfFlow ? {} : attrs"
    :width="componentHostWidth"
    :height="componentHostHeight"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
    :extra-style="componentShellExtraStyle"
    :repeat-badge="showRepeatBadge"
    :event-badge-count="eventBadgeCount"
    :visually-hidden="visuallyHidden"
    :interactive="previewInteractive"
    :inside-scroll-port="insideScrollColumn"
    :fill-remaining-height="componentOutOfFlow ? false : fillRemainingHeight"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointerleave="handlePointerLeave"
    @open-repeat="handleOpenRepeat"
  >
    <div class="widget component-host" :style="componentStyle">
      <XmlNodeView
        v-if="componentRoot"
        :node="componentRoot"
        :node-id="`${nodeId}/c:0:${componentRoot.tag}`"
        :selectable="false"
        :interact-enabled="interactEnabled"
        :parent-scrollable="inScrollColumn"
        :icon-library="iconLibrary"
        :page-data="componentPageData ?? pageData"
        :component-map="componentMap"
        :dollar-props="instanceDollarProps"
        :route-params="routeParams"
        @interact="forwardComponentInteract"
      />
      <div v-else :style="componentPlaceholderStyle">
        <div class="component-title">{{ attrs.name || attrs.componentId || 'Component' }}</div>
        <div class="component-id">{{ attrs.componentId ? '组件未找到或 XML 为空' : '未指定组件' }}</div>
      </div>
    </div>
  </WidgetSelectShell>

  <WidgetSelectShell
    v-else-if="node.tag === 'Swiper'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="attrs"
    :width="width"
    :height="height"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
    :fill-parent="isRoot"
    :extra-style="shellExtraStyle"
    :repeat-badge="showRepeatBadge"
    :event-badge-count="eventBadgeCount"
    :visually-hidden="visuallyHidden"
    :interactive="previewInteractive"
    :inside-scroll-port="insideScrollColumn"
    :fill-remaining-height="fillRemainingHeight"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointerleave="handlePointerLeave"
    @open-repeat="handleOpenRepeat"
  >
    <div class="widget swiper" :style="swiperStyle">
      <SwiperPort
        :editable="selectable"
        :overflow="parseOverflow(attrs.overflow, 'visible')"
        :slide-count="node.children.length"
        :autoplay="!selectable && swiperAutoplay"
        :interval="swiperInterval"
        :circular="swiperCircular"
        :indicator="swiperIndicator"
        :indicator-color="swiperIndicatorColor"
        :indicator-active-color="swiperIndicatorActiveColor"
        :duration="swiperDuration"
        :current="swiperCurrent"
      >
        <template #default="{ index }">
          <XmlNodeView
            v-if="node.children[index]"
            :node="node.children[index]"
            :node-id="childId(index, node.children[index].tag)"
            :selected-id="selectedId"
            :hovered-id="hoveredId"
            :selectable="selectable"
            :interact-enabled="interactEnabled"
            :parent-horizontal="false"
            :parent-vertical="true"
            :parent-scrollable="inScrollColumn"
            :icon-library="iconLibrary"
            :page-data="pageData"
            :hidden-node-ids="hiddenNodeIds"
            :component-map="componentMap"
            :dollar-props="dollarProps"
            :route-params="routeParams"
            @select="forwardSelect"
            @hover="forwardHover"
            @open-repeat="forwardOpenRepeat"
            @interact="forwardInteract"
          />
        </template>
      </SwiperPort>
    </div>
  </WidgetSelectShell>

  <!-- Modal：原树占位为 0；内容 Teleport 到手机层 -->
  <div
    v-else-if="node.tag === 'Modal' && modalHostEl"
    class="modal-flow-anchor"
  >
    <Teleport :to="modalHostEl">
      <div
        v-if="modalLayerVisible"
        class="modal-overlay"
        :class="{ 'is-edit': selectable, 'is-selected': isSelected }"
        :style="modalOverlayStyle"
        @click="handleModalBackdropClick"
        @mouseenter="handleMouseEnter"
      >
        <div
          class="modal-panel"
          :style="modalPanelStyle"
          @click.stop="handleModalPanelClick"
        >
          <XmlNodeView
            v-for="(child, index) in node.children"
            :key="childId(index, child.tag)"
            :node="child"
            :node-id="childId(index, child.tag)"
            :selected-id="selectedId"
            :hovered-id="hoveredId"
            :selectable="selectable"
            :interact-enabled="interactEnabled"
            :extra-style="childRelativeStyle(child)"
            :icon-library="iconLibrary"
            :page-data="pageData"
            :hidden-node-ids="hiddenNodeIds"
            :component-map="componentMap"
            :dollar-props="dollarProps"
            :route-params="routeParams"
            @select="forwardSelect"
            @hover="forwardHover"
            @open-repeat="forwardOpenRepeat"
            @interact="forwardInteract"
          />
          <div v-if="selectable && !node.children.length" class="modal-empty">
            向弹层添加内容 · name「{{ modalKey }}」
          </div>
        </div>
      </div>
    </Teleport>
  </div>

  <template v-else-if="node.tag === 'Modal'" />

  <WidgetSelectShell
    v-else-if="node.tag === 'LinearLayout'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="attrs"
    :width="width"
    :height="height"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
    :fill-parent="isRoot"
    :extra-style="shellExtraStyle"
    :repeat-badge="showRepeatBadge"
    :event-badge-count="eventBadgeCount"
    :visually-hidden="visuallyHidden"
    :interactive="previewInteractive"
    :scroll-port="isScrollLayout"
    :inside-scroll-port="insideScrollColumn"
    :fill-remaining-height="fillRemainingHeight"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointerleave="handlePointerLeave"
    @open-repeat="handleOpenRepeat"
  >
    <OverlayScrollPort
      :enabled="isScrollLayout"
      content-class="widget linear"
      :content-style="linearStyle"
      @wheel="$event.stopPropagation()"
      @scroll="handleScroll"
    >
      <XmlNodeView
        v-for="(child, index) in node.children"
        :key="childId(index, child.tag)"
        :node="child"
        :node-id="childId(index, child.tag)"
        :selected-id="selectedId"
        :hovered-id="hoveredId"
        :selectable="selectable"
        :interact-enabled="interactEnabled"
        :parent-horizontal="isHorizontalLinear"
        :parent-vertical="!isHorizontalLinear"
        :parent-scrollable="inScrollColumn"
        :icon-library="iconLibrary"
        :page-data="pageData"
        :hidden-node-ids="hiddenNodeIds"
        :component-map="componentMap"
        :dollar-props="dollarProps"
        :route-params="routeParams"
        @select="forwardSelect"
        @hover="forwardHover"
        @open-repeat="forwardOpenRepeat"
        @interact="forwardInteract"
      />
    </OverlayScrollPort>
  </WidgetSelectShell>

  <WidgetSelectShell
    v-else-if="node.tag === 'RelativeLayout'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="attrs"
    :width="width"
    :height="height"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
    :fill-parent="isRoot"
    :extra-style="shellExtraStyle"
    :repeat-badge="showRepeatBadge"
    :event-badge-count="eventBadgeCount"
    :visually-hidden="visuallyHidden"
    :interactive="previewInteractive"
    :scroll-port="isScrollLayout"
    :inside-scroll-port="insideScrollColumn"
    :fill-remaining-height="fillRemainingHeight"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointerleave="handlePointerLeave"
    @open-repeat="handleOpenRepeat"
  >
    <OverlayScrollPort
      :enabled="isScrollLayout"
      content-class="widget relative"
      :content-style="relativeStyle"
      @wheel="$event.stopPropagation()"
      @scroll="handleScroll"
    >
      <!--
        绝对定位子节点相对 padding edge 定位、不受父级 padding 影响。
        内层再开一层 relative，使 padding 能像 Android 一样压缩内容区。
      -->
      <div class="relative-content">
        <XmlNodeView
          v-for="(child, index) in node.children"
          :key="childId(index, child.tag)"
          :node="child"
          :node-id="childId(index, child.tag)"
          :selected-id="selectedId"
          :hovered-id="hoveredId"
          :selectable="selectable"
          :interact-enabled="interactEnabled"
          :extra-style="childRelativeStyle(child)"
          :parent-scrollable="inScrollColumn"
          :icon-library="iconLibrary"
          :page-data="pageData"
          :hidden-node-ids="hiddenNodeIds"
          :component-map="componentMap"
          :dollar-props="dollarProps"
          :route-params="routeParams"
          @select="forwardSelect"
          @hover="forwardHover"
          @open-repeat="forwardOpenRepeat"
          @interact="forwardInteract"
        />
      </div>
    </OverlayScrollPort>
  </WidgetSelectShell>
  </template>
</template>

<style scoped>
.widget.swiper {
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}

/* RelativeLayout：承载绝对定位子节点；高度跟父内容区（已扣 padding） */
.relative-content {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
}

.fragment-host {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  box-sizing: border-box;
}

.fragment-host.is-root {
  min-height: 100%;
}

/* 仅含 Modal：不占文档流 */
.fragment-host.is-out-of-flow {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  min-height: 0;
  overflow: visible;
  pointer-events: none;
}

/* Modal 在原树中的锚点：独立出流，不挤开兄弟 */
.modal-flow-anchor {
  position: absolute;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
}

.modal-empty {
  width: 100%;
  padding: 16px 8px;
  font-size: 12px;
  color: #909399;
  text-align: center;
  pointer-events: none;
}

/* 尺寸由 modalPanelStyle 控制（铺满弹层，相对布局根） */
.modal-panel {
  position: relative;
}

.component-title {
  font-size: 13px;
  font-weight: 600;
}

.component-id {
  font-size: 11px;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.unsupported {
  padding: 8px;
  color: #f56c6c;
  font-size: 12px;
  border: 1px dashed #f56c6c;
}

.widget.button {
  font-family: inherit;
}

.widget.image {
  vertical-align: top;
  user-select: none;
}

.widget.icon {
  vertical-align: top;
  user-select: none;
  overflow: visible;
}

.widget.icon-var-placeholder {
  opacity: 0.72;
}

.widget.icon-placeholder {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px;
}

.widget.image-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 12px;
  border: 1px dashed #dcdfe6;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px;
}
</style>
