import './RepeatBadge.css'

export default function RepeatBadge({
  title = '已配置重复',
  size = 15,
  clickable = false,
  onClick,
}: {
  title?: string
  size?: number
  clickable?: boolean
  onClick?: (event: React.MouseEvent<HTMLSpanElement>) => void
}) {
  function handleClick(event: React.MouseEvent<HTMLSpanElement>) {
    event.stopPropagation()
    onClick?.(event)
  }

  return (
    <span
      className={`repeat-badge${clickable ? ' clickable' : ''}`}
      title={title}
      style={{
        width: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
        height: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
        fontSize: `calc(${size}px / max(var(--canvas-zoom, 1), 1))`,
        borderRadius: `calc(4px / max(var(--canvas-zoom, 1), 1))`,
      }}
      role="button"
      onClick={clickable ? handleClick : undefined}
    >
      <svg className="repeat-badge-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M17.5 3.5c-2.6.2-5 1.6-6.5 3.7C9.2 5 6.5 3.5 3.5 3.5c0 0-.5 5.2 2.2 8.4C4.2 13.2 3 15.4 3 18c2.6 0 5-1.2 6.5-3.2.3 1.7.9 3.3 1.8 4.7.9-1.4 1.5-3 1.8-4.7C14.6 16.8 17 18 19.6 18c0-2.6-1.2-4.8-2.7-6.1 2.7-3.2 2.2-8.4 2.2-8.4z"
        />
      </svg>
    </span>
  )
}
