<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    size?: number
    count?: number
  }>(),
  {
    title: '已绑定事件方法',
    size: 16,
    count: 0,
  },
)
</script>

<template>
  <span
    class="event-badge"
    :title="count > 0 ? `${title}（${count}）` : title"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <svg class="event-badge-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13 2 4 14h6l-1 8 10-14h-6l0-6z"
      />
    </svg>
  </span>
</template>

<style scoped>
.event-badge {
  flex-shrink: 0;
  border-radius: 4px;
  background: #f97316;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
}

.event-badge-icon {
  width: 70%;
  height: 70%;
  display: block;
}
</style>
