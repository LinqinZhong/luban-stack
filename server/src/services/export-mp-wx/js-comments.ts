/** 导出代码注释工具：设计器 remark → JSDoc / 行注释 */

export function escapeJsComment(text: string): string {
  return String(text || '')
    .replace(/\*\//g, '*\\/')
    .replace(/\r\n/g, '\n')
    .trim()
}

/** 方法体是否引用标识符（忽略字符串/注释，避免 setData('x') 误判） */
export function codeUsesIdent(code: string, name: string): boolean {
  if (!name || !code) return false
  const stripped = String(code)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}(?:[^A-Za-z0-9_]|$)`).test(
    stripped,
  )
}

/** 单行 // 注释；多行压成一行 */
export function lineComment(remark: string, indent = ''): string {
  const text = escapeJsComment(remark).replace(/\n/g, ' ')
  if (!text) return ''
  return `${indent}// ${text}`
}

/** 方法 / 字段 JSDoc（indent 含前导空格） */
export function jsDocComment(
  options: {
    summary?: string
    params?: Array<{ name: string; remark?: string }>
  },
  indent = '',
): string {
  const summary = escapeJsComment(options.summary || '')
  const params = (options.params ?? []).filter(
    (p) => p.name && escapeJsComment(p.remark || ''),
  )
  if (!summary && !params.length) return ''

  const lines: string[] = [`${indent}/**`]
  if (summary) {
    for (const line of summary.split('\n')) {
      lines.push(`${indent} * ${line}`)
    }
  }
  if (params.length) {
    if (summary) lines.push(`${indent} *`)
    for (const p of params) {
      const r = escapeJsComment(p.remark || '')
      lines.push(
        r
          ? `${indent} * @param ${p.name} ${r}`
          : `${indent} * @param ${p.name}`,
      )
    }
  }
  lines.push(`${indent} */`)
  return lines.join('\n') + '\n'
}
