<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

/** 与编辑器画布设计宽度一致，导出按此等比缩放 */
const DESIGN_WIDTH = 375

const vw = ref(DESIGN_WIDTH)
const vh = ref(667)

function syncViewport() {
  vw.value = window.innerWidth
  vh.value = window.innerHeight
}

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncViewport)
})

const scale = computed(() => vw.value / DESIGN_WIDTH)
/** 设计坐标系下一屏高度，缩放后视觉上正好铺满视口高度 */
const designScreenH = computed(() => vh.value / scale.value)
</script>

<template>
  <div class="voider-stage" :style="{ height: vh + 'px' }">
    <div
      class="voider-page"
      :style="{
        width: DESIGN_WIDTH + 'px',
        height: designScreenH + 'px',
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }"
    >
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.voider-stage {
  width: 100%;
  overflow: hidden;
  position: relative;
  background: #ededed;
}
.voider-page {
  position: relative;
  overflow: hidden;
}
</style>
