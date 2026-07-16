import type { DataField, DataFieldValue } from '../../types/page-data.js'
import { pageIdToStoreFile, pageIdToStoreName, toPascalCase } from './naming.js'

function extractReturnExpression(computeBody: string): string | null {
  const lines = computeBody.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('return ')) {
      return line.slice('return '.length).trim()
    }
    if (line.startsWith('return')) {
      return line.slice('return'.length).trim()
    }
  }
  return null
}

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

export function generateStoreSource(id: string, fields: DataField[]): string {
  const storeName = pageIdToStoreName(id)
  const stateFields = fields.filter((f) => f.type !== 'ref')
  const computedFields = stateFields.filter(
    (f) => f.binding === 'computed' && f.computeBody?.trim(),
  )
  const plainStateFields = stateFields.filter((f) => !computedFields.includes(f))

  const stateLines = plainStateFields.map((field) => {
    const val = serializeValue(field.value)
    return `    ${field.name}: ${val},`
  })

  const getterLines = computedFields.map((field) => {
    const expr = extractReturnExpression(field.computeBody ?? '')
    const comment = (field.computeBody ?? '')
      .split('\n')
      .map((line) => `    // ${line}`)
      .join('\n')
    const body = expr
      ? `      try {\n        const { ${plainStateFields.map((f) => f.name).join(', ')} } = state\n        return ${expr}\n      } catch {\n        return ${serializeValue(field.value)}\n      }`
      : `      return ${serializeValue(field.value)}`
    return `${comment}\n    ${field.name}(state) {\n${body}\n    },`
  })

  const stateTypeLines = plainStateFields.map(
    (f) => `  ${f.name}: ${tsTypeForField(f)}`,
  )
  const getterTypeLines = computedFields.map(
    (f) => `  readonly ${f.name}: ${tsTypeForField(f)}`,
  )
  const allTypeLines = [...stateTypeLines, ...getterTypeLines]

  return `import { defineStore } from 'pinia'

export interface ${toPascalCase(id)}State {
${allTypeLines.join('\n')}
}

export const ${storeName} = defineStore('${pageIdToStoreFile(id)}', {
  state: (): ${toPascalCase(id)}State => ({
${stateLines.join('\n')}
  }),
${getterLines.length ? `  getters: {\n${getterLines.join('\n\n')}\n  },\n` : ''}  actions: {
    setData(prop: keyof ${toPascalCase(id)}State | string, value: any) {
      if (prop in this.$state) {
        ;(this as Record<string, any>)[prop as string] = value
      }
    },
  },
})
`
}

export function generateStoreFileName(id: string): string {
  return `${pageIdToStoreFile(id)}.ts`
}
