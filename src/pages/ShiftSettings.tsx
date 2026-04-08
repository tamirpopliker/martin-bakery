import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Plus, X, Check, AlertCircle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAppUser } from '../lib/UserContext'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface ShiftRole {
  id: number
  branch_id: number
  name: string
  color: string
  is_active: boolean
}

interface BranchShift {
  id: number
  branch_id: number
  name: string
  start_time: string
  end_time: string
  days_of_week: number[]
  is_active: boolean
}

interface StaffingRequirement {
  id?: number
  shift_id: number
  role_id: number
  required_count: number
}

interface BranchEmployee {
  id: number
  name: string
  active: boolean
  priority: number | null
  min_shifts_per_week: number | null
  training_status: string | null
}

interface SpecialDay {
  id: number
  branch_id: number | null
  date: string
  name: string
  type: string
  staffing_multiplier: number
  shift_pattern: string
  source: string | null
}

interface HebcalItem {
  title: string
  date: string
  category: string
  hebrew?: string
}

interface EmployeeRoleAssignment {
  id: number
  employee_id: number
  role_id: number
}

type Tab = 'roles' | 'shifts' | 'staffing' | 'employees' | 'holidays'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']

const ROLE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899']

const card: React.CSSProperties = {
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  borderRadius: '12px',
  border: '1px solid #f1f5f9',
  padding: '20px',
}

const S = {
  label: { fontSize: '13px', fontWeight: '500' as const, color: '#64748b', display: 'block', marginBottom: '6px' },
  input: { width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '9px 12px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit', outline: 'none', background: '#fff' },
}

export default function ShiftSettings({ branchId, branchName, branchColor, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('roles')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'roles', label: 'תפקידים' },
    { key: 'shifts', label: 'משמרות' },
    { key: 'staffing', label: 'דרישות כוח אדם' },
    { key: 'employees', label: 'תפקידי עובדים' },
    { key: 'holidays', label: 'חגים ועומס' },
  ]

  return (
    <motion.div dir="rtl" initial="hidden" animate="visible" variants={fadeIn}
      style={{ padding: '24px 16px', maxWidth: '900px', margin: '0 auto' }}>
      <PageHeader title="הגדרות משמרות" subtitle={branchName} onBack={onBack} />

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '24px', borderBottom: '1px solid #f1f5f9' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', border: 'none', cursor: 'pointer',
              fontSize: '14px', fontWeight: '500', fontFamily: 'inherit',
              background: 'transparent',
              color: tab === t.key ? '#6366f1' : '#94a3b8',
              borderBottom: tab === t.key ? '2px solid #6366f1' : '2px solid transparent',
              transition: 'all 0.2s',
              marginBottom: '-1px',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'roles' && <RolesTab branchId={branchId} />}
      {tab === 'shifts' && <ShiftsTab branchId={branchId} />}
      {tab === 'staffing' && <StaffingTab branchId={branchId} />}
      {tab === 'employees' && <EmployeesTab branchId={branchId} />}
      {tab === 'holidays' && <HolidaysTab branchId={branchId} />}
    </motion.div>
  )
}

/* ==================== Tab 1: Roles ==================== */
function RolesTab({ branchId }: { branchId: number }) {
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(ROLE_COLORS[0])

  async function fetchRoles() {
    const { data } = await supabase.from('shift_roles').select('*')
      .eq('branch_id', branchId).eq('is_active', true).order('name')
    if (data) setRoles(data)
    setLoading(false)
  }

  useEffect(() => { fetchRoles() }, [branchId])

  async function addRole() {
    if (!newName.trim()) return
    await supabase.from('shift_roles').insert({ branch_id: branchId, name: newName.trim(), color: newColor, is_active: true })
    setNewName('')
    setNewColor(ROLE_COLORS[0])
    fetchRoles()
  }

  async function deleteRole(id: number) {
    await supabase.from('shift_roles').update({ is_active: false }).eq('id', id)
    fetchRoles()
  }

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0' }}>טוען...</p>

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeIn}>
      <div style={card}>
        {/* Add form */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: roles.length > 0 ? '24px' : '0', paddingBottom: roles.length > 0 ? '20px' : '0', borderBottom: roles.length > 0 ? '1px solid #f1f5f9' : 'none' }}>
          <div style={{ flex: 1, minWidth: '160px' }}>
            <label style={S.label}>שם תפקיד</label>
            <input style={S.input} value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="לדוגמה: קופאי" onKeyDown={e => e.key === 'Enter' && addRole()} />
          </div>
          <div>
            <label style={S.label}>צבע</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {ROLE_COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)}
                  style={{
                    width: '24px', height: '24px', borderRadius: '50%', background: c,
                    border: newColor === c ? '2.5px solid #1e293b' : '2.5px solid transparent',
                    cursor: 'pointer', transition: 'border 0.15s',
                  }} />
              ))}
            </div>
          </div>
          <button onClick={addRole}
            style={{
              background: 'transparent', border: '1px solid #6366f1', borderRadius: '8px',
              padding: '8px 16px', fontSize: '13px', fontWeight: '500', fontFamily: 'inherit',
              color: '#6366f1', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
            }}>
            <Plus style={{ width: '14px', height: '14px' }} /> הוסף
          </button>
        </div>

        {/* Roles list */}
        {roles.length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8', padding: '16px 0', margin: 0 }}>אין תפקידים עדיין</p>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {roles.map((role, i) => (
            <div key={role.id}
              className="role-row"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 4px',
                borderBottom: i < roles.length - 1 ? '1px solid #f8fafc' : 'none',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: role.color, flexShrink: 0 }} />
                <span style={{ fontSize: '14px', fontWeight: '500', color: '#334155' }}>{role.name}</span>
              </div>
              <button onClick={() => deleteRole(role.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#cbd5e1', fontSize: '16px', padding: '4px 8px', lineHeight: 1,
                }}>
                <X style={{ width: '14px', height: '14px' }} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

/* ==================== Tab 2: Shifts ==================== */
function ShiftsTab({ branchId }: { branchId: number }) {
  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', start_time: '08:00', end_time: '16:00', days_of_week: [0, 1, 2, 3, 4, 5] as number[] })

  async function fetchShifts() {
    const { data } = await supabase.from('branch_shifts').select('*')
      .eq('branch_id', branchId).eq('is_active', true).order('name')
    if (data) setShifts(data)
    setLoading(false)
  }

  useEffect(() => { fetchShifts() }, [branchId])

  function openAdd() {
    setEditId(null)
    setForm({ name: '', start_time: '08:00', end_time: '16:00', days_of_week: [0, 1, 2, 3, 4, 5] })
    setDialogOpen(true)
  }

  function openEdit(s: BranchShift) {
    setEditId(s.id)
    setForm({ name: s.name, start_time: s.start_time, end_time: s.end_time, days_of_week: [...s.days_of_week] })
    setDialogOpen(true)
  }

  function toggleDay(day: number) {
    setForm(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day)
        ? prev.days_of_week.filter(d => d !== day)
        : [...prev.days_of_week, day].sort(),
    }))
  }

  async function handleSave() {
    if (!form.name.trim()) return
    const payload = {
      branch_id: branchId,
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      days_of_week: form.days_of_week,
      is_active: true,
    }
    if (editId) {
      await supabase.from('branch_shifts').update(payload).eq('id', editId)
    } else {
      await supabase.from('branch_shifts').insert(payload)
    }
    setDialogOpen(false)
    fetchShifts()
  }

  async function deleteShift(id: number) {
    await supabase.from('branch_shifts').update({ is_active: false }).eq('id', id)
    fetchShifts()
  }

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0' }}>טוען...</p>

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeIn}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <span style={{ fontSize: '15px', fontWeight: '600', color: '#334155' }}>רשימת משמרות</span>
          <button onClick={openAdd}
            style={{
              background: 'transparent', border: '1px solid #6366f1', borderRadius: '8px',
              padding: '7px 14px', fontSize: '13px', fontWeight: '500', fontFamily: 'inherit',
              color: '#6366f1', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
            }}>
            <Plus style={{ width: '14px', height: '14px' }} /> הוסף משמרת
          </button>
        </div>

        {shifts.length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8', padding: '16px 0', margin: 0 }}>אין משמרות עדיין</p>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shifts.map((shift, i) => (
            <div key={shift.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px',
              padding: '14px 4px',
              borderBottom: i < shifts.length - 1 ? '1px solid #f8fafc' : 'none',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#334155' }}>{shift.name}</span>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                    {shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {shift.days_of_week?.map(d => (
                    <span key={d} style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                      background: '#f1f5f9', color: '#64748b', fontWeight: '500',
                    }}>
                      {DAY_NAMES[d]}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <button onClick={() => openEdit(shift)}
                  style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '5px 10px', fontSize: '12px', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>
                  ערוך
                </button>
                <button onClick={() => deleteShift(shift.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', padding: '4px 6px' }}>
                  <X style={{ width: '14px', height: '14px' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add/Edit Dialog */}
      {dialogOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
        }} onClick={() => setDialogOpen(false)}>
          <div dir="rtl" onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '420px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #f1f5f9',
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0, color: '#1e293b' }}>{editId ? 'עריכת משמרת' : 'משמרת חדשה'}</h2>
              <button onClick={() => setDialogOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <X style={{ width: '18px', height: '18px', color: '#94a3b8' }} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={S.label}>שם משמרת</label>
                <input style={S.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="לדוגמה: בוקר" />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>שעת התחלה</label>
                  <input style={S.input} type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>שעת סיום</label>
                  <input style={S.input} type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={S.label}>ימים</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {DAY_NAMES.map((name, i) => (
                    <button key={i} onClick={() => toggleDay(i)}
                      style={{
                        padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                        fontSize: '13px', fontWeight: '500', fontFamily: 'inherit',
                        background: form.days_of_week.includes(i) ? '#6366f1' : '#f1f5f9',
                        color: form.days_of_week.includes(i) ? '#fff' : '#64748b',
                        transition: 'all 0.15s',
                      }}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleSave}
                style={{
                  marginTop: '4px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '8px',
                  padding: '10px 20px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}>
                <Check style={{ width: '16px', height: '16px' }} />
                {editId ? 'שמור שינויים' : 'הוסף משמרת'}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

/* ==================== Tab 3: Staffing Requirements ==================== */
function StaffingTab({ branchId }: { branchId: number }) {
  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [selectedShiftId, setSelectedShiftId] = useState<number | null>(null)
  const [requirements, setRequirements] = useState<StaffingRequirement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [shiftsRes, rolesRes] = await Promise.all([
        supabase.from('branch_shifts').select('*').eq('branch_id', branchId).eq('is_active', true).order('name'),
        supabase.from('shift_roles').select('*').eq('branch_id', branchId).eq('is_active', true).order('name'),
      ])
      if (shiftsRes.data) setShifts(shiftsRes.data)
      if (rolesRes.data) setRoles(rolesRes.data)
      setLoading(false)
    }
    load()
  }, [branchId])

  useEffect(() => {
    if (!selectedShiftId) return
    async function loadReqs() {
      const { data } = await supabase.from('shift_staffing_requirements').select('*')
        .eq('shift_id', selectedShiftId)
      if (data) setRequirements(data)
    }
    loadReqs()
  }, [selectedShiftId])

  function getCount(roleId: number): number {
    return requirements.find(r => r.role_id === roleId)?.required_count ?? 0
  }

  async function updateCount(roleId: number, count: number) {
    if (!selectedShiftId) return
    const val = Math.max(0, count)
    // Optimistic update
    setRequirements(prev => {
      const existing = prev.find(r => r.role_id === roleId)
      if (existing) return prev.map(r => r.role_id === roleId ? { ...r, required_count: val } : r)
      return [...prev, { shift_id: selectedShiftId, role_id: roleId, required_count: val }]
    })
    await supabase.from('shift_staffing_requirements').upsert(
      { shift_id: selectedShiftId, role_id: roleId, required_count: val },
      { onConflict: 'shift_id,role_id' }
    )
  }

  const totalRequired = requirements.reduce((sum, r) => sum + (r.required_count || 0), 0)

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0' }}>טוען...</p>

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeIn}>
      <div style={card}>
        <label style={S.label}>בחר משמרת</label>
        <select style={{ ...S.input, cursor: 'pointer' }} value={selectedShiftId ?? ''}
          onChange={e => setSelectedShiftId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">-- בחר משמרת --</option>
          {shifts.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)})</option>
          ))}
        </select>

        {selectedShiftId && roles.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {roles.map((role, i) => (
                <div key={role.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                  padding: '12px 0',
                  borderBottom: i < roles.length - 1 ? '1px solid #f8fafc' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: role.color }} />
                    <span style={{ fontSize: '14px', fontWeight: '500', color: '#334155' }}>{role.name}</span>
                  </div>
                  <input type="number" min={0} value={getCount(role.id)}
                    onChange={e => updateCount(role.id, parseInt(e.target.value) || 0)}
                    style={{ ...S.input, width: '72px', textAlign: 'center', padding: '7px 8px' }} />
                </div>
              ))}
            </div>
            <div style={{
              marginTop: '20px', padding: '12px 16px', borderRadius: '8px',
              background: '#f8fafc', border: '1px solid #f1f5f9', fontSize: '14px', fontWeight: '500', color: '#64748b',
            }}>
              סה&quot;כ {totalRequired} עובדים נדרשים במשמרת זו
            </div>
          </div>
        )}

        {selectedShiftId && roles.length === 0 && (
          <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '20px' }}>
            אין תפקידים מוגדרים. הגדר תפקידים בלשונית &quot;תפקידים&quot; תחילה.
          </p>
        )}
      </div>
    </motion.div>
  )
}

/* ==================== Tab 4: Employee Roles ==================== */
function EmployeesTab({ branchId }: { branchId: number }) {
  const { appUser } = useAppUser()
  const isReadOnly = appUser?.role === 'scheduler'
  const [employees, setEmployees] = useState<BranchEmployee[]>([])
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [assignments, setAssignments] = useState<EmployeeRoleAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingEmpChanges, setPendingEmpChanges] = useState<Map<number, Record<string, any>>>(new Map())
  const [pendingRoleAdds, setPendingRoleAdds] = useState<{ empId: number; roleId: number }[]>([])
  const [pendingRoleDeletes, setPendingRoleDeletes] = useState<number[]>([]) // assignment ids to delete
  const [isSaving, setIsSaving] = useState(false)
  const hasPendingChanges = pendingEmpChanges.size > 0 || pendingRoleAdds.length > 0 || pendingRoleDeletes.length > 0

  useEffect(() => {
    async function load() {
      const [empRes, rolesRes, assignRes] = await Promise.all([
        supabase.from('branch_employees').select('id, name, active, priority, min_shifts_per_week, training_status, is_manager').eq('branch_id', branchId).eq('active', true).eq('is_manager', false).order('name'),
        supabase.from('shift_roles').select('*').eq('branch_id', branchId).eq('is_active', true).order('name'),
        supabase.from('employee_role_assignments').select('*'),
      ])
      if (empRes.data) setEmployees(empRes.data)
      if (rolesRes.data) setRoles(rolesRes.data)
      if (assignRes.data) setAssignments(assignRes.data)
      setLoading(false)
    }
    load()
  }, [branchId])

  function hasAssignment(empId: number, roleId: number): boolean {
    return assignments.some(a => a.employee_id === empId && a.role_id === roleId)
  }

  function empRoleCount(empId: number): number {
    return assignments.filter(a => a.employee_id === empId).length
  }

  function toggleAssignment(empId: number, roleId: number) {
    const existing = assignments.find(a => a.employee_id === empId && a.role_id === roleId)
    if (existing) {
      // Check if this was a pending add — cancel it instead
      const pendingIdx = pendingRoleAdds.findIndex(p => p.empId === empId && p.roleId === roleId)
      if (pendingIdx >= 0) {
        setPendingRoleAdds(prev => prev.filter((_, i) => i !== pendingIdx))
      } else {
        setPendingRoleDeletes(prev => [...prev, existing.id])
      }
      setAssignments(prev => prev.filter(a => a.id !== existing.id))
    } else {
      // Check if this was a pending delete — cancel it
      const wasDeleted = pendingRoleDeletes.length > 0
      setPendingRoleAdds(prev => [...prev, { empId, roleId }])
      setAssignments(prev => [...prev, { id: -(Date.now() + Math.random()), employee_id: empId, role_id: roleId } as EmployeeRoleAssignment])
    }
  }

  function updateEmpField(empId: number, field: string, value: any) {
    setPendingEmpChanges(prev => {
      const next = new Map(prev)
      const existing = next.get(empId) || {}
      next.set(empId, { ...existing, [field]: value })
      return next
    })
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, [field]: value } : e))
  }

  async function saveAllChanges() {
    setIsSaving(true)
    try {
      // Save employee field changes (priority, training_status, min_shifts)
      const empUpdates = Array.from(pendingEmpChanges.entries()).map(([id, fields]) =>
        supabase.from('branch_employees').update(fields).eq('id', id)
      )

      // Delete role assignments
      const roleDeletes = pendingRoleDeletes.map(id =>
        supabase.from('employee_role_assignments').delete().eq('id', id)
      )

      // Add role assignments
      const roleAddsData = pendingRoleAdds.map(p => ({ employee_id: p.empId, role_id: p.roleId }))
      const roleAddPromise = roleAddsData.length > 0
        ? supabase.from('employee_role_assignments').insert(roleAddsData).select()
        : Promise.resolve({ data: [] })

      await Promise.all([...empUpdates, ...roleDeletes, roleAddPromise])

      // Reload assignments to get real IDs
      const { data: freshAssignments } = await supabase.from('employee_role_assignments').select('*')
      if (freshAssignments) setAssignments(freshAssignments)

      setPendingEmpChanges(new Map())
      setPendingRoleAdds([])
      setPendingRoleDeletes([])
      alert('✅ השינויים נשמרו')
    } catch (err) {
      alert('שגיאה בשמירה: ' + String(err))
    }
    setIsSaving(false)
  }

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0' }}>טוען...</p>

  if (employees.length === 0 || roles.length === 0) {
    return (
      <motion.div initial="hidden" animate="visible" variants={fadeIn}>
        <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '24px' }}>
          {employees.length === 0 ? 'אין עובדים פעילים בסניף זה.' : 'אין תפקידים מוגדרים. הגדר תפקידים בלשונית "תפקידים" תחילה.'}
        </p>
      </motion.div>
    )
  }

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeIn}>
      {hasPendingChanges && !isReadOnly && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: '10px 16px', marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: '#4338ca', fontWeight: 600 }}>יש שינויים שלא נשמרו</span>
          <button
            onClick={saveAllChanges}
            disabled={isSaving}
            style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: isSaving ? 'wait' : 'pointer', opacity: isSaving ? 0.7 : 1 }}
          >
            {isSaving ? 'שומר...' : '💾 שמור שינויים'}
          </button>
        </div>
      )}
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '13px' }}>עובד</th>
                <th style={{ textAlign: 'center', padding: '10px 6px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '12px' }}>עדיפות</th>
                <th style={{ textAlign: 'center', padding: '10px 6px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '12px' }}>הכשרה</th>
                <th style={{ textAlign: 'center', padding: '10px 6px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '12px' }}>מינ׳ משמרות</th>
                {roles.map(role => (
                  <th key={role.id} style={{ textAlign: 'center', padding: '10px 6px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: role.color }} />
                      <span style={{ fontSize: '11px', fontWeight: '500', color: '#64748b' }}>{role.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                const noRoles = empRoleCount(emp.id) === 0
                return (
                  <tr key={emp.id}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f8fafc', fontWeight: '500', color: '#334155' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {emp.name}
                        {noRoles && (
                          <span style={{
                            fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                            background: '#f1f5f9', color: '#94a3b8', fontWeight: '500',
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                          }}>
                            <AlertCircle style={{ width: '11px', height: '11px' }} />
                            ללא תפקיד
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 6px', borderBottom: '1px solid #f8fafc' }}>
                      <select
                        value={emp.priority || 2}
                        onChange={(e) => {
                          updateEmpField(emp.id, 'priority', Number(e.target.value))
                        }}
                        disabled={isReadOnly}
                        style={{ fontSize: '12px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #e2e8f0', fontFamily: 'inherit', cursor: isReadOnly ? 'default' : 'pointer', background: isReadOnly ? '#f8fafc' : '#fff', opacity: isReadOnly ? 0.7 : 1 }}
                      >
                        <option value={1}>&#x1F947; עדיפות גבוהה</option>
                        <option value={2}>&#x1F464; רגיל</option>
                        <option value={3}>&#x1F504; גמיש</option>
                      </select>
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 6px', borderBottom: '1px solid #f8fafc' }}>
                      <select
                        value={emp.training_status || 'independent'}
                        onChange={(e) => {
                          updateEmpField(emp.id, 'training_status', e.target.value)
                        }}
                        disabled={isReadOnly}
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: isReadOnly ? '#f8fafc' : 'white', fontFamily: 'inherit', cursor: isReadOnly ? 'default' : 'pointer', opacity: isReadOnly ? 0.7 : 1 }}
                      >
                        <option value="independent">{'\uD83D\uDFE2'} עצמאי</option>
                        <option value="trainee">{'\uD83D\uDCDA'} מתלמד</option>
                        <option value="mentor">{'\u2B50'} חונך</option>
                      </select>
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 6px', borderBottom: '1px solid #f8fafc' }}>
                      <input
                        type="number"
                        min={0}
                        max={7}
                        value={emp.min_shifts_per_week || 0}
                        onChange={(e) => {
                          updateEmpField(emp.id, 'min_shifts_per_week', Number(e.target.value))
                        }}
                        disabled={isReadOnly}
                        style={{ width: '56px', textAlign: 'center', fontSize: '13px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #e2e8f0', fontFamily: 'inherit', background: isReadOnly ? '#f8fafc' : '#fff', opacity: isReadOnly ? 0.7 : 1 }}
                      />
                    </td>
                    {roles.map(role => (
                      <td key={role.id} style={{ textAlign: 'center', padding: '10px 6px', borderBottom: '1px solid #f8fafc' }}>
                        <input type="checkbox" checked={hasAssignment(emp.id, role.id)}
                          onChange={() => toggleAssignment(emp.id, role.id)}
                          disabled={isReadOnly}
                          style={{ width: '16px', height: '16px', cursor: isReadOnly ? 'default' : 'pointer', accentColor: role.color, opacity: isReadOnly ? 0.7 : 1 }} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  )
}

/* ==================== Tab 5: Holidays & Load ==================== */
function HolidaysTab({ branchId }: { branchId: number }) {
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([])
  const [loading, setLoading] = useState(true)
  const [hebcalItems, setHebcalItems] = useState<(HebcalItem & { selected: boolean })[]>([])
  const [hebcalLoading, setHebcalLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ date: '', name: '', type: 'holiday', staffing_multiplier: 1.5 })
  const [newShiftPattern, setNewShiftPattern] = useState('regular')

  async function fetchSpecialDays() {
    const { data } = await supabase.from('special_days').select('*')
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .order('date')
    if (data) setSpecialDays(data)
    setLoading(false)
  }

  useEffect(() => { fetchSpecialDays() }, [branchId])

  async function loadHebcalHolidays() {
    setHebcalLoading(true)
    try {
      const year = new Date().getFullYear()
      const res = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&month=x&maj=on&min=off&mod=off&nx=off&mf=off&ss=off&i=off&geo=none`)
      const json = await res.json()
      const items: HebcalItem[] = (json.items || []).filter((item: HebcalItem) => item.category === 'holiday' && item.date)
      setHebcalItems(items.map(item => ({ ...item, selected: false })))
    } catch {
      alert('שגיאה בטעינת חגים מהלוח העברי')
    }
    setHebcalLoading(false)
  }

  async function addSelectedHolidays() {
    const selected = hebcalItems.filter(h => h.selected)
    if (selected.length === 0) return
    try {
      const rows = selected.map(h => ({
        branch_id: branchId,
        date: h.date,
        name: h.title,
        type: 'holiday',
        source: 'hebcal',
        staffing_multiplier: 1.5,
        shift_pattern: 'friday',
      }))
      await supabase.from('special_days').insert(rows)
      setHebcalItems([])
      fetchSpecialDays()
    } catch {
      alert('שגיאה בהוספת חגים')
    }
  }

  async function updateShiftPattern(id: number, val: string) {
    await supabase.from('special_days').update({ shift_pattern: val }).eq('id', id)
    setSpecialDays(prev => prev.map(d => d.id === id ? { ...d, shift_pattern: val } : d))
  }

  async function addSpecialDay() {
    if (!addForm.date || !addForm.name.trim()) return
    const pattern = addForm.type === 'blocked' ? 'closed' : newShiftPattern
    await supabase.from('special_days').insert({
      branch_id: branchId,
      date: addForm.date,
      name: addForm.name.trim(),
      type: addForm.type,
      staffing_multiplier: addForm.type === 'blocked' ? 0 : addForm.staffing_multiplier,
      shift_pattern: pattern,
    })
    setAddForm({ date: '', name: '', type: 'holiday', staffing_multiplier: 1.5 })
    setNewShiftPattern('regular')
    setShowAddForm(false)
    fetchSpecialDays()
  }

  async function deleteSpecialDay(id: number) {
    await supabase.from('special_days').delete().eq('id', id)
    fetchSpecialDays()
  }

  const typeBadge = (type: string) => {
    const map: Record<string, { label: string }> = {
      holiday: { label: 'חג' },
      high_demand: { label: 'עומס גבוה' },
      low_demand: { label: 'עומס נמוך' },
      blocked: { label: 'חסום' },
    }
    const t = map[type] || map.holiday
    return (
      <span style={{ fontSize: '11px', padding: '2px 10px', borderRadius: '6px', background: '#f1f5f9', color: '#64748b', fontWeight: '500' }}>
        {t.label}
      </span>
    )
  }

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0' }}>טוען...</p>

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeIn}>
      {/* Section 1: Load holidays from Hebrew calendar */}
      <div style={{ ...card, marginBottom: '16px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 14px 0', color: '#334155' }}>טען חגים אוטומטית</h3>
        <button onClick={loadHebcalHolidays} disabled={hebcalLoading}
          style={{
            background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '8px',
            padding: '8px 16px', fontSize: '13px', fontWeight: '500', fontFamily: 'inherit',
            color: '#475569', cursor: hebcalLoading ? 'wait' : 'pointer',
          }}>
          {hebcalLoading ? 'טוען...' : 'טען חגים מהלוח העברי'}
        </button>

        {hebcalItems.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #f1f5f9', borderRadius: '8px' }}>
              {hebcalItems.map((item, i) => (
                <label key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', cursor: 'pointer',
                  borderBottom: i < hebcalItems.length - 1 ? '1px solid #f8fafc' : 'none',
                }}>
                  <input type="checkbox" checked={item.selected}
                    onChange={() => setHebcalItems(prev => prev.map((h, j) => j === i ? { ...h, selected: !h.selected } : h))}
                    style={{ width: '15px', height: '15px', cursor: 'pointer' }} />
                  <span style={{ fontSize: '14px', fontWeight: '500', color: '#334155' }}>{item.title}</span>
                  {item.hebrew && <span style={{ fontSize: '12px', color: '#94a3b8' }}>({item.hebrew})</span>}
                  <span style={{ fontSize: '12px', color: '#cbd5e1', marginRight: 'auto', direction: 'ltr' }}>{item.date}</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              <button onClick={addSelectedHolidays}
                style={{
                  background: 'transparent', border: '1px solid #6366f1', borderRadius: '8px',
                  padding: '7px 14px', fontSize: '13px', fontWeight: '500', fontFamily: 'inherit',
                  color: '#6366f1', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                <Plus style={{ width: '14px', height: '14px' }} /> הוסף נבחרים ({hebcalItems.filter(h => h.selected).length})
              </button>
              <button onClick={() => setHebcalItems([])}
                style={{
                  background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '8px',
                  padding: '7px 14px', fontSize: '13px', fontWeight: '500', fontFamily: 'inherit',
                  color: '#64748b', cursor: 'pointer',
                }}>
                ביטול
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Special Days */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '600', margin: 0, color: '#334155' }}>ימים מיוחדים</h3>
          <button onClick={() => setShowAddForm(!showAddForm)}
            style={{
              background: 'transparent', border: '1px solid #6366f1', borderRadius: '8px',
              padding: '7px 14px', fontSize: '13px', fontWeight: '500', fontFamily: 'inherit',
              color: '#6366f1', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
            }}>
            <Plus style={{ width: '14px', height: '14px' }} /> הוסף יום מיוחד
          </button>
        </div>

        {showAddForm && (
          <div style={{
            padding: '16px', borderRadius: '10px', background: '#fafbfc', border: '1px solid #f1f5f9', marginBottom: '16px',
            display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={S.label}>תאריך</label>
                <input type="date" style={S.input} value={addForm.date}
                  onChange={e => setAddForm({ ...addForm, date: e.target.value })} />
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={S.label}>שם</label>
                <input style={S.input} value={addForm.name}
                  onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                  placeholder="לדוגמה: ערב פסח" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={S.label}>סוג</label>
                <select style={{ ...S.input, cursor: 'pointer' }} value={addForm.type}
                  onChange={e => setAddForm({ ...addForm, type: e.target.value })}>
                  <option value="holiday">חג</option>
                  <option value="high_demand">עומס גבוה</option>
                  <option value="low_demand">עומס נמוך</option>
                  <option value="blocked">יום חסום</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={S.label}>מכפיל כוח אדם</label>
                <input type="number" min={0.5} max={2.0} step={0.1} style={S.input}
                  value={addForm.staffing_multiplier}
                  onChange={e => setAddForm({ ...addForm, staffing_multiplier: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <label style={S.label}>תבנית משמרות</label>
              <select value={newShiftPattern} onChange={e => setNewShiftPattern(e.target.value)}
                style={{ ...S.input, cursor: 'pointer' }}>
                <option value="regular">רגיל — כל המשמרות</option>
                <option value="friday">ערב חג — כמו שישי</option>
                <option value="closed">סגור — אין משמרות</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button onClick={addSpecialDay}
                style={{
                  background: '#6366f1', color: '#fff', border: 'none', borderRadius: '8px',
                  padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                <Check style={{ width: '14px', height: '14px' }} /> הוסף
              </button>
              <button onClick={() => setShowAddForm(false)}
                style={{
                  background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '8px',
                  padding: '8px 16px', fontSize: '13px', fontWeight: '500', fontFamily: 'inherit',
                  color: '#64748b', cursor: 'pointer',
                }}>
                ביטול
              </button>
            </div>
          </div>
        )}

        {specialDays.length === 0 && !showAddForm && (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: '16px 0', margin: 0 }}>אין ימים מיוחדים</p>
        )}

        {specialDays.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '13px' }}>תאריך</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '13px' }}>שם</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '13px' }}>סוג</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '13px' }}>תבנית</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '13px' }}>מכפיל</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#64748b', fontSize: '13px' }}></th>
                </tr>
              </thead>
              <tbody>
                {specialDays.map(day => (
                  <tr key={day.id}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f8fafc', direction: 'ltr', textAlign: 'right', color: '#64748b', fontSize: '13px' }}>{day.date}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f8fafc', fontWeight: '500', color: '#334155' }}>{day.name}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f8fafc', textAlign: 'center' }}>{typeBadge(day.type)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f8fafc', textAlign: 'center' }}>
                      <select value={day.shift_pattern || 'regular'}
                        onChange={e => updateShiftPattern(day.id, e.target.value)}
                        style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer', background: '#fff', fontFamily: 'inherit', color: '#475569' }}>
                        <option value="regular">רגיל</option>
                        <option value="friday">ערב חג</option>
                        <option value="closed">סגור</option>
                      </select>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f8fafc', textAlign: 'center', fontWeight: '500', color: '#64748b' }}>x{day.staffing_multiplier}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f8fafc', textAlign: 'center' }}>
                      <button onClick={() => deleteSpecialDay(day.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', padding: '4px' }}>
                        <X style={{ width: '14px', height: '14px' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  )
}
