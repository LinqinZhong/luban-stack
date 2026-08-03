/** 输入/输出节点：本地调用 vs 网络请求 */
export type IoChannel = 'local' | 'network'

export type NetworkHttpMethod = 'GET' | 'POST' | 'DELETE' | 'PUT'

export type NetworkParamValueKind = 'variable' | 'constant'

export type NetworkConstantType = 'string' | 'number' | 'boolean'

export type NetworkParamRow = {
  name: string
  valueKind: NetworkParamValueKind
  value: string
  /** 常量时的值类型 */
  constantType?: NetworkConstantType
}

export type NetworkMediaTypePreset =
  | 'application/x-www-form-urlencoded'
  | 'application/json'
  | 'application/xml'

export type NetworkResponseBodyType = 'string' | 'json'

export type NetworkRequestConfig = {
  apiUrl: string
  httpMethod: NetworkHttpMethod
  headers: NetworkParamRow[]
  queryParams: NetworkParamRow[]
  mediaType: string
  formParams: NetworkParamRow[]
  /** json / xml / 自定义时：选择已有变量作为请求体 */
  bodyVarName: string
}

export type NetworkInputResponseConfig = {
  responseBodyType: NetworkResponseBodyType
  responseBodyVarName: string
  /** 空 = 不接收 */
  responseHeaderVarName: string
  /** 空 = 不接收 */
  statusCodeVarName: string
}

export type NetworkInputConfig = NetworkRequestConfig & NetworkInputResponseConfig

export const NETWORK_HTTP_METHODS: NetworkHttpMethod[] = [
  'GET',
  'POST',
  'DELETE',
  'PUT',
]

export const NETWORK_MEDIA_TYPE_OPTIONS: Array<{
  value: string
  label: string
}> = [
  {
    value: 'application/x-www-form-urlencoded',
    label: 'application/x-www-form-urlencoded',
  },
  { value: 'application/json', label: 'application/json' },
  { value: 'application/xml', label: 'application/xml' },
  { value: '__custom__', label: '自定义 application/…' },
]

export const NETWORK_MEDIA_CUSTOM = '__custom__'

export function createEmptyNetworkParamRow(
  partial?: Partial<NetworkParamRow>,
): NetworkParamRow {
  return {
    name: '',
    valueKind: 'constant',
    value: '',
    constantType: 'string',
    ...partial,
  }
}

export function createEmptyNetworkRequestConfig(
  partial?: Partial<NetworkRequestConfig>,
): NetworkRequestConfig {
  const {
    headers: headersIn,
    queryParams: queryIn,
    formParams: formIn,
    ...rest
  } = partial ?? {}
  return {
    apiUrl: '',
    httpMethod: 'GET',
    mediaType: 'application/json',
    bodyVarName: '',
    ...rest,
    headers: (headersIn ?? []).map((r) => createEmptyNetworkParamRow(r)),
    queryParams: (queryIn ?? []).map((r) => createEmptyNetworkParamRow(r)),
    formParams: (formIn ?? []).map((r) => createEmptyNetworkParamRow(r)),
  }
}

export function createEmptyNetworkInputConfig(
  partial?: Partial<NetworkInputConfig>,
): NetworkInputConfig {
  const base = createEmptyNetworkRequestConfig(partial)
  return {
    ...base,
    responseBodyType: partial?.responseBodyType ?? 'string',
    responseBodyVarName: partial?.responseBodyVarName ?? '',
    responseHeaderVarName: partial?.responseHeaderVarName ?? '',
    statusCodeVarName: partial?.statusCodeVarName ?? '',
  }
}

export function normalizeIoChannel(raw: unknown): IoChannel {
  return raw === 'network' ? 'network' : 'local'
}

function normalizeConstantType(raw: unknown): NetworkConstantType {
  if (raw === 'number' || raw === 'boolean' || raw === 'string') return raw
  return 'string'
}

export function normalizeNetworkParamRow(raw: unknown): NetworkParamRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const valueKind: NetworkParamValueKind =
    row.valueKind === 'variable' ? 'variable' : 'constant'
  const value = typeof row.value === 'string' ? row.value : String(row.value ?? '')
  return {
    name,
    valueKind,
    value,
    constantType: normalizeConstantType(row.constantType),
  }
}

export function normalizeNetworkParamRows(raw: unknown): NetworkParamRow[] {
  if (!Array.isArray(raw)) return []
  const out: NetworkParamRow[] = []
  for (const item of raw) {
    const row = normalizeNetworkParamRow(item)
    if (row) out.push(row)
  }
  return out
}

export function normalizeNetworkRequestConfig(
  raw: unknown,
): NetworkRequestConfig {
  const row =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const methodRaw =
    typeof row.httpMethod === 'string' ? row.httpMethod.toUpperCase() : 'GET'
  const httpMethod = (
    NETWORK_HTTP_METHODS.includes(methodRaw as NetworkHttpMethod)
      ? methodRaw
      : 'GET'
  ) as NetworkHttpMethod
  return createEmptyNetworkRequestConfig({
    apiUrl: typeof row.apiUrl === 'string' ? row.apiUrl : '',
    httpMethod,
    headers: normalizeNetworkParamRows(row.headers),
    queryParams: normalizeNetworkParamRows(row.queryParams),
    mediaType:
      typeof row.mediaType === 'string' && row.mediaType.trim()
        ? row.mediaType.trim()
        : 'application/json',
    formParams: normalizeNetworkParamRows(row.formParams),
    bodyVarName: typeof row.bodyVarName === 'string' ? row.bodyVarName : '',
  })
}

export function normalizeNetworkInputConfig(raw: unknown): NetworkInputConfig {
  const row =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const base = normalizeNetworkRequestConfig(row)
  const bodyType =
    row.responseBodyType === 'json' || row.responseBodyType === 'string'
      ? row.responseBodyType
      : 'string'
  return {
    ...base,
    responseBodyType: bodyType,
    responseBodyVarName:
      typeof row.responseBodyVarName === 'string'
        ? row.responseBodyVarName
        : '',
    responseHeaderVarName:
      typeof row.responseHeaderVarName === 'string'
        ? row.responseHeaderVarName
        : '',
    statusCodeVarName:
      typeof row.statusCodeVarName === 'string' ? row.statusCodeVarName : '',
  }
}

export function isFormUrlEncoded(mediaType: string): boolean {
  return mediaType.trim().toLowerCase() === 'application/x-www-form-urlencoded'
}

export function usesRequestBody(mediaType: string): boolean {
  return !isFormUrlEncoded(mediaType)
}

/** 校验参数行；返回错误文案，空串表示通过 */
export function validateNetworkParamRows(
  rows: NetworkParamRow[],
  label: string,
): string {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const name = row.name.trim()
    const hasValue =
      row.valueKind === 'variable'
        ? Boolean(row.value.trim())
        : row.value !== ''
    if (!name && !hasValue) continue
    if (!name) return `${label}第 ${i + 1} 行缺少参数名`
    if (row.valueKind === 'variable' && !row.value.trim()) {
      return `${label}「${name}」请选择变量`
    }
  }
  return ''
}

export function coerceNetworkConstant(
  value: string,
  constantType: NetworkConstantType = 'string',
): string | number | boolean {
  if (constantType === 'boolean') {
    const t = value.trim().toLowerCase()
    if (t === 'true' || t === '1') return true
    if (t === 'false' || t === '0') return false
    return Boolean(value)
  }
  if (constantType === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return value
}

export function networkSummaryLabel(
  config: Pick<NetworkRequestConfig, 'apiUrl' | 'httpMethod'>,
): string {
  const url = config.apiUrl.trim() || '(未填地址)'
  return `${config.httpMethod} ${url}`
}
