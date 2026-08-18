import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  BadgeHostContext,
  CanvasToolModeContext,
} from '../../composables/useModalStack'
import {
  InspectHostContext,
  PhoneFrameContext,
  getInspectButtonY,
  removeInspectCallout,
  subscribeInspectLayout,
  upsertInspectCallout,
} from '../../composables/useInspectCalloutLayout'
import {
  hasMargin,
  marginStyle,
  marginValues,
  matchParentAxisSize,
  parseSize,
} from '../../utils/xml'
import RepeatBadge from './RepeatBadge'
import EventBadge from './EventBadge'
import InspectBadge from './InspectBadge'
import './WidgetSelectShell.css'

export default function WidgetSelectShell({
  selected,
  hovered,
  marginAttrs,
  width,
  height,
  parentHorizontal,
  parentVertical,
  fillParent,
  extraStyle,
  repeatBadge,
  eventBadgeCount,
  inspectBadge,
  inspectLabel,
  inspectActive,
  visuallyHidden,
  visibilityHidden,
  interactive,
  scrollPort,
  overflowVisible,
  insideScrollPort,
  fillRemainingHeight,
  widgetNodeId,
  children,
  onClick,
  onMouseEnter,
  onOpenRepeat,
  onOpenEvent,
  onOpenInspect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
}: {
  selected?: boolean
  hovered?: boolean
  marginAttrs: Record<string, string>
  width?: ReturnType<typeof parseSize>
  height?: ReturnType<typeof parseSize>
  parentHorizontal?: boolean
  parentVertical?: boolean
  fillParent?: boolean
  extraStyle?: CSSProperties
  repeatBadge?: boolean
  eventBadgeCount?: number
  inspectBadge?: boolean
  inspectLabel?: string
  inspectActive?: boolean
  visuallyHidden?: boolean
  visibilityHidden?: boolean
  interactive?: boolean
  scrollPort?: boolean
  overflowVisible?: boolean
  insideScrollPort?: boolean
  fillRemainingHeight?: boolean
  widgetNodeId?: string
  children?: ReactNode
  onClick?: (event: React.MouseEvent) => void
  onMouseEnter?: () => void
  onOpenRepeat?: () => void
  onOpenEvent?: () => void
  onOpenInspect?: () => void
  onPointerDown?: (event: React.PointerEvent) => void
  onPointerMove?: (event: React.PointerEvent) => void
  onPointerUp?: (event: React.PointerEvent) => void
  onPointerLeave?: (event: React.PointerEvent) => void
  onPointerCancel?: (event: React.PointerEvent) => void
}) {
  const matchParentWidth = width === 'match_parent'
  const matchParentHeight = height === 'match_parent'
  const isAbsolute = extraStyle?.position === 'absolute'
  const scrollPortClip = Boolean(scrollPort) && !overflowVisible
  const absoluteStretchedX = Boolean(
    isAbsolute && extraStyle && matchParentWidth && extraStyle.left != null && extraStyle.right != null,
  )
  const absoluteStretchedY = Boolean(
    isAbsolute && extraStyle && matchParentHeight && extraStyle.top != null && extraStyle.bottom != null,
  )

  const shellStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {
      position: 'relative',
      maxWidth: '100%',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      cursor: interactive ? 'pointer' : undefined,
      ...marginStyle(marginAttrs),
      ...(extraStyle ?? {}),
    }

    if (visuallyHidden) {
      style.display = 'none'
    }

    if (visibilityHidden && !visuallyHidden) {
      style.visibility = 'hidden'
      style.pointerEvents = 'none'
    }

    const zRaw = marginAttrs.zIndex?.trim()
    if (zRaw) {
      const n = Number(zRaw.replace(/px$/i, ''))
      if (Number.isFinite(n)) style.zIndex = n
    }

    if (isAbsolute) {
      if (!matchParentWidth && style.left != null && style.right != null) {
        style.right = undefined
      }
      if (!matchParentHeight && style.top != null && style.bottom != null) {
        style.bottom = undefined
      }

      if (absoluteStretchedX) {
        style.width = undefined
        style.minWidth = 0
      } else if (matchParentWidth) {
        style.width = matchParentAxisSize('width', marginAttrs)
        style.minWidth = 0
      } else if (typeof width === 'number') {
        style.width = `${width}px`
        style.flexShrink = 0
      } else {
        style.width = 'fit-content'
        style.maxWidth = '100%'
      }

      if (absoluteStretchedY) {
        style.height = undefined
        if (scrollPort) {
          style.minHeight = 0
          if (scrollPortClip) style.overflow = 'hidden'
          else style.overflow = 'visible'
        }
      } else if (matchParentHeight) {
        style.height = matchParentAxisSize('height', marginAttrs)
        if (scrollPort) {
          style.minHeight = 0
          if (scrollPortClip) style.overflow = 'hidden'
          else style.overflow = 'visible'
        }
      } else if (typeof height === 'number') {
        style.height = `${height}px`
        style.flexShrink = 0
      } else {
        style.height = 'fit-content'
      }
      return style
    }

    if (fillParent) {
      style.minHeight = 0
      style.minWidth = 0
      const wrapW = width === 'wrap_content'
      const wrapH = height === 'wrap_content'
      if (wrapW || wrapH) {
        style.flex = '0 0 auto'
        style.alignSelf = wrapW ? 'flex-start' : 'stretch'
      } else {
        style.flex = '1 1 auto'
        style.alignSelf = 'stretch'
      }
      if (matchParentWidth || width === undefined) {
        style.width = matchParentAxisSize('width', marginAttrs)
      } else if (typeof width === 'number') {
        style.width = `${width}px`
      } else if (wrapW) {
        style.width = 'fit-content'
        style.maxWidth = '100%'
      }
      if (matchParentHeight || height === undefined) {
        style.height = matchParentAxisSize('height', marginAttrs)
      } else if (typeof height === 'number') {
        style.height = `${height}px`
      } else if (wrapH) {
        style.height = 'fit-content'
        style.maxHeight = '100%'
      }
      if (scrollPortClip) style.overflow = 'hidden'
      else if (scrollPort) style.overflow = 'visible'
      return style
    }

    if (matchParentWidth) {
      if (parentHorizontal) {
        style.flex = '1 1 0%'
        style.minWidth = 0
        style.width = 'auto'
      } else {
        style.alignSelf = 'stretch'
        style.width = 'auto'
      }
    } else if (typeof width === 'number') {
      style.width = `${width}px`
      style.flexShrink = 0
    }

    if (matchParentHeight) {
      if (scrollPort) {
        style.flex = '1 1 0%'
        style.minHeight = 0
        style.height = '0'
        if (scrollPortClip) style.overflow = 'hidden'
        else style.overflow = 'visible'
      } else if (parentVertical && fillRemainingHeight) {
        style.flex = '1 1 0%'
        style.minHeight = 0
        style.height = '0'
      } else if (insideScrollPort || parentVertical) {
        style.alignSelf = 'stretch'
        style.height = 'auto'
        style.flex = '0 0 auto'
        style.flexShrink = 0
      } else {
        style.alignSelf = 'stretch'
        style.height = 'auto'
      }
    } else if (typeof height === 'number') {
      style.height = `${height}px`
      style.flexShrink = 0
      if (scrollPortClip) style.overflow = 'hidden'
      else if (scrollPort) style.overflow = 'visible'
    }

    return style
  }, [
    absoluteStretchedX,
    absoluteStretchedY,
    extraStyle,
    fillParent,
    fillRemainingHeight,
    height,
    insideScrollPort,
    interactive,
    isAbsolute,
    marginAttrs,
    matchParentHeight,
    matchParentWidth,
    parentHorizontal,
    parentVertical,
    scrollPort,
    scrollPortClip,
    visibilityHidden,
    visuallyHidden,
    width,
  ])

  const fillWidth = matchParentWidth || absoluteStretchedX
  const fillHeight = matchParentHeight || absoluteStretchedY
  const stackByContent =
    !scrollPort &&
    !fillRemainingHeight &&
    (insideScrollPort || parentVertical)
  const allowShrinkBelowContent =
    Boolean(scrollPort) || (matchParentHeight && !stackByContent)

  const marginBoxStyle = useMemo(
    () => ({
      flex: allowShrinkBelowContent ? '1 1 0%' : '0 0 auto',
      display: 'flex',
      flexDirection: 'column' as const,
      minHeight: allowShrinkBelowContent ? 0 : undefined,
      minWidth: allowShrinkBelowContent || parentHorizontal ? 0 : undefined,
      width: fillWidth ? '100%' : undefined,
      height: stackByContent ? 'auto' : fillHeight ? '100%' : undefined,
      ...(scrollPortClip ? { overflow: 'hidden' as const } : {}),
      ...(scrollPort && overflowVisible
        ? { overflow: 'visible' as const }
        : {}),
    }),
    [
      allowShrinkBelowContent,
      fillHeight,
      fillWidth,
      overflowVisible,
      parentHorizontal,
      scrollPort,
      scrollPortClip,
      stackByContent,
    ],
  )

  const contentBoxStyle = useMemo<CSSProperties>(
    () => ({
      position: 'relative',
      flex: allowShrinkBelowContent ? '1 1 0%' : '0 0 auto',
      display: 'flex',
      flexDirection: 'column' as const,
      minHeight: allowShrinkBelowContent ? 0 : undefined,
      minWidth: allowShrinkBelowContent || parentHorizontal ? 0 : undefined,
      width: fillWidth ? '100%' : undefined,
      height: stackByContent ? 'auto' : fillHeight ? '100%' : undefined,
      ...(scrollPortClip ? { overflow: 'hidden' as const } : {}),
      ...(scrollPort && overflowVisible
        ? { overflow: 'visible' as const }
        : {}),
    }),
    [
      allowShrinkBelowContent,
      fillHeight,
      fillWidth,
      overflowVisible,
      parentHorizontal,
      scrollPort,
      scrollPortClip,
      stackByContent,
    ],
  )

  const showMarginFrame = (selected || hovered) && hasMargin(marginAttrs)
  const showContentFrame = selected || hovered || inspectActive

  const badgeHostRef = useContext(BadgeHostContext)
  const inspectHostRef = useContext(InspectHostContext)
  const phoneFrameRef = useContext(PhoneFrameContext)
  const toolMode = useContext(CanvasToolModeContext)

  const [, hostTick] = useState(0)
  useEffect(() => {
    hostTick((n) => n + 1)
  }, [badgeHostRef, inspectHostRef, phoneFrameRef])

  const hasEditBadges =
    toolMode !== 'measure' &&
    (Boolean(repeatBadge) || (eventBadgeCount ?? 0) > 0)
  const hasInspectBadge = toolMode !== 'measure' && Boolean(inspectBadge)
  const badgeHostEl = badgeHostRef?.current ?? null
  const inspectHostEl = inspectHostRef?.current ?? null
  const contentBoxRef = useRef<HTMLDivElement | null>(null)
  const [badgeAnchorStyle, setBadgeAnchorStyle] = useState<CSSProperties>({
    visibility: 'hidden',
  })
  const [inspectAnchorStyle, setInspectAnchorStyle] = useState<CSSProperties>({
    visibility: 'hidden',
  })
  const [inspectSide, setInspectSide] = useState<'left' | 'right'>('right')
  const [inspectStemH, setInspectStemH] = useState(28)
  const [inspectRise, setInspectRise] = useState(-16)
  const INSPECT_BTN = 18
  const OUTSIDE_PAD = 72
  const lastInspectMidYRef = useRef(0)
  const badgeSyncRafRef = useRef(0)
  const badgeLiveRafRef = useRef(0)
  const badgeResizeObserverRef = useRef<ResizeObserver | null>(null)
  const inspectSideRef = useRef(inspectSide)
  inspectSideRef.current = inspectSide
  const inspectStemHRef = useRef(inspectStemH)
  inspectStemHRef.current = inspectStemH
  const inspectRiseRef = useRef(inspectRise)
  inspectRiseRef.current = inspectRise
  const inspectAnchorStyleRef = useRef(inspectAnchorStyle)
  inspectAnchorStyleRef.current = inspectAnchorStyle

  const useBadgeTeleport = hasEditBadges && Boolean(badgeHostEl)
  const useInspectTeleport = hasInspectBadge && Boolean(inspectHostEl)
  const needBadgeSync = hasEditBadges || hasInspectBadge

  function syncBadgeAnchor() {
    const box = contentBoxRef.current
    if (!box) {
      setBadgeAnchorStyle({ visibility: 'hidden' })
      setInspectAnchorStyle({ visibility: 'hidden' })
      return
    }
    const br = box.getBoundingClientRect()
    const badgeHost = badgeHostRef?.current
    const bhr = badgeHost?.getBoundingClientRect()
    const phone = phoneFrameRef?.current ?? badgeHost
    const pr = phone?.getBoundingClientRect()
    const inspectHost = inspectHostRef?.current
    const ihr = inspectHost?.getBoundingClientRect()

    if (hasInspectBadge) {
      const boxMidX = (br.left + br.right) / 2
      const midX = pr ? (pr.left + pr.right) / 2 : window.innerWidth / 2
      setInspectSide(boxMidX >= midX ? 'right' : 'left')
    }

    if (hasEditBadges && badgeHost && bhr && bhr.width >= 1) {
      const scaleX = badgeHost.offsetWidth / bhr.width
      const scaleY = badgeHost.offsetHeight / bhr.height
      setBadgeAnchorStyle({
        position: 'absolute',
        top: `${(br.top - bhr.top) * scaleY}px`,
        left: `${(br.right - bhr.left) * scaleX}px`,
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
        visibility: 'visible',
      })
    } else {
      setBadgeAnchorStyle({ visibility: 'hidden' })
    }

    const side = inspectSideRef.current
    if (hasInspectBadge && inspectHost && ihr && pr && ihr.width >= 1) {
      const scaleX = inspectHost.offsetWidth / ihr.width
      const scaleY = inspectHost.offsetHeight / ihr.height
      const edgeX = side === 'right' ? br.right : br.left
      const midY = (br.top + br.bottom) / 2
      const phoneEdge = side === 'right' ? pr.right : pr.left
      const stemScreen =
        side === 'right'
          ? phoneEdge + OUTSIDE_PAD - edgeX
          : edgeX - (phoneEdge - OUTSIDE_PAD)
      const nextStem = Math.max(16, stemScreen * scaleX)
      if (Math.abs(inspectStemHRef.current - nextStem) > 0.5) {
        setInspectStemH(nextStem)
      }

      const midLocalY = (midY - ihr.top) * scaleY
      lastInspectMidYRef.current = midLocalY
      const calloutId = widgetNodeId || 'inspect'
      const preferredBtnY = midLocalY - 16
      const buttonY = upsertInspectCallout({
        id: calloutId,
        side,
        preferredY: preferredBtnY,
        btnSize: INSPECT_BTN,
      })
      const nextRise = buttonY - midLocalY
      if (Math.abs(inspectRiseRef.current - nextRise) > 0.5) {
        setInspectRise(nextRise)
      }

      const nextLeft = (edgeX - ihr.left) * scaleX
      const prev = inspectAnchorStyleRef.current
      const prevTop = typeof prev.top === 'string' ? parseFloat(prev.top) : NaN
      const prevLeft = typeof prev.left === 'string' ? parseFloat(prev.left) : NaN
      if (
        prev.visibility !== 'visible' ||
        !Number.isFinite(prevTop) ||
        !Number.isFinite(prevLeft) ||
        Math.abs(prevTop - midLocalY) > 0.5 ||
        Math.abs(prevLeft - nextLeft) > 0.5
      ) {
        setInspectAnchorStyle({
          position: 'absolute',
          top: `${midLocalY}px`,
          left: `${nextLeft}px`,
          width: 0,
          height: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          visibility: 'visible',
          zIndex: 100060,
        })
      }
    } else {
      if (widgetNodeId) removeInspectCallout(widgetNodeId)
      if (inspectAnchorStyleRef.current.visibility !== 'hidden') {
        setInspectAnchorStyle({ visibility: 'hidden' })
      }
    }
  }

  function scheduleSyncBadgeAnchor() {
    if (badgeSyncRafRef.current) cancelAnimationFrame(badgeSyncRafRef.current)
    badgeSyncRafRef.current = requestAnimationFrame(() => {
      badgeSyncRafRef.current = 0
      syncBadgeAnchor()
    })
  }

  function startBadgeLiveSync() {
    if (badgeLiveRafRef.current) return
    const tick = () => {
      if (!needBadgeSync) {
        badgeLiveRafRef.current = 0
        return
      }
      syncBadgeAnchor()
      badgeLiveRafRef.current = requestAnimationFrame(tick)
    }
    badgeLiveRafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    return subscribeInspectLayout(() => {
      if (!hasInspectBadge || !widgetNodeId) return
      const y = getInspectButtonY(widgetNodeId)
      if (y == null) return
      const nextRise = y - lastInspectMidYRef.current
      if (Math.abs(inspectRiseRef.current - nextRise) > 0.5) {
        setInspectRise(nextRise)
      }
    })
  }, [hasInspectBadge, widgetNodeId])

  const frameKind = selected
    ? 'selected'
    : inspectActive
      ? 'inspecting'
      : hovered
        ? 'hovered'
        : ''

  const marginFrameStyle = useMemo<CSSProperties>(() => {
    if (!showMarginFrame) return {}
    const m = marginValues(marginAttrs)
    return {
      top: `${-m.top}px`,
      left: `${-m.left}px`,
      right: `${-m.right}px`,
      bottom: `${-m.bottom}px`,
    }
  }, [marginAttrs, showMarginFrame])

  useEffect(() => {
    queueMicrotask(() => {
      scheduleSyncBadgeAnchor()
      if (needBadgeSync) startBadgeLiveSync()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needBadgeSync])

  useEffect(() => {
    scheduleSyncBadgeAnchor()
    window.addEventListener('resize', scheduleSyncBadgeAnchor)
    window.addEventListener('scroll', scheduleSyncBadgeAnchor, true)
    if (typeof ResizeObserver !== 'undefined') {
      badgeResizeObserverRef.current = new ResizeObserver(() =>
        scheduleSyncBadgeAnchor(),
      )
      if (contentBoxRef.current) {
        badgeResizeObserverRef.current.observe(contentBoxRef.current)
      }
      if (badgeHostEl) badgeResizeObserverRef.current.observe(badgeHostEl)
      if (inspectHostEl) badgeResizeObserverRef.current.observe(inspectHostEl)
    }
    return () => {
      if (badgeSyncRafRef.current) cancelAnimationFrame(badgeSyncRafRef.current)
      if (badgeLiveRafRef.current) cancelAnimationFrame(badgeLiveRafRef.current)
      badgeLiveRafRef.current = 0
      window.removeEventListener('resize', scheduleSyncBadgeAnchor)
      window.removeEventListener('scroll', scheduleSyncBadgeAnchor, true)
      badgeResizeObserverRef.current?.disconnect()
      badgeResizeObserverRef.current = null
      if (widgetNodeId) removeInspectCallout(widgetNodeId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const observer = badgeResizeObserverRef.current
    if (!observer) return
    if (inspectHostEl) observer.observe(inspectHostEl)
    scheduleSyncBadgeAnchor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectHostEl])

  const editBadges = (
    <div className="badge-stack">
      {(eventBadgeCount ?? 0) > 0 ? (
        <EventBadge
          count={eventBadgeCount}
          clickable
          onClick={() => onOpenEvent?.()}
        />
      ) : null}
      {repeatBadge ? (
        <RepeatBadge clickable onClick={() => onOpenRepeat?.()} />
      ) : null}
    </div>
  )

  return (
    <div
      className={`select-shell${visuallyHidden ? ' is-vshow-hidden' : ''}`}
      style={shellStyle}
      data-widget-node-id={widgetNodeId || undefined}
      onClick={(event) => onClick?.(event)}
      onMouseEnter={() => onMouseEnter?.()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
    >
      {showMarginFrame ? (
        <div
          className={`frame-margin ${frameKind}`.trim()}
          style={marginFrameStyle}
        />
      ) : null}
      <div className="margin-box" style={marginBoxStyle}>
        <div
          ref={contentBoxRef}
          className={[
            'content-box',
            selected ? 'selected' : '',
            hovered && !selected && !inspectActive ? 'hovered' : '',
            inspectActive && !selected ? 'inspecting' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={contentBoxStyle}
        >
          {children}
          {showContentFrame ? (
            <div className={`frame-content ${frameKind}`.trim()} />
          ) : null}
          {hasEditBadges && !useBadgeTeleport ? editBadges : null}
        </div>
      </div>
      {useBadgeTeleport && badgeHostEl
        ? createPortal(
            <div className="badge-anchor" style={badgeAnchorStyle}>
              {editBadges}
            </div>,
            badgeHostEl,
          )
        : null}
      {useInspectTeleport && inspectHostEl
        ? createPortal(
            <div className="badge-anchor" style={inspectAnchorStyle}>
              <InspectBadge
                side={inspectSide}
                active={inspectActive}
                label={inspectLabel}
                size={INSPECT_BTN}
                stemH={inspectStemH}
                rise={inspectRise}
                onClick={() => onOpenInspect?.()}
              />
            </div>,
            inspectHostEl,
          )
        : null}
    </div>
  )
}
