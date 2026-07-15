<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DataField } from '../../types/page-data'
import NumericInput from './NumericInput.vue'
import {
  buildConditionFieldTree,
  composeFieldPath,
  disableNonSelectable,
  pathNeedsArrayIndex,
  splitFieldPath,
} from '../../utils/data-field-paths'

const props = defineProps<{
  modelValue: string
  fields?: DataField[]
  /** 最近的 repeat 数组字段名 */
  repeatListName?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const treeSelected = ref('')
const arrayIndex = ref('')

const treeData = computed(() =>
  disableNonSelectable(
    buildConditionFieldTree(props.fields ?? [], props.repeatListName),
  ),
)

const showIndexInput = computed(() =>
  pathNeedsArrayIndex(
    treeSelected.value,
    props.fields ?? [],
    props.repeatListName,
  ),
)

watch(
  () => props.modelValue,
  (value) => {
    const { selected, arrayIndex: idx } = splitFieldPath(value || '')
    // 若完整 path 在树里能精确命中（含 list[0].x），优先整段选中
    const exact = findExactInTree(treeData.value, value || '')
    if (exact) {
      treeSelected.value = exact
      arrayIndex.value = ''
      return
    }
    treeSelected.value = selected
    arrayIndex.value = idx
  },
  { immediate: true },
)

function findExactInTree(
  nodes: Array<{ value?: string; children?: unknown[] }>,
  value: string,
): string {
  if (!value) return ''
  for (const node of nodes) {
    if (node.value === value) return value
    const kids = node.children as Array<{ value?: string; children?: unknown[] }> | undefined
    if (kids?.length) {
      const found = findExactInTree(kids, value)
      if (found) return found
    }
  }
  return ''
}

function emitPath() {
  const next = showIndexInput.value
    ? composeFieldPath(treeSelected.value, arrayIndex.value)
    : treeSelected.value.trim()
  emit('update:modelValue', next)
}

function onTreeChange() {
  if (!showIndexInput.value) {
    arrayIndex.value = ''
  } else if (!arrayIndex.value) {
    arrayIndex.value = '0'
  }
  emitPath()
}

function onIndexChange() {
  emitPath()
}
</script>

<template>
  <div class="field-path-select">
    <el-tree-select
      v-model="treeSelected"
      :data="treeData"
      filterable
      clearable
      check-strictly
      :render-after-expand="false"
      default-expand-all
      placeholder="选择字段"
      :props="{
        label: 'label',
        children: 'children',
        value: 'value',
        disabled: 'disabled',
      }"
      style="flex: 1; min-width: 0"
      @change="onTreeChange"
    />
    <NumericInput
      v-if="showIndexInput"
      v-model="arrayIndex"
      class="index-input"
      placeholder="下标"
      :min="0"
      :max="9999"
      @change="onIndexChange"
    />
  </div>
</template>

<style scoped>
.field-path-select {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.index-input {
  width: 72px;
  flex-shrink: 0;
}
</style>
