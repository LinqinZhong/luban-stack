<script setup lang="ts">
import { computed } from 'vue'
import {
  selectValueToTypeExpr,
  typeExprToSelectValue,
  type TypeExpr,
} from '../../types/data-types'

const NONE_VALUE = '__none__'

const props = defineProps<{
  modelValue: TypeExpr | null
  namedOptions?: Array<{ id: string; label: string }>
  genericNames?: string[]
  /** 允许选择「无约束」，值为 null */
  allowNone?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TypeExpr | null]
}>()

const options = computed(() => {
  const base: Array<{ label: string; value: string }> = []
  if (props.allowNone) {
    base.push({ label: '无约束', value: NONE_VALUE })
  }
  base.push(
    { label: '数字', value: 'number' },
    { label: '字符串', value: 'string' },
    { label: '布尔值', value: 'boolean' },
    { label: 'any', value: 'any' },
  )
  for (const name of props.genericNames ?? []) {
    base.push({ label: `泛型 ${name}`, value: `generic:${name}` })
  }
  for (const opt of props.namedOptions ?? []) {
    base.push({ label: opt.label, value: `named:${opt.id}` })
  }
  return base
})

const selectValue = computed(() => {
  if (props.modelValue == null) {
    return props.allowNone ? NONE_VALUE : 'string'
  }
  return typeExprToSelectValue(props.modelValue)
})

function onChange(value: string) {
  if (value === NONE_VALUE) {
    emit('update:modelValue', null)
    return
  }
  emit('update:modelValue', selectValueToTypeExpr(value))
}
</script>

<template>
  <el-select
    :model-value="selectValue"
    filterable
    class="type-select"
    @update:model-value="onChange"
  >
    <el-option
      v-for="opt in options"
      :key="opt.value"
      :label="opt.label"
      :value="opt.value"
    />
  </el-select>
</template>

<style scoped>
.type-select {
  width: 100%;
}
</style>
