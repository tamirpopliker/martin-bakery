import { useState } from 'react'
import { Users, CalendarCheck, ClipboardList } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/PageHeader'
import TeamManagement from './TeamManagement'
import WorkSchedule from './WorkSchedule'
import ManagerConstraintsView from './ManagerConstraintsView'

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } } }
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
  onNavigate?: (page: string) => void
}

const CARDS = [
  { key: 'team', label: 'צוות', subtitle: 'עובדים · הזמנות · תפקידים', Icon: Users },
  { key: 'schedule', label: 'סידור עבודה', subtitle: 'שבועי · היסטוריה · הגדרות · חגים', Icon: CalendarCheck },
  { key: 'constraints', label: 'זמינות הצוות', subtitle: 'אילוצים · שבועי', Icon: ClipboardList },
]

export default function BranchTeam({ branchId, branchName, branchColor, onBack, onNavigate = () => {} }: Props) {
  const [subPage, setSubPage] = useState<string | null>(null)
  const [hovCard, setHovCard] = useState<string | null>(null)

  if (subPage === 'team') {
    return <TeamManagement branchId={branchId} branchName={branchName} branchColor={branchColor} onBack={() => setSubPage(null)} />
  }
  if (subPage === 'schedule') {
    return <WorkSchedule branchId={branchId} branchName={branchName} branchColor={branchColor} onBack={() => setSubPage(null)} />
  }
  if (subPage === 'constraints') {
    return <ManagerConstraintsView branchId={branchId} branchName={branchName} branchColor={branchColor} onBack={() => setSubPage(null)} />
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="ניהול צוות" subtitle={branchName} onBack={onBack} />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '36px 16px' }}>
        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}
          variants={stagger} initial="hidden" animate="visible">
          {CARDS.map(card => {
            const Icon = card.Icon
            const isHov = hovCard === card.key
            return (
              <motion.div key={card.key} variants={fadeUp}>
                <button
                  onClick={() => setSubPage(card.key)}
                  onMouseEnter={() => setHovCard(card.key)}
                  onMouseLeave={() => setHovCard(null)}
                  style={{
                    width: '100%', background: 'white',
                    border: `1px solid ${isHov ? '#c7d2fe' : '#f1f5f9'}`,
                    borderRadius: 12, padding: '24px 18px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                    boxShadow: isHov ? '0 4px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)',
                    cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
                  }}>
                  <div style={{ width: 44, height: 44, background: '#f1f5f9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} color="#6366f1" strokeWidth={1.5} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b' }}>{card.label}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{card.subtitle}</div>
                </button>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}
