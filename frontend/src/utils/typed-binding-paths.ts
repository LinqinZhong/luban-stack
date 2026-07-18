import {
  createEmptyProcessorTypeExpr,
  type ProcessorTypeExpr,
} from '../types/backend-services'
import type { DataTypeLibrary, TypeAtom, TypeExpr } from '../types/data-types'
import type { MethodParam, MethodParamType } from '../types/page-method'
import { findDataTypeDef } from './named-type-fields'
import { unwrapArrayAtom } from '../types/data-types'

export type TypedBindingCascaderOption = {
  value: string
  label: string
  /** 类型匹配，可选中 */
  selectable: boolean
  children?: TypedBindingCascaderOption[]
}

const MAX_DEPTH = 6

function primaryAtom(expr: TypeExpr | undefined | null): TypeAtom {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' }
}

/** 粗粒度方法类型 → ProcessorTypeExpr */
export function coarseToProcessorTypeExpr(
  type: MethodParamType | 'void' | string,
  typeRef = '',
): ProcessorTypeExpr {
  const ref = typeRef.trim()
  if (type === 'void') return createEmptyProcessorTypeExpr('any')
  if (type === 'array') {
    return {
      ...createEmptyProcessorTypeExpr('array'),
      itemType: 'any',
    }
  }
  if (type === 'object' || ref) {
    return {
      ...createEmptyProcessorTypeExpr(ref ? 'json' : 'json'),
      typeRef: ref,
    }
  }
  if (type === 'any') return createEmptyProcessorTypeExpr('any')
  if (type === 'number' || type === 'boolean' || type === 'string') {
    return createEmptyProcessorTypeExpr(type)
  }
  return createEmptyProcessorTypeExpr('any')
}

export function methodParamTypeExpr(
  param: MethodParam,
): ProcessorTypeExpr {
  if (param.typeExpr) return param.typeExpr
  return coarseToProcessorTypeExpr(param.type, '')
}

function cloneExpr(expr: ProcessorTypeExpr): ProcessorTypeExpr {
  return {
    type: expr.type,
    typeRef: expr.typeRef,
    itemType: expr.itemType,
    itemTypeRef: expr.itemTypeRef,
    itemItemType: expr.itemItemType,
    itemItemTypeRef: expr.itemItemTypeRef,
    genericArgs: { ...(expr.genericArgs ?? {}) },
  }
}

function isAnyExpr(expr: ProcessorTypeExpr): boolean {
  const t = (expr.type || '').trim()
  return !t || t === 'any'
}

function namedRefOf(expr: ProcessorTypeExpr): string {
  if (expr.type === 'array') {
    if (expr.itemType === 'array') return (expr.itemItemTypeRef || '').trim()
    return (expr.itemTypeRef || '').trim()
  }
  return (expr.typeRef || '').trim()
}

function genericsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const aa = a ?? {}
  const bb = b ?? {}
  const keys = new Set([...Object.keys(aa), ...Object.keys(bb)])
  for (const k of keys) {
    if ((aa[k] ?? '').trim() !== (bb[k] ?? '').trim()) return false
  }
  return true
}

/** 源类型是否可赋值给目标类型 */
export function isTypeExprCompatible(
  source: ProcessorTypeExpr,
  target: ProcessorTypeExpr,
  library?: DataTypeLibrary | null,
): boolean {
  if (isAnyExpr(target) || isAnyExpr(source)) return true

  if (target.type === 'array') {
    if (source.type !== 'array') return false
    const tItem: ProcessorTypeExpr = {
      ...createEmptyProcessorTypeExpr(
        target.itemType === 'array'
          ? 'array'
          : target.itemTypeRef
            ? 'json'
            : target.itemType || 'any',
      ),
      typeRef:
        target.itemType === 'array' ? '' : target.itemTypeRef || '',
      itemType: target.itemType === 'array' ? target.itemItemType || 'any' : '',
      itemTypeRef:
        target.itemType === 'array' ? target.itemItemTypeRef || '' : '',
      genericArgs: { ...(target.genericArgs ?? {}) },
    }
    const sItem: ProcessorTypeExpr = {
      ...createEmptyProcessorTypeExpr(
        source.itemType === 'array'
          ? 'array'
          : source.itemTypeRef
            ? 'json'
            : source.itemType || 'any',
      ),
      typeRef:
        source.itemType === 'array' ? '' : source.itemTypeRef || '',
      itemType: source.itemType === 'array' ? source.itemItemType || 'any' : '',
      itemTypeRef:
        source.itemType === 'array' ? source.itemItemTypeRef || '' : '',
      genericArgs: { ...(source.genericArgs ?? {}) },
    }
    return isTypeExprCompatible(sItem, tItem, library)
  }

  const tRef = namedRefOf(target)
  const sRef = namedRefOf(source)
  const tDef = tRef ? findDataTypeDef(library, tRef) : null
  const sDef = sRef ? findDataTypeDef(library, sRef) : null

  // 枚举与 string 互通
  if (tDef?.kind === 'enum' && !sRef && source.type === 'string') return true
  if (sDef?.kind === 'enum' && !tRef && target.type === 'string') return true

  if (tRef || sRef) {
    if (tRef && sRef) {
      if (tRef !== sRef) return false
      return genericsEqual(source.genericArgs, target.genericArgs)
    }
    // 目标为具名对象、源为无 typeRef 的 json：不匹配（避免误绑）
    // 目标无 typeRef 的 json/object，源为具名对象：允许
    if (!tRef && sRef) {
      return target.type === 'json' || target.type === 'object'
    }
    return false
  }

  const t = (target.type || 'string').trim()
  const s = (source.type || 'string').trim()
  if (t === 'json' || t === 'object') {
    return s === 'json' || s === 'object'
  }
  return t === s
}

function atomToProcessorTypeExpr(
  atom: TypeAtom,
  genericArgs: Record<string, string>,
): ProcessorTypeExpr {
  if (atom.kind === 'generic') {
    const bound = (genericArgs[atom.ref ?? ''] ?? '').trim()
    if (!bound) return createEmptyProcessorTypeExpr('any')
    return {
      ...createEmptyProcessorTypeExpr('json'),
      typeRef: bound,
    }
  }
  if (atom.kind === 'named') {
    return {
      ...createEmptyProcessorTypeExpr('json'),
      typeRef: (atom.ref ?? '').trim(),
    }
  }
  if (atom.kind === 'array') {
    const item = atom.item ?? { kind: 'any' as const }
    if (item.kind === 'array') {
      const leaf = item.item ?? { kind: 'any' as const }
      if (leaf.kind === 'named') {
        return {
          ...createEmptyProcessorTypeExpr('array'),
          itemType: 'array',
          itemItemType: 'json',
          itemItemTypeRef: leaf.ref ?? '',
        }
      }
      if (leaf.kind === 'generic') {
        const bound = (genericArgs[leaf.ref ?? ''] ?? '').trim()
        return {
          ...createEmptyProcessorTypeExpr('array'),
          itemType: 'array',
          itemItemType: bound ? 'json' : 'any',
          itemItemTypeRef: bound,
        }
      }
      return {
        ...createEmptyProcessorTypeExpr('array'),
        itemType: 'array',
        itemItemType: leaf.kind === 'any' ? 'any' : leaf.kind,
      }
    }
    if (item.kind === 'named') {
      return {
        ...createEmptyProcessorTypeExpr('array'),
        itemType: 'json',
        itemTypeRef: item.ref ?? '',
      }
    }
    if (item.kind === 'generic') {
      const bound = (genericArgs[item.ref ?? ''] ?? '').trim()
      return {
        ...createEmptyProcessorTypeExpr('array'),
        itemType: bound ? 'json' : 'any',
        itemTypeRef: bound,
      }
    }
    return {
      ...createEmptyProcessorTypeExpr('array'),
      itemType: item.kind === 'any' ? 'any' : item.kind,
    }
  }
  if (atom.kind === 'any') return createEmptyProcessorTypeExpr('any')
  if (
    atom.kind === 'number' ||
    atom.kind === 'boolean' ||
    atom.kind === 'string'
  ) {
    return createEmptyProcessorTypeExpr(atom.kind)
  }
  return createEmptyProcessorTypeExpr('any')
}

function typeExprToProcessorTypeExpr(
  expr: TypeExpr,
  genericArgs: Record<string, string>,
): ProcessorTypeExpr {
  return atomToProcessorTypeExpr(primaryAtom(expr), genericArgs)
}

function expandObjectChildren(
  typeExpr: ProcessorTypeExpr,
  target: ProcessorTypeExpr,
  library: DataTypeLibrary | null | undefined,
  depth: number,
): TypedBindingCascaderOption[] {
  if (depth >= MAX_DEPTH) return []
  const ref = namedRefOf(typeExpr)
  if (!ref || typeExpr.type === 'array') return []

  const def = findDataTypeDef(library, ref)
  if (!def || def.kind !== 'interface') return []

  const genericArgs = typeExpr.genericArgs ?? {}
  const children: TypedBindingCascaderOption[] = []

  for (const field of def.fields) {
    const name = field.name.trim()
    if (!name) continue

    const atom = unwrapArrayAtom(primaryAtom(field.type))
    // 字段本身可能是 T[]：用完整 atom，不要 unwrap 后再转
    const fieldExpr = typeExprToProcessorTypeExpr(field.type, genericArgs)

    // 泛型字段：若绑定到具体 interface，展开其字段
    if (atom.kind === 'generic') {
      const boundId = (genericArgs[atom.ref ?? ''] ?? '').trim()
      const bound = findDataTypeDef(library, boundId)
      if (bound?.kind === 'interface' && primaryAtom(field.type).kind !== 'array') {
        const boundExpr: ProcessorTypeExpr = {
          ...createEmptyProcessorTypeExpr('json'),
          typeRef: boundId,
        }
        const selectable = isTypeExprCompatible(boundExpr, target, library)
        const nested = expandObjectChildren(
          boundExpr,
          target,
          library,
          depth + 1,
        )
        if (selectable || nested.length) {
          children.push({
            value: name,
            label: name,
            selectable,
            ...(nested.length ? { children: nested } : {}),
          })
        }
        continue
      }
    }

    const selectable = isTypeExprCompatible(fieldExpr, target, library)
    let nested: TypedBindingCascaderOption[] = []

    if (fieldExpr.type === 'array') {
      const itemExpr: ProcessorTypeExpr = {
        ...createEmptyProcessorTypeExpr(
          fieldExpr.itemTypeRef ? 'json' : fieldExpr.itemType || 'any',
        ),
        typeRef: fieldExpr.itemTypeRef || '',
        genericArgs: { ...(fieldExpr.genericArgs ?? {}) },
      }
      const itemSelectable = isTypeExprCompatible(itemExpr, target, library)
      const itemNested = expandObjectChildren(
        itemExpr,
        target,
        library,
        depth + 1,
      )
      if (itemSelectable || itemNested.length) {
        nested = [
          {
            value: '[0]',
            label: '[0]',
            selectable: itemSelectable,
            ...(itemNested.length ? { children: itemNested } : {}),
          },
        ]
      }
    } else {
      nested = expandObjectChildren(fieldExpr, target, library, depth + 1)
    }

    if (selectable || nested.length) {
      children.push({
        value: name,
        label: name,
        selectable,
        ...(nested.length ? { children: nested } : {}),
      })
    }
  }

  return children
}

function buildVarOption(
  param: MethodParam,
  target: ProcessorTypeExpr,
  library: DataTypeLibrary | null | undefined,
): TypedBindingCascaderOption | null {
  const source = methodParamTypeExpr(param)
  const selectable = isTypeExprCompatible(source, target, library)
  let children: TypedBindingCascaderOption[] = []

  if (source.type === 'array') {
    const itemExpr: ProcessorTypeExpr = {
      ...createEmptyProcessorTypeExpr(
        source.itemTypeRef
          ? 'json'
          : source.itemType === 'array'
            ? 'array'
            : source.itemType || 'any',
      ),
      typeRef: source.itemType === 'array' ? '' : source.itemTypeRef || '',
      itemType: source.itemType === 'array' ? source.itemItemType || 'any' : '',
      itemTypeRef:
        source.itemType === 'array' ? source.itemItemTypeRef || '' : '',
      genericArgs: { ...(source.genericArgs ?? {}) },
    }
    const itemSelectable = isTypeExprCompatible(itemExpr, target, library)
    const itemNested = expandObjectChildren(itemExpr, target, library, 1)
    if (itemSelectable || itemNested.length) {
      children = [
        {
          value: '[0]',
          label: '[0]',
          selectable: itemSelectable,
          ...(itemNested.length ? { children: itemNested } : {}),
        },
      ]
    }
  } else {
    children = expandObjectChildren(source, target, library, 1)
  }

  if (!selectable && !children.length) return null
  return {
    value: param.name,
    label: param.name,
    selectable,
    ...(children.length ? { children } : {}),
  }
}

/** 构建类型匹配的级联选项（变量 → 嵌套字段） */
export function buildTypedBindingCascaderOptions(
  ambientVars: MethodParam[],
  target: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): TypedBindingCascaderOption[] {
  const targetExpr = target ? cloneExpr(target) : createEmptyProcessorTypeExpr('any')
  const options: TypedBindingCascaderOption[] = []
  for (const v of ambientVars) {
    const name = v.name.trim()
    if (!name) continue
    const opt = buildVarOption(v, targetExpr, library)
    if (opt) options.push(opt)
  }
  return options
}

/** 表达式 → cascader 路径段 */
export function splitBindingPath(expr: string): string[] {
  const s = expr.trim()
  if (!s) return []
  const parts: string[] = []
  const re = /([A-Za-z_][\w]*)|(\[\d+\])/g
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(s))) {
    if (m.index > last) {
      // 含非法片段，整段当作单值
      return [s]
    }
    parts.push(m[0])
    last = m.index + m[0].length
    if (s[last] === '.') last += 1
  }
  if (last < s.length) return [s]
  return parts
}

/** cascader 路径段 → 表达式 */
export function joinBindingPath(segments: string[]): string {
  if (!segments.length) return ''
  let out = segments[0] ?? ''
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i] ?? ''
    if (seg.startsWith('[')) out += seg
    else out += `.${seg}`
  }
  return out
}

function findOption(
  options: TypedBindingCascaderOption[],
  segments: string[],
): TypedBindingCascaderOption | null {
  let list = options
  let node: TypedBindingCascaderOption | null = null
  for (const seg of segments) {
    node = list.find((o) => o.value === seg) ?? null
    if (!node) return null
    list = node.children ?? []
  }
  return node
}

export function isSelectableBindingPath(
  options: TypedBindingCascaderOption[],
  segments: string[],
): boolean {
  return Boolean(findOption(options, segments)?.selectable)
}

/** 将内部选项转为 el-cascader options */
export function toElCascaderOptions(
  options: TypedBindingCascaderOption[],
): Array<{
  value: string
  label: string
  disabled?: boolean
  children?: ReturnType<typeof toElCascaderOptions>
}> {
  return options.map((o) => {
    const children = o.children?.length
      ? toElCascaderOptions(o.children)
      : undefined
    return {
      value: o.value,
      label: o.label,
      // 中间节点保持可展开；仅无子级且不匹配时禁用（一般已被剪枝）
      ...(!o.selectable && !children ? { disabled: true } : {}),
      ...(children ? { children } : {}),
    }
  })
}
