export const PALETTE_FILE = 'palette.json'

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

export function createDefaultColorPalette(): ColorPalette {
  return {
    colors: [
      {
        name: 'primary',
        description: '主色',
        value: '#409eff',
      },
      {
        name: 'success',
        description: '成功色',
        value: '#67c23a',
      },
      {
        name: 'warning',
        description: '警告色',
        value: '#e6a23c',
      },
      {
        name: 'danger',
        description: '危险色',
        value: '#f56c6c',
      },
      {
        name: 'text',
        description: '主文字色',
        value: '#303133',
      },
    ],
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isValidPaletteColorName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)
}

export function normalizeColorPalette(input: unknown): ColorPalette {
  if (!isPlainObject(input) || !Array.isArray(input.colors)) {
    return createEmptyColorPalette()
  }

  const seen = new Set<string>()
  const colors: PaletteColor[] = []

  for (const item of input.colors) {
    if (!isPlainObject(item)) continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const description =
      typeof item.description === 'string' ? item.description.trim() : ''
    const value = typeof item.value === 'string' ? item.value.trim() : ''

    if (!name || !isValidPaletteColorName(name) || seen.has(name) || !value) {
      continue
    }
    seen.add(name)
    colors.push({
      name,
      description,
      value,
    })
  }

  return { colors }
}

/** 将调色板 key 转为 CSS 自定义属性名 */
export function paletteCssVarName(name: string): string {
  return `--${name}`
}

/** 构建时引用：var(--name) */
export function paletteCssVarRef(name: string): string {
  return `var(${paletteCssVarName(name)})`
}

/** 生成 CSS 变量块（默认 :root；小程序用 page） */
export function buildPaletteCssVars(
  palette: ColorPalette,
  selector: string = ':root',
): string {
  if (!palette.colors.length) return ''
  const lines = palette.colors.map(
    (c) => `  ${paletteCssVarName(c.name)}: ${c.value};`,
  )
  return `${selector} {\n${lines.join('\n')}\n}\n`
}

/**
 * 小程序 WXS：把调色板 key 转成 CSS var（style）或具体色值（SVG tint 等）。
 */
export function buildPaletteWxs(palette: ColorPalette): string {
  const entries = palette.colors
    .map((c) => `  "${c.name}": ${JSON.stringify(c.value)}`)
    .join(',\n')
  return `var VALUES = {
${entries}
};

function color(v) {
  if (v === undefined || v === null) return v;
  var s = '' + v;
  if (!s) return s;
  if (VALUES[s]) return 'var(--' + s + ')';
  return s;
}

function value(v) {
  if (v === undefined || v === null) return v;
  var s = '' + v;
  if (!s) return s;
  if (VALUES[s]) return VALUES[s];
  if (s.indexOf('var(--') === 0 && s.charAt(s.length - 1) === ')') {
    var name = s.substring(6, s.length - 1);
    if (VALUES[name]) return VALUES[name];
  }
  return s;
}

module.exports = {
  color: color,
  value: value
};
`
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

/**
 * 若 value 是调色板 key，返回 CSS var 引用；否则原样返回。
 */
export function resolvePaletteColorForCss(
  value: string | undefined,
  palette: ColorPalette | undefined,
): string | undefined {
  if (value == null) return value
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'null' || trimmed.includes('{')) return value
  const found = findPaletteColor(palette, trimmed)
  return found ? paletteCssVarRef(found.name) : value
}
