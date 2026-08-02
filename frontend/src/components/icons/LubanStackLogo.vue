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
  <!-- LubanStack：七方块对称等距十字，整体方正 -->
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
      <linearGradient id="lb-top" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#F3DFC4" />
        <stop offset="1" stop-color="#E8C9A0" />
      </linearGradient>
      <linearGradient id="lb-left" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#D4A574" />
        <stop offset="1" stop-color="#C4956A" />
      </linearGradient>
      <linearGradient id="lb-right" x1="1" y1="0" x2="0" y2="1">
        <stop stop-color="#C9A07A" />
        <stop offset="1" stop-color="#A67C52" />
      </linearGradient>
    </defs>

    <!--
      单元方块：顶面半宽 8 / 半高 4，侧高 8
      步进 9.5：留细缝；六向对称，外接约正方形
    -->
    <g transform="translate(32 28)">
      <!-- 上 -->
      <g transform="translate(0 -9.5)">
        <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
        <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
        <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
      </g>
      <!-- 后 -->
      <g transform="translate(-9.5 4.75)">
        <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
        <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
        <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
      </g>
      <!-- 左 -->
      <g transform="translate(-9.5 -4.75)">
        <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
        <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
        <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
      </g>
      <!-- 中 -->
      <g>
        <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
        <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
        <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
      </g>
      <!-- 右 -->
      <g transform="translate(9.5 4.75)">
        <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
        <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
        <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
      </g>
      <!-- 前 -->
      <g transform="translate(9.5 -4.75)">
        <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
        <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
        <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
      </g>
      <!-- 下 -->
      <g transform="translate(0 9.5)">
        <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
        <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
        <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.lubanstack-logo {
  display: block;
  flex-shrink: 0;
}
</style>
