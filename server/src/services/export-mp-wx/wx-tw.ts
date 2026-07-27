/**
 * 微信小程序导出：按 Tailwind 语义生成工具类。
 * WXSS 不支持 `\[` 等转义选择器，类名仅用 [a-zA-Z0-9_-]。
 */

/** 固定工具类 → CSS 声明（类名已对 WXSS 安全） */
const TW_KNOWN: Record<string, string> = {
  'box-border': 'box-sizing:border-box',
  'w-full': 'width:100%',
  'w-auto': 'width:auto',
  'w-fit': 'width:auto',
  'w-0': 'width:0',
  'h-full': 'height:100%',
  'h-auto': 'height:auto',
  'h-fit': 'height:auto',
  'h-0': 'height:0',
  'min-w-0': 'min-width:0',
  'min-h-0': 'min-height:0',
  'max-w-full': 'max-width:100%',
  flex: 'display:flex',
  'inline-flex': 'display:inline-flex',
  'flex-row': 'flex-direction:row',
  'flex-col': 'flex-direction:column',
  'flex-1': 'flex:1 1 0%',
  'shrink-0': 'flex-shrink:0',
  'items-start': 'align-items:flex-start',
  'items-center': 'align-items:center',
  'items-end': 'align-items:flex-end',
  'justify-start': 'justify-content:flex-start',
  'justify-center': 'justify-content:center',
  'justify-end': 'justify-content:flex-end',
  absolute: 'position:absolute',
  relative: 'position:relative',
  'left-0': 'left:0',
  'right-0': 'right:0',
  'top-0': 'top:0',
  'bottom-0': 'bottom:0',
  'inset-0': 'top:0;right:0;bottom:0;left:0',
  // Tailwind left-1/2 → WXSS 安全名 left-1-2
  'left-1-2': 'left:50%',
  'top-1-2': 'top:50%',
  '-translate-x-1-2':
    '-webkit-transform:translateX(-50%);transform:translateX(-50%)',
  '-translate-y-1-2':
    '-webkit-transform:translateY(-50%);transform:translateY(-50%)',
  'overflow-hidden': 'overflow:hidden',
  'overflow-visible': 'overflow:visible',
  'pointer-events-none': 'pointer-events:none',
  'm-0': 'margin:0',
  'p-0': 'padding:0',
  'pt-0': 'padding-top:0',
  'pr-0': 'padding-right:0',
  'pb-0': 'padding-bottom:0',
  'pl-0': 'padding-left:0',
  'mt-0': 'margin-top:0',
  'mr-0': 'margin-right:0',
  'mb-0': 'margin-bottom:0',
  'ml-0': 'margin-left:0',
}

/** 别名：codegen 仍可写 Tailwind 原名，内部落到安全类名 */
const TW_ALIASES: Record<string, string> = {
  'left-1/2': 'left-1-2',
  'top-1/2': 'top-1-2',
  '-translate-x-1/2': '-translate-x-1-2',
  '-translate-y-1/2': '-translate-y-1-2',
}

/**
 * 把任意 CSS 值变成 WXSS 合法 class 片段。
 * 5.333333vw → 5_333333vw；#ffffff → hffffff；rgba(...) → 压缩
 */
export function safeToken(raw: string): string {
  return raw
    .trim()
    .replace(/^#/, 'h')
    .replace(/%/g, 'p')
    .replace(/\./g, '_')
    .replace(/,/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
}

/** 任意值 class：w-arb-5_333333vw（对应 Tailwind w-[5.333333vw]） */
export function twArb(prefix: string, cssValue: string): string {
  return `${prefix}-arb-${safeToken(cssValue)}`
}

export class ClassRegistry {
  private rules = new Map<string, string>()

  use(name: string): string {
    const resolved = TW_ALIASES[name] ?? name
    const decl = TW_KNOWN[resolved]
    if (!decl) {
      throw new Error(`unknown tw utility: ${name}`)
    }
    this.rules.set(resolved, decl)
    return resolved
  }

  useMany(names: string[]): string[] {
    return names.map((n) => this.use(n))
  }

  /**
   * 任意值工具类。
   * @param prefix 如 w / h / p / bg / text / rounded / text-size
   * @param cssProp CSS 属性
   * @param cssValue 真实 CSS 值
   */
  arb(prefix: string, cssProp: string, cssValue: string): string {
    if (cssValue === '0' || cssValue === '0px' || cssValue === '0vw') {
      const zeroName = `${prefix}-0`
      if (TW_KNOWN[zeroName]) return this.use(zeroName)
    }
    const name = twArb(prefix, cssValue)
    this.rules.set(name, `${cssProp}:${cssValue}`)
    return name
  }

  /** 结构壳：保证类名 WXSS 安全 */
  shell(name: string, decls: string): string {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '-')
    this.rules.set(safe, decls)
    return safe
  }

  toWxss(): string {
    if (!this.rules.size) return ''
    const lines: string[] = [
      '/* Voider utilities — Tailwind semantics, WXSS-safe class names */',
    ]
    const names = [...this.rules.keys()].sort()
    for (const name of names) {
      const decl = this.rules.get(name)!
      lines.push(`.${name}{${decl}}`)
    }
    return `${lines.join('\n')}\n`
  }
}

/** 同类尺寸/定位工具类互相覆盖时的优先级：arb 明确值 > 其余；同级保留后者 */
const CLASS_PROP_GROUP: Record<string, string> = {
  'w-full': 'width',
  'w-auto': 'width',
  'w-fit': 'width',
  'w-0': 'width',
  'h-full': 'height',
  'h-auto': 'height',
  'h-fit': 'height',
  'h-0': 'height',
  'left-0': 'left',
  'left-1-2': 'left',
  'right-0': 'right',
  'top-0': 'top',
  'top-1-2': 'top',
  'bottom-0': 'bottom',
  'inset-0': 'inset',
}

function classPropGroup(name: string): string | null {
  if (CLASS_PROP_GROUP[name]) return CLASS_PROP_GROUP[name]
  const m = /^(w|h|left|right|top|bottom|m|p|mt|mr|mb|ml|pt|pr|pb|pl|bg|text-size|text|rounded-tl|rounded-tr|rounded-br|rounded-bl|rounded|z)-arb-/.exec(
    name,
  )
  if (m) {
    const p = m[1]!
    const map: Record<string, string> = {
      w: 'width',
      h: 'height',
      m: 'margin',
      p: 'padding',
      mt: 'margin-top',
      mr: 'margin-right',
      mb: 'margin-bottom',
      ml: 'margin-left',
      pt: 'padding-top',
      pr: 'padding-right',
      pb: 'padding-bottom',
      pl: 'padding-left',
      bg: 'background',
      'text-size': 'font-size',
      text: 'color',
      rounded: 'border-radius',
      'rounded-tl': 'border-top-left-radius',
      'rounded-tr': 'border-top-right-radius',
      'rounded-br': 'border-bottom-right-radius',
      'rounded-bl': 'border-bottom-left-radius',
      z: 'z-index',
      left: 'left',
      right: 'right',
      top: 'top',
      bottom: 'bottom',
    }
    return map[p] ?? p
  }
  if (name.startsWith('z-arb-') || name === 'z-0') return 'z-index'
  return null
}

function classRank(name: string): number {
  // 明确任意值优先，避免 w-full / w-fit 盖掉 w-arb-*
  if (name.includes('-arb-')) return 3
  if (name === 'w-0' || name === 'h-0') return 2
  if (
    name.endsWith('-full') ||
    name.endsWith('-fit') ||
    name.endsWith('-auto') ||
    name === 'left-0' ||
    name === 'right-0' ||
    name === 'top-0' ||
    name === 'bottom-0' ||
    name === 'inset-0'
  ) {
    return 1
  }
  return 2
}

/** 按 CSS 属性去重：同组保留优先级更高的；同级保留后者 */
export function dedupeUtilityClasses(
  classes: Array<string | null | undefined>,
): string[] {
  const list = classes
    .filter((c): c is string => Boolean(c && String(c).trim()))
    .map((c) => c.trim())
  // 先去掉完全重复的 class，再按属性组去重
  const uniq: string[] = []
  const seen = new Set<string>()
  for (const name of list) {
    if (seen.has(name)) continue
    seen.add(name)
    uniq.push(name)
  }
  const best = new Map<string, { name: string; index: number; rank: number }>()
  uniq.forEach((name, i) => {
    const g = classPropGroup(name)
    if (!g) return
    const rank = classRank(name)
    const prev = best.get(g)
    if (!prev || rank > prev.rank || (rank === prev.rank && i > prev.index)) {
      best.set(g, { name, index: i, rank })
    }
  })
  const keepIndex = new Set([...best.values()].map((v) => v.index))
  return uniq.filter((name, i) => {
    const g = classPropGroup(name)
    if (!g) return true
    return keepIndex.has(i)
  })
}

export function classAttr(classes: Array<string | null | undefined>): string {
  const trimmed = dedupeUtilityClasses(classes).join(' ').replace(/\s+/g, ' ').trim()
  return trimmed ? `class="${trimmed}"` : ''
}

export function hasWidthClass(classes: string[]): boolean {
  return classes.some((c) => classPropGroup(c) === 'width')
}

export function hasHeightClass(classes: string[]): boolean {
  return classes.some((c) => classPropGroup(c) === 'height')
}
