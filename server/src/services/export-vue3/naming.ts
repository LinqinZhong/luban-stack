/** kebab-case / snake_case / plain → PascalCase */
export function toPascalCase(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function pageIdToViewName(pageId: string): string {
  return `${toPascalCase(pageId)}View`
}

export function pageIdToStoreFile(pageId: string): string {
  return toPascalCase(pageId).charAt(0).toLowerCase() + toPascalCase(pageId).slice(1)
}

export function pageIdToStoreName(pageId: string): string {
  return `use${toPascalCase(pageId)}Store`
}

export function componentIdToFileName(componentId: string): string {
  return toPascalCase(componentId)
}

export function componentIdToVarName(componentId: string): string {
  return toPascalCase(componentId)
}
