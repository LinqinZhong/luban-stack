<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, type CSSProperties, type ComputedRef } from 'vue'
import type { IconLibrary } from '../../types/icon-library'
import { findIcon, iconSymbolId } from '../../types/icon-library'
import type { PageData } from '../../types/page-data'
import type { ComponentRenderMap } from '../../types/component-render'
import type { XmlNode } from '../../utils/xml'
import type { PreviewEventKey, PreviewInteractPayload } from '../../utils/event-runtime'
import {
  isSupportedTag,
  parseBool,
  parseNumber,
  parseOverflow,
  parsePageXml,
  parseSize,
  borderStyle,
  overflowStyle,
  paddingStyle,
} from '../../utils/xml'
import { resolveMatchingStyleOverrides, evaluateScenarios } from '../../utils/dynamic-style-runtime'
import {
  buildDollarProps,
  interpolateDollarProps,
} from '../../utils/component-props'
import {
  DYNAMIC_STYLES_ATTR,
  V_IF_ATTR,
  V_SHOW_ATTR,
  parseVisibilityConditions,
} from '../../types/dynamic-styles'
import { countEventBindings, countNodeEventBindings, INTERACTION_EVENT_KEYS } from '../../types/page-method'
import WidgetSelectShell from './WidgetSelectShell.vue'
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
}>()

const emit = defineEmits<{
  select: [id: string]
  hover: [id: string]
  'open-repeat': [id: string]
  interact: [payload: PreviewInteractPayload]
}>()

const isEditorHidden = computed(() =>
  (props.hiddenNodeIds ?? []).includes(props.nodeId),
)

const runtimeScope = computed(() => ({
  ...(props.node.scope ?? {}),
  $props: props.dollarProps,
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

/** v-show：条件为假时隐藏但仍挂载 */
const visuallyHidden = computed(() => !showAllowed.value)

const previewClickable = computed(
  () => !props.selectable && countEventBindings(props.node.attrs.onClick) > 0,
)
const previewLongClickable = computed(
  () => !props.selectable && countEventBindings(props.node.attrs.onLongClick) > 0,
)
const previewInteractive = computed(
  () => previewClickable.value || previewLongClickable.value,
)

/** 基础 attrs + 按 scope / 数据池求值后的动态样式覆盖；预览态再替换 $props */
const attrs = computed(() => {
  const base = props.node.attrs
  const overrides = resolveMatchingStyleOverrides(
    base[DYNAMIC_STYLES_ATTR],
    props.pageData,
    runtimeScope.value,
  )
  let merged = Object.keys(overrides).length ? { ...base, ...overrides } : base

  if (!props.selectable && props.dollarProps) {
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
      next[key] = SKIP_DOLLAR_PROPS_ATTRS.has(key)
        ? value
        : interpolateDollarProps(value, props.dollarProps)
    }
    merged = next
  }
  return merged
})
const width = computed(() => parseSize(attrs.value.width, 'wrap_content'))
const height = computed(() => parseSize(attrs.value.height, 'wrap_content'))
const isSelected = computed(() => props.selectable && props.selectedId === props.nodeId)
const isHovered = computed(() => props.selectable && props.hoveredId === props.nodeId)

/** RelativeLayout 在纵向父布局中需占满剩余高度（绝对定位子节点依赖此盒子） */
const fillRemainingHeight = computed(() => props.node.tag === 'RelativeLayout')

/**
 * 纵向父布局内的普通子项按内容堆叠；RelativeLayout / 滚动视口除外。
 */
const stackInVerticalParent = computed(
  () =>
    Boolean(props.parentVertical) &&
    props.node.tag !== 'RelativeLayout',
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

const componentDetail = computed(() => {
  const id = attrs.value.componentId?.trim()
  if (!id || !props.componentMap) return null
  return props.componentMap[id] ?? null
})

const instanceDollarProps = computed(() =>
  buildDollarProps(componentDetail.value?.config, attrs.value),
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

const componentHostWidth = computed(() => {
  const fromAttr = attrs.value.width?.trim()
  if (fromAttr) return parseSize(fromAttr, 'wrap_content')
  const fromConfig = componentDetail.value?.config.width
  return parseSize(fromConfig, 'wrap_content')
})

const componentHostHeight = computed(() => {
  const fromAttr = attrs.value.height?.trim()
  if (fromAttr) return parseSize(fromAttr, 'wrap_content')
  const fromConfig = componentDetail.value?.config.height
  return parseSize(fromConfig, 'wrap_content')
})

const componentStyle = computed(() => {
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
  // 图片自身圆角仍需裁切，不受布局 overflow 属性控制
  ...(attrs.value.borderRadius ? { overflow: 'hidden' as const } : {}),
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
  ...(attrs.value.borderRadius ? { overflow: 'hidden' as const } : {}),
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
  () => parseOverflow(attrs.value.overflow, 'hidden') === 'scroll',
)

const injectedScrollColumn = inject<ComputedRef<boolean> | undefined>(
  SCROLL_COLUMN_KEY,
  undefined,
)

const ancestorInScrollColumn = computed(() => Boolean(injectedScrollColumn?.value))

/**
 * 向子孙声明「滚动内容列」：仅当自身/祖先带 overflow=scroll 的纵向布局。
 * 勿对所有纵向 LinearLayout 声明，否则内容区 RelativeLayout 会被当成堆叠而高度塌陷。
 */
const inScrollColumn = computed(
  () =>
    ancestorInScrollColumn.value ||
    (hasScrollAttr.value && attrs.value.orientation !== 'horizontal') ||
    Boolean(props.parentScrollable),
)

provide(
  SCROLL_COLUMN_KEY,
  computed(() => inScrollColumn.value),
)

const layoutOverflowStyle = computed(() => {
  if (props.selectable) return { overflow: 'visible' as const }
  return overflowStyle(attrs.value, 'hidden')
})

/** 预览态真正成为滚动容器 */
const isScrollLayout = computed(() => !props.selectable && hasScrollAttr.value)

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
              overflow: 'hidden',
            }
      : isScrollLayout.value
        ? { maxHeight: '100%', minHeight: 0 }
        : {}),
  }
})

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
          : { height: '100%', overflow: 'hidden' }
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

const eventBadgeCount = computed(() =>
  props.selectable ? countNodeEventBindings(attrs.value) : 0,
)

function childId(index: number, tag: string) {
  return `${props.nodeId}/${index}:${tag}`
}

function emitInteract(eventKey: PreviewEventKey) {
  const raw = props.node.attrs[eventKey]
  if (!raw?.trim()) return
  emit('interact', {
    eventKey,
    raw,
    scope: props.node.scope,
  })
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

onMounted(() => {
  if (props.selectable) return
  if (countEventBindings(props.node.attrs.onAppear) <= 0) return
  emitInteract('onAppear')
})

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

  <WidgetSelectShell
    v-else-if="node.tag === 'Text'"
    :selected="isSelected"
    :hovered="isHovered"
    :margin-attrs="attrs"
    :width="width"
    :height="height"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
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
    :margin-attrs="attrs"
    :width="componentHostWidth"
    :height="componentHostHeight"
    :parent-horizontal="parentHorizontal"
    :parent-vertical="parentVertical"
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
    <div class="widget component-host" :style="componentStyle">
      <XmlNodeView
        v-if="componentRoot"
        :node="componentRoot"
        :node-id="`${nodeId}/c:0:${componentRoot.tag}`"
        :selectable="false"
        :parent-scrollable="inScrollColumn"
        :icon-library="iconLibrary"
        :page-data="componentDetail?.data ?? pageData"
        :component-map="componentMap"
        :dollar-props="instanceDollarProps"
      />
      <div v-else :style="componentPlaceholderStyle">
        <div class="component-title">{{ attrs.name || attrs.componentId || 'Component' }}</div>
        <div class="component-id">{{ attrs.componentId ? '组件未找到或 XML 为空' : '未指定组件' }}</div>
      </div>
    </div>
  </WidgetSelectShell>

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
    <div
      class="widget linear"
      :class="{ 'is-scrollable': isScrollLayout }"
      :style="linearStyle"
      @wheel="isScrollLayout ? $event.stopPropagation() : undefined"
    >
      <XmlNodeView
        v-for="(child, index) in node.children"
        :key="childId(index, child.tag)"
        :node="child"
        :node-id="childId(index, child.tag)"
        :selected-id="selectedId"
        :hovered-id="hoveredId"
        :selectable="selectable"
        :parent-horizontal="isHorizontalLinear"
        :parent-vertical="!isHorizontalLinear"
        :parent-scrollable="inScrollColumn"
        :icon-library="iconLibrary"
        :page-data="pageData"
        :hidden-node-ids="hiddenNodeIds"
        :component-map="componentMap"
        :dollar-props="dollarProps"
        @select="forwardSelect"
        @hover="forwardHover"
        @open-repeat="forwardOpenRepeat"
        @interact="forwardInteract"
      />
    </div>
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
    <div
      class="widget relative"
      :class="{ 'is-scrollable': isScrollLayout }"
      :style="relativeStyle"
      @wheel="isScrollLayout ? $event.stopPropagation() : undefined"
    >
      <XmlNodeView
        v-for="(child, index) in node.children"
        :key="childId(index, child.tag)"
        :node="child"
        :node-id="childId(index, child.tag)"
        :selected-id="selectedId"
        :hovered-id="hoveredId"
        :selectable="selectable"
        :extra-style="childRelativeStyle(child)"
        :parent-scrollable="inScrollColumn"
        :icon-library="iconLibrary"
        :page-data="pageData"
        :hidden-node-ids="hiddenNodeIds"
        :component-map="componentMap"
        :dollar-props="dollarProps"
        @select="forwardSelect"
        @hover="forwardHover"
        @open-repeat="forwardOpenRepeat"
        @interact="forwardInteract"
      />
    </div>
  </WidgetSelectShell>
  </template>
</template>

<style scoped>
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

.widget.linear.is-scrollable,
.widget.relative.is-scrollable {
  flex: 1 1 0% !important;
  width: 100%;
  min-height: 0 !important;
  min-width: 0;
  align-self: stretch;
  /* 移动端风格滚动条：细、圆角、半透明 */
  scrollbar-width: thin;
  scrollbar-color: rgba(15, 23, 42, 0.28) transparent;
}

.widget.linear.is-scrollable::-webkit-scrollbar,
.widget.relative.is-scrollable::-webkit-scrollbar {
  width: 3px;
  height: 3px;
}

.widget.linear.is-scrollable::-webkit-scrollbar-track,
.widget.relative.is-scrollable::-webkit-scrollbar-track {
  background: transparent;
}

.widget.linear.is-scrollable::-webkit-scrollbar-thumb,
.widget.relative.is-scrollable::-webkit-scrollbar-thumb {
  background: rgba(15, 23, 42, 0.28);
  border-radius: 999px;
}

.widget.linear.is-scrollable::-webkit-scrollbar-thumb:hover,
.widget.relative.is-scrollable::-webkit-scrollbar-thumb:hover {
  background: rgba(15, 23, 42, 0.42);
}

.widget.linear.is-scrollable::-webkit-scrollbar-corner,
.widget.relative.is-scrollable::-webkit-scrollbar-corner {
  background: transparent;
}

.widget.button {
  font-family: inherit;
}

.widget.image {
  vertical-align: top;
  user-select: none;
  pointer-events: none;
}

.widget.icon {
  vertical-align: top;
  user-select: none;
  pointer-events: none;
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
