<script setup lang="ts">
import vueLogo from '../../assets/vue.svg'

defineProps<{
  /** nestjs | vue3 | mp-wx */
  type: string
}>()
</script>

<template>
  <span class="fw-icon" aria-hidden="true">
    <!-- Nest.js：红色巢形标记 -->
    <svg
      v-if="type === 'nestjs'"
      class="fw-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
    >
      <path
        fill="#E0234E"
        d="M12 2.2c-1.2 0-2.2.7-2.7 1.8-.4 1-.5 2.1-.5 3.1 0 .2 0 .4.01.6-.4.3-.8.7-1.1 1.1C6.5 10.2 5.8 12 5.8 14c0 3.1 2.5 5.6 5.6 5.8V17c-1.7-.2-3-1.6-3-3.4 0-1.2.6-2.3 1.6-2.9.2-.1.3-.4.2-.6-.1-.6-.3-1.2-.3-1.8 0-.7.2-1.4.5-2 .4-.7 1-1.1 1.7-1.1.7 0 1.3.4 1.7 1.1.3.6.5 1.3.5 2 0 .6-.1 1.2-.3 1.8-.1.2 0 .5.2.6 1 .6 1.6 1.7 1.6 2.9 0 1.8-1.3 3.2-3 3.4v2.8c3.1-.2 5.6-2.7 5.6-5.8 0-2-.7-3.8-1.9-5.2-.3-.4-.7-.8-1.1-1.1.01-.2.01-.4.01-.6 0-1-.1-2.1-.5-3.1C14.2 2.9 13.2 2.2 12 2.2zm0 8.3c-.5 0-.9.4-.9.9s.4.9.9.9.9-.4.9-.9-.4-.9-.9-.9z"
      />
    </svg>
    <!-- Vue 3 -->
    <img v-else-if="type === 'vue3'" class="fw-svg" :src="vueLogo" alt="" />
    <!-- 微信小程序 -->
    <svg
      v-else-if="type === 'mp-wx'"
      class="fw-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
    >
      <path
        fill="#07C160"
        d="M9.2 3.5C5.7 3.5 2.8 5.9 2.8 8.9c0 1.7.9 3.2 2.4 4.2l-.5 1.6c-.05.15 0 .3.1.4.1.1.3.1.4.05l1.9-1c.6.15 1.3.25 2 .25.2 0 .4 0 .6-.02A4.3 4.3 0 0 1 9 11.5c-2.4 0-4.3-1.7-4.3-3.8S6.6 4 9 4c1.8 0 3.3.9 4 2.2-.5-.2-1.1-.3-1.7-.4-.4-.05-.8-.1-1.1-.1zm5.3 5c-2.6 0-4.7 1.8-4.7 4.1s2.1 4.1 4.7 4.1c.5 0 1-.07 1.5-.2l1.6.85c.1.05.25.05.35-.05.1-.1.15-.25.1-.4l-.4-1.35c1.3-.9 2.1-2.3 2.1-3.95 0-2.3-2.1-4.1-4.7-4.1zM8.3 7.3a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm2.8 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zM13.2 14a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm2.8 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z"
      />
    </svg>
  </span>
</template>

<style scoped>
.fw-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  line-height: 0;
}
.fw-svg {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}
</style>
