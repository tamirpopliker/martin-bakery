import { useState, useEffect, useMemo } from 'react'
// JSZip is loaded lazily inside exportAccountingZip — it's ~95KB minified and
// only needed when the user actually clicks "ייצוא להנה"ח". Keeping it out of
// the page's static imports cuts the initial chunk and prevents a long parse
// when the page mounts.
import { supabase } from '../lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ArrowRight, ChevronLeft, ChevronRight, Download, Printer, Archive,
  UserPlus, UserMinus, TrendingUp, Landmark, Briefcase, FileText, Edit3,
} from 'lucide-react'

interface Props { onBack: () => void }

interface AuditEntry {
  id: number
  table_name: string
  employee_kind: 'branch' | 'factory' | null
  employee_id: number | null
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_fields: Record<string, unknown> | null
  changed_by_email: string | null
  changed_at: string
}

interface UnifiedEmployee {
  kind: 'branch' | 'factory'
  id: number
  name: string
  location_name: string | null
  department: string | null
}

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const SALARY_FIELDS = new Set(['hourly_rate', 'monthly_salary', 'retention_bonus', 'bonus', 'global_daily_rate'])
const BANK_FIELDS = new Set(['bank_name', 'bank_branch', 'bank_account_number'])
const ROLE_FIELDS = new Set(['position', 'department'])

const FIELD_LABELS: Record<string, string> = {
  hourly_rate: 'תעריף שעתי', monthly_salary: 'שכר חודשי', retention_bonus: 'בונוס שמירה',
  bonus: 'בונוס', global_daily_rate: 'תעריף יומי', bank_name: 'בנק',
  bank_branch: 'סניף בנק', bank_account_number: 'חשבון', position: 'תפקיד',
  department: 'מחלקה', start_date: 'תחילת עבודה', end_date: 'סיום עבודה',
  active: 'פעיל', id_number: 'ת.ז', birth_date: 'ת. לידה', address: 'כתובת',
  email: 'אימייל', phone: 'טלפון', name: 'שם',
}

function fieldLabel(k: string) { return FIELD_LABELS[k] || k }

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'כן' : 'לא'
  return String(v)
}

export default function MonthlyChangesReport({ onBack }: Props) {
  const now = new Date()
  // Default: previous month
  const initialDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [year, setYear] = useState(initialDate.getFullYear())
  const [month, setMonth] = useState(initialDate.getMonth() + 1) // 1-12
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [employeeMap, setEmployeeMap] = useState<Map<string, UnifiedEmployee>>(new Map())
  const [loading, setLoading] = useState(true)
  const [exportingZip, setExportingZip] = useState(false)
  const [zipProgress, setZipProgress] = useState<string | null>(null)

  useEffect(() => { load() }, [year, month])

  async function load() {
    setLoading(true)
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonthDate = new Date(year, month, 1)
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`

    try {
      const [auditRes, empsRes] = await Promise.all([
        supabase
          .from('hr_audit_log')
          .select('id, table_name, employee_kind, employee_id, operation, changed_fields, changed_by_email, changed_at')
          .gte('changed_at', monthStart)
          .lt('changed_at', nextMonth)
          .order('changed_at', { ascending: false })
          .limit(5000),
        supabase
          .from('hr_employees_unified')
          .select('kind, id, name, location_name, department')
          .limit(2000),
      ])
      if (auditRes.error) console.error('[MonthlyChangesReport] hr_audit_log query failed:', auditRes.error)
      if (empsRes.error) console.error('[MonthlyChangesReport] hr_employees_unified query failed:', empsRes.error)

      setEntries((auditRes.data as AuditEntry[]) || [])
      const map = new Map<string, UnifiedEmployee>()
      for (const e of (empsRes.data as UnifiedEmployee[] || [])) {
        map.set(`${e.kind}-${e.id}`, e)
      }
      setEmployeeMap(map)
    } catch (err) {
      console.error('[MonthlyChangesReport] load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setYear(y); setMonth(m)
  }

  function empName(e: AuditEntry): string {
    if (!e.employee_kind || !e.employee_id) return '—'
    const emp = employeeMap.get(`${e.employee_kind}-${e.employee_id}`)
    if (!emp) return `(${e.employee_kind === 'branch' ? 'סניף' : 'מפעל'} #${e.employee_id})`
    const loc = emp.location_name || (emp.department || '')
    return loc ? `${emp.name} (${loc})` : emp.name
  }

  function formatDate(s: string): string {
    return new Date(s).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  // Categorize entries — memoized so it doesn't re-run on every render
  // (e.g. when the user clicks the month picker or hovers a button).
  const { hires, departures, salaryChanges, bankChanges, roleChanges, documentEvents, otherChanges } = useMemo(() => {
    const hires: AuditEntry[] = []
    const departures: AuditEntry[] = []
    const salaryChanges: AuditEntry[] = []
    const bankChanges: AuditEntry[] = []
    const roleChanges: AuditEntry[] = []
    const documentEvents: AuditEntry[] = []
    const otherChanges: AuditEntry[] = []

    for (const e of entries) {
      if (e.table_name === 'employee_documents') {
        documentEvents.push(e)
        continue
      }
      if (e.table_name === 'employee_onboarding') continue // skip onboarding noise

      if (e.table_name === 'branch_employees' || e.table_name === 'employees') {
        if (e.operation === 'INSERT') {
          hires.push(e)
          continue
        }
        const fields = e.changed_fields || {}
        const changedKeys = Object.keys(fields)
        // End-date set means departure
        if (changedKeys.includes('end_date')) {
          const newVal = (fields.end_date as { old: unknown; new: unknown } | undefined)?.new
          if (newVal) {
            departures.push(e)
            continue
          }
        }
        const hasSalary = changedKeys.some(k => SALARY_FIELDS.has(k))
        const hasBank = changedKeys.some(k => BANK_FIELDS.has(k))
        const hasRole = changedKeys.some(k => ROLE_FIELDS.has(k))
        if (hasSalary) salaryChanges.push(e)
        if (hasBank) bankChanges.push(e)
        if (hasRole) roleChanges.push(e)
        if (!hasSalary && !hasBank && !hasRole) {
          // Skip if only "active" or system-y fields
          const meaningful = changedKeys.filter(k =>
            !['active', 'updated_at', 'created_at'].includes(k))
          if (meaningful.length > 0) otherChanges.push(e)
        }
      }
    }
    return { hires, departures, salaryChanges, bankChanges, roleChanges, documentEvents, otherChanges }
  }, [entries])

  // Some audit-log rows have `null` (or a non-object) values for a field in
  // changed_fields — defensively skip those instead of crashing on `.old`.
  // Without the guard, a single null in any month's data blows up the whole
  // page render (React unmounts the tree → looks like the app is frozen).
  function isDiff(v: unknown): v is { old: unknown; new: unknown } {
    return v !== null && typeof v === 'object'
  }

  function describeFieldDiff(e: AuditEntry, allowedFields: Set<string>): string {
    const fields = e.changed_fields || {}
    const parts: string[] = []
    for (const [k, v] of Object.entries(fields)) {
      if (!allowedFields.has(k)) continue
      if (!isDiff(v)) continue
      parts.push(`${fieldLabel(k)}: ${formatValue(v.old)} → ${formatValue(v.new)}`)
    }
    return parts.join(' · ')
  }

  function describeOtherDiff(e: AuditEntry): string {
    const fields = e.changed_fields || {}
    const parts: string[] = []
    for (const [k, v] of Object.entries(fields)) {
      if (SALARY_FIELDS.has(k) || BANK_FIELDS.has(k) || ROLE_FIELDS.has(k)) continue
      if (['active', 'updated_at', 'created_at', 'end_date'].includes(k)) continue
      if (!isDiff(v)) continue
      parts.push(`${fieldLabel(k)}: ${formatValue(v.old)} → ${formatValue(v.new)}`)
    }
    return parts.join(' · ')
  }

  function buildSummaryCsv(): string {
    const headers = ['קטגוריה', 'עובד', 'תיאור שינוי', 'מבצע', 'תאריך']
    const rows: string[][] = []
    const push = (cat: string, e: AuditEntry, desc: string) =>
      rows.push([cat, empName(e), desc, e.changed_by_email || '', new Date(e.changed_at).toLocaleString('he-IL')])

    for (const e of hires)         push('עובדים שנקלטו', e, 'נקלט')
    for (const e of departures)    push('עובדים שעזבו', e, `סיום עבודה: ${formatValue((e.changed_fields?.end_date as { new: unknown } | undefined)?.new)}`)
    for (const e of salaryChanges) push('שינויי שכר', e, describeFieldDiff(e, SALARY_FIELDS))
    for (const e of bankChanges)   push('שינויי בנק', e, describeFieldDiff(e, BANK_FIELDS))
    for (const e of roleChanges)   push('שינויי תפקיד/מחלקה', e, describeFieldDiff(e, ROLE_FIELDS))
    for (const e of documentEvents) {
      const fields = e.changed_fields || {}
      const file = (fields.file_name as { new?: unknown })?.new || fields.file_name || '?'
      const dtype = (fields.document_type_label as { new?: unknown })?.new || fields.document_type_label || ''
      push('מסמכים', e, `${e.operation === 'INSERT' ? 'הועלה' : 'הוסר'}: ${formatValue(dtype)} (${formatValue(file)})`)
    }
    for (const e of otherChanges)  push('שינויים אחרים', e, describeOtherDiff(e))

    return [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
  }

  function exportCsv() {
    const csv = buildSummaryCsv()
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `monthly_changes_${year}_${String(month).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Accounting-friendly export: ZIP containing the summary CSV + every relevant
  // document for the month (uploaded this month + full doc set for hires/leavers).
  async function exportAccountingZip() {
    setExportingZip(true)
    setZipProgress('טוען...')
    try {
      // Lazy-load JSZip — keeps it out of the page's initial bundle.
      const { default: JSZip } = await import('jszip')
      setZipProgress('אוסף נתונים...')
      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
      const nextMonthDate = new Date(year, month, 1)
      const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`

      const zip = new JSZip()

      // 1. Summary CSV
      const csv = buildSummaryCsv()
      zip.file(`סיכום שינויים ${HEBREW_MONTHS[month - 1]} ${year}.csv`, '﻿' + csv)

      // 2. Collect employee keys to grab full doc set for: hires + leavers
      const fullDocEmpKeys = new Set<string>()
      for (const e of hires) {
        if (e.employee_kind && e.employee_id) fullDocEmpKeys.add(`${e.employee_kind}-${e.employee_id}`)
      }
      for (const e of departures) {
        if (e.employee_kind && e.employee_id) fullDocEmpKeys.add(`${e.employee_kind}-${e.employee_id}`)
      }

      // 3. Query: docs uploaded this month
      const { data: monthDocs } = await supabase
        .from('employee_documents')
        .select('*')
        .gte('uploaded_at', monthStart)
        .lt('uploaded_at', nextMonth)

      // 4. Query: full doc set for hires + leavers (regardless of upload date)
      const fullDocs: Array<Record<string, unknown>> = []
      for (const key of fullDocEmpKeys) {
        const [kindStr, idStr] = key.split('-')
        const { data } = await supabase
          .from('employee_documents')
          .select('*')
          .eq('employee_kind', kindStr)
          .eq('employee_id', Number(idStr))
        if (data) fullDocs.push(...data)
      }

      // 5. Merge by id (avoid duplicates)
      const allDocs = new Map<number, Record<string, unknown>>()
      for (const d of (monthDocs || [])) allDocs.set(d.id as number, d)
      for (const d of fullDocs) allDocs.set(d.id as number, d)

      const total = allDocs.size
      let i = 0
      if (total > 0) {
        const docsFolder = zip.folder('מסמכים')!
        for (const doc of allDocs.values()) {
          i++
          setZipProgress(`מוריד מסמכים... ${i}/${total}`)
          const empKey = `${doc.employee_kind}-${doc.employee_id}`
          const emp = employeeMap.get(empKey)
          const empName = emp?.name || `(${doc.employee_kind} #${doc.employee_id})`
          const empLoc = emp?.location_name || emp?.department || ''
          const folderName = sanitizePath(`${empName}${empLoc ? ' - ' + empLoc : ''}`)
          const dtype = sanitizePath(String(doc.document_type_label))
          const fileName = sanitizePath(String(doc.file_name))
          const fileUrl = String(doc.file_url)

          const dl = await supabase.storage.from('hr-documents').download(fileUrl)
          if (dl.error || !dl.data) continue
          const arrayBuffer = await dl.data.arrayBuffer()
          docsFolder.file(`${folderName}/${dtype}/${fileName}`, arrayBuffer)
        }
      }

      setZipProgress('יוצר ZIP...')
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `דוח להנהלת חשבונות ${HEBREW_MONTHS[month - 1]} ${year}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setZipProgress(null)
    } catch (e: any) {
      setZipProgress(`שגיאה: ${e?.message || 'לא ידוע'}`)
      setTimeout(() => setZipProgress(null), 4000)
    } finally {
      setExportingZip(false)
    }
  }

  function sanitizePath(s: string): string {
    return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
  }

  const totalChanges = hires.length + departures.length + salaryChanges.length +
                       bankChanges.length + roleChanges.length + documentEvents.length +
                       otherChanges.length

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #monthly-changes-print, #monthly-changes-print * { visibility: visible !important; }
          #monthly-changes-print {
            position: absolute !important; inset: 0 !important;
            background: white !important; padding: 24px !important;
          }
          .no-print { display: none !important; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      <div className="bg-white border-b sticky top-0 z-10 px-6 py-4 flex items-center gap-3 no-print">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowRight className="size-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 m-0">דוח שינויים חודשי</h1>
          <p className="text-sm text-slate-500 m-0">{HEBREW_MONTHS[month - 1]} {year} · {totalChanges} שינויים</p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4 ml-2" />
          הדפסה / PDF
        </Button>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="size-4 ml-2" />
          ייצוא CSV
        </Button>
        <Button onClick={exportAccountingZip} disabled={exportingZip}>
          <Archive className="size-4 ml-2" />
          {exportingZip ? (zipProgress || 'מכין...') : 'ייצוא להנה"ח'}
        </Button>
      </div>

      <div className="max-w-[900px] mx-auto px-6 py-6">
        <Card className="mb-4 no-print">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" onClick={() => changeMonth(-1)}>
              <ChevronRight className="size-4" />
              חודש קודם
            </Button>
            <div className="flex gap-2 items-center">
              <select
                value={month}
                onChange={e => setMonth(Number(e.target.value))}
                className="border rounded-lg px-3 py-2 text-sm bg-white"
              >
                {HEBREW_MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
              <input
                type="number"
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="border rounded-lg px-3 py-2 text-sm bg-white w-24"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => changeMonth(1)}>
              חודש הבא
              <ChevronLeft className="size-4" />
            </Button>
          </CardContent>
        </Card>

        <div id="monthly-changes-print">
          <h2 className="text-2xl font-bold mb-1 hidden print:block">דוח שינויים — {HEBREW_MONTHS[month - 1]} {year}</h2>

          {loading ? (
            <div className="text-center py-16 text-slate-500">טוען...</div>
          ) : totalChanges === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-slate-400">
                לא היו שינויים בחודש זה
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <CategorySection
                title="עובדים שנקלטו" count={hires.length}
                icon={<UserPlus className="size-5 text-green-600" />} color="green"
              >
                {hires.map(e => (
                  <CategoryRow key={e.id} name={empName(e)} desc="נקלט" date={formatDate(e.changed_at)} by={e.changed_by_email} />
                ))}
              </CategorySection>

              <CategorySection
                title="עובדים שעזבו" count={departures.length}
                icon={<UserMinus className="size-5 text-red-600" />} color="red"
              >
                {departures.map(e => {
                  const newEnd = (e.changed_fields?.end_date as { new?: unknown } | undefined)?.new
                  return <CategoryRow key={e.id} name={empName(e)} desc={`סיום עבודה: ${formatValue(newEnd)}`} date={formatDate(e.changed_at)} by={e.changed_by_email} />
                })}
              </CategorySection>

              <CategorySection
                title="שינויי שכר" count={salaryChanges.length}
                icon={<TrendingUp className="size-5 text-amber-600" />} color="amber"
              >
                {salaryChanges.map(e => (
                  <CategoryRow key={e.id} name={empName(e)} desc={describeFieldDiff(e, SALARY_FIELDS)} date={formatDate(e.changed_at)} by={e.changed_by_email} />
                ))}
              </CategorySection>

              <CategorySection
                title="שינויי בנק" count={bankChanges.length}
                icon={<Landmark className="size-5 text-blue-600" />} color="blue"
              >
                {bankChanges.map(e => (
                  <CategoryRow key={e.id} name={empName(e)} desc={describeFieldDiff(e, BANK_FIELDS)} date={formatDate(e.changed_at)} by={e.changed_by_email} />
                ))}
              </CategorySection>

              <CategorySection
                title="שינויי תפקיד/מחלקה" count={roleChanges.length}
                icon={<Briefcase className="size-5 text-purple-600" />} color="purple"
              >
                {roleChanges.map(e => (
                  <CategoryRow key={e.id} name={empName(e)} desc={describeFieldDiff(e, ROLE_FIELDS)} date={formatDate(e.changed_at)} by={e.changed_by_email} />
                ))}
              </CategorySection>

              <CategorySection
                title="מסמכים" count={documentEvents.length}
                icon={<FileText className="size-5 text-indigo-600" />} color="indigo"
              >
                {documentEvents.map(e => {
                  const fields = e.changed_fields || {}
                  const file = (fields.file_name as { new?: unknown } | undefined)?.new ?? fields.file_name ?? '?'
                  const dtype = (fields.document_type_label as { new?: unknown } | undefined)?.new ?? fields.document_type_label ?? ''
                  const action = e.operation === 'INSERT' ? 'הועלה' : 'הוסר'
                  return <CategoryRow key={e.id} name={empName(e)} desc={`${action}: ${formatValue(dtype)} (${formatValue(file)})`} date={formatDate(e.changed_at)} by={e.changed_by_email} />
                })}
              </CategorySection>

              <CategorySection
                title="שינויים אחרים" count={otherChanges.length}
                icon={<Edit3 className="size-5 text-slate-600" />} color="slate"
              >
                {otherChanges.map(e => (
                  <CategoryRow key={e.id} name={empName(e)} desc={describeOtherDiff(e)} date={formatDate(e.changed_at)} by={e.changed_by_email} />
                ))}
              </CategorySection>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CategorySection({
  title, count, icon, color, children,
}: {
  title: string; count: number; icon: React.ReactNode
  color: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'indigo' | 'slate'
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b">
          {icon}
          <h3 className="text-base font-bold text-slate-900 m-0 flex-1">{title}</h3>
          <span className="text-sm font-medium text-slate-500">({count})</span>
        </div>
        <div className="space-y-1.5">{children}</div>
      </CardContent>
    </Card>
  )
}

function CategoryRow({ name, desc, date, by }: {
  name: string; desc: string; date: string; by: string | null
}) {
  return (
    <div className="text-sm flex flex-wrap items-baseline gap-2 py-1">
      <span className="font-medium text-slate-900 min-w-[180px]">{name}</span>
      <span className="text-slate-700 flex-1">{desc}</span>
      <span className="text-xs text-slate-400 whitespace-nowrap">
        {date}{by ? ` · ${by}` : ''}
      </span>
    </div>
  )
}
