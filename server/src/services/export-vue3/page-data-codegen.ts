import type { DataField, DataFieldValue } from '../../types/page-data.js'

function serializeValue(value: DataFieldValue, indent = 2): string {
  return JSON.stringify(value, null, indent)
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  ' + line))
    .join('\n')
}

function tsTypeForField(field: DataField): string {
  switch (field.type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return field.binding === 'controller' ? 'any[] | null' : 'any[]'
    case 'json':
      return field.binding === 'controller'
        ? 'Record<string, any> | null'
        : 'Record<string, any>'
    default:
      return 'string'
  }
}

/** 计算体里的数据池字段名 → xxx.value（已是 .value / 属性访问左侧 / 赋值左侧则跳过） */
export function rewriteComputeBody(
  body: string,
  fieldNames: readonly string[],
): string {
  let result = body
  const sorted = [...fieldNames].sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 勿改写 $props.xxx；勿用 (?!\.)：会把 goodsList.filter 误判为已带点访问而不改写
    result = result.replace(
      new RegExp(
        `(?<!\\$)(?<!\\.)\\b${escaped}\\b(?!\\s*\\.value\\b)(?!\\s*=)`,
        'g',
      ),
      `${name}.value`,
    )
  }
  return result
}

export function collectPageDataFields(fields: DataField[]): DataField[] {
  return fields.filter((f) => f.type !== 'ref' && f.name.trim())
}

export function generatePageDataSource(fields: DataField[]): {
  source: string
  fieldNames: string[]
  writableFieldNames: string[]
  needsComputed: boolean
  needsRef: boolean
} {
  const dataFields = collectPageDataFields(fields)
  const fieldNames = dataFields.map((f) => f.name.trim())
  const plain = dataFields.filter(
    (f) => !(f.binding === 'computed' && f.computeBody?.trim()),
  )
  const computedFields = dataFields.filter(
    (f) => f.binding === 'computed' && f.computeBody?.trim(),
  )
  const writableFieldNames = plain.map((f) => f.name.trim())

  const lines: string[] = []
  for (const field of plain) {
    const name = field.name.trim()
    const type = tsTypeForField(field)
    lines.push(`const ${name} = ref<${type}>(${serializeValue(field.value)})`)
  }

  for (const field of computedFields) {
    const name = field.name.trim()
    const body = rewriteComputeBody(field.computeBody!.trim(), fieldNames)
    const indented = body
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
    lines.push(`const ${name} = computed(() => {\n${indented}\n})`)
  }

  return {
    source: lines.length ? `${lines.join('\n')}\n` : '',
    fieldNames,
    writableFieldNames,
    needsComputed: computedFields.length > 0,
    needsRef: plain.length > 0,
  }
}

/** visibility / interpolate 用的 store-like 适配 */
export function generatePageStoreAdapter(
  fieldNames: string[],
  writableFieldNames: string[],
  varName = 'pageStore',
): string {
  if (!fieldNames.length) {
    return `const ${varName} = {
  get $state(): Record<string, any> {
    return {}
  },
  setData(_prop: string, _value: any) {},
}
`
  }
  const stateEntries = fieldNames.map((n) => `      ${n}: ${n}.value,`).join('\n')
  const setCases = writableFieldNames
    .map((n) => `    if (prop === '${n}') { ${n}.value = value as typeof ${n}.value; return }`)
    .join('\n')
  return `const ${varName} = {
  get $state(): Record<string, any> {
    return {
${stateEntries}
    }
  },
  setData(prop: string, value: any) {
${setCases || '    // no writable fields'}
  },
}
`
}

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

function indentBlock(src: string, pad: string): string {
  return src
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n')
}

type EventBinding = {
  method?: string
  args?: Record<string, unknown>
}

function parseEventBindings(raw: string | undefined): EventBinding[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item) => item && typeof item === 'object' && typeof (item as EventBinding).method === 'string',
    ) as EventBinding[]
  } catch {
    return []
  }
}

function evalArgLiteral(raw: unknown): string {
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (raw == null) return 'null'
  if (typeof raw !== 'string') {
    try {
      return JSON.stringify(raw)
    } catch {
      return 'null'
    }
  }
  const text = raw.trim()
  if (!text) return '""'
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']')) ||
    text === 'true' ||
    text === 'false' ||
    text === 'null' ||
    /^-?\d+(\.\d+)?$/.test(text)
  ) {
    return text
  }
  if (/^[A-Za-z_$][\w$]*$/.test(text)) return text
  try {
    JSON.parse(text)
    return text
  } catch {
    return JSON.stringify(text)
  }
}

/** 控制器加载钩子 → 页面 ref.set / showToast 等 */
function generateControllerHookStmts(
  raw: string | undefined,
  indent: string,
): string[] {
  const stmts: string[] = []
  for (const bind of parseEventBindings(raw)) {
    const method = (bind.method || '').trim()
    if (!method) continue
    const args = bind.args ?? {}

    if (method === 'setData') {
      const prop = String(args.prop ?? '').trim()
      const valueExpr = evalArgLiteral(args.value)
      if (!prop || !isValidIdent(prop)) continue
      stmts.push(
        `${indent}${prop}.value = ${valueExpr} as typeof ${prop}.value`,
      )
      continue
    }

    if (method === 'showToast') {
      const message = evalArgLiteral(args.message ?? args.msg ?? '')
      stmts.push(`${indent}showToast(String(${message}))`)
      continue
    }
  }
  return stmts
}

export type VueApiBinding = {
  serviceId: string
  serviceName?: string
  controllerId: string
  apiId: string
  method: string
  path: string
}

/**
 * 页面 onMounted：自动拉取 binding===controller 的数据池字段。
 * 「加载事件」为空时仍会请求。
 */
export function generateControllerBoundPageMounted(options: {
  fields: DataField[]
  resolveApi: (raw: string) => VueApiBinding | null
}): {
  source: string
  needsOnMounted: boolean
  needsRoute: boolean
  needsInvoke: boolean
} {
  const loadBlocks: string[] = []
  let needsRoute = false

  for (const field of options.fields ?? []) {
    if (field.binding !== 'controller') continue
    const cfg = field.controllerBinding
    const name = field.name.trim()
    if (!cfg || !name || !isValidIdent(name)) continue
    const serviceId = cfg.serviceId?.trim() ?? ''
    const controllerId = cfg.controllerId?.trim() ?? ''
    const apiId = cfg.apiId?.trim() ?? ''
    if (!serviceId || !controllerId || !apiId) continue

    const resolved = options.resolveApi(
      JSON.stringify({ serviceId, controllerId, apiId }),
    )
    if (!resolved || !resolved.path) continue

    const argLines: string[] = [`      const args: Record<string, unknown> = {}`]
    for (const [varName, inp] of Object.entries(cfg.inputs ?? {})) {
      const key = varName.trim()
      if (!key || !isValidIdent(key)) continue
      if (!inp || inp.source !== 'binding') {
        const lit =
          inp && 'literal' in inp ? JSON.stringify(inp.literal ?? null) : 'undefined'
        argLines.push(`      args[${JSON.stringify(key)}] = ${lit}`)
        continue
      }
      const path = (inp.binding ?? '').trim()
      if (
        path === '$query' ||
        path === 'query' ||
        path.startsWith('$query.') ||
        path.startsWith('query.') ||
        path.startsWith('$route.') ||
        path.startsWith('route.')
      ) {
        needsRoute = true
      }
      argLines.push(
        `      args[${JSON.stringify(key)}] = __resolveCtrlBinding(${JSON.stringify(path)})`,
      )
    }

    const parseBody = (cfg.parseBody ?? '').trim()
    const parseCall = parseBody
      ? `(function (data: any) {\n${indentBlock(parseBody, '        ')}\n      })(data)`
      : 'data'

    const loadingStmts = generateControllerHookStmts(cfg.onLoading, '      ')
    const successStmts = generateControllerHookStmts(cfg.onSuccess, '        ')
    const errorStmts = generateControllerHookStmts(cfg.onError, '        ')
    const finallyStmts = generateControllerHookStmts(cfg.onFinally, '        ')

    loadBlocks.push(`  tasks.push(
    (async () => {
${loadingStmts.length ? `${loadingStmts.join('\n')}\n` : ''}      try {
${argLines.join('\n')}
        const data = await invoke(${JSON.stringify(resolved)}, args)
        const parsed = ${parseCall}
        ${name}.value = parsed as typeof ${name}.value
${successStmts.length ? `${successStmts.join('\n')}\n` : ''}      } catch (err) {
        console.error(${JSON.stringify(`[voider] controller ${name}`)}, err)
${errorStmts.length ? `${errorStmts.join('\n')}\n` : ''}      } finally {
${finallyStmts.length ? `${finallyStmts.join('\n')}\n` : ''}      }
    })(),
  )`)
  }

  if (!loadBlocks.length) {
    return {
      source: '',
      needsOnMounted: false,
      needsRoute: false,
      needsInvoke: false,
    }
  }

  const pageFieldNames = (options.fields ?? [])
    .map((f) => f.name.trim())
    .filter((n) => n && isValidIdent(n))
  const rootObj =
    pageFieldNames.length > 0
      ? `{ ${pageFieldNames.map((n) => `${n}: ${n}.value`).join(', ')} }`
      : '{}'
  const queryExpr = needsRoute ? 'route.query' : '{}'

  const source = `function __resolveCtrlBinding(path: string): unknown {
  const p = String(path ?? '').trim()
  if (!p) return undefined
  let root: any = null
  let rest = ''
  if (p === '$query' || p === 'query' || p === '$route' || p === 'route') {
    return ${queryExpr}
  }
  if (p.startsWith('$query.')) {
    root = ${queryExpr}
    rest = p.slice(7)
  } else if (p.startsWith('query.')) {
    root = ${queryExpr}
    rest = p.slice(6)
  } else if (p.startsWith('$route.')) {
    root = ${queryExpr}
    rest = p.slice(7)
  } else if (p.startsWith('route.')) {
    root = ${queryExpr}
    rest = p.slice(6)
  } else {
    root = ${rootObj}
    rest = p
  }
  if (!rest) return root
  const parts = rest.split('.')
  let cur: any = root
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

onMounted(() => {
  const tasks: Promise<unknown>[] = []
${loadBlocks.join('\n')}
  void Promise.all(tasks)
})
`

  return {
    source,
    needsOnMounted: true,
    needsRoute,
    needsInvoke: true,
  }
}

