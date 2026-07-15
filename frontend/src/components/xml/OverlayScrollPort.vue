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

const emit = defineEmits<{
  wheel: [event: WheelEvent]
}>()

const bodyRef = ref<HTMLElement | null>(null)
const thumbVisible = ref(false)
const thumbTop = ref(0)
const thumbHeight = ref(24)
const canScroll = ref(false)

let hideTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null

const thumbStyle = computed(() => ({
  height: `${thumbHeight.value}px`,
  transform: `translateY(${thumbTop.value}px)`,
}))

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

function onScroll() {
  if (!props.enabled) return
  revealThumb()
}

function onWheel(event: WheelEvent) {
  if (props.enabled) emit('wheel', event)
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
  unbindObservers()
})

watch(
  () => props.enabled,
  async (enabled) => {
    unbindObservers()
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
      :class="[contentClass, { 'is-scrollable': enabled }]"
      :style="contentStyle"
      @scroll="onScroll"
      @wheel="onWheel"
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
  /* 隐藏原生滚动条，避免占用布局宽度 */
  scrollbar-width: none;
  -ms-overflow-style: none;
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
