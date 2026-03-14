interface IconProps {
  size?: number
  color?: string
  className?: string
}

export function ProfitIcon({ size = 24, color = 'currentColor', className }: IconProps) {
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
      {/* Chart axes */}
      <line x1="3" y1="20" x2="3" y2="4" />
      <line x1="3" y1="20" x2="21" y2="20" />
      {/* Rising line */}
      <polyline points="6,16 10,12 14,14 20,6" />
      {/* Arrow tip on the rising line */}
      <polyline points="17,6 20,6 20,9" />
    </svg>
  )
}
