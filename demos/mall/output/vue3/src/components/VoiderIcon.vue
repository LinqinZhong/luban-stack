<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    color?: string
  }>(),
  {
    size: 16,
    color: 'currentColor',
  },
)

const modules = import.meta.glob('../assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const svg = computed(() => {
  const id = String(props.name || '').trim()
  if (!id) return ''
  return modules[`../assets/icons/${id}.svg`] ?? ''
})

const box = computed(() => {
  const n = Number(props.size)
  return Number.isFinite(n) && n > 0 ? n : 16
})
</script>

<template>
  <span
    class="voider-icon inline-flex items-center justify-center shrink-0"
    :style="{ width: box + 'px', height: box + 'px', color: color || 'currentColor' }"
    v-html="svg"
    aria-hidden="true"
  />
</template>

<style scoped>
.voider-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
