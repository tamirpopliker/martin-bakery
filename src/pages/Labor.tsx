import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Pencil, Trash2, Upload, Users, AlertTriangle, X, Check, Save } from 'lucide-react'

interface Props { onBack: () => void }

interface Employee {
  id: number
  name: string
  employee_number: string
  department: string
  wage_type: 'hourly' | 'global'
  hourly_rate: number
  global_daily_rate: number
  active: boolean
}

interface ParsedRow {
  id: string
  name: string
  hours_100: number
  hours_125: number
  hours_150: number
  employee?: Employee
  found: boolean
  editing: boolean
}

interface AddForm {
  name: string
  employee_number: string
  department: string
  wage_type: 'hourly' | 'global'
  hourly_rate: string
  global_daily_rate: string
}

const deptOptions = [
  { value: 'creams', label: 'קרמים' },
  { value: 'dough', label: 'בצקים' },
  { value: 'packaging', label: 'אריזה' },
  { value: 'cleaning', label: 'ניקיון' },
]

const EMPLOYER_COST = 1.3

function calcCost(emp: Employee, h100: number, h125: number, h150: number): number {
  if (emp.wage_type === 'global') return emp.global_daily_rate * EMPLOYER_COST
  const base = emp.hourly_rate
  return ((h100 * base) + (h125 * base * 1.25) + (h150 * base * 1.5)) * EMPLOYER_COST
}

const emptyForm: AddForm = { name: '', employee_number: '', department: 'creams', wage_type: 'hourly', hourly_rate: '', global_daily_rate: '' }

export default function Labor({ onBack }: Props) {
  const [tab, setTab] = useState<'upload' | 'employees'>('upload')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>(emptyForm)
  const [editEmpId, setEditEmpId] = useState<number | null>(null)
  const [editEmpData, setEditEmpData] = useState<Partial<Employee>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  async function fetchEmployees() {
    const { data } = await supabase.from('employees').select('*').eq('active', true).order('name')
    if (data) setEmployees(data)
  }

  useEffect(() => { fetchEmployees() }, [])

  function parseCSV(text: string) {
    const lines = text.split('\n').filter(l => l.trim())
    const newRows: ParsedRow[] = []
    for (const line of lines) {
      const cols = line.split(',')
      const name = cols[0]?.trim().replace(/"/g, '')
      if (!name || name.includes('שם העובד') || name.includes('לתשומת') || name.includes('דוח') || name.includes('שם החברה')) continue
      const hours_100 = parseFloat(cols[18]) || 0
      const hours_125 = parseFloat(cols[19]) || 0
      const hours_150 = parseFloat(cols[20]) || 0
      if (hours_100 === 0 && hours_125 === 0 && hours_150 === 0) continue
      const emp = employees.find(e => e.name.trim().toLowerCase() === name.toLowerCase())
      newRows.push({ id: Math.random().toString(36).slice(2), name, hours_100, hours_125, hours_150, employee: emp, found: !!emp, editing: false })
    }
    setRows(newRows)
    setSaved(false)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => parseCSV(ev.target?.result as string)
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  function deleteRow(id: string) {
    setRows(r => r.filter(row => row.id !== id))
  }

  function startEdit(id: string) {
    setRows(r => r.map(row => row.id === id ? { ...row, editing: true } : row))
  }

  function updateRow(id: string, field: 'hours_100' | 'hours_125' | 'hours_150', val: string) {
    setRows(r => r.map(row => row.id === id ? { ...row, [field]: parseFloat(val) || 0 } : row))
  }

  function saveRowEdit(id: string) {
    setRows(r => r.map(row => row.id === id ? { ...row, editing: false } : row))
  }

  async function handleSave() {
    const knownRows = rows.filter(r => r.found && r.employee)
    if (!knownRows.length) return
    setSaving(true)
    const inserts = knownRows.map(r => ({
      entity_type: 'factory',
      entity_id: r.employee!.department,
      date,
      employee_name: r.name,
      hours_100: r.hours_100,
      hours_125: r.hours_125,
      hours_150: r.hours_150,
      hourly_rate: r.employee!.hourly_rate,
      gross_salary: calcCost(r.employee!, r.hours_100, r.hours_125, r.hours_150)
    }))
    await supabase.from('labor').insert(inserts)
    setSaving(false)
    setSaved(true)
    setRows([])
  }

  async function handleAddEmployee() {
    if (!addForm.name) return
    await supabase.from('employees').insert({
      name: addForm.name,
      employee_number: addForm.employee_number,
      department: addForm.department,
      wage_type: addForm.wage_type,
      hourly_rate: parseFloat(addForm.hourly_rate) || 0,
      global_daily_rate: parseFloat(addForm.global_daily_rate) || 0,
    })
    await fetchEmployees()
    setShowAddEmp(false)
    setAddForm(emptyForm)
  }

  async function handleDeleteEmployee(id: number) {
    await supabase.from('employees').update({ active: false }).eq('id', id)
    await fetchEmployees()
  }

  async function handleEditEmployee(id: number) {
    await supabase.from('employees').update(editEmpData).eq('id', id)
    setEditEmpId(null)
    await fetchEmployees()
  }

  const knownRows = rows.filter(r => r.found && r.employee)
  const unknownRows = rows.filter(r => !r.found)
  const totalCost = knownRows.reduce((s, r) => s + calcCost(r.employee!, r.hours_100, r.hours_125, r.hours_150), 0)

  const inpStyle = { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '9px 12px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', textAlign: 'right' as const, width: '100%', boxSizing: 'border-box' as const }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>

      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>לייבור מרוכז</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>העלאת נוכחות וניהול עובדים</p>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => setTab('upload')} style={{ background: tab === 'upload' ? '#3b82f6' : '#f1f5f9', color: tab === 'upload' ? 'white' : '#64748b', border: 'none', borderRadius: '10px', padding: '8px 20px', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
            העלאת קובץ
          </button>
          <button onClick={() => setTab('employees')} style={{ background: tab === 'employees' ? '#3b82f6' : '#f1f5f9', color: tab === 'employees' ? 'white' : '#64748b', border: 'none', borderRadius: '10px', padding: '8px 20px', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
            עובדים ({employees.length})
          </button>
        </div>
      </div>

      <div style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto' }}>

        {tab === 'upload' && (
          <>
            <div style={{ background: 'white', borderRadius: '20px', padding: '28px', marginBottom: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <h2 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: '700', color: '#374151' }}>העלאת קובץ נוכחות</h2>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>תאריך</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit' }} />
                </div>
                <div>
                  <input type="file" accept=".csv" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
                  <button onClick={() => fileRef.current?.click()} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Upload size={18} />בחר קובץ CSV
                  </button>
                </div>
              </div>
            </div>

            {unknownRows.length > 0 && (
              <div style={{ background: '#fef3c7', border: '1.5px solid #fde68a', borderRadius: '16px', padding: '20px 24px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <AlertTriangle size={20} color="#f59e0b" />
                  <span style={{ fontWeight: '700', color: '#92400e', fontSize: '15px' }}>עובדים לא מזוהים — ניתן להקים או למחוק מהרשימה</span>
                </div>
                {unknownRows.map(row => (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderRadius: '10px', padding: '12px 16px', marginBottom: '8px' }}>
                    <span style={{ fontWeight: '600', color: '#374151' }}>{row.name}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { setShowAddEmp(true); setAddForm(f => ({ ...f, name: row.name })) }}
                        style={{ background: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 16px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                        הקם עובד
                      </button>
                      <button onClick={() => deleteRow(row.id)}
                        style={{ background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rows.length > 0 && (
              <>
                <div style={{ background: 'white', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 110px 130px 36px 36px', padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                    <span>עובד</span><span>100%</span><span>125%</span><span>150%</span><span>מחלקה</span><span>עלות מעביד</span><span></span><span></span>
                  </div>
                  {rows.map((row, i) => (
                    <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 110px 130px 36px 36px', alignItems: 'center', padding: '12px 24px', borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none', background: !row.found ? '#fef9f0' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {!row.found && <AlertTriangle size={14} color="#f59e0b" />}
                        <span style={{ fontWeight: '600', color: row.found ? '#374151' : '#92400e', fontSize: '14px' }}>{row.name}</span>
                      </div>

                      {row.editing ? (
                        <>
                          <input type="number" value={row.hours_100} onChange={e => updateRow(row.id, 'hours_100', e.target.value)} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 6px', fontSize: '13px', width: '75px' }} />
                          <input type="number" value={row.hours_125} onChange={e => updateRow(row.id, 'hours_125', e.target.value)} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 6px', fontSize: '13px', width: '75px' }} />
                          <input type="number" value={row.hours_150} onChange={e => updateRow(row.id, 'hours_150', e.target.value)} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 6px', fontSize: '13px', width: '75px' }} />
                          <span style={{ fontSize: '12px', color: '#64748b' }}>{row.employee ? deptOptions.find(d => d.value === row.employee!.department)?.label : '—'}</span>
                          <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>
                            {row.employee ? '₪' + calcCost(row.employee, row.hours_100, row.hours_125, row.hours_150).toFixed(0) : '—'}
                          </span>
                          <button onClick={() => saveRowEdit(row.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 6px', cursor: 'pointer' }}>
                            <Check size={14} />
                          </button>
                          <button onClick={() => deleteRow(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Trash2 size={14} color="#ef4444" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: '13px', color: '#64748b' }}>{row.hours_100}</span>
                          <span style={{ fontSize: '13px', color: '#64748b' }}>{row.hours_125}</span>
                          <span style={{ fontSize: '13px', color: '#64748b' }}>{row.hours_150}</span>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>{row.employee ? deptOptions.find(d => d.value === row.employee!.department)?.label : '—'}</span>
                          <span style={{ fontWeight: '700', color: row.found ? '#0f172a' : '#94a3b8', fontSize: '14px' }}>
                            {row.found && row.employee ? '₪' + calcCost(row.employee, row.hours_100, row.hours_125, row.hours_150).toFixed(0) : '—'}
                          </span>
                          <button onClick={() => startEdit(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Pencil size={14} color="#94a3b8" />
                          </button>
                          <button onClick={() => deleteRow(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Trash2 size={14} color="#ef4444" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ background: '#0f172a', color: 'white', borderRadius: '12px', padding: '12px 24px', fontWeight: '800', fontSize: '18px' }}>
                    סה"כ עלות מעביד: ₪{totalCost.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  </div>
                  <button onClick={handleSave} disabled={saving || saved || knownRows.length === 0}
                    style={{ background: saved ? '#10b981' : saving || knownRows.length === 0 ? '#e2e8f0' : '#3b82f6', color: saved || knownRows.length > 0 ? 'white' : '#94a3b8', border: 'none', borderRadius: '12px', padding: '12px 32px', fontWeight: '700', fontSize: '16px', cursor: knownRows.length > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {saved ? <><Check size={18} />נשמר!</> : saving ? 'שומר...' : <><Save size={18} />אשר ושמור</>}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'employees' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button onClick={() => setShowAddEmp(true)} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={16} />הוסף עובד
              </button>
            </div>
            <div style={{ background: 'white', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px 100px 120px 40px 40px', padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                <span>שם</span><span>מחלקה</span><span>סוג שכר</span><span>תעריף שעתי</span><span>גלובאלי/יום</span><span></span><span></span>
              </div>
              {employees.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין עובדים — הוסף עובד ראשון</div>
              ) : employees.map((emp, i) => (
                <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px 100px 120px 40px 40px', alignItems: 'center', padding: '13px 24px', borderBottom: i < employees.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editEmpId === emp.id ? (
                    <>
                      <input value={editEmpData.name || ''} onChange={e => setEditEmpData({ ...editEmpData, name: e.target.value })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', textAlign: 'right' }} />
                      <select value={editEmpData.department || ''} onChange={e => setEditEmpData({ ...editEmpData, department: e.target.value })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px', fontSize: '12px' }}>
                        {deptOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                      <select value={editEmpData.wage_type || ''} onChange={e => setEditEmpData({ ...editEmpData, wage_type: e.target.value as any })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px', fontSize: '12px' }}>
                        <option value="hourly">שעתי</option>
                        <option value="global">גלובאלי</option>
                      </select>
                      <input type="number" value={editEmpData.hourly_rate || ''} onChange={e => setEditEmpData({ ...editEmpData, hourly_rate: parseFloat(e.target.value) })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} />
                      <input type="number" value={editEmpData.global_daily_rate || ''} onChange={e => setEditEmpData({ ...editEmpData, global_daily_rate: parseFloat(e.target.value) })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} />
                      <button onClick={() => handleEditEmployee(emp.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✓</button>
                      <button onClick={() => setEditEmpId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✗</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{emp.name}</span>
                      <span style={{ fontSize: '12px', background: '#eff6ff', color: '#3b82f6', padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>
                        {deptOptions.find(d => d.value === emp.department)?.label}
                      </span>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>{emp.wage_type === 'hourly' ? 'שעתי' : 'גלובאלי'}</span>
                      <span style={{ fontSize: '13px', color: '#374151' }}>{emp.wage_type === 'hourly' ? '₪' + emp.hourly_rate : '—'}</span>
                      <span style={{ fontSize: '13px', color: '#374151' }}>{emp.wage_type === 'global' ? '₪' + emp.global_daily_rate : '—'}</span>
                      <button onClick={() => { setEditEmpId(emp.id); setEditEmpData(emp) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <Pencil size={15} color="#94a3b8" />
                      </button>
                      <button onClick={() => handleDeleteEmployee(emp.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <Trash2 size={15} color="#ef4444" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showAddEmp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: '24px', padding: '32px', width: '480px', maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>הוספת עובד חדש</h2>
              <button onClick={() => { setShowAddEmp(false); setAddForm(emptyForm) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748b" />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>שם עובד</label>
                <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} style={inpStyle} placeholder="שם מלא..." />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>מספר עובד</label>
                <input value={addForm.employee_number} onChange={e => setAddForm(f => ({ ...f, employee_number: e.target.value }))} style={inpStyle} placeholder="אופציונלי" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>מחלקה</label>
                <select value={addForm.department} onChange={e => setAddForm(f => ({ ...f, department: e.target.value }))} style={{ ...inpStyle, background: 'white' }}>
                  {deptOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>סוג שכר</label>
                <select value={addForm.wage_type} onChange={e => setAddForm(f => ({ ...f, wage_type: e.target.value as any }))} style={{ ...inpStyle, background: 'white' }}>
                  <option value="hourly">שעתי</option>
                  <option value="global">גלובאלי</option>
                </select>
              </div>
              {addForm.wage_type === 'hourly' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>תעריף שעתי (₪)</label>
                  <input type="number" value={addForm.hourly_rate} onChange={e => setAddForm(f => ({ ...f, hourly_rate: e.target.value }))} style={inpStyle} placeholder="0" />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>עלות יומית גלובאלית (₪)</label>
                  <input type="number" value={addForm.global_daily_rate} onChange={e => setAddForm(f => ({ ...f, global_daily_rate: e.target.value }))} style={inpStyle} placeholder="0" />
                </div>
              )}
              <button onClick={handleAddEmployee} disabled={!addForm.name}
                style={{ background: !addForm.name ? '#e2e8f0' : '#3b82f6', color: !addForm.name ? '#94a3b8' : 'white', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '16px', fontWeight: '700', cursor: addForm.name ? 'pointer' : 'not-allowed', marginTop: '8px' }}>
                הוסף עובד
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}