import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase, monthEnd, getWorkingDays } from '../lib/supabase'
import { parseTimeWatchPDF, type TimeWatchRow } from '../lib/parseTimeWatch'
import { Plus, Pencil, Trash2, Upload, AlertTriangle, X, Check, Save, Calendar, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAppUser } from '../lib/UserContext'

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
    const dailyGross = (emp.global_daily_rate + (emp.bonus || 0)) / workingDays
    const dailyEmployer = (emp.global_daily_rate * EMPLOYER_FACTOR + (emp.bonus || 0)) / workingDays
    return { gross: dailyGross, employerCost: dailyEmployer, total: dailyEmployer }
  }
  const totalHours = h100 + h125 + h150
  const gross = (h100 * emp.hourly_rate) + (h125 * emp.hourly_rate * 1.25) + (h150 * emp.hourly_rate * 1.5) + ((emp.bonus || 0) * totalHours)
  const employerCost = (h100 * emp.hourly_rate * EMPLOYER_FACTOR) + (h125 * emp.hourly_rate * 1.25) + (h150 * emp.hourly_rate * 1.5) + ((emp.bonus || 0) * totalHours)
  return { gross, employerCost, total: employerCost }
}

const emptyForm: AddForm = { name: '', employee_number: '', department: 'creams', wage_type: 'hourly', hourly_rate: '', global_daily_rate: '', bonus: '' }

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function Labor({ onBack }: Props) {
  const { appUser } = useAppUser()
  const isDeptManager = appUser?.role === 'factory' && !!appUser?.managed_department

  function shouldHideSalary(emp: Employee | undefined): boolean {
    if (!isDeptManager || !emp) return false
    const myDept = appUser?.managed_department
    if (myDept === 'creams' && emp.wage_type === 'global' && emp.department === 'dough') return true
    if (myDept === 'dough' && emp.wage_type === 'global' && emp.department === 'creams') return true
    return false
  }

  const [tab, setTab] = useState<'upload' | 'employees' | 'history'>('upload')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [allEmployees, setAllEmployees] = useState<Employee[]>([])
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
  const [duplicateDates, setDuplicateDates] = useState<string[]>([])
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false)
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
    const { error } = await supabase.from('labor').delete().eq('id', id)
    if (error) {
      console.error('[Labor deleteHistoryRow] error:', error)
      alert(`מחיקת רשומת לייבור נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    fetchHistory()
  }

  async function deleteHistoryDay(date: string) {
    if (!confirm(`למחוק את כל הרשומות ליום ${new Date(date + 'T12:00:00').toLocaleDateString('he-IL')}?`)) return
    const { error } = await supabase.from('labor').delete().eq('entity_type', 'factory').eq('date', date)
    if (error) {
      console.error('[Labor deleteHistoryDay] error:', error)
      alert(`מחיקת רשומות היום נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    setExpandedDate(null)
    fetchHistory()
  }

  async function saveHistoryEdit() {
    if (!editHistId) return
    const { hours_100, hours_125, hours_150 } = editHistData
    const emp = allEmployees.find(e => e.name === editHistData.employee_name)
    let employer_cost = editHistData.employer_cost
    let gross_salary = editHistData.gross_salary
    if (emp && emp.wage_type === 'hourly') {
      gross_salary = (hours_100 * emp.hourly_rate) + (hours_125 * emp.hourly_rate * 1.25) + (hours_150 * emp.hourly_rate * 1.5) + ((emp.bonus || 0) * (hours_100 + hours_125 + hours_150))
      employer_cost = (hours_100 * emp.hourly_rate * EMPLOYER_FACTOR) + (hours_125 * emp.hourly_rate * 1.25) + (hours_150 * emp.hourly_rate * 1.5) + ((emp.bonus || 0) * (hours_100 + hours_125 + hours_150))
    }
    const { error } = await supabase.from('labor').update({ hours_100, hours_125, hours_150, gross_salary, employer_cost }).eq('id', editHistId)
    if (error) {
      console.error('[Labor saveHistoryEdit] error:', error)
      alert(`עדכון רשומת הלייבור נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    setEditHistId(null)
    fetchHistory()
  }

  async function parseMultiplePDFs(files: File[]) {
    try {
      const allNewRows: ParsedRow[] = []
      const seenDates = new Set<string>()
      const normalize = (s: string) => s.replace(/[\s'"׳`']/g, '').toLowerCase()

      for (const file of files) {
        const twRows = await parseTimeWatchPDF(file)
        for (const tw of twRows) {
          if (tw.date) seenDates.add(tw.date)
          const twNorm = normalize(tw.name)
          const emp = (tw.employee_number && allEmployees.find(e => e.employee_number === tw.employee_number))
            || allEmployees.find(e => e.name.trim().toLowerCase() === tw.name.trim().toLowerCase())
            || allEmployees.find(e => normalize(e.name) === twNorm)
            || allEmployees.find(e => twNorm.includes(normalize(e.name)) || normalize(e.name).includes(twNorm))
            || undefined
          allNewRows.push({
            id: Math.random().toString(36).slice(2),
            name: emp ? emp.name : tw.name,
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
      }

      setRows(allNewRows)
      setIsMonthly(seenDates.size > 1)
      setReplaceMode(false)
      setSaved(false)

      if (seenDates.size > 0) {
        const dateArr = [...seenDates]
        const { data: existing } = await supabase
          .from('labor')
          .select('date')
          .eq('entity_type', 'factory')
          .in('date', dateArr)
        const existingDates = [...new Set((existing || []).map((r: any) => r.date))]
        if (existingDates.length > 0) {
          setDuplicateDates(existingDates)
          setShowDuplicateWarning(true)
        } else {
          setDuplicateDates([])
          setShowDuplicateWarning(false)
        }
      }
    } catch (err: any) {
      console.error('[Labor] PDF parse error:', err?.message || err, err?.stack)
      alert('שגיאה בקריאת קובץ PDF: ' + (err?.message || 'unknown'))
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    const pdfFiles = [...files].filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (pdfFiles.length > 0) {
      parseMultiplePDFs(pdfFiles)
      e.target.value = ''
      return
    }

    const file = files[0]
    if (file && file.name.toLowerCase().endsWith('.csv')) {
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
    if (duplicateDates.length > 0 && replaceMode) {
      for (const d of duplicateDates) {
        const { error: delErr } = await supabase.from('labor').delete()
          .eq('entity_type', 'factory')
          .eq('date', d)
        if (delErr) {
          console.error('[Labor handleSave delete] error:', delErr)
          alert(`ניקוי רשומות קודמות נכשל לתאריך ${d}: ${delErr.message || 'שגיאת מסד נתונים'}. ההעלאה בוטלה.`)
          setSaving(false)
          return
        }
      }
    }
    const inserts = knownRows.map(r => ({
      entity_type: 'factory',
      entity_id: r.employee!.department,
      date: r.date || date,
      employee_name: r.name,
      hours_100: r.hours_100,
      hours_125: r.hours_125,
      hours_150: r.hours_150,
      hourly_rate: r.employee!.hourly_rate,
      gross_salary: calcWage(r.employee!, r.hours_100, r.hours_125, r.hours_150, workingDays).gross,
      employer_cost: calcWage(r.employee!, r.hours_100, r.hours_125, r.hours_150, workingDays).total
    }))
    for (let i = 0; i < inserts.length; i += 100) {
      const { error } = await supabase.from('labor').insert(inserts.slice(i, i + 100))
      if (error) {
        console.error('[Labor handleSave insert] error:', error)
        alert(`שמירת חבילה ${i / 100 + 1} נכשלה: ${error.message || 'שגיאת מסד נתונים'}. חלק מהשורות אולי נשמרו — בדוק בהיסטוריה.`)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setSaved(true)
    setDuplicateDates([])
    setReplaceMode(false)
    const count = inserts.length
    const dateCount = new Set(inserts.map(r => r.date)).size
    setTimeout(() => { setRows([]); setSaved(false) }, 5000)
    setSavedInfo({ count, dateCount })
  }

  const [savedInfo, setSavedInfo] = useState<{ count: number; dateCount: number } | null>(null)

  async function handleAddEmployee() {
    if (!addForm.name) return
    const { error } = await supabase.from('employees').insert({
      name: addForm.name,
      employee_number: addForm.employee_number,
      department: addForm.department,
      wage_type: addForm.wage_type,
      hourly_rate: parseFloat(addForm.hourly_rate) || 0,
      global_daily_rate: parseFloat(addForm.global_daily_rate) || 0,
      bonus: parseFloat(addForm.bonus) || 0,
    })
    if (error) {
      console.error('[Labor handleAddEmployee] error:', error)
      alert(`הוספת עובד נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    await fetchEmployees()
    setShowAddEmp(false)
    setAddForm(emptyForm)
  }

  async function handleDeleteEmployee(id: number) {
    const { error } = await supabase.from('employees').update({ active: false }).eq('id', id)
    if (error) {
      console.error('[Labor handleDeleteEmployee] error:', error)
      alert(`השבתת העובד נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    await fetchEmployees()
  }

  async function handleEditEmployee(id: number) {
    const { error } = await supabase.from('employees').update(editEmpData).eq('id', id)
    if (error) {
      console.error('[Labor handleEditEmployee] error:', error)
      alert(`עדכון פרטי העובד נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    setEditEmpId(null)
    await fetchEmployees()
  }

  const knownRows = rows.filter(r => r.found && r.employee)
  const unknownRows = rows.filter(r => !r.found)
  const totalCost = knownRows.reduce((s, r) => s + calcWage(r.employee!, r.hours_100, r.hours_125, r.hours_150, workingDays).total, 0)

  const inpStyle: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit', textAlign: 'right' as const, width: '100%', boxSizing: 'border-box' as const }

  const tabBtn = (key: typeof tab, label: string) => (
    <button onClick={() => setTab(key)} style={{ padding: '13px 22px', background: 'none', border: 'none', borderBottom: tab === key ? '2px solid #6366f1' : '2px solid transparent', cursor: 'pointer', fontSize: 13, fontWeight: tab === key ? 700 : 500, color: tab === key ? '#6366f1' : '#64748b', transition: 'all 0.15s' }}>
      {label}
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>

      <PageHeader title="לייבור מפעל" onBack={onBack} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, padding: '0 20px', background: 'white', borderBottom: '1px solid #f1f5f9', marginBottom: 16 }}>
        {tabBtn('upload', 'העלאת קובץ')}
        {tabBtn('history', 'היסטוריה')}
        {tabBtn('employees', `עובדים (${employees.length})`)}
      </div>

      <div style={{ padding: '0 20px 28px', maxWidth: 1000, margin: '0 auto' }}>

        {/* ═══ UPLOAD TAB ═══ */}
        {tab === 'upload' && (
          <>
            {/* Upload card */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 24, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>העלאת קובץ נוכחות</h2>
                <div style={{ position: 'relative' }} className="help-popover-wrapper">
                  <button onClick={(e) => { const el = (e.currentTarget.nextElementSibling as HTMLElement); el.style.display = el.style.display === 'block' ? 'none' : 'block' }}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                    <HelpCircle size={18} color="#6366f1" />
                  </button>
                  <div style={{ display: 'none', position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 24, width: 360, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(0,0,0,0.12)', zIndex: 1000, fontSize: 13, color: '#374151', lineHeight: '1.8' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: '#0f172a' }}>איך להוריד דוח מ-TimeWatch?</div>
                    <ol style={{ margin: 0, paddingRight: 18 }}>
                      <li>היכנס ל-<strong>TimeWatch</strong> של המפעל</li>
                      <li>לחץ על <strong>"דוחות"</strong> בתפריט העליון</li>
                      <li>בחר <strong>"דוח נוכחות יומית / חודשית"</strong></li>
                      <li>בשדה <strong>סוג</strong> → בחר <strong>"תקופתי"</strong></li>
                      <li>הגדר <strong>מתאריך</strong> ו<strong>עד תאריך</strong> לטווח הרצוי</li>
                      <li>בשדה <strong>תצוגה</strong> → בחר <strong>"כל העובדים ברצף"</strong></li>
                      <li>ודא שמסומן <strong>"הצג בפורמט עשרוני"</strong> ✓</li>
                      <li>לחץ <strong>"הצג"</strong> ואז על כפתור <strong>PDF</strong> להורדה</li>
                    </ol>
                    <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}>
                      הקובץ מכיל שעות רגילות + שעות נוספות לכל עובד לכל יום.
                    </div>
                  </div>
                </div>
              </div>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#94a3b8' }}>PDF דוח נוכחות מ-TimeWatch — פרסור אוטומטי ללא שרת</p>
              <div>
                <input type="file" accept=".pdf,.csv" multiple ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
                <button onClick={() => fileRef.current?.click()} style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Upload size={16} />בחר קבצי PDF
                </button>
              </div>
            </div>

            {/* Monthly banner */}
            {isMonthly && rows.length > 0 && (() => {
              const dates = rows.filter(r => r.date).map(r => r.date).sort()
              const firstD = dates[0]; const lastD = dates[dates.length - 1]
              const uniqueEmps = new Set(rows.map(r => r.name)).size
              return (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Calendar size={18} color="#6366f1" />
                  <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 13 }}>
                    קובץ חודשי — {knownRows.length} רשומות, {uniqueEmps} עובדים
                  </span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    {firstD && new Date(firstD + 'T12:00:00').toLocaleDateString('he-IL')} – {lastD && new Date(lastD + 'T12:00:00').toLocaleDateString('he-IL')}
                  </span>
                  <label style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={replaceMode} onChange={e => setReplaceMode(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: '#6366f1', cursor: 'pointer' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: replaceMode ? '#dc2626' : '#64748b' }}>
                      מחק נתונים קיימים לחודש זה לפני ייבוא
                    </span>
                  </label>
                </div>
              )
            })()}

            {/* Unknown employees */}
            {unknownRows.length > 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <AlertTriangle size={18} color="#f59e0b" />
                  <span style={{ fontWeight: 700, color: '#92400e', fontSize: 14 }}>עובדים לא מזוהים — ניתן להקים או למחוק מהרשימה</span>
                </div>
                {unknownRows.map(row => (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderRadius: 10, padding: '10px 14px', marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: '#374151', fontSize: 13 }}>{row.name}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setShowAddEmp(true); setAddForm(f => ({ ...f, name: row.name })) }}
                        style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '5px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                        הקם עובד
                      </button>
                      <button onClick={() => deleteRow(row.id)}
                        style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Parsed rows table */}
            {rows.length > 0 && (
              <>
                <motion.div variants={fadeIn} initial="hidden" animate="visible">
                <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMonthly ? '80px 1fr 70px 70px 70px 90px 110px 36px 36px' : '1fr 90px 90px 90px 110px 130px 36px 36px', padding: '12px 24px', borderBottom: '1px solid #f1f5f9', fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>
                    {isMonthly && <span>תאריך</span>}
                    <span>עובד</span><span>100%</span><span>125%</span><span>150%</span><span>מחלקה</span><span>עלות מעביד</span><span></span><span></span>
                  </div>
                  {rows.map((row, i) => (
                    <div key={row.id} style={{ display: 'grid', gridTemplateColumns: isMonthly ? '80px 1fr 70px 70px 70px 90px 110px 36px 36px' : '1fr 90px 90px 90px 110px 130px 36px 36px', alignItems: 'center', padding: '11px 24px', borderBottom: '1px solid #f8fafc', background: 'white' }}>
                      {isMonthly && (
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          {row.date ? new Date(row.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) : '—'}
                        </span>
                      )}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {!row.found && <AlertTriangle size={13} color="#f59e0b" />}
                          <span style={{ fontWeight: 600, color: row.found ? '#374151' : '#92400e', fontSize: 13 }}>{row.name}</span>
                        </div>
                        {row.found && row.employee && !shouldHideSalary(row.employee) && (
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                            {row.employee.wage_type === 'global'
                              ? `גלובלי: ₪${Math.round(row.employee.global_daily_rate).toLocaleString()}/חודש${row.employee.bonus ? ` + בונוס ₪${Math.round(row.employee.bonus).toLocaleString()}/חודש` : ''}`
                              : `₪${row.employee.hourly_rate}/ש׳${row.employee.bonus ? ` + בונוס ₪${row.employee.bonus}/ש׳` : ''}`
                            }
                          </div>
                        )}
                      </div>

                      {row.editing ? (
                        <>
                          <input type="number" value={row.hours_100} onChange={e => updateRow(row.id, 'hours_100', e.target.value)} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 6px', fontSize: 13, width: 60 }} />
                          <input type="number" value={row.hours_125} onChange={e => updateRow(row.id, 'hours_125', e.target.value)} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 6px', fontSize: 13, width: 60 }} />
                          <input type="number" value={row.hours_150} onChange={e => updateRow(row.id, 'hours_150', e.target.value)} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 6px', fontSize: 13, width: 60 }} />
                          <span style={{ fontSize: 12, color: '#64748b' }}>{row.employee ? deptOptions.find(d => d.value === row.employee!.department)?.label : '—'}</span>
                          <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 13 }}>
                            {row.employee ? (shouldHideSalary(row.employee) ? '—' : '₪' + calcWage(row.employee, row.hours_100, row.hours_125, row.hours_150, workingDays).total.toFixed(0)) : '—'}
                          </span>
                          <button onClick={() => saveRowEdit(row.id)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }}>
                            <Check size={13} />
                          </button>
                          <button onClick={() => deleteRow(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <Trash2 size={13} color="#94a3b8" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 13, color: '#64748b' }}>{row.hours_100}</span>
                          <span style={{ fontSize: 13, color: row.hours_125 > 0 ? '#f59e0b' : '#94a3b8', fontWeight: row.hours_125 > 0 ? 600 : 400 }}>{row.hours_125 || '—'}</span>
                          <span style={{ fontSize: 13, color: row.hours_150 > 0 ? '#ef4444' : '#94a3b8', fontWeight: row.hours_150 > 0 ? 600 : 400 }}>{row.hours_150 || '—'}</span>
                          <span style={{ fontSize: 12, color: '#64748b' }}>{row.employee ? deptOptions.find(d => d.value === row.employee!.department)?.label : '—'}</span>
                          <span style={{ fontWeight: 700, color: row.found ? '#0f172a' : '#94a3b8', fontSize: 13 }}>
                            {row.found && row.employee ? (shouldHideSalary(row.employee) ? '—' : '₪' + calcWage(row.employee, row.hours_100, row.hours_125, row.hours_150, workingDays).total.toFixed(0)) : '—'}
                          </span>
                          <button onClick={() => startEdit(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <Pencil size={13} color="#94a3b8" />
                          </button>
                          <button onClick={() => deleteRow(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <Trash2 size={13} color="#94a3b8" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                </motion.div>

                {/* Duplicate dates warning */}
                {showDuplicateWarning && duplicateDates.length > 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '14px 18px', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <AlertTriangle size={16} color="#f59e0b" />
                      <span style={{ fontWeight: 700, color: '#92400e', fontSize: 13 }}>
                        נמצאו נתונים קיימים ל-{duplicateDates.length} {duplicateDates.length === 1 ? 'יום' : 'ימים'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#78350f', marginBottom: 10 }}>
                      {duplicateDates.slice(0, 5).map(d => new Date(d + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })).join(' · ')}
                      {duplicateDates.length > 5 && ` ועוד ${duplicateDates.length - 5}...`}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setReplaceMode(true); setShowDuplicateWarning(false) }}
                        style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Trash2 size={13} />מחק קיימים והחלף
                      </button>
                      <button onClick={() => { setRows([]); setShowDuplicateWarning(false); setDuplicateDates([]) }}
                        style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                        בטל העלאה
                      </button>
                    </div>
                  </div>
                )}

                {replaceMode && duplicateDates.length > 0 && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 18px', marginBottom: 12, fontSize: 12, color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={14} />
                    שים לב: הנתונים הקיימים ל-{duplicateDates.length} ימים יימחקו ויוחלפו בנתונים החדשים
                  </div>
                )}

                {saved && savedInfo && (
                  <div style={{ background: 'white', border: '1px solid #d1fae5', borderRadius: 12, padding: '20px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#065f46', marginBottom: 4 }}>
                      נשמרו {savedInfo.count} רשומות בהצלחה
                    </div>
                    <div style={{ fontSize: 13, color: '#047857' }}>
                      {savedInfo.dateCount} {savedInfo.dateCount === 1 ? 'יום' : 'ימים'} · {new Set(rows.map(r => r.name)).size || savedInfo.count} עובדים
                    </div>
                    <button onClick={() => setTab('history')} style={{ marginTop: 12, background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '7px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                      צפה בהיסטוריה
                    </button>
                  </div>
                )}

                {!showDuplicateWarning && !saved && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ background: 'white', borderRadius: 12, padding: '12px 24px', fontWeight: 700, fontSize: 16, color: '#0f172a', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      סה"כ עלות מעביד: ₪{totalCost.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      {isMonthly && <span style={{ fontSize: 12, fontWeight: 500, marginRight: 12, color: '#94a3b8' }}>{knownRows.length} רשומות</span>}
                    </div>
                    <button onClick={handleSave} disabled={saving || knownRows.length === 0}
                      style={{ background: saving || knownRows.length === 0 ? '#e2e8f0' : replaceMode ? '#dc2626' : '#6366f1', color: knownRows.length > 0 ? 'white' : '#94a3b8', border: 'none', borderRadius: 10, padding: '10px 28px', fontWeight: 700, fontSize: 15, cursor: knownRows.length > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {saving ? 'שומר...' : replaceMode ? <><Save size={16} />מחק והחלף</> : <><Save size={16} />אשר ושמור</>}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {tab === 'history' && (() => {
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
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <input type="month" value={historyMonth} onChange={e => setHistoryMonth(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 14px', fontSize: 14, fontFamily: 'inherit' }} />
                <div style={{ marginRight: 'auto', display: 'flex', gap: 16, fontSize: 13, color: '#64748b' }}>
                  <span>סה"כ: <strong style={{ color: '#0f172a' }}>₪{Math.round(totalCostAll).toLocaleString()}</strong></span>
                  <span>שעות: <strong>{totalHoursAll.toFixed(1)}</strong></span>
                  <span>ימים: <strong>{dates.length}</strong></span>
                  <span>רשומות: <strong>{historyData.length}</strong></span>
                </div>
              </div>

              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>טוען...</div>
              ) : dates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>אין נתונים לחודש זה</div>
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
                      <div key={d} style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <button onClick={() => setExpandedDate(isOpen ? null : d)}
                            style={{ flex: 1, display: 'grid', gridTemplateColumns: '80px 1fr 100px 100px 30px', alignItems: 'center', padding: '13px 20px', background: 'white', border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'right' }}>
                            <span style={{ fontWeight: 700, color: '#0f172a' }}>{dayName} {dateStr}</span>
                            <span style={{ fontSize: 12, color: '#94a3b8' }}>{dayEmps} עובדים · {dayHours.toFixed(1)} ש׳</span>
                            <span style={{ fontWeight: 700, color: '#0f172a' }}>₪{Math.round(dayCost).toLocaleString()}</span>
                            <span />
                            {isOpen ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); deleteHistoryDay(d) }}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 12px' }}
                            title="מחק יום">
                            <Trash2 size={13} color="#94a3b8" />
                          </button>
                        </div>

                        {isOpen && (
                          <div style={{ borderTop: '1px solid #f1f5f9' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px 60px 60px 90px 60px', padding: '8px 20px', fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                              <span>עובד</span><span>מחלקה</span><span>100%</span><span>125%</span><span>150%</span><span>עלות</span><span></span>
                            </div>
                            {dayRows.map((r: any, i: number) => (
                              <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px 60px 60px 90px 60px', padding: '8px 20px', borderBottom: '1px solid #f8fafc', fontSize: 13, alignItems: 'center' }}>
                                {editHistId === r.id ? (
                                  <>
                                    <span style={{ fontWeight: 600, color: '#374151' }}>{r.employee_name}</span>
                                    <span style={{ fontSize: 11, color: '#64748b' }}>{deptOptions.find(x => x.value === r.entity_id)?.label || r.entity_id}</span>
                                    <input type="number" value={editHistData.hours_100 ?? ''} onChange={e => setEditHistData({ ...editHistData, hours_100: parseFloat(e.target.value) || 0 })}
                                      style={{ border: '1px solid #6366f1', borderRadius: 4, padding: '2px 4px', fontSize: 12, width: 50 }} />
                                    <input type="number" value={editHistData.hours_125 ?? ''} onChange={e => setEditHistData({ ...editHistData, hours_125: parseFloat(e.target.value) || 0 })}
                                      style={{ border: '1px solid #6366f1', borderRadius: 4, padding: '2px 4px', fontSize: 12, width: 50 }} />
                                    <input type="number" value={editHistData.hours_150 ?? ''} onChange={e => setEditHistData({ ...editHistData, hours_150: parseFloat(e.target.value) || 0 })}
                                      style={{ border: '1px solid #6366f1', borderRadius: 4, padding: '2px 4px', fontSize: 12, width: 50 }} />
                                    <span />
                                    <div style={{ display: 'flex', gap: 4 }}>
                                      <button onClick={saveHistoryEdit} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}><Check size={12} /></button>
                                      <button onClick={() => setEditHistId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}><X size={12} /></button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <span style={{ fontWeight: 600, color: '#374151' }}>{r.employee_name}</span>
                                    <span style={{ fontSize: 11, color: '#64748b' }}>{deptOptions.find(x => x.value === r.entity_id)?.label || r.entity_id}</span>
                                    <span style={{ color: '#64748b' }}>{r.hours_100 || '—'}</span>
                                    <span style={{ color: r.hours_125 > 0 ? '#f59e0b' : '#d1d5db', fontWeight: r.hours_125 > 0 ? 600 : 400 }}>{r.hours_125 || '—'}</span>
                                    <span style={{ color: r.hours_150 > 0 ? '#ef4444' : '#d1d5db', fontWeight: r.hours_150 > 0 ? 600 : 400 }}>{r.hours_150 || '—'}</span>
                                    <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>
                                      {shouldHideSalary(allEmployees.find(e => e.name === r.employee_name)) ? '—' : `₪${Math.round(r.employer_cost || 0).toLocaleString()}`}
                                    </span>
                                    <div style={{ display: 'flex', gap: 2 }}>
                                      <button onClick={() => { setEditHistId(r.id); setEditHistData({ ...r }) }}
                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}><Pencil size={12} color="#94a3b8" /></button>
                                      <button onClick={() => deleteHistoryRow(r.id)}
                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}><Trash2 size={12} color="#94a3b8" /></button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </motion.div>
              )}
            </>
          )
        })()}

        {/* ═══ EMPLOYEES TAB ═══ */}
        {tab === 'employees' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button onClick={() => setShowAddEmp(true)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 10, padding: '9px 20px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={15} />הוסף עובד
              </button>
            </div>
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll">
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px 100px 40px 40px', padding: '12px 24px', borderBottom: '1px solid #f1f5f9', fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>
                  <span>שם</span><span>מחלקה</span><span>סוג שכר</span><span>שכר</span><span>בונוס</span><span></span><span></span>
                </div>
                {employees.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>אין עובדים — הוסף עובד ראשון</div>
                ) : employees.map((emp, i) => (
                  <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px 100px 40px 40px', alignItems: 'center', padding: '12px 24px', borderBottom: '1px solid #f8fafc' }}>
                    {editEmpId === emp.id ? (
                      <>
                        <input value={editEmpData.name || ''} onChange={e => setEditEmpData({ ...editEmpData, name: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }} />
                        <select value={editEmpData.department || ''} onChange={e => setEditEmpData({ ...editEmpData, department: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: 4, fontSize: 12 }}>
                          {deptOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                        <select value={editEmpData.wage_type || ''} onChange={e => setEditEmpData({ ...editEmpData, wage_type: e.target.value as any })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: 4, fontSize: 12 }}>
                          <option value="hourly">שעתי</option>
                          <option value="global">גלובאלי</option>
                        </select>
                        <input type="number" value={editEmpData.wage_type === 'global' ? (editEmpData.global_daily_rate || '') : (editEmpData.hourly_rate || '')} onChange={e => setEditEmpData(p => p.wage_type === 'global' ? { ...p, global_daily_rate: parseFloat(e.target.value) } : { ...p, hourly_rate: parseFloat(e.target.value) })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 13 }} placeholder={editEmpData.wage_type === 'global' ? 'חודשי' : 'שעתי'} />
                        <input type="number" value={editEmpData.bonus || ''} onChange={e => setEditEmpData({ ...editEmpData, bonus: parseFloat(e.target.value) })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 13 }} placeholder={editEmpData.wage_type === 'hourly' ? 'בונוס/ש׳' : 'בונוס/חודש'} />
                        <button onClick={() => handleEditEmployee(emp.id)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✓</button>
                        <button onClick={() => setEditEmpId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✗</button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontWeight: 600, color: '#374151', fontSize: 13 }}>{emp.name}</span>
                        <span style={{ fontSize: 11, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                          {deptOptions.find(d => d.value === emp.department)?.label}
                        </span>
                        <span style={{ fontSize: 11, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 20, fontWeight: 600, textAlign: 'center' }}>
                          {emp.wage_type === 'hourly' ? 'שעתי' : 'גלובאלי'}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                          {emp.wage_type === 'hourly'
                            ? (emp.hourly_rate ? `₪${emp.hourly_rate}/ש׳` : '—')
                            : (emp.global_daily_rate ? '₪' + Math.round(emp.global_daily_rate).toLocaleString() + '/חודש' : '—')}
                        </span>
                        <span style={{ fontSize: 12, color: emp.bonus ? '#64748b' : '#d1d5db', fontWeight: 600 }}>
                          {emp.bonus
                            ? (emp.wage_type === 'hourly' ? `₪${emp.bonus}/ש׳` : '₪' + Math.round(emp.bonus).toLocaleString() + '/חודש')
                            : '—'}
                        </span>
                        <button onClick={() => { setEditEmpId(emp.id); setEditEmpData(emp) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                          <Pencil size={14} color="#94a3b8" />
                        </button>
                        <button onClick={() => handleDeleteEmployee(emp.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                          <Trash2 size={14} color="#94a3b8" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            </motion.div>
          </>
        )}
      </div>

      {/* Add employee modal */}
      {showAddEmp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 28, width: 460, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>הוספת עובד חדש</h2>
              <button onClick={() => { setShowAddEmp(false); setAddForm(emptyForm) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <X size={18} color="#64748b" />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>שם עובד</label>
                <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} style={inpStyle} placeholder="שם מלא..." />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>מספר עובד</label>
                <input value={addForm.employee_number} onChange={e => setAddForm(f => ({ ...f, employee_number: e.target.value }))} style={inpStyle} placeholder="אופציונלי" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>מחלקה</label>
                <select value={addForm.department} onChange={e => setAddForm(f => ({ ...f, department: e.target.value }))} style={{ ...inpStyle, background: 'white' }}>
                  {deptOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>סוג שכר</label>
                <select value={addForm.wage_type} onChange={e => setAddForm(f => ({ ...f, wage_type: e.target.value as any }))} style={{ ...inpStyle, background: 'white' }}>
                  <option value="hourly">שעתי</option>
                  <option value="global">גלובאלי</option>
                </select>
              </div>
              {addForm.wage_type === 'hourly' ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>תעריף שעתי (₪)</label>
                    <input type="number" value={addForm.hourly_rate} onChange={e => setAddForm(f => ({ ...f, hourly_rate: e.target.value }))} style={inpStyle} placeholder="0" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>בונוס שעתי (₪/ש׳) <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופציונלי)</span></label>
                    <input type="number" value={addForm.bonus} onChange={e => setAddForm(f => ({ ...f, bonus: e.target.value }))} style={inpStyle} placeholder="0" />
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>סכום נוסף לשעה — לא מוכפל ב-x1.3</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>משכורת חודשית (₪)</label>
                    <input type="number" value={addForm.global_daily_rate} onChange={e => setAddForm(f => ({ ...f, global_daily_rate: e.target.value }))} style={inpStyle} placeholder="0" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>בונוס חודשי (₪) <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופציונלי)</span></label>
                    <input type="number" value={addForm.bonus} onChange={e => setAddForm(f => ({ ...f, bonus: e.target.value }))} style={inpStyle} placeholder="0" />
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>חישוב: (משכורת x 1.3) + בונוס</span>
                  </div>
                </>
              )}
              <button onClick={handleAddEmployee} disabled={!addForm.name}
                style={{ background: !addForm.name ? '#e2e8f0' : '#6366f1', color: !addForm.name ? '#94a3b8' : 'white', border: 'none', borderRadius: 10, padding: 12, fontSize: 15, fontWeight: 700, cursor: addForm.name ? 'pointer' : 'not-allowed', marginTop: 8 }}>
                הוסף עובד
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
