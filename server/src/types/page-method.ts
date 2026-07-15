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
  name: string
  params: MethodParam[]
  returnType: MethodReturnType
  body: string
  builtin?: boolean
}

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

export function serializeMethodFile(method: PageMethod): string {
  const meta = {
    name: method.name,
    params: method.params,
    returnType: method.returnType,
  }
  return `/*@voider-method\n${JSON.stringify(meta, null, 2)}\n*/\n\n${method.body.trimEnd()}\n`
}

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
