import { ArrowRight } from 'lucide-react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  action?: React.ReactNode
}

export default function PageHeader({ title, subtitle, onBack, action }: PageHeaderProps) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'white', borderBottom: '1px solid #f1f5f9',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      padding: '0 20px', height: 64,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      direction: 'rtl',
    }}>
      {/* Right side: back button */}
      <div style={{ minWidth: 80 }}>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 13, color: '#64748b', fontFamily: 'inherit',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = '#1e293b')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
          >
            <ArrowRight size={16} />
            <span>חזרה</span>
          </button>
        )}
      </div>

      {/* Center: title */}
      <div style={{ textAlign: 'center', flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', lineHeight: 1.3 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.3 }}>{subtitle}</div>}
      </div>

      {/* Left side: action */}
      <div style={{ minWidth: 80, display: 'flex', justifyContent: 'flex-end' }}>
        {action || null}
      </div>
    </div>
  )
}
