import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openProject, ProjectError } from './project.js'
import { listPages, getPage } from './pages.js'
import { listComponents, getComponent } from './components.js'
import { readIconLibrary } from './icons.js'
import type { ComponentConfig } from '../types/component.js'
import type { DataField } from '../types/page-data.js'
import { parseXml, findRootNode, type XmlNode } from './export-vue3/xml-parser.js'
import { scaffoldFiles } from './export-vue3/scaffold.js'
import { generateStoreFileName, generateStoreSource } from './export-vue3/store-codegen.js'
import {
  generateViewSfc,
  generateComponentSfc,
  pageIdToViewName,
  type PageRefField,
} from './export-vue3/vue-codegen.js'
import { componentIdToFileName } from './export-vue3/naming.js'
import { iconAssetFiles } from './export-vue3/icon-export.js'

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
    if (!node || node.tag !== 'Component') continue

    const componentId = node.attrs.componentId?.trim()
    if (!componentId) continue

    const config = componentConfigs.get(componentId)
    refs.push({
      name,
      nodePath,
      componentId,
      exposedMethods: (config?.exposedMethods ?? []).filter(Boolean),
    })
  }
  return refs
}

export async function exportVue3Project(projectPathInput: string): Promise<ExportVue3Result> {
  if (!projectPathInput?.trim()) {
    throw new ProjectError('请提供 projectPath')
  }

  const { path: projectPath, config } = await openProject(projectPathInput)
  const outputPath = path.join(projectPath, OUTPUT_DIR)

  try {
    await rm(outputPath, { recursive: true, force: true })
  } catch (err) {
    // 开发服务器占用 output 目录时无法整目录删除，改为保留并覆盖写入
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw err
  }
  await mkdir(outputPath, { recursive: true })

  const pageSummaries = await listPages(projectPath)
  const componentSummaries = await listComponents(projectPath)

  const componentConfigs = new Map<string, ComponentConfig>()
  const componentRoots = new Map<string, XmlNode>()
  const componentDetails = await Promise.all(
    componentSummaries.map(async (summary) => {
      const detail = await getComponent(projectPath, summary.id)
      componentConfigs.set(summary.id, detail.config)
      const roots = parseXml(detail.xml)
      const root = findRootNode(roots)
      if (root) componentRoots.set(summary.id, root)
      return detail
    }),
  )

  const pageDetails = await Promise.all(
    pageSummaries.map((summary) => getPage(projectPath, summary.id)),
  )

  const iconLibrary = await readIconLibrary(projectPath)

  const scaffold = scaffoldFiles({
    projectName: config.name,
    config,
    pages: pageSummaries.map((p) => ({ id: p.id, title: p.title })),
    componentIds: componentSummaries.map((c) => c.id),
  })
  await writeMany(outputPath, scaffold)

  for (const page of pageDetails) {
    const rootNodes = parseXml(page.xml)
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
    })
    await writeProjectFile(
      outputPath,
      `src/views/${pageIdToViewName(page.id)}.vue`,
      sfc,
    )
  }

  for (const component of componentDetails) {
    if (component.data.fields.some((f) => f.type !== 'ref')) {
      const storeFile = `src/stores/${generateStoreFileName(component.id)}`
      await writeProjectFile(
        outputPath,
        storeFile,
        generateStoreSource(component.id, component.data.fields),
      )
    }

    const rootNodes = parseXml(component.xml)
    const sfc = generateComponentSfc({
      componentId: component.id,
      config: component.config,
      xml: component.xml,
      data: component.data,
      componentConfigs,
      componentRoots,
      rootNodes,
    })
    await writeProjectFile(
      outputPath,
      `src/components/${componentIdToFileName(component.id)}.vue`,
      sfc,
    )
  }

  await writeMany(outputPath, iconAssetFiles(iconLibrary))

  return {
    outputPath,
    pages: pageDetails.length,
    components: componentDetails.length,
  }
}
