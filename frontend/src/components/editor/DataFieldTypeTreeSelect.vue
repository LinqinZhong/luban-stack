<script setup lang="ts">
import { computed } from 'vue'
import {
  COMPOSABLE_FIELD_TYPE_OPTIONS,
  DATA_FIELD_TYPE_OPTIONS,
  type DataFieldType,
} from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'

export type TypeSelectPayload = {
  type: DataFieldType
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  /** itemType === 'array' 时，内层数组的元素类型 */
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}

interface CascaderNode {
  value: string
  label: string
  children?: CascaderNode[]
}

const props = withDefaults(
  defineProps<{
    type: DataFieldType
    typeRef?: string | null
    itemType?: DataFieldType | null
    itemTypeRef?: string | null
    itemItemType?: DataFieldType | null
    itemItemTypeRef?: string | null
    library?: DataTypeLibrary | null
    allowRef?: boolean
    allowNamed?: boolean
    composable?: boolean
    nested?: boolean
    excludeTypes?: DataFieldType[]
    placeholder?: string
    clearable?: boolean
    size?: 'large' | 'default' | 'small'
  }>(),
  {
    allowRef: false,
    allowNamed: true,
    composable: false,
    nested: false,
    clearable: false,
    placeholder: '选择类型',
    size: 'default',
  },
)

const emit = defineEmits<{
  change: [payload: TypeSelectPayload]
}>()

function baseOptions(): Array<{ label: string; value: DataFieldType }> {
  let base = props.nested
    ? DATA_FIELD_TYPE_OPTIONS.filter(
        (o) => o.value !== 'json' && o.value !== 'ref',
      )
    : props.composable
      ? [...COMPOSABLE_FIELD_TYPE_OPTIONS]
      : [...DATA_FIELD_TYPE_OPTIONS]

  if (!props.allowRef) {
    base = base.filter((o) => o.value !== 'ref')
  }
  if (props.excludeTypes?.length) {
    const ban = new Set(props.excludeTypes)
    base = base.filter((o) => !ban.has(o.value))
  }
  return base
}

function namedGroupNodes(): CascaderNode[] {
  if (props.allowNamed === false) return []
  const nodes: CascaderNode[] = []
  for (const group of props.library?.groups ?? []) {
    const children = (group.types ?? [])
      .filter((t) => t.name?.trim())
      .map((t) => ({
        value: `named:${t.id}`,
        label: t.name.trim(),
      }))
    if (!children.length) continue
    nodes.push({
      value: `__group__:${group.id}`,
      label: group.name,
      children,
    })
  }
  return nodes
}

/**
 * arrayDepth：数组下还可再展开几层元素类型（>0 可继续嵌套数组；0 仍可选元素但不再嵌套数组；<0 不再出现数组）
 * forArrayElement：元素类型层才展示「任意」（any[]）
 */
function buildCascaderOptions(arrayDepth: number, forArrayElement = false): CascaderNode[] {
  // 数组元素类型不含「引用」（引用仅数据池顶层）
  const base = baseOptions().filter((o) => {
    if (o.value === 'any') return forArrayElement
    if (o.value === 'ref') return !forArrayElement
    if (o.value === 'array' && arrayDepth < 0) return false
    return true
  })
  const named = namedGroupNodes()
  const nodes: CascaderNode[] = []

  for (const opt of base) {
    if (opt.value === 'array') {
      nodes.push({
        value: 'array',
        label: opt.label,
        children: buildCascaderOptions(arrayDepth - 1, true),
      })
    } else {
      nodes.push({ value: opt.value, label: opt.label })
    }
  }
  nodes.push(...named)
  return nodes
}

const options = computed(() => buildCascaderOptions(2, false))

function findNamedPath(typeRef: string): string[] {
  for (const group of props.library?.groups ?? []) {
    if (group.types.some((t) => t.id === typeRef)) {
      return [`__group__:${group.id}`, `named:${typeRef}`]
    }
  }
  return [`named:${typeRef}`]
}

function encodeLeaf(type: DataFieldType, typeRef?: string | null): string[] {
  if (typeRef) return findNamedPath(typeRef)
  return [type]
}

const cascaderValue = computed<string[]>(() => {
  if (props.type === 'array') {
    if (props.itemType === 'array') {
      return [
        'array',
        'array',
        ...encodeLeaf(props.itemItemType || 'string', props.itemItemTypeRef),
      ]
    }
    return [
      'array',
      ...encodeLeaf(props.itemType || 'string', props.itemTypeRef),
    ]
  }
  return encodeLeaf(props.type, props.typeRef)
})

function decodeLeaf(path: string[]): {
  type: DataFieldType
  typeRef?: string
} {
  const last = path[path.length - 1] || 'string'
  if (last.startsWith('named:')) {
    return { type: 'json', typeRef: last.slice(6) }
  }
  if (last.startsWith('__group__:')) {
    return { type: 'string' }
  }
  const allowed = DATA_FIELD_TYPE_OPTIONS.some((o) => o.value === last)
  return { type: (allowed ? last : 'string') as DataFieldType }
}

function decodePath(path: string[]): TypeSelectPayload {
  if (!path.length) return { type: 'string' }

  let arrayDepth = 0
  while (path[arrayDepth] === 'array') arrayDepth += 1
  const leafPath = path.slice(arrayDepth)
  const leaf = leafPath.length ? decodeLeaf(leafPath) : { type: 'string' as DataFieldType }

  if (arrayDepth === 0) {
    return { type: leaf.type, typeRef: leaf.typeRef }
  }
  if (arrayDepth === 1) {
    return {
      type: 'array',
      itemType: leaf.type,
      itemTypeRef: leaf.typeRef,
    }
  }
  // array / array / …element（多层数组时，模型保留两层：外层数组 → 内层数组 → 元素）
  return {
    type: 'array',
    itemType: 'array',
    itemItemType: leaf.type,
    itemItemTypeRef: leaf.typeRef,
  }
}

function onChange(value: string[] | null | undefined) {
  if (!value?.length) {
    emit('change', { type: 'string' })
    return
  }
  emit('change', decodePath(value))
}
</script>

<template>
  <el-cascader
    :model-value="cascaderValue"
    :options="options"
    :placeholder="placeholder"
    :clearable="clearable"
    :size="size"
    filterable
    :props="{ expandTrigger: 'hover' }"
    style="width: 100%"
    @update:model-value="onChange"
  />
</template>
