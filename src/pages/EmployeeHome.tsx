import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Calendar, Hand, CheckSquare, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppUser } from '../lib/UserContext'
import MySchedule from './MySchedule'
import { useBranches } from '../lib/BranchContext'
import { supabase } from '../lib/supabase'
import EmployeeConstraints from './EmployeeConstraints'

const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, delay } },
})

const cards = [
  { key: 'schedule', label: 'הסידור שלי', emoji: '📅', subtitle: 'משמרות · שעות · ימים', Icon: Calendar, ready: true },
  { key: 'constraints', label: 'האילוצים שלי', emoji: '🙋', subtitle: 'זמינות · העדפות · חופש', Icon: Hand, ready: true },
  { key: 'tasks', label: 'המשימות שלי', emoji: '✅', subtitle: 'יומיות · שיוך · מעקב', Icon: CheckSquare, ready: false },
]

export default function EmployeeHome() {
  const { appUser, logout } = useAppUser()
  const { branches } = useBranches()
  const branchName = branches.find(b => b.id === appUser?.branch_id)?.name || ''
  const [page, setPage] = useState<string | null>(null)
  const [nextWeekCount, setNextWeekCount] = useState(0)

  useEffect(() => {
    async function fetchNextWeekAvailability() {
      let empId = appUser?.employee_id
      if (!empId && appUser?.email) {
        const { data } = await supabase
          .from('branch_employees')
          .select('id')
          .eq('email', appUser.email)
          .maybeSingle()
        if (data) empId = data.id
      }
      if (!empId) return

      const today = new Date()
      const nextWeekStart = new Date(today)
      nextWeekStart.setDate(today.getDate() + 1)
      const nextWeekEnd = new Date(today)
      nextWeekEnd.setDate(today.getDate() + 7)

      const startStr = nextWeekStart.toISOString().slice(0, 10)
      const endStr = nextWeekEnd.toISOString().slice(0, 10)

      const { data: constraints } = await supabase
        .from('schedule_constraints')
        .select('id')
        .eq('employee_id', empId)
        .gte('date', startStr)
        .lte('date', endStr)

      setNextWeekCount(constraints?.length ?? 0)
    }

    fetchNextWeekAvailability()
  }, [appUser])

  if (page === 'schedule') {
    return <MySchedule onBack={() => setPage(null)} />
  }
  if (page === 'constraints') {
    return <EmployeeConstraints onBack={() => setPage(null)} />
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white" dir="rtl">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <motion.div variants={fadeIn(0)} initial="hidden" animate="visible" className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800">שלום, {appUser?.name || 'עובד'} 👋</h1>
          {branchName && <p className="text-sm text-slate-500 mt-1">{branchName}</p>}
        </motion.div>

        {/* Next week availability */}
        <motion.div variants={fadeIn(0.05)} initial="hidden" animate="visible">
          <div style={{
            background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '12px',
            padding: '12px 16px', marginBottom: '16px', textAlign: 'center'
          }}>
            <span style={{ fontSize: '13px', color: '#4338ca', fontWeight: '600' }}>
              הזמינות שלך לשבוע הבא: {nextWeekCount} משמרות מסומנות
            </span>
          </div>
        </motion.div>

        {/* Cards */}
        <div className="flex flex-col gap-3">
          {cards.map((card, i) => (
            <motion.div key={card.key} variants={fadeIn(0.1 + i * 0.1)} initial="hidden" animate="visible">
              <div className="bg-white rounded-xl p-5 cursor-pointer hover:shadow-md transition-shadow relative overflow-hidden"
                style={{ border: '0.5px solid #e2e8f0' }}
                onClick={() => card.ready ? setPage(card.key) : undefined}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-2xl">
                    {card.emoji}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-base text-slate-800">{card.label}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{card.subtitle}</p>
                  </div>
                  {!card.ready && (
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">בקרוב</span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Logout */}
        <motion.div variants={fadeIn(0.5)} initial="hidden" animate="visible" className="mt-10 text-center">
          <Button variant="outline" onClick={async () => { await supabase.auth.signOut(); logout() }} className="gap-2 text-slate-500">
            <LogOut size={16} />
            התנתקות
          </Button>
        </motion.div>
      </div>
    </div>
  )
}
