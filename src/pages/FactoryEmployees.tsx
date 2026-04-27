import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { Plus, Pencil, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import PageHeader from '../components/PageHeader'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Props { onBack: () => void }

type DeptKey = 'creams' | 'dough' | 'packaging' | 'cleaning'

interface Employee {
  id: number
  name: string
  employee_number: string | null
  department: string
  wage_type: 'hourly' | 'global'
  hourly_rate: number | null
  global_daily_rate: number | null
  bonus: number | null
  active: boolean
}

// ─── קבועים ─────────────────────────────────────────────────────────────────
const DEPT_LABELS: Record<string, string> = {
  creams: 'קרמים',
  dough: 'בצקים',
  packaging: 'אריזה',
  cleaning: 'ניקיון',
}

const ALL_DEPTS: { key: DeptKey; label: string }[] = [
  { key: 'creams',    label: 'קרמים' },
  { key: 'dough',     label: 'בצקים' },
  { key: 'packaging', label: 'אריזה' },
  { key: 'cleaning',  label: 'ניקיון' },
]

const fadeIn = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
}

function fmtM(n: number) { return '₪' + Math.round(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) }

// ─── סגנונות ─────────────────────────────────────────────────────────────────
const S = {
  label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
  input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
}

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function FactoryEmployees({ onBack }: Props) {
  const { appUser } = useAppUser()

  const isAdmin = appUser?.role === 'admin'
  const managedDept = appUser?.managed_department ?? null

  // Department filter logic
  const allowedDepts: DeptKey[] = isAdmin
    ? (['creams', 'dough', 'packaging', 'cleaning'] as DeptKey[])
    : managedDept
      ? Array.from(new Set([managedDept as DeptKey, 'cleaning' as DeptKey, 'packaging' as DeptKey]))
      : (['creams', 'dough', 'packaging', 'cleaning'] as DeptKey[])

  const [deptFilter, setDeptFilter] = useState<string>(
    managedDept && !isAdmin ? managedDept : 'all',
  )
  const [employees, setEmployees]   = useState<Employee[]>([])
  const [loading, setLoading]       = useState(true)
  const [editEmpId, setEditEmpId]   = useState<number | null>(null)
  const [editEmpData, setEditEmpData] = useState<Partial<Employee>>({})
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [newEmp, setNewEmp]         = useState<Partial<Employee>>({ wage_type: 'hourly', department: allowedDepts[0] })
  const [loadingEmp, setLoadingEmp] = useState(false)

  // ─── שליפות ──────────────────────────────────────────────────────────────
  async function fetchEmployees() {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').order('department').order('name')
    if (data) setEmployees(data)
    setLoading(false)
  }

  useEffect(() => { fetchEmployees() }, [])

  // ─── CRUD ────────────────────────────────────────────────────────────────
  async function addEmployee() {
    if (!newEmp.name || !newEmp.department || !newEmp.wage_type) return
    setLoadingEmp(true)
    const { error } = await supabase.from('employees').insert({
      name: newEmp.name,
      employee_number: newEmp.employee_number || null,
      department: newEmp.department,
      wage_type: newEmp.wage_type,
      hourly_rate: newEmp.wage_type === 'hourly' ? (newEmp.hourly_rate || null) : null,
      global_daily_rate: newEmp.wage_type === 'global' ? (newEmp.global_daily_rate || null) : null,
      bonus: newEmp.bonus || null,
    })
    if (error) {
      console.error('[FactoryEmployees addEmployee] error:', error)
      alert(`הוספת עובד נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      setLoadingEmp(false)
      return
    }
    setNewEmp({ wage_type: 'hourly', department: allowedDepts[0] })
    setShowAddEmp(false)
    await fetchEmployees()
    setLoadingEmp(false)
  }

  async function saveEmployee(id: number) {
    const { error } = await supabase.from('employees').update(editEmpData).eq('id', id)
    if (error) {
      console.error('[FactoryEmployees saveEmployee] error:', error)
      alert(`עדכון פרטי עובד נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    setEditEmpId(null)
    await fetchEmployees()
  }

  async function toggleActive(emp: Employee) {
    const { error } = await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id)
    if (error) {
      console.error('[FactoryEmployees toggleActive] error:', error)
      alert(`שינוי סטטוס פעילות נכשל: ${error.message || 'שגיאת מסד נתונים'}.`)
      return
    }
    await fetchEmployees()
  }

  // ─── סינון ─────────────────────────────────────────────────────────────
  const filteredEmps = employees.filter(e => {
    // First check allowed departments
    if (!allowedDepts.includes(e.department as DeptKey) && e.department !== 'both') return false
    // Then apply selected filter
    if (deptFilter !== 'all' && e.department !== deptFilter) return false
    return true
  })

  const activeCount = filteredEmps.filter(e => e.active).length
  const inactiveCount = filteredEmps.filter(e => !e.active).length

  const currentDeptLabel = deptFilter === 'all'
    ? 'כל המחלקות'
    : DEPT_LABELS[deptFilter] || deptFilter

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <PageHeader
        title="עובדי מפעל"
        subtitle={`${currentDeptLabel} · ${activeCount} פעילים · ${inactiveCount} מושבתים`}
        onBack={onBack}
        action={
          <button onClick={() => setShowAddEmp(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: showAddEmp ? '#64748b' : '#0f172a', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Plus size={16} /> {showAddEmp ? 'ביטול' : 'הוסף עובד'}
          </button>
        }
      />

      <div style={{ padding: '24px 32px', maxWidth: '960px', margin: '0 auto' }}>

        {/* ─── פילטר מחלקה (אדמין בלבד) ─────────────────────────────── */}
        {isAdmin && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setDeptFilter('all')}
              className={`border-0 rounded-lg py-1.5 px-3.5 text-[13px] font-semibold cursor-pointer ${deptFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}
            >
              הכל
            </button>
            {ALL_DEPTS.map(d => (
              <button
                key={d.key}
                onClick={() => setDeptFilter(d.key)}
                className={`border-0 rounded-lg py-1.5 px-3.5 text-[13px] font-semibold cursor-pointer ${deptFilter === d.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        {/* ─── טופס הוספת עובד ────────────────────────────────────────── */}
        {showAddEmp && (
          <Card className="shadow-sm mb-5" style={{ borderTop: '3px solid #0f172a' }}>
            <CardContent className="p-6">
              <h3 style={{ margin: '0 0 18px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>עובד חדש</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gridColumn: 'span 2' }}>
                  <label style={S.label}>שם מלא</label>
                  <input type="text" placeholder="שם עובד..." value={newEmp.name || ''}
                    onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))} style={S.input} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={S.label}>מס׳ עובד <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                  <input type="text" placeholder="—" value={newEmp.employee_number || ''}
                    onChange={e => setNewEmp(p => ({ ...p, employee_number: e.target.value || null }))} style={S.input} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={S.label}>סוג שכר</label>
                  <select value={newEmp.wage_type || 'hourly'} onChange={e => setNewEmp(p => ({ ...p, wage_type: e.target.value as 'hourly' | 'global' }))}
                    style={{ ...S.input, background: 'white' }}>
                    <option value="hourly">שעתי</option>
                    <option value="global">גלובלי</option>
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={S.label}>מחלקה</label>
                  <select value={newEmp.department || allowedDepts[0]} onChange={e => setNewEmp(p => ({ ...p, department: e.target.value }))}
                    style={{ ...S.input, background: 'white' }}>
                    {allowedDepts.map(key => (
                      <option key={key} value={key}>{DEPT_LABELS[key]}</option>
                    ))}
                  </select>
                </div>
                {newEmp.wage_type === 'hourly' ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={S.label}>תעריף שעתי (₪)</label>
                    <input type="number" placeholder="0" value={newEmp.hourly_rate || ''}
                      onChange={e => setNewEmp(p => ({ ...p, hourly_rate: parseFloat(e.target.value) || null }))}
                      style={{ ...S.input, textAlign: 'right' }} />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={S.label}>משכורת חודשית (₪)</label>
                    <input type="number" placeholder="0" value={newEmp.global_daily_rate || ''}
                      onChange={e => setNewEmp(p => ({ ...p, global_daily_rate: parseFloat(e.target.value) || null }))}
                      style={{ ...S.input, textAlign: 'right' }} />
                  </div>
                )}
              </div>
              <button onClick={addEmployee} disabled={loadingEmp || !newEmp.name}
                style={{ background: loadingEmp || !newEmp.name ? '#e2e8f0' : '#0f172a', color: loadingEmp || !newEmp.name ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={18} />הוסף עובד
              </button>
            </CardContent>
          </Card>
        )}

        {/* ─── טבלת עובדים ────────────────────────────────────────────── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>טוען...</div>
        ) : (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll">
              <Card className="shadow-sm">
                <CardContent className="p-6">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 70px 110px 50px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                    <span>שם</span>
                    <span>מספר עובד</span>
                    <span>מחלקה</span>
                    <span>סוג שכר</span>
                    <span style={{ textAlign: 'center' }}>תעריף</span>
                    <span style={{ textAlign: 'center' }}>פעיל</span>
                    <span />
                  </div>

                  {filteredEmps.length === 0 ? (
                    <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
                      <Users size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                      <div>אין עובדים</div>
                    </div>
                  ) : filteredEmps.map((emp, i) => (
                    <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 70px 110px 50px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: i < filteredEmps.length - 1 ? '1px solid #f1f5f9' : 'none', background: !emp.active ? '#fff1f2' : i % 2 === 0 ? 'white' : '#fafafa', opacity: emp.active ? 1 : 0.6 }}>
                      {editEmpId === emp.id ? (
                        <>
                          <input type="text" value={editEmpData.name || ''} onChange={e => setEditEmpData(p => ({ ...p, name: e.target.value }))} autoFocus style={{ border: '1.5px solid #0f172a', borderRadius: '8px', padding: '5px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                          <input type="text" value={editEmpData.employee_number || ''} onChange={e => setEditEmpData(p => ({ ...p, employee_number: e.target.value || null }))} style={{ border: '1px solid #0f172a', borderRadius: '6px', padding: '5px 6px', fontSize: '12px', textAlign: 'center' }} placeholder="—" />
                          <select value={editEmpData.department || ''} onChange={e => setEditEmpData(p => ({ ...p, department: e.target.value }))} style={{ border: '1px solid #0f172a', borderRadius: '6px', padding: '5px 6px', fontSize: '12px', fontFamily: 'inherit' }}>
                            {ALL_DEPTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                          </select>
                          <select value={editEmpData.wage_type || ''} onChange={e => setEditEmpData(p => ({ ...p, wage_type: e.target.value as 'hourly' | 'global' }))} style={{ border: '1px solid #0f172a', borderRadius: '6px', padding: '5px 6px', fontSize: '11px', fontFamily: 'inherit' }}>
                            <option value="hourly">שעתי</option>
                            <option value="global">גלובלי</option>
                          </select>
                          <input type="number" value={editEmpData.wage_type === 'global' ? (editEmpData.global_daily_rate || '') : (editEmpData.hourly_rate || '')} onChange={e => setEditEmpData(p => p.wage_type === 'global' ? { ...p, global_daily_rate: parseFloat(e.target.value) } : { ...p, hourly_rate: parseFloat(e.target.value) })} style={{ border: '1px solid #0f172a', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', textAlign: 'center' }} placeholder={editEmpData.wage_type === 'global' ? 'חודשי' : 'שעתי'} />
                          <button onClick={() => saveEmployee(emp.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>&#10003;</button>
                          <button onClick={() => setEditEmpId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>&#10005;</button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{emp.name}</span>
                          <span style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>{emp.employee_number || '—'}</span>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            {DEPT_LABELS[emp.department] || emp.department}
                          </span>
                          <span style={{ fontSize: '11px', background: emp.wage_type === 'hourly' ? '#dbeafe' : '#d1fae5', color: emp.wage_type === 'hourly' ? '#1d4ed8' : '#065f46', padding: '2px 8px', borderRadius: '20px', fontWeight: '600', textAlign: 'center' }}>
                            {emp.wage_type === 'hourly' ? 'שעתי' : 'גלובלי'}
                          </span>
                          <span style={{ textAlign: 'center', fontWeight: '700', color: '#0f172a', fontSize: '13px' }}>
                            {emp.wage_type === 'hourly'
                              ? (emp.hourly_rate ? `₪${emp.hourly_rate}/ש׳` : '—')
                              : (emp.global_daily_rate ? fmtM(emp.global_daily_rate) : '—')}
                          </span>
                          <span style={{ textAlign: 'center' }}>
                            <button onClick={() => toggleActive(emp)}
                              style={{ background: emp.active ? '#d1fae5' : '#fecdd3', color: emp.active ? '#065f46' : '#991b1b', border: 'none', borderRadius: '20px', padding: '2px 10px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>
                              {emp.active ? '&#10003;' : '&#10005;'}
                            </button>
                          </span>
                          <button onClick={() => { setEditEmpId(emp.id); setEditEmpData(emp) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Pencil size={14} color="#94a3b8" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}

                  {filteredEmps.length > 0 && (
                    <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderRadius: '0 0 20px 20px', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                      {filteredEmps.length} עובדים — {activeCount} פעילים · {inactiveCount} מושבתים
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
