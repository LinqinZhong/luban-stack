export interface PaletteColor {
  /** 英文名称，用作 CSS 变量名与引用 key */
  name: string
  /** 说明 */
  description: string
  /** 实际颜色值：#hex / rgba() / transparent */
  value: string
}

export interface ColorPalette {
  colors: PaletteColor[]
}

export function createEmptyColorPalette(): ColorPalette {
  return { colors: [] }
}

export function isValidPaletteColorName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)
}

export function findPaletteColor(
  palette: ColorPalette | undefined,
  name: string | undefined,
): PaletteColor | undefined {
  if (!palette || !name) return undefined
  const key = name.trim()
  if (!key) return undefined
  return palette.colors.find((item) => item.name === key)
}

/** 画布预览：key → 实际色值；非 key 原样返回 */
export function resolvePaletteColorValue(
  value: string | undefined,
  palette: ColorPalette | undefined,
): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return trimmed
  const found = findPaletteColor(palette, trimmed)
  return found ? found.value : trimmed
}

export function paletteCssVarName(name: string): string {
  return `--${name}`
}

export function paletteCssVarRef(name: string): string {
  return `var(${paletteCssVarName(name)})`
}

/**
 * 按画板颜色 key 取色值。
 * - 命中画板：返回配置的 value
 * - 未命中：原样返回 key（兼容直接写 #hex）
 */
export function resolveColorKey(
  palette: ColorPalette | undefined | null,
  key: unknown,
): string {
  const raw = String(key ?? '').trim()
  if (!raw) return ''
  const found = findPaletteColor(palette ?? undefined, raw)
  return found ? found.value : raw
}

/** 运行时 `$color.xxx`：已知名为画板色值；未知名原样返回 */
export function buildDollarColor(
  palette?: ColorPalette | null,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of palette?.colors ?? []) {
    const name = c.name.trim()
    if (!name || !isValidPaletteColorName(name)) continue
    map[name] = c.value
  }
  return new Proxy(map, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return target[prop]
      }
      // 允许 $color['#fff'] / 未知 key 原样返回
      return prop
    },
  })
}

function isJsIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

/** Monaco：`$color.xxx` ambient；属性名为画板颜色 key，便于 `.` 后补全 */
export function buildDollarColorAmbientDeclaration(
  palette?: ColorPalette | null,
): string {
  const keys = (palette?.colors ?? [])
    .map((c) => c.name.trim())
    .filter((n) => isValidPaletteColorName(n))
  const unique = [...new Set(keys)]
  if (!unique.length) {
    return [
      '/** 画板颜色（当前暂无颜色）：$color.xxx */',
      'declare const $color: Record<string, string>;',
    ].join('\n')
  }
  const fields = unique
    .map((k) => {
      const def = findPaletteColor(palette ?? undefined, k)
      const remark = def?.description?.trim() || def?.value || ''
      const safeRemark = remark.replace(/\*\//g, '* /')
      const doc = safeRemark ? `  /** ${safeRemark} */\n` : ''
      const prop = isJsIdent(k) ? k : JSON.stringify(k)
      return `${doc}  readonly ${prop}: string;`
    })
    .join('\n')
  return [
    '/** 画板颜色：$color.primary 等 */',
    'declare const $color: {',
    fields,
    '};',
  ].join('\n')
}
