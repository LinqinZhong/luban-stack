import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Skeleton,
  Tabs,
  Tooltip,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  ApiOutlined,
  AppstoreOutlined,
  ArrowLeftOutlined,
  ClockCircleOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  DollarOutlined,
  EditOutlined,
  EyeOutlined,
  FileOutlined,
  GoldOutlined,
  HighlightOutlined,
  PictureOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
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
  bumpPreviewDataRevision,
  resetPreviewDataRevision,
} from '../composables/preview-data-revision'
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
  getColorPalette,
  getDataTypeLibrary,
  getIconLibrary,
  getMysqlLibrary,
  getOssLibrary,
  saveBackendServiceLibrary as saveBackendServiceLibraryApi,
  saveColorPalette as saveColorPaletteApi,
  saveDataTypeLibrary as saveDataTypeLibraryApi,
  saveIconLibrary as saveIconLibraryApi,
  saveMysqlLibrary as saveMysqlLibraryApi,
  saveOssLibrary as saveOssLibraryApi,
  setProjectEntryPage,
  patchProjectConfig,
} from '../api/projects'
import DataPoolPanel, {
  type DataPoolPanelHandle,
} from '../components/editor/DataPoolPanel'
import DataTypesPanel from '../components/editor/DataTypesPanel'
import MysqlPanel from '../components/editor/MysqlPanel'
import OssPanel from '../components/editor/OssPanel'
import BackendServiceEditor from '../components/editor/BackendServiceEditor'
import BackendServiceWorkspace from '../components/editor/BackendServiceWorkspace'
import { isSameProcessorDebugTarget } from '../components/editor/ServiceProcessorPanel'
import DataMethodDebugPanel, {
  type DataMethodDebugTarget,
} from '../components/editor/DataMethodDebugPanel'
import MethodFlowDebugPanel, {
  type MethodFlowDebugTarget,
} from '../components/editor/MethodFlowDebugPanel'
import type { DataMethodUsageRef } from '../utils/data-method-usage'
import IconLibraryPanel from '../components/editor/IconLibraryPanel'
import ColorPalettePanel from '../components/editor/ColorPalettePanel'
import { setColorPaletteState } from '../composables/useColorPalette'
import {
  createEmptyColorPalette,
  resolvePaletteColorValue,
  buildDollarColorAmbientDeclaration,
  type ColorPalette,
} from '../types/color-palette'
import MethodEditDialog from '../components/editor/MethodEditDialog'
import MethodsPanel from '../components/editor/MethodsPanel'
import LifecyclePanel from '../components/editor/LifecyclePanel'
import LeafIcon from '../components/icons/LeafIcon'
import MysqlIcon from '../components/icons/MysqlIcon'
import OssIcon from '../components/icons/OssIcon'
import DevelopIcon from '../components/icons/DevelopIcon'
import BackendIcon from '../components/icons/BackendIcon'
import ComponentMetaPanel from '../components/editor/ComponentMetaPanel'
import PreviewDebugPanel from '../components/editor/PreviewDebugPanel'
import PreviewRuntimeLog, {
  type PreviewRuntimeLogEntry,
  type PreviewRuntimeLogLevel,
} from '../components/editor/PreviewRuntimeLog'
import PreviewCanvasToolbar from '../components/editor/PreviewCanvasToolbar'
import PropsPanel from '../components/editor/PropsPanel'
import PageCanvas from '../components/xml/PageCanvas'
import WidgetTree from '../components/xml/WidgetTree'
import { useProjectStore } from '../stores/project'
import { useWorkspaceSettingsStore } from '../stores/workspace-settings'
import { useAiAssistantStore } from '../stores/ai-assistant'
import {
  publishAiAssistantEvent,
  subscribeAiAssistantEvents,
} from '../services/ai-assistant-session'
import {
  resolveWorkspaceUiSnapshotWaiters,
  type WorkspaceNavigateCommand,
  type WorkspaceUiSnapshot,
} from '../services/workspace-nav'
import {
  resolveCanvasPreviewResultWaiters,
  type CanvasPreviewCommand,
  type CanvasPreviewSnapshot,
} from '../services/canvas-preview-bridge'
import {
  buildLayoutFromXmlAndData,
  collectLayoutRisks,
  pageDataFieldsSnapshot,
} from '../services/page-preview-session'
import {
  measurePhoneViewportOverflow,
  mergeOverflowIntoLayoutRisks,
} from '../services/viewport-overflow'
import { getWidgetDetailForAi } from '../services/ai-widget-view'
import {
  INTERACTION_EVENT_KEYS,
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
import type {
  ComponentEmitContext,
  PreviewInteractPayload,
} from '../utils/event-runtime'
import {
  resolveComputedFieldsInPlace,
  resolveComputedPageData,
  sameJson,
} from '../utils/compute-runtime'
import {
  buildQueryObject,
  type PageQueryParamDef,
} from '../types/page-query'
import {
  hasControllerBoundFields,
  loadControllerBoundPageData,
  type ControllerFetchLogEntry,
} from '../utils/controller-binding-runtime'
import {
  normalizeStatusBarConfig,
  resolveStatusBarConfig,
  type StatusBarConfig,
} from '../utils/status-bar'
import {
  buildDollarProps,
  buildDollarPropsAmbientDeclaration,
  buildUpdatePropsAmbientDeclarations,
  mergePropDebugOverrides,
  normalizePropDefaultValue,
} from '../utils/component-props'
import { hydrateApiDollarProps } from '../utils/api-prop'
import { resolveComponentInstanceDollarProps } from '../utils/instance-dollar-props'
import { getDeviceInfo } from '../utils/device-info'
import { clonePageData, type DataFieldValue, type PageData } from '../types/page-data'
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
  canMoveWidgetSibling,
  canPasteWidgetAsChild,
  canPasteWidgetAsSibling,
  copyWidgetFragment,
  findXmlNodeById,
  moveWidget,
  moveWidgetSibling,
  pasteWidget,
  removeWidget,
  migrateLegacyMaskToModal,
  WIDGET_OPTIONS,
  type MovePosition,
  type WidgetTag,
} from '../utils/xml-node'
import {
  getWidgetClipboard,
  hasWidgetClipboard,
  setWidgetClipboard,
} from '../utils/widget-clipboard'
import { parsePageXml } from '../utils/xml'
import { resolveRefTargetNode } from '../utils/widget-ref'
import {
  isSlotOutletNodeId,
  parseSlotOutletNodeId,
} from '../utils/slot-outlet'
import type { ComponentConfig, ComponentSummary } from '../types/component'
import type { ComponentRenderMap } from '../types/component-render'
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
import type { PreviewInspectPayload } from '../types/preview-inspect'
import { ElMessage, ElMessageBox } from '../ui/feedback'
import './WorkspaceView.css'

type WorkspaceMode =
  | 'preview'
  | 'edit'
  | 'datapool'
  | 'datatypes'
  | 'mysql'
  | 'oss'
  | 'icons'
  | 'palette'
  | 'methods'
  | 'lifecycle'

type ResourceKind = 'page' | 'component'
type ProjectNav = 'datatypes' | 'mysql' | 'oss' | 'icons' | 'palette'
type TopNav = 'frontend' | 'backend' | ProjectNav
type PropsTab = 'style' | 'event' | 'dynamic'
type PageMenuCommand = 'rename' | 'copy' | 'setEntry' | 'delete'
type ComponentMenuCommand = 'rename' | 'delete'
type ServiceMenuCommand = 'rename' | 'config' | 'delete'
type WidgetCtxCommand =
  | 'copy'
  | 'delete'
  | 'moveUp'
  | 'moveDown'
  | 'pasteSibling'
  | 'pasteChild'
  | 'mentionAi'

type ProcessorDebugTarget =
  | ({ kind: 'data' } & DataMethodDebugTarget)
  | ({ kind: 'flow' } & MethodFlowDebugTarget)

type ProcessorSelectionState = {
  processorId: string
  methodId: string
  flowEditing: {
    processorId: string
    methodId: string
    focusNodeId?: string
  } | null
}

type EmitLogEntry = {
  id: number
  time: string
  event: string
  args: Record<string, unknown>
}

type RefNavSnapshot = {
  resourceKind: 'page' | 'component'
  resourceId: string
  workspaceMode: WorkspaceMode
  inspectMode: 'clean' | 'component'
  inspectTarget: PreviewInspectPayload | null
  routeParams: Record<string, unknown>
}

type BackendServiceWorkspaceHandle = {
  applyDebugParams: (params: Record<string, unknown>) => void
  applyFlowDebugCursor: (state: {
    cursorNodeId: string | null
    visitedNodeIds: string[]
    printByNode?: Record<string, string>
  }) => void
  openBusinessFlowAt: (options: {
    processorId: string
    methodId: string
    focusNodeId?: string
  }) => boolean
  openCreateController: () => void
  addApi: () => void
  openCreateProcessor: () => void
  addProcessorMethod: () => void
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    queueMicrotask(resolve)
  })
}

function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

function createIdRules(message: string) {
  return [
    { required: true, message },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: '仅支持字母、数字、下划线和短横线',
    },
  ]
}

export default function WorkspaceView() {
  const projectStore = useProjectStore()
  const workspaceSettings = useWorkspaceSettingsStore()
  const aiAssistant = useAiAssistantStore()
  const [createForm] = Form.useForm<{ id: string; name: string; title: string }>()
  const [renameComponentForm] = Form.useForm<{ id: string; name: string }>()

  const [, bump] = useState(0)
  const rerender = useCallback(() => bump((n) => n + 1), [])
  const s = useRef({
    resourceKind: 'page' as ResourceKind,
    topNav: 'frontend' as TopNav,
    pages: [] as PageSummary[],
    components: [] as ComponentSummary[],
    activePageId: '',
    activeComponentId: '',
    activePage: null as PageDetail | null,
    activeComponent: null as ComponentDetail | null,
    selectedNodeId: '',
    workspaceMode: 'preview' as WorkspaceMode,
    componentMap: {} as ComponentRenderMap,
    componentMethodsMap: {} as Record<string, PageMethod[]>,
    propsTab: 'style' as PropsTab,
    openRepeatRequest: 0,
    loadingPages: false,
    loadingPage: false,
    createVisible: false,
    creating: false,
    addDialogVisible: false,
    addDialogTab: 'widget' as 'widget' | 'component',
    addIntoSlotDebug: false,
    iconLibrary: createEmptyIconLibrary() as IconLibrary,
    colorPalette: createEmptyColorPalette() as ColorPalette,
    dataTypeLibrary: createEmptyDataTypeLibrary() as DataTypeLibrary,
    mysqlLibrary: createEmptyMysqlLibrary() as MysqlLibrary,
    ossLibrary: createEmptyOssLibrary() as OssLibrary,
    backendServiceLibrary: createEmptyBackendServiceLibrary() as BackendServiceLibrary,
    activeServiceId: '',
    serviceDialogVisible: false,
    backendServiceLayer: 'controller' as BackendLayer,
    backendDebugTarget: null as ProcessorDebugTarget | null,
    backendByService: {} as Record<string, BackendServiceUiState>,
    workspaceUiReady: false,
    editorHiddenNodeIds: [] as string[],
    pageMethods: [] as PageMethod[],
    lifecycleConfig: createEmptyLifecycleConfig() as LifecycleConfig,
    methodDialogVisible: false,
    editingMethod: null as PageMethod | null,
    previewLifecycleGate: 0,
    pageHistory: [] as Array<{ pageId: string; params: Record<string, unknown> }>,
    routeParams: {} as Record<string, unknown>,
    previewToast: null as { message: string; id: number } | null,
    previewPropOverrides: {} as Record<string, unknown>,
    previewInstancePropOverrides: {} as Record<string, Record<string, unknown>>,
    previewInspectTarget: null as PreviewInspectPayload | null,
    previewInspectMode: 'clean' as 'clean' | 'component',
    refNavStack: [] as RefNavSnapshot[],
    refNavRestoring: false,
    previewEmitLogs: [] as EmitLogEntry[],
    previewControllerFetchLogs: {} as Record<string, ControllerFetchLogEntry[]>,
    previewRuntimeLogs: [] as PreviewRuntimeLogEntry[],
    canvasPanX: 0,
    canvasPanY: 0,
    canvasZoom: 1,
    canvasScene: (projectStore.config?.canvas?.scene === 'miniprogram'
      ? 'miniprogram'
      : 'h5') as 'h5' | 'miniprogram',
    previewRuntimeData: null as PageData | null,
    previewComponentMap: null as ComponentRenderMap | null,
    renameComponentVisible: false,
    renamingComponent: false,
    renameComponentTarget: null as ComponentSummary | null,
    widgetCtxMenu: { visible: false, x: 0, y: 0, nodeId: '' },
    widgetCtxClipboardTick: 0,
  }).current

  function patch<K extends keyof typeof s>(key: K, value: (typeof s)[K]) {
    if (Object.is(s[key], value)) return
    s[key] = value
    rerender()
  }

  const backendWorkspaceRef = useRef<BackendServiceWorkspaceHandle | null>(null)
  const dataPoolPanelRef = useRef<DataPoolPanelHandle | null>(null)
  const backendServiceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lifecycleSessionActive = useRef(false)
  const lifecycleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewSessionGen = useRef(0)
  const previewNavSeq = useRef(0)
  const lifecycleUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewEmitLogSeq = useRef(0)
  const previewRuntimeLogSeq = useRef(0)
  const canvasSceneSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debugPropsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageQuerySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewControllerHydrateSeq = useRef(0)
  const dataSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const iconSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const paletteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dataTypeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const xmlSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mysqlSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ossSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aiReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handledCanvasRequestIds = useRef(new Set<string>())
  const modalStack = useMemo(() => createModalStack(), [])
  const prevWorkspaceMode = useRef(s.workspaceMode)
  const prevInspectMode = useRef(s.previewInspectMode)
  const prevCanvasSceneFromConfig = useRef(projectStore.config?.canvas?.scene)
  const skipCanvasSceneSave = useRef(true)

  function bumpPreviewSession() {
    previewSessionGen.current += 1
    if (lifecycleUpdateTimer.current != null) {
      clearTimeout(lifecycleUpdateTimer.current)
      lifecycleUpdateTimer.current = null
    }
  }

  function isPreviewSessionLive(sessionGen: number) {
    return sessionGen === previewSessionGen.current
  }

  function beginPreviewNavigation() {
    const nav = ++previewNavSeq.current
    bumpPreviewSession()
    s.previewLifecycleGate = 0
    return nav
  }

  function isPreviewNavCurrent(nav: number) {
    return nav === previewNavSeq.current
  }

  function showPreviewToast(message: string, duration: 'short' | 'long' = 'short') {
    const text = String(message ?? '').trim() || ' '
    patch('previewToast', { message: text, id: Date.now() })
    if (previewToastTimer.current) clearTimeout(previewToastTimer.current)
    previewToastTimer.current = setTimeout(
      () => {
        patch('previewToast', null)
        previewToastTimer.current = null
      },
      duration === 'long' ? 4500 : 2000,
    )
  }

  const isPageResource = s.resourceKind === 'page'
  const isComponentResource = s.resourceKind === 'component'
  const activeDoc = isPageResource ? s.activePage : s.activeComponent
  const canvasWidth = projectStore.config?.canvas.width ?? 375

  const addWidgetOptions = (() => {
    let list = isComponentResource
      ? [...WIDGET_OPTIONS]
      : WIDGET_OPTIONS.filter((item) => item.tag !== 'Slot')
    if (s.addIntoSlotDebug) {
      list = list.filter((item) => item.tag !== 'Slot')
    }
    return list
  })()

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
    if (s.resourceKind !== 'component' || !s.activeComponent) return {}
    const saved = s.activeComponent.config.debugProps
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return { ...saved }
  }

  function previewGetDeviceInfo() {
    return getDeviceInfo({
      platform: s.canvasScene,
      windowWidth: canvasWidth,
    })
  }

  const editorConditionComponentProps = isComponentResource
    ? (s.activeComponent?.config.props ?? [])
    : null

  const editorDollarPropsRaw = (() => {
    if (!isComponentResource || !s.activeComponent) return undefined
    return mergePropDebugOverrides(
      buildDollarProps(s.activeComponent.config),
      s.previewPropOverrides,
    )
  })()

  const editorDollarProps = (() => {
    const raw = editorDollarPropsRaw
    if (!raw || !s.activeComponent) return raw
    return hydrateApiDollarProps(
      raw,
      s.activeComponent.config.props,
      projectStore.path,
    )
  })()

  function resolvePreviewPageData(data: PageData): PageData {
    return resolveComputedPageData(data, {
      getDeviceInfo: previewGetDeviceInfo,
      dollarProps: editorDollarProps ?? {},
      dollarQuery: s.resourceKind === 'page' ? s.routeParams : undefined,
      colorPalette: s.colorPalette,
    })
  }

  function resetPreviewRuntime() {
    if (!activeDoc) {
      s.previewRuntimeData = null
      s.previewComponentMap = null
      s.previewPropOverrides = {}
      s.previewInstancePropOverrides = {}
      s.previewInspectTarget = null
      s.previewInspectMode = 'clean'
      s.previewEmitLogs = []
      s.previewControllerFetchLogs = {}
      s.previewRuntimeLogs = []
      resetPreviewDataRevision()
      rerender()
      return
    }
    s.previewRuntimeData = resolvePreviewPageData(
      clonePageData(activeDoc.data ?? { fields: [] }),
    )
    s.previewComponentMap = cloneComponentRenderMap(s.componentMap)
    s.previewPropOverrides = s.resourceKind === 'component' ? restoreComponentDebugProps() : {}
    s.previewInstancePropOverrides = {}
    s.previewInspectTarget = null
    s.previewInspectMode = 'clean'
    s.previewEmitLogs = []
    s.previewControllerFetchLogs = {}
    s.previewRuntimeLogs = []
    resetPreviewDataRevision()
    rerender()
  }

  function clearPreviewRuntime(options?: { silent?: boolean }) {
    s.previewRuntimeData = null
    s.previewComponentMap = null
    s.previewPropOverrides = s.resourceKind === 'component' ? restoreComponentDebugProps() : {}
    s.previewInstancePropOverrides = {}
    if (!s.refNavRestoring) {
      s.previewInspectTarget = null
      s.previewInspectMode = 'clean'
    }
    s.previewEmitLogs = []
    s.previewControllerFetchLogs = {}
    s.previewRuntimeLogs = []
    resetPreviewDataRevision()
    if (!options?.silent) rerender()
  }

  function seedPreviewRuntime(data: PageData) {
    s.previewRuntimeData = resolvePreviewPageData(clonePageData(data))
    s.previewComponentMap = s.componentMap
    s.previewPropOverrides =
      s.resourceKind === 'component' ? restoreComponentDebugProps() : {}
    s.previewInstancePropOverrides = {}
    if (!s.refNavRestoring) s.previewInspectTarget = null
    s.previewEmitLogs = []
    s.previewControllerFetchLogs = {}
    s.previewRuntimeLogs = []
  }

  const resolvedPageData =
    s.workspaceMode === 'preview' && s.previewRuntimeData
      ? s.previewRuntimeData
      : resolveComputedPageData(activeDoc?.data ?? { fields: [] }, {
          getDeviceInfo: previewGetDeviceInfo,
          dollarProps: editorDollarProps ?? {},
          dollarQuery: s.resourceKind === 'page' ? s.routeParams : undefined,
          colorPalette: s.colorPalette,
        })

  const canvasComponentMap =
    s.workspaceMode === 'preview' && s.previewComponentMap
      ? s.previewComponentMap
      : s.componentMap

  const previewDebugDollarProps = editorDollarPropsRaw ?? {}
  const previewInspectNodeId = s.previewInspectTarget?.nodeId ?? ''

  const previewPanelPropValues = (() => {
    const target = s.previewInspectTarget
    if (!target) return previewDebugDollarProps
    const hostOwner = target.hostDataOwnerId.trim()
    const hostData = hostOwner
      ? canvasComponentMap[hostOwner]?.data
      : resolvedPageData
    const base = resolveComponentInstanceDollarProps({
      config: target.config,
      hostAttrs: target.hostAttrs,
      pageData: hostData ?? { fields: [] },
      routeParams: s.routeParams,
      projectPath: projectStore.path,
      editCanvasFallback: s.workspaceMode === 'edit',
      scope: target.scope
        ? { item: target.scope.item, index: target.scope.index }
        : null,
    })
    const overrides = s.previewInstancePropOverrides[target.nodeId] ?? {}
    const merged: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(overrides)) {
      const raw = target.hostAttrs[key]
      if (typeof raw === 'string') {
        const t = raw.trim()
        if (
          /^\{\s*[A-Za-z_$][\w$]*\s*\}$/.test(t) ||
          /^\{\s*item(?:\.[A-Za-z_$][\w$]*(?:\[\d+\])*)*\s*\}$/.test(t) ||
          /^\{\s*\$?props(?:\.[A-Za-z_$][\w$]*(?:\[\d+\])*)*\s*\}$/.test(t)
        ) {
          continue
        }
      }
      if (value === null) continue
      merged[key] = value
    }
    return merged
  })()

  const previewPanelPropOverrides = (() => {
    const target = s.previewInspectTarget
    if (!target) return s.previewPropOverrides
    return s.previewInstancePropOverrides[target.nodeId] ?? {}
  })()

  const previewPanelPageData = (() => {
    const target = s.previewInspectTarget
    if (!target) return resolvedPageData
    const raw = canvasComponentMap[target.componentId]?.data
    if (!raw) return resolvedPageData
    return resolveComputedPageData(raw, {
      getDeviceInfo: previewGetDeviceInfo,
      dollarProps: previewPanelPropValues,
      colorPalette: s.colorPalette,
    })
  })()

  const previewPanelMode: 'page' | 'component' = s.previewInspectTarget
    ? 'component'
    : isComponentResource
      ? 'component'
      : 'page'

  const previewPanelConfig =
    s.previewInspectTarget?.config ?? s.activeComponent?.config ?? null

  function handlePreviewOpenInspect(payload: PreviewInspectPayload) {
    if (s.previewInspectTarget?.nodeId === payload.nodeId) {
      patch('previewInspectTarget', null)
      return
    }
    patch('previewInspectTarget', payload)
  }

  function clearPreviewInspect() {
    patch('previewInspectTarget', null)
  }

  function clearRefNavStack() {
    if (s.refNavStack.length) patch('refNavStack', [])
  }

  function captureRefNavSnapshot(): RefNavSnapshot | null {
    const kind = s.resourceKind === 'component' ? 'component' : 'page'
    const resourceId = kind === 'component' ? s.activeComponentId : s.activePageId
    if (!resourceId.trim()) return null
    const target = s.previewInspectTarget
    return {
      resourceKind: kind,
      resourceId,
      workspaceMode: s.workspaceMode,
      inspectMode: s.previewInspectMode,
      inspectTarget: target ? { ...target, hostAttrs: { ...target.hostAttrs } } : null,
      routeParams: { ...s.routeParams },
    }
  }

  function openPageFromSidebar(pageId: string) {
    clearRefNavStack()
    return openPage(pageId)
  }

  function openComponentFromSidebar(componentId: string) {
    clearRefNavStack()
    return openComponent(componentId)
  }

  async function handleEditInspectedComponent(componentId: string) {
    const id = componentId.trim()
    if (!id) {
      ElMessage.warning('组件 ID 为空')
      return
    }
    const snap = captureRefNavSnapshot()
    if (snap) patch('refNavStack', [...s.refNavStack, snap])
    clearPreviewInspect()
    patch('previewInspectMode', 'clean')
    setWorkspaceMode('edit')
    await openComponent(id)
  }

  async function handleBackToRef() {
    const stack = s.refNavStack
    if (!stack.length) return
    const snap = stack[stack.length - 1]!
    patch('refNavStack', stack.slice(0, -1))
    const mode =
      snap.workspaceMode === 'preview' ||
      snap.workspaceMode === 'edit' ||
      snap.workspaceMode === 'datapool' ||
      snap.workspaceMode === 'methods' ||
      snap.workspaceMode === 'lifecycle'
        ? snap.workspaceMode
        : 'preview'
    patch('refNavRestoring', true)
    try {
      if (s.workspaceMode !== mode) {
        setWorkspaceMode(mode)
        await nextTick()
      }
      if (snap.resourceKind === 'page') {
        await openPage(snap.resourceId, {
          keepHistory: true,
          params: snap.routeParams,
        })
      } else {
        await openComponent(snap.resourceId)
      }
      await nextTick()
      s.previewInspectMode = snap.inspectMode
      s.previewInspectTarget = snap.inspectTarget
        ? { ...snap.inspectTarget, hostAttrs: { ...snap.inspectTarget.hostAttrs } }
        : null
      rerender()
    } finally {
      patch('refNavRestoring', false)
    }
  }

  function handleLocateRef(refPath: string) {
    const path = refPath.trim()
    if (!path) {
      ElMessage.warning('引用路径为空')
      return
    }
    const inspecting = s.previewInspectTarget
    const scopeXml = inspecting
      ? canvasComponentMap[inspecting.componentId]?.xml
      : activeDoc?.xml
    const resolved = resolveRefTargetNode(scopeXml, path)
    if (!resolved) {
      ElMessage.warning('未找到引用对应的节点')
      return
    }
    if (resolved.node.tag !== 'Component') {
      ElMessage.warning('引用目标不是组件节点')
      return
    }
    const componentId = resolved.node.attrs.componentId?.trim() || ''
    const detail = componentId ? canvasComponentMap[componentId] : null
    if (!detail?.config || !componentId) {
      ElMessage.warning('组件未加载或缺少配置')
      return
    }
    const nodeId = inspecting
      ? `${inspecting.nodeId}/c:${resolved.path}`
      : resolved.path
    s.previewInspectMode = 'component'
    s.previewInspectTarget = {
      nodeId,
      componentId: detail.id,
      label:
        resolved.node.attrs.name?.trim() ||
        detail.config.name?.trim() ||
        detail.config.title?.trim() ||
        componentId,
      config: detail.config,
      hostAttrs: { ...resolved.node.attrs },
      hostDataOwnerId: inspecting?.componentId?.trim() || '',
    }
    rerender()
  }

  function parseSimpleDataBinding(raw: string | undefined | null): string | null {
    const text = String(raw ?? '').trim()
    const m = text.match(/^\{([A-Za-z_$][\w$]*)\}$/)
    return m?.[1] ?? null
  }

  function handlePreviewPanelPropUpdate(name: string, value: unknown) {
    const target = s.previewInspectTarget
    if (!target) {
      handlePreviewPropUpdate(name, value)
      return
    }
    const propName = name.trim()
    if (!propName) return
    const def = target.config?.props?.find((item) => item.name.trim() === propName)
    if (!def) {
      pushPreviewRuntimeLog({
        level: 'error',
        message: `组件参数不存在：${propName}`,
        location: `组件 ${target.componentId} · 入参`,
      })
      return
    }
    if (def.type === 'api') {
      pushPreviewRuntimeLog({
        level: 'warn',
        message: `「${propName}」为后端 API 参数，无法在调试面板修改`,
        location: `组件 ${target.componentId} · 入参`,
      })
      return
    }
    const coerced = value === null ? null : normalizePropDefaultValue(def.type, value)
    s.previewInstancePropOverrides = {
      ...s.previewInstancePropOverrides,
      [target.nodeId]: {
        ...(s.previewInstancePropOverrides[target.nodeId] ?? {}),
        [propName]: coerced,
      },
    }
    if (def.twoWay) {
      const boundField = parseSimpleDataBinding(target.hostAttrs?.[propName])
      if (boundField) {
        const hostOwner = target.hostDataOwnerId?.trim() || ''
        if (hostOwner) applyComponentPreviewSetData(hostOwner, boundField, coerced)
        else applyPreviewSetData(boundField, coerced)
      }
    }
    bumpPreviewDataRevision()
    rerender()
  }

  function handlePreviewPanelDataField(
    name: string,
    value: DataFieldValue,
    meta?: {
      objectFields?: import('../types/page-data').ObjectSubField[]
      arrayFields?: import('../types/page-data').ArraySubField[]
    },
  ) {
    const target = s.previewInspectTarget
    if (target?.componentId) {
      applyComponentPreviewSetData(target.componentId, name, value, meta)
      return
    }
    applyPreviewSetData(name, value, meta)
  }

  const canPreviewGoBack = s.workspaceMode === 'preview' && s.pageHistory.length > 0
  const hasEntryPage = (() => {
    const entryId = projectStore.config?.entryPage
    if (entryId && s.pages.some((item) => item.id === entryId)) return true
    return s.pages.some((item) => item.isEntry)
  })()

  function resolveEntryPageId(): string | null {
    const entryId = projectStore.config?.entryPage
    if (entryId && s.pages.some((item) => item.id === entryId)) return entryId
    return s.pages.find((item) => item.isEntry)?.id ?? null
  }

  function pushPreviewEmitLog(event: string, args: Record<string, unknown>) {
    previewEmitLogSeq.current += 1
    patch('previewEmitLogs', [
      {
        id: previewEmitLogSeq.current,
        time: new Date().toLocaleTimeString(),
        event,
        args,
      },
      ...s.previewEmitLogs,
    ].slice(0, 80))
  }

  function pushPreviewRuntimeLog(options: {
    level: PreviewRuntimeLogLevel
    message: string
    location?: string
  }) {
    const messageText = String(options.message ?? '').trim()
    if (!messageText) return
    previewRuntimeLogSeq.current += 1
    patch('previewRuntimeLogs', [
      {
        id: previewRuntimeLogSeq.current,
        time: new Date().toLocaleTimeString(),
        level: options.level,
        message: messageText,
        location: options.location?.trim() || undefined,
      },
      ...s.previewRuntimeLogs,
    ].slice(0, 200))
  }

  function formatPreviewLogLocation(options?: {
    dataOwnerComponentId?: string
    eventKey?: string
    timing?: string
  }): string {
    const ownerId = options?.dataOwnerComponentId?.trim() || ''
    const info = ownerId ? canvasComponentMap[ownerId] : null
    const base = ownerId
      ? `组件 ${info?.config?.name?.trim() || ownerId}`
      : '页面'
    const timing =
      options?.timing?.trim() ||
      (options?.eventKey && !String(options.eventKey).startsWith('__')
        ? `事件 ${options.eventKey}`
        : '')
    return timing ? `${base} · ${timing}` : base
  }

  function resolveUpdatePropsHostDataOwnerId(
    emitCtx: ComponentEmitContext | undefined,
  ): string | undefined {
    let layer = emitCtx?.outer
    while (layer) {
      if (!layer.slotHost) {
        const id = layer.componentId?.trim()
        if (id) return id
      }
      layer = layer.outer
    }
    return undefined
  }

  function createPreviewDebugEmit() {
    if (!isComponentResource || !s.activeComponent) return undefined
    return createComponentEmit(s.activeComponent.config.events ?? [], (eventName, args) => {
      pushPreviewEmitLog(eventName, args)
    })
  }

  function handlePreviewPropUpdate(name: string, value: unknown) {
    s.previewPropOverrides = { ...s.previewPropOverrides, [name]: value }
    if (isComponentResource && s.activeComponent) {
      const nextDebug = {
        ...(s.activeComponent.config.debugProps ?? {}),
        [name]: value,
      }
      s.activeComponent = {
        ...s.activeComponent,
        config: { ...s.activeComponent.config, debugProps: nextDebug },
      }
      if (debugPropsSaveTimer.current) clearTimeout(debugPropsSaveTimer.current)
      debugPropsSaveTimer.current = setTimeout(() => {
        void persistComponentDebugPropsBaseline()
      }, 400)
    }
    if (
      s.workspaceMode === 'preview' &&
      isComponentResource &&
      s.previewRuntimeData
    ) {
      s.previewRuntimeData = resolvePreviewPageData(s.previewRuntimeData)
      bumpPreviewDataRevision()
    }
    rerender()
    void runLifecycleUpdateSequence()
  }

  function applyPreviewPropRuntimeOverride(name: string, value: unknown) {
    s.previewPropOverrides = { ...s.previewPropOverrides, [name]: value }
    if (isComponentResource && s.previewRuntimeData) {
      s.previewRuntimeData = resolvePreviewPageData(s.previewRuntimeData)
    }
    rerender()
  }

  async function persistComponentDebugPropsBaseline() {
    if (!projectStore.path || !s.activeComponent || !isComponentResource) return
    const baseline = { ...(s.activeComponent.config.debugProps ?? {}) }
    try {
      const saved = await saveComponentConfig({
        projectPath: projectStore.path,
        componentId: s.activeComponent.id,
        config: { ...s.activeComponent.config, debugProps: baseline },
      })
      if (s.activeComponent?.id === saved.id) {
        s.activeComponent = {
          ...s.activeComponent,
          config: {
            ...saved.config,
            debugProps: { ...(saved.config.debugProps ?? {}), ...baseline },
          },
        }
        rerender()
      }
    } catch (err) {
      console.error('[luban] 保存组件调试 Props 失败:', err)
    }
  }

  async function handlePreviewNavigateBack() {
    const prev = s.pageHistory.pop()
    rerender()
    if (!prev) {
      ElMessage.info('没有可返回的页面')
      return
    }
    await openPage(prev.pageId, { keepHistory: true, params: prev.params })
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
    if (isComponentResource && s.activeComponentId) {
      bumpPreviewSession()
      const sessionGen = previewSessionGen.current
      await preparePreviewRuntime()
      if (!isPreviewSessionLive(sessionGen)) return
      patch('previewLifecycleGate', s.previewLifecycleGate + 1)
      await nextTick()
      if (!isPreviewSessionLive(sessionGen)) return
      await syncLifecycleSession()
      return
    }
    if (!s.activePageId) return
    const pageId = s.activePageId
    const params = { ...s.routeParams }
    const history = s.pageHistory.map((item) => ({
      pageId: item.pageId,
      params: { ...item.params },
    }))
    await openPage(pageId, { keepHistory: true, params })
    patch('pageHistory', history)
  }

  function invokeActiveExposedMethod(methodName: string, args: unknown[]) {
    if (!s.activeComponent || !activeDoc) return
    const exposed = s.activeComponent.config.exposedMethods ?? []
    if (!exposed.includes(methodName)) {
      ElMessage.warning(`方法「${methodName}」未在组件中暴露`)
      return
    }
    const method = s.pageMethods.find((item) => item.name === methodName && !item.builtin)
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
      dollarProps: editorDollarProps,
      emitFn: createPreviewDebugEmit(),
      logLocation: formatPreviewLogLocation({
        timing: `调试 · 暴露方法 ${methodName}`,
      }),
    })
  }

  const methodAmbientExtra = (() => {
    const deviceAmbient = [
      'interface MenuButtonBoundingClientRect { width: number; height: number; top: number; right: number; bottom: number; left: number }',
      'interface DeviceInfo { statusBarHeight: number; userAgent: string; menuButton: MenuButtonBoundingClientRect | null; platform: \'h5\' | \'miniprogram\' }',
      'declare function navigateTo(to: string, params?: Record<string, unknown>): void;',
      'declare function navigateBack(): void;',
      'declare function setData(prop: string, value: any): void;',
      "declare function showToast(message: string, duration?: 'short' | 'long'): void;",
      'declare function getDeviceInfo(): DeviceInfo;',
      buildDollarColorAmbientDeclaration(s.colorPalette),
    ].filter(Boolean).join('\n')
    const propsAmbient = buildDollarPropsAmbientDeclaration(
      isComponentResource ? s.activeComponent?.config.props : null,
      s.dataTypeLibrary,
    )
    const updatePropsAmbient = isComponentResource
      ? buildUpdatePropsAmbientDeclarations(
          s.activeComponent?.config.props,
          s.dataTypeLibrary,
        )
      : ''
    const typeAmbient = buildTypeLibraryAmbientDeclarations(s.dataTypeLibrary)
    const localMethodsAmbient = buildLocalMethodsAmbientDeclarations(
      s.pageMethods,
      s.dataTypeLibrary,
    )
    const base =
      [deviceAmbient, typeAmbient, propsAmbient, updatePropsAmbient, localMethodsAmbient]
        .filter(Boolean)
        .join('\n') + '\n'
    if (!isComponentResource || !s.activeComponent) return base
    return `${base}${buildEmitAmbientDeclarations(
      s.activeComponent.config.events ?? [],
      s.dataTypeLibrary,
    )}`
  })()

  const editorMethods = (() => {
    const expected = builtinsForRoot(isComponentResource ? 'components' : 'pages')
    const expectedNames = new Set(expected.map((item) => item.name))
    const list = s.pageMethods.filter(
      (item) => !item.builtin || expectedNames.has(item.name),
    )
    const names = new Set(list.map((item) => item.name))
    const missing = expected.filter((item) => !names.has(item.name))
    if (!missing.length) return list
    const builtins = list.filter((item) => item.builtin)
    const custom = list.filter((item) => !item.builtin)
    return [...builtins, ...missing, ...custom]
  })()

  function parseFrameSize(value: string | undefined, fallback: number): number | 'auto' {
    if (!value || value === 'wrap_content') return 'auto'
    if (value === 'match_parent') return fallback
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }

  const phoneWidthFitContent = (() => {
    if (!isComponentResource || !s.activeComponent) return false
    const w = s.activeComponent.config.width
    return !w || w === 'wrap_content'
  })()

  const canvasFrameWidth = (() => {
    if (isComponentResource && s.activeComponent) {
      const parsed = parseFrameSize(s.activeComponent.config.width, canvasWidth)
      return parsed === 'auto' ? canvasWidth : parsed
    }
    return canvasWidth
  })()

  const canvasFrameHeight = (() => {
    if (isComponentResource && s.activeComponent) {
      return parseFrameSize(s.activeComponent.config.height, 667)
    }
    return undefined as number | 'auto' | undefined
  })()

  const createDialogTitle = isComponentResource ? '新建组件' : '新建页面'
  const isEditMode = s.workspaceMode === 'edit'
  const isDataPoolMode = s.workspaceMode === 'datapool'
  const isDataTypesMode = s.workspaceMode === 'datatypes'
  const isMysqlMode = s.workspaceMode === 'mysql'
  const isOssMode = s.workspaceMode === 'oss'
  const isIconsMode = s.workspaceMode === 'icons'
  const isPaletteMode = s.workspaceMode === 'palette'
  const isMethodsMode = s.workspaceMode === 'methods'
  const isLifecycleMode = s.workspaceMode === 'lifecycle'
  const hideWidgetTree =
    isDataPoolMode ||
    isDataTypesMode ||
    isMysqlMode ||
    isOssMode ||
    isIconsMode ||
    isPaletteMode ||
    isMethodsMode ||
    isLifecycleMode

  const canDeleteSelected =
    isEditMode &&
    Boolean(activeDoc) &&
    !isSlotOutletNodeId(s.selectedNodeId) &&
    canDeleteNode(s.selectedNodeId)

  const widgetCtxCanCopy =
    Boolean(s.widgetCtxMenu.nodeId) &&
    !isSlotOutletNodeId(s.widgetCtxMenu.nodeId) &&
    canDeleteNode(s.widgetCtxMenu.nodeId)
  const widgetCtxCanDelete = widgetCtxCanCopy
  const widgetCtxCanMoveUp = (() => {
    void s.widgetCtxClipboardTick
    if (!activeDoc || !s.widgetCtxMenu.nodeId) return false
    return canMoveWidgetSibling(activeDoc.xml, s.widgetCtxMenu.nodeId, 'up')
  })()
  const widgetCtxCanMoveDown = (() => {
    void s.widgetCtxClipboardTick
    if (!activeDoc || !s.widgetCtxMenu.nodeId) return false
    return canMoveWidgetSibling(activeDoc.xml, s.widgetCtxMenu.nodeId, 'down')
  })()
  const widgetCtxCanPasteSibling = (() => {
    void s.widgetCtxClipboardTick
    return hasWidgetClipboard() && canPasteWidgetAsSibling(s.widgetCtxMenu.nodeId)
  })()
  const widgetCtxCanPasteChild = (() => {
    void s.widgetCtxClipboardTick
    if (!activeDoc || !s.widgetCtxMenu.nodeId) return false
    return hasWidgetClipboard() && canPasteWidgetAsChild(activeDoc.xml, s.widgetCtxMenu.nodeId)
  })()
  const widgetCtxCanMentionAi =
    workspaceSettings.aiAssistantEnabled &&
    Boolean(s.widgetCtxMenu.nodeId) &&
    !isSlotOutletNodeId(s.widgetCtxMenu.nodeId)

  function closeWidgetCtxMenu() {
    patch('widgetCtxMenu', { visible: false, x: 0, y: 0, nodeId: '' })
  }

  function openWidgetCtxMenu(payload: { nodeId: string; x: number; y: number }) {
    if (!isEditMode || !activeDoc) return
    if (!payload.nodeId || isSlotOutletNodeId(payload.nodeId)) return
    s.widgetCtxClipboardTick += 1
    const pad = 8
    const menuW = 160
    const menuH = 260
    const x = Math.min(payload.x, window.innerWidth - menuW - pad)
    const y = Math.min(payload.y, window.innerHeight - menuH - pad)
    patch('widgetCtxMenu', {
      visible: true,
      x: Math.max(pad, x),
      y: Math.max(pad, y),
      nodeId: payload.nodeId,
    })
  }

  function onGlobalPointerDownForCtx(event: MouseEvent) {
    if (!s.widgetCtxMenu.visible) return
    const t = event.target
    if (t instanceof Element && t.closest('.widget-ctx-menu')) return
    closeWidgetCtxMenu()
  }

  const showAddDebugButton = (() => {
    if (!isEditMode || !isComponentResource || !activeDoc) return false
    const id = s.selectedNodeId
    if (!id || isSlotOutletNodeId(id)) return false
    try {
      const root = parsePageXml(activeDoc.xml)
      return findXmlNodeById(root, id)?.tag === 'Slot'
    } catch {
      return false
    }
  })()

  const iconOptions = s.iconLibrary.icons.map((item) => ({
    id: item.id,
    label: item.label,
  }))

  const modeTabs = [
    { key: 'preview' as const, label: '预览', icon: <EyeOutlined /> },
    { key: 'edit' as const, label: '编辑', icon: <EditOutlined /> },
    { key: 'datapool' as const, label: '数据池', icon: <GoldOutlined /> },
    { key: 'methods' as const, label: '方法', icon: <ThunderboltOutlined /> },
    { key: 'lifecycle' as const, label: '生命周期', icon: <LeafIcon /> },
  ]

  const frontendModeTitle =
    modeTabs.find((tab) => tab.key === s.workspaceMode)?.label ?? '预览'

  const backendLayerTabs = [
    { key: 'controller' as const, label: '控制器', icon: <ApiOutlined /> },
    { key: 'service' as const, label: '业务层', icon: <ClusterOutlined /> },
    { key: 'data' as const, label: '数据层', icon: <DollarOutlined /> },
    { key: 'schedule' as const, label: '定时任务', icon: <ClockCircleOutlined /> },
  ]

  const backendLayerTitle =
    backendLayerTabs.find((tab) => tab.key === s.backendServiceLayer)?.label ??
    '控制器'

  const projectNavItems: { key: ProjectNav; label: string; icon: ReactNode }[] = [
    { key: 'datatypes', label: '数据类型', icon: <DatabaseOutlined /> },
    { key: 'mysql', label: 'MySQL', icon: <MysqlIcon /> },
    { key: 'oss', label: '对象存储', icon: <OssIcon /> },
    { key: 'icons', label: '图标库', icon: <PictureOutlined /> },
    { key: 'palette', label: '调色板', icon: <HighlightOutlined /> },
  ]

  const isFrontendNav = s.topNav === 'frontend'
  const isBackendNav = s.topNav === 'backend'
  const isProjectNav =
    s.topNav === 'datatypes' ||
    s.topNav === 'mysql' ||
    s.topNav === 'oss' ||
    s.topNav === 'icons' ||
    s.topNav === 'palette'
  const showModeTabs = isFrontendNav

  const activeBackendService =
    s.backendServiceLibrary.services.find((item) => item.id === s.activeServiceId) ??
    null

  const backendModuleOptions = s.backendServiceLibrary.services.map((svc) => ({
    id: svc.id,
    name: svc.name || svc.id,
  }))

  const showBackendLayerTabs = isBackendNav && Boolean(activeBackendService)
  const activeBackendUi = (s.activeServiceId
    ? s.backendByService[s.activeServiceId]
    : null) ?? null

  const dataDebugTarget = (() => {
    const t = s.backendDebugTarget
    if (t?.kind !== 'data') return null
    const { kind: _kind, ...rest } = t
    return rest
  })()
  const flowDebugTarget = (() => {
    const t = s.backendDebugTarget
    if (t?.kind !== 'flow') return null
    const { kind: _kind, ...rest } = t
    return rest
  })()

  function patchBackendServiceUi(
    serviceId: string,
    nextPatch: Partial<BackendServiceUiState>,
  ) {
    if (!serviceId) return
    const prev = s.backendByService[serviceId] ?? emptyBackendServiceUiState()
    patch('backendByService', {
      ...s.backendByService,
      [serviceId]: {
        ...prev,
        ...nextPatch,
        processors: {
          ...prev.processors,
          ...(nextPatch.processors ?? {}),
        },
      },
    })
  }

  function collectWorkspaceUiState(): WorkspaceUiState {
    return {
      topNav: s.topNav,
      resourceKind: s.resourceKind,
      workspaceMode: s.workspaceMode,
      activePageId: s.activePageId,
      activeComponentId: s.activeComponentId,
      activeServiceId: s.activeServiceId,
      backendServiceLayer: s.backendServiceLayer,
      backendByService: s.backendByService,
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
      top === 'icons' ||
      top === 'palette'
    ) {
      s.topNav = top
    }
    if (saved.resourceKind === 'page' || saved.resourceKind === 'component') {
      s.resourceKind = saved.resourceKind
    }
    if (
      top === 'datatypes' ||
      top === 'mysql' ||
      top === 'oss' ||
      top === 'icons' ||
      top === 'palette'
    ) {
      s.workspaceMode = top
    } else if (
      saved.workspaceMode === 'preview' ||
      saved.workspaceMode === 'edit' ||
      saved.workspaceMode === 'datapool' ||
      saved.workspaceMode === 'methods' ||
      saved.workspaceMode === 'lifecycle'
    ) {
      s.workspaceMode = saved.workspaceMode
    }
    s.activePageId = saved.activePageId || ''
    s.activeComponentId = saved.activeComponentId || ''
    s.activeServiceId = saved.activeServiceId || ''
    const layer = saved.backendServiceLayer
    if (
      layer === 'controller' ||
      layer === 'service' ||
      layer === 'data' ||
      layer === 'schedule'
    ) {
      s.backendServiceLayer = layer
    }
    s.backendByService = saved.backendByService ?? {}
    rerender()
  }

  function onBackendLayerUpdate(layer: BackendLayer) {
    s.backendServiceLayer = layer
    if (layer === 'schedule') s.backendDebugTarget = null
    if (s.activeServiceId) patchBackendServiceUi(s.activeServiceId, { layer })
    rerender()
  }

  function onBackendControllerId(id: string) {
    if (!s.activeServiceId) return
    const prev = s.backendByService[s.activeServiceId]
    if (prev?.controllerId === id) return
    patchBackendServiceUi(s.activeServiceId, { controllerId: id })
  }

  function onBackendBusinessSelection(state: ProcessorSelectionState) {
    if (!s.activeServiceId) return
    patchBackendServiceUi(s.activeServiceId, {
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
    if (!s.activeServiceId) return
    patchBackendServiceUi(s.activeServiceId, {
      processors: {
        data: {
          processorId: state.processorId,
          methodId: state.methodId,
          flowEditing: null,
        },
      },
    })
  }

  function onNavigateDataMethodUsage(ref: DataMethodUsageRef) {
    if (ref.layer === 'controller') {
      ElMessage.info('控制器 API 当前无独立流程图，已切换到对应 API')
      if (ref.serviceId !== s.activeServiceId) s.activeServiceId = ref.serviceId
      s.backendServiceLayer = 'controller'
      patchBackendServiceUi(ref.serviceId, {
        layer: 'controller',
        controllerId: ref.ownerId,
      })
      rerender()
      return
    }
    if (ref.serviceId !== s.activeServiceId) s.activeServiceId = ref.serviceId
    s.backendServiceLayer = 'service'
    patchBackendServiceUi(ref.serviceId, {
      layer: 'service',
      processors: {
        business: {
          processorId: ref.ownerId,
          methodId: ref.methodId,
          flowEditing: {
            processorId: ref.ownerId,
            methodId: ref.methodId,
            focusNodeId: ref.nodeId,
          },
        },
      },
    })
    rerender()
    void nextTick().then(() => {
      const tryOpen = () =>
        backendWorkspaceRef.current?.openBusinessFlowAt?.({
          processorId: ref.ownerId,
          methodId: ref.methodId,
          focusNodeId: ref.nodeId,
        })
      if (tryOpen()) return
      window.setTimeout(() => {
        tryOpen()
      }, 350)
    })
  }

  const centerDirSegment = isMethodsMode ? 'function' : ''

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

  const centerPathQuery = (() => {
    if (s.workspaceMode !== 'preview' || isComponentResource) return ''
    const entries = Object.entries(s.routeParams)
    if (!entries.length) return ''
    return `?${entries
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(formatRouteParamValue(value))}`,
      )
      .join('&')}`
  })()

  const backendCenterPath = (() => {
    if (!activeBackendService) return 'services'
    const layer =
      s.backendServiceLayer === 'controller'
        ? 'controllers'
        : s.backendServiceLayer === 'service'
          ? 'business'
          : s.backendServiceLayer === 'data'
            ? 'data'
            : 'schedules'
    return `services/${layer}`
  })()

  const propsPlaceholderText = (() => {
    if (isBackendNav) {
      if (s.backendServiceLayer === 'data') return '选中数据层方法后可调试'
      if (s.backendServiceLayer === 'service') return '选中业务方法后可调试'
      return '在模块列表右键可重命名、配置或删除'
    }
    if (isDataTypesMode) return '在分组列表右键可重命名或删除'
    if (isMysqlMode) return '在连接列表右键可配置或删除'
    if (isOssMode) return '在连接列表右键可配置或删除'
    if (isIconsMode) return '在图标上右键可编辑或删除'
    if (isPaletteMode) return '在颜色上可编辑或删除'
    if (
      !s.activePage &&
      !isIconsMode &&
      !isPaletteMode &&
      !isDataTypesMode &&
      !isMysqlMode &&
      !isOssMode
    ) {
      return '打开页面后可编辑'
    }
    if (isDataPoolMode) return '数据池模式下请在中间区域编辑'
    if (isMethodsMode) return '方法模式下请在中间区域编辑'
    if (isLifecycleMode) return '生命周期模式下请在中间区域编辑'
    if (isComponentResource && s.activeComponent && !s.selectedNodeId) {
      return '选中控件可编辑样式，或查看组件设置'
    }
    return isComponentResource ? '打开组件后可编辑' : '打开页面后可编辑'
  })()

  async function loadIconLibrary() {
    if (!projectStore.path) return
    try {
      const next = await getIconLibrary(projectStore.path)
      patch('iconLibrary', next)
    } catch (err) {
      patch('iconLibrary', createEmptyIconLibrary())
      console.error(err)
    }
  }

  async function loadColorPalette() {
    if (!projectStore.path) return
    try {
      const next = await getColorPalette(projectStore.path)
      s.colorPalette = next
      setColorPaletteState(next)
      rerender()
    } catch (err) {
      const empty = createEmptyColorPalette()
      s.colorPalette = empty
      setColorPaletteState(empty)
      rerender()
      console.error(err)
    }
  }

  async function loadDataTypeLibrary() {
    if (!projectStore.path) return
    try {
      patch('dataTypeLibrary', await getDataTypeLibrary(projectStore.path))
    } catch (err) {
      patch('dataTypeLibrary', createEmptyDataTypeLibrary())
      console.error(err)
    }
  }

  async function loadMysqlLibrary() {
    if (!projectStore.path) return
    try {
      patch('mysqlLibrary', await getMysqlLibrary(projectStore.path))
    } catch (err) {
      patch('mysqlLibrary', createEmptyMysqlLibrary())
      console.error(err)
    }
  }

  async function loadOssLibrary() {
    if (!projectStore.path) return
    try {
      patch('ossLibrary', await getOssLibrary(projectStore.path))
    } catch (err) {
      patch('ossLibrary', createEmptyOssLibrary())
      console.error(err)
    }
  }

  async function loadBackendServiceLibrary() {
    if (!projectStore.path) return
    try {
      const next = await getBackendServiceLibrary(projectStore.path)
      s.backendServiceLibrary = next
      if (
        s.activeServiceId &&
        !next.services.some((svc) => svc.id === s.activeServiceId)
      ) {
        s.activeServiceId = next.services[0]?.id ?? ''
      } else if (!s.activeServiceId && next.services.length) {
        s.activeServiceId = next.services[0]!.id
      }
      rerender()
    } catch (err) {
      patch('backendServiceLibrary', createEmptyBackendServiceLibrary())
      console.error(err)
    }
  }

  async function refreshComponentMap() {
    if (!projectStore.path) {
      s.componentMap = {}
      s.componentMethodsMap = {}
      rerender()
      return
    }
    try {
      const { components: list } = await listComponents(projectStore.path)
      const details = await Promise.all(
        list.map((item) => getComponent(projectStore.path, item.id)),
      )
      const lifecycleEntries = await Promise.all(
        details.map(async (detail) => {
          try {
            const { lifecycle } = await getComponentLifecycle(
              projectStore.path,
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
            colorPalette: s.colorPalette,
          }),
          lifecycle: lifecycleById[detail.id] ?? createEmptyLifecycleConfig(),
        }
      }
      s.componentMap = next
      const methodEntries = await Promise.all(
        details.map(async (detail) => {
          try {
            const { methods } = await listComponentMethods(
              projectStore.path,
              detail.id,
            )
            return [detail.id, methods] as const
          } catch {
            return [detail.id, [] as PageMethod[]] as const
          }
        }),
      )
      s.componentMethodsMap = Object.fromEntries(methodEntries)
      rerender()
    } catch (err) {
      console.error(err)
    }
  }

  async function loadPages(selectId?: string) {
    if (!projectStore.path) return
    patch('loadingPages', true)
    try {
      await Promise.all([
        loadIconLibrary(),
        loadColorPalette(),
        loadDataTypeLibrary(),
        loadMysqlLibrary(),
        loadOssLibrary(),
        loadBackendServiceLibrary(),
      ])
      const [pageResult, componentResult] = await Promise.all([
        listPages(projectStore.path),
        listComponents(projectStore.path),
      ])
      s.pages = pageResult.pages
      s.components = componentResult.components
      await refreshComponentMap()
      if (s.resourceKind === 'component') {
        const nextId =
          selectId ||
          (s.activeComponentId &&
          componentResult.components.some((p) => p.id === s.activeComponentId)
            ? s.activeComponentId
            : componentResult.components[0]?.id)
        if (nextId) await openComponent(nextId)
        else {
          s.activeComponentId = ''
          s.activeComponent = null
          s.selectedNodeId = ''
        }
      } else {
        const nextId =
          selectId ||
          (s.activePageId && pageResult.pages.some((p) => p.id === s.activePageId)
            ? s.activePageId
            : pageResult.pages[0]?.id)
        if (nextId) await openPage(nextId)
        else {
          s.activePageId = ''
          s.activePage = null
          s.selectedNodeId = ''
        }
      }
      rerender()
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '加载列表失败')
    } finally {
      patch('loadingPages', false)
    }
  }

  async function loadPageMethods(pageId?: string) {
    if (!projectStore.path) return
    const id =
      pageId || (s.resourceKind === 'component' ? s.activeComponentId : s.activePageId)
    if (!id) {
      patch('pageMethods', [])
      return
    }
    try {
      const result =
        s.resourceKind === 'component'
          ? await listComponentMethods(projectStore.path, id)
          : await listPageMethods(projectStore.path, id)
      let methods = result.methods
      {
        const expected = builtinsForRoot(
          s.resourceKind === 'component' ? 'components' : 'pages',
        )
        const names = new Set(methods.map((item) => item.name))
        const missing = expected.filter((item) => !names.has(item.name))
        if (missing.length) {
          const builtins = methods.filter((item) => item.builtin)
          const custom = methods.filter((item) => !item.builtin)
          methods = [...builtins, ...missing, ...custom]
        }
      }
      patch('pageMethods', methods)
    } catch (err) {
      patch('pageMethods', [])
      console.error(err)
    }
  }

  async function loadLifecycle(resourceId?: string) {
    if (!projectStore.path) return
    const id =
      resourceId || (s.resourceKind === 'component' ? s.activeComponentId : s.activePageId)
    if (!id) {
      patch('lifecycleConfig', createEmptyLifecycleConfig())
      return
    }
    try {
      const result =
        s.resourceKind === 'component'
          ? await getComponentLifecycle(projectStore.path, id)
          : await getPageLifecycle(projectStore.path, id)
      patch('lifecycleConfig', result.lifecycle ?? createEmptyLifecycleConfig())
    } catch (err) {
      patch('lifecycleConfig', createEmptyLifecycleConfig())
      console.error(err)
    }
  }

  async function handleLifecycleUpdate(lifecycle: LifecycleConfig) {
    if (!projectStore.path) return
    const doc = s.resourceKind === 'page' ? s.activePage : s.activeComponent
    if (!doc) return
    patch('lifecycleConfig', lifecycle)
    if (lifecycleSaveTimer.current) clearTimeout(lifecycleSaveTimer.current)
    lifecycleSaveTimer.current = setTimeout(async () => {
      const liveDoc = s.resourceKind === 'page' ? s.activePage : s.activeComponent
      if (!projectStore.path || !liveDoc) return
      try {
        if (s.resourceKind === 'component') {
          const result = await saveComponentLifecycle({
            projectPath: projectStore.path,
            componentId: liveDoc.id,
            lifecycle: s.lifecycleConfig,
          })
          s.lifecycleConfig = result.lifecycle
          const cid = liveDoc.id
          const prev = s.componentMap[cid]
          if (prev) {
            s.componentMap = {
              ...s.componentMap,
              [cid]: { ...prev, lifecycle: result.lifecycle },
            }
          }
          rerender()
        } else {
          const result = await savePageLifecycle({
            projectPath: projectStore.path,
            pageId: liveDoc.id,
            lifecycle: s.lifecycleConfig,
          })
          patch('lifecycleConfig', result.lifecycle)
        }
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存生命周期失败')
      }
    }, 400)
  }

  function syncRouteParamsFromPageConfig(
    config?: PageConfig | null,
    options?: { silent?: boolean },
  ) {
    const next = !config
      ? {}
      : buildQueryObject(config.queryParams, config.debugQuery)
    if (options?.silent) {
      s.routeParams = next
      return
    }
    patch('routeParams', next)
  }

  function commitPreviewRuntime(data: PageData, map: ComponentRenderMap) {
    s.previewRuntimeData = resolvePreviewPageData(data)
    s.previewComponentMap = map
    s.previewPropOverrides = s.resourceKind === 'component' ? restoreComponentDebugProps() : {}
    s.previewInstancePropOverrides = {}
    if (!s.refNavRestoring) s.previewInspectTarget = null
    s.previewEmitLogs = []
    s.previewControllerFetchLogs = {}
    s.previewRuntimeLogs = []
    rerender()
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
    if (!options?.keepHistory) s.pageHistory = []
    const useNavParams = options?.params !== undefined
    if (useNavParams) {
      s.routeParams =
        options.params && typeof options.params === 'object' && !Array.isArray(options.params)
          ? { ...options.params }
          : {}
    } else if (!options?.keepHistory) {
      s.routeParams = {}
    }
    await teardownLifecycleSession()
    if (!isPreviewNavCurrent(nav)) return
    s.activePageId = pageId
    const softNav = Boolean(s.activePage || s.activeComponent)
    s.selectedNodeId = ''
    s.editorHiddenNodeIds = []
    modalStack.closeAll()
    if (!softNav) s.loadingPage = true
    rerender()
    try {
      const detail = await getPage(projectStore.path, pageId)
      if (!isPreviewNavCurrent(nav)) return
      const migrated = migrateLegacyMaskToModal(detail.xml)
      const nextPage: PageDetail = migrated.changed
        ? { ...detail, xml: migrated.xml }
        : detail
      const inPreview = s.workspaceMode === 'preview'
      s.resourceKind = 'page'
      s.activeComponentId = ''
      s.activeComponent = null
      s.activePage = nextPage
      if (!useNavParams && !options?.keepHistory) {
        syncRouteParamsFromPageConfig(nextPage.config, { silent: true })
      }
      if (inPreview) {
        seedPreviewRuntime(nextPage.data ?? { fields: [] })
      } else {
        clearPreviewRuntime({ silent: true })
      }
      s.loadingPage = false
      rerender()

      const isolatePreview = (async () => {
        await afterPaint()
        if (!isPreviewNavCurrent(nav) || !inPreview) return
        s.previewComponentMap = cloneComponentRenderMap(s.componentMap)
        rerender()
      })()
      await Promise.all([
        isolatePreview,
        loadPageMethods(pageId),
        loadLifecycle(pageId),
      ])
      if (!isPreviewNavCurrent(nav)) return
      if (migrated.changed) {
        await handleXmlUpdate(migrated.xml)
        if (!isPreviewNavCurrent(nav)) return
      }
      if (inPreview) {
        s.previewLifecycleGate += 1
        rerender()
        await syncLifecycleSession()
        if (!isPreviewNavCurrent(nav)) return
        await hydratePreviewControllerBindings()
      } else {
        await syncLifecycleSession()
      }
    } catch (err) {
      if (!isPreviewNavCurrent(nav)) return
      s.activePage = null
      s.pageMethods = []
      s.lifecycleConfig = createEmptyLifecycleConfig()
      rerender()
      ElMessage.error(err instanceof Error ? err.message : '打开页面失败')
    } finally {
      if (isPreviewNavCurrent(nav)) patch('loadingPage', false)
    }
  }

  async function openComponent(componentId: string) {
    if (!projectStore.path) return
    const nav = beginPreviewNavigation()
    await teardownLifecycleSession()
    if (!isPreviewNavCurrent(nav)) return
    const softNav = Boolean(s.activeComponent || s.activePage)
    s.selectedNodeId = ''
    s.editorHiddenNodeIds = []
    s.pageHistory = []
    s.routeParams = {}
    modalStack.closeAll()
    s.activeComponentId = componentId
    if (!softNav) s.loadingPage = true
    rerender()
    try {
      const detail = await getComponent(projectStore.path, componentId)
      if (!isPreviewNavCurrent(nav)) return
      const migrated = migrateLegacyMaskToModal(detail.xml)
      const nextComponent = migrated.changed
        ? { ...detail, xml: migrated.xml }
        : detail
      const inPreview = s.workspaceMode === 'preview'
      s.resourceKind = 'component'
      s.activeComponentId = componentId
      s.activePageId = ''
      s.activePage = null
      s.activeComponent = nextComponent
      if (inPreview) {
        seedPreviewRuntime(nextComponent.data ?? { fields: [] })
      } else {
        clearPreviewRuntime({ silent: true })
      }
      s.loadingPage = false
      rerender()

      const isolatePreview = (async () => {
        await afterPaint()
        if (!isPreviewNavCurrent(nav) || !inPreview) return
        s.previewComponentMap = cloneComponentRenderMap(s.componentMap)
        rerender()
      })()
      await Promise.all([
        isolatePreview,
        loadPageMethods(componentId),
        loadLifecycle(componentId),
      ])
      if (!isPreviewNavCurrent(nav)) return
      if (migrated.changed) {
        await handleXmlUpdate(migrated.xml)
        if (!isPreviewNavCurrent(nav)) return
      }
      if (inPreview) {
        s.previewLifecycleGate += 1
        rerender()
        await syncLifecycleSession()
        if (!isPreviewNavCurrent(nav)) return
        await hydratePreviewControllerBindings()
      } else {
        await syncLifecycleSession()
      }
    } catch (err) {
      if (!isPreviewNavCurrent(nav)) return
      s.activeComponent = null
      s.pageMethods = []
      s.lifecycleConfig = createEmptyLifecycleConfig()
      rerender()
      ElMessage.error(err instanceof Error ? err.message : '打开组件失败')
    } finally {
      if (isPreviewNavCurrent(nav)) patch('loadingPage', false)
    }
  }

  function switchResourceKind(kind: ResourceKind) {
    leaveProjectNav()
    if (s.resourceKind === kind) return
    clearRefNavStack()
    s.resourceKind = kind
    s.selectedNodeId = ''
    rerender()
    if (kind === 'page') {
      const id = s.activePageId || s.pages[0]?.id
      if (id) void openPage(id)
      else {
        s.activePage = null
        s.pageMethods = []
        s.lifecycleConfig = createEmptyLifecycleConfig()
        rerender()
      }
    } else {
      const id = s.activeComponentId || s.components[0]?.id
      if (id) void openComponent(id)
      else {
        s.activeComponent = null
        s.pageMethods = []
        s.lifecycleConfig = createEmptyLifecycleConfig()
        rerender()
      }
    }
  }

  function leaveProjectNav() {
    if (!isProjectNav && !isBackendNav) return
    s.topNav = 'frontend'
    if (
      s.workspaceMode === 'datatypes' ||
      s.workspaceMode === 'mysql' ||
      s.workspaceMode === 'oss' ||
      s.workspaceMode === 'icons' ||
      s.workspaceMode === 'palette'
    ) {
      s.workspaceMode = 'preview'
    }
    rerender()
  }

  function selectFrontendNav() {
    leaveProjectNav()
    patch('topNav', 'frontend')
  }

  function selectBackendNav() {
    s.topNav = 'backend'
    if (
      s.workspaceMode === 'datatypes' ||
      s.workspaceMode === 'mysql' ||
      s.workspaceMode === 'oss' ||
      s.workspaceMode === 'icons' ||
      s.workspaceMode === 'palette'
    ) {
      s.workspaceMode = 'preview'
    }
    if (!s.activeServiceId && s.backendServiceLibrary.services.length) {
      s.activeServiceId = s.backendServiceLibrary.services[0]!.id
    }
    rerender()
  }

  function selectProjectNav(nav: ProjectNav) {
    s.topNav = nav
    s.workspaceMode = nav
    rerender()
  }

  function setWorkspaceMode(mode: (typeof modeTabs)[number]['key']) {
    s.topNav = 'frontend'
    s.workspaceMode = mode
    rerender()
  }

  function toggleEditorHidden(nodeId: string) {
    const set = new Set(s.editorHiddenNodeIds)
    if (set.has(nodeId)) set.delete(nodeId)
    else set.add(nodeId)
    patch('editorHiddenNodeIds', Array.from(set))
  }

  function openCreateDialog() {
    createForm.resetFields()
    createForm.setFieldsValue({ id: '', name: '', title: '' })
    patch('createVisible', true)
  }

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
        if (s.activePage?.id === page.id) {
          s.activePage = {
            ...s.activePage,
            config: {
              ...s.activePage.config,
              name,
              title:
                s.activePage.config.title === s.activePage.config.name
                  ? name
                  : s.activePage.config.title,
            },
          }
        }
        s.pages = s.pages.map((item) =>
          item.id === page.id
            ? { ...item, name, title: item.title === item.name ? name : item.title }
            : item,
        )
        rerender()
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
        s.pages = s.pages.map((item) => ({
          ...item,
          isEntry: item.id === page.id,
        }))
        rerender()
        ElMessage.success(`已将「${page.name}」设为入口`)
        return
      }
      if (command === 'delete') {
        await ElMessageBox.confirm(
          `确定删除页面「${page.name}」（${page.id}）吗？此操作不可恢复。`,
          '删除页面',
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
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
          s.activePageId === page.id
            ? s.pages.find((item) => item.id !== page.id)?.id
            : s.activePageId
        if (s.activePageId === page.id) {
          s.activePageId = ''
          s.activePage = null
        }
        await loadPages(nextSelect || undefined)
      }
    } catch (err) {
      if (err === 'cancel' || err === 'close') return
      ElMessage.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  function openRenameComponentDialog(component: ComponentSummary) {
    s.renameComponentTarget = component
    renameComponentForm.resetFields()
    renameComponentForm.setFieldsValue({ id: component.id, name: component.name })
    patch('renameComponentVisible', true)
  }

  async function handleRenameComponentConfirm() {
    const target = s.renameComponentTarget
    if (!target || !projectStore.path) return
    try {
      await renameComponentForm.validateFields()
    } catch {
      return
    }
    const values = renameComponentForm.getFieldsValue()
    patch('renamingComponent', true)
    try {
      const renamed = await renameComponent({
        projectPath: projectStore.path,
        componentId: target.id,
        newId: values.id.trim(),
        name: values.name.trim(),
      })
      const refsHint =
        renamed.refsUpdated > 0 ? `，已更新 ${renamed.refsUpdated} 处引用` : ''
      ElMessage.success(`已重命名${refsHint}`)
      s.renameComponentVisible = false
      if (s.activeComponentId === target.id) s.activeComponentId = renamed.id
      rerender()
      await loadPages(renamed.id)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '重命名失败')
    } finally {
      patch('renamingComponent', false)
    }
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
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
        )
        await deleteComponent({
          projectPath: projectStore.path,
          componentId: component.id,
        })
        ElMessage.success('已删除')
        const nextSelect =
          s.activeComponentId === component.id
            ? s.components.find((item) => item.id !== component.id)?.id
            : s.activeComponentId
        if (s.activeComponentId === component.id) {
          s.activeComponentId = ''
          s.activeComponent = null
        }
        await loadPages(nextSelect || undefined)
      }
    } catch (err) {
      if (err === 'cancel' || err === 'close') return
      ElMessage.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  async function handleCreatePage() {
    if (!projectStore.path) return
    try {
      await createForm.validateFields()
    } catch {
      return
    }
    const values = createForm.getFieldsValue()
    patch('creating', true)
    try {
      if (isComponentResource) {
        const component = await createComponent({
          projectPath: projectStore.path,
          id: values.id.trim(),
          name: values.name.trim(),
          title: values.title.trim() || undefined,
        })
        ElMessage.success(`已创建组件：${component.config.name}`)
        patch('createVisible', false)
        await loadPages(component.id)
      } else {
        const page = await createPage({
          projectPath: projectStore.path,
          id: values.id.trim(),
          name: values.name.trim(),
          title: values.title.trim() || undefined,
        })
        ElMessage.success(`已创建页面：${page.config.name}`)
        patch('createVisible', false)
        await loadPages(page.id)
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      patch('creating', false)
    }
  }

  async function handleXmlUpdate(xml: string) {
    if (!projectStore.path) return
    if (s.resourceKind === 'component' && s.activeComponent) {
      s.activeComponent = { ...s.activeComponent, xml }
      rerender()
      if (xmlSaveTimer.current) clearTimeout(xmlSaveTimer.current)
      xmlSaveTimer.current = setTimeout(async () => {
        if (!projectStore.path || !s.activeComponent) return
        try {
          s.activeComponent = await saveComponentXml({
            projectPath: projectStore.path,
            componentId: s.activeComponent.id,
            xml: s.activeComponent.xml,
          })
          rerender()
          await refreshComponentMap()
        } catch (err) {
          ElMessage.error(err instanceof Error ? err.message : '保存失败')
        }
      }, 280)
      return
    }
    if (!s.activePage) return
    s.activePage = { ...s.activePage, xml }
    rerender()
    if (xmlSaveTimer.current) clearTimeout(xmlSaveTimer.current)
    xmlSaveTimer.current = setTimeout(async () => {
      if (!projectStore.path || !s.activePage) return
      try {
        s.activePage = await savePageXml({
          projectPath: projectStore.path,
          pageId: s.activePage.id,
          xml: s.activePage.xml,
        })
        rerender()
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存失败')
      }
    }, 280)
  }

  async function handleStatusBarUpdate(config: StatusBarConfig) {
    if (!projectStore.path || !s.activePage || isComponentResource) return
    const next = normalizeStatusBarConfig(config)
    s.activePage = {
      ...s.activePage,
      config: { ...s.activePage.config, statusBar: next },
    }
    rerender()
    try {
      const saved = await savePageConfig({
        projectPath: projectStore.path,
        pageId: s.activePage.id,
        name: s.activePage.config.name,
        title: s.activePage.config.title,
        statusBar: next,
        queryParams: s.activePage.config.queryParams,
        debugQuery: s.activePage.config.debugQuery,
      })
      s.activePage = { ...s.activePage, config: saved.config }
      rerender()
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存状态栏失败')
    }
  }

  const pageQueryParams: PageQueryParamDef[] = isPageResource
    ? s.activePage?.config.queryParams ?? []
    : []
  const pageDebugQuery: Record<string, unknown> = isPageResource
    ? s.activePage?.config.debugQuery ?? {}
    : {}

  async function persistPageQueryConfig(partial: {
    queryParams?: PageQueryParamDef[]
    debugQuery?: Record<string, unknown>
  }) {
    if (!projectStore.path || !s.activePage || isComponentResource) return
    const nextConfig: PageConfig = {
      ...s.activePage.config,
      ...(partial.queryParams !== undefined ? { queryParams: partial.queryParams } : {}),
      ...(partial.debugQuery !== undefined ? { debugQuery: partial.debugQuery } : {}),
    }
    s.activePage = { ...s.activePage, config: nextConfig }
    syncRouteParamsFromPageConfig(nextConfig)
    rerender()
    if (pageQuerySaveTimer.current) clearTimeout(pageQuerySaveTimer.current)
    pageQuerySaveTimer.current = setTimeout(async () => {
      if (!projectStore.path || !s.activePage) return
      try {
        const saved = await savePageConfig({
          projectPath: projectStore.path,
          pageId: s.activePage.id,
          name: s.activePage.config.name,
          title: s.activePage.config.title,
          statusBar: s.activePage.config.statusBar,
          queryParams: s.activePage.config.queryParams ?? [],
          debugQuery: s.activePage.config.debugQuery ?? {},
        })
        s.activePage = { ...s.activePage, config: saved.config }
        rerender()
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

  const pageStatusBarConfig = normalizeStatusBarConfig(
    isPageResource ? s.activePage?.config.statusBar : null,
  )

  const resolvedPageStatusBar = (() => {
    const bar = resolveStatusBarConfig(
      isPageResource ? s.activePage?.config.statusBar : null,
      resolvedPageData,
    )
    return {
      ...bar,
      backgroundColor: resolvePaletteColorValue(bar.backgroundColor, s.colorPalette),
    }
  })()

  function applyComponentPreviewSetData(
    componentId: string,
    prop: string,
    value: DataFieldValue,
    meta?: {
      objectFields?: import('../types/page-data').ObjectSubField[]
      arrayFields?: import('../types/page-data').ArraySubField[]
    },
  ) {
    if (s.workspaceMode !== 'preview') return
    if (!s.previewComponentMap) resetPreviewRuntime()
    const map = s.previewComponentMap
    if (!map) return
    const info = map[componentId]
    if (!info) {
      pushPreviewRuntimeLog({
        level: 'error',
        message: `组件不存在：${componentId}`,
        location: `组件 ${componentId} · setData`,
      })
      return
    }
    const fields = info.data.fields ?? []
    const index = fields.findIndex((item) => item.name.trim() === prop.trim())
    if (index < 0) {
      pushPreviewRuntimeLog({
        level: 'error',
        message: `组件数据池不存在字段：${prop}`,
        location: `组件 ${componentId} · setData('${prop}')`,
      })
      return
    }
    const prev = fields[index]!
    const valueUnchanged = sameJson(prev.value, value)
    if (valueUnchanged && !meta) return
    prev.value = value
    if (meta?.objectFields !== undefined) {
      prev.objectFields = meta.objectFields
    } else if (
      prev.type === 'json' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray(prev.objectFields) &&
      prev.objectFields.length
    ) {
      const obj = value as Record<string, unknown>
      for (const sub of prev.objectFields) {
        const key = sub.name.trim()
        if (!key || !(key in obj)) continue
        sub.value = obj[key] as DataFieldValue
      }
    }
    if (meta?.arrayFields !== undefined) prev.arrayFields = meta.arrayFields
    resolveComputedFieldsInPlace(info.data, [prop], {
      getDeviceInfo: previewGetDeviceInfo,
      dollarProps: buildDollarProps(info.config),
      colorPalette: s.colorPalette,
    })
    bumpPreviewDataRevision()
  }

  function applyPreviewUpdateProps(
    prop: string,
    value: unknown,
    options?: {
      componentId?: string
      hostAttrs?: Record<string, string>
      hostDataOwnerId?: string
      config?: ComponentConfig | null
    },
  ) {
    const name = prop.trim()
    if (!name) return
    const config =
      options?.config ??
      (options?.componentId ? canvasComponentMap[options.componentId]?.config : null) ??
      (isComponentResource ? s.activeComponent?.config : null)
    const def = config?.props?.find((item) => item.name.trim() === name)
    if (!def) {
      pushPreviewRuntimeLog({
        level: 'error',
        message: `组件参数不存在：${name}`,
        location: options?.componentId
          ? `组件 ${options.componentId} · updateProps('${name}')`
          : `updateProps('${name}')`,
      })
      return
    }
    if (!def.twoWay) {
      pushPreviewRuntimeLog({
        level: 'warn',
        message: `「${name}」未开启「可更新」，无法 updateProps`,
        location: options?.componentId
          ? `组件 ${options.componentId} · updateProps('${name}')`
          : `updateProps('${name}')`,
      })
      return
    }
    if (def.type === 'api') {
      pushPreviewRuntimeLog({
        level: 'warn',
        message: `「${name}」为后端 API 参数，无法 updateProps`,
        location: options?.componentId
          ? `组件 ${options.componentId} · updateProps('${name}')`
          : `updateProps('${name}')`,
      })
      return
    }
    const coerced = normalizePropDefaultValue(def.type, value)
    if (
      isComponentResource &&
      (!options?.componentId || options.componentId === s.activeComponentId)
    ) {
      applyPreviewPropRuntimeOverride(name, coerced)
    }
    const boundField = parseSimpleDataBinding(options?.hostAttrs?.[name])
    if (boundField) {
      const hostOwner = options?.hostDataOwnerId?.trim() || ''
      if (hostOwner) applyComponentPreviewSetData(hostOwner, boundField, coerced)
      else applyPreviewSetData(boundField, coerced)
      const prev = s.previewInstancePropOverrides
      let changed = false
      const next: Record<string, Record<string, unknown>> = {}
      for (const [nodeId, bag] of Object.entries(prev)) {
        if (!(name in bag)) {
          next[nodeId] = bag
          continue
        }
        const { [name]: _drop, ...rest } = bag
        changed = true
        if (Object.keys(rest).length) next[nodeId] = rest
      }
      if (changed) patch('previewInstancePropOverrides', next)
    }
    bumpPreviewDataRevision()
  }

  function applyPreviewSetData(
    prop: string,
    value: DataFieldValue,
    meta?: {
      objectFields?: import('../types/page-data').ObjectSubField[]
      arrayFields?: import('../types/page-data').ArraySubField[]
    },
  ) {
    if (!activeDoc || s.workspaceMode !== 'preview') return
    if (!s.previewRuntimeData) resetPreviewRuntime()
    const live = s.previewRuntimeData
    if (!live) return
    const fields = live.fields ?? []
    const index = fields.findIndex((item) => item.name.trim() === prop.trim())
    if (index < 0) {
      pushPreviewRuntimeLog({
        level: 'error',
        message: `数据池不存在字段：${prop}`,
        location: `页面 · setData('${prop}')`,
      })
      return
    }
    const prev = fields[index]!
    const valueUnchanged = sameJson(prev.value, value)
    if (valueUnchanged && !meta) return
    prev.value = value
    if (meta?.objectFields !== undefined) {
      prev.objectFields = meta.objectFields
    } else if (
      prev.type === 'json' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray(prev.objectFields) &&
      prev.objectFields.length
    ) {
      const obj = value as Record<string, unknown>
      for (const sub of prev.objectFields) {
        const key = sub.name.trim()
        if (!key || !(key in obj)) continue
        sub.value = obj[key] as DataFieldValue
      }
    }
    if (meta?.arrayFields !== undefined) prev.arrayFields = meta.arrayFields
    resolveComputedFieldsInPlace(live, [prop], {
      getDeviceInfo: previewGetDeviceInfo,
      dollarProps: editorDollarProps ?? {},
      dollarQuery: s.resourceKind === 'page' ? s.routeParams : undefined,
      colorPalette: s.colorPalette,
    })
    bumpPreviewDataRevision()
    scheduleLifecycleUpdate()
  }

  function runComponentExposedMethod(
    componentId: string,
    methodName: string,
    args: unknown[],
    options?: { hostAttrs?: Record<string, string>; hostNodePath?: string },
  ) {
    const info = canvasComponentMap[componentId]
    if (!info) {
      pushPreviewRuntimeLog({
        level: 'error',
        message: `组件不存在：${componentId}`,
        location: `调用暴露方法 · ${componentId}.${methodName}`,
      })
      return
    }
    const exposed = info.config.exposedMethods ?? []
    if (!exposed.includes(methodName)) {
      pushPreviewRuntimeLog({
        level: 'warn',
        message: `方法「${methodName}」未在组件中暴露`,
        location: `组件 ${componentId}`,
      })
      return
    }
    const method = (s.componentMethodsMap[componentId] ?? []).find(
      (item) => item.name === methodName && !item.builtin,
    )
    if (!method?.body?.trim()) {
      pushPreviewRuntimeLog({
        level: 'error',
        message: `找不到方法「${methodName}」的实现`,
        location: `组件 ${componentId}`,
      })
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
    const hostAttrs = options?.hostAttrs
    const instanceDollarProps = hostAttrs
      ? resolveComponentInstanceDollarProps({
          config: info.config,
          hostAttrs,
          pageData: resolvedPageData,
          routeParams: s.routeParams,
          projectPath: projectStore.path,
        })
      : hydrateApiDollarProps(
          buildDollarProps(info.config),
          info.config.props,
          projectStore.path,
        )
    void runEventBindings(raw, {
      pageData: info.data,
      getPageData: () => s.previewComponentMap?.[componentId]?.data ?? info.data,
      xml: info.xml,
      modalStack,
      componentMap: canvasComponentMap,
      componentMethodsMap: s.componentMethodsMap,
      runComponentMethod: runComponentExposedMethod,
      resolveMethod: (name) =>
        (s.componentMethodsMap[componentId] ?? []).find(
          (item) => item.name === name && !item.builtin,
        ),
      localMethods: (s.componentMethodsMap[componentId] ?? []).filter(
        (item) => !item.builtin,
      ),
      eventArgs,
      dollarProps: instanceDollarProps,
      hasPage: (pageId) => s.pages.some((item) => item.id === pageId),
      navigateTo: async () => {
        pushPreviewRuntimeLog({
          level: 'info',
          message: '组件内暂不支持 navigateTo',
          location: `组件 ${componentId}`,
        })
      },
      navigateBack: async () => {
        pushPreviewRuntimeLog({
          level: 'info',
          message: '组件内暂不支持 navigateBack',
          location: `组件 ${componentId}`,
        })
      },
      setData: (nextProp, nextValue) => {
        applyComponentPreviewSetData(componentId, nextProp, nextValue)
      },
      updateProps: (nextProp, nextValue) => {
        applyPreviewUpdateProps(nextProp, nextValue, {
          componentId,
          config: info.config,
          hostAttrs,
        })
      },
      showToast: (message, duration) => {
        showPreviewToast(message, duration)
      },
      getDeviceInfo: previewGetDeviceInfo,
      colorPalette: s.colorPalette,
      logLocation: formatPreviewLogLocation({
        dataOwnerComponentId: componentId,
        timing: `暴露方法 ${methodName}`,
      }),
      onUnknownMethod: (name, detail) => {
        const location =
          detail?.location?.trim() ||
          formatPreviewLogLocation({
            dataOwnerComponentId: componentId,
            timing: `暴露方法 ${methodName}`,
          })
        if (name.startsWith('自定义方法')) {
          pushPreviewRuntimeLog({ level: 'error', message: name, location })
        } else if (name.startsWith('updateProps')) {
          pushPreviewRuntimeLog({ level: 'warn', message: name, location })
        }
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
      dataOwnerComponentId?: string
      updatePropsHostAttrs?: Record<string, string>
      updatePropsHostDataOwnerId?: string
      logLocation?: string
    },
  ) {
    if (!activeDoc) return
    const sessionGen = previewSessionGen.current
    const ownerId = options?.dataOwnerComponentId?.trim() || ''
    const ownerInfo = ownerId ? canvasComponentMap[ownerId] : null
    if (ownerId && !ownerInfo) {
      pushPreviewRuntimeLog({
        level: 'error',
        message: `组件不存在：${ownerId}`,
        location: '运行事件绑定',
      })
      return
    }
    const boundUpdatePropsConfig =
      ownerInfo?.config ??
      (isComponentResource ? s.activeComponent?.config : undefined)
    const boundHostAttrs = options?.updatePropsHostAttrs
    const boundHostDataOwnerId = options?.updatePropsHostDataOwnerId
    const boundDollarProps = options?.dollarProps ?? editorDollarProps
    const boundLocalMethods = ownerId
      ? (s.componentMethodsMap[ownerId] ?? []).filter((item) => !item.builtin)
      : s.pageMethods.filter((item) => !item.builtin)
    const boundResolveMethod = (name: string) =>
      ownerId
        ? (s.componentMethodsMap[ownerId] ?? []).find(
            (item) => item.name === name && !item.builtin,
          )
        : s.pageMethods.find((item) => item.name === name && !item.builtin)
    const debugEmit = options?.emitFn ?? createPreviewDebugEmit()
    const debugEmitWithArgs =
      options?.emitWithArgs ??
      (isComponentResource
        ? (eventName: string, args: Record<string, unknown>) => {
            if (!isPreviewSessionLive(sessionGen)) return
            const params =
              s.activeComponent?.config.events?.find(
                (item) => item.name.trim() === eventName,
              )?.params ?? []
            const packed: Record<string, unknown> = {}
            for (const param of params) {
              const key = param.name.trim()
              if (!key || key.startsWith('...')) continue
              if (key in args) packed[key] = coerceEmitParamValue(param.type, args[key])
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
          s.previewComponentMap?.[ownerId]?.data ??
          ownerInfo?.data ??
          activeDoc.data
        )
      }
      return s.previewRuntimeData ?? activeDoc.data
    }
    const boundLogLocation =
      options?.logLocation?.trim() ||
      formatPreviewLogLocation({ dataOwnerComponentId: ownerId || undefined })
    await runEventBindings(raw, {
      pageData: readLivePageData(),
      getPageData: readLivePageData,
      xml: ownerInfo ? ownerInfo.xml : activeDoc.xml,
      modalStack,
      componentMap: canvasComponentMap,
      componentMethodsMap: s.componentMethodsMap,
      runComponentMethod: runComponentExposedMethod,
      resolveMethod: boundResolveMethod,
      localMethods: boundLocalMethods,
      scope: options?.scope,
      eventArgs: options?.eventArgs,
      dollarProps: boundDollarProps,
      emit: debugEmit,
      emitWithArgs: debugEmitWithArgs,
      logLocation: boundLogLocation,
      hasPage: (pageId) => s.pages.some((item) => item.id === pageId),
      navigateTo: async (pageId, params) => {
        if (!isPreviewSessionLive(sessionGen)) return
        if (s.activePageId && s.activePageId !== pageId) {
          s.pageHistory.push({
            pageId: s.activePageId,
            params: { ...s.routeParams },
          })
          rerender()
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
        const prev = s.pageHistory.pop()
        rerender()
        if (!prev) {
          ElMessage.info('没有可返回的页面')
          return
        }
        await openPage(prev.pageId, { keepHistory: true, params: prev.params })
      },
      setData: (prop, value) => {
        if (!isPreviewSessionLive(sessionGen)) return
        if (ownerId) applyComponentPreviewSetData(ownerId, prop, value)
        else applyPreviewSetData(prop, value)
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
      colorPalette: s.colorPalette,
      onUnknownMethod: (name, detail) => {
        if (!isPreviewSessionLive(sessionGen)) return
        const location = detail?.location?.trim() || boundLogLocation
        if (name.startsWith('navigateTo:')) {
          pushPreviewRuntimeLog({
            level: 'warn',
            message: name.replace(/^navigateTo:\s*/, ''),
            location,
          })
        } else if (name.startsWith('自定义方法')) {
          pushPreviewRuntimeLog({ level: 'error', message: name, location })
        } else if (name.startsWith('updateProps')) {
          pushPreviewRuntimeLog({ level: 'warn', message: name, location })
        }
      },
    })
  }

  function pushControllerFetchLog(entry: ControllerFetchLogEntry) {
    const key = entry.fieldName.trim() || '?'
    const prev = s.previewControllerFetchLogs[key] ?? []
    patch('previewControllerFetchLogs', {
      ...s.previewControllerFetchLogs,
      [key]: [entry, ...prev].slice(0, 30),
    })
  }

  async function hydratePreviewControllerBindings() {
    const path = projectStore.path
    const runtime = s.previewRuntimeData
    if (!path || !runtime || s.workspaceMode !== 'preview') return
    if (!hasControllerBoundFields(runtime)) return
    const seq = ++previewControllerHydrateSeq.current
    const sessionGen = previewSessionGen.current
    try {
      const next = await loadControllerBoundPageData(runtime, {
        projectPath: path,
        dryRun: true,
        typeLibrary: s.dataTypeLibrary,
        pageScope: {
          ...Object.fromEntries(
            (runtime.fields ?? []).map((f) => [f.name.trim(), f.value]),
          ),
          $query: { ...s.routeParams },
          $route: { ...s.routeParams },
        },
        runEvents: (raw, eventArgs, meta) =>
          runPreviewBindings(raw, {
            eventArgs,
            logLocation: formatPreviewLogLocation({
              timing: `控制器绑定 · ${meta?.hook || '钩子'}`,
            }),
          }),
        onFetchLog: pushControllerFetchLog,
      })
      if (seq !== previewControllerHydrateSeq.current) return
      if (!isPreviewSessionLive(sessionGen)) return
      if (s.workspaceMode !== 'preview') return
      const live = s.previewRuntimeData
      if (!live) {
        patch('previewRuntimeData', next)
        return
      }
      const nextByName = new Map(next.fields.map((f) => [f.name.trim(), f] as const))
      const fields = live.fields.map((f) => {
        if (f.binding !== 'controller') return f
        const name = f.name.trim()
        const updated = nextByName.get(name)
        if (!updated) return f
        return {
          ...f,
          value: updated.value,
          objectFields: updated.objectFields ?? f.objectFields,
        }
      })
      s.previewRuntimeData = resolveComputedPageData(
        { fields },
        {
          getDeviceInfo: previewGetDeviceInfo,
          dollarProps: editorDollarProps ?? {},
          dollarQuery: s.resourceKind === 'page' ? s.routeParams : undefined,
          colorPalette: s.colorPalette,
        },
      )
      rerender()
    } catch (err) {
      console.warn('[luban] 预览控制器数据加载失败:', err)
    }
  }

  async function preparePreviewRuntime() {
    const sessionGen = previewSessionGen.current
    const doc = s.resourceKind === 'page' ? s.activePage : s.activeComponent
    if (!doc) {
      clearPreviewRuntime()
      return
    }
    if (s.resourceKind === 'component' && s.activeComponentId && projectStore.path) {
      try {
        const detail = await getComponent(projectStore.path, s.activeComponentId)
        if (!isPreviewSessionLive(sessionGen)) return
        if (s.activeComponent?.id === detail.id) {
          s.activeComponent = {
            ...s.activeComponent,
            config: {
              ...s.activeComponent.config,
              debugProps: { ...(detail.config.debugProps ?? {}) },
            },
          }
          rerender()
        }
      } catch (err) {
        console.warn('[luban] 同步组件调试 Props 失败:', err)
      }
    }
    if (!isPreviewSessionLive(sessionGen)) return
    const liveDoc = s.resourceKind === 'page' ? s.activePage : s.activeComponent
    if (!liveDoc) return
    if (s.workspaceMode !== 'preview') return
    commitPreviewRuntime(
      clonePageData(liveDoc.data ?? { fields: [] }),
      cloneComponentRenderMap(s.componentMap),
    )
    await hydratePreviewControllerBindings()
  }

  async function runLifecycleHook(key: LifecycleHookKey) {
    const raw = s.lifecycleConfig[key]
    if (!raw?.trim()) return
    await runPreviewBindings(raw, {
      dollarProps: editorDollarProps,
      logLocation: formatPreviewLogLocation({ timing: `生命周期 ${key}` }),
    })
  }

  async function runNestedComponentLifecycle(
    phase: 'mount' | 'unmount',
    payload: PreviewInteractPayload,
  ) {
    if (!activeDoc) return
    if (phase === 'mount' && s.workspaceMode !== 'preview') return
    const sessionGen = previewSessionGen.current
    const componentId = payload.componentEmit?.componentId?.trim() || ''
    if (!componentId) return
    const lifecycle = canvasComponentMap[componentId]?.lifecycle
    if (!lifecycle) return
    const keys = phase === 'unmount' ? LIFECYCLE_UNMOUNT_KEYS : LIFECYCLE_MOUNT_KEYS
    for (const key of keys) {
      if (
        phase === 'mount' &&
        (!isPreviewSessionLive(sessionGen) || s.previewLifecycleGate <= 0)
      ) {
        return
      }
      const raw = lifecycle[key]
      if (!raw?.trim()) continue
      if (phase === 'unmount' && s.workspaceMode !== 'preview') {
        await runPreviewBindings(raw, {
          scope: payload.scope,
          dollarProps: payload.dollarProps,
          dataOwnerComponentId: componentId,
          updatePropsHostAttrs: payload.componentEmit?.hostAttrs,
          updatePropsHostDataOwnerId: resolveUpdatePropsHostDataOwnerId(
            payload.componentEmit,
          ),
          logLocation: formatPreviewLogLocation({
            dataOwnerComponentId: componentId,
            timing: `生命周期 ${key}`,
          }),
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
    if (!lifecycleSessionActive.current) return
    for (const key of LIFECYCLE_UNMOUNT_KEYS) {
      await runLifecycleHook(key)
    }
    lifecycleSessionActive.current = false
  }

  async function setupLifecycleSession() {
    if (s.workspaceMode !== 'preview' || !activeDoc) return
    if (lifecycleSessionActive.current) return
    lifecycleSessionActive.current = true
    for (const key of LIFECYCLE_MOUNT_KEYS) {
      await runLifecycleHook(key)
    }
  }

  async function syncLifecycleSession() {
    if (s.workspaceMode === 'preview' && activeDoc) {
      await setupLifecycleSession()
    }
  }

  async function runLifecycleUpdateSequence() {
    if (!lifecycleSessionActive.current || s.workspaceMode !== 'preview') return
    for (const key of LIFECYCLE_UPDATE_KEYS) {
      await runLifecycleHook(key)
    }
  }

  function scheduleLifecycleUpdate() {
    if (lifecycleUpdateTimer.current != null) return
    lifecycleUpdateTimer.current = setTimeout(() => {
      lifecycleUpdateTimer.current = null
      void runLifecycleUpdateSequence()
    }, 32)
  }

  async function handlePreviewInteract(payload: PreviewInteractPayload) {
    const sessionGen = previewSessionGen.current
    if (payload.eventKey === '__lifecycle') {
      const phase = payload.eventArgs?.phase
      if (phase === 'mount') {
        if (s.workspaceMode !== 'preview' || !activeDoc) return
        if (!isPreviewSessionLive(sessionGen)) return
        if (s.previewLifecycleGate <= 0) return
        await runNestedComponentLifecycle('mount', payload)
      } else if (phase === 'unmount') {
        if (!activeDoc) return
        await runNestedComponentLifecycle('unmount', payload)
      }
      return
    }
    if (s.workspaceMode !== 'preview' || !activeDoc) return
    if (!isPreviewSessionLive(sessionGen)) return
    if (payload.eventKey === '__setData') {
      const prop = payload.eventArgs?.prop
      const value = payload.eventArgs?.value
      if (typeof prop === 'string' && prop.trim()) {
        const ownerId = payload.componentEmit?.componentId?.trim()
        if (ownerId) {
          applyComponentPreviewSetData(ownerId, prop.trim(), value as DataFieldValue)
        } else {
          applyPreviewSetData(prop.trim(), value as DataFieldValue)
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
      for (const [key, nextValue] of Object.entries(args)) {
        if (!(key in packed)) packed[key] = nextValue
      }
      return packed
    }
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
        if (isComponentResource && !raw?.trim()) {
          pushPreviewEmitLog(eventName, packed)
          return
        }
        if (!raw?.trim()) return
        if (isComponentResource) pushPreviewEmitLog(eventName, packed)
        const parent = findOuterWithEvent(layer.outer, eventName)
        const hostDataOwner = layer.outer?.componentId?.trim() || undefined
        void runPreviewBindings(raw, {
          scope: layer.hostScope ?? payload.scope,
          eventArgs: packed,
          dataOwnerComponentId: hostDataOwner,
          logLocation: formatPreviewLogLocation({
            dataOwnerComponentId: hostDataOwner,
            timing: `事件 ${eventName}`,
          }),
          emitWithArgs: parent
            ? createLayerEmitWithArgs(parent)
            : isComponentResource
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
    function captureRootComponentEmit(
      eventName: string,
      args: Record<string, unknown>,
    ) {
      const events = s.activeComponent?.config.events ?? []
      pushPreviewEmitLog(
        eventName,
        packEmitArgs(
          { componentId: s.activeComponentId || '', events, hostAttrs: {} },
          eventName,
          args,
        ),
      )
    }
    const hostEmit = payload.componentEmit
    const emitWithArgs = hostEmit
      ? createLayerEmitWithArgs(hostEmit)
      : isComponentResource
        ? captureRootComponentEmit
        : undefined
    const emitFn = hostEmit
      ? createComponentEmit(hostEmit.events, (eventName, args) => {
          createLayerEmitWithArgs(hostEmit)(eventName, args)
        })
      : createPreviewDebugEmit()
    await runPreviewBindings(payload.raw, {
      scope: payload.scope,
      eventArgs: payload.eventArgs,
      dollarProps: payload.dollarProps,
      emitFn,
      emitWithArgs,
      dataOwnerComponentId: payload.componentEmit?.componentId?.trim() || undefined,
      updatePropsHostAttrs: payload.componentEmit?.hostAttrs,
      updatePropsHostDataOwnerId: resolveUpdatePropsHostDataOwnerId(
        payload.componentEmit,
      ),
      logLocation: formatPreviewLogLocation({
        dataOwnerComponentId: payload.componentEmit?.componentId?.trim() || undefined,
        eventKey: payload.eventKey,
      }),
    })
  }

  async function handleDataUpdate(data: PageData) {
    if (!projectStore.path || !activeDoc) return
    const persistableData = (): PageData => {
      const doc = s.resourceKind === 'component' ? s.activeComponent : s.activePage
      return {
        fields: (doc?.data.fields ?? []).filter((item) => {
          const name = item.name.trim()
          return Boolean(name) && name !== '$props'
        }),
      }
    }
    if (isComponentResource && s.activeComponent) {
      s.activeComponent = { ...s.activeComponent, data }
      rerender()
      if (dataSaveTimer.current) clearTimeout(dataSaveTimer.current)
      dataSaveTimer.current = setTimeout(async () => {
        if (!projectStore.path || !s.activeComponent) return
        try {
          await saveComponentData({
            projectPath: projectStore.path,
            componentId: s.activeComponent.id,
            data: persistableData(),
          })
          await refreshComponentMap()
        } catch (err) {
          ElMessage.error(err instanceof Error ? err.message : '保存数据池失败')
        }
      }, 400)
      return
    }
    if (!s.activePage) return
    s.activePage = { ...s.activePage, data }
    rerender()
    if (dataSaveTimer.current) clearTimeout(dataSaveTimer.current)
    dataSaveTimer.current = setTimeout(async () => {
      if (!projectStore.path || !s.activePage) return
      try {
        await savePageData({
          projectPath: projectStore.path,
          pageId: s.activePage.id,
          data: persistableData(),
        })
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存数据池失败')
      }
    }, 400)
  }

  async function handleComponentConfigUpdate(config: ComponentConfig) {
    if (!projectStore.path || !s.activeComponent) return
    const nextConfig: ComponentConfig = {
      ...config,
      debugProps: {
        ...(s.activeComponent.config.debugProps ?? {}),
        ...(config.debugProps ?? {}),
        ...s.previewPropOverrides,
      },
    }
    s.activeComponent = { ...s.activeComponent, config: nextConfig }
    rerender()
    try {
      s.activeComponent = await saveComponentConfig({
        projectPath: projectStore.path,
        componentId: s.activeComponent.id,
        config: nextConfig,
      })
      s.previewPropOverrides = restoreComponentDebugProps()
      rerender()
      await refreshComponentMap()
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存组件配置失败')
    }
  }

  async function handleIconLibraryUpdate(library: IconLibrary) {
    if (!projectStore.path) return
    patch('iconLibrary', library)
    if (iconSaveTimer.current) clearTimeout(iconSaveTimer.current)
    iconSaveTimer.current = setTimeout(async () => {
      if (!projectStore.path) return
      try {
        patch(
          'iconLibrary',
          await saveIconLibraryApi({
            projectPath: projectStore.path,
            icons: s.iconLibrary.icons,
          }),
        )
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存图标库失败')
      }
    }, 400)
  }

  async function handleColorPaletteUpdate(library: ColorPalette) {
    if (!projectStore.path) return
    s.colorPalette = library
    setColorPaletteState(library)
    rerender()
    if (paletteSaveTimer.current) clearTimeout(paletteSaveTimer.current)
    paletteSaveTimer.current = setTimeout(async () => {
      if (!projectStore.path) return
      try {
        const next = await saveColorPaletteApi({
          projectPath: projectStore.path,
          colors: s.colorPalette.colors,
        })
        s.colorPalette = next
        setColorPaletteState(next)
        rerender()
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存调色板失败')
      }
    }, 400)
  }

  async function handleDataTypeLibraryUpdate(library: DataTypeLibrary) {
    if (!projectStore.path) return
    patch('dataTypeLibrary', library)
    if (dataTypeSaveTimer.current) clearTimeout(dataTypeSaveTimer.current)
    dataTypeSaveTimer.current = setTimeout(async () => {
      if (!projectStore.path) return
      try {
        patch(
          'dataTypeLibrary',
          await saveDataTypeLibraryApi({
            projectPath: projectStore.path,
            groups: s.dataTypeLibrary.groups,
          }),
        )
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存数据类型失败')
      }
    }, 400)
  }

  async function handleMysqlLibraryUpdate(library: MysqlLibrary) {
    if (!projectStore.path) return
    patch('mysqlLibrary', library)
    if (mysqlSaveTimer.current) clearTimeout(mysqlSaveTimer.current)
    mysqlSaveTimer.current = setTimeout(async () => {
      if (!projectStore.path) return
      try {
        patch(
          'mysqlLibrary',
          await saveMysqlLibraryApi({
            projectPath: projectStore.path,
            databases: s.mysqlLibrary.databases,
          }),
        )
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存 MySQL 配置失败')
      }
    }, 400)
  }

  async function handleOssLibraryUpdate(library: OssLibrary) {
    if (!projectStore.path) return
    patch('ossLibrary', library)
    if (ossSaveTimer.current) clearTimeout(ossSaveTimer.current)
    ossSaveTimer.current = setTimeout(async () => {
      if (!projectStore.path) return
      try {
        patch(
          'ossLibrary',
          await saveOssLibraryApi({
            projectPath: projectStore.path,
            connections: s.ossLibrary.connections,
          }),
        )
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存对象存储配置失败')
      }
    }, 400)
  }

  function persistBackendServices() {
    if (!projectStore.path) return
    if (backendServiceSaveTimer.current) clearTimeout(backendServiceSaveTimer.current)
    backendServiceSaveTimer.current = setTimeout(async () => {
      if (!projectStore.path) return
      try {
        patch(
          'backendServiceLibrary',
          await saveBackendServiceLibraryApi({
            projectPath: projectStore.path,
            services: s.backendServiceLibrary.services,
          }),
        )
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存服务配置失败')
      }
    }, 400)
  }

  function handleBackendServiceUpdate(service: BackendService) {
    const nameTaken = s.backendServiceLibrary.services.some(
      (item) => item.id !== service.id && item.name === service.name,
    )
    if (nameTaken) {
      ElMessage.error(`模块「${service.name}」已存在`)
      return
    }
    s.backendServiceLibrary = {
      services: s.backendServiceLibrary.services.map((item) =>
        item.id === service.id ? service : item,
      ),
    }
    rerender()
    persistBackendServices()
  }

  function openBackendServiceConfig(service: BackendService) {
    s.activeServiceId = service.id
    s.serviceDialogVisible = true
    rerender()
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
      s.backendServiceLibrary.services.some(
        (item) => item.id !== service.id && item.name === name,
      )
    ) {
      ElMessage.error(`模块「${name}」已存在`)
      return
    }
    handleBackendServiceUpdate({ ...service, name })
    ElMessage.success('已重命名')
  }

  function handleServiceMenuCommand(command: ServiceMenuCommand, service: BackendService) {
    if (command === 'rename') {
      void renameBackendService(service)
      return
    }
    if (command === 'config') {
      openBackendServiceConfig(service)
      return
    }
    if (command === 'delete') void removeBackendService(service)
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
    if (s.backendServiceLibrary.services.some((svc) => svc.id === id)) {
      ElMessage.error(`模块「${id}」已存在`)
      return
    }
    const next = createEmptyBackendService(id)
    s.backendServiceLibrary = {
      services: [...s.backendServiceLibrary.services, next],
    }
    s.activeServiceId = next.id
    s.serviceDialogVisible = true
    rerender()
    persistBackendServices()
  }

  async function removeBackendService(service: BackendService) {
    try {
      await ElMessageBox.confirm(`确定删除模块「${service.name}」吗？`, '删除模块', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
    const editingDeleted =
      s.serviceDialogVisible && s.activeServiceId === service.id
    s.backendServiceLibrary = {
      services: s.backendServiceLibrary.services.filter((svc) => svc.id !== service.id),
    }
    if (s.activeServiceId === service.id) {
      s.activeServiceId = s.backendServiceLibrary.services[0]?.id ?? ''
    }
    if (editingDeleted) s.serviceDialogVisible = false
    rerender()
    persistBackendServices()
  }

  function openAddMethod() {
    s.editingMethod = createEmptyMethod()
    s.methodDialogVisible = true
    rerender()
  }

  function openEditMethod(method: PageMethod) {
    s.editingMethod = { ...method, params: method.params.map((p) => ({ ...p })) }
    s.methodDialogVisible = true
    rerender()
  }

  async function handleSaveMethod(method: PageMethod, previousName?: string) {
    if (!projectStore.path || !activeDoc) return
    try {
      const previous =
        previousName && previousName !== method.name ? previousName : undefined
      if (isComponentResource && s.activeComponent) {
        await saveComponentMethod({
          projectPath: projectStore.path,
          componentId: s.activeComponent.id,
          method,
          previousName: previous,
        })
      } else if (s.activePage) {
        await savePageMethod({
          projectPath: projectStore.path,
          pageId: s.activePage.id,
          method,
          previousName: previous,
        })
      }
      ElMessage.success('方法已保存')
      await loadPageMethods()
      if (isComponentResource && s.activeComponent) {
        s.componentMethodsMap = {
          ...s.componentMethodsMap,
          [s.activeComponent.id]: [...s.pageMethods],
        }
        rerender()
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存方法失败')
    }
  }

  async function handleRemoveMethod(method: PageMethod) {
    if (!projectStore.path || !activeDoc || method.builtin) return
    try {
      await ElMessageBox.confirm(
        `确定删除方法「${method.name}」？对应 .ts 文件将一并删除。`,
        '删除方法',
        { type: 'warning' },
      )
      if (isComponentResource && s.activeComponent) {
        await deleteComponentMethod({
          projectPath: projectStore.path,
          componentId: s.activeComponent.id,
          name: method.name,
        })
      } else if (s.activePage) {
        await deletePageMethod({
          projectPath: projectStore.path,
          pageId: s.activePage.id,
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
    if (!activeDoc) return
    s.addIntoSlotDebug = Boolean(options?.intoSlotDebug)
    s.addDialogTab = options?.tab ?? 'widget'
    s.addDialogVisible = true
    rerender()
  }

  function openAddWidgetDialog() {
    openAddDialog({ intoSlotDebug: false, tab: 'widget' })
  }

  function openAddDebugDialog() {
    if (!showAddDebugButton) return
    openAddDialog({ intoSlotDebug: true, tab: 'widget' })
  }

  const addableComponents =
    !isComponentResource || !s.activeComponentId
      ? s.components
      : s.components.filter((item) => item.id !== s.activeComponentId)

  async function handleAddComponentInstance(component: ComponentSummary) {
    if (!activeDoc || !projectStore.path) return
    if (isComponentResource && component.id === s.activeComponentId) {
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
        /* defaults */
      }
      const intoSlotDebug = s.addIntoSlotDebug
      const outlet = intoSlotDebug ? null : parseSlotOutletNodeId(s.selectedNodeId)
      const appendTarget = outlet?.hostId ?? s.selectedNodeId
      const { xml, newNodeId } = appendComponent(activeDoc.xml, appendTarget, {
        componentId: component.id,
        name,
        width,
        height,
        allowRootSiblings: isComponentResource && !outlet && !intoSlotDebug,
        slot: outlet?.slotName,
        intoSlotDebug,
      })
      s.selectedNodeId = newNodeId
      s.addDialogVisible = false
      s.addIntoSlotDebug = false
      rerender()
      await handleXmlUpdate(xml)
      ElMessage.success(intoSlotDebug ? `已添加调试组件 ${name}` : `已添加组件 ${name}`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '添加组件失败')
    }
  }

  async function handleOpenRepeatConfig(nodeId: string) {
    if (!isEditMode || !nodeId) return
    s.selectedNodeId = nodeId
    s.propsTab = 'dynamic'
    rerender()
    await nextTick()
    patch('openRepeatRequest', s.openRepeatRequest + 1)
  }

  function handleOpenEventConfig(nodeId: string) {
    if (!isEditMode || !nodeId) return
    s.selectedNodeId = nodeId
    s.propsTab = 'event'
    rerender()
  }

  async function handleAddWidget(tag: WidgetTag) {
    if (!activeDoc) return
    try {
      const intoSlotDebug = s.addIntoSlotDebug
      const outlet = intoSlotDebug ? null : parseSlotOutletNodeId(s.selectedNodeId)
      const appendTarget = outlet?.hostId ?? s.selectedNodeId
      const { xml, newNodeId } = appendWidget(activeDoc.xml, appendTarget, tag, {
        allowRootSiblings: s.resourceKind === 'component' && !outlet && !intoSlotDebug,
        slot: outlet?.slotName,
        intoSlotDebug,
      })
      s.addDialogVisible = false
      s.addIntoSlotDebug = false
      s.selectedNodeId = newNodeId
      rerender()
      await handleXmlUpdate(xml)
      ElMessage.success(intoSlotDebug ? `已添加调试 ${tag}` : `已添加 ${tag}`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '添加控件失败')
    }
  }

  async function handleAddMultiWindow(parentId: string) {
    if (!activeDoc || !parentId) return
    try {
      const { xml, newNodeId } = appendWidget(activeDoc.xml, parentId, 'LinearLayout')
      s.selectedNodeId = newNodeId
      s.propsTab = 'style'
      rerender()
      await handleXmlUpdate(xml)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '新建窗口失败')
    }
  }

  async function handleDeleteWidget() {
    if (
      !activeDoc ||
      !isEditMode ||
      isSlotOutletNodeId(s.selectedNodeId) ||
      !canDeleteNode(s.selectedNodeId)
    ) {
      return
    }
    const node = s.selectedNodeId
    try {
      await ElMessageBox.confirm('删除后无法恢复，确定要删除该控件吗？', '删除控件', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
    try {
      const { xml, parentId } = removeWidget(activeDoc.xml, node)
      s.selectedNodeId = parentId
      rerender()
      await handleXmlUpdate(xml)
      ElMessage.success('已删除控件')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '删除控件失败')
    }
  }

  function handleCopyWidget(nodeId = s.selectedNodeId) {
    if (!activeDoc || !isEditMode || !nodeId) return
    if (isSlotOutletNodeId(nodeId) || !canDeleteNode(nodeId)) {
      ElMessage.warning('该节点不能复制')
      return
    }
    try {
      const frag = copyWidgetFragment(activeDoc.xml, nodeId)
      setWidgetClipboard(frag)
      patch('widgetCtxClipboardTick', s.widgetCtxClipboardTick + 1)
      ElMessage.success('已复制')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '复制失败')
    }
  }

  async function handleMoveWidgetSibling(direction: 'up' | 'down') {
    if (!activeDoc || !isEditMode) return
    const nodeId = s.selectedNodeId
    if (!nodeId || isSlotOutletNodeId(nodeId)) return
    try {
      const { xml, newNodeId } = moveWidgetSibling(activeDoc.xml, nodeId, direction)
      s.selectedNodeId = newNodeId
      rerender()
      await handleXmlUpdate(xml)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '移动失败')
    }
  }

  async function handlePasteWidget(mode: 'sibling' | 'child') {
    if (!activeDoc || !isEditMode) return
    const nodeId = s.selectedNodeId
    const frag = getWidgetClipboard()
    if (!nodeId || !frag) {
      ElMessage.warning('请先复制一个控件')
      return
    }
    try {
      const { xml, newNodeId } = pasteWidget(activeDoc.xml, nodeId, frag, mode)
      s.selectedNodeId = newNodeId
      rerender()
      await handleXmlUpdate(xml)
      ElMessage.success(mode === 'child' ? '已粘贴为子级' : '已粘贴为同级')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '粘贴失败')
    }
  }

  function handleMentionWidgetToAi(nodeId: string) {
    if (!workspaceSettings.aiAssistantEnabled) {
      ElMessage.warning('请先在设置中开启 AI 助手')
      return
    }
    if (!activeDoc) return
    const resourceScope = isPageResource ? 'page' : 'component'
    const resourceId = isPageResource ? s.activePageId : s.activeComponentId
    if (!resourceId || !nodeId.trim()) {
      ElMessage.warning('无法识别该节点')
      return
    }
    try {
      const root = parsePageXml(activeDoc.xml)
      if (!findXmlNodeById(root, nodeId)) {
        ElMessage.warning('无法识别该节点')
        return
      }
    } catch {
      ElMessage.warning('无法识别该节点')
      return
    }
    aiAssistant.addWidgetMention({ nodeId, resourceScope, resourceId })
  }

  async function handleWidgetCtxCommand(command: WidgetCtxCommand) {
    const nodeId = s.widgetCtxMenu.nodeId
    closeWidgetCtxMenu()
    if (!nodeId) return
    if (command === 'mentionAi') {
      handleMentionWidgetToAi(nodeId)
      return
    }
    s.selectedNodeId = nodeId
    rerender()
    if (command === 'copy') {
      handleCopyWidget(nodeId)
      return
    }
    if (command === 'delete') {
      await handleDeleteWidget()
      return
    }
    if (command === 'moveUp') {
      await handleMoveWidgetSibling('up')
      return
    }
    if (command === 'moveDown') {
      await handleMoveWidgetSibling('down')
      return
    }
    if (command === 'pasteSibling') {
      await handlePasteWidget('sibling')
      return
    }
    if (command === 'pasteChild') await handlePasteWidget('child')
  }

  async function handleMoveWidget(payload: {
    sourceId: string
    targetId: string
    position: MovePosition
    slot?: string
  }) {
    if (!activeDoc || !isEditMode) return
    try {
      const { xml, newNodeId } = moveWidget(
        activeDoc.xml,
        payload.sourceId,
        payload.targetId,
        payload.position,
        payload.slot ? { slot: payload.slot } : undefined,
      )
      s.selectedNodeId = newNodeId
      rerender()
      await handleXmlUpdate(xml)
      ElMessage.success('已调整控件结构')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '移动控件失败')
    }
  }

  function collectWorkspaceUiSnapshot(): WorkspaceUiSnapshot {
    const serviceId = s.activeServiceId
    const st = serviceId ? s.backendByService[serviceId] : null
    const layer = (st?.layer || s.backendServiceLayer) as string
    let processorId = ''
    let methodId = ''
    if (layer === 'service') {
      processorId = st?.processors?.business?.processorId ?? ''
      methodId = st?.processors?.business?.methodId ?? ''
    } else if (layer === 'data') {
      processorId = st?.processors?.data?.processorId ?? ''
      methodId = st?.processors?.data?.methodId ?? ''
    }
    return {
      topNav: s.topNav,
      workspaceMode: s.workspaceMode,
      resourceKind: s.resourceKind,
      activePageId: s.activePageId,
      activeComponentId: s.activeComponentId,
      selectedNodeId: s.selectedNodeId,
      propsTab: s.propsTab,
      canvasScene: s.canvasScene,
      activeServiceId: serviceId,
      backendLayer: s.backendServiceLayer,
      backendControllerId: st?.controllerId ?? '',
      backendProcessorId: processorId,
      backendMethodId: methodId,
    }
  }

  function publishWorkspaceUiSnapshot(requestId?: string) {
    const snapshot = collectWorkspaceUiSnapshot()
    aiAssistant.setUiSnapshot(snapshot)
    resolveWorkspaceUiSnapshotWaiters(snapshot, requestId)
    if (projectStore.path) {
      publishAiAssistantEvent({
        type: 'workspace-ui-snapshot',
        projectPath: projectStore.path,
        requestId,
        snapshot,
      })
    }
  }

  async function applyAiNavigateCommand(
    command: WorkspaceNavigateCommand,
    requestId?: string,
  ) {
    try {
      switch (command.op) {
        case 'switchNav': {
          if (command.topNav === 'frontend') selectFrontendNav()
          else if (command.topNav === 'backend') selectBackendNav()
          else selectProjectNav(command.topNav)
          break
        }
        case 'switchMode': {
          setWorkspaceMode(command.mode)
          break
        }
        case 'openResource': {
          if (command.mode) setWorkspaceMode(command.mode)
          else selectFrontendNav()
          if (command.scope === 'page') await openPage(command.id)
          else await openComponent(command.id)
          break
        }
        case 'selectWidget': {
          selectFrontendNav()
          if (s.workspaceMode === 'preview') setWorkspaceMode('edit')
          if (command.scope === 'page') {
            if (!isPageResource || s.activePageId !== command.resourceId) {
              await openPage(command.resourceId)
            }
          } else if (
            !isComponentResource ||
            s.activeComponentId !== command.resourceId
          ) {
            await openComponent(command.resourceId)
          }
          patch('selectedNodeId', command.nodeId)
          break
        }
        case 'focusPropsTab': {
          selectFrontendNav()
          if (s.workspaceMode !== 'edit') setWorkspaceMode('edit')
          patch('propsTab', command.tab)
          break
        }
        case 'openBackend': {
          selectBackendNav()
          s.activeServiceId = command.serviceId
          const layer = command.layer ?? 'controller'
          onBackendLayerUpdate(layer)
          if (command.controllerId) onBackendControllerId(command.controllerId)
          if (command.processorId || command.methodId) {
            if (layer === 'service') {
              onBackendBusinessSelection({
                processorId: command.processorId ?? '',
                methodId: command.methodId ?? '',
                flowEditing: null,
              })
            } else if (layer === 'data') {
              onBackendDataSelection({
                processorId: command.processorId ?? '',
                methodId: command.methodId ?? '',
                flowEditing: null,
              })
            }
          }
          rerender()
          break
        }
        case 'setCanvasScene': {
          patch('canvasScene', command.scene)
          break
        }
        case 'reveal': {
          const nav = command.topNav ?? 'frontend'
          if (nav === 'frontend') selectFrontendNav()
          else if (nav === 'backend') selectBackendNav()
          else selectProjectNav(nav)
          if (command.canvasScene) patch('canvasScene', command.canvasScene)
          if (command.mode) setWorkspaceMode(command.mode)
          if (command.scope && command.resourceId) {
            if (command.scope === 'page') await openPage(command.resourceId)
            else await openComponent(command.resourceId)
          }
          if (command.nodeId) {
            if (s.workspaceMode === 'preview') setWorkspaceMode('edit')
            patch('selectedNodeId', command.nodeId)
          }
          if (command.propsTab) {
            if (s.workspaceMode !== 'edit') setWorkspaceMode('edit')
            patch('propsTab', command.propsTab)
          }
          break
        }
        default: {
          const _exhaustive: never = command
          throw new Error(`未知导航命令：${JSON.stringify(_exhaustive)}`)
        }
      }
      await nextTick()
      publishWorkspaceUiSnapshot(requestId)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '导航失败')
      publishWorkspaceUiSnapshot(requestId)
    }
  }

  function stableJsonPreview(value: unknown): string {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  function collectCanvasPreviewSnapshot(
    includeLayout = true,
    fieldFilter?: string[],
  ): CanvasPreviewSnapshot {
    const kind: 'page' | 'component' = isComponentResource ? 'component' : 'page'
    const id = isComponentResource ? s.activeComponentId : s.activePageId
    const data = s.previewRuntimeData ?? activeDoc?.data ?? ({ fields: [] } as PageData)
    let fields = pageDataFieldsSnapshot(data)
    if (fieldFilter?.length) {
      const allow = new Set(fieldFilter.map((f) => f.trim()).filter(Boolean))
      fields = Object.fromEntries(Object.entries(fields).filter(([k]) => allow.has(k)))
    }
    const snapshot: CanvasPreviewSnapshot = {
      kind,
      id: id || '',
      fields,
      toast: s.previewToast,
      logs: s.previewRuntimeLogs.map((item) => ({
        level: item.level,
        message: item.message,
        location: item.location,
      })),
      workspaceMode: s.workspaceMode,
    }
    if (includeLayout && activeDoc?.xml) {
      const layout = buildLayoutFromXmlAndData(activeDoc.xml, data)
      snapshot.layout = layout
      const measured =
        s.workspaceMode === 'preview'
          ? measurePhoneViewportOverflow(document, { rootOverflowAttr: layout.overflow })
          : null
      snapshot.viewportOverflow = measured
      snapshot.layoutRisks = mergeOverflowIntoLayoutRisks(
        collectLayoutRisks(layout),
        layout,
        measured,
      )
    }
    return snapshot
  }

  function publishCanvasPreviewResult(
    requestId: string,
    payload: {
      ok: boolean
      snapshot?: CanvasPreviewSnapshot
      error?: string
      meta?: Record<string, unknown>
    },
  ) {
    resolveCanvasPreviewResultWaiters(payload, requestId)
    if (projectStore.path) {
      publishAiAssistantEvent({
        type: 'canvas-preview-result',
        projectPath: projectStore.path,
        requestId,
        ok: payload.ok,
        snapshot: payload.snapshot,
        error: payload.error,
        meta: payload.meta,
      })
    }
  }

  async function waitPreviewFieldMatch(options: {
    field: string
    equals?: unknown
    contains?: string
    timeoutMs: number
  }): Promise<void> {
    const deadline = Date.now() + options.timeoutMs
    const field = options.field.trim()
    while (Date.now() <= deadline) {
      const snap = collectCanvasPreviewSnapshot(false)
      const actual = snap.fields[field]
      if (options.equals !== undefined) {
        if (stableJsonPreview(actual) === stableJsonPreview(options.equals)) return
      } else if (options.contains != null && options.contains !== '') {
        const text = stableJsonPreview(actual) ?? ''
        if (text.includes(options.contains)) return
      } else {
        return
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    const snap = collectCanvasPreviewSnapshot(false)
    throw new Error(
      `等待字段 ${field} 超时。实际：${stableJsonPreview(snap.fields[field])}`,
    )
  }

  async function applyAiCanvasPreviewCommand(
    command: CanvasPreviewCommand,
    requestId: string,
  ) {
    if (handledCanvasRequestIds.current.has(requestId)) return
    handledCanvasRequestIds.current.add(requestId)
    if (handledCanvasRequestIds.current.size > 80) {
      const first = handledCanvasRequestIds.current.values().next().value
      if (first) handledCanvasRequestIds.current.delete(first)
    }
    try {
      selectFrontendNav()
      let meta: Record<string, unknown> | undefined
      switch (command.op) {
        case 'open': {
          setWorkspaceMode('preview')
          await nextTick()
          if (command.scope === 'page') {
            await openPage(
              command.id,
              command.query !== undefined ? { params: command.query } : undefined,
            )
          } else {
            await openComponent(command.id)
          }
          await nextTick()
          if (s.workspaceMode !== 'preview') throw new Error('未能进入预览模式')
          if (!s.previewRuntimeData) {
            await preparePreviewRuntime()
            s.previewLifecycleGate += 1
            rerender()
            await nextTick()
            await syncLifecycleSession()
            await hydratePreviewControllerBindings()
          }
          break
        }
        case 'click': {
          if (s.workspaceMode !== 'preview') {
            throw new Error('请先 open 进入预览模式再 click')
          }
          if (!activeDoc) throw new Error('当前无打开的页面/组件')
          const nodeId = command.nodeId.trim()
          const eventKey = (command.eventKey?.trim() || 'onClick') as string
          if (
            !(INTERACTION_EVENT_KEYS as readonly string[]).includes(eventKey) &&
            !eventKey.startsWith('on')
          ) {
            throw new Error(`不支持的事件：${eventKey}`)
          }
          const detail = getWidgetDetailForAi(activeDoc.xml, nodeId)
          const raw =
            detail.events[eventKey] != null
              ? serializeEventBindings(detail.events[eventKey]!)
              : detail.attrs[eventKey]
          if (!raw?.trim()) {
            const invalid = detail.invalidEventAttrs?.click
            if (eventKey === 'onClick' && invalid) {
              throw new Error(`节点 ${nodeId} 使用了无效属性 click，请改为 onClick`)
            }
            throw new Error(`节点 ${nodeId} 未绑定 ${eventKey}`)
          }
          const payload: PreviewInteractPayload = {
            eventKey,
            raw,
            eventArgs: command.eventArgs,
          }
          if (command.scope && typeof command.scope.index === 'number') {
            payload.scope = { item: command.scope.item, index: command.scope.index }
          }
          await handlePreviewInteract(payload)
          await nextTick()
          meta = {
            eventKey,
            nodeId,
            bindingCount: detail.events[eventKey]?.length ?? 1,
          }
          break
        }
        case 'setData': {
          if (s.workspaceMode !== 'preview') {
            throw new Error('请先 open 进入预览模式再 setData')
          }
          const field = command.field.trim()
          if (!field) throw new Error('缺少 field')
          applyPreviewSetData(field, command.value as DataFieldValue)
          await nextTick()
          break
        }
        case 'runMethod': {
          if (s.workspaceMode !== 'preview') {
            throw new Error('请先 open 进入预览模式再 runMethod')
          }
          const name = command.name.trim()
          if (!name) throw new Error('缺少方法名')
          const methods = s.pageMethods.filter((m) => !m.builtin)
          const method = methods.find((m) => m.name === name)
          if (!method && !isComponentResource) {
            throw new Error(`未找到自定义方法：${name}`)
          }
          if (isComponentResource) {
            const local = s.pageMethods.find((m) => m.name === name && !m.builtin)
            if (!local) throw new Error(`未找到自定义方法：${name}`)
          }
          const args: Record<string, string> = {}
          for (const [k, v] of Object.entries(command.args ?? {})) {
            args[k] = v == null ? '' : String(v)
          }
          const raw = serializeEventBindings([
            {
              id: `bind_ai_cv_${Date.now().toString(36)}`,
              method: name,
              args,
            },
          ])
          await runPreviewBindings(raw, { logLocation: `AI 画布 · 方法 ${name}` })
          await nextTick()
          break
        }
        case 'getState': {
          if (s.workspaceMode !== 'preview' && !s.previewRuntimeData) {
            throw new Error('当前不在预览态且无运行时数据，请先 canvas open')
          }
          break
        }
        case 'wait': {
          if (command.ms != null && Number(command.ms) > 0) {
            const ms = Math.min(Math.max(0, Number(command.ms) || 0), 8000)
            await new Promise((r) => setTimeout(r, ms))
          }
          if (command.field?.trim()) {
            await waitPreviewFieldMatch({
              field: command.field,
              equals: command.equals,
              contains: command.contains,
              timeoutMs: Math.min(Math.max(0, Number(command.timeoutMs) || 8000), 8000),
            })
          }
          break
        }
        default: {
          const _exhaustive: never = command
          throw new Error(`未知画布命令：${JSON.stringify(_exhaustive)}`)
        }
      }
      const includeLayout =
        command.op === 'getState'
          ? command.includeLayout !== false
          : command.op === 'open' ||
            command.op === 'click' ||
            command.op === 'setData' ||
            command.op === 'runMethod' ||
            command.op === 'wait'
      const fields = command.op === 'getState' ? command.fields : undefined
      if (includeLayout) {
        await nextTick()
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
      }
      const snapshot = collectCanvasPreviewSnapshot(includeLayout, fields)
      publishCanvasPreviewResult(requestId, { ok: true, snapshot, meta })
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err)
      let snapshot: CanvasPreviewSnapshot | undefined
      try {
        snapshot = collectCanvasPreviewSnapshot(true)
      } catch {
        snapshot = undefined
      }
      publishCanvasPreviewResult(requestId, {
        ok: false,
        error: messageText,
        snapshot,
      })
    }
  }

  async function reloadActiveAfterAiEdit() {
    if (!projectStore.path) return
    try {
      const [pageResult, componentResult] = await Promise.all([
        listPages(projectStore.path),
        listComponents(projectStore.path),
      ])
      s.pages = pageResult.pages
      s.components = componentResult.components
      if (s.resourceKind === 'page' && s.activePageId) {
        if (!pageResult.pages.some((p) => p.id === s.activePageId)) {
          s.activePageId = ''
          s.activePage = null
          s.selectedNodeId = ''
          s.pageMethods = []
        } else {
          const detail = await getPage(projectStore.path, s.activePageId)
          const migrated = migrateLegacyMaskToModal(detail.xml)
          s.activePage = migrated.changed ? { ...detail, xml: migrated.xml } : detail
          if (migrated.changed) await handleXmlUpdate(migrated.xml)
          await Promise.all([
            loadPageMethods(s.activePageId),
            loadLifecycle(s.activePageId),
          ])
        }
      } else if (s.resourceKind === 'component' && s.activeComponentId) {
        if (!componentResult.components.some((c) => c.id === s.activeComponentId)) {
          s.activeComponentId = ''
          s.activeComponent = null
          s.selectedNodeId = ''
          s.pageMethods = []
        } else {
          const detail = await getComponent(projectStore.path, s.activeComponentId)
          const migrated = migrateLegacyMaskToModal(detail.xml)
          s.activeComponent = migrated.changed
            ? { ...detail, xml: migrated.xml }
            : detail
          if (migrated.changed) await handleXmlUpdate(migrated.xml)
          await Promise.all([
            loadPageMethods(s.activeComponentId),
            loadLifecycle(s.activeComponentId),
          ])
        }
      }
      rerender()
      await Promise.all([
        refreshComponentMap(),
        loadIconLibrary(),
        loadColorPalette(),
        loadDataTypeLibrary(),
        loadMysqlLibrary(),
        loadOssLibrary(),
        loadBackendServiceLibrary(),
      ])
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '刷新 AI 改动失败')
    }
  }

  function scheduleReloadActiveAfterAiEdit() {
    if (aiReloadTimer.current) clearTimeout(aiReloadTimer.current)
    aiReloadTimer.current = setTimeout(() => {
      aiReloadTimer.current = null
      void reloadActiveAfterAiEdit()
    }, 180)
  }

  useEffect(() => {
    setColorPaletteState(s.colorPalette)
  }, [s.colorPalette])

  useEffect(() => {
    window.addEventListener('mousedown', onGlobalPointerDownForCtx, true)
    window.addEventListener('scroll', closeWidgetCtxMenu, true)
    const unsub = subscribeAiAssistantEvents((event) => {
      if (!projectStore.path || event.projectPath !== projectStore.path) return
      if (event.type === 'resources-changed') {
        scheduleReloadActiveAfterAiEdit()
        return
      }
      if (event.type === 'workspace-navigate') {
        void applyAiNavigateCommand(event.command, event.requestId)
        return
      }
      if (event.type === 'workspace-ui-query') {
        publishWorkspaceUiSnapshot(event.requestId)
        return
      }
      if (event.type === 'canvas-preview-command') {
        void applyAiCanvasPreviewCommand(event.command, event.requestId)
      }
    })
    return () => {
      window.removeEventListener('mousedown', onGlobalPointerDownForCtx, true)
      window.removeEventListener('scroll', closeWidgetCtxMenu, true)
      unsub()
      if (aiReloadTimer.current) {
        clearTimeout(aiReloadTimer.current)
        aiReloadTimer.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectStore.path])

  useEffect(() => {
    if (s.previewInspectMode === 'clean' && !s.refNavRestoring) {
      if (prevInspectMode.current !== 'clean') patch('previewInspectTarget', null)
    }
    prevInspectMode.current = s.previewInspectMode
  }, [s.previewInspectMode, s.refNavRestoring])

  useEffect(() => {
    const scene = projectStore.config?.canvas?.scene
    const next = scene === 'miniprogram' ? 'miniprogram' : 'h5'
    if (s.canvasScene !== next) {
      skipCanvasSceneSave.current = true
      patch('canvasScene', next)
    }
    prevCanvasSceneFromConfig.current = scene
  }, [projectStore.config?.canvas?.scene])

  useEffect(() => {
    if (skipCanvasSceneSave.current) {
      skipCanvasSceneSave.current = false
      return
    }
    const path = projectStore.path?.trim()
    if (!path) return
    if (projectStore.config?.canvas?.scene === s.canvasScene) return
    if (canvasSceneSaveTimer.current) clearTimeout(canvasSceneSaveTimer.current)
    canvasSceneSaveTimer.current = setTimeout(() => {
      canvasSceneSaveTimer.current = null
      void (async () => {
        try {
          const result = await patchProjectConfig({
            projectPath: path,
            canvasScene: s.canvasScene,
          })
          projectStore.setProject(result.path, result.config)
        } catch (err) {
          console.error(err)
          ElMessage.error('保存画布场景失败')
        }
      })()
    }, 200)
    return () => {
      if (canvasSceneSaveTimer.current) clearTimeout(canvasSceneSaveTimer.current)
    }
  }, [s.canvasScene, projectStore.path, projectStore.config?.canvas?.scene, projectStore])

  useEffect(() => {
    const mode = s.workspaceMode
    const prev = prevWorkspaceMode.current
    prevWorkspaceMode.current = mode
    if (prev === mode) return
    void (async () => {
      if (prev === 'preview' && mode !== 'preview') {
        bumpPreviewSession()
        patch('previewLifecycleGate', 0)
        await teardownLifecycleSession()
        clearPreviewRuntime()
        return
      }
      if (mode === 'preview' && prev !== 'preview') {
        bumpPreviewSession()
        const sessionGen = previewSessionGen.current
        await preparePreviewRuntime()
        if (!isPreviewSessionLive(sessionGen)) return
        patch('previewLifecycleGate', s.previewLifecycleGate + 1)
        await nextTick()
        if (!isPreviewSessionLive(sessionGen)) return
        await syncLifecycleSession()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.workspaceMode])

  useEffect(() => {
    if (!isComponentResource || !s.activeComponentId) return
    if (s.activeComponent?.id !== s.activeComponentId) return
    patch('previewPropOverrides', restoreComponentDebugProps())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComponentResource, s.activeComponentId, s.activeComponent?.id])

  const pendingSelect = aiAssistant.pendingSelect
  useEffect(() => {
    if (!pendingSelect) return
    const { scope, resourceId, nodeId } = pendingSelect
    aiAssistant.clearPendingSelect()
    void (async () => {
      try {
        if (scope === 'page') {
          if (!isPageResource || s.activePageId !== resourceId) {
            await openPage(resourceId)
          }
        } else if (!isComponentResource || s.activeComponentId !== resourceId) {
          await openComponent(resourceId)
        }
        patch('selectedNodeId', nodeId)
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '定位节点失败')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelect])

  const pendingNavigate = aiAssistant.pendingNavigate
  useEffect(() => {
    if (!pendingNavigate) return
    const { command, requestId } = pendingNavigate
    aiAssistant.clearPendingNavigate()
    void applyAiNavigateCommand(command, requestId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNavigate])

  const pendingUiQueryId = aiAssistant.pendingUiQueryId
  useEffect(() => {
    if (!pendingUiQueryId) return
    aiAssistant.clearPendingUiQuery()
    publishWorkspaceUiSnapshot(pendingUiQueryId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUiQueryId])

  const pendingCanvasPreview = aiAssistant.pendingCanvasPreview
  useEffect(() => {
    if (!pendingCanvasPreview) return
    const { command, requestId } = pendingCanvasPreview
    aiAssistant.clearPendingCanvasPreview()
    void applyAiCanvasPreviewCommand(command, requestId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCanvasPreview])

  useEffect(() => {
    aiAssistant.setUiSnapshot(collectWorkspaceUiSnapshot())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    s.topNav,
    s.workspaceMode,
    s.resourceKind,
    s.activePageId,
    s.activeComponentId,
    s.selectedNodeId,
    s.propsTab,
    s.canvasScene,
    s.activeServiceId,
    s.backendServiceLayer,
    s.backendByService,
  ])

  useEffect(() => {
    if (s.resourceKind === 'page' && s.activePageId) {
      aiAssistant.setActiveResource({ scope: 'page', id: s.activePageId })
      return
    }
    if (s.resourceKind === 'component' && s.activeComponentId) {
      aiAssistant.setActiveResource({
        scope: 'component',
        id: s.activeComponentId,
      })
      return
    }
    aiAssistant.setActiveResource(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.resourceKind, s.activePageId, s.activeComponentId])

  const resourceEpoch = aiAssistant.resourceEpoch
  const prevResourceEpoch = useRef(resourceEpoch)
  useEffect(() => {
    const prev = prevResourceEpoch.current
    prevResourceEpoch.current = resourceEpoch
    if (!resourceEpoch || resourceEpoch === prev) return
    scheduleReloadActiveAfterAiEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceEpoch])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      s.workspaceUiReady = false
      rerender()
      if (!projectStore.path) return
      const saved = loadWorkspaceUiState(projectStore.path)
      if (saved && !cancelled) applyWorkspaceUiState(saved)
      await loadPages()
      if (cancelled) return
      if (s.activeServiceId) {
        const st = s.backendByService[s.activeServiceId]
        if (st?.layer) s.backendServiceLayer = st.layer
      }
      s.workspaceUiReady = true
      rerender()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectStore.path])

  useEffect(() => {
    if (!s.activeServiceId || !s.workspaceUiReady) return
    const st = s.backendByService[s.activeServiceId]
    if (st?.layer) patch('backendServiceLayer', st.layer)
  }, [s.activeServiceId, s.workspaceUiReady, s.backendByService])

  useEffect(() => {
    if (!s.workspaceUiReady || !projectStore.path) return
    saveWorkspaceUiState(projectStore.path, collectWorkspaceUiState())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    s.workspaceUiReady,
    projectStore.path,
    s.topNav,
    s.resourceKind,
    s.workspaceMode,
    s.activePageId,
    s.activeComponentId,
    s.activeServiceId,
    s.backendServiceLayer,
    s.backendByService,
  ])

  const pageMenuItems = (page: PageSummary): MenuProps['items'] => [
    { key: 'rename', label: '重命名' },
    { key: 'copy', label: '复制' },
    { key: 'setEntry', label: '设为入口', disabled: page.isEntry },
    { type: 'divider' },
    { key: 'delete', label: '删除', danger: true },
  ]

  const componentMenuItems: MenuProps['items'] = [
    { key: 'rename', label: '重命名' },
    { type: 'divider' },
    { key: 'delete', label: '删除', danger: true },
  ]

  const serviceMenuItems: MenuProps['items'] = [
    { key: 'rename', label: '重命名' },
    { key: 'config', label: '配置' },
    { type: 'divider' },
    { key: 'delete', label: '删除', danger: true },
  ]

  return (
    <div className="workspace">
      <nav className="activity-rail" aria-label="项目资源">
        <Tooltip title="前端" placement="right">
          <button
            type="button"
            className={`rail-btn${isFrontendNav ? ' active' : ''}`}
            onClick={selectFrontendNav}
          >
            <DevelopIcon />
          </button>
        </Tooltip>
        <Tooltip title="后端" placement="right">
          <button
            type="button"
            className={`rail-btn${isBackendNav ? ' active' : ''}`}
            onClick={selectBackendNav}
          >
            <BackendIcon />
          </button>
        </Tooltip>
        <div className="rail-divider" />
        {projectNavItems.map((item) => (
          <Tooltip key={item.key} title={item.label} placement="right">
            <button
              type="button"
              className={`rail-btn${s.topNav === item.key ? ' active' : ''}`}
              onClick={() => selectProjectNav(item.key)}
            >
              {item.icon}
            </button>
          </Tooltip>
        ))}
      </nav>

      <aside className="side-panel" style={{ display: isFrontendNav ? undefined : 'none' }}>
        <div className="pages-section">
          <div className="section-header">
            <div className="resource-tabs">
              <button
                type="button"
                className={`resource-tab${isPageResource ? ' active' : ''}`}
                onClick={() => switchResourceKind('page')}
              >
                页面
              </button>
              <button
                type="button"
                className={`resource-tab${isComponentResource ? ' active' : ''}`}
                onClick={() => switchResourceKind('component')}
              >
                组件
              </button>
            </div>
            <Button type="primary" icon={<PlusOutlined />} size="small" onClick={openCreateDialog}>
              新建
            </Button>
          </div>
          <div className="pages-body">
            {isPageResource ? (
              s.loadingPages && !s.pages.length ? (
                <Skeleton active paragraph={{ rows: 4 }} title={false} />
              ) : !s.pages.length ? (
                <Empty description="暂无页面，点击新建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <div className="page-list">
                  {s.pages.map((page) => (
                    <Dropdown
                      key={page.id}
                      trigger={['contextMenu']}
                      className="page-dropdown"
                      menu={{
                        items: pageMenuItems(page),
                        onClick: ({ key }) =>
                          void handlePageMenuCommand(key as PageMenuCommand, page),
                      }}
                    >
                      <button
                        type="button"
                        className={`page-item${page.id === s.activePageId ? ' active' : ''}${page.isEntry ? ' entry' : ''}`}
                        onClick={() => void openPageFromSidebar(page.id)}
                      >
                        <FileOutlined />
                        <div className="page-meta">
                          <div className="page-name">
                            <span>{page.name}</span>
                            {page.isEntry ? <span className="entry-badge">入口</span> : null}
                          </div>
                          <div className="page-id">{page.id}</div>
                        </div>
                      </button>
                    </Dropdown>
                  ))}
                </div>
              )
            ) : s.loadingPages && !s.components.length ? (
              <Skeleton active paragraph={{ rows: 4 }} title={false} />
            ) : !s.components.length ? (
              <Empty description="暂无组件，点击新建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="page-list">
                {s.components.map((item) => (
                  <Dropdown
                    key={item.id}
                    trigger={['contextMenu']}
                    className="page-dropdown"
                    menu={{
                      items: componentMenuItems,
                      onClick: ({ key }) =>
                        void handleComponentMenuCommand(key as ComponentMenuCommand, item),
                    }}
                  >
                    <button
                      type="button"
                      className={`page-item${item.id === s.activeComponentId ? ' active' : ''}`}
                      onClick={() => void openComponentFromSidebar(item.id)}
                    >
                      <AppstoreOutlined />
                      <div className="page-meta">
                        <div className="page-name">{item.name}</div>
                        <div className="page-id">{item.id}</div>
                      </div>
                    </button>
                  </Dropdown>
                ))}
              </div>
            )}
          </div>
        </div>
        {activeDoc && !hideWidgetTree && s.workspaceMode !== 'preview' ? (
          <WidgetTree
            xml={activeDoc.xml}
            selectedId={s.selectedNodeId}
            editable={isEditMode}
            hiddenIds={s.editorHiddenNodeIds}
            includeStatusBar={isPageResource}
            componentMap={s.componentMap}
            onSelect={(id) => patch('selectedNodeId', id)}
            onOpenRepeat={handleOpenRepeatConfig}
            onOpenEvent={handleOpenEventConfig}
            onMove={handleMoveWidget}
            onToggleHidden={toggleEditorHidden}
            onContextMenu={openWidgetCtxMenu}
          />
        ) : activeDoc && s.workspaceMode === 'preview' ? (
          <PreviewRuntimeLog
            logs={s.previewRuntimeLogs}
            onClear={() => patch('previewRuntimeLogs', [])}
          />
        ) : null}
      </aside>

      <aside className="side-panel" style={{ display: isBackendNav ? undefined : 'none' }}>
        <div className="pages-section backend-services-section">
          <div className="section-header">
            <span className="section-title">模块列表</span>
            <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => void addBackendService()}>
              新建
            </Button>
          </div>
          <div className="pages-body">
            {!s.backendServiceLibrary.services.length ? (
              <Empty description="暂无服务，点击新建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="page-list">
                {s.backendServiceLibrary.services.map((service) => (
                  <Dropdown
                    key={service.id}
                    trigger={['contextMenu']}
                    className="page-dropdown"
                    menu={{
                      items: serviceMenuItems,
                      onClick: ({ key }) =>
                        handleServiceMenuCommand(key as ServiceMenuCommand, service),
                    }}
                  >
                    <button
                      type="button"
                      className={`page-item${service.id === s.activeServiceId ? ' active' : ''}`}
                      onClick={() => patch('activeServiceId', service.id)}
                      onDoubleClick={() => openBackendServiceConfig(service)}
                    >
                      <BackendIcon />
                      <div className="page-meta">
                        <div className="page-name">{service.name}</div>
                        <div className="page-id">{service.id}</div>
                      </div>
                    </button>
                  </Dropdown>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="workspace-stage">
        <section className="center-panel">
          <div className="preview-header">
            {isBackendNav ? (
              <>
                <span className="preview-title">
                  {activeBackendService ? backendLayerTitle : '后端'}
                </span>
                <span className="preview-sub">{backendCenterPath}</span>
                {activeBackendService && s.backendServiceLayer === 'controller' ? (
                  <div className="preview-header-actions">
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => backendWorkspaceRef.current?.openCreateController()}
                    >
                      创建控制器
                    </Button>
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => backendWorkspaceRef.current?.addApi()}
                    >
                      创建 API
                    </Button>
                  </div>
                ) : activeBackendService &&
                  (s.backendServiceLayer === 'service' ||
                    s.backendServiceLayer === 'data') ? (
                  <div className="preview-header-actions">
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => backendWorkspaceRef.current?.openCreateProcessor()}
                    >
                      创建处理器
                    </Button>
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => backendWorkspaceRef.current?.addProcessorMethod()}
                    >
                      创建方法
                    </Button>
                  </div>
                ) : null}
              </>
            ) : isIconsMode ? (
              <>
                <span className="preview-title">图标库</span>
                <span className="preview-sub">icons</span>
              </>
            ) : isPaletteMode ? (
              <>
                <span className="preview-title">调色板</span>
                <span className="preview-sub">palette</span>
              </>
            ) : isDataTypesMode ? (
              <>
                <span className="preview-title">数据类型</span>
                <span className="preview-sub">types</span>
              </>
            ) : isMysqlMode ? (
              <>
                <span className="preview-title">MySQL</span>
                <span className="preview-sub">mysql</span>
              </>
            ) : isOssMode ? (
              <>
                <span className="preview-title">对象存储</span>
                <span className="preview-sub">oss</span>
              </>
            ) : activeDoc ? (
              <>
                <span className="preview-title">{frontendModeTitle}</span>
                <span className="preview-sub">
                  {isComponentResource ? 'components' : 'pages'}/{activeDoc.id}
                  {centerDirSegment ? `/${centerDirSegment}` : ''}
                  {centerPathQuery}
                </span>
                {isMethodsMode ? (
                  <Button
                    className="preview-header-action"
                    type="link"
                    icon={<PlusOutlined />}
                    onClick={openAddMethod}
                  >
                    添加方法
                  </Button>
                ) : isDataPoolMode ? (
                  <Button
                    className="preview-header-action"
                    type="link"
                    icon={<PlusOutlined />}
                    onClick={() => dataPoolPanelRef.current?.addField()}
                  >
                    添加字段
                  </Button>
                ) : null}
              </>
            ) : (
              <span className="preview-title">
                {isComponentResource ? '组件预览' : '页面预览'}
              </span>
            )}
          </div>

          <div className="preview-body">
            {s.refNavStack.length ? (
              <button
                type="button"
                className="ref-nav-back"
                title="回到引用处"
                onClick={() => void handleBackToRef()}
              >
                <ArrowLeftOutlined />
                <span>回到引用处</span>
              </button>
            ) : null}
            <div
              className="preview-pane-fill"
              style={{ display: isBackendNav ? undefined : 'none' }}
            >
              {activeBackendService ? (
                <BackendServiceWorkspace
                  key={activeBackendService.id}
                  ref={backendWorkspaceRef}
                  projectPath={projectStore.path}
                  serviceId={activeBackendService.id}
                  serviceName={activeBackendService.name}
                  typeLibrary={s.dataTypeLibrary}
                  moduleOptions={backendModuleOptions}
                  layer={s.backendServiceLayer}
                  restoredControllerId={activeBackendUi?.controllerId}
                  restoredBusiness={activeBackendUi?.processors.business ?? null}
                  restoredData={
                    activeBackendUi?.processors.data
                      ? {
                          processorId: activeBackendUi.processors.data.processorId,
                          methodId: activeBackendUi.processors.data.methodId,
                        }
                      : null
                  }
                  onLayerChange={onBackendLayerUpdate}
                  onDebugTargetChange={(target) => {
                    if (isSameProcessorDebugTarget(s.backendDebugTarget, target)) {
                      return
                    }
                    patch('backendDebugTarget', target)
                  }}
                  onControllerIdChange={onBackendControllerId}
                  onBusinessSelectionChange={onBackendBusinessSelection}
                  onDataSelectionChange={onBackendDataSelection}
                  onNavigateUsage={onNavigateDataMethodUsage}
                />
              ) : (
                <Empty description="暂无服务，请在左侧新建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </div>
            {!isBackendNav ? (
              <>
                {s.loadingPage && !activeDoc ? (
                  <div className="preview-placeholder">
                    <Skeleton active paragraph={{ rows: 6 }} title={false} />
                  </div>
                ) : isIconsMode ? (
                  <IconLibraryPanel
                    library={s.iconLibrary}
                    projectPath={projectStore.path}
                    onLibraryChange={handleIconLibraryUpdate}
                  />
                ) : isPaletteMode ? (
                  <ColorPalettePanel
                    library={s.colorPalette}
                    onLibraryChange={handleColorPaletteUpdate}
                  />
                ) : isDataTypesMode ? (
                  <DataTypesPanel
                    library={s.dataTypeLibrary}
                    onLibraryChange={handleDataTypeLibraryUpdate}
                  />
                ) : isMysqlMode ? (
                  <MysqlPanel
                    library={s.mysqlLibrary}
                    typeLibrary={s.dataTypeLibrary}
                    projectPath={projectStore.path}
                    onLibraryChange={handleMysqlLibraryUpdate}
                    onTypeLibraryChange={handleDataTypeLibraryUpdate}
                  />
                ) : isOssMode ? (
                  <OssPanel
                    library={s.ossLibrary}
                    onLibraryChange={handleOssLibraryUpdate}
                  />
                ) : !activeDoc ? (
                  <div className="preview-placeholder">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        isComponentResource
                          ? '请选择或新建一个组件'
                          : '请选择或新建一个页面'
                      }
                    />
                  </div>
                ) : isDataPoolMode ? (
                  <DataPoolPanel
                    ref={dataPoolPanelRef}
                    data={activeDoc.data ?? { fields: [] }}
                    xml={activeDoc.xml}
                    iconOptions={iconOptions}
                    getDeviceInfo={previewGetDeviceInfo}
                    colorPalette={s.colorPalette}
                    componentProps={editorConditionComponentProps}
                    dollarProps={editorDollarProps}
                    typeLibrary={s.dataTypeLibrary}
                    projectPath={projectStore.path}
                    methods={editorMethods}
                    componentMap={s.componentMap}
                    componentMethodsMap={s.componentMethodsMap}
                    emitEvents={
                      isComponentResource ? s.activeComponent?.config.events : undefined
                    }
                    pageQueryParams={isPageResource ? pageQueryParams : null}
                    routeParams={isPageResource ? s.routeParams : null}
                    onDataChange={handleDataUpdate}
                  />
                ) : isMethodsMode ? (
                  <MethodsPanel
                    methods={editorMethods}
                    onEdit={openEditMethod}
                    onRemove={handleRemoveMethod}
                  />
                ) : isLifecycleMode ? (
                  <LifecyclePanel
                    lifecycle={s.lifecycleConfig}
                    methods={editorMethods}
                    dataFields={activeDoc.data?.fields ?? []}
                    xml={activeDoc.xml}
                    componentMap={s.componentMap}
                    componentMethodsMap={s.componentMethodsMap}
                    iconOptions={iconOptions}
                    emitEvents={
                      isComponentResource ? s.activeComponent?.config.events : undefined
                    }
                    componentProps={editorConditionComponentProps}
                    typeLibrary={s.dataTypeLibrary}
                    projectPath={projectStore.path}
                    onLifecycleChange={handleLifecycleUpdate}
                  />
                ) : (
                  <>
                    <PageCanvas
                      panX={s.canvasPanX}
                      onPanXChange={(v) => patch('canvasPanX', v)}
                      panY={s.canvasPanY}
                      onPanYChange={(v) => patch('canvasPanY', v)}
                      zoom={s.canvasZoom}
                      onZoomChange={(v) => patch('canvasZoom', v)}
                      scene={s.canvasScene}
                      onSceneChange={(v) => patch('canvasScene', v)}
                      inspectMode={s.previewInspectMode}
                      onInspectModeChange={(v) => patch('previewInspectMode', v)}
                      modalStack={modalStack}
                      xml={activeDoc.xml}
                      canvasWidth={canvasFrameWidth}
                      canvasHeight={
                        canvasFrameHeight === undefined ? undefined : canvasFrameHeight
                      }
                      phoneWidthFitContent={phoneWidthFitContent}
                      phoneScreenWidth={canvasWidth}
                      phoneScreenHeight={667}
                      selectedId={s.selectedNodeId}
                      selectable={isEditMode}
                      showAddButton={isEditMode}
                      showAddDebugButton={showAddDebugButton}
                      showDeleteButton={canDeleteSelected}
                      expandRepeat={s.workspaceMode === 'preview'}
                      pageData={resolvedPageData}
                      iconLibrary={s.iconLibrary}
                      componentMap={canvasComponentMap}
                      dollarProps={editorDollarProps}
                      routeParams={s.routeParams}
                      projectPath={projectStore.path || undefined}
                      previewLifecycleGate={s.previewLifecycleGate}
                      inspectNodeId={previewInspectNodeId}
                      instancePropOverrides={s.previewInstancePropOverrides}
                      hiddenNodeIds={isEditMode ? s.editorHiddenNodeIds : undefined}
                      toast={s.workspaceMode === 'preview' ? s.previewToast : null}
                      showDeviceChrome={!isComponentResource}
                      statusBarSelectable={isEditMode && isPageResource}
                      statusBarBackground={resolvedPageStatusBar.backgroundColor}
                      statusBarTextStyle={resolvedPageStatusBar.textStyle}
                      statusBarCover={resolvedPageStatusBar.cover}
                      statusBarNavigationBar={resolvedPageStatusBar.navigationBar}
                      navigationBarTitle={
                        s.activePage?.config.title || s.activePage?.config.name || ''
                      }
                      onSelect={(id) => patch('selectedNodeId', id)}
                      onOpenRepeat={handleOpenRepeatConfig}
                      onOpenEvent={handleOpenEventConfig}
                      onOpenInspect={handlePreviewOpenInspect}
                      onClearInspect={clearPreviewInspect}
                      onAddWindow={handleAddMultiWindow}
                      onInteract={handlePreviewInteract}
                      onAdd={openAddWidgetDialog}
                      onAddDebug={openAddDebugDialog}
                      onDelete={handleDeleteWidget}
                      onContextMenu={openWidgetCtxMenu}
                    />
                    {s.workspaceMode === 'preview' && activeDoc ? (
                      <PreviewCanvasToolbar
                        mode={isComponentResource ? 'component' : 'page'}
                        canGoBack={canPreviewGoBack}
                        hasEntryPage={hasEntryPage}
                        config={s.activeComponent?.config}
                        methods={editorMethods}
                        onBack={handlePreviewNavigateBack}
                        onGoEntry={handlePreviewGoEntry}
                        onRefresh={handlePreviewRefresh}
                        onInvokeMethod={(payload) =>
                          invokeActiveExposedMethod(payload.name, payload.args)
                        }
                      />
                    ) : null}
                  </>
                )}
              </>
            ) : null}
          </div>
        </section>

        {isFrontendNav && activeDoc && isEditMode && isComponentResource ? (
          !s.selectedNodeId ? (
            <ComponentMetaPanel
              config={s.activeComponent!.config}
              methods={editorMethods}
              iconOptions={iconOptions}
              typeLibrary={s.dataTypeLibrary}
              onConfigChange={handleComponentConfigUpdate}
            />
          ) : (
            <PropsPanel
              tab={s.propsTab}
              onTabChange={(tab) => patch('propsTab', tab)}
              backLabel="返回组件设置"
              xml={activeDoc.xml}
              selectedId={s.selectedNodeId}
              dataFields={activeDoc.data?.fields ?? []}
              iconOptions={iconOptions}
              methods={editorMethods}
              emitEvents={s.activeComponent?.config.events}
              componentProps={editorConditionComponentProps}
              routeParams={null}
              componentMap={s.componentMap}
              componentMethodsMap={s.componentMethodsMap}
              projectPath={projectStore.path || undefined}
              typeLibrary={s.dataTypeLibrary}
              openRepeatRequest={s.openRepeatRequest}
              onXmlChange={handleXmlUpdate}
              onBack={() => patch('selectedNodeId', '')}
            />
          )
        ) : isFrontendNav && activeDoc && isEditMode ? (
          <PropsPanel
            tab={s.propsTab}
            onTabChange={(tab) => patch('propsTab', tab)}
            xml={activeDoc.xml}
            selectedId={s.selectedNodeId}
            dataFields={activeDoc.data?.fields ?? []}
            iconOptions={iconOptions}
            methods={editorMethods}
            componentProps={null}
            routeParams={s.routeParams}
            componentMap={s.componentMap}
            componentMethodsMap={s.componentMethodsMap}
            projectPath={projectStore.path || undefined}
            typeLibrary={s.dataTypeLibrary}
            openRepeatRequest={s.openRepeatRequest}
            statusBarConfig={isPageResource ? pageStatusBarConfig : null}
            isPageResource={isPageResource}
            pageQueryParams={isPageResource ? pageQueryParams : null}
            pageDebugQuery={isPageResource ? pageDebugQuery : null}
            canvasScene={s.canvasScene}
            onXmlChange={handleXmlUpdate}
            onStatusBarChange={handleStatusBarUpdate}
            onPageQueryParamsChange={handlePageQueryParamsUpdate}
            onPageDebugQueryChange={handlePageDebugQueryUpdate}
          />
        ) : isFrontendNav && s.workspaceMode === 'preview' && activeDoc ? (
          <PreviewDebugPanel
            mode={previewPanelMode}
            config={previewPanelConfig}
            propValues={previewPanelPropValues}
            propOverrides={previewPanelPropOverrides}
            pageData={previewPanelPageData}
            inspectLabel={s.previewInspectTarget?.label}
            inspectComponentId={s.previewInspectTarget?.componentId}
            hostAttrs={s.previewInspectTarget?.hostAttrs}
            emitLogs={s.previewEmitLogs}
            controllerFetchLogs={s.previewControllerFetchLogs}
            typeLibrary={s.dataTypeLibrary}
            projectPath={projectStore.path || undefined}
            onRefresh={handlePreviewRefresh}
            onPropChange={handlePreviewPanelPropUpdate}
            onDataFieldChange={handlePreviewPanelDataField}
            onClearEmitLogs={() => patch('previewEmitLogs', [])}
            onLocateRef={handleLocateRef}
            onEditComponent={handleEditInspectedComponent}
          />
        ) : isBackendNav && s.backendServiceLayer === 'data' ? (
          <DataMethodDebugPanel
            target={dataDebugTarget}
            typeLibrary={s.dataTypeLibrary}
            onDebugParamsChange={(params) =>
              backendWorkspaceRef.current?.applyDebugParams(params)
            }
          />
        ) : isBackendNav &&
          (s.backendServiceLayer === 'service' ||
            s.backendServiceLayer === 'controller') ? (
          <MethodFlowDebugPanel
            target={flowDebugTarget}
            typeLibrary={s.dataTypeLibrary}
            onDebugParamsChange={(params) =>
              backendWorkspaceRef.current?.applyDebugParams(params)
            }
            onCursorChange={(state) =>
              backendWorkspaceRef.current?.applyFlowDebugCursor(state)
            }
          />
        ) : !(
            (isFrontendNav && (isDataPoolMode || isMethodsMode || isLifecycleMode)) ||
            (isBackendNav && s.backendServiceLayer === 'schedule')
          ) ? (
          <aside className="props-placeholder">
            <div className="panel-header">{isBackendNav ? '服务' : '属性'}</div>
            <Empty description={propsPlaceholderText} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </aside>
        ) : null}

        {showModeTabs ? (
          <div className="workspace-mode-tabs">
            <div className="workspace-mode-tabs-bar">
              {modeTabs.map((tab) => (
                <Tooltip key={tab.key} title={tab.label} placement="top">
                  <button
                    type="button"
                    className={`workspace-mode-tab${s.workspaceMode === tab.key ? ' active' : ''}`}
                    onClick={() => setWorkspaceMode(tab.key)}
                  >
                    {tab.icon}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        ) : showBackendLayerTabs ? (
          <div className="workspace-mode-tabs">
            <div className="workspace-mode-tabs-bar">
              {backendLayerTabs.map((tab) => (
                <Tooltip key={tab.key} title={tab.label} placement="top">
                  <button
                    type="button"
                    className={`workspace-mode-tab${s.backendServiceLayer === tab.key ? ' active' : ''}`}
                    onClick={() => onBackendLayerUpdate(tab.key)}
                  >
                    {tab.icon}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <MethodEditDialog
        open={s.methodDialogVisible}
        onOpenChange={(open) => patch('methodDialogVisible', open)}
        method={s.editingMethod}
        dataFields={activeDoc?.data?.fields ?? []}
        typeLibrary={s.dataTypeLibrary}
        xml={activeDoc?.xml}
        componentMap={s.componentMap}
        componentMethodsMap={s.componentMethodsMap}
        ambientExtra={methodAmbientExtra}
        onSave={handleSaveMethod}
      />

      <BackendServiceEditor
        open={s.serviceDialogVisible}
        onOpenChange={(open) => patch('serviceDialogVisible', open)}
        service={activeBackendService}
        mysqlLibrary={s.mysqlLibrary}
        onSave={handleBackendServiceUpdate}
      />

      <Modal
        open={s.createVisible}
        title={createDialogTitle}
        width={480}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => patch('createVisible', false)}
        footer={
          <Button type="primary" loading={s.creating} onClick={() => void handleCreatePage()}>
            创建
          </Button>
        }
      >
        <Form form={createForm} labelCol={{ flex: '88px' }} colon={false}>
          <Form.Item
            label={isComponentResource ? '组件 ID' : '页面 ID'}
            name="id"
            rules={createIdRules('请输入页面 ID')}
          >
            <Input placeholder={isComponentResource ? '例如：nav-bar' : '例如：home'} />
          </Form.Item>
          <Form.Item
            label={isComponentResource ? '组件名称' : '页面名称'}
            name="name"
            rules={[{ required: true, message: '请输入页面名称' }]}
          >
            <Input placeholder={isComponentResource ? '例如：导航栏' : '例如：首页'} />
          </Form.Item>
          <Form.Item label={isComponentResource ? '组件标题' : '页面标题'} name="title">
            <Input placeholder="可选，默认与名称相同" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={s.renameComponentVisible}
        title="重命名组件"
        width={480}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => patch('renameComponentVisible', false)}
        footer={
          <Button
            type="primary"
            loading={s.renamingComponent}
            onClick={() => void handleRenameComponentConfirm()}
          >
            确定
          </Button>
        }
      >
        <Form form={renameComponentForm} labelCol={{ flex: '88px' }} colon={false}>
          <Form.Item
            label="组件 ID"
            name="id"
            rules={createIdRules('请输入组件 ID')}
          >
            <Input placeholder="例如：GoodsList" />
          </Form.Item>
          <Form.Item
            label="组件名称"
            name="name"
            rules={[{ required: true, message: '请输入组件名称' }]}
          >
            <Input placeholder="例如：商品列表" />
          </Form.Item>
        </Form>
        <p className="add-hint">
          修改 ID 会重命名组件目录，并自动更新页面中的 componentId 引用。
        </p>
      </Modal>

      <Modal
        open={s.addDialogVisible}
        title={s.addIntoSlotDebug ? '添加调试元素' : '添加'}
        width={560}
        destroyOnHidden
        className="add-widget-dialog"
        maskClosable={false}
        keyboard={false}
        footer={null}
        onCancel={() => patch('addDialogVisible', false)}
        afterClose={() => patch('addIntoSlotDebug', false)}
      >
        {s.addIntoSlotDebug ? (
          <p className="add-hint">
            写入当前插槽的调试预览内容，便于组件编辑时查看布局；导出 Vue 时插槽仍为空
            <code>&lt;slot&gt;</code>，不含这些子节点。
          </p>
        ) : (
          <p className="add-hint">
            将添加到当前选中的布局容器；若选中的是 Text/Button/Input，则添加到其父布局。选中
            Component 时可添加插槽内容子节点。
          </p>
        )}
        <Tabs
          className="add-dialog-tabs"
          activeKey={s.addDialogTab}
          onChange={(key) => patch('addDialogTab', key as 'widget' | 'component')}
          items={[
            {
              key: 'widget',
              label: '控件',
              children: (
                <div className="widget-options widget-options--tiles">
                  {addWidgetOptions.map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      className="widget-option widget-option--tile"
                      title={item.description}
                      onClick={() => void handleAddWidget(item.tag)}
                    >
                      <div className="widget-option-title">{item.label.split(/\s+/)[0]}</div>
                      <div className="widget-option-tag">{item.tag}</div>
                      <div className="widget-option-desc">{item.description}</div>
                    </button>
                  ))}
                </div>
              ),
            },
            {
              key: 'component',
              label: '组件',
              children: !addableComponents.length ? (
                <Empty
                  description={
                    isComponentResource
                      ? '暂无其它组件可嵌套'
                      : '暂无组件，请先在「组件」中新建'
                  }
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <div className="widget-options widget-options--tiles">
                  {addableComponents.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="widget-option widget-option--tile"
                      title={item.id}
                      onClick={() => void handleAddComponentInstance(item)}
                    >
                      <div className="widget-option-title">{item.name}</div>
                      <div className="widget-option-tag">{item.id}</div>
                      <div className="widget-option-desc">插入为 Component 节点</div>
                    </button>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </Modal>

      {s.widgetCtxMenu.visible
        ? createPortal(
            <div
              className="widget-ctx-menu"
              style={{ left: `${s.widgetCtxMenu.x}px`, top: `${s.widgetCtxMenu.y}px` }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                type="button"
                className="widget-ctx-item"
                disabled={!widgetCtxCanCopy}
                onClick={() => void handleWidgetCtxCommand('copy')}
              >
                复制
              </button>
              <button
                type="button"
                className="widget-ctx-item"
                disabled={!widgetCtxCanDelete}
                onClick={() => void handleWidgetCtxCommand('delete')}
              >
                删除
              </button>
              <div className="widget-ctx-divider" />
              <button
                type="button"
                className="widget-ctx-item"
                disabled={!widgetCtxCanMoveUp}
                onClick={() => void handleWidgetCtxCommand('moveUp')}
              >
                上移
              </button>
              <button
                type="button"
                className="widget-ctx-item"
                disabled={!widgetCtxCanMoveDown}
                onClick={() => void handleWidgetCtxCommand('moveDown')}
              >
                下移
              </button>
              <div className="widget-ctx-divider" />
              <button
                type="button"
                className="widget-ctx-item"
                disabled={!widgetCtxCanPasteSibling}
                onClick={() => void handleWidgetCtxCommand('pasteSibling')}
              >
                粘贴为同级
              </button>
              <button
                type="button"
                className="widget-ctx-item"
                disabled={!widgetCtxCanPasteChild}
                onClick={() => void handleWidgetCtxCommand('pasteChild')}
              >
                粘贴为子级
              </button>
              <div className="widget-ctx-divider" />
              <button
                type="button"
                className="widget-ctx-item"
                disabled={!widgetCtxCanMentionAi}
                onClick={() => void handleWidgetCtxCommand('mentionAi')}
              >
                提及给AI助手
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
