import { useState } from 'react'
import { CalendarCheck, History, Settings, Calendar } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import WeeklySchedule from './WeeklySchedule'
import ScheduleHistory from './ScheduleHistory'
import ShiftSettings from './ShiftSettings'

interface Props {
  branchId: number; branchName: string; branchColor: string
  onBack: () => void
}

export default function WorkSchedule({ branchId, branchName, branchColor, onBack }: Props) {
  const [tab, setTab] = useState<'weekly' | 'history' | 'settings'>('weekly')
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined)

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="סידור עבודה" subtitle={branchName} onBack={onBack} />

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', paddingRight: 32, background: 'white' }}>
        <button onClick={() => setTab('weekly')}
          style={{ padding: '12px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', borderBottom: tab === 'weekly' ? '2px solid #6366f1' : '2px solid transparent', background: 'none', color: tab === 'weekly' ? '#6366f1' : '#94a3b8' }}>
          <CalendarCheck size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> שבועי
        </button>
        <button onClick={() => setTab('history')}
          style={{ padding: '12px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', borderBottom: tab === 'history' ? '2px solid #6366f1' : '2px solid transparent', background: 'none', color: tab === 'history' ? '#6366f1' : '#94a3b8' }}>
          <History size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> היסטוריה
        </button>
        <button onClick={() => setTab('settings')}
          style={{ padding: '12px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', borderBottom: tab === 'settings' ? '2px solid #6366f1' : '2px solid transparent', background: 'none', color: tab === 'settings' ? '#6366f1' : '#94a3b8' }}>
          <Settings size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> הגדרות וחגים
        </button>
      </div>

      {tab === 'weekly' && (
        <WeeklySchedule branchId={branchId} branchName={branchName} branchColor={branchColor}
          onBack={() => setTab('weekly')} initialWeekStart={weekStart} />
      )}
      {tab === 'history' && (
        <ScheduleHistory branchId={branchId} branchName={branchName} branchColor={branchColor}
          onBack={() => setTab('weekly')}
          onNavigate={(_p, data) => { setWeekStart(data?.initialWeekStart); setTab('weekly') }} />
      )}
      {tab === 'settings' && (
        <ShiftSettings branchId={branchId} branchName={branchName} branchColor={branchColor}
          onBack={() => setTab('weekly')} />
      )}
    </div>
  )
}
