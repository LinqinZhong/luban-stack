import { access, mkdir, readdir, readFile, writeFile, stat, cp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { ProjectError, setEntryPage, getProjectEntryPage } from './project.js'
import {
  createDefaultPageData,
  normalizeControllerBinding,
  normalizeDataSourceBinding,
  type ArraySubField,
  type DataField,
  type ObjectSubField,
  type PageData,
} from '../types/page-data.js'

const PAGES_DIR = 'pages'
const PAGE_CONFIG_FILE = 'config.json'
const PAGE_XML_FILE = 'index.xml'
const PAGE_DATA_FILE = 'data.json'

export interface PageConfig {
  name: string
  title?: string
  /** 系统状态栏样式（小程序场景生效；字段支持数据池绑定） */
  statusBar?: {
    textStyle?: string
    backgroundColor?: string
    cover?: boolean | string
    /** 是否显示原生标题栏；关闭则导出 navigationStyle: custom */
    navigationBar?: boolean | string
  }
}

export interface PageSummary {
  id: string
  name: string
  title: string
  path: string
  /** 是否为项目入口页 */
  isEntry?: boolean
}

export interface PageDetail {
  id: string
  path: string
  config: PageConfig
  xml: string
  data: PageData
}

function normalizeProjectPath(input: string): string {
  if (!input || typeof input !== 'string' || !input.trim()) {
    throw new ProjectError('请提供项目路径')
  }
  return path.resolve(input.trim())
}

function assertSafePageId(pageId: string): string {
  const id = pageId?.trim()
  if (!id) {
    throw new ProjectError('请提供页面 ID')
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new ProjectError('页面 ID 仅支持字母、数字、下划线和短横线')
  }
  return id
}

async function assertProjectDir(projectPath: string): Promise<string> {
  const resolved = normalizeProjectPath(projectPath)
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) {
      throw new ProjectError('项目路径不是文件夹')
    }
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('项目文件夹不存在', 404)
  }
  return resolved
}

function pagesRoot(projectPath: string): string {
  return path.join(projectPath, PAGES_DIR)
}

function pageDir(projectPath: string, pageId: string): string {
  return path.join(pagesRoot(projectPath), pageId)
}

export function createDefaultPageConfig(name: string): PageConfig {
  return {
    name,
    title: name,
  }
}

export function createDefaultPageXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
  orientation="vertical"
  width="match_parent"
  height="match_parent"
  padding="16">
  <Text
    text="Hello Voider"
    textSize="18"
    textColor="#303133"
    width="wrap_content"
    height="wrap_content" />
  <Button
    text="按钮"
    width="match_parent"
    height="44"
    marginTop="12" />
</LinearLayout>
`
}

async function ensurePagesDir(projectPath: string): Promise<string> {
  const root = pagesRoot(projectPath)
  await mkdir(root, { recursive: true })
  return root
}

async function readPageConfig(dir: string): Promise<PageConfig> {
  const configPath = path.join(dir, PAGE_CONFIG_FILE)
  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PageConfig>
    if (!parsed.name || typeof parsed.name !== 'string') {
      throw new ProjectError(`${PAGE_CONFIG_FILE} 缺少 name 字段`)
    }
    const statusBar = normalizePageStatusBar(
      (parsed as Partial<PageConfig>).statusBar,
    )
    return {
      name: parsed.name,
      title: typeof parsed.title === 'string' ? parsed.title : parsed.name,
      ...(statusBar ? { statusBar } : {}),
    }
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError(`无法读取 ${PAGE_CONFIG_FILE}`, 400)
  }
}

const DATA_FIELD_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'json',
  'array',
  'icon',
  'color',
  'any',
  'ref',
])

function optionalTypeRef(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const id = raw.trim()
  return id || undefined
}

function normalizeGenericArgs(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim()
    if (!name) continue
    out[name] = typeof value === 'string' ? value.trim() : ''
  }
  return Object.keys(out).length ? out : undefined
}

function optionalItemType(raw: unknown): DataField['itemType'] | undefined {
  if (typeof raw !== 'string' || !DATA_FIELD_TYPES.has(raw) || raw === 'ref') {
    return undefined
  }
  return raw as DataField['itemType']
}

function looksLikeBinding(raw: string): boolean {
  return /\{[^{}]+\}/.test(raw)
}

function normalizePageStatusBar(
  raw: PageConfig['statusBar'] | null | undefined,
): PageConfig['statusBar'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined

  const textRaw = typeof raw.textStyle === 'string' ? raw.textStyle.trim() : ''
  let textStyle = 'black'
  if (textRaw) {
    if (looksLikeBinding(textRaw) || textRaw === 'black' || textRaw === 'white') {
      textStyle = textRaw
    } else {
      textStyle = textRaw.toLowerCase() === 'white' ? 'white' : 'black'
    }
  }

  const backgroundColor =
    typeof raw.backgroundColor === 'string' && raw.backgroundColor.trim()
      ? raw.backgroundColor.trim()
      : '#ffffff'

  let cover: boolean | string = false
  if (typeof raw.cover === 'boolean') {
    cover = raw.cover
  } else if (typeof raw.cover === 'string') {
    const c = raw.cover.trim()
    if (!c) cover = false
    else if (looksLikeBinding(c) || c === 'true' || c === 'false') cover = c
    else cover = c === '1' || c.toLowerCase() === 'true'
  }

  let navigationBar: boolean | string = true
  if (typeof raw.navigationBar === 'boolean') {
    navigationBar = raw.navigationBar
  } else if (typeof raw.navigationBar === 'string') {
    const n = raw.navigationBar.trim()
    if (!n) navigationBar = true
    else if (looksLikeBinding(n) || n === 'true' || n === 'false') navigationBar = n
    else navigationBar = n === '1' || n.toLowerCase() === 'true'
  }

  return { textStyle, backgroundColor, cover, navigationBar }
}

function defaultValue(type: DataField['type']) {
  switch (type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'json':
      return {}
    case 'array':
      return []
    case 'any':
    case 'icon':
    case 'color':
    case 'ref':
      return ''
    default:
      return ''
  }
}

function resolveObjectSubFieldValue(item: ObjectSubField): unknown {
  if (item.type === 'array') {
    return (item.arrayFields ?? []).map(resolveArraySubFieldValue)
  }
  if (item.type === 'json') {
    return buildObjectValue(item.objectFields ?? [])
  }
  return item.value ?? defaultValue(item.type)
}

function resolveArraySubFieldValue(item: ArraySubField): unknown {
  if (item.type === 'array') {
    return (item.arrayFields ?? []).map(resolveArraySubFieldValue)
  }
  if (item.type === 'json') {
    return buildObjectValue(item.objectFields ?? [])
  }
  return item.value ?? defaultValue(item.type)
}

function buildObjectValue(items: ObjectSubField[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const item of items) {
    if (!item.name.trim()) continue
    result[item.name.trim()] = resolveObjectSubFieldValue(item)
  }
  return result
}

function buildArrayValue(items: ArraySubField[]): unknown[] {
  return items.map(resolveArraySubFieldValue)
}

function normalizeObjectSubField(raw: unknown): ObjectSubField | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<ObjectSubField>
  if (typeof s.name !== 'string') return null
  if (!s.type || !DATA_FIELD_TYPES.has(s.type)) return null
  // 引用仅允许数据池顶层
  if (s.type === 'ref') return null

  const typeRef = optionalTypeRef(s.typeRef)
  const itemType = optionalItemType(s.itemType)
  const itemTypeRef = optionalTypeRef(s.itemTypeRef)

  if (s.type === 'array') {
    const arrayFields = Array.isArray(s.arrayFields)
      ? s.arrayFields
          .map((sub) => normalizeArraySubField(sub))
          .filter((sub): sub is ArraySubField => sub !== null)
      : []
    return {
      name: s.name.trim(),
      type: 'array',
      ...(itemType ? { itemType } : {}),
      ...(itemTypeRef ? { itemTypeRef } : {}),
      arrayFields,
    }
  }

  if (s.type === 'json') {
    const objectFields = Array.isArray(s.objectFields)
      ? s.objectFields
          .map((sub) => normalizeObjectSubField(sub))
          .filter((sub): sub is ObjectSubField => sub !== null)
      : []
    return {
      name: s.name.trim(),
      type: 'json',
      ...(typeRef ? { typeRef } : {}),
      objectFields,
    }
  }

  return {
    name: s.name.trim(),
    type: s.type,
    ...(typeRef ? { typeRef } : {}),
    value: s.value ?? defaultValue(s.type),
  }
}

function normalizeArraySubField(raw: unknown): ArraySubField | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<ArraySubField>
  if (!s.type || !DATA_FIELD_TYPES.has(s.type)) return null
  // 引用仅允许数据池顶层
  if (s.type === 'ref') return null

  const typeRef = optionalTypeRef(s.typeRef)
  const itemType = optionalItemType(s.itemType)
  const itemTypeRef = optionalTypeRef(s.itemTypeRef)

  if (s.type === 'array') {
    const arrayFields = Array.isArray(s.arrayFields)
      ? s.arrayFields
          .map((sub) => normalizeArraySubField(sub))
          .filter((sub): sub is ArraySubField => sub !== null)
      : []
    return {
      type: 'array',
      ...(itemType ? { itemType } : {}),
      ...(itemTypeRef ? { itemTypeRef } : {}),
      arrayFields,
    }
  }

  if (s.type === 'json') {
    const objectFields = Array.isArray(s.objectFields)
      ? s.objectFields
          .map((sub) => normalizeObjectSubField(sub))
          .filter((sub): sub is ObjectSubField => sub !== null)
      : []
    return {
      type: 'json',
      ...(typeRef ? { typeRef } : {}),
      objectFields,
    }
  }

  return {
    type: s.type,
    ...(typeRef ? { typeRef } : {}),
    value: s.value ?? defaultValue(s.type),
  }
}

function resolveFieldValue(
  item: Partial<DataField> & {
    initialValue?: unknown
    arrayFields?: unknown[]
    objectFields?: unknown[]
  },
): DataField['value'] {
  if (item.value !== undefined) {
    return item.value as DataField['value']
  }

  // 兼容旧字段 initialValue
  if (item.initialValue !== undefined) {
    return item.initialValue as DataField['value']
  }

  // 兼容旧结构：从 arrayFields / objectFields 推导 value
  if (item.type === 'array' && Array.isArray(item.arrayFields)) {
    const arrayFields = item.arrayFields
      .map((sub) => normalizeArraySubField(sub))
      .filter((sub): sub is ArraySubField => sub !== null)
    return buildArrayValue(arrayFields)
  }

  if (item.type === 'json' && Array.isArray(item.objectFields)) {
    const objectFields = item.objectFields
      .map((sub) => normalizeObjectSubField(sub))
      .filter((sub): sub is ObjectSubField => sub !== null)
    return buildObjectValue(objectFields)
  }

  return defaultValue(item.type!)
}

function normalizeDataField(raw: unknown): DataField | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<DataField> & {
    initialValue?: unknown
    arrayFields?: unknown[]
    objectFields?: unknown[]
  }
  if (typeof item.name !== 'string') return null
  const name = item.name.trim()
  // $props 为组件入参保留字，不允许进入数据池
  if (!name || name === '$props') return null
  if (!item.type || !DATA_FIELD_TYPES.has(item.type)) return null

  const field: DataField = {
    name,
    type: item.type,
    remark: typeof item.remark === 'string' ? item.remark : '',
    value: resolveFieldValue(item),
    binding: normalizeDataSourceBinding(item.binding),
  }

  if (typeof item.computeBody === 'string') {
    field.computeBody = item.computeBody
  }

  const controllerBinding = normalizeControllerBinding(
    (item as { controllerBinding?: unknown }).controllerBinding,
    field.type,
  )
  if (controllerBinding && field.binding === 'controller') {
    field.controllerBinding = controllerBinding
  }

  const typeRef = optionalTypeRef(item.typeRef)
  if (typeRef) field.typeRef = typeRef

  const genericArgs = normalizeGenericArgs(
    (item as { genericArgs?: unknown }).genericArgs,
  )
  if (genericArgs) field.genericArgs = genericArgs

  if (field.type === 'array') {
    const itemType = optionalItemType(item.itemType)
    const itemTypeRef = optionalTypeRef(item.itemTypeRef)
    if (itemType) field.itemType = itemType
    if (itemTypeRef) field.itemTypeRef = itemTypeRef
    if (itemType === 'array') {
      const itemItemType = optionalItemType(
        (item as { itemItemType?: unknown }).itemItemType,
      )
      const itemItemTypeRef = optionalTypeRef(
        (item as { itemItemTypeRef?: unknown }).itemItemTypeRef,
      )
      if (itemItemType) field.itemItemType = itemItemType
      if (itemItemTypeRef) field.itemItemTypeRef = itemItemTypeRef
    }
  }

  if (item.type === 'array' && Array.isArray(item.arrayFields)) {
    field.arrayFields = item.arrayFields
      .map((sub) => normalizeArraySubField(sub))
      .filter((sub): sub is ArraySubField => sub !== null)
  }

  if (item.type === 'json' && Array.isArray(item.objectFields)) {
    field.objectFields = item.objectFields
      .map((sub) => normalizeObjectSubField(sub))
      .filter((sub): sub is ObjectSubField => sub !== null)
  }

  // 引用类型存节点 path，不可绑定数据源
  if (field.type === 'ref') {
    field.binding = ''
    delete field.computeBody
    delete field.controllerBinding
    field.value =
      typeof field.value === 'string' ? field.value : String(field.value ?? '')
  }

  return field
}

function normalizePageData(raw: unknown): PageData {
  if (!raw || typeof raw !== 'object') {
    return createDefaultPageData()
  }
  const parsed = raw as Partial<PageData>
  if (!Array.isArray(parsed.fields)) {
    return createDefaultPageData()
  }
  const fields = parsed.fields
    .map((item) => normalizeDataField(item))
    .filter((item): item is DataField => item !== null)
  return { fields }
}

async function readPageData(dir: string): Promise<PageData> {
  const dataPath = path.join(dir, PAGE_DATA_FILE)
  try {
    const raw = await readFile(dataPath, 'utf-8')
    return normalizePageData(JSON.parse(raw))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDefaultPageData()
    }
    throw new ProjectError(`无法读取 ${PAGE_DATA_FILE}`, 400)
  }
}

export async function listPages(projectPathInput: string): Promise<PageSummary[]> {
  const projectPath = await assertProjectDir(projectPathInput)
  const root = await ensurePagesDir(projectPath)
  const entryPage = await getProjectEntryPage(projectPath).catch(() => undefined)

  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    throw new ProjectError('无法读取 pages 目录', 500)
  }

  const pages: PageSummary[] = []

  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith('.')) return
      const dir = path.join(root, name)
      try {
        const info = await stat(dir)
        if (!info.isDirectory()) return

        const configPath = path.join(dir, PAGE_CONFIG_FILE)
        const xmlPath = path.join(dir, PAGE_XML_FILE)
        await access(configPath, constants.R_OK)
        await access(xmlPath, constants.R_OK)

        const config = await readPageConfig(dir)
        pages.push({
          id: name,
          name: config.name,
          title: config.title || config.name,
          path: dir,
          isEntry: Boolean(entryPage && entryPage === name),
        })
      } catch {
        // skip incomplete page folders
      }
    }),
  )

  return pages.sort((a, b) => {
    if (a.isEntry !== b.isEntry) return a.isEntry ? -1 : 1
    return a.id.localeCompare(b.id, 'zh-CN')
  })
}

export async function getPage(
  projectPathInput: string,
  pageIdInput: string,
): Promise<PageDetail> {
  const projectPath = await assertProjectDir(projectPathInput)
  const pageId = assertSafePageId(pageIdInput)
  const dir = pageDir(projectPath, pageId)

  try {
    const info = await stat(dir)
    if (!info.isDirectory()) {
      throw new ProjectError('页面不存在', 404)
    }
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('页面不存在', 404)
  }

  const config = await readPageConfig(dir)

  let xml: string
  try {
    xml = await readFile(path.join(dir, PAGE_XML_FILE), 'utf-8')
  } catch {
    throw new ProjectError(`无法读取 ${PAGE_XML_FILE}`, 500)
  }

  const data = await readPageData(dir)

  return {
    id: pageId,
    path: dir,
    config,
    xml,
    data,
  }
}

export async function createPage(options: {
  projectPath: string
  id: string
  name: string
  title?: string
}): Promise<PageDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const pageId = assertSafePageId(options.id)

  if (!options.name?.trim()) {
    throw new ProjectError('请填写页面名称')
  }

  await ensurePagesDir(projectPath)
  const dir = pageDir(projectPath, pageId)

  try {
    await access(dir, constants.F_OK)
    throw new ProjectError(`页面 ${pageId} 已存在`)
  } catch (err) {
    if (err instanceof ProjectError) throw err
  }

  try {
    await mkdir(dir, { recursive: true })
  } catch {
    throw new ProjectError('无法创建页面目录', 500)
  }

  const config = createDefaultPageConfig(options.name.trim())
  if (options.title?.trim()) {
    config.title = options.title.trim()
  }

  const xml = createDefaultPageXml()

  try {
    await writeFile(
      path.join(dir, PAGE_CONFIG_FILE),
      `${JSON.stringify(config, null, 2)}\n`,
      'utf-8',
    )
    await writeFile(path.join(dir, PAGE_XML_FILE), xml, 'utf-8')
    await writeFile(
      path.join(dir, PAGE_DATA_FILE),
      `${JSON.stringify(createDefaultPageData(), null, 2)}\n`,
      'utf-8',
    )
    await mkdir(path.join(dir, 'function'), { recursive: true })
  } catch {
    throw new ProjectError('无法写入页面文件', 500)
  }

  return {
    id: pageId,
    path: dir,
    config,
    xml,
    data: createDefaultPageData(),
  }
}

export async function savePageData(options: {
  projectPath: string
  pageId: string
  data: PageData
}): Promise<PageDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const pageId = assertSafePageId(options.pageId)
  const dir = pageDir(projectPath, pageId)

  try {
    const info = await stat(dir)
    if (!info.isDirectory()) {
      throw new ProjectError('页面不存在', 404)
    }
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('页面不存在', 404)
  }

  const data = normalizePageData(options.data)

  try {
    await writeFile(
      path.join(dir, PAGE_DATA_FILE),
      `${JSON.stringify(data, null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(`无法写入 ${PAGE_DATA_FILE}`, 500)
  }

  return getPage(projectPath, pageId)
}

export async function savePageXml(options: {
  projectPath: string
  pageId: string
  xml: string
}): Promise<PageDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const pageId = assertSafePageId(options.pageId)
  const dir = pageDir(projectPath, pageId)

  if (typeof options.xml !== 'string') {
    throw new ProjectError('请提供页面 XML 内容')
  }

  try {
    await writeFile(path.join(dir, PAGE_XML_FILE), options.xml, 'utf-8')
  } catch {
    throw new ProjectError(`无法写入 ${PAGE_XML_FILE}`, 500)
  }

  return getPage(projectPath, pageId)
}

export async function savePageConfig(options: {
  projectPath: string
  pageId: string
  name: string
  title?: string
  statusBar?: PageConfig['statusBar']
}): Promise<PageDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const pageId = assertSafePageId(options.pageId)
  const dir = pageDir(projectPath, pageId)

  try {
    const info = await stat(dir)
    if (!info.isDirectory()) throw new ProjectError('页面不存在', 404)
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('页面不存在', 404)
  }

  const name = options.name?.trim()
  if (!name) throw new ProjectError('请填写页面名称')

  const prev = await readPageConfig(dir)
  const config: PageConfig = {
    name,
    title:
      options.title !== undefined
        ? options.title.trim() || name
        : prev.title === prev.name
          ? name
          : prev.title || name,
  }

  const statusBarSource =
    options.statusBar !== undefined ? options.statusBar : prev.statusBar
  const normalizedStatusBar = normalizePageStatusBar(statusBarSource)
  if (normalizedStatusBar) {
    config.statusBar = normalizedStatusBar
  }

  try {
    await writeFile(
      path.join(dir, PAGE_CONFIG_FILE),
      `${JSON.stringify(config, null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(`无法写入 ${PAGE_CONFIG_FILE}`, 500)
  }

  return getPage(projectPath, pageId)
}

export async function copyPage(options: {
  projectPath: string
  pageId: string
  newId: string
  name?: string
  title?: string
}): Promise<PageDetail> {
  const projectPath = await assertProjectDir(options.projectPath)
  const sourceId = assertSafePageId(options.pageId)
  const newId = assertSafePageId(options.newId)
  if (sourceId === newId) {
    throw new ProjectError('新页面 ID 不能与原页面相同')
  }

  const sourceDir = pageDir(projectPath, sourceId)
  const targetDir = pageDir(projectPath, newId)

  try {
    const info = await stat(sourceDir)
    if (!info.isDirectory()) throw new ProjectError('原页面不存在', 404)
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('原页面不存在', 404)
  }

  try {
    await access(targetDir, constants.F_OK)
    throw new ProjectError(`页面 ${newId} 已存在`)
  } catch (err) {
    if (err instanceof ProjectError) throw err
  }

  try {
    await cp(sourceDir, targetDir, { recursive: true })
  } catch {
    throw new ProjectError('复制页面失败', 500)
  }

  const sourceConfig = await readPageConfig(sourceDir)
  const name = options.name?.trim() || `${sourceConfig.name} 副本`
  const title =
    options.title?.trim() ||
    (sourceConfig.title ? `${sourceConfig.title} 副本` : name)

  try {
    await writeFile(
      path.join(targetDir, PAGE_CONFIG_FILE),
      `${JSON.stringify({ name, title }, null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError('无法写入复制页面的配置', 500)
  }

  return getPage(projectPath, newId)
}

export async function deletePage(options: {
  projectPath: string
  pageId: string
}): Promise<{ ok: boolean; entryCleared: boolean }> {
  const projectPath = await assertProjectDir(options.projectPath)
  const pageId = assertSafePageId(options.pageId)
  const dir = pageDir(projectPath, pageId)

  try {
    const info = await stat(dir)
    if (!info.isDirectory()) throw new ProjectError('页面不存在', 404)
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('页面不存在', 404)
  }

  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    throw new ProjectError('删除页面失败', 500)
  }

  let entryCleared = false
  try {
    const entry = await getProjectEntryPage(projectPath)
    if (entry === pageId) {
      await setEntryPage(projectPath, null)
      entryCleared = true
    }
  } catch {
    // ignore entry cleanup failures
  }

  return { ok: true, entryCleared }
}
