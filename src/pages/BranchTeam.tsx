import { Users, CalendarCheck, History, Clock, ClipboardList, Calendar, Settings, Mail } from 'lucide-react'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
  onNavigate?: (page: string) => void
}

const categories = [
  {
    title: 'צוות',
    icon: Users,
    items: [
      { page: 'branch-employees', label: 'ניהול עובדים', subtitle: 'תעריפים · פרטי עובד', Icon: Users },
      { page: 'branch-employees', label: 'הזמנת עובד', subtitle: 'שליחת הזמנה · אימייל', Icon: Mail },
      { page: 'shift-settings', label: 'תפקידי עובדים', subtitle: 'שיוך תפקידים', Icon: Settings, tabOverride: 'employees' },
    ]
  },
  {
    title: 'סידור עבודה',
    icon: CalendarCheck,
    items: [
      { page: 'weekly-schedule', label: 'סידור שבועי', subtitle: 'שיבוץ · משמרות', Icon: CalendarCheck },
      { page: 'schedule-history', label: 'היסטוריית סידורים', subtitle: 'ארכיון · סידורים שפורסמו', Icon: History },
      { page: 'shift-settings', label: 'הגדרות משמרות', subtitle: 'משמרות · דרישות', Icon: Settings },
    ]
  },
  {
    title: 'זמינות',
    icon: Clock,
    items: [
      { page: 'manager-constraints', label: 'זמינות הצוות', subtitle: 'אילוצים · שבועי', Icon: ClipboardList },
      { page: 'shift-settings', label: 'חגים וימים מיוחדים', subtitle: 'חגים · עומס · תבניות', Icon: Calendar, tabOverride: 'holidays' },
    ]
  },
]

export default function BranchTeam({ branchName, branchColor, onBack, onNavigate = () => {} }: Props) {
  const { appUser } = useAppUser()
  const isManagerOrAdmin = appUser?.role === 'admin' || appUser?.role === 'branch'
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="ניהול צוות" subtitle={branchName} onBack={onBack} />

      {/* Category cards */}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
        {categories.map(cat => (
          <div key={cat.title} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #f1f5f9', paddingBottom: 8, marginBottom: 12 }}>
              {cat.title}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3" style={{ gap: 12 }}>
              {cat.items.map(item => (
                <button key={item.page + item.label} onClick={() => onNavigate?.(item.page)}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#c7d2fe' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#f1f5f9' }}
                  style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '16px', textAlign: 'right', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', transition: 'all 0.18s', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <item.Icon size={18} color="#6366f1" strokeWidth={1.5} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{item.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
