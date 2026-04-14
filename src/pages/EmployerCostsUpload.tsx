import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Upload, CheckCircle, AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import PageHeader from '../components/PageHeader'
import * as XLSX from 'xlsx'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { onBack: () => void }

interface ParsedEmployee {
  employee_number: number; employee_name: string
  department_number: number; department_name: string
  actual_employer_cost: number; actual_hours: number; actual_days: number
  branch_id: number | null; is_headquarters: boolean; is_manager: boolean
  matched: boolean; matched_employee_id: number | null; assignment: string
}

interface UnmatchedBranchEmp { id: number; name: string; branch_id: number | null }

// Department → branch mapping
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

const S = {
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '8px 6px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '8px 6px', borderBottom: '1px solid #f1f5f9' },
}
const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString()

export default function EmployerCostsUpload({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const [step, setStep] = useState<'upload' | 'preview' | 'saving' | 'done'>('upload')
  const [employees, setEmployees] = useState<ParsedEmployee[]>([])
  const [reportMonth, setReportMonth] = useState(0)
  const [reportYear, setReportYear] = useState(0)
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState<any[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [unmatchedBranchEmps, setUnmatchedBranchEmps] = useState<UnmatchedBranchEmp[]>([])

  // Load past uploads
  useEffect(() => {
    supabase.from('employer_costs_uploads').select('*').order('uploaded_at', { ascending: false }).limit(10)
      .then(({ data }) => setUploads(data || []))
  }, [step])

  async function parseFile(file: File) {
    setError('')
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

        // Extract month/year from row 1: "דוח מעסיק לחודש 3/2026"
        const titleRow = String(rows[1]?.[0] || '')
        const dateMatch = titleRow.match(/(\d+)\/(\d{4})/)
        if (!dateMatch) { setError('לא נמצא חודש/שנה בכותרת הדוח'); return }
        const month = parseInt(dateMatch[1])
        const year = parseInt(dateMatch[2])
        setReportMonth(month); setReportYear(year)

        // Parse employees
        const parsed: ParsedEmployee[] = []
        let currentDeptNum = 0; let currentDeptName = ''

        for (let i = 7; i < rows.length; i++) {
          const row = rows[i]
          if (!row || row.length === 0) continue
          const first = String(row[0] || '')

          // Department header
          const deptMatch = first.match(/מחלקה מספר\s*(\d+)\s*:\s*(.+)/)
          if (deptMatch) {
            currentDeptNum = parseInt(deptMatch[1])
            currentDeptName = deptMatch[2].trim()
            continue
          }

          // Skip totals
          if (first.includes('סה"כ') || first.includes('סה״כ')) continue

          // Employee row: col 0 = number, 1 = last name, 2 = first name
          const empNum = Number(row[0])
          if (!empNum || isNaN(empNum)) continue
          const lastName = String(row[1] || '').trim()
          const firstName = String(row[2] || '').trim()
          const name = `${firstName} ${lastName}`.trim()
          const cost = Number(row[12]) || 0
          const hours = Number(row[13]) || 0
          const days = Number(row[16]) || 0

          const mapping = DEPT_MAP[currentDeptNum]
          parsed.push({
            employee_number: empNum, employee_name: name,
            department_number: currentDeptNum, department_name: currentDeptName,
            actual_employer_cost: cost, actual_hours: hours, actual_days: days,
            branch_id: mapping?.branch_id ?? null,
            is_headquarters: mapping?.is_hq ?? false,
            is_manager: mapping?.is_mgr ?? false,
            matched: false, matched_employee_id: null,
            assignment: mapping?.label || `מחלקה ${currentDeptNum}`,
          })
        }

        if (parsed.length === 0) { setError('לא נמצאו עובדים בקובץ'); return }

        // Match with branch_employees by payroll_number
        const { data: branchEmps } = await supabase.from('branch_employees').select('id, name, branch_id, payroll_number').eq('active', true)
        const matchedPayrollNums = new Set<number>()

        if (branchEmps) {
          for (const emp of parsed) {
            // First try exact payroll_number match
            const byPayroll = branchEmps.find((be: any) => be.payroll_number === emp.employee_number)
            if (byPayroll) {
              emp.matched = true
              emp.matched_employee_id = byPayroll.id
              matchedPayrollNums.add(emp.employee_number)
              continue
            }
            // Try name match
            const byName = branchEmps.find((be: any) =>
              emp.employee_name.includes(be.name) || be.name.includes(emp.employee_name)
            )
            if (byName) {
              emp.matched = true
              emp.matched_employee_id = byName.id
              matchedPayrollNums.add(emp.employee_number)
            }
          }

          // Build list of branch employees without payroll_number for manual assignment
          const unmatched = branchEmps.filter((be: any) => !be.payroll_number && !parsed.some(p => p.matched_employee_id === be.id))
          setUnmatchedBranchEmps(unmatched.map((be: any) => ({ id: be.id, name: be.name, branch_id: be.branch_id })))
        }

        setEmployees(parsed)
        setStep('preview')
      } catch (err) {
        setError('שגיאה בקריאת הקובץ: ' + (err instanceof Error ? err.message : String(err)))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function saveAll() {
    setStep('saving')
    // Delete existing data for this month/year
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

    // Save payroll_number permanently for matched employees
    for (const emp of employees) {
      if (emp.matched_employee_id) {
        await supabase.from('branch_employees').update({ payroll_number: emp.employee_number }).eq('id', emp.matched_employee_id)
      }
    }

    await supabase.from('employer_costs_uploads').insert({
      month: reportMonth, year: reportYear,
      filename: 'דוח מעסיק', uploaded_by: appUser?.name || null,
      status: 'completed', unmatched_count: employees.filter(e => !e.matched).length,
    })

    setStep('done')
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

        {step === 'upload' && (
          <div style={S.card}>
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <FileSpreadsheet size={48} color="#94a3b8" style={{ marginBottom: 16 }} />
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>העלאת דוח מעסיק</h3>
              <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
                העלה קובץ Excel מתוכנת השכר — המערכת תחלץ אוטומטית עלות מעסיק לכל עובד ותשייך לסניף/מפעל
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

            {/* Past uploads */}
            {uploads.length > 0 && (
              <div style={{ marginTop: 24, borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>דוחות שהועלו</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {uploads.map(u => (
                    <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fafbfc', borderRadius: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{u.month}/{u.year}</span>
                      <span style={{ fontSize: 12, color: '#16a34a' }}>✓ {u.status}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(u.uploaded_at).toLocaleDateString('he-IL')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'preview' && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>תצוגה מקדימה — {reportMonth}/{reportYear}</h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>{employees.length} עובדים</p>
              </div>
              <button onClick={() => setStep('upload')} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>חזרה</button>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ background: '#eff6ff', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 500 }}>סה"כ עובדים</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#1d4ed8' }}>{employees.length}</div>
              </div>
              <div style={{ background: '#faf5ff', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 500 }}>עלות מטה</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#7c3aed' }}>{fmtM(hqCost)}</div>
              </div>
              <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }}>עלות סניפים</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a' }}>{fmtM(branchCost)}</div>
              </div>
              <div style={{ background: '#fff7ed', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 11, color: '#c2410c', fontWeight: 500 }}>עלות מפעל</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#c2410c' }}>{fmtM(factoryCost)}</div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 11, color: '#0f172a', fontWeight: 500 }}>סה"כ</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{fmtM(totalCost)}</div>
              </div>
            </div>

            {unmatchedCount > 0 && (
              <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#a16207' }}>
                ⚠ {unmatchedCount} עובדים לא מזוהים — שייך ידנית מה-dropdown
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
                <tbody>{employees.map((emp, i) => (
                  <tr key={i} style={{ background: !emp.matched && !emp.is_headquarters && !emp.is_manager ? '#fffbeb' : i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={{ ...S.td, color: '#64748b', fontSize: 12, fontWeight: 600 }}>{emp.employee_number}</td>
                    <td style={{ ...S.td, fontWeight: 500 }}>{emp.employee_name}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{emp.department_name}</td>
                    <td style={S.td}>
                      <select value={emp.is_headquarters ? -2 : (emp.branch_id ?? -1)} onChange={e => {
                        const v = Number(e.target.value)
                        if (v === -2) updateAssignment(i, null, true)
                        else if (v === -1) updateAssignment(i, null, false)
                        else updateAssignment(i, v, false)
                      }} style={{ border: `1px solid ${!emp.matched && !emp.is_headquarters && !emp.is_manager ? '#fde68a' : '#e2e8f0'}`, borderRadius: 8, padding: '4px 8px', fontSize: 12, background: !emp.matched && !emp.is_headquarters && !emp.is_manager ? '#fffbeb' : 'white', width: '100%', cursor: 'pointer' }}>
                        <option value={-1}>מפעל</option>
                        <option value={-2}>מטה (מנהלים)</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                    <td style={S.td}>
                      {emp.matched || emp.is_headquarters || emp.is_manager ? (
                        <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>
                          ✓ {emp.is_headquarters ? 'מטה' : emp.is_manager ? 'מנהל' : 'מזוהה'}
                        </span>
                      ) : (
                        <select value={emp.matched_employee_id ?? 0} onChange={e => {
                          const beId = Number(e.target.value)
                          if (beId === -1) {
                            // "עובד חדש" — mark as matched without linking
                            setEmployees(prev => prev.map((em, j) => j === i ? { ...em, matched: true, matched_employee_id: null } : em))
                            return
                          }
                          if (!beId) return
                          const be = unmatchedBranchEmps.find(u => u.id === beId)
                          setEmployees(prev => prev.map((em, j) => j === i ? { ...em, matched: true, matched_employee_id: beId, assignment: be ? `${be.name}` : em.assignment } : em))
                          setUnmatchedBranchEmps(prev => prev.filter(u => u.id !== beId))
                        }} style={{ border: '1px solid #fde68a', borderRadius: 8, padding: '3px 6px', fontSize: 11, background: '#fffbeb', width: '100%' }}>
                          <option value={0}>⚠️ שייך לעובד...</option>
                          <option value={-1}>➕ עובד חדש (ללא שיוך)</option>
                          {unmatchedBranchEmps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fmtM(emp.actual_employer_cost)}</td>
                    <td style={S.td}>{emp.actual_hours}</td>
                    <td style={S.td}>{emp.actual_days}</td>
                  </tr>
                ))}</tbody>
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

        {step === 'saving' && (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 14, color: '#64748b' }}>שומר {employees.length} רשומות...</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
            <CheckCircle size={48} color="#10b981" style={{ marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>הדוח נשמר בהצלחה</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px' }}>
              {employees.length} עובדים · {reportMonth}/{reportYear} · עלות כוללת: {fmtM(totalCost)}
            </p>
            <button onClick={() => setStep('upload')} style={{ ...S.btn, background: '#6366f1', color: 'white' }}>העלאת דוח נוסף</button>
          </div>
        )}
      </div>
    </motion.div>
  )
}
