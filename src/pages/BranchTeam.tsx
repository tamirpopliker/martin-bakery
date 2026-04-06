import { motion } from 'framer-motion'
import { Users, CalendarCheck, History, Clock, ClipboardList, Calendar, Settings, Mail, ArrowRight } from 'lucide-react'
import { useAppUser } from '../lib/UserContext'
import { Button } from '@/components/ui/button'

const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, delay } },
})

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
  onNavigate: (page: string) => void
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

export default function BranchTeam({ branchName, branchColor, onBack, onNavigate }: Props) {
  const { appUser } = useAppUser()
  const isManagerOrAdmin = appUser?.role === 'admin' || appUser?.role === 'branch'
  return (
    <div className="max-w-3xl mx-auto px-4 py-6" dir="rtl">
      {/* Header */}
      <motion.div variants={fadeIn(0)} initial="hidden" animate="visible" className="flex items-center gap-3 mb-6">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2 px-4 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={18} /> חזרה
        </Button>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold text-slate-800">ניהול צוות — {branchName}</h1>
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: branchColor }}>
          <Users size={20} className="text-white" />
        </div>
      </motion.div>

      {/* Category cards */}
      {categories.map(cat => (
        <div key={cat.title} style={{ marginBottom: 20 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #e2e8f0' }}>
            <cat.icon size={16} style={{ color: '#94a3b8' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>{cat.title}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {cat.items.map(item => (
              <button key={item.page + item.label} onClick={() => onNavigate(item.page)}
                style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', textAlign: 'right', cursor: 'pointer' }}
                className="hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                  <item.Icon size={16} style={{ color: branchColor }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{item.label}</span>
                </div>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.subtitle}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
