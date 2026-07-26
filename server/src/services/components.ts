import { access, mkdir, readdir, readFile, writeFile, stat, rm, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { ProjectError } from './project.js'
import { createDefaultPageData, type PageData } from '../types/page-data.js'
import {
  createDefaultComponentConfig,
  normalizeComponentConfig,
  type ComponentConfig,
  type ComponentSummary,
} from '../types/component.js'

const COMPONENTS_DIR = 'components'
const CONFIG_FILE = 'config.json'
const XML_FILE = 'index.xml'
const DATA_FILE = 'data.json'

export interface ComponentDetail {
  id: string
  path: string
  config: ComponentConfig
  xml: string
  data: PageData
}

function normalizeProjectPath(input: string): string {
  if (!input || typeof input !== 'string' || !input.trim()) {
    throw new ProjectError('请提供项目路径')
  }
  return path.resolve(input.trim())
}

function assertSafeId(idInput: string): string {
  const id = idInput?.trim()
  if (!id) throw new ProjectError('请提供组件 ID')
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new ProjectError('组件 ID 仅支持字母、数字、下划线和短横线')
  }
  return id
}

async function assertProjectDir(projectPath: string): Promise<string> {
  const resolved = normalizeProjectPath(projectPath)
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new ProjectError('项目路径不是文件夹')
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('项目文件夹不存在', 404)
  }
  return resolved
}

function componentsRoot(projectPath: string): string {
  return path.join(projectPath, COMPONENTS_DIR)
}

function componentDir(projectPath: string, id: string): string {
  return path.join(componentsRoot(projectPath), id)
}

async function ensureComponentsDir(projectPath: string): Promise<string> {
  const root = componentsRoot(projectPath)
  await mkdir(root, { recursive: true })
  return root
}

export function createDefaultComponentXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Fragment>
  <LinearLayout
    orientation="vertical"
    width="match_parent"
    height="wrap_content"
    padding="12"
    background="#ffffff">
    <Text
      text="组件内容"
      textSize="14"
      textColor="#303133"
      width="wrap_content"
      height="wrap_content" />
  </LinearLayout>
</Fragment>
`
}

async function readComponentConfig(dir: string, fallbackName: string): Promise<ComponentConfig> {
  const configPath = path.join(dir, CONFIG_FILE)
  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return normalizeComponentConfig(parsed, fallbackName)
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError(`无法读取 ${CONFIG_FILE}`, 400)
  }
}

async function readComponentData(dir: string): Promise<PageData> {
  try {
    const raw = await readFile(path.join(dir, DATA_FILE), 'utf-8')
    const parsed = JSON.parse(raw) as PageData
    return {
      fields: Array.isArray(parsed?.fields) ? parsed.fields : [],
    }
  } catch {
    return createDefaultPageData()
  }
}

export async function listComponents(
  projectPathInput: string,
): Promise<ComponentSummary[]> {
  const projectPath = await assertProjectDir(projectPathInput)
  const root = await ensureComponentsDir(projectPath)

  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    throw new ProjectError('无法读取 components 目录', 500)
  }

  const items: ComponentSummary[] = []
  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith('.')) return
      const dir = path.join(root, name)
      try {
        const info = await stat(dir)
        if (!info.isDirectory()) return
        await access(path.join(dir, CONFIG_FILE), constants.R_OK)
        await access(path.join(dir, XML_FILE), constants.R_OK)
        const config = await readComponentConfig(dir, name)
        items.push({
          id: name,
          name: config.name,
          title: config.title || config.name,
          path: dir,
        })
      } catch {
        // skip incomplete
      }
    }),
  )

  return items.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'))
}

export async function getComponent(
  projectPathInput: string,
  idInput: string,
): Promise<ComponentDetail> {
  const projectPath = await assertProjectDir(projectPathInput)
  const id = assertSafeId(idInput)
  const dir = componentDir(projectPath, id)

  try {
    const info = await stat(dir)
    if (!info.isDirectory()) throw new ProjectError('组件不存在', 404)
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('组件不存在', 404)
  }

  const config = await readComponentConfig(dir, id)
  let xml: string
  try {
    xml = await readFile(path.join(dir, XML_FILE), 'utf-8')
  } catch {
    throw new ProjectError(`无法读取 ${XML_FILE}`, 500)
  }

  return {
    id,
    path: dir,
    config,
    xml,
    data: await readComponentData(dir),
  }
}

export async function createComponent(options: {
  projectPath: string
  id: string
  name: string
  title?: string
}): Promise<ComponentDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const id = assertSafeId(options.id)
  if (!options.name?.trim()) throw new ProjectError('请填写组件名称')

  await ensureComponentsDir(projectPath)
  const dir = componentDir(projectPath, id)

  try {
    await access(dir, constants.F_OK)
    throw new ProjectError(`组件 ${id} 已存在`)
  } catch (err) {
    if (err instanceof ProjectError) throw err
  }

  try {
    await mkdir(dir, { recursive: true })
  } catch {
    throw new ProjectError('无法创建组件目录', 500)
  }

  const config = createDefaultComponentConfig(options.name.trim())
  if (options.title?.trim()) config.title = options.title.trim()
  const xml = createDefaultComponentXml()

  try {
    await writeFile(path.join(dir, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
    await writeFile(path.join(dir, XML_FILE), xml, 'utf-8')
    await writeFile(
      path.join(dir, DATA_FILE),
      `${JSON.stringify(createDefaultPageData(), null, 2)}\n`,
      'utf-8',
    )
    await mkdir(path.join(dir, 'function'), { recursive: true })
  } catch {
    throw new ProjectError('无法写入组件文件', 500)
  }

  return {
    id,
    path: dir,
    config,
    xml,
    data: createDefaultPageData(),
  }
}

export async function saveComponentConfig(options: {
  projectPath: string
  id: string
  config: ComponentConfig
}): Promise<ComponentDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const id = assertSafeId(options.id)
  const dir = componentDir(projectPath, id)
  const config = normalizeComponentConfig(options.config, id)
  if (!config.name.trim()) throw new ProjectError('请填写组件名称')

  try {
    await writeFile(path.join(dir, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  } catch {
    throw new ProjectError(`无法写入 ${CONFIG_FILE}`, 500)
  }
  return getComponent(projectPath, id)
}

export async function saveComponentXml(options: {
  projectPath: string
  id: string
  xml: string
}): Promise<ComponentDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const id = assertSafeId(options.id)
  const dir = componentDir(projectPath, id)
  if (typeof options.xml !== 'string') throw new ProjectError('请提供组件 XML 内容')

  try {
    await writeFile(path.join(dir, XML_FILE), options.xml, 'utf-8')
  } catch {
    throw new ProjectError(`无法写入 ${XML_FILE}`, 500)
  }
  return getComponent(projectPath, id)
}

export async function saveComponentData(options: {
  projectPath: string
  id: string
  data: PageData
}): Promise<ComponentDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const id = assertSafeId(options.id)
  const dir = componentDir(projectPath, id)
  const data: PageData = {
    fields: Array.isArray(options.data?.fields) ? options.data.fields : [],
  }

  try {
    await writeFile(path.join(dir, DATA_FILE), `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  } catch {
    throw new ProjectError(`无法写入 ${DATA_FILE}`, 500)
  }
  return getComponent(projectPath, id)
}

export async function deleteComponent(options: {
  projectPath: string
  componentId: string
}): Promise<{ ok: boolean }> {
  const projectPath = await assertProjectDir(options.projectPath)
  const componentId = assertSafeId(options.componentId)
  const dir = componentDir(projectPath, componentId)

  try {
    const info = await stat(dir)
    if (!info.isDirectory()) throw new ProjectError('组件不存在', 404)
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('组件不存在', 404)
  }

  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    throw new ProjectError('删除组件失败', 500)
  }

  return { ok: true }
}

async function rewriteComponentIdInXmlFiles(
  projectPath: string,
  oldId: string,
  newId: string,
): Promise<number> {
  const roots = [
    path.join(projectPath, 'pages'),
    path.join(projectPath, COMPONENTS_DIR),
  ]
  let updated = 0
  const patterns = [
    `componentId="${oldId}"`,
    `componentId='${oldId}'`,
  ]
  const replacements = [
    `componentId="${newId}"`,
    `componentId='${newId}'`,
  ]

  for (const root of roots) {
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const xmlPath = path.join(root, name, XML_FILE)
      try {
        const raw = await readFile(xmlPath, 'utf-8')
        let next = raw
        for (let i = 0; i < patterns.length; i += 1) {
          if (next.includes(patterns[i])) {
            next = next.split(patterns[i]).join(replacements[i])
          }
        }
        if (next !== raw) {
          await writeFile(xmlPath, next, 'utf-8')
          updated += 1
        }
      } catch {
        // skip missing / unreadable
      }
    }
  }
  return updated
}

export async function renameComponent(options: {
  projectPath: string
  componentId: string
  newId: string
  name?: string
}): Promise<ComponentDetail & { refsUpdated: number }> {
  const projectPath = await assertProjectDir(options.projectPath)
  const oldId = assertSafeId(options.componentId)
  const newId = assertSafeId(options.newId)
  const sourceDir = componentDir(projectPath, oldId)
  const targetDir = componentDir(projectPath, newId)

  try {
    const info = await stat(sourceDir)
    if (!info.isDirectory()) throw new ProjectError('组件不存在', 404)
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('组件不存在', 404)
  }

  const idChanged = oldId !== newId
  if (idChanged) {
    try {
      await access(targetDir, constants.F_OK)
      throw new ProjectError(`组件 ${newId} 已存在`)
    } catch (err) {
      if (err instanceof ProjectError) throw err
    }
    try {
      await rename(sourceDir, targetDir)
    } catch {
      throw new ProjectError('重命名组件目录失败', 500)
    }
  }

  const detail = await getComponent(projectPath, newId)
  const name = options.name?.trim()
  let config = detail.config
  if (name && name !== config.name) {
    config = {
      ...config,
      name,
      title:
        config.title === config.name || !config.title ? name : config.title,
    }
    await writeFile(
      path.join(componentDir(projectPath, newId), CONFIG_FILE),
      `${JSON.stringify(config, null, 2)}\n`,
      'utf-8',
    )
  }

  const refsUpdated = idChanged
    ? await rewriteComponentIdInXmlFiles(projectPath, oldId, newId)
    : 0

  const result = await getComponent(projectPath, newId)
  return { ...result, refsUpdated }
}
