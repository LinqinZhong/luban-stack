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
    keyType: expr.keyType ?? '',
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
  const aBound = Object.values(aa).some((v) => v.trim())
  const bBound = Object.values(bb).some((v) => v.trim())
  // 一侧未填泛型实参时，视为与同名类型兼容（QueryPageVo ≈ QueryPageVo<T>）
  if (!aBound || !bBound) return true
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

  // 枚举与 string / number 互通（状态码常见为数字枚举）
  if (tDef?.kind === 'enum' && !sRef) {
    if (source.type === 'string' || source.type === 'number') return true
  }
  if (sDef?.kind === 'enum' && !tRef) {
    if (target.type === 'string' || target.type === 'number') return true
  }

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
  if (atom.kind === 'map') {
    return {
      ...createEmptyProcessorTypeExpr('map'),
      keyType: atom.key === 'number' ? 'number' : 'string',
      itemType: atom.item?.kind === 'array' ? 'array' : (atom.item?.kind === 'named' ? 'json' : (atom.item?.kind === 'number' || atom.item?.kind === 'boolean' || atom.item?.kind === 'any' || atom.item?.kind === 'string' ? atom.item.kind : 'any')),
      itemTypeRef: atom.item?.kind === 'named' ? atom.item.ref || '' : '',
      itemItemType: atom.item?.kind === 'array' && atom.item.item ? (atom.item.item.kind === 'named' ? 'json' : atom.item.item.kind === 'number' || atom.item.item.kind === 'boolean' || atom.item.item.kind === 'any' || atom.item.item.kind === 'string' ? atom.item.item.kind : 'any') : '',
      itemItemTypeRef: atom.item?.kind === 'array' && atom.item.item?.kind === 'named' ? atom.item.item.ref || '' : '',
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
  mode: BindingCompatibilityMode = 'strict',
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
      if (!boundId) {
        // 未绑定泛型不可当作 any 匹配具体出参（含 T[] 的 records）
        continue
      }
      const bound = findDataTypeDef(library, boundId)
      if (bound?.kind === 'interface' && primaryAtom(field.type).kind !== 'array') {
        const boundExpr: ProcessorTypeExpr = {
          ...createEmptyProcessorTypeExpr('json'),
          typeRef: boundId,
        }
        const selectable = isBindingTypeCompatible(
          boundExpr,
          target,
          library,
          mode,
        )
        if (selectable) {
          children.push({
            value: name,
            label: name,
            selectable: true,
          })
          continue
        }
        const nested = expandObjectChildren(
          boundExpr,
          target,
          library,
          depth + 1,
          mode,
        )
        if (nested.length) {
          children.push({
            value: name,
            label: name,
            selectable: false,
            children: nested,
          })
        }
        continue
      }
    }

    const selectable = isBindingTypeCompatible(fieldExpr, target, library, mode)
    // 字段本身已匹配目标类型：只可选该字段，不再往下钻
    if (selectable) {
      children.push({
        value: name,
        label: name,
        selectable: true,
      })
      continue
    }

    let nested: TypedBindingCascaderOption[] = []

    if (fieldExpr.type === 'array') {
      const itemExpr: ProcessorTypeExpr = {
        ...createEmptyProcessorTypeExpr(
          fieldExpr.itemTypeRef ? 'json' : fieldExpr.itemType || 'any',
        ),
        typeRef: fieldExpr.itemTypeRef || '',
        genericArgs: { ...(fieldExpr.genericArgs ?? {}) },
      }
      // 未绑定泛型会落成 any，禁止据此生成可选的 [0]
      if (isAnyExpr(itemExpr) && !namedRefOf(itemExpr)) {
        continue
      }
      const itemSelectable = isBindingTypeCompatible(
        itemExpr,
        target,
        library,
        mode,
      )
      const itemNested = itemSelectable
        ? []
        : expandObjectChildren(
            itemExpr,
            target,
            library,
            depth + 1,
            mode,
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
      nested = expandObjectChildren(fieldExpr, target, library, depth + 1, mode)
    }

    if (nested.length) {
      children.push({
        value: name,
        label: name,
        selectable: false,
        children: nested,
      })
    }
  }

  return children
}

function buildVarOption(
  param: MethodParam,
  target: ProcessorTypeExpr,
  library: DataTypeLibrary | null | undefined,
  mode: BindingCompatibilityMode = 'strict',
): TypedBindingCascaderOption | null {
  const source = methodParamTypeExpr(param)
  const selectable = isBindingTypeCompatible(source, target, library, mode)
  // 变量本身已匹配目标类型：只可选该变量，禁止再钻到 goods / [0] 等
  if (selectable) {
    return {
      value: param.name,
      label: param.name,
      selectable: true,
    }
  }

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
    if (!(isAnyExpr(itemExpr) && !namedRefOf(itemExpr))) {
      const itemSelectable = isBindingTypeCompatible(
        itemExpr,
        target,
        library,
        mode,
      )
      const itemNested = itemSelectable
        ? []
        : expandObjectChildren(itemExpr, target, library, 1, mode)
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
    }
  } else {
    children = expandObjectChildren(source, target, library, 1, mode)
  }

  if (!children.length) return null
  return {
    value: param.name,
    label: param.name,
    selectable: false,
    children,
  }
}

/** 构建类型匹配的级联选项（变量 → 嵌套字段） */
export function buildTypedBindingCascaderOptions(
  ambientVars: MethodParam[],
  target: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
  extraRoots?: TypedBindingCascaderOption[],
  mode: BindingCompatibilityMode = 'strict',
): TypedBindingCascaderOption[] {
  const targetExpr = target ? cloneExpr(target) : createEmptyProcessorTypeExpr('any')
  const options: TypedBindingCascaderOption[] = []
  for (const v of ambientVars) {
    const name = v.name.trim()
    if (!name) continue
    const opt = buildVarOption(v, targetExpr, library, mode)
    if (opt) options.push(opt)
  }
  if (extraRoots?.length) {
    for (const root of extraRoots) {
      if (!root.value) continue
      options.push(root)
    }
  }
  return options
}

/** 页面 $query 入参级联根（字段为字符串/数字/布尔） */
export function buildQueryBindingRoot(
  defs: Array<{ name: string; type?: string; remark?: string }> | null | undefined,
  target: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): TypedBindingCascaderOption | null {
  if (!defs?.length) return null
  const targetExpr = target ? cloneExpr(target) : createEmptyProcessorTypeExpr('any')
  const children: TypedBindingCascaderOption[] = []
  for (const def of defs) {
    const name = def.name.trim()
    if (!name) continue
    const ty =
      def.type === 'number'
        ? 'number'
        : def.type === 'boolean'
          ? 'boolean'
          : 'string'
    if (!isQueryParamCompatibleWithTarget(ty, targetExpr, library)) continue
    children.push({
      value: name,
      label: def.remark?.trim() ? `${name} · ${def.remark.trim()}` : name,
      selectable: true,
    })
  }
  if (!children.length) return null
  return {
    value: '$query',
    label: '$query（页面 Query）',
    selectable: false,
    children,
  }
}

/**
 * Query 定义常为 string（URL 字面量），目标 API 却是 number/boolean。
 * 允许标量互通，运行时再按目标类型转换。
 */
function isQueryParamCompatibleWithTarget(
  sourceType: 'string' | 'number' | 'boolean',
  target: ProcessorTypeExpr,
  library?: DataTypeLibrary | null,
): boolean {
  const source = createEmptyProcessorTypeExpr(sourceType)
  if (isTypeExprCompatible(source, target, library)) return true
  if (sourceType === 'string') {
    if (
      isTypeExprCompatible(
        createEmptyProcessorTypeExpr('number'),
        target,
        library,
      )
    ) {
      return true
    }
    if (
      isTypeExprCompatible(
        createEmptyProcessorTypeExpr('boolean'),
        target,
        library,
      )
    ) {
      return true
    }
  }
  if (sourceType === 'number') {
    return isTypeExprCompatible(
      createEmptyProcessorTypeExpr('string'),
      target,
      library,
    )
  }
  if (sourceType === 'boolean') {
    return isTypeExprCompatible(
      createEmptyProcessorTypeExpr('string'),
      target,
      library,
    )
  }
  return false
}

export type BindingCompatibilityMode = 'strict' | 'scalar-loose'

/** 绑定兼容：strict 严格类型；scalar-loose 额外允许 string/number/boolean 互通 */
export function isBindingTypeCompatible(
  source: ProcessorTypeExpr,
  target: ProcessorTypeExpr,
  library?: DataTypeLibrary | null,
  mode: BindingCompatibilityMode = 'strict',
): boolean {
  if (isTypeExprCompatible(source, target, library)) return true
  if (mode !== 'scalar-loose') return false

  // 源为枚举：按 string/number 再试（与目标标量互通）
  const sRef = namedRefOf(source)
  const sDef = sRef ? findDataTypeDef(library, sRef) : null
  if (sDef?.kind === 'enum') {
    return (
      isQueryParamCompatibleWithTarget('string', target, library) ||
      isQueryParamCompatibleWithTarget('number', target, library)
    )
  }

  const s = (source.type || '').trim()
  if (sRef || s === 'array' || s === 'map' || s === 'json' || s === 'object') {
    return false
  }
  if (s !== 'string' && s !== 'number' && s !== 'boolean') return false
  return isQueryParamCompatibleWithTarget(s, target, library)
}

/** 表达式 → cascader 路径段 */
export function splitBindingPath(expr: string): string[] {
  const s = expr.trim()
  if (!s) return []
  const parts: string[] = []
  const re = /([A-Za-z_$][\w$]*)|(\[\d+\])/g
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
      // 类型不匹配的不可选（仍可展开子级去选匹配字段）
      ...(!o.selectable ? { disabled: true } : {}),
      ...(children ? { children } : {}),
    }
  })
}

function flattenSelectableOptions(
  nodes: TypedBindingCascaderOption[],
  prefix: string[] = [],
): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = []
  for (const node of nodes) {
    const path = [...prefix, node.value]
    if (node.selectable) {
      out.push({
        value: joinBindingPath(path),
        label: path.join('.').replace(/\.\[/g, '['),
      })
    }
    if (node.children?.length) {
      out.push(...flattenSelectableOptions(node.children, path))
    }
  }
  return out
}

/** 扁平可选绑定路径（弹窗内用 el-select，避免 cascader 点选问题） */
export function buildFlatSelectableBindingOptions(
  ambientVars: MethodParam[],
  targetType: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
  extraRoots?: TypedBindingCascaderOption[],
  mode: BindingCompatibilityMode = 'strict',
): Array<{ value: string; label: string }> {
  const tree = buildTypedBindingCascaderOptions(
    ambientVars,
    targetType,
    library,
    extraRoots,
    mode,
  )
  return flattenSelectableOptions(tree)
}

/** 组件 $props 入参级联根（排除 api 类型） */
export function buildPropsBindingRoot(
  defs:
    | Array<{
        name: string
        type?: string
        typeRef?: string
        remark?: string
        itemType?: string
        itemTypeRef?: string
        itemItemType?: string
        itemItemTypeRef?: string
        genericArgs?: Record<string, string>
      }>
    | null
    | undefined,
  target: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
  mode: BindingCompatibilityMode = 'scalar-loose',
): TypedBindingCascaderOption | null {
  if (!defs?.length) return null
  const targetExpr = target
    ? cloneExpr(target)
    : createEmptyProcessorTypeExpr('any')
  const ambient: MethodParam[] = []
  for (const def of defs) {
    const name = def.name.trim()
    if (!name || def.type === 'api' || def.type === 'ref') continue
    ambient.push({
      name,
      type:
        def.type === 'number'
          ? 'number'
          : def.type === 'boolean'
            ? 'boolean'
            : def.type === 'array'
              ? 'array'
              : def.type === 'json' || def.typeRef
                ? 'object'
                : def.type === 'map'
                  ? 'map'
                  : def.type === 'any'
                    ? 'any'
                    : 'string',
      typeExpr: {
        ...createEmptyProcessorTypeExpr(
          def.typeRef
            ? 'json'
            : def.type === 'array'
              ? 'array'
              : def.type === 'json'
                ? 'json'
                : def.type === 'map'
                  ? 'map'
                  : def.type === 'number' ||
                      def.type === 'boolean' ||
                      def.type === 'string' ||
                      def.type === 'any'
                    ? def.type
                    : 'string',
        ),
        typeRef: def.typeRef || '',
        itemType: def.itemType || '',
        itemTypeRef: def.itemTypeRef || '',
        itemItemType: def.itemItemType || '',
        itemItemTypeRef: def.itemItemTypeRef || '',
        genericArgs: { ...(def.genericArgs ?? {}) },
      },
    })
  }
  if (!ambient.length) return null
  const children = buildTypedBindingCascaderOptions(
    ambient,
    targetExpr,
    library,
    undefined,
    mode,
  )
  if (!children.length) return null
  return {
    value: '$props',
    label: '$props（组件入参）',
    selectable: false,
    children,
  }
}
