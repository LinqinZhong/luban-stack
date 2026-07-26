/** Component 实例上的虚拟插槽节点：`hostId/#slot:name` */

export const SLOT_OUTLET_MARKER = '/#slot:'

export function isSlotOutletNodeId(id: string): boolean {
  return Boolean(id && id.includes(SLOT_OUTLET_MARKER))
}

export function makeSlotOutletNodeId(hostId: string, slotName: string): string {
  const name = slotName.trim() || 'default'
  return `${hostId}/#slot:${name}`
}

export function parseSlotOutletNodeId(
  id: string,
): { hostId: string; slotName: string } | null {
  if (!id) return null
  const idx = id.lastIndexOf(SLOT_OUTLET_MARKER)
  if (idx === -1) return null
  const hostId = id.slice(0, idx)
  const slotName = id.slice(idx + SLOT_OUTLET_MARKER.length).trim() || 'default'
  if (!hostId) return null
  return { hostId, slotName }
}

/** 从组件 XML 收集 Slot 名称（去重，保序） */
export function collectSlotNamesFromXml(xml: string): string[] {
  if (!xml?.trim()) return []
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'application/xml')
    if (doc.querySelector('parsererror')) return []
    const names: string[] = []
    const seen = new Set<string>()
    for (const el of Array.from(doc.getElementsByTagName('Slot'))) {
      const name = el.getAttribute('name')?.trim() || 'default'
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
    return names
  } catch {
    return []
  }
}
