export type MethodParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'any'

export type MethodReturnType = MethodParamType | 'void'

export interface MethodParam {
  name: string
  type: MethodParamType
}

export interface PageMethod {
  /** 方法名，同时作为文件名 */
  name: string
  params: MethodParam[]
  returnType: MethodReturnType
  /** 方法体（不含函数签名） */
  body: string
  /** 预置只读方法 */
  builtin?: boolean
}

export const METHOD_PARAM_TYPE_OPTIONS: Array<{
  label: string
  value: MethodParamType
}> = [
  { label: '字符串', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: '对象', value: 'object' },
  { label: '数组', value: 'array' },
  { label: '任意', value: 'any' },
]

export const METHOD_RETURN_TYPE_OPTIONS: Array<{
  label: string
  value: MethodReturnType
}> = [
  { label: '无返回值', value: 'void' },
  ...METHOD_PARAM_TYPE_OPTIONS,
]

export const BUILTIN_METHODS: PageMethod[] = [
  {
    name: 'navigateTo',
    params: [
      { name: 'to', type: 'string' },
      { name: 'params', type: 'object' },
    ],
    returnType: 'void',
    body: '// 跳转到指定页面\n// to: 页面 id；params: 路由参数对象',
    builtin: true,
  },
  {
    name: 'navigateBack',
    params: [],
    returnType: 'void',
    body: '// 返回上一页',
    builtin: true,
  },
  {
    name: 'setData',
    params: [
      { name: 'prop', type: 'string' },
      { name: 'value', type: 'any' },
    ],
    returnType: 'void',
    body: '// 写入数据池字段\n// prop: 字段名；value: 任意值',
    builtin: true,
  },
]

export function isValidMethodName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
}

export function createEmptyMethod(): PageMethod {
  return {
    name: '',
    params: [],
    returnType: 'void',
    body: '',
    builtin: false,
  }
}

/** 写入 .ts 文件的内容 */
export function serializeMethodFile(method: PageMethod): string {
  const meta = {
    name: method.name,
    params: method.params,
    returnType: method.returnType,
  }
  return `/*@voider-method\n${JSON.stringify(meta, null, 2)}\n*/\n\n${method.body.trimEnd()}\n`
}

/** 从 .ts 文件内容解析 */
export function parseMethodFile(raw: string, fallbackName: string): PageMethod {
  const trimmed = raw.replace(/^\uFEFF/, '')
  const match = trimmed.match(/^\/\*@voider-method\s*([\s\S]*?)\*\//)
  let meta: Partial<PageMethod> = { name: fallbackName }
  let body = trimmed

  if (match) {
    try {
      meta = { ...meta, ...(JSON.parse(match[1]) as Partial<PageMethod>) }
    } catch {
      // ignore
    }
    body = trimmed.slice(match[0].length).replace(/^\s*\n/, '')
  }

  const name =
    typeof meta.name === 'string' && meta.name.trim()
      ? meta.name.trim()
      : fallbackName

  const params = Array.isArray(meta.params)
    ? meta.params
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          name: String((item as MethodParam).name ?? '').trim(),
          type: normalizeParamType((item as MethodParam).type),
        }))
        .filter((item) => item.name)
    : []

  return {
    name,
    params,
    returnType: normalizeReturnType(meta.returnType),
    body: body.replace(/\s+$/, '\n') || '',
    builtin: false,
  }
}

function normalizeParamType(value: unknown): MethodParamType {
  const allowed: MethodParamType[] = [
    'string',
    'number',
    'boolean',
    'object',
    'array',
    'any',
  ]
  return allowed.includes(value as MethodParamType)
    ? (value as MethodParamType)
    : 'any'
}

function normalizeReturnType(value: unknown): MethodReturnType {
  if (value === 'void') return 'void'
  return normalizeParamType(value)
}

/** 事件绑定：单个方法调用 */
export interface EventMethodBinding {
  id: string
  method: string
  /** 参数名 → 字面量/表达式字符串 */
  args: Record<string, string>
}

export function parseEventBindings(raw: string | undefined): EventMethodBinding[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      // 兼容旧纯字符串：当作无参方法名
      const name = raw.trim()
      if (!name) return []
      return [
        {
          id: `bind_${Date.now()}`,
          method: name.includes(':') ? name.split(':')[0] : name,
          args: {},
        },
      ]
    }
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => {
        const row = item as Partial<EventMethodBinding>
        return {
          id: row.id || `bind_${index}_${Date.now()}`,
          method: String(row.method ?? '').trim(),
          args:
            row.args && typeof row.args === 'object' && !Array.isArray(row.args)
              ? Object.fromEntries(
                  Object.entries(row.args).map(([k, v]) => [
                    k,
                    v == null ? '' : String(v),
                  ]),
                )
              : {},
        }
      })
      .filter((item) => item.method)
  } catch {
    const name = raw.trim()
    if (!name) return []
    return [{ id: `bind_${Date.now()}`, method: name, args: {} }]
  }
}

export function serializeEventBindings(bindings: EventMethodBinding[]): string {
  const list = bindings
    .filter((item) => item.method.trim())
    .map((item) => ({
      id: item.id,
      method: item.method.trim(),
      args: item.args ?? {},
    }))
  if (!list.length) return ''
  return JSON.stringify(list)
}

export function countEventBindings(raw: string | undefined): number {
  return parseEventBindings(raw).length
}

export const INTERACTION_EVENT_KEYS = ['onClick', 'onLongClick', 'onAppear'] as const

export function countNodeEventBindings(attrs: Record<string, string | undefined>): number {
  return INTERACTION_EVENT_KEYS.reduce(
    (sum, key) => sum + countEventBindings(attrs[key]),
    0,
  )
}
