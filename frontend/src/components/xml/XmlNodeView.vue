<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import type { XmlNode } from '../../utils/xml'
import {
  isSupportedTag,
  parseBool,
  parseNumber,
  parseSize,
  borderStyle,
  paddingStyle,
} from '../../utils/xml'
import WidgetSelectShell from './WidgetSelectShell.vue'
import XmlNodeView from './XmlNodeView.vue'

const props = defineProps<{
  node: XmlNode
  nodeId: string
  selectedId?: string
  hoveredId?: string
  selectable?: boolean
  parentHorizontal?: boolean
  /** 父级为纵向 LinearLayout */
  parentVertical?: boolean
  /** 页面根节点 */
  isRoot?: boolean
  /** RelativeLayout 子节点定位样式 */
  extraStyle?: CSSProperties
}>()

const emit = defineEmits<{
  select: [id: string]
  hover: [id: string]
  'open-repeat': [id: string]
}>()

const attrs = computed(() => props.node.attrs)
const width = computed(() => parseSize(attrs.value.width, 'wrap_content'))
const height = computed(() => parseSize(attrs.value.height, 'wrap_content'))
const isSelected = computed(() => props.selectable && props.selectedId === props.nodeId)
const isHovered = computed(() => props.selectable && props.hoveredId === props.nodeId)

const innerSizeStyle = computed(() => {
  const style: Record<string, string> = {}

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
    style.height = '100%'
    style.maxHeight = '100%'
    style.minHeight = '0'
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
  boxSizing: 'border-box' as const,
  ...(props.extraStyle ?? {}),
}))

const textContent = computed(
  () => attrs.value.text || props.node.text || '',
)

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
  cursor: props.selectable ? 'pointer' : 'default',
  minHeight: height.value === 'wrap_content' ? '36px' : undefined,
}))

const linearStyle = computed(() => {
  const horizontal = attrs.value.orientation === 'horizontal'
  const matchHeight = height.value === 'match_parent'
  const matchWidth = width.value === 'match_parent'
  return {
    ...layoutStyle.value,
    ...borderStyle(attrs.value),
    display: 'flex',
    flexDirection: (horizontal ? 'row' : 'column') as 'row' | 'column',
    alignItems: mapGravityCross(attrs.value.gravity, horizontal),
    justifyContent: mapGravityMain(attrs.value.gravity, horizontal),
    gap: attrs.value.gap ? `${parseNumber(attrs.value.gap)}px` : undefined,
    background: attrs.value.background || 'transparent',
    position: 'relative' as const,
    ...(matchWidth ? { width: '100%', minWidth: 0 } : {}),
    ...(matchHeight
      ? { height: '100%', flex: '1 1 auto', minHeight: 0 }
      : {}),
  }
})

const relativeStyle = computed(() => {
  const matchHeight = height.value === 'match_parent'
  const matchWidth = width.value === 'match_parent'
  return {
    ...layoutStyle.value,
    ...borderStyle(attrs.value),
    position: 'relative' as const,
    background: attrs.value.background || 'transparent',
    ...(matchWidth ? { width: '100%' } : {}),
    ...(matchHeight ? { height: '100%' } : {}),
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

const isRelativeChild = computed(() => Boolean(props.extraStyle?.position === 'absolute'))

const showRepeatBadge = computed(
  () => Boolean(props.selectable && attrs.value.repeat?.trim()),
)

function childId(index: number, tag: string) {
  return `${props.nodeId}/${index}:${tag}`
}

function handleSelect(event: MouseEvent) {
  if (!props.selectable) return
  event.stopPropagation()
  emit('select', props.nodeId)
}

function handleMouseEnter() {
  if (!props.selectable) return
  emit('hover', props.nodeId)
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
</script>

<template>
  <div
    v-if="!isSupportedTag(node.tag)"
    class="unsupported"
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
    :fill-parent="isRelativeChild"
    :repeat-badge="showRepeatBadge"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
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
    :fill-parent="isRelativeChild"
    :repeat-badge="showRepeatBadge"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @open-repeat="handleOpenRepeat"
  >
    <button type="button" class="widget button" :style="buttonStyle">
      {{ textContent || 'Button' }}
    </button>
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
    :fill-parent="isRelativeChild || isRoot"
    :repeat-badge="showRepeatBadge"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @open-repeat="handleOpenRepeat"
  >
    <div class="widget linear" :style="linearStyle">
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
        @select="forwardSelect"
        @hover="forwardHover"
        @open-repeat="forwardOpenRepeat"
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
    :fill-parent="isRelativeChild || isRoot"
    :repeat-badge="showRepeatBadge"
    @click="handleSelect"
    @mouseenter="handleMouseEnter"
    @open-repeat="handleOpenRepeat"
  >
    <div class="widget relative" :style="relativeStyle">
      <XmlNodeView
        v-for="(child, index) in node.children"
        :key="childId(index, child.tag)"
        :node="child"
        :node-id="childId(index, child.tag)"
        :selected-id="selectedId"
        :hovered-id="hoveredId"
        :selectable="selectable"
        :extra-style="childRelativeStyle(child)"
        @select="forwardSelect"
        @hover="forwardHover"
        @open-repeat="forwardOpenRepeat"
      />
    </div>
  </WidgetSelectShell>
</template>

<style scoped>
.unsupported {
  padding: 8px;
  color: #f56c6c;
  font-size: 12px;
  border: 1px dashed #f56c6c;
}

.widget.linear,
.widget.relative {
  min-height: 0;
  min-width: 0;
}

.widget.button {
  font-family: inherit;
}
</style>
