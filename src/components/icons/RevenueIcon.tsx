interface IconProps {
  size?: number
  color?: string
  className?: string
}

export function RevenueIcon({ size = 24, color = 'currentColor', className }: IconProps) {
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
      {/* Credit card body */}
      <rect x="2" y="5" width="16" height="13" rx="2" />
      {/* Magnetic stripe */}
      <line x1="2" y1="9" x2="18" y2="9" />
      {/* Card number dots */}
      <circle cx="6" cy="14" r="0.5" fill={color} stroke="none" />
      <circle cx="8.5" cy="14" r="0.5" fill={color} stroke="none" />
      <circle cx="11" cy="14" r="0.5" fill={color} stroke="none" />
      {/* Upward arrow */}
      <line x1="20" y1="14" x2="20" y2="4" />
      <polyline points="17,7 20,4 23,7" />
    </svg>
  )
}
