import { useMemo } from 'react'
import './InspectBadge.css'

export default function InspectBadge({
  title = '查看组件入参',
  label = '',
  size = 18,
  active = false,
  side = 'right',
  stemH = 20,
  rise,
  onClick,
}: {
  title?: string
  label?: string
  size?: number
  active?: boolean
  side?: 'left' | 'right'
  stemH?: number
  rise?: number
  onClick?: (event: React.MouseEvent) => void
}) {
  const BTN = Math.max(14, size)
  const STEM_H = Math.max(10, stemH)
  const RISE = useMemo(() => {
    if (rise != null && Number.isFinite(rise)) return rise
    return -Math.max(14, STEM_H * 0.35)
  }, [rise, STEM_H])
  const DIAG_X = Math.max(12, Math.min(20, Math.abs(RISE) || 14))
  const displayLabel = label.trim()
  const LEADER_W = STEM_H + DIAG_X
  const svgW = LEADER_W + BTN
  const svgH = Math.abs(RISE) + BTN
  const y0 = Math.abs(Math.min(0, RISE)) + BTN / 2

  const pathD = useMemo(() => {
    const yStart = y0
    const yEnd = yStart + RISE
    if (side === 'left') {
      const x1 = svgW - STEM_H
      const x2 = svgW - STEM_H - DIAG_X
      return `M ${svgW} ${yStart} H ${x1} L ${x2} ${yEnd}`
    }
    const x1 = STEM_H
    const x2 = STEM_H + DIAG_X
    return `M 0 ${yStart} H ${x1} L ${x2} ${yEnd}`
  }, [DIAG_X, RISE, STEM_H, side, svgW, y0])

  const boxStyle = useMemo(() => {
    const btnOffsetX = LEADER_W - BTN / 2
    const btnOffsetY = y0 + RISE - BTN / 2
    return {
      height: `${BTN}px`,
      top: `${btnOffsetY}px`,
      ...(side === 'right'
        ? { left: `${btnOffsetX}px`, right: 'auto' }
        : { right: `${btnOffsetX}px`, left: 'auto' }),
    } as React.CSSProperties
  }, [BTN, LEADER_W, RISE, side, y0])

  const leaderStyle = useMemo(() => {
    const btnOffsetY = y0 + RISE - BTN / 2
    return {
      width: `${svgW}px`,
      height: `${svgH}px`,
      top: `${-btnOffsetY}px`,
      ...(side === 'right'
        ? { left: `${-(LEADER_W - BTN / 2)}px`, right: 'auto' }
        : { right: `${-(LEADER_W - BTN / 2)}px`, left: 'auto' }),
    } as React.CSSProperties
  }, [BTN, LEADER_W, RISE, side, svgH, svgW, y0])

  function fire(event: React.SyntheticEvent) {
    event.preventDefault()
    event.stopPropagation()
    onClick?.(event as unknown as React.MouseEvent)
  }

  return (
    <div
      className={`inspect-callout side-${side}${active ? ' active' : ''}`}
      title={title}
      style={boxStyle}
    >
      <svg
        className="inspect-leader"
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={leaderStyle}
        aria-hidden="true"
      >
        <path
          className="inspect-path"
          d={pathD}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4 3"
        />
      </svg>
      <button
        type="button"
        className="inspect-chip"
        style={{ height: `${BTN}px` }}
        onPointerDown={fire}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <span
          className="inspect-btn"
          style={{ width: `${BTN}px`, height: `${BTN}px` }}
        >
          <svg className="inspect-btn-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6.2 1.4h3.6l1.2 1.2v2.4H14l1.2 1.2v3.6L14 10.8h-2.4V14L10.4 15.2H6.8L5.6 14v-3.2H3.2L2 9.6V6l1.2-1.2h2.4V2.6L6.2 1.4Zm.6 1.5v2.5H4.2v2.8h2.6v2.5h2.4v-2.5h2.6V5.4H9.2V2.9H6.8Z"
            />
          </svg>
        </span>
        {displayLabel ? <span className="inspect-label">{displayLabel}</span> : null}
      </button>
    </div>
  )
}
