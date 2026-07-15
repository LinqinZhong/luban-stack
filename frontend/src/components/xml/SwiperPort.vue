<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 编辑态：横滑浏览全部页，便于点选子控件 */
    editable?: boolean
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
const dragging = ref(false)
const dragOffset = ref(0)
let startX = 0
let startY = 0
let startOffset = 0
let lockAxis: 'x' | 'y' | null = null
let timer: ReturnType<typeof setInterval> | null = null
let suppressClickUntil = 0
let resizeObserver: ResizeObserver | null = null

const count = computed(() => Math.max(0, props.slideCount))

const viewportStyle = computed(() => {
  if (!props.editable || !slideWidthPx.value) return undefined
  return {
    ['--slide-w' as string]: `${slideWidthPx.value}px`,
  }
})

const clampedIndex = computed(() => {
  if (count.value <= 0) return 0
  return ((index.value % count.value) + count.value) % count.value
})

const EDIT_GAP_PX = 8

const trackStyle = computed(() => {
  if (props.editable) {
    // 按 current 把对应页对齐到视口（手机框）中间；两侧页溢出可见
    const w = slideWidthPx.value
    const offset =
      w > 0 && count.value > 0
        ? -(clampedIndex.value * (w + EDIT_GAP_PX))
        : 0
    return {
      display: 'flex',
      flexDirection: 'row' as const,
      alignItems: 'stretch' as const,
      height: '100%',
      width: 'max-content',
      maxWidth: 'none',
      gap: `${EDIT_GAP_PX}px`,
      padding: '0',
      boxSizing: 'border-box' as const,
      transform: `translate3d(${offset}px, 0, 0)`,
    }
  }
  const percent = count.value > 0 ? -clampedIndex.value * 100 : 0
  const offsetPx = dragOffset.value
  return {
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
  startX = event.clientX
  startY = event.clientY
  startOffset = 0
  dragOffset.value = 0
  clearTimer()
  el.setPointerCapture?.(event.pointerId)
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
  lockAxis = null
  try {
    viewportRef.value?.releasePointerCapture?.(event.pointerId)
  } catch {
    // ignore
  }
  if (Math.abs(dx) > width * 0.18) {
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
  slideWidthPx.value = Math.max(0, Math.round(el.clientWidth))
}

watch(
  () => props.editable,
  (editable) => {
    if (editable) void nextTick(() => syncSlideWidth())
  },
)

onMounted(() => {
  restartTimer()
  syncSlideWidth()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncSlideWidth())
    if (viewportRef.value) resizeObserver.observe(viewportRef.value)
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
  /* 编辑态：溢出可见，方便看到右侧后续页 */
  overflow: visible;
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
  /* 每页与窗口同宽；由 --slide-w 锁定（相对视口），后续页溢出仍可见 */
  flex: 0 0 var(--slide-w, 100%);
  width: var(--slide-w, 100%);
  min-width: var(--slide-w, 100%);
  overflow: visible;
  border: 1px dashed #c0c4cc;
  border-radius: 6px;
  background: rgba(64, 158, 255, 0.04);
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
