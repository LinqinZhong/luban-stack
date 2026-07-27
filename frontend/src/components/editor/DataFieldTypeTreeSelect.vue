<script setup lang="ts">
import { computed } from 'vue'
import {
  COMPOSABLE_FIELD_TYPE_OPTIONS,
  DATA_FIELD_TYPE_OPTIONS,
  type DataFieldType,
} from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'

export type TypeSelectLeafType = DataFieldType | 'void' | 'generic'

export type TypeSelectPayload = {
  type: TypeSelectLeafType
  typeRef?: string
  itemType?: DataFieldType | 'generic'
  itemTypeRef?: string
  /** itemType === 'array' 时，内层数组的元素类型 */
  itemItemType?: DataFieldType | 'generic'
  itemItemTypeRef?: string
  /** clearable + emptyOnClear 清空时为 true */
  cleared?: boolean
}

interface CascaderNode {
  value: string
  label: string
  children?: CascaderNode[]
}

const GENERIC_GROUP = '__group__:__generics__'

const props = withDefaults(
  defineProps<{
    type: TypeSelectLeafType
    typeRef?: string | null
    itemType?: DataFieldType | 'generic' | null
    itemTypeRef?: string | null
    itemItemType?: DataFieldType | 'generic' | null
    itemItemTypeRef?: string | null
    /** 为 true 时 cascader 显示为空（未选择） */
    empty?: boolean
    library?: DataTypeLibrary | null
    /** 当前类型上的泛型参数名（如 T / U），展示在「泛型」分组 */
    genericNames?: string[]
    /** 排除的具名类型 id（如正在编辑的类型自身） */
    excludeNamedIds?: string[]
    allowRef?: boolean
    allowNamed?: boolean
    /** 允许选择 void（方法出参等） */
    allowVoid?: boolean
    /** 顶层也展示「任意」（类型库字段等；数据池仅数组元素层有 any） */
    allowAny?: boolean
    /** 清空时发出 cleared: true（类型库字段等） */
    emptyOnClear?: boolean
    composable?: boolean
    nested?: boolean
    excludeTypes?: DataFieldType[]
    placeholder?: string
    clearable?: boolean
    size?: 'large' | 'default' | 'small'
    /** 覆盖输入框展示文案（如 QueryPageVo<GoodsItem>） */
    labelOverride?: string | null
  }>(),
  {
    allowRef: false,
    allowNamed: true,
    allowVoid: false,
    allowAny: false,
    emptyOnClear: false,
    empty: false,
    composable: false,
    nested: false,
    clearable: false,
    placeholder: '选择类型',
    size: 'default',
  },
)

const emit = defineEmits<{
  change: [payload: TypeSelectPayload]
  /** 点击覆盖文案（用于打开泛型配置） */
  'label-click': []
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

function genericGroupNode(): CascaderNode | null {
  const names = (props.genericNames ?? []).map((n) => n.trim()).filter(Boolean)
  if (!names.length) return null
  return {
    value: GENERIC_GROUP,
    label: '泛型',
    children: names.map((name) => ({
      value: `generic:${name}`,
      label: name,
    })),
  }
}

function namedGroupNodes(): CascaderNode[] {
  if (props.allowNamed === false) return []
  const ban = new Set(props.excludeNamedIds ?? [])
  const nodes: CascaderNode[] = []
  for (const group of props.library?.groups ?? []) {
    const children = (group.types ?? [])
      .filter((t) => t.name?.trim() && !ban.has(t.id))
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
    if (o.value === 'any') return forArrayElement || props.allowAny
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
  const generics = genericGroupNode()
  if (generics) nodes.push(generics)
  nodes.push(...named)
  return nodes
}

const options = computed(() => {
  const nodes = buildCascaderOptions(2, false)
  if (props.allowVoid) {
    return [{ value: 'void', label: 'void' }, ...nodes]
  }
  return nodes
})

function findNamedPath(typeRef: string): string[] {
  for (const group of props.library?.groups ?? []) {
    if (group.types.some((t) => t.id === typeRef)) {
      return [`__group__:${group.id}`, `named:${typeRef}`]
    }
  }
  return [`named:${typeRef}`]
}

function findGenericPath(name: string): string[] {
  return [GENERIC_GROUP, `generic:${name}`]
}

function encodeLeaf(
  type: DataFieldType | 'generic',
  typeRef?: string | null,
): string[] {
  if (type === 'generic' && typeRef) return findGenericPath(typeRef)
  if (typeRef) return findNamedPath(typeRef)
  return [type]
}

const cascaderValue = computed<string[]>(() => {
  if (props.empty) return []
  if (props.type === 'void') return ['void']
  if (props.type === 'generic') {
    return encodeLeaf('generic', props.typeRef)
  }
  if (props.type === 'array') {
    if (props.itemType === 'array') {
      return [
        'array',
        'array',
        ...encodeLeaf(
          (props.itemItemType || 'string') as DataFieldType | 'generic',
          props.itemItemTypeRef,
        ),
      ]
    }
    return [
      'array',
      ...encodeLeaf(
        (props.itemType || 'string') as DataFieldType | 'generic',
        props.itemTypeRef,
      ),
    ]
  }
  return encodeLeaf(props.type, props.typeRef)
})

function decodeLeaf(path: string[]): {
  type: DataFieldType | 'generic'
  typeRef?: string
} {
  const last = path[path.length - 1] || 'string'
  if (last.startsWith('named:')) {
    return { type: 'json', typeRef: last.slice(6) }
  }
  if (last.startsWith('generic:')) {
    return { type: 'generic', typeRef: last.slice(8) }
  }
  if (last.startsWith('__group__:')) {
    return { type: 'string' }
  }
  const allowed = DATA_FIELD_TYPE_OPTIONS.some((o) => o.value === last)
  return { type: (allowed ? last : 'string') as DataFieldType }
}

function decodePath(path: string[]): TypeSelectPayload {
  if (!path.length) return { type: 'string' }
  if (path[0] === 'void') return { type: 'void' }

  let arrayDepth = 0
  while (path[arrayDepth] === 'array') arrayDepth += 1
  const leafPath = path.slice(arrayDepth)
  const leaf = leafPath.length
    ? decodeLeaf(leafPath)
    : { type: 'string' as DataFieldType }

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
  return {
    type: 'array',
    itemType: 'array',
    itemItemType: leaf.type,
    itemItemTypeRef: leaf.typeRef,
  }
}

function onChange(value: string[] | null | undefined) {
  if (!value?.length) {
    if (props.emptyOnClear) {
      emit('change', { type: 'string', cleared: true })
      return
    }
    emit('change', props.allowVoid ? { type: 'void' } : { type: 'string' })
    return
  }
  emit('change', decodePath(value))
}

const overrideText = computed(() => (props.labelOverride ?? '').trim())
</script>

<template>
  <div class="type-tree-select" :class="{ 'has-override': Boolean(overrideText) }">
    <el-cascader
      :model-value="cascaderValue"
      :options="options"
      :placeholder="placeholder"
      :clearable="clearable"
      :size="size"
      filterable
      :show-all-levels="!overrideText"
      :props="{ expandTrigger: 'hover' }"
      style="width: 100%"
      @update:model-value="onChange"
    />
    <button
      v-if="overrideText"
      type="button"
      class="type-override-label"
      :title="overrideText"
      @click.stop="emit('label-click')"
    >
      {{ overrideText }}
    </button>
  </div>
</template>

<style scoped>
.type-tree-select {
  position: relative;
  width: 100%;
}

.type-tree-select.has-override :deep(.el-input__inner),
.type-tree-select.has-override :deep(.el-input__wrapper input) {
  color: transparent !important;
  -webkit-text-fill-color: transparent;
}

.type-override-label {
  position: absolute;
  left: 11px;
  right: 30px;
  top: 50%;
  transform: translateY(-50%);
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 13px;
  line-height: 1.2;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}
</style>

