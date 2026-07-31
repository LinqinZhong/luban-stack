import type { DataTypeDef, DataTypeLibrary, TypeAtom, TypeExpr } from '../../../types/data-types.js'
import type { ProcessorTypeExpr } from '../../../types/backend-services.js'

export type IdToName = Map<string, string>

export function buildIdToName(library: DataTypeLibrary): IdToName {
  const map: IdToName = new Map()
  for (const group of library.groups ?? []) {
    for (const t of group.types ?? []) {
      if (t.id && t.name) map.set(t.id, t.name.trim())
    }
  }
  return map
}

function atomToTs(atom: TypeAtom, idToName: IdToName): string {
  if (atom.kind === 'array') {
    return `${atomToTs(atom.item ?? { kind: 'any' }, idToName)}[]`
  }
  if (atom.kind === 'map') {
    const key = atom.key === 'number' ? 'number' : 'string'
    return `Map<${key}, ${atomToTs(atom.item ?? { kind: 'any' }, idToName)}>`
  }
  if (atom.kind === 'named') return idToName.get(atom.ref || '') || 'any'
  if (atom.kind === 'generic') return atom.ref || 'T'
  if (
    atom.kind === 'time' ||
    atom.kind === 'date' ||
    atom.kind === 'datetime'
  ) {
    return 'string'
  }
  return atom.kind
}

export function typeExprToTs(expr: TypeExpr | null | undefined, idToName: IdToName): string {
  const atom = expr?.intersections?.[0]?.alternatives?.[0]
  if (!atom) return 'any'
  return atomToTs(atom, idToName)
}

export function processorTypeExprToTs(
  expr: ProcessorTypeExpr | null | undefined,
  idToName: IdToName,
): string {
  if (!expr) return 'any'
  if (expr.type === 'map') {
    const key = expr.keyType === 'number' ? 'number' : 'string'
    let value = 'any'
    if (expr.itemType === 'array') {
      const inner = expr.itemItemTypeRef
        ? idToName.get(expr.itemItemTypeRef) || 'any'
        : expr.itemItemType || 'any'
      value = `${inner}[]`
    } else {
      value = expr.itemTypeRef
        ? idToName.get(expr.itemTypeRef) || 'any'
        : expr.itemType || 'any'
    }
    return `Map<${key}, ${value}>`
  }
  if (expr.type === 'array') {
    if (expr.itemType === 'array') {
      const inner = expr.itemItemTypeRef
        ? idToName.get(expr.itemItemTypeRef) || 'any'
        : expr.itemItemType || 'any'
      return `${inner}[][]`
    }
    const item = expr.itemTypeRef
      ? idToName.get(expr.itemTypeRef) || 'any'
      : expr.itemType || 'any'
    return `${item}[]`
  }
  if (expr.type === 'json' || expr.type === 'object') {
    if (expr.typeRef) {
      const name = idToName.get(expr.typeRef) || 'any'
      const args = expr.genericArgs || {}
      const keys = Object.keys(args)
      if (keys.length) {
        const inner = keys
          .map((k) => {
            const ref = args[k]
            return ref ? idToName.get(ref) || 'any' : 'any'
          })
          .join(', ')
        return `${name}<${inner}>`
      }
      return name
    }
    return 'Record<string, unknown>'
  }
  if (expr.type === 'string' || expr.type === 'number' || expr.type === 'boolean') {
    return expr.type
  }
  if (expr.typeRef) return idToName.get(expr.typeRef) || 'any'
  return 'any'
}

function remarkComment(remark: string): string {
  const text = remark.trim()
  if (!text) return ''
  if (text.includes('\n')) {
    return `/**\n${text
      .split('\n')
      .map((l) => ` * ${l}`)
      .join('\n')}\n */\n`
  }
  return `/** ${text} */\n`
}

function fieldRemark(remark: string): string {
  const text = remark.trim()
  if (!text) return ''
  return `  /** ${text.replace(/\*\//g, '* /')} */\n`
}

export function dataTypeToTs(def: DataTypeDef, idToName: IdToName): string {
  const name = def.name.trim() || 'Unnamed'
  const head = remarkComment(def.remark)

  if (def.kind === 'string' && name === 'URI') {
    return `${head}export type URI = string\n`
  }
  if (def.kind === 'number' || def.kind === 'string' || def.kind === 'boolean') {
    return `${head}export type ${name} = ${def.kind}\n`
  }

  if (def.kind === 'enum') {
    const body = (def.enumMembers ?? [])
      .map((m) => {
        const n = m.name.trim() || '_'
        if (m.value.trim()) {
          const v = m.value.trim()
          const lit = /^-?\d+(\.\d+)?$/.test(v) ? v : JSON.stringify(v)
          return `  ${n} = ${lit},`
        }
        return `  ${n},`
      })
      .join('\n')
    return `${head}export enum ${name} {\n${body}\n}\n`
  }

  const gens = (def.generics ?? [])
    .map((g) => g.name || 'T')
    .join(', ')
  const gensSuffix = gens ? `<${gens}>` : ''
  const fields = (def.fields ?? [])
    .map((f) => {
      const fname = f.name.trim() || '_'
      const opt = f.optional ? '?' : ''
      const ty = typeExprToTs(f.type, idToName)
      return `${fieldRemark(f.remark)}  ${fname}${opt}: ${ty}`
    })
    .join('\n')
  return `${head}export interface ${name}${gensSuffix} {\n${fields}\n}\n`
}

export function emitTypeGroupFile(
  groupName: string,
  types: DataTypeDef[],
  idToName: IdToName,
): string {
  const parts = types.map((t) => dataTypeToTs(t, idToName))
  return `/** types/${groupName} */\n\n${parts.join('\n')}`
}

export function findTypeDef(
  library: DataTypeLibrary,
  id: string,
): DataTypeDef | null {
  if (!id) return null
  for (const group of library.groups ?? []) {
    const hit = group.types.find((t) => t.id === id)
    if (hit) return hit
  }
  return null
}
