import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import type { IconLibrary } from '../../types/icon-library'
import { findIcon, iconSymbolId } from '../../types/icon-library'
import { resolvePaletteColorValue } from '../../types/color-palette'
import { useColorPaletteState } from '../../composables/useColorPalette'
import type { PageData } from '../../types/page-data'
import type { ComponentRenderMap } from '../../types/component-render'
import type { XmlNode } from '../../utils/xml'
import type {
  PreviewEventKey,
  PreviewInteractPayload,
} from '../../utils/event-runtime'
import {
  isFragmentTag,
  isOutOfFlowTree,
  isSupportedTag,
  parseBool,
  parseNumber,
  parseOverflow,
  parsePageXml,
  parseSize,
  borderStyle,
  hasBorderRadius,
  overflowStyle,
  paddingStyle,
  resolveBackgroundAttr,
  rotateStyle,
} from '../../utils/xml'
import {
  DEFAULT_PRESS_RIPPLE_COLOR,
  normalizePressFeedbackMode,
  pressFeedbackHasRipple,
  pressFeedbackHasScale,
} from '../../utils/xml-node'
import {
  resolveMatchingStyleOverrides,
  evaluateScenarios,
  interpolateDataBindings,
  resolveAttrBindingValue,
} from '../../utils/dynamic-style-runtime'
import { interpolateDollarProps } from '../../utils/component-props'
import {
  buildHostBoundAttrsDepsKey,
  buildParentDollarPropsBoundAttrsDepsKey,
  resolveComponentInstanceDollarProps,
} from '../../utils/instance-dollar-props'
import {
  resolveComputedPageData,
  buildComputeDepsKey,
  sameJson,
} from '../../utils/compute-runtime'
import {
  buildVisibilityDataDepsKey,
  collectXmlVisibilityDataFieldNames,
} from '../../utils/visibility-data-deps'
import {
  buildRepeatExpandKey,
  expandRepeatTree,
  applyEditRepeatPreviewScope,
} from '../../utils/repeat'
import { CanvasRuntimeContext } from '../../composables/useCanvasRuntime'
import {
  ComponentLiveDollarPropsContext,
  ComponentLivePageDataContext,
  ComponentRenderMapContext,
  PageLivePageDataContext,
} from '../../composables/useComponentRenderMap'
import { usePreviewDataRevision } from '../../composables/preview-data-revision'
import {
  DYNAMIC_STYLES_ATTR,
  V_IF_ATTR,
  V_SHOW_ATTR,
  parseVisibilityConditions,
} from '../../types/dynamic-styles'
import {
  countEventBindings,
  countNodeEventBindings,
  INTERACTION_EVENT_KEYS,
} from '../../types/page-method'
import {
  ModalHostContext,
  ModalStackContext,
  PreviewInspectModeContext,
  PreviewInstancePropOverridesContext,
  useModalStackSnapshot,
} from '../../composables/useModalStack'
import { OpenInspectContext } from '../../composables/useInspectCalloutLayout'
import type { PreviewInspectPayload } from '../../types/preview-inspect'
import WidgetSelectShell from './WidgetSelectShell'
import OverlayScrollPort from './OverlayScrollPort'
import SwiperPort from './SwiperPort'
import MultiWindowPort from './MultiWindowPort'
import { makeSlotOutletNodeId } from '../../utils/slot-outlet'
import './XmlNodeView.css'

const ScrollColumnContext = createContext(false)

type SlotContentEntry = { node: XmlNode; nodeId: string }

export type LubanSlotScope = {
  map: Record<string, SlotContentEntry[]>
  selectable: boolean
  hostId: string
  hostPageData?: PageData
  hostDollarProps?: Record<string, unknown>
  hostDataOwnerId?: string
  parent?: LubanSlotScope | null
}

const SKIP_DOLLAR_PROPS_ATTRS = new Set<string>([
  DYNAMIC_STYLES_ATTR,
  V_SHOW_ATTR,
  V_IF_ATTR,
  ...INTERACTION_EVENT_KEYS,
])

export type XmlNodeViewProps = {
  node: XmlNode
  nodeId: string
  selectedId?: string
  hoveredId?: string
  selectable?: boolean
  parentHorizontal?: boolean
  parentVertical?: boolean
  parentScrollable?: boolean
  parentIsScrollPort?: boolean
  parentHeightDefinite?: boolean
  isRoot?: boolean
  extraStyle?: CSSProperties
  iconLibrary?: IconLibrary
  pageData?: PageData
  hiddenNodeIds?: string[]
  componentMap?: ComponentRenderMap
  dollarProps?: Record<string, unknown>
  routeParams?: Record<string, unknown>
  interactEnabled?: boolean
  previewLifecycleGate?: number
  expandRepeat?: boolean
  lubanSlotScope?: LubanSlotScope | null
  hostDataOwnerComponentId?: string
  insideComponentDefinition?: boolean
  inspectNodeId?: string
  onSelect?: (id: string) => void
  onHover?: (id: string) => void
  onOpenRepeat?: (id: string) => void
  onOpenEvent?: (id: string) => void
  onOpenInspect?: (payload: PreviewInspectPayload) => void
  onInteract?: (payload: PreviewInteractPayload) => void
  onAddWindow?: (parentId: string) => void
}

export default function XmlNodeView(props: XmlNodeViewProps) {
  const {
    node: sourceNode,
    nodeId,
    selectedId,
    hoveredId,
    selectable,
    parentHorizontal,
    parentVertical,
    parentScrollable,
    parentIsScrollPort,
    parentHeightDefinite,
    isRoot,
    extraStyle,
    iconLibrary,
    pageData,
    hiddenNodeIds,
    componentMap,
    dollarProps,
    routeParams,
    interactEnabled,
    previewLifecycleGate,
    expandRepeat,
    lubanSlotScope,
    hostDataOwnerComponentId,
    insideComponentDefinition,
    inspectNodeId,
    onSelect,
    onHover,
    onOpenRepeat,
    onOpenEvent,
    onOpenInspect,
    onInteract,
    onAddWindow,
  } = props

  const colorPalette = useColorPaletteState()
  const previewDataRevision = usePreviewDataRevision()
  const modalStack = useContext(ModalStackContext)
  useModalStackSnapshot(modalStack)
  const modalHostRef = useContext(ModalHostContext)
  const canvasRuntime = useContext(CanvasRuntimeContext)
  const injectedComponentMap = useContext(ComponentRenderMapContext)
  const resolvedComponentMap = injectedComponentMap ?? componentMap
  const previewInspectMode = useContext(PreviewInspectModeContext)
  const previewInstancePropOverrides = useContext(
    PreviewInstancePropOverridesContext,
  )
  const openInspectDirect = useContext(OpenInspectContext)
  const pageLivePageData = useContext(PageLivePageDataContext)
  const parentLivePageData = useContext(ComponentLivePageDataContext)
  const parentLiveDollarProps = useContext(ComponentLiveDollarPropsContext)
  const ancestorInScrollColumn = useContext(ScrollColumnContext)

  const [modalHostEl, setModalHostEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setModalHostEl(modalHostRef?.current ?? null)
  }, [modalHostRef])

  const showComponentInspect = Boolean(
    interactEnabled &&
      previewInspectMode === 'component' &&
      !insideComponentDefinition &&
      !nodeId.includes('/c:'),
  )

  function buildSlotContentMap(
    host: XmlNode,
    hostId: string,
  ): Record<string, SlotContentEntry[]> {
    const map: Record<string, SlotContentEntry[]> = {}
    host.children.forEach((child, index) => {
      const name = child.attrs.slot?.trim() || 'default'
      ;(map[name] ??= []).push({
        node: child,
        nodeId: `${hostId}/${index}:${child.tag}`,
      })
    })
    return map
  }

  const effectiveSlotScope: LubanSlotScope | null =
    sourceNode.tag === 'Component'
      ? {
          map: buildSlotContentMap(sourceNode, nodeId),
          selectable: Boolean(selectable),
          hostId: nodeId,
          hostPageData: pageData,
          hostDollarProps: dollarProps,
          hostDataOwnerId: hostDataOwnerComponentId?.trim() || '',
          parent: lubanSlotScope ?? null,
        }
      : (lubanSlotScope ?? null)

  const childLubanSlotScope = effectiveSlotScope

  const slotOutletNodeId =
    sourceNode.tag === 'Slot' && effectiveSlotScope
      ? makeSlotOutletNodeId(
          effectiveSlotScope.hostId,
          sourceNode.attrs.name?.trim() || 'default',
        )
      : null

  const slotOutletSelectable = Boolean(
    slotOutletNodeId && effectiveSlotScope?.selectable,
  )

  const isEditorHidden = (hiddenNodeIds ?? []).includes(nodeId)

  const viewNode =
    !selectable || expandRepeat
      ? sourceNode
      : applyEditRepeatPreviewScope(sourceNode, pageData, dollarProps)

  const previewClickable = Boolean(
    interactEnabled &&
      !selectable &&
      countEventBindings(sourceNode.attrs.onClick) > 0,
  )
  const previewLongClickable = Boolean(
    interactEnabled &&
      !selectable &&
      countEventBindings(sourceNode.attrs.onLongClick) > 0,
  )
  const previewTouchable = Boolean(
    interactEnabled &&
      !selectable &&
      (countEventBindings(sourceNode.attrs.onTouchStart) > 0 ||
        countEventBindings(sourceNode.attrs.onTouchMove) > 0 ||
        countEventBindings(sourceNode.attrs.onTouchEnd) > 0),
  )
  const previewInteractive =
    previewClickable || previewLongClickable || previewTouchable

  const componentDetail = useMemo(() => {
    if (sourceNode.tag !== 'Component') return null
    const id = sourceNode.attrs.componentId?.trim()
    if (!id || !resolvedComponentMap) return null
    return resolvedComponentMap[id] ?? null
  }, [resolvedComponentMap, sourceNode.attrs.componentId, sourceNode.tag])

  const hostPageDataForInstanceProps = hostDataOwnerComponentId?.trim()
    ? pageData
    : (pageLivePageData ?? pageData)

  function isLiveHostAttrBinding(raw: string): boolean {
    const t = raw.trim()
    if (/^\{\s*[A-Za-z_$][\w$]*\s*\}$/.test(t)) return true
    if (/^\{\s*\$?props(?:\.[A-Za-z_$][\w$]*(?:\[\d+\])*)*\s*\}$/.test(t)) {
      return true
    }
    return false
  }

  const cachedInstanceDollarPropsRef = useRef<Record<string, unknown> | null>(
    null,
  )
  const instanceDollarProps = useMemo(() => {
    void previewDataRevision
    const hostData = hostPageDataForInstanceProps
    const parentDollarProps = parentLiveDollarProps ?? dollarProps ?? null
    const boundKey = buildHostBoundAttrsDepsKey(sourceNode.attrs, hostData)
    void boundKey
    const parentBoundKey = buildParentDollarPropsBoundAttrsDepsKey(
      sourceNode.attrs,
      parentDollarProps,
    )
    void parentBoundKey
    const base = resolveComponentInstanceDollarProps({
      config: componentDetail?.config,
      hostAttrs: sourceNode.attrs,
      pageData: hostData,
      routeParams,
      parentDollarProps,
      editCanvasFallback: Boolean(selectable),
      scope: sourceNode.scope
        ? {
            item: sourceNode.scope.item,
            index: sourceNode.scope.index,
          }
        : null,
      projectPath: canvasRuntime?.projectPath,
    })
    const overrides = previewInstancePropOverrides?.[nodeId]
    const next: Record<string, unknown> = { ...base }
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        const raw = sourceNode.attrs[key]
        if (typeof raw === 'string' && isLiveHostAttrBinding(raw)) {
          continue
        }
        if (value === null) continue
        next[key] = value
      }
    }
    if (
      cachedInstanceDollarPropsRef.current &&
      sameJson(cachedInstanceDollarPropsRef.current, next)
    ) {
      return cachedInstanceDollarPropsRef.current
    }
    cachedInstanceDollarPropsRef.current = next
    return next
  }, [
    canvasRuntime?.projectPath,
    componentDetail?.config,
    dollarProps,
    hostPageDataForInstanceProps,
    nodeId,
    parentLiveDollarProps,
    previewDataRevision,
    previewInstancePropOverrides,
    routeParams,
    selectable,
    sourceNode.attrs,
    sourceNode.scope,
  ])

  const livePageDataForSubtree =
    sourceNode.tag === 'Component' && componentDetail?.data
      ? componentDetail.data
      : parentLivePageData

  const liveDollarPropsForSubtree =
    sourceNode.tag === 'Component' && componentDetail
      ? instanceDollarProps
      : (parentLiveDollarProps ?? dollarProps)

  const runtimeScope = {
    ...(viewNode.scope ?? {}),
    $props: liveDollarPropsForSubtree ?? dollarProps,
    $route: routeParams,
    $query: routeParams,
  }

  const modalKey = sourceNode.attrs.name?.trim() || nodeId
  const modalIsOpen =
    sourceNode.tag !== 'Modal'
      ? true
      : selectable
        ? true
        : Boolean(modalStack?.isTop(modalKey))

  const visibilityPageData = insideComponentDefinition
    ? (livePageDataForSubtree ?? pageData)
    : (pageLivePageData ?? pageData)

  const mountAllowed = (() => {
    if (selectable) return true
    void previewDataRevision
    const config = parseVisibilityConditions(sourceNode.attrs[V_IF_ATTR])
    return evaluateScenarios(config.scenarios, visibilityPageData, runtimeScope)
  })()

  const showAllowed = (() => {
    if (selectable) return true
    void previewDataRevision
    const config = parseVisibilityConditions(sourceNode.attrs[V_SHOW_ATTR])
    return evaluateScenarios(config.scenarios, visibilityPageData, runtimeScope)
  })()

  const visuallyHidden =
    !showAllowed || (sourceNode.tag === 'Modal' && !modalIsOpen)

  const modalLayerVisible =
    sourceNode.tag === 'Modal' &&
    !isEditorHidden &&
    mountAllowed &&
    (selectable || (showAllowed && modalIsOpen))

  const attrs = useMemo(() => {
    const base = sourceNode.attrs
    const overrides = resolveMatchingStyleOverrides(
      base[DYNAMIC_STYLES_ATTR],
      pageData,
      runtimeScope,
    )
    const merged = Object.keys(overrides).length ? { ...base, ...overrides } : base
    const skipEventKeys = new Set<string>([
      ...SKIP_DOLLAR_PROPS_ATTRS,
      ...(componentDetail?.config.events ?? [])
        .map((item) => item.name.trim())
        .filter(Boolean),
    ])
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
      if (skipEventKeys.has(key)) {
        next[key] = value
        continue
      }
      let resolved = interpolateDataBindings(value, pageData, runtimeScope)
      if (dollarProps) {
        resolved = interpolateDollarProps(resolved, dollarProps)
      }
      next[key] = resolvePaletteColorValue(resolved, colorPalette)
    }
    return next
    // runtimeScope is rebuilt each render; deps below cover its inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    colorPalette,
    componentDetail?.config.events,
    dollarProps,
    pageData,
    previewDataRevision,
    liveDollarPropsForSubtree,
    routeParams,
    sourceNode.attrs,
    viewNode.scope,
  ])

  const width = parseSize(attrs.width, 'wrap_content')
  const height = parseSize(attrs.height, 'wrap_content')

  const inspectLabel =
    sourceNode.tag !== 'Component'
      ? ''
      : attrs.name?.trim() ||
        componentDetail?.config.name?.trim() ||
        componentDetail?.config.title?.trim() ||
        sourceNode.attrs.componentId?.trim() ||
        ''

  const isSelected = selectedId
    ? sourceNode.tag === 'Slot' &&
      slotOutletNodeId &&
      selectedId === slotOutletNodeId
      ? true
      : selectedId === nodeId
    : false
  const isHovered = hoveredId
    ? sourceNode.tag === 'Slot' &&
      slotOutletNodeId &&
      hoveredId === slotOutletNodeId
      ? true
      : hoveredId === nodeId
    : false

  const fillRemainingHeight =
    height === 'match_parent' &&
    Boolean(parentVertical) &&
    (Boolean(parentHeightDefinite) ||
      !Boolean(parentScrollable) ||
      Boolean(parentIsScrollPort))

  const heightIsDefinite = height !== 'wrap_content'
  const stackInVerticalParent =
    Boolean(parentVertical) && height !== 'match_parent'

  const hasScrollAttr = parseOverflow(attrs.overflow, 'visible') === 'scroll'
  const inScrollColumn =
    ancestorInScrollColumn ||
    (hasScrollAttr && attrs.orientation !== 'horizontal') ||
    Boolean(parentScrollable)
  const isScrollLayout = !selectable && hasScrollAttr
  const insideScrollColumn = ancestorInScrollColumn || Boolean(parentScrollable)

  const innerSizeStyle = (() => {
    const style: Record<string, string> = {}
    const stackHeight = insideScrollColumn || stackInVerticalParent

    if (width === 'match_parent') {
      style.width = '100%'
      style.maxWidth = '100%'
      style.minWidth = '0'
    } else if (width === 'wrap_content') {
      style.width = 'fit-content'
      style.maxWidth = '100%'
      style.flexShrink = '0'
    } else {
      style.width = `${width}px`
      style.flexShrink = '0'
    }

    if (height === 'match_parent') {
      if (stackHeight) {
        style.height = 'auto'
        style.maxHeight = 'none'
        style.flexShrink = '0'
      } else {
        style.height = '100%'
        style.maxHeight = '100%'
        style.minHeight = '0'
      }
    } else if (height === 'wrap_content') {
      style.height = 'fit-content'
      style.flexShrink = '0'
    } else {
      style.height = `${height}px`
      style.flexShrink = '0'
    }
    return style
  })()

  const layoutStyle = {
    ...innerSizeStyle,
    ...paddingStyle(attrs),
    ...borderStyle(attrs),
    boxSizing: 'border-box' as const,
  }

  const shellExtraStyle = extraStyle

  const textContent = (() => {
    const raw = attrs.text || sourceNode.text || ''
    if (attrs.text) return attrs.text
    if (!dollarProps) return raw
    return interpolateDollarProps(raw, dollarProps)
  })()

  const textDisplayContent = (() => {
    if (selectable) {
      const source = String(sourceNode.attrs.text ?? sourceNode.text ?? '').trim()
      if (/\{[^{}]+\}/.test(source)) return '动态文本'
    }
    return textContent
  })()

  const textStyle = {
    ...layoutStyle,
    color: attrs.textColor || '#303133',
    fontSize: `${parseNumber(attrs.textSize, 14)}px`,
    textAlign: (attrs.textAlign
      ? attrs.textAlign
      : attrs.gravity?.includes('space_between') ||
          attrs.gravity?.includes('space-between')
        ? 'left'
        : attrs.gravity?.includes('center')
          ? 'center'
          : attrs.gravity?.includes('right')
            ? 'right'
            : 'left') as 'left' | 'center' | 'right',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    ...rotateStyle(attrs),
  }

  const componentComputeDepsKey = componentDetail
    ? buildComputeDepsKey(
        componentDetail.data,
        instanceDollarProps,
        canvasRuntime?.getDeviceInfo() ?? null,
        null,
        colorPalette,
      )
    : ''

  const componentVisibilityFields = useMemo(() => {
    const xml = componentDetail?.xml
    if (!xml?.trim()) return [] as string[]
    return collectXmlVisibilityDataFieldNames(xml)
  }, [componentDetail?.xml])

  const componentDataSyncKey = componentDetail
    ? `${componentComputeDepsKey}\0${buildVisibilityDataDepsKey(
        componentDetail.data,
        componentVisibilityFields,
      )}`
    : ''

  const componentPageData = useMemo(() => {
    if (!componentDetail) return pageData
    return resolveComputedPageData(componentDetail.data, {
      getDeviceInfo: canvasRuntime?.getDeviceInfo,
      dollarProps: instanceDollarProps,
      colorPalette,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentDetail?.data, componentDataSyncKey])

  const cachedComponentExpandKeyRef = useRef('')
  const cachedComponentRootRef = useRef<XmlNode | null>(null)
  const componentRoot = useMemo(() => {
    if (!componentDetail?.xml?.trim()) {
      cachedComponentExpandKeyRef.current = ''
      cachedComponentRootRef.current = null
      return null
    }
    try {
      const data = componentPageData ?? componentDetail.data
      const expandKey = `${componentDetail.xml}\0${buildRepeatExpandKey(data, instanceDollarProps)}`
      if (
        expandKey === cachedComponentExpandKeyRef.current &&
        cachedComponentRootRef.current
      ) {
        return cachedComponentRootRef.current
      }
      const root = parsePageXml(componentDetail.xml)
      const expanded = expandRepeatTree(root, data, instanceDollarProps)
      cachedComponentExpandKeyRef.current = expandKey
      cachedComponentRootRef.current = expanded
      return expanded
    } catch {
      cachedComponentExpandKeyRef.current = ''
      cachedComponentRootRef.current = null
      return null
    }
  }, [componentDetail, componentPageData, instanceDollarProps])

  const componentOutOfFlow = Boolean(
    componentRoot && isOutOfFlowTree(componentRoot),
  )
  const fragmentOutOfFlow =
    isFragmentTag(sourceNode.tag) && isOutOfFlowTree(sourceNode)

  const outOfFlowHostStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    pointerEvents: 'none',
    margin: 0,
  }

  const componentHostWidth = componentOutOfFlow
    ? ('wrap_content' as const)
    : attrs.width?.trim()
      ? parseSize(attrs.width, 'wrap_content')
      : parseSize(componentDetail?.config.width, 'wrap_content')

  const componentHostHeight = componentOutOfFlow
    ? ('wrap_content' as const)
    : attrs.height?.trim()
      ? parseSize(attrs.height, 'wrap_content')
      : parseSize(componentDetail?.config.height, 'wrap_content')

  const componentShellExtraStyle: CSSProperties = {
    ...(extraStyle ?? {}),
    ...(componentOutOfFlow ? outOfFlowHostStyle : {}),
  }

  const componentStyle = (() => {
    if (componentOutOfFlow) {
      return {
        display: 'block' as const,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box' as const,
        pointerEvents: 'none' as const,
      }
    }
    const stackHeight = insideScrollColumn || stackInVerticalParent
    const fillHostHeight =
      componentHostHeight === 'match_parent' &&
      !stackInVerticalParent &&
      (!insideScrollColumn || fillRemainingHeight)
    const keepSelectionVisible =
      selectable ||
      Boolean(
        selectedId &&
          (selectedId === nodeId || selectedId.startsWith(`${nodeId}/`)),
      )
    return {
      ...layoutStyle,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      width: '100%',
      height: fillHostHeight ? '100%' : 'auto',
      maxHeight: stackHeight || !fillHostHeight ? 'none' : undefined,
      minHeight:
        componentHostHeight === 'wrap_content' && !componentRoot
          ? '48px'
          : undefined,
      boxSizing: 'border-box' as const,
      overflow:
        keepSelectionVisible ||
        stackHeight ||
        !fillHostHeight ||
        !interactEnabled
          ? 'visible'
          : 'hidden',
    }
  })()

  const componentPlaceholderStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: '4px',
    minHeight: '48px',
    padding: '10px 12px',
    border: '1px dashed #94a3b8',
    borderRadius: '8px',
    background: 'rgba(148, 163, 184, 0.12)',
    color: '#334155',
    boxSizing: 'border-box' as const,
    width: '100%',
  }

  const buttonPressFeedbackMode = normalizePressFeedbackMode(attrs.pressFeedback)
  const buttonPressHasScale = pressFeedbackHasScale(buttonPressFeedbackMode)
  const buttonPressHasRipple = pressFeedbackHasRipple(buttonPressFeedbackMode)
  const buttonPressRippleColor =
    (attrs.pressRippleColor ?? '').trim() || DEFAULT_PRESS_RIPPLE_COLOR

  const buttonStyle = {
    ...layoutStyle,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '4px',
    background: resolveBackgroundAttr(attrs, '#409eff'),
    color: attrs.textColor || '#ffffff',
    fontSize: `${parseNumber(attrs.textSize, 14)}px`,
    cursor: selectable || previewInteractive ? 'pointer' : 'default',
    minHeight: height === 'wrap_content' ? '36px' : undefined,
    position: 'relative' as const,
    overflow: 'hidden' as const,
    transition:
      buttonPressHasScale || buttonPressHasRipple
        ? 'transform 0.08s ease, filter 0.08s ease'
        : undefined,
    WebkitTapHighlightColor: 'transparent',
    ...(buttonPressHasRipple
      ? { ['--press-ripple-color' as string]: buttonPressRippleColor }
      : {}),
  }

  const inputValue = attrs.value ?? ''
  const inputPlaceholder = attrs.placeholder || ''
  const inputStyle = {
    ...layoutStyle,
    display: 'block',
    width: '100%',
    background: resolveBackgroundAttr(attrs, '#ffffff'),
    color: attrs.textColor || '#303133',
    fontSize: `${parseNumber(attrs.textSize, 14)}px`,
    outline: 'none',
    minHeight: height === 'wrap_content' ? '36px' : undefined,
  }

  const [inputLocalValue, setInputLocalValue] = useState<string | null>(null)
  useEffect(() => {
    setInputLocalValue(null)
  }, [sourceNode.attrs.value])

  function boundInputFieldName(): string | null {
    const raw = (sourceNode.attrs.value ?? '').trim()
    const m = raw.match(/^\{([A-Za-z_][\w]*)\}$/)
    return m?.[1] ?? null
  }

  const inputDisplayValue = boundInputFieldName()
    ? inputValue
    : !selectable && inputLocalValue != null
      ? inputLocalValue
      : inputValue

  function isTemplateSrc(src: string): boolean {
    return /\{[^{}]+\}/.test(src)
  }

  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  useEffect(() => {
    setImageLoadFailed(false)
  }, [attrs.src])

  const imageSrcRaw = attrs.src?.trim() || ''
  const imageSrc =
    !imageSrcRaw || isTemplateSrc(imageSrcRaw) || imageLoadFailed
      ? ''
      : imageSrcRaw
  const imageAlt = attrs.alt || ''
  const imageTitle = attrs.title || undefined
  const imageLoading = (() => {
    const value = attrs.loading?.trim().toLowerCase()
    return value === 'lazy' || value === 'eager' ? value : undefined
  })()
  const imagePlaceholderLabel = isTemplateSrc(imageSrcRaw)
    ? '图片'
    : imageAlt || 'Image'

  const imageStyle = {
    ...layoutStyle,
    display: 'block',
    objectFit: (attrs.objectFit || 'cover') as CSSProperties['objectFit'],
    background: resolveBackgroundAttr(attrs) || undefined,
    ...(height === 'match_parent'
      ? { width: '100%', height: '100%', minHeight: 0, flex: '1 1 auto' }
      : {}),
    ...(hasBorderRadius(attrs) ? { overflow: 'hidden' as const } : {}),
    ...rotateStyle(attrs),
  }

  const imagePlaceholderStyle = {
    ...layoutStyle,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: resolveBackgroundAttr(attrs, '#f2f3f5'),
    color: '#909399',
    fontSize: '12px',
    minWidth: width === 'wrap_content' ? '80px' : undefined,
    minHeight: height === 'wrap_content' ? '60px' : undefined,
    ...(height === 'match_parent'
      ? { width: '100%', height: '100%', minHeight: 0, flex: '1 1 auto' }
      : {}),
    ...(hasBorderRadius(attrs) ? { overflow: 'hidden' as const } : {}),
    ...rotateStyle(attrs),
  }

  const iconIdRaw = attrs.iconId?.trim() || ''
  const iconIsTemplate = isTemplateSrc(iconIdRaw)
  const iconDef = iconIsTemplate
    ? undefined
    : findIcon(iconLibrary, iconIdRaw)
  const iconSize = parseNumber(attrs.size, 24)
  const iconColor = attrs.color || '#303133'
  const iconHref = iconDef ? `#${iconSymbolId(iconDef.id)}` : ''

  const iconStyle = (() => {
    const size = iconSize
    const hasFixedW = width !== 'wrap_content'
    const hasFixedH = height !== 'wrap_content'
    const shadow = attrs.contentShadow?.trim()
    return {
      ...layoutStyle,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: iconColor,
      fill: iconColor,
      background: resolveBackgroundAttr(attrs, 'transparent'),
      width: hasFixedW ? undefined : `${size}px`,
      height: hasFixedH ? undefined : `${size}px`,
      flexShrink: 0,
      lineHeight: 0,
      ...(hasBorderRadius(attrs) ? { overflow: 'hidden' as const } : {}),
      ...(shadow ? { boxShadow: shadow } : {}),
      ...rotateStyle(attrs),
    }
  })()

  const iconPlaceholderStyle = {
    ...iconStyle,
    background: resolveBackgroundAttr(
      attrs,
      iconIsTemplate ? 'transparent' : '#f2f3f5',
    ),
    color: iconIsTemplate ? iconColor : '#909399',
    fontSize: '11px',
    border: iconIsTemplate ? 'none' : '1px dashed #dcdfe6',
    boxSizing: 'border-box' as const,
  }

  const layoutOverflowStyle = (() => {
    const strategy = parseOverflow(attrs.overflow, 'visible')
    if (!interactEnabled) {
      if (!insideComponentDefinition || strategy !== 'hidden') {
        return { overflow: 'visible' as const }
      }
    }
    return overflowStyle(attrs, 'visible')
  })()

  function mapGravityMain(gravity: string | undefined, horizontal: boolean) {
    if (!gravity) return 'flex-start'
    const g = gravity.toLowerCase().trim()
    if (g.includes('space_between') || g.includes('space-between')) {
      return 'space-between'
    }
    if (horizontal) {
      if (g.includes('right') || g.includes('end')) return 'flex-end'
      if (g.includes('left') || g.includes('start')) return 'flex-start'
      if (g.includes('center_horizontal') || g === 'center') return 'center'
      return 'flex-start'
    }
    if (g.includes('bottom')) return 'flex-end'
    if (g.includes('top')) return 'flex-start'
    if (g.includes('center_vertical') || g === 'center') return 'center'
    return 'flex-start'
  }

  function mapGravityCross(gravity: string | undefined, horizontal: boolean) {
    if (!gravity) return 'stretch'
    const g = gravity.toLowerCase().trim()
    if (g.includes('space_between') || g.includes('space-between')) {
      if (g.includes('bottom')) return 'flex-end'
      if (g.includes('top')) return 'flex-start'
      if (
        g.includes('center') ||
        g.includes('center_vertical') ||
        g.includes('center_horizontal')
      ) {
        return 'center'
      }
      return 'stretch'
    }
    if (horizontal) {
      if (g.includes('bottom')) return 'flex-end'
      if (g.includes('top')) return 'flex-start'
      if (g.includes('center_vertical') || g === 'center') return 'center'
      return 'stretch'
    }
    if (g.includes('right') || g.includes('end')) return 'flex-end'
    if (g.includes('left') || g.includes('start')) return 'flex-start'
    if (g.includes('center_horizontal') || g === 'center') return 'center'
    return 'stretch'
  }

  const linearStyle = (() => {
    const horizontal = attrs.orientation === 'horizontal'
    const matchHeight = height === 'match_parent'
    const matchWidth = width === 'match_parent'
    const stackHeight = insideScrollColumn || stackInVerticalParent
    return {
      ...layoutStyle,
      ...layoutOverflowStyle,
      display: 'flex',
      flexDirection: (horizontal ? 'row' : 'column') as 'row' | 'column',
      alignItems: mapGravityCross(attrs.gravity, horizontal),
      justifyContent: mapGravityMain(attrs.gravity, horizontal),
      gap: attrs.gap ? `${parseNumber(attrs.gap)}px` : undefined,
      background: resolveBackgroundAttr(attrs, 'transparent'),
      position: 'relative' as const,
      ...(matchWidth ? { width: '100%', minWidth: 0 } : {}),
      ...(matchHeight
        ? stackHeight
          ? {
              height: 'auto',
              maxHeight: 'none',
              flex: '0 0 auto',
              alignSelf: 'stretch',
            }
          : isScrollLayout
            ? {
                flex: '1 1 0%',
                minHeight: 0,
                height: '100%',
                maxHeight: '100%',
                alignSelf: 'stretch',
              }
            : {
                height: '100%',
                flex: '1 1 auto',
                minHeight: 0,
                ...(interactEnabled ? { overflow: 'hidden' as const } : {}),
              }
        : isScrollLayout
          ? { maxHeight: '100%', minHeight: 0 }
          : {}),
    }
  })()

  const swiperOverflowStyle = !interactEnabled
    ? { overflow: 'visible' as const }
    : {
        overflow: (parseOverflow(attrs.overflow, 'visible') === 'hidden'
          ? 'hidden'
          : 'visible') as 'visible' | 'hidden',
      }

  const swiperStyle = (() => {
    const matchHeight = height === 'match_parent'
    const matchWidth = width === 'match_parent'
    const stackHeight = insideScrollColumn || stackInVerticalParent
    return {
      ...layoutStyle,
      ...swiperOverflowStyle,
      position: 'relative' as const,
      background: resolveBackgroundAttr(attrs, 'transparent'),
      ...(matchWidth ? { width: '100%', minWidth: 0 } : {}),
      ...(matchHeight
        ? stackHeight
          ? {
              height: '160px',
              maxHeight: 'none',
              flex: '0 0 auto',
              alignSelf: 'stretch',
            }
          : {
              height: '100%',
              minHeight: 0,
              flex: '1 1 auto',
              alignSelf: 'stretch',
            }
        : { minHeight: 0 }),
    }
  })()

  const swiperAutoplay = parseBool(attrs.autoplay)
  const swiperCircular =
    attrs.circular == null ||
    attrs.circular === '' ||
    parseBool(attrs.circular)
  const swiperIndicator =
    attrs.indicatorDots == null ||
    attrs.indicatorDots === '' ||
    parseBool(attrs.indicatorDots)
  const swiperInterval = parseNumber(attrs.interval, 3000)
  const swiperDuration = parseNumber(attrs.duration, 280)
  const swiperCurrent = parseNumber(attrs.current, 0)
  const swiperIndicatorColor =
    attrs.indicatorColor?.trim() || 'rgba(0,0,0,0.25)'
  const swiperIndicatorActiveColor =
    attrs.indicatorActiveColor?.trim() || '#409eff'

  const multiWindowOverflowStyle = !interactEnabled
    ? { overflow: 'visible' as const }
    : {
        overflow: (parseOverflow(attrs.overflow, 'visible') === 'hidden'
          ? 'hidden'
          : 'visible') as 'visible' | 'hidden',
      }

  const multiWindowStyle = (() => {
    const matchHeight = height === 'match_parent'
    const matchWidth = width === 'match_parent'
    const stackHeight = insideScrollColumn
    return {
      ...layoutStyle,
      ...multiWindowOverflowStyle,
      position: 'relative' as const,
      background: resolveBackgroundAttr(attrs, 'transparent'),
      ...(matchWidth ? { width: '100%' } : {}),
      ...(matchHeight
        ? stackHeight
          ? {
              height: 'auto',
              maxHeight: 'none',
              flex: '0 0 auto',
              alignSelf: 'stretch',
            }
          : {
              height: '100%',
              minHeight: 0,
              flex: '1 1 0%',
              alignSelf: 'stretch',
            }
        : {}),
      display: 'block',
      boxSizing: 'border-box' as const,
    }
  })()

  const multiWindows = sourceNode.children.map((child, index) => ({
    index,
    key: child.attrs.windowKey?.trim() || '',
  }))

  const multiWindowActiveValue = (() => {
    const raw = sourceNode.attrs.active?.trim() || ''
    if (!raw) return ''
    const native = resolveAttrBindingValue(raw, pageData, runtimeScope)
    if (native !== undefined && native !== null && typeof native !== 'object') {
      return native as string | number
    }
    return attrs.active ?? ''
  })()

  const multiWindowFocusIndex = (() => {
    if (!selectable || !selectedId) return 0
    const prefix = `${nodeId}/`
    if (!selectedId.startsWith(prefix)) return 0
    const rest = selectedId.slice(prefix.length)
    const m = rest.match(/^(\d+):/)
    if (!m) return 0
    const idx = Number(m[1])
    return Number.isFinite(idx) ? idx : 0
  })()

  const relativeStyle = (() => {
    const matchHeight = height === 'match_parent'
    const matchWidth = width === 'match_parent'
    const stackHeight = insideScrollColumn
    return {
      ...layoutStyle,
      ...layoutOverflowStyle,
      position: 'relative' as const,
      background: resolveBackgroundAttr(attrs, 'transparent'),
      ...(matchWidth ? { width: '100%' } : {}),
      ...(matchHeight
        ? stackHeight
          ? {
              height: 'auto',
              maxHeight: 'none',
              flex: '0 0 auto',
              alignSelf: 'stretch',
            }
          : isScrollLayout
            ? {
                flex: '1 1 0%',
                minHeight: 0,
                height: '100%',
                maxHeight: '100%',
                alignSelf: 'stretch',
              }
            : {
                height: '100%',
                ...(interactEnabled ? { overflow: 'hidden' as const } : {}),
              }
        : isScrollLayout
          ? { maxHeight: '100%', minHeight: 0 }
          : {}),
      minHeight: height === 'wrap_content' ? '40px' : undefined,
    }
  })()

  const modalSurfaceStyle = {
    ...paddingStyle(attrs),
    ...borderStyle(attrs),
    background: resolveBackgroundAttr(attrs, 'rgba(0,0,0,0.45)'),
    boxSizing: 'border-box' as const,
  }

  const modalOverlayStyle = {
    ...modalSurfaceStyle,
    position: 'absolute' as const,
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: selectable && isSelected ? 3 : 1,
    outline:
      selectable && isSelected
        ? '2px solid #e6a23c'
        : selectable && isHovered
          ? '1px dashed var(--color-primary)'
          : undefined,
    outlineOffset: '-2px',
  }

  const modalPanelStyle = {
    position: 'relative' as const,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    maxWidth: '100%',
    maxHeight: '100%',
    boxSizing: 'border-box' as const,
  }

  const modalCloseOnClick =
    attrs.closeOnClick == null ||
    attrs.closeOnClick === '' ||
    parseBool(attrs.closeOnClick)

  function childRelativeStyle(child: XmlNode): CSSProperties {
    const a = child.attrs
    const style: CSSProperties = { position: 'absolute' }
    if (parseBool(a.layout_alignParentLeft) || parseBool(a.layout_alignParentStart)) {
      style.left = 0
    }
    if (parseBool(a.layout_alignParentRight) || parseBool(a.layout_alignParentEnd)) {
      style.right = 0
    }
    if (parseBool(a.layout_alignParentTop)) style.top = 0
    if (parseBool(a.layout_alignParentBottom)) style.bottom = 0
    const hasLayoutMargin = (raw: string | undefined): boolean => {
      const t = raw?.trim()
      return Boolean(t && t !== 'null')
    }
    const marginPx = (raw: string | undefined): number | null => {
      const t = raw?.trim()
      if (!t || t === 'null') return null
      const n = parseNumber(t, Number.NaN)
      return Number.isFinite(n) ? n : null
    }
    const ml = marginPx(a.layout_marginLeft)
    const mt = marginPx(a.layout_marginTop)
    const mr = marginPx(a.layout_marginRight)
    const mb = marginPx(a.layout_marginBottom)
    const hasMl = hasLayoutMargin(a.layout_marginLeft)
    const hasMt = hasLayoutMargin(a.layout_marginTop)
    const hasMr = hasLayoutMargin(a.layout_marginRight)
    const hasMb = hasLayoutMargin(a.layout_marginBottom)

    if (
      parseBool(a.layout_centerInParent) &&
      !hasMl &&
      !hasMr &&
      !hasMt &&
      !hasMb
    ) {
      style.left = '50%'
      style.top = '50%'
      style.transform = 'translate(-50%, -50%)'
    } else {
      if (parseBool(a.layout_centerHorizontal) && !hasMl && !hasMr) {
        style.left = '50%'
        style.transform = style.transform
          ? `${style.transform} translateX(-50%)`
          : 'translateX(-50%)'
      }
      if (parseBool(a.layout_centerVertical) && !hasMt && !hasMb) {
        style.top = '50%'
        style.transform = style.transform
          ? `${style.transform} translateY(-50%)`
          : 'translateY(-50%)'
      }
    }
    if (ml != null) style.left = `${ml}px`
    if (mt != null) style.top = `${mt}px`
    if (mr != null) style.right = `${mr}px`
    if (mb != null) style.bottom = `${mb}px`
    return style
  }

  const isHorizontalLinear =
    sourceNode.tag === 'LinearLayout' && attrs.orientation === 'horizontal'
  const showRepeatBadge = Boolean(selectable && attrs.repeat?.trim())
  const eventBadgeCount = (() => {
    if (!selectable) return 0
    if (sourceNode.tag === 'Component') {
      const names = (componentDetail?.config.events ?? [])
        .map((item) => item.name.trim())
        .filter(Boolean)
      const keys = [...new Set<string>([...INTERACTION_EVENT_KEYS, ...names])]
      return keys.reduce(
        (sum, key) => sum + countEventBindings(attrs[key]),
        0,
      )
    }
    return countNodeEventBindings(attrs)
  })()

  function childId(index: number, tag: string) {
    return `${nodeId}/${index}:${tag}`
  }

  const slotFillEntries =
    sourceNode.tag !== 'Slot'
      ? ([] as SlotContentEntry[])
      : (effectiveSlotScope?.map[sourceNode.attrs.name?.trim() || 'default'] ??
        [])
  const slotHasFill = slotFillEntries.length > 0
  const hideEmptySlotInPreview = Boolean(
    interactEnabled && !slotHasFill && effectiveSlotScope,
  )
  const slotFillSelectable = Boolean(effectiveSlotScope?.selectable)
  const slotFillPageData = effectiveSlotScope?.hostPageData ?? pageData
  const slotFillDollarProps = effectiveSlotScope?.hostDollarProps ?? dollarProps

  function parseSlotParamNames(raw: string | undefined): string[] {
    if (!raw?.trim()) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      const names: string[] = []
      for (const row of parsed) {
        if (!row || typeof row !== 'object') continue
        const name =
          typeof (row as { name?: unknown }).name === 'string'
            ? (row as { name: string }).name.trim()
            : ''
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name)
      }
      return names
    } catch {
      return []
    }
  }

  const slotFillNodes = (() => {
    const entries = slotFillEntries
    if (!entries.length) return [] as SlotContentEntry[]
    const paramNames = parseSlotParamNames(sourceNode.attrs.params)
    if (!paramNames.length) return entries
    const hostProps = slotFillDollarProps ?? {}
    const hostData = slotFillPageData
    const scopeExtra: Record<string, unknown> = {}
    for (const name of paramNames) {
      if (Object.prototype.hasOwnProperty.call(hostProps, name)) {
        scopeExtra[name] = hostProps[name]
        continue
      }
      const field = hostData?.fields.find((f) => f.name.trim() === name)
      if (field) {
        scopeExtra[name] = field.value
        continue
      }
      scopeExtra[name] = {}
    }
    return entries.map((entry) => {
      const prev = entry.node.scope
      if (prev?.item !== undefined && prev.item !== null) return entry
      return {
        nodeId: entry.nodeId,
        node: {
          ...entry.node,
          scope: {
            item: scopeExtra.item ?? {},
            index: prev?.index ?? 0,
          },
        },
      }
    })
  })()

  const slotFillStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    boxSizing: 'border-box',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    flex: height === 'match_parent' ? '1 1 0%' : '0 0 auto',
    height: height === 'match_parent' ? '100%' : 'auto',
    alignSelf: 'stretch',
    overflow: 'visible',
    position: 'relative',
    zIndex: 1,
  }

  const slotPlaceholderStyle: CSSProperties = {
    boxSizing: 'border-box',
    width: '100%',
    height: height === 'match_parent' ? '100%' : 'auto',
    minHeight: '48px',
    flex: height === 'match_parent' ? '1 1 0%' : undefined,
    border: '1px dashed #94a3b8',
    borderRadius: '6px',
    background: 'rgba(148, 163, 184, 0.08)',
    color: '#64748b',
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
  }

  function emitInteract(
    eventKey: PreviewEventKey,
    eventArgs?: Record<string, unknown>,
  ) {
    const raw = sourceNode.attrs[eventKey]
    if (!raw?.trim()) return
    onInteract?.({
      eventKey,
      raw,
      scope: sourceNode.scope,
      dollarProps,
      ...(eventArgs ? { eventArgs } : {}),
    })
  }

  type ScrollEventDetail = {
    scrollTop: number
    scrollLeft: number
    scrollHeight: number
    scrollWidth: number
    clientHeight: number
    clientWidth: number
  }

  const PREVIEW_SCROLL_DEBOUNCE_MS = 48
  const PREVIEW_SCROLL_MAX_WAIT_MS = 80
  const previewScrollDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const previewScrollMaxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const pendingPreviewScrollDetail = useRef<ScrollEventDetail | null>(null)

  function clearPreviewScrollDebounce(flush: boolean) {
    if (previewScrollDebounceTimer.current != null) {
      clearTimeout(previewScrollDebounceTimer.current)
      previewScrollDebounceTimer.current = null
    }
    if (previewScrollMaxWaitTimer.current != null) {
      clearTimeout(previewScrollMaxWaitTimer.current)
      previewScrollMaxWaitTimer.current = null
    }
    if (!flush) {
      pendingPreviewScrollDetail.current = null
      return
    }
    const detail = pendingPreviewScrollDetail.current
    pendingPreviewScrollDetail.current = null
    if (!detail) return
    if (!interactEnabled || selectable) return
    if (countEventBindings(sourceNode.attrs.onScroll) <= 0) return
    emitInteract('onScroll', { ...detail })
  }

  function handleScroll(detail: ScrollEventDetail) {
    if (!interactEnabled || selectable) return
    if (countEventBindings(sourceNode.attrs.onScroll) <= 0) return
    pendingPreviewScrollDetail.current = { ...detail }
    if (previewScrollDebounceTimer.current != null) {
      clearTimeout(previewScrollDebounceTimer.current)
    }
    previewScrollDebounceTimer.current = setTimeout(() => {
      previewScrollDebounceTimer.current = null
      clearPreviewScrollDebounce(true)
    }, PREVIEW_SCROLL_DEBOUNCE_MS)
    if (previewScrollMaxWaitTimer.current == null) {
      previewScrollMaxWaitTimer.current = setTimeout(() => {
        previewScrollMaxWaitTimer.current = null
        clearPreviewScrollDebounce(true)
      }, PREVIEW_SCROLL_MAX_WAIT_MS)
    }
  }

  function handleScrollToLower(detail: ScrollEventDetail) {
    if (!interactEnabled || selectable) return
    if (countEventBindings(sourceNode.attrs.onScrollToLower) <= 0) return
    emitInteract('onScrollToLower', { ...detail })
  }

  function handleScrollToUpper(detail: ScrollEventDetail) {
    if (!interactEnabled || selectable) return
    if (countEventBindings(sourceNode.attrs.onScrollToUpper) <= 0) return
    emitInteract('onScrollToUpper', { ...detail })
  }

  type TouchEventDetail = {
    clientX: number
    clientY: number
    pageX: number
    pageY: number
  }

  function touchDetailFromPointer(event: React.PointerEvent): TouchEventDetail {
    return {
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
    }
  }

  function handleTouchStart(detail: TouchEventDetail) {
    if (!interactEnabled || selectable) return
    if (countEventBindings(sourceNode.attrs.onTouchStart) <= 0) return
    emitInteract('onTouchStart', { ...detail })
  }

  function handleTouchMove(detail: TouchEventDetail) {
    if (!interactEnabled || selectable) return
    if (countEventBindings(sourceNode.attrs.onTouchMove) <= 0) return
    emitInteract('onTouchMove', { ...detail })
  }

  function handleTouchEnd(detail: TouchEventDetail) {
    if (!interactEnabled || selectable) return
    if (countEventBindings(sourceNode.attrs.onTouchEnd) <= 0) return
    emitInteract('onTouchEnd', { ...detail })
  }

  const pointerTouchActive = useRef(false)

  function emitPointerTouch(
    kind: 'start' | 'move' | 'end',
    event: React.PointerEvent,
  ) {
    if (!interactEnabled || selectable) return
    if (isScrollLayout) return
    const detail = touchDetailFromPointer(event)
    if (kind === 'start') {
      pointerTouchActive.current = true
      handleTouchStart(detail)
      return
    }
    if (!pointerTouchActive.current) return
    if (kind === 'move') {
      handleTouchMove(detail)
      return
    }
    pointerTouchActive.current = false
    handleTouchEnd(detail)
  }

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function handleSelect(event: React.MouseEvent) {
    if (slotOutletSelectable && slotOutletNodeId) {
      event.stopPropagation()
      onSelect?.(slotOutletNodeId)
      return
    }
    if (selectable) {
      event.stopPropagation()
      onSelect?.(nodeId)
      return
    }
    if (longPressFired.current) {
      longPressFired.current = false
      event.stopPropagation()
      return
    }
    if (!previewClickable) return
    event.stopPropagation()
    emitInteract('onClick')
  }

  function closeModalIfAllowed() {
    if (!modalCloseOnClick) return
    modalStack?.close(modalKey)
  }

  function handleModalBackdropClick(event?: React.MouseEvent) {
    if (selectable) {
      if (event) handleSelect(event)
      return
    }
    closeModalIfAllowed()
  }

  function handleModalPanelClick(event: React.MouseEvent) {
    if (selectable) {
      handleSelect(event)
      return
    }
    if (event.target === event.currentTarget) {
      closeModalIfAllowed()
    }
  }

  function handleMouseEnter() {
    if (slotOutletSelectable && slotOutletNodeId) {
      onHover?.(slotOutletNodeId)
      return
    }
    if (!selectable) return
    onHover?.(nodeId)
  }

  function handlePointerDown(event: React.PointerEvent) {
    emitPointerTouch('start', event)
    if (!previewLongClickable) return
    longPressFired.current = false
    clearLongPress()
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      emitInteract('onLongClick')
    }, 500)
  }

  function handlePointerMove(event: React.PointerEvent) {
    emitPointerTouch('move', event)
  }

  function handlePointerUp(event: React.PointerEvent) {
    emitPointerTouch('end', event)
    clearLongPress()
    if (longPressFired.current) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  function handlePointerLeave(event: React.PointerEvent) {
    emitPointerTouch('end', event)
    clearLongPress()
  }

  function handleInputClick(event: React.MouseEvent) {
    if (selectable) {
      handleSelect(event)
      return
    }
    event.stopPropagation()
  }

  function handleInputPointerDown(event: React.PointerEvent) {
    if (selectable) return
    event.stopPropagation()
  }

  function handleInputInput(event: React.FormEvent<HTMLInputElement>) {
    if (selectable || !interactEnabled) return
    const next = event.currentTarget.value
    const field = boundInputFieldName()
    if (field) {
      onInteract?.({
        eventKey: '__setData',
        raw: '',
        scope: sourceNode.scope,
        dollarProps,
        eventArgs: { prop: field, value: next },
      })
      return
    }
    setInputLocalValue(next)
  }

  function handleOpenRepeat() {
    onOpenRepeat?.(nodeId)
  }

  function handleOpenEvent() {
    onOpenEvent?.(nodeId)
  }

  function handleOpenInspect() {
    const detail = componentDetail
    const componentId =
      detail?.id?.trim() || sourceNode.attrs.componentId?.trim() || ''
    if (!detail?.config || !componentId) return
    const label =
      detail.config.name?.trim() ||
      sourceNode.attrs.name?.trim() ||
      componentId
    const payload: PreviewInspectPayload = {
      nodeId,
      componentId,
      label,
      config: detail.config,
      hostAttrs: { ...sourceNode.attrs },
      hostDataOwnerId: hostDataOwnerComponentId?.trim() || '',
      scope: sourceNode.scope
        ? { item: sourceNode.scope.item, index: sourceNode.scope.index ?? 0 }
        : null,
    }
    if (openInspectDirect) {
      openInspectDirect(payload)
      return
    }
    onOpenInspect?.(payload)
  }

  function forwardOpenInspect(payload: PreviewInspectPayload) {
    if (openInspectDirect) {
      openInspectDirect(payload)
      return
    }
    onOpenInspect?.(payload)
  }

  function forwardSlotInteract(payload: PreviewInteractPayload) {
    onInteract?.({
      ...payload,
      fromSlotHost: true,
    })
  }

  function forwardComponentInteract(payload: PreviewInteractPayload) {
    const componentId = sourceNode.attrs.componentId?.trim() || ''
    const self: NonNullable<PreviewInteractPayload['componentEmit']> = {
      componentId,
      events: componentDetail?.config.events ?? [],
      hostAttrs: { ...sourceNode.attrs },
      hostScope: sourceNode.scope
        ? {
            item: sourceNode.scope.item,
            index: sourceNode.scope.index ?? 0,
          }
        : undefined,
    }

    function appendOuter(
      inner: NonNullable<PreviewInteractPayload['componentEmit']>,
      outer: NonNullable<PreviewInteractPayload['componentEmit']>,
    ): NonNullable<PreviewInteractPayload['componentEmit']> {
      if (!inner.outer) return { ...inner, outer }
      return { ...inner, outer: appendOuter(inner.outer, outer) }
    }

    if (payload.fromSlotHost) {
      if (payload.componentEmit) {
        onInteract?.({
          ...payload,
          componentEmit: appendOuter(payload.componentEmit, {
            ...self,
            slotHost: true,
          }),
        })
      } else {
        onInteract?.(payload)
      }
      return
    }

    const componentEmit = payload.componentEmit
      ? appendOuter(payload.componentEmit, self)
      : self

    onInteract?.({
      ...payload,
      componentEmit,
    })
  }

  function buildSelfComponentEmit():
    | NonNullable<PreviewInteractPayload['componentEmit']>
    | null {
    if (sourceNode.tag !== 'Component') return null
    const componentId = sourceNode.attrs.componentId?.trim() || ''
    if (!componentId) return null
    return {
      componentId,
      events: componentDetail?.config.events ?? [],
      hostAttrs: { ...sourceNode.attrs },
      hostScope: sourceNode.scope
        ? {
            item: sourceNode.scope.item,
            index: sourceNode.scope.index ?? 0,
          }
        : undefined,
    }
  }

  function emitComponentLifecycle(phase: 'mount' | 'unmount') {
    if (!interactEnabled || sourceNode.tag !== 'Component') return
    const componentEmit = buildSelfComponentEmit()
    if (!componentEmit) return
    onInteract?.({
      eventKey: '__lifecycle',
      raw: '',
      eventArgs: { phase },
      dollarProps: instanceDollarProps,
      scope: sourceNode.scope
        ? {
            item: sourceNode.scope.item,
            index: sourceNode.scope.index ?? 0,
          }
        : undefined,
      componentEmit,
    })
  }

  const emitLifecycleUnmount = useRef(emitComponentLifecycle)
  emitLifecycleUnmount.current = (phase) => {
    if (sourceNode.tag !== 'Component') return
    const componentEmit = buildSelfComponentEmit()
    if (!componentEmit) return
    if (phase === 'mount' && !interactEnabled) return
    onInteract?.({
      eventKey: '__lifecycle',
      raw: '',
      eventArgs: { phase },
      dollarProps: instanceDollarProps,
      scope: sourceNode.scope
        ? {
            item: sourceNode.scope.item,
            index: sourceNode.scope.index ?? 0,
          }
        : undefined,
      componentEmit,
    })
  }

  const prevGatePairRef = useRef<[boolean, number] | null>(null)
  useEffect(() => {
    const enabled = Boolean(interactEnabled)
    const gate = previewLifecycleGate ?? 0
    const prev = prevGatePairRef.current
    prevGatePairRef.current = [enabled, gate]
    if (prev == null) return
    if (sourceNode.tag !== 'Component') return
    if (!enabled || gate <= 0) return
    const prevEnabled = prev[0]
    const prevGate = prev[1]
    if (gate !== prevGate || (enabled && !prevEnabled)) {
      emitComponentLifecycle('mount')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactEnabled, previewLifecycleGate])

  const wasEnabledRef = useRef(Boolean(interactEnabled))
  useEffect(() => {
    const enabled = Boolean(interactEnabled)
    const wasEnabled = wasEnabledRef.current
    wasEnabledRef.current = enabled
    if (sourceNode.tag !== 'Component') return
    if (enabled || !wasEnabled) return
    const componentEmit = buildSelfComponentEmit()
    if (!componentEmit) return
    onInteract?.({
      eventKey: '__lifecycle',
      raw: '',
      eventArgs: { phase: 'unmount' as const },
      dollarProps: instanceDollarProps,
      scope: sourceNode.scope
        ? {
            item: sourceNode.scope.item,
            index: sourceNode.scope.index ?? 0,
          }
        : undefined,
      componentEmit,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactEnabled])

  useEffect(() => {
    if ((previewLifecycleGate ?? 0) > 0) {
      emitComponentLifecycle('mount')
    }
    return () => {
      clearPreviewScrollDebounce(false)
      clearLongPress()
      emitLifecycleUnmount.current('unmount')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shellBase = {
    widgetNodeId: nodeId,
    selected: isSelected,
    hovered: isHovered,
    marginAttrs: attrs,
    width,
    height,
    parentHorizontal,
    parentVertical,
    fillParent: isRoot,
    extraStyle: shellExtraStyle,
    repeatBadge: showRepeatBadge,
    eventBadgeCount,
    visuallyHidden,
    visibilityHidden: isEditorHidden,
    interactive: previewInteractive,
    insideScrollPort: insideScrollColumn,
    fillRemainingHeight,
    onClick: handleSelect,
    onMouseEnter: handleMouseEnter,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerLeave: handlePointerLeave,
    onOpenRepeat: handleOpenRepeat,
    onOpenEvent: handleOpenEvent,
  }

  const childShared = {
    selectedId,
    hoveredId,
    selectable,
    interactEnabled,
    previewLifecycleGate,
    iconLibrary,
    pageData,
    hostDataOwnerComponentId,
    insideComponentDefinition,
    inspectNodeId,
    hiddenNodeIds,
    componentMap,
    dollarProps,
    routeParams,
    expandRepeat,
    lubanSlotScope: childLubanSlotScope,
    onSelect,
    onHover,
    onOpenRepeat,
    onOpenEvent,
    onOpenInspect: forwardOpenInspect,
    onInteract,
    onAddWindow,
  }

  function renderBody() {
    const tag = viewNode.tag
    if (!isSupportedTag(tag)) {
      return (
        <div
          className="unsupported"
          style={{
            ...(visuallyHidden ? { display: 'none' } : {}),
            ...(isEditorHidden
              ? { visibility: 'hidden', pointerEvents: 'none' }
              : {}),
          }}
        >
          不支持的控件：{tag}
        </div>
      )
    }

    if (isFragmentTag(tag)) {
      return (
        <div
          className={`fragment-host${isRoot ? ' is-root' : ''}${fragmentOutOfFlow ? ' is-out-of-flow' : ''}`}
          style={
            isEditorHidden
              ? { visibility: 'hidden', pointerEvents: 'none' }
              : undefined
          }
        >
          {viewNode.children.map((child, index) => (
            <XmlNodeView
              key={childId(index, child.tag)}
              node={child}
              nodeId={childId(index, child.tag)}
              {...childShared}
              parentHorizontal={false}
              parentVertical
              parentScrollable={parentScrollable}
              parentHeightDefinite={heightIsDefinite}
            />
          ))}
        </div>
      )
    }

    if (tag === 'Text') {
      return (
        <WidgetSelectShell {...shellBase}>
          <div className="widget text" style={textStyle}>
            {textDisplayContent}
          </div>
        </WidgetSelectShell>
      )
    }

    if (tag === 'Button') {
      return (
        <WidgetSelectShell {...shellBase}>
          <button
            type="button"
            className={`widget button${buttonPressHasScale ? ' is-press-scale' : ''}${buttonPressHasRipple ? ' is-press-ripple' : ''}`}
            style={buttonStyle}
          >
            {textContent || 'Button'}
          </button>
        </WidgetSelectShell>
      )
    }

    if (tag === 'Input') {
      return (
        <WidgetSelectShell {...shellBase}>
          <input
            type="text"
            className="widget input"
            value={inputDisplayValue}
            placeholder={inputPlaceholder}
            readOnly={selectable}
            style={inputStyle}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={handleInputPointerDown}
            onClick={handleInputClick}
            onInput={handleInputInput}
          />
        </WidgetSelectShell>
      )
    }

    if (tag === 'Image') {
      return (
        <WidgetSelectShell {...shellBase}>
          {imageSrc ? (
            <img
              className="widget image"
              src={imageSrc}
              alt={imageAlt}
              title={imageTitle}
              loading={imageLoading}
              style={imageStyle}
              draggable={false}
              onError={() => setImageLoadFailed(true)}
            />
          ) : (
            <div
              className="widget image image-placeholder"
              style={imagePlaceholderStyle}
              title={imageTitle}
            >
              {imagePlaceholderLabel}
            </div>
          )}
        </WidgetSelectShell>
      )
    }

    if (tag === 'Icon') {
      return (
        <WidgetSelectShell {...shellBase}>
          {iconHref ? (
            <svg
              className="widget icon"
              style={iconStyle}
              viewBox={iconDef?.viewBox || '0 0 24 24'}
              aria-hidden="true"
            >
              <use href={iconHref} />
            </svg>
          ) : iconIsTemplate ? (
            <svg
              className="widget icon icon-var-placeholder"
              style={iconStyle}
              viewBox="0 0 24 24"
              aria-hidden="true"
              aria-label="变量图标占位"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="9" cy="10" r="1.2" fill="currentColor" />
              <circle cx="15" cy="10" r="1.2" fill="currentColor" />
              <path
                d="M8.5 14.5c1.2 1.4 2.6 2 3.5 2s2.3-.6 3.5-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <div className="widget icon icon-placeholder" style={iconPlaceholderStyle}>
              {iconIdRaw || 'Icon'}
            </div>
          )}
        </WidgetSelectShell>
      )
    }

    if (tag === 'Slot') {
      return (
        <WidgetSelectShell
          {...shellBase}
          fillParent={undefined}
          visuallyHidden={visuallyHidden || hideEmptySlotInPreview}
          interactive={previewInteractive || slotOutletSelectable}
        >
          {slotHasFill ? (
            <div className="widget slot-fill" style={slotFillStyle}>
              {slotFillNodes.map((entry) => (
                <XmlNodeView
                  key={entry.nodeId}
                  node={entry.node}
                  nodeId={entry.nodeId}
                  {...childShared}
                  selectable={slotFillSelectable}
                  interactEnabled={interactEnabled && !slotFillSelectable}
                  parentHorizontal={false}
                  parentVertical
                  parentScrollable={inScrollColumn}
                  parentHeightDefinite={heightIsDefinite}
                  pageData={slotFillPageData}
                  hostDataOwnerComponentId={
                    effectiveSlotScope?.hostDataOwnerId ??
                    hostDataOwnerComponentId
                  }
                  insideComponentDefinition={false}
                  dollarProps={slotFillDollarProps}
                  lubanSlotScope={effectiveSlotScope?.parent ?? null}
                  onInteract={forwardSlotInteract}
                />
              ))}
            </div>
          ) : viewNode.children.length && !effectiveSlotScope ? (
            <div className="widget slot-debug" style={slotFillStyle}>
              {viewNode.children.map((child, index) => (
                <XmlNodeView
                  key={childId(index, child.tag)}
                  node={child}
                  nodeId={childId(index, child.tag)}
                  {...childShared}
                  parentHorizontal={false}
                  parentVertical
                  parentScrollable={inScrollColumn}
                  parentHeightDefinite={heightIsDefinite}
                />
              ))}
            </div>
          ) : (
            <div className="widget slot-placeholder" style={slotPlaceholderStyle}>
              插槽 · {attrs.name?.trim() || 'default'}
            </div>
          )}
        </WidgetSelectShell>
      )
    }

    if (tag === 'Component') {
      return (
        <WidgetSelectShell
          {...shellBase}
          fillParent={undefined}
          marginAttrs={componentOutOfFlow ? {} : attrs}
          width={componentHostWidth}
          height={componentHostHeight}
          extraStyle={componentShellExtraStyle}
          inspectBadge={showComponentInspect}
          inspectLabel={inspectLabel}
          inspectActive={inspectNodeId === nodeId}
          fillRemainingHeight={componentOutOfFlow ? false : fillRemainingHeight}
          onOpenInspect={handleOpenInspect}
        >
          <div className="widget component-host" style={componentStyle}>
            {componentRoot ? (
              <XmlNodeView
                node={componentRoot}
                nodeId={`${nodeId}/c:0:${componentRoot.tag}`}
                {...childShared}
                selectable={false}
                parentVertical
                parentScrollable={inScrollColumn}
                parentHeightDefinite={heightIsDefinite}
                pageData={componentPageData ?? pageData}
                hostDataOwnerComponentId={
                  componentDetail?.id || hostDataOwnerComponentId
                }
                insideComponentDefinition
                dollarProps={instanceDollarProps}
                isRoot
                onInteract={forwardComponentInteract}
              />
            ) : (
              <div style={componentPlaceholderStyle}>
                <div className="component-title">
                  {attrs.name || attrs.componentId || 'Component'}
                </div>
                <div className="component-id">
                  {attrs.componentId
                    ? '组件未找到或 XML 为空'
                    : '未指定组件'}
                </div>
              </div>
            )}
          </div>
        </WidgetSelectShell>
      )
    }

    if (tag === 'Swiper') {
      return (
        <WidgetSelectShell
          {...shellBase}
          extraStyle={
            !interactEnabled
              ? {
                  ...shellExtraStyle,
                  overflow: 'visible',
                  maxWidth: '100%',
                  minWidth: 0,
                  width: '100%',
                }
              : shellExtraStyle
          }
        >
          <div className="widget swiper" style={swiperStyle}>
            <SwiperPort
              editable={!interactEnabled}
              overflow={parseOverflow(attrs.overflow, 'visible')}
              slideCount={viewNode.children.length}
              autoplay={Boolean(interactEnabled && swiperAutoplay)}
              interval={swiperInterval}
              circular={swiperCircular}
              indicator={swiperIndicator}
              indicatorColor={swiperIndicatorColor}
              indicatorActiveColor={swiperIndicatorActiveColor}
              duration={swiperDuration}
              current={swiperCurrent}
            >
              {(index) =>
                viewNode.children[index] ? (
                  <XmlNodeView
                    node={viewNode.children[index]!}
                    nodeId={childId(index, viewNode.children[index]!.tag)}
                    {...childShared}
                    parentHorizontal={false}
                    parentVertical
                    parentScrollable={false}
                    parentHeightDefinite
                  />
                ) : null
              }
            </SwiperPort>
          </div>
        </WidgetSelectShell>
      )
    }

    if (tag === 'MultiWindow') {
      return (
        <WidgetSelectShell {...shellBase}>
          <div className="widget multi-window" style={multiWindowStyle}>
            <MultiWindowPort
              editable={!interactEnabled}
              allowManage={selectable}
              overflow={parseOverflow(attrs.overflow, 'visible')}
              activeValue={multiWindowActiveValue}
              focusIndex={multiWindowFocusIndex}
              windows={multiWindows}
              onAddWindow={() => onAddWindow?.(nodeId)}
              onSelectWindow={(index) => {
                const child = sourceNode.children[index]
                if (!child) return
                onSelect?.(childId(index, child.tag))
              }}
            >
              {(index) =>
                viewNode.children[index] ? (
                  <XmlNodeView
                    node={viewNode.children[index]!}
                    nodeId={childId(index, viewNode.children[index]!.tag)}
                    {...childShared}
                    parentHorizontal={false}
                    parentVertical
                    parentScrollable={inScrollColumn}
                    parentHeightDefinite
                  />
                ) : null
              }
            </MultiWindowPort>
          </div>
        </WidgetSelectShell>
      )
    }

    if (tag === 'Modal' && modalHostEl) {
      return (
        <div className="modal-flow-anchor">
          {createPortal(
            modalLayerVisible ? (
              <div
                className={`modal-overlay${selectable ? ' is-edit' : ''}${isSelected ? ' is-selected' : ''}`}
                style={modalOverlayStyle}
                onClick={handleModalBackdropClick}
                onMouseEnter={handleMouseEnter}
              >
                <div
                  className="modal-panel"
                  style={modalPanelStyle}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleModalPanelClick(event)
                  }}
                >
                  {viewNode.children.map((child, index) => (
                    <XmlNodeView
                      key={childId(index, child.tag)}
                      node={child}
                      nodeId={childId(index, child.tag)}
                      {...childShared}
                      extraStyle={childRelativeStyle(child)}
                    />
                  ))}
                  {selectable && !viewNode.children.length ? (
                    <div className="modal-empty">
                      向弹层添加内容 · name「{modalKey}」
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null,
            modalHostEl,
          )}
        </div>
      )
    }

    if (tag === 'Modal') return null

    if (tag === 'LinearLayout') {
      return (
        <WidgetSelectShell
          {...shellBase}
          scrollPort={isScrollLayout}
          overflowVisible={!interactEnabled}
        >
          <OverlayScrollPort
            enabled={isScrollLayout && Boolean(interactEnabled)}
            contentClass="widget linear"
            contentStyle={linearStyle}
            onWheel={(event) => event.stopPropagation()}
            onScroll={handleScroll}
            onScrollToLower={handleScrollToLower}
            onScrollToUpper={handleScrollToUpper}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {viewNode.children.map((child, index) => (
              <XmlNodeView
                key={childId(index, child.tag)}
                node={child}
                nodeId={childId(index, child.tag)}
                {...childShared}
                parentHorizontal={isHorizontalLinear}
                parentVertical={!isHorizontalLinear}
                parentScrollable={inScrollColumn}
                parentIsScrollPort={hasScrollAttr && !isHorizontalLinear}
                parentHeightDefinite={heightIsDefinite}
              />
            ))}
          </OverlayScrollPort>
        </WidgetSelectShell>
      )
    }

    if (tag === 'RelativeLayout') {
      return (
        <WidgetSelectShell
          {...shellBase}
          scrollPort={isScrollLayout}
          overflowVisible={!interactEnabled}
        >
          <OverlayScrollPort
            enabled={isScrollLayout && Boolean(interactEnabled)}
            contentClass="widget relative"
            contentStyle={relativeStyle}
            onWheel={(event) => event.stopPropagation()}
            onScroll={handleScroll}
            onScrollToLower={handleScrollToLower}
            onScrollToUpper={handleScrollToUpper}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="relative-content">
              {viewNode.children.map((child, index) => (
                <XmlNodeView
                  key={childId(index, child.tag)}
                  node={child}
                  nodeId={childId(index, child.tag)}
                  {...childShared}
                  extraStyle={childRelativeStyle(child)}
                  parentScrollable={inScrollColumn}
                  parentIsScrollPort={hasScrollAttr}
                  parentHeightDefinite={heightIsDefinite}
                />
              ))}
            </div>
          </OverlayScrollPort>
        </WidgetSelectShell>
      )
    }

    return null
  }

  return (
    <ScrollColumnContext.Provider value={inScrollColumn}>
      <ComponentLivePageDataContext.Provider value={livePageDataForSubtree}>
        <ComponentLiveDollarPropsContext.Provider
          value={liveDollarPropsForSubtree}
        >
          {mountAllowed ? renderBody() : null}
        </ComponentLiveDollarPropsContext.Provider>
      </ComponentLivePageDataContext.Provider>
    </ScrollColumnContext.Provider>
  )
}
