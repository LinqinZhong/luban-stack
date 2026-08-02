import type { OssBindingConfig } from './page-data'

export interface IconDefinition {
  id: string
  label: string
  viewBox: string
  content: string
  /** 绑定到对象存储时同步上传/删除 */
  ossBinding?: OssBindingConfig
}

export interface IconLibrary {
  icons: IconDefinition[]
}

export const ICON_SYMBOL_PREFIX = 'luban-icon-'

export function iconSymbolId(iconId: string): string {
  return `${ICON_SYMBOL_PREFIX}${iconId}`
}

export function createEmptyIconLibrary(): IconLibrary {
  return { icons: [] }
}

export function isValidIconId(id: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)
}

/**
 * 从完整 <svg>…</svg> 或内部 markup 解析出 viewBox + content，便于入库复用。
 */
export function parseSvgSource(raw: string): { viewBox: string; content: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const svgMatch = trimmed.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>/i)
  if (svgMatch) {
    const attrs = svgMatch[1]
    const inner = svgMatch[2].trim()
    if (!inner) return null
    const viewBoxMatch = attrs.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)
    const widthMatch = attrs.match(/\bwidth\s*=\s*["']([^"']+)["']/i)
    const heightMatch = attrs.match(/\bheight\s*=\s*["']([^"']+)["']/i)
    let viewBox = viewBoxMatch?.[1]?.trim() || ''
    if (!viewBox && widthMatch && heightMatch) {
      const w = widthMatch[1].replace(/px$/i, '')
      const h = heightMatch[1].replace(/px$/i, '')
      if (Number.isFinite(Number(w)) && Number.isFinite(Number(h))) {
        viewBox = `0 0 ${w} ${h}`
      }
    }
    return {
      viewBox: viewBox || '0 0 24 24',
      content: inner,
    }
  }

  return {
    viewBox: '0 0 24 24',
    content: trimmed,
  }
}

export function findIcon(
  library: IconLibrary | undefined,
  iconId: string | undefined,
): IconDefinition | undefined {
  if (!library || !iconId) return undefined
  return library.icons.find((item) => item.id === iconId)
}
