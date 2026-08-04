<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { Delete, Plus, RefreshRight } from '@element-plus/icons-vue'
import { colorPickState } from '../../composables/useColorPick'
import {
  BADGE_HOST_KEY,
  CANVAS_TOOL_MODE_KEY,
  createModalStack,
  MODAL_HOST_KEY,
  MODAL_STACK_KEY,
  PREVIEW_INSPECT_MODE_KEY,
  PREVIEW_INSTANCE_PROP_OVERRIDES_KEY,
  type CanvasToolMode,
  type ModalStackApi,
  type PreviewInspectMode,
} from '../../composables/useModalStack'
import {
  INSPECT_HOST_KEY,
  OPEN_INSPECT_KEY,
  PHONE_FRAME_KEY,
} from '../../composables/useInspectCalloutLayout'
import { CANVAS_RUNTIME_KEY } from '../../composables/useCanvasRuntime'
import {
  COMPONENT_RENDER_MAP_KEY,
  PAGE_LIVE_PAGE_DATA_KEY,
} from '../../composables/useComponentRenderMap'
import { EDITOR_MENU_BUTTON, getDeviceInfo } from '../../utils/device-info'
import type { IconLibrary } from '../../types/icon-library'
import type { PageData } from '../../types/page-data'
import type { ComponentRenderMap } from '../../types/component-render'
import { buildRepeatExpandKey, expandRepeatTree } from '../../utils/repeat'
import { parsePageXml, type XmlNode } from '../../utils/xml'
import IconSprite from './IconSprite.vue'
import XmlNodeView from './XmlNodeView.vue'
import { STATUS_BAR_NODE_ID } from '../../utils/status-bar'

const props = defineProps<{
  xml: string
  canvasWidth: number
  selectedId?: string
  selectable?: boolean
  showAddButton?: boolean
  /** 选中插槽时：添加调试元素 */
  showAddDebugButton?: boolean
  showDeleteButton?: boolean
  /** ????? repeat??? v-for? */
  expandRepeat?: boolean
  pageData?: PageData
  iconLibrary?: IconLibrary
  /** ?????????????? */
  hiddenNodeIds?: string[]
  /** ??? Component ??????? */
  componentMap?: ComponentRenderMap
  /** ?????????? min 667?? auto ?????? */
  canvasHeight?: number | 'auto'
  /** 组件 width=wrap_content：手机框宽随内容，上限 phoneScreenWidth/canvasWidth */
  phoneWidthFitContent?: boolean
  /** ??/????????? $props????? */
  dollarProps?: Record<string, unknown>
  /** ????????$route? */
  routeParams?: Record<string, unknown>
  /** 当前工程路径（组件 api 参数预览） */
  projectPath?: string
  /** 预览运行时就绪闸门（递增后触发嵌套组件生命周期） */
  previewLifecycleGate?: number
  /** ??? Toast????????? */
  toast?: { message: string; id: number } | null
  /** ??? Modal ??????????????? */
  modalStack?: ModalStackApi
  /** 页面预览显示状态栏/胶囊；组件预览不显示 */
  showDeviceChrome?: boolean
  /** 组件居中参照：手机屏宽（默认与 canvasWidth 相同） */
  phoneScreenWidth?: number
  /** 组件居中参照：手机屏高 */
  phoneScreenHeight?: number
  /** 状态栏是否可选中（编辑态） */
  statusBarSelectable?: boolean
  /** 状态栏背景色 */
  statusBarBackground?: string
  /** 状态栏文字/图标色 black | white */
  statusBarTextStyle?: 'black' | 'white'
  /** 状态栏与页面重叠（沉浸式） */
  statusBarCover?: boolean
  /** 是否显示微信原生标题栏 */
  statusBarNavigationBar?: boolean
  /** 标题栏文案（页面 title） */
  navigationBarTitle?: string
  /** 预览态正在检视的 Component 节点 id */
  inspectNodeId?: string
  /** 预览检视：按节点 id 覆盖 Component 实例入参 */
  instancePropOverrides?: Record<string, Record<string, unknown>>
}>()

const instancePropOverridesRef = computed(
  () => props.instancePropOverrides ?? {},
)

const emit = defineEmits<{
  select: [id: string]
  add: []
  'add-debug': []
  delete: []
  'open-repeat': [id: string]
  'open-event': [id: string]
  'open-inspect': [
    payload: import('../../types/preview-inspect').PreviewInspectPayload,
  ]
  'clear-inspect': []
  'add-window': [parentId: string]
  interact: [payload: import('../../utils/event-runtime').PreviewInteractPayload]
  contextmenu: [payload: { nodeId: string; x: number; y: number }]
}>()

const fallbackModalStack = createModalStack()
const modalHostRef = ref<HTMLElement | null>(null)
const badgeHostRef = ref<HTMLElement | null>(null)
const inspectHostRef = ref<HTMLElement | null>(null)
const phoneRef = ref<HTMLElement | null>(null)
/** 选中工具 / 测量工具 */
const toolMode = ref<CanvasToolMode>('select')

/** 画布场景：H5 / 小程序 */
const scene = defineModel<'h5' | 'miniprogram'>('scene', { default: 'h5' })
/** 预览检视：纯净 / 组件（仅预览态使用） */
const inspectMode = defineModel<PreviewInspectMode>('inspectMode', {
  default: 'clean',
})

provide(MODAL_STACK_KEY, props.modalStack ?? fallbackModalStack)
provide(MODAL_HOST_KEY, modalHostRef)
provide(BADGE_HOST_KEY, badgeHostRef)
provide(INSPECT_HOST_KEY, inspectHostRef)
provide(PHONE_FRAME_KEY, phoneRef)
provide(OPEN_INSPECT_KEY, (payload) => emit('open-inspect', payload))
provide(CANVAS_TOOL_MODE_KEY, toolMode)
provide(PREVIEW_INSPECT_MODE_KEY, inspectMode)
provide(PREVIEW_INSTANCE_PROP_OVERRIDES_KEY, instancePropOverridesRef)
provide(
  COMPONENT_RENDER_MAP_KEY,
  computed(() => props.componentMap),
)
provide(
  PAGE_LIVE_PAGE_DATA_KEY,
  computed(() => props.pageData),
)
provide(CANVAS_RUNTIME_KEY, {
  getDeviceInfo: () =>
    getDeviceInfo({
      platform: scene.value,
      windowWidth: props.canvasWidth,
    }),
  get projectPath() {
    return props.projectPath
  },
})

watch(
  () => props.selectable,
  (selectable) => {
    if (selectable) (props.modalStack ?? fallbackModalStack).closeAll()
  },
)
/** 页面级 repeat：仅数组变化时重建，避免标量 setData 每帧拆树 */
let cachedPageExpandKey = ''
let cachedPageRoot: XmlNode | null = null

const parsed = computed<{ root: XmlNode | null; error: string }>(() => {
  if (!props.xml.trim()) {
    cachedPageExpandKey = ''
    cachedPageRoot = null
    return { root: null, error: '?? XML ??' }
  }
  try {
    const root = parsePageXml(props.xml)
    if (!props.expandRepeat || !root) {
      return { root, error: '' }
    }
    const expandKey = `${props.xml}\0${buildRepeatExpandKey(props.pageData, props.dollarProps)}`
    if (expandKey === cachedPageExpandKey && cachedPageRoot) {
      return { root: cachedPageRoot, error: '' }
    }
    const viewRoot = expandRepeatTree(root, props.pageData, props.dollarProps)
    cachedPageExpandKey = expandKey
    cachedPageRoot = viewRoot
    return { root: viewRoot, error: '' }
  } catch (err) {
    cachedPageExpandKey = ''
    cachedPageRoot = null
    return {
      root: null,
      error: err instanceof Error ? err.message : 'XML ????',
    }
  }
})

const rootId = computed(() =>
  parsed.value.root ? `0:${parsed.value.root.tag}` : '',
)

const hoveredNodeId = ref('')

const phoneFrameStyle = computed(() => {
  const style: Record<string, string> = {
    // 辅助边框/标注反缩放用（与 transform scale 配套）
    '--canvas-zoom': String(zoom.value || 1),
  }
  if (props.phoneWidthFitContent) {
    const maxW =
      (typeof props.phoneScreenWidth === 'number' && props.phoneScreenWidth > 0
        ? props.phoneScreenWidth
        : props.canvasWidth) || 375
    style.width = 'fit-content'
    style.maxWidth = `${maxW}px`
    style.minWidth = '0'
  } else {
    style.width = `${props.canvasWidth}px`
  }
  if (typeof props.canvasHeight === 'number' && Number.isFinite(props.canvasHeight)) {
    style.height = `${props.canvasHeight}px`
    style.minHeight = `${props.canvasHeight}px`
  } else if (props.canvasHeight === 'auto') {
    style.height = 'auto'
    style.minHeight = '0'
  }
  return style
})

type MeasureRect = { left: number; top: number; right: number; bottom: number }
type MeasureGuide = {
  side: 'left' | 'right' | 'top' | 'bottom' | 'h' | 'v'
  value: number
  left: number
  top: number
  width: number
  height: number
}
/** 占满画布的对齐虚线（相对 stage 坐标） */
type AlignGuide = {
  axis: 'h' | 'v'
  /** h → top；v → left（相对 stage） */
  pos: number
  /** selected=黄，hovered=粉 */
  tone: 'selected' | 'hovered'
}

const measureGuides = ref<MeasureGuide[]>([])
const alignGuides = ref<AlignGuide[]>([])
const measureSizeLabel = ref<{ text: string; left: number; top: number } | null>(null)
let measureSyncRaf = 0
let measureLiveRaf = 0

const showMeasureOverlay = computed(
  () =>
    Boolean(props.selectable) &&
    toolMode.value === 'measure' &&
    Boolean(props.selectedId),
)

function toLocalRect(
  host: HTMLElement,
  hr: DOMRect,
  rect: DOMRect,
): MeasureRect {
  const scaleX = host.offsetWidth / hr.width
  const scaleY = host.offsetHeight / hr.height
  return {
    left: (rect.left - hr.left) * scaleX,
    top: (rect.top - hr.top) * scaleY,
    right: (rect.right - hr.left) * scaleX,
    bottom: (rect.bottom - hr.top) * scaleY,
  }
}

function rectContains(outer: MeasureRect, inner: MeasureRect) {
  return (
    outer.left <= inner.left + 0.5 &&
    outer.right >= inner.right - 0.5 &&
    outer.top <= inner.top + 0.5 &&
    outer.bottom >= inner.bottom - 0.5
  )
}

function midY(r: MeasureRect) {
  return (r.top + r.bottom) / 2
}

function midX(r: MeasureRect) {
  return (r.left + r.right) / 2
}

function smallerByHeight(a: MeasureRect, b: MeasureRect) {
  return a.bottom - a.top <= b.bottom - b.top ? a : b
}

function smallerByWidth(a: MeasureRect, b: MeasureRect) {
  return a.right - a.left <= b.right - b.left ? a : b
}

function yOverlap(a: MeasureRect, b: MeasureRect) {
  return a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
}

function xOverlap(a: MeasureRect, b: MeasureRect) {
  return a.left < b.right - 0.5 && a.right > b.left + 0.5
}

/** 视口坐标 → stage 本地坐标（对齐虚线挂在 stage 上，占满画布） */
function viewportToStage(stage: HTMLElement, clientX: number, clientY: number) {
  const sr = stage.getBoundingClientRect()
  if (sr.width < 1 || sr.height < 1) return { x: 0, y: 0 }
  const scaleX = stage.clientWidth / sr.width
  const scaleY = stage.clientHeight / sr.height
  return {
    x: (clientX - sr.left) * scaleX,
    y: (clientY - sr.top) * scaleY,
  }
}

/** 内嵌：小节点相对大节点四边间距 */
function containmentGuides(small: MeasureRect, large: MeasureRect): MeasureGuide[] {
  const next: MeasureGuide[] = []
  const leftGap = small.left - large.left
  if (leftGap >= 1) {
    next.push({
      side: 'left',
      value: Math.round(leftGap),
      left: large.left,
      top: midY(small),
      width: leftGap,
      height: 0,
    })
  }
  const rightGap = large.right - small.right
  if (rightGap >= 1) {
    next.push({
      side: 'right',
      value: Math.round(rightGap),
      left: small.right,
      top: midY(small),
      width: rightGap,
      height: 0,
    })
  }
  const topGap = small.top - large.top
  if (topGap >= 1) {
    next.push({
      side: 'top',
      value: Math.round(topGap),
      left: midX(small),
      top: large.top,
      width: 0,
      height: topGap,
    })
  }
  const bottomGap = large.bottom - small.bottom
  if (bottomGap >= 1) {
    next.push({
      side: 'bottom',
      value: Math.round(bottomGap),
      left: midX(small),
      top: small.bottom,
      width: 0,
      height: bottomGap,
    })
  }
  return next
}

type GuidesResult = { distances: MeasureGuide[]; aligns: AlignGuide[] }

/**
 * 选中(a) ↔ 悬停(b) 间距；
 * 距离线在垂直/水平方向对不齐时，补占满画布的对齐虚线。
 * selectedEl/hoveredEl 用于把边换算到 stage 坐标。
 */
function guidesBetween(
  a: MeasureRect,
  b: MeasureRect,
  stage: HTMLElement,
  selectedEl: HTMLElement,
  hoveredEl: HTMLElement,
): GuidesResult {
  if (rectContains(a, b) || rectContains(b, a)) {
    const small = rectContains(a, b) ? b : a
    const large = rectContains(a, b) ? a : b
    return { distances: containmentGuides(small, large), aligns: [] }
  }

  const distances: MeasureGuide[] = []
  const aligns: AlignGuide[] = []
  const y = midY(smallerByHeight(a, b))
  const x = midX(smallerByWidth(a, b))

  const aBox = selectedEl.getBoundingClientRect()
  const bBox = hoveredEl.getBoundingClientRect()

  const pushAlignV = (clientX: number, tone: 'selected' | 'hovered') => {
    const { x: sx } = viewportToStage(stage, clientX, 0)
    aligns.push({ axis: 'v', pos: sx, tone })
  }
  const pushAlignH = (clientY: number, tone: 'selected' | 'hovered') => {
    const { y: sy } = viewportToStage(stage, 0, clientY)
    aligns.push({ axis: 'h', pos: sy, tone })
  }

  if (a.right < b.left - 0.5) {
    const gap = b.left - a.right
    distances.push({ side: 'h', value: Math.round(gap), left: a.right, top: y, width: gap, height: 0 })
    // 垂直方向错开：距离线够不到另一元素边，拉满画布虚线
    if (!yOverlap(a, b)) {
      pushAlignV(aBox.right, 'selected')
      pushAlignV(bBox.left, 'hovered')
    }
  } else if (b.right < a.left - 0.5) {
    const gap = a.left - b.right
    distances.push({ side: 'h', value: Math.round(gap), left: b.right, top: y, width: gap, height: 0 })
    if (!yOverlap(a, b)) {
      pushAlignV(bBox.right, 'hovered')
      pushAlignV(aBox.left, 'selected')
    }
  }

  if (a.bottom < b.top - 0.5) {
    const gap = b.top - a.bottom
    distances.push({ side: 'v', value: Math.round(gap), left: x, top: a.bottom, width: 0, height: gap })
    if (!xOverlap(a, b)) {
      pushAlignH(aBox.bottom, 'selected')
      pushAlignH(bBox.top, 'hovered')
    }
  } else if (b.bottom < a.top - 0.5) {
    const gap = a.top - b.bottom
    distances.push({ side: 'v', value: Math.round(gap), left: x, top: b.bottom, width: 0, height: gap })
    if (!xOverlap(a, b)) {
      pushAlignH(bBox.bottom, 'hovered')
      pushAlignH(aBox.top, 'selected')
    }
  }

  return { distances, aligns }
}

function syncMeasureOverlay() {
  const host = badgeHostRef.value
  const phone = phoneRef.value
  const stage = stageRef.value
  if (!host || !phone || !showMeasureOverlay.value) {
    measureGuides.value = []
    alignGuides.value = []
    measureSizeLabel.value = null
    return
  }

  const selectedEl = phone.querySelector('.content-box.selected') as HTMLElement | null
  if (!selectedEl) {
    measureGuides.value = []
    alignGuides.value = []
    measureSizeLabel.value = null
    return
  }

  const hr = host.getBoundingClientRect()
  if (hr.width < 1 || hr.height < 1) {
    measureGuides.value = []
    alignGuides.value = []
    measureSizeLabel.value = null
    return
  }

  const selected = toLocalRect(host, hr, selectedEl.getBoundingClientRect())
  const width = Math.max(0, Math.round(selected.right - selected.left))
  const height = Math.max(0, Math.round(selected.bottom - selected.top))
  const inv = 1 / (zoom.value || 1)
  measureSizeLabel.value = {
    text: `${width} × ${height}`,
    left: (selected.left + selected.right) / 2,
    top: selected.bottom + 4 * inv,
  }

  const canDistance =
    Boolean(hoveredNodeId.value) &&
    hoveredNodeId.value !== props.selectedId
  if (!canDistance || !stage) {
    measureGuides.value = []
    alignGuides.value = []
    return
  }

  const hoveredEl = phone.querySelector('.content-box.hovered') as HTMLElement | null
  if (!hoveredEl) {
    measureGuides.value = []
    alignGuides.value = []
    return
  }

  const hovered = toLocalRect(host, hr, hoveredEl.getBoundingClientRect())
  const result = guidesBetween(selected, hovered, stage, selectedEl, hoveredEl)
  measureGuides.value = result.distances
  alignGuides.value = result.aligns
}

function scheduleMeasureSync() {
  if (measureSyncRaf) cancelAnimationFrame(measureSyncRaf)
  measureSyncRaf = requestAnimationFrame(() => {
    measureSyncRaf = 0
    syncMeasureOverlay()
  })
}

function startMeasureLiveSync() {
  if (measureLiveRaf) return
  const tick = () => {
    if (!showMeasureOverlay.value) {
      measureLiveRaf = 0
      return
    }
    syncMeasureOverlay()
    measureLiveRaf = requestAnimationFrame(tick)
  }
  measureLiveRaf = requestAnimationFrame(tick)
}

const phoneFitContent = computed(
  () => props.canvasHeight === 'auto' || typeof props.canvasHeight === 'number',
)

/** 组件预览参照手机屏尺寸；小于该尺寸的方向居中 */
const phoneScreenW = computed(
  () =>
    (typeof props.phoneScreenWidth === 'number' && props.phoneScreenWidth > 0
      ? props.phoneScreenWidth
      : props.canvasWidth) || 375,
)
const phoneScreenH = computed(
  () =>
    (typeof props.phoneScreenHeight === 'number' && props.phoneScreenHeight > 0
      ? props.phoneScreenHeight
      : 667),
)

const centerPhoneX = computed(() => {
  if (!phoneFitContent.value) return false
  if (props.phoneWidthFitContent) return true
  return props.canvasWidth < phoneScreenW.value
})

const centerPhoneY = computed(() => {
  if (!phoneFitContent.value) return false
  if (props.canvasHeight === 'auto') return true
  if (typeof props.canvasHeight === 'number') {
    return props.canvasHeight < phoneScreenH.value
  }
  return false
})

const phoneSlotStyle = computed(() => {
  if (!phoneFitContent.value) return undefined
  return {
    width: `${phoneScreenW.value}px`,
    height: `${phoneScreenH.value}px`,
  }
})

/** ???? / ???????????????? */
const panX = defineModel<number>('panX', { default: 0 })
const panY = defineModel<number>('panY', { default: 0 })
const zoom = defineModel<number>('zoom', { default: 1 })
const sceneTabs = [
  { key: 'h5' as const, label: 'H5' },
  { key: 'miniprogram' as const, label: '微信小程序' },
]
const panning = ref(false)
const stageRef = ref<HTMLElement | null>(null)
let panOriginX = 0
let panOriginY = 0
let panStartClientX = 0
let panStartClientY = 0
let panPointerId: number | null = null

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

const zoomPercent = computed(() => Math.round(zoom.value * 100))

const statusBarSelected = computed(
  () =>
    Boolean(props.selectable) &&
    props.selectedId === STATUS_BAR_NODE_ID,
)

/** H5 场景固定白底黑字、无沉浸、无标题栏；小程序场景用页面配置 */
const effectiveStatusBar = computed(() => {
  if (scene.value !== 'miniprogram') {
    return {
      background: '#ffffff',
      textStyle: 'black' as const,
      cover: false,
      navigationBar: false,
    }
  }
  return {
    background: props.statusBarBackground?.trim() || '#ffffff',
    textStyle: props.statusBarTextStyle === 'white' ? ('white' as const) : ('black' as const),
    cover: Boolean(props.statusBarCover),
    navigationBar: props.statusBarNavigationBar !== false,
  }
})

const statusBarStyle = computed(() => {
  const light = effectiveStatusBar.value.textStyle === 'white'
  return {
    background: effectiveStatusBar.value.background,
    color: light ? '#ffffff' : '#111111',
  }
})

const statusBarCover = computed(() => effectiveStatusBar.value.cover)
const showNavigationBar = computed(
  () =>
    Boolean(props.showDeviceChrome) &&
    scene.value === 'miniprogram' &&
    effectiveStatusBar.value.navigationBar,
)

const navigationBarTitleText = computed(() => {
  const t = props.navigationBarTitle?.trim()
  return t || '页面'
})

const navBarStyle = computed(() => {
  const light = effectiveStatusBar.value.textStyle === 'white'
  return {
    background: effectiveStatusBar.value.background,
    color: light ? '#ffffff' : '#111111',
  }
})

const capsuleLight = computed(() => effectiveStatusBar.value.textStyle === 'white')

const capsuleStyle = computed(() => ({
  top: `${EDITOR_MENU_BUTTON.top}px`,
  right: `${EDITOR_MENU_BUTTON.marginRight}px`,
  height: `${EDITOR_MENU_BUTTON.height}px`,
  borderRadius: `${EDITOR_MENU_BUTTON.height / 2}px`,
}))

function handleStatusBarSelect(event: MouseEvent) {
  if (!props.statusBarSelectable) return
  event.stopPropagation()
  emit('select', STATUS_BAR_NODE_ID)
}

const worldStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value || 1})`,
  transformOrigin: 'center top',
}))

const viewMoved = computed(
  () => panX.value !== 0 || panY.value !== 0 || zoom.value !== 1,
)

watch(
  () => props.selectable,
  (selectable) => {
    if (!selectable) hoveredNodeId.value = ''
  },
)

function handleHover(id: string) {
  if (!props.selectable) return
  hoveredNodeId.value = id
}

function clearHover() {
  hoveredNodeId.value = ''
}

function handleWidgetContextMenu(event: MouseEvent) {
  if (!props.selectable) return
  const target = event.target
  if (!(target instanceof Element)) return
  const host = target.closest('[data-widget-node-id]')
  if (!(host instanceof HTMLElement)) return
  if (!host.dataset.widgetNodeId?.trim()) return
  // 悬停红框节点：右键切换选中并打开其菜单；否则保持当前选中，只打开菜单
  const hovered = hoveredNodeId.value.trim()
  const nodeId = hovered || props.selectedId?.trim()
  if (!nodeId) return
  event.preventDefault()
  event.stopPropagation()
  if (hovered && hovered !== props.selectedId) {
    emit('select', hovered)
  }
  emit('contextmenu', { nodeId, x: event.clientX, y: event.clientY })
}

function handlePhoneClick(event: MouseEvent) {
  if (colorPickState.picking.value) {
    event.preventDefault()
    event.stopPropagation()
    colorPickState.pickFromPoint(event.clientX, event.clientY)
    return
  }
  // 点到手机框内未被控件拦截的区域 → 取消选中
  if (props.selectable) {
    emit('select', '')
  }
}

/** 点击画布空白（网格区域等）取消选中 / 取消检视 */
function handleStageClick(event: MouseEvent) {
  if (colorPickState.picking.value) return
  const el = event.target as HTMLElement | null
  if (!el) return
  // 工具栏 / 状态条 / 取色层等
  if (el.closest('.color-pick-ignore')) return
  // 控件自身会 stopPropagation；此处再兜底
  if (el.closest('.select-shell')) return
  if (el.closest('.inspect-callout')) return
  if (props.selectable) {
    emit('select', '')
    return
  }
  // 预览组件检视：点手机外的画布空白取消检视
  if (props.inspectNodeId && !el.closest('.phone')) {
    emit('clear-inspect')
  }
}

const touchCursorVisible = ref(false)
const touchCursorPressed = ref(false)
const touchCursorPos = ref({ x: 0, y: 0 })
/** 按下期间用 window 跟踪，避免拖出画布后 pointerleave/capture 导致光标错位乱跳 */
let touchWindowTrackBound = false

const showTouchCursor = computed(
  () => !props.selectable && !colorPickState.picking.value,
)

const touchCursorStyle = computed(() => ({
  left: `${touchCursorPos.value.x}px`,
  top: `${touchCursorPos.value.y}px`,
}))

function isPointerInsideStage(event: PointerEvent): boolean {
  const stage = stageRef.value
  if (!stage) return false
  const rect = stage.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

/** 相对整个 stage 定位，避免被 .phone overflow 裁成半圆 */
function updateTouchCursorPos(event: PointerEvent) {
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return
  touchCursorPos.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
}

/** 工具栏 / 检视操纵杆等 chrome：用系统 pointer，不跟手指光标 */
function isStageChromeTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(
    el?.closest?.('.color-pick-ignore, .inspect-callout, .stage-inspect-host'),
  )
}

function applyTouchCursorFromEvent(event: PointerEvent) {
  if (!showTouchCursor.value) {
    touchCursorVisible.value = false
    return
  }
  if (!isPointerInsideStage(event)) {
    // 画布外：隐藏自定义光标，交给系统光标，避免贴边裁切乱跳
    touchCursorVisible.value = false
    return
  }
  if (isStageChromeTarget(event.target) && !touchCursorPressed.value) {
    touchCursorVisible.value = false
    return
  }
  touchCursorVisible.value = true
  updateTouchCursorPos(event)
}

function onWindowTouchPointerMove(event: PointerEvent) {
  if (!touchCursorPressed.value) return
  applyTouchCursorFromEvent(event)
}

function onWindowTouchPointerUp() {
  touchCursorPressed.value = false
  unbindTouchWindowTrack()
}

function bindTouchWindowTrack() {
  if (touchWindowTrackBound) return
  touchWindowTrackBound = true
  window.addEventListener('pointermove', onWindowTouchPointerMove, true)
  window.addEventListener('pointerup', onWindowTouchPointerUp, true)
  window.addEventListener('pointercancel', onWindowTouchPointerUp, true)
}

function unbindTouchWindowTrack() {
  if (!touchWindowTrackBound) return
  touchWindowTrackBound = false
  window.removeEventListener('pointermove', onWindowTouchPointerMove, true)
  window.removeEventListener('pointerup', onWindowTouchPointerUp, true)
  window.removeEventListener('pointercancel', onWindowTouchPointerUp, true)
}

function syncTouchCursorMove(event: PointerEvent) {
  if (touchCursorPressed.value) {
    // 按下时由 window 捕获统一处理，避免 stage leave/capture 重复打架
    applyTouchCursorFromEvent(event)
    return
  }
  applyTouchCursorFromEvent(event)
}

function syncTouchCursorDown(event: PointerEvent) {
  if (!showTouchCursor.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (isStageChromeTarget(event.target)) {
    touchCursorVisible.value = false
    touchCursorPressed.value = false
    return
  }
  touchCursorPressed.value = true
  applyTouchCursorFromEvent(event)
  bindTouchWindowTrack()
}

function syncTouchCursorUp() {
  touchCursorPressed.value = false
  unbindTouchWindowTrack()
}

function syncTouchCursorLeave() {
  // 按下拖出画布时不要清 pressed，交给 window 跟踪
  if (touchCursorPressed.value) {
    touchCursorVisible.value = false
    return
  }
  touchCursorVisible.value = false
}

watch(
  () => props.selectable,
  () => {
    touchCursorVisible.value = false
    touchCursorPressed.value = false
    unbindTouchWindowTrack()
  },
)

/** 底部悬浮模式 tab 占用高度（含间距），初始适配时避开 */
const BOTTOM_UI_SAFE = 56
/** 适配/重置视图边距（与组件检视留白无关，避免重置时被压到很小） */
const STAGE_PAD = 24

function fitView() {
  const stage = stageRef.value
  const phone = phoneRef.value
  panX.value = 0
  panY.value = 0
  if (!stage || !phone) {
    zoom.value = 1
    return
  }
  const availW = Math.max(1, stage.clientWidth - STAGE_PAD * 2)
  const availH = Math.max(
    1,
    stage.clientHeight - STAGE_PAD * 2 - BOTTOM_UI_SAFE,
  )
  const phoneW = phone.offsetWidth
  const phoneH = phone.offsetHeight
  if (phoneW < 1 || phoneH < 1) {
    zoom.value = 1
    return
  }
  zoom.value = clampZoom(Math.min(1, availW / phoneW, availH / phoneH))
}

function resetView() {
  fitView()
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
}

function onStageWheel(event: WheelEvent) {
  // 编辑态：滚轮直接缩放；预览态仍需 Ctrl/⌘，避免挡住页面滚动
  if (!props.selectable && !event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const stage = stageRef.value
  if (!stage) {
    const factor = event.deltaY > 0 ? 0.9 : 1 / 0.9
    zoom.value = clampZoom(zoom.value * factor)
    return
  }
  const rect = stage.getBoundingClientRect()
  const cx = event.clientX - rect.left
  const cy = event.clientY - rect.top
  const oldZoom = zoom.value
  const factor = event.deltaY > 0 ? 0.9 : 1 / 0.9
  const nextZoom = clampZoom(oldZoom * factor)
  if (nextZoom === oldZoom) return

  // world 以 center top 为原点：x = stageWidth/2，y = 0
  const ox = rect.width / 2
  const oy = 0
  const dx = cx - ox - panX.value
  const dy = cy - oy - panY.value
  const ratio = nextZoom / oldZoom
  panX.value = cx - ox - dx * ratio
  panY.value = cy - oy - dy * ratio
  zoom.value = nextZoom
}

function endPan(target?: HTMLElement | null) {
  if (!panning.value) return
  panning.value = false
  if (panPointerId != null && target) {
    try {
      target.releasePointerCapture(panPointerId)
    } catch {
      // ignore
    }
  }
  panPointerId = null
}

function onStagePointerDown(event: PointerEvent) {
  syncTouchCursorDown(event)
  // 中键拖动画布
  if (event.button !== 1) return
  event.preventDefault()
  event.stopPropagation()
  panning.value = true
  panStartClientX = event.clientX
  panStartClientY = event.clientY
  panOriginX = panX.value
  panOriginY = panY.value
  panPointerId = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onStagePointerMove(event: PointerEvent) {
  syncTouchCursorMove(event)
  if (!panning.value) return
  panX.value = panOriginX + (event.clientX - panStartClientX)
  panY.value = panOriginY + (event.clientY - panStartClientY)
}

function onStagePointerUp(event: PointerEvent) {
  syncTouchCursorUp()
  if (event.button !== 1 && !panning.value) return
  endPan(event.currentTarget as HTMLElement)
}

function onStagePointerLeave() {
  syncTouchCursorLeave()
}

/** ????????????? */
function onStageMouseDown(event: MouseEvent) {
  if (event.button === 1) {
    event.preventDefault()
  }
}

function onStageAuxClick(event: MouseEvent) {
  if (event.button === 1) {
    event.preventDefault()
  }
}

onMounted(() => {
  stageRef.value?.addEventListener('wheel', onStageWheel, { passive: false })
  window.addEventListener('resize', scheduleMeasureSync)
  window.addEventListener('scroll', scheduleMeasureSync, true)
  void nextTick(() => {
    fitView()
    // 等一帧再适配，确保手机框尺寸已布局完成
    requestAnimationFrame(() => fitView())
  })
})

watch(
  () => [props.canvasWidth, props.canvasHeight] as const,
  async () => {
    await nextTick()
    requestAnimationFrame(() => fitView())
  },
)

onBeforeUnmount(() => {
  endPan()
  unbindTouchWindowTrack()
  stageRef.value?.removeEventListener('wheel', onStageWheel)
  window.removeEventListener('resize', scheduleMeasureSync)
  window.removeEventListener('scroll', scheduleMeasureSync, true)
  if (measureSyncRaf) cancelAnimationFrame(measureSyncRaf)
  if (measureLiveRaf) cancelAnimationFrame(measureLiveRaf)
  measureLiveRaf = 0
})

watch(
  [
    showMeasureOverlay,
    () => props.selectedId,
    hoveredNodeId,
    zoom,
    toolMode,
  ],
  async () => {
    await nextTick()
    scheduleMeasureSync()
    if (showMeasureOverlay.value) startMeasureLiveSync()
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <div
    ref="stageRef"
    class="stage"
    :class="{ panning, 'is-preview-touch': showTouchCursor }"
    @pointerdown="onStagePointerDown"
    @pointermove="onStagePointerMove"
    @pointerup="onStagePointerUp"
    @pointercancel="onStagePointerUp"
    @pointerleave="onStagePointerLeave"
    @mousedown="onStageMouseDown"
    @auxclick="onStageAuxClick"
    @click="handleStageClick"
  >
    <IconSprite
      v-if="iconLibrary"
      :library="iconLibrary"
    />
    <div
      v-if="showAddButton || showAddDebugButton || showDeleteButton"
      class="stage-toolbar color-pick-ignore"
    >
      <el-tooltip v-if="showAddDebugButton" content="添加调试元素" placement="left">
        <el-button type="warning" circle class="btn-plus-bug" @click="emit('add-debug')">
          <span class="plus-bug-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M11 3h2v2.06c1.72.34 3.1 1.5 3.74 3.09L19 7.5l1 1.73-2.1 1.21c.07.41.1.84.1 1.28v.5h2.5v2H18v.5c0 .44-.03.87-.1 1.28L20 17.77 19 19.5l-2.26-.65A5.98 5.98 0 0 1 13 18.94V21h-2v-2.06a5.98 5.98 0 0 1-3.74-3.09L5 19.5l-1-1.73 2.1-1.21A7.4 7.4 0 0 1 6 13.5v-.5H3.5v-2H6v-.5c0-.44.03-.87.1-1.28L4 9.23 5 7.5l2.26.65A5.98 5.98 0 0 1 11 5.06V3zm1 4a4 4 0 0 0-4 4v2a4 4 0 0 0 8 0v-2a4 4 0 0 0-4-4zm-1 3h2v4h-2v-4z"
              />
              <path
                fill="currentColor"
                d="M17.5 2.5h1.5v1.5H20.5v1.5h-1.5V7h-1.5V5.5H16V4h1.5z"
              />
            </svg>
          </span>
        </el-button>
      </el-tooltip>
      <el-tooltip v-if="showAddButton" content="添加控件 / 组件" placement="left">
        <el-button type="primary" circle :icon="Plus" @click="emit('add')" />
      </el-tooltip>
      <el-tooltip v-if="showDeleteButton" content="删除" placement="left">
        <el-button type="danger" circle :icon="Delete" @click="emit('delete')" />
      </el-tooltip>
    </div>

    <div
      class="stage-world"
      :class="{ 'is-component': phoneFitContent }"
      :style="worldStyle"
    >
      <div
        class="phone-slot"
        :class="{
          'is-framed': phoneFitContent,
          'center-x': centerPhoneX,
          'center-y': centerPhoneY,
        }"
        :style="phoneFitContent ? phoneSlotStyle : undefined"
      >
        <div class="phone-shell">
        <div
          ref="phoneRef"
          class="phone"
          :class="{
            'is-picking': colorPickState.picking.value,
            'is-fit-content': phoneFitContent,
            'is-width-fit-content': Boolean(phoneWidthFitContent),
            'is-edit': selectable,
            'is-preview': showTouchCursor,
            'is-miniprogram': showDeviceChrome && scene === 'miniprogram',
            'has-status-bar': showDeviceChrome,
            'has-navigation-bar': showNavigationBar,
            'status-bar-cover': showDeviceChrome && statusBarCover,
          }"
          :style="phoneFrameStyle"
          @click="handlePhoneClick"
          @mouseleave="clearHover"
        >
        <div
          v-if="showDeviceChrome"
          class="device-status-bar color-pick-ignore"
          :class="{
            selectable: statusBarSelectable,
            selected: statusBarSelected,
            cover: statusBarCover,
          }"
          :style="statusBarStyle"
          aria-hidden="true"
          @click="handleStatusBarSelect"
        >
          <span class="status-time">9:41</span>
          <div class="status-trailing">
            <svg class="status-icon status-signal" viewBox="0 0 17 12" fill="currentColor">
              <rect x="0" y="7.5" width="3" height="4.5" rx="0.75" />
              <rect x="4.5" y="5" width="3" height="7" rx="0.75" />
              <rect x="9" y="2.5" width="3" height="9.5" rx="0.75" />
              <rect x="13.5" y="0" width="3" height="12" rx="0.75" />
            </svg>
            <svg class="status-icon status-wifi" viewBox="0 0 16 12" fill="currentColor">
              <circle cx="8" cy="10.6" r="1.15" />
              <path
                d="M4.55 7.55a4.9 4.9 0 0 1 6.9 0l-1.15 1.2a3.25 3.25 0 0 0-4.6 0l-1.15-1.2Z"
              />
              <path
                d="M2.2 5.05a8.2 8.2 0 0 1 11.6 0l-1.15 1.2a6.55 6.55 0 0 0-9.3 0L2.2 5.05Z"
              />
              <path
                d="M.15 2.7a11.2 11.2 0 0 1 15.7 0l-1.15 1.2a9.55 9.55 0 0 0-13.4 0L.15 2.7Z"
              />
            </svg>
            <svg class="status-icon status-battery" viewBox="0 0 28 13" fill="none">
              <rect
                x="0.75"
                y="0.75"
                width="23.5"
                height="11.5"
                rx="2.5"
                stroke="currentColor"
                stroke-width="1.5"
                opacity="0.35"
              />
              <rect x="2.4" y="2.35" width="17.5" height="8.3" rx="1.5" fill="currentColor" />
              <rect
                x="25.2"
                y="4.1"
                width="2"
                height="4.8"
                rx="0.7"
                fill="currentColor"
                opacity="0.4"
              />
            </svg>
          </div>
        </div>
        <div
          v-if="showNavigationBar"
          class="device-navigation-bar color-pick-ignore"
          :class="{
            selectable: statusBarSelectable,
            selected: statusBarSelected,
            cover: statusBarCover,
          }"
          :style="navBarStyle"
          aria-hidden="true"
          @click="handleStatusBarSelect"
        >
          <span class="nav-title">{{ navigationBarTitleText }}</span>
        </div>
        <div
          v-if="showDeviceChrome && scene === 'miniprogram'"
          class="mp-capsule color-pick-ignore"
          :class="{ light: capsuleLight, 'in-nav-bar': showNavigationBar }"
          :style="capsuleStyle"
          aria-hidden="true"
        >
          <span class="mp-capsule-more" />
          <span class="mp-capsule-divider" />
          <span class="mp-capsule-close" />
        </div>
        <el-alert
          v-if="parsed.error"
          :title="parsed.error"
          type="error"
          show-icon
          :closable="false"
        />
        <!-- 隔离页面内容的 z-index，避免绝对定位控件压过角标/光标 -->
        <div
          v-else-if="parsed.root"
          class="phone-page-layer"
          @contextmenu="handleWidgetContextMenu"
        >
          <XmlNodeView
            :node="parsed.root"
            :node-id="rootId"
            :selected-id="selectable ? selectedId : inspectNodeId || ''"
            :hovered-id="hoveredNodeId"
            :selectable="selectable"
            :interact-enabled="!selectable"
            :expand-repeat="expandRepeat"
            :icon-library="iconLibrary"
            :page-data="pageData"
            :hidden-node-ids="hiddenNodeIds"
            :dollar-props="dollarProps"
            :route-params="routeParams"
            :preview-lifecycle-gate="previewLifecycleGate"
            :inspect-node-id="inspectNodeId"
            is-root
            @select="emit('select', $event)"
            @hover="handleHover"
            @open-repeat="emit('open-repeat', $event)"
            @open-event="emit('open-event', $event)"
            @open-inspect="emit('open-inspect', $event)"
            @add-window="emit('add-window', $event)"
            @interact="emit('interact', $event)"
          />
        </div>
        <div ref="modalHostRef" class="phone-modal-host" />
        <div
          v-if="selectable"
          class="phone-screen-frame"
          aria-hidden="true"
        />
        <div
          ref="badgeHostRef"
          class="phone-badge-host"
        >
          <div
            v-if="showMeasureOverlay"
            class="distance-guides"
            aria-hidden="true"
          >
            <div
              v-for="(g, i) in measureGuides"
              :key="`${g.side}-${i}`"
              class="distance-guide"
              :class="g.side"
              :style="{
                left: `${g.left}px`,
                top: `${g.top}px`,
                width: g.width ? `${g.width}px` : undefined,
                height: g.height ? `${g.height}px` : undefined,
              }"
            >
              <span class="distance-line" />
              <span class="distance-label">{{ g.value }}</span>
            </div>
            <div
              v-if="measureSizeLabel"
              class="size-label"
              :style="{
                left: `${measureSizeLabel.left}px`,
                top: `${measureSizeLabel.top}px`,
              }"
            >
              {{ measureSizeLabel.text }}
            </div>
          </div>
        </div>
        <Transition name="phone-toast">
          <div
            v-if="toast?.message"
            :key="toast.id"
            class="phone-toast"
            role="status"
          >
            {{ toast.message }}
          </div>
        </Transition>
      </div>
        </div>
      </div>
    </div>

    <!-- 挂在 stage 层，避免被右侧工具条盖住导致点不中 -->
    <div
      v-show="!selectable && inspectMode === 'component'"
      ref="inspectHostRef"
      class="stage-inspect-host"
    />

    <!-- 预览手指光标：挂 stage，不被手机框 overflow 裁切 -->
    <div
      v-show="showTouchCursor && touchCursorVisible"
      class="stage-touch-cursor"
      :class="{ 'is-pressed': touchCursorPressed }"
      :style="touchCursorStyle"
      aria-hidden="true"
    />

    <div
      v-if="alignGuides.length"
      class="align-guides color-pick-ignore"
      aria-hidden="true"
    >
      <div
        v-for="(g, i) in alignGuides"
        :key="`${g.axis}-${g.tone}-${i}`"
        class="align-guide"
        :class="[g.axis, g.tone]"
        :style="
          g.axis === 'h'
            ? { top: `${g.pos}px` }
            : { left: `${g.pos}px` }
        "
      />
    </div>

    <div class="stage-status color-pick-ignore">
      <div
        v-if="selectable"
        class="scene-tabs tool-tabs"
        role="tablist"
        aria-label="画布工具"
      >
        <button
          type="button"
          role="tab"
          class="scene-tab tool-tab"
          :class="{ active: toolMode === 'select' }"
          :aria-selected="toolMode === 'select'"
          title="选择"
          @click="toolMode = 'select'"
        >
          <svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3.2 1.4a.7.7 0 0 1 .76-.1l9.2 4.5a.7.7 0 0 1-.08 1.3L9.1 8.5l3.4 5.1a.7.7 0 0 1-.2.96l-1.35.9a.7.7 0 0 1-.96-.2L6.7 10.3l-2.5 2.4a.7.7 0 0 1-1.2-.46V2a.7.7 0 0 1 .2-.6Z"
            />
          </svg>
        </button>
        <button
          type="button"
          role="tab"
          class="scene-tab tool-tab"
          :class="{ active: toolMode === 'measure' }"
          :aria-selected="toolMode === 'measure'"
          title="测量"
          @click="toolMode = 'measure'"
        >
          <svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M1.6 11.8 11.8 1.6a1.4 1.4 0 0 1 2 2L3.6 13.8a1.4 1.4 0 0 1-2-2Zm9.3-8.6.7.7-1.1 1.1-.7-.7 1.1-1.1Zm-1.8 1.8.7.7-1.1 1.1-.7-.7 1.1-1.1Zm-1.8 1.8.7.7-1.1 1.1-.7-.7 1.1-1.1Zm-1.8 1.8.7.7-1.2 1.2-.7-.7 1.2-1.2Z"
            />
          </svg>
        </button>
      </div>
      <div
        v-if="!selectable"
        class="scene-tabs tool-tabs"
        role="tablist"
        aria-label="预览检视模式"
      >
        <button
          type="button"
          role="tab"
          class="scene-tab tool-tab"
          :class="{ active: inspectMode === 'clean' }"
          :aria-selected="inspectMode === 'clean'"
          title="纯净模式"
          @click="inspectMode = 'clean'"
        >
          <svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 2.2c3.6 0 6.5 2.6 7.2 5.8-.7 3.2-3.6 5.8-7.2 5.8S1.5 11.2.8 8C1.5 4.8 4.4 2.2 8 2.2Zm0 1.5c-2.7 0-5 1.9-5.6 4.3.6 2.4 2.9 4.3 5.6 4.3s5-1.9 5.6-4.3C13 5.6 10.7 3.7 8 3.7Zm0 1.6a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Zm0 1.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"
            />
          </svg>
        </button>
        <button
          type="button"
          role="tab"
          class="scene-tab tool-tab"
          :class="{ active: inspectMode === 'component' }"
          :aria-selected="inspectMode === 'component'"
          title="组件模式"
          @click="inspectMode = 'component'"
        >
          <svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6.2 1.4h3.6l1.2 1.2v2.4H14l1.2 1.2v3.6L14 10.8h-2.4V14L10.4 15.2H6.8L5.6 14v-3.2H3.2L2 9.6V6l1.2-1.2h2.4V2.6L6.2 1.4Zm.6 1.5v2.5H4.2v2.8h2.6v2.5h2.4v-2.5h2.6V5.4H9.2V2.9H6.8Z"
            />
          </svg>
        </button>
      </div>
      <div class="scene-tabs" role="tablist" aria-label="画布场景">
        <button
          v-for="tab in sceneTabs"
          :key="tab.key"
          type="button"
          role="tab"
          class="scene-tab"
          :class="{ active: scene === tab.key }"
          :aria-selected="scene === tab.key"
          @click="scene = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
      <span
        class="zoom-label"
        :title="selectable ? '滚轮缩放' : 'Ctrl + 滚轮缩放'"
      >{{ zoomPercent }}%</span>
      <el-tooltip content="重置视图 · Ctrl+0" placement="left">
        <el-button
          class="pan-reset"
          :class="{ visible: viewMoved }"
          circle
          :icon="RefreshRight"
          :disabled="!viewMoved"
          @click="resetView"
        />
      </el-tooltip>
    </div>

    <div
      v-if="colorPickState.picking.value"
      class="pick-overlay color-pick-ignore"
      @click="colorPickState.cancelPick()"
    >
      <span>??????????????</span>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  height: 100%;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background:
    linear-gradient(90deg, rgba(15, 23, 42, 0.04) 1px, transparent 1px),
    linear-gradient(rgba(15, 23, 42, 0.04) 1px, transparent 1px);
  background-size: 16px 16px;
  background-color: #e8edf3;
  cursor: default;
}

.stage.is-preview-touch {
  cursor: none;
}

/* 仅内容区隐藏系统光标；工具栏等 chrome 保留 pointer */
.stage.is-preview-touch .stage-world,
.stage.is-preview-touch .phone,
.stage.is-preview-touch .phone :deep(*) {
  cursor: none;
}

.stage.is-preview-touch .color-pick-ignore,
.stage.is-preview-touch .color-pick-ignore :deep(button),
.stage.is-preview-touch .color-pick-ignore :deep(.el-button),
.stage.is-preview-touch .inspect-callout,
.stage.is-preview-touch .inspect-callout :deep(button) {
  cursor: pointer !important;
}

.stage.panning,
.stage.panning :deep(*) {
  cursor: grabbing !important;
}

.stage-world {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 24px;
  width: 100%;
  height: 100%;
  min-width: 100%;
  min-height: 100%;
  box-sizing: border-box;
}

.stage-world.is-component {
  align-items: center;
}

.phone-slot.is-framed {
  display: flex;
  flex-shrink: 0;
  box-sizing: border-box;
  justify-content: flex-start;
  align-items: flex-start;
}

.phone-slot:not(.is-framed) {
  display: contents;
}

/* 与原先 .phone 作为 stage-world 子项时一致：占满高度，否则内部 flex:1 页面层会塌成 0 */
.phone-shell {
  position: relative;
  flex-shrink: 0;
  height: 100%;
  box-sizing: border-box;
  overflow: visible;
}

/* 小于屏宽/屏高时 shell 随内容，才能在 phone-slot 内真正居中 */
.phone-slot.is-framed .phone-shell {
  max-width: 100%;
  max-height: 100%;
  box-sizing: border-box;
}
.phone-slot.is-framed:not(.center-x) .phone-shell {
  width: 100%;
}
.phone-slot.is-framed:not(.center-y) .phone-shell {
  height: 100%;
}
.phone-slot.is-framed.center-x .phone-shell {
  width: auto;
}
.phone-slot.is-framed.center-y .phone-shell {
  height: auto;
}

.stage-inspect-host {
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
  overflow: visible;
}

.stage-inspect-host :deep(.inspect-callout) {
  pointer-events: auto;
}

.phone-slot.center-x {
  justify-content: center;
}

.phone-slot.center-y {
  align-items: center;
}

.stage-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: flex;
  gap: 8px;
}

.btn-plus-bug :deep(span) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.plus-bug-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  line-height: 0;
}

.plus-bug-icon svg {
  display: block;
}

.stage-status {
  --ctrl-h: 28px;
  position: absolute;
  right: 16px;
  /* 避开底部悬浮模式 tab */
  bottom: 64px;
  /* 低于检视层；空白处穿透，避免挡住操纵杆 */
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.stage-status > * {
  pointer-events: auto;
}

.scene-tabs {
  display: inline-flex;
  align-items: stretch;
  box-sizing: border-box;
  height: var(--ctrl-h);
  padding: 2px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e4e7ed;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.scene-tab {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  border: none;
  background: transparent;
  color: #606266;
  font-size: 12px;
  line-height: 1;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.scene-tab:hover {
  color: #303133;
}

.scene-tab.active {
  background: #ecf5ff;
  color: #409eff;
  font-weight: 600;
}

.tool-tab {
  width: 28px;
  padding: 0;
}

.tool-icon {
  display: block;
  width: 14px;
  height: 14px;
}

.zoom-label {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--ctrl-h);
  min-width: 48px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e4e7ed;
  color: #606266;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  user-select: none;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.stage-status :deep(.pan-reset) {
  box-sizing: border-box;
  width: var(--ctrl-h);
  height: var(--ctrl-h);
  min-height: var(--ctrl-h);
  padding: 0;
  opacity: 0.35;
  transition: opacity 0.15s ease;
}

.stage-status :deep(.pan-reset.visible) {
  opacity: 1;
}

/* 系统状态栏：时间 · 信号 · Wi‑Fi · 电量 */
.device-status-bar {
  flex-shrink: 0;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  background: #fff;
  color: #111;
  pointer-events: none;
  z-index: 6;
  box-sizing: border-box;
  outline: calc(1px / var(--canvas-zoom, 1)) solid transparent;
  outline-offset: calc(-1px / var(--canvas-zoom, 1));
  transition: outline-color 0.12s ease;
}

.device-status-bar.selectable {
  pointer-events: auto;
  cursor: pointer;
}

.device-status-bar.selectable:hover {
  outline-color: rgba(64, 158, 255, 0.55);
}

.device-status-bar.selected {
  outline-color: #409eff;
}

.device-status-bar.cover {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  flex-shrink: 0;
}

/* 微信原生标题栏（navigationBar） */
.device-navigation-bar {
  flex-shrink: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 96px 0 16px;
  box-sizing: border-box;
  pointer-events: none;
  z-index: 6;
  outline: calc(1px / var(--canvas-zoom, 1)) solid transparent;
  outline-offset: calc(-1px / var(--canvas-zoom, 1));
  transition: outline-color 0.12s ease;
}

.device-navigation-bar.selectable {
  pointer-events: auto;
  cursor: pointer;
}

.device-navigation-bar.selectable:hover {
  outline-color: rgba(64, 158, 255, 0.55);
}

.device-navigation-bar.selected {
  outline-color: #409eff;
}

.device-navigation-bar.cover {
  position: absolute;
  top: 22px;
  left: 0;
  right: 0;
}

.nav-title {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.status-time {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.status-trailing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.status-icon {
  display: block;
  flex-shrink: 0;
  color: inherit;
}

.status-signal {
  width: 14px;
  height: 10px;
}

.status-wifi {
  width: 13px;
  height: 10px;
}

.status-battery {
  width: 22px;
  height: 10px;
}

/* 小程序标题栏胶囊：三点 · 关闭环；位置尺寸与 device-info EDITOR_MENU_BUTTON 对齐 */
.mp-capsule {
  position: absolute;
  top: 30px;
  right: 7px;
  z-index: 8;
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 2px;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.6);
  box-sizing: border-box;
  pointer-events: none;
}

.mp-capsule.light {
  border-color: rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.15);
}

.mp-capsule.light .mp-capsule-more::before {
  background: #fff;
  box-shadow:
    -6px 0 0 -0.5px #fff,
    6px 0 0 -0.5px #fff;
}

.mp-capsule.light .mp-capsule-divider {
  background: rgba(255, 255, 255, 0.35);
}

.mp-capsule.light .mp-capsule-close::before {
  border-color: #fff;
}

.mp-capsule.light .mp-capsule-close::after {
  background: #fff;
}

.mp-capsule-more,
.mp-capsule-close {
  position: relative;
  width: 36px;
  height: 28px;
  flex-shrink: 0;
}

/* 三点：中间略大 */
.mp-capsule-more::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: #111;
  box-shadow:
    -6px 0 0 -0.5px #111,
    6px 0 0 -0.5px #111;
}

.mp-capsule-divider {
  width: 1px;
  height: 16px;
  background: rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
}

/* 关闭：外环 + 实心圆心 */
.mp-capsule-close::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 15px;
  height: 15px;
  margin: -7.5px 0 0 -7.5px;
  border-radius: 50%;
  border: 2.5px solid #111;
  box-sizing: border-box;
}

.mp-capsule-close::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: #111;
}

.phone.has-status-bar > .phone-page-layer > :deep(.select-shell) {
  flex: 1 1 auto;
  min-height: 0;
}

.phone.status-bar-cover > .phone-page-layer > :deep(.select-shell) {
  /* 重叠时页面仍铺满手机框，状态栏浮层不占流 */
  flex: 1 1 auto;
  min-height: 0;
}

.phone-page-layer {
  position: relative;
  z-index: 0;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 困住页面内任意 z-index，避免压过角标/手指光标 */
  isolation: isolate;
}

.phone.is-miniprogram {
  border-radius: 0;
}

.phone {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 667px;
  height: 100%;
  background: #fff;
  border: 1px solid #d0d7de;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

.phone.is-preview {
  cursor: none;
  /* ??????/?????? touch-action??????? */
  touch-action: auto;
}

.phone.is-preview :deep(*) {
  cursor: none;
}

.phone.is-preview :deep(.overlay-scroll-body.is-drag-scrolling),
.phone.is-preview :deep(.overlay-scroll-body.is-drag-scrolling *) {
  cursor: grabbing;
}

.stage-touch-cursor {
  position: absolute;
  z-index: 100050;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border-radius: 50%;
  background: rgba(64, 158, 255, 0.28);
  border: 2px solid rgba(64, 158, 255, 0.55);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
  pointer-events: none;
  transform: scale(1);
  transition: transform 0.08s ease, background 0.08s ease, border-color 0.08s ease;
}

.stage-touch-cursor.is-pressed {
  background: rgba(64, 158, 255, 0.42);
  border-color: rgba(64, 158, 255, 0.75);
  transform: scale(1.2);
}

.phone-modal-host {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
  overflow: hidden;
}

.phone-modal-host :deep(.modal-overlay) {
  pointer-events: auto;
}

.phone-screen-frame {
  position: absolute;
  inset: 0;
  z-index: 200;
  pointer-events: none;
  box-sizing: border-box;
  border: calc(1px / var(--canvas-zoom, 1)) dashed #1677ff;
}

.phone-badge-host {
  position: absolute;
  inset: 0;
  z-index: 100040;
  pointer-events: none;
  overflow: visible;
}

.phone-badge-host :deep(.badge-stack) {
  pointer-events: auto;
}

.distance-guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 30;
  overflow: visible;
}

.align-guides {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
}

.align-guide {
  position: absolute;
  pointer-events: none;
  box-sizing: border-box;
}

.align-guide.h {
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px dashed transparent;
}

.align-guide.v {
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px dashed transparent;
}

.align-guide.selected {
  border-color: #d48806;
}

.align-guide.hovered {
  border-color: #c41d7f;
}

.distance-guide {
  position: absolute;
  pointer-events: none;
  color: #f5222d;
}

.distance-guide .distance-line {
  position: absolute;
  background: #f5222d;
}

.distance-guide.left .distance-line,
.distance-guide.right .distance-line,
.distance-guide.h .distance-line {
  left: 0;
  right: 0;
  top: 0;
  height: calc(1px / var(--canvas-zoom, 1));
  transform: translateY(-50%);
}

.distance-guide.top .distance-line,
.distance-guide.bottom .distance-line,
.distance-guide.v .distance-line {
  top: 0;
  bottom: 0;
  left: 0;
  width: calc(1px / var(--canvas-zoom, 1));
  transform: translateX(-50%);
}

.distance-guide .distance-label {
  position: absolute;
  z-index: 1;
  padding: 0 calc(3px / var(--canvas-zoom, 1));
  font-size: calc(11px / var(--canvas-zoom, 1));
  font-weight: 600;
  line-height: calc(14px / var(--canvas-zoom, 1));
  color: #f5222d;
  background: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  user-select: none;
}

.distance-guide.left .distance-label,
.distance-guide.right .distance-label,
.distance-guide.h .distance-label {
  left: 50%;
  top: 0;
  transform: translate(-50%, calc(-100% - 2px / var(--canvas-zoom, 1)));
}

.distance-guide.top .distance-label,
.distance-guide.bottom .distance-label,
.distance-guide.v .distance-label {
  left: 0;
  top: 50%;
  transform: translate(calc(100% + 2px / var(--canvas-zoom, 1)), -50%);
}

.size-label {
  position: absolute;
  z-index: 2;
  transform: translateX(-50%);
  padding: calc(1px / var(--canvas-zoom, 1)) calc(6px / var(--canvas-zoom, 1));
  border-radius: calc(3px / var(--canvas-zoom, 1));
  font-size: calc(11px / var(--canvas-zoom, 1));
  font-weight: 600;
  line-height: calc(16px / var(--canvas-zoom, 1));
  color: #fff;
  background: #f5222d;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
}

/* ?????????? Swiper ?????????? */
.phone.is-edit {
  overflow: visible;
}

.phone-toast {
  position: absolute;
  left: 50%;
  bottom: 72px;
  z-index: 100;
  transform: translateX(-50%);
  max-width: calc(100% - 48px);
  padding: 10px 16px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.86);
  color: #fff;
  font-size: 14px;
  line-height: 1.4;
  text-align: center;
  word-break: break-word;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
}

.phone-toast-enter-active,
.phone-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.phone-toast-enter-from,
.phone-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.phone.is-fit-content {
  height: auto;
  min-height: 0;
  /* 组件画布：去掉整机边框，只保留内容框 */
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

/* width=wrap_content：框随内容，避免 flex 子项 stretch 把宽度撑回屏宽 */
.phone.is-width-fit-content > .phone-page-layer {
  flex: 0 0 auto;
  align-self: flex-start;
  width: fit-content;
  max-width: 100%;
}

.phone.is-picking {
  cursor: crosshair;
}

.pick-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12px;
  background: rgba(15, 23, 42, 0.08);
  color: #303133;
  font-size: 13px;
  cursor: crosshair;
}
</style>
