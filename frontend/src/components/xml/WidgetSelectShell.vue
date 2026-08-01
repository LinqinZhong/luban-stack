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
import { BADGE_HOST_KEY, CANVAS_TOOL_MODE_KEY, type CanvasToolMode } from '../../composables/useModalStack'
import {
  INSPECT_HOST_KEY,
  PHONE_FRAME_KEY,
  getInspectButtonY,
  removeInspectCallout,
  subscribeInspectLayout,
  upsertInspectCallout,
} from '../../composables/useInspectCalloutLayout'
import {
  hasMargin,
  marginStyle,
  marginValues,
  matchParentAxisSize,
  parseSize,
} from '../../utils/xml'
import RepeatBadge from './RepeatBadge.vue'
import EventBadge from './EventBadge.vue'
import InspectBadge from './InspectBadge.vue'

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
  /** 预览态：组件旁显示调试操纵杆 */
  inspectBadge?: boolean
  /** 预览态：操纵杆旁显示的组件名 */
  inspectLabel?: string
  /** 预览态：当前正在检视该组件 */
  inspectActive?: boolean
  /** 类似 v-show：保留节点但隐藏（不占位，display:none） */
  visuallyHidden?: boolean
  /**
   * 编辑态眼睛隐藏：visibility:hidden，占位保留。
   * 与 visuallyHidden 同时为真时仍以 display:none 为准。
   */
  visibilityHidden?: boolean
  /** 预览态可点击（事件绑定） */
  interactive?: boolean
  /** 预览态滚动容器：壳层需要压住高度，否则子内容撑开后无法滚 */
  scrollPort?: boolean
  /**
   * 编辑态允许横向溢出（Swiper/多窗体平铺），即使 scrollPort 也不裁切。
   */
  overflowVisible?: boolean
  /**
   * 位于纵向滚动列内部：未声明「占满剩余」时按内容堆叠，
   * 不要 flex:1/height:0，否则兄弟会叠在同一视口。
   */
  insideScrollPort?: boolean
  /**
   * 纵向父布局内需要「占满剩余高度」的节点（height=match_parent）。
   * 仅此类节点使用 flex:1；其它纵向子项按内容堆叠。
   */
  fillRemainingHeight?: boolean
  /** 右键菜单定位用：节点 path id */
  widgetNodeId?: string
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
  mouseenter: []
  'open-repeat': []
  'open-event': []
  'open-inspect': []
}>()

const matchParentWidth = computed(() => props.width === 'match_parent')
const matchParentHeight = computed(() => props.height === 'match_parent')
const isAbsolute = computed(() => props.extraStyle?.position === 'absolute')
/** scrollPort 默认裁切；编辑态 overflowVisible 时放开，露出平铺页 */
const scrollPortClip = computed(
  () => Boolean(props.scrollPort) && !props.overflowVisible,
)
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

  // 放在 extraStyle 之后，避免被覆盖；占位保留
  if (props.visibilityHidden && !props.visuallyHidden) {
    style.visibility = 'hidden'
    style.pointerEvents = 'none'
  }

  const zRaw = props.marginAttrs.zIndex?.trim()
  if (zRaw) {
    const n = Number(zRaw.replace(/px$/i, ''))
    if (Number.isFinite(n)) style.zIndex = n
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
        if (scrollPortClip.value) style.overflow = 'hidden'
        else style.overflow = 'visible'
      }
    } else if (matchParentHeight.value) {
      style.height = matchParentAxisSize('height', props.marginAttrs)
      if (props.scrollPort) {
        style.minHeight = 0
        if (scrollPortClip.value) style.overflow = 'hidden'
        else style.overflow = 'visible'
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
    style.minHeight = 0
    style.minWidth = 0
    const wrapW = props.width === 'wrap_content'
    const wrapH = props.height === 'wrap_content'
    // wrap_content：按内容收缩，不超过画布；勿 stretch 拉满
    if (wrapW || wrapH) {
      style.flex = '0 0 auto'
      style.alignSelf = wrapW ? 'flex-start' : 'stretch'
    } else {
      style.flex = '1 1 auto'
      style.alignSelf = 'stretch'
    }
    if (matchParentWidth.value || props.width === undefined) {
      style.width = matchParentAxisSize('width', props.marginAttrs)
    } else if (typeof props.width === 'number') {
      style.width = `${props.width}px`
    } else if (wrapW) {
      style.width = 'fit-content'
      style.maxWidth = '100%'
    }
    if (matchParentHeight.value || props.height === undefined) {
      style.height = matchParentAxisSize('height', props.marginAttrs)
    } else if (typeof props.height === 'number') {
      style.height = `${props.height}px`
    } else if (wrapH) {
      style.height = 'fit-content'
      style.maxHeight = '100%'
    }
    if (scrollPortClip.value) style.overflow = 'hidden'
    else if (props.scrollPort) style.overflow = 'visible'
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
      if (scrollPortClip.value) style.overflow = 'hidden'
      else style.overflow = 'visible'
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
    if (scrollPortClip.value) style.overflow = 'hidden'
    else if (props.scrollPort) style.overflow = 'visible'
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
    !props.fillRemainingHeight &&
    (props.insideScrollPort || props.parentVertical),
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
  ...(scrollPortClip.value ? { overflow: 'hidden' as const } : {}),
  ...(props.scrollPort && props.overflowVisible
    ? { overflow: 'visible' as const }
    : {}),
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
  ...(scrollPortClip.value ? { overflow: 'hidden' as const } : {}),
  ...(props.scrollPort && props.overflowVisible
    ? { overflow: 'visible' as const }
    : {}),
}))

const showMarginFrame = computed(
  () => (props.selected || props.hovered) && hasMargin(props.marginAttrs),
)

const showContentFrame = computed(
  () => props.selected || props.hovered || props.inspectActive,
)

const badgeHostRef = inject<Ref<HTMLElement | null> | null>(BADGE_HOST_KEY, null)
const inspectHostRef = inject<Ref<HTMLElement | null> | null>(INSPECT_HOST_KEY, null)
const phoneFrameRef = inject<Ref<HTMLElement | null> | null>(PHONE_FRAME_KEY, null)
const toolMode = inject<Ref<CanvasToolMode> | null>(CANVAS_TOOL_MODE_KEY, null)

/** 编辑态事件/循环角标（右上角） */
const hasEditBadges = computed(
  () =>
    toolMode?.value !== 'measure' &&
    (Boolean(props.repeatBadge) || (props.eventBadgeCount ?? 0) > 0),
)
/** 预览组件模式操纵杆（左右外延） */
const hasInspectBadge = computed(
  () => toolMode?.value !== 'measure' && Boolean(props.inspectBadge),
)
const hasBadges = computed(() => hasEditBadges.value || hasInspectBadge.value)
const badgeHostEl = computed(() => badgeHostRef?.value ?? null)
const inspectHostEl = computed(() => inspectHostRef?.value ?? null)
const contentBoxRef = ref<HTMLElement | null>(null)
const badgeAnchorStyle = ref<CSSProperties>({ visibility: 'hidden' })
const inspectAnchorStyle = ref<CSSProperties>({ visibility: 'hidden' })
const inspectSide = ref<'left' | 'right'>('right')
/** 水平伸出到屏外（手机本地 px） */
const inspectStemH = ref(28)
/** 按钮相对锚点纵向偏移（向上为负） */
const inspectRise = ref(-16)
const INSPECT_BTN = 18
/** 按钮落点距手机外缘（越大离屏幕越远） */
const OUTSIDE_PAD = 72
/** 最近一次同步的组件中线 Y（检视布局订阅用） */
let lastInspectMidY = 0
let badgeSyncRaf = 0
let badgeLiveRaf = 0
let badgeResizeObserver: ResizeObserver | null = null
let unsubInspectLayout: (() => void) | null = null

const useBadgeTeleport = computed(
  () => hasEditBadges.value && Boolean(badgeHostEl.value),
)
const useInspectTeleport = computed(
  () => hasInspectBadge.value && Boolean(inspectHostEl.value),
)

function syncBadgeAnchor() {
  const box = contentBoxRef.value
  if (!box) {
    badgeAnchorStyle.value = { visibility: 'hidden' }
    inspectAnchorStyle.value = { visibility: 'hidden' }
    return
  }
  const br = box.getBoundingClientRect()
  const badgeHost = badgeHostRef?.value
  const bhr = badgeHost?.getBoundingClientRect()
  const phone = phoneFrameRef?.value ?? badgeHost
  const pr = phone?.getBoundingClientRect()
  const inspectHost = inspectHostRef?.value
  const ihr = inspectHost?.getBoundingClientRect()

  // 左右：相对手机屏中线
  if (hasInspectBadge.value) {
    const boxMidX = (br.left + br.right) / 2
    const midX = pr ? (pr.left + pr.right) / 2 : window.innerWidth / 2
    inspectSide.value = boxMidX >= midX ? 'right' : 'left'
  }

  if (hasEditBadges.value && badgeHost && bhr && bhr.width >= 1) {
    const scaleX = badgeHost.offsetWidth / bhr.width
    const scaleY = badgeHost.offsetHeight / bhr.height
    badgeAnchorStyle.value = {
      position: 'absolute',
      top: `${(br.top - bhr.top) * scaleY}px`,
      left: `${(br.right - bhr.left) * scaleX}px`,
      width: 0,
      height: 0,
      overflow: 'visible',
      pointerEvents: 'none',
      visibility: 'visible',
    }
  } else {
    badgeAnchorStyle.value = { visibility: 'hidden' }
  }

  if (hasInspectBadge.value && inspectHost && ihr && pr && ihr.width >= 1) {
    const scaleX = inspectHost.offsetWidth / ihr.width
    const scaleY = inspectHost.offsetHeight / ihr.height
    const side = inspectSide.value
    const edgeX = side === 'right' ? br.right : br.left
    const midY = (br.top + br.bottom) / 2
    const phoneEdge = side === 'right' ? pr.right : pr.left
    // 水平段：组件边 → 屏外 pad
    const stemScreen =
      side === 'right'
        ? phoneEdge + OUTSIDE_PAD - edgeX
        : edgeX - (phoneEdge - OUTSIDE_PAD)
    const nextStem = Math.max(16, stemScreen * scaleX)
    if (Math.abs(inspectStemH.value - nextStem) > 0.5) {
      inspectStemH.value = nextStem
    }

    const midLocalY = (midY - ihr.top) * scaleY
    lastInspectMidY = midLocalY
    const calloutId = props.widgetNodeId || 'inspect'
    const preferredBtnY = midLocalY - 16
    const buttonY = upsertInspectCallout({
      id: calloutId,
      side,
      preferredY: preferredBtnY,
      btnSize: INSPECT_BTN,
    })
    const nextRise = buttonY - midLocalY
    if (Math.abs(inspectRise.value - nextRise) > 0.5) {
      inspectRise.value = nextRise
    }

    const nextLeft = (edgeX - ihr.left) * scaleX
    const prev = inspectAnchorStyle.value
    const prevTop = typeof prev.top === 'string' ? parseFloat(prev.top) : NaN
    const prevLeft = typeof prev.left === 'string' ? parseFloat(prev.left) : NaN
    if (
      prev.visibility !== 'visible' ||
      !Number.isFinite(prevTop) ||
      !Number.isFinite(prevLeft) ||
      Math.abs(prevTop - midLocalY) > 0.5 ||
      Math.abs(prevLeft - nextLeft) > 0.5
    ) {
      inspectAnchorStyle.value = {
        position: 'absolute',
        top: `${midLocalY}px`,
        left: `${nextLeft}px`,
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
        visibility: 'visible',
        zIndex: 100060,
      }
    }
  } else {
    if (props.widgetNodeId) removeInspectCallout(props.widgetNodeId)
    if (inspectAnchorStyle.value.visibility !== 'hidden') {
      inspectAnchorStyle.value = { visibility: 'hidden' }
    }
  }
}

function scheduleSyncBadgeAnchor() {
  if (badgeSyncRaf) cancelAnimationFrame(badgeSyncRaf)
  badgeSyncRaf = requestAnimationFrame(() => {
    badgeSyncRaf = 0
    syncBadgeAnchor()
  })
}

const needBadgeSync = computed(
  () => hasEditBadges.value || hasInspectBadge.value,
)

function startBadgeLiveSync() {
  if (badgeLiveRaf) return
  const tick = () => {
    if (!needBadgeSync.value) {
      badgeLiveRaf = 0
      return
    }
    syncBadgeAnchor()
    badgeLiveRaf = requestAnimationFrame(tick)
  }
  badgeLiveRaf = requestAnimationFrame(tick)
}

unsubInspectLayout = subscribeInspectLayout(() => {
  if (!hasInspectBadge.value || !props.widgetNodeId) return
  const y = getInspectButtonY(props.widgetNodeId)
  if (y == null) return
  const nextRise = y - lastInspectMidY
  if (Math.abs(inspectRise.value - nextRise) > 0.5) {
    inspectRise.value = nextRise
  }
})

const frameKind = computed(() => {
  if (props.selected) return 'selected'
  if (props.inspectActive) return 'inspecting'
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
  needBadgeSync,
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
    if (inspectHostEl.value) badgeResizeObserver.observe(inspectHostEl.value)
  }
})

watch(inspectHostEl, (el, prev) => {
  if (!badgeResizeObserver) return
  if (prev) badgeResizeObserver.unobserve(prev)
  if (el) badgeResizeObserver.observe(el)
  scheduleSyncBadgeAnchor()
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
  unsubInspectLayout?.()
  unsubInspectLayout = null
  if (props.widgetNodeId) removeInspectCallout(props.widgetNodeId)
})
</script>

<template>
  <div
    class="select-shell"
    :style="shellStyle"
    :data-widget-node-id="widgetNodeId || undefined"
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
        :class="{
          selected,
          hovered: hovered && !selected && !inspectActive,
          inspecting: inspectActive && !selected,
        }"
        :style="contentBoxStyle"
      >
        <slot />
        <div v-if="showContentFrame" class="frame-content" :class="frameKind" />
        <div v-if="hasEditBadges && !useBadgeTeleport" class="badge-stack">
          <EventBadge
            v-if="(eventBadgeCount ?? 0) > 0"
            :count="eventBadgeCount"
            clickable
            @click="emit('open-event')"
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
            clickable
            @click="emit('open-event')"
          />
          <RepeatBadge
            v-if="repeatBadge"
            clickable
            @click="emit('open-repeat')"
          />
        </div>
      </div>
    </Teleport>
    <!-- 操纵杆挂到手机框外层，避免被 phone overflow 裁切 -->
    <Teleport v-if="useInspectTeleport && inspectHostEl" :to="inspectHostEl">
      <div class="badge-anchor" :style="inspectAnchorStyle">
        <InspectBadge
          :side="inspectSide"
          :active="inspectActive"
          :label="inspectLabel"
          :size="INSPECT_BTN"
          :stem-h="inspectStemH"
          :rise="inspectRise"
          @click="emit('open-inspect')"
        />
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

/* 边框按 1/zoom 反缩放，屏幕上始终约 1px；黄色一律虚线 */
.content-box.selected,
.content-box.inspecting {
  outline: calc(1px / var(--canvas-zoom, 1)) dashed #d48806;
  outline-offset: calc(-1px / var(--canvas-zoom, 1));
  background-color: rgba(212, 136, 6, 0.08);
}

.content-box.hovered {
  outline: calc(1px / var(--canvas-zoom, 1)) solid #c41d7f;
  outline-offset: calc(-1px / var(--canvas-zoom, 1));
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

.frame-content.selected,
.frame-content.inspecting {
  border: calc(1px / var(--canvas-zoom, 1)) dashed #d48806;
}

.frame-content.hovered {
  border: calc(1px / var(--canvas-zoom, 1)) solid #c41d7f;
}

.frame-margin {
  inset: 0;
}

.frame-margin.selected,
.frame-margin.inspecting {
  border: calc(1px / var(--canvas-zoom, 1)) dashed #d48806;
}

.frame-margin.hovered {
  border: calc(1px / var(--canvas-zoom, 1)) dashed #c41d7f;
}

.badge-stack {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 100040;
  transform: translate(50%, -50%);
  display: flex;
  align-items: center;
  gap: calc(4px / max(var(--canvas-zoom, 1), 1));
  pointer-events: none;
}

.badge-stack > * {
  pointer-events: auto;
}

.inspect-local {
  position: absolute;
  top: 50%;
  z-index: 100050;
  width: 0;
  height: 0;
  pointer-events: none;
}

.inspect-local.side-right {
  right: 0;
}

.inspect-local.side-left {
  left: 0;
}
</style>
