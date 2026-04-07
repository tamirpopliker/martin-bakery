import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept, fetchFactoryTrends, getFixedCostTotal } from '../lib/supabase'
import type { GlobalEmployee, MonthTrend } from '../lib/supabase'
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

const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString()
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
  const [salesInternal, setSalesInternal] = useState(0)

  // Suppliers
  const [_supplierRows, setSupplierRows] = useState<{ name: string; total: number }[]>([])
  const [totalSuppliers, setTotalSuppliers] = useState(0)

  // Waste per dept
  const [wasteDept, setWasteDept] = useState<Record<Dept, number>>({ creams: 0, dough: 0, packaging: 0, cleaning: 0 })

  // Production per dept
  const [_prodDept, setProdDept] = useState<Record<string, number>>({ creams: 0, dough: 0, packaging: 0 })

  // Repairs per dept
  const [repairsDept, setRepairsDept] = useState<Record<Dept, number>>({ creams: 0, dough: 0, packaging: 0, cleaning: 0 })

  // Labor per dept
  const [laborDept, setLaborDept] = useState<Record<Dept, { hours: number; gross: number; employer: number }>>({
    creams: { hours: 0, gross: 0, employer: 0 }, dough: { hours: 0, gross: 0, employer: 0 },
    packaging: { hours: 0, gross: 0, employer: 0 }, cleaning: { hours: 0, gross: 0, employer: 0 },
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
      supabase.from('daily_production').select('department, amount').gte('date', from).lt('date', to),
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

    const internalFsTotal = fs.filter((r: any) => r.is_internal).reduce((s: number, r: any) => s + Number(r.amount), 0)
    const internalB2bTotal = b2b.filter((r: any) => r.is_internal).reduce((s: number, r: any) => s + Number(r.amount), 0)
    setSalesInternal(internalFsTotal + internalB2bTotal)

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

    // Production
    const prodData = prodRes.data || []
    const pDeptMap: Record<string, number> = { creams: 0, dough: 0, packaging: 0 }
    prodData.forEach((r: any) => { if (pDeptMap[r.department] !== undefined) pDeptMap[r.department] += Number(r.amount) })
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
    const [pSales, pB2b, pWaste, pRepairs, pLabor, pSupp, pWd, pProd] = await Promise.all([
      supabase.from('factory_sales').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_b2b_sales').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_waste').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_repairs').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('labor').select('employee_name, employer_cost').eq('entity_type', 'factory').gte('date', pFrom).lt('date', pTo),
      supabase.from('supplier_invoices').select('amount').gte('date', pFrom).lt('date', pTo),
      getWorkingDays(comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)),
      supabase.from('daily_production').select('amount').gte('date', pFrom).lt('date', pTo),
    ])
    const sum = (res: any) => (res.data || []).reduce((s: number, r: any) => s + Number(r.amount || r.employer_cost || 0), 0)
    const pSalesTotal = sum(pSales) + sum(pB2b)
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
  }, [from, to])

  // ─── Computed Values ────────────────────────────────────────────────────
  const totalSales   = salesCreams + salesDough + salesB2B + salesMisc
  const totalWaste   = DEPTS.reduce((s, d) => s + wasteDept[d], 0)
  const totalRepairs = DEPTS.reduce((s, d) => s + repairsDept[d], 0)
  const hourlyLabor  = DEPTS.reduce((s, d) => s + laborDept[d].employer, 0)

  // Global employees - employer cost per dept
  const globalLaborCreams = calcGlobalLaborForDept(globalEmps, 'creams', wdCount)
  const globalLaborDough  = calcGlobalLaborForDept(globalEmps, 'dough', wdCount)
  const totalGlobalLabor  = globalLaborCreams + globalLaborDough
  const totalLabor        = hourlyLabor + totalGlobalLabor

  // Profit formulas — controllable margin = sales - suppliers - labor - waste - repairs
  const controllableMargin = totalSales - totalSuppliers - totalLabor - totalWaste - totalRepairs
  const operatingProfit    = controllableMargin - fixedCosts

  // KPI percentages
  const laborPct  = pct(totalLabor, totalSales)
  const wastePct  = pct(totalWaste, totalSales)
  const opPct     = pct(operatingProfit, totalSales)

  // Previous period profit (for DiffBadge)
  const prevControllable    = prev.sales - prev.suppliers - prev.labor - prev.waste - prev.repairs
  const prevOperatingProfit = prevControllable - fixedCosts

  // ─── Loading State ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ direction: 'rtl', background: '#f8fafc' }}>
      <div className="text-center py-16 text-slate-400">טוען נתונים...</div>
    </div>
  )

  // ─── Sales breakdown ────────────────────────────────────────────────────
  const salesItems = [
    { label: 'קרמים', value: salesCreams },
    { label: 'בצקים', value: salesDough },
    { label: 'B2B', value: salesB2B },
    { label: 'שונות', value: salesMisc },
  ]
  const maxSale = Math.max(...salesItems.map(i => i.value), 1)

  // Costs breakdown
  const costItems = [
    { label: 'ספקים', value: totalSuppliers },
    { label: 'לייבור', value: totalLabor },
    { label: 'עלויות קבועות', value: fixedCosts },
    { label: 'פחת', value: totalWaste },
    { label: 'תיקונים', value: totalRepairs },
  ]
  const maxCost = Math.max(...costItems.map(i => i.value), 1)

  // ─── P&L Table rows ───────────────────────────────────────────────────
  const plRows: { label: string; amount: number; type: 'normal' | 'separator' | 'bold' }[] = [
    { label: 'מכירות', amount: totalSales, type: 'normal' },
    { label: 'חומרי גלם', amount: totalSuppliers, type: 'normal' },
    { label: 'לייבור', amount: totalLabor, type: 'normal' },
    { label: 'פחת', amount: totalWaste, type: 'normal' },
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

        {/* ═══ ROW 1 — 4 KPI Cards ═══ */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5">

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
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4, cursor: 'help' }} title="מכירות פחות ספקים, לייבור, פחת ותיקונים">רווח נשלט</div>
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
                    <Tooltip formatter={(value: any, name: any) => [`₪${Math.round(Number(value)).toLocaleString()}`, String(name)]} />
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

        {/* ═══ ROW 5 — Detail Cards (Sales + Costs breakdown) ═══ */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-2 gap-2.5 mb-2.5" transition={{ delay: 0.4 }}>

          {/* Sales by Department */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>מכירות לפי מחלקה</div>
              {salesItems.map(item => (
                <ProgressRow key={item.label} label={item.label} value={item.value} max={maxSale} color="#6366f1" />
              ))}
          </div>

          {/* Costs */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>עלויות</div>
              {costItems.map(item => (
                <ProgressRow key={item.label} label={item.label} value={item.value} max={maxCost} color="#94a3b8" />
              ))}
          </div>

        </motion.div>

      </div>
    </div>
  )
}
