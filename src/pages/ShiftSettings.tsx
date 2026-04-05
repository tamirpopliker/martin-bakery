import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight, Plus, Trash2, Pencil, X, Check, AlertCircle } from 'lucide-react'

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
}

interface EmployeeRoleAssignment {
  id: number
  employee_id: number
  role_id: number
}

type Tab = 'roles' | 'shifts' | 'staffing' | 'employees'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']

const ROLE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899']

const S = {
  label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', display: 'block', marginBottom: '6px' },
  input: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
}

export default function ShiftSettings({ branchId, branchName, branchColor, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('roles')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'roles', label: 'תפקידים' },
    { key: 'shifts', label: 'משמרות' },
    { key: 'staffing', label: 'דרישות כוח אדם' },
    { key: 'employees', label: 'תפקידי עובדים' },
  ]

  return (
    <motion.div dir="rtl" initial="hidden" animate="visible" variants={fadeIn}
      style={{ padding: '16px', maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight style={{ width: '18px', height: '18px' }} />
        </Button>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0 }}>הגדרות משמרות</h1>
          <span style={{ fontSize: '13px', color: '#64748b' }}>{branchName}</span>
        </div>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: branchColor, marginRight: '4px' }} />
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer',
              fontSize: '14px', fontWeight: '600', fontFamily: 'inherit',
              background: tab === t.key ? branchColor : '#f1f5f9',
              color: tab === t.key ? '#fff' : '#475569',
              transition: 'all 0.2s',
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

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8' }}>טוען...</p>

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeIn}>
      {/* Add form */}
      <Card style={{ marginBottom: '16px' }}>
        <CardContent style={{ padding: '16px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
                      width: '30px', height: '30px', borderRadius: '50%', background: c, border: newColor === c ? '3px solid #1e293b' : '3px solid transparent',
                      cursor: 'pointer', transition: 'border 0.15s',
                    }} />
                ))}
              </div>
            </div>
            <Button onClick={addRole} style={{ gap: '6px' }}>
              <Plus style={{ width: '16px', height: '16px' }} /> הוסף
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Roles list */}
      {roles.length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '24px' }}>אין תפקידים עדיין</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {roles.map(role => (
          <Card key={role.id}>
            <CardContent style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: role.color }} />
                <span style={{ fontSize: '15px', fontWeight: '600' }}>{role.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteRole(role.id)}
                style={{ color: '#ef4444' }}>
                <Trash2 style={{ width: '16px', height: '16px' }} />
              </Button>
            </CardContent>
          </Card>
        ))}
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

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8' }}>טוען...</p>

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeIn}>
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '16px' }}>
        <Button onClick={openAdd} style={{ gap: '6px' }}>
          <Plus style={{ width: '16px', height: '16px' }} /> הוסף משמרת
        </Button>
      </div>

      {shifts.length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8' }}>אין משמרות עדיין</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {shifts.map(shift => (
          <Card key={shift.id}>
            <CardContent style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <span style={{ fontSize: '15px', fontWeight: '600' }}>{shift.name}</span>
                <span style={{ fontSize: '13px', color: '#64748b', marginRight: '12px' }}>
                  {shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}
                </span>
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {shift.days_of_week?.map(d => (
                    <span key={d} style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                      background: '#e0e7ff', color: '#4338ca', fontWeight: '600',
                    }}>
                      {DAY_NAMES[d]}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <Button variant="ghost" size="sm" onClick={() => openEdit(shift)}>
                  <Pencil style={{ width: '16px', height: '16px' }} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => deleteShift(shift.id)} style={{ color: '#ef4444' }}>
                  <Trash2 style={{ width: '16px', height: '16px' }} />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add/Edit Dialog */}
      {dialogOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
        }} onClick={() => setDialogOpen(false)}>
          <div dir="rtl" onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '420px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>{editId ? 'עריכת משמרת' : 'משמרת חדשה'}</h2>
              <button onClick={() => setDialogOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X style={{ width: '20px', height: '20px', color: '#94a3b8' }} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={S.label}>שם משמרת</label>
                <input style={S.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="לדוגמה: בוקר" />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
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
                        fontSize: '13px', fontWeight: '600', fontFamily: 'inherit',
                        background: form.days_of_week.includes(i) ? '#6366f1' : '#f1f5f9',
                        color: form.days_of_week.includes(i) ? '#fff' : '#475569',
                        transition: 'all 0.15s',
                      }}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              <Button onClick={handleSave} style={{ marginTop: '8px' }}>
                <Check style={{ width: '16px', height: '16px', marginLeft: '6px' }} />
                {editId ? 'שמור שינויים' : 'הוסף משמרת'}
              </Button>
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

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8' }}>טוען...</p>

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeIn}>
      <Card style={{ marginBottom: '16px' }}>
        <CardContent style={{ padding: '16px' }}>
          <label style={S.label}>בחר משמרת</label>
          <select style={{ ...S.input, cursor: 'pointer' }} value={selectedShiftId ?? ''}
            onChange={e => setSelectedShiftId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">-- בחר משמרת --</option>
            {shifts.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)})</option>
            ))}
          </select>
        </CardContent>
      </Card>

      {selectedShiftId && roles.length > 0 && (
        <Card>
          <CardContent style={{ padding: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {roles.map(role => (
                <div key={role.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: role.color }} />
                    <span style={{ fontSize: '14px', fontWeight: '600' }}>{role.name}</span>
                  </div>
                  <input type="number" min={0} value={getCount(role.id)}
                    onChange={e => updateCount(role.id, parseInt(e.target.value) || 0)}
                    style={{ ...S.input, width: '80px', textAlign: 'center' }} />
                </div>
              ))}
            </div>
            <div style={{
              marginTop: '16px', padding: '12px', borderRadius: '10px',
              background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '14px', fontWeight: '600', color: '#16a34a',
            }}>
              סה&quot;כ {totalRequired} עובדים נדרשים במשמרת זו
            </div>
          </CardContent>
        </Card>
      )}

      {selectedShiftId && roles.length === 0 && (
        <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '16px' }}>
          אין תפקידים מוגדרים. הגדר תפקידים בלשונית &quot;תפקידים&quot; תחילה.
        </p>
      )}
    </motion.div>
  )
}

/* ==================== Tab 4: Employee Roles ==================== */
function EmployeesTab({ branchId }: { branchId: number }) {
  const [employees, setEmployees] = useState<BranchEmployee[]>([])
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [assignments, setAssignments] = useState<EmployeeRoleAssignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [empRes, rolesRes, assignRes] = await Promise.all([
        supabase.from('branch_employees').select('id, name, active').eq('branch_id', branchId).eq('active', true).order('name'),
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

  async function toggleAssignment(empId: number, roleId: number) {
    const existing = assignments.find(a => a.employee_id === empId && a.role_id === roleId)
    if (existing) {
      setAssignments(prev => prev.filter(a => a.id !== existing.id))
      await supabase.from('employee_role_assignments').delete().eq('id', existing.id)
    } else {
      const { data } = await supabase.from('employee_role_assignments')
        .insert({ employee_id: empId, role_id: roleId })
        .select()
      if (data && data[0]) {
        setAssignments(prev => [...prev, data[0]])
      }
    }
  }

  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8' }}>טוען...</p>

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
      <Card>
        <CardContent style={{ padding: '16px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', fontWeight: '700' }}>עובד</th>
                {roles.map(role => (
                  <th key={role.id} style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '2px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: role.color }} />
                      <span style={{ fontSize: '12px', fontWeight: '600' }}>{role.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                const noRoles = empRoleCount(emp.id) === 0
                return (
                  <tr key={emp.id} style={{ background: noRoles ? '#fef2f2' : undefined }}>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', fontWeight: '500' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {emp.name}
                        {noRoles && (
                          <span style={{
                            fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                            background: '#fecaca', color: '#dc2626', fontWeight: '600',
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                          }}>
                            <AlertCircle style={{ width: '12px', height: '12px' }} />
                            ללא תפקיד
                          </span>
                        )}
                      </div>
                    </td>
                    {roles.map(role => (
                      <td key={role.id} style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid #f1f5f9' }}>
                        <input type="checkbox" checked={hasAssignment(emp.id, role.id)}
                          onChange={() => toggleAssignment(emp.id, role.id)}
                          style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: role.color }} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </motion.div>
  )
}
