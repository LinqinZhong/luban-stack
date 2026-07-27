import type { IconDefinition, IconLibrary } from '../../types/icon-library.js'
import type { OssLibrary } from '../../types/oss.js'

export function buildIconSvg(icon: Pick<IconDefinition, 'viewBox' | 'content'>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}">\n${icon.content}\n</svg>\n`
}

export function iconRemoteUrl(icon: IconDefinition): string {
  return icon.ossBinding?.url?.trim() || ''
}

export function isRemoteIcon(icon: IconDefinition): boolean {
  return Boolean(iconRemoteUrl(icon))
}

export interface IconRemoteBinding {
  connectionId: string
  bucketName: string
  objectKey: string
  /** 公有桶可直接用；私有桶仅作标识 */
  url: string
  access: 'public' | 'private'
}

function bucketAccessMap(ossLibrary: OssLibrary | null | undefined): Map<string, 'public' | 'private'> {
  const map = new Map<string, 'public' | 'private'>()
  for (const conn of ossLibrary?.connections ?? []) {
    for (const b of conn.buckets ?? []) {
      map.set(`${conn.id}::${b.name}`, b.access === 'public' ? 'public' : 'private')
    }
  }
  return map
}

export function resolveIconRemoteBinding(
  icon: IconDefinition,
  ossLibrary?: OssLibrary | null,
): IconRemoteBinding | null {
  const binding = icon.ossBinding
  const url = binding?.url?.trim() || ''
  if (!binding || !url) return null
  const connectionId = binding.connectionId?.trim() || ''
  const bucketName = binding.bucketName?.trim() || ''
  const objectKey = binding.objectKey?.trim() || ''
  const accessMap = bucketAccessMap(ossLibrary)
  const access =
    connectionId && bucketName
      ? accessMap.get(`${connectionId}::${bucketName}`) || 'private'
      : 'private'
  return {
    connectionId,
    bucketName,
    objectKey,
    url,
    access,
  }
}

/** 仅本地图标（无外链）写入产物；有外链的不打包 SVG */
export function localIconAssetFiles(
  library: IconLibrary,
  pathPrefix = 'src/assets/icons',
): Record<string, string> {
  const files: Record<string, string> = {}
  for (const icon of library.icons) {
    if (isRemoteIcon(icon)) continue
    files[`${pathPrefix}/${icon.id}.svg`] = buildIconSvg(icon)
  }
  return files
}

/** 公有外链：id → url；私有：id → binding（运行时签名） */
export function iconRemoteExportMaps(
  library: IconLibrary,
  ossLibrary?: OssLibrary | null,
): {
  publicUrls: Record<string, string>
  privateBindings: Record<string, IconRemoteBinding>
} {
  const publicUrls: Record<string, string> = {}
  const privateBindings: Record<string, IconRemoteBinding> = {}
  for (const icon of library.icons) {
    const remote = resolveIconRemoteBinding(icon, ossLibrary)
    if (!remote) continue
    if (remote.access === 'public') {
      publicUrls[icon.id] = remote.url
    } else {
      privateBindings[icon.id] = remote
    }
  }
  return { publicUrls, privateBindings }
}

export function iconRemoteUrlsModule(
  library: IconLibrary,
  ossLibrary?: OssLibrary | null,
  filePath = 'src/assets/icon-remotes.ts',
): Record<string, string> {
  const { publicUrls, privateBindings } = iconRemoteExportMaps(library, ossLibrary)
  return {
    [filePath]: `/** 已绑定 OSS 的图标：不打包 SVG；公有直链 / 私有运行时签名 */
export const ICON_REMOTE_URLS: Record<string, string> = ${JSON.stringify(publicUrls, null, 2)}

export interface IconRemoteBinding {
  connectionId: string
  bucketName: string
  objectKey: string
  url: string
  access: 'public' | 'private'
}

export const ICON_PRIVATE_BINDINGS: Record<string, IconRemoteBinding> = ${JSON.stringify(privateBindings, null, 2)}
`,
  }
}

/** H5：本地 SVG 资源 + 外链/私有绑定映射 */
export function iconExportFiles(
  library: IconLibrary,
  options?: {
    assetPrefix?: string
    remotesPath?: string
    ossLibrary?: OssLibrary | null
    /** serviceName / default → baseUrl */
    apiBaseUrls?: Record<string, string>
  },
): Record<string, string> {
  const files = {
    ...localIconAssetFiles(library, options?.assetPrefix ?? 'src/assets/icons'),
    ...iconRemoteUrlsModule(
      library,
      options?.ossLibrary,
      options?.remotesPath ?? 'src/assets/icon-remotes.ts',
    ),
  }
  const apiBaseUrls = options?.apiBaseUrls
  if (apiBaseUrls && Object.keys(apiBaseUrls).length) {
    const defaultBase =
      apiBaseUrls.default ||
      apiBaseUrls.oss ||
      Object.values(apiBaseUrls).find((v) => typeof v === 'string' && v.trim()) ||
      ''
    files['.env.local'] = `VITE_API_BASE_URLS=${JSON.stringify(JSON.stringify(apiBaseUrls))}
VITE_API_BASE=${JSON.stringify(defaultBase)}
`
  }
  return files
}
