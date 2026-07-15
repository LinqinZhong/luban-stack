<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
  type Ref,
} from 'vue'
import { BADGE_HOST_KEY } from '../../composables/useModalStack'
import {
  hasMargin,
  marginStyle,
  marginValues,
  matchParentAxisSize,
  parseSize,
} from '../../utils/xml'
import RepeatBadge from './RepeatBadge.vue'
import EventBadge from './EventBadge.vue'

const props = defineProps<{
  selected?: boolean
  hovered?: boolean
  marginAttrs: Record<string, string>
  width?: ReturnType<typeof parseSize>
  height?: ReturnType<typeof parseSize>
  parentHorizontal?: boolean
  parentVertical?: boolean
  /** 根节点：填满画布；勿用于 RelativeLayout 子节点 */
  fillParent?: boolean
  /** RelativeLayout 子节点的定位样式（position/top/left 等） */
  extraStyle?: CSSProperties
  /** 编辑模式下，已配置 repeat 的指示角标 */
  repeatBadge?: boolean
  /** 编辑模式下，已绑定事件方法的角标数量 */
  eventBadgeCount?: number
  /** 类似 v-show：保留节点但隐藏 */
  visuallyHidden?: boolean
  /** 预览态可点击（事件绑定） */
  interactive?: boolean
  /** 预览态滚动容器：壳层需要压住高度，否则子内容撑开后无法滚 */
  scrollPort?: boolean
  /**
   * 位于纵向滚动列内部：match_parent 高度按内容堆叠，
   * 不要 flex:1/height:0，否则兄弟会叠在同一视口。
   */
  insideScrollPort?: boolean
  /**
   * 纵向父布局内需要「占满剩余高度」的节点（height=match_parent）。
   * 仅此类节点使用 flex:1；其它纵向子项按内容堆叠。
   */
  fillRemainingHeight?: boolean
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
  mouseenter: []
  'open-repeat': []
}>()

const matchParentWidth = computed(() => props.width === 'match_parent')
const matchParentHeight = computed(() => props.height === 'match_parent')
const isAbsolute = computed(() => props.extraStyle?.position === 'absolute')
/** 仅 width=match_parent 时，left+right 才拉伸；wrap_content 不跟对边拉满 */
const absoluteStretchedX = computed(() => {
  if (!isAbsolute.value || !props.extraStyle || !matchParentWidth.value) return false
  return props.extraStyle.left != null && props.extraStyle.right != null
})

/** 仅 height=match_parent 时，top+bottom 才拉伸 */
const absoluteStretchedY = computed(() => {
  if (!isAbsolute.value || !props.extraStyle || !matchParentHeight.value) return false
  return props.extraStyle.top != null && props.extraStyle.bottom != null
})

const shellStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    position: 'relative',
    maxWidth: '100%',
    display: props.visuallyHidden ? 'none' : 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    cursor: props.interactive ? 'pointer' : undefined,
    ...marginStyle(props.marginAttrs),
    ...(props.extraStyle ?? {}),
  }

  // 绝对定位子节点：按自身 width/height，勿强制撑满父级
  if (isAbsolute.value) {
    // wrap_content / 固定宽：去掉对边定位，避免 left+right 把盒子拉满
    if (!matchParentWidth.value && style.left != null && style.right != null) {
      style.right = undefined
    }
    if (!matchParentHeight.value && style.top != null && style.bottom != null) {
      style.bottom = undefined
    }

    if (absoluteStretchedX.value) {
      // left + right 已拉满，不要再写 width:100% 破坏约束
      style.width = undefined
      style.minWidth = 0
    } else if (matchParentWidth.value) {
      style.width = matchParentAxisSize('width', props.marginAttrs)
      style.minWidth = 0
    } else if (typeof props.width === 'number') {
      style.width = `${props.width}px`
      style.flexShrink = 0
    } else {
      style.width = 'fit-content'
      style.maxWidth = '100%'
    }

    if (absoluteStretchedY.value) {
      // top + bottom 已拉满，不要再写 height:100% 破坏约束
      style.height = undefined
      if (props.scrollPort) {
        style.minHeight = 0
        style.overflow = 'hidden'
      }
    } else if (matchParentHeight.value) {
      style.height = matchParentAxisSize('height', props.marginAttrs)
      if (props.scrollPort) {
        style.minHeight = 0
        style.overflow = 'hidden'
      }
    } else if (typeof props.height === 'number') {
      style.height = `${props.height}px`
      style.flexShrink = 0
    } else {
      style.height = 'fit-content'
    }
    return style
  }

  if (props.fillParent) {
    style.flex = '1 1 auto'
    style.alignSelf = 'stretch'
    style.minHeight = 0
    style.minWidth = 0
    if (matchParentWidth.value || props.width === undefined) {
      style.width = matchParentAxisSize('width', props.marginAttrs)
    } else if (typeof props.width === 'number') {
      style.width = `${props.width}px`
    }
    if (matchParentHeight.value || props.height === undefined) {
      style.height = matchParentAxisSize('height', props.marginAttrs)
    } else if (typeof props.height === 'number') {
      style.height = `${props.height}px`
    }
    if (props.scrollPort) style.overflow = 'hidden'
    return style
  }

  if (matchParentWidth.value) {
    if (props.parentHorizontal) {
      style.flex = '1 1 0%'
      style.minWidth = 0
      style.width = 'auto'
    } else {
      style.alignSelf = 'stretch'
      style.width = 'auto'
    }
  } else if (typeof props.width === 'number') {
    style.width = `${props.width}px`
    style.flexShrink = 0
  }

  if (matchParentHeight.value) {
    if (props.scrollPort) {
      // 自身是滚动视口：压住高度，才能滚（此处需要 min-height:0）
      style.flex = '1 1 0%'
      style.minHeight = 0
      style.height = '0'
      style.overflow = 'hidden'
    } else if (props.parentVertical && props.fillRemainingHeight) {
      // RelativeLayout 等内容区：占满剩余高度
      style.flex = '1 1 0%'
      style.minHeight = 0
      style.height = '0'
    } else if (props.insideScrollPort || props.parentVertical) {
      // 按内容堆叠：不要 min-height:0，否则会被压矮，内容溢出叠到兄弟上
      style.alignSelf = 'stretch'
      style.height = 'auto'
      style.flex = '0 0 auto'
      style.flexShrink = 0
    } else {
      style.alignSelf = 'stretch'
      style.height = 'auto'
    }
  } else if (typeof props.height === 'number') {
    style.height = `${props.height}px`
    style.flexShrink = 0
    if (props.scrollPort) style.overflow = 'hidden'
  }

  return style
})

const fillWidth = computed(
  () => matchParentWidth.value || absoluteStretchedX.value,
)

const fillHeight = computed(
  () => matchParentHeight.value || absoluteStretchedY.value,
)

/** 纵向普通子项按内容堆叠；match_parent 撑满项除外 */
const stackByContent = computed(
  () =>
    !props.scrollPort &&
    (props.insideScrollPort ||
      (props.parentVertical && !props.fillRemainingHeight)),
)

/** 仅占满/滚动时才允许缩到内容以下；堆叠项保持内容最小高度 */
const allowShrinkBelowContent = computed(
  () => props.scrollPort || (matchParentHeight.value && !stackByContent.value),
)

const marginBoxStyle = computed(() => ({
  flex: allowShrinkBelowContent.value ? '1 1 0%' : '0 0 auto',
  display: 'flex',
  flexDirection: 'column' as const,
  minHeight: allowShrinkBelowContent.value ? 0 : undefined,
  minWidth: allowShrinkBelowContent.value || props.parentHorizontal ? 0 : undefined,
  width: fillWidth.value ? '100%' : undefined,
  height: stackByContent.value ? 'auto' : fillHeight.value ? '100%' : undefined,
  ...(props.scrollPort ? { overflow: 'hidden' as const } : {}),
}))

const contentBoxStyle = computed<CSSProperties>(() => ({
  position: 'relative',
  flex: allowShrinkBelowContent.value ? '1 1 0%' : '0 0 auto',
  display: 'flex',
  flexDirection: 'column' as const,
  minHeight: allowShrinkBelowContent.value ? 0 : undefined,
  minWidth: allowShrinkBelowContent.value || props.parentHorizontal ? 0 : undefined,
  width: fillWidth.value ? '100%' : undefined,
  height: stackByContent.value ? 'auto' : fillHeight.value ? '100%' : undefined,
  ...(props.scrollPort ? { overflow: 'hidden' as const } : {}),
}))

const showMarginFrame = computed(
  () => (props.selected || props.hovered) && hasMargin(props.marginAttrs),
)

const showContentFrame = computed(() => props.selected || props.hovered)

const hasBadges = computed(
  () => Boolean(props.repeatBadge) || (props.eventBadgeCount ?? 0) > 0,
)

const badgeHostRef = inject<Ref<HTMLElement | null> | null>(BADGE_HOST_KEY, null)
const badgeHostEl = computed(() => badgeHostRef?.value ?? null)
const contentBoxRef = ref<HTMLElement | null>(null)
const badgeAnchorStyle = ref<CSSProperties>({ visibility: 'hidden' })
let badgeSyncRaf = 0
let badgeLiveRaf = 0
let badgeResizeObserver: ResizeObserver | null = null

const useBadgeTeleport = computed(
  () => hasBadges.value && Boolean(badgeHostEl.value),
)

function syncBadgeAnchor() {
  const host = badgeHostRef?.value
  const box = contentBoxRef.value
  if (!host || !box || !hasBadges.value) {
    badgeAnchorStyle.value = { visibility: 'hidden' }
    return
  }
  const hr = host.getBoundingClientRect()
  const br = box.getBoundingClientRect()
  // 锚定到 content-box 右上角，角标仍用 top/right + translate(50%,-50%)
  badgeAnchorStyle.value = {
    position: 'absolute',
    top: `${br.top - hr.top}px`,
    left: `${br.right - hr.left}px`,
    width: 0,
    height: 0,
    overflow: 'visible',
    pointerEvents: 'none',
    visibility: 'visible',
  }
}

function scheduleSyncBadgeAnchor() {
  if (badgeSyncRaf) cancelAnimationFrame(badgeSyncRaf)
  badgeSyncRaf = requestAnimationFrame(() => {
    badgeSyncRaf = 0
    syncBadgeAnchor()
  })
}

function startBadgeLiveSync() {
  if (badgeLiveRaf) return
  const tick = () => {
    if (!useBadgeTeleport.value) {
      badgeLiveRaf = 0
      return
    }
    syncBadgeAnchor()
    badgeLiveRaf = requestAnimationFrame(tick)
  }
  badgeLiveRaf = requestAnimationFrame(tick)
}

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

watch(
  useBadgeTeleport,
  async (enabled) => {
    await nextTick()
    scheduleSyncBadgeAnchor()
    if (enabled) startBadgeLiveSync()
  },
  { flush: 'post', immediate: true },
)

onMounted(() => {
  scheduleSyncBadgeAnchor()
  window.addEventListener('resize', scheduleSyncBadgeAnchor)
  window.addEventListener('scroll', scheduleSyncBadgeAnchor, true)
  if (typeof ResizeObserver !== 'undefined') {
    badgeResizeObserver = new ResizeObserver(() => scheduleSyncBadgeAnchor())
    if (contentBoxRef.value) badgeResizeObserver.observe(contentBoxRef.value)
    if (badgeHostEl.value) badgeResizeObserver.observe(badgeHostEl.value)
  }
})

watch(contentBoxRef, (el, prev) => {
  if (!badgeResizeObserver) return
  if (prev) badgeResizeObserver.unobserve(prev)
  if (el) badgeResizeObserver.observe(el)
})

onBeforeUnmount(() => {
  if (badgeSyncRaf) cancelAnimationFrame(badgeSyncRaf)
  if (badgeLiveRaf) cancelAnimationFrame(badgeLiveRaf)
  badgeLiveRaf = 0
  window.removeEventListener('resize', scheduleSyncBadgeAnchor)
  window.removeEventListener('scroll', scheduleSyncBadgeAnchor, true)
  badgeResizeObserver?.disconnect()
  badgeResizeObserver = null
})
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
        ref="contentBoxRef"
        class="content-box"
        :class="{ selected, hovered: hovered && !selected }"
        :style="contentBoxStyle"
      >
        <slot />
        <div v-if="showContentFrame" class="frame-content" :class="frameKind" />
        <div v-if="hasBadges && !useBadgeTeleport" class="badge-stack">
          <EventBadge
            v-if="(eventBadgeCount ?? 0) > 0"
            :count="eventBadgeCount"
          />
          <RepeatBadge
            v-if="repeatBadge"
            clickable
            @click="emit('open-repeat')"
          />
        </div>
      </div>
    </div>
    <Teleport v-if="useBadgeTeleport && badgeHostEl" :to="badgeHostEl">
      <div class="badge-anchor" :style="badgeAnchorStyle">
        <div class="badge-stack">
          <EventBadge
            v-if="(eventBadgeCount ?? 0) > 0"
            :count="eventBadgeCount"
          />
          <RepeatBadge
            v-if="repeatBadge"
            clickable
            @click="emit('open-repeat')"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.select-shell {
  overflow: visible;
}

.margin-box {
  position: relative;
  overflow: visible;
}

.content-box {
  overflow: visible;
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

.badge-stack {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 40;
  transform: translate(50%, -50%);
  display: flex;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}

.badge-stack > * {
  pointer-events: auto;
}
</style>
