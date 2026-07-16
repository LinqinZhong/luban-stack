import type { IconDefinition, IconLibrary } from '../../types/icon-library.js'

export function buildIconSvg(icon: Pick<IconDefinition, 'viewBox' | 'content'>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}">\n${icon.content}\n</svg>\n`
}

export function iconAssetFiles(library: IconLibrary): Record<string, string> {
  const files: Record<string, string> = {}
  for (const icon of library.icons) {
    files[`src/assets/icons/${icon.id}.svg`] = buildIconSvg(icon)
  }
  return files
}
