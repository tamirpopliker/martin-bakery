import { useState } from 'react'
import { Users, Mail, Settings } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import BranchEmployees from './BranchEmployees'
import ShiftSettings from './ShiftSettings'

interface Props {
  branchId: number; branchName: string; branchColor: string
  onBack: () => void
}

export default function TeamManagement({ branchId, branchName, branchColor, onBack }: Props) {
  const [tab, setTab] = useState<'employees' | 'roles'>('employees')
  const [subPage, setSubPage] = useState<string | null>(null)

  // If navigating to sub-page from BranchEmployees
  if (subPage === 'employee-archive') {
    // Let BranchEmployees handle archive internally
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="צוות" subtitle={branchName} onBack={onBack} />

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', paddingRight: 32, background: 'white' }}>
        <button onClick={() => setTab('employees')}
          style={{ padding: '12px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', borderBottom: tab === 'employees' ? '2px solid #6366f1' : '2px solid transparent', background: 'none', color: tab === 'employees' ? '#6366f1' : '#94a3b8' }}>
          <Users size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> עובדים והזמנות
        </button>
        <button onClick={() => setTab('roles')}
          style={{ padding: '12px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', borderBottom: tab === 'roles' ? '2px solid #6366f1' : '2px solid transparent', background: 'none', color: tab === 'roles' ? '#6366f1' : '#94a3b8' }}>
          <Settings size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> תפקידים
        </button>
      </div>

      {tab === 'employees' && (
        <BranchEmployees branchId={branchId} branchName={branchName} branchColor={branchColor}
          onBack={() => setTab('employees')} onNavigate={(p) => setSubPage(p)} />
      )}
      {tab === 'roles' && (
        <ShiftSettings branchId={branchId} branchName={branchName} branchColor={branchColor}
          onBack={() => setTab('employees')} />
      )}
    </div>
  )
}
