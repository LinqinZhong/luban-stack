import type {
  ServiceApiParam,
  ServiceApiParamLocation,
} from '../types/backend-services'
import type { DataTypeLibrary } from '../types/data-types'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from './named-type-fields'

/** 具名 interface 且含字段 */
export function isObjectApiTypeRef(
  typeRef: string,
  library: DataTypeLibrary | null | undefined,
): boolean {
  if (!typeRef) return false
  const def = findDataTypeDef(library, typeRef)
  return Boolean(
    def &&
      def.kind === 'interface' &&
      def.fields.some((f) => f.name.trim()),
  )
}

/** 接口执行时：非 body 对象入参平铺后的 HTTP 字段 */
export type FlatHttpApiField = {
  /** HTTP 传参名（字段名） */
  httpName: string
  location: Exclude<ServiceApiParamLocation, 'body'>
  type: string
  typeRef: string
  required: boolean
  remark: string
  /** 配置里的对象变量名，组装后写入该变量 */
  ownerVarName: string
  /** 相对对象的字段路径 */
  fieldPath: string[]
}

type LeafField = {
  httpName: string
  type: string
  typeRef: string
  required: boolean
  remark: string
  fieldPath: string[]
}

function collectObjectLeaves(
  typeRef: string,
  library: DataTypeLibrary | null | undefined,
  path: string[],
  required: boolean,
): LeafField[] {
  const def = findDataTypeDef(library, typeRef)
  if (!def || def.kind !== 'interface') return []
  const out: LeafField[] = []
  for (const f of def.fields) {
    const name = f.name.trim()
    if (!name) continue
    const mapped = typeExprToDataFieldType(f.type, library)
    const nextPath = [...path, name]
    const fieldRequired = required && !f.optional
    if (mapped.typeRef && isObjectApiTypeRef(mapped.typeRef, library)) {
      out.push(
        ...collectObjectLeaves(
          mapped.typeRef,
          library,
          nextPath,
          fieldRequired,
        ),
      )
      continue
    }
    out.push({
      httpName: name,
      type: mapped.typeRef ? 'json' : mapped.type || 'string',
      typeRef: mapped.typeRef || '',
      required: fieldRequired,
      remark: f.remark || '',
      fieldPath: nextPath,
    })
  }
  return out
}

/**
 * 接口执行用：把非 body 的对象入参展开为平铺 HTTP 字段；
 * body / 标量保持由调用方按整参处理。
 * 设计配置结构不变，仅运行时组装传参时使用。
 */
export function listFlattenedHttpFields(
  inputs: ServiceApiParam[],
  library: DataTypeLibrary | null | undefined,
): FlatHttpApiField[] {
  const out: FlatHttpApiField[] = []
  for (const p of inputs) {
    if (p.location === 'body') continue
    const varName = p.varName.trim()
    if (!varName) continue
    if (p.typeRef && isObjectApiTypeRef(p.typeRef, library)) {
      for (const leaf of collectObjectLeaves(
        p.typeRef,
        library,
        [],
        p.required,
      )) {
        out.push({
          ...leaf,
          location: p.location,
          ownerVarName: varName,
        })
      }
      continue
    }
    out.push({
      httpName: varName,
      location: p.location,
      type: p.typeRef ? 'json' : p.type || 'string',
      typeRef: p.typeRef || '',
      required: p.required,
      remark: p.remark,
      ownerVarName: varName,
      fieldPath: [],
    })
  }
  return out
}

function setPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
) {
  if (!path.length) return
  let cur: Record<string, unknown> = target
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    const next = cur[key]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[key] = {}
    }
    cur = cur[key] as Record<string, unknown>
  }
  cur[path[path.length - 1]!] = value
}

/**
 * 从平铺 HTTP 值组装回流程入参对象（非 body 对象入参）。
 * flatValues key 为 httpName；同名字段后写覆盖。
 */
export function assembleApiInputsFromFlat(
  inputs: ServiceApiParam[],
  flatValues: Record<string, unknown>,
  library: DataTypeLibrary | null | undefined,
): Record<string, unknown> {
  const scope: Record<string, unknown> = {}
  for (const p of inputs) {
    const varName = p.varName.trim()
    if (!varName) continue
    if (p.location === 'body') {
      if (Object.prototype.hasOwnProperty.call(flatValues, varName)) {
        scope[varName] = flatValues[varName]
      }
      continue
    }
    if (p.typeRef && isObjectApiTypeRef(p.typeRef, library)) {
      const obj: Record<string, unknown> = {}
      for (const leaf of collectObjectLeaves(
        p.typeRef,
        library,
        [],
        p.required,
      )) {
        if (Object.prototype.hasOwnProperty.call(flatValues, leaf.httpName)) {
          setPath(obj, leaf.fieldPath, flatValues[leaf.httpName])
        }
      }
      scope[varName] = obj
      continue
    }
    if (Object.prototype.hasOwnProperty.call(flatValues, varName)) {
      scope[varName] = flatValues[varName]
    }
  }
  return scope
}
