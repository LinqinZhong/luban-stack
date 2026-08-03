import {
  createEmptyNetworkRequestConfig,
  normalizeIoChannel,
  normalizeNetworkRequestConfig,
  type IoChannel,
  type NetworkRequestConfig,
} from './network-request'

export type OutputNodeForm = {
  channel: IoChannel
  dataProcessorId: string
  dataMethodId: string
  methodLabel: string
  paramBindings: Record<string, string>
  /** 可选：写入结果变量名 */
  resultVarName: string
  description: string
  printExpr: string
  /** channel=network 时的请求配置（无响应字段） */
  network: NetworkRequestConfig
}

export function createEmptyOutputNodeForm(
  partial?: Partial<OutputNodeForm>,
): OutputNodeForm {
  const { network, channel, paramBindings, ...rest } = partial ?? {}
  return {
    channel: normalizeIoChannel(channel),
    dataProcessorId: '',
    dataMethodId: '',
    methodLabel: '',
    paramBindings: { ...(paramBindings ?? {}) },
    resultVarName: '',
    description: '',
    printExpr: '',
    ...rest,
    network: createEmptyNetworkRequestConfig(network),
  }
}

export function readOutputNetworkFromData(
  data: Record<string, unknown>,
): NetworkRequestConfig {
  if (data.network && typeof data.network === 'object') {
    return normalizeNetworkRequestConfig(data.network)
  }
  return normalizeNetworkRequestConfig(data)
}
