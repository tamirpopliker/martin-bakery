import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase, fetchBranchPL, getOverheadPct, type BranchPLResult } from '../lib/supabase'
import { calculateBranchPL } from '../lib/calculatePL'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TrendingUp, TrendingDown, CreditCard, Globe, BookOpen } from 'lucide-react'
import { fetchRevenueBySource } from '../lib/revenueBySource'
import PageHeader from '../components/PageHeader'
import { RevenueIcon, ProfitIcon, LaborIcon } from '@/components/icons'
import { generateInsights, type InsightsInput } from '../lib/generateInsights'
import InsightsCard from '../components/InsightsCard'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

/* ─── helpers ─── */

function fmtN(n: number) { return '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) }
function fmtPct(n: number) { return n.toFixed(1) + '%' }

const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const, delay } },
})

/* ─── sub-components ─── */

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

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-100 px-4 py-3">
      <p className="text-[11px] font-bold text-slate-500 mb-1.5 border-b border-slate-100 pb-1.5">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-6 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-[11px] text-slate-600">{entry.name}</span>
          </div>
          <span className="text-[12px] font-bold text-slate-800">₪{Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      ))}
    </div>
  )
}

/** KPI target progress card */
function KpiTargetCard({ label, actual, target, lowerIsBetter }: {
  label: string; actual: number; target: number; lowerIsBetter: boolean
}) {
  const deviation = lowerIsBetter
    ? (actual - target) / Math.max(target, 0.01)
    : (target - actual) / Math.max(target, 0.01)

  const color = deviation <= 0 ? '#639922' : deviation <= 0.2 ? '#E09100' : '#E24B4A'
  const barPct = lowerIsBetter
    ? Math.min((actual / Math.max(target, 0.01)) * 100, 150)
    : Math.min((actual / Math.max(target, 0.01)) * 100, 150)

  return (
    <Card className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
      <CardContent className="p-0">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[13px] font-medium text-slate-600">{label}</span>
          <span className="text-[13px] font-bold" style={{ color }}>{fmtPct(actual)}</span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
          <motion.div
            className="h-full rounded-full"
            style={{ background: color }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(barPct, 100)}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        <span className="text-[11px] text-slate-400">יעד: {fmtPct(target)}</span>
      </CardContent>
    </Card>
  )
}

/* ─── main component ─── */

interface BranchDashboardProps {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

export default function BranchDashboard({ branchId, branchName, branchColor, onBack }: BranchDashboardProps) {
  const { period, setPeriod, comparisonPeriod, from, to, monthKey } = usePeriod()

  const [loading, setLoading] = useState(true)

  // Current period P&L
  const [pl, setPl] = useState<BranchPLResult | null>(null)

  // KPI targets
  const [laborTarget, setLaborTarget] = useState(0)
  const [wasteTarget, setWasteTarget] = useState(3)
  const [insights, setInsights] = useState<any[]>([])

  // Previous period P&L
  const [prevPl, setPrevPl] = useState<BranchPLResult | null>(null)

  // Trend
  const [trendData, setTrendData] = useState<any[]>([])
  // Daily revenue for the selected month (with comparison to same day-of-month
  // average over the previous 3 months). Only populated when a single month is
  // selected; quarter/year periods leave it empty and hide the chart.
  const [dailyChart, setDailyChart] = useState<{ day: string; current: number | null; avg: number | null }[]>([])

  // Revenue split by source (קופות / אתר / הקפה) for this branch
  const [posRevenue, setPosRevenue] = useState(0)
  const [websiteRevenue, setWebsiteRevenue] = useState(0)
  const [creditRevenue, setCreditRevenue] = useState(0)

  // Derived values from current P&L
  const totalRevenue = pl?.revenue ?? 0
  const expSupplier = pl?.expSuppliers ?? 0
  const expSuppliersInternal = pl?.expSuppliersInternal ?? 0
  const expSuppliersExternal = pl?.expSuppliersExternal ?? 0
  const laborEmployer = pl?.laborEmployer ?? 0
  const wasteTotal = pl?.wasteTotal ?? 0
  const fixedCosts = pl?.fixedCosts ?? 0
  const mgmtCosts = pl?.mgmtCosts ?? 0
  const expRepairs = pl?.expRepairs ?? 0
  const overheadAmount = pl?.overheadAmount ?? 0
  const controllableMargin = pl?.controllableMargin ?? 0
  const operatingProfit = pl?.operatingProfit ?? 0
  const laborPct = totalRevenue > 0 ? (laborEmployer / totalRevenue) * 100 : 0
  const wastePct = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0
  const opProfitPct = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0

  const [overheadPct, setOverheadPct] = useState(5)

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, from, to, monthKey])

  async function fetchTrend() {
    // Bug E fix: previously this function reimplemented P&L inline with a
    // simplified formula (no manager salary, no employer_costs fallback,
    // no internal/external supplier split). The graph numbers diverged from
    // the P&L card on the same page. Now delegates to calculateBranchPL —
    // the canonical source — so every cell on the dashboard agrees.
    const months: string[] = []
    const now = new Date(from)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(d.toISOString().slice(0, 7))
    }

    const data = await Promise.all(months.map(async (m) => {
      const mFrom = m + '-01'
      const mTo = new Date(new Date(mFrom).getFullYear(), new Date(mFrom).getMonth() + 1, 1).toISOString().slice(0, 10)
      const pl = await calculateBranchPL(branchId, mFrom, mTo, undefined, m)
      const label = new Date(mFrom + 'T12:00:00').toLocaleDateString('he-IL', { month: 'short', year: '2-digit' })
      return {
        month: label,
        'הכנסות': Math.round(pl.revenue),
        'רווח נשלט': Math.round(pl.controllableProfit),
        'רווח תפעולי': Math.round(pl.operatingProfit),
      }
    }))

    return data
  }

  async function fetchDailyChart() {
    const mk = monthKey || from.slice(0, 7)
    const [y, m] = mk.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const today = new Date()
    const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === m
    const lastFilledDay = isCurrentMonth ? today.getDate() : daysInMonth

    // Pull 4 months of revenue (current + 3 prior) in one round-trip per table.
    const rangeStart = `${y}-${String(m).padStart(2, '0')}-01`
    const startObj = new Date(y, m - 4, 1)
    const startDate = `${startObj.getFullYear()}-${String(startObj.getMonth() + 1).padStart(2, '0')}-01`
    const endObj = new Date(y, m, 1)
    const endDate = `${endObj.getFullYear()}-${String(endObj.getMonth() + 1).padStart(2, '0')}-01`

    const [{ data: closings }, { data: revenues }] = await Promise.all([
      supabase.from('register_closings').select('date, cash_sales, credit_sales')
        .eq('branch_id', branchId).gte('date', startDate).lt('date', endDate),
      supabase.from('branch_revenue').select('date, amount')
        .eq('branch_id', branchId).gte('date', startDate).lt('date', endDate),
    ])

    const totalByDate: Record<string, number> = {}
    for (const c of (closings || [])) {
      totalByDate[c.date] = (totalByDate[c.date] || 0) + Number(c.cash_sales || 0) + Number(c.credit_sales || 0)
    }
    for (const r of (revenues || [])) {
      totalByDate[r.date] = (totalByDate[r.date] || 0) + Number(r.amount || 0)
    }

    const chart: { day: string; current: number | null; avg: number | null }[] = []
    for (let d = 1; d <= daysInMonth; d++) {
      const curISO = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const current = curISO < rangeStart ? null : d > lastFilledDay ? null : (totalByDate[curISO] || 0)

      let sum = 0, count = 0
      for (let back = 1; back <= 3; back++) {
        const prev = new Date(y, m - 1 - back, d)
        const prevLastDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate()
        if (d > prevLastDay) continue
        const prevISO = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        if (totalByDate[prevISO] !== undefined) {
          sum += totalByDate[prevISO]
          count++
        }
      }
      const avg = count > 0 ? Math.round(sum / count) : null

      chart.push({ day: String(d), current: current === null ? null : Math.round(current), avg })
    }
    setDailyChart(chart)
  }

  async function fetchData() {
    setLoading(true)
    try {
      const oh = await getOverheadPct()
      setOverheadPct(oh)
      const curMonthKey = monthKey || from.slice(0, 7)
      const prevMonthKey = comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)

      const [current, prev, trend, kpiRes, sources] = await Promise.all([
        fetchBranchPL(branchId, from, to, curMonthKey, oh),
        fetchBranchPL(branchId, comparisonPeriod.from, comparisonPeriod.to, prevMonthKey, oh),
        fetchTrend(),
        supabase.from('branch_kpi_targets').select('labor_pct, waste_pct').eq('branch_id', branchId).maybeSingle(),
        fetchRevenueBySource([branchId], from, to),
      ])
      // Daily chart runs alongside but uses its own raw queries.
      fetchDailyChart().catch(err => console.error('BranchDashboard daily chart:', err))

      setPosRevenue(sources.pos[branchId] ?? 0)
      setWebsiteRevenue(sources.website[branchId] ?? 0)
      setCreditRevenue(sources.credit[branchId] ?? 0)

      // fetchBranchPL already returns the correct supplier split (internal
      // from internal_sales, external from branch_expenses). The previous
      // override via fetchBranchProfit pulled from the stale branch_pl_summary
      // VIEW (built on branch_labor, not employer_costs) — removed.

      setPl(current)
      setPrevPl(prev)

      if (kpiRes.data?.labor_pct) setLaborTarget(kpiRes.data.labor_pct)
      if (kpiRes.data?.waste_pct) setWasteTarget(kpiRes.data.waste_pct)

      // Generate insights
      const rev = current.revenue || 0
      const insightInput: InsightsInput = {
        labor: { totalCost: current.laborEmployer || 0, targetPct: kpiRes.data?.labor_pct || 28, revenue: rev },
        revenue: { actual: rev, target: kpiRes.data?.revenue_target || 0 },
        waste: { totalAmount: current.wasteTotal || 0, targetPct: kpiRes.data?.waste_pct || 3, revenue: rev },
        controllableProfit: { actual: current.controllableMargin || 0, target: rev * 0.30, revenue: rev },
        factoryPurchases: { amount: current.expSuppliersInternal || 0, avgMonthly: current.expSuppliersInternal || 0, isHolidayMonth: false },
      }
      setInsights(generateInsights(insightInput))

      setTrendData(trend)
    } catch (err) {
      console.error('BranchDashboard fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  /* ─── P&L table rows ─── */
  const pctOf = (v: number) => totalRevenue > 0 ? ((v / totalRevenue) * 100).toFixed(1) + '%' : '—'

  type PLTableRow = { label: string; amount: number; isSeparator?: boolean; bold?: boolean; bgClass?: string }

  const plRows: PLTableRow[] = [
    { label: 'הכנסות', amount: totalRevenue },
    { label: 'רכישות מפעל', amount: expSuppliersInternal },
    { label: 'ספקים חיצוניים', amount: expSuppliersExternal },
    { label: 'לייבור', amount: laborEmployer },
    { label: 'שכר מנהל', amount: mgmtCosts },
    { label: 'תיקונים', amount: expRepairs },
    { label: '', amount: 0, isSeparator: true },
    { label: 'רווח נשלט', amount: controllableMargin, bold: true, bgClass: controllableMargin >= 0 ? 'bg-emerald-50' : 'bg-rose-50' },
    { label: '', amount: 0, isSeparator: true },
    { label: 'עלויות קבועות', amount: fixedCosts },
    { label: 'העמסת מטה', amount: overheadAmount },
    { label: '', amount: 0, isSeparator: true },
    { label: 'רווח תפעולי', amount: operatingProfit, bold: true, bgClass: operatingProfit >= 0 ? 'bg-emerald-50' : 'bg-rose-50' },
  ]

  return (
    <div dir="rtl">
      {/* HEADER */}
      <PageHeader
        title="דשבורד סניף"
        subtitle={branchName}
        onBack={onBack}
        action={<PeriodPicker period={period} onChange={setPeriod} />}
      />

      {/* BODY */}
      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400" />
          </div>
        ) : (
          <>
            {/* Insights */}
            <InsightsCard insights={insights} />

            {/* ROW 1 — 4 KPI Cards */}
            <motion.div variants={fadeIn(0)} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5">
              {/* הכנסות */}
              <Card className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 mb-2">
                    <RevenueIcon size={18} />
                    <span className="text-[11px] text-slate-400">הכנסות</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[22px] font-medium" style={{ color: '#378ADD' }}>
                      <CountUp end={totalRevenue} prefix="₪" separator="," duration={0.8} />
                    </span>
                    <DiffBadge current={totalRevenue} previous={prevPl?.revenue ?? 0} />
                  </div>
                </CardContent>
              </Card>

              {/* רווח נשלט */}
              <Card className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 mb-2">
                    <ProfitIcon size={18} />
                    <span className="text-[11px] text-slate-400 cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[22px] font-medium" style={{ color: controllableMargin >= 0 ? '#639922' : '#E24B4A' }}>
                      <CountUp end={controllableMargin} prefix="₪" separator="," duration={0.8} />
                    </span>
                    <DiffBadge current={controllableMargin} previous={prevPl?.controllableMargin ?? 0} />
                  </div>
                </CardContent>
              </Card>

              {/* רווח תפעולי */}
              <Card className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 mb-2">
                    <ProfitIcon size={18} />
                    <span className="text-[11px] text-slate-400">רווח תפעולי</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[22px] font-medium" style={{ color: operatingProfit >= 0 ? '#639922' : '#E24B4A' }}>
                      <CountUp end={operatingProfit} prefix="₪" separator="," duration={0.8} />
                    </span>
                    <DiffBadge current={operatingProfit} previous={prevPl?.operatingProfit ?? 0} />
                  </div>
                </CardContent>
              </Card>

              {/* % לייבור */}
              <Card className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 mb-2">
                    <LaborIcon size={18} />
                    <span className="text-[11px] text-slate-400">% לייבור</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[22px] font-medium" style={{ color: laborTarget > 0 ? (laborPct <= laborTarget ? '#639922' : '#E24B4A') : '#334155' }}>
                      <CountUp end={laborPct} decimals={1} suffix="%" duration={0.8} />
                    </span>
                    <DiffBadge current={laborPct} previous={prevPl && prevPl.revenue > 0 ? (prevPl.laborEmployer / prevPl.revenue) * 100 : 0} inverse />
                  </div>
                  <span className="text-[11px] text-slate-400">{laborTarget > 0 ? `יעד ${laborTarget}%` : '\u2014'}</span>
                  {pl?.laborIsActual !== undefined && (
                    <div style={{ fontSize: 10, marginTop: 4, color: pl.laborIsActual ? '#16a34a' : '#ca8a04', fontWeight: 600 }}>
                      {pl.laborIsActual ? '✓ נתוני מעסיק אמיתיים' : '~ משוער'}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* ROW 1b — Revenue by Source (קופות / אתר / הקפה) */}
            <motion.div variants={fadeIn(0.05)} initial="hidden" animate="visible" className="grid grid-cols-3 gap-2.5 mb-2.5">
              {(() => {
                const sourceTotal = posRevenue + websiteRevenue + creditRevenue
                const pctOfSource = (v: number) => sourceTotal > 0 ? ((v / sourceTotal) * 100).toFixed(1) + '%' : '—'
                const cards = [
                  { label: 'קופות',  amount: posRevenue,     Icon: CreditCard, color: '#F59E0B' },
                  { label: 'אתר',    amount: websiteRevenue, Icon: Globe,      color: '#0EA5E9' },
                  { label: 'הקפה',   amount: creditRevenue,  Icon: BookOpen,   color: '#8B5CF6' },
                ]
                return cards.map(({ label, amount, Icon, color }) => (
                  <Card key={label} className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
                    <CardContent className="p-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon size={18} color={color} />
                        <span className="text-[11px] text-slate-400">{label}</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[22px] font-medium" style={{ color }}>
                          <CountUp end={amount} prefix="₪" separator="," duration={0.8} />
                        </span>
                        <span className="text-[12px] font-bold text-slate-500">{pctOfSource(amount)}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {totalRevenue > 0 ? `${((amount / totalRevenue) * 100).toFixed(1)}% מההכנסות` : '—'}
                      </span>
                    </CardContent>
                  </Card>
                ))
              })()}
            </motion.div>

            {/* ROW 2 — P&L Table */}
            <motion.div variants={fadeIn(0.1)} initial="hidden" animate="visible" className="mb-2.5">
              <Card className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
                <CardHeader className="p-0 mb-3">
                  <CardTitle className="text-[15px] font-bold text-slate-700">
                    רווח והפסד — {branchName} — {period.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[13px] text-slate-500">מדד</TableHead>
                        <TableHead className="text-[13px] text-slate-500">סכום ₪</TableHead>
                        <TableHead className="text-[13px] text-slate-500">% מהכנסות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plRows.map((row, idx) => {
                        if (row.isSeparator) {
                          return (
                            <TableRow key={`sep-${idx}`} className="hover:bg-transparent">
                              <TableCell colSpan={3} className="py-0 px-0">
                                <div className="border-t border-dashed border-slate-200" />
                              </TableCell>
                            </TableRow>
                          )
                        }
                        return (
                          <TableRow key={row.label} className={row.bgClass || ''}>
                            <TableCell className={`text-[13px] text-slate-700 ${row.bold ? 'font-bold' : ''}`}>
                              {row.label}
                            </TableCell>
                            <TableCell className={`text-[13px] text-slate-800 ${row.bold ? 'font-bold' : ''}`}>
                              {fmtN(row.amount)}
                            </TableCell>
                            <TableCell className={`text-[13px] text-slate-500 ${row.bold ? 'font-bold' : ''}`}>
                              {pctOf(row.amount)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </motion.div>

            {/* ROW 3 — KPI Targets */}
            <motion.div variants={fadeIn(0.2)} initial="hidden" animate="visible" className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-2.5">
              <KpiTargetCard
                label="% לייבור"
                actual={laborPct}
                target={laborTarget}
                lowerIsBetter
              />
              <KpiTargetCard
                label="% פחת"
                actual={wastePct}
                target={wasteTarget}
                lowerIsBetter
              />
              <KpiTargetCard
                label="% רווח תפעולי"
                actual={opProfitPct}
                target={opProfitPct}
                lowerIsBetter={false}
              />
            </motion.div>

            {/* ROW 3.5 — Daily revenue for the selected month vs same-day average of last 3 months */}
            {dailyChart.length > 0 && (
              <motion.div variants={fadeIn(0.25)} initial="hidden" animate="visible">
                <Card className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
                  <CardHeader className="p-0 mb-3">
                    <CardTitle className="text-[15px] font-bold text-slate-700">
                      הכנסות יומיות — {new Date((monthKey || from.slice(0, 7)) + '-01T12:00:00').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
                    </CardTitle>
                    <p className="text-[11px] text-slate-400 mt-1">קו רציף: החודש הנוכחי · קו מקווקו: ממוצע באותו תאריך ב-3 חודשים האחרונים</p>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={dailyChart} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => '₪' + (v / 1000).toFixed(0) + 'K'} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="current" name="החודש" stroke="#378ADD" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                        <Line type="monotone" dataKey="avg" name="ממוצע 3 חודשים" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ROW 4 — 6-Month Trend Chart */}
            <motion.div variants={fadeIn(0.3)} initial="hidden" animate="visible">
              <Card className="bg-white border-[0.5px] border-slate-200 rounded-xl p-4">
                <CardHeader className="p-0 mb-3">
                  <CardTitle className="text-[15px] font-bold text-slate-700">מגמת 6 חודשים</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={trendData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => '₪' + (v / 1000).toFixed(0) + 'K'} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="הכנסות" stroke="#378ADD" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="רווח נשלט" stroke="#639922" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="רווח תפעולי" stroke="#534AB7" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
