import './LubanStackLogo.css'

export default function LubanStackLogo({
  size = 28,
  className,
}: {
  size?: number | string
  className?: string
}) {
  return (
    <svg
      className={['lubanstack-logo', className].filter(Boolean).join(' ')}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lb-top" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#F3DFC4" />
          <stop offset="1" stopColor="#E8C9A0" />
        </linearGradient>
        <linearGradient id="lb-left" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#D4A574" />
          <stop offset="1" stopColor="#C4956A" />
        </linearGradient>
        <linearGradient id="lb-right" x1="1" y1="0" x2="0" y2="1">
          <stop stopColor="#C9A07A" />
          <stop offset="1" stopColor="#A67C52" />
        </linearGradient>
      </defs>
      <g transform="translate(32 28)">
        <g transform="translate(0 -9.5)">
          <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
          <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
          <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
        </g>
        <g transform="translate(-9.5 4.75)">
          <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
          <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
          <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
        </g>
        <g transform="translate(-9.5 -4.75)">
          <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
          <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
          <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
        </g>
        <g>
          <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
          <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
          <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
        </g>
        <g transform="translate(9.5 4.75)">
          <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
          <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
          <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
        </g>
        <g transform="translate(9.5 -4.75)">
          <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
          <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
          <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
        </g>
        <g transform="translate(0 9.5)">
          <path fill="url(#lb-top)" d="M0 -4 L8 0 L0 4 L-8 0 Z" />
          <path fill="url(#lb-left)" d="M-8 0 L0 4 L0 12 L-8 8 Z" />
          <path fill="url(#lb-right)" d="M8 0 L0 4 L0 12 L8 8 Z" />
        </g>
      </g>
    </svg>
  )
}
