import { motion } from 'framer-motion'
import { Users, Calendar, CheckSquare, ArrowRight, ClipboardList } from 'lucide-react'
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

const cards = [
  { page: 'employees', label: 'עובדים', emoji: '👤', subtitle: 'תעריפים · פרטי עובד', Icon: Users, ready: true },
  { page: 'manager-constraints', label: 'זמינות הצוות', emoji: '📋', subtitle: 'אילוצים · זמינות · שבועי', Icon: ClipboardList, ready: true },
  { page: 'branch-schedule', label: 'סידור עבודה', emoji: '📅', subtitle: 'משמרות · שבועי · פרסום', Icon: Calendar, ready: false },
  { page: 'branch-tasks', label: 'משימות', emoji: '✅', subtitle: 'יומיות · שיוך · מעקב', Icon: CheckSquare, ready: false },
]

export default function BranchTeam({ branchName, branchColor, onBack, onNavigate }: Props) {
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

      {/* Cards */}
      <div className="flex flex-col gap-3">
        {cards.map((card, i) => (
          <motion.div key={card.page} variants={fadeIn(0.1 + i * 0.1)} initial="hidden" animate="visible">
            <div
              className="bg-white rounded-xl p-5 cursor-pointer hover:shadow-md transition-shadow relative overflow-hidden"
              style={{ border: '0.5px solid #e2e8f0' }}
              onClick={() => card.ready ? onNavigate(card.page) : undefined}
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                  style={{ background: branchColor + '18' }}>
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
    </div>
  )
}
