import { Cascader, Select } from 'antd'
import {
  COMPOSABLE_FIELD_TYPE_OPTIONS,
  DATA_FIELD_TYPE_OPTIONS,
  MAP_KEY_TYPE_OPTIONS,
  type DataFieldType,
  type MapKeyType,
} from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import { resolveNamedTypeAsField } from '../../utils/named-type-fields'
import './DataFieldTypeTreeSelect.css'

export type TypeSelectLeafType = DataFieldType | 'void' | 'generic'

export type TypeSelectPayload = {
  type: TypeSelectLeafType
  typeRef?: string
  itemType?: DataFieldType | 'generic'
  itemTypeRef?: string
  itemItemType?: DataFieldType | 'generic'
  itemItemTypeRef?: string
  keyType?: MapKeyType
  cleared?: boolean
  isNull?: boolean
}

const NULL_OPTION_VALUE = '__null__'

type TypeCategory = 'basic' | 'special' | 'custom'

interface CascaderNode {
  value: string
  label: string
  children?: CascaderNode[]
}

const GENERIC_GROUP = '__group__:__generics__'

const CATEGORY_OPTIONS: Array<{ label: string; value: TypeCategory }> = [
  { label: '基本数据类型', value: 'basic' },
  { label: '特殊类型', value: 'special' },
  { label: '自定义类型', value: 'custom' },
]

const BASIC_TYPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '布尔值', value: 'boolean' },
  { label: '字符串', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '数组', value: 'array' },
  { label: '对象', value: 'json' },
]

const SPECIAL_TYPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '颜色', value: 'color' },
  { label: '时间', value: 'time' },
  { label: '日期', value: 'date' },
  { label: '日期时间', value: 'datetime' },
  { label: '图标', value: 'icon' },
  { label: 'Resource', value: 'resource' },
  { label: '映射', value: 'map' },
  { label: '任意', value: 'any' },
]

export type DataFieldTypeTreeSelectProps = {
  type: TypeSelectLeafType
  typeRef?: string | null
  itemType?: DataFieldType | 'generic' | null
  itemTypeRef?: string | null
  itemItemType?: DataFieldType | 'generic' | null
  itemItemTypeRef?: string | null
  keyType?: MapKeyType | null
  empty?: boolean
  library?: DataTypeLibrary | null
  genericNames?: string[]
  excludeNamedIds?: string[]
  allowRef?: boolean
  allowNamed?: boolean
  allowVoid?: boolean
  allowNull?: boolean
  nullSelected?: boolean
  allowAny?: boolean
  emptyOnClear?: boolean
  composable?: boolean
  nested?: boolean
  excludeTypes?: DataFieldType[]
  mapLeaf?: boolean
  placeholder?: string
  clearable?: boolean
  size?: 'large' | 'default' | 'small'
  labelOverride?: string | null
  dualCategory?: boolean
  className?: string
  onChange?: (payload: TypeSelectPayload) => void
  onLabelClick?: () => void
}

function antdSize(size?: 'large' | 'default' | 'small') {
  if (size === 'large') return 'large' as const
  if (size === 'small') return 'small' as const
  return 'middle' as const
}

export default function DataFieldTypeTreeSelect({
  type,
  typeRef,
  itemType,
  itemTypeRef,
  itemItemType,
  itemItemTypeRef,
  keyType,
  empty = false,
  library,
  genericNames,
  excludeNamedIds,
  allowRef = false,
  allowNamed = true,
  allowVoid = false,
  allowNull = false,
  nullSelected = false,
  allowAny = false,
  emptyOnClear = false,
  composable = false,
  nested = false,
  excludeTypes,
  mapLeaf = false,
  placeholder = '选择类型',
  clearable = false,
  size = 'default',
  labelOverride,
  dualCategory = false,
  className,
  onChange,
  onLabelClick,
}: DataFieldTypeTreeSelectProps) {
  function baseOptions(): Array<{ label: string; value: DataFieldType }> {
    let base = nested
      ? DATA_FIELD_TYPE_OPTIONS.filter(
          (o) => o.value !== 'json' && o.value !== 'ref',
        )
      : composable
        ? [...COMPOSABLE_FIELD_TYPE_OPTIONS]
        : [...DATA_FIELD_TYPE_OPTIONS]

    if (!allowRef) {
      base = base.filter((o) => o.value !== 'ref')
    }
    if (excludeTypes?.length) {
      const ban = new Set(excludeTypes)
      base = base.filter((o) => !ban.has(o.value))
    }
    return base
  }

  function genericGroupNode(): CascaderNode | null {
    const names = (genericNames ?? []).map((n) => n.trim()).filter(Boolean)
    if (!names.length) return null
    return {
      value: GENERIC_GROUP,
      label: '泛型参数',
      children: names.map((name) => ({
        value: `generic:${name}`,
        label: name,
      })),
    }
  }

  function namedGroupNodes(): CascaderNode[] {
    if (allowNamed === false) return []
    const ban = new Set(excludeNamedIds ?? [])
    const nodes: CascaderNode[] = []
    for (const group of library?.groups ?? []) {
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

  function buildCascaderOptions(
    arrayDepth: number,
    forArrayElement = false,
  ): CascaderNode[] {
    const base = baseOptions().filter((o) => {
      if (o.value === 'any') return forArrayElement || allowAny
      if (o.value === 'ref') return !forArrayElement
      if (o.value === 'array' && arrayDepth < 0) return false
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
        if (mapLeaf) {
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

  const options = (() => {
    const nodes = buildCascaderOptions(2, false)
    const head: CascaderNode[] = []
    if (allowNull) {
      head.push({ value: NULL_OPTION_VALUE, label: 'NULL' })
    }
    if (allowVoid) {
      head.push({ value: 'void', label: 'void' })
    }
    return head.length ? [...head, ...nodes] : nodes
  })()

  function findNamedPath(ref: string): string[] {
    for (const group of library?.groups ?? []) {
      if (group.types.some((t) => t.id === ref)) {
        return [`__group__:${group.id}`, `named:${ref}`]
      }
    }
    return [`named:${ref}`]
  }

  function findGenericPath(name: string): string[] {
    return [GENERIC_GROUP, `generic:${name}`]
  }

  function encodeLeaf(
    leafType: DataFieldType | 'generic',
    leafRef?: string | null,
  ): string[] {
    if (leafType === 'generic' && leafRef) return findGenericPath(leafRef)
    if (leafRef) return findNamedPath(leafRef)
    return [leafType]
  }

  function encodeValuePath(): string[] {
    if (itemType === 'array') {
      return [
        'array',
        ...encodeLeaf(
          (itemItemType || 'string') as DataFieldType | 'generic',
          itemItemTypeRef,
        ),
      ]
    }
    return encodeLeaf(
      (itemType || 'string') as DataFieldType | 'generic',
      itemTypeRef,
    )
  }

  const cascaderValue = ((): string[] => {
    if (nullSelected && allowNull) return [NULL_OPTION_VALUE]
    if (type === 'map') {
      if (mapLeaf) return ['map']
      const key: MapKeyType = keyType === 'number' ? 'number' : 'string'
      return ['map', `mapKey:${key}`, ...encodeValuePath()]
    }
    if (empty) return []
    if (type === 'void') return ['void']
    if (type === 'generic') {
      return encodeLeaf('generic', typeRef)
    }
    if (type === 'array') {
      if (itemType === 'array') {
        return [
          'array',
          'array',
          ...encodeLeaf(
            (itemItemType || 'string') as DataFieldType | 'generic',
            itemItemTypeRef,
          ),
        ]
      }
      return [
        'array',
        ...encodeLeaf(
          (itemType || 'string') as DataFieldType | 'generic',
          itemTypeRef,
        ),
      ]
    }
    return encodeLeaf(type, typeRef)
  })()

  function decodeLeaf(path: string[]): {
    type: DataFieldType | 'generic'
    typeRef?: string
  } {
    const last = path[path.length - 1] || 'string'
    if (last.startsWith('named:')) {
      const id = last.slice(6)
      const resolved = resolveNamedTypeAsField(id, library)
      return {
        type: resolved.type,
        typeRef: resolved.typeRef || id,
      }
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
        path.length > 1
          ? decodeLeaf(path.slice(1))
          : { type: 'string' as DataFieldType }
      return {
        itemType: 'array',
        itemTypeRef: '',
        itemItemType: leaf.type,
        itemItemTypeRef: leaf.typeRef,
        typeRef: '',
      }
    }
    const leaf = path.length
      ? decodeLeaf(path)
      : { type: 'string' as DataFieldType }
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
      if (path.length === 1 || mapLeaf) {
        const nextKey: MapKeyType = keyType === 'number' ? 'number' : 'string'
        if (type === 'map' && itemType) {
          return {
            type: 'map',
            keyType: nextKey,
            itemType: itemType as DataFieldType | 'generic',
            itemTypeRef: itemTypeRef || undefined,
            itemItemType: (itemItemType || undefined) as
              | DataFieldType
              | 'generic'
              | undefined,
            itemItemTypeRef: itemItemTypeRef || undefined,
          }
        }
        return { type: 'map', keyType: nextKey, itemType: 'string' }
      }
      const keyToken = path[1] || 'mapKey:string'
      const nextKey: MapKeyType =
        keyToken === 'mapKey:number' || keyToken === 'number'
          ? 'number'
          : 'string'
      const value = decodeValuePath(path.slice(2))
      return {
        type: 'map',
        keyType: nextKey,
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

  function handleCascaderChange(value: (string | number)[] | undefined) {
    if (!value?.length) {
      if (emptyOnClear) {
        onChange?.({ type: 'string', cleared: true })
        return
      }
      onChange?.(allowVoid ? { type: 'void' } : { type: 'string' })
      return
    }
    onChange?.(decodePath(value.map(String)))
  }

  const overrideText = (labelOverride ?? '').trim()

  function resolveTypeCategory(): TypeCategory {
    if (nullSelected && allowNull) return 'basic'
    if (typeRef?.trim() && allowNamed !== false) return 'custom'
    if (type === 'generic') return 'custom'
    const t = type
    if (
      t === 'boolean' ||
      t === 'string' ||
      t === 'number' ||
      t === 'array' ||
      t === 'json'
    ) {
      return 'basic'
    }
    return 'special'
  }

  function dualLeafValue(): string {
    if (nullSelected && allowNull) return NULL_OPTION_VALUE
    if (type === 'generic' && typeRef?.trim()) {
      return `generic:${typeRef.trim()}`
    }
    if (typeRef?.trim()) return `named:${typeRef.trim()}`
    if (type === 'array') return 'array'
    if (type === 'map') return 'map'
    if (type === 'void') return 'void'
    return String(type || 'string')
  }

  const dualCategoryValue = resolveTypeCategory()

  const dualGroupOptions = (() => {
    const ban = new Set(excludeNamedIds ?? [])
    const groups: Array<{ label: string; value: string }> = []
    for (const group of library?.groups ?? []) {
      const hasType = (group.types ?? []).some(
        (t) => t.name?.trim() && !ban.has(t.id),
      )
      if (!hasType) continue
      groups.push({ label: group.name, value: group.id })
    }
    if ((genericNames ?? []).some((n) => n.trim())) {
      groups.unshift({ label: '泛型参数', value: GENERIC_GROUP })
    }
    return groups
  })()

  const dualGroupValue = (() => {
    if (dualCategoryValue !== 'custom') return ''
    if (type === 'generic' && typeRef?.trim()) return GENERIC_GROUP
    const ref = typeRef?.trim()
    if (ref) {
      for (const group of library?.groups ?? []) {
        if (group.types.some((t) => t.id === ref)) return group.id
      }
    }
    return dualGroupOptions[0]?.value ?? ''
  })()

  function dualLeafOptionsForCustom(): Array<{ label: string; value: string }> {
    const ban = new Set(excludeNamedIds ?? [])
    const groupId = dualGroupValue
    const named: Array<{ label: string; value: string }> = []

    if (groupId === GENERIC_GROUP) {
      return (genericNames ?? [])
        .map((n) => n.trim())
        .filter(Boolean)
        .map((name) => ({ value: `generic:${name}`, label: name }))
    }

    for (const group of library?.groups ?? []) {
      if (groupId && group.id !== groupId) continue
      for (const t of group.types ?? []) {
        if (!t.name?.trim() || ban.has(t.id)) continue
        named.push({
          value: `named:${t.id}`,
          label: t.name.trim(),
        })
      }
    }
    return named
  }

  const dualLeafOptions = (() => {
    const cat = dualCategoryValue
    if (cat === 'basic') {
      const list = [...BASIC_TYPE_OPTIONS]
      if (allowNull) {
        return [{ label: 'NULL', value: NULL_OPTION_VALUE }, ...list]
      }
      return list
    }
    if (cat === 'special') {
      let list = [...SPECIAL_TYPE_OPTIONS]
      if (!allowAny) {
        list = list.filter((o) => o.value !== 'any')
      }
      if (excludeTypes?.length) {
        const ban = new Set(excludeTypes)
        list = list.filter((o) => !ban.has(o.value as DataFieldType))
      }
      return list
    }
    return dualLeafOptionsForCustom()
  })()

  function emitDualLeaf(token: string) {
    if (token === NULL_OPTION_VALUE) {
      onChange?.({ type: 'string', isNull: true })
      return
    }
    if (token.startsWith('named:')) {
      const id = token.slice(6)
      const resolved = resolveNamedTypeAsField(id, library)
      onChange?.({
        type: resolved.type,
        typeRef: resolved.typeRef || id,
      })
      return
    }
    if (token.startsWith('generic:')) {
      onChange?.({ type: 'generic', typeRef: token.slice(8) })
      return
    }
    if (token === 'array') {
      onChange?.({ type: 'array', itemType: 'string' })
      return
    }
    if (token === 'map') {
      onChange?.({
        type: 'map',
        keyType: 'string',
        itemType: 'string',
      })
      return
    }
    if (token === 'void') {
      onChange?.({ type: 'void' })
      return
    }
    onChange?.({ type: token as DataFieldType })
  }

  function firstLeafInGroup(groupId: string): string | null {
    const ban = new Set(excludeNamedIds ?? [])
    if (groupId === GENERIC_GROUP) {
      const name = (genericNames ?? []).map((n) => n.trim()).find(Boolean)
      return name ? `generic:${name}` : null
    }
    for (const group of library?.groups ?? []) {
      if (group.id !== groupId) continue
      for (const t of group.types ?? []) {
        if (!t.name?.trim() || ban.has(t.id)) continue
        return `named:${t.id}`
      }
    }
    return null
  }

  function onDualCategoryChange(cat: TypeCategory) {
    if (cat === 'basic') {
      emitDualLeaf(allowNull ? NULL_OPTION_VALUE : 'string')
      return
    }
    if (cat === 'special') {
      const list = SPECIAL_TYPE_OPTIONS.filter((o) =>
        allowAny ? true : o.value !== 'any',
      )
      emitDualLeaf(list[0]?.value || 'color')
      return
    }
    const groupId = dualGroupOptions[0]?.value
    const leaf = groupId ? firstLeafInGroup(groupId) : null
    if (leaf) emitDualLeaf(leaf)
  }

  function onDualGroupChange(groupId: string) {
    const leaf = firstLeafInGroup(groupId)
    if (leaf) emitDualLeaf(leaf)
  }

  function onDualLeafChange(token: string) {
    emitDualLeaf(token)
  }

  const rootClass = [
    'type-tree-select',
    overrideText ? 'has-override' : '',
    dualCategory ? 'is-dual' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass}>
      {dualCategory ? (
        <div className="type-dual-select">
          <Select
            value={dualCategoryValue}
            size={antdSize(size)}
            placeholder="类别"
            className="type-dual-category"
            options={CATEGORY_OPTIONS}
            onChange={(v) => onDualCategoryChange(v as TypeCategory)}
          />
          {dualCategoryValue === 'custom' ? (
            <Select
              value={dualGroupValue || undefined}
              size={antdSize(size)}
              showSearch
              placeholder="分组"
              className="type-dual-group"
              options={dualGroupOptions}
              onChange={(v) => onDualGroupChange(String(v ?? ''))}
            />
          ) : null}
          <Select
            value={dualLeafValue()}
            size={antdSize(size)}
            showSearch
            placeholder={dualCategoryValue === 'custom' ? '类型' : placeholder}
            className="type-dual-leaf"
            options={dualLeafOptions}
            onChange={(v) => onDualLeafChange(String(v ?? ''))}
          />
        </div>
      ) : (
        <Cascader
          value={cascaderValue}
          options={options}
          placeholder={placeholder}
          allowClear={clearable}
          size={antdSize(size)}
          showSearch
          expandTrigger="hover"
          displayRender={
            overrideText ? () => '' : (labels) => labels.join(' / ')
          }
          style={{ width: '100%' }}
          onChange={(v) =>
            handleCascaderChange(v as (string | number)[] | undefined)
          }
        />
      )}
      {overrideText ? (
        <button
          type="button"
          className="type-override-label"
          title={overrideText}
          onClick={(e) => {
            e.stopPropagation()
            onLabelClick?.()
          }}
        >
          {overrideText}
        </button>
      ) : null}
    </div>
  )
}
