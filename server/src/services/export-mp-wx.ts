import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openProject, ProjectError } from './project.js'
import { listPages, getPage } from './pages.js'
import { listComponents, getComponent } from './components.js'
import { listPageMethods } from './functions.js'
import { getLifecycle } from './lifecycle.js'
import { readIconLibrary } from './icons.js'
import {
  readBackendServiceLibrary,
  readServiceControllers,
} from './backend-services.js'
import { parseXml, findRootNode, type XmlNode } from './export-vue3/xml-parser.js'
import { buildIconSvg } from './export-vue3/icon-export.js'
import { scaffoldMpWxFiles } from './export-mp-wx/scaffold.js'
import {
  generatePageFiles,
  generateComponentFiles,
} from './export-mp-wx/wx-codegen.js'
import {
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

async function preloadApiResolver(
  projectPath: string,
): Promise<(raw: string) => MpApiBinding | null> {
  const library = await readBackendServiceLibrary(projectPath)
  const byService = new Map<
    string,
    Awaited<ReturnType<typeof readServiceControllers>>
  >()

  await Promise.all(
    library.services.map(async (svc) => {
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
    const controllers = byService.get(ids.serviceId) ?? []
    const ctrl = controllers.find((c) => c.id === ids.controllerId)
    const api = ctrl?.apis.find((a) => a.id === ids.apiId)
    if (!ctrl || !api) {
      return {
        ...ids,
        method: 'GET',
        path: '',
      }
    }
    return {
      ...ids,
      method: (api.method || 'GET').toUpperCase(),
      path: joinControllerApiPath(ctrl.path || '', api.path || ''),
    }
  }
}

export async function exportMpWxProject(
  projectPathInput: string,
): Promise<ExportMpWxResult> {
  if (!projectPathInput?.trim()) {
    throw new ProjectError('请提供 projectPath')
  }

  const { path: projectPath, config } = await openProject(projectPathInput)
  if (!config.wechatAppId?.trim()) {
    throw new ProjectError('未配置微信小程序 AppID，请先在设置中填写', 400)
  }

  const outputPath = path.join(projectPath, OUTPUT_DIR)

  try {
    await rm(outputPath, { recursive: true, force: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw err
  }
  await mkdir(outputPath, { recursive: true })

  const pageSummaries = await listPages(projectPath)
  const componentSummaries = await listComponents(projectPath)

  const pageDetails = await Promise.all(
    pageSummaries.map((summary) => getPage(projectPath, summary.id)),
  )
  const componentDetails = await Promise.all(
    componentSummaries.map((summary) => getComponent(projectPath, summary.id)),
  )
  const iconLibrary = await readIconLibrary(projectPath)
  const resolveApi = await preloadApiResolver(projectPath)

  const componentConfigs = new Map<string, ComponentConfig>()
  const componentRoots = new Map<string, XmlNode>()
  for (const c of componentDetails) {
    componentConfigs.set(c.id, c.config)
    const rootNodes = migrateLegacyMaskNodes(parseXml(c.xml))
    const root = findRootNode(rootNodes)
    if (root) componentRoots.set(c.id, root)
  }

  const scaffold = scaffoldMpWxFiles({
    config,
    pages: pageSummaries.map((p) => ({ id: p.id, title: p.title })),
    projectPath,
  })
  await writeMany(outputPath, scaffold)

  for (const page of pageDetails) {
    const rootNodes = migrateLegacyMaskNodes(parseXml(page.xml))
    const root = findRootNode(rootNodes)
    const files = generatePageFiles({
      pageId: page.id,
      title: page.config.title || page.config.name || page.id,
      root,
      data: page.data,
      componentConfigs,
      componentRoots,
      resolveApi,
      statusBar: page.config.statusBar,
    })
    const base = `pages/${page.id}/index`
    await writeProjectFile(outputPath, `${base}.wxml`, files.wxml)
    await writeProjectFile(outputPath, `${base}.wxss`, files.wxss)
    await writeProjectFile(outputPath, `${base}.js`, files.js)
    await writeProjectFile(outputPath, `${base}.json`, files.json)
  }

  for (const component of componentDetails) {
    const rootNodes = migrateLegacyMaskNodes(parseXml(component.xml))
    const root = findRootNode(rootNodes)
    const [{ methods }, { lifecycle }] = await Promise.all([
      listPageMethods(projectPath, component.id, 'components'),
      getLifecycle(projectPath, component.id, 'components'),
    ])
    const files = generateComponentFiles({
      componentId: component.id,
      root,
      data: component.data,
      config: component.config,
      methods,
      lifecycle,
      componentConfigs,
      componentRoots,
    })
    const base = `components/${component.id}/index`
    await writeProjectFile(outputPath, `${base}.wxml`, files.wxml)
    await writeProjectFile(outputPath, `${base}.wxss`, files.wxss)
    await writeProjectFile(outputPath, `${base}.js`, files.js)
    await writeProjectFile(outputPath, `${base}.json`, files.json)
  }

  const iconFiles: Record<string, string> = {}
  for (const icon of iconLibrary.icons) {
    iconFiles[`assets/icons/${icon.id}.svg`] = buildIconSvg(icon)
  }
  await writeMany(outputPath, iconFiles)

  return {
    outputPath,
    pages: pageDetails.length,
    components: componentDetails.length,
  }
}
