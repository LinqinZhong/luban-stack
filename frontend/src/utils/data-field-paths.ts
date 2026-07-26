import type { DataField, DataFieldType } from '../types/page-data'
import { defaultValue, inferValueType } from '../types/page-data'
import type { ComponentPropDef } from '../types/component'
import { findNodeFromXml } from './xml-node'

export interface FieldPathTreeNode {
  id: string
  label: string
  /** 选中写入条件的 path；不可选节点为空串 */
  value: string
  type: DataFieldType | 'index'
  selectable: boolean
  children?: FieldPathTreeNode[]
}

/** 自当前节点向上（含自身）查找最近的 repeat 数组字段名 */
export function findNearestRepeatListName(xml: string, nodeId: string): string | null {
  if (!nodeId) return null
  let currentId: string | null = nodeId
  while (currentId) {
    const node = findNodeFromXml(xml, currentId)
    const list = node?.attrs.repeat?.trim()
    if (list) return list
    if (!currentId.includes('/')) break
    currentId = currentId.slice(0, currentId.lastIndexOf('/'))
  }
  return null
}

/** 从数组字段 schema / 样例对象中收集 type=icon 的 object 字段名 */
export function collectIconFieldNamesFromArray(field: DataField | undefined): string[] {
  if (!field || field.type !== 'array') return []

  const names = new Set<string>()

  if (Array.isArray(field.arrayFields)) {
    for (const item of field.arrayFields) {
      if (item.type !== 'json') continue
      for (const sub of item.objectFields ?? []) {
        if (sub.type === 'icon' && sub.name.trim()) {
          names.add(sub.name.trim())
        }
      }
    }
  }

  return Array.from(names)
}

/**
 * 重复列表内可供 Icon.iconId 绑定的选项。
 * 返回 value 形如 `{item.icon}`，label 方便展示。
 */
export function listRepeatItemIconOptions(
  fields: DataField[],
  listName: string | null | undefined,
  componentProps?: ComponentPropDef[] | null,
): Array<{ id: string; label: string }> {
  if (!listName?.trim()) return []
  const key = listName.trim()
  if (key.startsWith('$props.')) {
    const propName = key.slice('$props.'.length).trim()
    const def = (componentProps ?? []).find((item) => item.name.trim() === propName)
    if (!def || def.type !== 'array') return []
    const asField: DataField = {
      name: propName,
      type: 'array',
      remark: '',
      value: Array.isArray(def.defaultValue) ? def.defaultValue : [],
      binding: 'literal',
    }
    const iconNames = collectIconFieldNamesFromArray(asField)
    return iconNames.map((name) => ({
      id: `{item.${name}}`,
      label: `重复项 · ${name}`,
    }))
  }
  const field = fields.find((item) => item.name.trim() === key)
  const iconNames = collectIconFieldNamesFromArray(field)
  return iconNames.map((name) => ({
    id: `{item.${name}}`,
    label: `重复项 · ${name}`,
  }))
}

function joinPath(parent: string, key: string): string {
  if (!parent) return key
  if (key.startsWith('[')) return `${parent}${key}`
  return `${parent}.${key}`
}

function buildFromUnknown(
  path: string,
  label: string,
  value: unknown,
): FieldPathTreeNode {
  const type = inferValueType(value)

  if (type === 'array' && Array.isArray(value)) {
    const children = value.map((item, index) =>
      buildFromUnknown(`${path}[${index}]`, `[${index}]`, item),
    )
    return {
      id: path || label,
      label: `${label} []`,
      value: path,
      type: 'array',
      selectable: true,
      children: children.length ? children : undefined,
    }
  }

  if (type === 'json' && value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    return {
      id: path || label,
      label,
      value: path,
      type: 'json',
      selectable: true,
      children: entries.length
        ? entries.map(([key, child]) =>
            buildFromUnknown(joinPath(path, key), key, child),
          )
        : undefined,
    }
  }

  return {
    id: path || label,
    label,
    value: path,
    type,
    selectable: true,
  }
}

function buildRepeatItemTree(
  listName: string,
  fields: DataField[],
  componentProps?: ComponentPropDef[] | null,
): FieldPathTreeNode | null {
  let sample: unknown
  let itemType: DataFieldType | 'index' = 'json'

  if (listName.startsWith('$props.')) {
    const propName = listName.slice('$props.'.length).trim()
    const def = (componentProps ?? []).find((item) => item.name.trim() === propName)
    const raw =
      def?.defaultValue === '' || def?.defaultValue === undefined
        ? defaultValue('array')
        : def.defaultValue
    const arr = Array.isArray(raw) ? raw : []
    sample = arr.find(
      (item) => item && typeof item === 'object' && !Array.isArray(item),
    )
    itemType = sample
      ? 'json'
      : arr.length
        ? inferValueType(arr[0])
        : 'json'
  } else {
    const field = fields.find((item) => item.name.trim() === listName)
    if (!field || field.type !== 'array' || !Array.isArray(field.value)) {
      return {
        id: '__repeat__',
        label: `重复 · ${listName}`,
        value: `__repeat__${listName}`,
        type: 'json',
        selectable: false,
        children: [
          {
            id: 'index',
            label: 'index（索引）',
            value: 'index',
            type: 'index',
            selectable: true,
          },
          {
            id: 'item',
            label: 'item',
            value: 'item',
            type: 'json',
            selectable: true,
          },
        ],
      }
    }
    sample = field.value.find(
      (item) => item && typeof item === 'object' && !Array.isArray(item),
    )
    itemType = sample
      ? 'json'
      : inferValueType(field.value[0])
  }

  const itemChildren: FieldPathTreeNode[] = [
    {
      id: 'index',
      label: 'index（索引）',
      value: 'index',
      type: 'index',
      selectable: true,
    },
    {
      id: 'item',
      label: 'item',
      value: 'item',
      type: itemType,
      selectable: true,
      children:
        sample && typeof sample === 'object' && !Array.isArray(sample)
          ? Object.entries(sample as Record<string, unknown>).map(([key, child]) =>
              buildFromUnknown(`item.${key}`, key, child),
            )
          : undefined,
    },
  ]

  return {
    id: '__repeat__',
    label: `重复 · ${listName}`,
    value: `__repeat__${listName}`,
    type: 'json',
    selectable: false,
    children: itemChildren,
  }
}

/** 组件参数树：$props / $props.xxx（componentProps 非 null/undefined 时始终展示根） */
function buildPropsTree(
  componentProps: ComponentPropDef[] | null | undefined,
): FieldPathTreeNode | null {
  if (componentProps == null) return null

  const list = Array.isArray(componentProps) ? componentProps : []
  const defs = list.filter((item) => item?.name?.trim())
  return {
    id: '$props',
    label: '$props（组件参数）',
    value: '$props',
    type: 'json',
    selectable: true,
    children: defs.length
      ? defs.map((def) => {
          const name = def.name.trim()
          const sample =
            def.defaultValue === '' || def.defaultValue === undefined
              ? defaultValue(def.type)
              : def.defaultValue
          return buildFromUnknown(`$props.${name}`, name, sample)
        })
      : undefined,
  }
}

/** 路由参数树：$route / $route.xxx */
function buildRouteTree(
  routeParams: Record<string, unknown> | null | undefined,
): FieldPathTreeNode | null {
  if (routeParams == null) return null

  const entries = Object.entries(routeParams)
  return {
    id: '$route',
    label: '$route（路由参数）',
    value: '$route',
    type: 'json',
    selectable: true,
    children: entries.length
      ? entries.map(([key, value]) =>
          buildFromUnknown(`$route.${key}`, key, value),
        )
      : [
          // 编辑态尚无跳转参数时，仍提供常用 id 供选择
          buildFromUnknown('$route.id', 'id', ''),
        ],
  }
}

/** 构建条件字段树：数据池 + 组件 $props + 路由 $route + repeat */
export function buildConditionFieldTree(
  fields: DataField[],
  repeatListName?: string | null,
  componentProps?: ComponentPropDef[] | null,
  routeParams?: Record<string, unknown> | null,
): FieldPathTreeNode[] {
  const roots: FieldPathTreeNode[] = []

  const propsRoot = buildPropsTree(componentProps)
  if (propsRoot) roots.push(propsRoot)

  const routeRoot = buildRouteTree(routeParams)
  if (routeRoot) roots.push(routeRoot)

  if (repeatListName) {
    const repeatRoot = buildRepeatItemTree(
      repeatListName,
      fields,
      componentProps,
    )
    if (repeatRoot) roots.push(repeatRoot)
  }

  for (const field of fields) {
    const name = field.name.trim()
    if (!name || name === '$props' || name === '$route') continue
    roots.push(buildFromUnknown(name, name, field.value))
  }

  return roots
}

/** 判断 path 末段是否落在某个数组字段上（还需下标才能落到具体项） */
export function pathNeedsArrayIndex(
  path: string,
  fields: DataField[],
  repeatListName?: string | null,
  componentProps?: ComponentPropDef[] | null,
  routeParams?: Record<string, unknown> | null,
): boolean {
  if (!path || path === 'index' || path === 'item' || path.startsWith('item.')) {
    if (path.startsWith('item.') && !/\[\d+\]$/.test(path)) {
      const node = findTreeNodeByValue(
        buildConditionFieldTree(fields, repeatListName, componentProps, routeParams),
        path,
      )
      return node?.type === 'array'
    }
    return false
  }
  if (/\[\d+\]$/.test(path)) return false

  const node = findTreeNodeByValue(
    buildConditionFieldTree(fields, repeatListName, componentProps, routeParams),
    path,
  )
  return node?.type === 'array'
}

export function findTreeNodeByValue(
  nodes: FieldPathTreeNode[],
  value: string,
): FieldPathTreeNode | null {
  for (const node of nodes) {
    if (node.value === value) return node
    if (node.children?.length) {
      const found = findTreeNodeByValue(node.children, value)
      if (found) return found
    }
  }
  return null
}

/** 将树选中值与可选数组下标合成最终 path */
export function composeFieldPath(selected: string, arrayIndex: string): string {
  const base = selected.trim()
  if (!base) return ''
  if (base === 'index' || base === 'item' || base.startsWith('item.')) return base
  if (/\[\d+\]/.test(base)) return base
  const idx = arrayIndex.trim()
  if (idx === '' || !/^\d+$/.test(idx)) return base
  return `${base}[${Number(idx)}]`
}

/** 从完整 path 拆出 tree 选中值与数组下标（若末尾为 [n] 且父级是数组字段） */
export function splitFieldPath(path: string): { selected: string; arrayIndex: string } {
  const raw = path.trim()
  if (!raw) return { selected: '', arrayIndex: '' }
  const match = raw.match(/^(.*)\[(\d+)\]$/)
  if (!match) return { selected: raw, arrayIndex: '' }
  return { selected: match[1], arrayIndex: match[2] }
}

export function disableNonSelectable(nodes: FieldPathTreeNode[]): Array<
  FieldPathTreeNode & { disabled?: boolean }
> {
  return nodes.map((node) => ({
    ...node,
    disabled: !node.selectable,
    children: node.children?.length
      ? disableNonSelectable(node.children)
      : undefined,
  }))
}
