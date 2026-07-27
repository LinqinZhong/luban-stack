import type { ComponentConfig } from '../../types/component.js'
import type { DataField } from '../../types/page-data.js'
import type { XmlNode } from '../export-vue3/xml-parser.js'

export type MpRefField = {
  name: string
  nodePath: string
  kind: 'component' | 'modal'
  componentId?: string
  exposedMethods: string[]
  modalName?: string
}

/** Walk XML tree by path like "0:LinearLayout/1:Component"（与编辑器一致） */
export function resolveNodeByPath(
  root: XmlNode | null,
  nodePath: string,
): XmlNode | null {
  if (!root || !nodePath.trim()) return null
  const segments = nodePath.split('/').filter(Boolean)
  let current: XmlNode = root

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const colon = segment.indexOf(':')
    const index = Number(colon === -1 ? segment : segment.slice(0, colon))
    const tag = colon === -1 ? '' : segment.slice(colon + 1)

    if (!Number.isInteger(index)) return null

    if (i === 0) {
      if (index !== 0 || (tag && current.tag !== tag)) return null
      continue
    }

    const next = current.children[index]
    if (!next || (tag && next.tag !== tag)) return null
    current = next
  }

  return current
}

export function collectMpRefFields(
  fields: DataField[] | undefined,
  root: XmlNode | null,
  componentConfigs: Map<string, ComponentConfig>,
): MpRefField[] {
  const refs: MpRefField[] = []
  for (const field of fields ?? []) {
    if (field.type !== 'ref' || typeof field.value !== 'string') continue
    const nodePath = field.value.trim()
    const name = field.name.trim()
    if (!nodePath || !name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue

    const node = resolveNodeByPath(root, nodePath)
    if (!node) continue

    if (node.tag === 'Modal') {
      const modalName = node.attrs.name?.trim() || `modal_${name}`
      refs.push({
        name,
        nodePath,
        kind: 'modal',
        exposedMethods: ['show', 'hide'],
        modalName,
      })
      continue
    }

    if (node.tag !== 'Component') continue
    const componentId = node.attrs.componentId?.trim()
    if (!componentId) continue
    const config = componentConfigs.get(componentId)
    refs.push({
      name,
      nodePath,
      kind: 'component',
      componentId,
      exposedMethods: (config?.exposedMethods ?? []).filter(Boolean),
    })
  }
  return refs
}

export function modalVisibleDataKey(modalName: string): string {
  const safe = modalName.replace(/[^a-zA-Z0-9_$]/g, '_')
  return `__modal_${safe}`
}

/** 生成方法/事件 prelude 里的 ref 局部变量 */
export function renderRefLocalVars(
  refFields: MpRefField[],
  indent = '    ',
): string[] {
  const lines: string[] = []
  for (const field of refFields) {
    if (field.kind === 'modal' && field.modalName) {
      const key = modalVisibleDataKey(field.modalName)
      lines.push(`${indent}var ${field.name} = {`)
      lines.push(
        `${indent}  show: function () { var p = {}; p[${JSON.stringify(key)}] = true; that.setData(p) },`,
      )
      lines.push(
        `${indent}  hide: function () { var p = {}; p[${JSON.stringify(key)}] = false; that.setData(p) },`,
      )
      lines.push(`${indent}}`)
      continue
    }
    if (field.kind === 'component') {
      // selectComponent 需组件未开 virtualHost，且 wxml 上有 id
      const methods = (field.exposedMethods ?? []).filter((m) =>
        /^[A-Za-z_$][\w$]*$/.test(m),
      )
      if (!methods.length) {
        lines.push(
          `${indent}var ${field.name} = that.selectComponent(${JSON.stringify('#' + field.name)})`,
        )
      } else {
        lines.push(
          `${indent}var ${field.name} = (function () {`,
        )
        lines.push(
          `${indent}  var __c = that.selectComponent(${JSON.stringify('#' + field.name)})`,
        )
        lines.push(`${indent}  return {`)
        for (const m of methods) {
          lines.push(
            `${indent}    ${m}: function () { if (__c && typeof __c.${m} === 'function') return __c.${m}.apply(__c, arguments) },`,
          )
        }
        lines.push(`${indent}  }`)
        lines.push(`${indent}})()`)
      }
    }
  }
  return lines
}
