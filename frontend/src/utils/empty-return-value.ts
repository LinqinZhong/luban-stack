import type { ProcessorTypeExpr } from '../types/backend-services'
import type { DataTypeLibrary } from '../types/data-types'
import { findDataTypeDef } from './named-type-fields'
import { QUERY_PAGE_VO_TYPE_ID } from './page-map-flow'

/** 是否为 QueryPageVo（含泛型） */
export function isQueryPageVoOutput(
  expr: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): boolean {
  if (!expr) return false
  const ref = (expr.typeRef || '').trim()
  if (!ref) return false
  if (ref === QUERY_PAGE_VO_TYPE_ID) return true
  return findDataTypeDef(library, ref)?.name?.trim() === 'QueryPageVo'
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
  // object / json / 其它具名对象
  return null
}

/** 空返回值的可读说明（对话框提示 / 节点摘要） */
export function defaultEmptyReturnHint(
  expr: ProcessorTypeExpr | null | undefined,
  library?: DataTypeLibrary | null,
): string {
  if (!expr) return ''
  const t = (expr.type || '').trim()
  if (!t || t === 'void') return ''
  if (isQueryPageVoOutput(expr, library)) {
    return '留空 → { total: 0, records: [] }'
  }
  if (t === 'array') return '留空 → []'
  if (t === 'boolean') return '留空 → false'
  if (t === 'number') return '留空 → 0'
  if (t === 'string') return '留空 → null'
  return '留空 → null'
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
