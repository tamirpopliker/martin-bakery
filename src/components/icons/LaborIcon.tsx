interface IconProps {
  size?: number
  color?: string
  className?: string
}

export function LaborIcon({ size = 24, color = 'currentColor', className }: IconProps) {
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
      {/* Person head */}
      <circle cx="9" cy="7" r="3" />
      {/* Person body */}
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      {/* Gear */}
      <circle cx="19" cy="11" r="2" />
      <path d="M19 8v-1" />
      <path d="M19 14v1" />
      <path d="M16.5 9.5l-.7-.7" />
      <path d="M21.5 12.5l.7.7" />
      <path d="M16 11h-1" />
      <path d="M23 11h-1" />
      <path d="M16.5 12.5l-.7.7" />
      <path d="M21.5 9.5l.7-.7" />
    </svg>
  )
}
