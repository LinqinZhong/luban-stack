import type { ProcessorTypeExpr } from '../types/backend-services.js'
import type { DataTypeLibrary } from '../types/data-types.js'

export const QUERY_PAGE_VO_TYPE_ID = 'type_common_QueryPageVo'

function findTypeName(
  library: DataTypeLibrary | null | undefined,
  typeRef: string,
): string {
  if (!library || !typeRef) return ''
  for (const group of library.groups ?? []) {
    for (const t of group.types ?? []) {
      if (t.id === typeRef) return (t.name || '').trim()
    }
  }
  return ''
}

/** ????QueryPageVo??????*/
export function isQueryPageVoOutput(
  expr: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): boolean {
  if (!expr) return false
  const ref = (expr.typeRef || '').trim()
  if (!ref) return false
  if (ref === QUERY_PAGE_VO_TYPE_ID) return true
  return findTypeName(library, ref) === 'QueryPageVo'
}

/** ??????????????????????*/
export function defaultEmptyReturnValue(
  expr: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): unknown {
  if (!expr) return undefined
  const t = (expr.type || '').trim()
  if (!t || t === 'void') return undefined
  if (isQueryPageVoOutput(expr, library)) {
    return {
      current: 0,
      pageSize: 0,
      hasNext: false,
      total: 0,
      records: [],
    }
  }
  if (t === 'array') return []
  if (t === 'boolean') return false
  if (t === 'number') return 0
  if (t === 'string') return null
  if (t === 'map') return new Map()
  return null
}

/** ???????????? */
export function defaultEmptyReturnCode(
  expr: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): string {
  if (!expr) return 'undefined'
  const t = (expr.type || '').trim()
  if (!t || t === 'void') return 'undefined'
  if (isQueryPageVoOutput(expr, library)) {
    return '{ current: 0, pageSize: 0, hasNext: false, total: 0, records: [] }'
  }
  if (t === 'array') return '[]'
  if (t === 'boolean') return 'false'
  if (t === 'number') return '0'
  if (t === 'string') return 'null'
  if (t === 'map') return 'new Map()'
  return 'null'
}
