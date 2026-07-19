/** 输入节点数据来源 */
export type InputDataSource =
  | 'current_business'
  | 'other_business'
  | 'current_data'
  | 'other_data'
  | 'request_header'

export const INPUT_HEADER_CUSTOM = '__custom__'

export const INPUT_HEADER_PRESET_FIELDS = [
  'user-id',
  'user-agent',
  'ip',
  'referer',
] as const

export const INPUT_HEADER_FIELD_OPTIONS = [
  { value: 'user-id', label: 'user-id' },
  { value: 'user-agent', label: 'user-agent' },
  { value: 'ip', label: 'ip' },
  { value: 'referer', label: 'referer' },
  { value: INPUT_HEADER_CUSTOM, label: '自定义' },
] as const

export type InputNodeForm = {
  dataSource: InputDataSource
  dataProcessorId: string
  dataMethodId: string
  /** 请求头字段名，如 user-id / user-agent；自定义时为实际头名 */
  headerField: string
  varName: string
  methodLabel: string
  /** 方法入参名 → 表达式 */
  paramBindings: Record<string, string>
  printExpr: string
}
