/**
 * AI / 无头预览会话：复用 runEventBindings + computed + 可见性求值，
 * 不依赖 WorkspaceView 画布 DOM。
 */
import { getComponent, listComponentMethods, listComponents } from '../api/components'
import {
  getPage,
  getPageLifecycle,
  listPageMethods,
  listPages,
} from '../api/pages'
import { getColorPalette, getDataTypeLibrary } from '../api/projects'
import type { ComponentRenderMap } from '../types/component-render'
import type { ColorPalette } from '../types/color-palette'
import type { DataTypeLibrary } from '../types/data-types'
import type { LifecycleConfig } from '../types/lifecycle'
import {
  INTERACTION_EVENT_KEYS,
  serializeEventBindings,
  type PageMethod,
} from '../types/page-method'
import {
  clonePageData,
  type DataFieldValue,
  type PageData,
} from '../types/page-data'
import {
  V_IF_ATTR,
  V_SHOW_ATTR,
  parseVisibilityConditions,
} from '../types/dynamic-styles'
import { createModalStack } from '../composables/useModalStack'
import {
  resolveComputedFieldsInPlace,
  resolveComputedPageData,
  sameJson,
} from '../utils/compute-runtime'
import {
  hasControllerBoundFields,
  loadControllerBoundPageData,
} from '../utils/controller-binding-runtime'
import { getDeviceInfo } from '../utils/device-info'
import {
  evaluateScenarios,
  interpolateDataBindings,
  resolveMatchingStyleOverrides,
} from '../utils/dynamic-style-runtime'
import { runEventBindings } from '../utils/event-runtime'
import { parsePageXml, type XmlNode } from '../utils/xml'
import type { ComponentMethodsMap } from '../utils/widget-ref'
import { getWidgetDetailForAi } from './ai-widget-view'

export type PreviewSessionKind = 'page' | 'component'

export type PreviewLayoutNode = {
  nodeId: string
  tag: string
  visible: boolean
  text?: string
  width?: string
  height?: string
  weight?: string
  overflow?: string
  orientation?: string
  backgroundColor?: string
  textColor?: string
  risks?: string[]
  children?: PreviewLayoutNode[]
}

export type PreviewSessionState = {
  kind: PreviewSessionKind
  id: string
  fields: Record<string, unknown>
  toast: { message: string; id: number } | null
  logs: Array<{ level: string; message: string; location?: string }>
  navigatedTo: string | null
  layoutRisks: string[]
}

export type PagePreviewSession = {
  projectPath: string
  kind: PreviewSessionKind
  id: string
  xml: string
  pageData: PageData
  methods: PageMethod[]
  lifecycle: LifecycleConfig | null
  query: Record<string, unknown>
  componentMap: ComponentRenderMap
  componentMethodsMap: ComponentMethodsMap
  pageIds: Set<string>
  colorPalette: ColorPalette | null
  typeLibrary: DataTypeLibrary | null
  toast: { message: string; id: number } | null
  logs: Array<{ level: string; message: string; location?: string }>
  navigatedTo: string | null
  history: Array<{ kind: PreviewSessionKind; id: string; query: Record<string, unknown> }>
}

const sessions = new Map<string, PagePreviewSession>()

function sessionKey(projectPath: string): string {
  return projectPath.trim()
}

function pushLog(
  session: PagePreviewSession,
  level: string,
  message: string,
  location?: string,
) {
  session.logs.push({ level, message, location })
  if (session.logs.length > 80) session.logs.shift()
}

function fieldsSnapshot(data: PageData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of data.fields ?? []) {
    const name = f.name.trim()
    if (!name) continue
    out[name] = f.value
  }
  return out
}

export function pageDataFieldsSnapshot(data: PageData): Record<string, unknown> {
  return fieldsSnapshot(data)
}

export function buildLayoutFromXmlAndData(
  xml: string,
  pageData: PageData,
): PreviewLayoutNode {
  const root = parsePageXml(xml)
  return walkLayout(root, `0:${root.tag}`, pageData, true)
}

function parseHexColor(raw: string | undefined): { r: number; g: number; b: number } | null {
  if (!raw) return null
  const s = raw.trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (!m) return null
  let hex = m[1]!
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const n = Number.parseInt(hex, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function relativeLuminance(c: { r: number; g: number; b: number }): number {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

function collectNodeRisks(attrs: Record<string, string>, isRoot: boolean): string[] {
  const risks: string[] = []
  const width = (attrs.width ?? '').trim()
  const height = (attrs.height ?? '').trim()
  const weight = (attrs.weight ?? '').trim()
  if ((width === '0' || width === '0px') && !weight) {
    risks.push('width=0 且无 weight，可能不可见')
  }
  if (height === '0' || height === '0px') {
    risks.push('height=0，布局会坍塌')
  }
  const bg = parseHexColor(attrs.backgroundColor || attrs.background)
  const fg = parseHexColor(attrs.textColor || attrs.color)
  if (bg && fg) {
    const diff = Math.abs(relativeLuminance(bg) - relativeLuminance(fg))
    if (diff < 0.15) {
      risks.push('背景色与文字色对比度过低')
    }
  }
  if (isRoot && !(attrs.backgroundColor || attrs.background)?.trim()) {
    risks.push('根布局未设背景（默认白底）')
  }
  return risks
}

function walkLayout(
  node: XmlNode,
  path: string,
  pageData: PageData,
  isRoot: boolean,
): PreviewLayoutNode {
  const ifOk = evaluateScenarios(
    parseVisibilityConditions(node.attrs[V_IF_ATTR]).scenarios,
    pageData,
  )
  const showOk = evaluateScenarios(
    parseVisibilityConditions(node.attrs[V_SHOW_ATTR]).scenarios,
    pageData,
  )
  const visible = ifOk && showOk
  const styleOverrides = resolveMatchingStyleOverrides(
    node.attrs.dynamicStyles,
    pageData,
  )
  const effectiveAttrs = {
    ...node.attrs,
    ...styleOverrides,
  }
  const rawText = effectiveAttrs.text ?? effectiveAttrs.value
  const text = rawText
    ? interpolateDataBindings(rawText, pageData)
    : undefined
  const risks = collectNodeRisks(effectiveAttrs, isRoot)
  const children = node.children.map((child, index) =>
    walkLayout(child, `${path}/${index}:${child.tag}`, pageData, false),
  )
  const item: PreviewLayoutNode = {
    nodeId: path,
    tag: node.tag,
    visible,
  }
  if (text != null && text !== '') item.text = text
  if (effectiveAttrs.width) item.width = effectiveAttrs.width
  if (effectiveAttrs.height) item.height = effectiveAttrs.height
  if (effectiveAttrs.weight) item.weight = effectiveAttrs.weight
  if (effectiveAttrs.overflow) item.overflow = effectiveAttrs.overflow
  if (effectiveAttrs.orientation) item.orientation = effectiveAttrs.orientation
  if (effectiveAttrs.backgroundColor || effectiveAttrs.background) {
    item.backgroundColor =
      effectiveAttrs.backgroundColor || effectiveAttrs.background
  }
  if (effectiveAttrs.textColor || effectiveAttrs.color) {
    item.textColor = effectiveAttrs.textColor || effectiveAttrs.color
  }
  if (risks.length) item.risks = risks
  if (children.length) item.children = children
  return item
}

function flattenLayoutRisks(node: PreviewLayoutNode, acc: string[] = []): string[] {
  if (node.risks?.length) {
    for (const r of node.risks) acc.push(`${node.nodeId}: ${r}`)
  }
  for (const child of node.children ?? []) flattenLayoutRisks(child, acc)
  return acc
}

export function collectLayoutRisks(node: PreviewLayoutNode): string[] {
  return flattenLayoutRisks(node)
}

async function buildComponentMaps(projectPath: string): Promise<{
  map: ComponentRenderMap
  methodsMap: ComponentMethodsMap
}> {
  const { components } = await listComponents(projectPath)
  const map: ComponentRenderMap = {}
  const methodsMap: ComponentMethodsMap = {}
  await Promise.all(
    components.map(async (c) => {
      try {
        const [detail, methodsRes] = await Promise.all([
          getComponent(projectPath, c.id),
          listComponentMethods(projectPath, c.id),
        ])
        map[c.id] = {
          id: detail.id,
          config: detail.config,
          xml: detail.xml,
          data: clonePageData(detail.data),
        }
        methodsMap[c.id] = methodsRes.methods
      } catch {
        // skip broken component
      }
    }),
  )
  return { map, methodsMap }
}

function applySetDataOn(
  data: PageData,
  prop: string,
  value: DataFieldValue,
  options: {
    getDeviceInfo: () => ReturnType<typeof getDeviceInfo>
    dollarQuery?: Record<string, unknown>
    colorPalette: ColorPalette | null
  },
): void {
  const fields = data.fields ?? []
  const index = fields.findIndex((item) => item.name.trim() === prop.trim())
  if (index < 0) {
    throw new Error(`数据池不存在字段：${prop}`)
  }
  const prev = fields[index]!
  if (sameJson(prev.value, value)) return
  prev.value = value
  resolveComputedFieldsInPlace(data, [prop], {
    getDeviceInfo: options.getDeviceInfo,
    dollarProps: {},
    dollarQuery: options.dollarQuery,
    colorPalette: options.colorPalette,
  })
}

function buildEventContext(session: PagePreviewSession) {
  const device = () => getDeviceInfo({ platform: 'h5' })
  const modalStack = createModalStack()
  return {
    pageData: session.pageData,
    getPageData: () => session.pageData,
    xml: session.xml,
    modalStack,
    componentMap: session.componentMap,
    componentMethodsMap: session.componentMethodsMap,
    resolveMethod: (name: string) =>
      session.methods.find((m) => m.name === name && !m.builtin),
    localMethods: session.methods.filter((m) => !m.builtin),
    hasPage: (pageId: string) => session.pageIds.has(pageId),
    navigateTo: async (pageId: string, params?: Record<string, unknown>) => {
      session.navigatedTo = pageId
      session.history.push({
        kind: session.kind,
        id: session.id,
        query: { ...session.query },
      })
      pushLog(session, 'info', `navigateTo ${pageId}`, '预览会话')
      if (session.pageIds.has(pageId)) {
        await resetPreviewSession({
          projectPath: session.projectPath,
          pageId,
          query: params && typeof params === 'object' ? params : {},
          keepHistory: true,
        })
      }
    },
    navigateBack: async () => {
      const prev = session.history.pop()
      if (!prev) {
        pushLog(session, 'warn', '没有可返回的页面', 'navigateBack')
        return
      }
      await resetPreviewSession({
        projectPath: session.projectPath,
        pageId: prev.kind === 'page' ? prev.id : undefined,
        componentId: prev.kind === 'component' ? prev.id : undefined,
        query: prev.query,
        keepHistory: true,
      })
    },
    setData: (prop: string, value: DataFieldValue) => {
      try {
        applySetDataOn(session.pageData, prop, value, {
          getDeviceInfo: device,
          dollarQuery: session.kind === 'page' ? session.query : undefined,
          colorPalette: session.colorPalette,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        pushLog(session, 'error', message, `setData('${prop}')`)
        throw err instanceof Error ? err : new Error(message)
      }
    },
    showToast: (message: string) => {
      session.toast = { message, id: Date.now() }
    },
    getDeviceInfo: device,
    colorPalette: session.colorPalette,
    emit: (event: string, ...args: unknown[]) => {
      pushLog(
        session,
        'info',
        `emit ${event} ${JSON.stringify(args)}`,
        '组件 emit',
      )
    },
    onUnknownMethod: (message: string, detail?: { location?: string }) => {
      // 自定义方法/未知方法失败必须记为 error，供自测门禁检出
      pushLog(session, 'error', message, detail?.location)
    },
  }
}

/** 执行事件/方法后：若产生 error 日志则抛出，避免「跑了但挂了」仍算通过 */
function throwIfNewRuntimeErrors(
  session: PagePreviewSession,
  logStart: number,
  label: string,
): void {
  const fresh = session.logs.slice(logStart).filter((item) => item.level === 'error')
  if (!fresh.length) return
  const detail = fresh
    .map((item) =>
      item.location ? `${item.location}: ${item.message}` : item.message,
    )
    .join('；')
  throw new Error(`${label} 运行出错：${detail}`)
}

function unwrapPalette(raw: unknown): ColorPalette | null {
  if (!raw || typeof raw !== 'object') return null
  if ('palette' in (raw as object)) {
    return (raw as { palette: ColorPalette }).palette ?? null
  }
  return raw as ColorPalette
}

function unwrapTypeLibrary(raw: unknown): DataTypeLibrary | null {
  if (!raw || typeof raw !== 'object') return null
  if ('library' in (raw as object)) {
    return (raw as { library: DataTypeLibrary }).library ?? null
  }
  return raw as DataTypeLibrary
}

export async function resetPreviewSession(options: {
  projectPath: string
  pageId?: string
  componentId?: string
  query?: Record<string, unknown>
  keepHistory?: boolean
}): Promise<PagePreviewSession> {
  const projectPath = options.projectPath.trim()
  if (!projectPath) throw new Error('缺少 projectPath')
  const pageId = options.pageId?.trim()
  const componentId = options.componentId?.trim()
  if (!pageId && !componentId) {
    throw new Error('请指定 pageId 或 componentId')
  }
  if (pageId && componentId) {
    throw new Error('pageId 与 componentId 只能指定一个')
  }

  const prev = sessions.get(sessionKey(projectPath))
  const history = options.keepHistory && prev ? [...prev.history] : []

  const [{ pages }, { map, methodsMap }, paletteRes, typeLib] =
    await Promise.all([
      listPages(projectPath),
      buildComponentMaps(projectPath),
      getColorPalette(projectPath).catch(() => null),
      getDataTypeLibrary(projectPath).catch(() => null),
    ])

  const kind: PreviewSessionKind = pageId ? 'page' : 'component'
  const id = (pageId || componentId)!
  let xml: string
  let rawData: PageData
  let methods: PageMethod[]
  let lifecycle: LifecycleConfig | null = null

  if (kind === 'page') {
    const detail = await getPage(projectPath, id)
    xml = detail.xml
    rawData = detail.data
    const methodsRes = await listPageMethods(projectPath, id)
    methods = methodsRes.methods
    try {
      const life = await getPageLifecycle(projectPath, id)
      lifecycle = life.lifecycle
    } catch {
      lifecycle = null
    }
  } else {
    const detail = await getComponent(projectPath, id)
    xml = detail.xml
    rawData = detail.data
    const methodsRes = await listComponentMethods(projectPath, id)
    methods = methodsRes.methods
  }

  const query = { ...(options.query ?? {}) }
  const colorPalette = unwrapPalette(paletteRes)
  const typeLibrary = unwrapTypeLibrary(typeLib)

  let pageData = resolveComputedPageData(clonePageData(rawData), {
    getDeviceInfo: () => getDeviceInfo({ platform: 'h5' }),
    dollarProps: {},
    dollarQuery: kind === 'page' ? query : undefined,
    colorPalette,
  })

  const session: PagePreviewSession = {
    projectPath,
    kind,
    id,
    xml,
    pageData,
    methods,
    lifecycle,
    query,
    componentMap: map,
    componentMethodsMap: methodsMap,
    pageIds: new Set(pages.map((p) => p.id)),
    colorPalette,
    typeLibrary,
    toast: null,
    logs: [],
    navigatedTo: null,
    history,
  }

  sessions.set(sessionKey(projectPath), session)

  if (hasControllerBoundFields(pageData)) {
    try {
      const hydrated = await loadControllerBoundPageData(pageData, {
        projectPath,
        dryRun: true,
        typeLibrary: session.typeLibrary,
        runEvents: async (raw, eventArgs) => {
          await runEventBindings(raw, {
            ...buildEventContext(session),
            eventArgs,
            logLocation: '控制器字段钩子',
          })
        },
      })
      session.pageData = resolveComputedPageData(hydrated, {
        getDeviceInfo: () => getDeviceInfo({ platform: 'h5' }),
        dollarProps: {},
        dollarQuery: kind === 'page' ? query : undefined,
        colorPalette,
      })
    } catch (err) {
      pushLog(
        session,
        'warn',
        `控制器字段加载失败：${err instanceof Error ? err.message : String(err)}`,
        'preview_page',
      )
    }
  }

  const onMounted = lifecycle?.onMounted?.trim()
  if (onMounted) {
    try {
      await runEventBindings(onMounted, {
        ...buildEventContext(session),
        logLocation: '生命周期 onMounted',
      })
    } catch (err) {
      pushLog(
        session,
        'warn',
        `onMounted 失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return getPreviewSession(projectPath)!
}

export function getPreviewSession(
  projectPath: string,
): PagePreviewSession | null {
  return sessions.get(sessionKey(projectPath)) ?? null
}

export function requirePreviewSession(projectPath: string): PagePreviewSession {
  const s = getPreviewSession(projectPath)
  if (!s) {
    throw new Error('尚未初始化预览会话，请先调用 preview_page')
  }
  return s
}

export function getPreviewState(projectPath: string): PreviewSessionState {
  const s = requirePreviewSession(projectPath)
  const layout = getLayoutSnapshot(projectPath)
  return {
    kind: s.kind,
    id: s.id,
    fields: fieldsSnapshot(s.pageData),
    toast: s.toast,
    logs: [...s.logs],
    navigatedTo: s.navigatedTo,
    layoutRisks: flattenLayoutRisks(layout),
  }
}

export function getLayoutSnapshot(projectPath: string): PreviewLayoutNode {
  const s = requirePreviewSession(projectPath)
  const root = parsePageXml(s.xml)
  return walkLayout(root, `0:${root.tag}`, s.pageData, true)
}

export function setPreviewData(
  projectPath: string,
  field: string,
  value: unknown,
): PreviewSessionState {
  const s = requirePreviewSession(projectPath)
  applySetDataOn(s.pageData, field, value as DataFieldValue, {
    getDeviceInfo: () => getDeviceInfo({ platform: 'h5' }),
    dollarQuery: s.kind === 'page' ? s.query : undefined,
    colorPalette: s.colorPalette,
  })
  return getPreviewState(projectPath)
}

export async function simulatePreviewEvent(options: {
  projectPath: string
  nodeId: string
  eventKey?: string
  scope?: { item?: unknown; index?: number }
  eventArgs?: Record<string, unknown>
}): Promise<{
  eventKey: string
  nodeId: string
  bindingCount: number
  state: PreviewSessionState
}> {
  const s = requirePreviewSession(options.projectPath)
  const eventKey = (options.eventKey?.trim() || 'onClick') as string
  if (
    !(INTERACTION_EVENT_KEYS as readonly string[]).includes(eventKey) &&
    !eventKey.startsWith('on')
  ) {
    throw new Error(`不支持的事件：${eventKey}`)
  }
  const detail = getWidgetDetailForAi(s.xml, options.nodeId)
  const raw =
    detail.events[eventKey] != null
      ? serializeEventBindings(detail.events[eventKey]!)
      : detail.attrs[eventKey]
  if (!raw?.trim()) {
    const invalid = detail.invalidEventAttrs?.click
    if (eventKey === 'onClick' && invalid) {
      throw new Error(
        `节点 ${options.nodeId} 使用了无效属性 click，请改为 onClick`,
      )
    }
    throw new Error(`节点 ${options.nodeId} 未绑定 ${eventKey}`)
  }
  const before = fieldsSnapshot(s.pageData)
  const logStart = s.logs.length
  await runEventBindings(raw, {
    ...buildEventContext(s),
    scope: options.scope,
    eventArgs: options.eventArgs,
    logLocation: `预览 · ${eventKey} · ${options.nodeId}`,
  })
  throwIfNewRuntimeErrors(s, logStart, `${eventKey} @ ${options.nodeId}`)
  const after = fieldsSnapshot(s.pageData)
  const changed = Object.keys({ ...before, ...after }).filter(
    (k) => !sameJson(before[k], after[k]),
  )
  if (changed.length) {
    pushLog(s, 'info', `数据变更：${changed.join(', ')}`, eventKey)
  }
  return {
    eventKey,
    nodeId: options.nodeId,
    bindingCount: detail.events[eventKey]?.length ?? 1,
    state: getPreviewState(options.projectPath),
  }
}

export async function runPreviewMethod(options: {
  projectPath: string
  name: string
  args?: Record<string, unknown>
}): Promise<PreviewSessionState> {
  const s = requirePreviewSession(options.projectPath)
  const name = options.name.trim()
  if (!name) throw new Error('缺少方法名')
  const method = s.methods.find((m) => m.name === name && !m.builtin)
  if (!method) throw new Error(`未找到自定义方法：${name}`)
  const args: Record<string, string> = {}
  for (const [k, v] of Object.entries(options.args ?? {})) {
    args[k] = v == null ? '' : String(v)
  }
  const raw = serializeEventBindings([
    {
      id: `bind_ai_${Date.now().toString(36)}`,
      method: name,
      args,
    },
  ])
  const logStart = s.logs.length
  await runEventBindings(raw, {
    ...buildEventContext(s),
    logLocation: `预览 · 方法 ${name}`,
  })
  throwIfNewRuntimeErrors(s, logStart, `方法 ${name}`)
  return getPreviewState(options.projectPath)
}

export function findLayoutNode(
  root: PreviewLayoutNode,
  nodeId: string,
): PreviewLayoutNode | null {
  if (root.nodeId === nodeId) return root
  for (const child of root.children ?? []) {
    const hit = findLayoutNode(child, nodeId)
    if (hit) return hit
  }
  return null
}
