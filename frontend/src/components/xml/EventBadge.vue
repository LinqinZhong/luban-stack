<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    size?: number
    count?: number
    clickable?: boolean
  }>(),
  {
    title: '已绑定事件方法',
    size: 15,
    count: 0,
    clickable: false,
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

function handleClick(event: MouseEvent) {
  event.stopPropagation()
  emit('click', event)
}
</script>

<template>
  <span
    class="event-badge"
    :class="{ clickable }"
    :title="count > 0 ? `${title}（${count}）` : title"
    :style="{
      width: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
      height: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
      fontSize: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
      borderRadius: `calc(4px / max(var(--canvas-zoom, 1), 1))`,
    }"
    role="button"
    @click="clickable ? handleClick($event) : undefined"
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
  box-sizing: border-box;
  flex-shrink: 0;
  background: #f97316;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  overflow: hidden;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
}

.event-badge.clickable {
  pointer-events: auto;
  cursor: pointer;
}

.event-badge.clickable:hover {
  background: #ea580c;
}

.event-badge-icon {
  width: 0.68em;
  height: 0.68em;
  display: block;
  flex-shrink: 0;
}
</style>
