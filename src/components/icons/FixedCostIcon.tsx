interface IconProps {
  size?: number
  color?: string
  className?: string
}

export function FixedCostIcon({ size = 24, color = 'currentColor', className }: IconProps) {
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
      {/* Building base */}
      <rect x="3" y="8" width="12" height="13" rx="1" />
      {/* Building roof/triangle */}
      <path d="M3 8l6-4 6 4" />
      {/* Windows */}
      <rect x="6" y="11" width="2" height="2" rx="0.3" />
      <rect x="10" y="11" width="2" height="2" rx="0.3" />
      {/* Door */}
      <rect x="7" y="17" width="4" height="4" rx="0.5" />
      {/* Shekel sign ₪ */}
      <text
        x="20"
        y="10"
        fontSize="8"
        fontWeight="bold"
        fill={color}
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        ₪
      </text>
    </svg>
  )
}
