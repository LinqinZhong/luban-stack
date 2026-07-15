<script setup lang="ts">
defineProps<{
  modelValue: string
  options?: Array<{ id: string; label: string }>
  placeholder?: string
  allowCreate?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

function optionLabel(opt: { id: string; label: string }) {
  if (!opt.label) return opt.id
  if (opt.id.startsWith('{')) return `${opt.label} · ${opt.id}`
  if (opt.label === opt.id) return opt.id
  return `${opt.label} (${opt.id})`
}

function onChange(value: string) {
  emit('update:modelValue', value ?? '')
  emit('change', value ?? '')
}
</script>

<template>
  <el-select
    :model-value="modelValue"
    filterable
    :allow-create="allowCreate !== false"
    default-first-option
    clearable
    :placeholder="placeholder || '选择图标'"
    style="width: 100%"
    @update:model-value="onChange"
  >
    <el-option
      v-for="opt in options ?? []"
      :key="opt.id"
      :label="optionLabel(opt)"
      :value="opt.id"
    />
  </el-select>
</template>
