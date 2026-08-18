import { useMemo } from 'react'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import {
  isTypeExprCleared,
  type DataTypeLibrary,
  type TypeExpr,
} from '../../types/data-types'
import {
  selectPayloadToTypeExpr,
  TYPE_EXPR_EXCLUDE_TYPES,
  typeExprToSelectPayload,
} from '../../utils/type-expr-select'

export default function TypeExprEditor({
  value,
  onChange,
  library,
  genericNames,
  excludeNamedIds,
  allowNone = false,
  size = 'default',
  className,
}: {
  value: TypeExpr | null
  onChange?: (value: TypeExpr | null) => void
  library?: DataTypeLibrary | null
  genericNames?: string[]
  excludeNamedIds?: string[]
  allowNone?: boolean
  size?: 'large' | 'default' | 'small'
  className?: string
}) {
  const payload = useMemo(() => typeExprToSelectPayload(value), [value])

  const isEmpty = value == null || isTypeExprCleared(value)

  function handleChange(next: TypeSelectPayload) {
    if (next.cleared) {
      onChange?.(allowNone ? null : selectPayloadToTypeExpr(next))
      return
    }
    onChange?.(selectPayloadToTypeExpr(next))
  }

  return (
    <DataFieldTypeTreeSelect
      type={payload.cleared ? 'string' : payload.type}
      typeRef={payload.typeRef}
      itemType={payload.itemType}
      itemTypeRef={payload.itemTypeRef}
      itemItemType={payload.itemItemType}
      itemItemTypeRef={payload.itemItemTypeRef}
      empty={isEmpty}
      library={library}
      genericNames={genericNames}
      excludeNamedIds={excludeNamedIds}
      excludeTypes={TYPE_EXPR_EXCLUDE_TYPES}
      allowAny
      emptyOnClear
      clearable
      size={size}
      className={className}
      onChange={handleChange}
    />
  )
}
