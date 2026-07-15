<script setup lang="ts">
import { iconSymbolId, type IconLibrary } from '../../types/icon-library'

defineProps<{
  library: IconLibrary
}>()
</script>

<template>
  <!-- 页面级 SVG sprite：控件通过 <use> 引用，避免重复内联 SVG -->
  <svg
    class="icon-sprite"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <symbol
      v-for="icon in library.icons"
      :id="iconSymbolId(icon.id)"
      :key="icon.id"
      :viewBox="icon.viewBox"
      v-html="icon.content"
    />
  </svg>
</template>

<style scoped>
.icon-sprite {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}
</style>
