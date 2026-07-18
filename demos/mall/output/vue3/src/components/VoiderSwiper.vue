<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    slideCount: number
    autoplay?: boolean
    interval?: number
    circular?: boolean
    indicator?: boolean
    indicatorColor?: string
    indicatorActiveColor?: string
    duration?: number
    current?: number
  }>(),
  {
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

const index = ref(Math.max(0, props.current || 0))
const viewportRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragOffset = ref(0)
let startX = 0
let startY = 0
let startOffset = 0
let lockAxis: 'x' | 'y' | null = null
let timer: ReturnType<typeof setInterval> | null = null
let pointerCaptured = false

const count = computed(() => Math.max(0, props.slideCount))
const clampedIndex = computed(() => {
  if (count.value <= 0) return 0
  return ((index.value % count.value) + count.value) % count.value
})

const trackStyle = computed(() => {
  const percent = count.value > 0 ? -clampedIndex.value * 100 : 0
  return {
    transform: `translate3d(calc(${percent}% + ${dragOffset.value}px), 0, 0)`,
    transition: dragging.value ? 'none' : `transform ${props.duration}ms ease`,
  }
})

function clearTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
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

function restartTimer() {
  clearTimer()
  if (!props.autoplay || count.value <= 1) return
  const ms = Math.max(800, props.interval || 3000)
  timer = setInterval(() => goNext(), ms)
}

function onPointerDown(event: PointerEvent) {
  if (count.value <= 1 || event.button !== 0) return
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
  }
  restartTimer()
}

watch(
  () => [props.autoplay, props.interval, props.slideCount, props.circular] as const,
  () => restartTimer(),
)
watch(
  () => props.current,
  (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) goTo(v)
  },
)

onMounted(() => restartTimer())
onBeforeUnmount(() => clearTimer())
</script>

<template>
  <div
    ref="viewportRef"
    class="voider-swiper"
    :class="{ dragging }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div class="voider-swiper-track" :style="trackStyle">
      <slot />
    </div>
    <div
      v-if="indicator && count > 1"
      class="voider-swiper-dots"
      aria-hidden="true"
    >
      <button
        v-for="i in count"
        :key="i - 1"
        type="button"
        class="dot"
        :class="{ active: clampedIndex === i - 1 }"
        :style="{
          background: clampedIndex === i - 1 ? indicatorActiveColor : indicatorColor,
        }"
        @click.stop="goTo(i - 1)"
      />
    </div>
  </div>
</template>

<style scoped>
.voider-swiper {
  /* 尺寸由外层 shell / class 决定，这里只做填满，避免盖掉 absolute / 固定宽高 */
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  box-sizing: border-box;
}
.voider-swiper.dragging {
  cursor: grabbing;
}
.voider-swiper-track {
  display: flex;
  flex-direction: row;
  height: 100%;
  width: 100%;
  will-change: transform;
  box-sizing: border-box;
}
.voider-swiper-track > :deep(*) {
  position: relative;
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}
.voider-swiper-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  display: flex;
  justify-content: center;
  gap: 6px;
  z-index: 2;
  pointer-events: auto;
}
.dot {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}
</style>
