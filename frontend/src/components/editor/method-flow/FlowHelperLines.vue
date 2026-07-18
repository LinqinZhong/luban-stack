<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  horizontal?: number
  vertical?: number
}>()

const { viewport, dimensions } = useVueFlow()
const canvasRef = ref<HTMLCanvasElement | null>(null)

const width = computed(() => dimensions.value.width)
const height = computed(() => dimensions.value.height)
const x = computed(() => viewport.value.x)
const y = computed(() => viewport.value.y)
const zoom = computed(() => viewport.value.zoom)

function paint() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!ctx || !canvas) return

  const dpi = window.devicePixelRatio || 1
  canvas.width = width.value * dpi
  canvas.height = height.value * dpi
  ctx.setTransform(dpi, 0, 0, dpi, 0, 0)
  ctx.clearRect(0, 0, width.value, height.value)
  ctx.strokeStyle = '#409eff'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])

  if (typeof props.vertical === 'number') {
    ctx.beginPath()
    ctx.moveTo(props.vertical * zoom.value + x.value, 0)
    ctx.lineTo(props.vertical * zoom.value + x.value, height.value)
    ctx.stroke()
  }

  if (typeof props.horizontal === 'number') {
    ctx.beginPath()
    ctx.moveTo(0, props.horizontal * zoom.value + y.value)
    ctx.lineTo(width.value, props.horizontal * zoom.value + y.value)
    ctx.stroke()
  }
}

watch(
  [width, height, x, y, zoom, () => props.horizontal, () => props.vertical],
  () => paint(),
  { immediate: true },
)
</script>

<template>
  <canvas ref="canvasRef" class="helper-lines-canvas" />
</template>

<style scoped>
.helper-lines-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  pointer-events: none;
}
</style>
