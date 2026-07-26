<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
} from 'vue'

const props = defineProps<{
  enabled?: boolean
  contentClass?: string | Record<string, boolean> | Array<string | Record<string, boolean>>
  contentStyle?: CSSProperties
}>()

type ScrollDetail = {
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  scrollWidth: number
  clientHeight: number
  clientWidth: number
}

type TouchDetail = {
  clientX: number
  clientY: number
  pageX: number
  pageY: number
}

const emit = defineEmits<{
  wheel: [event: WheelEvent]
  scroll: [detail: ScrollDetail]
  scrollToLower: [detail: ScrollDetail]
  scrollToUpper: [detail: ScrollDetail]
  touchStart: [detail: TouchDetail]
  touchMove: [detail: TouchDetail]
  touchEnd: [detail: TouchDetail]
}>()

/** 触底 / 触顶判定阈值（px） */
const EDGE_THRESHOLD_PX = 50
let atLowerEdge = false
let atUpperEdge = true

const bodyRef = ref<HTMLElement | null>(null)
const thumbVisible = ref(false)
const thumbTop = ref(0)
const thumbHeight = ref(24)
const canScroll = ref(false)
const dragScrolling = ref(false)

let hideTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null

/** 鼠标拖拽模拟触摸滑动 */
let dragPointerId: number | null = null
let dragStartY = 0
let dragStartScrollTop = 0
let dragMoved = false
let suppressClick = false
const DRAG_THRESHOLD_PX = 6

/** 松手惯性：近期指针采样推算速度，再按指数衰减滑行 */
type VelocitySample = { y: number; t: number }
let velocitySamples: VelocitySample[] = []
let momentumRaf: number | null = null
const VELOCITY_WINDOW_MS = 100
const MIN_INERTIA_VELOCITY = 0.05 // px/ms
const MAX_INERTIA_VELOCITY = 3.2 // px/ms
const INERTIA_FRICTION = 0.0032 // 越大停得越快
const INERTIA_STOP_VELOCITY = 0.02 // px/ms

const thumbStyle = computed(() => ({
  height: `${thumbHeight.value}px`,
  transform: `translateY(${thumbTop.value}px)`,
}))

function stopMomentum() {
  if (momentumRaf == null) return
  cancelAnimationFrame(momentumRaf)
  momentumRaf = null
}

function pushVelocitySample(y: number, t = performance.now()) {
  velocitySamples.push({ y, t })
  const cutoff = t - VELOCITY_WINDOW_MS
  while (velocitySamples.length > 0 && velocitySamples[0]!.t < cutoff) {
    velocitySamples.shift()
  }
}

/** 手指速度（px/ms，向下为正） */
function releaseFingerVelocity(): number {
  if (velocitySamples.length < 2) return 0
  const first = velocitySamples[0]!
  const last = velocitySamples[velocitySamples.length - 1]!
  const dt = last.t - first.t
  if (dt < 12) return 0
  return (last.y - first.y) / dt
}

function startMomentum(fingerVelocityPxPerMs: number) {
  stopMomentum()
  const el = bodyRef.value
  if (!el || !props.enabled) return

  // 拖拽时 scrollTop = start - dy → 滚动速度 = -手指速度
  let velocity = -fingerVelocityPxPerMs
  const abs = Math.abs(velocity)
  if (abs < MIN_INERTIA_VELOCITY) return
  if (abs > MAX_INERTIA_VELOCITY) {
    velocity = Math.sign(velocity) * MAX_INERTIA_VELOCITY
  }

  let lastTime = performance.now()

  const tick = (now: number) => {
    const target = bodyRef.value
    if (!target || !props.enabled) {
      momentumRaf = null
      return
    }

    const dt = Math.min(34, Math.max(0, now - lastTime))
    lastTime = now
    if (dt <= 0) {
      momentumRaf = requestAnimationFrame(tick)
      return
    }

    const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight)
    const nextTop = target.scrollTop + velocity * dt
    if (nextTop <= 0 || nextTop >= maxScroll) {
      target.scrollTop = Math.min(maxScroll, Math.max(0, nextTop))
      revealThumb()
      momentumRaf = null
      return
    }

    target.scrollTop = nextTop
    velocity *= Math.exp(-INERTIA_FRICTION * dt)
    revealThumb()

    if (Math.abs(velocity) < INERTIA_STOP_VELOCITY) {
      momentumRaf = null
      return
    }

    momentumRaf = requestAnimationFrame(tick)
  }

  momentumRaf = requestAnimationFrame(tick)
}

function clearHideTimer() {
  if (hideTimer != null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleHide() {
  clearHideTimer()
  hideTimer = setTimeout(() => {
    thumbVisible.value = false
  }, 900)
}

function updateThumb() {
  const el = bodyRef.value
  if (!el || !props.enabled) {
    canScroll.value = false
    thumbVisible.value = false
    return
  }

  const { scrollTop, scrollHeight, clientHeight } = el
  const overflow = scrollHeight - clientHeight
  canScroll.value = overflow > 1
  if (!canScroll.value) {
    thumbVisible.value = false
    return
  }

  const track = clientHeight
  const size = Math.max(20, (clientHeight / scrollHeight) * track)
  const maxTop = Math.max(0, track - size)
  const top = overflow > 0 ? (scrollTop / overflow) * maxTop : 0
  thumbHeight.value = size
  thumbTop.value = top
}

function revealThumb() {
  updateThumb()
  if (!canScroll.value) return
  thumbVisible.value = true
  scheduleHide()
}

function scrollDetail(el: HTMLElement): ScrollDetail {
  return {
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
    scrollHeight: el.scrollHeight,
    scrollWidth: el.scrollWidth,
    clientHeight: el.clientHeight,
    clientWidth: el.clientWidth,
  }
}

/** 每帧最多派发一次 scroll / touchMove，减轻预览 setData 压力 */
let scrollEmitRaf: number | null = null
let touchMoveEmitRaf: number | null = null
let pendingTouchMove: TouchDetail | null = null

function flushScrollEmit() {
  scrollEmitRaf = null
  if (!props.enabled) return
  const el = bodyRef.value
  if (!el) return
  const detail = scrollDetail(el)
  emit('scroll', detail)

  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  const nowLower = maxScroll > 0 && el.scrollTop >= maxScroll - EDGE_THRESHOLD_PX
  const nowUpper = el.scrollTop <= EDGE_THRESHOLD_PX
  if (nowLower && !atLowerEdge) emit('scrollToLower', detail)
  if (nowUpper && !atUpperEdge) emit('scrollToUpper', detail)
  atLowerEdge = nowLower
  atUpperEdge = nowUpper
}

function onScroll() {
  if (!props.enabled) return
  revealThumb()
  if (scrollEmitRaf != null) return
  scrollEmitRaf = requestAnimationFrame(flushScrollEmit)
}

function flushTouchMoveEmit() {
  touchMoveEmitRaf = null
  if (!props.enabled || !pendingTouchMove) return
  const detail = pendingTouchMove
  pendingTouchMove = null
  emit('touchMove', detail)
}

function scheduleTouchMoveEmit(detail: TouchDetail) {
  pendingTouchMove = detail
  if (touchMoveEmitRaf != null) return
  touchMoveEmitRaf = requestAnimationFrame(flushTouchMoveEmit)
}

function cancelEmitRafs() {
  if (scrollEmitRaf != null) {
    cancelAnimationFrame(scrollEmitRaf)
    scrollEmitRaf = null
  }
  if (touchMoveEmitRaf != null) {
    cancelAnimationFrame(touchMoveEmitRaf)
    touchMoveEmitRaf = null
  }
  pendingTouchMove = null
}

function touchDetail(event: TouchEvent, preferChanged: boolean): TouchDetail | null {
  const t = preferChanged
    ? (event.changedTouches[0] ?? event.touches[0])
    : (event.touches[0] ?? event.changedTouches[0])
  if (!t) return null
  return {
    clientX: t.clientX,
    clientY: t.clientY,
    pageX: t.pageX,
    pageY: t.pageY,
  }
}

function detailFromPointer(event: PointerEvent): TouchDetail {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pageX: event.pageX,
    pageY: event.pageY,
  }
}

/** 鼠标/笔模拟触摸（桌面预览没有原生 TouchEvent） */
let simTouchPointerId: number | null = null

function onTouchStart(event: TouchEvent) {
  if (!props.enabled) return
  const detail = touchDetail(event, false)
  if (!detail) return
  emit('touchStart', detail)
}

function onTouchMove(event: TouchEvent) {
  if (!props.enabled) return
  const detail = touchDetail(event, false)
  if (!detail) return
  scheduleTouchMoveEmit(detail)
}

function onTouchEnd(event: TouchEvent) {
  if (!props.enabled) return
  // 先冲刷最后一帧 move，避免 touchEnd 读到过期坐标
  if (touchMoveEmitRaf != null) {
    cancelAnimationFrame(touchMoveEmitRaf)
    flushTouchMoveEmit()
  }
  const detail = touchDetail(event, true)
  if (!detail) return
  emit('touchEnd', detail)
}

function endSimTouch(event: PointerEvent) {
  if (simTouchPointerId == null || event.pointerId !== simTouchPointerId) return
  if (touchMoveEmitRaf != null) {
    cancelAnimationFrame(touchMoveEmitRaf)
    flushTouchMoveEmit()
  }
  emit('touchEnd', detailFromPointer(event))
  simTouchPointerId = null
}

function onWheel(event: WheelEvent) {
  stopMomentum()
  if (props.enabled) emit('wheel', event)
}

let pointerCaptured = false

function releaseCapture(el: HTMLElement | null | undefined, pointerId: number) {
  if (!pointerCaptured || !el) return
  try {
    el.releasePointerCapture(pointerId)
  } catch {
    // ignore
  }
  pointerCaptured = false
}

function endDrag(el?: HTMLElement | null, withInertia = false) {
  if (dragPointerId == null) return
  const target = el ?? bodyRef.value
  const pointerId = dragPointerId
  releaseCapture(target, pointerId)

  const shouldInertia = withInertia && dragMoved
  const fingerVelocity = shouldInertia ? releaseFingerVelocity() : 0

  if (dragMoved) {
    suppressClick = true
    // 下一拍再放开，吞掉拖拽结束后的 click
    window.setTimeout(() => {
      suppressClick = false
    }, 0)
  }
  dragPointerId = null
  dragMoved = false
  dragScrolling.value = false
  velocitySamples = []

  if (shouldInertia) startMomentum(fingerVelocity)
}

function onPointerDown(event: PointerEvent) {
  if (!props.enabled) return
  // 真触摸走 TouchEvent；鼠标/笔在此模拟触摸并拖拽滚动
  if (event.pointerType === 'touch') return
  if (event.pointerType === 'mouse' && event.button !== 0) return

  simTouchPointerId = event.pointerId
  emit('touchStart', detailFromPointer(event))

  const el = bodyRef.value
  if (!el) return
  stopMomentum()
  updateThumb()
  if (!canScroll.value) return

  // 注意：不要在 down 时 setPointerCapture，否则 click 会落到滚动层、子组件点不动
  dragPointerId = event.pointerId
  dragStartY = event.clientY
  dragStartScrollTop = el.scrollTop
  dragMoved = false
  dragScrolling.value = false
  pointerCaptured = false
  velocitySamples = [{ y: event.clientY, t: performance.now() }]
}

function onPointerMove(event: PointerEvent) {
  if (simTouchPointerId != null && event.pointerId === simTouchPointerId) {
    scheduleTouchMoveEmit(detailFromPointer(event))
  }

  if (dragPointerId == null || event.pointerId !== dragPointerId) return
  const el = bodyRef.value
  if (!el) return
  pushVelocitySample(event.clientY)
  const dy = event.clientY - dragStartY
  if (!dragMoved && Math.abs(dy) < DRAG_THRESHOLD_PX) return

  if (!dragMoved) {
    dragMoved = true
    dragScrolling.value = true
    // 确认真的在拖再捕获，短按点击仍命中子节点
    try {
      el.setPointerCapture(event.pointerId)
      pointerCaptured = true
    } catch {
      pointerCaptured = false
    }
  }

  event.preventDefault()
  el.scrollTop = dragStartScrollTop - dy
  revealThumb()
}

function onPointerUp(event: PointerEvent) {
  endSimTouch(event)
  if (dragPointerId == null || event.pointerId !== dragPointerId) return
  pushVelocitySample(event.clientY)
  endDrag(bodyRef.value, true)
}

function onPointerCancel(event: PointerEvent) {
  endSimTouch(event)
  if (dragPointerId == null || event.pointerId !== dragPointerId) return
  endDrag(bodyRef.value, false)
}

function onClickCapture(event: MouseEvent) {
  if (!suppressClick) return
  event.preventDefault()
  event.stopPropagation()
}

function bindObservers() {
  const el = bodyRef.value
  if (!el || !props.enabled) return

  resizeObserver?.disconnect()
  mutationObserver?.disconnect()

  resizeObserver = new ResizeObserver(() => {
    updateThumb()
  })
  resizeObserver.observe(el)

  mutationObserver = new MutationObserver(() => {
    updateThumb()
  })
  mutationObserver.observe(el, { childList: true, subtree: true, characterData: true })
}

function unbindObservers() {
  resizeObserver?.disconnect()
  resizeObserver = null
  mutationObserver?.disconnect()
  mutationObserver = null
  clearHideTimer()
}

onMounted(async () => {
  await nextTick()
  if (props.enabled) {
    bindObservers()
    updateThumb()
  }
})

onBeforeUnmount(() => {
  stopMomentum()
  endDrag()
  simTouchPointerId = null
  cancelEmitRafs()
  unbindObservers()
})

watch(
  () => props.enabled,
  async (enabled) => {
    stopMomentum()
    unbindObservers()
    atLowerEdge = false
    atUpperEdge = true
    await nextTick()
    if (enabled) {
      bindObservers()
      updateThumb()
    } else {
      canScroll.value = false
      thumbVisible.value = false
    }
  },
)
</script>

<template>
  <div
    class="overlay-scroll-port"
    :class="{ 'is-enabled': enabled }"
  >
    <div
      ref="bodyRef"
      class="overlay-scroll-body"
      :class="[
        contentClass,
        { 'is-scrollable': enabled, 'is-drag-scrolling': dragScrolling },
      ]"
      :style="contentStyle"
      @scroll="onScroll"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @click.capture="onClickCapture"
    >
      <slot />
    </div>
    <div
      v-if="enabled && canScroll"
      class="overlay-scroll-thumb"
      :class="{ 'is-visible': thumbVisible }"
      :style="thumbStyle"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
/* 非滚动时不介入布局 */
.overlay-scroll-port:not(.is-enabled) {
  display: contents;
}

.overlay-scroll-port.is-enabled {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  width: 100%;
  min-height: 0;
  min-width: 0;
  align-self: stretch;
  overflow: hidden;
}

.overlay-scroll-body.is-scrollable {
  flex: 1 1 0%;
  width: 100%;
  min-height: 0 !important;
  min-width: 0;
  align-self: stretch;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  /* 隐藏原生滚动条，避免占用布局宽度 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.overlay-scroll-body.is-drag-scrolling {
  cursor: grabbing;
  user-select: none;
}

.overlay-scroll-body.is-scrollable::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.overlay-scroll-thumb {
  position: absolute;
  top: 0;
  right: 2px;
  width: 3px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.32);
  opacity: 0;
  pointer-events: none;
  z-index: 35;
  transition: opacity 0.18s ease;
  will-change: transform, opacity;
}

.overlay-scroll-thumb.is-visible {
  opacity: 1;
}
</style>
