import { useState, useEffect, useMemo } from 'react'
// JSZip is loaded lazily inside exportAccountingZip — it's ~95KB minified and
// only needed when the user actually clicks "ייצוא להנה"ח". Keeping it out of
// the page's static imports cuts the initial chunk and prevents a long parse
// when the page mounts.
import * as XLSX from 'xlsx'
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

interface BonusKpiSnapshot {
  id: string
  name: string
  weight: number
  source: string
  kind: string
  achieved: boolean
  bonus: number
}

interface BonusRecord {
  id: number
  branch_id: number
  branch_name: string
  month: string
  status: 'draft' | 'approved'
  manager_name: string
  base_amount: number
  threshold_pct: number
  parameters: BonusKpiSnapshot[]
  total_bonus: number
  approved_by: string | null
  approved_at: string | null
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

// Display order for the Excel sheets — drives the column order of the row-
// per-entry export. Each list must contain only keys that appear in the
// matching *_FIELDS Set above.
const SALARY_FIELDS_ORDER = ['hourly_rate', 'monthly_salary', 'global_daily_rate', 'bonus', 'retention_bonus'] as const
const BANK_FIELDS_ORDER = ['bank_name', 'bank_branch', 'bank_account_number'] as const
const ROLE_FIELDS_ORDER = ['position', 'department'] as const

const FIELD_LABELS: Record<string, string> = {
  hourly_rate: 'תעריף שעתי', monthly_salary: 'שכר חודשי', retention_bonus: 'בונוס התמדה',
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
  const [bonuses, setBonuses] = useState<BonusRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [exportingZip, setExportingZip] = useState(false)
  const [zipProgress, setZipProgress] = useState<string | null>(null)

  useEffect(() => { load() }, [year, month])

  async function load() {
    setLoading(true)
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonthDate = new Date(year, month, 1)
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`

    const monthKey = `${year}-${String(month).padStart(2, '0')}`
    try {
      const [auditRes, empsRes, bonusRes, branchesRes] = await Promise.all([
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
        supabase
          .from('branch_bonus_monthly')
          .select('*')
          .eq('month', monthKey)
          .eq('status', 'approved'),
        supabase.from('branches').select('id, name'),
      ])
      if (auditRes.error) console.error('[MonthlyChangesReport] hr_audit_log query failed:', auditRes.error)
      if (empsRes.error) console.error('[MonthlyChangesReport] hr_employees_unified query failed:', empsRes.error)

      setEntries((auditRes.data as AuditEntry[]) || [])
      // Bonuses — enrich with branch name for the export sheet.
      const branchNameById = new Map<number, string>()
      for (const b of (branchesRes.data || [])) branchNameById.set(b.id, b.name)
      const bRows: BonusRecord[] = ((bonusRes.data as any[]) || []).map(b => ({
        id: b.id,
        branch_id: b.branch_id,
        branch_name: branchNameById.get(b.branch_id) || `סניף #${b.branch_id}`,
        month: b.month,
        status: b.status,
        manager_name: b.manager_name,
        base_amount: Number(b.base_amount),
        threshold_pct: Number(b.threshold_pct),
        parameters: (b.parameters as BonusKpiSnapshot[]) || [],
        total_bonus: Number(b.total_bonus),
        approved_by: b.approved_by,
        approved_at: b.approved_at,
      }))
      setBonuses(bRows)
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
    if (!emp) return `[עובד לא נמצא במאגר] (${e.employee_kind === 'branch' ? 'סניף' : 'מפעל'} #${e.employee_id})`
    const loc = emp.location_name || (emp.department || '')
    return loc ? `${emp.name} (${loc})` : emp.name
  }

  // Same data as empName but split for the Excel export, where the location
  // and department belong in their own columns (the UI keeps the combined
  // "(שם סניף)" form because it's denser on screen).
  // For branch employees: location = branch name, department is usually empty.
  // For factory employees: location = "מפעל", department = "בצקים"/"קרמים"/etc.
  function empParts(e: AuditEntry): { name: string; location: string; department: string } {
    if (!e.employee_kind || !e.employee_id) return { name: '—', location: '', department: '' }
    const emp = employeeMap.get(`${e.employee_kind}-${e.employee_id}`)
    if (!emp) {
      const kind = e.employee_kind === 'branch' ? 'סניף' : 'מפעל'
      return { name: '[עובד לא נמצא במאגר]', location: `${kind} #${e.employee_id}`, department: '' }
    }
    return {
      name: emp.name,
      location: emp.location_name || (e.employee_kind === 'factory' ? 'מפעל' : ''),
      department: emp.department || '',
    }
  }

  // A "bulk import" is 5+ audit entries sharing the same second, same author,
  // same table, same operation — almost always a single bulk DB load that
  // would otherwise flood the export. We move these to their own sheet.
  interface BulkBatch { changed_at: string; changed_by_email: string; table_name: string; operation: string; rows: AuditEntry[] }
  function detectBulkImports(es: AuditEntry[]): { bulk: BulkBatch[]; normal: AuditEntry[] } {
    const groups = new Map<string, AuditEntry[]>()
    for (const e of es) {
      const key = `${e.changed_at.slice(0, 19)}|${e.changed_by_email || ''}|${e.table_name}|${e.operation}`
      const arr = groups.get(key) || []
      arr.push(e)
      groups.set(key, arr)
    }
    const bulk: BulkBatch[] = []
    const normal: AuditEntry[] = []
    for (const [key, rows] of groups) {
      if (rows.length >= 5) {
        const [changed_at, changed_by_email, table_name, operation] = key.split('|')
        bulk.push({ changed_at, changed_by_email, table_name, operation, rows })
      } else {
        normal.push(...rows)
      }
    }
    return { bulk, normal }
  }

  function formatDate(s: string): string {
    return new Date(s).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  // Categorize entries — memoized so it doesn't re-run on every render
  // (e.g. when the user clicks the month picker or hovers a button).
  const { hires, departures, salaryChanges, bankChanges, roleChanges, documentEvents, otherChanges, bulkBatches } = useMemo(() => {
    const hires: AuditEntry[] = []
    const departures: AuditEntry[] = []
    const salaryChanges: AuditEntry[] = []
    const bankChanges: AuditEntry[] = []
    const roleChanges: AuditEntry[] = []
    const documentEvents: AuditEntry[] = []
    const otherChanges: AuditEntry[] = []

    const { bulk: bulkBatches, normal } = detectBulkImports(entries)

    for (const e of normal) {
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
    return { hires, departures, salaryChanges, bankChanges, roleChanges, documentEvents, otherChanges, bulkBatches }
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

  // One row per audit entry — one column per allowed field. When multiple
  // fields change in the same UPDATE (e.g. all 3 bank fields at once), they
  // share a single row instead of being split across N rows. Filters out
  // entries that produced no diff in the allowed set.
  function buildFieldRows(es: AuditEntry[], fieldOrder: readonly string[]) {
    type Row = Record<string, string> & { _sortName: string; _sortDate: string }
    const rows: Row[] = []
    for (const e of es) {
      const fields = e.changed_fields || {}
      const parts = empParts(e)
      const row: Row = {
        עובד: parts.name,
        סניף: parts.location,
        מחלקה: parts.department,
        _sortName: parts.name,
        _sortDate: e.changed_at,
      }
      let hasAnyDiff = false
      for (const k of fieldOrder) {
        const v = fields[k]
        if (isDiff(v)) {
          row[fieldLabel(k)] = `${formatValue(v.old)} → ${formatValue(v.new)}`
          hasAnyDiff = true
        } else {
          row[fieldLabel(k)] = ''
        }
      }
      if (!hasAnyDiff) continue
      row['תאריך'] = new Date(e.changed_at).toLocaleString('he-IL')
      row['מבצע'] = e.changed_by_email || ''
      rows.push(row)
    }
    rows.sort((a, b) => a._sortName.localeCompare(b._sortName, 'he') || b._sortDate.localeCompare(a._sortDate))
    return rows.map(({ _sortName, _sortDate, ...rest }) => rest)
  }

  function appendSheet(wb: XLSX.WorkBook, name: string, rows: Record<string, unknown>[]) {
    if (rows.length === 0) return
    const ws = XLSX.utils.json_to_sheet(rows)
    // Mark the sheet RTL so Excel renders Hebrew columns right-to-left.
    ws['!sheetViews'] = [{ rightToLeft: true }]
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  function buildWorkbook(): XLSX.WorkBook {
    const wb = XLSX.utils.book_new()

    // ── Sheet 1: summary ──
    const summary = [
      { קטגוריה: 'עובדים שנקלטו', 'מספר אירועים': hires.length },
      { קטגוריה: 'עובדים שעזבו', 'מספר אירועים': departures.length },
      { קטגוריה: 'שינויי שכר', 'מספר אירועים': salaryChanges.length },
      { קטגוריה: 'שינויי בנק', 'מספר אירועים': bankChanges.length },
      { קטגוריה: 'שינויי תפקיד/מחלקה', 'מספר אירועים': roleChanges.length },
      { קטגוריה: 'מסמכים', 'מספר אירועים': documentEvents.length },
      { קטגוריה: 'שינויים אחרים', 'מספר אירועים': otherChanges.length },
      { קטגוריה: 'ייבוא נתונים (Bulk)', 'מספר אירועים': bulkBatches.reduce((s, b) => s + b.rows.length, 0) },
      { קטגוריה: 'בונוסי מנהלי סניף', 'מספר אירועים': bonuses.length },
    ]
    appendSheet(wb, 'סיכום', summary)

    // ── Sheet 2: hires ──
    // INSERT rows store the initial value either as a bare scalar OR as
    // { new: value } depending on the trigger version. Probe both.
    const extractInitial = (fields: Record<string, unknown> | null, key: string): unknown => {
      const v = fields?.[key]
      if (v && typeof v === 'object' && 'new' in (v as object)) return (v as { new: unknown }).new
      return v
    }
    const hireRows = hires
      .map(e => {
        const p = empParts(e)
        const rate = extractInitial(e.changed_fields, 'hourly_rate')
        const globalRate = extractInitial(e.changed_fields, 'global_daily_rate')
        return {
          עובד: p.name,
          סניף: p.location,
          מחלקה: p.department,
          'שכר שעתי': formatValue(rate),
          'שכר גלובלי': formatValue(globalRate),
          'תאריך קליטה': new Date(e.changed_at).toLocaleString('he-IL'),
          מבצע: e.changed_by_email || '',
        }
      })
      .sort((a, b) => a['עובד'].localeCompare(b['עובד'], 'he'))
    appendSheet(wb, 'עובדים שנקלטו', hireRows)

    // ── Sheet 3: departures ──
    const departRows = departures
      .map(e => {
        const newEnd = (e.changed_fields?.end_date as { new?: unknown } | undefined)?.new
        const p = empParts(e)
        return {
          עובד: p.name,
          סניף: p.location,
          מחלקה: p.department,
          'תאריך סיום עבודה': formatValue(newEnd),
          'תאריך רישום': new Date(e.changed_at).toLocaleString('he-IL'),
          מבצע: e.changed_by_email || '',
        }
      })
      .sort((a, b) => a['עובד'].localeCompare(b['עובד'], 'he'))
    appendSheet(wb, 'עובדים שעזבו', departRows)

    // ── Sheets 4–6: salary / bank / role — one row per audit entry,
    // column per known field. Multiple field changes in the same UPDATE
    // collapse to a single row.
    appendSheet(wb, 'שינויי שכר', buildFieldRows(salaryChanges, SALARY_FIELDS_ORDER))
    appendSheet(wb, 'שינויי בנק', buildFieldRows(bankChanges, BANK_FIELDS_ORDER))
    appendSheet(wb, 'שינויי תפקיד-מחלקה', buildFieldRows(roleChanges, ROLE_FIELDS_ORDER))

    // ── Sheet 7: documents ──
    const docRows = documentEvents
      .map(e => {
        const fields = e.changed_fields || {}
        const fileRaw = (fields.file_name as { new?: unknown })?.new ?? fields.file_name
        const dtypeRaw = (fields.document_type_label as { new?: unknown })?.new ?? fields.document_type_label
        const p = empParts(e)
        return {
          עובד: p.name,
          סניף: p.location,
          מחלקה: p.department,
          'סוג מסמך': formatValue(dtypeRaw),
          'שם קובץ': formatValue(fileRaw),
          פעולה: e.operation === 'INSERT' ? 'הועלה' : e.operation === 'DELETE' ? 'הוסר' : 'עודכן',
          תאריך: new Date(e.changed_at).toLocaleString('he-IL'),
          מבצע: e.changed_by_email || '',
        }
      })
      .sort((a, b) => a['עובד'].localeCompare(b['עובד'], 'he'))
    appendSheet(wb, 'מסמכים', docRows)

    // ── Sheet 8: other changes — skip rows with empty description ──
    const otherRows = otherChanges
      .map(e => {
        const p = empParts(e)
        return { עובד: p.name, סניף: p.location, מחלקה: p.department, 'תיאור שינוי': describeOtherDiff(e), תאריך: new Date(e.changed_at).toLocaleString('he-IL'), מבצע: e.changed_by_email || '' }
      })
      .filter(r => r['תיאור שינוי'].trim() !== '')
      .sort((a, b) => a['עובד'].localeCompare(b['עובד'], 'he'))
    appendSheet(wb, 'שינויים אחרים', otherRows)

    // ── Sheet 9: bulk imports — one row per batch, not per row ──
    const tableLabels: Record<string, string> = {
      branch_employees: 'עובדי סניפים', employees: 'עובדי מפעל',
      employee_documents: 'מסמכי עובדים', employee_onboarding: 'קליטה',
    }
    const opLabels: Record<string, string> = { INSERT: 'הוספה', UPDATE: 'עדכון', DELETE: 'מחיקה' }
    const bulkRows = bulkBatches
      .map(b => ({
        תאריך: new Date(b.changed_at).toLocaleString('he-IL'),
        מבצע: b.changed_by_email || '',
        טבלה: tableLabels[b.table_name] || b.table_name,
        פעולה: opLabels[b.operation] || b.operation,
        'מספר רשומות': b.rows.length,
      }))
      .sort((a, b) => b['תאריך'].localeCompare(a['תאריך']))
    appendSheet(wb, 'ייבוא נתונים (Bulk)', bulkRows)

    // ── Sheet 10: bonuses approved for this month ──
    const bonusRows = bonuses
      .map(b => {
        const passed = b.parameters.filter(p => p.achieved).length
        const kpiSummary = b.parameters
          .map(p => `${p.name} ${p.achieved ? '✓ ' : '✗ '}${Math.round(p.bonus)}`)
          .join(' · ')
        return {
          מנהל: b.manager_name,
          סניף: b.branch_name,
          חודש: b.month,
          'בונוס בסיס': Math.round(b.base_amount),
          'סף עמידה (%)': b.threshold_pct,
          'מדדים שעברו': `${passed}/${b.parameters.length}`,
          'סה"כ בונוס': Math.round(b.total_bonus),
          'פירוט KPI': kpiSummary,
          מאשר: b.approved_by || '',
          'תאריך אישור': b.approved_at ? new Date(b.approved_at).toLocaleString('he-IL') : '',
        }
      })
      .sort((a, b) => a['מנהל'].localeCompare(b['מנהל'], 'he'))
    appendSheet(wb, 'בונוסי מנהלי סניף', bonusRows)

    return wb
  }

  function exportXlsx() {
    const wb = buildWorkbook()
    XLSX.writeFile(wb, `monthly_changes_${year}_${String(month).padStart(2, '0')}.xlsx`)
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

      // 1. Summary XLSX (multi-sheet, organized for accountant)
      const wb = buildWorkbook()
      const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      zip.file(`סיכום שינויים ${HEBREW_MONTHS[month - 1]} ${year}.xlsx`, xlsxBuf)

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
        <Button variant="outline" onClick={exportXlsx}>
          <Download className="size-4 ml-2" />
          ייצוא לאקסל
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
