import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openProject, ProjectError } from './project.js'
import { listPages, getPage } from './pages.js'
import { listComponents, getComponent } from './components.js'
import { readIconLibrary } from './icons.js'
import { readColorPalette } from './palette.js'
import { readOssLibrary } from './oss.js'
import { emptyDirPreserveDeps } from './clean-output.js'
import type { ComponentConfig } from '../types/component.js'
import type { DataField } from '../types/page-data.js'
import { parseXml, findRootNode, type XmlNode } from './export-vue3/xml-parser.js'
import { scaffoldFiles } from './export-vue3/scaffold.js'
import {
  generateViewSfc,
  generateComponentSfc,
  pageIdToViewName,
  type PageRefField,
} from './export-vue3/vue-codegen.js'
import { componentIdToFileName } from './export-vue3/naming.js'
import { iconExportFiles } from './export-vue3/icon-export.js'
import { buildExportApiBaseUrls } from './export-api-base.js'
import {
  readBackendServiceLibrary,
} from './backend-services.js'
import { preloadApiResolver } from './export-mp-wx.js'

export interface ExportVue3Result {
  outputPath: string
  pages: number
  components: number
}

const OUTPUT_DIR = path.join('output', 'vue3')

async function writeProjectFile(baseDir: string, relPath: string, content: string): Promise<void> {
  const filePath = path.join(baseDir, relPath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

async function writeMany(baseDir: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(([relPath, content]) =>
      writeProjectFile(baseDir, relPath, content),
    ),
  )
}

/** Walk XML tree by path like "0:LinearLayout/1:Component" (与编辑器 findXmlNodeById 一致) */
function resolveNodeByPath(root: XmlNode | null, nodePath: string): XmlNode | null {
  if (!root || !nodePath.trim()) return null
  const segments = nodePath.split('/').filter(Boolean)
  let current: XmlNode = root

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const colon = segment.indexOf(':')
    const index = Number(colon === -1 ? segment : segment.slice(0, colon))
    const tag = colon === -1 ? '' : segment.slice(colon + 1)

    if (!Number.isInteger(index)) return null

    if (i === 0) {
      if (index !== 0 || (tag && current.tag !== tag)) return null
      continue
    }

    const next = current.children[index]
    if (!next || (tag && next.tag !== tag)) return null
    current = next
  }

  return current
}

function collectPageRefFields(
  fields: DataField[],
  root: XmlNode | null,
  componentConfigs: Map<string, ComponentConfig>,
): PageRefField[] {
  const refs: PageRefField[] = []
  for (const field of fields) {
    if (field.type !== 'ref' || typeof field.value !== 'string') continue
    const nodePath = field.value.trim()
    const name = field.name.trim()
    if (!nodePath || !name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue

    const node = resolveNodeByPath(root, nodePath)
    if (!node) continue

    if (node.tag === 'Modal') {
      const modalName = node.attrs.name?.trim() || `modal_${name}`
      refs.push({
        name,
        nodePath,
        kind: 'modal',
        exposedMethods: ['show', 'hide'],
        modalName,
      })
      continue
    }

    if (node.tag !== 'Component') continue

    const componentId = node.attrs.componentId?.trim()
    if (!componentId) continue

    const config = componentConfigs.get(componentId)
    refs.push({
      name,
      nodePath,
      kind: 'component',
      componentId,
      exposedMethods: (config?.exposedMethods ?? []).filter(Boolean),
    })
  }
  return refs
}

/** 导出时兼容旧 Mask → Modal（与编辑器 migrateLegacyMaskToModal 对齐） */
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

export interface ExportVue3Options {
  outputPath?: string
  pageIds?: string[]
  /** 覆盖项目入口页 */
  entryPage?: string
  /** H5 开发端口，写入 .env.local */
  port?: number
  apiBaseUrls?: Record<string, string>
}

export async function exportVue3Project(
  projectPathInput: string,
  options: ExportVue3Options = {},
): Promise<ExportVue3Result> {
  if (!projectPathInput?.trim()) {
    throw new ProjectError('请提供 projectPath')
  }

  const { path: projectPath, config } = await openProject(projectPathInput)
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(projectPath, OUTPUT_DIR)

  try {
    await emptyDirPreserveDeps(outputPath)
  } catch (err) {
    // 开发服务器占用时忽略已处理的锁错误；其它错误上抛
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

  const componentConfigs = new Map<string, ComponentConfig>()
  const componentRoots = new Map<string, XmlNode>()
  const componentDetails = await Promise.all(
    componentSummaries.map(async (summary) => {
      const detail = await getComponent(projectPath, summary.id)
      componentConfigs.set(summary.id, detail.config)
      const roots = migrateLegacyMaskNodes(parseXml(detail.xml))
      const root = findRootNode(roots)
      if (root) componentRoots.set(summary.id, root)
      return detail
    }),
  )

  const pageDetails = await Promise.all(
    pageSummaries.map((summary) => getPage(projectPath, summary.id)),
  )

  const iconLibrary = await readIconLibrary(projectPath)
  const colorPalette = await readColorPalette(projectPath)
  const ossLibrary = await readOssLibrary(projectPath)
  const serviceLibrary = await readBackendServiceLibrary(projectPath)
  const resolveApi = await preloadApiResolver(projectPath)
  const apiBaseUrls = buildExportApiBaseUrls(
    config,
    serviceLibrary.services,
    options.apiBaseUrls,
  )

  const scaffold = scaffoldFiles({
    projectName: config.name,
    config: {
      ...config,
      entryPage:
        options.entryPage?.trim() ||
        config.entryPage ||
        pageSummaries[0]?.id,
    },
    pages: pageSummaries.map((p) => ({ id: p.id, title: p.title })),
    componentIds: componentSummaries.map((c) => c.id),
    colorPalette,
  })
  await writeMany(outputPath, scaffold)

  for (const page of pageDetails) {
    const rootNodes = migrateLegacyMaskNodes(parseXml(page.xml))
    const root = findRootNode(rootNodes)
    const pageRefFields = collectPageRefFields(page.data.fields, root, componentConfigs)

    const sfc = generateViewSfc({
      pageId: page.id,
      xml: page.xml,
      data: page.data,
      componentConfigs,
      componentRoots,
      pageRefFields,
      rootNodes,
      resolveApi,
      colorPalette,
    })
    await writeProjectFile(
      outputPath,
      `src/views/${pageIdToViewName(page.id)}.vue`,
      sfc,
    )
  }

  for (const component of componentDetails) {
    // 组件数据池改为 SFC 内 ref/computed，不再生成 Pinia store

    const rootNodes = migrateLegacyMaskNodes(parseXml(component.xml))
    const sfc = generateComponentSfc({
      componentId: component.id,
      config: component.config,
      xml: component.xml,
      data: component.data,
      componentConfigs,
      componentRoots,
      rootNodes,
      colorPalette,
    })
    await writeProjectFile(
      outputPath,
      `src/components/${componentIdToFileName(component.id)}.vue`,
      sfc,
    )
  }

  const envExtra =
    options.port && options.port > 0
      ? `\nVITE_DEV_PORT=${Math.floor(options.port)}\n`
      : ''
  const iconFiles = iconExportFiles(iconLibrary, {
    ossLibrary,
    apiBaseUrls,
  })
  if (envExtra && iconFiles['.env.local']) {
    iconFiles['.env.local'] += envExtra
  } else if (envExtra) {
    iconFiles['.env.local'] = envExtra.trimStart()
  }
  await writeMany(outputPath, iconFiles)

  return {
    outputPath,
    pages: pageDetails.length,
    components: componentDetails.length,
  }
}
