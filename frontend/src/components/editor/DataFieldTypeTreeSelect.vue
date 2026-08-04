<script setup lang="ts">
import { computed } from 'vue'
import {
  COMPOSABLE_FIELD_TYPE_OPTIONS,
  DATA_FIELD_TYPE_OPTIONS,
  MAP_KEY_TYPE_OPTIONS,
  type DataFieldType,
  type MapKeyType,
} from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'

export type TypeSelectLeafType = DataFieldType | 'void' | 'generic'

export type TypeSelectPayload = {
  type: TypeSelectLeafType
  typeRef?: string
  itemType?: DataFieldType | 'generic'
  itemTypeRef?: string
  /** itemType === 'array' ??????????? */
  itemItemType?: DataFieldType | 'generic'
  itemItemTypeRef?: string
  /** type === 'map' ????? */
  keyType?: MapKeyType
  /** clearable + emptyOnClear ???? true */
  cleared?: boolean
  /** 选中顶部 NULL：字段值应为 null */
  isNull?: boolean
}

const NULL_OPTION_VALUE = '__null__'

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
    keyType?: MapKeyType | null
    /** ? true ? cascader ????????? */
    empty?: boolean
    library?: DataTypeLibrary | null
    /** ????????????? T / U??????????? */
    genericNames?: string[]
    /** ??????? id???????????? */
    excludeNamedIds?: string[]
    allowRef?: boolean
    allowNamed?: boolean
    /** ???? void??????? */
    allowVoid?: boolean
    /** 顶部增加 NULL（对象字段值可为空） */
    allowNull?: boolean
    /** 当前值为 null 时选中 NULL */
    nullSelected?: boolean
    /** ??????????????????????????? any? */
    allowAny?: boolean
    /** ????? cleared: true???????? */
    emptyOnClear?: boolean
    composable?: boolean
    nested?: boolean
    excludeTypes?: DataFieldType[]
    /** ? true ??????????????/??? */
    mapLeaf?: boolean
    placeholder?: string
    clearable?: boolean
    size?: 'large' | 'default' | 'small'
    /** ??????????? QueryPageVo<GoodsItem>? */
    labelOverride?: string | null
  }>(),
  {
    allowRef: false,
    allowNamed: true,
    allowVoid: false,
    allowNull: false,
    nullSelected: false,
    allowAny: false,
    emptyOnClear: false,
    empty: false,
    composable: false,
    nested: false,
    mapLeaf: false,
    clearable: false,
    placeholder: '????',
    size: 'default',
  },
)

const emit = defineEmits<{
  change: [payload: TypeSelectPayload]
  /** ???????????????? */
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
    label: '??',
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
 * arrayDepth????????????????>0 ????????0 ?????????????<0 ???????
 * forArrayElement??????????????any[]?
 */
function buildCascaderOptions(arrayDepth: number, forArrayElement = false): CascaderNode[] {
  // ??????????????????????
  const base = baseOptions().filter((o) => {
    if (o.value === 'any') return forArrayElement || props.allowAny
    if (o.value === 'ref') return !forArrayElement
    if (o.value === 'array' && arrayDepth < 0) return false
    // ?????????????? / ??????? map ?????
    if (o.value === 'map' && forArrayElement) return false
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
    } else if (opt.value === 'map') {
      if (props.mapLeaf) {
        nodes.push({ value: 'map', label: opt.label })
      } else {
        nodes.push({
          value: 'map',
          label: opt.label,
          children: MAP_KEY_TYPE_OPTIONS.map((k) => ({
            value: `mapKey:${k.value}`,
            label: k.label,
            children: buildCascaderOptions(arrayDepth, true),
          })),
        })
      }
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
  const head: CascaderNode[] = []
  if (props.allowNull) {
    head.push({ value: NULL_OPTION_VALUE, label: 'NULL' })
  }
  if (props.allowVoid) {
    head.push({ value: 'void', label: 'void' })
  }
  return head.length ? [...head, ...nodes] : nodes
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

function encodeValuePath(): string[] {
  if (props.itemType === 'array') {
    return [
      'array',
      ...encodeLeaf(
        (props.itemItemType || 'string') as DataFieldType | 'generic',
        props.itemItemTypeRef,
      ),
    ]
  }
  return encodeLeaf(
    (props.itemType || 'string') as DataFieldType | 'generic',
    props.itemTypeRef,
  )
}

const cascaderValue = computed<string[]>(() => {
  if (props.nullSelected && props.allowNull) return [NULL_OPTION_VALUE]
  if (props.type === 'map') {
    if (props.mapLeaf) return ['map']
    const key: MapKeyType = props.keyType === 'number' ? 'number' : 'string'
    return ['map', `mapKey:${key}`, ...encodeValuePath()]
  }
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

function decodeValuePath(path: string[]): Pick<
  TypeSelectPayload,
  'itemType' | 'itemTypeRef' | 'itemItemType' | 'itemItemTypeRef' | 'typeRef'
> {
  if (path[0] === 'array') {
    const leaf =
      path.length > 1 ? decodeLeaf(path.slice(1)) : { type: 'string' as DataFieldType }
    return {
      itemType: 'array',
      itemTypeRef: '',
      itemItemType: leaf.type,
      itemItemTypeRef: leaf.typeRef,
      typeRef: '',
    }
  }
  const leaf = path.length ? decodeLeaf(path) : { type: 'string' as DataFieldType }
  return {
    itemType: leaf.type,
    itemTypeRef: leaf.typeRef,
    typeRef: '',
  }
}

function decodePath(path: string[]): TypeSelectPayload {
  if (!path.length) return { type: 'string' }
  if (path[0] === NULL_OPTION_VALUE) {
    return { type: 'string', isNull: true }
  }
  if (path[0] === 'map') {
    // ????????????/?????? ??? ? ???
    if (path.length === 1 || props.mapLeaf) {
      const keyType: MapKeyType =
        props.keyType === 'number' ? 'number' : 'string'
      if (props.type === 'map' && props.itemType) {
        return {
          type: 'map',
          keyType,
          itemType: props.itemType as DataFieldType | 'generic',
          itemTypeRef: props.itemTypeRef || undefined,
          itemItemType: (props.itemItemType || undefined) as
            | DataFieldType
            | 'generic'
            | undefined,
          itemItemTypeRef: props.itemItemTypeRef || undefined,
        }
      }
      return { type: 'map', keyType, itemType: 'string' }
    }
    const keyToken = path[1] || 'mapKey:string'
    const keyType: MapKeyType =
      keyToken === 'mapKey:number' || keyToken === 'number' ? 'number' : 'string'
    const value = decodeValuePath(path.slice(2))
    return {
      type: 'map',
      keyType,
      ...value,
    }
  }
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

