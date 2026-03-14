interface IconProps {
  size?: number
  color?: string
  className?: string
}

export function TrophyIcon({ size = 24, color = 'currentColor', className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Cup body */}
      <path d="M6 4h12v6a6 6 0 0 1-12 0V4z" />
      {/* Left handle */}
      <path d="M6 6H4a2 2 0 0 0-2 2v1a3 3 0 0 0 3 3h1" />
      {/* Right handle */}
      <path d="M18 6h2a2 2 0 0 1 2 2v1a3 3 0 0 1-3 3h-1" />
      {/* Stem */}
      <line x1="12" y1="16" x2="12" y2="19" />
      {/* Base */}
      <path d="M8 21h8" />
      <path d="M10 19h4v2h-4z" />
      {/* Star */}
      <path d="M12 7.5l1 2h2l-1.5 1.5.5 2-2-1-2 1 .5-2L9 9.5h2z" fill={color} strokeWidth={0} />
    </svg>
  )
}
