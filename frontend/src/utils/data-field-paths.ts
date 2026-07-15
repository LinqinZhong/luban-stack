import type { DataField, DataFieldType } from '../types/page-data'
import { findNodeFromXml } from './xml-node'
import { inferValueType } from '../types/page-data'

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
): Array<{ id: string; label: string }> {
  if (!listName?.trim()) return []
  const field = fields.find((item) => item.name.trim() === listName.trim())
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
): FieldPathTreeNode | null {
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

  const sample = field.value.find(
    (item) => item && typeof item === 'object' && !Array.isArray(item),
  )
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
      type: sample ? 'json' : inferValueType(field.value[0]),
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

/** 构建条件字段树：可选数据池字段 + 祖先/自身 repeat 的 index / item.xxx */
export function buildConditionFieldTree(
  fields: DataField[],
  repeatListName?: string | null,
): FieldPathTreeNode[] {
  const roots: FieldPathTreeNode[] = []

  if (repeatListName) {
    const repeatRoot = buildRepeatItemTree(repeatListName, fields)
    if (repeatRoot) roots.push(repeatRoot)
  }

  for (const field of fields) {
    const name = field.name.trim()
    if (!name) continue
    roots.push(buildFromUnknown(name, name, field.value))
  }

  return roots
}

/** 判断 path 末段是否落在某个数组字段上（还需下标才能落到具体项） */
export function pathNeedsArrayIndex(
  path: string,
  fields: DataField[],
  repeatListName?: string | null,
): boolean {
  if (!path || path === 'index' || path === 'item' || path.startsWith('item.')) {
    // item.xxx 若本身是数组仍需要下标
    if (path.startsWith('item.') && !/\[\d+\]$/.test(path)) {
      const node = findTreeNodeByValue(
        buildConditionFieldTree(fields, repeatListName),
        path,
      )
      return node?.type === 'array'
    }
    return false
  }
  if (/\[\d+\]$/.test(path)) return false

  const node = findTreeNodeByValue(
    buildConditionFieldTree(fields, repeatListName),
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
