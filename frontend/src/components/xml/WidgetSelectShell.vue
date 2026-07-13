<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import {
  hasMargin,
  marginStyle,
  marginValues,
  matchParentAxisSize,
  parseSize,
} from '../../utils/xml'
import RepeatBadge from './RepeatBadge.vue'

const props = defineProps<{
  selected?: boolean
  hovered?: boolean
  marginAttrs: Record<string, string>
  width?: ReturnType<typeof parseSize>
  height?: ReturnType<typeof parseSize>
  parentHorizontal?: boolean
  parentVertical?: boolean
  fillParent?: boolean
  /** 编辑模式下，已配置 repeat 的指示角标 */
  repeatBadge?: boolean
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
  mouseenter: []
  'open-repeat': []
}>()

const matchParentWidth = computed(
  () => props.fillParent || props.width === 'match_parent',
)

const matchParentHeight = computed(
  () => props.fillParent || props.height === 'match_parent',
)

const shellStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    position: 'relative',
    maxWidth: '100%',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    ...marginStyle(props.marginAttrs),
  }

  if (props.fillParent) {
    style.flex = '1 1 auto'
    style.alignSelf = 'stretch'
    style.minHeight = '0'
    style.width = matchParentAxisSize('width', props.marginAttrs)
    style.height = matchParentAxisSize('height', props.marginAttrs)
    return style
  }

  if (props.width === 'match_parent') {
    if (props.parentHorizontal) {
      style.flex = '1 1 0%'
      style.minWidth = '0'
      style.width = 'auto'
    } else {
      style.alignSelf = 'stretch'
      style.width = 'auto'
    }
  }

  if (props.height === 'match_parent') {
    if (props.parentVertical) {
      style.flex = '1 1 0%'
      style.minHeight = '0'
      style.height = 'auto'
    } else {
      style.alignSelf = 'stretch'
      style.height = 'auto'
    }
  }

  return style
})

const marginBoxStyle = computed(() => ({
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column' as const,
  minHeight: 0,
  minWidth: 0,
  width: matchParentWidth.value ? '100%' : undefined,
  height: matchParentHeight.value ? '100%' : undefined,
}))

const contentBoxStyle = computed<CSSProperties>(() => ({
  position: 'relative',
  flex: matchParentHeight.value ? '1 1 auto' : undefined,
  display: 'flex',
  flexDirection: 'column' as const,
  minHeight: 0,
  minWidth: 0,
  width: matchParentWidth.value ? '100%' : undefined,
  height: matchParentHeight.value ? '100%' : undefined,
}))

const showMarginFrame = computed(
  () => (props.selected || props.hovered) && hasMargin(props.marginAttrs),
)

const showContentFrame = computed(() => props.selected || props.hovered)

const frameKind = computed(() => {
  if (props.selected) return 'selected'
  if (props.hovered) return 'hovered'
  return ''
})

const marginFrameStyle = computed<CSSProperties>(() => {
  if (!showMarginFrame.value) return {}
  const m = marginValues(props.marginAttrs)
  return {
    top: `${-m.top}px`,
    left: `${-m.left}px`,
    right: `${-m.right}px`,
    bottom: `${-m.bottom}px`,
  }
})

function onClick(event: MouseEvent) {
  emit('click', event)
}
</script>

<template>
  <div
    class="select-shell"
    :style="shellStyle"
    @click="onClick"
    @mouseenter="emit('mouseenter')"
  >
    <div
      v-if="showMarginFrame"
      class="frame-margin"
      :class="frameKind"
      :style="marginFrameStyle"
    />
    <div class="margin-box" :style="marginBoxStyle">
      <div
        class="content-box"
        :class="{ selected, hovered: hovered && !selected }"
        :style="contentBoxStyle"
      >
        <slot />
        <div v-if="showContentFrame" class="frame-content" :class="frameKind" />
        <RepeatBadge
          v-if="repeatBadge"
          class="repeat-badge-corner"
          clickable
          @click="emit('open-repeat')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.select-shell {
  overflow: visible;
}

.margin-box {
  position: relative;
  height: 100%;
}

.content-box.selected {
  z-index: 2;
}

.content-box.hovered {
  z-index: 1;
}

.frame-content,
.frame-margin {
  position: absolute;
  pointer-events: none;
  box-sizing: border-box;
  z-index: 20;
}

.frame-content {
  inset: 0;
}

.frame-content.selected {
  border: 2px solid #fadb14;
}

.frame-content.hovered {
  border: 2px solid #ff85c0;
}

.frame-margin {
  inset: 0;
}

.frame-margin.selected {
  border: 2px dashed #fadb14;
}

.frame-margin.hovered {
  border: 2px dashed #ff85c0;
}

.repeat-badge-corner {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 25;
  /* 中心对齐控件右上角 */
  transform: translate(50%, -50%);
}
</style>
