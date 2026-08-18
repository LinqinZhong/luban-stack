import './EventBadge.css'

export default function EventBadge({
  title = '已绑定事件方法',
  size = 15,
  count = 0,
  clickable = false,
  onClick,
}: {
  title?: string
  size?: number
  count?: number
  clickable?: boolean
  onClick?: (event: React.MouseEvent<HTMLSpanElement>) => void
}) {
  function handleClick(event: React.MouseEvent<HTMLSpanElement>) {
    event.stopPropagation()
    onClick?.(event)
  }

  return (
    <span
      className={`event-badge${clickable ? ' clickable' : ''}`}
      title={count > 0 ? `${title}（${count}）` : title}
      style={{
        width: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
        height: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
        fontSize: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
        borderRadius: `calc(4px / max(var(--canvas-zoom, 1), 1))`,
      }}
      role="button"
      onClick={clickable ? handleClick : undefined}
    >
      <svg className="event-badge-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M13 2 4 14h6l-1 8 10-14h-6l0-6z" />
      </svg>
    </span>
  )
}
