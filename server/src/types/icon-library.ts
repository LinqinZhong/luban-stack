export const ICONS_FILE = 'icons.json'

export interface IconDefinition {
  /** 稳定 id，用于 SVG symbol 与控件引用 */
  id: string
  /** 显示名称 */
  label: string
  viewBox: string
  /** symbol 内部 markup（不含外层 svg），通过 sprite 复用 */
  content: string
}

export interface IconLibrary {
  icons: IconDefinition[]
}

export function createEmptyIconLibrary(): IconLibrary {
  return { icons: [] }
}

export function createDefaultIconLibrary(): IconLibrary {
  return {
    icons: [
      {
        id: 'home',
        label: '首页',
        viewBox: '0 0 24 24',
        content:
          '<path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>',
      },
      {
        id: 'star',
        label: '星标',
        viewBox: '0 0 24 24',
        content:
          '<path fill="currentColor" d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>',
      },
      {
        id: 'heart',
        label: '爱心',
        viewBox: '0 0 24 24',
        content:
          '<path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"/>',
      },
    ],
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isValidIconId(id: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)
}

export function normalizeIconLibrary(input: unknown): IconLibrary {
  if (!isPlainObject(input) || !Array.isArray(input.icons)) {
    return createEmptyIconLibrary()
  }

  const seen = new Set<string>()
  const icons: IconDefinition[] = []

  for (const item of input.icons) {
    if (!isPlainObject(item)) continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const viewBox =
      typeof item.viewBox === 'string' && item.viewBox.trim()
        ? item.viewBox.trim()
        : '0 0 24 24'
    const content = typeof item.content === 'string' ? item.content.trim() : ''

    if (!id || !isValidIconId(id) || seen.has(id) || !content) continue
    seen.add(id)
    icons.push({
      id,
      label: label || id,
      viewBox,
      content,
    })
  }

  return { icons }
}
