import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Alert, Button, Tooltip } from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  RedoOutlined,
} from '@ant-design/icons'
import { colorPickState, useColorPick } from '../../composables/useColorPick'
import {
  BadgeHostContext,
  CanvasToolModeContext,
  ModalHostContext,
  ModalStackContext,
  PreviewInspectModeContext,
  PreviewInstancePropOverridesContext,
  createModalStack,
  type CanvasToolMode,
  type ModalStackApi,
  type PreviewInspectMode,
} from '../../composables/useModalStack'
import {
  InspectHostContext,
  OpenInspectContext,
  PhoneFrameContext,
} from '../../composables/useInspectCalloutLayout'
import { CanvasRuntimeContext } from '../../composables/useCanvasRuntime'
import {
  ComponentRenderMapContext,
  PageLivePageDataContext,
} from '../../composables/useComponentRenderMap'
import { EDITOR_MENU_BUTTON, getDeviceInfo } from '../../utils/device-info'
import type { IconLibrary } from '../../types/icon-library'
import type { PageData } from '../../types/page-data'
import type { ComponentRenderMap } from '../../types/component-render'
import type { PreviewInspectPayload } from '../../types/preview-inspect'
import type { PreviewInteractPayload } from '../../utils/event-runtime'
import { buildRepeatExpandKey, expandRepeatTree } from '../../utils/repeat'
import { parsePageXml, type XmlNode } from '../../utils/xml'
import IconSprite from './IconSprite'
import XmlNodeView from './XmlNodeView'
import { STATUS_BAR_NODE_ID } from '../../utils/status-bar'
import './PageCanvas.css'

const sceneTabs = [
  { key: 'h5' as const, label: 'H5' },
  { key: 'miniprogram' as const, label: '微信小程序' },
]

function useControllable<T>(
  value: T | undefined,
  onChange: ((next: T) => void) | undefined,
  defaultValue: T,
) {
  const [inner, setInner] = useState(defaultValue)
  const current = value !== undefined ? value : inner
  const set = useCallback(
    (next: T) => {
      if (value === undefined) setInner(next)
      onChange?.(next)
    },
    [onChange, value],
  )
  return [current, set] as const
}

export default function PageCanvas({
  xml,
  canvasWidth,
  selectedId,
  selectable,
  showAddButton,
  showAddDebugButton,
  showDeleteButton,
  expandRepeat,
  pageData,
  iconLibrary,
  hiddenNodeIds,
  componentMap,
  canvasHeight,
  phoneWidthFitContent,
  dollarProps,
  routeParams,
  projectPath,
  previewLifecycleGate,
  toast,
  modalStack,
  showDeviceChrome,
  phoneScreenWidth,
  phoneScreenHeight,
  statusBarSelectable,
  statusBarBackground,
  statusBarTextStyle,
  statusBarCover: statusBarCoverProp,
  statusBarNavigationBar,
  navigationBarTitle,
  inspectNodeId,
  instancePropOverrides,
  scene: sceneProp,
  onSceneChange,
  inspectMode: inspectModeProp,
  onInspectModeChange,
  panX: panXProp,
  onPanXChange,
  panY: panYProp,
  onPanYChange,
  zoom: zoomProp,
  onZoomChange,
  onSelect,
  onAdd,
  onAddDebug,
  onDelete,
  onOpenRepeat,
  onOpenEvent,
  onOpenInspect,
  onClearInspect,
  onAddWindow,
  onInteract,
  onContextMenu,
}: {
  xml: string
  canvasWidth: number
  selectedId?: string
  selectable?: boolean
  showAddButton?: boolean
  showAddDebugButton?: boolean
  showDeleteButton?: boolean
  expandRepeat?: boolean
  pageData?: PageData
  iconLibrary?: IconLibrary
  hiddenNodeIds?: string[]
  componentMap?: ComponentRenderMap
  canvasHeight?: number | 'auto'
  phoneWidthFitContent?: boolean
  dollarProps?: Record<string, unknown>
  routeParams?: Record<string, unknown>
  projectPath?: string
  previewLifecycleGate?: number
  toast?: { message: string; id: number } | null
  modalStack?: ModalStackApi
  showDeviceChrome?: boolean
  phoneScreenWidth?: number
  phoneScreenHeight?: number
  statusBarSelectable?: boolean
  statusBarBackground?: string
  statusBarTextStyle?: 'black' | 'white'
  statusBarCover?: boolean
  statusBarNavigationBar?: boolean
  navigationBarTitle?: string
  inspectNodeId?: string
  instancePropOverrides?: Record<string, Record<string, unknown>>
  scene?: 'h5' | 'miniprogram'
  onSceneChange?: (scene: 'h5' | 'miniprogram') => void
  inspectMode?: PreviewInspectMode
  onInspectModeChange?: (mode: PreviewInspectMode) => void
  panX?: number
  onPanXChange?: (value: number) => void
  panY?: number
  onPanYChange?: (value: number) => void
  zoom?: number
  onZoomChange?: (value: number) => void
  onSelect?: (id: string) => void
  onAdd?: () => void
  onAddDebug?: () => void
  onDelete?: () => void
  onOpenRepeat?: (id: string) => void
  onOpenEvent?: (id: string) => void
  onOpenInspect?: (payload: PreviewInspectPayload) => void
  onClearInspect?: () => void
  onAddWindow?: (parentId: string) => void
  onInteract?: (payload: PreviewInteractPayload) => void
  onContextMenu?: (payload: { nodeId: string; x: number; y: number }) => void
}) {
  const { picking } = useColorPick()
  const fallbackModalStack = useMemo(() => createModalStack(), [])
  const resolvedModalStack = modalStack ?? fallbackModalStack
  const modalHostRef = useRef<HTMLElement | null>(null)
  const badgeHostRef = useRef<HTMLElement | null>(null)
  const inspectHostRef = useRef<HTMLElement | null>(null)
  const phoneRef = useRef<HTMLElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [toolMode, setToolMode] = useState<CanvasToolMode>('select')
  const [scene, setScene] = useControllable(sceneProp, onSceneChange, 'h5')
  const [inspectMode, setInspectMode] = useControllable(
    inspectModeProp,
    onInspectModeChange,
    'clean',
  )
  const [panX, setPanX] = useControllable(panXProp, onPanXChange, 0)
  const [panY, setPanY] = useControllable(panYProp, onPanYChange, 0)
  const [zoom, setZoom] = useControllable(zoomProp, onZoomChange, 1)
  const instancePropOverridesValue = instancePropOverrides ?? {}

  const canvasRuntime = useMemo(
    () => ({
      getDeviceInfo: () =>
        getDeviceInfo({
          platform: scene,
          windowWidth: canvasWidth,
        }),
      projectPath,
    }),
    [canvasWidth, projectPath, scene],
  )

  const openInspect = useCallback(
    (payload: PreviewInspectPayload) => onOpenInspect?.(payload),
    [onOpenInspect],
  )

  useEffect(() => {
    if (selectable) resolvedModalStack.closeAll()
  }, [resolvedModalStack, selectable])

  const cachedPageExpandKeyRef = useRef('')
  const cachedPageRootRef = useRef<XmlNode | null>(null)

  const parsed = useMemo(() => {
    if (!xml.trim()) {
      cachedPageExpandKeyRef.current = ''
      cachedPageRootRef.current = null
      return { root: null as XmlNode | null, error: '?? XML ??' }
    }
    try {
      const root = parsePageXml(xml)
      if (!expandRepeat || !root) {
        return { root, error: '' }
      }
      const expandKey = `${xml}\0${buildRepeatExpandKey(pageData, dollarProps)}`
      if (expandKey === cachedPageExpandKeyRef.current && cachedPageRootRef.current) {
        return { root: cachedPageRootRef.current, error: '' }
      }
      const viewRoot = expandRepeatTree(root, pageData, dollarProps)
      cachedPageExpandKeyRef.current = expandKey
      cachedPageRootRef.current = viewRoot
      return { root: viewRoot, error: '' }
    } catch (err) {
      cachedPageExpandKeyRef.current = ''
      cachedPageRootRef.current = null
      return {
        root: null as XmlNode | null,
        error: err instanceof Error ? err.message : 'XML ????',
      }
    }
  }, [dollarProps, expandRepeat, pageData, xml])

  const rootId = parsed.root ? `0:${parsed.root.tag}` : ''
  const [hoveredNodeId, setHoveredNodeId] = useState('')

  const phoneFrameStyle = useMemo(() => {
    const style: Record<string, string> = {
      '--canvas-zoom': String(zoom || 1),
    }
    if (phoneWidthFitContent) {
      const maxW =
        (typeof phoneScreenWidth === 'number' && phoneScreenWidth > 0
          ? phoneScreenWidth
          : canvasWidth) || 375
      style.width = 'fit-content'
      style.maxWidth = `${maxW}px`
      style.minWidth = '0'
    } else {
      style.width = `${canvasWidth}px`
    }
    if (typeof canvasHeight === 'number' && Number.isFinite(canvasHeight)) {
      style.height = `${canvasHeight}px`
      style.minHeight = `${canvasHeight}px`
    } else if (canvasHeight === 'auto') {
      style.height = 'auto'
      style.minHeight = '0'
    }
    return style as CSSProperties
  }, [canvasHeight, canvasWidth, phoneScreenWidth, phoneWidthFitContent, zoom])

  type MeasureRect = { left: number; top: number; right: number; bottom: number }
  type MeasureGuide = {
    side: 'left' | 'right' | 'top' | 'bottom' | 'h' | 'v'
    value: number
    left: number
    top: number
    width: number
    height: number
  }
  type AlignGuide = {
    axis: 'h' | 'v'
    pos: number
    tone: 'selected' | 'hovered'
  }

  const [measureGuides, setMeasureGuides] = useState<MeasureGuide[]>([])
  const [alignGuides, setAlignGuides] = useState<AlignGuide[]>([])
  const [measureSizeLabel, setMeasureSizeLabel] = useState<{
    text: string
    left: number
    top: number
  } | null>(null)
  const measureSyncRafRef = useRef(0)
  const measureLiveRafRef = useRef(0)

  const showMeasureOverlay = Boolean(selectable) && toolMode === 'measure' && Boolean(selectedId)

  function toLocalRect(host: HTMLElement, hr: DOMRect, rect: DOMRect): MeasureRect {
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
      distances.push({
        side: 'h',
        value: Math.round(gap),
        left: a.right,
        top: y,
        width: gap,
        height: 0,
      })
      if (!yOverlap(a, b)) {
        pushAlignV(aBox.right, 'selected')
        pushAlignV(bBox.left, 'hovered')
      }
    } else if (b.right < a.left - 0.5) {
      const gap = a.left - b.right
      distances.push({
        side: 'h',
        value: Math.round(gap),
        left: b.right,
        top: y,
        width: gap,
        height: 0,
      })
      if (!yOverlap(a, b)) {
        pushAlignV(bBox.right, 'hovered')
        pushAlignV(aBox.left, 'selected')
      }
    }

    if (a.bottom < b.top - 0.5) {
      const gap = b.top - a.bottom
      distances.push({
        side: 'v',
        value: Math.round(gap),
        left: x,
        top: a.bottom,
        width: 0,
        height: gap,
      })
      if (!xOverlap(a, b)) {
        pushAlignH(aBox.bottom, 'selected')
        pushAlignH(bBox.top, 'hovered')
      }
    } else if (b.bottom < a.top - 0.5) {
      const gap = a.top - b.bottom
      distances.push({
        side: 'v',
        value: Math.round(gap),
        left: x,
        top: b.bottom,
        width: 0,
        height: gap,
      })
      if (!xOverlap(a, b)) {
        pushAlignH(bBox.bottom, 'hovered')
        pushAlignH(aBox.top, 'selected')
      }
    }

    return { distances, aligns }
  }

  function syncMeasureOverlay() {
    const host = badgeHostRef.current
    const phone = phoneRef.current
    const stage = stageRef.current
    if (!host || !phone || !showMeasureOverlay) {
      setMeasureGuides([])
      setAlignGuides([])
      setMeasureSizeLabel(null)
      return
    }

    const selectedEl = phone.querySelector('.content-box.selected') as HTMLElement | null
    if (!selectedEl) {
      setMeasureGuides([])
      setAlignGuides([])
      setMeasureSizeLabel(null)
      return
    }

    const hr = host.getBoundingClientRect()
    if (hr.width < 1 || hr.height < 1) {
      setMeasureGuides([])
      setAlignGuides([])
      setMeasureSizeLabel(null)
      return
    }

    const selected = toLocalRect(host, hr, selectedEl.getBoundingClientRect())
    const width = Math.max(0, Math.round(selected.right - selected.left))
    const height = Math.max(0, Math.round(selected.bottom - selected.top))
    const inv = 1 / (zoom || 1)
    setMeasureSizeLabel({
      text: `${width} × ${height}`,
      left: (selected.left + selected.right) / 2,
      top: selected.bottom + 4 * inv,
    })

    const canDistance = Boolean(hoveredNodeId) && hoveredNodeId !== selectedId
    if (!canDistance || !stage) {
      setMeasureGuides([])
      setAlignGuides([])
      return
    }

    const hoveredEl = phone.querySelector('.content-box.hovered') as HTMLElement | null
    if (!hoveredEl) {
      setMeasureGuides([])
      setAlignGuides([])
      return
    }

    const hovered = toLocalRect(host, hr, hoveredEl.getBoundingClientRect())
    const result = guidesBetween(selected, hovered, stage, selectedEl, hoveredEl)
    setMeasureGuides(result.distances)
    setAlignGuides(result.aligns)
  }

  function scheduleMeasureSync() {
    if (measureSyncRafRef.current) cancelAnimationFrame(measureSyncRafRef.current)
    measureSyncRafRef.current = requestAnimationFrame(() => {
      measureSyncRafRef.current = 0
      syncMeasureOverlay()
    })
  }

  function startMeasureLiveSync() {
    if (measureLiveRafRef.current) return
    const tick = () => {
      if (!showMeasureOverlay) {
        measureLiveRafRef.current = 0
        return
      }
      syncMeasureOverlay()
      measureLiveRafRef.current = requestAnimationFrame(tick)
    }
    measureLiveRafRef.current = requestAnimationFrame(tick)
  }

  const phoneFitContent =
    canvasHeight === 'auto' || typeof canvasHeight === 'number'
  const phoneScreenW =
    (typeof phoneScreenWidth === 'number' && phoneScreenWidth > 0
      ? phoneScreenWidth
      : canvasWidth) || 375
  const phoneScreenH =
    typeof phoneScreenHeight === 'number' && phoneScreenHeight > 0
      ? phoneScreenHeight
      : 667

  const centerPhoneX = phoneFitContent
    ? phoneWidthFitContent
      ? true
      : canvasWidth < phoneScreenW
    : false
  const centerPhoneY = !phoneFitContent
    ? false
    : canvasHeight === 'auto'
      ? true
      : typeof canvasHeight === 'number'
        ? canvasHeight < phoneScreenH
        : false

  const phoneSlotStyle = phoneFitContent
    ? { width: `${phoneScreenW}px`, height: `${phoneScreenH}px` }
    : undefined

  const panningRef = useRef(false)
  const [panning, setPanning] = useState(false)
  const panOriginRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 })
  const panPointerIdRef = useRef<number | null>(null)
  const blankPointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchActiveRef = useRef(false)
  const pinchStartRef = useRef({
    distance: 0,
    zoom: 1,
    midX: 0,
    midY: 0,
    panX: 0,
    panY: 0,
  })
  const pinchMovedRef = useRef(false)
  const panXRef = useRef(panX)
  const panYRef = useRef(panY)
  const zoomRef = useRef(zoom)
  panXRef.current = panX
  panYRef.current = panY
  zoomRef.current = zoom

  const MIN_ZOOM = 0.25
  const MAX_ZOOM = 3
  const zoomPercent = Math.round(zoom * 100)
  const statusBarSelected = Boolean(selectable) && selectedId === STATUS_BAR_NODE_ID

  const effectiveStatusBar =
    scene !== 'miniprogram'
      ? {
          background: '#ffffff',
          textStyle: 'black' as const,
          cover: false,
          navigationBar: false,
        }
      : {
          background: statusBarBackground?.trim() || '#ffffff',
          textStyle:
            statusBarTextStyle === 'white'
              ? ('white' as const)
              : ('black' as const),
          cover: Boolean(statusBarCoverProp),
          navigationBar: statusBarNavigationBar !== false,
        }

  const statusBarStyle = {
    background: effectiveStatusBar.background,
    color: effectiveStatusBar.textStyle === 'white' ? '#ffffff' : '#111111',
  }
  const statusBarCover = effectiveStatusBar.cover
  const showNavigationBar =
    Boolean(showDeviceChrome) &&
    scene === 'miniprogram' &&
    effectiveStatusBar.navigationBar
  const navigationBarTitleText = navigationBarTitle?.trim() || '页面'
  const navBarStyle = {
    background: effectiveStatusBar.background,
    color: effectiveStatusBar.textStyle === 'white' ? '#ffffff' : '#111111',
  }
  const capsuleLight = effectiveStatusBar.textStyle === 'white'
  const capsuleStyle = {
    top: `${EDITOR_MENU_BUTTON.top}px`,
    right: `${EDITOR_MENU_BUTTON.marginRight}px`,
    height: `${EDITOR_MENU_BUTTON.height}px`,
    borderRadius: `${EDITOR_MENU_BUTTON.height / 2}px`,
  }

  function handleStatusBarSelect(event: React.MouseEvent) {
    if (!statusBarSelectable) return
    event.stopPropagation()
    onSelect?.(STATUS_BAR_NODE_ID)
  }

  const worldStyle = {
    transform: `translate(${panX}px, ${panY}px) scale(${zoom || 1})`,
    transformOrigin: 'center top',
  }

  const viewMoved = panX !== 0 || panY !== 0 || zoom !== 1

  useEffect(() => {
    if (!selectable) setHoveredNodeId('')
  }, [selectable])

  function handleHover(id: string) {
    if (!selectable) return
    setHoveredNodeId(id)
  }

  function handleWidgetContextMenu(event: React.MouseEvent) {
    if (!selectable) return
    const target = event.target
    if (!(target instanceof Element)) return
    const host = target.closest('[data-widget-node-id]')
    if (!(host instanceof HTMLElement)) return
    if (!host.dataset.widgetNodeId?.trim()) return
    const hovered = hoveredNodeId.trim()
    const nodeId = hovered || selectedId?.trim()
    if (!nodeId) return
    event.preventDefault()
    event.stopPropagation()
    if (hovered && hovered !== selectedId) {
      onSelect?.(hovered)
    }
    onContextMenu?.({ nodeId, x: event.clientX, y: event.clientY })
  }

  function handlePhoneClick(event: React.MouseEvent) {
    if (colorPickState.picking) {
      event.preventDefault()
      event.stopPropagation()
      colorPickState.pickFromPoint(event.clientX, event.clientY)
      return
    }
    if (selectable) {
      onSelect?.('')
    }
  }

  function handleStageClick(event: React.MouseEvent) {
    if (pinchMovedRef.current) {
      pinchMovedRef.current = false
      return
    }
    if (colorPickState.picking) return
    const el = event.target as HTMLElement | null
    if (!el) return
    if (el.closest('.color-pick-ignore')) return
    if (el.closest('.select-shell')) return
    if (el.closest('.inspect-callout')) return
    if (selectable) {
      onSelect?.('')
      return
    }
    if (inspectNodeId && !el.closest('.phone')) {
      onClearInspect?.()
    }
  }

  const isPreviewMode = !selectable && !picking
  const BOTTOM_UI_SAFE = 56
  const STAGE_PAD = 24

  function clampZoom(value: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
  }

  function fitView() {
    const stage = stageRef.current
    const phone = phoneRef.current
    setPanX(0)
    setPanY(0)
    if (!stage || !phone) {
      setZoom(1)
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
      setZoom(1)
      return
    }
    setZoom(clampZoom(Math.min(1, availW / phoneW, availH / phoneH)))
  }

  function isCanvasBlankTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    if (target.closest('.color-pick-ignore')) return false
    if (target.closest('.phone')) return false
    if (target.closest('.inspect-callout')) return false
    return Boolean(target.closest('.stage'))
  }

  function beginBlankPinch() {
    if (blankPointers.current.size < 2) return
    const pts = [...blankPointers.current.values()]
    const a = pts[0]!
    const b = pts[1]!
    pinchActiveRef.current = true
    pinchMovedRef.current = false
    panningRef.current = true
    setPanning(true)
    pinchStartRef.current = {
      distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      zoom: zoomRef.current || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      panX: panXRef.current,
      panY: panYRef.current,
    }
  }

  function updateBlankPinch() {
    if (!pinchActiveRef.current || blankPointers.current.size < 2) return
    const stage = stageRef.current
    if (!stage) return
    const pts = [...blankPointers.current.values()]
    const a = pts[0]!
    const b = pts[1]!
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2
    const panDx = midX - pinchStartRef.current.midX
    const panDy = midY - pinchStartRef.current.midY
    if (
      Math.abs(panDx) > 2 ||
      Math.abs(panDy) > 2 ||
      Math.abs(dist - pinchStartRef.current.distance) > 2
    ) {
      pinchMovedRef.current = true
    }

    const nextZoom = clampZoom(
      pinchStartRef.current.zoom * (dist / pinchStartRef.current.distance),
    )
    const rect = stage.getBoundingClientRect()
    const ox = rect.width / 2
    const oy = 0
    const startCx = pinchStartRef.current.midX - rect.left
    const startCy = pinchStartRef.current.midY - rect.top
    const dx = startCx - ox - pinchStartRef.current.panX
    const dy = startCy - oy - pinchStartRef.current.panY
    const ratio = nextZoom / pinchStartRef.current.zoom

    setPanX(startCx - ox - dx * ratio + panDx)
    setPanY(startCy - oy - dy * ratio + panDy)
    setZoom(nextZoom)
  }

  function endBlankPinch() {
    pinchActiveRef.current = false
    if (panPointerIdRef.current == null) {
      panningRef.current = false
      setPanning(false)
    }
  }

  function clearBlankPointer(pointerId: number, target?: HTMLElement | null) {
    if (!blankPointers.current.has(pointerId)) return
    blankPointers.current.delete(pointerId)
    if (target) {
      try {
        target.releasePointerCapture(pointerId)
      } catch {
        // ignore
      }
    }
    if (blankPointers.current.size >= 2) {
      beginBlankPinch()
    } else {
      endBlankPinch()
    }
  }

  function onStageWheel(event: WheelEvent) {
    if (!selectable && !event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const stage = stageRef.current
    if (!stage) {
      const factor = event.deltaY > 0 ? 0.9 : 1 / 0.9
      setZoom(clampZoom(zoomRef.current * factor))
      return
    }
    const rect = stage.getBoundingClientRect()
    const cx = event.clientX - rect.left
    const cy = event.clientY - rect.top
    const oldZoom = zoomRef.current
    const factor = event.deltaY > 0 ? 0.9 : 1 / 0.9
    const nextZoom = clampZoom(oldZoom * factor)
    if (nextZoom === oldZoom) return

    const ox = rect.width / 2
    const oy = 0
    const dx = cx - ox - panXRef.current
    const dy = cy - oy - panYRef.current
    const ratio = nextZoom / oldZoom
    setPanX(cx - ox - dx * ratio)
    setPanY(cy - oy - dy * ratio)
    setZoom(nextZoom)
  }

  function endPan(target?: HTMLElement | null) {
    if (!panningRef.current && panPointerIdRef.current == null) return
    if (panPointerIdRef.current != null && target) {
      try {
        target.releasePointerCapture(panPointerIdRef.current)
      } catch {
        // ignore
      }
    }
    panPointerIdRef.current = null
    if (!pinchActiveRef.current) {
      panningRef.current = false
      setPanning(false)
    }
  }

  function onStagePointerDown(event: React.PointerEvent) {
    if (event.pointerType === 'mouse' && event.button === 1) {
      event.preventDefault()
      event.stopPropagation()
      endBlankPinch()
      blankPointers.current.clear()
      panningRef.current = true
      setPanning(true)
      panOriginRef.current = {
        x: panXRef.current,
        y: panYRef.current,
        startX: event.clientX,
        startY: event.clientY,
      }
      panPointerIdRef.current = event.pointerId
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      return
    }

    if (event.pointerType !== 'touch') return
    if (!isCanvasBlankTarget(event.target)) return
    event.preventDefault()
    blankPointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    try {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    if (blankPointers.current.size === 2) beginBlankPinch()
  }

  function onStagePointerMove(event: React.PointerEvent) {
    if (panPointerIdRef.current === event.pointerId && !pinchActiveRef.current) {
      setPanX(
        panOriginRef.current.x + (event.clientX - panOriginRef.current.startX),
      )
      setPanY(
        panOriginRef.current.y + (event.clientY - panOriginRef.current.startY),
      )
      return
    }

    if (!blankPointers.current.has(event.pointerId)) return
    blankPointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    if (pinchActiveRef.current) {
      event.preventDefault()
      updateBlankPinch()
    }
  }

  function onStagePointerUp(event: React.PointerEvent) {
    if (panPointerIdRef.current === event.pointerId) {
      endPan(event.currentTarget as HTMLElement)
    }
    clearBlankPointer(event.pointerId, event.currentTarget as HTMLElement)
  }

  function onStageMouseDown(event: React.MouseEvent) {
    if (event.button === 1) {
      event.preventDefault()
    }
  }

  function onStageAuxClick(event: React.MouseEvent) {
    if (event.button === 1) {
      event.preventDefault()
    }
  }

  useEffect(() => {
    const stage = stageRef.current
    stage?.addEventListener('wheel', onStageWheel, { passive: false })
    window.addEventListener('resize', scheduleMeasureSync)
    window.addEventListener('scroll', scheduleMeasureSync, true)
    queueMicrotask(() => {
      fitView()
      requestAnimationFrame(() => fitView())
    })
    return () => {
      endPan()
      blankPointers.current.clear()
      endBlankPinch()
      stage?.removeEventListener('wheel', onStageWheel)
      window.removeEventListener('resize', scheduleMeasureSync)
      window.removeEventListener('scroll', scheduleMeasureSync, true)
      if (measureSyncRafRef.current) cancelAnimationFrame(measureSyncRafRef.current)
      if (measureLiveRafRef.current) cancelAnimationFrame(measureLiveRafRef.current)
      measureLiveRafRef.current = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      requestAnimationFrame(() => fitView())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasWidth, canvasHeight])

  useEffect(() => {
    queueMicrotask(() => {
      scheduleMeasureSync()
      if (showMeasureOverlay) startMeasureLiveSync()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMeasureOverlay, selectedId, hoveredNodeId, zoom, toolMode])

  const stage = (
    <div
      ref={stageRef}
      className={`stage${panning ? ' panning' : ''}${isPreviewMode ? ' is-preview' : ''}`}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      onPointerCancel={onStagePointerUp}
      onMouseDown={onStageMouseDown}
      onAuxClick={onStageAuxClick}
      onClick={handleStageClick}
    >
      {iconLibrary ? <IconSprite library={iconLibrary} /> : null}
      {showAddButton || showAddDebugButton || showDeleteButton ? (
        <div className="stage-toolbar color-pick-ignore">
          {showAddDebugButton ? (
            <Tooltip title="添加调试元素" placement="left">
              <Button
                type="primary"
                danger
                shape="circle"
                className="btn-plus-bug"
                onClick={() => onAddDebug?.()}
                style={{ background: '#e6a23c', borderColor: '#e6a23c' }}
                icon={
                  <span className="plus-bug-icon" aria-hidden="true">
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
                }
              />
            </Tooltip>
          ) : null}
          {showAddButton ? (
            <Tooltip title="添加控件 / 组件" placement="left">
              <Button
                type="primary"
                shape="circle"
                icon={<PlusOutlined />}
                onClick={() => onAdd?.()}
              />
            </Tooltip>
          ) : null}
          {showDeleteButton ? (
            <Tooltip title="删除" placement="left">
              <Button
                danger
                shape="circle"
                icon={<DeleteOutlined />}
                onClick={() => onDelete?.()}
              />
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      <div
        className={`stage-world${phoneFitContent ? ' is-component' : ''}`}
        style={worldStyle}
      >
        <div
          className={[
            'phone-slot',
            phoneFitContent ? 'is-framed' : '',
            centerPhoneX ? 'center-x' : '',
            centerPhoneY ? 'center-y' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={phoneFitContent ? phoneSlotStyle : undefined}
        >
          <div className="phone-shell">
            <div
              ref={(el) => {
                phoneRef.current = el
              }}
              className={[
                'phone',
                picking ? 'is-picking' : '',
                phoneFitContent ? 'is-fit-content' : '',
                phoneWidthFitContent ? 'is-width-fit-content' : '',
                selectable ? 'is-edit' : '',
                isPreviewMode ? 'is-preview' : '',
                showDeviceChrome && scene === 'miniprogram' ? 'is-miniprogram' : '',
                showDeviceChrome ? 'has-status-bar' : '',
                showNavigationBar ? 'has-navigation-bar' : '',
                showDeviceChrome && statusBarCover ? 'status-bar-cover' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={phoneFrameStyle}
              onClick={handlePhoneClick}
              onMouseLeave={() => setHoveredNodeId('')}
            >
              {showDeviceChrome ? (
                <div
                  className={[
                    'device-status-bar color-pick-ignore',
                    statusBarSelectable ? 'selectable' : '',
                    statusBarSelected ? 'selected' : '',
                    statusBarCover ? 'cover' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={statusBarStyle}
                  aria-hidden="true"
                  onClick={handleStatusBarSelect}
                >
                  <span className="status-time">9:41</span>
                  <div className="status-trailing">
                    <svg className="status-icon status-signal" viewBox="0 0 17 12" fill="currentColor">
                      <rect x="0" y="7.5" width="3" height="4.5" rx="0.75" />
                      <rect x="4.5" y="5" width="3" height="7" rx="0.75" />
                      <rect x="9" y="2.5" width="3" height="9.5" rx="0.75" />
                      <rect x="13.5" y="0" width="3" height="12" rx="0.75" />
                    </svg>
                    <svg className="status-icon status-wifi" viewBox="0 0 16 12" fill="currentColor">
                      <circle cx="8" cy="10.6" r="1.15" />
                      <path d="M4.55 7.55a4.9 4.9 0 0 1 6.9 0l-1.15 1.2a3.25 3.25 0 0 0-4.6 0l-1.15-1.2Z" />
                      <path d="M2.2 5.05a8.2 8.2 0 0 1 11.6 0l-1.15 1.2a6.55 6.55 0 0 0-9.3 0L2.2 5.05Z" />
                      <path d="M.15 2.7a11.2 11.2 0 0 1 15.7 0l-1.15 1.2a9.55 9.55 0 0 0-13.4 0L.15 2.7Z" />
                    </svg>
                    <svg className="status-icon status-battery" viewBox="0 0 28 13" fill="none">
                      <rect
                        x="0.75"
                        y="0.75"
                        width="23.5"
                        height="11.5"
                        rx="2.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
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
              ) : null}
              {showNavigationBar ? (
                <div
                  className={[
                    'device-navigation-bar color-pick-ignore',
                    statusBarSelectable ? 'selectable' : '',
                    statusBarSelected ? 'selected' : '',
                    statusBarCover ? 'cover' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={navBarStyle}
                  aria-hidden="true"
                  onClick={handleStatusBarSelect}
                >
                  <span className="nav-title">{navigationBarTitleText}</span>
                </div>
              ) : null}
              {showDeviceChrome && scene === 'miniprogram' ? (
                <div
                  className={`mp-capsule color-pick-ignore${capsuleLight ? ' light' : ''}${showNavigationBar ? ' in-nav-bar' : ''}`}
                  style={capsuleStyle}
                  aria-hidden="true"
                >
                  <span className="mp-capsule-more" />
                  <span className="mp-capsule-divider" />
                  <span className="mp-capsule-close" />
                </div>
              ) : null}
              {parsed.error ? (
                <Alert type="error" showIcon closable={false} message={parsed.error} />
              ) : parsed.root ? (
                <div className="phone-page-layer" onContextMenu={handleWidgetContextMenu}>
                  <XmlNodeView
                    node={parsed.root}
                    nodeId={rootId}
                    selectedId={selectable ? selectedId : inspectNodeId || ''}
                    hoveredId={hoveredNodeId}
                    selectable={selectable}
                    interactEnabled={!selectable}
                    expandRepeat={expandRepeat}
                    iconLibrary={iconLibrary}
                    pageData={pageData}
                    hiddenNodeIds={hiddenNodeIds}
                    dollarProps={dollarProps}
                    routeParams={routeParams}
                    previewLifecycleGate={previewLifecycleGate}
                    inspectNodeId={inspectNodeId}
                    isRoot
                    onSelect={(id) => onSelect?.(id)}
                    onHover={handleHover}
                    onOpenRepeat={(id) => onOpenRepeat?.(id)}
                    onOpenEvent={(id) => onOpenEvent?.(id)}
                    onOpenInspect={(payload) => onOpenInspect?.(payload)}
                    onAddWindow={(parentId) => onAddWindow?.(parentId)}
                    onInteract={(payload) => onInteract?.(payload)}
                  />
                </div>
              ) : null}
              <div
                ref={(el) => {
                  modalHostRef.current = el
                }}
                className="phone-modal-host"
              />
              {selectable && !phoneFitContent ? (
                <div className="phone-screen-frame" aria-hidden="true" />
              ) : null}
              <div
                ref={(el) => {
                  badgeHostRef.current = el
                }}
                className="phone-badge-host"
              >
                {showMeasureOverlay ? (
                  <div className="distance-guides" aria-hidden="true">
                    {measureGuides.map((g, i) => (
                      <div
                        key={`${g.side}-${i}`}
                        className={`distance-guide ${g.side}`}
                        style={{
                          left: `${g.left}px`,
                          top: `${g.top}px`,
                          width: g.width ? `${g.width}px` : undefined,
                          height: g.height ? `${g.height}px` : undefined,
                        }}
                      >
                        <span className="distance-line" />
                        <span className="distance-label">{g.value}</span>
                      </div>
                    ))}
                    {measureSizeLabel ? (
                      <div
                        className="size-label"
                        style={{
                          left: `${measureSizeLabel.left}px`,
                          top: `${measureSizeLabel.top}px`,
                        }}
                      >
                        {measureSizeLabel.text}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {toast?.message ? (
                <div key={toast.id} className="phone-toast" role="status">
                  {toast.message}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={(el) => {
          inspectHostRef.current = el
        }}
        className="stage-inspect-host"
        style={{
          display: !selectable && inspectMode === 'component' ? undefined : 'none',
        }}
      />

      {alignGuides.length ? (
        <div className="align-guides color-pick-ignore" aria-hidden="true">
          {alignGuides.map((g, i) => (
            <div
              key={`${g.axis}-${g.tone}-${i}`}
              className={`align-guide ${g.axis} ${g.tone}`}
              style={
                g.axis === 'h' ? { top: `${g.pos}px` } : { left: `${g.pos}px` }
              }
            />
          ))}
        </div>
      ) : null}

      <div className="stage-status color-pick-ignore">
        {selectable ? (
          <div className="scene-tabs tool-tabs" role="tablist" aria-label="画布工具">
            <button
              type="button"
              role="tab"
              className={`scene-tab tool-tab${toolMode === 'select' ? ' active' : ''}`}
              aria-selected={toolMode === 'select'}
              title="选择"
              onClick={() => setToolMode('select')}
            >
              <svg className="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M3.2 1.4a.7.7 0 0 1 .76-.1l9.2 4.5a.7.7 0 0 1-.08 1.3L9.1 8.5l3.4 5.1a.7.7 0 0 1-.2.96l-1.35.9a.7.7 0 0 1-.96-.2L6.7 10.3l-2.5 2.4a.7.7 0 0 1-1.2-.46V2a.7.7 0 0 1 .2-.6Z"
                />
              </svg>
            </button>
            <button
              type="button"
              role="tab"
              className={`scene-tab tool-tab${toolMode === 'measure' ? ' active' : ''}`}
              aria-selected={toolMode === 'measure'}
              title="测量"
              onClick={() => setToolMode('measure')}
            >
              <svg className="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M1.6 11.8 11.8 1.6a1.4 1.4 0 0 1 2 2L3.6 13.8a1.4 1.4 0 0 1-2-2Zm9.3-8.6.7.7-1.1 1.1-.7-.7 1.1-1.1Zm-1.8 1.8.7.7-1.1 1.1-.7-.7 1.1-1.1Zm-1.8 1.8.7.7-1.1 1.1-.7-.7 1.1-1.1Zm-1.8 1.8.7.7-1.2 1.2-.7-.7 1.2-1.2Z"
                />
              </svg>
            </button>
          </div>
        ) : (
          <div
            className="scene-tabs tool-tabs"
            role="tablist"
            aria-label="预览检视模式"
          >
            <button
              type="button"
              role="tab"
              className={`scene-tab tool-tab${inspectMode === 'clean' ? ' active' : ''}`}
              aria-selected={inspectMode === 'clean'}
              title="纯净模式"
              onClick={() => setInspectMode('clean')}
            >
              <svg className="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 2.2c3.6 0 6.5 2.6 7.2 5.8-.7 3.2-3.6 5.8-7.2 5.8S1.5 11.2.8 8C1.5 4.8 4.4 2.2 8 2.2Zm0 1.5c-2.7 0-5 1.9-5.6 4.3.6 2.4 2.9 4.3 5.6 4.3s5-1.9 5.6-4.3C13 5.6 10.7 3.7 8 3.7Zm0 1.6a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Zm0 1.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"
                />
              </svg>
            </button>
            <button
              type="button"
              role="tab"
              className={`scene-tab tool-tab${inspectMode === 'component' ? ' active' : ''}`}
              aria-selected={inspectMode === 'component'}
              title="组件模式"
              onClick={() => setInspectMode('component')}
            >
              <svg className="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M6.2 1.4h3.6l1.2 1.2v2.4H14l1.2 1.2v3.6L14 10.8h-2.4V14L10.4 15.2H6.8L5.6 14v-3.2H3.2L2 9.6V6l1.2-1.2h2.4V2.6L6.2 1.4Zm.6 1.5v2.5H4.2v2.8h2.6v2.5h2.4v-2.5h2.6V5.4H9.2V2.9H6.8Z"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="scene-tabs" role="tablist" aria-label="画布场景">
          {sceneTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              className={`scene-tab${scene === tab.key ? ' active' : ''}`}
              aria-selected={scene === tab.key}
              onClick={() => setScene(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span
          className="zoom-label"
          title={selectable ? '滚轮缩放' : 'Ctrl + 滚轮缩放'}
        >
          {zoomPercent}%
        </span>
        <Tooltip title="重置视图 · Ctrl+0" placement="left">
          <Button
            className={`pan-reset${viewMoved ? ' visible' : ''}`}
            shape="circle"
            icon={<RedoOutlined />}
            disabled={!viewMoved}
            onClick={() => fitView()}
          />
        </Tooltip>
      </div>

      {picking ? (
        <div
          className="pick-overlay color-pick-ignore"
          onClick={() => colorPickState.cancelPick()}
        >
          <span>??????????????</span>
        </div>
      ) : null}
    </div>
  )

  return (
    <ModalStackContext.Provider value={resolvedModalStack}>
      <ModalHostContext.Provider value={modalHostRef}>
        <BadgeHostContext.Provider value={badgeHostRef}>
          <InspectHostContext.Provider value={inspectHostRef}>
            <PhoneFrameContext.Provider value={phoneRef}>
              <OpenInspectContext.Provider value={openInspect}>
                <CanvasToolModeContext.Provider value={toolMode}>
                  <PreviewInspectModeContext.Provider value={inspectMode}>
                    <PreviewInstancePropOverridesContext.Provider
                      value={instancePropOverridesValue}
                    >
                      <ComponentRenderMapContext.Provider value={componentMap}>
                        <PageLivePageDataContext.Provider value={pageData}>
                          <CanvasRuntimeContext.Provider value={canvasRuntime}>
                            {stage}
                          </CanvasRuntimeContext.Provider>
                        </PageLivePageDataContext.Provider>
                      </ComponentRenderMapContext.Provider>
                    </PreviewInstancePropOverridesContext.Provider>
                  </PreviewInspectModeContext.Provider>
                </CanvasToolModeContext.Provider>
              </OpenInspectContext.Provider>
            </PhoneFrameContext.Provider>
          </InspectHostContext.Provider>
        </BadgeHostContext.Provider>
      </ModalHostContext.Provider>
    </ModalStackContext.Provider>
  )
}
