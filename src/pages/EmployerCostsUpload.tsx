import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Upload, CheckCircle, AlertTriangle, FileSpreadsheet, Trash2, History, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { safeDbOperation } from '../lib/dbHelpers'
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
interface FactoryLaborEmp { name: string; department: string }

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
const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })

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
  const [factoryLaborEmps, setFactoryLaborEmps] = useState<FactoryLaborEmp[]>([])
  const [existingUpload, setExistingUpload] = useState<any>(null)
  const [parsedFileName, setParsedFileName] = useState('')
  const [newEmpModal, setNewEmpModal] = useState<{ idx: number; firstName: string; lastName: string } | null>(null)
  const [newEmpBranch, setNewEmpBranch] = useState<number>(-1)
  const [detailModal, setDetailModal] = useState<{ year: number; month: number } | null>(null)
  const [detailRows, setDetailRows] = useState<any[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Load factory employees from labor table (distinct names)
  const loadFactoryEmps = useCallback(async () => {
    const { data, error: laborErr } = await supabase.from('labor')
      .select('employee_name, entity_id').eq('entity_type', 'factory').limit(10000)
    console.log('[EmployerCosts] labor query result:', { rowCount: data?.length ?? 0, error: laborErr?.message ?? null, sample: data?.slice(0, 3) })
    const empMap = new Map<string, string>()
    for (const row of (data || [])) {
      if (row.employee_name && !empMap.has(row.employee_name)) {
        empMap.set(row.employee_name, row.entity_id || '')
      }
    }
    setFactoryLaborEmps([...empMap.entries()]
      .map(([name, dept]) => ({ name, department: dept }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he')))
  }, [])
  useEffect(() => { loadFactoryEmps() }, [loadFactoryEmps])

  // Load history
  const loadUploads = useCallback(async () => {
    const { data } = await supabase.from('employer_costs_uploads').select('*').order('uploaded_at', { ascending: false })
    setUploads(data || [])
  }, [])
  useEffect(() => { loadUploads() }, [loadUploads, step])

  // Load detail rows when a history row is clicked
  useEffect(() => {
    if (!detailModal) { setDetailRows([]); return }
    setDetailLoading(true)
    supabase.from('employer_costs')
      .select('employee_name, branch_id, department_name, is_manager, is_headquarters, actual_hours, actual_days, actual_employer_cost')
      .eq('year', detailModal.year).eq('month', detailModal.month)
      .order('actual_employer_cost', { ascending: false })
      .then(res => {
        if (res.error) console.error('[detail modal] error:', res.error.message)
        setDetailRows(res.data || [])
        setDetailLoading(false)
      })
  }, [detailModal])

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

        // Match branch employees
        const { data: branchEmps } = await supabase.from('branch_employees').select('id, name, branch_id, payroll_number').eq('active', true)
        if (branchEmps) {
          for (const emp of parsed) {
            if ([5, 6, 7, 8].includes(emp.department_number)) continue // factory rows skip branch matching
            const byPayroll = branchEmps.find((be: any) => be.payroll_number === emp.employee_number)
            if (byPayroll) { emp.matched = true; emp.matched_employee_id = byPayroll.id; continue }
            const byName = branchEmps.find((be: any) => emp.employee_name.includes(be.name) || be.name.includes(emp.employee_name))
            if (byName) { emp.matched = true; emp.matched_employee_id = byName.id }
          }
          setUnmatchedBranchEmps(branchEmps.filter((be: any) => !be.payroll_number && !parsed.some(p => p.matched_employee_id === be.id)).map((be: any) => ({ id: be.id, name: be.name, branch_id: be.branch_id })))
        }

        // Auto-match factory rows by name against already-loaded factoryLaborEmps
        const factoryNames = factoryLaborEmps.map(f => f.name)
        for (const emp of parsed) {
          if (![5, 6, 7, 8].includes(emp.department_number)) continue
          if (emp.matched) continue
          const byName = factoryNames.find(name => emp.employee_name.includes(name) || name.includes(emp.employee_name))
          if (byName) { emp.matched = true; emp.matched_employee_id = null }
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
    const delCosts = await safeDbOperation(
      () => supabase.from('employer_costs').delete().eq('month', reportMonth).eq('year', reportYear),
      'מחיקת רשומות עלות מעסיק קיימות',
    )
    if (!delCosts.ok) { setError(delCosts.error); setStep('upload'); return }
    const delUpload = await safeDbOperation(
      () => supabase.from('employer_costs_uploads').delete().eq('month', reportMonth).eq('year', reportYear),
      'מחיקת רשומת ההעלאה הקודמת',
    )
    if (!delUpload.ok) { setError(delUpload.error); setStep('upload'); return }
    setExistingUpload(null); setStep('preview')
  }

  async function saveAll() {
    // Step 4: check unmatched before save
    const remaining = employees.filter(e => !e.matched && !e.is_headquarters && !e.is_manager).length
    if (remaining > 0 && step !== 'confirm_save') { setStep('confirm_save'); return }

    setError('')
    setStep('saving')

    // Step A: delete any existing rows for this month. If this fails we must
    // NOT proceed — an INSERT afterwards would leave the table in an unknown
    // state (some rows from the old payload + some from the new).
    const delRes = await safeDbOperation(
      () => supabase.from('employer_costs').delete().eq('month', reportMonth).eq('year', reportYear),
      'ניקוי רשומות קודמות לחודש זה',
    )
    if (!delRes.ok) {
      setError(delRes.error + '. נסה שוב בעוד מספר שניות או פנה למנהל המערכת.')
      setStep('preview')
      return
    }

    // Step B: insert the new payload.
    const payload = employees.map(emp => ({
      employee_number: emp.employee_number, employee_name: emp.employee_name,
      month: reportMonth, year: reportYear,
      department_number: emp.department_number, department_name: emp.department_name,
      actual_employer_cost: emp.actual_employer_cost, actual_hours: emp.actual_hours, actual_days: emp.actual_days,
      branch_id: emp.branch_id, is_headquarters: emp.is_headquarters, is_manager: emp.is_manager,
      uploaded_by: appUser?.name || null,
    }))
    const insertRes = await safeDbOperation(
      () => supabase.from('employer_costs').insert(payload),
      'שמירת דוח עלות מעסיק',
    )
    if (!insertRes.ok) {
      // The old rows were already deleted. Record a 'failed' upload marker so
      // the history tab reflects the truth rather than a misleading "completed".
      await safeDbOperation(
        () => supabase.from('employer_costs_uploads').insert({
          month: reportMonth, year: reportYear, filename: parsedFileName,
          uploaded_by: appUser?.name || null, status: 'failed',
          unmatched_count: 0,
        }),
        'רישום ניסיון העלאה כושל',
      )
      setError(insertRes.error + '. הנתונים הישנים (אם היו) נמחקו — יש להעלות מחדש.')
      setStep('preview')
      return
    }

    // Step C: best-effort link payroll_number on branch_employees. Not fatal
    // if this fails — the P&L calculations do not depend on the link.
    const branchUpdates = employees.filter(e => e.matched_employee_id && ![2, 5, 6, 7, 8].includes(e.department_number))
    const updateResults = await Promise.all(
      branchUpdates.map(emp => safeDbOperation(
        () => supabase.from('branch_employees').update({ payroll_number: emp.employee_number }).eq('id', emp.matched_employee_id!),
        `עדכון מספר שכר לעובד ${emp.employee_name}`,
      ))
    )
    const failedUpdates = updateResults.filter(r => !r.ok).length
    if (failedUpdates > 0) {
      console.warn(`[EmployerCostsUpload] ${failedUpdates}/${branchUpdates.length} payroll_number updates failed`)
    }

    // Step D: record a completed upload only after the INSERT succeeded.
    const logRes = await safeDbOperation(
      () => supabase.from('employer_costs_uploads').insert({
        month: reportMonth, year: reportYear, filename: parsedFileName,
        uploaded_by: appUser?.name || null, status: 'completed',
        unmatched_count: employees.filter(e => !e.matched && !e.is_headquarters && !e.is_manager).length,
      }),
      'רישום בהיסטוריית העלאות',
    )
    if (!logRes.ok) {
      // The data itself saved fine; only the history log entry failed.
      // Warn but proceed to the done screen.
      console.warn('[EmployerCostsUpload] data saved but history log failed:', logRes.error)
    }
    setStep('done')
  }

  async function deleteUpload(id: number, month: number, year: number) {
    if (!confirm(`למחוק דוח מעסיק ${month}/${year}?`)) return
    const delCosts = await safeDbOperation(
      () => supabase.from('employer_costs').delete().eq('month', month).eq('year', year),
      'מחיקת רשומות עלות מעסיק',
    )
    if (!delCosts.ok) { alert(delCosts.error); return }
    const delLog = await safeDbOperation(
      () => supabase.from('employer_costs_uploads').delete().eq('id', id),
      'מחיקת רשומת ההעלאה',
    )
    if (!delLog.ok) { alert(delLog.error); return }
    loadUploads()
  }

  function openNewEmpModal(idx: number, empName: string) {
    const parts = empName.split(' ')
    const firstName = parts[0] || ''
    const lastName = parts.slice(1).join(' ') || ''
    setNewEmpModal({ idx, firstName, lastName })
    setNewEmpBranch(-1)
  }

  const [newEmpSaving, setNewEmpSaving] = useState(false)
  const [newEmpPhone, setNewEmpPhone] = useState('')
  const [newEmpEmail, setNewEmpEmail] = useState('')
  const [newEmpDept, setNewEmpDept] = useState('')
  const FACTORY_DEPTS = ['בצקים', 'קרמים', 'ניקיון', 'אריזה', 'מפעל אחר']

  async function saveNewEmployee() {
    if (!newEmpModal) return
    setNewEmpSaving(true)
    const branchId = newEmpBranch > 0 ? newEmpBranch : null
    const fullName = `${newEmpModal.firstName} ${newEmpModal.lastName}`.trim()
    const empNumber = employees[newEmpModal.idx]?.employee_number || null

    // branch_employees requires branch_id — for factory/HQ use branch 1 as placeholder
    // The actual cost assignment uses employer_costs.branch_id (null for factory)
    const dbBranchId = branchId || 1

    const insertPayload: any = {
      branch_id: dbBranchId,
      name: fullName,
      email: newEmpEmail || null,
      phone: newEmpPhone || null,
      payroll_number: empNumber,
      active: true,
    }
    if (newEmpDept) insertPayload.department = newEmpDept

    const { data: newEmp, error: insertErr } = await supabase
      .from('branch_employees').insert(insertPayload).select().single()

    if (insertErr || !newEmp) {
      console.error('Employee creation error:', insertErr)
      alert('שגיאה ביצירת עובד: ' + (insertErr?.message || ''))
      setNewEmpSaving(false)
      return
    }

    // Update the parsed employee row
    const empIdx = newEmpModal.idx
    const assignLabel = branchId ? (branches.find(b => b.id === branchId)?.name || '') : newEmpDept ? `מפעל (${newEmpDept})` : 'מפעל'
    setEmployees(prev => prev.map((em, j) => j === empIdx ? {
      ...em, matched: true, matched_employee_id: newEmp.id,
      branch_id: branchId, assignment: assignLabel,
    } : em))

    setNewEmpModal(null); setNewEmpSaving(false); setNewEmpPhone(''); setNewEmpEmail(''); setNewEmpDept('')
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
                          <select value="" onChange={e => {
                            const val = e.target.value
                            if (val === '__inactive') {
                              setEmployees(prev => prev.map((em, j) => j === i ? { ...em, matched: true, matched_employee_id: null } : em))
                              return
                            }
                            if (val === '__new') {
                              openNewEmpModal(i, emp.employee_name)
                              return
                            }
                            if (!val) return
                            if ([5, 6, 7, 8].includes(emp.department_number)) {
                              // Factory: value is the employee name from labor
                              const fe = factoryLaborEmps.find(u => u.name === val)
                              const deptLabel = fe?.department ? `מפעל (${fe.department})` : emp.assignment
                              setEmployees(prev => prev.map((em, j) => j === i ? {
                                ...em, matched: true, matched_employee_id: null,
                                branch_id: null, assignment: deptLabel,
                              } : em))
                              setFactoryLaborEmps(prev => prev.filter(u => u.name !== val))
                            } else {
                              const beId = Number(val)
                              const be = unmatchedBranchEmps.find(u => u.id === beId)
                              const branchId = be?.branch_id ?? emp.branch_id
                              const branchLabel = branchId ? (branches.find(b => b.id === branchId)?.name || '') : emp.assignment
                              setEmployees(prev => prev.map((em, j) => j === i ? {
                                ...em, matched: true, matched_employee_id: beId,
                                branch_id: branchId, assignment: branchLabel,
                              } : em))
                              setUnmatchedBranchEmps(prev => prev.filter(u => u.id !== beId))
                            }
                          }} style={{ border: '1px solid #fde68a', borderRadius: 8, padding: '3px 6px', fontSize: 11, background: '#fffbeb', width: '100%' }}>
                            <option value="">⚠️ שייך לעובד...</option>
                            <option value="__new">➕ צור עובד חדש</option>
                            <option value="__inactive">🚫 עובד לא פעיל</option>
                            {(() => { if (needsMatch) console.log('[EmployerCosts] dropdown row:', { name: emp.employee_name, dept: emp.department_number, factoryCount: factoryLaborEmps.length }); return null })()}
                            {[5, 6, 7, 8].includes(emp.department_number) ? (
                              factoryLaborEmps.map(u => (
                                <option key={u.name} value={u.name}>{u.name} ({u.department || 'מפעל'})</option>
                              ))
                            ) : (
                              unmatchedBranchEmps.map(u => {
                                const brName = u.branch_id ? branches.find(b => b.id === u.branch_id)?.name : 'מפעל'
                                return <option key={u.id} value={u.id}>{u.name} ({brName})</option>
                              })
                            )}
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
                  <tr key={u.id}
                    style={{ background: i % 2 === 0 ? 'white' : '#fafbfc', cursor: 'pointer' }}
                    onClick={() => setDetailModal({ year: u.year, month: u.month })}>
                    <td style={{ ...S.td, fontWeight: 600, color: '#6366f1' }}>{MONTH_NAMES[u.month] || u.month} {u.year}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{u.filename || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{u.uploaded_by || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{new Date(u.uploaded_at).toLocaleDateString('he-IL')}</td>
                    <td style={S.td}>{u.unmatched_count > 0 ? <span style={{ color: '#f59e0b', fontWeight: 600 }}>{u.unmatched_count}</span> : <span style={{ color: '#16a34a' }}>0</span>}</td>
                    <td style={S.td} onClick={e => e.stopPropagation()}>
                      <button onClick={() => deleteUpload(u.id, u.month, u.year)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* New employee modal */}
      {newEmpModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setNewEmpModal(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>הקמת עובד חדש</h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
              "{newEmpModal.firstName} {newEmpModal.lastName}" לא נמצא במערכת — צור עכשיו:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}><label style={S.label}>שם פרטי</label>
                  <input value={newEmpModal.firstName} onChange={e => setNewEmpModal(p => p ? { ...p, firstName: e.target.value } : p)} style={{ ...S.input, width: '100%' }} /></div>
                <div style={{ flex: 1 }}><label style={S.label}>שם משפחה</label>
                  <input value={newEmpModal.lastName} onChange={e => setNewEmpModal(p => p ? { ...p, lastName: e.target.value } : p)} style={{ ...S.input, width: '100%' }} /></div>
              </div>
              <div><label style={S.label}>סניף / מפעל</label>
                <select value={newEmpBranch} onChange={e => { setNewEmpBranch(Number(e.target.value)); if (Number(e.target.value) > 0) setNewEmpDept('') }} style={{ ...S.input, width: '100%' }}>
                  <option value={-1}>מפעל</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              {newEmpBranch <= 0 && (
                <div><label style={S.label}>מחלקה במפעל</label>
                  <select value={newEmpDept} onChange={e => setNewEmpDept(e.target.value)} style={{ ...S.input, width: '100%' }}>
                    <option value="">בחר מחלקה...</option>
                    {FACTORY_DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div><label style={S.label}>טלפון <span style={{ color: '#94a3b8' }}>(אופציונלי)</span></label>
                <input value={newEmpPhone} onChange={e => setNewEmpPhone(e.target.value)} placeholder="050-..." style={{ ...S.input, width: '100%' }} /></div>
              <div><label style={S.label}>אימייל <span style={{ color: '#94a3b8' }}>(אופציונלי)</span></label>
                <input value={newEmpEmail} onChange={e => setNewEmpEmail(e.target.value)} placeholder="email@..." style={{ ...S.input, width: '100%' }} /></div>
            </div>
            <div style={{ background: '#eff6ff', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#1d4ed8' }}>
              💡 העובד ייווצר עם מספר שכר {employees[newEmpModal.idx]?.employee_number} ויזוהה אוטומטית בהעלאות הבאות
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveNewEmployee} disabled={newEmpSaving} style={{ ...S.btn, background: newEmpSaving ? '#94a3b8' : '#6366f1', color: 'white' }}>
                {newEmpSaving ? 'שומר...' : '✓ צור עובד ושייך'}
              </button>
              <button onClick={() => setNewEmpModal(null)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* Report detail modal — clickable history rows */}
      {detailModal && (() => {
        const branchName = (id: number | null) => id == null ? 'מפעל' : (branches.find(b => b.id === id)?.name || `סניף ${id}`)
        const total = detailRows.reduce((s, r) => s + Number(r.actual_employer_cost || 0), 0)
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setDetailModal(null)}>
            <div style={{ background: 'white', borderRadius: 16, padding: 20, width: '100%', maxWidth: 900, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
                  פירוט דוח — {MONTH_NAMES[detailModal.month] || detailModal.month} {detailModal.year}
                </h3>
                <button onClick={() => setDetailModal(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
              {detailLoading ? (
                <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>טוען...</div>
              ) : detailRows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>אין שורות עבור חודש זה</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'white' }}>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ ...S.th, textAlign: 'right' }}>עובד</th>
                      <th style={S.th}>מסגרת</th>
                      <th style={S.th}>מחלקה</th>
                      <th style={S.th}>תפקיד</th>
                      <th style={S.th}>שעות</th>
                      <th style={S.th}>ימים</th>
                      <th style={S.th}>עלות מעסיק</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((r, idx) => {
                      const role = r.is_headquarters ? 'מטה' : r.is_manager ? 'מנהל/ת' : 'עובד/ת'
                      const roleColor = r.is_headquarters ? '#64748b' : r.is_manager ? '#7c3aed' : '#0f172a'
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{r.employee_name}</td>
                          <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{branchName(r.branch_id)}</td>
                          <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{r.department_name || '—'}</td>
                          <td style={{ ...S.td, fontSize: 12, fontWeight: 600, color: roleColor }}>{role}</td>
                          <td style={{ ...S.td, fontSize: 12 }}>{r.actual_hours != null ? Math.round(Number(r.actual_hours)) : '—'}</td>
                          <td style={{ ...S.td, fontSize: 12 }}>{r.actual_days != null ? Math.round(Number(r.actual_days)) : '—'}</td>
                          <td style={{ ...S.td, fontWeight: 600 }}>{fmtM(Number(r.actual_employer_cost || 0))}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ background: '#fafbfc', fontWeight: 700 }}>
                      <td colSpan={6} style={{ ...S.td, textAlign: 'right' }}>סה"כ ({detailRows.length} עובדים)</td>
                      <td style={{ ...S.td, fontSize: 14 }}>{fmtM(total)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )
      })()}
    </motion.div>
  )
}
