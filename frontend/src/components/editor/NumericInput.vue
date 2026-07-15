<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    min?: number
    max?: number
    step?: number
    placeholder?: string
  }>(),
  {
    min: 0,
    step: 1,
    placeholder: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const innerValue = computed({
  get() {
    if (props.modelValue === '' || props.modelValue === undefined || props.modelValue === null) {
      return undefined
    }
    const num = Number(String(props.modelValue).replace(/px$/i, ''))
    return Number.isFinite(num) ? num : undefined
  },
  set(value: number | undefined) {
    const next = value === undefined ? '' : String(value)
    emit('update:modelValue', next)
  },
})

function handleChange(value: number | undefined) {
  const next = value === undefined ? '' : String(value)
  emit('change', next)
}

/** 阻止方向键冒泡到控件树，长按时不会清掉/切走选中节点 */
function handleKeydown(event: Event) {
  const key = (event as KeyboardEvent).key
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    event.stopPropagation()
  }
}
</script>

<template>
  <el-input-number
    v-model="innerValue"
    class="numeric-input"
    :min="min"
    :max="max"
    :step="step"
    :placeholder="placeholder"
    controls-position="right"
    @change="handleChange"
    @keydown="handleKeydown"
  />
</template>

<style scoped>
.numeric-input {
  width: 100%;
}

:deep(.el-input__wrapper) {
  padding-left: 8px;
  padding-right: 36px;
}
</style>
