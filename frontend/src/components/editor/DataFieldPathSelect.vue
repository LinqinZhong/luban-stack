<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DataField } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import NumericInput from './NumericInput.vue'
import {
  buildConditionFieldTree,
  composeFieldPath,
  pathNeedsArrayIndex,
  splitFieldPath,
  type FieldPathTreeNode,
} from '../../utils/data-field-paths'

const props = defineProps<{
  modelValue: string
  fields?: DataField[]
  /** 组件参数定义；传入数组（含空数组）即展示 $props 根 */
  componentProps?: ComponentPropDef[] | null
  /** 路由参数；传入对象（含空对象）即展示 $route 根 */
  routeParams?: Record<string, unknown> | null
  /** 最近的 repeat 数组字段名 */
  repeatListName?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const treeSelected = ref('')
const arrayIndex = ref('')

const treeData = computed(() =>
  buildConditionFieldTree(
    props.fields ?? [],
    props.repeatListName,
    props.componentProps,
    props.routeParams,
  ),
)

/** 展平为 el-select 选项，避免 tree-select 在表格单元格内偶发「无数据」 */
const flatOptions = computed(() => {
  const out: Array<{ value: string; label: string }> = []

  function walk(nodes: FieldPathTreeNode[], trail: string[]) {
    for (const node of nodes) {
      const nextTrail = [...trail, node.label]
      if (node.selectable && node.value) {
        out.push({
          value: node.value,
          label: nextTrail.join(' / '),
        })
      }
      if (node.children?.length) {
        walk(node.children, nextTrail)
      }
    }
  }

  walk(treeData.value, [])
  return out
})

const showIndexInput = computed(() =>
  pathNeedsArrayIndex(
    treeSelected.value,
    props.fields ?? [],
    props.repeatListName,
    props.componentProps,
    props.routeParams,
  ),
)

watch(
  () => props.modelValue,
  (value) => {
    const { selected, arrayIndex: idx } = splitFieldPath(value || '')
    const exact = flatOptions.value.find((item) => item.value === (value || ''))
    if (exact) {
      treeSelected.value = exact.value
      arrayIndex.value = ''
      return
    }
    treeSelected.value = selected
    arrayIndex.value = idx
  },
  { immediate: true },
)

function emitPath() {
  const next = showIndexInput.value
    ? composeFieldPath(treeSelected.value, arrayIndex.value)
    : treeSelected.value.trim()
  emit('update:modelValue', next)
}

function onSelectChange() {
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
    <el-select
      v-if="flatOptions.length"
      v-model="treeSelected"
      filterable
      clearable
      placeholder="选择字段"
      style="flex: 1; min-width: 0"
      @change="onSelectChange"
    >
      <el-option
        v-for="opt in flatOptions"
        :key="opt.value"
        :label="opt.label"
        :value="opt.value"
      />
    </el-select>
    <el-input
      v-else
      :model-value="modelValue"
      clearable
      placeholder="输入字段，如 $props.id / $route.id"
      style="flex: 1; min-width: 0"
      @update:model-value="emit('update:modelValue', $event ?? '')"
    />
    <NumericInput
      v-if="flatOptions.length && showIndexInput"
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
