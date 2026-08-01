<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 图标边长（CSS 尺寸） */
    size?: number | string
  }>(),
  { size: 28 },
)
</script>

<template>
  <!-- LubanStack：三块蓝方（Stack）+ 几何锤线稿（Luban） -->
  <svg
    class="lubanstack-logo"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="ls-a" x1="4" y1="18" x2="28" y2="44" gradientUnits="userSpaceOnUse">
        <stop stop-color="#82CFFF" />
        <stop offset="1" stop-color="#4A9BE8" />
      </linearGradient>
      <linearGradient id="ls-b" x1="32" y1="4" x2="58" y2="28" gradientUnits="userSpaceOnUse">
        <stop stop-color="#9AD4FF" />
        <stop offset="1" stop-color="#3078D7" />
      </linearGradient>
      <linearGradient id="ls-c" x1="30" y1="32" x2="58" y2="58" gradientUnits="userSpaceOnUse">
        <stop stop-color="#5BA8F0" />
        <stop offset="1" stop-color="#1E5BB8" />
      </linearGradient>
    </defs>

    <!-- Stack -->
    <rect x="4" y="20" width="24" height="24" rx="1" fill="url(#ls-a)" />
    <rect x="34" y="6" width="24" height="24" rx="1" fill="url(#ls-b)" />
    <rect x="32" y="34" width="24" height="24" rx="1" fill="url(#ls-c)" />

    <!--
      Luban 锤：粗描边几何轮廓（锤头右上、柄左下）
      形态贴近参考：直角折线、开口端
    -->
    <path
      stroke="#2B1B10"
      stroke-width="3.6"
      stroke-linejoin="miter"
      stroke-linecap="square"
      fill="none"
      d="M20 50 L34 36 L40 42 L26 56 M34 36 L48 22 L54 28 L40 42 M48 22 L56 14 L50 8 L42 16 L48 22"
    />
  </svg>
</template>

<style scoped>
.lubanstack-logo {
  display: block;
  flex-shrink: 0;
}
</style>
