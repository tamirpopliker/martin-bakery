import { useState } from 'react'
import { motion } from 'framer-motion'
import { supabase, monthEnd } from '../lib/supabase'
import JSZip from 'jszip'
import { Download, CheckCircle, Loader2, FileText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

// ─── Types ───────────────────────────────────────────────────────────────────
interface TableExport {
  fileName: string
  label: string
  query: (from: string | null, to: string | null) => Promise<Record<string, any>[]>
  columns: string[]
  mapRow: (row: Record<string, any>) => (string | number | boolean | null)[]
  rowCount?: number
}

// ─── Table export configs ────────────────────────────────────────────────────
const EXPORT_TABLES: TableExport[] = [
  {
    fileName: 'factory_daily_production.csv',
    label: 'ייצור יומי',
    columns: ['date', 'department', 'production_amount'],
    query: async (from, to) => {
      let q = supabase.from('daily_production').select('*').order('date')
      if (from && to) q = q.gte('date', from).lt('date', to)
      const { data } = await q
      return data || []
    },
    mapRow: (r) => [r.date, r.department, r.amount ?? r.quantity ?? 0],
  },
  {
    fileName: 'factory_labor.csv',
    label: 'לייבור מחלקות',
    columns: ['date', 'employee_name', 'department', 'hours', 'gross_salary', 'employer_cost', 'notes'],
    query: async (from, to) => {
      let q = supabase.from('labor').select('*').eq('entity_type', 'factory').order('date')
      if (from && to) q = q.gte('date', from).lt('date', to)
      const { data } = await q.limit(10000)
      return data || []
    },
    mapRow: (r) => {
      const hours = (r.hours_100 || 0) + (r.hours_125 || 0) + (r.hours_150 || 0)
      const empCost = r.employer_cost || Math.round((r.gross_salary || 0) * 1.3 * 100) / 100
      return [r.date, r.employee_name, r.entity_id, round2(hours), round2(r.gross_salary), round2(empCost), '']
    },
  },
  {
    fileName: 'factory_waste.csv',
    label: 'פחת',
    columns: ['date', 'department', 'category', 'amount', 'description'],
    query: async (from, to) => {
      let q = supabase.from('factory_waste').select('*').order('date')
      if (from && to) q = q.gte('date', from).lt('date', to)
      const { data } = await q
      return data || []
    },
    mapRow: (r) => [r.date, r.department, r.category || '', round2(r.amount), r.description || ''],
  },
  {
    fileName: 'factory_repairs.csv',
    label: 'תיקונים',
    columns: ['date', 'department', 'description', 'amount', 'type'],
    query: async (from, to) => {
      let q = supabase.from('factory_repairs').select('*').order('date')
      if (from && to) q = q.gte('date', from).lt('date', to)
      const { data } = await q
      return data || []
    },
    mapRow: (r) => [r.date, r.department, r.description || '', round2(r.amount), r.type || ''],
  },
  {
    fileName: 'factory_packaging.csv',
    label: 'אריזה',
    columns: ['date', 'product_name', 'quantity', 'unit', 'notes'],
    query: async (from, to) => {
      let q = supabase.from('daily_production').select('*').eq('department', 'packaging').order('date')
      if (from && to) q = q.gte('date', from).lt('date', to)
      const { data } = await q
      return data || []
    },
    mapRow: (r) => [r.date, r.product_name || '', r.quantity || 0, r.unit || '', r.notes || ''],
  },
  {
    fileName: 'factory_kpi_targets.csv',
    label: 'יעדי KPI',
    columns: ['department', 'labor_pct', 'waste_pct', 'repairs_pct', 'gross_profit_pct', 'production_pct'],
    query: async () => {
      const { data } = await supabase.from('kpi_targets').select('*')
      return data || []
    },
    mapRow: (r) => [r.department, r.labor_pct, r.waste_pct, r.repairs_pct, r.gross_profit_pct, r.production_pct],
  },
  {
    fileName: 'factory_sales.csv',
    label: 'מכירות מפעל',
    columns: ['date', 'department', 'customer', 'amount', 'doc_number', 'notes'],
    query: async (from, to) => {
      let q = supabase.from('factory_sales').select('*').order('date')
      if (from && to) q = q.gte('date', from).lt('date', to)
      const { data } = await q
      return data || []
    },
    mapRow: (r) => [r.date, r.department, r.customer || '', round2(r.amount), r.doc_number || '', r.notes || ''],
  },
  {
    fileName: 'factory_other_sales.csv',
    label: 'מכירות B2B/שונות',
    columns: ['date', 'sale_type', 'customer', 'amount', 'doc_number', 'notes'],
    query: async (from, to) => {
      let q = supabase.from('factory_b2b_sales').select('*').order('date')
      if (from && to) q = q.gte('date', from).lt('date', to)
      const { data } = await q
      return data || []
    },
    mapRow: (r) => [r.date, r.sale_type, r.customer || '', round2(r.amount), r.doc_number || '', r.notes || ''],
  },
  {
    fileName: 'factory_suppliers.csv',
    label: 'ספקים',
    columns: ['name'],
    query: async () => {
      const { data } = await supabase.from('suppliers').select('*').order('name')
      return data || []
    },
    mapRow: (r) => [r.name],
  },
  {
    fileName: 'factory_supplier_invoices.csv',
    label: 'חשבוניות ספקים',
    columns: ['date', 'supplier_name', 'amount', 'doc_number', 'category', 'notes'],
    query: async (from, to) => {
      // Fetch suppliers for ID→name resolution
      const { data: suppliers } = await supabase.from('suppliers').select('id, name')
      const idToName: Record<number, string> = {}
      if (suppliers) suppliers.forEach(s => { idToName[s.id] = s.name })
      let q = supabase.from('supplier_invoices').select('*').order('date')
      if (from && to) q = q.gte('date', from).lt('date', to)
      const { data } = await q
      return (data || []).map(r => ({ ...r, supplier_name: idToName[r.supplier_id] || '' }))
    },
    mapRow: (r) => [r.date, r.supplier_name || '', round2(r.amount), r.doc_number || '', r.doc_type || '', r.notes || ''],
  },
  {
    fileName: 'factory_fixed_costs.csv',
    label: 'עלויות קבועות',
    columns: ['name', 'amount', 'month', 'entity_type'],
    query: async (from, _to) => {
      let q = supabase.from('fixed_costs').select('*').eq('entity_type', 'factory').order('name')
      if (from) q = q.eq('month', from.slice(0, 7))
      const { data } = await q
      return data || []
    },
    mapRow: (r) => [r.name, round2(r.amount), r.month, r.entity_type],
  },
  {
    fileName: 'factory_packaging_products.csv',
    label: 'מוצרי אריזה',
    columns: ['name', 'unit', 'notes', 'active'],
    query: async () => {
      // Try packaging_products table, ignore if doesn't exist
      try {
        const { data } = await supabase.from('packaging_products').select('*').order('name')
        return data || []
      } catch { return [] }
    },
    mapRow: (r) => [r.name, r.unit || '', r.notes || '', r.active ?? true],
  },
  {
    fileName: 'factory_customers.csv',
    label: 'לקוחות',
    columns: ['name', 'phone', 'type', 'credit_limit', 'notes', 'active'],
    query: async () => {
      // TODO: הטבלה 'customers' לא קיימת ב-DB (רק b2b_customers,
      // branch_credit_customers, internal_customer_map). הקריאה הזו
      // תמיד מחזירה [] דרך ה-try/catch. להחליף ל-branch_credit_customers
      // או להסיר את הסעיף כולו. (מזוהה 2026-04-21 במהלך RLS שלב 1.)
      try {
        const { data } = await supabase.from('customers').select('*').order('name')
        return data || []
      } catch { return [] }
    },
    mapRow: (r) => [r.name, r.phone || '', r.type || '', r.credit_limit || 0, r.notes || '', r.active ?? true],
  },
]

function round2(n: any): number {
  const v = parseFloat(n)
  return isNaN(v) ? 0 : Math.round(v * 100) / 100
}

// ─── CSV builder with BOM ────────────────────────────────────────────────────
function buildCsv(columns: string[], rows: (string | number | boolean | null)[][]): string {
  const BOM = '\uFEFF'
  const header = columns.join(',')
  const body = rows.map(row =>
    row.map(cell => {
      if (cell === null || cell === undefined) return ''
      if (typeof cell === 'boolean') return cell ? 'true' : 'false'
      const s = String(cell)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    }).join(',')
  ).join('\n')
  return BOM + header + '\n' + body
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── Component ───────────────────────────────────────────────────────────────
export default function DataExport() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [allTime, setAllTime] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [results, setResults] = useState<{ fileName: string; label: string; count: number }[] | null>(null)
  const [totalRecords, setTotalRecords] = useState(0)

  async function doExport() {
    setExporting(true)
    setResults(null)

    const zip = new JSZip()
    const from = allTime ? null : `${month}-01`
    const to = allTime ? null : monthEnd(month)
    const res: { fileName: string; label: string; count: number }[] = []
    let total = 0

    for (const tbl of EXPORT_TABLES) {
      try {
        const data = await tbl.query(from, to)
        const mappedRows = data.map(r => tbl.mapRow(r))
        const csv = buildCsv(tbl.columns, mappedRows)
        zip.file(tbl.fileName, csv)
        res.push({ fileName: tbl.fileName, label: tbl.label, count: data.length })
        total += data.length
      } catch {
        res.push({ fileName: tbl.fileName, label: tbl.label, count: 0 })
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const zipName = allTime ? 'martin_factory_all.zip' : `martin_factory_${month}.zip`

    // Download
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = zipName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    setResults(res)
    setTotalRecords(total)
    setExporting(false)
  }

  return (
    <div className="page-container" style={{ direction: 'rtl', fontFamily: "'Segoe UI', Arial, sans-serif", display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Controls */}
      <motion.div variants={fadeIn} initial="hidden" animate="visible">
      <Card className="shadow-sm">
        <CardContent className="p-6">
        <h2 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>ייצוא נתונים לקובץ ZIP</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={allTime} onChange={e => setAllTime(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: '#6366f1' }} />
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>כל הזמנים</span>
          </label>

          {!allTime && (
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', fontFamily: 'inherit', background: 'white' }} />
          )}

          <button onClick={doExport} disabled={exporting}
            style={{
              background: exporting ? '#94a3b8' : '#6366f1', color: 'white',
              border: 'none', borderRadius: '10px', padding: '12px 32px',
              fontSize: '15px', fontWeight: '700', cursor: exporting ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto',
            }}>
            {exporting
              ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> מייצא...</>
              : <><Download size={18} /> ייצוא נתונים לקובץ ZIP</>
            }
          </button>
        </div>

        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
          מייצא {EXPORT_TABLES.length} טבלאות · UTF-8 BOM · כל קובץ CSV נפרד ב-ZIP
        </div>
        </CardContent>
      </Card>
      </motion.div>

      {/* Results */}
      {results && (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <Card className="shadow-sm">
          <CardContent className="p-6">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <CheckCircle size={22} color="#34d399" />
            <div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#065f46' }}>הייצוא הושלם!</div>
              <div style={{ fontSize: '13px', color: '#34d399', fontWeight: '600' }}>
                מייצא {EXPORT_TABLES.length} טבלאות · {totalRecords.toLocaleString(undefined, { maximumFractionDigits: 2 })} רשומות סה"כ · {allTime ? 'כל הזמנים' : month}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {results.map(r => (
              <div key={r.fileName} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 12px', borderBottom: '1px solid #f8fafc',
              }}>
                {r.count > 0
                  ? <CheckCircle size={14} color="#34d399" />
                  : <FileText size={14} color="#94a3b8" />
                }
                <span style={{ flex: 1, fontSize: '13px', fontWeight: '600', color: r.count > 0 ? '#374151' : '#94a3b8' }}>
                  {r.label}
                </span>
                <span style={{ fontSize: '12px', color: r.count > 0 ? '#34d399' : '#94a3b8', fontWeight: '600' }}>
                  {r.count > 0 ? `${r.count} רשומות` : 'ריק'}
                </span>
              </div>
            ))}
          </div>
          </CardContent>
        </Card>
        </motion.div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
