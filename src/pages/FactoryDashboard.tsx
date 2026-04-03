import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept, fetchFactoryTrends, getFixedCostTotal } from '../lib/supabase'
import type { GlobalEmployee, MonthTrend } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { ArrowRight, TrendingUp, TrendingDown, Factory } from 'lucide-react'
import { usePeriod } from '../lib/PeriodContext'
import { getMonthsInRange } from '../lib/period'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

  // Profit formulas
  const grossProfit     = totalSales - totalLabor - totalSuppliers
  const operatingProfit = grossProfit - fixedCosts - totalWaste - totalRepairs

  // KPI percentages
  const laborPct = pct(totalLabor, totalSales)

  // Previous period profit (for DiffBadge)
  const prevGrossProfit     = prev.sales - prev.labor - prev.suppliers
  const prevOperatingProfit = prevGrossProfit - prev.waste - prev.repairs

  // ─── Loading State ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center" style={{ direction: 'rtl' }}>
      <div className="text-center py-16 text-slate-400">טוען נתונים...</div>
    </div>
  )

  // ─── Sales breakdown for Row 2 ─────────────────────────────────────────
  const salesItems = [
    { label: 'קרמים', value: salesCreams },
    { label: 'בצקים', value: salesDough },
    { label: 'B2B', value: salesB2B },
    { label: 'שונות', value: salesMisc },
  ]
  const maxSale = Math.max(...salesItems.map(i => i.value), 1)

  // Costs breakdown for Row 2
  const costItems = [
    { label: 'ספקים', value: totalSuppliers },
    { label: 'לייבור', value: totalLabor },
    { label: 'עלויות קבועות', value: fixedCosts },
    { label: 'פחת', value: totalWaste },
    { label: 'תיקונים', value: totalRepairs },
  ]
  const maxCost = Math.max(...costItems.map(i => i.value), 1)

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* ─── Header ───────────────────────────────────────────────────── */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
          <Factory size={20} className="text-indigo-500" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 m-0">דשבורד מפעל</h1>
          <p className="text-[13px] text-slate-400 m-0">KPI · מכירות · עלויות · {period.label}</p>
        </div>
        <div className="mr-auto">
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      {/* ─── Main Content ─────────────────────────────────────────────── */}
      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>

        {/* ═══ ROW 1 — 4 Golden KPI Cards ═══ */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-4 gap-2.5 mb-2.5">

          {/* 1. Total Sales (excl. internal) */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">מכירות כוללות (ללא פנימיות)</div>
              <div className="flex items-center gap-2">
                <span className="text-[22px] font-medium" style={{ color: '#378ADD' }}>{fmtM(totalSales)}</span>
                <DiffBadge current={totalSales} previous={prev.sales} />
              </div>
              {salesInternal > 0 && (
                <div className="text-[11px] text-slate-400 mt-1">מתוכם פנימיות: {fmtM(salesInternal)}</div>
              )}
            </CardContent>
          </Card>

          {/* 2. Gross Profit */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold text-slate-400 mb-1 cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</div>
              <div className="flex items-center gap-2">
                <span className="text-[22px] font-medium" style={{ color: grossProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtM(grossProfit)}</span>
                <DiffBadge current={grossProfit} previous={prevGrossProfit} />
              </div>
              <div className="text-[11px] text-slate-400 mt-1">{totalSales > 0 ? (pct(grossProfit, totalSales)).toFixed(1) : '0.0'}% מהמכירות</div>
            </CardContent>
          </Card>

          {/* 3. Operating Profit */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">רווח תפעולי</div>
              <div className="flex items-center gap-2">
                <span className="text-[22px] font-medium" style={{ color: operatingProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtM(operatingProfit)}</span>
                <DiffBadge current={operatingProfit} previous={prevOperatingProfit} />
              </div>
              <div className="text-[11px] text-slate-400 mt-1">{totalSales > 0 ? (pct(operatingProfit, totalSales)).toFixed(1) : '0.0'}% מהמכירות</div>
            </CardContent>
          </Card>

          {/* 4. Labor % */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">% לייבור</div>
              <div className="flex items-center gap-2">
                <span className="text-[22px] font-medium" style={{ color: '#534AB7' }}>{laborPct.toFixed(1)}%</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                יעד: {targets.labor_pct.toFixed(1)}%
                <span className="mr-1.5" style={{ color: laborPct <= targets.labor_pct ? '#639922' : '#E24B4A' }}>
                  ({laborPct <= targets.labor_pct ? 'עומד ביעד' : 'חורג'})
                </span>
              </div>
            </CardContent>
          </Card>

        </motion.div>

        {/* ═══ ROW 2 — 2 Detail Cards ═══ */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-2 gap-2.5 mb-2.5">

          {/* LEFT — Sales by Department */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-[13px] font-bold text-slate-700 mb-3">מכירות לפי מחלקה</div>
              {salesItems.map(item => (
                <ProgressRow key={item.label} label={item.label} value={item.value} max={maxSale} color="#378ADD" />
              ))}
            </CardContent>
          </Card>

          {/* RIGHT — Costs */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-[13px] font-bold text-slate-700 mb-3">עלויות</div>
              {costItems.map(item => (
                <ProgressRow key={item.label} label={item.label} value={item.value} max={maxCost} color="#E24B4A" />
              ))}
            </CardContent>
          </Card>

        </motion.div>

        {/* ═══ ROW 3 — 6-Month Trend LineChart ═══ */}
        {trendData.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="text-[13px] font-bold text-slate-700 mb-3">מגמות מפעל — 6 חודשים</div>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trendData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: any, name: any) => [`₪${Math.round(Number(value)).toLocaleString()}`, String(name)]} />
                    <Legend />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="revenue" name="מכירות" stroke="#378ADD" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="grossProfit" name="רווח נשלט" stroke="#639922" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="operatingProfit" name="רווח תפעולי" stroke="#534AB7" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>
        )}

      </div>
    </div>
  )
}
