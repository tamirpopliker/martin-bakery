import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { supabase, monthEnd } from '../lib/supabase'
import Papa from 'papaparse'
import JSZip from 'jszip'
import { Upload, CheckCircle, AlertCircle, XCircle, FileText, Loader2, Download, Trash2 } from 'lucide-react'
import { detectBranchId } from '../lib/internalCustomers'
import { Card, CardContent } from '@/components/ui/card'

// ─── Types ───────────────────────────────────────────────────────────────────
interface Props { onBack?: () => void; branchOnly?: boolean }

interface FileMapping {
  csvName: string
  tableName: string
  label: string
  status: 'ready' | 'warning' | 'skip' | 'importing' | 'done' | 'error'
  rows: Record<string, any>[]
  rowCount: number
  rawCount?: number
  warning?: string
  warnings?: string[]
  sampleRows?: Record<string, any>[]
  result?: { inserted: number; skipped: number; errors: number; nullRows?: number; deleteError?: string; firstError?: string }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
interface TableDef {
  table: string
  label: string
  mapRow: (row: Record<string, string>, extra: { month?: string }) => Record<string, any> | null
  dupeKey: (row: Record<string, any>) => string
  autoInject?: Record<string, any>
  hasDate?: boolean
}

const DEPT_MAP: Record<string, string> = {
  'קרמים': 'creams', 'creams': 'creams', 'cream': 'creams',
  'בצקים': 'dough', 'dough': 'dough',
  'אריזה': 'packaging', 'packaging': 'packaging', 'pack': 'packaging',
  'ניקיון': 'cleaning', 'cleaning': 'cleaning', 'clean': 'cleaning',
  'נהג': 'cleaning', 'נהגים': 'cleaning', 'driver': 'cleaning',
  'ניקיון/נהג': 'cleaning', 'ניקיון+נהג': 'cleaning', 'ניקיון + נהג': 'cleaning',
  'הנהלה': 'cleaning', 'משרד': 'cleaning',
}

const REPAIR_TYPE_MAP: Record<string, string> = {
  'תיקון': 'repair', 'repair': 'repair',
  'ציוד חדש': 'new_equipment', 'new_equipment': 'new_equipment', 'new equipment': 'new_equipment',
}

const BRANCH_MAP: Record<string, number> = {
  'אברהם אבינו': 1,
  'הפועלים': 2,
  'יעקב כהן': 3,
}
function parseBranch(val: string | undefined): number | null {
  if (!val) return null
  const v = val.trim()
  return BRANCH_MAP[v] ?? null
}

const SOURCE_MAP: Record<string, string> = {
  'קופה': 'cashier', 'cashier': 'cashier', 'cash': 'cashier',
  'אתר': 'website', 'website': 'website', 'web': 'website',
  'הקפה': 'credit', 'אשראי': 'credit', 'credit': 'credit',
}

const EXPENSE_TYPES = ['suppliers', 'repairs', 'infrastructure', 'deliveries', 'other']

const SUPPLIER_CAT_MAP: Record<string, string> = {
  'ספקים/מלאי': 'מזון', 'מזון': 'מזון', 'ניקיון': 'ניקיון',
  'ציוד': 'ציוד', 'תשתיות': 'תשתיות', 'אריזה': 'אריזה', 'שונות': 'שונות',
}

function parseDept(val: string | undefined): string {
  if (!val) return ''
  const v = val.trim()
  return DEPT_MAP[v] || DEPT_MAP[v.toLowerCase()] || v
}

function parseNum(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null
  const n = parseFloat(val.replace(/,/g, ''))
  return isNaN(n) ? null : Math.round(n * 100) / 100
}

function parseDate(val: string | undefined): string | null {
  if (!val) return null
  let v = val.replace(/[א-ת]+/g, '').replace(/\s+/g, ' ').trim().replace(/^[\s\-]+|[\s\-]+$/g, '').trim()
  const dmy = v.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const ymd = v.match(/^(\d{4})[\s\-]+(\d{1,2})[\s\-]+(\d{1,2})$/)
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return null
}

function parseRepairType(val: string | undefined): string {
  if (!val) return 'repair'
  const v = val.trim()
  return REPAIR_TYPE_MAP[v] || REPAIR_TYPE_MAP[v.toLowerCase()] || 'repair'
}

// ─── Pre-import validation ───────────────────────────────────────────────────
function validateRows(tableName: string, mapped: Record<string, any>[], rawRows: Record<string, string>[]): string[] {
  const warnings: string[] = []
  // Unrecognized departments
  if (['daily_production', 'factory_waste', 'factory_repairs', 'labor'].includes(tableName)) {
    const badDepts = new Set<string>()
    for (const r of rawRows) {
      const dept = r.department?.trim()
      if (dept && !DEPT_MAP[dept] && !DEPT_MAP[dept.toLowerCase()]) badDepts.add(dept)
    }
    if (badDepts.size > 0) warnings.push(`מחלקות לא מזוהות: ${[...badDepts].join(', ')}`)
  }
  // Unrecognized repair types
  if (tableName === 'factory_repairs') {
    const badTypes = new Set<string>()
    for (const r of rawRows) {
      const val = (r.status || r.type || '').trim()
      if (val && !REPAIR_TYPE_MAP[val] && !REPAIR_TYPE_MAP[val.toLowerCase()]) badTypes.add(val)
    }
    if (badTypes.size > 0) warnings.push(`סוגי תיקון לא מזוהים (ישתמש ב-repair): ${[...badTypes].join(', ')}`)
  }
  // Unrecognized branches
  if (['branch_revenue', 'branch_expenses', 'branch_labor', 'branch_waste', 'branch_suppliers', 'branch_credit_customers'].includes(tableName)) {
    const badBranches = new Set<string>()
    for (const r of rawRows) {
      const bn = r.branch_name?.trim()
      if (bn && !BRANCH_MAP[bn]) badBranches.add(bn)
    }
    if (badBranches.size > 0) warnings.push(`סניפים לא מזוהים: ${[...badBranches].join(', ')}`)
  }
  // Mixed months
  const months = new Set<string>()
  for (const r of mapped) {
    if (r.date && typeof r.date === 'string') {
      const m = r.date.slice(0, 7)
      if (/^\d{4}-\d{2}$/.test(m)) months.add(m)
    }
  }
  if (months.size > 1) warnings.push(`ייבוא מרובה חודשים: ${[...months].join(', ')}`)
  // Employer cost source tracking for labor tables
  if (['labor', 'branch_labor'].includes(tableName)) {
    const fromCsv = mapped.filter(r => r._empCostSource === 'csv').length
    const fromCalc = mapped.filter(r => r._empCostSource === 'calc').length
    if (fromCalc > 0 && fromCsv > 0) {
      warnings.push(`עלות מעסיק: ${fromCsv} שורות מהקובץ, ${fromCalc} שורות חושבו (×1.3)`)
    } else if (fromCalc > 0) {
      warnings.push(`עלות מעסיק: כל ${fromCalc} השורות חושבו אוטומטית (שכר ברוטו ×1.3)`)
    }
  }
  // Rejected rows
  const rejected = rawRows.length - mapped.length
  if (rejected > 0) warnings.push(`${rejected} שורות נדחו (שדות חסרים: תאריך, סכום וכו')`)
  return warnings
}

// ─── Table definitions ───────────────────────────────────────────────────────
const FILE_MAP: Record<string, TableDef> = {
  'factory_daily_production': {
    table: 'daily_production', label: 'ייצור יומי', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const dept = parseDept(r.department)
      if (!date || !dept) return null
      return {
        date, department: dept,
        amount: parseNum(r.production_amount) ?? parseNum(r.amount) ?? parseNum(r.quantity) ?? 0,
      }
    },
    dupeKey: (r) => `${r.date}_${r.department}`,
  },
  'factory_labor': {
    table: 'labor', label: 'לייבור מחלקות', hasDate: true,
    autoInject: { entity_type: 'factory' },
    mapRow: (r) => {
      const date = parseDate(r.date); const dept = parseDept(r.department)
      if (!date || !r.employee_name?.trim()) return null
      const gross = parseNum(r.gross_salary) ?? 0
      let empCost = parseNum(r.employer_cost) ?? parseNum(r['עלות מעסיק']) ?? parseNum(r['עלות_מעסיק'])
      const empCostFromCsv = !!empCost
      if (!empCost || empCost === 0) empCost = Math.round(gross * 1.3 * 100) / 100
      return {
        date, entity_id: dept, entity_type: 'factory',
        employee_name: r.employee_name.trim(),
        hours_100: parseNum(r.hours) ?? 0, hours_125: 0, hours_150: 0,
        gross_salary: gross, employer_cost: empCost,
        hourly_rate: parseNum(r.hourly_rate) ?? 0, bonus: parseNum(r.bonus) ?? 0,
        _empCostSource: empCostFromCsv ? 'csv' : 'calc',
      }
    },
    dupeKey: (r) => `${r.date}_${r.employee_name}`,
  },
  'factory_sales': {
    table: 'factory_sales', label: 'מכירות מפעל', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const amount = parseNum(r.amount)
      if (!date || amount === null) return null
      const customerName = r.customer?.trim() || null
      const branchId = customerName ? detectBranchId(customerName) : null
      return {
        date, department: parseDept(r.department),
        customer: customerName, amount,
        doc_number: r.doc_number?.trim() || null, notes: r.notes?.trim() || null,
        is_internal: branchId !== null,
        target_branch_id: branchId,
        branch_status: branchId !== null ? 'pending' : null,
      }
    },
    dupeKey: (r) => `${r.date}_${r.customer}_${r.amount}_${r.doc_number}`,
  },
  'factory_other_sales': {
    table: 'factory_b2b_sales', label: 'מכירות B2B/שונות', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const amount = parseNum(r.amount)
      if (!date || amount === null) return null
      let st = r.sale_type?.trim().toLowerCase() || 'misc'
      if (st === 'שונות') st = 'misc'
      if (st === 'עסקי' || st === 'b2b') st = 'b2b'
      const customerName = r.customer?.trim() || null
      const branchId = customerName ? detectBranchId(customerName) : null
      return {
        date, sale_type: st, customer: customerName,
        amount, doc_number: r.doc_number?.trim() || null, notes: r.notes?.trim() || null,
        is_internal: branchId !== null,
        target_branch_id: branchId,
        branch_status: branchId !== null ? 'pending' : null,
      }
    },
    dupeKey: (r) => `${r.date}_${r.customer}_${r.amount}`,
  },
  'factory_supplier_invoices': {
    table: 'supplier_invoices', label: 'חשבוניות ספקים', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const amount = parseNum(r.amount)
      if (!date || amount === null) return null
      return {
        date, amount,
        supplier_name: r.supplier_name?.trim() || null,
        doc_number: r.doc_number?.trim() || null,
        doc_type: r.category?.trim() || r.doc_type?.trim() || 'חשבונית מס',
        notes: r.notes?.trim() || null,
      }
    },
    dupeKey: (r) => `${r.date}_${r.supplier_id || r.supplier_name}_${r.amount}_${r.doc_number}`,
  },
  'factory_waste': {
    table: 'factory_waste', label: 'פחת', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const amount = parseNum(r.amount)
      if (!date || amount === null) return null
      const dept = parseDept(r.department)
      return {
        date, department: dept || 'creams',
        amount,
        category: r.category?.trim() || null,
        description: r.notes?.trim() || r.description?.trim() || null,
      }
    },
    dupeKey: (r) => `${r.date}_${r.department}_${r.amount}`,
  },
  'factory_repairs': {
    table: 'factory_repairs', label: 'תיקונים', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const amount = parseNum(r.amount)
      if (!date || amount === null) return null
      return {
        date, department: parseDept(r.department) || 'creams',
        amount,
        type: parseRepairType(r.status || r.type),
        description: r.description?.trim() || null,
      }
    },
    dupeKey: (r) => `${r.date}_${r.amount}_${r.description}`,
  },
  'factory_fixed_costs': {
    table: 'fixed_costs', label: 'עלויות קבועות', hasDate: false,
    mapRow: (r, extra) => {
      const amount = parseNum(r.amount)
      if (!r.name?.trim() || amount === null) return null
      let et = r.entity_type?.trim() || 'factory'
      if (et === 'fixed') et = 'factory'
      const rawMonth = r.month?.toString().trim() || extra.month || new Date().toISOString().slice(0, 7)
      return {
        name: r.name.trim(), amount,
        month: rawMonth,
        entity_type: et,
        entity_id: 'factory',
      }
    },
    dupeKey: (r) => `${r.name}_${r.month}`,
  },
  'factory_kpi_targets': {
    table: 'kpi_targets', label: 'יעדי KPI', hasDate: false,
    mapRow: (r) => {
      const dept = parseDept(r.department)
      if (!dept) return null
      return {
        department: dept,
        labor_pct: parseNum(r.labor_pct) ?? 25, waste_pct: parseNum(r.waste_pct) ?? 5,
        repairs_pct: parseNum(r.repairs_pct) ?? 3, gross_profit_pct: parseNum(r.gross_profit_pct) ?? 40,
        production_pct: parseNum(r.production_pct) ?? 45,
      }
    },
    dupeKey: (r) => `${r.department}`,
  },
  'factory_suppliers': {
    table: 'suppliers', label: 'ספקים', hasDate: false,
    mapRow: (r) => {
      if (!r.name?.trim()) return null
      return { name: r.name.trim() }
    },
    dupeKey: (r) => `${r.name}`,
  },
  // ─── Branch tables ───────────────────────────────────────────────────────
  'branch_revenue': {
    table: 'branch_revenue', label: 'הכנסות סניפים', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const amount = parseNum(r.amount)
      const branchId = parseBranch(r.branch_name)
      if (!date || amount === null || !branchId) return null
      const rawSrc = (r.source || '').trim()
      const src = SOURCE_MAP[rawSrc] || SOURCE_MAP[rawSrc.toLowerCase()] || rawSrc.toLowerCase()
      if (!['cashier', 'website', 'credit'].includes(src)) return null
      return {
        branch_id: branchId, date, source: src, amount,
        transaction_count: parseNum(r.transaction_count) ?? 0,
        customer: r.customer?.trim() || null,
        doc_number: r.doc_number?.trim() || null,
        notes: r.notes?.trim() || null,
      }
    },
    dupeKey: (r) => `${r.branch_id}_${r.date}_${r.source}_${r.amount}`,
  },
  'branch_expenses': {
    table: 'branch_expenses', label: 'הוצאות סניפים', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const amount = parseNum(r.amount)
      const branchId = parseBranch(r.branch_name)
      if (!date || amount === null || !branchId) return null
      let et = (r.expense_type || 'suppliers').trim().toLowerCase()
      if (!EXPENSE_TYPES.includes(et)) et = 'suppliers'
      return {
        branch_id: branchId, date, amount,
        expense_type: et,
        supplier: r.supplier?.trim() || '—',
        doc_number: r.doc_number?.trim() || null,
        notes: r.notes?.trim() || null,
        from_factory: (r.supplier?.trim() || '').includes('מפעל'),
      }
    },
    dupeKey: (r) => `${r.branch_id}_${r.date}_${r.supplier}_${r.amount}`,
  },
  'branch_labor': {
    table: 'branch_labor', label: 'לייבור סניפים', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date)
      const branchId = parseBranch(r.branch_name)
      const gross = parseNum(r.gross_salary) ?? 0
      if (!date || !branchId || gross === 0) return null
      let empCost = parseNum(r.employer_cost) ?? parseNum(r['עלות מעסיק']) ?? parseNum(r['עלות_מעסיק'])
      const empCostFromCsv = !!empCost
      if (!empCost || empCost === 0) empCost = Math.round(gross * 1.3 * 100) / 100
      return {
        branch_id: branchId, date,
        employee_name: r.employee_name?.trim() || 'סיכום יומי',
        hours: parseNum(r.hours) ?? 0,
        gross_salary: gross,
        employer_cost: empCost,
        notes: r.notes?.trim() || null,
        _empCostSource: empCostFromCsv ? 'csv' : 'calc',
      }
    },
    dupeKey: (r) => `${r.branch_id}_${r.date}_${r.employee_name}`,
  },
  'branch_waste': {
    table: 'branch_waste', label: 'פחת סניפים', hasDate: true,
    mapRow: (r) => {
      const date = parseDate(r.date); const amount = parseNum(r.amount)
      const branchId = parseBranch(r.branch_name)
      if (!date || amount === null || !branchId) return null
      let cat = (r.category || 'finished').trim().toLowerCase()
      if (!['finished', 'raw', 'packaging'].includes(cat)) cat = 'finished'
      return {
        branch_id: branchId, date, amount, category: cat,
        notes: r.notes?.trim() || null,
      }
    },
    dupeKey: (r) => `${r.branch_id}_${r.date}_${r.amount}`,
  },
  'branch_suppliers': {
    table: 'branch_suppliers', label: 'ספקי סניפים', hasDate: false,
    mapRow: (r) => {
      const branchId = parseBranch(r.branch_name)
      if (!branchId || !r.name?.trim()) return null
      const rawCat = r.category?.trim() || 'מזון'
      const cat = SUPPLIER_CAT_MAP[rawCat] || rawCat
      return {
        branch_id: branchId, name: r.name.trim(),
        phone: r.phone?.trim() || r.company_id?.trim() || null,
        category: cat, notes: r.notes?.trim() || null, active: true,
      }
    },
    dupeKey: (r) => `${r.branch_id}_${r.name}`,
  },
  'branch_customers': {
    table: 'branch_credit_customers', label: 'לקוחות הקפה', hasDate: false,
    mapRow: (r) => {
      const branchId = parseBranch(r.branch_name)
      if (!branchId || !r.name?.trim()) return null
      return {
        branch_id: branchId, name: r.name.trim(),
        phone: r.phone?.trim() || null,
        credit_limit: parseNum(r.credit_limit) ?? 0,
        notes: r.notes?.trim() || null, active: true,
      }
    },
    dupeKey: (r) => `${r.branch_id}_${r.name}`,
  },
}

const SKIP_FILES = ['factory_customers', 'factory_packaging', 'factory_packaging_products']
const BRANCH_FILE_KEYS = ['branch_revenue', 'branch_expenses', 'branch_labor', 'branch_waste', 'branch_suppliers', 'branch_customers']

// ─── Auto-detect month from data ─────────────────────────────────────────────
function detectMonth(allFiles: FileMapping[]): string {
  const months: Record<string, number> = {}
  for (const f of allFiles) {
    for (const row of f.rows) {
      if (row.date && typeof row.date === 'string') {
        const m = row.date.slice(0, 7)
        if (/^\d{4}-\d{2}$/.test(m)) months[m] = (months[m] || 0) + 1
      }
    }
  }
  let best = '', bestCount = 0
  for (const [m, c] of Object.entries(months)) {
    if (c > bestCount) { best = m; bestCount = c }
  }
  return best || new Date().toISOString().slice(0, 7)
}

function detectAllMonths(allFiles: FileMapping[]): string[] {
  const months = new Set<string>()
  for (const f of allFiles) {
    for (const row of f.rows) {
      if (row.date && typeof row.date === 'string') {
        const m = row.date.slice(0, 7)
        if (/^\d{4}-\d{2}$/.test(m)) months.add(m)
      }
    }
  }
  return [...months].sort()
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── Component ───────────────────────────────────────────────────────────────
export default function DataImport({ branchOnly }: Props) {
  const [files, setFiles] = useState<FileMapping[]>([])
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)
  const [clearExisting, setClearExisting] = useState(true)
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' })
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dbStatus, setDbStatus] = useState<{ month: string; tables: Record<string, { count: number; label: string; error?: string; sum?: number; sumLabel?: string }> } | null>(null)
  const [checkingDb, setCheckingDb] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [purgingAll, setPurgingAll] = useState(false)
  const [purgeResult, setPurgeResult] = useState<{ table: string; label: string; ok: boolean; error?: string }[] | null>(null)
  const [importMode, setImportMode] = useState<'zip' | 'single'>('zip')
  const singleFileRef = useRef<HTMLInputElement>(null)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)

  // ─── Identify file ─────────────────────────────────────────────────────────
  function identifyFile(name: string): { key: string; def: TableDef } | { key: string; skip: true } | null {
    const base = name.replace(/\.csv$/i, '').toLowerCase().trim()
    if (FILE_MAP[base]) {
      if (branchOnly && !BRANCH_FILE_KEYS.includes(base)) return { key: base, skip: true }
      return { key: base, def: FILE_MAP[base] }
    }
    if (SKIP_FILES.some(s => base.includes(s))) return { key: base, skip: true }
    for (const [key, def] of Object.entries(FILE_MAP)) {
      if (base.includes(key) || key.includes(base)) {
        if (branchOnly && !BRANCH_FILE_KEYS.includes(key)) return { key, skip: true }
        return { key, def }
      }
    }
    return null
  }

  // ─── Parse a single CSV ────────────────────────────────────────────────────
  function parseCsvContent(fileName: string, csvText: string) {
    const identified = identifyFile(fileName)
    if (!identified) {
      setFiles(prev => {
        if (prev.find(f => f.csvName === fileName)) return prev
        return [...prev, { csvName: fileName, tableName: '', label: 'לא מזוהה', status: 'skip', rows: [], rowCount: 0, warning: 'קובץ לא מזוהה — ידולג' }]
      })
      return
    }
    if ('skip' in identified) {
      setFiles(prev => {
        if (prev.find(f => f.csvName === fileName)) return prev
        return [...prev, { csvName: fileName, tableName: '', label: fileName, status: 'skip', rows: [], rowCount: 0, warning: 'קובץ ידולג (לא נתמך)' }]
      })
      return
    }
    const { def } = identified
    // Add placeholder
    setFiles(prev => {
      if (prev.find(f => f.csvName === fileName)) return prev
      return [...prev, { csvName: fileName, tableName: def.table, label: def.label, status: 'ready', rows: [], rowCount: 0 }]
    })
    // Parse CSV text
    Papa.parse(csvText, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        const mapped: Record<string, any>[] = []
        const tempMonth = new Date().toISOString().slice(0, 7)
        for (const row of results.data as Record<string, string>[]) {
          const m = def.mapRow(row, { month: tempMonth })
          if (m) {
            if (def.autoInject) Object.assign(m, def.autoInject)
            mapped.push(m)
          }
        }
        const rawTotal = (results.data as any[]).length
        const warnings = validateRows(def.table, mapped, results.data as Record<string, string>[])
        const sampleRows = mapped.slice(0, 3)
        setFiles(prev => prev.map(f =>
          f.csvName === fileName
            ? { ...f, rows: mapped, rowCount: mapped.length, rawCount: rawTotal, warnings, sampleRows, status: mapped.length > 0 ? 'ready' : 'warning', warning: mapped.length === 0 ? `0 שורות תקינות מתוך ${rawTotal} (mapRow החזיר null לכולן)` : undefined }
            : f
        ))
      },
    })
  }

  // ─── Parse files (CSV or ZIP) ─────────────────────────────────────────────
  const handleFiles = useCallback((fileList: FileList) => {
    setDone(false)

    Array.from(fileList).forEach(file => {
      const name = file.name.toLowerCase()

      // ── ZIP file: extract CSVs inside ──
      if (name.endsWith('.zip')) {
        file.arrayBuffer().then(buf => {
          const zip = new JSZip()
          zip.loadAsync(buf).then(z => {
            const csvNames = Object.keys(z.files).filter(n => n.toLowerCase().endsWith('.csv') && !n.startsWith('__MACOSX'))
            if (csvNames.length === 0) {
              setFiles(prev => [...prev, { csvName: file.name, tableName: '', label: 'ZIP ריק', status: 'skip', rows: [], rowCount: 0, warning: 'לא נמצאו קבצי CSV ב-ZIP' }])
              return
            }
            for (const csvName of csvNames) {
              const shortName = csvName.includes('/') ? csvName.split('/').pop()! : csvName
              z.files[csvName].async('string').then(text => {
                parseCsvContent(shortName, text)
              })
            }
          }).catch(() => {
            setFiles(prev => [...prev, { csvName: file.name, tableName: '', label: 'שגיאת ZIP', status: 'skip', rows: [], rowCount: 0, warning: 'שגיאה בפתיחת ה-ZIP' }])
          })
        })
        return
      }

      // ── Individual CSV file ──
      if (name.endsWith('.csv')) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const text = e.target?.result as string
          if (text) parseCsvContent(file.name, text)
        }
        reader.readAsText(file, 'UTF-8')
        return
      }

      // ── Unknown file type ──
      setFiles(prev => [...prev, { csvName: file.name, tableName: '', label: 'לא נתמך', status: 'skip', rows: [], rowCount: 0, warning: 'רק קבצי CSV או ZIP נתמכים' }])
    })
  }, [])

  // ─── Check DB ────────────────────────────────────────────────────────────
  async function checkDb(month?: string) {
    setCheckingDb(true)
    const m = month || detectedMonth || new Date().toISOString().slice(0, 7)
    const from = m + '-01'
    const to = monthEnd(m)
    const tables: Record<string, { count: number; label: string; error?: string; sum?: number; sumLabel?: string }> = {}
    const allChecks: { name: string; label: string; dateFilter?: boolean; extra?: Record<string, string>; monthFilter?: boolean; sumField?: string; sumLabel?: string }[] = [
      { name: 'daily_production', label: 'ייצור יומי', dateFilter: true, sumField: 'amount' },
      { name: 'labor', label: 'לייבור', dateFilter: true, extra: { entity_type: 'factory' }, sumField: 'employer_cost', sumLabel: 'עלות מעסיק' },
      { name: 'factory_sales', label: 'מכירות', dateFilter: true, sumField: 'amount' },
      { name: 'factory_b2b_sales', label: 'B2B', dateFilter: true, sumField: 'amount' },
      { name: 'supplier_invoices', label: 'חשבוניות ספקים', dateFilter: true, sumField: 'amount' },
      { name: 'factory_waste', label: 'פחת', dateFilter: true, sumField: 'amount' },
      { name: 'factory_repairs', label: 'תיקונים', dateFilter: true, sumField: 'amount' },
      { name: 'fixed_costs', label: 'עלויות קבועות', monthFilter: true, sumField: 'amount' },
      { name: 'kpi_targets', label: 'יעדי KPI' },
      { name: 'suppliers', label: 'ספקים' },
      // Branch tables
      { name: 'branch_revenue', label: 'הכנסות סניפים', dateFilter: true, sumField: 'amount' },
      { name: 'branch_expenses', label: 'הוצאות סניפים', dateFilter: true, sumField: 'amount' },
      { name: 'branch_labor', label: 'לייבור סניפים', dateFilter: true, sumField: 'employer_cost', sumLabel: 'עלות מעסיק' },
      { name: 'branch_waste', label: 'פחת סניפים', dateFilter: true, sumField: 'amount' },
      { name: 'branch_suppliers', label: 'ספקי סניפים' },
      { name: 'branch_credit_customers', label: 'לקוחות הקפה' },
    ]
    const checks = branchOnly ? allChecks.filter(c => c.name.startsWith('branch_')) : allChecks
    for (const t of checks) {
      // Count query
      let q = supabase.from(t.name).select('*', { count: 'exact', head: true })
      if (t.dateFilter) q = q.gte('date', from).lt('date', to)
      if (t.extra) for (const [k, v] of Object.entries(t.extra)) q = q.eq(k, v)
      if (t.monthFilter) q = q.eq('entity_type', 'factory').eq('month', m)
      const { count, error } = await q
      // Sum query (if applicable)
      let sum: number | undefined
      if (t.sumField && (count ?? 0) > 0) {
        let sq = supabase.from(t.name).select(t.sumField)
        if (t.dateFilter) sq = sq.gte('date', from).lt('date', to)
        if (t.extra) for (const [k, v] of Object.entries(t.extra)) sq = sq.eq(k, v)
        if (t.monthFilter) sq = sq.eq('entity_type', 'factory').eq('month', m)
        const { data: sumData } = await sq
        if (sumData) sum = sumData.reduce((s: number, r: any) => s + Number(r[t.sumField!] || 0), 0)
      }
      tables[t.name] = { count: count ?? 0, label: t.label, error: error?.message, sum, sumLabel: t.sumLabel || (t.sumField ? 'סכום' : undefined) }
    }
    setDbStatus({ month: m, tables })
    setCheckingDb(false)
  }

  // ─── Purge all data ──────────────────────────────────────────────────────────
  async function purgeAllData() {
    setPurgingAll(true)
    setPurgeResult(null)
    const results: { table: string; label: string; ok: boolean; error?: string }[] = []

    // Order matters: supplier_invoices BEFORE suppliers (FK constraint)
    // Use .not('id', 'is', null) as universal filter — matches ALL rows (id is PK, never null)
    const allPurgeList: { table: string; label: string; filter: (q: any) => any }[] = [
      { table: 'supplier_invoices', label: 'חשבוניות ספקים', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'daily_production', label: 'ייצור יומי', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'labor', label: 'לייבור (מפעל)', filter: (q: any) => q.eq('entity_type', 'factory') },
      { table: 'factory_sales', label: 'מכירות מפעל', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'factory_b2b_sales', label: 'מכירות B2B', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'factory_waste', label: 'פחת', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'factory_repairs', label: 'תיקונים', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'fixed_costs', label: 'עלויות קבועות', filter: (q: any) => q.eq('entity_type', 'factory') },
      { table: 'kpi_targets', label: 'יעדי KPI', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'suppliers', label: 'ספקים', filter: (q: any) => q.not('id', 'is', null) },
      // Branch tables
      { table: 'branch_revenue', label: 'הכנסות סניפים', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'branch_expenses', label: 'הוצאות סניפים', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'branch_labor', label: 'לייבור סניפים', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'branch_waste', label: 'פחת סניפים', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'branch_suppliers', label: 'ספקי סניפים', filter: (q: any) => q.not('id', 'is', null) },
      { table: 'branch_credit_customers', label: 'לקוחות הקפה', filter: (q: any) => q.not('id', 'is', null) },
    ]
    const purgeList = branchOnly ? allPurgeList.filter(p => p.table.startsWith('branch_')) : allPurgeList

    for (const item of purgeList) {
      try {
        // Count rows before delete
        let cq = supabase.from(item.table).select('*', { count: 'exact', head: true })
        if (item.table === 'labor') cq = cq.eq('entity_type', 'factory')
        if (item.table === 'fixed_costs') cq = cq.eq('entity_type', 'factory')
        const { count: before } = await cq

        // Delete
        const q = supabase.from(item.table).delete()
        const { error } = await item.filter(q)

        if (error) {
          results.push({ table: item.table, label: item.label, ok: false, error: `${error.message} (${before ?? '?'} rows)` })
        } else {
          results.push({ table: item.table, label: `${item.label} (${before ?? 0} נמחקו)`, ok: true })
        }
      } catch (e: any) {
        results.push({ table: item.table, label: item.label, ok: false, error: e.message || 'Unknown error' })
      }
    }

    setPurgeResult(results)
    setPurgingAll(false)
    setConfirmPurge(false)
    setDbStatus(null)
    setFiles([])
    setDone(false)
  }

  // ─── Drop ──────────────────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  // ─── Import ────────────────────────────────────────────────────────────────
  async function importAll() {
    setImporting(true)
    const readyFiles = files.filter(f => f.status === 'ready' && f.rows.length > 0)
    const totalRows = readyFiles.reduce((s, f) => s + f.rows.length, 0)
    let globalCurrent = 0

    // Auto-detect months from data dates
    const allMonths = detectAllMonths(readyFiles)
    const dataMonth = detectMonth(readyFiles) // fallback for fixed_costs without month

    // Ensure suppliers imported before supplier_invoices (FK dependency)
    readyFiles.sort((a, b) => {
      if (a.tableName === 'suppliers') return -1
      if (b.tableName === 'suppliers') return 1
      return 0
    })

    // Update fixed costs month — keep original if valid, otherwise use detected month as fallback
    for (const fm of readyFiles) {
      if (fm.csvName.toLowerCase().includes('fixed_costs')) {
        fm.rows = fm.rows.map(r => ({
          ...r,
          month: r.month && /^\d{4}-\d{2}$/.test(r.month) ? r.month : dataMonth,
        }))
      }
    }

    for (const fm of readyFiles) {
      // ─── Resolve supplier_name → supplier_id for invoices ──────────────
      if (fm.tableName === 'supplier_invoices') {
        const uniqueNames = new Set<string>()
        for (const row of fm.rows) {
          if (row.supplier_name) uniqueNames.add(row.supplier_name)
        }
        // Fetch existing suppliers
        const { data: existingSuppliers } = await supabase.from('suppliers').select('id, name')
        const nameToId: Record<string, number> = {}
        if (existingSuppliers) {
          for (const s of existingSuppliers) nameToId[s.name] = s.id
        }
        // Auto-create missing suppliers
        for (const name of uniqueNames) {
          if (!nameToId[name]) {
            const { data: newSup } = await supabase.from('suppliers').insert({ name }).select('id').single()
            if (newSup) nameToId[name] = newSup.id
          }
        }
        // Replace supplier_name → supplier_id in each row
        fm.rows = fm.rows.map(row => {
          const { supplier_name, ...rest } = row
          const supplier_id = nameToId[supplier_name]
          if (!supplier_id) return null
          return { ...rest, supplier_id }
        }).filter(Boolean) as Record<string, any>[]
      }

      setProgress({ current: globalCurrent, total: totalRows, label: fm.label })
      setFiles(prev => prev.map(f => f.csvName === fm.csvName ? { ...f, status: 'importing' as const } : f))

      const defEntry = Object.values(FILE_MAP).find(d => d.table === fm.tableName)
      if (!defEntry) continue

      let deleteError = ''

      // Clear existing data if toggle is ON — clear ALL months found in data
      if (clearExisting) {
        if (fm.tableName === 'kpi_targets') {
          const delRes = await supabase.from('kpi_targets').delete().neq('department', '__never__')
          if (delRes?.error) {
            deleteError = `מחיקה: ${delRes.error.message}`
            console.error(`[Delete ${fm.tableName}]`, delRes.error)
          }
        } else if (fm.tableName === 'suppliers') {
          // Don't delete suppliers — just skip dupes
        } else {
          for (const m of allMonths) {
            const mFrom = m + '-01'
            const mTo = monthEnd(m)
            let delRes: { error: any } | null = null
            if (fm.tableName === 'labor') {
              delRes = await supabase.from('labor').delete().eq('entity_type', 'factory').gte('date', mFrom).lt('date', mTo)
            } else if (fm.tableName === 'fixed_costs') {
              delRes = await supabase.from('fixed_costs').delete().eq('entity_type', 'factory').eq('month', m)
            } else if (defEntry.hasDate) {
              delRes = await supabase.from(fm.tableName).delete().gte('date', mFrom).lt('date', mTo)
            }
            if (delRes?.error) {
              deleteError = `מחיקה (${m}): ${delRes.error.message}`
              console.error(`[Delete ${fm.tableName} ${m}]`, delRes.error)
            }
          }
        }
      }

      // Fetch existing for dupe check (after clearing)
      const existingKeys = new Set<string>()
      try {
        let q = supabase.from(fm.tableName).select('*')
        if (fm.tableName === 'labor') q = q.eq('entity_type', 'factory')
        const { data } = await q.limit(10000)
        if (data) data.forEach((rec: any) => existingKeys.add(defEntry.dupeKey(rec)))
      } catch { /* ignore */ }

      let inserted = 0, skipped = 0, errors = 0, firstError = deleteError
      const BATCH = 50

      for (let i = 0; i < fm.rows.length; i += BATCH) {
        const batch = fm.rows.slice(i, i + BATCH)
        const toInsert: Record<string, any>[] = []

        for (const row of batch) {
          const key = defEntry.dupeKey(row)
          if (existingKeys.has(key)) { skipped++ }
          else {
            // Strip internal tracking fields before DB insert
            const { _empCostSource, ...cleanRow } = row
            toInsert.push(cleanRow); existingKeys.add(key)
          }
        }

        if (toInsert.length > 0) {
          const { error } = await supabase.from(fm.tableName).insert(toInsert)
          if (error) {
            // Row-by-row fallback
            for (const row of toInsert) {
              const { error: re } = await supabase.from(fm.tableName).insert(row)
              if (re) {
                errors++
                if (!firstError) firstError = `${re.message} | ${re.details || ''} | ${re.hint || ''}`
                console.error(`[Import ${fm.tableName}]`, re.message, re.details, JSON.stringify(row))
              } else { inserted++ }
            }
          } else {
            inserted += toInsert.length
          }
        }

        globalCurrent += batch.length
        setProgress({ current: globalCurrent, total: totalRows, label: fm.label })
      }

      const nullRows = (fm.rawCount || fm.rows.length) - fm.rows.length
      setFiles(prev => prev.map(f =>
        f.csvName === fm.csvName ? { ...f, status: 'done' as const, result: { inserted, skipped, errors, nullRows, deleteError: deleteError || undefined, firstError: firstError || undefined } } : f
      ))
    }

    setImporting(false); setDone(true)
    // Auto-verify database state after import
    checkDb(dataMonth)
  }

  // ─── Computed ──────────────────────────────────────────────────────────────
  const readyFiles = files.filter(f => f.status === 'ready' && f.rows.length > 0)
  const totalReady = readyFiles.reduce((s, f) => s + f.rows.length, 0)
  const canImport = readyFiles.length > 0 && !importing
  const totalInserted = files.reduce((s, f) => s + (f.result?.inserted || 0), 0)
  const totalSkipped = files.reduce((s, f) => s + (f.result?.skipped || 0), 0)
  const detectedMonth = files.length > 0 ? detectMonth(files) : ''

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* Purge all data */}
      <Card className="shadow-sm mb-2" style={{ border: '2px solid #fecdd3', background: '#fff5f5' }}>
        <CardContent className="p-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#991b1b' }}>🗑️ מחיקת כל הנתונים</div>
            <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '2px' }}>
              {branchOnly
                ? 'מוחק את כל נתוני הסניפים (הכנסות, הוצאות, לייבור, פחת, ספקים, לקוחות הקפה)'
                : 'מוחק את כל הנתונים מכל הטבלאות (ייצור, מכירות, לייבור, פחת, תיקונים, ספקים, עלויות קבועות, KPI)'}
            </div>
          </div>
          {!confirmPurge ? (
            <button onClick={() => setConfirmPurge(true)} disabled={purgingAll}
              style={{ background: '#fb7185', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Trash2 size={16} /> מחק הכל
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#dc2626' }}>בטוח? לא ניתן לשחזר!</span>
              <button onClick={purgeAllData} disabled={purgingAll}
                style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '14px', fontWeight: '700', cursor: purgingAll ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {purgingAll ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> מוחק...</> : '✓ כן, מחק הכל'}
              </button>
              <button onClick={() => setConfirmPurge(false)}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '10px 16px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                ביטול
              </button>
            </div>
          )}
        </div>
        </CardContent>
      </Card>

      {/* Purge result */}
      {purgeResult && (
        <Card className="shadow-sm mb-2" style={{ border: '2px solid #86efac', background: '#f0fdf4' }}>
          <CardContent className="p-6">
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#065f46', marginBottom: '10px' }}>
            ✅ מחיקה הושלמה
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px' }}>
            {purgeResult.map(r => (
              <div key={r.table} style={{
                background: r.ok ? '#ecfdf5' : '#fff1f2', border: `1px solid ${r.ok ? '#86efac' : '#fecdd3'}`,
                borderRadius: '8px', padding: '8px 10px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '16px' }}>{r.ok ? '✓' : '✗'}</div>
                <div style={{ fontSize: '11px', fontWeight: '600', color: r.ok ? '#065f46' : '#991b1b' }}>{r.label}</div>
                {r.error && <div style={{ fontSize: '10px', color: '#fb7185', marginTop: '2px' }}>{r.error}</div>}
              </div>
            ))}
          </div>
          <div style={{ fontSize: '12px', color: '#34d399', fontWeight: '600', marginTop: '10px' }}>
            ניתן להעלות קבצים מחדש למטה ↓
          </div>
          </CardContent>
        </Card>
      )}

      {/* Import mode toggle */}
      {files.length === 0 && (
        <div style={{ display: 'flex', gap: '0', marginBottom: '0' }}>
          <button onClick={() => { setImportMode('zip'); setSelectedTable(null) }}
            style={{
              flex: 1, padding: '14px 20px', border: 'none', cursor: 'pointer',
              borderRadius: '12px 0 0 12px', fontSize: '15px', fontWeight: '700',
              background: importMode === 'zip' ? '#0f172a' : '#f1f5f9',
              color: importMode === 'zip' ? 'white' : '#64748b',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'all 0.2s',
            }}>
            <Download size={18} /> ייבוא ZIP מלא
          </button>
          <button onClick={() => { setImportMode('single'); setSelectedTable(null) }}
            style={{
              flex: 1, padding: '14px 20px', border: 'none', cursor: 'pointer',
              borderRadius: '0 12px 12px 0', fontSize: '15px', fontWeight: '700',
              background: importMode === 'single' ? '#0f172a' : '#f1f5f9',
              color: importMode === 'single' ? 'white' : '#64748b',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'all 0.2s',
            }}>
            <FileText size={18} /> החלפת קובץ בודד
          </button>
        </div>
      )}

      {/* ZIP mode: Drop zone */}
      {files.length === 0 && importMode === 'zip' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            background: dragOver ? '#eff6ff' : '#fafafa',
            border: `2.5px dashed ${dragOver ? '#818cf8' : '#cbd5e1'}`,
            borderRadius: '16px', padding: '60px 40px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <Upload size={48} color={dragOver ? '#818cf8' : '#94a3b8'} style={{ marginBottom: '16px' }} />
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>
            גרור קבצי CSV או ZIP לכאן
          </div>
          <div style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '20px' }}>
            או לחץ לבחירת קבצים · ניתן להעלות ZIP עם כל הקבצים, או CSVs בודדים
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
            {Object.keys(FILE_MAP)
              .filter(key => !branchOnly || BRANCH_FILE_KEYS.includes(key))
              .map(key => (
              <span key={key} style={{ background: '#f1f5f9', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', color: '#64748b' }}>
                {key}.csv
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Single file mode: Table selection grid */}
      {files.length === 0 && importMode === 'single' && (
        <Card className="shadow-sm"><CardContent className="p-6">
          <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', marginBottom: '6px' }}>
            בחר טבלה להחלפה
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
            בחר את הטבלה שברצונך לעדכן — הנתונים הקיימים יימחקו ויוחלפו בקובץ החדש
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
            {Object.entries(FILE_MAP)
              .filter(([key]) => !branchOnly || BRANCH_FILE_KEYS.includes(key))
              .map(([key, def]) => (
              <div key={key}
                onClick={() => { setSelectedTable(key); singleFileRef.current?.click() }}
                style={{
                  background: selectedTable === key ? '#eff6ff' : '#fafafa',
                  border: `2px solid ${selectedTable === key ? '#818cf8' : '#e2e8f0'}`,
                  borderRadius: '12px', padding: '16px 12px', textAlign: 'center',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                <FileText size={24} color={selectedTable === key ? '#818cf8' : '#94a3b8'} style={{ marginBottom: '8px' }} />
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>{def.label}</div>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px', direction: 'ltr' as const }}>{key}.csv</div>
              </div>
            ))}
          </div>
          <input ref={singleFileRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files && selectedTable) {
                setClearExisting(true)
                handleFiles(e.target.files)
              }
              e.target.value = ''
            }} />
        </CardContent></Card>
      )}

      <input ref={fileRef} type="file" accept=".csv,.zip" multiple style={{ display: 'none' }}
        onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />

      {/* File list */}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Header */}
          <Card className="shadow-sm"><CardContent className="p-6" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
                {done ? `יובאו ${totalInserted.toLocaleString()} שורות` : `${readyFiles.length} קבצים מוכנים לייבוא`}
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>
                {done
                  ? `${totalSkipped > 0 ? `דולגו ${totalSkipped} כפילויות · ` : ''}${files.filter(f => f.status === 'done').length} טבלאות`
                  : `${totalReady.toLocaleString()} שורות סה"כ`}
              </div>
              {detectedMonth && !done && (
                <div style={{ fontSize: '13px', color: '#818cf8', fontWeight: '600', marginTop: '4px' }}>
                  חודש נתונים: {new Date(detectedMonth + '-01').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              {!done && !importing && importMode === 'zip' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#64748b', cursor: 'pointer' }}>
                  <input type="checkbox" checked={clearExisting} onChange={e => setClearExisting(e.target.checked)}
                    style={{ accentColor: '#fb7185', width: '16px', height: '16px' }} />
                  <Trash2 size={14} color={clearExisting ? '#fb7185' : '#94a3b8'} />
                  נקה נתונים קודמים
                </label>
              )}
              {!done && !importing && importMode === 'single' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#fb7185', fontWeight: '600' }}>
                  <Trash2 size={14} color="#fb7185" />
                  הנתונים הקיימים יוחלפו
                </span>
              )}
              <button onClick={() => checkDb()} disabled={checkingDb}
                style={{ background: '#dbeafe', color: '#2563eb', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: checkingDb ? 'default' : 'pointer', opacity: checkingDb ? 0.6 : 1 }}>
                {checkingDb ? '⏳ בודק...' : '🔍 בדוק מסד נתונים'}
              </button>
              <button onClick={() => { setFiles([]); setDone(false); setDbStatus(null); setSelectedTable(null) }}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                איפוס
              </button>
              {!done && importMode === 'zip' && (
                <button onClick={() => fileRef.current?.click()}
                  style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                  + הוסף קבצים
                </button>
              )}
              {!done && (
                <button onClick={importAll} disabled={!canImport}
                  style={{
                    background: canImport ? '#0f172a' : '#e2e8f0', color: canImport ? 'white' : '#94a3b8',
                    border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700',
                    cursor: canImport ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                  {importing
                    ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> מייבא...</>
                    : importMode === 'single'
                      ? <><Download size={18} /> החלף {readyFiles.length > 0 ? readyFiles[0].label : 'נתונים'}</>
                      : <><Download size={18} /> ייבא הכל</>
                  }
                </button>
              )}
            </div>
          </CardContent></Card>

          {/* Progress */}
          {importing && progress.total > 0 && (
            <Card className="shadow-sm"><CardContent className="p-6">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#64748b' }}>
                <span>{progress.label}</span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
              <div style={{ background: '#e2e8f0', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                <div style={{
                  background: 'linear-gradient(90deg, #818cf8, #c084fc)', height: '100%', borderRadius: '8px',
                  width: `${(progress.current / progress.total) * 100}%`, transition: 'width 0.3s',
                }} />
              </div>
            </CardContent></Card>
          )}

          {/* Files */}
          {files.map((fm, i) => {
            const color = fm.status === 'done' ? '#34d399' : fm.status === 'error' ? '#fb7185' : fm.status === 'skip' ? '#94a3b8' : fm.status === 'warning' ? '#fbbf24' : '#818cf8'
            return (
              <Card key={fm.csvName + i} className="shadow-sm" style={{
                borderRight: `4px solid ${color}`,
                opacity: fm.status === 'skip' ? 0.6 : 1,
              }}><CardContent className="p-4 px-5">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {fm.status === 'done' && <CheckCircle size={20} color="#34d399" />}
                  {fm.status === 'error' && <XCircle size={20} color="#fb7185" />}
                  {fm.status === 'skip' && <XCircle size={20} color="#94a3b8" />}
                  {fm.status === 'warning' && <AlertCircle size={20} color="#fbbf24" />}
                  {fm.status === 'importing' && <Loader2 size={20} color="#818cf8" style={{ animation: 'spin 1s linear infinite' }} />}
                  {fm.status === 'ready' && <FileText size={20} color="#818cf8" />}

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{fm.csvName}</span>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>→</span>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>{fm.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {fm.rowCount > 0 && (
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                          {fm.rowCount} שורות תקינות
                          {fm.rawCount && fm.rawCount !== fm.rowCount && (
                            <span style={{ color: '#fbbf24' }}> (מתוך {fm.rawCount} ב-CSV, {fm.rawCount - fm.rowCount} נדחו)</span>
                          )}
                        </span>
                      )}
                      {fm.warning && <span style={{ fontSize: '12px', color: '#fbbf24', fontWeight: '600' }}>{fm.warning}</span>}
                      {fm.result && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '12px', color: '#34d399', fontWeight: '600' }}>
                            {fm.result.inserted} יובאו
                            {fm.result.skipped > 0 && ` · ${fm.result.skipped} כפילויות`}
                            {fm.result.errors > 0 && <span style={{ color: '#fb7185' }}> · {fm.result.errors} שגיאות</span>}
                            {fm.result.nullRows != null && fm.result.nullRows > 0 && (
                              <span style={{ color: '#fbbf24' }}> · {fm.result.nullRows} שורות נדחו</span>
                            )}
                          </span>
                          {fm.result.deleteError && (
                            <span style={{ fontSize: '11px', color: '#fb7185', fontWeight: '700' }}>
                              ⚠️ {fm.result.deleteError}
                            </span>
                          )}
                          {fm.result.firstError && !fm.result.deleteError && (
                            <span style={{ fontSize: '11px', color: '#fb7185', maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={fm.result.firstError}>
                              {fm.result.firstError.slice(0, 100)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Pre-import warnings */}
                    {fm.warnings && fm.warnings.length > 0 && !fm.result && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                        {fm.warnings.map((w, wi) => (
                          <span key={wi} style={{ fontSize: '11px', color: '#fbbf24', fontWeight: '500' }}>⚠️ {w}</span>
                        ))}
                      </div>
                    )}
                    {/* Sample rows preview */}
                    {fm.sampleRows && fm.sampleRows.length > 0 && fm.status === 'ready' && (
                      <details style={{ marginTop: '6px' }}>
                        <summary style={{ fontSize: '11px', color: '#64748b', cursor: 'pointer' }}>
                          תצוגה מקדימה ({fm.sampleRows.length} שורות לדוגמה)
                        </summary>
                        <div style={{ marginTop: '4px', fontSize: '10px', fontFamily: 'monospace', direction: 'ltr' as const, background: '#f8fafc', padding: '8px', borderRadius: '8px', overflow: 'auto', maxHeight: '100px' }}>
                          {fm.sampleRows.map((row, ri) => (
                            <div key={ri} style={{ marginBottom: '3px', whiteSpace: 'nowrap' }}>{JSON.stringify(row)}</div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>

                  {!importing && fm.status !== 'done' && (
                    <button onClick={() => setFiles(prev => prev.filter(f => f.csvName !== fm.csvName))}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                      <XCircle size={16} color="#cbd5e1" />
                    </button>
                  )}
                </div>
              </CardContent></Card>
            )
          })}

          {/* Done */}
          {done && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm" style={{ background: '#f0fdf4', borderTop: '3px solid #34d399', textAlign: 'center' }}>
              <CardContent className="p-8">
              <CheckCircle size={40} color="#34d399" style={{ marginBottom: '12px' }} />
              <div style={{ fontSize: '20px', fontWeight: '800', color: '#065f46', marginBottom: '8px' }}>הייבוא הושלם בהצלחה!</div>
              <div style={{ fontSize: '15px', color: '#34d399', fontWeight: '600' }}>
                יובאו {totalInserted.toLocaleString()} שורות{totalSkipped > 0 && ` · דולגו ${totalSkipped} כפילויות`}
              </div>
              </CardContent>
            </Card>
            </motion.div>
          )}

          {/* DB Status Verification */}
          {dbStatus && (
            <Card className="shadow-sm" style={{ border: '2px solid #818cf8', background: '#fafcff' }}>
              <CardContent className="p-6">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>
                  🔍 מצב מסד נתונים — {new Date(dbStatus.month + '-01').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
                </div>
                <button onClick={() => setDbStatus(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#94a3b8' }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
                {Object.entries(dbStatus.tables).map(([table, info]) => (
                  <div key={table} style={{
                    background: info.error ? '#fff1f2' : info.count > 0 ? '#f0fdf4' : '#fffbeb',
                    border: `1.5px solid ${info.error ? '#fecdd3' : info.count > 0 ? '#86efac' : '#fde68a'}`,
                    borderRadius: '12px', padding: '12px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: '800', color: info.error ? '#fb7185' : info.count > 0 ? '#34d399' : '#fbbf24' }}>
                      {info.error ? '✗' : info.count}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginTop: '4px' }}>{info.label}</div>
                    {info.sum !== undefined && info.sum > 0 && (
                      <div style={{ fontSize: '10px', color: '#374151', fontWeight: '600', marginTop: '2px' }}>
                        {info.sumLabel || 'סכום'}: ₪{Math.round(info.sum).toLocaleString()}
                      </div>
                    )}
                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', direction: 'ltr' }}>{table}</div>
                    {info.error && <div style={{ fontSize: '10px', color: '#fb7185', marginTop: '4px' }}>{info.error}</div>}
                  </div>
                ))}
              </div>
              {Object.values(dbStatus.tables).every(t => t.count === 0 && !t.error) && (
                <div style={{ marginTop: '14px', padding: '12px', background: '#fef3c7', borderRadius: '8px', fontSize: '13px', color: '#92400e', fontWeight: '600' }}>
                  ⚠️ כל הטבלאות ריקות לחודש זה! ודא שהקבצים הועלו בהצלחה ושאין שגיאות בייבוא.
                </div>
              )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
