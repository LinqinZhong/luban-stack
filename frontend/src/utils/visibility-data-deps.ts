import {
  DYNAMIC_STYLES_ATTR,
  V_IF_ATTR,
  V_SHOW_ATTR,
  parseDynamicStyles,
  parseVisibilityConditions,
  type StyleCondition,
  type StyleScenario,
} from '../types/dynamic-styles'
import type { PageData } from '../types/page-data'
import { parsePageXml, type XmlNode } from './xml'

function rootDataFieldName(field: string): string | null {
  const raw = field.trim()
  if (!raw) return null
  if (
    raw === 'item' ||
    raw === 'index' ||
    raw.startsWith('item.') ||
    raw.startsWith('$') ||
    raw.startsWith('props.') ||
    raw.startsWith('route.') ||
    raw.startsWith('query.')
  ) {
    return null
  }
  const root = raw.split(/[.\[\]]/).filter(Boolean)[0]
  return root || null
}

function collectFromScenarios(scenarios: StyleScenario[], out: Set<string>) {
  for (const scene of scenarios) {
    for (const cond of scene.conditions ?? []) {
      const name = rootDataFieldName((cond as StyleCondition).field ?? '')
      if (name) out.add(name)
    }
  }
}

function walkNode(node: XmlNode, out: Set<string>) {
  collectFromScenarios(
    parseVisibilityConditions(node.attrs[V_IF_ATTR]).scenarios,
    out,
  )
  collectFromScenarios(
    parseVisibilityConditions(node.attrs[V_SHOW_ATTR]).scenarios,
    out,
  )
  for (const state of parseDynamicStyles(node.attrs[DYNAMIC_STYLES_ATTR]).states) {
    collectFromScenarios(state.scenarios ?? [], out)
  }
  for (const child of node.children) walkNode(child, out)
}

/**
 * 组件 XML 里 vIf / vShow / dynamicStyles 引用到的数据池根字段名。
 * 用于预览时在这些字段 setData 后刷新实例数据池快照（避免与计算依赖无关时漏更新）。
 */
export function collectXmlVisibilityDataFieldNames(xml: string): string[] {
  const text = xml.trim()
  if (!text) return []
  try {
    const root = parsePageXml(text)
    const out = new Set<string>()
    walkNode(root, out)
    return [...out]
  } catch {
    return []
  }
}

/** 供 Vue 缓存：可见性相关普通字段值变化时字符串才变 */
export function buildVisibilityDataDepsKey(
  data: PageData | undefined | null,
  fieldNames: string[],
): string {
  if (!data || !fieldNames.length) return ''
  const fields = data.fields ?? []
  const byName = new Map(
    fields.map((item) => [item.name.trim(), item.value] as const),
  )
  const slice = [...new Set(fieldNames)]
    .filter(Boolean)
    .sort()
    .map((name) => [name, byName.get(name)])
  try {
    return JSON.stringify(slice)
  } catch {
    return String(Date.now())
  }
}
