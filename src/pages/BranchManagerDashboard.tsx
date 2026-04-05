import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase, getOverheadPct } from '../lib/supabase'
import { fetchAllBranchesProfit } from '../lib/profitCalc'
import { usePeriod } from '../lib/PeriodContext'
import { useBranches } from '../lib/BranchContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ArrowRight, TrendingUp, TrendingDown, Presentation, EyeOff } from 'lucide-react'
import { ProfitIcon } from '@/components/icons'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const, delay } },
})

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
  expSuppliersInternal: number
  expSuppliersExternal: number
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
  totalTransactions: number
  workingDays: number
  avgBasket: number
  avgDailyTransactions: number
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
  const [overheadPct, setOverheadPct] = useState(5)
  const [chartData, setChartData] = useState<any[]>([])
  const [kpiTargets, setKpiTargets] = useState<Record<number, { labor_pct: number; waste_pct: number; revenue_target: number; basket_target: number; transaction_target: number }>>({})

  const brOH = (br: BranchData) => br.totalRevenue * overheadPct / 100
  const brGross = (br: BranchData) => br.totalRevenue - br.totalExpenses - br.laborEmployer - br.mgmtCosts - br.wasteTotal
  const brOP = (br: BranchData) => brGross(br) - br.fixedCosts - brOH(br)

  async function fetchBranchData(branchId: number, name: string, color: string, dateFrom: string, dateTo: string, monthKey: string): Promise<BranchData> {
    const entityType = `branch_${branchId}`

    const [revRes, expRes, labRes, wstRes, fcRes] = await Promise.all([
      supabase.from('branch_revenue').select('source, amount, transaction_count, date').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('branch_expenses').select('expense_type, amount, from_factory').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
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

    const supplierRows = expData.filter(r => r.expense_type === 'suppliers' || r.expense_type === 'supplier')
    const expSuppliers = supplierRows.reduce((s, r) => s + Number(r.amount), 0)
    const expSuppliersInternal = supplierRows.filter(r => r.from_factory).reduce((s, r) => s + Number(r.amount), 0)
    const expSuppliersExternal = supplierRows.filter(r => !r.from_factory).reduce((s, r) => s + Number(r.amount), 0)
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

    // Transaction & basket calculations
    const totalTransactions = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + (Number(r.transaction_count) || 0), 0)
    const uniqueDays = new Set(revData.filter(r => r.source === 'cashier' && Number(r.transaction_count) > 0).map(r => r.date)).size
    const workingDays = uniqueDays || 1
    const avgBasket = totalTransactions > 0 ? revCashier / totalTransactions : 0
    const avgDailyTransactions = totalTransactions / workingDays

    return {
      id: branchId, name, color,
      revCashier, revWebsite, revCredit, totalRevenue,
      expSuppliers, expSuppliersInternal, expSuppliersExternal, expRepairs, expInfra, expDelivery, expOther, totalExpenses,
      laborGross, laborEmployer, wasteTotal, fixedCosts, mgmtCosts,
      grossProfit, operatingProfit,
      laborPct: totalRevenue > 0 ? (laborEmployer / totalRevenue) * 100 : 0,
      wastePct: totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0,
      grossPct: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
      operatingPct: totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0,
      totalTransactions, workingDays, avgBasket, avgDailyTransactions,
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const oh = await getOverheadPct()
      setOverheadPct(oh)
      const monthKey = from.slice(0, 7)
      const prevMonthKey = comparisonPeriod.from.slice(0, 7)

      const [current, previous] = await Promise.all([
        Promise.all(BRANCHES.map(br => fetchBranchData(br.id, br.name, br.color, from, to, monthKey))),
        Promise.all(BRANCHES.map(br => fetchBranchData(br.id, br.name, br.color, comparisonPeriod.from, comparisonPeriod.to, prevMonthKey))),
      ])

      // Override supplier split from View (single source of truth)
      const branchIds = BRANCHES.map(br => br.id)
      const viewProfits = await fetchAllBranchesProfit(branchIds, from, to)
      for (const br of current) {
        const vp = viewProfits.find(p => p.branchId === br.id)
        if (vp && vp.revenue > 0) {
          br.expSuppliersInternal = vp.internalSupplierCost
          br.expSuppliersExternal = vp.externalSupplierCost
          br.expSuppliers = vp.totalSupplierCost
        }
      }

      setBranches(current)
      setPrevBranches(previous)

      // Fetch KPI targets for all branches
      const { data: kpiData } = await supabase.from('branch_kpi_targets').select('branch_id, labor_pct, waste_pct, revenue_target, basket_target, transaction_target')
      const kpiMap: typeof kpiTargets = {}
      ;(kpiData || []).forEach((k: any) => { kpiMap[k.branch_id] = k })
      setKpiTargets(kpiMap)

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
    grossProfit: branches.reduce((s, b) => s + brGross(b), 0),
    operatingProfit: branches.reduce((s, b) => s + brOP(b), 0),
  }
  const prevTotals = {
    revenue: prevBranches.reduce((s, b) => s + b.totalRevenue, 0),
    grossProfit: prevBranches.reduce((s, b) => s + brGross(b), 0),
    operatingProfit: prevBranches.reduce((s, b) => s + brOP(b), 0),
  }
  const totalLaborPct = totals.revenue > 0 ? (totals.labor / totals.revenue) * 100 : 0
  const totalWastePct = totals.revenue > 0 ? (totals.waste / totals.revenue) * 100 : 0
  const getTarget = (brId: number, key: string) => (kpiTargets[brId] as any)?.[key] || (key === 'labor_pct' ? 0 : key === 'waste_pct' ? 3 : 0)

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
          <motion.div variants={fadeIn(0)} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5">
            {/* 1. Total Revenue */}
            <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid #e2e8f0' }}>
              <div className="text-[11px] font-semibold text-slate-400 mb-1">סה"כ הכנסות</div>
              <div className="text-[22px] font-medium" style={{ color: '#378ADD' }}>
                <CountUp end={Math.round(totals.revenue)} duration={1.5} separator="," prefix="₪" />
              </div>
              <DiffBadge current={totals.revenue} previous={prevTotals.revenue} />
            </div>

            {/* 2. Total Gross Profit */}
            <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid #e2e8f0' }}>
              <div className="text-[11px] font-semibold text-slate-400 mb-1 cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">סה"כ רווח נשלט</div>
              <div className="text-[22px] font-medium" style={{ color: totals.grossProfit >= 0 ? '#639922' : '#E24B4A' }}>
                <CountUp end={Math.round(totals.grossProfit)} duration={1.5} separator="," prefix="₪" />
              </div>
              <DiffBadge current={totals.grossProfit} previous={prevTotals.grossProfit} />
            </div>

            {/* 3. Total Operating Profit */}
            <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid #e2e8f0' }}>
              <div className="text-[11px] font-semibold text-slate-400 mb-1">סה"כ רווח תפעולי</div>
              <div className="text-[22px] font-medium" style={{ color: totals.operatingProfit >= 0 ? '#639922' : '#E24B4A' }}>
                <CountUp end={Math.round(totals.operatingProfit)} duration={1.5} separator="," prefix="₪" />
              </div>
              <DiffBadge current={totals.operatingProfit} previous={prevTotals.operatingProfit} />
            </div>

            {/* 4. Average Labor % */}
            <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid #e2e8f0' }}>
              <div className="text-[11px] font-semibold text-slate-400 mb-1">% לייבור ממוצע</div>
              <div className="text-[22px] font-medium" style={{ color: '#534AB7' }}>
                <CountUp end={totalLaborPct} duration={1.5} suffix="%" decimals={1} />
              </div>
              {(() => { const avgTarget = branches.length > 0 ? branches.reduce((s, b) => s + getTarget(b.id, 'labor_pct'), 0) / branches.length : 0; return avgTarget > 0 ? <span className="text-[11px] text-slate-400">יעד {avgTarget.toFixed(0)}%</span> : <span className="text-[11px] text-slate-400">{'\u2014'}</span> })()}
            </div>
          </motion.div>

          {/* ── ROW 2 — 2 Detail Cards ── */}
          <motion.div variants={fadeIn(0.1)} initial="hidden" animate="visible" className="grid grid-cols-2 gap-2.5 mb-2.5">
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
                            <span className="text-[13px] font-medium" style={{ color: (() => { const t = getTarget(br.id, 'labor_pct'); return t > 0 ? (br.laborPct <= t ? '#639922' : '#E24B4A') : '#334155' })() }}>
                              {br.laborPct.toFixed(1)}%
                            </span>
                            {(() => { const t = getTarget(br.id, 'labor_pct'); return t > 0 ? <span className="text-[11px] text-slate-400">יעד {t}%</span> : <span className="text-[11px] text-slate-400">{'\u2014'}</span> })()}
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden relative">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(barW, 100)}%`, backgroundColor: '#534AB7' }} />
                          {/* Target line */}
                          {(() => { const t = getTarget(br.id, 'labor_pct'); return t > 0 ? <div className="absolute top-0 h-full w-px bg-slate-400" style={{ right: `${(t / Math.max(maxLaborPct, 40)) * 100}%` }} /> : null })()}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── ROW 3 — KPI Targets per Branch ── */}
          <motion.div variants={fadeIn(0.2)} initial="hidden" animate="visible" className="mb-2.5">
            <div className="text-[15px] font-bold text-slate-900 mb-2">יעדים לפי סניף</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {branches.map(br => {
                const laborTarget = getTarget(br.id, 'labor_pct')
                const wasteTarget = getTarget(br.id, 'waste_pct')
                const opPct = br.totalRevenue > 0 ? (brOP(br) / br.totalRevenue * 100) : 0

                const kpiColor = (actual: number, target: number, inverse: boolean) => {
                  const diff = inverse ? (actual - target) / target : (target - actual) / target
                  if (diff <= 0) return '#639922'
                  if (diff <= 0.2) return '#f59e0b'
                  return '#E24B4A'
                }

                const laborColor = kpiColor(br.laborPct, laborTarget, true)
                const wasteColor = kpiColor(br.wastePct, wasteTarget, true)
                const opColor = opPct >= 0 ? '#639922' : opPct >= -5 ? '#f59e0b' : '#E24B4A'

                return (
                  <div key={br.id} className="bg-white rounded-xl p-4" style={{ border: '0.5px solid #e2e8f0' }}>
                    <div className="text-[13px] font-bold text-slate-700 mb-3">{br.name}</div>
                    <div className="flex flex-col gap-2.5">
                      {/* Labor % */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-500">% לייבור</span>
                          <span className="text-[11px] font-bold" style={{ color: laborColor }}>{br.laborPct.toFixed(1)}% / {laborTarget}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min((br.laborPct / Math.max(laborTarget * 1.5, 1)) * 100, 100)}%`, backgroundColor: laborColor }} />
                        </div>
                      </div>
                      {/* Waste % */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-500">% פחת</span>
                          <span className="text-[11px] font-bold" style={{ color: wasteColor }}>{br.wastePct.toFixed(1)}% / {wasteTarget}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min((br.wastePct / Math.max(wasteTarget * 1.5, 1)) * 100, 100)}%`, backgroundColor: wasteColor }} />
                        </div>
                      </div>
                      {/* Operating Profit % */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-500">% רווח תפעולי</span>
                          <span className="text-[11px] font-bold" style={{ color: opColor }}>{opPct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(Math.max(opPct, 0), 100)}%`, backgroundColor: opColor }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>

          {/* ── ROW 4 — Comparative LineChart ── */}
          <motion.div variants={fadeIn(0.3)} initial="hidden" animate="visible" className="mb-2.5">
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
                    {BRANCHES.map((br) => (
                      <Line
                        key={br.id}
                        type="monotone"
                        dataKey={br.name}
                        stroke={br.color || '#378ADD'}
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

          {/* ── Overhead % (from system settings) ── */}
          <div className="flex items-center gap-2 mb-3.5 justify-end">
            <span className="text-[13px] font-semibold text-slate-500">העמסת מטה:</span>
            <span className="text-sm font-semibold text-indigo-400">{overheadPct}%</span>
          </div>

          {/* ── Comparison Table ── */}
          <motion.div variants={fadeIn(0.4)} initial="hidden" animate="visible">
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
                    <motion.div variants={fadeIn(0)} initial="hidden" animate="visible"
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
                        // Correct order: revenue, expenses, labor, mgmt → gross profit, then fixedCosts, waste, overhead → operating
                        const costRows: { label: string; key: keyof BranchData; color: string }[] = [
                          { label: 'הכנסות', key: 'totalRevenue', color: '#34d399' },
                          { label: 'רכישות מפעל', key: 'expSuppliersInternal', color: '#818cf8' },
                          { label: 'ספקים חיצוניים', key: 'expSuppliersExternal', color: '#fb7185' },
                          { label: 'לייבור', key: 'laborEmployer', color: '#fbbf24' },
                          { label: 'הנהלה וכלליות', key: 'mgmtCosts', color: '#64748b' },
                          { label: 'פחת', key: 'wasteTotal', color: '#fb7185' },
                        ]
                        const visibleCostRows = presentationMode ? costRows.filter(r => !HIDDEN_IN_PRESENTATION.has(r.key)) : costRows
                        const rows: JSX.Element[] = []

                        // Cost rows before gross profit
                        visibleCostRows.forEach((row, ri) => {
                          const isBold = row.key === 'totalRevenue'
                          const totalVal = branches.reduce((s, b) => s + b[row.key], 0)
                          rows.push(
                            <TableRow key={row.key} className={isBold ? 'bg-slate-50' : ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                              <TableCell className={`px-3.5 py-2.5 text-slate-700 ${isBold ? 'font-bold' : 'font-medium'}`}>{row.label}</TableCell>
                              {branches.map(br => (
                                <TableCell key={br.id} className={`px-3.5 py-2.5 text-center ${isBold ? 'font-bold' : 'font-medium'}`} style={{ color: br[row.key] === 0 ? '#94a3b8' : row.color }}>
                                  {br[row.key] === 0 ? '\u2014' : fmtM(Number(br[row.key]))}
                                </TableCell>
                              ))}
                              <TableCell className="px-3.5 py-2.5 text-center font-bold text-slate-900">
                                {totalVal === 0 ? '\u2014' : fmtM(totalVal)}
                              </TableCell>
                            </TableRow>
                          )
                        })

                        // Presentation mode: merged labor % row
                        if (presentationMode) {
                          rows.push(
                            <TableRow key="labor-exp-pct" className="bg-indigo-50/50">
                              <TableCell className="px-3.5 py-2.5 font-bold" style={{ color: '#3C3489' }}>עלויות עבודה %</TableCell>
                              {branches.map(br => {
                                const pct = br.totalRevenue > 0 ? ((br.laborEmployer + br.totalExpenses + br.mgmtCosts) / br.totalRevenue * 100) : 0
                                return (
                                  <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: '#534AB7' }}>
                                    {br.totalRevenue > 0 ? pct.toFixed(1) + '%' : '\u2014'}
                                  </TableCell>
                                )
                              })}
                              <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: '#534AB7' }}>
                                {totals.revenue > 0 ? ((totals.labor + totals.expenses + totals.mgmtCosts) / totals.revenue * 100).toFixed(1) + '%' : '\u2014'}
                              </TableCell>
                            </TableRow>
                          )
                        }

                        // Gross profit row
                        rows.push(
                          <TableRow key="grossProfit" className="bg-slate-50 border-t border-slate-200">
                            <TableCell className="px-3.5 py-2.5 font-bold text-slate-700"><span className="cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span></TableCell>
                            {branches.map(br => {
                              const gp = brGross(br)
                              return (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: gp >= 0 ? '#34d399' : '#fb7185' }}>
                                  {fmtM(gp)}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totals.grossProfit >= 0 ? '#34d399' : '#fb7185' }}>
                              {fmtM(totals.grossProfit)}
                            </TableCell>
                          </TableRow>
                        )

                        // % Gross profit row
                        rows.push(
                          <TableRow key="kpi-gross-pct" className="bg-slate-50">
                            <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% רווח נשלט</TableCell>
                            {branches.map(br => {
                              const gp = brGross(br)
                              const gpPct = br.totalRevenue > 0 ? (gp / br.totalRevenue * 100) : 0
                              return (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: gpPct >= 0 ? '#34d399' : '#fb7185' }}>
                                  {br.totalRevenue > 0 ? gpPct.toFixed(1) + '%' : '\u2014'}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totals.grossProfit >= 0 ? '#34d399' : '#fb7185' }}>
                              {totals.revenue > 0 ? (totals.grossProfit / totals.revenue * 100).toFixed(1) + '%' : '\u2014'}
                            </TableCell>
                          </TableRow>
                        )

                        // Operating cost rows: fixedCosts, overhead
                        const opCostRows: { label: string; key: keyof BranchData; color: string }[] = [
                          { label: 'עלויות קבועות', key: 'fixedCosts', color: '#64748b' },
                        ]
                        opCostRows.forEach((row, ri) => {
                          const totalVal = branches.reduce((s, b) => s + Number(b[row.key]), 0)
                          rows.push(
                            <TableRow key={row.key} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                              <TableCell className="px-3.5 py-2.5 font-medium text-slate-700">{row.label}</TableCell>
                              {branches.map(br => (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-medium" style={{ color: Number(br[row.key]) === 0 ? '#94a3b8' : row.color }}>
                                  {Number(br[row.key]) === 0 ? '\u2014' : fmtM(Number(br[row.key]))}
                                </TableCell>
                              ))}
                              <TableCell className="px-3.5 py-2.5 text-center font-bold text-slate-900">
                                {totalVal === 0 ? '\u2014' : fmtM(totalVal)}
                              </TableCell>
                            </TableRow>
                          )
                        })

                        // Overhead row
                        if (overheadPct > 0) {
                          rows.push(
                            <TableRow key="overhead" className="bg-slate-50/50">
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
                          )
                        }

                        // Operating profit row
                        rows.push(
                          <TableRow key="operatingProfit" className="bg-slate-50 border-t border-slate-200">
                            <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">רווח תפעולי</TableCell>
                            {branches.map(br => {
                              const op = brOP(br)
                              return (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: op >= 0 ? '#34d399' : '#fb7185' }}>
                                  {fmtM(op)}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totals.operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>
                              {fmtM(totals.operatingProfit)}
                            </TableCell>
                          </TableRow>
                        )

                        // KPI % rows with targets
                        const avgLaborTarget = branches.length > 0 ? branches.reduce((s, b) => s + getTarget(b.id, 'labor_pct'), 0) / branches.length : 0
                        const avgWasteTarget = branches.length > 0 ? branches.reduce((s, b) => s + getTarget(b.id, 'waste_pct'), 0) / branches.length : 3

                        rows.push(
                          <TableRow key="kpi-labor" className="border-t-2 border-slate-200 bg-slate-50">
                            <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% לייבור</TableCell>
                            {branches.map(br => {
                              const target = getTarget(br.id, 'labor_pct')
                              return (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: target > 0 ? (br.laborPct <= target ? '#34d399' : '#fb7185') : '#334155' }}>
                                  {br.totalRevenue > 0 ? <>{br.laborPct.toFixed(1)}% {target > 0 && <span className="text-[10px] text-slate-400 font-normal">(יעד {target}%)</span>}</> : '\u2014'}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: avgLaborTarget > 0 ? (totalLaborPct <= avgLaborTarget ? '#34d399' : '#fb7185') : '#334155' }}>
                              {totalLaborPct.toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        )

                        rows.push(
                          <TableRow key="kpi-waste" className="bg-slate-50">
                            <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% פחת</TableCell>
                            {branches.map(br => {
                              const target = getTarget(br.id, 'waste_pct')
                              return (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: br.wastePct <= target ? '#34d399' : '#fb7185' }}>
                                  {br.totalRevenue > 0 ? <>{br.wastePct.toFixed(1)}% <span className="text-[10px] text-slate-400 font-normal">(יעד {target}%)</span></> : '\u2014'}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totalWastePct <= avgWasteTarget ? '#34d399' : '#fb7185' }}>
                              {totalWastePct.toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        )

                        rows.push(
                          <TableRow key="kpi-op-pct" className="bg-slate-50">
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
                        )

                        // Revenue target row
                        rows.push(
                          <TableRow key="kpi-revenue" className="border-t-2 border-indigo-200 bg-indigo-50/30">
                            <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">יעד הכנסות</TableCell>
                            {branches.map(br => {
                              const target = getTarget(br.id, 'revenue_target')
                              const hit = target > 0 && br.totalRevenue >= target
                              return (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: target === 0 ? '#94a3b8' : hit ? '#34d399' : '#fb7185' }}>
                                  {target > 0 ? <>{fmtM(br.totalRevenue)} <span className="text-[10px] text-slate-400 font-normal">/ {fmtM(target)}</span></> : '\u2014'}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold text-slate-900">
                              {fmtM(totals.revenue)}
                            </TableCell>
                          </TableRow>
                        )

                        // Average basket row
                        rows.push(
                          <TableRow key="kpi-basket" className="bg-indigo-50/30">
                            <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">סל ממוצע</TableCell>
                            {branches.map(br => {
                              const target = getTarget(br.id, 'basket_target')
                              const hit = target > 0 && br.avgBasket >= target
                              return (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: target === 0 ? '#94a3b8' : hit ? '#34d399' : '#fb7185' }}>
                                  {br.avgBasket > 0 ? <>₪{Math.round(br.avgBasket)} <span className="text-[10px] text-slate-400 font-normal">(יעד ₪{target})</span></> : '\u2014'}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold text-slate-900">
                              {(() => { const t = branches.reduce((s, b) => s + b.totalTransactions, 0); const r = branches.reduce((s, b) => s + b.revCashier, 0); return t > 0 ? '₪' + Math.round(r / t) : '\u2014' })()}
                            </TableCell>
                          </TableRow>
                        )

                        // Daily transactions row
                        rows.push(
                          <TableRow key="kpi-transactions" className="bg-indigo-50/30">
                            <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">עסקאות יומי (ממוצע)</TableCell>
                            {branches.map(br => {
                              const target = getTarget(br.id, 'transaction_target')
                              const hit = target > 0 && br.avgDailyTransactions >= target
                              return (
                                <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: target === 0 ? '#94a3b8' : hit ? '#34d399' : '#fb7185' }}>
                                  {br.avgDailyTransactions > 0 ? <>{Math.round(br.avgDailyTransactions)} <span className="text-[10px] text-slate-400 font-normal">(יעד {target})</span></> : '\u2014'}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold text-slate-900">
                              {Math.round(branches.reduce((s, b) => s + b.avgDailyTransactions, 0))}
                            </TableCell>
                          </TableRow>
                        )

                        return rows
                      })()}
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
