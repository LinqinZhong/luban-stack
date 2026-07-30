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

/** 是否为 QueryPageVo（含泛型） */
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

/** 终止节点未选返回数据时，按方法出参构造空值 */
export function defaultEmptyReturnValue(
  expr: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): unknown {
  if (!expr) return undefined
  const t = (expr.type || '').trim()
  if (!t || t === 'void') return undefined
  if (isQueryPageVoOutput(expr, library)) {
    return { total: 0, records: [] }
  }
  if (t === 'array') return []
  if (t === 'boolean') return false
  if (t === 'number') return 0
  if (t === 'string') return null
  return null
}

/** 导出代码中的空返回表达式 */
export function defaultEmptyReturnCode(
  expr: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): string {
  if (!expr) return 'undefined'
  const t = (expr.type || '').trim()
  if (!t || t === 'void') return 'undefined'
  if (isQueryPageVoOutput(expr, library)) {
    return '{ total: 0, records: [] }'
  }
  if (t === 'array') return '[]'
  if (t === 'boolean') return 'false'
  if (t === 'number') return '0'
  if (t === 'string') return 'null'
  return 'null'
}
