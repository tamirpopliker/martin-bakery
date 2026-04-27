import { useState, useEffect } from 'react'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept, countWorkingDaysInRange } from '../lib/supabase'
import type { GlobalEmployee } from '../lib/supabase'
import { TrendingUp, TrendingDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { ProfitIcon } from '@/components/icons'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

// --- Types ---
type Department = 'creams' | 'dough'

interface Props {
  department: Department
  onBack: () => void
}

interface DayData {
  date: string
  production: number
  sales: number
  waste: number
  repairs: number
  labor: number
}

interface KpiTarget {
  labor_pct: number
  waste_pct: number
  repairs_pct: number
  gross_profit_pct: number
}

// --- Config ---
const DEPT_CONFIG = {
  creams: { label: 'קרמים', color: '#6366f1', bg: '#f1f5f9' },
  dough:  { label: 'בצקים', color: '#6366f1', bg: '#f1f5f9' },
}

const DEFAULT_TARGETS: KpiTarget = {
  labor_pct: 25,
  waste_pct: 5,
  repairs_pct: 3,
  gross_profit_pct: 40,
}

// --- Helpers ---
function pct(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}
function fmtPct(n: number) { return n.toFixed(1) + '%' }
function fmtMoney(n: number) { return '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) }

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

/** KPI color: green if on target, orange within 20%, red >20%. inverse=true means lower is better. */
function kpiColor(actual: number, target: number | null, inverse: boolean): string {
  if (target === null || target === 0) return '#64748b'
  const deviation = inverse
    ? (actual - target) / target   // cost: positive = bad
    : (target - actual) / target   // profit: positive = bad
  if (deviation <= 0) return '#639922'
  if (deviation <= 0.2) return '#BA7517'
  return '#E24B4A'
}

// --- DiffBadge ---
function DiffBadge({ current, previous, inverse }: { current: number; previous: number; inverse?: boolean }) {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return <TrendingUp size={12} className="text-emerald-400" />
  const pctVal = ((current - previous) / Math.abs(previous)) * 100
  const isUp = pctVal > 0
  const isGood = inverse ? !isUp : isUp
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${isGood ? 'text-emerald-500' : 'text-rose-500'}`}>
      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(pctVal).toFixed(1)}%
    </span>
  )
}

// --- Main Component ---
export default function DepartmentDashboard({ department, onBack }: Props) {
  const cfg = DEPT_CONFIG[department]

  const { period: globalPeriod, setPeriod: setGlobalPeriod, from, to, comparisonPeriod, monthKey } = usePeriod()
  const [days, setDays]           = useState<DayData[]>([])
  const [prevDays, setPrevDays]   = useState<DayData[]>([])
  const [loading, setLoading]     = useState(true)
  const [targets, setTargets]     = useState<KpiTarget>(DEFAULT_TARGETS)
  const [globalEmps, setGlobalEmps] = useState<GlobalEmployee[]>([])
  const [workingDaysMonth, setWorkingDaysMonth] = useState(26)
  const [prodReportCost, setProdReportCost] = useState(0)
  const [prevProdReportCost, setPrevProdReportCost] = useState(0)
  const [topProducts, setTopProducts] = useState<{ product_name: string; total_qty: number; unit_price: number }[]>([])

  // --- Data fetching ---
  async function fetchRange(from: string, to: string, globalNames: Set<string> = new Set()): Promise<DayData[]> {
    const [prod, sales, waste, repairs, labor] = await Promise.all([
      supabase.from('daily_production').select('date,amount').eq('department', department).gte('date', from).lt('date', to),
      supabase.from('factory_sales').select('date,amount').eq('department', department).gte('date', from).lt('date', to),
      supabase.from('factory_waste').select('date,amount').eq('department', department).gte('date', from).lt('date', to),
      supabase.from('factory_repairs').select('date,amount').eq('department', department).gte('date', from).lt('date', to),
      supabase.from('labor').select('date,employee_name,employer_cost').eq('entity_type', 'factory').eq('entity_id', department).gte('date', from).lt('date', to),
    ])

    const laborData = (labor.data || []).filter((r: any) => !globalNames.has(r.employee_name))

    const allDates = new Set([
      ...(prod.data || []).map((r: any) => r.date),
      ...(sales.data || []).map((r: any) => r.date),
      ...(waste.data || []).map((r: any) => r.date),
      ...(repairs.data || []).map((r: any) => r.date),
      ...laborData.map((r: any) => r.date),
    ])

    const sum = (arr: any[], dateStr: string, field: string) =>
      (arr || []).filter(r => r.date === dateStr).reduce((s: number, r: any) => s + Number(r[field] || 0), 0)

    return [...allDates].sort().map(date => ({
      date,
      production: sum(prod.data || [], date, 'amount'),
      sales:      sum(sales.data || [], date, 'amount'),
      waste:      sum(waste.data || [], date, 'amount'),
      repairs:    sum(repairs.data || [], date, 'amount'),
      labor:      sum(laborData, date, 'employer_cost'),
    }))
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const prevFrom = comparisonPeriod.from
      const prevTo = comparisonPeriod.to
      const [kpiRes, gEmps, wDays] = await Promise.all([
        supabase.from('kpi_targets').select('*').eq('department', department).single(),
        fetchGlobalEmployees(),
        getWorkingDays(monthKey || from.slice(0, 7)),
      ])
      const globalNames = new Set(
        gEmps.filter(e => e.department === department || e.department === 'both').map(e => e.name)
      )
      const [cur, prv] = await Promise.all([
        fetchRange(from, to, globalNames),
        fetchRange(prevFrom, prevTo, globalNames),
      ])
      setDays(cur)
      setPrevDays(prv)
      setGlobalEmps(gEmps)
      setWorkingDaysMonth(wDays)

      // Fetch production report costs
      const deptName = department === 'creams' ? 'קרמים' : 'בצקים'
      const [prCur, prPrev] = await Promise.all([
        supabase.from('production_reports').select('total_cost').eq('department', deptName).gte('report_date', from).lt('report_date', to),
        supabase.from('production_reports').select('total_cost').eq('department', deptName).gte('report_date', prevFrom).lt('report_date', prevTo),
      ])
      setProdReportCost((prCur.data || []).reduce((s: number, r: any) => s + Number(r.total_cost), 0))
      setPrevProdReportCost((prPrev.data || []).reduce((s: number, r: any) => s + Number(r.total_cost), 0))

      // Top products by quantity sold
      const { data: topItems } = await supabase.from('internal_sale_items')
        .select('product_name, quantity_supplied, unit_price, sale_id')
        .eq('department', deptName)
      if (topItems && topItems.length > 0) {
        // Filter by date range via sales
        const saleIds = [...new Set(topItems.map(i => i.sale_id))]
        const { data: salesInRange } = await supabase.from('internal_sales')
          .select('id').in('id', saleIds).gte('order_date', from).lt('order_date', to).eq('status', 'completed')
        const validIds = new Set((salesInRange || []).map((s: any) => s.id))
        const filtered = topItems.filter(i => validIds.has(i.sale_id))
        const grouped = new Map<string, { qty: number; price: number }>()
        for (const item of filtered) {
          const e = grouped.get(item.product_name)
          if (e) { e.qty += Number(item.quantity_supplied) }
          else { grouped.set(item.product_name, { qty: Number(item.quantity_supplied), price: Number(item.unit_price) }) }
        }
        setTopProducts([...grouped.entries()]
          .map(([name, v]) => ({ product_name: name, total_qty: v.qty, unit_price: v.price }))
          .sort((a, b) => b.total_qty - a.total_qty).slice(0, 5))
      }

      if (kpiRes.data) {
        setTargets({
          labor_pct: Number(kpiRes.data.labor_pct) || DEFAULT_TARGETS.labor_pct,
          waste_pct: Number(kpiRes.data.waste_pct) || DEFAULT_TARGETS.waste_pct,
          repairs_pct: Number(kpiRes.data.repairs_pct) || DEFAULT_TARGETS.repairs_pct,
          gross_profit_pct: Number(kpiRes.data.gross_profit_pct) || DEFAULT_TARGETS.gross_profit_pct,
        })
      }
      setLoading(false)
    }
    load()
  }, [from, to, department])

  // --- Aggregations ---
  const agg = (arr: DayData[], field: keyof DayData) => arr.reduce((s, d) => s + Number(d[field]), 0)

  const totalSales    = agg(days, 'sales')
  const totalProd     = agg(days, 'production')
  const totalWaste    = agg(days, 'waste')
  const totalRepairs  = agg(days, 'repairs')
  const hourlyLabor   = agg(days, 'labor')

  const workingDaysInPeriod = countWorkingDaysInRange(from, to)
  const globalLaborCost = calcGlobalLaborForDept(globalEmps, department, workingDaysMonth, workingDaysInPeriod)
  const totalLabor      = hourlyLabor + globalLaborCost

  const grossProfit     = totalSales - totalProd - totalLabor
  const operatingProfit = grossProfit - totalWaste - totalRepairs

  const prevSales       = agg(prevDays, 'sales')
  const prevProd        = agg(prevDays, 'production')
  const prevLabor       = agg(prevDays, 'labor')
  const prevWaste       = agg(prevDays, 'waste')
  const prevRepairs     = agg(prevDays, 'repairs')
  const prevGross       = prevSales - prevProd - prevLabor
  void (prevGross - prevWaste - prevRepairs) // prevOperating available if needed

  const relevantGlobalEmps = globalEmps.filter(e => e.department === department || e.department === 'both')

  const laborPct  = pct(totalLabor, totalSales)
  const wastePct  = pct(totalWaste, totalSales)
  const productionPct = pct(totalProd, totalSales)

  // Previous period percentages for DiffBadge
  const prevLaborPct = pct(prevLabor, prevSales)
  const prevWastePct = pct(prevWaste, prevSales)

  // --- Chart data: daily data for the current period ---
  const chartData = days.map(d => ({
    name: new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }),
    sales: d.sales,
    production: d.production,
    labor: d.labor,
    waste: d.waste,
  }))

  // --- Cost breakdown for Row 2 right card ---
  const costItems = [
    { label: 'לייבור', value: totalLabor, color: '#6366f1' },
    { label: 'פחת', value: totalWaste, color: '#94a3b8' },
    { label: 'תיקונים', value: totalRepairs, color: '#94a3b8' },
  ]
  const maxCost = Math.max(...costItems.map(c => c.value), 1)

  // --- Render ---
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ direction: 'rtl', background: '#f8fafc' }}>
      <div className="text-slate-400 text-base">טוען נתונים...</div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ direction: 'rtl', background: '#f8fafc' }}>

      <PageHeader title="דשבורד מחלקה" subtitle={cfg.label} onBack={onBack} action={<PeriodPicker period={globalPeriod} onChange={setGlobalPeriod} />} />

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>

        {/* ── ROW 1: 4 Golden KPIs ── */}
        <motion.div
          variants={fadeIn} initial="hidden" animate="visible"
          className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5"
        >
          {/* 1. Sales */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>מכירות מחלקה</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>
              {fmtMoney(totalSales)}
            </div>
            <DiffBadge current={totalSales} previous={prevSales} />
          </div>

          {/* 2. Production cost (from reports) */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>עלות ייצור</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>
              {prodReportCost > 0 ? fmtMoney(prodReportCost) : fmtMoney(totalProd)}
            </div>
            {prodReportCost > 0
              ? <DiffBadge current={prodReportCost} previous={prevProdReportCost} inverse />
              : <DiffBadge current={totalProd} previous={prevProd} />
            }
          </div>

          {/* 3. Labor % */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>% לייבור</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#6366f1' }}>
              {fmtPct(laborPct)}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>יעד: {fmtPct(targets.labor_pct)}</div>
            <DiffBadge current={laborPct} previous={prevLaborPct} inverse />
          </div>

          {/* 4. Waste % */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>% פחת</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>
              {fmtPct(wastePct)}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>יעד: {fmtPct(targets.waste_pct)}</div>
            <DiffBadge current={wastePct} previous={prevWastePct} />
          </div>
        </motion.div>

        {/* ── ROW 2: 2 Detail Cards ── */}
        <motion.div
          variants={fadeIn} initial="hidden" animate="visible"
          className="grid grid-cols-2 gap-2.5 mb-2.5"
        >
          {/* LEFT: Sales breakdown */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>פירוט מכירות</div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] text-slate-600">סה״כ מכירות</span>
                <span className="text-[14px] font-bold" style={{ color: '#6366f1' }}>{fmtMoney(totalSales)}</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: '100%', background: '#6366f1' }}
                />
              </div>
              <div className="mt-4 flex items-center justify-between mb-2">
                <span className="text-[13px] text-slate-600 cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span>
                <span className="text-[14px] font-bold" style={{ color: grossProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtMoney(grossProfit)}</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: totalSales > 0 ? `${Math.max(0, Math.min(100, (grossProfit / totalSales) * 100))}%` : '0%',
                    background: '#6366f1',
                  }}
                />
              </div>
              <div className="mt-4 flex items-center justify-between mb-2">
                <span className="text-[13px] text-slate-600">רווח תפעולי</span>
                <span className="text-[14px] font-bold" style={{ color: operatingProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtMoney(operatingProfit)}</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: totalSales > 0 ? `${Math.max(0, Math.min(100, (operatingProfit / totalSales) * 100))}%` : '0%',
                    background: '#6366f1',
                  }}
                />
              </div>
          </div>

          {/* RIGHT: Costs breakdown */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>עלויות מחלקה</div>
              {costItems.map(item => (
                <div key={item.label} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] text-slate-600">{item.label}</span>
                    <span className="text-[14px] font-bold" style={{ color: item.color }}>{fmtMoney(item.value)}</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max(2, (item.value / maxCost) * 100)}%`,
                        background: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </motion.div>

        {/* ── ROW 3: KPI Targets with progress bars ── */}
        <motion.div
          variants={fadeIn} initial="hidden" animate="visible"
          className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-2.5"
        >
          {[
            { label: '% לייבור', actual: laborPct, target: targets.labor_pct, color: '#6366f1', inverse: true },
            { label: '% פחת', actual: wastePct, target: targets.waste_pct, color: '#BA7517', inverse: true },
            { label: '% ייצור', actual: productionPct, target: targets.gross_profit_pct, color: '#6366f1', inverse: true },
          ].map(item => {
            const barColor = kpiColor(item.actual, item.target, item.inverse)
            const ratio = item.target > 0 ? Math.min((item.actual / item.target) * 100, 100) : 0
            return (
              <div key={item.label} style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold text-slate-500">{item.label}</span>
                  <span className="text-[12px] font-bold" style={{ color: barColor }}>
                    {fmtPct(item.actual)} / {fmtPct(item.target)}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${ratio}%`, background: barColor }}
                  />
                </div>
              </div>
            )
          })}
        </motion.div>

        {/* ── ROW 4: 6-month / period LineChart ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-5">
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>מגמות לאורך התקופה</div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} reversed />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                  <Tooltip
                    contentStyle={{ direction: 'rtl', fontSize: 13, borderRadius: 8 }}
                    formatter={(value: any, name: any) => [fmtMoney(Number(value)), String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="sales" name="מכירות" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="production" name="ייצור" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="labor" name="לייבור" stroke="#94a3b8" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="waste" name="פחת" stroke="#cbd5e1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
          </div>
        </motion.div>

        {/* ── Daily Detail Table ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>פירוט יומי</div>

              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '10px 16px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>תאריך</span>
                <span style={{ textAlign: 'left' }}>מכירות</span>
                <span style={{ textAlign: 'left' }}>ייצור</span>
                <span style={{ textAlign: 'left' }}>לייבור</span>
                <span style={{ textAlign: 'left' }}>פחת</span>
                <span style={{ textAlign: 'left' }}>תיקונים</span>
                <span style={{ textAlign: 'left' }} className="cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span>
                <span style={{ textAlign: 'left' }}>רווח תפעולי</span>
              </div>

              {days.length === 0 ? (
                <div className="py-10 text-center text-slate-400">אין נתונים לתקופה זו</div>
              ) : [...days].reverse().map((d, i) => {
                const gp = d.sales - d.production - d.labor
                const op = gp - d.waste - d.repairs
                return (
                  <div key={d.date} style={{
                    display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr 1fr 1fr 1fr',
                    alignItems: 'center', padding: '12px 16px',
                    borderBottom: '1px solid #f8fafc',
                  }}>
                    <span className="text-[13px] text-slate-500 font-medium">
                      {new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}
                    </span>
                    <span className="text-[14px] font-bold" style={{ color: '#6366f1' }}>{d.sales > 0 ? fmtMoney(d.sales) : '—'}</span>
                    <span className="text-[13px] text-slate-500">{d.production > 0 ? fmtMoney(d.production) : '—'}</span>
                    <span className="text-[13px]" style={{ color: '#6366f1', fontWeight: d.labor > 0 ? 600 : 400 }}>{d.labor > 0 ? fmtMoney(d.labor) : '—'}</span>
                    <span className="text-[13px]" style={{ color: '#E24B4A', fontWeight: d.waste > 0 ? 600 : 400 }}>{d.waste > 0 ? fmtMoney(d.waste) : '—'}</span>
                    <span className="text-[13px]" style={{ color: '#E24B4A', fontWeight: d.repairs > 0 ? 600 : 400 }}>{d.repairs > 0 ? fmtMoney(d.repairs) : '—'}</span>
                    <span className="text-[13px] font-bold" style={{
                      color: gp >= 0 ? '#639922' : '#E24B4A',
                    }}>
                      {d.sales > 0 ? fmtMoney(gp) : '—'}
                    </span>
                    <span className="text-[13px] font-bold" style={{
                      color: op >= 0 ? '#639922' : '#E24B4A',
                    }}>
                      {d.sales > 0 ? fmtMoney(op) : '—'}
                    </span>
                  </div>
                )
              })}

              {/* Total row */}
              {days.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '14px 16px', background: '#fafafa', borderTop: '1px solid #f1f5f9', borderRadius: '0 0 12px 12px', fontWeight: 700 }}>
                  <span style={{ fontSize: 13, color: '#0f172a' }}>סה"כ</span>
                  <span style={{ color: '#0f172a' }}>{fmtMoney(totalSales)}</span>
                  <span style={{ color: '#64748b' }}>{fmtMoney(totalProd)}</span>
                  <span style={{ color: '#6366f1' }}>{fmtMoney(totalLabor)}</span>
                  <span style={{ color: '#64748b' }}>{fmtMoney(totalWaste)}</span>
                  <span style={{ color: '#64748b' }}>{fmtMoney(totalRepairs)}</span>
                  <span style={{ color: grossProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtMoney(grossProfit)}</span>
                  <span style={{ color: operatingProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtMoney(operatingProfit)}</span>
                </div>
              )}
          </div>
        </motion.div>

        {/* ── Global Employees Table ── */}
        {relevantGlobalEmps.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mt-5">
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 20 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>פירוט לייבור — עובדים גלובליים</div>

                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 70px 70px 70px 110px 120px', padding: '10px 16px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: 700, color: '#64748b' }}>
                  <span>עובד</span>
                  <span style={{ textAlign: 'center' }}>ימים</span>
                  <span style={{ textAlign: 'center' }}>100%</span>
                  <span style={{ textAlign: 'center' }}>125%</span>
                  <span style={{ textAlign: 'center' }}>150%</span>
                  <span style={{ textAlign: 'left' }}>ברוטו</span>
                  <span style={{ textAlign: 'left' }}>עלות מעסיק</span>
                </div>

                {relevantGlobalEmps.map((emp, i) => {
                  const isBoth = emp.department === 'both'
                  const factor = isBoth ? 0.5 : 1
                  const bruto = emp.global_daily_rate
                  const employerCost = bruto * 1.3 * factor * (workingDaysInPeriod / (workingDaysMonth || 1))
                  return (
                    <div key={emp.id} style={{
                      display: 'grid', gridTemplateColumns: '1.5fr 80px 70px 70px 70px 110px 120px',
                      alignItems: 'center', padding: '12px 16px',
                      borderBottom: '1px solid #f8fafc',
                    }}>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700 text-sm">{emp.name}</span>
                        <span className="text-[11px] bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-full font-semibold">גלובלי</span>
                        {isBoth && <span className="text-[11px] text-slate-400">(50%)</span>}
                      </div>
                      <span className="text-[13px] text-slate-500 text-center">{workingDaysInPeriod}</span>
                      <span className="text-[13px] text-slate-300 text-center">—</span>
                      <span className="text-[13px] text-slate-300 text-center">—</span>
                      <span className="text-[13px] text-slate-300 text-center">—</span>
                      <span className="text-sm font-bold text-slate-700">{fmtMoney(bruto)}</span>
                      <span className="text-sm font-bold" style={{ color: cfg.color }}>{fmtMoney(employerCost)}</span>
                    </div>
                  )
                })}

                {/* Total row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 70px 70px 70px 110px 120px', padding: '14px 16px', background: '#fafafa', borderTop: '1px solid #f1f5f9', borderRadius: '0 0 12px 12px', fontWeight: 700 }}>
                  <span style={{ fontSize: 13, color: '#0f172a' }}>סה"כ גלובלי</span>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span style={{ fontSize: 15, color: '#6366f1' }}>{fmtMoney(globalLaborCost)}</span>
                </div>
            </div>
          </motion.div>
        )}

        {/* ── Top Products ── */}
        {topProducts.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible" style={{ marginTop: 10 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 12px' }}>מוצרים נמכרים ביותר</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', gap: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', padding: '6px 0', borderBottom: '1px solid #e2e8f0' }}>מוצר</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', padding: '6px 0', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>כמות</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', padding: '6px 0', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>מחיר</span>
                {topProducts.map((p, i) => (
                  <div key={i} style={{ display: 'contents' }}>
                    <span style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid #f8fafc', color: '#374151' }}>{p.product_name}</span>
                    <span style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid #f8fafc', textAlign: 'center', fontWeight: 600 }}>{p.total_qty}</span>
                    <span style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid #f8fafc', textAlign: 'left', color: '#64748b' }}>{fmtMoney(p.unit_price)}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

      </div>
    </div>
  )
}
