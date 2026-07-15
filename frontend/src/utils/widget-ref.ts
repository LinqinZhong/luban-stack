import type { ComponentRenderMap } from '../types/component-render'
import type { DataField } from '../types/page-data'
import type { PageMethod } from '../types/page-method'
import { parsePageXml, type XmlNode } from './xml'
import { findNodeFromXml } from './xml-node'

export interface ModalStackLike {
  open: (name: string) => void
  close: (name?: string) => void
}

/** 组件方法表：componentId → 方法列表 */
export type ComponentMethodsMap = Record<string, PageMethod[]>

export interface RefResolveContext {
  xml?: string
  modalStack?: ModalStackLike
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  /** 执行组件暴露方法（在组件自己的数据池作用域内） */
  runComponentMethod?: (
    componentId: string,
    methodName: string,
    args: unknown[],
  ) => void
}

function walkNodes(
  node: XmlNode,
  path: string,
  visit: (node: XmlNode, path: string) => void,
) {
  visit(node, path)
  node.children.forEach((child, index) => {
    walkNodes(child, `${path}/${index}:${child.tag}`, visit)
  })
}

/** 解析引用字段指向的节点（path 或 Modal name） */
export function resolveRefTargetNode(
  xml: string | undefined,
  refValue: string,
): { node: XmlNode; path: string } | null {
  const id = refValue.trim()
  if (!id || !xml?.trim()) return null

  try {
    const byPath = findNodeFromXml(xml, id)
    if (byPath) return { node: byPath, path: id }

    const root = parsePageXml(xml)
    const rootPath = `0:${root.tag}`
    let found: { node: XmlNode; path: string } | null = null
    walkNodes(root, rootPath, (node, path) => {
      if (found) return
      const name = node.attrs.name?.trim() || ''
      if (name === id || path === id) found = { node, path }
    })
    return found
  } catch {
    return null
  }
}

/** Modal 在堆栈中的 key：优先 attrs.name，否则节点 path */
export function resolveModalStackKey(
  xml: string | undefined,
  refValue: string,
): string | null {
  const id = refValue.trim()
  if (!id) return null
  const target = resolveRefTargetNode(xml, id)
  if (target?.node.tag === 'Modal') {
    return target.node.attrs.name?.trim() || target.path
  }
  if (/(?:^|\/)\d+:Modal$/.test(id)) return id
  return null
}

function mapMethodParamTs(type: string): string {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'Record<string, unknown>'
    case 'array':
      return 'unknown[]'
    case 'void':
      return 'void'
    default:
      return 'any'
  }
}

function buildMethodSignature(method: PageMethod | undefined, name: string): string {
  if (!method) return `${name}(...args: any[]): void`
  const params = (method.params ?? [])
    .filter((item) => item.name.trim() && !item.name.trim().startsWith('...'))
    .map((item) => `${item.name.trim()}: ${mapMethodParamTs(item.type)}`)
    .join(', ')
  const ret =
    method.returnType && method.returnType !== 'void'
      ? mapMethodParamTs(method.returnType)
      : 'void'
  return `${name}(${params}): ${ret}`
}

/**
 * 引用字段 Monaco ambient：
 * - Modal → show / hide
 * - Component → 组件配置的「暴露方法」
 */
export function buildRefAmbientDeclarations(
  fields: DataField[] | undefined,
  xml?: string,
  componentMap?: ComponentRenderMap,
  componentMethodsMap?: ComponentMethodsMap,
): string {
  const lines: string[] = []
  const seen = new Set<string>()
  let anyRef = false

  for (const field of fields ?? []) {
    if (field.type !== 'ref') continue
    const name = field.name.trim()
    if (!name || seen.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name)) continue
    seen.add(name)
    anyRef = true

    const refValue = String(field.value ?? '').trim()
    const target = resolveRefTargetNode(xml, refValue)
    const tag = target?.node.tag

    if (tag === 'Modal') {
      lines.push(
        `/** Modal 引用 */`,
        `declare const ${name}: { show(): void; hide(): void };`,
      )
      continue
    }

    if (tag === 'Component') {
      const componentId = target!.node.attrs.componentId?.trim() || ''
      const info = componentId ? componentMap?.[componentId] : undefined
      const exposed = (info?.config.exposedMethods ?? []).filter((m) =>
        /^[A-Za-z_$][\w$]*$/.test(m.trim()),
      )
      const methods = componentId ? componentMethodsMap?.[componentId] ?? [] : []
      const methodMap = new Map(methods.map((m) => [m.name, m]))

      if (!exposed.length) {
        lines.push(
          `/** 组件引用 · ${info?.config.name || componentId || '未配置'}（未暴露方法） */`,
          `declare const ${name}: Record<string, never>;`,
        )
        continue
      }

      const members = exposed.map((raw) => {
        const methodName = raw.trim()
        return `  ${buildMethodSignature(methodMap.get(methodName), methodName)};`
      })
      lines.push(
        `/** 组件引用 · ${info?.config.name || componentId} */`,
        `declare const ${name}: {`,
        ...members,
        `};`,
      )
      continue
    }

    lines.push(
      `/** 控件引用 */`,
      `declare const ${name}: Record<string, never>;`,
    )
  }

  if (!anyRef) return ''
  return `${lines.join('\n')}\n`
}

function createModalRefHandle(modalKey: string, stack: ModalStackLike) {
  return {
    show: () => stack.open(modalKey),
    hide: () => stack.close(modalKey),
  }
}

function createComponentRefHandle(
  componentId: string,
  exposed: string[],
  run?: RefResolveContext['runComponentMethod'],
): Record<string, (...args: unknown[]) => unknown> {
  const handle: Record<string, (...args: unknown[]) => unknown> = {}
  for (const raw of exposed) {
    const methodName = raw.trim()
    if (!methodName || !/^[A-Za-z_$][\w$]*$/.test(methodName)) continue
    handle[methodName] = (...args: unknown[]) => {
      run?.(componentId, methodName, args)
    }
  }
  return handle
}

/** 数据池引用字段 → 运行时句柄 */
export function resolveRefFieldValue(
  field: DataField,
  ctx: RefResolveContext,
): unknown {
  const nodeId = String(field.value ?? '').trim()
  if (field.type !== 'ref') return field.value

  const target = resolveRefTargetNode(ctx.xml, nodeId)
  if (!target) return {}

  if (target.node.tag === 'Modal') {
    const modalKey = target.node.attrs.name?.trim() || target.path
    if (modalKey && ctx.modalStack) {
      return createModalRefHandle(modalKey, ctx.modalStack)
    }
    return { show: () => undefined, hide: () => undefined }
  }

  if (target.node.tag === 'Component') {
    const componentId = target.node.attrs.componentId?.trim() || ''
    if (!componentId) return {}
    const exposed =
      ctx.componentMap?.[componentId]?.config.exposedMethods ?? []
    return createComponentRefHandle(
      componentId,
      exposed,
      ctx.runComponentMethod,
    )
  }

  return {}
}
