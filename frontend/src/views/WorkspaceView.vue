<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Box,
  Coin,
  Collection,
  Connection,
  Cpu,
  Document,
  EditPen,
  Lightning,
  Picture,
  Plus,
  Timer,
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
  type PageConfig,
  type PageDetail,
  type PageSummary,
} from '../api/pages'
import { createModalStack } from '../composables/useModalStack'
import {
  createComponent,
  deleteComponent,
  deleteComponentMethod,
  getComponent,
  getComponentLifecycle,
  listComponentMethods,
  listComponents,
  renameComponent,
  saveComponentConfig,
  saveComponentData,
  saveComponentLifecycle,
  saveComponentMethod,
  saveComponentXml,
  type ComponentDetail,
} from '../api/components'
import {
  getBackendServiceLibrary,
  getDataTypeLibrary,
  getIconLibrary,
  getMysqlLibrary,
  getOssLibrary,
  saveBackendServiceLibrary as saveBackendServiceLibraryApi,
  saveDataTypeLibrary as saveDataTypeLibraryApi,
  saveIconLibrary as saveIconLibraryApi,
  saveMysqlLibrary as saveMysqlLibraryApi,
  saveOssLibrary as saveOssLibraryApi,
  setProjectEntryPage,
} from '../api/projects'
import DataPoolPanel from '../components/editor/DataPoolPanel.vue'
import DataTypesPanel from '../components/editor/DataTypesPanel.vue'
import MysqlPanel from '../components/editor/MysqlPanel.vue'
import OssPanel from '../components/editor/OssPanel.vue'
import BackendServiceEditor from '../components/editor/BackendServiceEditor.vue'
import BackendServiceWorkspace from '../components/editor/BackendServiceWorkspace.vue'
import DataMethodDebugPanel from '../components/editor/DataMethodDebugPanel.vue'
import MethodFlowDebugPanel from '../components/editor/MethodFlowDebugPanel.vue'
import type {
  ProcessorDebugTarget,
  ProcessorSelectionState,
} from '../components/editor/ServiceProcessorPanel.vue'
import IconLibraryPanel from '../components/editor/IconLibraryPanel.vue'
import MethodEditDialog from '../components/editor/MethodEditDialog.vue'
import MethodsPanel from '../components/editor/MethodsPanel.vue'
import LifecyclePanel from '../components/editor/LifecyclePanel.vue'
import LeafIcon from '../components/icons/LeafIcon.vue'
import MysqlIcon from '../components/icons/MysqlIcon.vue'
import OssIcon from '../components/icons/OssIcon.vue'
import DevelopIcon from '../components/icons/DevelopIcon.vue'
import BackendIcon from '../components/icons/BackendIcon.vue'
import ComponentMetaPanel from '../components/editor/ComponentMetaPanel.vue'
import PreviewDebugPanel, {
  type EmitLogEntry,
} from '../components/editor/PreviewDebugPanel.vue'
import PreviewCanvasToolbar from '../components/editor/PreviewCanvasToolbar.vue'
import PropsPanel, { type PropsTab } from '../components/editor/PropsPanel.vue'
import PageCanvas from '../components/xml/PageCanvas.vue'
import WidgetTree from '../components/xml/WidgetTree.vue'
import { useProjectStore } from '../stores/project'
import {
  buildEmitAmbientDeclarations,
  buildLocalMethodsAmbientDeclarations,
  buildTypeLibraryAmbientDeclarations,
  builtinsForRoot,
  coerceEmitParamValue,
  createEmptyMethod,
  CUSTOM_EVENT_METHOD,
  serializeEventBindings,
  type PageMethod,
} from '../types/page-method'
import { runEventBindings } from '../utils/event-runtime'
import { createComponentEmit } from '../utils/component-emit'
import type { PreviewInteractPayload } from '../utils/event-runtime'
import { resolveComputedPageData, sameJson } from '../utils/compute-runtime'
import {
  buildQueryObject,
  type PageQueryParamDef,
} from '../types/page-query'
import {
  hasControllerBoundFields,
  loadControllerBoundPageData,
} from '../utils/controller-binding-runtime'
import {
  normalizeStatusBarConfig,
  resolveStatusBarConfig,
  type StatusBarConfig,
} from '../utils/status-bar'
import { buildDollarProps, buildDollarPropsAmbientDeclaration, buildUpdatePropsAmbientDeclarations, normalizePropDefaultValue } from '../utils/component-props'
import { hydrateApiDollarProps } from '../utils/api-prop'
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
  findXmlNodeById,
  moveWidget,
  removeWidget,
  migrateLegacyMaskToModal,
  WIDGET_OPTIONS,
  type MovePosition,
  type WidgetTag,
} from '../utils/xml-node'
import { parsePageXml } from '../utils/xml'
import {
  isSlotOutletNodeId,
  parseSlotOutletNodeId,
} from '../utils/slot-outlet'
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
import {
  createEmptyOssLibrary,
  type OssLibrary,
} from '../types/oss'
import {
  createEmptyBackendService,
  createEmptyBackendServiceLibrary,
  isValidServiceId,
  type BackendService,
  type BackendServiceLibrary,
} from '../types/backend-services'
import {
  emptyBackendServiceUiState,
  loadWorkspaceUiState,
  saveWorkspaceUiState,
  type BackendLayer,
  type BackendServiceUiState,
  type WorkspaceUiState,
} from '../utils/workspace-ui-state'

type WorkspaceMode =
  | 'preview'
  | 'edit'
  | 'datapool'
  | 'datatypes'
  | 'mysql'
  | 'oss'
  | 'icons'
  | 'methods'
  | 'lifecycle'

const projectStore = useProjectStore()

type ResourceKind = 'page' | 'component'
type ProjectNav = 'datatypes' | 'mysql' | 'oss' | 'icons'
/** 活动栏：前端 / 后端 / 项目级资源 */
type TopNav = 'frontend' | 'backend' | ProjectNav

const resourceKind = ref<ResourceKind>('page')
const topNav = ref<TopNav>('frontend')
const pages = ref<PageSummary[]>([])
const components = ref<ComponentSummary[]>([])
const activePageId = ref('')
const activeComponentId = ref('')
const activePage = ref<PageDetail | null>(null)
const activeComponent = ref<ComponentDetail | null>(null)
const selectedNodeId = ref('')
const workspaceMode = ref<WorkspaceMode>('preview')
const componentMap = ref<ComponentRenderMap>({})
/** 各组件方法（含暴露方法签名 / 预览调用） */
const componentMethodsMap = ref<Record<string, PageMethod[]>>({})
const propsTab = ref<PropsTab>('style')
const openRepeatRequest = ref(0)
const loadingPages = ref(false)
const loadingPage = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const addDialogVisible = ref(false)
const addDialogTab = ref<'widget' | 'component'>('widget')
/** 打开添加弹窗时是否写入当前插槽的调试子节点 */
const addIntoSlotDebug = ref(false)
const iconLibrary = ref<IconLibrary>(createEmptyIconLibrary())
const dataTypeLibrary = ref<DataTypeLibrary>(createEmptyDataTypeLibrary())
const mysqlLibrary = ref<MysqlLibrary>(createEmptyMysqlLibrary())
const ossLibrary = ref<OssLibrary>(createEmptyOssLibrary())
const backendServiceLibrary = ref<BackendServiceLibrary>(
  createEmptyBackendServiceLibrary(),
)
const activeServiceId = ref('')
const serviceDialogVisible = ref(false)
const backendServiceLayer = ref<BackendLayer>('controller')
const backendDebugTarget = ref<ProcessorDebugTarget | null>(null)
/** 各服务的层 / 选中状态（刷新与切 tab 后恢复） */
const backendByService = ref<Record<string, BackendServiceUiState>>({})
/** 已从 localStorage 恢复，之后才写回 */
const workspaceUiReady = ref(false)

const dataDebugTarget = computed(() => {
  const t = backendDebugTarget.value
  if (t?.kind !== 'data') return null
  const { kind: _kind, ...rest } = t
  return rest
})
const flowDebugTarget = computed(() => {
  const t = backendDebugTarget.value
  if (t?.kind !== 'flow') return null
  const { kind: _kind, ...rest } = t
  return rest
})
const backendWorkspaceRef = ref<InstanceType<
  typeof BackendServiceWorkspace
> | null>(null)
const dataPoolPanelRef = ref<InstanceType<typeof DataPoolPanel> | null>(null)
let backendServiceSaveTimer: ReturnType<typeof setTimeout> | null = null
/** 编辑态临时隐藏，不写入 XML；预览模式不生效 */
const editorHiddenNodeIds = ref<string[]>([])
const pageMethods = ref<PageMethod[]>([])
const lifecycleConfig = ref<LifecycleConfig>(createEmptyLifecycleConfig())
const methodDialogVisible = ref(false)
const editingMethod = ref<PageMethod | null>(null)
/** 预览态是否已跑过挂载生命周期序列 */
let lifecycleSessionActive = false
let lifecycleSaveTimer: ReturnType<typeof setTimeout> | null = null
/** 预览运行时就绪后递增，驱动嵌套 Component 挂载生命周期 */
const previewLifecycleGate = ref(0)
/**
 * 预览会话代次：切页/切组件/离开预览时递增。
 * 旧会话里未完成的 setData / updateProps / 生命周期回调据此静默丢弃，避免打到新文档数据池。
 */
let previewSessionGen = 0
/** 打开页面/组件的导航代次，用于取消被更快切换打断的 in-flight open* */
let previewNavSeq = 0
/** setData 高频时合并 onUpdate，避免滚动帧内反复跑生命周期 */
let lifecycleUpdateTimer: ReturnType<typeof setTimeout> | null = null

function bumpPreviewSession() {
  previewSessionGen += 1
  if (lifecycleUpdateTimer != null) {
    clearTimeout(lifecycleUpdateTimer)
    lifecycleUpdateTimer = null
  }
}

function isPreviewSessionLive(sessionGen: number) {
  return sessionGen === previewSessionGen
}

function beginPreviewNavigation() {
  const nav = ++previewNavSeq
  bumpPreviewSession()
  // 立刻关闸，丢弃旧画布上尚未处理完的嵌套 Component mount
  previewLifecycleGate.value = 0
  return nav
}

function isPreviewNavCurrent(nav: number) {
  return nav === previewNavSeq
}
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

const renameComponentVisible = ref(false)
const renamingComponent = ref(false)
const renameComponentTarget = ref<ComponentSummary | null>(null)
const renameComponentForm = reactive({
  id: '',
  name: '',
})
const renameComponentFormRef = ref()
const renameComponentRules = {
  id: [
    { required: true, message: '请输入组件 ID', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: '仅支持字母、数字、下划线和短横线',
      trigger: 'blur',
    },
  ],
  name: [{ required: true, message: '请输入组件名称', trigger: 'blur' }],
}

const canvasWidth = computed(
  () => projectStore.config?.canvas.width ?? 375,
)

const isPageResource = computed(() => resourceKind.value === 'page')
const isComponentResource = computed(() => resourceKind.value === 'component')

/** 页面不可添加 Slot；仅组件资源可选；插槽调试也不嵌套 Slot */
const addWidgetOptions = computed(() => {
  let list = isComponentResource.value
    ? [...WIDGET_OPTIONS]
    : WIDGET_OPTIONS.filter((item) => item.tag !== 'Slot')
  if (addIntoSlotDebug.value) {
    list = list.filter((item) => item.tag !== 'Slot')
  }
  return list
})
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
      lifecycle: info.lifecycle ? { ...info.lifecycle } : undefined,
    }
  }
  return next
}

function restoreComponentDebugProps(): Record<string, unknown> {
  if (!isComponentResource.value || !activeComponent.value) return {}
  const saved = activeComponent.value.config.debugProps
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  return { ...saved }
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
  // 组件调试 Props 从 config.debugProps 恢复
  previewPropOverrides.value = isComponentResource.value
    ? restoreComponentDebugProps()
    : {}
  previewEmitLogs.value = []
}

function clearPreviewRuntime() {
  previewRuntimeData.value = null
  previewComponentMap.value = null
  previewPropOverrides.value = isComponentResource.value
    ? restoreComponentDebugProps()
    : {}
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

/** 编辑/预览组件时：用 config.props 默认值 + 调试覆盖作为 $props（原始值，含 api 绑定 JSON） */
const editorDollarPropsRaw = computed(() => {
  if (!isComponentResource.value || !activeComponent.value) return undefined
  return {
    ...buildDollarProps(activeComponent.value.config),
    ...previewPropOverrides.value,
  }
})

/** 画布 / 自定义代码运行时：api 参数为可调用函数 */
const editorDollarProps = computed(() => {
  const raw = editorDollarPropsRaw.value
  if (!raw || !activeComponent.value) return raw
  return hydrateApiDollarProps(
    raw,
    activeComponent.value.config.props,
    projectStore.path,
  )
})

const previewDebugDollarProps = computed(() => editorDollarPropsRaw.value ?? {})

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

let debugPropsSaveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 调试面板手动改 Props：写入预览覆盖，并作为「测试基线」持久化到 debugProps。
 * （生命周期里的 updateProps 不要走这里，否则会把运行时累加结果存进基线。）
 */
function handlePreviewPropUpdate(name: string, value: unknown) {
  previewPropOverrides.value = {
    ...previewPropOverrides.value,
    [name]: value,
  }
  if (isComponentResource.value && activeComponent.value) {
    const nextDebug = {
      ...(activeComponent.value.config.debugProps ?? {}),
      [name]: value,
    }
    activeComponent.value = {
      ...activeComponent.value,
      config: {
        ...activeComponent.value.config,
        debugProps: nextDebug,
      },
    }
    if (debugPropsSaveTimer) clearTimeout(debugPropsSaveTimer)
    debugPropsSaveTimer = setTimeout(() => {
      void persistComponentDebugPropsBaseline()
    }, 400)
  }
  void runLifecycleUpdateSequence()
}

/** 预览运行时 updateProps：只改内存中的 $props，不回写 debugProps 基线 */
function applyPreviewPropRuntimeOverride(name: string, value: unknown) {
  previewPropOverrides.value = {
    ...previewPropOverrides.value,
    [name]: value,
  }
}

async function persistComponentDebugPropsBaseline() {
  if (!projectStore.path || !activeComponent.value || !isComponentResource.value) {
    return
  }
  const baseline = {
    ...(activeComponent.value.config.debugProps ?? {}),
  }
  try {
    const saved = await saveComponentConfig({
      projectPath: projectStore.path,
      componentId: activeComponent.value.id,
      config: {
        ...activeComponent.value.config,
        debugProps: baseline,
      },
    })
    if (activeComponent.value?.id === saved.id) {
      activeComponent.value = {
        ...activeComponent.value,
        config: {
          ...saved.config,
          debugProps: {
            ...(saved.config.debugProps ?? {}),
            ...baseline,
          },
        },
      }
    }
  } catch (err) {
    console.error('[voider] 保存组件调试 Props 失败:', err)
  }
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
  if (isComponentResource.value && activeComponentId.value) {
    bumpPreviewSession()
    const sessionGen = previewSessionGen
    await preparePreviewRuntime()
    if (!isPreviewSessionLive(sessionGen)) return
    previewLifecycleGate.value += 1
    await nextTick()
    if (!isPreviewSessionLive(sessionGen)) return
    await syncLifecycleSession()
    return
  }
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
    dollarProps: editorDollarProps.value,
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
    dataTypeLibrary.value,
  )
  const updatePropsAmbient = isComponentResource.value
    ? buildUpdatePropsAmbientDeclarations(
        activeComponent.value?.config.props,
        dataTypeLibrary.value,
      )
    : ''
  const typeAmbient = buildTypeLibraryAmbientDeclarations(dataTypeLibrary.value)
  const localMethodsAmbient = buildLocalMethodsAmbientDeclarations(
    pageMethods.value,
    dataTypeLibrary.value,
  )
  const base =
    [deviceAmbient, typeAmbient, propsAmbient, updatePropsAmbient, localMethodsAmbient]
      .filter(Boolean)
      .join('\n') + '\n'
  if (!isComponentResource.value || !activeComponent.value) {
    return base
  }
  return `${base}${buildEmitAmbientDeclarations(
    activeComponent.value.config.events ?? [],
    dataTypeLibrary.value,
  )}`
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
const isOssMode = computed(() => workspaceMode.value === 'oss')
const isIconsMode = computed(() => workspaceMode.value === 'icons')
const isMethodsMode = computed(() => workspaceMode.value === 'methods')
const isLifecycleMode = computed(() => workspaceMode.value === 'lifecycle')
const hideWidgetTree = computed(
  () =>
    isDataPoolMode.value ||
    isDataTypesMode.value ||
    isMysqlMode.value ||
    isOssMode.value ||
    isIconsMode.value ||
    isMethodsMode.value ||
    isLifecycleMode.value,
)

const canDeleteSelected = computed(
  () =>
    isEditMode.value &&
    Boolean(activeDoc.value) &&
    !isSlotOutletNodeId(selectedNodeId.value) &&
    canDeleteNode(selectedNodeId.value),
)

/** 组件定义中选中 Slot 时，可添加调试预览元素 */
const showAddDebugButton = computed(() => {
  if (!isEditMode.value || !isComponentResource.value || !activeDoc.value) {
    return false
  }
  const id = selectedNodeId.value
  if (!id || isSlotOutletNodeId(id)) return false
  try {
    const root = parsePageXml(activeDoc.value.xml)
    return findXmlNodeById(root, id)?.tag === 'Slot'
  } catch {
    return false
  }
})

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

const frontendModeTitle = computed(
  () => modeTabs.find((tab) => tab.key === workspaceMode.value)?.label ?? '预览',
)

const backendLayerTabs = [
  { key: 'controller' as const, label: '控制器', icon: Connection },
  { key: 'service' as const, label: '业务层', icon: Cpu },
  { key: 'data' as const, label: '数据层', icon: Coin },
  { key: 'schedule' as const, label: '定时任务', icon: Timer },
]

const backendLayerTitle = computed(
  () =>
    backendLayerTabs.find((tab) => tab.key === backendServiceLayer.value)
      ?.label ?? '控制器',
)

const projectNavItems: { key: ProjectNav; label: string; icon: unknown }[] = [
  { key: 'datatypes', label: '数据类型', icon: Collection },
  { key: 'mysql', label: 'MySQL', icon: MysqlIcon },
  { key: 'oss', label: '对象存储', icon: OssIcon },
  { key: 'icons', label: '图标库', icon: Picture },
]

const isFrontendNav = computed(() => topNav.value === 'frontend')
const isBackendNav = computed(() => topNav.value === 'backend')
const isProjectNav = computed(
  () =>
    topNav.value === 'datatypes' ||
    topNav.value === 'mysql' ||
    topNav.value === 'oss' ||
    topNav.value === 'icons',
)
const showModeTabs = computed(() => isFrontendNav.value)

const activeBackendService = computed(
  () =>
    backendServiceLibrary.value.services.find(
      (item) => item.id === activeServiceId.value,
    ) ?? null,
)

const showBackendLayerTabs = computed(
  () => isBackendNav.value && Boolean(activeBackendService.value),
)

const activeBackendUi = computed(
  () =>
    (activeServiceId.value
      ? backendByService.value[activeServiceId.value]
      : null) ?? null,
)

function patchBackendServiceUi(
  serviceId: string,
  patch: Partial<BackendServiceUiState>,
) {
  if (!serviceId) return
  const prev =
    backendByService.value[serviceId] ?? emptyBackendServiceUiState()
  backendByService.value = {
    ...backendByService.value,
    [serviceId]: {
      ...prev,
      ...patch,
      processors: {
        ...prev.processors,
        ...(patch.processors ?? {}),
      },
    },
  }
}

function collectWorkspaceUiState(): WorkspaceUiState {
  return {
    topNav: topNav.value,
    resourceKind: resourceKind.value,
    workspaceMode: workspaceMode.value,
    activePageId: activePageId.value,
    activeComponentId: activeComponentId.value,
    activeServiceId: activeServiceId.value,
    backendServiceLayer: backendServiceLayer.value,
    backendByService: backendByService.value,
  }
}

function applyWorkspaceUiState(saved: WorkspaceUiState) {
  const top = saved.topNav as TopNav
  if (
    top === 'frontend' ||
    top === 'backend' ||
    top === 'datatypes' ||
    top === 'mysql' ||
    top === 'oss' ||
    top === 'icons'
  ) {
    topNav.value = top
  }
  if (saved.resourceKind === 'page' || saved.resourceKind === 'component') {
    resourceKind.value = saved.resourceKind
  }
  if (top === 'datatypes' || top === 'mysql' || top === 'oss' || top === 'icons') {
    workspaceMode.value = top
  } else if (
    saved.workspaceMode === 'preview' ||
    saved.workspaceMode === 'edit' ||
    saved.workspaceMode === 'datapool' ||
    saved.workspaceMode === 'methods' ||
    saved.workspaceMode === 'lifecycle'
  ) {
    workspaceMode.value = saved.workspaceMode
  }
  activePageId.value = saved.activePageId || ''
  activeComponentId.value = saved.activeComponentId || ''
  activeServiceId.value = saved.activeServiceId || ''
  const layer = saved.backendServiceLayer
  if (
    layer === 'controller' ||
    layer === 'service' ||
    layer === 'data' ||
    layer === 'schedule'
  ) {
    backendServiceLayer.value = layer
  }
  backendByService.value = saved.backendByService ?? {}
}

function onBackendLayerUpdate(layer: BackendLayer) {
  backendServiceLayer.value = layer
  if (layer === 'schedule') backendDebugTarget.value = null
  if (activeServiceId.value) {
    patchBackendServiceUi(activeServiceId.value, { layer })
  }
}

function onBackendControllerId(id: string) {
  if (!activeServiceId.value) return
  patchBackendServiceUi(activeServiceId.value, { controllerId: id })
}

function onBackendBusinessSelection(state: ProcessorSelectionState) {
  if (!activeServiceId.value) return
  patchBackendServiceUi(activeServiceId.value, {
    processors: {
      business: {
        processorId: state.processorId,
        methodId: state.methodId,
        flowEditing: state.flowEditing,
      },
    },
  })
}

function onBackendDataSelection(state: ProcessorSelectionState) {
  if (!activeServiceId.value) return
  patchBackendServiceUi(activeServiceId.value, {
    processors: {
      data: {
        processorId: state.processorId,
        methodId: state.methodId,
        flowEditing: null,
      },
    },
  })
}

/** 顶栏路径只展示到目录，不显示具体文件名 */
const centerDirSegment = computed(() => {
  if (isMethodsMode.value) return 'function'
  return ''
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

/** 后端顶栏路径：services/{层}，不展示服务 id，无尾斜杠 */
const backendCenterPath = computed(() => {
  if (!activeBackendService.value) return 'services'
  const layer =
    backendServiceLayer.value === 'controller'
      ? 'controllers'
      : backendServiceLayer.value === 'service'
        ? 'business'
        : backendServiceLayer.value === 'data'
          ? 'data'
          : 'schedules'
  return `services/${layer}`
})

const propsPlaceholderText = computed(() => {
  if (isBackendNav.value) {
    if (backendServiceLayer.value === 'data') {
      return '选中数据层方法后可调试'
    }
    if (backendServiceLayer.value === 'service') {
      return '选中业务方法后可调试'
    }
    return '在模块列表右键可重命名、配置或删除'
  }
  if (isDataTypesMode.value) return '在分组列表右键可重命名或删除'
  if (isMysqlMode.value) return '在连接列表右键可配置或删除'
  if (isOssMode.value) return '在连接列表右键可配置或删除'
  if (isIconsMode.value) return '在图标上右键可编辑或删除'
  if (
    !activePage.value &&
    !isIconsMode.value &&
    !isDataTypesMode.value &&
    !isMysqlMode.value &&
    !isOssMode.value
  ) {
    return '打开页面后可编辑'
  }
  if (isDataPoolMode.value) return '数据池模式下请在中间区域编辑'
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
    await Promise.all([
      loadIconLibrary(),
      loadDataTypeLibrary(),
      loadMysqlLibrary(),
      loadOssLibrary(),
      loadBackendServiceLibrary(),
    ])
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

async function loadOssLibrary() {
  if (!projectStore.path) return
  try {
    ossLibrary.value = await getOssLibrary(projectStore.path)
  } catch (err) {
    ossLibrary.value = createEmptyOssLibrary()
    console.error(err)
  }
}

async function loadBackendServiceLibrary() {
  if (!projectStore.path) return
  try {
    backendServiceLibrary.value = await getBackendServiceLibrary(projectStore.path)
    if (
      activeServiceId.value &&
      !backendServiceLibrary.value.services.some((s) => s.id === activeServiceId.value)
    ) {
      activeServiceId.value = backendServiceLibrary.value.services[0]?.id ?? ''
    } else if (!activeServiceId.value && backendServiceLibrary.value.services.length) {
      activeServiceId.value = backendServiceLibrary.value.services[0]!.id
    }
  } catch (err) {
    backendServiceLibrary.value = createEmptyBackendServiceLibrary()
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
    const lifecycleEntries = await Promise.all(
      details.map(async (detail) => {
        try {
          const { lifecycle } = await getComponentLifecycle(
            projectStore.path!,
            detail.id,
          )
          return [detail.id, lifecycle ?? createEmptyLifecycleConfig()] as const
        } catch {
          return [detail.id, createEmptyLifecycleConfig()] as const
        }
      }),
    )
    const lifecycleById = Object.fromEntries(lifecycleEntries)
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
        lifecycle: lifecycleById[detail.id] ?? createEmptyLifecycleConfig(),
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
        const cid = activeDoc.value.id
        const prev = componentMap.value[cid]
        if (prev) {
          componentMap.value = {
            ...componentMap.value,
            [cid]: { ...prev, lifecycle: result.lifecycle },
          }
        }
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
  const nav = beginPreviewNavigation()

  if (!options?.keepHistory) {
    pageHistory.value = []
  }

  const useNavParams = options?.params !== undefined
  if (useNavParams) {
    routeParams.value =
      options.params && typeof options.params === 'object' && !Array.isArray(options.params)
        ? { ...options.params }
        : {}
  } else if (!options?.keepHistory) {
    routeParams.value = {}
  }

  await teardownLifecycleSession()
  if (!isPreviewNavCurrent(nav)) return

  // 侧栏立即高亮；画布内容等新页就绪后再换，避免抖动
  activePageId.value = pageId
  const softNav = Boolean(activePage.value || activeComponent.value)
  selectedNodeId.value = ''
  editorHiddenNodeIds.value = []
  modalStack.closeAll()
  if (!softNav) loadingPage.value = true
  try {
    const detail = await getPage(projectStore.path, pageId)
    if (!isPreviewNavCurrent(nav)) return
    const migrated = migrateLegacyMaskToModal(detail.xml)
    const nextPage: PageDetail = migrated.changed
      ? { ...detail, xml: migrated.xml }
      : detail

    // 预览：先切页（初始数据）→ 生命周期 → 再拉控制器，避免跳转卡在旧页
    const inPreview = workspaceMode.value === 'preview'
    let nextPreview: import('../types/page-data').PageData | null = null
    let nextCompMap: ComponentRenderMap | null = null
    if (inPreview) {
      previewLifecycleGate.value = 0
      await nextTick()
      if (!isPreviewNavCurrent(nav)) return
      nextPreview = clonePageData(nextPage.data ?? { fields: [] })
      nextCompMap = cloneComponentRenderMap(componentMap.value)
    } else {
      clearPreviewRuntime()
    }

    resourceKind.value = 'page'
    activeComponentId.value = ''
    activeComponent.value = null
    activePage.value = nextPage
    if (!useNavParams && !options?.keepHistory) {
      syncRouteParamsFromPageConfig(nextPage.config)
    }
    await Promise.all([loadPageMethods(pageId), loadLifecycle(pageId)])
    if (!isPreviewNavCurrent(nav)) return
    if (migrated.changed) {
      await handleXmlUpdate(migrated.xml)
      if (!isPreviewNavCurrent(nav)) return
    }

    if (inPreview && nextPreview && nextCompMap) {
      // 须在 resourceKind/activeDoc 切换后再 commit，避免仍按组件恢复 debugProps
      commitPreviewRuntime(nextPreview, nextCompMap)
      previewLifecycleGate.value += 1
      await nextTick()
      if (!isPreviewNavCurrent(nav)) return
      await syncLifecycleSession()
      if (!isPreviewNavCurrent(nav)) return
      await hydratePreviewControllerBindings()
    } else {
      await syncLifecycleSession()
    }
  } catch (err) {
    if (!isPreviewNavCurrent(nav)) return
    activePage.value = null
    pageMethods.value = []
    lifecycleConfig.value = createEmptyLifecycleConfig()
    ElMessage.error(err instanceof Error ? err.message : '打开页面失败')
  } finally {
    if (isPreviewNavCurrent(nav)) loadingPage.value = false
  }
}

async function openComponent(componentId: string) {
  if (!projectStore.path) return
  const nav = beginPreviewNavigation()
  await teardownLifecycleSession()
  if (!isPreviewNavCurrent(nav)) return

  const softNav = Boolean(activeComponent.value || activePage.value)
  selectedNodeId.value = ''
  editorHiddenNodeIds.value = []
  pageHistory.value = []
  routeParams.value = {}
  modalStack.closeAll()
  // 侧栏立即高亮（此时 activeComponent 仍可能是旧文档，勿据此恢复 debugProps）
  activeComponentId.value = componentId
  if (!softNav) loadingPage.value = true
  try {
    const detail = await getComponent(projectStore.path, componentId)
    if (!isPreviewNavCurrent(nav)) return
    const migrated = migrateLegacyMaskToModal(detail.xml)
    const nextComponent = migrated.changed
      ? { ...detail, xml: migrated.xml }
      : detail

    const inPreview = workspaceMode.value === 'preview'
    let nextPreview: import('../types/page-data').PageData | null = null
    let nextCompMap: ComponentRenderMap | null = null
    if (inPreview) {
      previewLifecycleGate.value = 0
      await nextTick()
      if (!isPreviewNavCurrent(nav)) return
      nextPreview = clonePageData(nextComponent.data ?? { fields: [] })
      nextCompMap = cloneComponentRenderMap(componentMap.value)
    } else {
      clearPreviewRuntime()
    }

    resourceKind.value = 'component'
    activeComponentId.value = componentId
    activePageId.value = ''
    activePage.value = null
    activeComponent.value = nextComponent
    await Promise.all([loadPageMethods(componentId), loadLifecycle(componentId)])
    if (!isPreviewNavCurrent(nav)) return
    if (migrated.changed) {
      await handleXmlUpdate(migrated.xml)
      if (!isPreviewNavCurrent(nav)) return
    }

    if (inPreview && nextPreview && nextCompMap) {
      // 先切好组件文档再 commit，才能用本组件 debugProps 作为 $props
      commitPreviewRuntime(nextPreview, nextCompMap)
      previewLifecycleGate.value += 1
      await nextTick()
      if (!isPreviewNavCurrent(nav)) return
      await syncLifecycleSession()
      if (!isPreviewNavCurrent(nav)) return
      await hydratePreviewControllerBindings()
    } else {
      await syncLifecycleSession()
    }
  } catch (err) {
    if (!isPreviewNavCurrent(nav)) return
    activeComponent.value = null
    pageMethods.value = []
    lifecycleConfig.value = createEmptyLifecycleConfig()
    ElMessage.error(err instanceof Error ? err.message : '打开组件失败')
  } finally {
    if (isPreviewNavCurrent(nav)) loadingPage.value = false
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
  if (!isProjectNav.value && !isBackendNav.value) return
  topNav.value = 'frontend'
  if (
    workspaceMode.value === 'datatypes' ||
    workspaceMode.value === 'mysql' ||
    workspaceMode.value === 'oss' ||
    workspaceMode.value === 'icons'
  ) {
    workspaceMode.value = 'preview'
  }
}

function selectFrontendNav() {
  leaveProjectNav()
  topNav.value = 'frontend'
}

function selectBackendNav() {
  topNav.value = 'backend'
  if (
    workspaceMode.value === 'datatypes' ||
    workspaceMode.value === 'mysql' ||
    workspaceMode.value === 'oss' ||
    workspaceMode.value === 'icons'
  ) {
    workspaceMode.value = 'preview'
  }
  if (
    !activeServiceId.value &&
    backendServiceLibrary.value.services.length
  ) {
    activeServiceId.value = backendServiceLibrary.value.services[0]!.id
  }
}

function selectProjectNav(nav: ProjectNav) {
  topNav.value = nav
  workspaceMode.value = nav
}

function setWorkspaceMode(mode: (typeof modeTabs)[number]['key']) {
  topNav.value = 'frontend'
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

type ComponentMenuCommand = 'rename' | 'delete'

function openRenameComponentDialog(component: ComponentSummary) {
  renameComponentTarget.value = component
  renameComponentForm.id = component.id
  renameComponentForm.name = component.name
  renameComponentVisible.value = true
}

async function handleRenameComponentConfirm() {
  const form = renameComponentFormRef.value
  const target = renameComponentTarget.value
  if (!form || !target || !projectStore.path) return

  await form.validate(async (valid: boolean) => {
    if (!valid) return
    renamingComponent.value = true
    try {
      const renamed = await renameComponent({
        projectPath: projectStore.path!,
        componentId: target.id,
        newId: renameComponentForm.id.trim(),
        name: renameComponentForm.name.trim(),
      })
      const refsHint =
        renamed.refsUpdated > 0
          ? `，已更新 ${renamed.refsUpdated} 处引用`
          : ''
      ElMessage.success(`已重命名${refsHint}`)
      renameComponentVisible.value = false
      if (activeComponentId.value === target.id) {
        activeComponentId.value = renamed.id
      }
      await loadPages(renamed.id)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '重命名失败')
    } finally {
      renamingComponent.value = false
    }
  })
}

async function handleComponentMenuCommand(
  command: ComponentMenuCommand,
  component: ComponentSummary,
) {
  if (!projectStore.path) return

  try {
    if (command === 'rename') {
      openRenameComponentDialog(component)
      return
    }

    if (command === 'delete') {
      await ElMessageBox.confirm(
        `确定删除组件「${component.name}」（${component.id}）吗？此操作不可恢复。`,
        '删除组件',
        {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          confirmButtonClass: 'el-button--danger',
        },
      )
      await deleteComponent({
        projectPath: projectStore.path,
        componentId: component.id,
      })
      ElMessage.success('已删除')
      const nextSelect =
        activeComponentId.value === component.id
          ? components.value.find((item) => item.id !== component.id)?.id
          : activeComponentId.value
      if (activeComponentId.value === component.id) {
        activeComponentId.value = ''
        activeComponent.value = null
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
      queryParams: activePage.value.config.queryParams,
      debugQuery: activePage.value.config.debugQuery,
    })
    activePage.value = {
      ...activePage.value,
      config: saved.config,
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存状态栏失败')
  }
}

const pageQueryParams = computed(
  (): PageQueryParamDef[] =>
    isPageResource.value ? activePage.value?.config.queryParams ?? [] : [],
)

const pageDebugQuery = computed(
  (): Record<string, unknown> =>
    isPageResource.value ? activePage.value?.config.debugQuery ?? {} : {},
)

function syncRouteParamsFromPageConfig(config?: PageConfig | null) {
  if (!config) {
    routeParams.value = {}
    return
  }
  routeParams.value = buildQueryObject(config.queryParams, config.debugQuery)
}

let pageQuerySaveTimer: ReturnType<typeof setTimeout> | null = null

async function persistPageQueryConfig(partial: {
  queryParams?: PageQueryParamDef[]
  debugQuery?: Record<string, unknown>
}) {
  if (!projectStore.path || !activePage.value || isComponentResource.value) return
  const nextConfig: PageConfig = {
    ...activePage.value.config,
    ...(partial.queryParams !== undefined
      ? { queryParams: partial.queryParams }
      : {}),
    ...(partial.debugQuery !== undefined
      ? { debugQuery: partial.debugQuery }
      : {}),
  }
  activePage.value = {
    ...activePage.value,
    config: nextConfig,
  }
  syncRouteParamsFromPageConfig(nextConfig)
  if (pageQuerySaveTimer) clearTimeout(pageQuerySaveTimer)
  pageQuerySaveTimer = setTimeout(async () => {
    if (!projectStore.path || !activePage.value) return
    try {
      const saved = await savePageConfig({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        name: activePage.value.config.name,
        title: activePage.value.config.title,
        statusBar: activePage.value.config.statusBar,
        queryParams: activePage.value.config.queryParams ?? [],
        debugQuery: activePage.value.config.debugQuery ?? {},
      })
      activePage.value = {
        ...activePage.value,
        config: saved.config,
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存 Query 入参失败')
    }
  }, 280)
}

function handlePageQueryParamsUpdate(value: PageQueryParamDef[]) {
  void persistPageQueryConfig({ queryParams: value })
}

function handlePageDebugQueryUpdate(value: Record<string, unknown>) {
  void persistPageQueryConfig({ debugQuery: value })
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
  const index = fields.findIndex((item) => item.name.trim() === prop.trim())
  if (index < 0) {
    ElMessage.warning(`组件数据池不存在字段：${prop}`)
    return
  }
  const prev = fields[index]!
  if (sameJson(prev.value, value)) return
  let objectFields = prev.objectFields
  if (
    prev.type === 'json' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray(prev.objectFields) &&
    prev.objectFields.length
  ) {
    const obj = value as Record<string, unknown>
    objectFields = prev.objectFields.map((sub) => {
      const key = sub.name.trim()
      if (!key || !(key in obj)) return sub
      return { ...sub, value: obj[key] as DataFieldValue }
    })
  }
  fields[index] = { ...prev, value, objectFields }
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

/** 解析 Component 属性上的纯数据池绑定：`{field}` */
function parseSimpleDataBinding(raw: string | undefined | null): string | null {
  const text = String(raw ?? '').trim()
  const m = text.match(/^\{([A-Za-z_$][\w$]*)\}$/)
  return m?.[1] ?? null
}

/**
 * 预览态 updateProps：校验 model 参数 → 更新本地 $props / 调试 Props →
 * 若父级属性为 `{field}` 则回写父级数据池。
 */
function applyPreviewUpdateProps(
  prop: string,
  value: unknown,
  options?: {
    componentId?: string
    hostAttrs?: Record<string, string>
    /** 父级数据池所属组件；空则页面 */
    hostDataOwnerId?: string
    config?: import('../types/component').ComponentConfig | null
  },
) {
  const name = prop.trim()
  if (!name) return
  const config =
    options?.config ??
    (options?.componentId
      ? canvasComponentMap.value[options.componentId]?.config
      : null) ??
    (isComponentResource.value ? activeComponent.value?.config : null)
  const def = config?.props?.find((item) => item.name.trim() === name)
  if (!def) {
    ElMessage.warning(`组件参数不存在：${name}`)
    return
  }
  if (!def.twoWay) {
    ElMessage.warning(`「${name}」未开启双向绑定，无法 updateProps`)
    return
  }
  if (def.type === 'api') {
    ElMessage.warning(`「${name}」为后端 API 参数，无法 updateProps`)
    return
  }

  const coerced = normalizePropDefaultValue(def.type, value)

  // 正在编辑该组件：仅更新预览态 $props，不污染 debugProps 测试基线
  if (
    isComponentResource.value &&
    (!options?.componentId ||
      options.componentId === activeComponentId.value)
  ) {
    applyPreviewPropRuntimeOverride(name, coerced)
  }

  // 父级绑定 `{field}` → 回写数据池
  const boundField = parseSimpleDataBinding(options?.hostAttrs?.[name])
  if (boundField) {
    const hostOwner = options?.hostDataOwnerId?.trim() || ''
    if (hostOwner) {
      applyComponentPreviewSetData(hostOwner, boundField, coerced)
    } else {
      applyPreviewSetData(boundField, coerced)
    }
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
    getPageData: () =>
      previewComponentMap.value?.[componentId]?.data ?? info.data,
    xml: info.xml,
    modalStack,
    componentMap: canvasComponentMap.value,
    componentMethodsMap: componentMethodsMap.value,
    runComponentMethod: runComponentExposedMethod,
    resolveMethod: (name) =>
      (componentMethodsMap.value[componentId] ?? []).find(
        (item) => item.name === name && !item.builtin,
      ),
    localMethods: (componentMethodsMap.value[componentId] ?? []).filter(
      (item) => !item.builtin,
    ),
    eventArgs,
    dollarProps: buildDollarProps(info.config),
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
    updateProps: (prop, value) => {
      applyPreviewUpdateProps(prop, value, {
        componentId,
        config: info.config,
      })
    },
    showToast: (message, duration) => {
      showPreviewToast(message, duration)
    },
    getDeviceInfo: previewGetDeviceInfo,
    onUnknownMethod: (name) => {
      if (name.startsWith('自定义方法')) ElMessage.error(name)
      else if (name.startsWith('updateProps')) ElMessage.warning(name)
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
    emitWithArgs?: (event: string, args: Record<string, unknown>) => void
    /**
     * 事件绑定写在该组件定义内时，setData / 数据池 / 方法解析走组件数据池。
     * 空则走当前页面（或正在编辑的组件资源）数据池。
     */
    dataOwnerComponentId?: string
    /** updateProps 回写父级：Component 节点原始 attrs */
    updatePropsHostAttrs?: Record<string, string>
    /** updateProps 回写父级数据池所属组件 id */
    updatePropsHostDataOwnerId?: string
  },
) {
  if (!activeDoc.value) return
  const sessionGen = previewSessionGen
  const ownerId = options?.dataOwnerComponentId?.trim() || ''
  const ownerInfo = ownerId ? canvasComponentMap.value[ownerId] : null
  if (ownerId && !ownerInfo) {
    ElMessage.warning(`组件不存在：${ownerId}`)
    return
  }

  // 绑定创建时固化 config / host，避免 Promise 回调时 activeComponent 已切走
  const boundUpdatePropsConfig =
    ownerInfo?.config ??
    (isComponentResource.value ? activeComponent.value?.config : undefined)
  const boundHostAttrs = options?.updatePropsHostAttrs
  const boundHostDataOwnerId = options?.updatePropsHostDataOwnerId
  const boundDollarProps = options?.dollarProps ?? editorDollarProps.value
  const boundLocalMethods = ownerId
    ? (componentMethodsMap.value[ownerId] ?? []).filter((item) => !item.builtin)
    : pageMethods.value.filter((item) => !item.builtin)
  const boundResolveMethod = (name: string) =>
    ownerId
      ? (componentMethodsMap.value[ownerId] ?? []).find(
          (item) => item.name === name && !item.builtin,
        )
      : pageMethods.value.find((item) => item.name === name && !item.builtin)

  const debugEmit = options?.emitFn ?? createPreviewDebugEmit()
  const debugEmitWithArgs =
    options?.emitWithArgs ??
    (isComponentResource.value
      ? (eventName: string, args: Record<string, unknown>) => {
          if (!isPreviewSessionLive(sessionGen)) return
          const params =
            activeComponent.value?.config.events?.find(
              (item) => item.name.trim() === eventName,
            )?.params ?? []
          const packed: Record<string, unknown> = {}
          for (const param of params) {
            const key = param.name.trim()
            if (!key || key.startsWith('...')) continue
            if (key in args) {
              packed[key] = coerceEmitParamValue(param.type, args[key])
            }
          }
          for (const [key, value] of Object.entries(args)) {
            if (!(key in packed)) packed[key] = value
          }
          pushPreviewEmitLog(eventName, packed)
        }
      : undefined)

  const readLivePageData = () => {
    if (ownerId) {
      return (
        previewComponentMap.value?.[ownerId]?.data ??
        ownerInfo?.data ??
        activeDoc.value!.data
      )
    }
    // 必须读 previewRuntimeData（setData 写入处），不能用 resolved 快照
    return previewRuntimeData.value ?? activeDoc.value!.data
  }

  await runEventBindings(raw, {
    pageData: readLivePageData(),
    getPageData: readLivePageData,
    xml: ownerInfo ? ownerInfo.xml : activeDoc.value.xml,
    modalStack,
    componentMap: canvasComponentMap.value,
    componentMethodsMap: componentMethodsMap.value,
    runComponentMethod: runComponentExposedMethod,
    resolveMethod: boundResolveMethod,
    localMethods: boundLocalMethods,
    scope: options?.scope,
    eventArgs: options?.eventArgs,
    dollarProps: boundDollarProps,
    emit: debugEmit,
    emitWithArgs: debugEmitWithArgs,
    hasPage: (pageId) => pages.value.some((item) => item.id === pageId),
    navigateTo: async (pageId, params) => {
      if (!isPreviewSessionLive(sessionGen)) return
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
      if (!isPreviewSessionLive(sessionGen)) return
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
      if (!isPreviewSessionLive(sessionGen)) return
      if (ownerId) {
        applyComponentPreviewSetData(ownerId, prop, value)
      } else {
        applyPreviewSetData(prop, value)
      }
    },
    updateProps: (prop, value) => {
      if (!isPreviewSessionLive(sessionGen)) return
      applyPreviewUpdateProps(prop, value, {
        componentId: ownerId || undefined,
        config: boundUpdatePropsConfig,
        hostAttrs: boundHostAttrs,
        hostDataOwnerId: boundHostDataOwnerId,
      })
    },
    showToast: (message, duration) => {
      if (!isPreviewSessionLive(sessionGen)) return
      showPreviewToast(message, duration)
    },
    getDeviceInfo: previewGetDeviceInfo,
    onUnknownMethod: (name) => {
      if (!isPreviewSessionLive(sessionGen)) return
      if (name.startsWith('navigateTo:')) {
        ElMessage.warning(name.replace(/^navigateTo:\s*/, ''))
      } else if (name.startsWith('自定义方法')) {
        ElMessage.error(name)
      } else if (name.startsWith('updateProps')) {
        ElMessage.warning(name)
      }
    },
  })
}

/** 预览进入时拉取控制器绑定字段（与数据池编辑态隔离） */
let previewControllerHydrateSeq = 0

function commitPreviewRuntime(
  data: import('../types/page-data').PageData,
  map: ComponentRenderMap,
) {
  previewRuntimeData.value = data
  previewComponentMap.value = map
  previewPropOverrides.value = isComponentResource.value
    ? restoreComponentDebugProps()
    : {}
  previewEmitLogs.value = []
}

/** 页面已展示后拉取控制器绑定并触发 onLoading / onSuccess / onError */
async function hydratePreviewControllerBindings() {
  const path = projectStore.path
  const runtime = previewRuntimeData.value
  if (!path || !runtime || workspaceMode.value !== 'preview') return
  if (!hasControllerBoundFields(runtime)) return

  const seq = ++previewControllerHydrateSeq
  const sessionGen = previewSessionGen
  try {
    const next = await loadControllerBoundPageData(runtime, {
      projectPath: path,
      dryRun: true,
      typeLibrary: dataTypeLibrary.value,
      pageScope: {
        ...Object.fromEntries(
          (runtime.fields ?? []).map((f) => [f.name.trim(), f.value]),
        ),
        $query: { ...routeParams.value },
        $route: { ...routeParams.value },
      },
      runEvents: (raw, eventArgs) =>
        runPreviewBindings(raw, { eventArgs }),
    })
    if (seq !== previewControllerHydrateSeq) return
    if (!isPreviewSessionLive(sessionGen)) return
    if (workspaceMode.value !== 'preview') return
    previewRuntimeData.value = next
  } catch (err) {
    console.warn('[voider] 预览控制器数据加载失败:', err)
  }
}

async function preparePreviewRuntime() {
  const sessionGen = previewSessionGen
  if (!activeDoc.value) {
    clearPreviewRuntime()
    return
  }
  // 组件预览：先从磁盘同步 debugProps 基线，再跑生命周期（updateProps 只改内存）
  if (
    isComponentResource.value &&
    activeComponentId.value &&
    projectStore.path
  ) {
    try {
      const detail = await getComponent(
        projectStore.path,
        activeComponentId.value,
      )
      if (!isPreviewSessionLive(sessionGen)) return
      if (activeComponent.value?.id === detail.id) {
        activeComponent.value = {
          ...activeComponent.value,
          config: {
            ...activeComponent.value.config,
            debugProps: { ...(detail.config.debugProps ?? {}) },
          },
        }
      }
    } catch (err) {
      console.warn('[voider] 同步组件调试 Props 失败:', err)
    }
  }
  if (!isPreviewSessionLive(sessionGen) || !activeDoc.value) return
  if (workspaceMode.value !== 'preview') return
  // 先挂初始数据，再异步拉控制器，避免进入预览时卡在旧态
  commitPreviewRuntime(
    clonePageData(activeDoc.value.data ?? { fields: [] }),
    cloneComponentRenderMap(componentMap.value),
  )
  await hydratePreviewControllerBindings()
}

async function runLifecycleHook(key: LifecycleHookKey) {
  const raw = lifecycleConfig.value[key]
  if (!raw?.trim()) return
  await runPreviewBindings(raw, {
    dollarProps: editorDollarProps.value,
  })
}

async function runNestedComponentLifecycle(
  phase: 'mount' | 'unmount',
  payload: PreviewInteractPayload,
) {
  if (!activeDoc.value) return
  if (phase === 'mount' && workspaceMode.value !== 'preview') return
  const sessionGen = previewSessionGen
  const componentId = payload.componentEmit?.componentId?.trim() || ''
  if (!componentId) return
  const lifecycle = canvasComponentMap.value[componentId]?.lifecycle
  if (!lifecycle) return
  const keys = phase === 'unmount' ? LIFECYCLE_UNMOUNT_KEYS : LIFECYCLE_MOUNT_KEYS
  for (const key of keys) {
    if (
      phase === 'mount' &&
      (!isPreviewSessionLive(sessionGen) || previewLifecycleGate.value <= 0)
    ) {
      return
    }
    const raw = lifecycle[key]
    if (!raw?.trim()) continue
    // 卸载钩子在离开预览时仍需执行，绕过 handlePreviewInteract 的 preview 门闩
    if (phase === 'unmount' && workspaceMode.value !== 'preview') {
      await runPreviewBindings(raw, {
        scope: payload.scope,
        dollarProps: payload.dollarProps,
        dataOwnerComponentId: componentId,
        updatePropsHostAttrs: payload.componentEmit?.hostAttrs,
        updatePropsHostDataOwnerId:
          payload.componentEmit?.outer?.componentId?.trim() || undefined,
      })
      continue
    }
    await handlePreviewInteract({
      eventKey: key,
      raw,
      scope: payload.scope,
      dollarProps: payload.dollarProps,
      componentEmit: payload.componentEmit,
    })
  }
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

/** setData 高频时合并 onUpdate，避免滚动帧内反复跑生命周期 */
function scheduleLifecycleUpdate() {
  if (lifecycleUpdateTimer != null) return
  lifecycleUpdateTimer = setTimeout(() => {
    lifecycleUpdateTimer = null
    void runLifecycleUpdateSequence()
  }, 32)
}

watch(workspaceMode, async (mode, prev) => {
  if (prev === 'preview' && mode !== 'preview') {
    bumpPreviewSession()
    previewLifecycleGate.value = 0
    await teardownLifecycleSession()
    clearPreviewRuntime()
    return
  }
  if (mode === 'preview' && prev !== 'preview') {
    bumpPreviewSession()
    const sessionGen = previewSessionGen
    await preparePreviewRuntime()
    if (!isPreviewSessionLive(sessionGen)) return
    previewLifecycleGate.value += 1
    await nextTick()
    if (!isPreviewSessionLive(sessionGen)) return
    await syncLifecycleSession()
  }
})

watch(
  () =>
    [
      isComponentResource.value,
      activeComponentId.value,
      activeComponent.value?.id,
    ] as const,
  () => {
    if (!isComponentResource.value || !activeComponentId.value) return
    // 文档尚未切到目标组件时不要恢复，避免沿用上一个组件的 debugProps
    if (activeComponent.value?.id !== activeComponentId.value) return
    previewPropOverrides.value = restoreComponentDebugProps()
  },
)

async function handlePreviewInteract(payload: PreviewInteractPayload) {
  const sessionGen = previewSessionGen

  if (payload.eventKey === '__lifecycle') {
    const phase = payload.eventArgs?.phase
    if (phase === 'mount') {
      if (workspaceMode.value !== 'preview' || !activeDoc.value) return
      if (!isPreviewSessionLive(sessionGen)) return
      if (previewLifecycleGate.value <= 0) return
      await runNestedComponentLifecycle('mount', payload)
    } else if (phase === 'unmount') {
      // 离开预览时 mode 可能已切走，仍允许跑卸载钩子
      if (!activeDoc.value) return
      await runNestedComponentLifecycle('unmount', payload)
    }
    return
  }

  if (workspaceMode.value !== 'preview' || !activeDoc.value) return
  if (!isPreviewSessionLive(sessionGen)) return

  if (payload.eventKey === '__setData') {
    const prop = payload.eventArgs?.prop
    const value = payload.eventArgs?.value
    if (typeof prop === 'string' && prop.trim()) {
      const ownerId = payload.componentEmit?.componentId?.trim()
      if (ownerId) {
        applyComponentPreviewSetData(
          ownerId,
          prop.trim(),
          value as import('../types/page-data').DataFieldValue,
        )
      } else {
        applyPreviewSetData(
          prop.trim(),
          value as import('../types/page-data').DataFieldValue,
        )
      }
    }
    return
  }

  type EmitLayer = NonNullable<PreviewInteractPayload['componentEmit']>

  function packEmitArgs(
    layer: EmitLayer,
    eventName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const params =
      layer.events.find((item) => item.name.trim() === eventName)?.params ?? []
    const packed: Record<string, unknown> = {}
    for (const param of params) {
      const key = param.name.trim()
      if (!key || key.startsWith('...')) continue
      if (key in args) packed[key] = coerceEmitParamValue(param.type, args[key])
    }
    for (const [key, value] of Object.entries(args)) {
      if (!(key in packed)) packed[key] = value
    }
    return packed
  }

  /** 沿 outer 找到声明了该事件绑定的外层组件 */
  function findOuterWithEvent(
    start: EmitLayer | undefined,
    eventName: string,
  ): EmitLayer | undefined {
    let layer = start
    while (layer) {
      if (layer.hostAttrs[eventName]?.trim()) return layer
      layer = layer.outer
    }
    return undefined
  }

  function createLayerEmitWithArgs(layer: EmitLayer) {
    return (eventName: string, args: Record<string, unknown>) => {
      const packed = packEmitArgs(layer, eventName, args)
      const raw = layer.hostAttrs[eventName]
      // 组件资源预览：子组件 emit 时父级可能未绑定，仍要记入调试日志
      if (isComponentResource.value && !raw?.trim()) {
        pushPreviewEmitLog(eventName, packed)
        return
      }
      if (!raw?.trim()) return
      // 组件资源预览：有父级绑定时也先记一条，便于调试
      if (isComponentResource.value) {
        pushPreviewEmitLog(eventName, packed)
      }
      const parent = findOuterWithEvent(layer.outer, eventName)
      // hostAttrs 写在父级 XML 上：有 outer 则父组件数据池，否则页面数据池
      const hostDataOwner = layer.outer?.componentId?.trim() || undefined
      void runPreviewBindings(raw, {
        scope: layer.hostScope ?? payload.scope,
        eventArgs: packed,
        dataOwnerComponentId: hostDataOwner,
        // 再 emit 时交给外层（GoodsCard → GoodsList → 页面）
        emitWithArgs: parent
          ? createLayerEmitWithArgs(parent)
          : isComponentResource.value
            ? (name, nextArgs) => {
                pushPreviewEmitLog(name, packEmitArgs(layer, name, nextArgs))
              }
            : undefined,
        emitFn: parent
          ? createComponentEmit(parent.events, (name, nextArgs) => {
              createLayerEmitWithArgs(parent)(name, nextArgs)
            })
          : createPreviewDebugEmit(),
      })
    }
  }

  /** 组件资源预览：根 XML 上的 emit（无 componentEmit）直接写入调试日志 */
  function captureRootComponentEmit(
    eventName: string,
    args: Record<string, unknown>,
  ) {
    const events = activeComponent.value?.config.events ?? []
    pushPreviewEmitLog(
      eventName,
      packEmitArgs(
        {
          componentId: activeComponentId.value || '',
          events,
          hostAttrs: {},
        },
        eventName,
        args,
      ),
    )
  }

  const hostEmit = payload.componentEmit
  const emitWithArgs = hostEmit
    ? createLayerEmitWithArgs(hostEmit)
    : isComponentResource.value
      ? captureRootComponentEmit
      : undefined
  const emitFn = hostEmit
    ? createComponentEmit(hostEmit.events, (eventName, args) => {
        createLayerEmitWithArgs(hostEmit)(eventName, args)
      })
    : createPreviewDebugEmit()

  // 绑定写在组件定义内（如 Pager 的 onScrollToLower）→ 写组件数据池
  await runPreviewBindings(payload.raw, {
    scope: payload.scope,
    eventArgs: payload.eventArgs,
    dollarProps: payload.dollarProps,
    emitFn,
    emitWithArgs,
    dataOwnerComponentId: payload.componentEmit?.componentId?.trim() || undefined,
    updatePropsHostAttrs: payload.componentEmit?.hostAttrs,
    updatePropsHostDataOwnerId:
      payload.componentEmit?.outer?.componentId?.trim() || undefined,
  })
}

function applyPreviewSetData(prop: string, value: import('../types/page-data').DataFieldValue) {
  if (!activeDoc.value || workspaceMode.value !== 'preview') return
  if (!previewRuntimeData.value) resetPreviewRuntime()
  const fields = [...(previewRuntimeData.value?.fields ?? [])]
  const index = fields.findIndex((item) => item.name.trim() === prop.trim())
  if (index < 0) {
    ElMessage.warning(`数据池不存在字段：${prop}`)
    return
  }
  const prev = fields[index]!
  if (sameJson(prev.value, value)) return
  // json 对象同步 objectFields，避免面板/后续逻辑读到旧嵌套值
  let objectFields = prev.objectFields
  if (
    prev.type === 'json' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray(prev.objectFields) &&
    prev.objectFields.length
  ) {
    const obj = value as Record<string, unknown>
    objectFields = prev.objectFields.map((sub) => {
      const key = sub.name.trim()
      if (!key || !(key in obj)) return sub
      return { ...sub, value: obj[key] as import('../types/page-data').DataFieldValue }
    })
  }
  fields[index] = { ...prev, value, objectFields }
  // 与组件路径一致：写入时重算，避免 pullText 等仍停在旧值
  previewRuntimeData.value = resolveComputedPageData(
    { fields },
    {
      getDeviceInfo: previewGetDeviceInfo,
      dollarProps: editorDollarProps.value ?? {},
    },
  )
  scheduleLifecycleUpdate()
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
  // 元信息面板保存时保留当前调试 Props，避免被覆盖清空
  const nextConfig: ComponentConfig = {
    ...config,
    debugProps: {
      ...(activeComponent.value.config.debugProps ?? {}),
      ...(config.debugProps ?? {}),
      ...previewPropOverrides.value,
    },
  }
  activeComponent.value = { ...activeComponent.value, config: nextConfig }
  try {
    activeComponent.value = await saveComponentConfig({
      projectPath: projectStore.path,
      componentId: activeComponent.value.id,
      config: nextConfig,
    })
    previewPropOverrides.value = restoreComponentDebugProps()
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

let ossSaveTimer: ReturnType<typeof setTimeout> | null = null

async function handleOssLibraryUpdate(library: OssLibrary) {
  if (!projectStore.path) return
  ossLibrary.value = library

  if (ossSaveTimer) clearTimeout(ossSaveTimer)
  ossSaveTimer = setTimeout(async () => {
    if (!projectStore.path) return
    try {
      ossLibrary.value = await saveOssLibraryApi({
        projectPath: projectStore.path,
        connections: ossLibrary.value.connections,
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存对象存储配置失败')
    }
  }, 400)
}

function persistBackendServices() {
  if (!projectStore.path) return
  if (backendServiceSaveTimer) clearTimeout(backendServiceSaveTimer)
  backendServiceSaveTimer = setTimeout(async () => {
    if (!projectStore.path) return
    try {
      backendServiceLibrary.value = await saveBackendServiceLibraryApi({
        projectPath: projectStore.path,
        services: backendServiceLibrary.value.services,
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存服务配置失败')
    }
  }, 400)
}

function handleBackendServiceUpdate(service: BackendService) {
  const nameTaken = backendServiceLibrary.value.services.some(
    (item) => item.id !== service.id && item.name === service.name,
  )
  if (nameTaken) {
    ElMessage.error(`模块「${service.name}」已存在`)
    return
  }
  backendServiceLibrary.value = {
    services: backendServiceLibrary.value.services.map((item) =>
      item.id === service.id ? service : item,
    ),
  }
  persistBackendServices()
}

function openBackendServiceConfig(service: BackendService) {
  activeServiceId.value = service.id
  serviceDialogVisible.value = true
}

async function renameBackendService(service: BackendService) {
  let name = ''
  try {
    const result = await ElMessageBox.prompt('请输入新的模块显示名', '重命名', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: service.name,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    name = String(result.value ?? '').trim()
  } catch {
    return
  }
  if (!name || name === service.name) return
  if (
    backendServiceLibrary.value.services.some(
      (item) => item.id !== service.id && item.name === name,
    )
  ) {
    ElMessage.error(`模块「${name}」已存在`)
    return
  }
  handleBackendServiceUpdate({ ...service, name })
  ElMessage.success('已重命名')
}

type ServiceMenuCommand = 'rename' | 'config' | 'delete'

function handleServiceMenuCommand(
  command: ServiceMenuCommand,
  service: BackendService,
) {
  if (command === 'rename') {
    void renameBackendService(service)
    return
  }
  if (command === 'config') {
    openBackendServiceConfig(service)
    return
  }
  if (command === 'delete') {
    void removeBackendService(service)
  }
}

async function addBackendService() {
  let id = ''
  try {
    const result = await ElMessageBox.prompt(
      '模块 ID 将作为目录名 services/{id}/，仅允许英文（字母开头）',
      '新建模块',
      {
        confirmButtonText: '添加',
        cancelButtonText: '取消',
        inputPlaceholder: '如 shop',
        inputPattern: /^[A-Za-z][A-Za-z0-9_-]*$/,
        inputErrorMessage: '仅允许英文：字母开头，字母/数字/下划线/连字符',
      },
    )
    id = String(result.value ?? '').trim()
  } catch {
    return
  }
  if (!isValidServiceId(id)) {
    ElMessage.error('模块 ID 不合法')
    return
  }
  if (backendServiceLibrary.value.services.some((s) => s.id === id)) {
    ElMessage.error(`模块「${id}」已存在`)
    return
  }
  const next = createEmptyBackendService(id)
  backendServiceLibrary.value = {
    services: [...backendServiceLibrary.value.services, next],
  }
  activeServiceId.value = next.id
  persistBackendServices()
  serviceDialogVisible.value = true
}

async function removeBackendService(service: BackendService) {
  try {
    await ElMessageBox.confirm(
      `确定删除模块「${service.name}」吗？`,
      '删除模块',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const editingDeleted =
    serviceDialogVisible.value && activeServiceId.value === service.id
  backendServiceLibrary.value = {
    services: backendServiceLibrary.value.services.filter((s) => s.id !== service.id),
  }
  if (activeServiceId.value === service.id) {
    activeServiceId.value = backendServiceLibrary.value.services[0]?.id ?? ''
  }
  if (editingDeleted) {
    serviceDialogVisible.value = false
  }
  persistBackendServices()
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

function openAddDialog(options?: { intoSlotDebug?: boolean; tab?: 'widget' | 'component' }) {
  if (!activeDoc.value) return
  addIntoSlotDebug.value = Boolean(options?.intoSlotDebug)
  addDialogTab.value = options?.tab ?? 'widget'
  addDialogVisible.value = true
}

function openAddWidgetDialog() {
  openAddDialog({ intoSlotDebug: false, tab: 'widget' })
}

function openAddDebugDialog() {
  if (!showAddDebugButton.value) return
  openAddDialog({ intoSlotDebug: true, tab: 'widget' })
}

/** 组件内嵌组件时，排除自身，避免直接循环引用 */
const addableComponents = computed(() => {
  if (!isComponentResource.value || !activeComponentId.value) {
    return components.value
  }
  return components.value.filter((item) => item.id !== activeComponentId.value)
})

async function handleAddComponentInstance(component: ComponentSummary) {
  if (!activeDoc.value || !projectStore.path) return
  if (
    isComponentResource.value &&
    component.id === activeComponentId.value
  ) {
    ElMessage.warning('不能将组件添加到自身')
    return
  }
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
    const intoSlotDebug = addIntoSlotDebug.value
    const outlet = intoSlotDebug
      ? null
      : parseSlotOutletNodeId(selectedNodeId.value)
    const appendTarget = outlet?.hostId ?? selectedNodeId.value
    const { xml, newNodeId } = appendComponent(
      activeDoc.value.xml,
      appendTarget,
      {
        componentId: component.id,
        name,
        width,
        height,
        allowRootSiblings: isComponentResource.value && !outlet && !intoSlotDebug,
        slot: outlet?.slotName,
        intoSlotDebug,
      },
    )
    selectedNodeId.value = newNodeId
    addDialogVisible.value = false
    addIntoSlotDebug.value = false
    await handleXmlUpdate(xml)
    ElMessage.success(
      intoSlotDebug ? `已添加调试组件 ${name}` : `已添加组件 ${name}`,
    )
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

function handleOpenEventConfig(nodeId: string) {
  if (!isEditMode.value || !nodeId) return
  selectedNodeId.value = nodeId
  propsTab.value = 'event'
}

async function handleAddWidget(tag: WidgetTag) {
  if (!activeDoc.value) return

  try {
    const intoSlotDebug = addIntoSlotDebug.value
    const outlet = intoSlotDebug
      ? null
      : parseSlotOutletNodeId(selectedNodeId.value)
    const appendTarget = outlet?.hostId ?? selectedNodeId.value
    const { xml, newNodeId } = appendWidget(
      activeDoc.value.xml,
      appendTarget,
      tag,
      {
        allowRootSiblings: resourceKind.value === 'component' && !outlet && !intoSlotDebug,
        slot: outlet?.slotName,
        intoSlotDebug,
      },
    )
    addDialogVisible.value = false
    addIntoSlotDebug.value = false
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    ElMessage.success(intoSlotDebug ? `已添加调试 ${tag}` : `已添加 ${tag}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加控件失败')
  }
}

/** 多窗口：右侧「新建窗口」追加子布局并自动分配 windowKey */
async function handleAddMultiWindow(parentId: string) {
  if (!activeDoc.value || !parentId) return
  try {
    const { xml, newNodeId } = appendWidget(
      activeDoc.value.xml,
      parentId,
      'LinearLayout',
    )
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    propsTab.value = 'style'
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '新建窗口失败')
  }
}

async function handleDeleteWidget() {
  if (
    !activeDoc.value ||
    isSlotOutletNodeId(selectedNodeId.value) ||
    !canDeleteNode(selectedNodeId.value)
  ) {
    return
  }

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
  slot?: string
}) {
  if (!activeDoc.value || !isEditMode.value) return

  try {
    const { xml, newNodeId } = moveWidget(
      activeDoc.value.xml,
      payload.sourceId,
      payload.targetId,
      payload.position,
      payload.slot ? { slot: payload.slot } : undefined,
    )
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    ElMessage.success('已调整控件结构')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '移动控件失败')
  }
}

watch(
  () => projectStore.path,
  async (path) => {
    workspaceUiReady.value = false
    if (!path) return
    const saved = loadWorkspaceUiState(path)
    if (saved) applyWorkspaceUiState(saved)
    await loadPages()
    if (activeServiceId.value) {
      const st = backendByService.value[activeServiceId.value]
      if (st?.layer) backendServiceLayer.value = st.layer
    }
    // 等列表与服务库加载完再允许写回，避免中间态冲掉 flowEditing
    workspaceUiReady.value = true
  },
  { immediate: true },
)

watch(
  activeServiceId,
  (id) => {
    if (!id || !workspaceUiReady.value) return
    const st = backendByService.value[id]
    if (st?.layer) backendServiceLayer.value = st.layer
  },
)

watch(
  collectWorkspaceUiState,
  (state) => {
    if (!workspaceUiReady.value || !projectStore.path) return
    saveWorkspaceUiState(projectStore.path, state)
  },
  { deep: true },
)
</script>

<template>
  <div class="workspace">
    <nav class="activity-rail" aria-label="项目资源">
      <el-tooltip content="前端" placement="right">
        <button
          type="button"
          class="rail-btn"
          :class="{ active: isFrontendNav }"
          @click="selectFrontendNav"
        >
          <el-icon :size="20"><DevelopIcon /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="后端" placement="right">
        <button
          type="button"
          class="rail-btn"
          :class="{ active: isBackendNav }"
          @click="selectBackendNav"
        >
          <el-icon :size="20"><BackendIcon /></el-icon>
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
          :class="{ active: topNav === item.key }"
          @click="selectProjectNav(item.key)"
        >
          <el-icon :size="20"><component :is="item.icon" /></el-icon>
        </button>
      </el-tooltip>
    </nav>

    <aside v-show="isFrontendNav" class="side-panel">
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
              <el-dropdown
                v-for="item in components"
                :key="item.id"
                trigger="contextmenu"
                class="page-dropdown"
                @command="
                  (cmd) =>
                    handleComponentMenuCommand(cmd as ComponentMenuCommand, item)
                "
              >
                <button
                  type="button"
                  class="page-item"
                  :class="{ active: item.id === activeComponentId }"
                  @click="openComponent(item.id)"
                  @contextmenu.prevent
                >
                  <el-icon><Box /></el-icon>
                  <div class="page-meta">
                    <div class="page-name">{{ item.name }}</div>
                    <div class="page-id">{{ item.id }}</div>
                  </div>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>
                      删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
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
        :component-map="componentMap"
        @select="selectedNodeId = $event"
        @open-repeat="handleOpenRepeatConfig"
        @open-event="handleOpenEventConfig"
        @move="handleMoveWidget"
        @toggle-hidden="toggleEditorHidden"
      />
    </aside>

    <aside v-show="isBackendNav" class="side-panel">
      <div class="pages-section backend-services-section">
        <div class="section-header">
          <span class="section-title">模块列表</span>
          <el-button type="primary" :icon="Plus" size="small" @click="addBackendService">
            新建
          </el-button>
        </div>
        <div class="pages-body">
          <el-empty
            v-if="!backendServiceLibrary.services.length"
            description="暂无服务，点击新建"
            :image-size="64"
          />
          <div v-else class="page-list">
            <el-dropdown
              v-for="service in backendServiceLibrary.services"
              :key="service.id"
              trigger="contextmenu"
              class="page-dropdown"
              @command="
                (cmd) =>
                  handleServiceMenuCommand(cmd as ServiceMenuCommand, service)
              "
            >
              <button
                type="button"
                class="page-item"
                :class="{ active: service.id === activeServiceId }"
                @click="activeServiceId = service.id"
                @dblclick="openBackendServiceConfig(service)"
                @contextmenu.prevent
              >
                <el-icon><BackendIcon /></el-icon>
                <div class="page-meta">
                  <div class="page-name">{{ service.name }}</div>
                  <div class="page-id">{{ service.id }}</div>
                </div>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">重命名</el-dropdown-item>
                  <el-dropdown-item command="config">配置</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>
    </aside>

    <div class="workspace-stage">
    <section class="center-panel">
      <div class="preview-header">
        <template v-if="isBackendNav">
          <span class="preview-title">{{
            activeBackendService ? backendLayerTitle : '后端'
          }}</span>
          <span class="preview-sub">{{ backendCenterPath }}</span>
          <template v-if="activeBackendService && backendServiceLayer === 'controller'">
            <div class="preview-header-actions">
              <el-button
                type="primary"
                link
                :icon="Plus"
                @click="backendWorkspaceRef?.openCreateController()"
              >
                创建控制器
              </el-button>
              <el-button
                type="primary"
                link
                :icon="Plus"
                @click="backendWorkspaceRef?.addApi()"
              >
                创建 API
              </el-button>
            </div>
          </template>
          <template
            v-else-if="
              activeBackendService &&
              (backendServiceLayer === 'service' || backendServiceLayer === 'data')
            "
          >
            <div class="preview-header-actions">
              <el-button
                type="primary"
                link
                :icon="Plus"
                @click="backendWorkspaceRef?.openCreateProcessor()"
              >
                创建处理器
              </el-button>
              <el-button
                type="primary"
                link
                :icon="Plus"
                @click="backendWorkspaceRef?.addProcessorMethod()"
              >
                创建方法
              </el-button>
            </div>
          </template>
        </template>
        <template v-else-if="isIconsMode">
          <span class="preview-title">图标库</span>
          <span class="preview-sub">icons</span>
        </template>
        <template v-else-if="isDataTypesMode">
          <span class="preview-title">数据类型</span>
          <span class="preview-sub">types</span>
        </template>
        <template v-else-if="isMysqlMode">
          <span class="preview-title">MySQL</span>
          <span class="preview-sub">mysql</span>
        </template>
        <template v-else-if="isOssMode">
          <span class="preview-title">对象存储</span>
          <span class="preview-sub">oss</span>
        </template>
        <template v-else-if="activeDoc">
          <span class="preview-title">{{ frontendModeTitle }}</span>
          <span class="preview-sub">
            {{ isComponentResource ? 'components' : 'pages' }}/{{ activeDoc.id }}{{ centerDirSegment ? `/${centerDirSegment}` : '' }}{{ centerPathQuery }}
          </span>
          <el-button
            v-if="isMethodsMode"
            class="preview-header-action"
            type="primary"
            link
            :icon="Plus"
            @click="openAddMethod"
          >
            添加方法
          </el-button>
          <el-button
            v-else-if="isDataPoolMode"
            class="preview-header-action"
            type="primary"
            link
            :icon="Plus"
            @click="dataPoolPanelRef?.addField()"
          >
            添加字段
          </el-button>
        </template>
        <span v-else class="preview-title">{{ isComponentResource ? '组件预览' : '页面预览' }}</span>
      </div>

      <div class="preview-body">
        <!-- 仅首次无文档时展示骨架，避免切换页面时插入骨架把画布顶抖 -->
        <el-skeleton
          v-if="loadingPage && isFrontendNav && !activeDoc"
          :rows="8"
          animated
        />
        <div v-show="isBackendNav" class="preview-pane-fill">
          <KeepAlive>
            <BackendServiceWorkspace
              v-if="isBackendNav && activeBackendService"
              :key="activeBackendService.id"
              ref="backendWorkspaceRef"
              :project-path="projectStore.path"
              :service-id="activeBackendService.id"
              :service-name="activeBackendService.name"
              :type-library="dataTypeLibrary"
              :layer="backendServiceLayer"
              :restored-controller-id="activeBackendUi?.controllerId"
              :restored-business="activeBackendUi?.processors.business ?? null"
              :restored-data="
                activeBackendUi?.processors.data
                  ? {
                      processorId: activeBackendUi.processors.data.processorId,
                      methodId: activeBackendUi.processors.data.methodId,
                    }
                  : null
              "
              @update:layer="onBackendLayerUpdate"
              @update:debug-target="backendDebugTarget = $event"
              @update:controller-id="onBackendControllerId"
              @update:business-selection="onBackendBusinessSelection"
              @update:data-selection="onBackendDataSelection"
            />
          </KeepAlive>
          <el-empty
            v-if="!activeBackendService"
            description="暂无服务，请在左侧新建"
            :image-size="80"
          />
        </div>
        <template v-if="!isBackendNav">
        <IconLibraryPanel
          v-if="isIconsMode"
          :library="iconLibrary"
          :project-path="projectStore.path"
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
          :project-path="projectStore.path"
          @update:library="handleMysqlLibraryUpdate"
          @update:type-library="handleDataTypeLibraryUpdate"
        />
        <OssPanel
          v-else-if="isOssMode"
          :library="ossLibrary"
          @update:library="handleOssLibraryUpdate"
        />
        <el-empty
          v-else-if="!activeDoc"
          :description="isComponentResource ? '请选择或新建一个组件' : '请选择或新建一个页面'"
        />
        <DataPoolPanel
          v-else-if="isDataPoolMode"
          ref="dataPoolPanelRef"
          :data="activeDoc.data ?? { fields: [] }"
          :xml="activeDoc.xml"
          :icon-options="iconOptions"
          :get-device-info="previewGetDeviceInfo"
          :component-props="editorConditionComponentProps"
          :dollar-props="editorDollarProps"
          :type-library="dataTypeLibrary"
          :project-path="projectStore.path"
          :methods="editorMethods"
          :component-map="componentMap"
          :component-methods-map="componentMethodsMap"
          :emit-events="
            isComponentResource ? activeComponent?.config.events : undefined
          "
          :page-query-params="isPageResource ? pageQueryParams : null"
          @update:data="handleDataUpdate"
        />
        <MethodsPanel
          v-else-if="isMethodsMode"
          :methods="editorMethods"
          @edit="openEditMethod"
          @remove="handleRemoveMethod"
        />
        <LifecyclePanel
          v-else-if="isLifecycleMode"
          :lifecycle="lifecycleConfig"
          :methods="editorMethods"
          :data-fields="activeDoc.data?.fields ?? []"
          :xml="activeDoc.xml"
          :component-map="componentMap"
          :component-methods-map="componentMethodsMap"
          :icon-options="iconOptions"
          :emit-events="isComponentResource ? activeComponent?.config.events : undefined"
          :component-props="editorConditionComponentProps"
          :type-library="dataTypeLibrary"
          :project-path="projectStore.path"
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
          :phone-screen-width="canvasWidth"
          :phone-screen-height="667"
          :selected-id="selectedNodeId"
          :selectable="isEditMode"
          :show-add-button="isEditMode"
          :show-add-debug-button="showAddDebugButton"
          :show-delete-button="canDeleteSelected"
          :expand-repeat="workspaceMode === 'preview'"
          :page-data="resolvedPageData"
          :icon-library="iconLibrary"
          :component-map="canvasComponentMap"
          :dollar-props="editorDollarProps"
          :route-params="routeParams"
          :project-path="projectStore.path || undefined"
          :preview-lifecycle-gate="previewLifecycleGate"
          :hidden-node-ids="isEditMode ? editorHiddenNodeIds : undefined"
          :toast="workspaceMode === 'preview' ? previewToast : null"
          :show-device-chrome="!isComponentResource"
          :status-bar-selectable="isEditMode && isPageResource"
          :status-bar-background="resolvedPageStatusBar.backgroundColor"
          :status-bar-text-style="resolvedPageStatusBar.textStyle"
          :status-bar-cover="resolvedPageStatusBar.cover"
          :status-bar-navigation-bar="resolvedPageStatusBar.navigationBar"
          :navigation-bar-title="activePage?.config.title || activePage?.config.name || ''"
          @select="selectedNodeId = $event"
          @open-repeat="handleOpenRepeatConfig"
          @open-event="handleOpenEventConfig"
          @add-window="handleAddMultiWindow"
          @interact="handlePreviewInteract"
          @add="openAddWidgetDialog"
          @add-debug="openAddDebugDialog"
          @delete="handleDeleteWidget"
        />
        <PreviewCanvasToolbar
          v-if="workspaceMode === 'preview' && activeDoc"
          :mode="isComponentResource ? 'component' : 'page'"
          :can-go-back="canPreviewGoBack"
          :has-entry-page="hasEntryPage"
          :config="activeComponent?.config"
          :methods="editorMethods"
          @back="handlePreviewNavigateBack"
          @go-entry="handlePreviewGoEntry"
          @refresh="handlePreviewRefresh"
          @invoke-method="invokeActiveExposedMethod($event.name, $event.args)"
        />
        </template>
      </div>
    </section>

    <template v-if="isFrontendNav && activeDoc && isEditMode && isComponentResource">
      <ComponentMetaPanel
        v-if="!selectedNodeId"
        :config="activeComponent!.config"
        :methods="editorMethods"
        :icon-options="iconOptions"
        :type-library="dataTypeLibrary"
        @update:config="handleComponentConfigUpdate"
      />
      <PropsPanel
        v-else
        v-model:tab="propsTab"
        back-label="返回组件设置"
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
        :project-path="projectStore.path || undefined"
        :type-library="dataTypeLibrary"
        :open-repeat-request="openRepeatRequest"
        @update:xml="handleXmlUpdate"
        @back="selectedNodeId = ''"
      />
    </template>
    <PropsPanel
      v-else-if="isFrontendNav && activeDoc && isEditMode"
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
      :project-path="projectStore.path || undefined"
      :type-library="dataTypeLibrary"
      :open-repeat-request="openRepeatRequest"
      :status-bar-config="isPageResource ? pageStatusBarConfig : null"
      :is-page-resource="isPageResource"
      :page-query-params="isPageResource ? pageQueryParams : null"
      :page-debug-query="isPageResource ? pageDebugQuery : null"
      :canvas-scene="canvasScene"
      @update:xml="handleXmlUpdate"
      @update:status-bar="handleStatusBarUpdate"
      @update:page-query-params="handlePageQueryParamsUpdate"
      @update:page-debug-query="handlePageDebugQueryUpdate"
    />
    <PreviewDebugPanel
      v-else-if="isFrontendNav && workspaceMode === 'preview' && activeDoc"
      :mode="isComponentResource ? 'component' : 'page'"
      :config="activeComponent?.config"
      :prop-values="previewDebugDollarProps"
      :page-data="resolvedPageData"
      :emit-logs="previewEmitLogs"
      :type-library="dataTypeLibrary"
      :project-path="projectStore.path || undefined"
      @refresh="handlePreviewRefresh"
      @update:prop="handlePreviewPropUpdate"
      @update:data-field="applyPreviewSetData"
      @clear-emit-logs="previewEmitLogs = []"
    />
    <DataMethodDebugPanel
      v-else-if="isBackendNav && backendServiceLayer === 'data'"
      :target="dataDebugTarget"
      :type-library="dataTypeLibrary"
      @update:debug-params="
        (params) => backendWorkspaceRef?.applyDebugParams(params)
      "
    />
    <MethodFlowDebugPanel
      v-else-if="
        isBackendNav &&
        (backendServiceLayer === 'service' ||
          backendServiceLayer === 'controller')
      "
      :target="flowDebugTarget"
      :type-library="dataTypeLibrary"
      @update:debug-params="
        (params) => backendWorkspaceRef?.applyDebugParams(params)
      "
      @update:cursor="
        (state) => backendWorkspaceRef?.applyFlowDebugCursor(state)
      "
    />
    <aside
      v-else-if="
        !(
          (isFrontendNav &&
            (isDataPoolMode || isMethodsMode || isLifecycleMode)) ||
          (isBackendNav && backendServiceLayer === 'schedule')
        )
      "
      class="props-placeholder"
    >
      <div class="panel-header">{{ isBackendNav ? '服务' : '属性' }}</div>
      <el-empty
        :description="propsPlaceholderText"
        :image-size="64"
      />
    </aside>

    <div v-if="showModeTabs" class="mode-tabs">
      <div class="mode-tabs-bar">
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
    </div>
    <div v-else-if="showBackendLayerTabs" class="mode-tabs">
      <div class="mode-tabs-bar">
        <el-tooltip
          v-for="tab in backendLayerTabs"
          :key="tab.key"
          :content="tab.label"
          placement="top"
        >
          <button
            type="button"
            class="mode-tab"
            :class="{ active: backendServiceLayer === tab.key }"
            @click="onBackendLayerUpdate(tab.key)"
          >
            <el-icon :size="18"><component :is="tab.icon" /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </div>
    </div>

    <MethodEditDialog
      v-model="methodDialogVisible"
      :method="editingMethod"
      :data-fields="activeDoc?.data?.fields ?? []"
      :type-library="dataTypeLibrary"
      :xml="activeDoc?.xml"
      :component-map="componentMap"
      :component-methods-map="componentMethodsMap"
      :ambient-extra="methodAmbientExtra"
      @save="handleSaveMethod"
    />

    <BackendServiceEditor
      v-model="serviceDialogVisible"
      :service="activeBackendService"
      :mysql-library="mysqlLibrary"
      @save="handleBackendServiceUpdate"
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
      v-model="renameComponentVisible"
      title="重命名组件"
      width="480px"
      destroy-on-close
    >
      <el-form
        ref="renameComponentFormRef"
        :model="renameComponentForm"
        :rules="renameComponentRules"
        label-width="88px"
      >
        <el-form-item label="组件 ID" prop="id">
          <el-input
            v-model="renameComponentForm.id"
            placeholder="例如：GoodsList"
          />
        </el-form-item>
        <el-form-item label="组件名称" prop="name">
          <el-input
            v-model="renameComponentForm.name"
            placeholder="例如：商品列表"
          />
        </el-form-item>
      </el-form>
      <p class="add-hint">
        修改 ID 会重命名组件目录，并自动更新页面中的 componentId 引用。
      </p>
      <template #footer>
        <el-button @click="renameComponentVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="renamingComponent"
          @click="handleRenameComponentConfirm"
        >
          确定
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="addDialogVisible"
      :title="addIntoSlotDebug ? '添加调试元素' : '添加'"
      width="560px"
      destroy-on-close
      class="add-widget-dialog"
      @closed="addIntoSlotDebug = false"
    >
      <p v-if="addIntoSlotDebug" class="add-hint">
        写入当前插槽的调试预览内容，便于组件编辑时查看布局；导出 Vue 时插槽仍为空
        <code>&lt;slot&gt;</code>，不含这些子节点。
      </p>
      <p v-else class="add-hint">
        将添加到当前选中的布局容器；若选中的是 Text/Button/Input，则添加到其父布局。选中
        Component 时可添加插槽内容子节点。
      </p>
      <el-tabs v-model="addDialogTab" class="add-dialog-tabs">
        <el-tab-pane label="控件" name="widget">
          <div class="widget-options widget-options--tiles">
            <button
              v-for="item in addWidgetOptions"
              :key="item.tag"
              type="button"
              class="widget-option widget-option--tile"
              :title="item.description"
              @click="handleAddWidget(item.tag)"
            >
              <div class="widget-option-title">{{ item.label.split(/\s+/)[0] }}</div>
              <div class="widget-option-tag">{{ item.tag }}</div>
              <div class="widget-option-desc">{{ item.description }}</div>
            </button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="组件" name="component">
          <el-empty
            v-if="!addableComponents.length"
            :description="
              isComponentResource
                ? '暂无其它组件可嵌套'
                : '暂无组件，请先在「组件」中新建'
            "
            :image-size="64"
          />
          <div v-else class="widget-options widget-options--tiles">
            <button
              v-for="item in addableComponents"
              :key="item.id"
              type="button"
              class="widget-option widget-option--tile"
              :title="item.id"
              @click="handleAddComponentInstance(item)"
            >
              <div class="widget-option-title">{{ item.name }}</div>
              <div class="widget-option-tag">{{ item.id }}</div>
              <div class="widget-option-desc">插入为 Component 节点</div>
            </button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </div>
</template>

<style scoped>
.workspace {
  /* 右侧栏统一宽度（与前端预览调试栏一致） */
  --workspace-right-width: 300px;
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

.backend-services-section {
  flex: 1;
  max-height: none;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
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

.workspace-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  position: relative;
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

.preview-header-action {
  margin-left: auto;
  flex-shrink: 0;
}

.preview-header-actions {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mode-tabs {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 12px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.mode-tabs-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebeef5;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
  pointer-events: auto;
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

.preview-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.preview-pane-fill {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.props-placeholder {
  width: var(--workspace-right-width, 300px);
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

.add-dialog-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.widget-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.widget-options--tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  max-height: min(58vh, 460px);
  overflow-y: auto;
  padding: 2px;
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

.widget-option--tile {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 10px;
  text-align: center;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.widget-option:hover {
  border-color: #409eff;
  background: #ecf5ff;
}

.widget-option--tile:hover {
  box-shadow: 0 0 0 1px #409eff inset;
}

.widget-option-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.widget-option--tile .widget-option-title {
  font-size: 15px;
  line-height: 1.3;
}

.widget-option-tag {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #64748b;
  line-height: 1.2;
}

.widget-option-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
}

.widget-option--tile .widget-option-desc {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}
</style>
