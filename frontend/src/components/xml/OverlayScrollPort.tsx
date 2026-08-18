import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import './OverlayScrollPort.css'

type ScrollDetail = {
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  scrollWidth: number
  clientHeight: number
  clientWidth: number
}

type TouchDetail = {
  clientX: number
  clientY: number
  pageX: number
  pageY: number
}

type ContentClass =
  | string
  | Record<string, boolean>
  | Array<string | Record<string, boolean> | undefined | false>

function classFromInput(input?: ContentClass): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    return input
      .map((item) => classFromInput(item as ContentClass))
      .filter(Boolean)
      .join(' ')
  }
  return Object.entries(input)
    .filter(([, on]) => Boolean(on))
    .map(([name]) => name)
    .join(' ')
}

export default function OverlayScrollPort({
  enabled,
  contentClass,
  contentStyle,
  children,
  onWheel,
  onScroll,
  onScrollToLower,
  onScrollToUpper,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: {
  enabled?: boolean
  contentClass?: ContentClass
  contentStyle?: CSSProperties
  children?: ReactNode
  onWheel?: (event: WheelEvent) => void
  onScroll?: (detail: ScrollDetail) => void
  onScrollToLower?: (detail: ScrollDetail) => void
  onScrollToUpper?: (detail: ScrollDetail) => void
  onTouchStart?: (detail: TouchDetail) => void
  onTouchMove?: (detail: TouchDetail) => void
  onTouchEnd?: (detail: TouchDetail) => void
}) {
  const EDGE_THRESHOLD_PX = 50
  const atLowerEdgeRef = useRef(false)
  const atUpperEdgeRef = useRef(true)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [thumbVisible, setThumbVisible] = useState(false)
  const [thumbTop, setThumbTop] = useState(0)
  const [thumbHeight, setThumbHeight] = useState(24)
  const [canScroll, setCanScroll] = useState(false)
  const [dragScrolling, setDragScrolling] = useState(false)
  const canScrollRef = useRef(false)
  const enabledRef = useRef(Boolean(enabled))
  enabledRef.current = Boolean(enabled)
  canScrollRef.current = canScroll

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const mutationObserverRef = useRef<MutationObserver | null>(null)

  const dragPointerIdRef = useRef<number | null>(null)
  const dragStartYRef = useRef(0)
  const dragStartScrollTopRef = useRef(0)
  const dragMovedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const DRAG_THRESHOLD_PX = 6

  type VelocitySample = { y: number; t: number }
  const velocitySamplesRef = useRef<VelocitySample[]>([])
  const momentumRafRef = useRef<number | null>(null)
  const VELOCITY_WINDOW_MS = 100
  const MIN_INERTIA_VELOCITY = 0.05
  const MAX_INERTIA_VELOCITY = 3.2
  const INERTIA_FRICTION = 0.0032
  const INERTIA_STOP_VELOCITY = 0.02

  const thumbStyle = useMemo(
    () => ({
      height: `${thumbHeight}px`,
      transform: `translateY(${thumbTop}px)`,
    }),
    [thumbHeight, thumbTop],
  )

  const onScrollRef = useRef(onScroll)
  const onScrollToLowerRef = useRef(onScrollToLower)
  const onScrollToUpperRef = useRef(onScrollToUpper)
  const onTouchStartRef = useRef(onTouchStart)
  const onTouchMoveRef = useRef(onTouchMove)
  const onTouchEndRef = useRef(onTouchEnd)
  const onWheelRef = useRef(onWheel)
  onScrollRef.current = onScroll
  onScrollToLowerRef.current = onScrollToLower
  onScrollToUpperRef.current = onScrollToUpper
  onTouchStartRef.current = onTouchStart
  onTouchMoveRef.current = onTouchMove
  onTouchEndRef.current = onTouchEnd
  onWheelRef.current = onWheel

  function stopMomentum() {
    if (momentumRafRef.current == null) return
    cancelAnimationFrame(momentumRafRef.current)
    momentumRafRef.current = null
  }

  function pushVelocitySample(y: number, t = performance.now()) {
    velocitySamplesRef.current.push({ y, t })
    const cutoff = t - VELOCITY_WINDOW_MS
    while (
      velocitySamplesRef.current.length > 0 &&
      velocitySamplesRef.current[0]!.t < cutoff
    ) {
      velocitySamplesRef.current.shift()
    }
  }

  function releaseFingerVelocity(): number {
    const samples = velocitySamplesRef.current
    if (samples.length < 2) return 0
    const first = samples[0]!
    const last = samples[samples.length - 1]!
    const dt = last.t - first.t
    if (dt < 12) return 0
    return (last.y - first.y) / dt
  }

  function startMomentum(fingerVelocityPxPerMs: number) {
    stopMomentum()
    const el = bodyRef.current
    if (!el || !enabledRef.current) return

    let velocity = -fingerVelocityPxPerMs
    const abs = Math.abs(velocity)
    if (abs < MIN_INERTIA_VELOCITY) return
    if (abs > MAX_INERTIA_VELOCITY) {
      velocity = Math.sign(velocity) * MAX_INERTIA_VELOCITY
    }

    let lastTime = performance.now()

    const tick = (now: number) => {
      const target = bodyRef.current
      if (!target || !enabledRef.current) {
        momentumRafRef.current = null
        return
      }

      const dt = Math.min(34, Math.max(0, now - lastTime))
      lastTime = now
      if (dt <= 0) {
        momentumRafRef.current = requestAnimationFrame(tick)
        return
      }

      const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight)
      const nextTop = target.scrollTop + velocity * dt
      if (nextTop <= 0 || nextTop >= maxScroll) {
        target.scrollTop = Math.min(maxScroll, Math.max(0, nextTop))
        revealThumb()
        momentumRafRef.current = null
        return
      }

      target.scrollTop = nextTop
      velocity *= Math.exp(-INERTIA_FRICTION * dt)
      revealThumb()

      if (Math.abs(velocity) < INERTIA_STOP_VELOCITY) {
        momentumRafRef.current = null
        return
      }

      momentumRafRef.current = requestAnimationFrame(tick)
    }

    momentumRafRef.current = requestAnimationFrame(tick)
  }

  function clearHideTimer() {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  function scheduleHide() {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      setThumbVisible(false)
    }, 900)
  }

  const updateThumb = useCallback(() => {
    const el = bodyRef.current
    if (!el || !enabledRef.current) {
      canScrollRef.current = false
      setCanScroll(false)
      setThumbVisible(false)
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = el
    const overflow = scrollHeight - clientHeight
    const nextCanScroll = overflow > 1
    canScrollRef.current = nextCanScroll
    setCanScroll(nextCanScroll)
    if (!nextCanScroll) {
      setThumbVisible(false)
      return
    }

    const track = clientHeight
    const size = Math.max(20, (clientHeight / scrollHeight) * track)
    const maxTop = Math.max(0, track - size)
    const top = overflow > 0 ? (scrollTop / overflow) * maxTop : 0
    setThumbHeight(size)
    setThumbTop(top)
  }, [])

  function revealThumb() {
    updateThumb()
    if (!canScrollRef.current) return
    setThumbVisible(true)
    scheduleHide()
  }

  function scrollDetail(el: HTMLElement): ScrollDetail {
    return {
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      scrollHeight: el.scrollHeight,
      scrollWidth: el.scrollWidth,
      clientHeight: el.clientHeight,
      clientWidth: el.clientWidth,
    }
  }

  const scrollEmitRafRef = useRef<number | null>(null)
  const touchMoveEmitRafRef = useRef<number | null>(null)
  const pendingTouchMoveRef = useRef<TouchDetail | null>(null)

  function flushScrollEmit() {
    scrollEmitRafRef.current = null
    if (!enabledRef.current) return
    const el = bodyRef.current
    if (!el) return
    const detail = scrollDetail(el)
    onScrollRef.current?.(detail)

    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
    const nowLower = maxScroll > 0 && el.scrollTop >= maxScroll - EDGE_THRESHOLD_PX
    const nowUpper = el.scrollTop <= EDGE_THRESHOLD_PX
    if (nowLower && !atLowerEdgeRef.current) onScrollToLowerRef.current?.(detail)
    if (nowUpper && !atUpperEdgeRef.current) onScrollToUpperRef.current?.(detail)
    atLowerEdgeRef.current = nowLower
    atUpperEdgeRef.current = nowUpper
  }

  function handleScroll() {
    if (!enabledRef.current) return
    revealThumb()
    if (scrollEmitRafRef.current != null) return
    scrollEmitRafRef.current = requestAnimationFrame(flushScrollEmit)
  }

  function flushTouchMoveEmit() {
    touchMoveEmitRafRef.current = null
    if (!enabledRef.current || !pendingTouchMoveRef.current) return
    const detail = pendingTouchMoveRef.current
    pendingTouchMoveRef.current = null
    onTouchMoveRef.current?.(detail)
  }

  function scheduleTouchMoveEmit(detail: TouchDetail) {
    pendingTouchMoveRef.current = detail
    if (touchMoveEmitRafRef.current != null) return
    touchMoveEmitRafRef.current = requestAnimationFrame(flushTouchMoveEmit)
  }

  function cancelEmitRafs() {
    if (scrollEmitRafRef.current != null) {
      cancelAnimationFrame(scrollEmitRafRef.current)
      scrollEmitRafRef.current = null
    }
    if (touchMoveEmitRafRef.current != null) {
      cancelAnimationFrame(touchMoveEmitRafRef.current)
      touchMoveEmitRafRef.current = null
    }
    pendingTouchMoveRef.current = null
  }

  function touchDetail(event: React.TouchEvent, preferChanged: boolean): TouchDetail | null {
    const native = event.nativeEvent
    const t = preferChanged
      ? (native.changedTouches[0] ?? native.touches[0])
      : (native.touches[0] ?? native.changedTouches[0])
    if (!t) return null
    return {
      clientX: t.clientX,
      clientY: t.clientY,
      pageX: t.pageX,
      pageY: t.pageY,
    }
  }

  function detailFromPointer(event: PointerEvent): TouchDetail {
    return {
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
    }
  }

  const simTouchPointerIdRef = useRef<number | null>(null)

  function handleTouchStart(event: React.TouchEvent) {
    if (!enabledRef.current) return
    const detail = touchDetail(event, false)
    if (!detail) return
    onTouchStartRef.current?.(detail)
  }

  function handleTouchMove(event: React.TouchEvent) {
    if (!enabledRef.current) return
    const detail = touchDetail(event, false)
    if (!detail) return
    scheduleTouchMoveEmit(detail)
  }

  function handleTouchEnd(event: React.TouchEvent) {
    if (!enabledRef.current) return
    if (touchMoveEmitRafRef.current != null) {
      cancelAnimationFrame(touchMoveEmitRafRef.current)
      flushTouchMoveEmit()
    }
    const detail = touchDetail(event, true)
    if (!detail) return
    onTouchEndRef.current?.(detail)
  }

  function endSimTouch(event: PointerEvent) {
    if (
      simTouchPointerIdRef.current == null ||
      event.pointerId !== simTouchPointerIdRef.current
    ) {
      return
    }
    if (touchMoveEmitRafRef.current != null) {
      cancelAnimationFrame(touchMoveEmitRafRef.current)
      flushTouchMoveEmit()
    }
    onTouchEndRef.current?.(detailFromPointer(event))
    simTouchPointerIdRef.current = null
  }

  function handleWheel(event: React.WheelEvent) {
    stopMomentum()
    if (enabledRef.current) onWheelRef.current?.(event.nativeEvent)
  }

  const windowPointerBoundRef = useRef(false)
  const sessionPointerIdRef = useRef<number | null>(null)

  function unbindWindowPointerSession() {
    if (!windowPointerBoundRef.current) return
    windowPointerBoundRef.current = false
    window.removeEventListener('pointermove', onWindowPointerMove, true)
    window.removeEventListener('pointerup', onWindowPointerUp, true)
    window.removeEventListener('pointercancel', onWindowPointerUp, true)
  }

  function bindWindowPointerSession(pointerId: number) {
    sessionPointerIdRef.current = pointerId
    if (windowPointerBoundRef.current) return
    windowPointerBoundRef.current = true
    window.addEventListener('pointermove', onWindowPointerMove, true)
    window.addEventListener('pointerup', onWindowPointerUp, true)
    window.addEventListener('pointercancel', onWindowPointerUp, true)
  }

  function endDrag(_el?: HTMLElement | null, withInertia = false) {
    if (dragPointerIdRef.current == null) return

    const shouldInertia = withInertia && dragMovedRef.current
    const fingerVelocity = shouldInertia ? releaseFingerVelocity() : 0

    if (dragMovedRef.current) {
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
    dragPointerIdRef.current = null
    dragMovedRef.current = false
    setDragScrolling(false)
    velocitySamplesRef.current = []

    if (shouldInertia) startMomentum(fingerVelocity)
  }

  function handleDragPointerMove(event: PointerEvent) {
    if (
      dragPointerIdRef.current == null ||
      event.pointerId !== dragPointerIdRef.current
    ) {
      return
    }
    const el = bodyRef.current
    if (!el) return
    pushVelocitySample(event.clientY)
    const dy = event.clientY - dragStartYRef.current
    if (!dragMovedRef.current && Math.abs(dy) < DRAG_THRESHOLD_PX) return

    if (!dragMovedRef.current) {
      dragMovedRef.current = true
      setDragScrolling(true)
    }

    event.preventDefault()
    el.scrollTop = dragStartScrollTopRef.current - dy
    revealThumb()
  }

  function onWindowPointerMove(event: PointerEvent) {
    if (
      sessionPointerIdRef.current == null ||
      event.pointerId !== sessionPointerIdRef.current
    ) {
      return
    }
    if (
      simTouchPointerIdRef.current != null &&
      event.pointerId === simTouchPointerIdRef.current
    ) {
      scheduleTouchMoveEmit(detailFromPointer(event))
    }
    handleDragPointerMove(event)
  }

  function onWindowPointerUp(event: PointerEvent) {
    if (
      sessionPointerIdRef.current == null ||
      event.pointerId !== sessionPointerIdRef.current
    ) {
      return
    }
    endSimTouch(event)
    if (
      dragPointerIdRef.current != null &&
      event.pointerId === dragPointerIdRef.current
    ) {
      pushVelocitySample(event.clientY)
      endDrag(bodyRef.current, event.type !== 'pointercancel')
    }
    sessionPointerIdRef.current = null
    unbindWindowPointerSession()
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (!enabledRef.current) return
    if (event.pointerType === 'touch') return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    simTouchPointerIdRef.current = event.pointerId
    onTouchStartRef.current?.(detailFromPointer(event.nativeEvent))

    const el = bodyRef.current
    if (!el) return
    stopMomentum()
    updateThumb()

    bindWindowPointerSession(event.pointerId)

    if (!canScrollRef.current) return

    dragPointerIdRef.current = event.pointerId
    dragStartYRef.current = event.clientY
    dragStartScrollTopRef.current = el.scrollTop
    dragMovedRef.current = false
    setDragScrolling(false)
    velocitySamplesRef.current = [{ y: event.clientY, t: performance.now() }]
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (
      windowPointerBoundRef.current &&
      sessionPointerIdRef.current === event.pointerId
    ) {
      return
    }
    if (
      simTouchPointerIdRef.current != null &&
      event.pointerId === simTouchPointerIdRef.current
    ) {
      scheduleTouchMoveEmit(detailFromPointer(event.nativeEvent))
    }
    handleDragPointerMove(event.nativeEvent)
  }

  function handlePointerUp(event: React.PointerEvent) {
    if (
      windowPointerBoundRef.current &&
      sessionPointerIdRef.current === event.pointerId
    ) {
      return
    }
    endSimTouch(event.nativeEvent)
    if (
      dragPointerIdRef.current == null ||
      event.pointerId !== dragPointerIdRef.current
    ) {
      return
    }
    pushVelocitySample(event.clientY)
    endDrag(bodyRef.current, true)
  }

  function handlePointerCancel(event: React.PointerEvent) {
    if (
      windowPointerBoundRef.current &&
      sessionPointerIdRef.current === event.pointerId
    ) {
      return
    }
    endSimTouch(event.nativeEvent)
    if (
      dragPointerIdRef.current == null ||
      event.pointerId !== dragPointerIdRef.current
    ) {
      return
    }
    endDrag(bodyRef.current, false)
  }

  function onClickCapture(event: React.MouseEvent) {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  function bindObservers() {
    const el = bodyRef.current
    if (!el || !enabledRef.current) return

    resizeObserverRef.current?.disconnect()
    mutationObserverRef.current?.disconnect()

    resizeObserverRef.current = new ResizeObserver(() => {
      updateThumb()
    })
    resizeObserverRef.current.observe(el)

    mutationObserverRef.current = new MutationObserver(() => {
      updateThumb()
    })
    mutationObserverRef.current.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  function unbindObservers() {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    mutationObserverRef.current?.disconnect()
    mutationObserverRef.current = null
    clearHideTimer()
  }

  useEffect(() => {
    queueMicrotask(() => {
      if (enabledRef.current) {
        bindObservers()
        updateThumb()
      }
    })
    return () => {
      stopMomentum()
      endDrag()
      simTouchPointerIdRef.current = null
      sessionPointerIdRef.current = null
      unbindWindowPointerSession()
      cancelEmitRafs()
      unbindObservers()
    }
    // mount/unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    stopMomentum()
    unbindObservers()
    atLowerEdgeRef.current = false
    atUpperEdgeRef.current = true
    queueMicrotask(() => {
      if (enabled) {
        bindObservers()
        updateThumb()
      } else {
        canScrollRef.current = false
        setCanScroll(false)
        setThumbVisible(false)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const bodyClass = [
    'overlay-scroll-body',
    classFromInput(contentClass),
    enabled ? 'is-scrollable' : '',
    dragScrolling ? 'is-drag-scrolling' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={`overlay-scroll-port${enabled ? ' is-enabled' : ''}`}
    >
      <div
        ref={bodyRef}
        className={bodyClass}
        style={contentStyle}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      {enabled && canScroll ? (
        <div
          className={`overlay-scroll-thumb${thumbVisible ? ' is-visible' : ''}`}
          style={thumbStyle}
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
}
