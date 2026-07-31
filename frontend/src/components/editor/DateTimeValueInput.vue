<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null
    kind: 'time' | 'date' | 'datetime'
    size?: 'small' | 'default' | 'large'
    placeholder?: string
    clearable?: boolean
  }>(),
  {
    size: 'default',
    clearable: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const text = computed(() =>
  props.modelValue == null || props.modelValue === ''
    ? null
    : String(props.modelValue),
)

const valueFormat = computed(() => {
  if (props.kind === 'time') return 'HH:mm:ss'
  if (props.kind === 'date') return 'YYYY-MM-DD'
  return 'YYYY-MM-DD HH:mm:ss'
})

const hint = computed(() => {
  if (props.placeholder) return props.placeholder
  if (props.kind === 'time') return '选择时间'
  if (props.kind === 'date') return '选择日期'
  return '选择日期时间'
})

function onUpdate(v: string | null) {
  emit('update:modelValue', v == null ? '' : String(v))
}
</script>

<template>
  <el-time-picker
    v-if="kind === 'time'"
    class="datetime-value-input"
    :model-value="text"
    :size="size"
    :clearable="clearable"
    :placeholder="hint"
    :value-format="valueFormat"
    format="HH:mm:ss"
    @update:model-value="onUpdate"
  />
  <el-date-picker
    v-else
    class="datetime-value-input"
    :model-value="text"
    :type="kind === 'date' ? 'date' : 'datetime'"
    :size="size"
    :clearable="clearable"
    :placeholder="hint"
    :value-format="valueFormat"
    :format="valueFormat"
    @update:model-value="onUpdate"
  />
</template>

<style scoped>
.datetime-value-input {
  width: 100%;
}
</style>
