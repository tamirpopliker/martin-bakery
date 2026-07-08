import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept, fetchFactoryTrends, fetchInternalSalesByDeptTrend, getFixedCostTotal } from '../lib/supabase'
import type { GlobalEmployee, MonthTrend, InternalDeptTrend } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { usePeriod } from '../lib/PeriodContext'
import { getMonthsInRange } from '../lib/period'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// ─── Animation ────────────────────────────────────────────────────────────────
const fadeIn = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props { onBack: () => void }
type Dept = 'creams' | 'dough' | 'packaging' | 'cleaning'

interface KpiTargets {
  labor_pct: number; waste_pct: number; repairs_pct: number
  gross_profit_pct: number; production_pct: number; operating_profit_pct: number
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEPTS: Dept[] = ['creams', 'dough', 'packaging', 'cleaning']

const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })
const pct  = (a: number, b: number) => b > 0 ? (a / b) * 100 : 0

const DEFAULT_TARGETS: KpiTargets = { labor_pct: 25, waste_pct: 5, repairs_pct: 3, gross_profit_pct: 40, production_pct: 45, operating_profit_pct: 30 }

// ─── DiffBadge ────────────────────────────────────────────────────────────────
function DiffBadge({ current, previous, inverse }: { current: number; previous: number; inverse?: boolean }) {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return <TrendingUp size={12} className="text-emerald-400" />
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const isUp = pct > 0
  const isGood = inverse ? !isUp : isUp
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${isGood ? 'text-emerald-500' : 'text-rose-500'}`}>
      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

// ─── ProgressRow ──────────────────────────────────────────────────────────────
function ProgressRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-medium text-slate-600">{label}</span>
        <span className="text-[13px] font-bold text-slate-700">{fmtM(value)}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${w}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FactoryDashboard({ onBack }: Props) {
  const { period, setPeriod, from, to, monthKey, comparisonPeriod } = usePeriod()
  const [loading, setLoading] = useState(true)

  // ─── State ──────────────────────────────────────────────────────────────
  // Sales
  const [salesCreams, setSalesCreams]   = useState(0)
  const [salesDough, setSalesDough]     = useState(0)
  const [salesB2B, setSalesB2B]         = useState(0)
  const [salesMisc, setSalesMisc]       = useState(0)
  const [salesPdfExt, setSalesPdfExt]   = useState(0)
  const [salesInternal, setSalesInternal] = useState(0)

  // Suppliers
  const [_supplierRows, setSupplierRows] = useState<{ name: string; total: number }[]>([])
  const [totalSuppliers, setTotalSuppliers] = useState(0)

  // Waste per dept
  const [wasteDept, setWasteDept] = useState<Record<Dept, number>>({ creams: 0, dough: 0, packaging: 0, cleaning: 0 })

  // Production per dept
  const [prodDept, setProdDept] = useState<Record<string, number>>({ creams: 0, dough: 0, packaging: 0, cleaning: 0 })

  // Internal sales broken down by department (rollup of internal_sale_items).
  // Keys are Hebrew because that's how the data is stored in internal_sale_items.department
  // ('קרמים' / 'בצקים' / 'אריזה' / 'ניקיון' / 'שונות'); items without a tag default to 'אחר'.
  const [internalByDept, setInternalByDept] = useState<Record<string, number>>({
    'קרמים': 0, 'בצקים': 0, 'אריזה': 0, 'ניקיון': 0, 'שונות': 0, 'אחר': 0,
  })

  // Repairs per dept
  const [repairsDept, setRepairsDept] = useState<Record<Dept, number>>({ creams: 0, dough: 0, packaging: 0, cleaning: 0 })

  // Labor per dept (timeclock estimate — fallback source)
  const [laborDept, setLaborDept] = useState<Record<Dept, { hours: number; gross: number; employer: number }>>({
    creams: { hours: 0, gross: 0, employer: 0 }, dough: { hours: 0, gross: 0, employer: 0 },
    packaging: { hours: 0, gross: 0, employer: 0 }, cleaning: { hours: 0, gross: 0, employer: 0 },
  })

  // Actual labor from the employer report (employer_costs), by dept. Managers are
  // INCLUDED in their department (option A). Preferred over the estimate above.
  const [actualLabor, setActualLabor] = useState<{ byDept: Record<Dept, number>; total: number; isActual: boolean }>({
    byDept: { creams: 0, dough: 0, packaging: 0, cleaning: 0 }, total: 0, isActual: false,
  })

  // Fixed costs
  const [fixedCosts, setFixedCosts] = useState(0)

  // KPI targets
  const [targets, setTargets] = useState<KpiTargets>(DEFAULT_TARGETS)

  // Global employees
  const [globalEmps, setGlobalEmps] = useState<GlobalEmployee[]>([])
  const [wdCount, setWdCount] = useState(26)

  // Previous period
  const [prev, setPrev] = useState({ sales: 0, suppliers: 0, waste: 0, repairs: 0, labor: 0, production: 0 })

  // 6-month trends
  const [trendData, setTrendData] = useState<MonthTrend[]>([])
  const [deptTrendData, setDeptTrendData] = useState<InternalDeptTrend[]>([])

  // ─── Data Fetching ──────────────────────────────────────────────────────
  async function fetchAll() {
    setLoading(true)

    const [
      salesFs, salesB2b,
      wasteRes, repairsRes, laborRes,
      fixedRes, kpiRes,
      suppInvRes, suppNamesRes,
      globalEmpsData, wdData,
      prodRes,
      intSalesRes,
      extSalesRes,
      intSaleItemsRes,
    ] = await Promise.all([
      supabase.from('factory_sales').select('department, amount, is_internal').gte('date', from).lt('date', to),
      supabase.from('factory_b2b_sales').select('sale_type, customer, amount, is_internal').gte('date', from).lt('date', to),
      supabase.from('factory_waste').select('department, amount').gte('date', from).lt('date', to),
      supabase.from('factory_repairs').select('department, amount').gte('date', from).lt('date', to),
      supabase.from('labor').select('entity_id, employee_name, hours_100, hours_125, hours_150, gross_salary, employer_cost').eq('entity_type', 'factory').gte('date', from).lt('date', to),
      getFixedCostTotal('factory', monthKey || from.slice(0, 7)),
      supabase.from('kpi_targets').select('*'),
      supabase.from('supplier_invoices').select('supplier_id, amount').gte('date', from).lt('date', to),
      supabase.from('suppliers').select('id, name'),
      fetchGlobalEmployees(),
      getWorkingDays(monthKey || from.slice(0, 7)),
      // Production cost: read from production_reports (Excel-upload table) which
      // has total_cost per product. Hebrew dept names mapped to English keys below.
      supabase.from('production_reports').select('department, total_cost').gte('report_date', from).lt('report_date', to),
      supabase.from('internal_sales').select('total_amount').eq('status', 'completed').gte('order_date', from).lt('order_date', to),
      supabase.from('external_sales').select('total_before_vat').gte('invoice_date', from).lt('invoice_date', to),
      // Per-department breakdown of internal sales via server-side aggregation.
      // RPC (SUM grouped by department) avoids the 1000-row fetch cap that
      // silently truncated the old item-level query and understated the rollup.
      supabase.rpc('internal_sales_by_dept', { p_from: from, p_to: to }),
    ])

    // Global employees
    setGlobalEmps(globalEmpsData)
    setWdCount(wdData)

    // Sales
    const fs = salesFs.data || []
    setSalesCreams(fs.filter((r: any) => r.department === 'creams').reduce((s: number, r: any) => s + Number(r.amount), 0))
    setSalesDough(fs.filter((r: any) => r.department === 'dough').reduce((s: number, r: any) => s + Number(r.amount), 0))

    const b2b = salesB2b.data || []
    setSalesB2B(b2b.filter((r: any) => r.sale_type === 'b2b').reduce((s: number, r: any) => s + Number(r.amount), 0))

    const miscTotal = b2b.filter((r: any) => r.sale_type === 'misc').reduce((s: number, r: any) => s + Number(r.amount), 0)
    setSalesMisc(miscTotal)

    // external_sales: factory's PDF-imported B2B invoices (separate table from factory_b2b_sales).
    const extSalesTotal = (extSalesRes.data || []).reduce((s: number, r: any) => s + Number(r.total_before_vat), 0)
    setSalesPdfExt(extSalesTotal)

    // Internal revenue: prefer internal_sales (completed), fallback to factory_sales/b2b is_internal
    const intSalesTotal = (intSalesRes.data || []).reduce((s: number, r: any) => s + Number(r.total_amount), 0)
    const legacyInternal = fs.filter((r: any) => r.is_internal).reduce((s: number, r: any) => s + Number(r.amount), 0)
                         + b2b.filter((r: any) => r.is_internal).reduce((s: number, r: any) => s + Number(r.amount), 0)
    setSalesInternal(intSalesTotal > 0 ? intSalesTotal : legacyInternal)

    // Per-department rollup of internal sales (server-aggregated by RPC).
    // Departments are stored as Hebrew strings; anything not in the known set
    // (typo / NULL / new category) falls into 'אחר'.
    const deptRows = (intSaleItemsRes.data || []) as { department: string | null; total: number }[]
    const KNOWN_DEPTS = ['קרמים', 'בצקים', 'אריזה', 'ניקיון', 'שונות', 'אחר']
    const intByDept: Record<string, number> = Object.fromEntries(KNOWN_DEPTS.map(k => [k, 0]))
    deptRows.forEach(r => {
      const d = r.department && KNOWN_DEPTS.includes(r.department) ? r.department : 'אחר'
      intByDept[d] += Number(r.total || 0)
    })
    setInternalByDept(intByDept)
    // Sanity check: rollup should reconcile to the parent total within ₪50
    const intRollup = KNOWN_DEPTS.reduce((s, k) => s + intByDept[k], 0)
    if (intSalesTotal > 0 && Math.abs(intRollup - intSalesTotal) > 50) {
      console.warn(`[FactoryDashboard] internal sales rollup mismatch: items=${Math.round(intRollup)} vs parent=${Math.round(intSalesTotal)}`)
    }

    // Suppliers
    const suppInvData = suppInvRes.data || []
    const suppTotal = suppInvData.reduce((s: number, r: any) => s + Number(r.amount), 0)
    setTotalSuppliers(suppTotal)

    const idToName: Record<number, string> = {}
    if (suppNamesRes.data) suppNamesRes.data.forEach((s: any) => { idToName[s.id] = s.name })
    const supMap: Record<string, number> = {}
    suppInvData.forEach((r: any) => {
      const name = idToName[r.supplier_id] || `ספק #${r.supplier_id}`
      supMap[name] = (supMap[name] || 0) + Number(r.amount)
    })
    const supArr = Object.entries(supMap).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total)
    setSupplierRows(supArr)

    // Waste
    const wData = wasteRes.data || []
    const wDept: Record<Dept, number> = { creams: 0, dough: 0, packaging: 0, cleaning: 0 }
    wData.forEach((r: any) => { if (wDept[r.department as Dept] !== undefined) wDept[r.department as Dept] += Number(r.amount) })
    setWasteDept(wDept)

    // Production cost from production_reports (Hebrew dept names) → map to English Dept keys.
    const prodData = prodRes.data || []
    const HEB_TO_DEPT: Record<string, string> = { 'קרמים': 'creams', 'בצקים': 'dough', 'אריזה': 'packaging' }
    const pDeptMap: Record<string, number> = { creams: 0, dough: 0, packaging: 0 }
    prodData.forEach((r: any) => {
      const dept = HEB_TO_DEPT[r.department]
      if (dept) pDeptMap[dept] += Number(r.total_cost || 0)
    })
    setProdDept(pDeptMap)

    // Repairs
    const rData = repairsRes.data || []
    const rDept: Record<Dept, number> = { creams: 0, dough: 0, packaging: 0, cleaning: 0 }
    rData.forEach((r: any) => { if (rDept[r.department as Dept] !== undefined) rDept[r.department as Dept] += Number(r.amount) })
    setRepairsDept(rDept)

    // Labor (filter global employees to prevent double counting)
    const lData = laborRes.data || []
    const globalNames = new Set(globalEmpsData.map(e => e.name))
    const hourlyLaborData = lData.filter((r: any) => !globalNames.has(r.employee_name))
    const lDept: Record<Dept, { hours: number; gross: number; employer: number }> = {
      creams: { hours: 0, gross: 0, employer: 0 }, dough: { hours: 0, gross: 0, employer: 0 },
      packaging: { hours: 0, gross: 0, employer: 0 }, cleaning: { hours: 0, gross: 0, employer: 0 },
    }
    hourlyLaborData.forEach((r: any) => {
      const d = r.entity_id as Dept
      if (lDept[d]) {
        lDept[d].hours    += Number(r.hours_100 || 0) + Number(r.hours_125 || 0) + Number(r.hours_150 || 0)
        lDept[d].gross    += Number(r.gross_salary || 0)
        lDept[d].employer += Number(r.employer_cost || 0)
      }
    })
    setLaborDept(lDept)

    // Actual factory labor from the employer report (employer_costs), by department.
    // Option A: managers are INCLUDED in their department (dept heads; the factory
    // dashboard has no separate manager line). HQ rows excluded — they arrive via
    // the מטה allocation. Falls back to the labor-table estimate above when no
    // employer report exists for the month.
    // Month keys covered by the current period (handles month / quarter / year).
    const monthKeys: string[] = []
    {
      const end = new Date(to + 'T12:00:00')
      const cur = new Date(parseInt(from.slice(0, 4)), parseInt(from.slice(5, 7)) - 1, 1)
      while (cur < end) {
        monthKeys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
        cur.setMonth(cur.getMonth() + 1)
      }
    }
    const years = [...new Set(monthKeys.map(k => parseInt(k.slice(0, 4))))]
    const monthKeySet = new Set(monthKeys)
    const { data: ecAll } = await supabase.from('employer_costs')
      .select('department_number, actual_employer_cost, year, month')
      .is('branch_id', null).eq('is_headquarters', false)
      .in('year', years.length ? years : [-1]).range(0, 99999)
    const ecFactory = (ecAll || []).filter((r: any) => monthKeySet.has(`${r.year}-${String(r.month).padStart(2, '0')}`))
    const DEPT_NUM_TO_KEY: Record<number, Dept> = { 5: 'dough', 6: 'creams', 7: 'cleaning', 8: 'packaging' }
    const actByDept: Record<Dept, number> = { creams: 0, dough: 0, packaging: 0, cleaning: 0 }
    let actTotal = 0
    ;(ecFactory || []).forEach((r: any) => {
      const amt = Number(r.actual_employer_cost || 0)
      actTotal += amt
      const key = DEPT_NUM_TO_KEY[r.department_number]
      if (key) actByDept[key] += amt   // dept 0 / 2 ("general") → total only, no specific dept
    })
    setActualLabor({ byDept: actByDept, total: actTotal, isActual: (ecFactory || []).length > 0 })

    // Fixed costs (fixedRes is already a number from getFixedCostTotal)
    setFixedCosts(fixedRes)

    // KPI targets
    const kData = kpiRes.data || []
    if (kData.length > 0) {
      const avg: KpiTargets = { ...DEFAULT_TARGETS }
      const fields: (keyof KpiTargets)[] = ['labor_pct', 'waste_pct', 'repairs_pct', 'gross_profit_pct', 'production_pct']
      fields.forEach(f => {
        const vals = kData.map((r: any) => Number(r[f])).filter(Boolean)
        if (vals.length) avg[f] = vals.reduce((s, v) => s + v, 0) / vals.length
      })
      setTargets(avg)
    }

    // Previous period
    const pFrom = comparisonPeriod.from, pTo = comparisonPeriod.to
    const [pSales, pB2b, pExtSales, pWaste, pRepairs, pLabor, pSupp, pWd, pProd] = await Promise.all([
      supabase.from('factory_sales').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_b2b_sales').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('external_sales').select('total_before_vat').gte('invoice_date', pFrom).lt('invoice_date', pTo),
      supabase.from('factory_waste').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_repairs').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('labor').select('employee_name, employer_cost').eq('entity_type', 'factory').gte('date', pFrom).lt('date', pTo),
      supabase.from('supplier_invoices').select('amount').gte('date', pFrom).lt('date', pTo),
      getWorkingDays(comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)),
      supabase.from('production_reports').select('total_cost').gte('report_date', pFrom).lt('report_date', pTo),
    ])
    const sum = (res: any) => (res.data || []).reduce((s: number, r: any) => s + Number(r.amount || r.employer_cost || r.total_before_vat || r.total_cost || 0), 0)
    const pSalesTotal = sum(pSales) + sum(pB2b) + sum(pExtSales)
    const pGlobalLaborCreams = calcGlobalLaborForDept(globalEmpsData, 'creams', pWd)
    const pGlobalLaborDough = calcGlobalLaborForDept(globalEmpsData, 'dough', pWd)
    const pTotalGlobalLabor = pGlobalLaborCreams + pGlobalLaborDough
    const pHourlyLabor = (pLabor.data || []).filter((r: any) => !globalNames.has(r.employee_name)).reduce((s: number, r: any) => s + Number(r.employer_cost || 0), 0)
    setPrev({ sales: pSalesTotal, suppliers: sum(pSupp), waste: sum(pWaste), repairs: sum(pRepairs), labor: pHourlyLabor + pTotalGlobalLabor, production: sum(pProd) })

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [from, to])

  useEffect(() => {
    fetchFactoryTrends(monthKey || from.slice(0, 7)).then(setTrendData)
    fetchInternalSalesByDeptTrend(monthKey || from.slice(0, 7)).then(setDeptTrendData)
  }, [from, to])

  // ─── Computed Values ────────────────────────────────────────────────────
  const totalSales   = salesCreams + salesDough + salesB2B + salesMisc + salesPdfExt + salesInternal
  const totalWaste   = DEPTS.reduce((s, d) => s + wasteDept[d], 0)
  const totalRepairs = DEPTS.reduce((s, d) => s + repairsDept[d], 0)
  const hourlyLabor  = DEPTS.reduce((s, d) => s + laborDept[d].employer, 0)
  const totalHourlyHours = DEPTS.reduce((s, d) => s + laborDept[d].hours, 0)

  // Global employees - employer cost per dept
  const globalLaborCreams = calcGlobalLaborForDept(globalEmps, 'creams', wdCount)
  const globalLaborDough  = calcGlobalLaborForDept(globalEmps, 'dough', wdCount)
  const totalGlobalLabor  = globalLaborCreams + globalLaborDough
  // Prefer the actual employer report; fall back to timeclock estimate + globals.
  const totalLabor        = actualLabor.isActual ? actualLabor.total : hourlyLabor + totalGlobalLabor

  // Approximate hours for global (monthly-salary) employees: each is paid for
  // wdCount × 9h / month. Used only as a denominator for the sales-per-hour KPI
  // so it stays comparable to hourly workers. The labor cost itself is taken
  // from calcGlobalLaborForDept — we never mix the two.
  const globalHoursCreams = (globalLaborCreams > 0 ? wdCount * 9 : 0)
  const globalHoursDough  = (globalLaborDough > 0 ? wdCount * 9 : 0)
  const totalLaborHours   = totalHourlyHours + globalHoursCreams + globalHoursDough
  const salesPerHour      = totalLaborHours > 0 ? totalSales / totalLaborHours : 0

  // "Other" channel = misc B2B + PDF external + legacy raw external creams/dough.
  // Most months these are near zero — they're shown together so we don't lose
  // visibility on stray non-channel sales without cluttering the top tier.
  const salesOther = salesMisc + salesPdfExt + salesCreams + salesDough

  // Profit formulas — controllable margin = sales - suppliers - labor - repairs.
  // Waste is NOT deducted — thrown-away products are already counted in raw materials
  // (suppliers). It remains as a KPI tracked separately. See lib/calculatePL.ts.
  const controllableMargin = totalSales - totalSuppliers - totalLabor - totalRepairs
  const operatingProfit    = controllableMargin - fixedCosts

  // KPI percentages
  const laborPct  = pct(totalLabor, totalSales)
  const wastePct  = pct(totalWaste, totalSales)
  const opPct     = pct(operatingProfit, totalSales)

  // Previous period profit (for DiffBadge) — same policy: waste excluded.
  const prevControllable    = prev.sales - prev.suppliers - prev.labor - prev.repairs
  const prevOperatingProfit = prevControllable - fixedCosts

  // ─── Per-department efficiency table ────────────────────────────────────
  // Aggregates production / sales / waste / labor cost+hours per department so
  // production managers can compare which dept is most efficient (sales / hour
  // worked) and where labor% is heaviest relative to revenue.
  // The English keys (DEPTS) are used by daily_production / factory_waste /
  // labor / factory_repairs. Sales come from internal_sale_items which uses
  // Hebrew strings — map English → Hebrew here so the lookup works.
  const deptLabel: Record<Dept, string> = { creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה', cleaning: 'ניקיון' }
  const deptTotals = DEPTS.map(d => {
    const production = prodDept[d] ?? 0
    const sales      = internalByDept[deptLabel[d]] ?? 0
    const waste      = wasteDept[d] ?? 0
    const hourly     = laborDept[d]
    const globalCost = d === 'creams' ? globalLaborCreams : d === 'dough' ? globalLaborDough : 0
    const laborCost  = actualLabor.isActual ? (actualLabor.byDept[d] ?? 0) : hourly.employer + globalCost
    const globalHrs  = d === 'creams' ? globalHoursCreams : d === 'dough' ? globalHoursDough : 0
    const hours      = hourly.hours + globalHrs
    const salesPerHr = hours > 0 ? sales / hours : 0
    const wPct       = sales > 0 ? (waste / sales) * 100 : 0
    const lPct       = sales > 0 ? (laborCost / sales) * 100 : 0
    const prodPct    = sales > 0 ? (production / sales) * 100 : 0
    return { dept: d, name: deptLabel[d], production, sales, waste, hours, laborCost, salesPerHr, wastePct: wPct, laborPct: lPct, prodCostPct: prodPct }
  }).sort((a, b) => b.sales - a.sales)

  // ─── Loading State ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ direction: 'rtl', background: '#f8fafc' }}>
      <div className="text-center py-16 text-slate-400">טוען נתונים...</div>
    </div>
  )

  // ─── Sales breakdown ────────────────────────────────────────────────────
  // Channel-level (top tier): internal-to-branches / B2B / other. Internal also
  // has per-dept sub-rows fed by internalByDept (rollup of internal_sale_items).
  const salesChannels = [
    { label: 'מכירות פנימיות לסניפים', value: salesInternal, kind: 'internal' as const },
    { label: 'B2B', value: salesB2B, kind: 'b2b' as const },
    { label: 'שונות', value: salesOther, kind: 'other' as const },
  ]
  const maxSale = Math.max(...salesChannels.map(i => i.value), 1)
  // Sub-rows under "מכירות פנימיות לסניפים" — read directly from Hebrew keys.
  // 'שונות' is intentional (raw materials sold to branches without a department);
  // 'אחר' = items uploaded without a department mapping (needs tagging — flagged
  // with a warning style in the UI).
  const internalSubRows = [
    { label: 'קרמים', value: internalByDept['קרמים'] ?? 0, kind: 'normal' as const },
    { label: 'בצקים', value: internalByDept['בצקים'] ?? 0, kind: 'normal' as const },
    { label: 'אריזה', value: internalByDept['אריזה'] ?? 0, kind: 'normal' as const },
    { label: 'ניקיון', value: internalByDept['ניקיון'] ?? 0, kind: 'normal' as const },
    { label: 'שונות (חומרי גלם)', value: internalByDept['שונות'] ?? 0, kind: 'normal' as const },
    { label: 'לא מתויגים', value: internalByDept['אחר'] ?? 0, kind: 'warn' as const },
  ].filter(r => r.value > 0)

  // Costs breakdown — waste excluded (already inside ספקים / חומרי גלם).
  // Shown separately as a KPI panel below.
  const costItems = [
    { label: 'ספקים', value: totalSuppliers },
    { label: 'לייבור', value: totalLabor },
    { label: 'עלויות קבועות', value: fixedCosts },
    { label: 'תיקונים', value: totalRepairs },
  ]
  const maxCost = Math.max(...costItems.map(i => i.value), 1)

  // ─── P&L Table rows ───────────────────────────────────────────────────
  const externalSales = salesCreams + salesDough + salesB2B + salesMisc + salesPdfExt
  const plRows: { label: string; amount: number; type: 'normal' | 'separator' | 'bold' }[] = [
    { label: 'מכירות חיצוניות', amount: externalSales, type: 'normal' },
    ...(salesInternal > 0 ? [{ label: 'מכירות פנימיות לסניפים', amount: salesInternal, type: 'normal' as const }] : []),
    { label: 'סה"כ מכירות', amount: totalSales, type: 'bold' },
    { label: 'חומרי גלם', amount: totalSuppliers, type: 'normal' },
    { label: 'לייבור', amount: totalLabor, type: 'normal' },
    { label: 'תיקונים', amount: totalRepairs, type: 'normal' },
    { label: '──────', amount: 0, type: 'separator' },
    { label: 'רווח נשלט', amount: controllableMargin, type: 'bold' },
    { label: '──────', amount: 0, type: 'separator' },
    { label: 'עלויות קבועות', amount: fixedCosts, type: 'normal' },
    { label: '──────', amount: 0, type: 'separator' },
    { label: 'רווח תפעולי', amount: operatingProfit, type: 'bold' },
  ]

  // ─── KPI color helper ─────────────────────────────────────────────────
  const kpiColor = (actual: number, target: number, inverse: boolean): string => {
    if (target === 0) return '#64748b'
    const deviation = inverse
      ? (actual - target) / target
      : (target - actual) / target
    if (deviation <= 0) return '#639922'
    if (deviation < 0.15) return '#f59e0b'
    return '#E24B4A'
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ direction: 'rtl', background: '#f8fafc' }}>

      <PageHeader title="דשבורד מפעל" onBack={onBack} action={<PeriodPicker period={period} onChange={setPeriod} />} />

      {/* ─── Main Content ─────────────────────────────────────────────── */}
      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>

        {/* ═══ ROW 1 — KPI Cards ═══ */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-2.5">

          {/* 1. Total Sales */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>מכירות כוללות</div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{fmtM(totalSales)}</span>
              <DiffBadge current={totalSales} previous={prev.sales} />
            </div>
            {salesInternal > 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>פנימיות: {fmtM(salesInternal)}</div>
            )}
          </div>

          {/* 2. Controllable Margin */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4, cursor: 'help' }} title="מכירות פחות ספקים, לייבור ותיקונים. פחת אינו מנוכה — הוא כבר כלול בעלות חומרי הגלם, ומוצג כמדד נפרד.">רווח נשלט</div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 24, fontWeight: 700, color: controllableMargin >= 0 ? '#639922' : '#E24B4A' }}>{fmtM(controllableMargin)}</span>
              <DiffBadge current={controllableMargin} previous={prevControllable} />
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{totalSales > 0 ? pct(controllableMargin, totalSales).toFixed(1) : '0.0'}% מהמכירות</div>
          </div>

          {/* 3. Operating Profit */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>רווח תפעולי</div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 24, fontWeight: 700, color: operatingProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtM(operatingProfit)}</span>
              <DiffBadge current={operatingProfit} previous={prevOperatingProfit} />
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{totalSales > 0 ? pct(operatingProfit, totalSales).toFixed(1) : '0.0'}% מהמכירות</div>
          </div>

          {/* 4. Labor % */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>% לייבור</div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 24, fontWeight: 700, color: '#6366f1' }}>{laborPct.toFixed(1)}%</span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              יעד {targets.labor_pct.toFixed(0)}%
              <span style={{ marginRight: 6, color: laborPct <= targets.labor_pct ? '#639922' : '#E24B4A' }}>
                ({laborPct <= targets.labor_pct ? 'עומד ביעד' : 'חורג'})
              </span>
            </div>
          </div>

          {/* 5. Sales per labor hour — productivity benchmark */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4, cursor: 'help' }} title="מכירות לכל שעת עבודה. שעות עובדים בשכר חודשי משוערות לפי ימי עבודה × 9.">
              מכירות / שעה
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>
                {totalLaborHours > 0 ? `₪${Math.round(salesPerHour).toLocaleString()}` : '—'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              {totalLaborHours > 0 ? `${Math.round(totalLaborHours).toLocaleString()} שעות בחודש` : 'אין נתוני שעות'}
            </div>
          </div>

        </motion.div>

        {/* ═══ ROW 2 — P&L Table ═══ */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-2.5" transition={{ delay: 0.1 }}>
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 12 }}>רווח והפסד — מפעל — {period.label}</span>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-bold text-slate-500 min-w-[140px]">מדד</TableHead>
                    <TableHead className="text-xs font-bold text-slate-500 text-center">סכום ₪</TableHead>
                    <TableHead className="text-xs font-bold text-slate-500 text-center">% מהכנסות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plRows.map((row, i) => {
                    if (row.type === 'separator') {
                      return (
                        <TableRow key={`sep-${i}`} className="h-1">
                          <TableCell colSpan={3} className="p-0"><div style={{ borderTop: '1px solid #f1f5f9' }} /></TableCell>
                        </TableRow>
                      )
                    }
                    const isBold = row.type === 'bold'
                    const isProfit = row.label === 'רווח נשלט' || row.label === 'רווח תפעולי'
                    const profitColor = isProfit ? (row.amount >= 0 ? '#639922' : '#E24B4A') : undefined
                    const revPct = totalSales > 0 ? (row.amount / totalSales * 100) : 0
                    const pctColor = isProfit ? profitColor : '#64748b'
                    return (
                      <TableRow key={row.label} style={{ background: isBold ? '#fafafa' : 'transparent', borderBottom: '1px solid #f8fafc' }}>
                        <TableCell className={`px-3.5 py-2.5 text-[12px] ${isBold ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
                          {row.label}
                        </TableCell>
                        <TableCell className={`px-3.5 py-2.5 text-[12px] text-center ${isBold ? 'font-bold' : ''}`} style={{ color: profitColor }}>
                          {fmtM(row.amount)}
                        </TableCell>
                        <TableCell className={`px-3.5 py-2.5 text-[12px] text-center ${isBold ? 'font-bold' : ''}`} style={{ color: pctColor }}>
                          {revPct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
          </div>
        </motion.div>

        {/* ═══ ROW 3 — KPI Targets ═══ */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-2.5" transition={{ delay: 0.2 }}>

          {/* Labor % vs target */}
          {(() => {
            const actual = laborPct
            const target = targets.labor_pct
            const color = kpiColor(actual, target, true)
            const progressW = target > 0 ? Math.min((actual / target) * 100, 150) : 0
            return (
              <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>% לייבור</div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-bold" style={{ color }}>{actual.toFixed(1)}%</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>יעד {target.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(progressW, 100)}%`, backgroundColor: color }} />
                </div>
              </div>
            )
          })()}

          {/* Waste % vs target */}
          {(() => {
            const actual = wastePct
            const target = targets.waste_pct
            const color = kpiColor(actual, target, true)
            const progressW = target > 0 ? Math.min((actual / target) * 100, 150) : 0
            return (
              <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>% פחת</div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-bold" style={{ color }}>{actual.toFixed(1)}%</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>יעד {target.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(progressW, 100)}%`, backgroundColor: color }} />
                </div>
              </div>
            )
          })()}

          {/* Operating Profit % vs target */}
          {(() => {
            const actual = opPct
            const target = targets.operating_profit_pct
            const color = kpiColor(actual, target, false)
            const progressW = target > 0 ? Math.min((actual / target) * 100, 150) : 0
            return (
              <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>% רווח תפעולי</div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-bold" style={{ color }}>{actual.toFixed(1)}%</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>יעד {target.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(progressW, 100)}%`, backgroundColor: color }} />
                </div>
              </div>
            )
          })()}

        </motion.div>

        {/* ═══ ROW 4 — 6-Month Trend Chart ═══ */}
        {trendData.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-2.5" transition={{ delay: 0.3 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>מגמות מפעל — 6 חודשים</div>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trendData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: any, name: any) => [`₪${Math.round(Number(value)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, String(name)]} />
                    <Legend />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="revenue" name="מכירות" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="grossProfit" name="רווח נשלט" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="operatingProfit" name="רווח תפעולי" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
            </div>
          </motion.div>
        )}

        {/* ═══ ROW 4b — מכירות לפי מחלקה (6 חודשים) ═══ */}
        {deptTrendData.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-2.5" transition={{ delay: 0.35 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>מכירות לפי מחלקה — 6 חודשים</div>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={deptTrendData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: any, name: any) => [`₪${Math.round(Number(value)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, String(name)]} />
                    <Legend />
                    <Line type="monotone" dataKey="creams" name="קרמים" stroke="#ec4899" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="dough"  name="בצקים" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
            </div>
          </motion.div>
        )}

        {/* ═══ ROW 5 — Detail Cards (Sales + Costs breakdown) ═══ */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-2 gap-2.5 mb-2.5" transition={{ delay: 0.4 }}>

          {/* Sales breakdown — channel level (internal / B2B / other) with internal sub-rows by department */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>הרכב מכירות החודש</div>
              {salesChannels.map(channel => (
                <div key={channel.label}>
                  <ProgressRow label={channel.label} value={channel.value} max={maxSale} color="#6366f1" />
                  {channel.kind === 'internal' && internalSubRows.length > 0 && (
                    <div style={{ marginInlineStart: 14, paddingInlineStart: 10, borderInlineStart: '2px solid #e2e8f0', marginTop: -6, marginBottom: 10 }}>
                      {internalSubRows.map(sub => {
                        const isWarn = sub.kind === 'warn'
                        return (
                          <div key={sub.label} className="flex items-center justify-between" style={{ padding: '4px 0' }}>
                            <span style={{ fontSize: 12, color: isWarn ? '#c2410c' : '#64748b', fontWeight: isWarn ? 600 : 400 }}>
                              {isWarn ? '⚠ ' : ''}{sub.label}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: isWarn ? '#c2410c' : '#475569' }}>{fmtM(sub.value)}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>סה"כ</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{fmtM(totalSales)}</span>
              </div>
          </div>

          {/* Costs */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>עלויות</div>
              {costItems.map(item => (
                <ProgressRow key={item.label} label={item.label} value={item.value} max={maxCost} color="#94a3b8" />
              ))}
          </div>

        </motion.div>

        {/* ═══ ROW 6 — Department Performance ═══ */}
        {/* Headline operational view for production managers — compare each dept's
            output / labor cost / waste / sales-per-hour side-by-side. */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-2.5" transition={{ delay: 0.5 }}>
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>ביצועי מחלקות</span>
              <span title="שעות עובדים בשכר חודשי משוערות לפי ימי עבודה × 9" style={{ fontSize: 11, color: '#94a3b8', cursor: 'help' }}>ⓘ</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold text-slate-500">מחלקה</TableHead>
                  <TableHead className="text-xs font-bold text-slate-500 text-center">עלות ייצור</TableHead>
                  <TableHead className="text-xs font-bold text-slate-500 text-center">מכירות</TableHead>
                  <TableHead className="text-xs font-bold text-slate-500 text-center">% עלות ייצור</TableHead>
                  <TableHead className="text-xs font-bold text-slate-500 text-center">לייבור</TableHead>
                  <TableHead className="text-xs font-bold text-slate-500 text-center">% לייבור</TableHead>
                  <TableHead className="text-xs font-bold text-slate-500 text-center">פחת</TableHead>
                  <TableHead className="text-xs font-bold text-slate-500 text-center">% פחת</TableHead>
                  <TableHead className="text-xs font-bold text-slate-500 text-center">מכירות / שעה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deptTotals.map(row => {
                  const lColor = row.sales > 0 ? kpiColor(row.laborPct, targets.labor_pct, true) : '#94a3b8'
                  const wColor = row.sales > 0 ? kpiColor(row.wastePct, targets.waste_pct, true) : '#94a3b8'
                  const pColor = row.sales > 0 && row.production > 0 ? kpiColor(row.prodCostPct, targets.production_pct, true) : '#94a3b8'
                  return (
                    <TableRow key={row.dept} style={{ borderBottom: '1px solid #f8fafc' }}>
                      <TableCell className="px-3.5 py-2.5 text-[12px] font-medium text-slate-700">{row.name}</TableCell>
                      <TableCell className="px-3.5 py-2.5 text-[12px] text-center text-slate-600">
                        {row.production > 0 ? fmtM(row.production) : '—'}
                      </TableCell>
                      <TableCell className="px-3.5 py-2.5 text-[12px] text-center text-slate-600">
                        {row.sales > 0 ? fmtM(row.sales) : '—'}
                      </TableCell>
                      <TableCell className="px-3.5 py-2.5 text-[12px] text-center font-bold" style={{ color: pColor }}>
                        {row.sales > 0 && row.production > 0 ? `${row.prodCostPct.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="px-3.5 py-2.5 text-[12px] text-center text-slate-600">
                        {row.laborCost > 0 ? fmtM(row.laborCost) : '—'}
                      </TableCell>
                      <TableCell className="px-3.5 py-2.5 text-[12px] text-center font-bold" style={{ color: lColor }}>
                        {row.sales > 0 ? `${row.laborPct.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="px-3.5 py-2.5 text-[12px] text-center text-slate-600">
                        {row.waste > 0 ? fmtM(row.waste) : '—'}
                      </TableCell>
                      <TableCell className="px-3.5 py-2.5 text-[12px] text-center font-bold" style={{ color: wColor }}>
                        {row.sales > 0 ? `${row.wastePct.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="px-3.5 py-2.5 text-[12px] text-center font-bold text-slate-700">
                        {row.hours > 0 && row.sales > 0 ? `₪${Math.round(row.salesPerHr).toLocaleString()}` : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </motion.div>

      </div>
    </div>
  )
}
