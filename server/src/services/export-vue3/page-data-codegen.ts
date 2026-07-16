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
      return 'any[]'
    case 'json':
      return 'Record<string, any>'
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

