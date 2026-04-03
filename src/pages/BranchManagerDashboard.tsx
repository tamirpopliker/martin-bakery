import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { useBranches } from '../lib/BranchContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ArrowRight, TrendingUp, TrendingDown, Presentation, EyeOff } from 'lucide-react'
import { ProfitIcon } from '@/components/icons'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props {
  onBack: () => void
}

interface BranchData {
  id: number
  name: string
  color: string
  revCashier: number
  revWebsite: number
  revCredit: number
  totalRevenue: number
  expSuppliers: number
  expRepairs: number
  expInfra: number
  expDelivery: number
  expOther: number
  totalExpenses: number
  laborGross: number
  laborEmployer: number
  wasteTotal: number
  fixedCosts: number
  mgmtCosts: number
  grossProfit: number
  operatingProfit: number
  laborPct: number
  wastePct: number
  grossPct: number
  operatingPct: number
}

function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString() }

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

const CHART_COLORS = ['#818cf8', '#34d399', '#fb923c', '#f472b6', '#38bdf8', '#a78bfa', '#fbbf24', '#4ade80']

export default function BranchManagerDashboard({ onBack }: Props) {
  const { period, setPeriod, from, to, comparisonPeriod } = usePeriod()
  const { branches: BRANCHES } = useBranches()
  const [loading, setLoading] = useState(true)
  const [presentationMode, setPresentationMode] = useState(true)
  const [branches, setBranches] = useState<BranchData[]>([])
  const [prevBranches, setPrevBranches] = useState<BranchData[]>([])
  const [overheadPct, setOverheadPct] = useState(() => {
    const saved = localStorage.getItem('overhead_pct')
    return saved ? Number(saved) : 5
  })
  const [chartData, setChartData] = useState<any[]>([])

  const brOH = (br: BranchData) => br.totalRevenue * overheadPct / 100
  const brOP = (br: BranchData) => br.operatingProfit - brOH(br)

  async function fetchBranchData(branchId: number, name: string, color: string, dateFrom: string, dateTo: string, monthKey: string): Promise<BranchData> {
    const entityType = `branch_${branchId}`

    const [revRes, expRes, labRes, wstRes, fcRes] = await Promise.all([
      supabase.from('branch_revenue').select('source, amount').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('branch_expenses').select('expense_type, amount').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('branch_labor').select('employer_cost, gross_salary').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('branch_waste').select('amount').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('fixed_costs').select('amount, entity_id').eq('entity_type', entityType).eq('month', monthKey),
    ])

    const revData = revRes.data || []
    const expData = expRes.data || []
    const labData = labRes.data || []
    const wstData = wstRes.data || []
    const fcData = fcRes.data || []

    const revCashier = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + Number(r.amount), 0)
    const revWebsite = revData.filter(r => r.source === 'website').reduce((s, r) => s + Number(r.amount), 0)
    const revCredit = revData.filter(r => r.source === 'credit').reduce((s, r) => s + Number(r.amount), 0)
    const totalRevenue = revCashier + revWebsite + revCredit

    const expSuppliers = expData.filter(r => r.expense_type === 'suppliers' || r.expense_type === 'supplier').reduce((s, r) => s + Number(r.amount), 0)
    const expRepairs = expData.filter(r => r.expense_type === 'repairs' || r.expense_type === 'repair').reduce((s, r) => s + Number(r.amount), 0)
    const expInfra = expData.filter(r => r.expense_type === 'infrastructure').reduce((s, r) => s + Number(r.amount), 0)
    const expDelivery = expData.filter(r => r.expense_type === 'deliveries' || r.expense_type === 'delivery').reduce((s, r) => s + Number(r.amount), 0)
    const expOther = expData.filter(r => r.expense_type === 'other').reduce((s, r) => s + Number(r.amount), 0)
    const totalExpenses = expSuppliers + expRepairs + expInfra + expDelivery + expOther

    const laborGross = labData.reduce((s, r) => s + Number(r.gross_salary), 0)
    const laborEmployer = labData.reduce((s, r) => s + Number(r.employer_cost), 0)
    const wasteTotal = wstData.reduce((s, r) => s + Number(r.amount), 0)
    const fixedCosts = fcData.filter((r: any) => r.entity_id !== 'mgmt').reduce((s, r) => s + Number(r.amount), 0)
    const mgmtCosts = fcData.filter((r: any) => r.entity_id === 'mgmt').reduce((s, r) => s + Number(r.amount), 0)

    const grossProfit = totalRevenue - laborEmployer - totalExpenses
    const operatingProfit = grossProfit - fixedCosts - mgmtCosts - wasteTotal

    return {
      id: branchId, name, color,
      revCashier, revWebsite, revCredit, totalRevenue,
      expSuppliers, expRepairs, expInfra, expDelivery, expOther, totalExpenses,
      laborGross, laborEmployer, wasteTotal, fixedCosts, mgmtCosts,
      grossProfit, operatingProfit,
      laborPct: totalRevenue > 0 ? (laborEmployer / totalRevenue) * 100 : 0,
      wastePct: totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0,
      grossPct: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
      operatingPct: totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0,
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const monthKey = from.slice(0, 7)
      const prevMonthKey = comparisonPeriod.from.slice(0, 7)

      const [current, previous] = await Promise.all([
        Promise.all(BRANCHES.map(br => fetchBranchData(br.id, br.name, br.color, from, to, monthKey))),
        Promise.all(BRANCHES.map(br => fetchBranchData(br.id, br.name, br.color, comparisonPeriod.from, comparisonPeriod.to, prevMonthKey))),
      ])

      setBranches(current)
      setPrevBranches(previous)

      // Fetch 6-month revenue data for chart
      const now = new Date(from)
      const months: { key: string; label: string; from: string; to: string }[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const nextD = new Date(d.getFullYear(), d.getMonth() + 1, 1)
        const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        const label = d.toLocaleDateString('he-IL', { month: 'short' })
        months.push({
          key: mKey,
          label,
          from: `${mKey}-01`,
          to: `${nextD.getFullYear()}-${String(nextD.getMonth() + 1).padStart(2, '0')}-01`,
        })
      }

      const chartRows = await Promise.all(
        months.map(async (m) => {
          const row: any = { month: m.label }
          await Promise.all(
            BRANCHES.map(async (br) => {
              const { data } = await supabase
                .from('branch_revenue')
                .select('amount')
                .eq('branch_id', br.id)
                .gte('date', m.from)
                .lt('date', m.to)
              row[br.name] = (data || []).reduce((s, r) => s + Number(r.amount), 0)
            })
          )
          return row
        })
      )
      setChartData(chartRows)
      setLoading(false)
    }
    load()
  }, [from, to])

  // Totals
  const totals = {
    revenue: branches.reduce((s, b) => s + b.totalRevenue, 0),
    expenses: branches.reduce((s, b) => s + b.totalExpenses, 0),
    labor: branches.reduce((s, b) => s + b.laborEmployer, 0),
    waste: branches.reduce((s, b) => s + b.wasteTotal, 0),
    fixedCosts: branches.reduce((s, b) => s + b.fixedCosts, 0),
    mgmtCosts: branches.reduce((s, b) => s + b.mgmtCosts, 0),
    overhead: branches.reduce((s, b) => s + brOH(b), 0),
    grossProfit: branches.reduce((s, b) => s + b.grossProfit, 0),
    operatingProfit: branches.reduce((s, b) => s + brOP(b), 0),
  }
  const prevTotals = {
    revenue: prevBranches.reduce((s, b) => s + b.totalRevenue, 0),
    grossProfit: prevBranches.reduce((s, b) => s + b.grossProfit, 0),
    operatingProfit: prevBranches.reduce((s, b) => s + brOP(b), 0),
  }
  const totalLaborPct = totals.revenue > 0 ? (totals.labor / totals.revenue) * 100 : 0
  const totalWastePct = totals.revenue > 0 ? (totals.waste / totals.revenue) * 100 : 0

  // Per-branch max for progress bars
  const maxRevenue = useMemo(() => Math.max(...branches.map(b => b.totalRevenue), 1), [branches])
  const maxLaborPct = useMemo(() => Math.max(...branches.map(b => b.laborPct), 1), [branches])

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #818cf8, #34d399)' }}>
          <ProfitIcon size={22} color="white" />
        </div>
        <div>
          <h1 className="m-0 text-[22px] font-extrabold text-slate-900">דשבורד מנהל סניפים</h1>
          <p className="m-0 text-[13px] text-slate-400">השוואת ביצועים &middot; P&amp;L &middot; KPI</p>
        </div>
        <div className="mr-auto flex items-center gap-3">
          <PeriodPicker period={period} onChange={setPeriod} />
          <Button
            variant={presentationMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPresentationMode(v => !v)}
            className={`rounded-xl gap-2 px-4 text-[13px] font-bold ${presentationMode ? 'bg-indigo-500 hover:bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}
          >
            {presentationMode ? <EyeOff size={15} /> : <Presentation size={15} />}
            {presentationMode ? 'יציאה ממצב ישיבה' : 'מצב ישיבה'}
          </Button>
        </div>
      </div>

      {loading && <div className="text-center py-16 text-slate-400">טוען נתונים...</div>}

      {!loading && (
        <div className="px-8 py-6 max-w-[1200px] mx-auto">

          {/* ── ROW 1 — 4 Golden KPIs ── */}
          <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-4 gap-2.5 mb-2.5">
            {/* 1. Total Revenue */}
            <Card className="shadow-sm border border-slate-200 rounded-lg">
              <CardContent className="p-4">
                <div className="text-[11px] font-semibold text-slate-400 mb-1">סה"כ הכנסות</div>
                <div className="text-[22px] font-medium" style={{ color: '#378ADD' }}>
                  <CountUp end={Math.round(totals.revenue)} duration={1.5} separator="," prefix="₪" />
                </div>
                <DiffBadge current={totals.revenue} previous={prevTotals.revenue} />
              </CardContent>
            </Card>

            {/* 2. Total Gross Profit */}
            <Card className="shadow-sm border border-slate-200 rounded-lg">
              <CardContent className="p-4">
                <div className="text-[11px] font-semibold text-slate-400 mb-1">סה"כ רווח גולמי</div>
                <div className="text-[22px] font-medium" style={{ color: totals.grossProfit >= 0 ? '#639922' : '#E24B4A' }}>
                  <CountUp end={Math.round(totals.grossProfit)} duration={1.5} separator="," prefix="₪" />
                </div>
                <DiffBadge current={totals.grossProfit} previous={prevTotals.grossProfit} />
              </CardContent>
            </Card>

            {/* 3. Total Operating Profit */}
            <Card className="shadow-sm border border-slate-200 rounded-lg">
              <CardContent className="p-4">
                <div className="text-[11px] font-semibold text-slate-400 mb-1">סה"כ רווח תפעולי</div>
                <div className="text-[22px] font-medium" style={{ color: totals.operatingProfit >= 0 ? '#639922' : '#E24B4A' }}>
                  <CountUp end={Math.round(totals.operatingProfit)} duration={1.5} separator="," prefix="₪" />
                </div>
                <DiffBadge current={totals.operatingProfit} previous={prevTotals.operatingProfit} />
              </CardContent>
            </Card>

            {/* 4. Average Labor % */}
            <Card className="shadow-sm border border-slate-200 rounded-lg">
              <CardContent className="p-4">
                <div className="text-[11px] font-semibold text-slate-400 mb-1">% לייבור ממוצע</div>
                <div className="text-[22px] font-medium" style={{ color: totalLaborPct <= 28 ? '#639922' : '#E24B4A' }}>
                  <CountUp end={totalLaborPct} duration={1.5} suffix="%" decimals={1} />
                </div>
                <span className="text-[11px] text-slate-400">יעד 28%</span>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── ROW 2 — 2 Detail Cards ── */}
          <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid grid-cols-2 gap-2.5 mb-2.5">
            {/* LEFT: Revenue per branch */}
            <Card className="shadow-sm border border-slate-200 rounded-lg">
              <CardContent className="p-4">
                <div className="text-[13px] font-bold text-slate-700 mb-3">הכנסות לפי סניף</div>
                <div className="flex flex-col gap-3">
                  {branches.map(br => {
                    const profitPct = br.totalRevenue > 0 ? (br.grossProfit / br.totalRevenue) * 100 : 0
                    const barW = (br.totalRevenue / maxRevenue) * 100
                    return (
                      <div key={br.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[13px] font-semibold text-slate-700">{br.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-slate-900">{fmtM(br.totalRevenue)}</span>
                            <span className="text-[11px] font-bold" style={{ color: profitPct >= 0 ? '#639922' : '#E24B4A' }}>
                              {profitPct.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barW}%`, backgroundColor: '#378ADD' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* RIGHT: Labor per branch */}
            <Card className="shadow-sm border border-slate-200 rounded-lg">
              <CardContent className="p-4">
                <div className="text-[13px] font-bold text-slate-700 mb-3">לייבור לפי סניף</div>
                <div className="flex flex-col gap-3">
                  {branches.map(br => {
                    const barW = (br.laborPct / Math.max(maxLaborPct, 40)) * 100
                    return (
                      <div key={br.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[13px] font-semibold text-slate-700">{br.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium" style={{ color: br.laborPct <= 28 ? '#639922' : '#E24B4A' }}>
                              {br.laborPct.toFixed(1)}%
                            </span>
                            <span className="text-[11px] text-slate-400">יעד 28%</span>
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden relative">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(barW, 100)}%`, backgroundColor: '#534AB7' }} />
                          {/* Target line at 28% */}
                          <div className="absolute top-0 h-full w-px bg-slate-400" style={{ right: `${(28 / Math.max(maxLaborPct, 40)) * 100}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── ROW 3 — Comparative LineChart ── */}
          <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-2.5">
            <Card className="shadow-sm border border-slate-200 rounded-lg">
              <CardContent className="p-4">
                <div className="text-[13px] font-bold text-slate-700 mb-3">הכנסות לפי סניף - 6 חודשים אחרונים</div>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                    <Tooltip
                      formatter={(value: any) => [fmtM(Number(value)), '']}
                      contentStyle={{ direction: 'rtl', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {BRANCHES.map((br, i) => (
                      <Line
                        key={br.id}
                        type="monotone"
                        dataKey={br.name}
                        stroke={br.color || CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── Overhead % control ── */}
          <div className="flex items-center gap-2 mb-3.5 justify-end">
            <span className="text-[13px] font-semibold text-slate-500">העמסת מטה:</span>
            <input
              type="number"
              value={overheadPct}
              onChange={e => {
                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                setOverheadPct(v)
                localStorage.setItem('overhead_pct', String(v))
              }}
              className="w-[50px] border border-slate-200 rounded-lg px-2 py-1 text-sm text-center font-semibold text-indigo-400 bg-white"
            />
            <span className="text-[13px] text-slate-500">%</span>
          </div>

          {/* ── Comparison Table ── */}
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold text-slate-900">
                    טבלת השוואה — {period.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Presentation mode banner */}
                  {presentationMode && (
                    <motion.div variants={fadeIn} initial="hidden" animate="visible"
                      className="rounded-lg px-4 py-2 mb-4 text-center text-[13px] font-semibold"
                      style={{ background: '#EEEDFE', color: '#3C3489' }}>
                      מצב ישיבה פעיל — נתוני שכר מוסתרים
                    </motion.div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-2 border-slate-200">
                        <TableHead className="text-right text-slate-500 font-semibold text-xs px-3.5 py-2.5">מדד</TableHead>
                        {branches.map(br => (
                          <TableHead key={br.id} className="text-center font-bold text-[13px] px-3.5 py-2.5">
                            <span style={{ color: br.color }}>{br.name}</span>
                          </TableHead>
                        ))}
                        <TableHead className="text-center font-bold text-[13px] text-slate-900 px-3.5 py-2.5">סה"כ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const HIDDEN_IN_PRESENTATION = new Set(['laborEmployer', 'mgmtCosts', 'totalExpenses'])
                        const allRows = [
                          { label: 'הכנסות', key: 'totalRevenue' as const, color: '#34d399' },
                          { label: 'הוצאות', key: 'totalExpenses' as const, color: '#fb7185' },
                          { label: 'לייבור', key: 'laborEmployer' as const, color: '#fbbf24' },
                          { label: 'פחת', key: 'wasteTotal' as const, color: '#fb7185' },
                          { label: 'עלויות קבועות', key: 'fixedCosts' as const, color: '#64748b' },
                          { label: 'הנהלה וכלליות', key: 'mgmtCosts' as const, color: '#64748b' },
                          { label: 'רווח גולמי', key: 'grossProfit' as const, color: '#34d399' },
                        ]
                        const visibleRows = presentationMode ? allRows.filter(r => !HIDDEN_IN_PRESENTATION.has(r.key)) : allRows
                        return visibleRows.map((row, ri) => {
                          const isBold = row.key === 'grossProfit' || row.key === 'totalRevenue'
                          const totalVal = branches.reduce((s, b) => s + b[row.key], 0)
                          return (
                            <TableRow key={row.key} className={isBold ? 'bg-slate-50' : ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                              <TableCell className={`px-3.5 py-2.5 text-slate-700 ${isBold ? 'font-bold' : 'font-medium'}`}>{row.label}</TableCell>
                              {branches.map(br => {
                                const val = br[row.key]
                                const isProfit = row.key === 'grossProfit'
                                const c = isProfit ? (val >= 0 ? '#34d399' : '#fb7185') : row.color
                                return (
                                  <TableCell key={br.id} className={`px-3.5 py-2.5 text-center ${isBold ? 'font-bold' : 'font-medium'}`} style={{ color: val === 0 ? '#94a3b8' : c }}>
                                    {val === 0 ? '\u2014' : fmtM(val)}
                                  </TableCell>
                                )
                              })}
                              <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: row.key === 'grossProfit' ? (totalVal >= 0 ? '#34d399' : '#fb7185') : '#0f172a' }}>
                                {totalVal === 0 ? '\u2014' : fmtM(totalVal)}
                              </TableCell>
                            </TableRow>
                          )
                        })
                      })()}
                      {/* Presentation mode: merged labor % row */}
                      {presentationMode && (
                        <TableRow className="bg-indigo-50/50">
                          <TableCell className="px-3.5 py-2.5 font-bold" style={{ color: '#3C3489' }}>עלויות עבודה %</TableCell>
                          {branches.map(br => {
                            const laborExpPct = br.totalRevenue > 0 ? ((br.laborEmployer + br.totalExpenses) / br.totalRevenue * 100) : 0
                            return (
                              <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: '#534AB7' }}>
                                {br.totalRevenue > 0 ? laborExpPct.toFixed(1) + '%' : '\u2014'}
                              </TableCell>
                            )
                          })}
                          <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: '#534AB7' }}>
                            {totals.revenue > 0 ? ((totals.labor + totals.expenses) / totals.revenue * 100).toFixed(1) + '%' : '\u2014'}
                          </TableCell>
                        </TableRow>
                      )}
                      {/* Overhead row */}
                      {overheadPct > 0 && (
                        <TableRow className="bg-slate-50/50">
                          <TableCell className="px-3.5 py-2.5 font-medium text-slate-700">העמסת מטה {overheadPct}%</TableCell>
                          {branches.map(br => (
                            <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-medium text-slate-500">
                              {fmtM(brOH(br))}
                            </TableCell>
                          ))}
                          <TableCell className="px-3.5 py-2.5 text-center font-bold text-slate-900">
                            {fmtM(totals.overhead)}
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className="bg-slate-50">
                        <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">רווח תפעולי</TableCell>
                        {branches.map(br => {
                          const op = brOP(br)
                          return (
                            <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: op >= 0 ? '#34d399' : '#fb7185' }}>
                              {op === 0 ? '\u2014' : fmtM(op)}
                            </TableCell>
                          )
                        })}
                        <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totals.operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>
                          {totals.operatingProfit === 0 ? '\u2014' : fmtM(totals.operatingProfit)}
                        </TableCell>
                      </TableRow>
                      {/* KPI rows */}
                      <TableRow className="border-t-2 border-slate-200 bg-slate-50">
                        <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% לייבור</TableCell>
                        {branches.map(br => (
                          <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: br.laborPct <= 28 ? '#34d399' : '#fb7185' }}>
                            {br.totalRevenue > 0 ? br.laborPct.toFixed(1) + '%' : '\u2014'}
                          </TableCell>
                        ))}
                        <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totalLaborPct <= 28 ? '#34d399' : '#fb7185' }}>
                          {totalLaborPct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                      <TableRow className="bg-slate-50">
                        <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% פחת</TableCell>
                        {branches.map(br => (
                          <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: br.wastePct <= 4 ? '#34d399' : '#fb7185' }}>
                            {br.totalRevenue > 0 ? br.wastePct.toFixed(1) + '%' : '\u2014'}
                          </TableCell>
                        ))}
                        <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totalWastePct <= 4 ? '#34d399' : '#fb7185' }}>
                          {totalWastePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                      <TableRow className="bg-slate-50">
                        <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% רווח תפעולי</TableCell>
                        {branches.map(br => {
                          const opPct = br.totalRevenue > 0 ? (brOP(br) / br.totalRevenue * 100) : 0
                          return (
                            <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: opPct >= 0 ? '#34d399' : '#fb7185' }}>
                              {br.totalRevenue > 0 ? opPct.toFixed(1) + '%' : '\u2014'}
                            </TableCell>
                          )
                        })}
                        <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totals.revenue > 0 ? ((totals.operatingProfit / totals.revenue * 100) >= 0 ? '#34d399' : '#fb7185') : '#94a3b8' }}>
                          {totals.revenue > 0 ? (totals.operatingProfit / totals.revenue * 100).toFixed(1) + '%' : '\u2014'}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </motion.div>

        </div>
      )}
    </div>
  )
}
