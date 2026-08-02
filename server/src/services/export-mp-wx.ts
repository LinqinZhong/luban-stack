import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openProject, ProjectError } from './project.js'
import { listPages, getPage } from './pages.js'
import { listComponents, getComponent } from './components.js'
import { listPageMethods } from './functions.js'
import { getLifecycle } from './lifecycle.js'
import { readIconLibrary } from './icons.js'
import { readColorPalette } from './palette.js'
import {
  buildPaletteCssVars,
  buildPaletteWxs,
} from '../types/color-palette.js'
import { readOssLibrary } from './oss.js'
import {
  readBackendServiceLibrary,
  readServiceControllers,
} from './backend-services.js'
import { parseXml, findRootNode, type XmlNode } from './export-vue3/xml-parser.js'
import { localIconAssetFiles } from './export-vue3/icon-export.js'
import { emptyDirPreserveDeps } from './clean-output.js'
import { generateAppIconFiles } from './export-mp-wx/app-icon.js'
import { scaffoldMpWxFiles } from './export-mp-wx/scaffold.js'
import { buildExportApiBaseUrls } from './export-api-base.js'
import {
  generatePageFiles,
  generateComponentFiles,
  ClassRegistry,
  withColorPalette,
} from './export-mp-wx/wx-codegen.js'
import {
  apiRefKey,
  generateApisFiles,
  joinControllerApiPath,
  parseApiPropBinding,
  type MpApiBinding,
} from './export-mp-wx/api-runtime.js'
import type { ComponentConfig } from '../types/component.js'

export interface ExportMpWxResult {
  outputPath: string
  pages: number
  components: number
}

const OUTPUT_DIR = path.join('output', 'mp-wx')

async function writeProjectFile(
  baseDir: string,
  relPath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(baseDir, relPath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

async function writeMany(
  baseDir: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(([relPath, content]) =>
      writeProjectFile(baseDir, relPath, content),
    ),
  )
}

function gravityToLayoutAttrs(gravity: string): Record<string, string> {
  const g = gravity.trim() || 'center'
  const attrs: Record<string, string> = {}
  if (g === 'center') {
    attrs.layout_centerInParent = 'true'
    return attrs
  }
  if (g.includes('center_horizontal')) attrs.layout_centerHorizontal = 'true'
  if (g.includes('center_vertical')) attrs.layout_centerVertical = 'true'
  if (g.includes('left') || g.includes('start')) attrs.layout_alignParentLeft = 'true'
  if (g.includes('right') || g.includes('end')) attrs.layout_alignParentRight = 'true'
  if (g.includes('top') && !g.includes('center')) attrs.layout_alignParentTop = 'true'
  if (g.includes('bottom')) attrs.layout_alignParentBottom = 'true'
  if (!Object.keys(attrs).length) attrs.layout_centerInParent = 'true'
  return attrs
}

function migrateMaskNode(node: XmlNode): XmlNode {
  const children = node.children.map(migrateMaskNode)
  if (node.tag !== 'Mask') {
    return { ...node, children }
  }
  const gravity = node.attrs.gravity?.trim() || 'center'
  const attrs = { ...node.attrs }
  delete attrs.gravity
  const migratedChildren = children.map((child) => {
    if (child.tag === '#text') return child
    const hasLayout = Object.keys(child.attrs).some((k) => k.startsWith('layout_'))
    if (hasLayout) return child
    return {
      ...child,
      attrs: { ...child.attrs, ...gravityToLayoutAttrs(gravity) },
    }
  })
  return { tag: 'Modal', attrs, children: migratedChildren }
}

function migrateLegacyMaskNodes(nodes: XmlNode[]): XmlNode[] {
  return nodes.map(migrateMaskNode)
}

export async function preloadApiResolver(
  projectPath: string,
): Promise<(raw: string) => MpApiBinding | null> {
  const library = await readBackendServiceLibrary(projectPath)
  const byService = new Map<
    string,
    Awaited<ReturnType<typeof readServiceControllers>>
  >()
  const serviceNameById = new Map<string, string>()

  await Promise.all(
    library.services.map(async (svc) => {
      if (svc.name?.trim()) serviceNameById.set(svc.id, svc.name.trim())
      try {
        const controllers = await readServiceControllers(projectPath, svc.id)
        byService.set(svc.id, controllers)
      } catch {
        byService.set(svc.id, [])
      }
    }),
  )

  return (raw: string): MpApiBinding | null => {
    const ids = parseApiPropBinding(raw)
    if (!ids) return null
    const serviceName = serviceNameById.get(ids.serviceId)
    const controllers = byService.get(ids.serviceId) ?? []
    const ctrl = controllers.find((c) => c.id === ids.controllerId)
    const api = ctrl?.apis.find((a) => a.id === ids.apiId)
    if (!ctrl || !api) {
      return {
        ...ids,
        ...(serviceName ? { serviceName } : {}),
        method: 'GET',
        path: '',
      }
    }
    return {
      ...ids,
      ...(serviceName ? { serviceName } : {}),
      controllerName: (ctrl.name || '').trim() || undefined,
      apiName: (api.name || '').trim() || undefined,
      remark: (api.remark || '').trim() || undefined,
      inputRemarks: (api.inputs ?? [])
        .map((inp) => ({
          name: (inp.varName || '').trim(),
          remark: (inp.remark || '').trim(),
        }))
        .filter((r) => r.name && r.remark),
      method: (api.method || 'GET').toUpperCase(),
      path: joinControllerApiPath(ctrl.path || '', api.path || ''),
    }
  }
}

export interface ExportMpWxOptions {
  outputPath?: string
  pageIds?: string[]
  /** 覆盖项目入口页 */
  entryPage?: string
  wechatAppId?: string
  apiBaseUrls?: Record<string, string>
}

export async function exportMpWxProject(
  projectPathInput: string,
  options: ExportMpWxOptions = {},
): Promise<ExportMpWxResult> {
  if (!projectPathInput?.trim()) {
    throw new ProjectError('请提供 projectPath')
  }

  const { path: projectPath, config } = await openProject(projectPathInput)
  const wechatAppId =
    options.wechatAppId?.trim() || config.wechatAppId?.trim() || ''
  if (!wechatAppId) {
    throw new ProjectError('未配置微信小程序 AppID', 400)
  }

  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(projectPath, OUTPUT_DIR)

  try {
    await emptyDirPreserveDeps(outputPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw err
  }
  await mkdir(outputPath, { recursive: true })

  const pageSummariesAll = await listPages(projectPath)
  const pageIdFilter = options.pageIds?.map((id) => id.trim()).filter(Boolean)
  const pageSummaries = pageIdFilter?.length
    ? pageSummariesAll.filter((p) => pageIdFilter.includes(p.id))
    : pageSummariesAll
  if (!pageSummaries.length) {
    throw new ProjectError('没有可导出的页面', 400)
  }

  const componentSummaries = await listComponents(projectPath)

  const pageDetails = await Promise.all(
    pageSummaries.map((summary) => getPage(projectPath, summary.id)),
  )
  const componentDetails = await Promise.all(
    componentSummaries.map((summary) => getComponent(projectPath, summary.id)),
  )
  const iconLibrary = await readIconLibrary(projectPath)
  const colorPalette = await readColorPalette(projectPath)
  const ossLibrary = await readOssLibrary(projectPath)
  const resolveApi = await preloadApiResolver(projectPath)
  const serviceLibrary = await readBackendServiceLibrary(projectPath)
  const apiBaseUrls = buildExportApiBaseUrls(
    config,
    serviceLibrary.services,
    options.apiBaseUrls,
  )

  const componentConfigs = new Map<string, ComponentConfig>()
  const componentRoots = new Map<string, XmlNode>()
  for (const c of componentDetails) {
    componentConfigs.set(c.id, c.config)
    const rootNodes = migrateLegacyMaskNodes(parseXml(c.xml))
    const root = findRootNode(rootNodes)
    if (root) componentRoots.set(c.id, root)
  }

  const designWidth =
    config.canvas?.width > 0 ? config.canvas.width : 375
  const classRegistry = new ClassRegistry()

  const scaffold = scaffoldMpWxFiles({
    config: {
      ...config,
      entryPage:
        options.entryPage?.trim() ||
        config.entryPage ||
        pageSummaries[0]?.id,
    },
    pages: pageSummaries.map((p) => ({ id: p.id, title: p.title })),
    apiBaseUrls,
    wechatAppId,
  })
  await writeMany(outputPath, scaffold)

  const usedApisByKey = new Map<string, MpApiBinding>()

  for (const page of pageDetails) {
    const rootNodes = migrateLegacyMaskNodes(parseXml(page.xml))
    const root = findRootNode(rootNodes)
    const files = withColorPalette(colorPalette, () =>
      generatePageFiles({
        pageId: page.id,
        title: page.config.title || page.config.name || page.id,
        root,
        data: page.data,
        componentConfigs,
        componentRoots,
        resolveApi,
        statusBar: page.config.statusBar,
        designWidth,
        classRegistry,
      }),
    )
    for (const b of files.usedApis) {
      if (!b.path?.trim()) continue
      usedApisByKey.set(apiRefKey(b), b)
    }
    const base = `pages/${page.id}/index`
    await writeProjectFile(outputPath, `${base}.wxml`, files.wxml)
    await writeProjectFile(outputPath, `${base}.wxss`, files.wxss)
    await writeProjectFile(outputPath, `${base}.js`, files.js)
    await writeProjectFile(outputPath, `${base}.json`, files.json)
  }

  await writeMany(outputPath, generateApisFiles([...usedApisByKey.values()]))

  for (const component of componentDetails) {
    const rootNodes = migrateLegacyMaskNodes(parseXml(component.xml))
    const root = findRootNode(rootNodes)
    const [{ methods }, { lifecycle }] = await Promise.all([
      listPageMethods(projectPath, component.id, 'components'),
      getLifecycle(projectPath, component.id, 'components'),
    ])
    const files = withColorPalette(colorPalette, () =>
      generateComponentFiles({
        componentId: component.id,
        root,
        data: component.data,
        config: component.config,
        methods,
        lifecycle,
        componentConfigs,
        componentRoots,
        designWidth,
        classRegistry,
      }),
    )
    const base = `components/${component.id}/index`
    await writeProjectFile(outputPath, `${base}.wxml`, files.wxml)
    await writeProjectFile(outputPath, `${base}.wxss`, files.wxss)
    await writeProjectFile(outputPath, `${base}.js`, files.js)
    await writeProjectFile(outputPath, `${base}.json`, files.json)
  }

  // 工具类写入共享文件：组件 @import；app.wxss 须把 @import 放在最前
  const utilities =
    classRegistry.toWxss() ||
    '/* Luban utilities — none generated */\n'
  await writeProjectFile(outputPath, 'styles/utilities.wxss', utilities)
  // 绑定色值（如 background="{{props.background}}"）经 WXS 把 key 转成 var(--key)
  await writeProjectFile(
    outputPath,
    'utils/palette.wxs',
    buildPaletteWxs(colorPalette),
  )
  await writeProjectFile(
    outputPath,
    'utils/util.wxs',
    `/** WXML 表达式辅助：Number/String/Boolean/Array.isArray 等须走 WXS */
function n(v) {
  return +v;
}
function s(v) {
  if (v === undefined || v === null) return '';
  return '' + v;
}
function b(v) {
  return !!v;
}
function isArray(v) {
  return v && typeof v === 'object' && typeof v.length === 'number' && typeof v.splice === 'function';
}
module.exports = {
  n: n,
  s: s,
  b: b,
  isArray: isArray
};
`,
  )
  // 小程序自定义属性挂在 page 上（:root 兼容性差）
  const paletteCss = buildPaletteCssVars(colorPalette, 'page')
  const existing = await readFile(path.join(outputPath, 'app.wxss'), 'utf-8')
  await writeProjectFile(
    outputPath,
    'app.wxss',
    `@import "./styles/utilities.wxss";\n\n${paletteCss}${existing.trim()}\n`,
  )

  const iconFiles: Record<string, string> = {
    ...generateAppIconFiles(iconLibrary, ossLibrary, colorPalette),
    ...localIconAssetFiles(iconLibrary, 'assets/icons'),
  }
  await writeMany(outputPath, iconFiles)

  return {
    outputPath,
    pages: pageDetails.length,
    components: componentDetails.length,
  }
}
