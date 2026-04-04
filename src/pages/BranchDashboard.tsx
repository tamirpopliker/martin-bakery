import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase, fetchBranchPL, getOverheadPct, type BranchPLResult } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ArrowRight, TrendingUp, TrendingDown, Store } from 'lucide-react'
import { RevenueIcon, ProfitIcon, LaborIcon } from '@/components/icons'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

/* ─── helpers ─── */

function fmtN(n: number) { return '₪' + Math.round(n).toLocaleString() }
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
          <span className="text-[12px] font-bold text-slate-800">₪{Number(entry.value).toLocaleString()}</span>
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

  // Previous period P&L
  const [prevPl, setPrevPl] = useState<BranchPLResult | null>(null)

  // Trend
  const [trendData, setTrendData] = useState<any[]>([])

  // Derived values from current P&L
  const totalRevenue = pl?.revenue ?? 0
  const expSupplier = pl?.expSuppliers ?? 0
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
    const months: string[] = []
    const now = new Date(from)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(d.toISOString().slice(0, 7))
    }

    const data = await Promise.all(months.map(async (m) => {
      const mFrom = m + '-01'
      const mTo = new Date(new Date(mFrom).getFullYear(), new Date(mFrom).getMonth() + 1, 1).toISOString().slice(0, 10)
      const [rev, lab, exp, wst, fc] = await Promise.all([
        supabase.from('branch_revenue').select('amount').eq('branch_id', branchId).gte('date', mFrom).lt('date', mTo),
        supabase.from('branch_labor').select('employer_cost').eq('branch_id', branchId).gte('date', mFrom).lt('date', mTo),
        supabase.from('branch_expenses').select('amount').eq('branch_id', branchId).gte('date', mFrom).lt('date', mTo),
        supabase.from('branch_waste').select('amount').eq('branch_id', branchId).gte('date', mFrom).lt('date', mTo),
        supabase.from('fixed_costs').select('amount').eq('entity_type', 'branch_' + branchId).eq('month', m),
      ])
      const revenue = (rev.data || []).reduce((s, r) => s + Number(r.amount), 0)
      const labor = (lab.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)
      const expenses = (exp.data || []).reduce((s, r) => s + Number(r.amount), 0)
      const waste = (wst.data || []).reduce((s, r) => s + Number(r.amount), 0)
      const fixed = (fc.data || []).reduce((s, r) => s + Number(r.amount), 0)
      const gross = revenue - labor - expenses
      const operating = gross - fixed - waste
      const label = new Date(mFrom + 'T12:00:00').toLocaleDateString('he-IL', { month: 'short', year: '2-digit' })
      return { month: label, 'הכנסות': Math.round(revenue), 'רווח נשלט': Math.round(gross), 'רווח תפעולי': Math.round(operating) }
    }))

    return data
  }

  async function fetchData() {
    setLoading(true)
    try {
      const oh = await getOverheadPct()
      setOverheadPct(oh)
      const curMonthKey = monthKey || from.slice(0, 7)
      const prevMonthKey = comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)

      const [current, prev, trend, kpiRes] = await Promise.all([
        fetchBranchPL(branchId, from, to, curMonthKey, oh),
        fetchBranchPL(branchId, comparisonPeriod.from, comparisonPeriod.to, prevMonthKey, oh),
        fetchTrend(),
        supabase.from('branch_kpi_targets').select('labor_pct, waste_pct').eq('branch_id', branchId).maybeSingle(),
      ])

      setPl(current)
      setPrevPl(prev)

      if (kpiRes.data?.labor_pct) setLaborTarget(kpiRes.data.labor_pct)
      if (kpiRes.data?.waste_pct) setWasteTarget(kpiRes.data.waste_pct)

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
    { label: 'ספקים', amount: expSupplier },
    { label: 'לייבור', amount: laborEmployer },
    { label: 'שכר מנהל', amount: mgmtCosts },
    { label: 'פחת', amount: wasteTotal },
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
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: branchColor + '20' }}>
          <Store size={20} style={{ color: branchColor }} />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 m-0">דשבורד סניף — {branchName}</h1>
          <p className="text-[13px] text-slate-400 m-0">KPI · הכנסות · הוצאות · {period.label}</p>
        </div>
        <div className="mr-auto">
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      {/* BODY */}
      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400" />
          </div>
        ) : (
          <>
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
                </CardContent>
              </Card>
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
