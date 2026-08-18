import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { PlusOutlined } from '@ant-design/icons'
import type { OverflowStrategy } from '../../utils/xml'
import './MultiWindowPort.css'

export default function MultiWindowPort({
  editable = false,
  allowManage = true,
  overflow = 'visible',
  activeValue = '',
  focusIndex = 0,
  windows,
  children,
  onAddWindow,
  onSelectWindow,
}: {
  editable?: boolean
  allowManage?: boolean
  overflow?: OverflowStrategy
  activeValue?: string | number | null
  focusIndex?: number
  windows: Array<{ key: string; index: number }>
  children?: (index: number) => ReactNode
  onAddWindow?: () => void
  onSelectWindow?: (index: number) => void
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [paneWidthPx, setPaneWidthPx] = useState(0)
  const lockedEditPaneWRef = useRef(0)
  const [dfsExtraByIndex, setDfsExtraByIndex] = useState<Record<number, number>>(
    {},
  )
  const dfsExtraByIndexRef = useRef<Record<number, number>>({})
  dfsExtraByIndexRef.current = dfsExtraByIndex
  const paneElByIndexRef = useRef(new Map<number, HTMLElement>())

  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const measureRafRef = useRef(0)
  const windowsLengthRef = useRef(windows.length)
  const editableRef = useRef(editable)
  const allowManageRef = useRef(allowManage)
  editableRef.current = editable
  allowManageRef.current = allowManage

  const EDIT_GAP_PX = 10

  const activeKey = useMemo(() => {
    if (activeValue == null) return ''
    return String(activeValue)
  }, [activeValue])

  const previewIndex = useMemo(() => {
    if (!activeKey) return -1
    return windows.findIndex((w) => w.key === activeKey)
  }, [activeKey, windows])

  const editIndex = useMemo(() => {
    if (!windows.length) return -1
    const fi = focusIndex ?? 0
    if (fi >= 0 && fi < windows.length) return fi
    return 0
  }, [focusIndex, windows.length])

  function isPreviewVisible(index: number, key: string): boolean {
    if (!key) return false
    return index === previewIndex
  }

  function paneStyle(index: number): CSSProperties | undefined {
    if (!editable) return undefined
    const w = paneWidthPx
    if (!(w > 0)) return undefined
    const extra = dfsExtraByIndex[index] ?? 0
    const style: CSSProperties = {
      width: `${w}px`,
      flex: `0 0 ${w}px`,
      minWidth: `${w}px`,
      maxWidth: `${w}px`,
    }
    if (extra > 0) style.marginRight = `${extra}px`
    return style
  }

  const viewportStyle = useMemo(() => {
    const style: Record<string, string> = {}
    if (editable && paneWidthPx) {
      style['--pane-w'] = `${paneWidthPx}px`
    }
    if (!editable) {
      style.overflow = overflow === 'hidden' ? 'hidden' : 'visible'
    }
    return Object.keys(style).length ? (style as CSSProperties) : undefined
  }, [editable, overflow, paneWidthPx])

  const trackStyle = useMemo(() => {
    if (!editable) return undefined
    return {
      display: 'flex',
      flexDirection: 'row' as const,
      alignItems: 'stretch' as const,
      height: '100%',
      width: 'max-content',
      maxWidth: 'none',
      gap: `${EDIT_GAP_PX}px`,
      boxSizing: 'border-box' as const,
    } as CSSProperties
  }, [editable])

  function setPaneRef(index: number, el: HTMLDivElement | null) {
    if (el) paneElByIndexRef.current.set(index, el)
    else paneElByIndexRef.current.delete(index)
  }

  function measureDfsExtra(pane: HTMLElement, baseW: number): number {
    if (!(baseW > 0)) return 0
    let extra = 0

    pane.querySelectorAll('.swiper-viewport.editable').forEach((node) => {
      const vp = node as HTMLElement
      const track = vp.querySelector('.swiper-track') as HTMLElement | null
      if (!track) return
      const trackW = track.scrollWidth
      const hostW = Math.round(vp.parentElement?.clientWidth || 0)
      const slide = vp.querySelector('.swiper-slide.editable') as HTMLElement | null
      const winW = hostW || Math.round(slide?.offsetWidth || baseW)
      if (trackW > winW) extra = Math.max(extra, trackW - winW)
    })

    const selfPort = viewportRef.current
    pane.querySelectorAll('.multi-window-port.is-edit').forEach((node) => {
      const port = node as HTMLElement
      if (port === selfPort) return
      if (!pane.contains(port)) return
      const track = port.querySelector(
        ':scope > .multi-window-track',
      ) as HTMLElement | null
      if (!track) return
      const trackW = track.scrollWidth
      if (trackW > baseW) extra = Math.max(extra, trackW - baseW)
    })

    return Math.max(0, Math.ceil(extra))
  }

  function remeasureDfsExtras() {
    if (!editableRef.current) return
    const base = lockedEditPaneWRef.current || paneWidthPx
    if (!(base > 0)) return

    const next: Record<number, number> = {}
    let changed = false
    for (const [index, pane] of paneElByIndexRef.current) {
      const extra = measureDfsExtra(pane, base)
      next[index] = extra
      if ((dfsExtraByIndexRef.current[index] ?? 0) !== extra) changed = true
    }
    if (changed) setDfsExtraByIndex(next)
  }

  function observeTileSources() {
    if (!resizeObserverRef.current || !editableRef.current) return
    const root = viewportRef.current
    if (!root) return
    root
      .querySelectorAll(
        '.swiper-viewport.editable, .swiper-track, .multi-window-port.is-edit > .multi-window-track',
      )
      .forEach((node) => {
        resizeObserverRef.current!.observe(node)
      })
    for (const pane of paneElByIndexRef.current.values()) {
      resizeObserverRef.current.observe(pane)
    }
  }

  function scheduleRemeasure() {
    if (!editableRef.current) return
    if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current)
    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = 0
      queueMicrotask(() => {
        remeasureDfsExtras()
        observeTileSources()
      })
    })
  }

  function syncPaneWidth() {
    const el = viewportRef.current
    if (!el) return
    if (editableRef.current) {
      if (lockedEditPaneWRef.current > 0) {
        setPaneWidthPx(lockedEditPaneWRef.current)
        scheduleRemeasure()
        return
      }
      const w = Math.max(0, Math.round(el.clientWidth))
      if (w > 0) {
        lockedEditPaneWRef.current = w
        setPaneWidthPx(w)
        scheduleRemeasure()
      }
      return
    }
    lockedEditPaneWRef.current = 0
    setDfsExtraByIndex({})
    setPaneWidthPx(Math.max(0, Math.round(el.clientWidth)))
  }

  useEffect(() => {
    const n = windows.length
    const prev = windowsLengthRef.current
    if (editable && allowManage && n > prev) {
      onSelectWindow?.(n - 1)
    }
    windowsLengthRef.current = n
    scheduleRemeasure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows.length])

  useEffect(() => {
    lockedEditPaneWRef.current = 0
    setDfsExtraByIndex({})
    queueMicrotask(() => syncPaneWidth())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])

  const windowsKey = windows.map((w) => w.key).join('\0')
  useEffect(() => {
    scheduleRemeasure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowsKey])

  useEffect(() => {
    syncPaneWidth()
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver((entries) => {
        const root = viewportRef.current
        for (const entry of entries) {
          if (entry.target === root) syncPaneWidth()
          else scheduleRemeasure()
        }
      })
      if (viewportRef.current) {
        resizeObserverRef.current.observe(viewportRef.current)
      }
      observeTileSources()
    }
    return () => {
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current)
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      paneElByIndexRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={viewportRef}
      className={`multi-window-port${editable ? ' is-edit' : ''}`}
      style={viewportStyle}
    >
      <div className="multi-window-track" style={trackStyle}>
        {windows.map((win) => {
          const previewHidden =
            !editable && !isPreviewVisible(win.index, win.key)
          return (
            <div
              key={`${win.index}:${win.key}`}
              ref={(el) => setPaneRef(win.index, el)}
              className={[
                'multi-window-pane',
                editable ? 'editable' : '',
                editable && win.index === editIndex ? 'active' : '',
                editable && !win.key ? 'unbound' : '',
                previewHidden ? 'is-preview-hidden' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                ...paneStyle(win.index),
                display: editable || isPreviewVisible(win.index, win.key)
                  ? undefined
                  : 'none',
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (editable && allowManage) onSelectWindow?.(win.index)
              }}
            >
              <div className="multi-window-pane-screen">{children?.(win.index)}</div>
            </div>
          )
        })}

        {editable && allowManage ? (
          <button
            type="button"
            className="multi-window-add"
            onClick={(event) => {
              event.stopPropagation()
              onAddWindow?.()
            }}
          >
            <PlusOutlined style={{ fontSize: 22 }} />
            <span>新建窗口</span>
          </button>
        ) : null}

        {editable && allowManage && !windows.length ? (
          <div className="multi-window-empty multi-window-empty--edit">
            点击右侧新建窗口
          </div>
        ) : !editable && previewIndex < 0 ? (
          <div className="multi-window-empty">
            {activeKey ? `无匹配窗口「${activeKey}」` : '未绑定激活项'}
          </div>
        ) : null}
      </div>
    </div>
  )
}
