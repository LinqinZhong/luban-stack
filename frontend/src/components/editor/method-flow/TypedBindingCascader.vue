<script setup lang="ts">
import { computed } from 'vue'
import type { ProcessorTypeExpr } from '../../../types/backend-services'
import type { DataTypeLibrary } from '../../../types/data-types'
import type { MethodParam } from '../../../types/page-method'
import {
  buildTypedBindingCascaderOptions,
  isSelectableBindingPath,
  joinBindingPath,
  splitBindingPath,
  toElCascaderOptions,
} from '../../../utils/typed-binding-paths'

const props = defineProps<{
  modelValue: string
  ambientVars: MethodParam[]
  targetType: ProcessorTypeExpr | null | undefined
  typeLibrary?: DataTypeLibrary | null
  placeholder?: string
  /** 额外根节点（如 $query） */
  extraRoots?: import('../../../utils/typed-binding-paths').TypedBindingCascaderOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const rawOptions = computed(() =>
  buildTypedBindingCascaderOptions(
    props.ambientVars,
    props.targetType,
    props.typeLibrary,
    props.extraRoots,
  ),
)

const options = computed(() => toElCascaderOptions(rawOptions.value))

const cascaderProps = {
  checkStrictly: true,
  emitPath: true,
  expandTrigger: 'hover' as const,
}

const pathValue = computed((): string[] => {
  const segments = splitBindingPath(props.modelValue || '')
  if (!segments.length) return []
  // 历史自由文本若不在选项树中，仍回显为单段，避免清空
  if (!findInTree(rawOptions.value, segments)) {
    return segments.length === 1 ? segments : [props.modelValue]
  }
  return segments
})

function findInTree(
  nodes: ReturnType<typeof buildTypedBindingCascaderOptions>,
  segments: string[],
): boolean {
  let list = nodes
  for (const seg of segments) {
    const hit = list.find((n) => n.value === seg)
    if (!hit) return false
    list = hit.children ?? []
  }
  return true
}

function onPathChange(val: string[] | null | undefined) {
  if (!val?.length) {
    emit('update:modelValue', '')
    return
  }
  if (!isSelectableBindingPath(rawOptions.value, val)) {
    // 未类型匹配的中间节点：忽略本次选择
    return
  }
  emit('update:modelValue', joinBindingPath(val))
}
</script>

<template>
  <div class="typed-binding-wrap">
    <el-cascader
      :model-value="pathValue"
      :options="options"
      :props="cascaderProps"
      filterable
      clearable
      :placeholder="placeholder || '选择类型匹配的变量或字段'"
      class="typed-binding-cascader"
      @update:model-value="onPathChange"
    />
    <p v-if="!options.length" class="empty-hint">暂无类型匹配的可选变量</p>
  </div>
</template>

<style scoped>
.typed-binding-wrap {
  width: 100%;
  display: block;
}

.typed-binding-cascader {
  width: 100%;
  display: inline-flex;
}

.typed-binding-cascader :deep(.el-input),
.typed-binding-cascader :deep(.el-input__wrapper) {
  width: 100%;
}

.empty-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.3;
}
</style>
