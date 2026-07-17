<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Box,
  Coin,
  Collection,
  Document,
  EditPen,
  Lightning,
  Picture,
  Plus,
  View,
} from '@element-plus/icons-vue'
import {
  copyPage,
  createPage,
  deletePage,
  deletePageMethod,
  getPage,
  getPageLifecycle,
  listPageMethods,
  listPages,
  savePageConfig,
  savePageData,
  savePageLifecycle,
  savePageMethod,
  savePageXml,
  type PageDetail,
  type PageSummary,
} from '../api/pages'
import { createModalStack } from '../composables/useModalStack'
import {
  createComponent,
  deleteComponentMethod,
  getComponent,
  getComponentLifecycle,
  listComponentMethods,
  listComponents,
  saveComponentConfig,
  saveComponentData,
  saveComponentLifecycle,
  saveComponentMethod,
  saveComponentXml,
  type ComponentDetail,
} from '../api/components'
import {
  getDataTypeLibrary,
  getIconLibrary,
  getMysqlLibrary,
  saveDataTypeLibrary as saveDataTypeLibraryApi,
  saveIconLibrary as saveIconLibraryApi,
  saveMysqlLibrary as saveMysqlLibraryApi,
  setProjectEntryPage,
} from '../api/projects'
import DataPoolPanel from '../components/editor/DataPoolPanel.vue'
import DataTypesPanel from '../components/editor/DataTypesPanel.vue'
import MysqlPanel from '../components/editor/MysqlPanel.vue'
import IconLibraryPanel from '../components/editor/IconLibraryPanel.vue'
import MethodEditDialog from '../components/editor/MethodEditDialog.vue'
import MethodsPanel from '../components/editor/MethodsPanel.vue'
import LifecyclePanel from '../components/editor/LifecyclePanel.vue'
import LeafIcon from '../components/icons/LeafIcon.vue'
import MysqlIcon from '../components/icons/MysqlIcon.vue'
import DevelopIcon from '../components/icons/DevelopIcon.vue'
import ComponentMetaPanel from '../components/editor/ComponentMetaPanel.vue'
import PreviewDebugPanel, {
  type EmitLogEntry,
} from '../components/editor/PreviewDebugPanel.vue'
import PropsPanel, { type PropsTab } from '../components/editor/PropsPanel.vue'
import PageCanvas from '../components/xml/PageCanvas.vue'
import WidgetTree from '../components/xml/WidgetTree.vue'
import { useProjectStore } from '../stores/project'
import {
  buildEmitAmbientDeclarations,
  builtinsForRoot,
  createEmptyMethod,
  CUSTOM_EVENT_METHOD,
  serializeEventBindings,
  type PageMethod,
} from '../types/page-method'
import { runEventBindings } from '../utils/event-runtime'
import { createComponentEmit } from '../utils/component-emit'
import type { PreviewInteractPayload } from '../utils/event-runtime'
import { resolveComputedPageData } from '../utils/compute-runtime'
import {
  normalizeStatusBarConfig,
  resolveStatusBarConfig,
  type StatusBarConfig,
} from '../utils/status-bar'
import { buildDollarProps, buildDollarPropsAmbientDeclaration } from '../utils/component-props'
import { getDeviceInfo } from '../utils/device-info'
import { clonePageData, type DataFieldValue } from '../types/page-data'
import {
  createEmptyLifecycleConfig,
  LIFECYCLE_MOUNT_KEYS,
  LIFECYCLE_UNMOUNT_KEYS,
  LIFECYCLE_UPDATE_KEYS,
  type LifecycleConfig,
  type LifecycleHookKey,
} from '../types/lifecycle'
import {
  appendComponent,
  appendWidget,
  canDeleteNode,
  moveWidget,
  removeWidget,
  migrateLegacyMaskToModal,
  WIDGET_OPTIONS,
  type MovePosition,
  type WidgetTag,
} from '../utils/xml-node'
import type { ComponentConfig, ComponentSummary } from '../types/component'
import type { ComponentRenderMap } from '../types/component-render'
import type { PageData } from '../types/page-data'
import {
  createEmptyIconLibrary,
  type IconLibrary,
} from '../types/icon-library'
import {
  createEmptyDataTypeLibrary,
  type DataTypeLibrary,
} from '../types/data-types'
import {
  createEmptyMysqlLibrary,
  type MysqlLibrary,
} from '../types/mysql'

type WorkspaceMode =
  | 'preview'
  | 'edit'
  | 'datapool'
  | 'datatypes'
  | 'mysql'
  | 'icons'
  | 'methods'
  | 'lifecycle'

const projectStore = useProjectStore()

type ResourceKind = 'page' | 'component'
type ProjectNav = 'datatypes' | 'mysql' | 'icons'

const resourceKind = ref<ResourceKind>('page')
/** 左侧项目级入口；null 表示页面/组件资源模式 */
const projectNav = ref<ProjectNav | null>(null)
const pages = ref<PageSummary[]>([])
const components = ref<ComponentSummary[]>([])
const activePageId = ref('')
const activeComponentId = ref('')
const activePage = ref<PageDetail | null>(null)
const activeComponent = ref<ComponentDetail | null>(null)
const selectedNodeId = ref('')
const workspaceMode = ref<WorkspaceMode>('preview')
const addComponentVisible = ref(false)
const componentMap = ref<ComponentRenderMap>({})
/** 各组件方法（含暴露方法签名 / 预览调用） */
const componentMethodsMap = ref<Record<string, PageMethod[]>>({})
const propsTab = ref<PropsTab>('style')
const openRepeatRequest = ref(0)
const loadingPages = ref(false)
const loadingPage = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const addWidgetVisible = ref(false)
const iconLibrary = ref<IconLibrary>(createEmptyIconLibrary())
const dataTypeLibrary = ref<DataTypeLibrary>(createEmptyDataTypeLibrary())
const mysqlLibrary = ref<MysqlLibrary>(createEmptyMysqlLibrary())
/** 编辑态临时隐藏，不写入 XML；预览模式不生效 */
const editorHiddenNodeIds = ref<string[]>([])
const pageMethods = ref<PageMethod[]>([])
const lifecycleConfig = ref<LifecycleConfig>(createEmptyLifecycleConfig())
const methodDialogVisible = ref(false)
const editingMethod = ref<PageMethod | null>(null)
/** 预览态是否已跑过挂载生命周期序列 */
let lifecycleSessionActive = false
let lifecycleSaveTimer: ReturnType<typeof setTimeout> | null = null
/** 预览态 navigateTo / navigateBack 历史（含路由参数） */
const pageHistory = ref<Array<{ pageId: string; params: Record<string, unknown> }>>([])
/** 预览态当前页跳转参数（navigateTo 传入） */
const routeParams = ref<Record<string, unknown>>({})
/** 预览态手机框内 Toast */
const previewToast = ref<{ message: string; id: number } | null>(null)
let previewToastTimer: ReturnType<typeof setTimeout> | null = null
/** 组件预览：调试面板覆盖的 $props */
const previewPropOverrides = ref<Record<string, unknown>>({})
const previewEmitLogs = ref<EmitLogEntry[]>([])
let previewEmitLogSeq = 0
/** 画布平移 / 缩放（切页保持，重置按钮仍可归位） */
const canvasPanX = ref(0)
const canvasPanY = ref(0)
const canvasZoom = ref(1)
/** 画布场景：H5 / 小程序 */
const canvasScene = ref<'h5' | 'miniprogram'>('h5')
/** 预览态 Modal 堆栈（一屏仅栈顶可见） */
const modalStack = createModalStack()

function showPreviewToast(message: string, duration: 'short' | 'long' = 'short') {
  const text = String(message ?? '').trim() || ' '
  previewToast.value = { message: text, id: Date.now() }
  if (previewToastTimer) clearTimeout(previewToastTimer)
  previewToastTimer = setTimeout(
    () => {
      previewToast.value = null
      previewToastTimer = null
    },
    duration === 'long' ? 4500 : 2000,
  )
}

const createForm = reactive({
  id: '',
  name: '',
  title: '',
})

const createRules = {
  id: [
    { required: true, message: '请输入页面 ID', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: '仅支持字母、数字、下划线和短横线',
      trigger: 'blur',
    },
  ],
  name: [{ required: true, message: '请输入页面名称', trigger: 'blur' }],
}

const createFormRef = ref()

const canvasWidth = computed(
  () => projectStore.config?.canvas.width ?? 375,
)

const isPageResource = computed(() => resourceKind.value === 'page')
const isComponentResource = computed(() => resourceKind.value === 'component')
const activeDoc = computed(() =>
  isPageResource.value ? activePage.value : activeComponent.value,
)

/** 预览态运行时数据副本（与数据池隔离，setData 只改这里） */
const previewRuntimeData = ref<import('../types/page-data').PageData | null>(null)
const previewComponentMap = ref<ComponentRenderMap | null>(null)

function cloneComponentRenderMap(map: ComponentRenderMap): ComponentRenderMap {
  const next: ComponentRenderMap = {}
  for (const [id, info] of Object.entries(map)) {
    next[id] = {
      ...info,
      config: { ...info.config },
      data: clonePageData(info.data),
    }
  }
  return next
}

function resetPreviewRuntime() {
  if (!activeDoc.value) {
    previewRuntimeData.value = null
    previewComponentMap.value = null
    previewPropOverrides.value = {}
    previewEmitLogs.value = []
    return
  }
  previewRuntimeData.value = clonePageData(activeDoc.value.data ?? { fields: [] })
  previewComponentMap.value = cloneComponentRenderMap(componentMap.value)
  previewPropOverrides.value = {}
  previewEmitLogs.value = []
}

function clearPreviewRuntime() {
  previewRuntimeData.value = null
  previewComponentMap.value = null
  previewPropOverrides.value = {}
  previewEmitLogs.value = []
}

/** 画布/预览运行时使用：预览走副本，编辑走数据池 */
const resolvedPageData = computed(() =>
  resolveComputedPageData(
    workspaceMode.value === 'preview' && previewRuntimeData.value
      ? previewRuntimeData.value
      : (activeDoc.value?.data ?? { fields: [] }),
    {
      getDeviceInfo: previewGetDeviceInfo,
      dollarProps: editorDollarProps.value ?? {},
    },
  ),
)

const canvasComponentMap = computed(() =>
  workspaceMode.value === 'preview' && previewComponentMap.value
    ? previewComponentMap.value
    : componentMap.value,
)

const editorConditionComponentProps = computed(() =>
  isComponentResource.value ? (activeComponent.value?.config.props ?? []) : null,
)

/** 编辑/预览组件时：用 config.props 默认值 + 调试覆盖作为 $props */
const editorDollarProps = computed(() => {
  if (!isComponentResource.value || !activeComponent.value) return undefined
  return {
    ...buildDollarProps(activeComponent.value.config),
    ...previewPropOverrides.value,
  }
})

const previewDebugDollarProps = computed(() => editorDollarProps.value ?? {})

const canPreviewGoBack = computed(
  () => workspaceMode.value === 'preview' && pageHistory.value.length > 0,
)

const hasEntryPage = computed(() => {
  const entryId = projectStore.config?.entryPage
  if (entryId && pages.value.some((item) => item.id === entryId)) return true
  return pages.value.some((item) => item.isEntry)
})

function resolveEntryPageId(): string | null {
  const entryId = projectStore.config?.entryPage
  if (entryId && pages.value.some((item) => item.id === entryId)) return entryId
  return pages.value.find((item) => item.isEntry)?.id ?? null
}

function pushPreviewEmitLog(event: string, args: Record<string, unknown>) {
  previewEmitLogSeq += 1
  previewEmitLogs.value = [
    {
      id: previewEmitLogSeq,
      time: new Date().toLocaleTimeString(),
      event,
      args,
    },
    ...previewEmitLogs.value,
  ].slice(0, 80)
}

function createPreviewDebugEmit() {
  if (!isComponentResource.value || !activeComponent.value) return undefined
  return createComponentEmit(
    activeComponent.value.config.events ?? [],
    (eventName, args) => {
      pushPreviewEmitLog(eventName, args)
    },
  )
}

function handlePreviewPropUpdate(name: string, value: unknown) {
  previewPropOverrides.value = {
    ...previewPropOverrides.value,
    [name]: value,
  }
  void runLifecycleUpdateSequence()
}

async function handlePreviewNavigateBack() {
  const prev = pageHistory.value.pop()
  if (!prev) {
    ElMessage.info('没有可返回的页面')
    return
  }
  await openPage(prev.pageId, {
    keepHistory: true,
    params: prev.params,
  })
}

async function handlePreviewGoEntry() {
  const entryId = resolveEntryPageId()
  if (!entryId) {
    ElMessage.warning('未设置入口页')
    return
  }
  await openPage(entryId)
}

async function handlePreviewRefresh() {
  if (!activePageId.value) return
  const pageId = activePageId.value
  const params = { ...routeParams.value }
  const history = pageHistory.value.map((item) => ({
    pageId: item.pageId,
    params: { ...item.params },
  }))
  await openPage(pageId, { keepHistory: true, params })
  pageHistory.value = history
}

/** 调试面板：调用当前预览组件的暴露方法 */
function invokeActiveExposedMethod(methodName: string, args: unknown[]) {
  if (!activeComponent.value || !activeDoc.value) return
  const exposed = activeComponent.value.config.exposedMethods ?? []
  if (!exposed.includes(methodName)) {
    ElMessage.warning(`方法「${methodName}」未在组件中暴露`)
    return
  }
  const method = pageMethods.value.find(
    (item) => item.name === methodName && !item.builtin,
  )
  if (!method?.body?.trim()) {
    ElMessage.warning(`找不到方法「${methodName}」的实现`)
    return
  }

  const eventArgs: Record<string, unknown> = {}
  ;(method.params ?? []).forEach((param, index) => {
    const key = param.name.trim()
    if (!key || key.startsWith('...')) return
    eventArgs[key] = args[index]
  })

  const raw = serializeEventBindings([
    {
      id: `debug_exposed_${methodName}`,
      method: CUSTOM_EVENT_METHOD,
      args: {},
      body: method.body,
    },
  ])

  void runPreviewBindings(raw, {
    eventArgs,
    dollarProps: previewDebugDollarProps.value,
    emitFn: createPreviewDebugEmit(),
  })
}

function previewGetDeviceInfo() {
  return getDeviceInfo({
    platform: canvasScene.value,
    windowWidth: canvasFrameWidth.value,
  })
}

/** 组件方法体 ambient：内置 emit + getDeviceInfo + $props 等 */
const methodAmbientExtra = computed(() => {
  const deviceAmbient = [
    'interface MenuButtonBoundingClientRect { width: number; height: number; top: number; right: number; bottom: number; left: number }',
    'interface DeviceInfo { statusBarHeight: number; userAgent: string; menuButton: MenuButtonBoundingClientRect | null; platform: \'h5\' | \'miniprogram\' }',
    'declare function navigateTo(to: string, params?: Record<string, unknown>): void;',
    'declare function navigateBack(): void;',
    'declare function setData(prop: string, value: any): void;',
    "declare function showToast(message: string, duration?: 'short' | 'long'): void;",
    'declare function getDeviceInfo(): DeviceInfo;',
  ].join('\n')
  const propsAmbient = buildDollarPropsAmbientDeclaration(
    isComponentResource.value ? activeComponent.value?.config.props : null,
  )
  const base = `${deviceAmbient}\n${propsAmbient}\n`
  if (!isComponentResource.value || !activeComponent.value) {
    return base
  }
  return `${base}${buildEmitAmbientDeclarations(activeComponent.value.config.events ?? [])}`
})

/** 展示用方法列表（保证含最新预置方法；剔除已废弃的内置方法） */
const editorMethods = computed(() => {
  const expected = builtinsForRoot(
    isComponentResource.value ? 'components' : 'pages',
  )
  const expectedNames = new Set(expected.map((item) => item.name))
  const list = pageMethods.value.filter(
    (item) => !item.builtin || expectedNames.has(item.name),
  )
  const names = new Set(list.map((item) => item.name))
  const missing = expected.filter((item) => !names.has(item.name))
  if (!missing.length) return list
  const builtins = list.filter((item) => item.builtin)
  const custom = list.filter((item) => !item.builtin)
  return [...builtins, ...missing, ...custom]
})

function parseFrameSize(
  value: string | undefined,
  fallback: number,
): number | 'auto' {
  if (!value || value === 'wrap_content') return 'auto'
  if (value === 'match_parent') return fallback
  const n = Number(value)
  // 0 / 非法固定值不应把画布压成空高度
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const canvasFrameWidth = computed(() => {
  if (isComponentResource.value && activeComponent.value) {
    const parsed = parseFrameSize(
      activeComponent.value.config.width,
      canvasWidth.value,
    )
    return parsed === 'auto' ? Math.min(canvasWidth.value, 320) : parsed
  }
  return canvasWidth.value
})

const canvasFrameHeight = computed(() => {
  if (isComponentResource.value && activeComponent.value) {
    return parseFrameSize(activeComponent.value.config.height, 667)
  }
  return undefined as number | 'auto' | undefined
})
const createDialogTitle = computed(() =>
  isComponentResource.value ? '新建组件' : '新建页面',
)

const isEditMode = computed(() => workspaceMode.value === 'edit')
const isDataPoolMode = computed(() => workspaceMode.value === 'datapool')
const isDataTypesMode = computed(() => workspaceMode.value === 'datatypes')
const isMysqlMode = computed(() => workspaceMode.value === 'mysql')
const isIconsMode = computed(() => workspaceMode.value === 'icons')
const isMethodsMode = computed(() => workspaceMode.value === 'methods')
const isLifecycleMode = computed(() => workspaceMode.value === 'lifecycle')
const hideWidgetTree = computed(
  () =>
    isDataPoolMode.value ||
    isDataTypesMode.value ||
    isMysqlMode.value ||
    isIconsMode.value ||
    isMethodsMode.value ||
    isLifecycleMode.value,
)

const canDeleteSelected = computed(
  () =>
    isEditMode.value &&
    Boolean(activeDoc.value) &&
    canDeleteNode(selectedNodeId.value),
)

const showAddComponentButton = computed(
  () => isEditMode.value && isPageResource.value && Boolean(activePage.value),
)

const iconOptions = computed(() =>
  iconLibrary.value.icons.map((item) => ({
    id: item.id,
    label: item.label,
  })),
)

const modeTabs = [
  { key: 'preview' as const, label: '预览', icon: View },
  { key: 'edit' as const, label: '编辑', icon: EditPen },
  { key: 'datapool' as const, label: '数据池', icon: Coin },
  { key: 'methods' as const, label: '方法', icon: Lightning },
  { key: 'lifecycle' as const, label: '生命周期', icon: LeafIcon },
]

const projectNavItems: { key: ProjectNav; label: string; icon: unknown }[] = [
  { key: 'datatypes', label: '数据类型', icon: Collection },
  { key: 'mysql', label: 'MySQL', icon: MysqlIcon },
  { key: 'icons', label: '图标库', icon: Picture },
]

const isProjectNav = computed(() => projectNav.value !== null)
const showModeTabs = computed(() => !isProjectNav.value)

const centerFileLabel = computed(() => {
  if (isDataPoolMode.value) return 'data.json'
  if (isDataTypesMode.value) return 'types/'
  if (isMysqlMode.value) return 'mysql.json'
  if (isIconsMode.value) return 'icons.json'
  if (isMethodsMode.value) return 'function/'
  if (isLifecycleMode.value) return 'lifecycle.json'
  return 'index.xml'
})

function formatRouteParamValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** 预览态路径后展示 ?id=... 等跳转参数 */
const centerPathQuery = computed(() => {
  if (workspaceMode.value !== 'preview' || isComponentResource.value) return ''
  const entries = Object.entries(routeParams.value)
  if (!entries.length) return ''
  return `?${entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(formatRouteParamValue(value))}`,
    )
    .join('&')}`
})

const propsPlaceholderText = computed(() => {
  if (!activePage.value && !isIconsMode.value && !isDataTypesMode.value && !isMysqlMode.value) {
    return '打开页面后可编辑'
  }
  if (isDataPoolMode.value) return '数据池模式下请在中间区域编辑'
  if (isDataTypesMode.value) return '数据类型模式下请在中间区域编辑'
  if (isMysqlMode.value) return 'MySQL 模式下请在中间区域编辑'
  if (isIconsMode.value) return '图标库模式下请在中间区域编辑'
  if (isMethodsMode.value) return '方法模式下请在中间区域编辑'
  if (isLifecycleMode.value) return '生命周期模式下请在中间区域编辑'
  if (isComponentResource.value && activeComponent.value && !selectedNodeId.value) {
    return '选中控件可编辑样式，或查看组件设置'
  }
  return isComponentResource.value ? '打开组件后可编辑' : '打开页面后可编辑'
})

async function loadPages(selectId?: string) {
  if (!projectStore.path) return

  loadingPages.value = true
  try {
    await Promise.all([loadIconLibrary(), loadDataTypeLibrary(), loadMysqlLibrary()])
    const [pageResult, componentResult] = await Promise.all([
      listPages(projectStore.path),
      listComponents(projectStore.path),
    ])
    pages.value = pageResult.pages
    components.value = componentResult.components
    await refreshComponentMap()

    if (resourceKind.value === 'component') {
      const nextId =
        selectId ||
        (activeComponentId.value &&
        componentResult.components.some((p) => p.id === activeComponentId.value)
          ? activeComponentId.value
          : componentResult.components[0]?.id)
      if (nextId) await openComponent(nextId)
      else {
        activeComponentId.value = ''
        activeComponent.value = null
        selectedNodeId.value = ''
      }
    } else {
      const nextId =
        selectId ||
        (activePageId.value && pageResult.pages.some((p) => p.id === activePageId.value)
          ? activePageId.value
          : pageResult.pages[0]?.id)
      if (nextId) await openPage(nextId)
      else {
        activePageId.value = ''
        activePage.value = null
        selectedNodeId.value = ''
      }
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载列表失败')
  } finally {
    loadingPages.value = false
  }
}

async function loadIconLibrary() {
  if (!projectStore.path) return
  try {
    iconLibrary.value = await getIconLibrary(projectStore.path)
  } catch (err) {
    iconLibrary.value = createEmptyIconLibrary()
    console.error(err)
  }
}

async function loadDataTypeLibrary() {
  if (!projectStore.path) return
  try {
    dataTypeLibrary.value = await getDataTypeLibrary(projectStore.path)
  } catch (err) {
    dataTypeLibrary.value = createEmptyDataTypeLibrary()
    console.error(err)
  }
}

async function loadMysqlLibrary() {
  if (!projectStore.path) return
  try {
    mysqlLibrary.value = await getMysqlLibrary(projectStore.path)
  } catch (err) {
    mysqlLibrary.value = createEmptyMysqlLibrary()
    console.error(err)
  }
}

async function refreshComponentMap() {
  if (!projectStore.path) {
    componentMap.value = {}
    componentMethodsMap.value = {}
    return
  }
  try {
    const { components: list } = await listComponents(projectStore.path)
    const details = await Promise.all(
      list.map((item) => getComponent(projectStore.path!, item.id)),
    )
    const next: ComponentRenderMap = {}
    for (const detail of details) {
      next[detail.id] = {
        id: detail.id,
        config: detail.config,
        xml: detail.xml,
        data: resolveComputedPageData(detail.data, {
          getDeviceInfo: previewGetDeviceInfo,
          dollarProps: buildDollarProps(detail.config),
        }),
      }
    }
    componentMap.value = next

    const methodEntries = await Promise.all(
      details.map(async (detail) => {
        try {
          const { methods } = await listComponentMethods(
            projectStore.path!,
            detail.id,
          )
          return [detail.id, methods] as const
        } catch {
          return [detail.id, [] as PageMethod[]] as const
        }
      }),
    )
    componentMethodsMap.value = Object.fromEntries(methodEntries)
  } catch (err) {
    console.error(err)
  }
}

async function loadPageMethods(pageId?: string) {
  if (!projectStore.path) return
  const id =
    pageId ||
    (isComponentResource.value ? activeComponentId.value : activePageId.value)
  if (!id) {
    pageMethods.value = []
    return
  }
  try {
    const result = isComponentResource.value
      ? await listComponentMethods(projectStore.path, id)
      : await listPageMethods(projectStore.path, id)
    let methods = result.methods
    // 保证预置方法齐全（兼容未重启的旧服务端）
    {
      const expected = builtinsForRoot(
        isComponentResource.value ? 'components' : 'pages',
      )
      const names = new Set(methods.map((item) => item.name))
      const missing = expected.filter((item) => !names.has(item.name))
      if (missing.length) {
        const builtins = methods.filter((item) => item.builtin)
        const custom = methods.filter((item) => !item.builtin)
        methods = [...builtins, ...missing, ...custom]
      }
    }
    pageMethods.value = methods
  } catch (err) {
    pageMethods.value = []
    console.error(err)
  }
}

async function loadLifecycle(resourceId?: string) {
  if (!projectStore.path) return
  const id =
    resourceId ||
    (isComponentResource.value ? activeComponentId.value : activePageId.value)
  if (!id) {
    lifecycleConfig.value = createEmptyLifecycleConfig()
    return
  }
  try {
    const result = isComponentResource.value
      ? await getComponentLifecycle(projectStore.path, id)
      : await getPageLifecycle(projectStore.path, id)
    lifecycleConfig.value = result.lifecycle ?? createEmptyLifecycleConfig()
  } catch (err) {
    lifecycleConfig.value = createEmptyLifecycleConfig()
    console.error(err)
  }
}

async function handleLifecycleUpdate(lifecycle: LifecycleConfig) {
  if (!projectStore.path || !activeDoc.value) return
  lifecycleConfig.value = lifecycle
  if (lifecycleSaveTimer) clearTimeout(lifecycleSaveTimer)
  lifecycleSaveTimer = setTimeout(async () => {
    if (!projectStore.path || !activeDoc.value) return
    try {
      if (isComponentResource.value) {
        const result = await saveComponentLifecycle({
          projectPath: projectStore.path,
          componentId: activeDoc.value.id,
          lifecycle: lifecycleConfig.value,
        })
        lifecycleConfig.value = result.lifecycle
      } else {
        const result = await savePageLifecycle({
          projectPath: projectStore.path,
          pageId: activeDoc.value.id,
          lifecycle: lifecycleConfig.value,
        })
        lifecycleConfig.value = result.lifecycle
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存生命周期失败')
    }
  }, 400)
}

async function openPage(
  pageId: string,
  options?: {
    keepHistory?: boolean
    params?: Record<string, unknown> | null
  },
) {
  if (!projectStore.path) return

  if (!options?.keepHistory) {
    pageHistory.value = []
  }

  if (options?.params !== undefined) {
    routeParams.value =
      options.params && typeof options.params === 'object' && !Array.isArray(options.params)
        ? { ...options.params }
        : {}
  } else if (!options?.keepHistory) {
    routeParams.value = {}
  }

  await teardownLifecycleSession()

  resourceKind.value = 'page'
  activePageId.value = pageId
  activeComponentId.value = ''
  activeComponent.value = null
  selectedNodeId.value = ''
  editorHiddenNodeIds.value = []
  modalStack.closeAll()
  loadingPage.value = true
  try {
    const detail = await getPage(projectStore.path, pageId)
    const migrated = migrateLegacyMaskToModal(detail.xml)
    if (migrated.changed) {
      activePage.value = { ...detail, xml: migrated.xml }
      await Promise.all([loadPageMethods(pageId), loadLifecycle(pageId)])
      await handleXmlUpdate(migrated.xml)
    } else {
      activePage.value = detail
      await Promise.all([loadPageMethods(pageId), loadLifecycle(pageId)])
    }
    if (workspaceMode.value === 'preview') {
      resetPreviewRuntime()
    } else {
      clearPreviewRuntime()
    }
    await syncLifecycleSession()
  } catch (err) {
    activePage.value = null
    pageMethods.value = []
    lifecycleConfig.value = createEmptyLifecycleConfig()
    ElMessage.error(err instanceof Error ? err.message : '打开页面失败')
  } finally {
    loadingPage.value = false
  }
}

async function openComponent(componentId: string) {
  if (!projectStore.path) return
  await teardownLifecycleSession()

  resourceKind.value = 'component'
  activeComponentId.value = componentId
  activePageId.value = ''
  activePage.value = null
  selectedNodeId.value = ''
  editorHiddenNodeIds.value = []
  pageHistory.value = []
  routeParams.value = {}
  modalStack.closeAll()
  loadingPage.value = true
  try {
    const detail = await getComponent(projectStore.path, componentId)
    const migrated = migrateLegacyMaskToModal(detail.xml)
    if (migrated.changed) {
      activeComponent.value = { ...detail, xml: migrated.xml }
      await Promise.all([loadPageMethods(componentId), loadLifecycle(componentId)])
      await handleXmlUpdate(migrated.xml)
    } else {
      activeComponent.value = detail
      await Promise.all([loadPageMethods(componentId), loadLifecycle(componentId)])
    }
    if (workspaceMode.value === 'preview') {
      resetPreviewRuntime()
    } else {
      clearPreviewRuntime()
    }
    await syncLifecycleSession()
  } catch (err) {
    activeComponent.value = null
    pageMethods.value = []
    lifecycleConfig.value = createEmptyLifecycleConfig()
    ElMessage.error(err instanceof Error ? err.message : '打开组件失败')
  } finally {
    loadingPage.value = false
  }
}

function switchResourceKind(kind: ResourceKind) {
  leaveProjectNav()
  if (resourceKind.value === kind) return
  resourceKind.value = kind
  selectedNodeId.value = ''
  // 切换页面/组件资源时保持当前工作模式（编辑/数据池等），不要强制回预览
  if (kind === 'page') {
    const id = activePageId.value || pages.value[0]?.id
    if (id) void openPage(id)
    else {
      activePage.value = null
      pageMethods.value = []
      lifecycleConfig.value = createEmptyLifecycleConfig()
    }
  } else {
    const id = activeComponentId.value || components.value[0]?.id
    if (id) void openComponent(id)
    else {
      activeComponent.value = null
      pageMethods.value = []
      lifecycleConfig.value = createEmptyLifecycleConfig()
    }
  }
}

function leaveProjectNav() {
  if (!projectNav.value) return
  projectNav.value = null
  if (
    workspaceMode.value === 'datatypes' ||
    workspaceMode.value === 'mysql' ||
    workspaceMode.value === 'icons'
  ) {
    workspaceMode.value = 'preview'
  }
}

function selectDevelopNav() {
  leaveProjectNav()
}

function selectProjectNav(nav: ProjectNav) {
  projectNav.value = nav
  workspaceMode.value = nav
}

function setWorkspaceMode(mode: (typeof modeTabs)[number]['key']) {
  projectNav.value = null
  workspaceMode.value = mode
}

function toggleEditorHidden(nodeId: string) {
  const set = new Set(editorHiddenNodeIds.value)
  if (set.has(nodeId)) set.delete(nodeId)
  else set.add(nodeId)
  editorHiddenNodeIds.value = Array.from(set)
}

function openCreateDialog() {
  createForm.id = ''
  createForm.name = ''
  createForm.title = ''
  createVisible.value = true
}

type PageMenuCommand = 'rename' | 'copy' | 'setEntry' | 'delete'

async function handlePageMenuCommand(command: PageMenuCommand, page: PageSummary) {
  if (!projectStore.path) return

  try {
    if (command === 'rename') {
      const { value } = await ElMessageBox.prompt('请输入新的页面名称', '重命名', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: page.name,
        inputPattern: /\S+/,
        inputErrorMessage: '名称不能为空',
      })
      const name = value.trim()
      await savePageConfig({
        projectPath: projectStore.path,
        pageId: page.id,
        name,
      })
      ElMessage.success('已重命名')
      if (activePage.value?.id === page.id) {
        activePage.value = {
          ...activePage.value,
          config: {
            ...activePage.value.config,
            name,
            title:
              activePage.value.config.title === activePage.value.config.name
                ? name
                : activePage.value.config.title,
          },
        }
      }
      pages.value = pages.value.map((item) =>
        item.id === page.id
          ? {
              ...item,
              name,
              title: item.title === item.name ? name : item.title,
            }
          : item,
      )
      return
    }

    if (command === 'copy') {
      const { value } = await ElMessageBox.prompt('请输入新页面 ID', '复制页面', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: `${page.id}_copy`,
        inputPattern: /^[a-zA-Z0-9_-]+$/,
        inputErrorMessage: '仅支持字母、数字、下划线和短横线',
      })
      const newId = value.trim()
      const copied = await copyPage({
        projectPath: projectStore.path,
        pageId: page.id,
        newId,
      })
      ElMessage.success(`已复制为 ${copied.config.name}`)
      await loadPages(copied.id)
      return
    }

    if (command === 'setEntry') {
      const result = await setProjectEntryPage({
        projectPath: projectStore.path,
        pageId: page.id,
      })
      projectStore.setProject(result.path, result.config)
      pages.value = pages.value.map((item) => ({
        ...item,
        isEntry: item.id === page.id,
      }))
      ElMessage.success(`已将「${page.name}」设为入口`)
      return
    }

    if (command === 'delete') {
      await ElMessageBox.confirm(
        `确定删除页面「${page.name}」（${page.id}）吗？此操作不可恢复。`,
        '删除页面',
        {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          confirmButtonClass: 'el-button--danger',
        },
      )
      const result = await deletePage({
        projectPath: projectStore.path,
        pageId: page.id,
      })
      if (result.entryCleared && projectStore.config) {
        const next = { ...projectStore.config }
        delete next.entryPage
        projectStore.setProject(projectStore.path, next)
      }
      ElMessage.success('已删除')
      const nextSelect =
        activePageId.value === page.id
          ? pages.value.find((item) => item.id !== page.id)?.id
          : activePageId.value
      if (activePageId.value === page.id) {
        activePageId.value = ''
        activePage.value = null
      }
      await loadPages(nextSelect || undefined)
    }
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function handleCreatePage() {
  const form = createFormRef.value
  if (!form || !projectStore.path) return

  await form.validate(async (valid: boolean) => {
    if (!valid) return

    creating.value = true
    try {
      if (isComponentResource.value) {
        const component = await createComponent({
          projectPath: projectStore.path,
          id: createForm.id.trim(),
          name: createForm.name.trim(),
          title: createForm.title.trim() || undefined,
        })
        ElMessage.success(`已创建组件：${component.config.name}`)
        createVisible.value = false
        await loadPages(component.id)
      } else {
        const page = await createPage({
          projectPath: projectStore.path,
          id: createForm.id.trim(),
          name: createForm.name.trim(),
          title: createForm.title.trim() || undefined,
        })
        ElMessage.success(`已创建页面：${page.config.name}`)
        createVisible.value = false
        await loadPages(page.id)
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      creating.value = false
    }
  })
}

async function handleXmlUpdate(xml: string) {
  if (!projectStore.path || !activeDoc.value) return

  if (isComponentResource.value && activeComponent.value) {
    activeComponent.value = { ...activeComponent.value, xml }
    if (xmlSaveTimer) clearTimeout(xmlSaveTimer)
    xmlSaveTimer = setTimeout(async () => {
      if (!projectStore.path || !activeComponent.value) return
      try {
        activeComponent.value = await saveComponentXml({
          projectPath: projectStore.path,
          componentId: activeComponent.value.id,
          xml: activeComponent.value.xml,
        })
        await refreshComponentMap()
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存失败')
      }
    }, 280)
    return
  }

  if (!activePage.value) return
  activePage.value = { ...activePage.value, xml }
  if (xmlSaveTimer) clearTimeout(xmlSaveTimer)
  xmlSaveTimer = setTimeout(async () => {
    if (!projectStore.path || !activePage.value) return
    try {
      activePage.value = await savePageXml({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        xml: activePage.value.xml,
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存失败')
    }
  }, 280)
}

async function handleStatusBarUpdate(config: StatusBarConfig) {
  if (!projectStore.path || !activePage.value || isComponentResource.value) return
  const next = normalizeStatusBarConfig(config)
  activePage.value = {
    ...activePage.value,
    config: {
      ...activePage.value.config,
      statusBar: next,
    },
  }
  try {
    const saved = await savePageConfig({
      projectPath: projectStore.path,
      pageId: activePage.value.id,
      name: activePage.value.config.name,
      title: activePage.value.config.title,
      statusBar: next,
    })
    activePage.value = {
      ...activePage.value,
      config: saved.config,
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存状态栏失败')
  }
}

const pageStatusBarConfig = computed(() =>
  normalizeStatusBarConfig(
    isPageResource.value ? activePage.value?.config.statusBar : null,
  ),
)

/** 画布渲染：解析数据池绑定后的状态栏样式 */
const resolvedPageStatusBar = computed(() =>
  resolveStatusBarConfig(
    isPageResource.value ? activePage.value?.config.statusBar : null,
    resolvedPageData.value,
  ),
)

function applyComponentPreviewSetData(
  componentId: string,
  prop: string,
  value: DataFieldValue,
) {
  if (workspaceMode.value !== 'preview') return
  if (!previewComponentMap.value) resetPreviewRuntime()
  const map = previewComponentMap.value
  if (!map) return
  const info = map[componentId]
  if (!info) {
    ElMessage.warning(`组件不存在：${componentId}`)
    return
  }
  const fields = [...(info.data.fields ?? [])]
  const index = fields.findIndex((item) => item.name === prop)
  if (index < 0) {
    ElMessage.warning(`组件数据池不存在字段：${prop}`)
    return
  }
  fields[index] = { ...fields[index], value }
  previewComponentMap.value = {
    ...map,
    [componentId]: {
      ...info,
      data: resolveComputedPageData(
        { fields },
        {
          getDeviceInfo: previewGetDeviceInfo,
          dollarProps: buildDollarProps(info.config),
        },
      ),
    },
  }
}

/** 父页通过引用调用组件「暴露方法」 */
function runComponentExposedMethod(
  componentId: string,
  methodName: string,
  args: unknown[],
) {
  const info = canvasComponentMap.value[componentId]
  if (!info) {
    ElMessage.warning(`组件不存在：${componentId}`)
    return
  }
  const exposed = info.config.exposedMethods ?? []
  if (!exposed.includes(methodName)) {
    ElMessage.warning(`方法「${methodName}」未在组件中暴露`)
    return
  }
  const method = (componentMethodsMap.value[componentId] ?? []).find(
    (item) => item.name === methodName && !item.builtin,
  )
  if (!method?.body?.trim()) {
    ElMessage.warning(`找不到方法「${methodName}」的实现`)
    return
  }

  const eventArgs: Record<string, unknown> = {}
  ;(method.params ?? []).forEach((param, index) => {
    const key = param.name.trim()
    if (!key || key.startsWith('...')) return
    eventArgs[key] = args[index]
  })

  const raw = serializeEventBindings([
    {
      id: `exposed_${methodName}`,
      method: CUSTOM_EVENT_METHOD,
      args: {},
      body: method.body,
    },
  ])

  void runEventBindings(raw, {
    pageData: info.data,
    xml: info.xml,
    modalStack,
    componentMap: canvasComponentMap.value,
    componentMethodsMap: componentMethodsMap.value,
    runComponentMethod: runComponentExposedMethod,
    resolveMethod: (name) =>
      (componentMethodsMap.value[componentId] ?? []).find(
        (item) => item.name === name && !item.builtin,
      ),
    eventArgs,
    hasPage: (pageId) => pages.value.some((item) => item.id === pageId),
    navigateTo: async () => {
      ElMessage.info('组件内暂不支持 navigateTo')
    },
    navigateBack: async () => {
      ElMessage.info('组件内暂不支持 navigateBack')
    },
    setData: (prop, value) => {
      applyComponentPreviewSetData(componentId, prop, value)
    },
    showToast: (message, duration) => {
      showPreviewToast(message, duration)
    },
    getDeviceInfo: previewGetDeviceInfo,
    onUnknownMethod: (name) => {
      if (name.startsWith('自定义方法')) ElMessage.error(name)
    },
  })
}

async function runPreviewBindings(
  raw: string | undefined,
  options?: {
    scope?: PreviewInteractPayload['scope']
    eventArgs?: Record<string, unknown>
    dollarProps?: Record<string, unknown>
    emitFn?: (event: string, ...args: unknown[]) => void
    emitWithArgs?: (event: string, args: Record<string, string>) => void
  },
) {
  if (!activeDoc.value) return
  const debugEmit = options?.emitFn ?? createPreviewDebugEmit()
  const debugEmitWithArgs =
    options?.emitWithArgs ??
    (isComponentResource.value
      ? (eventName: string, args: Record<string, string>) => {
          pushPreviewEmitLog(eventName, { ...args })
        }
      : undefined)
  await runEventBindings(raw, {
    pageData: resolvedPageData.value,
    xml: activeDoc.value.xml,
    modalStack,
    componentMap: canvasComponentMap.value,
    componentMethodsMap: componentMethodsMap.value,
    runComponentMethod: runComponentExposedMethod,
    resolveMethod: (name) =>
      pageMethods.value.find((item) => item.name === name && !item.builtin),
    scope: options?.scope,
    eventArgs: options?.eventArgs,
    dollarProps: options?.dollarProps ?? editorDollarProps.value,
    emit: debugEmit,
    emitWithArgs: debugEmitWithArgs,
    hasPage: (pageId) => pages.value.some((item) => item.id === pageId),
    navigateTo: async (pageId, params) => {
      if (activePageId.value && activePageId.value !== pageId) {
        pageHistory.value.push({
          pageId: activePageId.value,
          params: { ...routeParams.value },
        })
      }
      await openPage(pageId, {
        keepHistory: true,
        params:
          params && typeof params === 'object' && !Array.isArray(params)
            ? params
            : {},
      })
    },
    navigateBack: async () => {
      const prev = pageHistory.value.pop()
      if (!prev) {
        ElMessage.info('没有可返回的页面')
        return
      }
      await openPage(prev.pageId, {
        keepHistory: true,
        params: prev.params,
      })
    },
    setData: (prop, value) => {
      applyPreviewSetData(prop, value)
    },
    showToast: (message, duration) => {
      showPreviewToast(message, duration)
    },
    getDeviceInfo: previewGetDeviceInfo,
    onUnknownMethod: (name) => {
      if (name.startsWith('navigateTo:')) {
        ElMessage.warning(name.replace(/^navigateTo:\s*/, ''))
      } else if (name.startsWith('自定义方法')) {
        ElMessage.error(name)
      }
    },
  })
}

async function runLifecycleHook(key: LifecycleHookKey) {
  const raw = lifecycleConfig.value[key]
  if (!raw?.trim()) return
  await runPreviewBindings(raw)
}

async function teardownLifecycleSession() {
  if (!lifecycleSessionActive) return
  for (const key of LIFECYCLE_UNMOUNT_KEYS) {
    await runLifecycleHook(key)
  }
  lifecycleSessionActive = false
}

async function setupLifecycleSession() {
  if (workspaceMode.value !== 'preview' || !activeDoc.value) return
  if (lifecycleSessionActive) return
  lifecycleSessionActive = true
  for (const key of LIFECYCLE_MOUNT_KEYS) {
    await runLifecycleHook(key)
  }
}

async function syncLifecycleSession() {
  if (workspaceMode.value === 'preview' && activeDoc.value) {
    await setupLifecycleSession()
  }
}

async function runLifecycleUpdateSequence() {
  if (!lifecycleSessionActive || workspaceMode.value !== 'preview') return
  for (const key of LIFECYCLE_UPDATE_KEYS) {
    await runLifecycleHook(key)
  }
}

watch(workspaceMode, async (mode, prev) => {
  if (prev === 'preview' && mode !== 'preview') {
    await teardownLifecycleSession()
    clearPreviewRuntime()
    return
  }
  if (mode === 'preview' && prev !== 'preview') {
    resetPreviewRuntime()
    await nextTick()
    await syncLifecycleSession()
  }
})

async function handlePreviewInteract(payload: PreviewInteractPayload) {
  if (workspaceMode.value !== 'preview' || !activeDoc.value) return

  const hostEmit = payload.componentEmit

  const dispatchHostEvent = (
    eventName: string,
    args: Record<string, unknown>,
  ) => {
    if (!hostEmit) return
    const raw = hostEmit.hostAttrs[eventName]
    if (!raw?.trim()) return
    void runPreviewBindings(raw, {
      scope: hostEmit.hostScope ?? payload.scope,
      eventArgs: args,
    })
  }

  const emitFn = hostEmit
    ? createComponentEmit(hostEmit.events, dispatchHostEvent)
    : undefined

  const emitWithArgs = hostEmit
    ? (eventName: string, args: Record<string, string>) => {
        // 按事件形参名打包；未声明的键一并带上
        const params =
          hostEmit.events.find((item) => item.name.trim() === eventName)
            ?.params ?? []
        const packed: Record<string, unknown> = {}
        for (const param of params) {
          const key = param.name.trim()
          if (!key || key.startsWith('...')) continue
          if (key in args) packed[key] = args[key]
        }
        for (const [key, value] of Object.entries(args)) {
          if (!(key in packed)) packed[key] = value
        }
        dispatchHostEvent(eventName, packed)
      }
    : undefined

  await runPreviewBindings(payload.raw, {
    scope: payload.scope,
    eventArgs: payload.eventArgs,
    dollarProps: payload.dollarProps,
    emitFn,
    emitWithArgs,
  })
}

function applyPreviewSetData(prop: string, value: import('../types/page-data').DataFieldValue) {
  if (!activeDoc.value || workspaceMode.value !== 'preview') return
  if (!previewRuntimeData.value) resetPreviewRuntime()
  const fields = [...(previewRuntimeData.value?.fields ?? [])]
  const index = fields.findIndex((item) => item.name === prop)
  if (index < 0) {
    ElMessage.warning(`数据池不存在字段：${prop}`)
    return
  }
  fields[index] = { ...fields[index], value }
  previewRuntimeData.value = { fields }
  void runLifecycleUpdateSequence()
}

async function handleDataUpdate(data: import('../types/page-data').PageData) {
  if (!projectStore.path || !activeDoc.value) return

  /** 仅持久化已命名字段；空白草稿行留在本地，避免保存回写后被服务端过滤掉 */
  const persistableData = (): import('../types/page-data').PageData => ({
    fields: (activeDoc.value?.data.fields ?? []).filter((item) => {
      const name = item.name.trim()
      return Boolean(name) && name !== '$props'
    }),
  })

  if (isComponentResource.value && activeComponent.value) {
    activeComponent.value = { ...activeComponent.value, data }
    if (dataSaveTimer) clearTimeout(dataSaveTimer)
    dataSaveTimer = setTimeout(async () => {
      if (!projectStore.path || !activeComponent.value) return
      try {
        await saveComponentData({
          projectPath: projectStore.path,
          componentId: activeComponent.value.id,
          data: persistableData(),
        })
        // 不把服务端结果写回 data：避免清空未命名的「添加字段」草稿行
        await refreshComponentMap()
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存数据池失败')
      }
    }, 400)
    return
  }

  if (!activePage.value) return
  activePage.value = { ...activePage.value, data }

  if (dataSaveTimer) clearTimeout(dataSaveTimer)
  dataSaveTimer = setTimeout(async () => {
    if (!projectStore.path || !activePage.value) return
    try {
      await savePageData({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        data: persistableData(),
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存数据池失败')
    }
  }, 400)
}

async function handleComponentConfigUpdate(config: ComponentConfig) {
  if (!projectStore.path || !activeComponent.value) return
  activeComponent.value = { ...activeComponent.value, config }
  try {
    activeComponent.value = await saveComponentConfig({
      projectPath: projectStore.path,
      componentId: activeComponent.value.id,
      config,
    })
    await refreshComponentMap()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存组件配置失败')
  }
}

let dataSaveTimer: ReturnType<typeof setTimeout> | null = null
let iconSaveTimer: ReturnType<typeof setTimeout> | null = null
let dataTypeSaveTimer: ReturnType<typeof setTimeout> | null = null
let xmlSaveTimer: ReturnType<typeof setTimeout> | null = null

async function handleIconLibraryUpdate(library: IconLibrary) {
  if (!projectStore.path) return
  iconLibrary.value = library

  if (iconSaveTimer) clearTimeout(iconSaveTimer)
  iconSaveTimer = setTimeout(async () => {
    if (!projectStore.path) return
    try {
      iconLibrary.value = await saveIconLibraryApi({
        projectPath: projectStore.path,
        icons: iconLibrary.value.icons,
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存图标库失败')
    }
  }, 400)
}

async function handleDataTypeLibraryUpdate(library: DataTypeLibrary) {
  if (!projectStore.path) return
  dataTypeLibrary.value = library

  if (dataTypeSaveTimer) clearTimeout(dataTypeSaveTimer)
  dataTypeSaveTimer = setTimeout(async () => {
    if (!projectStore.path) return
    try {
      dataTypeLibrary.value = await saveDataTypeLibraryApi({
        projectPath: projectStore.path,
        groups: dataTypeLibrary.value.groups,
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存数据类型失败')
    }
  }, 400)
}

let mysqlSaveTimer: ReturnType<typeof setTimeout> | null = null

async function handleMysqlLibraryUpdate(library: MysqlLibrary) {
  if (!projectStore.path) return
  mysqlLibrary.value = library

  if (mysqlSaveTimer) clearTimeout(mysqlSaveTimer)
  mysqlSaveTimer = setTimeout(async () => {
    if (!projectStore.path) return
    try {
      mysqlLibrary.value = await saveMysqlLibraryApi({
        projectPath: projectStore.path,
        databases: mysqlLibrary.value.databases,
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存 MySQL 配置失败')
    }
  }, 400)
}

function openAddMethod() {
  editingMethod.value = createEmptyMethod()
  methodDialogVisible.value = true
}

function openEditMethod(method: PageMethod) {
  editingMethod.value = { ...method, params: method.params.map((p) => ({ ...p })) }
  methodDialogVisible.value = true
}

async function handleSaveMethod(method: PageMethod, previousName?: string) {
  if (!projectStore.path || !activeDoc.value) return
  try {
    const previous =
      previousName && previousName !== method.name ? previousName : undefined
    if (isComponentResource.value && activeComponent.value) {
      await saveComponentMethod({
        projectPath: projectStore.path,
        componentId: activeComponent.value.id,
        method,
        previousName: previous,
      })
    } else if (activePage.value) {
      await savePageMethod({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        method,
        previousName: previous,
      })
    }
    ElMessage.success('方法已保存')
    await loadPageMethods()
    if (isComponentResource.value && activeComponent.value) {
      componentMethodsMap.value = {
        ...componentMethodsMap.value,
        [activeComponent.value.id]: [...pageMethods.value],
      }
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存方法失败')
  }
}

async function handleRemoveMethod(method: PageMethod) {
  if (!projectStore.path || !activeDoc.value || method.builtin) return
  try {
    await ElMessageBox.confirm(
      `确定删除方法「${method.name}」？对应 .ts 文件将一并删除。`,
      '删除方法',
      { type: 'warning' },
    )
    if (isComponentResource.value && activeComponent.value) {
      await deleteComponentMethod({
        projectPath: projectStore.path,
        componentId: activeComponent.value.id,
        name: method.name,
      })
    } else if (activePage.value) {
      await deletePageMethod({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        name: method.name,
      })
    }
    ElMessage.success('已删除')
    await loadPageMethods()
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof Error ? err.message : '删除方法失败')
  }
}

function openAddWidgetDialog() {
  if (!activeDoc.value) return
  addWidgetVisible.value = true
}

function openAddComponentDialog() {
  if (!activePage.value) return
  addComponentVisible.value = true
}

async function handleAddComponentInstance(component: ComponentSummary) {
  if (!activePage.value || !projectStore.path) return
  try {
    let width = 'match_parent'
    let height = 'wrap_content'
    let name = component.name
    try {
      const detail = await getComponent(projectStore.path, component.id)
      width = detail.config.width || width
      height = detail.config.height || height
      name = detail.config.name || name
    } catch {
      // defaults
    }
    const { xml, newNodeId } = appendComponent(
      activePage.value.xml,
      selectedNodeId.value,
      {
        componentId: component.id,
        name,
        width,
        height,
      },
    )
    selectedNodeId.value = newNodeId
    addComponentVisible.value = false
    await handleXmlUpdate(xml)
    ElMessage.success(`已添加组件 ${name}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加组件失败')
  }
}

async function handleOpenRepeatConfig(nodeId: string) {
  if (!isEditMode.value || !nodeId) return
  selectedNodeId.value = nodeId
  propsTab.value = 'dynamic'
  await nextTick()
  openRepeatRequest.value += 1
}

async function handleAddWidget(tag: WidgetTag) {
  if (!activeDoc.value) return

  try {
    const { xml, newNodeId } = appendWidget(
      activeDoc.value.xml,
      selectedNodeId.value,
      tag,
      { allowRootSiblings: resourceKind.value === 'component' },
    )
    addWidgetVisible.value = false
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    ElMessage.success(`已添加 ${tag}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加控件失败')
  }
}

async function handleDeleteWidget() {
  if (!activeDoc.value || !canDeleteNode(selectedNodeId.value)) return

  const node = selectedNodeId.value
  try {
    await ElMessageBox.confirm(
      '删除后无法恢复，确定要删除该控件吗？',
      '删除控件',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  try {
    const { xml, parentId } = removeWidget(activeDoc.value.xml, node)
    selectedNodeId.value = parentId
    await handleXmlUpdate(xml)
    ElMessage.success('已删除控件')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除控件失败')
  }
}

async function handleMoveWidget(payload: {
  sourceId: string
  targetId: string
  position: MovePosition
}) {
  if (!activeDoc.value || !isEditMode.value) return

  try {
    const { xml, newNodeId } = moveWidget(
      activeDoc.value.xml,
      payload.sourceId,
      payload.targetId,
      payload.position,
    )
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    ElMessage.success('已调整控件结构')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '移动控件失败')
  }
}

onMounted(() => {
  void loadPages()
})
</script>

<template>
  <div class="workspace">
    <nav class="activity-rail" aria-label="项目资源">
      <el-tooltip content="开发" placement="right">
        <button
          type="button"
          class="rail-btn"
          :class="{ active: !isProjectNav }"
          @click="selectDevelopNav"
        >
          <el-icon :size="20"><DevelopIcon /></el-icon>
        </button>
      </el-tooltip>
      <div class="rail-divider" />
      <el-tooltip
        v-for="item in projectNavItems"
        :key="item.key"
        :content="item.label"
        placement="right"
      >
        <button
          type="button"
          class="rail-btn"
          :class="{ active: projectNav === item.key }"
          @click="selectProjectNav(item.key)"
        >
          <el-icon :size="20"><component :is="item.icon" /></el-icon>
        </button>
      </el-tooltip>
    </nav>

    <aside v-if="!isProjectNav" class="side-panel">
      <div class="pages-section">
        <div class="section-header">
          <div class="resource-tabs">
            <button
              type="button"
              class="resource-tab"
              :class="{ active: isPageResource }"
              @click="switchResourceKind('page')"
            >
              页面
            </button>
            <button
              type="button"
              class="resource-tab"
              :class="{ active: isComponentResource }"
              @click="switchResourceKind('component')"
            >
              组件
            </button>
          </div>
          <el-button type="primary" :icon="Plus" size="small" @click="openCreateDialog">
            新建
          </el-button>
        </div>

        <div class="pages-body">
          <template v-if="isPageResource">
            <el-skeleton v-if="loadingPages && !pages.length" :rows="4" animated />
            <el-empty v-else-if="!pages.length" description="暂无页面，点击新建" :image-size="64" />
            <div v-else class="page-list">
              <el-dropdown
                v-for="page in pages"
                :key="page.id"
                trigger="contextmenu"
                class="page-dropdown"
                @command="(cmd) => handlePageMenuCommand(cmd as PageMenuCommand, page)"
              >
                <button
                  type="button"
                  class="page-item"
                  :class="{ active: page.id === activePageId, entry: page.isEntry }"
                  @click="openPage(page.id)"
                  @contextmenu.prevent
                >
                  <el-icon><Document /></el-icon>
                  <div class="page-meta">
                    <div class="page-name">
                      <span>{{ page.name }}</span>
                      <span v-if="page.isEntry" class="entry-badge">入口</span>
                    </div>
                    <div class="page-id">{{ page.id }}</div>
                  </div>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="copy">复制</el-dropdown-item>
                    <el-dropdown-item command="setEntry" :disabled="page.isEntry">
                      设为入口
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided>
                      删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
          <template v-else>
            <el-skeleton v-if="loadingPages && !components.length" :rows="4" animated />
            <el-empty
              v-else-if="!components.length"
              description="暂无组件，点击新建"
              :image-size="64"
            />
            <div v-else class="page-list">
              <button
                v-for="item in components"
                :key="item.id"
                type="button"
                class="page-item"
                :class="{ active: item.id === activeComponentId }"
                @click="openComponent(item.id)"
              >
                <el-icon><Box /></el-icon>
                <div class="page-meta">
                  <div class="page-name">{{ item.name }}</div>
                  <div class="page-id">{{ item.id }}</div>
                </div>
              </button>
            </div>
          </template>
        </div>
      </div>

      <WidgetTree
        v-if="activeDoc && !hideWidgetTree"
        :xml="activeDoc.xml"
        :selected-id="selectedNodeId"
        :editable="isEditMode"
        :hidden-ids="editorHiddenNodeIds"
        :include-status-bar="isPageResource"
        @select="selectedNodeId = $event"
        @open-repeat="handleOpenRepeatConfig"
        @move="handleMoveWidget"
        @toggle-hidden="toggleEditorHidden"
      />
    </aside>

    <section class="center-panel">
      <div class="preview-header">
        <template v-if="isIconsMode">
          <span class="preview-title">图标库</span>
          <span class="preview-sub">icons.json</span>
        </template>
        <template v-else-if="isDataTypesMode">
          <span class="preview-title">数据类型</span>
          <span class="preview-sub">types/</span>
        </template>
        <template v-else-if="isMysqlMode">
          <span class="preview-title">MySQL</span>
          <span class="preview-sub">mysql.json</span>
        </template>
        <template v-else-if="activeDoc">
          <span class="preview-title">{{ activeDoc.config.title || activeDoc.config.name }}</span>
          <span class="preview-sub">
            {{ isComponentResource ? 'components' : 'pages' }}/{{ activeDoc.id }}/{{ centerFileLabel }}{{ centerPathQuery }}
          </span>
        </template>
        <span v-else class="preview-title">{{ isComponentResource ? '组件预览' : '页面预览' }}</span>
      </div>

      <div class="preview-body">
        <el-skeleton v-if="loadingPage" :rows="8" animated />
        <IconLibraryPanel
          v-else-if="isIconsMode"
          :library="iconLibrary"
          @update:library="handleIconLibraryUpdate"
        />
        <DataTypesPanel
          v-else-if="isDataTypesMode"
          :library="dataTypeLibrary"
          @update:library="handleDataTypeLibraryUpdate"
        />
        <MysqlPanel
          v-else-if="isMysqlMode"
          :library="mysqlLibrary"
          :type-library="dataTypeLibrary"
          @update:library="handleMysqlLibraryUpdate"
          @update:type-library="handleDataTypeLibraryUpdate"
        />
        <el-empty
          v-else-if="!activeDoc"
          :description="isComponentResource ? '请选择或新建一个组件' : '请选择或新建一个页面'"
        />
        <DataPoolPanel
          v-else-if="isDataPoolMode"
          :data="activeDoc.data ?? { fields: [] }"
          :xml="activeDoc.xml"
          :icon-options="iconOptions"
          :get-device-info="previewGetDeviceInfo"
          :component-props="editorConditionComponentProps"
          :dollar-props="editorDollarProps"
          :type-library="dataTypeLibrary"
          @update:data="handleDataUpdate"
        />
        <MethodsPanel
          v-else-if="isMethodsMode"
          :methods="editorMethods"
          :for-component="isComponentResource"
          @add="openAddMethod"
          @edit="openEditMethod"
          @remove="handleRemoveMethod"
        />
        <LifecyclePanel
          v-else-if="isLifecycleMode"
          :lifecycle="lifecycleConfig"
          :methods="editorMethods"
          :for-component="isComponentResource"
          :data-fields="activeDoc.data?.fields ?? []"
          :xml="activeDoc.xml"
          :component-map="componentMap"
          :component-methods-map="componentMethodsMap"
          :icon-options="iconOptions"
          :emit-events="isComponentResource ? activeComponent?.config.events : undefined"
          @update:lifecycle="handleLifecycleUpdate"
        />
        <PageCanvas
          v-else
          v-model:pan-x="canvasPanX"
          v-model:pan-y="canvasPanY"
          v-model:zoom="canvasZoom"
          v-model:scene="canvasScene"
          :modal-stack="modalStack"
          :xml="activeDoc.xml"
          :canvas-width="canvasFrameWidth"
          :canvas-height="canvasFrameHeight === undefined ? undefined : canvasFrameHeight"
          :selected-id="selectedNodeId"
          :selectable="isEditMode"
          :show-add-button="isEditMode"
          :show-add-component-button="showAddComponentButton"
          :show-delete-button="canDeleteSelected"
          :expand-repeat="workspaceMode === 'preview'"
          :page-data="resolvedPageData"
          :icon-library="iconLibrary"
          :component-map="canvasComponentMap"
          :dollar-props="editorDollarProps"
          :route-params="routeParams"
          :hidden-node-ids="isEditMode ? editorHiddenNodeIds : undefined"
          :toast="workspaceMode === 'preview' ? previewToast : null"
          :show-device-chrome="!isComponentResource"
          :status-bar-selectable="isEditMode && isPageResource"
          :status-bar-background="resolvedPageStatusBar.backgroundColor"
          :status-bar-text-style="resolvedPageStatusBar.textStyle"
          :status-bar-cover="resolvedPageStatusBar.cover"
          @select="selectedNodeId = $event"
          @open-repeat="handleOpenRepeatConfig"
          @interact="handlePreviewInteract"
          @add="openAddWidgetDialog"
          @add-component="openAddComponentDialog"
          @delete="handleDeleteWidget"
        />
      </div>

      <div v-if="showModeTabs" class="mode-tabs">
        <el-tooltip
          v-for="tab in modeTabs"
          :key="tab.key"
          :content="tab.label"
          placement="top"
        >
          <button
            type="button"
            class="mode-tab"
            :class="{ active: workspaceMode === tab.key }"
            @click="setWorkspaceMode(tab.key)"
          >
            <el-icon :size="18"><component :is="tab.icon" /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </section>

    <template v-if="activeDoc && isEditMode && isComponentResource">
      <ComponentMetaPanel
        v-if="!selectedNodeId"
        :config="activeComponent!.config"
        :methods="editorMethods"
        :icon-options="iconOptions"
        :type-library="dataTypeLibrary"
        @update:config="handleComponentConfigUpdate"
      />
      <div v-else class="props-with-back">
        <button type="button" class="back-component-meta" @click="selectedNodeId = ''">
          ← 返回组件设置
        </button>
        <PropsPanel
          v-model:tab="propsTab"
          :xml="activeDoc.xml"
          :selected-id="selectedNodeId"
          :data-fields="activeDoc.data?.fields ?? []"
          :icon-options="iconOptions"
          :methods="editorMethods"
          :emit-events="activeComponent?.config.events"
          :component-props="editorConditionComponentProps"
          :route-params="null"
          :component-map="componentMap"
          :component-methods-map="componentMethodsMap"
          :open-repeat-request="openRepeatRequest"
          @update:xml="handleXmlUpdate"
        />
      </div>
    </template>
    <PropsPanel
      v-else-if="activeDoc && isEditMode"
      v-model:tab="propsTab"
      :xml="activeDoc.xml"
      :selected-id="selectedNodeId"
      :data-fields="activeDoc.data?.fields ?? []"
      :icon-options="iconOptions"
      :methods="editorMethods"
      :component-props="null"
      :route-params="routeParams"
      :component-map="componentMap"
      :component-methods-map="componentMethodsMap"
      :open-repeat-request="openRepeatRequest"
      :status-bar-config="isPageResource ? pageStatusBarConfig : null"
      :canvas-scene="canvasScene"
      @update:xml="handleXmlUpdate"
      @update:status-bar="handleStatusBarUpdate"
    />
    <PreviewDebugPanel
      v-else-if="workspaceMode === 'preview' && activeDoc"
      :mode="isComponentResource ? 'component' : 'page'"
      :can-go-back="canPreviewGoBack"
      :has-entry-page="hasEntryPage"
      :config="activeComponent?.config"
      :methods="editorMethods"
      :prop-values="previewDebugDollarProps"
      :emit-logs="previewEmitLogs"
      @back="handlePreviewNavigateBack"
      @go-entry="handlePreviewGoEntry"
      @refresh="handlePreviewRefresh"
      @update:prop="handlePreviewPropUpdate"
      @invoke-method="invokeActiveExposedMethod($event.name, $event.args)"
      @clear-emit-logs="previewEmitLogs = []"
    />
    <aside v-else class="props-placeholder">
      <div class="panel-header">属性</div>
      <el-empty
        :description="propsPlaceholderText"
        :image-size="64"
      />
    </aside>

    <MethodEditDialog
      v-model="methodDialogVisible"
      :method="editingMethod"
      :data-fields="activeDoc?.data?.fields ?? []"
      :xml="activeDoc?.xml"
      :component-map="componentMap"
      :component-methods-map="componentMethodsMap"
      :ambient-extra="methodAmbientExtra"
      @save="handleSaveMethod"
    />

    <el-dialog v-model="createVisible" :title="createDialogTitle" width="480px" destroy-on-close>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="88px">
        <el-form-item :label="isComponentResource ? '组件 ID' : '页面 ID'" prop="id">
          <el-input
            v-model="createForm.id"
            :placeholder="isComponentResource ? '例如：nav-bar' : '例如：home'"
          />
        </el-form-item>
        <el-form-item :label="isComponentResource ? '组件名称' : '页面名称'" prop="name">
          <el-input
            v-model="createForm.name"
            :placeholder="isComponentResource ? '例如：导航栏' : '例如：首页'"
          />
        </el-form-item>
        <el-form-item :label="isComponentResource ? '组件标题' : '页面标题'">
          <el-input v-model="createForm.title" placeholder="可选，默认与名称相同" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreatePage">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="addComponentVisible"
      title="添加组件"
      width="480px"
      destroy-on-close
    >
      <p class="add-hint">从组件列表选择，插入为 Component 节点。</p>
      <el-empty
        v-if="!components.length"
        description="暂无组件，请先在「组件」中新建"
        :image-size="64"
      />
      <div v-else class="widget-options">
        <button
          v-for="item in components"
          :key="item.id"
          type="button"
          class="widget-option"
          @click="handleAddComponentInstance(item)"
        >
          <div class="widget-option-title">{{ item.name }}</div>
          <div class="widget-option-desc">{{ item.id }}</div>
        </button>
      </div>
    </el-dialog>

    <el-dialog
      v-model="addWidgetVisible"
      title="添加控件"
      width="480px"
      destroy-on-close
    >
      <p class="add-hint">
        将添加到当前选中的布局容器；若选中的是 Text/Button，则添加到其父布局。
      </p>
      <div class="widget-options">
        <button
          v-for="item in WIDGET_OPTIONS"
          :key="item.tag"
          type="button"
          class="widget-option"
          @click="handleAddWidget(item.tag)"
        >
          <div class="widget-option-title">{{ item.label }}</div>
          <div class="widget-option-desc">{{ item.description }}</div>
        </button>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.activity-rail {
  width: 52px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 0;
  background: #fff;
  border-right: 1px solid #ebeef5;
}

.rail-divider {
  width: 24px;
  height: 1px;
  margin: 4px 0;
  background: #ebeef5;
}

.rail-btn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}

.rail-btn:hover {
  background: #f5f7fa;
  color: #303133;
}

.rail-btn.active {
  background: #ecf5ff;
  color: #409eff;
}

.side-panel {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #fff;
  border-right: 1px solid #ebeef5;
}

.pages-section {
  display: flex;
  flex-direction: column;
  flex: 0 0 42%;
  min-height: 160px;
  max-height: 50%;
  overflow: hidden;
}

.resource-tabs {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: #f1f5f9;
}

.resource-tab {
  border: none;
  background: transparent;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
}

.resource-tab.active {
  background: #fff;
  color: #303133;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.section-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid #ebeef5;
  font-weight: 600;
  color: #303133;
}

.pages-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.page-list {
  display: flex;
  flex-direction: column;
}

.page-dropdown {
  display: block;
  width: 100%;
  margin-bottom: 4px;
}

.page-dropdown :deep(.el-tooltip__trigger) {
  display: block;
  width: 100%;
}

.page-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #303133;
}

.page-item:hover {
  background: #f5f7fa;
}

.page-item.active {
  background: #ecf5ff;
  color: #409eff;
}

.page-meta {
  min-width: 0;
  flex: 1;
}

.page-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
}

.entry-badge {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  color: #e6a23c;
  background: #fdf6ec;
}

.page-id {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.center-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}

.preview-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  line-height: 1;
}

.preview-sub {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.3;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.mode-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  background: #fff;
  border-top: 1px solid #ebeef5;
}

.mode-tab {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}

.mode-tab:hover {
  background: #f5f7fa;
  color: #303133;
}

.mode-tab.active {
  background: #ecf5ff;
  color: #409eff;
}

.props-with-back {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #fff;
  border-left: 1px solid #ebeef5;
}

.back-component-meta {
  flex-shrink: 0;
  border: none;
  background: #f8fafc;
  border-bottom: 1px solid #ebeef5;
  text-align: left;
  padding: 10px 14px;
  font-size: 12px;
  color: #409eff;
  cursor: pointer;
}

.back-component-meta:hover {
  background: #ecf5ff;
}

.props-with-back :deep(.props-panel) {
  width: 100%;
  border-left: none;
}

.props-placeholder {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-left: 1px solid #ebeef5;
}

.panel-header {
  flex-shrink: 0;
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.add-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}

.widget-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.widget-option {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.widget-option:hover {
  border-color: #409eff;
  background: #ecf5ff;
}

.widget-option-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.widget-option-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
