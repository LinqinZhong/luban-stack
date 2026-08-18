import type { DataFieldType, MapKeyType } from '../../types/page-data'

export type TypeSelectLeafType = DataFieldType | 'void' | 'generic'

export type TypeSelectPayload = {
  type: TypeSelectLeafType
  typeRef?: string
  itemType?: DataFieldType | 'generic'
  itemTypeRef?: string
  /** itemType === 'array' 时的嵌套元素类型 */
  itemItemType?: DataFieldType | 'generic'
  itemItemTypeRef?: string
  /** type === 'map' 时的键类型 */
  keyType?: MapKeyType
  /** clearable + emptyOnClear 时为 true */
  cleared?: boolean
  /** 选中顶部 NULL：字段值应为 null */
  isNull?: boolean
}
