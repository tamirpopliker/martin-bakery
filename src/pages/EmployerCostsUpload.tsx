import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Upload, CheckCircle, AlertTriangle, FileSpreadsheet, Trash2, History, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import PageHeader from '../components/PageHeader'
import * as XLSX from 'xlsx'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { onBack: () => void; onNavigate?: (page: string) => void }

interface ParsedEmployee {
  employee_number: number; employee_name: string
  department_number: number; department_name: string
  actual_employer_cost: number; actual_hours: number; actual_days: number
  branch_id: number | null; is_headquarters: boolean; is_manager: boolean
  matched: boolean; matched_employee_id: number | null; assignment: string
}

interface UnmatchedBranchEmp { id: number; name: string; branch_id: number | null }

const DEPT_MAP: Record<number, { branch_id: number | null; is_hq: boolean; is_mgr: boolean; label: string }> = {
  1:  { branch_id: null, is_hq: true, is_mgr: true, label: 'מטה (מנהלים)' },
  2:  { branch_id: null, is_hq: false, is_mgr: false, label: 'מפעל' },
  3:  { branch_id: 1, is_hq: false, is_mgr: false, label: 'סניף אברהם אבינו' },
  4:  { branch_id: 2, is_hq: false, is_mgr: false, label: 'סניף הפועלים' },
  5:  { branch_id: null, is_hq: false, is_mgr: false, label: 'מפעל (בצקים)' },
  6:  { branch_id: null, is_hq: false, is_mgr: false, label: 'מפעל (קרמים)' },
  7:  { branch_id: null, is_hq: false, is_mgr: false, label: 'מפעל (ניקיון)' },
  8:  { branch_id: null, is_hq: false, is_mgr: false, label: 'מפעל (אריזה)' },
  11: { branch_id: 2, is_hq: false, is_mgr: true, label: 'סניף הפועלים (מנהלים)' },
  13: { branch_id: 3, is_hq: false, is_mgr: false, label: 'סניף יעקב כהן' },
}

const MONTH_NAMES = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

const S = {
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '8px 6px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '8px 6px', borderBottom: '1px solid #f1f5f9' },
  input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' as const } as React.CSSProperties,
  label: { fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 } as React.CSSProperties,
  tab: (a: boolean) => ({ padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', borderBottom: a ? '2px solid #6366f1' : '2px solid transparent', background: 'none', color: a ? '#6366f1' : '#94a3b8' } as React.CSSProperties),
}
const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString()

export default function EmployerCostsUpload({ onBack, onNavigate }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const [tab, setTab] = useState<'upload' | 'history'>('upload')
  const [step, setStep] = useState<'upload' | 'confirm_month' | 'duplicate_check' | 'preview' | 'confirm_save' | 'saving' | 'done'>('upload')
  const [employees, setEmployees] = useState<ParsedEmployee[]>([])
  const [reportMonth, setReportMonth] = useState(0)
  const [reportYear, setReportYear] = useState(0)
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState<any[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [unmatchedBranchEmps, setUnmatchedBranchEmps] = useState<UnmatchedBranchEmp[]>([])
  const [existingUpload, setExistingUpload] = useState<any>(null)
  const [parsedFileName, setParsedFileName] = useState('')

  // Restore state from sessionStorage after returning from employee creation
  useEffect(() => {
    const saved = sessionStorage.getItem('employer_costs_state')
    if (saved) {
      try {
        const state = JSON.parse(saved)
        setEmployees(state.employees || [])
        setReportMonth(state.reportMonth || 0)
        setReportYear(state.reportYear || 0)
        setParsedFileName(state.parsedFileName || '')
        setStep('preview')
        setTab('upload')
        sessionStorage.removeItem('employer_costs_state')
        // Re-fetch unmatched employees (new one may have been created)
        supabase.from('branch_employees').select('id, name, branch_id, payroll_number').eq('active', true)
          .then(({ data }) => {
            if (data) {
              const matchedIds = new Set((state.employees || []).filter((e: any) => e.matched_employee_id).map((e: any) => e.matched_employee_id))
              setUnmatchedBranchEmps(data.filter((be: any) => !be.payroll_number && !matchedIds.has(be.id)).map((be: any) => ({ id: be.id, name: be.name, branch_id: be.branch_id })))
              // Try to auto-match the newly created employee by name
              for (let i = 0; i < state.employees.length; i++) {
                const emp = state.employees[i]
                if (!emp.matched && !emp.is_headquarters && !emp.is_manager) {
                  const match = data.find((be: any) => emp.employee_name.includes(be.name) || be.name.includes(emp.employee_name))
                  if (match && !matchedIds.has(match.id)) {
                    state.employees[i] = { ...emp, matched: true, matched_employee_id: match.id, branch_id: match.branch_id, assignment: match.name }
                    matchedIds.add(match.id)
                  }
                }
              }
              setEmployees([...state.employees])
            }
          })
      } catch {}
    }
  }, [])

  // Load history
  const loadUploads = useCallback(async () => {
    const { data } = await supabase.from('employer_costs_uploads').select('*').order('uploaded_at', { ascending: false })
    setUploads(data || [])
  }, [])
  useEffect(() => { loadUploads() }, [loadUploads, step])

  async function parseFile(file: File) {
    setError(''); setParsedFileName(file.name)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

        const titleRow = String(rows[1]?.[0] || '')
        const dateMatch = titleRow.match(/(\d+)\/(\d{4})/)
        if (!dateMatch) { setError('לא נמצא חודש/שנה בכותרת הדוח'); return }
        setReportMonth(parseInt(dateMatch[1])); setReportYear(parseInt(dateMatch[2]))

        const parsed: ParsedEmployee[] = []
        let currentDeptNum = 0; let currentDeptName = ''

        for (let i = 7; i < rows.length; i++) {
          const row = rows[i]
          if (!row || row.length === 0) continue
          const first = String(row[0] || '')
          const deptMatch = first.match(/מחלקה מספר\s*(\d+)\s*:\s*(.+)/)
          if (deptMatch) { currentDeptNum = parseInt(deptMatch[1]); currentDeptName = deptMatch[2].trim(); continue }
          if (first.includes('סה"כ') || first.includes('סה״כ')) continue
          const empNum = Number(row[0])
          if (!empNum || isNaN(empNum)) continue
          const name = `${String(row[2] || '').trim()} ${String(row[1] || '').trim()}`.trim()
          const mapping = DEPT_MAP[currentDeptNum]
          parsed.push({
            employee_number: empNum, employee_name: name,
            department_number: currentDeptNum, department_name: currentDeptName,
            actual_employer_cost: Number(row[12]) || 0, actual_hours: Number(row[13]) || 0, actual_days: Number(row[16]) || 0,
            branch_id: mapping?.branch_id ?? null, is_headquarters: mapping?.is_hq ?? false, is_manager: mapping?.is_mgr ?? false,
            matched: false, matched_employee_id: null, assignment: mapping?.label || `מחלקה ${currentDeptNum}`,
          })
        }
        if (parsed.length === 0) { setError('לא נמצאו עובדים בקובץ'); return }

        // Match employees
        const { data: branchEmps } = await supabase.from('branch_employees').select('id, name, branch_id, payroll_number').eq('active', true)
        if (branchEmps) {
          for (const emp of parsed) {
            const byPayroll = branchEmps.find((be: any) => be.payroll_number === emp.employee_number)
            if (byPayroll) { emp.matched = true; emp.matched_employee_id = byPayroll.id; continue }
            const byName = branchEmps.find((be: any) => emp.employee_name.includes(be.name) || be.name.includes(emp.employee_name))
            if (byName) { emp.matched = true; emp.matched_employee_id = byName.id }
          }
          setUnmatchedBranchEmps(branchEmps.filter((be: any) => !be.payroll_number && !parsed.some(p => p.matched_employee_id === be.id)).map((be: any) => ({ id: be.id, name: be.name, branch_id: be.branch_id })))
        }

        setEmployees(parsed)
        setStep('confirm_month') // Step 1: confirm month first
      } catch (err) { setError('שגיאה בקריאת הקובץ: ' + (err instanceof Error ? err.message : String(err))) }
    }
    reader.readAsArrayBuffer(file)
  }

  async function confirmMonth() {
    // Step 2: check for duplicate
    const { data: existing } = await supabase.from('employer_costs_uploads')
      .select('id, uploaded_at, uploaded_by').eq('month', reportMonth).eq('year', reportYear).maybeSingle()
    if (existing) { setExistingUpload(existing); setStep('duplicate_check') }
    else { setStep('preview') }
  }

  async function replaceDuplicate() {
    await supabase.from('employer_costs').delete().eq('month', reportMonth).eq('year', reportYear)
    await supabase.from('employer_costs_uploads').delete().eq('month', reportMonth).eq('year', reportYear)
    setExistingUpload(null); setStep('preview')
  }

  async function saveAll() {
    // Step 4: check unmatched before save
    const remaining = employees.filter(e => !e.matched && !e.is_headquarters && !e.is_manager).length
    if (remaining > 0 && step !== 'confirm_save') { setStep('confirm_save'); return }

    setStep('saving')
    await supabase.from('employer_costs').delete().eq('month', reportMonth).eq('year', reportYear)
    const payload = employees.map(emp => ({
      employee_number: emp.employee_number, employee_name: emp.employee_name,
      month: reportMonth, year: reportYear,
      department_number: emp.department_number, department_name: emp.department_name,
      actual_employer_cost: emp.actual_employer_cost, actual_hours: emp.actual_hours, actual_days: emp.actual_days,
      branch_id: emp.branch_id, is_headquarters: emp.is_headquarters, is_manager: emp.is_manager,
      uploaded_by: appUser?.name || null,
    }))
    await supabase.from('employer_costs').insert(payload)
    for (const emp of employees) { if (emp.matched_employee_id) await supabase.from('branch_employees').update({ payroll_number: emp.employee_number }).eq('id', emp.matched_employee_id) }
    await supabase.from('employer_costs_uploads').insert({
      month: reportMonth, year: reportYear, filename: parsedFileName,
      uploaded_by: appUser?.name || null, status: 'completed',
      unmatched_count: employees.filter(e => !e.matched && !e.is_headquarters && !e.is_manager).length,
    })
    setStep('done')
  }

  async function deleteUpload(id: number, month: number, year: number) {
    if (!confirm(`למחוק דוח מעסיק ${month}/${year}?`)) return
    await supabase.from('employer_costs').delete().eq('month', month).eq('year', year)
    await supabase.from('employer_costs_uploads').delete().eq('id', id)
    loadUploads()
  }

  function createNewEmployee(empName: string) {
    // Save current state to sessionStorage
    sessionStorage.setItem('employer_costs_state', JSON.stringify({
      employees, reportMonth, reportYear, parsedFileName,
    }))
    // Navigate to employee management — onNavigate goes to Home which can route
    if (onNavigate) {
      onNavigate('user_management')
    } else {
      alert(`צור עובד חדש בשם "${empName}" בדף ניהול צוות ואז חזור לכאן`)
    }
  }

  function updateAssignment(idx: number, branchId: number | null, isHq: boolean) {
    setEmployees(prev => prev.map((e, i) => i === idx ? { ...e, branch_id: branchId, is_headquarters: isHq, matched: true, assignment: branchId ? (branches.find(b => b.id === branchId)?.name || '') : isHq ? 'מטה' : 'מפעל' } : e))
  }

  const totalCost = employees.reduce((s, e) => s + e.actual_employer_cost, 0)
  const hqCost = employees.filter(e => e.is_headquarters).reduce((s, e) => s + e.actual_employer_cost, 0)
  const branchCost = employees.filter(e => e.branch_id).reduce((s, e) => s + e.actual_employer_cost, 0)
  const factoryCost = employees.filter(e => !e.branch_id && !e.is_headquarters).reduce((s, e) => s + e.actual_employer_cost, 0)
  const unmatchedCount = employees.filter(e => !e.matched && !e.is_headquarters && !e.is_manager).length

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="דוח מעסיק" subtitle="עלויות שכר אמיתיות" onBack={onBack} />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
          <button style={S.tab(tab === 'upload')} onClick={() => { setTab('upload'); setStep('upload') }}>
            <Upload size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> העלאת דוח
          </button>
          <button style={S.tab(tab === 'history')} onClick={() => setTab('history')}>
            <History size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> היסטוריה
          </button>
        </div>

        {/* ═══ UPLOAD TAB ═══ */}
        {tab === 'upload' && step === 'upload' && (
          <div style={S.card}>
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <FileSpreadsheet size={48} color="#94a3b8" style={{ marginBottom: 16 }} />
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>העלאת דוח מעסיק</h3>
              <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
                העלה קובץ Excel מתוכנת השכר — המערכת תחלץ אוטומטית עלות מעסיק לכל עובד
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
              <button onClick={() => fileRef.current?.click()}
                style={{ ...S.btn, background: '#6366f1', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Upload size={16} /> בחר קובץ Excel
              </button>
            </div>
            {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} color="#ef4444" /><span style={{ fontSize: 13, color: '#dc2626' }}>{error}</span>
            </div>}
          </div>
        )}

        {/* Step 1: Confirm month */}
        {tab === 'upload' && step === 'confirm_month' && (
          <div style={S.card}>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1d4ed8', marginBottom: 8 }}>
                <Clock size={16} style={{ verticalAlign: -3, marginLeft: 6 }} />
                חודש מזוהה: {MONTH_NAMES[reportMonth]} {reportYear}
              </div>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>האם החודש נכון? ניתן לשנות ידנית.</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div><label style={S.label}>חודש</label>
                  <select value={reportMonth} onChange={e => setReportMonth(Number(e.target.value))} style={{ ...S.input, width: 120 }}>
                    {MONTH_NAMES.slice(1).map((n, i) => <option key={i + 1} value={i + 1}>{n}</option>)}
                  </select>
                </div>
                <div><label style={S.label}>שנה</label>
                  <input type="number" value={reportYear} onChange={e => setReportYear(Number(e.target.value))} style={{ ...S.input, width: 80 }} />
                </div>
                <button onClick={confirmMonth} style={{ ...S.btn, background: '#6366f1', color: 'white' }}>✓ אשר והמשך</button>
                <button onClick={() => setStep('upload')} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Duplicate check */}
        {tab === 'upload' && step === 'duplicate_check' && existingUpload && (
          <div style={S.card}>
            <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#a16207', marginBottom: 8 }}>
                ⚠️ קיים דוח מעסיק ל-{MONTH_NAMES[reportMonth]} {reportYear}
              </div>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
                הועלה ב-{new Date(existingUpload.uploaded_at).toLocaleDateString('he-IL')}
                {existingUpload.uploaded_by ? ` ע"י ${existingUpload.uploaded_by}` : ''}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={replaceDuplicate} style={{ ...S.btn, background: '#f59e0b', color: 'white' }}>מחק והחלף</button>
                <button onClick={() => { setStep('upload'); setExistingUpload(null) }} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {tab === 'upload' && step === 'preview' && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>תצוגה מקדימה — {MONTH_NAMES[reportMonth]} {reportYear}</h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>{employees.length} עובדים · {parsedFileName}</p>
              </div>
              <button onClick={() => setStep('upload')} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>חזרה</button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'עובדים', value: String(employees.length), bg: '#eff6ff', color: '#1d4ed8' },
                { label: 'מטה', value: fmtM(hqCost), bg: '#faf5ff', color: '#7c3aed' },
                { label: 'סניפים', value: fmtM(branchCost), bg: '#f0fdf4', color: '#16a34a' },
                { label: 'מפעל', value: fmtM(factoryCost), bg: '#fff7ed', color: '#c2410c' },
                { label: 'סה"כ', value: fmtM(totalCost), bg: '#f8fafc', color: '#0f172a' },
              ].map((kpi, i) => (
                <div key={i} style={{ background: kpi.bg, borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 90 }}>
                  <div style={{ fontSize: 11, color: kpi.color, fontWeight: 500 }}>{kpi.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
                </div>
              ))}
            </div>

            {unmatchedCount > 0 && (
              <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#a16207' }}>
                ⚠ {unmatchedCount} עובדים לא מזוהים — שייך ידנית או בחר "עובד לא פעיל"
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...S.th, width: 60 }}>מס' עובד</th>
                  <th style={S.th}>עובד</th>
                  <th style={S.th}>מחלקה</th>
                  <th style={{ ...S.th, width: 170 }}>שיוך</th>
                  <th style={{ ...S.th, width: 160 }}>זיהוי</th>
                  <th style={S.th}>עלות מעסיק</th>
                  <th style={S.th}>שעות</th>
                  <th style={S.th}>ימים</th>
                </tr></thead>
                <tbody>{employees.map((emp, i) => {
                  const needsMatch = !emp.matched && !emp.is_headquarters && !emp.is_manager
                  return (
                    <tr key={i} style={{ background: needsMatch ? '#fffbeb' : i % 2 === 0 ? 'white' : '#fafbfc' }}>
                      <td style={{ ...S.td, color: '#64748b', fontSize: 12, fontWeight: 600 }}>{emp.employee_number}</td>
                      <td style={{ ...S.td, fontWeight: 500 }}>{emp.employee_name}</td>
                      <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{emp.department_name}</td>
                      <td style={S.td}>
                        <select value={emp.is_headquarters ? -2 : (emp.branch_id ?? -1)} onChange={e => {
                          const v = Number(e.target.value)
                          if (v === -2) updateAssignment(i, null, true)
                          else if (v === -1) updateAssignment(i, null, false)
                          else updateAssignment(i, v, false)
                        }} style={{ border: `1px solid ${needsMatch ? '#fde68a' : '#e2e8f0'}`, borderRadius: 8, padding: '4px 8px', fontSize: 12, background: needsMatch ? '#fffbeb' : 'white', width: '100%', cursor: 'pointer' }}>
                          <option value={-1}>מפעל</option>
                          <option value={-2}>מטה (מנהלים)</option>
                          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </td>
                      <td style={S.td}>
                        {!needsMatch ? (
                          <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>
                            ✓ {emp.is_headquarters ? 'מטה' : emp.is_manager ? 'מנהל' : 'מזוהה'}
                          </span>
                        ) : (
                          <select value={emp.matched_employee_id ?? 0} onChange={e => {
                            const beId = Number(e.target.value)
                            if (beId === -2) {
                              // "עובד לא פעיל" — save cost without linking
                              setEmployees(prev => prev.map((em, j) => j === i ? { ...em, matched: true, matched_employee_id: null } : em))
                              return
                            }
                            if (beId === -3) {
                              // "צור עובד חדש" — save state and navigate
                              createNewEmployee(emp.employee_name)
                              return
                            }
                            if (!beId) return
                            const be = unmatchedBranchEmps.find(u => u.id === beId)
                            // Auto-set branch_id from the selected employee's branch
                            const branchId = be?.branch_id ?? emp.branch_id
                            const branchLabel = branchId ? (branches.find(b => b.id === branchId)?.name || '') : emp.assignment
                            setEmployees(prev => prev.map((em, j) => j === i ? {
                              ...em, matched: true, matched_employee_id: beId,
                              branch_id: branchId, assignment: branchLabel,
                            } : em))
                            setUnmatchedBranchEmps(prev => prev.filter(u => u.id !== beId))
                          }} style={{ border: '1px solid #fde68a', borderRadius: 8, padding: '3px 6px', fontSize: 11, background: '#fffbeb', width: '100%' }}>
                            <option value={0}>⚠️ שייך לעובד...</option>
                            <option value={-3}>➕ צור עובד חדש</option>
                            <option value={-2}>🚫 עובד לא פעיל</option>
                            {unmatchedBranchEmps.map(u => {
                              const brName = u.branch_id ? branches.find(b => b.id === u.branch_id)?.name : 'מפעל'
                              return <option key={u.id} value={u.id}>{u.name} ({brName})</option>
                            })}
                          </select>
                        )}
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmtM(emp.actual_employer_cost)}</td>
                      <td style={S.td}>{emp.actual_hours}</td>
                      <td style={S.td}>{emp.actual_days}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={saveAll} style={{ ...S.btn, background: '#6366f1', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={16} /> שמור הכל ({employees.length} עובדים)
              </button>
              <button onClick={() => setStep('upload')} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        )}

        {/* Step 4: Confirm save with unmatched */}
        {tab === 'upload' && step === 'confirm_save' && (
          <div style={S.card}>
            <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#a16207', marginBottom: 8 }}>
                ⚠️ נותרו {unmatchedCount} עובדים ללא שיוך
              </div>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
                עובדים אלו יישמרו עם עלות המעסיק ללא שיוך לעובד ספציפי במערכת.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep('preview')} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>חזור לשיבוץ</button>
                <button onClick={() => { setStep('saving'); saveAll() }} style={{ ...S.btn, background: '#f59e0b', color: 'white' }}>שמור בכל זאת</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'upload' && step === 'saving' && (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 14, color: '#64748b' }}>שומר {employees.length} רשומות...</div>
          </div>
        )}

        {tab === 'upload' && step === 'done' && (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
            <CheckCircle size={48} color="#10b981" style={{ marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>הדוח נשמר בהצלחה</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px' }}>
              {employees.length} עובדים · {MONTH_NAMES[reportMonth]} {reportYear} · {fmtM(totalCost)}
            </p>
            <button onClick={() => setStep('upload')} style={{ ...S.btn, background: '#6366f1', color: 'white' }}>העלאת דוח נוסף</button>
          </div>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {tab === 'history' && (
          <div style={S.card}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>היסטוריית דוחות מעסיק</h3>
            {uploads.length === 0 ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>אין דוחות</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={S.th}>חודש</th>
                  <th style={S.th}>קובץ</th>
                  <th style={S.th}>הועלה ע"י</th>
                  <th style={S.th}>תאריך העלאה</th>
                  <th style={S.th}>לא משויכים</th>
                  <th style={{ ...S.th, width: 50 }}></th>
                </tr></thead>
                <tbody>{uploads.map((u, i) => (
                  <tr key={u.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{MONTH_NAMES[u.month] || u.month} {u.year}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{u.filename || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{u.uploaded_by || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{new Date(u.uploaded_at).toLocaleDateString('he-IL')}</td>
                    <td style={S.td}>{u.unmatched_count > 0 ? <span style={{ color: '#f59e0b', fontWeight: 600 }}>{u.unmatched_count}</span> : <span style={{ color: '#16a34a' }}>0</span>}</td>
                    <td style={S.td}>
                      <button onClick={() => deleteUpload(u.id, u.month, u.year)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}
