<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { OverflowStrategy } from '../../utils/xml'

const props = withDefaults(
  defineProps<{
    /** 编辑态：横滑浏览全部页，便于点选子控件 */
    editable?: boolean
    /** 预览态溢出策略（默认 visible）；编辑态忽略，始终露出相邻页 */
    overflow?: OverflowStrategy
    slideCount: number
    autoplay?: boolean
    interval?: number
    circular?: boolean
    indicator?: boolean
    indicatorColor?: string
    indicatorActiveColor?: string
    duration?: number
    /** 初始页下标 */
    current?: number
  }>(),
  {
    editable: false,
    overflow: 'visible',
    autoplay: false,
    interval: 3000,
    circular: true,
    indicator: true,
    indicatorColor: 'rgba(0,0,0,0.25)',
    indicatorActiveColor: '#409eff',
    duration: 280,
    current: 0,
  },
)

const index = ref(0)
const viewportRef = ref<HTMLElement | null>(null)
const slideWidthPx = ref(0)
/** 编辑态锁定单页宽（避免自身撑开后 clientWidth 循环变大） */
const lockedEditSlideW = ref(0)
const dragging = ref(false)
const dragOffset = ref(0)
let startX = 0
let startY = 0
let startOffset = 0
let lockAxis: 'x' | 'y' | null = null
let timer: ReturnType<typeof setInterval> | null = null
let suppressClickUntil = 0
let resizeObserver: ResizeObserver | null = null
let pointerCaptured = false

const count = computed(() => Math.max(0, props.slideCount))

const EDIT_GAP_PX = 8

/**
 * Swiper 窗口宽 = 宿主 .widget.swiper 的布局宽（match_parent）。
 * 不要用 --pane-w：多窗体页宽可能略大于 Banner 内 Swiper，会导致第 1 窗「多出一截」、
 * 后面窗口与手机右缘之间空出约一整窗宽。
 */
function measureSwiperWindowWidth(el: HTMLElement): number {
  const host = el.parentElement
  if (!host) return Math.max(0, Math.round(el.clientWidth))
  // track 已绝对定位，不再撑开宿主；直接读 host 布局宽
  let w = Math.round(host.clientWidth)
  if (!(w > 0)) {
    const outer = host.parentElement
    if (outer) w = Math.round(outer.clientWidth)
  }
  return Math.max(0, w)
}

const viewportStyle = computed(() => {
  const style: Record<string, string> = {}
  if (props.editable && slideWidthPx.value > 0) {
    style['--slide-w'] = `${slideWidthPx.value}px`
    // 布局宽始终 = 窗口宽；多页由绝对定位 track 画出，不参与撑宽
    style.width = '100%'
    style.maxWidth = '100%'
    style.minWidth = '0'
  }
  // 预览态不写 overflow：沿用 CSS `.swiper-viewport { overflow: hidden }` 裁切翻页
  // 编辑态由 `.swiper-viewport.editable { overflow: visible }` 露出平铺页
  return Object.keys(style).length ? style : undefined
})

const slideEditStyle = computed(() => {
  if (!props.editable || !(slideWidthPx.value > 0)) return undefined
  const w = `${slideWidthPx.value}px`
  return {
    flex: `0 0 ${w}`,
    width: w,
    minWidth: w,
    maxWidth: w,
  }
})

const clampedIndex = computed(() => {
  if (count.value <= 0) return 0
  return ((index.value % count.value) + count.value) % count.value
})

const trackStyle = computed(() => {
  if (props.editable) {
    // 编辑态：绝对定位平铺，不进入文档流，避免 max-content 把祖先 flex 撑超宽
    return {
      position: 'absolute' as const,
      left: '0',
      top: '0',
      display: 'flex',
      flexDirection: 'row' as const,
      alignItems: 'stretch' as const,
      height: '100%',
      width: 'max-content',
      maxWidth: 'none',
      gap: `${EDIT_GAP_PX}px`,
      padding: '0',
      boxSizing: 'border-box' as const,
      transform: 'none',
    }
  }
  // 预览态：与改平铺前一致（相对定位 + 百分比位移），不带编辑态绝对定位残留
  const percent = count.value > 0 ? -clampedIndex.value * 100 : 0
  const offsetPx = dragOffset.value
  return {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'row' as const,
    height: '100%',
    width: '100%',
    transform: `translate3d(calc(${percent}% + ${offsetPx}px), 0, 0)`,
    transition: dragging.value ? 'none' : `transform ${props.duration}ms ease`,
    willChange: 'transform',
  }
})

function clearTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function restartTimer() {
  clearTimer()
  if (props.editable || !props.autoplay || count.value <= 1) return
  const ms = Math.max(800, props.interval || 3000)
  timer = setInterval(() => {
    goNext()
  }, ms)
}

function goTo(next: number) {
  if (count.value <= 0) return
  if (props.circular) {
    index.value = ((next % count.value) + count.value) % count.value
  } else {
    index.value = Math.max(0, Math.min(count.value - 1, next))
  }
}

function goNext() {
  if (count.value <= 0) return
  if (!props.circular && clampedIndex.value >= count.value - 1) {
    goTo(0)
    return
  }
  goTo(clampedIndex.value + 1)
}

function goPrev() {
  if (count.value <= 0) return
  if (!props.circular && clampedIndex.value <= 0) {
    goTo(count.value - 1)
    return
  }
  goTo(clampedIndex.value - 1)
}

function onPointerDown(event: PointerEvent) {
  if (props.editable || count.value <= 1) return
  if (event.button !== 0) return
  const el = viewportRef.value
  if (!el) return
  dragging.value = true
  lockAxis = null
  pointerCaptured = false
  startX = event.clientX
  startY = event.clientY
  startOffset = 0
  dragOffset.value = 0
  clearTimer()
  // 勿在此处 capture：否则 click 会落到 viewport，子控件 onClick 失效
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  if (!lockAxis) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    lockAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    if (lockAxis === 'y') {
      dragging.value = false
      dragOffset.value = 0
      restartTimer()
      return
    }
    // 确认横向滑动后再 capture，保证轻点仍落到子控件
    try {
      viewportRef.value?.setPointerCapture?.(event.pointerId)
      pointerCaptured = true
    } catch {
      // ignore
    }
  }
  if (lockAxis !== 'x') return
  event.preventDefault()
  const width = viewportRef.value?.clientWidth || 1
  let next = dx
  if (!props.circular) {
    if (clampedIndex.value === 0 && dx > 0) next = dx * 0.35
    if (clampedIndex.value === count.value - 1 && dx < 0) next = dx * 0.35
  }
  startOffset = next
  dragOffset.value = Math.max(-width * 0.95, Math.min(width * 0.95, next))
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value && lockAxis !== 'x') {
    restartTimer()
    return
  }
  const width = viewportRef.value?.clientWidth || 1
  const dx = startOffset
  dragging.value = false
  dragOffset.value = 0
  const wasSwipe = lockAxis === 'x' && Math.abs(dx) > width * 0.18
  lockAxis = null
  if (pointerCaptured) {
    try {
      viewportRef.value?.releasePointerCapture?.(event.pointerId)
    } catch {
      // ignore
    }
    pointerCaptured = false
  }
  if (wasSwipe) {
    if (dx < 0) goNext()
    else goPrev()
    suppressClickUntil = Date.now() + 280
  }
  restartTimer()
}

function onDotClick(i: number) {
  if (props.editable) return
  goTo(i)
  restartTimer()
}

function onClickCapture(event: MouseEvent) {
  if (Date.now() < suppressClickUntil) {
    event.stopPropagation()
    event.preventDefault()
  }
}

watch(
  () => [props.current, props.slideCount] as const,
  ([cur]) => {
    if (count.value <= 0) {
      index.value = 0
      return
    }
    const next = Number(cur)
    index.value = Number.isFinite(next)
      ? Math.max(0, Math.min(count.value - 1, Math.floor(next)))
      : 0
  },
  { immediate: true },
)

watch(
  () => [props.autoplay, props.interval, props.editable, props.slideCount] as const,
  () => {
    void nextTick(() => restartTimer())
  },
)

function syncSlideWidth() {
  const el = viewportRef.value
  if (!el) return
  if (props.editable) {
    const w = measureSwiperWindowWidth(el)
    if (!(w > 0)) return
    // 只跟 Swiper 窗口宽（match_parent），锁定后仅在窗口宽真实变化时更新
    if (
      lockedEditSlideW.value <= 0 ||
      Math.abs(lockedEditSlideW.value - w) > 2
    ) {
      lockedEditSlideW.value = w
    }
    slideWidthPx.value = lockedEditSlideW.value
    return
  }
  lockedEditSlideW.value = 0
  slideWidthPx.value = Math.max(0, Math.round(el.clientWidth))
}

watch(
  () => props.editable,
  () => {
    lockedEditSlideW.value = 0
    void nextTick(() => syncSlideWidth())
  },
)

onMounted(() => {
  restartTimer()
  void nextTick(() => syncSlideWidth())
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncSlideWidth())
    const el = viewportRef.value
    // 观察宿主，避免观察已撑开的 viewport 把单页宽量成总宽
    const host = el?.parentElement
    if (host) resizeObserver.observe(host)
    else if (el) resizeObserver.observe(el)
  }
})
onBeforeUnmount(() => {
  clearTimer()
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div
    ref="viewportRef"
    class="swiper-viewport"
    :class="{ editable, dragging }"
    :style="viewportStyle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click.capture="onClickCapture"
  >
    <div class="swiper-track" :style="trackStyle">
      <div
        v-for="i in count"
        :key="i - 1"
        class="swiper-slide"
        :class="{ editable }"
        :style="slideEditStyle"
      >
        <slot :index="i - 1" />
      </div>
    </div>

    <div
      v-if="indicator && count > 1 && !editable"
      class="swiper-dots"
      aria-hidden="true"
    >
      <button
        v-for="i in count"
        :key="i - 1"
        type="button"
        class="dot"
        :class="{ active: clampedIndex === i - 1 }"
        :style="{
          background:
            clampedIndex === i - 1 ? indicatorActiveColor : indicatorColor,
        }"
        @click.stop="onDotClick(i - 1)"
      />
    </div>

    <div v-if="editable && count === 0" class="swiper-empty">
      向滑动窗口添加子控件作为每一页
    </div>
  </div>
</template>

<style scoped>
.swiper-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  box-sizing: border-box;
}

.swiper-viewport.editable {
  overflow: visible;
  position: relative;
  /* 禁止被平铺 track 的 min-content 撑开 */
  min-width: 0;
  max-width: 100%;
  width: 100%;
  touch-action: none;
  user-select: auto;
}

.swiper-viewport.dragging {
  cursor: grabbing;
}

.swiper-track {
  height: 100%;
  box-sizing: border-box;
}

.swiper-slide {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.swiper-slide.editable {
  /* 每页 = Swiper 窗口宽（match_parent）；具体像素由 slideEditStyle 写入 */
  flex-shrink: 0;
  overflow: visible;
  border: 1px dashed #c0c4cc;
  border-radius: 6px;
  background: rgba(64, 158, 255, 0.04);
  box-sizing: border-box;
}

.swiper-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  display: flex;
  justify-content: center;
  gap: 6px;
  pointer-events: auto;
  z-index: 2;
}

.dot {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.swiper-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-size: 12px;
  color: #909399;
  text-align: center;
  pointer-events: none;
}
</style>
