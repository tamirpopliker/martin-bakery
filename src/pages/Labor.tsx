import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase, monthEnd, getWorkingDays } from '../lib/supabase'
import { parseTimeWatchPDF, type TimeWatchRow } from '../lib/parseTimeWatch'
import { ArrowRight, Plus, Pencil, Trash2, Upload, AlertTriangle, X, Check, Save, Calendar, FileText, ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { LaborIcon } from '@/components/icons'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props { onBack: () => void }

interface Employee {
  id: number
  name: string
  employee_number: string
  department: string
  wage_type: 'hourly' | 'global'
  hourly_rate: number
  global_daily_rate: number
  bonus: number
  active: boolean
}

interface ParsedRow {
  id: string
  name: string
  employee_number: string
  date: string              // YYYY-MM-DD
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
  bonus: string
}

const deptOptions = [
  { value: 'creams', label: 'קרמים' },
  { value: 'dough', label: 'בצקים' },
  { value: 'packaging', label: 'אריזה' },
  { value: 'cleaning', label: 'ניקיון' },
]

const EMPLOYER_FACTOR = 1.3

function calcWage(emp: Employee, h100: number, h125: number, h150: number, workingDays = 26): { gross: number; employerCost: number; total: number } {
  if (emp.wage_type === 'global') {
    // Daily cost = monthly salary / working days in month
    const dailyGross = (emp.global_daily_rate + (emp.bonus || 0)) / workingDays
    const dailyEmployer = (emp.global_daily_rate * EMPLOYER_FACTOR + (emp.bonus || 0)) / workingDays
    return { gross: dailyGross, employerCost: dailyEmployer, total: dailyEmployer }
  }
  // שעתי:
  // שכר גולמי = (100% × שכר) + (125% × שכר × 1.25) + (150% × שכר × 1.5) + (סה"כ שעות × בונוס)
  const totalHours = h100 + h125 + h150
  const gross = (h100 * emp.hourly_rate) + (h125 * emp.hourly_rate * 1.25) + (h150 * emp.hourly_rate * 1.5) + ((emp.bonus || 0) * totalHours)
  // עלות מעסיק = (100% × שכר × 1.3) + (125% × שכר × 1.25) + (150% × שכר × 1.5) + (שעות × בונוס)
  // מכפיל 1.3 רק על שעות רגילות, שעות נוספות בערך נקוב
  const employerCost = (h100 * emp.hourly_rate * EMPLOYER_FACTOR) + (h125 * emp.hourly_rate * 1.25) + (h150 * emp.hourly_rate * 1.5) + ((emp.bonus || 0) * totalHours)
  return { gross, employerCost, total: employerCost }
}

const emptyForm: AddForm = { name: '', employee_number: '', department: 'creams', wage_type: 'hourly', hourly_rate: '', global_daily_rate: '', bonus: '' }

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function Labor({ onBack }: Props) {
  const [tab, setTab] = useState<'upload' | 'employees' | 'history'>('upload')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]) // includes inactive, for PDF matching
  // History state
  const [historyData, setHistoryData] = useState<any[]>([])
  const [historyMonth, setHistoryMonth] = useState(new Date().toISOString().slice(0, 7))
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [editHistId, setEditHistId] = useState<number | null>(null)
  const [editHistData, setEditHistData] = useState<any>({})
  const [workingDays, setWorkingDays] = useState(26)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isMonthly, setIsMonthly] = useState(false)
  const [replaceMode, setReplaceMode] = useState(false)
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>(emptyForm)
  const [editEmpId, setEditEmpId] = useState<number | null>(null)
  const [editEmpData, setEditEmpData] = useState<Partial<Employee>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  async function fetchEmployees() {
    const { data } = await supabase.from('employees').select('*').order('name')
    if (data) {
      setAllEmployees(data)
      setEmployees(data.filter(e => e.active))
    }
  }

  useEffect(() => { fetchEmployees() }, [])
  useEffect(() => {
    const month = date.slice(0, 7)
    getWorkingDays(month).then(setWorkingDays)
  }, [date])

  async function fetchHistory() {
    setHistoryLoading(true)
    const from = historyMonth + '-01'
    const toDate = new Date(parseInt(historyMonth.slice(0, 4)), parseInt(historyMonth.slice(5, 7)), 0)
    const to = historyMonth + '-' + String(toDate.getDate()).padStart(2, '0')
    const { data } = await supabase
      .from('labor')
      .select('*')
      .eq('entity_type', 'factory')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
    setHistoryData(data || [])
    setHistoryLoading(false)
  }

  useEffect(() => { if (tab === 'history') fetchHistory() }, [tab, historyMonth])

  async function deleteHistoryRow(id: number) {
    if (!confirm('למחוק רשומה זו?')) return
    await supabase.from('labor').delete().eq('id', id)
    fetchHistory()
  }

  async function deleteHistoryDay(date: string) {
    if (!confirm(`למחוק את כל הרשומות ליום ${new Date(date + 'T12:00:00').toLocaleDateString('he-IL')}?`)) return
    await supabase.from('labor').delete().eq('entity_type', 'factory').eq('date', date)
    setExpandedDate(null)
    fetchHistory()
  }

  async function saveHistoryEdit() {
    if (!editHistId) return
    const { hours_100, hours_125, hours_150 } = editHistData
    // Recalculate costs based on the employee
    const emp = allEmployees.find(e => e.name === editHistData.employee_name)
    let employer_cost = editHistData.employer_cost
    let gross_salary = editHistData.gross_salary
    if (emp && emp.wage_type === 'hourly') {
      gross_salary = (hours_100 * emp.hourly_rate) + (hours_125 * emp.hourly_rate * 1.25) + (hours_150 * emp.hourly_rate * 1.5) + ((emp.bonus || 0) * (hours_100 + hours_125 + hours_150))
      employer_cost = (hours_100 * emp.hourly_rate * EMPLOYER_FACTOR) + (hours_125 * emp.hourly_rate * 1.25) + (hours_150 * emp.hourly_rate * 1.5) + ((emp.bonus || 0) * (hours_100 + hours_125 + hours_150))
    }
    await supabase.from('labor').update({ hours_100, hours_125, hours_150, gross_salary, employer_cost }).eq('id', editHistId)
    setEditHistId(null)
    fetchHistory()
  }

  async function parsePDF(file: File) {
    try {
      const twRows = await parseTimeWatchPDF(file)
      const newRows: ParsedRow[] = []
      const seenDates = new Set<string>()

      for (const tw of twRows) {
        if (tw.date) seenDates.add(tw.date)
        // זיהוי: מספר עובד → שם מדויק → שם ללא רווחים → שם חלקי
        // Search ALL employees (including inactive) for matching
        const normalize = (s: string) => s.replace(/[\s'"׳`']/g, '').toLowerCase()
        const twNorm = normalize(tw.name)
        const emp = (tw.employee_number && allEmployees.find(e => e.employee_number === tw.employee_number))
          || allEmployees.find(e => e.name.trim().toLowerCase() === tw.name.trim().toLowerCase())
          || allEmployees.find(e => normalize(e.name) === twNorm)
          || allEmployees.find(e => twNorm.includes(normalize(e.name)) || normalize(e.name).includes(twNorm))
          || undefined
        newRows.push({
          id: Math.random().toString(36).slice(2),
          name: emp ? emp.name : tw.name, // Use DB name (with proper spacing) when matched
          employee_number: tw.employee_number || (emp?.employee_number ?? ''),
          date: tw.date,
          hours_100: tw.hours_100,
          hours_125: tw.hours_125,
          hours_150: tw.hours_150,
          employee: emp || undefined,
          found: !!emp,
          editing: false,
        })
      }

      setRows(newRows)
      setIsMonthly(seenDates.size > 1)
      setReplaceMode(false)
      setSaved(false)
    } catch (err: any) {
      console.error('[Labor] PDF parse error:', err?.message || err, err?.stack)
      alert('שגיאה בקריאת קובץ PDF: ' + (err?.message || 'unknown'))
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.name.endsWith('.pdf')) {
      parsePDF(file)
    } else {
      // CSV fallback
      const reader = new FileReader()
      reader.onload = ev => {
        const text = ev.target?.result as string
        const lines = text.split('\n').filter(l => l.trim())
        const newRows: ParsedRow[] = []
        const seenDates = new Set<string>()
        for (const line of lines) {
          const cols = line.split(',')
          const name = cols[0]?.trim().replace(/"/g, '')
          if (!name || name.includes('שם העובד') || name.includes('לתשומת') || name.includes('דוח') || name.includes('שם החברה')) continue
          const rawDate = cols[3]?.trim() || ''
          const dateMatch = rawDate.match(/^(\d{2})-(\d{2})-(\d{4})/)
          const rowDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : ''
          if (rowDate) seenDates.add(rowDate)
          const empNumber = cols[1]?.trim() || ''
          const hours_100 = parseFloat(cols[18]) || 0
          const hours_125 = parseFloat(cols[19]) || 0
          const hours_150 = parseFloat(cols[20]) || 0
          if (hours_100 === 0 && hours_125 === 0 && hours_150 === 0) continue
          const emp = (empNumber && employees.find(e => e.employee_number === empNumber))
            || employees.find(e => e.name.trim().toLowerCase() === name.toLowerCase())
            || undefined
          newRows.push({ id: Math.random().toString(36).slice(2), name, employee_number: empNumber, date: rowDate, hours_100, hours_125, hours_150, employee: emp || undefined, found: !!emp, editing: false })
        }
        setRows(newRows)
        setIsMonthly(seenDates.size > 1)
        setReplaceMode(false)
        setSaved(false)
      }
      reader.readAsText(file, 'utf-8')
    }
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
    // מצב החלפה — מחיקת נתונים קיימים לחודש
    if (isMonthly && replaceMode) {
      const firstDate = knownRows.find(r => r.date)?.date
      if (firstDate) {
        const month = firstDate.slice(0, 7) // YYYY-MM
        await supabase.from('labor').delete()
          .eq('entity_type', 'factory')
          .gte('date', month + '-01')
          .lt('date', monthEnd(month))
      }
    }
    const inserts = knownRows.map(r => ({
      entity_type: 'factory',
      entity_id: r.employee!.department,
      date: r.date || date,  // תאריך per-row, fallback ל-picker
      employee_name: r.name,
      hours_100: r.hours_100,
      hours_125: r.hours_125,
      hours_150: r.hours_150,
      hourly_rate: r.employee!.hourly_rate,
      gross_salary: calcWage(r.employee!, r.hours_100, r.hours_125, r.hours_150, workingDays).gross,
      employer_cost: calcWage(r.employee!, r.hours_100, r.hours_125, r.hours_150, workingDays).total
    }))
    // insert בקבוצות של 100 כדי לא לעבור מגבלת API
    for (let i = 0; i < inserts.length; i += 100) {
      await supabase.from('labor').insert(inserts.slice(i, i + 100))
    }
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
      bonus: parseFloat(addForm.bonus) || 0,
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
  const totalCost = knownRows.reduce((s, r) => s + calcWage(r.employee!, r.hours_100, r.hours_125, r.hours_150, workingDays).total, 0)

  const inpStyle = { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '9px 12px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', textAlign: 'right' as const, width: '100%', boxSizing: 'border-box' as const }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ width: '40px', height: '40px', background: '#818cf820', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LaborIcon size={20} color="#818cf8" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>לייבור מרוכז</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>העלאת נוכחות PDF · ניהול עובדים · עלות מעסיק ×1.3</p>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => setTab('upload')} style={{ background: tab === 'upload' ? '#818cf8' : '#f1f5f9', color: tab === 'upload' ? 'white' : '#64748b', border: 'none', borderRadius: '10px', padding: '8px 20px', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
            העלאת קובץ
          </button>
          <button onClick={() => setTab('history')} style={{ background: tab === 'history' ? '#818cf8' : '#f1f5f9', color: tab === 'history' ? 'white' : '#64748b', border: 'none', borderRadius: '10px', padding: '8px 20px', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
            היסטוריה
          </button>
          <button onClick={() => setTab('employees')} style={{ background: tab === 'employees' ? '#818cf8' : '#f1f5f9', color: tab === 'employees' ? 'white' : '#64748b', border: 'none', borderRadius: '10px', padding: '8px 20px', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
            עובדים ({employees.length})
          </button>
        </div>
      </div>

      <div className="page-container" style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto' }}>

        {tab === 'upload' && (
          <>
            <Card className="shadow-sm" style={{ marginBottom: '24px' }}>
              <CardContent className="p-6">
                <h2 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: '700', color: '#374151' }}>העלאת קובץ נוכחות</h2>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#94a3b8' }}>PDF דוח נוכחות מ-TimeWatch — פרסור אוטומטי ללא שרת</p>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  {!isMonthly && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>תאריך</label>
                      <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit' }} />
                    </div>
                  )}
                  <div>
                    <input type="file" accept=".pdf,.csv" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
                    <button onClick={() => fileRef.current?.click()} style={{ background: '#818cf8', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Upload size={18} />בחר קובץ PDF
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* באנר קובץ חודשי */}
            {isMonthly && rows.length > 0 && (() => {
              const dates = rows.filter(r => r.date).map(r => r.date).sort()
              const firstD = dates[0]; const lastD = dates[dates.length - 1]
              const uniqueEmps = new Set(rows.map(r => r.name)).size
              return (
                <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: '16px', padding: '16px 24px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <Calendar size={20} color="#818cf8" />
                  <span style={{ fontWeight: '700', color: '#1e40af', fontSize: '14px' }}>
                    קובץ חודשי — {knownRows.length} רשומות, {uniqueEmps} עובדים
                  </span>
                  <span style={{ fontSize: '13px', color: '#818cf8' }}>
                    {firstD && new Date(firstD + 'T12:00:00').toLocaleDateString('he-IL')} – {lastD && new Date(lastD + 'T12:00:00').toLocaleDateString('he-IL')}
                  </span>
                  <label style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={replaceMode} onChange={e => setReplaceMode(e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: '#fb7185', cursor: 'pointer' }} />
                    <span style={{ fontSize: '13px', fontWeight: '600', color: replaceMode ? '#dc2626' : '#64748b' }}>
                      מחק נתונים קיימים לחודש זה לפני ייבוא
                    </span>
                  </label>
                </div>
              )
            })()}

            {unknownRows.length > 0 && (
              <div style={{ background: '#fef3c7', border: '1.5px solid #fde68a', borderRadius: '16px', padding: '20px 24px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <AlertTriangle size={20} color="#fbbf24" />
                  <span style={{ fontWeight: '700', color: '#92400e', fontSize: '15px' }}>עובדים לא מזוהים — ניתן להקים או למחוק מהרשימה</span>
                </div>
                {unknownRows.map(row => (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderRadius: '10px', padding: '12px 16px', marginBottom: '8px' }}>
                    <span style={{ fontWeight: '600', color: '#374151' }}>{row.name}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { setShowAddEmp(true); setAddForm(f => ({ ...f, name: row.name })) }}
                        style={{ background: '#fbbf24', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 16px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                        הקם עובד
                      </button>
                      <button onClick={() => deleteRow(row.id)}
                        style={{ background: '#fee2e2', color: '#fb7185', border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rows.length > 0 && (
              <>
                <motion.div variants={fadeIn} initial="hidden" animate="visible">
                <Card className="shadow-sm" style={{ overflow: 'hidden', marginBottom: '20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMonthly ? '80px 1fr 70px 70px 70px 90px 110px 36px 36px' : '1fr 90px 90px 90px 110px 130px 36px 36px', padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                    {isMonthly && <span>תאריך</span>}
                    <span>עובד</span><span>100%</span><span>125%</span><span>150%</span><span>מחלקה</span><span>עלות מעביד</span><span></span><span></span>
                  </div>
                  {rows.map((row, i) => (
                    <div key={row.id} style={{ display: 'grid', gridTemplateColumns: isMonthly ? '80px 1fr 70px 70px 70px 90px 110px 36px 36px' : '1fr 90px 90px 90px 110px 130px 36px 36px', alignItems: 'center', padding: '12px 24px', borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none', background: !row.found ? '#fef9f0' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                      {isMonthly && (
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          {row.date ? new Date(row.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) : '—'}
                        </span>
                      )}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {!row.found && <AlertTriangle size={14} color="#fbbf24" />}
                          <span style={{ fontWeight: '600', color: row.found ? '#374151' : '#92400e', fontSize: '14px' }}>{row.name}</span>
                        </div>
                        {row.found && row.employee && (
                          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                            {row.employee.wage_type === 'global'
                              ? `גלובלי: ₪${Math.round(row.employee.global_daily_rate).toLocaleString()}/חודש${row.employee.bonus ? ` + בונוס ₪${Math.round(row.employee.bonus).toLocaleString()}/חודש` : ''}`
                              : `₪${row.employee.hourly_rate}/ש׳${row.employee.bonus ? ` + בונוס ₪${row.employee.bonus}/ש׳` : ''}`
                            }
                          </div>
                        )}
                      </div>

                      {row.editing ? (
                        <>
                          <input type="number" value={row.hours_100} onChange={e => updateRow(row.id, 'hours_100', e.target.value)} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 6px', fontSize: '13px', width: '60px' }} />
                          <input type="number" value={row.hours_125} onChange={e => updateRow(row.id, 'hours_125', e.target.value)} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 6px', fontSize: '13px', width: '60px' }} />
                          <input type="number" value={row.hours_150} onChange={e => updateRow(row.id, 'hours_150', e.target.value)} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 6px', fontSize: '13px', width: '60px' }} />
                          <span style={{ fontSize: '12px', color: '#64748b' }}>{row.employee ? deptOptions.find(d => d.value === row.employee!.department)?.label : '—'}</span>
                          <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>
                            {row.employee ? '₪' + calcWage(row.employee, row.hours_100, row.hours_125, row.hours_150, workingDays).total.toFixed(0) : '—'}
                          </span>
                          <button onClick={() => saveRowEdit(row.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 6px', cursor: 'pointer' }}>
                            <Check size={14} />
                          </button>
                          <button onClick={() => deleteRow(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Trash2 size={14} color="#fb7185" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: '13px', color: '#64748b' }}>{row.hours_100}</span>
                          <span style={{ fontSize: '13px', color: row.hours_125 > 0 ? '#fbbf24' : '#64748b', fontWeight: row.hours_125 > 0 ? '600' : '400' }}>{row.hours_125 || '—'}</span>
                          <span style={{ fontSize: '13px', color: row.hours_150 > 0 ? '#fb7185' : '#64748b', fontWeight: row.hours_150 > 0 ? '600' : '400' }}>{row.hours_150 || '—'}</span>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>{row.employee ? deptOptions.find(d => d.value === row.employee!.department)?.label : '—'}</span>
                          <span style={{ fontWeight: '700', color: row.found ? '#0f172a' : '#94a3b8', fontSize: '14px' }}>
                            {row.found && row.employee ? '₪' + calcWage(row.employee, row.hours_100, row.hours_125, row.hours_150, workingDays).total.toFixed(0) : '—'}
                          </span>
                          <button onClick={() => startEdit(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Pencil size={14} color="#94a3b8" />
                          </button>
                          <button onClick={() => deleteRow(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Trash2 size={14} color="#fb7185" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </Card>
                </motion.div>

                {isMonthly && replaceMode && (
                  <div style={{ background: '#fff1f2', border: '1.5px solid #fecdd3', borderRadius: '12px', padding: '12px 20px', marginBottom: '12px', fontSize: '13px', color: '#dc2626', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={16} />
                    שים לב: כל נתוני הלייבור הקיימים לחודש זה יימחקו ויוחלפו בנתונים החדשים
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ background: '#0f172a', color: 'white', borderRadius: '12px', padding: '12px 24px', fontWeight: '800', fontSize: '18px' }}>
                    סה"כ עלות מעביד: ₪{totalCost.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    {isMonthly && <span style={{ fontSize: '13px', fontWeight: '500', marginRight: '12px', opacity: 0.7 }}>{knownRows.length} רשומות</span>}
                  </div>
                  <button onClick={handleSave} disabled={saving || saved || knownRows.length === 0}
                    style={{ background: saved ? '#34d399' : saving || knownRows.length === 0 ? '#e2e8f0' : replaceMode ? '#dc2626' : '#818cf8', color: saved || knownRows.length > 0 ? 'white' : '#94a3b8', border: 'none', borderRadius: '12px', padding: '12px 32px', fontWeight: '700', fontSize: '16px', cursor: knownRows.length > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {saved ? <><Check size={18} />נשמר!</> : saving ? 'שומר...' : replaceMode ? <><Save size={18} />מחק והחלף</> : <><Save size={18} />אשר ושמור</>}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {tab === 'history' && (() => {
          // Group history by date
          const byDate = new Map<string, typeof historyData>()
          for (const row of historyData) {
            const d = row.date
            if (!byDate.has(d)) byDate.set(d, [])
            byDate.get(d)!.push(row)
          }
          const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a))
          const totalCostAll = historyData.reduce((s: number, r: any) => s + (r.employer_cost || 0), 0)
          const totalHoursAll = historyData.reduce((s: number, r: any) => s + (r.hours_100 || 0) + (r.hours_125 || 0) + (r.hours_150 || 0), 0)

          return (
            <>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
                <input type="month" value={historyMonth} onChange={e => setHistoryMonth(e.target.value)}
                  style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', fontFamily: 'inherit' }} />
                <div style={{ marginRight: 'auto', display: 'flex', gap: '16px', fontSize: '13px', color: '#64748b' }}>
                  <span>סה"כ: <strong style={{ color: '#818cf8' }}>₪{Math.round(totalCostAll).toLocaleString()}</strong></span>
                  <span>שעות: <strong>{totalHoursAll.toFixed(1)}</strong></span>
                  <span>ימים: <strong>{dates.length}</strong></span>
                  <span>רשומות: <strong>{historyData.length}</strong></span>
                </div>
              </div>

              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>טוען...</div>
              ) : dates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>אין נתונים לחודש זה</div>
              ) : (
                <motion.div variants={fadeIn} initial="hidden" animate="visible">
                  {dates.map(d => {
                    const dayRows = byDate.get(d)!
                    const dayCost = dayRows.reduce((s: number, r: any) => s + (r.employer_cost || 0), 0)
                    const dayHours = dayRows.reduce((s: number, r: any) => s + (r.hours_100 || 0) + (r.hours_125 || 0) + (r.hours_150 || 0), 0)
                    const dayEmps = new Set(dayRows.map((r: any) => r.employee_name)).size
                    const isOpen = expandedDate === d
                    const dateObj = new Date(d + 'T12:00:00')
                    const dayName = dateObj.toLocaleDateString('he-IL', { weekday: 'short' })
                    const dateStr = dateObj.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })

                    return (
                      <Card key={d} className="shadow-sm" style={{ marginBottom: '8px', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <button onClick={() => setExpandedDate(isOpen ? null : d)}
                            style={{ flex: 1, display: 'grid', gridTemplateColumns: '80px 1fr 100px 100px 30px', alignItems: 'center', padding: '14px 20px', background: 'white', border: 'none', cursor: 'pointer', fontSize: '13px', textAlign: 'right' }}>
                            <span style={{ fontWeight: '700', color: '#0f172a' }}>{dayName} {dateStr}</span>
                            <span style={{ fontSize: '12px', color: '#94a3b8' }}>{dayEmps} עובדים · {dayHours.toFixed(1)} ש׳</span>
                            <span style={{ fontWeight: '700', color: '#818cf8' }}>₪{Math.round(dayCost).toLocaleString()}</span>
                            <span />
                            {isOpen ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); deleteHistoryDay(d) }}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 12px' }}
                            title="מחק יום">
                            <Trash2 size={14} color="#fb7185" />
                          </button>
                        </div>

                        {isOpen && (
                          <div style={{ borderTop: '1px solid #e2e8f0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px 60px 60px 90px 60px', padding: '8px 20px', background: '#f8fafc', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
                              <span>עובד</span><span>מחלקה</span><span>100%</span><span>125%</span><span>150%</span><span>עלות</span><span></span>
                            </div>
                            {dayRows.map((r: any, i: number) => (
                              <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px 60px 60px 90px 60px', padding: '8px 20px', borderBottom: i < dayRows.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: '13px', alignItems: 'center' }}>
                                {editHistId === r.id ? (
                                  <>
                                    <span style={{ fontWeight: '600', color: '#374151' }}>{r.employee_name}</span>
                                    <span style={{ fontSize: '11px', color: '#818cf8' }}>{deptOptions.find(x => x.value === r.entity_id)?.label || r.entity_id}</span>
                                    <input type="number" value={editHistData.hours_100 ?? ''} onChange={e => setEditHistData({ ...editHistData, hours_100: parseFloat(e.target.value) || 0 })}
                                      style={{ border: '1px solid #818cf8', borderRadius: '4px', padding: '2px 4px', fontSize: '12px', width: '50px' }} />
                                    <input type="number" value={editHistData.hours_125 ?? ''} onChange={e => setEditHistData({ ...editHistData, hours_125: parseFloat(e.target.value) || 0 })}
                                      style={{ border: '1px solid #818cf8', borderRadius: '4px', padding: '2px 4px', fontSize: '12px', width: '50px' }} />
                                    <input type="number" value={editHistData.hours_150 ?? ''} onChange={e => setEditHistData({ ...editHistData, hours_150: parseFloat(e.target.value) || 0 })}
                                      style={{ border: '1px solid #818cf8', borderRadius: '4px', padding: '2px 4px', fontSize: '12px', width: '50px' }} />
                                    <span />
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button onClick={saveHistoryEdit} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}><Check size={12} /></button>
                                      <button onClick={() => setEditHistId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}><X size={12} /></button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <span style={{ fontWeight: '600', color: '#374151' }}>{r.employee_name}</span>
                                    <span style={{ fontSize: '11px', color: '#818cf8' }}>{deptOptions.find(x => x.value === r.entity_id)?.label || r.entity_id}</span>
                                    <span style={{ color: '#64748b' }}>{r.hours_100 || '—'}</span>
                                    <span style={{ color: r.hours_125 > 0 ? '#f59e0b' : '#d1d5db', fontWeight: r.hours_125 > 0 ? '600' : '400' }}>{r.hours_125 || '—'}</span>
                                    <span style={{ color: r.hours_150 > 0 ? '#fb7185' : '#d1d5db', fontWeight: r.hours_150 > 0 ? '600' : '400' }}>{r.hours_150 || '—'}</span>
                                    <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '12px' }}>₪{Math.round(r.employer_cost || 0).toLocaleString()}</span>
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                      <button onClick={() => { setEditHistId(r.id); setEditHistData({ ...r }) }}
                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px' }}><Pencil size={12} color="#94a3b8" /></button>
                                      <button onClick={() => deleteHistoryRow(r.id)}
                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px' }}><Trash2 size={12} color="#fb7185" /></button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                    )
                  })}
                </motion.div>
              )}
            </>
          )
        })()}

        {tab === 'employees' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button onClick={() => setShowAddEmp(true)} style={{ background: '#818cf8', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={16} />הוסף עובד
              </button>
            </div>
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll"><Card className="shadow-sm" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px 100px 40px 40px', padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                <span>שם</span><span>מחלקה</span><span>סוג שכר</span><span>שכר</span><span>בונוס</span><span></span><span></span>
              </div>
              {employees.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין עובדים — הוסף עובד ראשון</div>
              ) : employees.map((emp, i) => (
                <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px 100px 40px 40px', alignItems: 'center', padding: '13px 24px', borderBottom: i < employees.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editEmpId === emp.id ? (
                    <>
                      <input value={editEmpData.name || ''} onChange={e => setEditEmpData({ ...editEmpData, name: e.target.value })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', textAlign: 'right' }} />
                      <select value={editEmpData.department || ''} onChange={e => setEditEmpData({ ...editEmpData, department: e.target.value })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px', fontSize: '12px' }}>
                        {deptOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                      <select value={editEmpData.wage_type || ''} onChange={e => setEditEmpData({ ...editEmpData, wage_type: e.target.value as any })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px', fontSize: '12px' }}>
                        <option value="hourly">שעתי</option>
                        <option value="global">גלובאלי</option>
                      </select>
                      <input type="number" value={editEmpData.wage_type === 'global' ? (editEmpData.global_daily_rate || '') : (editEmpData.hourly_rate || '')} onChange={e => setEditEmpData(p => p.wage_type === 'global' ? { ...p, global_daily_rate: parseFloat(e.target.value) } : { ...p, hourly_rate: parseFloat(e.target.value) })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} placeholder={editEmpData.wage_type === 'global' ? 'חודשי' : 'שעתי'} />
                      <input type="number" value={editEmpData.bonus || ''} onChange={e => setEditEmpData({ ...editEmpData, bonus: parseFloat(e.target.value) })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} placeholder={editEmpData.wage_type === 'hourly' ? 'בונוס/ש׳' : 'בונוס/חודש'} />
                      <button onClick={() => handleEditEmployee(emp.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✓</button>
                      <button onClick={() => setEditEmpId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✗</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{emp.name}</span>
                      <span style={{ fontSize: '12px', background: '#eff6ff', color: '#818cf8', padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>
                        {deptOptions.find(d => d.value === emp.department)?.label}
                      </span>
                      <span style={{ fontSize: '11px', background: emp.wage_type === 'hourly' ? '#dbeafe' : '#d1fae5', color: emp.wage_type === 'hourly' ? '#1d4ed8' : '#065f46', padding: '2px 8px', borderRadius: '20px', fontWeight: '600', textAlign: 'center' }}>
                        {emp.wage_type === 'hourly' ? 'שעתי' : 'גלובאלי'}
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
                        {emp.wage_type === 'hourly'
                          ? (emp.hourly_rate ? `₪${emp.hourly_rate}/ש׳` : '—')
                          : (emp.global_daily_rate ? '₪' + Math.round(emp.global_daily_rate).toLocaleString() + '/חודש' : '—')}
                      </span>
                      <span style={{ fontSize: '12px', color: emp.bonus ? '#fbbf24' : '#d1d5db', fontWeight: '600' }}>
                        {emp.bonus
                          ? (emp.wage_type === 'hourly' ? `₪${emp.bonus}/ש׳` : '₪' + Math.round(emp.bonus).toLocaleString() + '/חודש')
                          : '—'}
                      </span>
                      <button onClick={() => { setEditEmpId(emp.id); setEditEmpData(emp) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <Pencil size={15} color="#94a3b8" />
                      </button>
                      <button onClick={() => handleDeleteEmployee(emp.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <Trash2 size={15} color="#fb7185" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </Card></div>
            </motion.div>
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
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>תעריף שעתי (₪)</label>
                    <input type="number" value={addForm.hourly_rate} onChange={e => setAddForm(f => ({ ...f, hourly_rate: e.target.value }))} style={inpStyle} placeholder="0" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>בונוס שעתי (₪/ש׳) <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופציונלי)</span></label>
                    <input type="number" value={addForm.bonus} onChange={e => setAddForm(f => ({ ...f, bonus: e.target.value }))} style={inpStyle} placeholder="0" />
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>סכום נוסף לשעה — לא מוכפל ב-×1.3</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>משכורת חודשית (₪)</label>
                    <input type="number" value={addForm.global_daily_rate} onChange={e => setAddForm(f => ({ ...f, global_daily_rate: e.target.value }))} style={inpStyle} placeholder="0" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>בונוס חודשי (₪) <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופציונלי)</span></label>
                    <input type="number" value={addForm.bonus} onChange={e => setAddForm(f => ({ ...f, bonus: e.target.value }))} style={inpStyle} placeholder="0" />
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>חישוב: (משכורת × 1.3) + בונוס</span>
                  </div>
                </>
              )}
              <button onClick={handleAddEmployee} disabled={!addForm.name}
                style={{ background: !addForm.name ? '#e2e8f0' : '#818cf8', color: !addForm.name ? '#94a3b8' : 'white', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '16px', fontWeight: '700', cursor: addForm.name ? 'pointer' : 'not-allowed', marginTop: '8px' }}>
                הוסף עובד
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
