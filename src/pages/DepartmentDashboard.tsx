import { useState, useEffect } from 'react'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept, countWorkingDaysInRange } from '../lib/supabase'
import type { GlobalEmployee } from '../lib/supabase'
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
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
  creams: { label: 'קרמים', color: '#818cf8', bg: '#dbeafe' },
  dough:  { label: 'בצקים', color: '#c084fc', bg: '#ede9fe' },
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
function fmtMoney(n: number) { return '₪' + Math.round(n).toLocaleString() }

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

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

  // Previous period percentages for DiffBadge
  const prevLaborPct = pct(prevLabor, prevSales)
  const prevWastePct = pct(prevWaste, prevSales)

  // --- Chart data: daily data for the current period ---
  const chartData = days.map(d => ({
    name: new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }),
    sales: d.sales,
    production: d.production,
    labor: d.labor,
  }))

  // --- Cost breakdown for Row 2 right card ---
  const costItems = [
    { label: 'לייבור', value: totalLabor, color: '#534AB7' },
    { label: 'פחת', value: totalWaste, color: '#E24B4A' },
    { label: 'תיקונים', value: totalRepairs, color: '#E24B4A' },
  ]
  const maxCost = Math.max(...costItems.map(c => c.value), 1)

  // --- Render ---
  if (loading) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center" style={{ direction: 'rtl' }}>
      <div className="text-slate-400 text-base">טוען נתונים...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* ── Header ── */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: cfg.bg }}>
          <ProfitIcon size={20} color={cfg.color} />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 m-0">דשבורד — {cfg.label}</h1>
          <p className="text-[13px] text-slate-400 m-0">KPI · גרפים · פירוט</p>
        </div>
        <div className="mr-auto">
          <PeriodPicker period={globalPeriod} onChange={setGlobalPeriod} />
        </div>
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>

        {/* ── ROW 1: 4 Golden KPIs ── */}
        <motion.div
          variants={fadeIn} initial="hidden" animate="visible"
          className="grid grid-cols-4 gap-2.5 mb-2.5"
        >
          {/* 1. Sales */}
          <Card className="shadow-sm border border-slate-200 rounded-lg">
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">מכירות מחלקה</div>
              <div className="text-[22px] font-medium" style={{ color: '#378ADD' }}>
                {fmtMoney(totalSales)}
              </div>
              <DiffBadge current={totalSales} previous={prevSales} />
            </CardContent>
          </Card>

          {/* 2. Production cost */}
          <Card className="shadow-sm border border-slate-200 rounded-lg">
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">ייצור (כמות)</div>
              <div className="text-[22px] font-medium" style={{ color: '#E24B4A' }}>
                {fmtMoney(totalProd)}
              </div>
              <DiffBadge current={totalProd} previous={prevProd} />
            </CardContent>
          </Card>

          {/* 3. Labor % */}
          <Card className="shadow-sm border border-slate-200 rounded-lg">
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">% לייבור</div>
              <div className="text-[22px] font-medium" style={{ color: laborPct <= targets.labor_pct ? '#639922' : '#E24B4A' }}>
                {fmtPct(laborPct)}
              </div>
              <div className="text-[11px] text-slate-400">יעד: {fmtPct(targets.labor_pct)}</div>
              <DiffBadge current={laborPct} previous={prevLaborPct} inverse />
            </CardContent>
          </Card>

          {/* 4. Waste % */}
          <Card className="shadow-sm border border-slate-200 rounded-lg">
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">% פחת</div>
              <div className="text-[22px] font-medium" style={{ color: wastePct <= targets.waste_pct ? '#639922' : '#E24B4A' }}>
                {fmtPct(wastePct)}
              </div>
              <div className="text-[11px] text-slate-400">יעד: {fmtPct(targets.waste_pct)}</div>
              <DiffBadge current={wastePct} previous={prevWastePct} />
            </CardContent>
          </Card>
        </motion.div>

        {/* ── ROW 2: 2 Detail Cards ── */}
        <motion.div
          variants={fadeIn} initial="hidden" animate="visible"
          className="grid grid-cols-2 gap-2.5 mb-2.5"
        >
          {/* LEFT: Sales breakdown */}
          <Card className="shadow-sm border border-slate-200 rounded-lg">
            <CardContent className="p-4">
              <div className="text-sm font-bold text-slate-700 mb-3">פירוט מכירות</div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] text-slate-600">סה״כ מכירות</span>
                <span className="text-[14px] font-bold" style={{ color: '#378ADD' }}>{fmtMoney(totalSales)}</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: '100%', background: '#378ADD' }}
                />
              </div>
              <div className="mt-4 flex items-center justify-between mb-2">
                <span className="text-[13px] text-slate-600">רווח גולמי</span>
                <span className="text-[14px] font-bold" style={{ color: grossProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtMoney(grossProfit)}</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: totalSales > 0 ? `${Math.max(0, Math.min(100, (grossProfit / totalSales) * 100))}%` : '0%',
                    background: '#378ADD',
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
                    background: '#378ADD',
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* RIGHT: Costs breakdown */}
          <Card className="shadow-sm border border-slate-200 rounded-lg">
            <CardContent className="p-4">
              <div className="text-sm font-bold text-slate-700 mb-3">עלויות מחלקה</div>
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
            </CardContent>
          </Card>
        </motion.div>

        {/* ── ROW 3: 6-month / period LineChart ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-5">
          <Card className="shadow-sm border border-slate-200 rounded-lg">
            <CardContent className="p-4">
              <div className="text-sm font-bold text-slate-700 mb-3">מגמות לאורך התקופה</div>
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
                  <Line type="monotone" dataKey="sales" name="מכירות" stroke="#378ADD" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="production" name="ייצור" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="labor" name="לייבור" stroke="#E24B4A" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Daily Detail Table ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="shadow-sm border border-slate-200 rounded-lg">
            <CardContent className="p-5">
              <div className="text-[15px] font-bold text-slate-700 mb-4">פירוט יומי</div>

              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '10px 16px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>תאריך</span>
                <span style={{ textAlign: 'left' }}>מכירות</span>
                <span style={{ textAlign: 'left' }}>ייצור</span>
                <span style={{ textAlign: 'left' }}>לייבור</span>
                <span style={{ textAlign: 'left' }}>פחת</span>
                <span style={{ textAlign: 'left' }}>תיקונים</span>
                <span style={{ textAlign: 'left' }}>רווח גולמי</span>
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
                    borderBottom: i < days.length - 1 ? '1px solid #f1f5f9' : 'none',
                    background: i % 2 === 0 ? 'white' : '#fafafa',
                  }}>
                    <span className="text-[13px] text-slate-500 font-medium">
                      {new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}
                    </span>
                    <span className="text-[14px] font-bold" style={{ color: '#378ADD' }}>{d.sales > 0 ? fmtMoney(d.sales) : '—'}</span>
                    <span className="text-[13px] text-slate-500">{d.production > 0 ? fmtMoney(d.production) : '—'}</span>
                    <span className="text-[13px]" style={{ color: '#534AB7', fontWeight: d.labor > 0 ? 600 : 400 }}>{d.labor > 0 ? fmtMoney(d.labor) : '—'}</span>
                    <span className="text-[13px]" style={{ color: '#E24B4A', fontWeight: d.waste > 0 ? 600 : 400 }}>{d.waste > 0 ? fmtMoney(d.waste) : '—'}</span>
                    <span className="text-[13px]" style={{ color: '#E24B4A', fontWeight: d.repairs > 0 ? 600 : 400 }}>{d.repairs > 0 ? fmtMoney(d.repairs) : '—'}</span>
                    <span className="text-[13px] font-bold px-2 py-0.5 rounded-md inline-block" style={{
                      color: gp >= 0 ? '#639922' : '#E24B4A',
                      background: gp >= 0 ? '#f0fdf4' : '#fef2f2',
                    }}>
                      {d.sales > 0 ? fmtMoney(gp) : '—'}
                    </span>
                    <span className="text-[13px] font-bold px-2 py-0.5 rounded-md inline-block" style={{
                      color: op >= 0 ? '#639922' : '#E24B4A',
                      background: op >= 0 ? '#f0fdf4' : '#fef2f2',
                    }}>
                      {d.sales > 0 ? fmtMoney(op) : '—'}
                    </span>
                  </div>
                )
              })}

              {/* Total row */}
              {days.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '14px 16px', background: cfg.bg, borderTop: `2px solid ${cfg.color}33`, borderRadius: '0 0 20px 20px', fontWeight: 700 }}>
                  <span className="text-[13px] text-slate-700">סה"כ</span>
                  <span style={{ color: '#378ADD' }}>{fmtMoney(totalSales)}</span>
                  <span className="text-slate-500">{fmtMoney(totalProd)}</span>
                  <span style={{ color: '#534AB7' }}>{fmtMoney(totalLabor)}</span>
                  <span style={{ color: '#E24B4A' }}>{fmtMoney(totalWaste)}</span>
                  <span style={{ color: '#E24B4A' }}>{fmtMoney(totalRepairs)}</span>
                  <span style={{ color: grossProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtMoney(grossProfit)}</span>
                  <span style={{ color: operatingProfit >= 0 ? '#639922' : '#E24B4A' }}>{fmtMoney(operatingProfit)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Global Employees Table ── */}
        {relevantGlobalEmps.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mt-5">
            <Card className="shadow-sm border border-slate-200 rounded-lg">
              <CardContent className="p-5">
                <div className="text-[15px] font-bold text-slate-700 mb-4">פירוט לייבור — עובדים גלובליים</div>

                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 70px 70px 70px 110px 120px', padding: '10px 16px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: 700, color: '#64748b' }}>
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
                      borderBottom: i < relevantGlobalEmps.length - 1 ? '1px solid #f1f5f9' : 'none',
                      background: i % 2 === 0 ? 'white' : '#fafafa',
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
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 70px 70px 70px 110px 120px', padding: '14px 16px', background: cfg.bg, borderTop: `2px solid ${cfg.color}33`, borderRadius: '0 0 20px 20px', fontWeight: 700 }}>
                  <span className="text-[13px] text-slate-700">סה"כ גלובלי</span>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span className="text-[15px]" style={{ color: cfg.color }}>{fmtMoney(globalLaborCost)}</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

      </div>
    </div>
  )
}
