<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    size?: number
    clickable?: boolean
  }>(),
  {
    title: '已配置重复',
    size: 16,
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
    class="repeat-badge"
    :class="{ clickable }"
    :title="title"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="button"
    @click="clickable ? handleClick($event) : undefined"
  >
    <svg class="repeat-badge-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.5 3.5c-2.6.2-5 1.6-6.5 3.7C9.2 5 6.5 3.5 3.5 3.5c0 0-.5 5.2 2.2 8.4C4.2 13.2 3 15.4 3 18c2.6 0 5-1.2 6.5-3.2.3 1.7.9 3.3 1.8 4.7.9-1.4 1.5-3 1.8-4.7C14.6 16.8 17 18 19.6 18c0-2.6-1.2-4.8-2.7-6.1 2.7-3.2 2.2-8.4 2.2-8.4z"
      />
    </svg>
  </span>
</template>

<style scoped>
.repeat-badge {
  flex-shrink: 0;
  border-radius: 4px;
  background: #7c3aed;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
}

.repeat-badge.clickable {
  pointer-events: auto;
  cursor: pointer;
}

.repeat-badge.clickable:hover {
  background: #6d28d9;
}

.repeat-badge-icon {
  width: 68%;
  height: 68%;
  display: block;
}
</style>
