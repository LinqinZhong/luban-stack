import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { OverflowStrategy } from '../../utils/xml'
import './SwiperPort.css'

export default function SwiperPort({
  editable = false,
  overflow = 'visible',
  slideCount,
  autoplay = false,
  interval = 3000,
  circular = true,
  indicator = true,
  indicatorColor = 'rgba(0,0,0,0.25)',
  indicatorActiveColor = '#409eff',
  duration = 280,
  current = 0,
  children,
}: {
  editable?: boolean
  overflow?: OverflowStrategy
  slideCount: number
  autoplay?: boolean
  interval?: number
  circular?: boolean
  indicator?: boolean
  indicatorColor?: string
  indicatorActiveColor?: string
  duration?: number
  current?: number
  children?: (index: number) => ReactNode
}) {
  void overflow
  const [index, setIndex] = useState(0)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [slideWidthPx, setSlideWidthPx] = useState(0)
  const lockedEditSlideWRef = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const startOffsetRef = useRef(0)
  const lockAxisRef = useRef<'x' | 'y' | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const suppressClickUntilRef = useRef(0)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const windowPointerBoundRef = useRef(false)
  const sessionPointerIdRef = useRef<number | null>(null)

  const count = Math.max(0, slideCount)
  const EDIT_GAP_PX = 8
  const editableRef = useRef(editable)
  const circularRef = useRef(circular)
  const countRef = useRef(count)
  const durationRef = useRef(duration)
  const autoplayRef = useRef(autoplay)
  const intervalRef = useRef(interval)
  editableRef.current = editable
  circularRef.current = circular
  countRef.current = count
  durationRef.current = duration
  autoplayRef.current = autoplay
  intervalRef.current = interval

  function measureSwiperWindowWidth(el: HTMLElement): number {
    const host = el.parentElement
    if (!host) return Math.max(0, Math.round(el.clientWidth))
    let w = Math.round(host.clientWidth)
    if (!(w > 0)) {
      const outer = host.parentElement
      if (outer) w = Math.round(outer.clientWidth)
    }
    return Math.max(0, w)
  }

  const viewportStyle = useMemo(() => {
    const style: Record<string, string> = {}
    if (editable && slideWidthPx > 0) {
      style['--slide-w'] = `${slideWidthPx}px`
      style.width = '100%'
      style.maxWidth = '100%'
      style.minWidth = '0'
    }
    return Object.keys(style).length ? (style as CSSProperties) : undefined
  }, [editable, slideWidthPx])

  const slideEditStyle = useMemo(() => {
    if (!editable || !(slideWidthPx > 0)) return undefined
    const w = `${slideWidthPx}px`
    return {
      flex: `0 0 ${w}`,
      width: w,
      minWidth: w,
      maxWidth: w,
    } as CSSProperties
  }, [editable, slideWidthPx])

  const clampedIndex =
    count <= 0 ? 0 : ((index % count) + count) % count
  const clampedIndexRef = useRef(clampedIndex)
  clampedIndexRef.current = clampedIndex

  const trackStyle = useMemo(() => {
    if (editable) {
      return {
        position: 'absolute' as const,
        left: '0',
        top: '0',
        display: 'flex',
        flexDirection: 'row' as const,
        alignItems: 'stretch' as const,
        height: '100%',
        width: 'max-content',
        maxWidth: 'none',
        gap: `${EDIT_GAP_PX}px`,
        padding: '0',
        boxSizing: 'border-box' as const,
        transform: 'none',
      } as CSSProperties
    }
    const percent = count > 0 ? -clampedIndex * 100 : 0
    const offsetPx = dragOffset
    return {
      position: 'relative' as const,
      display: 'flex',
      flexDirection: 'row' as const,
      height: '100%',
      width: '100%',
      transform: `translate3d(calc(${percent}% + ${offsetPx}px), 0, 0)`,
      transition: dragging ? 'none' : `transform ${duration}ms ease`,
      willChange: 'transform',
    } as CSSProperties
  }, [clampedIndex, count, dragOffset, dragging, duration, editable])

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function goTo(next: number) {
    const n = countRef.current
    if (n <= 0) return
    if (circularRef.current) {
      setIndex(((next % n) + n) % n)
    } else {
      setIndex(Math.max(0, Math.min(n - 1, next)))
    }
  }

  function goNext() {
    const n = countRef.current
    if (n <= 0) return
    if (!circularRef.current && clampedIndexRef.current >= n - 1) {
      goTo(0)
      return
    }
    goTo(clampedIndexRef.current + 1)
  }

  function goPrev() {
    const n = countRef.current
    if (n <= 0) return
    if (!circularRef.current && clampedIndexRef.current <= 0) {
      goTo(n - 1)
      return
    }
    goTo(clampedIndexRef.current - 1)
  }

  function restartTimer() {
    clearTimer()
    if (editableRef.current || !autoplayRef.current || countRef.current <= 1) {
      return
    }
    const ms = Math.max(800, intervalRef.current || 3000)
    timerRef.current = setInterval(() => {
      goNext()
    }, ms)
  }

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

  function finishPointerGesture() {
    if (!draggingRef.current && lockAxisRef.current !== 'x') {
      restartTimer()
      return
    }
    const width = viewportRef.current?.clientWidth || 1
    const dx = startOffsetRef.current
    draggingRef.current = false
    setDragging(false)
    setDragOffset(0)
    const wasSwipe = lockAxisRef.current === 'x' && Math.abs(dx) > width * 0.18
    lockAxisRef.current = null
    if (wasSwipe) {
      if (dx < 0) goNext()
      else goPrev()
      suppressClickUntilRef.current = Date.now() + 280
    }
    restartTimer()
  }

  function handleSwipePointerMove(event: PointerEvent) {
    if (!draggingRef.current) return
    const dx = event.clientX - startXRef.current
    const dy = event.clientY - startYRef.current
    if (!lockAxisRef.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      lockAxisRef.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
      if (lockAxisRef.current === 'y') {
        draggingRef.current = false
        setDragging(false)
        setDragOffset(0)
        restartTimer()
        return
      }
    }
    if (lockAxisRef.current !== 'x') return
    event.preventDefault()
    const width = viewportRef.current?.clientWidth || 1
    let next = dx
    if (!circularRef.current) {
      if (clampedIndexRef.current === 0 && dx > 0) next = dx * 0.35
      if (clampedIndexRef.current === countRef.current - 1 && dx < 0) {
        next = dx * 0.35
      }
    }
    startOffsetRef.current = next
    setDragOffset(Math.max(-width * 0.95, Math.min(width * 0.95, next)))
  }

  function onWindowPointerMove(event: PointerEvent) {
    if (
      sessionPointerIdRef.current == null ||
      event.pointerId !== sessionPointerIdRef.current
    ) {
      return
    }
    handleSwipePointerMove(event)
  }

  function onWindowPointerUp(event: PointerEvent) {
    if (
      sessionPointerIdRef.current == null ||
      event.pointerId !== sessionPointerIdRef.current
    ) {
      return
    }
    finishPointerGesture()
    sessionPointerIdRef.current = null
    unbindWindowPointerSession()
  }

  function onPointerDown(event: React.PointerEvent) {
    if (editable || count <= 1) return
    if (event.button !== 0) return
    const el = viewportRef.current
    if (!el) return
    draggingRef.current = true
    setDragging(true)
    lockAxisRef.current = null
    startXRef.current = event.clientX
    startYRef.current = event.clientY
    startOffsetRef.current = 0
    setDragOffset(0)
    clearTimer()
    bindWindowPointerSession(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    if (
      windowPointerBoundRef.current &&
      sessionPointerIdRef.current === event.pointerId
    ) {
      return
    }
    handleSwipePointerMove(event.nativeEvent)
  }

  function onPointerUp() {
    if (
      windowPointerBoundRef.current &&
      sessionPointerIdRef.current != null
    ) {
      return
    }
    finishPointerGesture()
  }

  function onDotClick(i: number) {
    if (editable) return
    goTo(i)
    restartTimer()
  }

  function onClickCapture(event: React.MouseEvent) {
    if (Date.now() < suppressClickUntilRef.current) {
      event.stopPropagation()
      event.preventDefault()
    }
  }

  useEffect(() => {
    if (count <= 0) {
      setIndex(0)
      return
    }
    const next = Number(current)
    setIndex(
      Number.isFinite(next)
        ? Math.max(0, Math.min(count - 1, Math.floor(next)))
        : 0,
    )
  }, [current, count])

  useEffect(() => {
    queueMicrotask(() => restartTimer())
    return () => clearTimer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, interval, editable, slideCount])

  function syncSlideWidth() {
    const el = viewportRef.current
    if (!el) return
    if (editableRef.current) {
      const w = measureSwiperWindowWidth(el)
      if (!(w > 0)) return
      if (
        lockedEditSlideWRef.current <= 0 ||
        Math.abs(lockedEditSlideWRef.current - w) > 2
      ) {
        lockedEditSlideWRef.current = w
      }
      setSlideWidthPx(lockedEditSlideWRef.current)
      return
    }
    lockedEditSlideWRef.current = 0
    setSlideWidthPx(Math.max(0, Math.round(el.clientWidth)))
  }

  useEffect(() => {
    lockedEditSlideWRef.current = 0
    queueMicrotask(() => syncSlideWidth())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])

  useEffect(() => {
    restartTimer()
    queueMicrotask(() => syncSlideWidth())
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(() => syncSlideWidth())
      const el = viewportRef.current
      const host = el?.parentElement
      if (host) resizeObserverRef.current.observe(host)
      else if (el) resizeObserverRef.current.observe(el)
    }
    return () => {
      clearTimer()
      sessionPointerIdRef.current = null
      unbindWindowPointerSession()
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const slides = Array.from({ length: count }, (_, i) => i)

  return (
    <div
      ref={viewportRef}
      className={`swiper-viewport${editable ? ' editable' : ''}${dragging ? ' dragging' : ''}`}
      style={viewportStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <div className="swiper-track" style={trackStyle}>
        {slides.map((i) => (
          <div
            key={i}
            className={`swiper-slide${editable ? ' editable' : ''}`}
            style={slideEditStyle}
          >
            {children?.(i)}
          </div>
        ))}
      </div>

      {indicator && count > 1 && !editable ? (
        <div className="swiper-dots" aria-hidden="true">
          {slides.map((i) => (
            <button
              key={i}
              type="button"
              className={`dot${clampedIndex === i ? ' active' : ''}`}
              style={{
                background:
                  clampedIndex === i ? indicatorActiveColor : indicatorColor,
              }}
              onClick={(event) => {
                event.stopPropagation()
                onDotClick(i)
              }}
            />
          ))}
        </div>
      ) : null}

      {editable && count === 0 ? (
        <div className="swiper-empty">向滑动窗口添加子控件作为每一页</div>
      ) : null}
    </div>
  )
}
