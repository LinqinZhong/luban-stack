/** Nest / 类型导出共用的备注注释 */

export function escapeJsComment(text: string): string {
  return String(text || '')
    .replace(/\*\//g, '*\\/')
    .replace(/\r\n/g, '\n')
    .trim()
}

/** 缩进级方法 JSDoc（含 @param） */
export function methodJsDoc(
  summary: string | undefined,
  params: Array<{ name: string; remark?: string }>,
  indent = '  ',
): string {
  const summaryText = escapeJsComment(summary || '')
  const withRemark = params.filter((p) => p.name && escapeJsComment(p.remark || ''))
  if (!summaryText && !withRemark.length) return ''

  const lines: string[] = [`${indent}/**`]
  if (summaryText) {
    for (const line of summaryText.split('\n')) {
      lines.push(`${indent} * ${line}`)
    }
  }
  if (withRemark.length) {
    if (summaryText) lines.push(`${indent} *`)
    for (const p of withRemark) {
      const r = escapeJsComment(p.remark || '')
      lines.push(`${indent} * @param ${p.name} ${r}`)
    }
  }
  lines.push(`${indent} */`)
  return `${lines.join('\n')}\n`
}
