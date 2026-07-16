<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    /** 保留兼容：文本模式下不强制校验范围 */
    min?: number
    max?: number
    step?: number
    placeholder?: string
  }>(),
  {
    min: 0,
    step: 1,
    placeholder: '数字或 {变量}',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const innerValue = computed({
  get() {
    if (props.modelValue === undefined || props.modelValue === null) return ''
    return String(props.modelValue)
  },
  set(value: string) {
    const next = value ?? ''
    emit('update:modelValue', next)
    // 立即提交：el-input 的 change 仅在失焦/回车触发，切节点会丢未提交内容
    emit('change', next)
  },
})

/** 阻止方向键冒泡到控件树，长按时不会清掉/切走选中节点 */
function handleKeydown(event: Event) {
  const key = (event as KeyboardEvent).key
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    event.stopPropagation()
  }
}
</script>

<template>
  <el-input
    v-model="innerValue"
    class="numeric-input"
    clearable
    :placeholder="placeholder"
    @keydown="handleKeydown"
  />
</template>

<style scoped>
.numeric-input {
  width: 100%;
}
</style>
