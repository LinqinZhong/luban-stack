/**
 * 文本/属性中的 `{...}` 绑定：支持嵌套 `{}`（如模板字符串 ${}）与 JS 表达式求值。
 */

const SIMPLE_PATH_RE =
  /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/

export function isSimpleBindingPath(expr: string): boolean {
  const e = expr.trim()
  return Boolean(e) && SIMPLE_PATH_RE.test(e)
}

/** 字符串字面量外的全角 ？： → ASCII（中文输入法常误输入） */
export function normalizeBindingOperators(expr: string): string {
  let out = ''
  let inSingle = false
  let inDouble = false
  let inTick = false
  let escape = false
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!
    if (escape) {
      out += c
      escape = false
      continue
    }
    if ((inSingle || inDouble || inTick) && c === '\\') {
      out += c
      escape = true
      continue
    }
    if (inSingle) {
      if (c === "'") inSingle = false
      out += c
      continue
    }
    if (inDouble) {
      if (c === '"') inDouble = false
      out += c
      continue
    }
    if (inTick) {
      if (c === '`') inTick = false
      out += c
      continue
    }
    if (c === "'") {
      inSingle = true
      out += c
      continue
    }
    if (c === '"') {
      inDouble = true
      out += c
      continue
    }
    if (c === '`') {
      inTick = true
      out += c
      continue
    }
    if (c === '？') {
      out += '?'
      continue
    }
    if (c === '：') {
      out += ':'
      continue
    }
    out += c
  }
  return out
}

export type BindingSpan = { start: number; end: number; expr: string }

/**
 * 扫描模板中的 `{expr}`（感知引号/模板字符串，支持嵌套 `{}`）。
 * 兼容 `{{expr}}`：按单层绑定处理（内外各剥一层）。
 */
export function scanBindingSpans(template: string): BindingSpan[] {
  const spans: BindingSpan[] = []
  let i = 0
  while (i < template.length) {
    if (template[i] !== '{') {
      i++
      continue
    }
    // `{{expr}}` → 从内层 `{` 开始匹配到与之平衡的 `}`，再吃掉外层 `}`
    let start = i
    let doubleWrap = false
    if (template[i + 1] === '{') {
      doubleWrap = true
      start = i + 1
    }
    const end = findBalancedBindingEnd(template, start)
    if (end < 0) {
      i++
      continue
    }
    let close = end
    if (doubleWrap) {
      if (template[end + 1] !== '}') {
        i++
        continue
      }
      close = end + 1
    }
    spans.push({
      start: doubleWrap ? i : start,
      end: close + 1,
      expr: template.slice(start + 1, end).trim(),
    })
    i = close + 1
  }
  return spans
}

/** 从 `template[openIndex] === '{'` 找到与之平衡的 `}` 下标；失败返回 -1 */
function findBalancedBindingEnd(template: string, openIndex: number): number {
  if (template[openIndex] !== '{') return -1
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTick = false
  let escape = false
  for (let j = openIndex; j < template.length; j++) {
    const c = template[j]!
    if (escape) {
      escape = false
      continue
    }
    if ((inSingle || inDouble || inTick) && c === '\\') {
      escape = true
      continue
    }
    if (inSingle) {
      if (c === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (c === '"') inDouble = false
      continue
    }
    if (inTick) {
      if (c === '`') inTick = false
      continue
    }
    if (c === "'") {
      inSingle = true
      continue
    }
    if (c === '"') {
      inDouble = true
      continue
    }
    if (c === '`') {
      inTick = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

/** 若整段 trim 后是单个 `{expr}`（可含嵌套），返回 expr；否则 null */
export function unwrapWholeBinding(raw: string): string | null {
  const t = raw.trim()
  if (!t.startsWith('{')) return null
  let open = 0
  let doubleWrap = false
  if (t[1] === '{') {
    doubleWrap = true
    open = 1
  }
  const end = findBalancedBindingEnd(t, open)
  if (end < 0) return null
  if (doubleWrap) {
    if (t[end + 1] !== '}' || end + 2 !== t.length) return null
  } else if (end !== t.length - 1) {
    return null
  }
  return t.slice(open + 1, end).trim()
}

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

/** 在数据池 / item / $props 等 scope 上求值绑定表达式 */
export function evaluateBindingExpression(
  expr: string,
  scope: Record<string, unknown>,
): { ok: true; value: unknown } | { ok: false } {
  const normalized = normalizeBindingOperators(expr.trim())
  if (!normalized) return { ok: false }
  try {
    const names = Object.keys(scope).filter(isValidIdent)
    const values = names.map((n) => scope[n])
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, `"use strict"; return (${normalized});`)
    return { ok: true, value: fn(...values) }
  } catch {
    return { ok: false }
  }
}

/** 把 `` `a${x}b` `` 转成 WXML 可用的拼接：('a'+(x)+'b') */
export function templateLiteralsToConcat(expr: string): string {
  let out = ''
  let i = 0
  while (i < expr.length) {
    if (expr[i] !== '`') {
      out += expr[i]
      i++
      continue
    }
    i++ // skip opening `
    const parts: string[] = []
    let literal = ''
    while (i < expr.length) {
      const c = expr[i]!
      if (c === '\\' && i + 1 < expr.length) {
        literal += expr[i + 1]
        i += 2
        continue
      }
      if (c === '`') {
        i++
        break
      }
      if (c === '$' && expr[i + 1] === '{') {
        if (literal) {
          parts.push(JSON.stringify(literal))
          literal = ''
        }
        const open = i + 1
        const close = findBalancedBindingEnd(expr, open)
        if (close < 0) {
          literal += c
          i++
          continue
        }
        const inner = expr.slice(open + 1, close)
        parts.push(`(${templateLiteralsToConcat(inner)})`)
        i = close + 1
        continue
      }
      literal += c
      i++
    }
    if (literal) parts.push(JSON.stringify(literal))
    out += parts.length ? `(${parts.join('+')})` : "''"
  }
  return out
}
