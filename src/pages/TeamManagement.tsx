import { useState } from 'react'
import { Users, UserX, Settings } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import BranchEmployees from './BranchEmployees'
import ShiftSettings from './ShiftSettings'
import EmployeeArchive from './EmployeeArchive'

interface Props {
  branchId: number; branchName: string; branchColor: string
  onBack: () => void
  onEditEmployee?: (empId: number) => void
}

export default function TeamManagement({ branchId, branchName, branchColor, onBack, onEditEmployee }: Props) {
  const [tab, setTab] = useState<'employees' | 'roles' | 'archive'>('employees')

  const tabBtnStyle = (active: boolean) => ({
    padding: '12px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
    border: 'none' as const, borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
    background: 'none' as const, color: active ? '#6366f1' : '#94a3b8',
  })

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="צוות" subtitle={branchName} onBack={onBack} />

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', paddingRight: 32, background: 'white' }}>
        <button onClick={() => setTab('employees')} style={tabBtnStyle(tab === 'employees')}>
          <Users size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> עובדים פעילים
        </button>
        <button onClick={() => setTab('archive')} style={tabBtnStyle(tab === 'archive')}>
          <UserX size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> לא פעילים
        </button>
        <button onClick={() => setTab('roles')} style={tabBtnStyle(tab === 'roles')}>
          <Settings size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> תפקידים
        </button>
      </div>

      {tab === 'employees' && (
        <BranchEmployees branchId={branchId} branchName={branchName} branchColor={branchColor}
          onBack={() => setTab('employees')} onEditEmployee={onEditEmployee} />
      )}
      {tab === 'archive' && (
        <EmployeeArchive branchId={branchId} branchName={branchName} branchColor={branchColor}
          onBack={() => setTab('employees')} />
      )}
      {tab === 'roles' && (
        <ShiftSettings branchId={branchId} branchName={branchName} branchColor={branchColor}
          onBack={() => setTab('employees')} />
      )}
    </div>
  )
}
