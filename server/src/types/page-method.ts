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
  {
    name: 'showToast',
    params: [
      { name: 'message', type: 'string' },
      { name: 'duration', type: 'string' },
    ],
    returnType: 'void',
    body:
      '// 弹出 Toast 提示\n' +
      "// message: 提示内容\n" +
      "// duration: 'short'（短，默认）或 'long'（长）",
    builtin: true,
  },
  {
    name: 'openMask',
    params: [{ name: 'name', type: 'string' }],
    returnType: 'void',
    body:
      '// 打开遮罩（按 name 入栈）\n' +
      '// 同一页面同时只显示栈顶遮罩；打开新遮罩时先前遮罩会暂时关闭，关闭后可恢复',
    builtin: true,
  },
  {
    name: 'closeMask',
    params: [{ name: 'name', type: 'string' }],
    returnType: 'void',
    body:
      '// 关闭遮罩\n' +
      '// 不传 name：关闭当前栈顶\n' +
      '// 传入 name：关闭该层及其之上的遮罩',
    builtin: true,
  },
  {
    name: 'closeAllMasks',
    params: [],
    returnType: 'void',
    body: '// 关闭页面上所有遮罩并清空堆栈',
    builtin: true,
  },
]

/** 仅组件 function 目录注入的预置方法 */
export const COMPONENT_BUILTIN_METHODS: PageMethod[] = [
  {
    name: 'emit',
    params: [
      { name: 'event', type: 'string' },
      { name: '...args', type: 'any' },
    ],
    returnType: 'void',
    body:
      '// 向父页面抛出组件事件\n' +
      "// 用法：emit(事件名, ...事件参数)\n" +
      "// 事件名对应组件设置里「事件方法」的名称；其后参数按该事件定义的参数依次传入\n" +
      "// 例如事件 onClick 定义了参数 id，则：emit('onClick', id)",
    builtin: true,
  },
]

export function builtinsForRoot(root: 'pages' | 'components'): PageMethod[] {
  if (root === 'components') {
    return [
      ...BUILTIN_METHODS.map((item) => ({ ...item, builtin: true as const })),
      ...COMPONENT_BUILTIN_METHODS.map((item) => ({ ...item, builtin: true as const })),
    ]
  }
  return BUILTIN_METHODS.map((item) => ({ ...item, builtin: true as const }))
}

export function isBuiltinMethodName(
  name: string,
  root: 'pages' | 'components' = 'pages',
): boolean {
  return builtinsForRoot(root).some((item) => item.name === name)
}

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
