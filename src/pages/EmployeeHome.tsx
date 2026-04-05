import { motion } from 'framer-motion'
import { Calendar, Hand, CheckSquare, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { supabase } from '../lib/supabase'

const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, delay } },
})

const cards = [
  { key: 'schedule', label: 'הסידור שלי', emoji: '📅', subtitle: 'משמרות · שעות · ימים', Icon: Calendar },
  { key: 'constraints', label: 'האילוצים שלי', emoji: '🙋', subtitle: 'זמינות · העדפות · חופש', Icon: Hand },
  { key: 'tasks', label: 'המשימות שלי', emoji: '✅', subtitle: 'יומיות · שיוך · מעקב', Icon: CheckSquare },
]

export default function EmployeeHome() {
  const { appUser, logout } = useAppUser()
  const { branches } = useBranches()
  const branchName = branches.find(b => b.id === appUser?.branch_id)?.name || ''

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white" dir="rtl">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <motion.div variants={fadeIn(0)} initial="hidden" animate="visible" className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800">שלום, {appUser?.name || 'עובד'} 👋</h1>
          {branchName && <p className="text-sm text-slate-500 mt-1">{branchName}</p>}
        </motion.div>

        {/* Cards */}
        <div className="flex flex-col gap-3">
          {cards.map((card, i) => (
            <motion.div key={card.key} variants={fadeIn(0.1 + i * 0.1)} initial="hidden" animate="visible">
              <div className="bg-white rounded-xl p-5 cursor-pointer hover:shadow-md transition-shadow relative overflow-hidden"
                style={{ border: '0.5px solid #e2e8f0' }}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-2xl">
                    {card.emoji}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-base text-slate-800">{card.label}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{card.subtitle}</p>
                  </div>
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">בקרוב</span>
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
