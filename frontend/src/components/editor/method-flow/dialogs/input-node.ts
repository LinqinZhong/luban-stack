import type { ProcessorTypeExpr } from '../../../../types/backend-services'

/** 输入节点数据来源（层） */
export type InputDataSource = 'business' | 'data' | 'request_header'

/** 旧版枚举，打开时归一到 InputDataSource */
export type LegacyInputDataSource =
  | 'current_business'
  | 'other_business'
  | 'current_data'
  | 'other_data'
  | 'business'
  | 'data'
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

export type InputModuleOption = {
  id: string
  name: string
}

export type InputNodeForm = {
  /** 所选模块（服务）id；请求头时可为空 */
  serviceId: string
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
  /** 落盘的方法出参类型，供 ambient / 跨模块解析 */
  outputTypeExpr?: ProcessorTypeExpr | null
}

export function normalizeInputDataSource(
  raw: unknown,
  opts?: { businessOnly?: boolean },
): InputDataSource {
  const businessOnly = Boolean(opts?.businessOnly)
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (s === 'request_header') return 'request_header'
  if (
    s === 'business' ||
    s === 'current_business' ||
    s === 'other_business'
  ) {
    return 'business'
  }
  if (s === 'data' || s === 'current_data' || s === 'other_data') {
    return businessOnly ? 'business' : 'data'
  }
  return businessOnly ? 'business' : 'data'
}

export function createEmptyInputNodeForm(
  partial?: Partial<InputNodeForm>,
): InputNodeForm {
  return {
    serviceId: '',
    dataSource: 'data',
    dataProcessorId: '',
    dataMethodId: '',
    headerField: '',
    varName: '',
    methodLabel: '',
    paramBindings: {},
    printExpr: '',
    outputTypeExpr: null,
    ...partial,
  }
}
