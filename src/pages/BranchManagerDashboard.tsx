import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase, getOverheadPct } from '../lib/supabase'
import { calculateBranchPL, type PLResult } from '../lib/calculatePL'
import { usePeriod } from '../lib/PeriodContext'
import { useBranches } from '../lib/BranchContext'
import PeriodPicker from '../components/PeriodPicker'
import { TrendingUp, TrendingDown, Presentation, EyeOff } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { generateInsights, type InsightsInput } from '../lib/generateInsights'
import InsightsCard from '../components/InsightsCard'

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

function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) }

function DiffBadge({ current, previous, inverse }: { current: number; previous: number; inverse?: boolean }) {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return <TrendingUp size={12} style={{ color: '#34d399' }} />
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const isUp = pct > 0
  const isGood = inverse ? !isUp : isUp
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 700, color: isGood ? '#34d399' : '#ef4444' }}>
      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

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
  const [insights, setInsights] = useState<any[]>([])

  const brOH = (br: BranchData) => br.totalRevenue * overheadPct / 100
  const brGross = (br: BranchData) => br.grossProfit
  const brOP = (br: BranchData) => br.operatingProfit

  function plToBranchData(pl: PLResult, name: string, color: string): BranchData {
    const totalExpenses = pl.factoryPurchases + pl.externalSuppliers + pl.repairs + pl.deliveries + pl.infrastructure + pl.otherExpenses
    return {
      id: pl.branchId, name, color,
      revCashier: 0, revWebsite: 0, revCredit: 0,
      totalRevenue: pl.revenue,
      expSuppliers: pl.factoryPurchases + pl.externalSuppliers,
      expSuppliersInternal: pl.factoryPurchases,
      expSuppliersExternal: pl.externalSuppliers,
      expRepairs: pl.repairs,
      expInfra: pl.infrastructure,
      expDelivery: pl.deliveries,
      expOther: pl.otherExpenses,
      totalExpenses,
      laborGross: 0,
      laborEmployer: pl.labor,
      wasteTotal: pl.waste,
      fixedCosts: pl.fixedCosts,
      mgmtCosts: pl.managerSalary,
      grossProfit: pl.controllableProfit,
      operatingProfit: pl.operatingProfit,
      laborPct: pl.revenue > 0 ? (pl.labor / pl.revenue) * 100 : 0,
      wastePct: pl.revenue > 0 ? (pl.waste / pl.revenue) * 100 : 0,
      grossPct: pl.revenue > 0 ? (pl.controllableProfit / pl.revenue) * 100 : 0,
      operatingPct: pl.revenue > 0 ? (pl.operatingProfit / pl.revenue) * 100 : 0,
      totalTransactions: 0, workingDays: 1, avgBasket: 0, avgDailyTransactions: 0,
    }
  }

  async function fetchTransactionData(branchId: number, dateFrom: string, dateTo: string) {
    const { data: revData } = await supabase.from('branch_revenue').select('source, amount, transaction_count, date')
      .eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo)
    const rows = revData || []
    const revCashier = rows.filter(r => r.source === 'cashier').reduce((s, r) => s + Number(r.amount), 0)
    const revWebsite = rows.filter(r => r.source === 'website').reduce((s, r) => s + Number(r.amount), 0)
    const revCredit = rows.filter(r => r.source === 'credit').reduce((s, r) => s + Number(r.amount), 0)
    const laborGross = 0 // not needed from revenue query
    const totalTransactions = rows.filter(r => r.source === 'cashier').reduce((s, r) => s + (Number(r.transaction_count) || 0), 0)
    const uniqueDays = new Set(rows.filter(r => r.source === 'cashier' && Number(r.transaction_count) > 0).map(r => r.date)).size
    const workingDays = uniqueDays || 1
    const avgBasket = totalTransactions > 0 ? revCashier / totalTransactions : 0
    const avgDailyTransactions = totalTransactions / workingDays
    return { revCashier, revWebsite, revCredit, laborGross, totalTransactions, workingDays, avgBasket, avgDailyTransactions }
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const oh = await getOverheadPct()
      setOverheadPct(oh)
      const mk = from.slice(0, 7)
      const prevMk = comparisonPeriod.from.slice(0, 7)

      const [currentPLs, previousPLs, transactionData] = await Promise.all([
        Promise.all(BRANCHES.map(br => calculateBranchPL(br.id, from, to, undefined, mk))),
        Promise.all(BRANCHES.map(br => calculateBranchPL(br.id, comparisonPeriod.from, comparisonPeriod.to, undefined, prevMk))),
        Promise.all(BRANCHES.map(br => fetchTransactionData(br.id, from, to))),
      ])

      const current = currentPLs.map((pl, i) => {
        const bd = plToBranchData(pl, BRANCHES[i].name, BRANCHES[i].color)
        const tx = transactionData[i]
        bd.revCashier = tx.revCashier
        bd.revWebsite = tx.revWebsite
        bd.revCredit = tx.revCredit
        bd.totalTransactions = tx.totalTransactions
        bd.workingDays = tx.workingDays
        bd.avgBasket = tx.avgBasket
        bd.avgDailyTransactions = tx.avgDailyTransactions
        return bd
      })

      const previous = previousPLs.map((pl, i) => plToBranchData(pl, BRANCHES[i].name, BRANCHES[i].color))

      setBranches(current)
      setPrevBranches(previous)

      const { data: kpiData } = await supabase.from('branch_kpi_targets').select('branch_id, labor_pct, waste_pct, revenue_target, basket_target, transaction_target')
      const kpiMap: typeof kpiTargets = {}
      ;(kpiData || []).forEach((k: any) => { kpiMap[k.branch_id] = k })
      setKpiTargets(kpiMap)

      // Generate insights from aggregated branch data
      const totalRev = current.reduce((s, br) => s + br.totalRevenue, 0)
      const totalLabor = current.reduce((s, br) => s + br.laborEmployer, 0)
      const totalWaste = current.reduce((s, br) => s + br.wasteTotal, 0)
      const totalGross = current.reduce((s, br) => s + br.grossProfit, 0)
      const totalFactoryPurchases = current.reduce((s, br) => s + (br.expSuppliersInternal || 0), 0)

      // Average targets
      const targetValues = Object.values(kpiMap)
      const avgLaborTarget = targetValues.length > 0 ? targetValues.reduce((s: number, t: any) => s + (t?.labor_pct || 0), 0) / targetValues.length : 28
      const avgWasteTarget = targetValues.length > 0 ? targetValues.reduce((s: number, t: any) => s + (t?.waste_pct || 0), 0) / targetValues.length : 3
      const avgRevTarget = targetValues.reduce((s: number, t: any) => s + (t?.revenue_target || 0), 0)

      const insightInput: InsightsInput = {
        labor: {
          totalCost: totalLabor,
          targetPct: avgLaborTarget,
          revenue: totalRev,
        },
        revenue: {
          actual: totalRev,
          target: avgRevTarget,
        },
        waste: {
          totalAmount: totalWaste,
          targetPct: avgWasteTarget,
          revenue: totalRev,
        },
        controllableProfit: {
          actual: totalGross,
          target: totalRev * 0.30,
          revenue: totalRev,
        },
        factoryPurchases: {
          amount: totalFactoryPurchases,
          avgMonthly: totalFactoryPurchases, // simplified — no historical avg
          isHolidayMonth: false,
        },
      }

      const generated = generateInsights(insightInput)
      console.log('[BranchManager] insightInput:', JSON.stringify(insightInput))
      console.log('[BranchManager] generated insights:', generated.length, generated.map(i => i.id))
      setInsights(generated)

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

  const maxRevenue = useMemo(() => Math.max(...branches.map(b => b.totalRevenue), 1), [branches])
  const maxLaborPct = useMemo(() => Math.max(...branches.map(b => b.laborPct), 1), [branches])

  // Chart colors - indigo/gray palette
  const CHART_COLORS = ['#6366f1', '#818cf8', '#a5b4fc', '#94a3b8', '#64748b', '#475569', '#c7d2fe', '#e2e8f0']

  // Table cell style helper
  const cellStyle = (bold?: boolean, color?: string): React.CSSProperties => ({
    padding: '10px 14px',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: bold ? 700 : 500,
    color: color || '#374151',
    borderBottom: '1px solid #f8fafc',
  })

  const headerCellStyle: React.CSSProperties = {
    padding: '10px 14px',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: 600,
    color: '#94a3b8',
    borderBottom: '1px solid #f1f5f9',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="דשבורד מנהל סניפים" onBack={onBack} action={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <button
            onClick={() => setPresentationMode(v => !v)}
            style={{
              background: presentationMode ? '#6366f1' : 'none',
              color: presentationMode ? 'white' : '#64748b',
              border: presentationMode ? 'none' : '1px solid #e2e8f0',
              borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            {presentationMode ? <EyeOff size={14} /> : <Presentation size={14} />}
            {presentationMode ? 'יציאה ממצב ישיבה' : 'מצב ישיבה'}
          </button>
        </div>
      } />

      {loading && <div style={{ textAlign: 'center', padding: '64px 0', color: '#94a3b8', fontSize: 14 }}>טוען נתונים...</div>}

      {!loading && (
        <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>

          <InsightsCard insights={insights} />

          {/* Hero KPI Card */}
          {branches.length > 0 && (() => {
            const totalRev = branches.reduce((s, br) => s + br.totalRevenue, 0)
            const totalLabor = branches.reduce((s, br) => s + br.laborEmployer, 0)
            const totalWaste = branches.reduce((s, br) => s + br.wasteTotal, 0)
            const totalGross = branches.reduce((s, br) => s + br.grossProfit, 0)
            const avgControllable = totalRev > 0 ? (totalGross / totalRev) * 100 : 0
            const avgLabor = totalRev > 0 ? (totalLabor / totalRev) * 100 : 0
            const avgWaste = totalRev > 0 ? (totalWaste / totalRev) * 100 : 0

            // Average targets
            const targetKeys = Object.keys(kpiTargets)
            const avgLaborTarget = targetKeys.length > 0 ? targetKeys.reduce((s, k) => s + (kpiTargets[Number(k)]?.labor_pct || 0), 0) / targetKeys.length : 0
            const avgWasteTarget = targetKeys.length > 0 ? targetKeys.reduce((s, k) => s + (kpiTargets[Number(k)]?.waste_pct || 0), 0) / targetKeys.length : 0
            const avgRevTarget = targetKeys.length > 0 ? targetKeys.reduce((s, k) => s + (kpiTargets[Number(k)]?.revenue_target || 0), 0) : 0

            const tiles = [
              {
                label: 'סה"כ הכנסות',
                value: `₪${Math.round(totalRev).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                pct: avgRevTarget > 0 ? (totalRev / avgRevTarget) * 100 : null,
                targetLabel: avgRevTarget > 0 ? `יעד: ₪${avgRevTarget.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : undefined,
                status: avgRevTarget <= 0 ? 'none' : totalRev >= avgRevTarget * 0.95 ? 'good' : totalRev >= avgRevTarget * 0.8 ? 'warn' : 'bad',
              },
              {
                label: 'רווח נשלט %',
                value: `${avgControllable.toFixed(1)}%`,
                pct: null,
                targetLabel: undefined,
                status: avgControllable >= 30 ? 'good' : avgControllable >= 20 ? 'warn' : 'bad',
              },
              {
                label: '% לייבור ממוצע',
                value: `${avgLabor.toFixed(1)}%`,
                pct: avgLaborTarget > 0 ? Math.max(0, (1 - (avgLabor - avgLaborTarget) / avgLaborTarget)) * 100 : null,
                targetLabel: avgLaborTarget > 0 ? `יעד: ${avgLaborTarget.toFixed(0)}%` : undefined,
                status: avgLaborTarget <= 0 ? 'none' : avgLabor <= avgLaborTarget ? 'good' : avgLabor <= avgLaborTarget + 2 ? 'warn' : 'bad',
              },
              {
                label: '% פחת ממוצע',
                value: `${avgWaste.toFixed(1)}%`,
                pct: avgWasteTarget > 0 ? Math.max(0, (1 - (avgWaste - avgWasteTarget) / avgWasteTarget)) * 100 : null,
                targetLabel: avgWasteTarget > 0 ? `יעד: ${avgWasteTarget.toFixed(0)}%` : undefined,
                status: avgWasteTarget <= 0 ? 'none' : avgWaste <= avgWasteTarget ? 'good' : avgWaste <= avgWasteTarget + 1 ? 'warn' : 'bad',
              },
            ]

            const theme = {
              good:  { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d', bar: '#4ade80' },
              warn:  { bg: '#fffbeb', border: '#fde68a', text: '#b45309', bar: '#fbbf24' },
              bad:   { bg: '#fff1f2', border: '#fecdd3', text: '#be123c', bar: '#fb7185' },
              none:  { bg: '#f9fafb', border: '#e5e7eb', text: '#374151', bar: '#d1d5db' },
            }

            return (
              <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 20, marginBottom: 16 }}>
                <div style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                    סיכום {period.label}
                  </h2>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>כל הסניפים</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  {tiles.map((tile, i) => {
                    const t = theme[tile.status as keyof typeof theme] || theme.none
                    const pctDisplay = tile.pct !== null ? `${Math.round(tile.pct)}%` : ''
                    return (
                      <div key={tile.label}
                        style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 12, padding: 14 }}>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{tile.label}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <span style={{ fontSize: 20, fontWeight: 700, color: t.text }}>{tile.value}</span>
                          {pctDisplay && <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{pctDisplay}</span>}
                        </div>
                        {tile.pct !== null && (
                          <div style={{ height: 5, background: `${t.border}`, borderRadius: 3, marginBottom: 4 }}>
                            <div style={{ height: '100%', width: `${Math.min(tile.pct, 100)}%`, background: t.bar, borderRadius: 3, transition: 'width 0.5s' }} />
                          </div>
                        )}
                        {tile.targetLabel && <div style={{ fontSize: 10, color: '#9ca3af' }}>{tile.targetLabel}</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* KPI Cards */}
          <motion.div variants={fadeIn(0)} initial="hidden" animate="visible" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>סה"כ הכנסות</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#6366f1' }}>
                <CountUp end={Math.round(totals.revenue)} duration={1.5} separator="," prefix="₪" />
              </div>
              <DiffBadge current={totals.revenue} previous={prevTotals.revenue} />
            </div>

            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4, cursor: 'help' }} title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">סה"כ רווח נשלט</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: totals.grossProfit >= 0 ? '#34d399' : '#ef4444' }}>
                <CountUp end={Math.round(totals.grossProfit)} duration={1.5} separator="," prefix="₪" />
              </div>
              <DiffBadge current={totals.grossProfit} previous={prevTotals.grossProfit} />
            </div>

            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>סה"כ רווח תפעולי</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: totals.operatingProfit >= 0 ? '#34d399' : '#ef4444' }}>
                <CountUp end={Math.round(totals.operatingProfit)} duration={1.5} separator="," prefix="₪" />
              </div>
              <DiffBadge current={totals.operatingProfit} previous={prevTotals.operatingProfit} />
            </div>

            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>% לייבור ממוצע</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#6366f1' }}>
                <CountUp end={totalLaborPct} duration={1.5} suffix="%" decimals={1} />
              </div>
              {(() => { const avgTarget = branches.length > 0 ? branches.reduce((s, b) => s + getTarget(b.id, 'labor_pct'), 0) / branches.length : 0; return avgTarget > 0 ? <span style={{ fontSize: 11, color: '#94a3b8' }}>יעד {avgTarget.toFixed(0)}%</span> : <span style={{ fontSize: 11, color: '#94a3b8' }}>{'\u2014'}</span> })()}
            </div>
          </motion.div>

          {/* Detail Cards Row */}
          <motion.div variants={fadeIn(0.1)} initial="hidden" animate="visible" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            {/* Revenue per branch */}
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>הכנסות לפי סניף</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {branches.map(br => {
                  const totalAllRev = branches.reduce((s, b) => s + b.totalRevenue, 0)
                  const revSharePct = totalAllRev > 0 ? (br.totalRevenue / totalAllRev) * 100 : 0
                  const barW = (br.totalRevenue / maxRevenue) * 100
                  return (
                    <div key={br.id}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{br.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>{fmtM(br.totalRevenue)}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1' }}>
                            {revSharePct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, transition: 'width 0.5s', width: `${barW}%`, backgroundColor: '#6366f1' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Labor per branch */}
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>לייבור לפי סניף</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {branches.map(br => {
                  const barW = (br.laborPct / Math.max(maxLaborPct, 40)) * 100
                  return (
                    <div key={br.id}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{br.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: (() => { const t = getTarget(br.id, 'labor_pct'); return t > 0 ? (br.laborPct <= t ? '#34d399' : '#ef4444') : '#374151' })() }}>
                            {br.laborPct.toFixed(1)}%
                          </span>
                          {(() => { const t = getTarget(br.id, 'labor_pct'); return t > 0 ? <span style={{ fontSize: 11, color: '#94a3b8' }}>יעד {t}%</span> : <span style={{ fontSize: 11, color: '#94a3b8' }}>{'\u2014'}</span> })()}
                        </div>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ height: '100%', borderRadius: 3, transition: 'width 0.5s', width: `${Math.min(barW, 100)}%`, backgroundColor: '#818cf8' }} />
                        {(() => { const t = getTarget(br.id, 'labor_pct'); return t > 0 ? <div style={{ position: 'absolute', top: 0, height: '100%', width: 1, background: '#94a3b8', right: `${(t / Math.max(maxLaborPct, 40)) * 100}%` }} /> : null })()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </motion.div>

          {/* KPI Targets per Branch */}
          <motion.div variants={fadeIn(0.2)} initial="hidden" animate="visible" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>יעדים לפי סניף</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {branches.map(br => {
                const laborTarget = getTarget(br.id, 'labor_pct')
                const wasteTarget = getTarget(br.id, 'waste_pct')
                const opPct = br.totalRevenue > 0 ? (brOP(br) / br.totalRevenue * 100) : 0

                const kpiColor = (actual: number, target: number, inverse: boolean) => {
                  const diff = inverse ? (actual - target) / target : (target - actual) / target
                  if (diff <= 0) return '#34d399'
                  if (diff <= 0.2) return '#f59e0b'
                  return '#ef4444'
                }

                const laborColor = kpiColor(br.laborPct, laborTarget, true)
                const wasteColor = kpiColor(br.wastePct, wasteTarget, true)
                const opColor = opPct >= 0 ? '#34d399' : opPct >= -5 ? '#f59e0b' : '#ef4444'

                return (
                  <div key={br.id} style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>{br.name}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>% לייבור</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: laborColor }}>{br.laborPct.toFixed(1)}% / {laborTarget}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, transition: 'width 0.5s', width: `${Math.min((br.laborPct / Math.max(laborTarget * 1.5, 1)) * 100, 100)}%`, backgroundColor: laborColor }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>% פחת</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: wasteColor }}>{br.wastePct.toFixed(1)}% / {wasteTarget}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, transition: 'width 0.5s', width: `${Math.min((br.wastePct / Math.max(wasteTarget * 1.5, 1)) * 100, 100)}%`, backgroundColor: wasteColor }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>% רווח תפעולי</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: opColor }}>{opPct.toFixed(1)}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, transition: 'width 0.5s', width: `${Math.min(Math.max(opPct, 0), 100)}%`, backgroundColor: opColor }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>

          {/* Line Chart */}
          <motion.div variants={fadeIn(0.3)} initial="hidden" animate="visible" style={{ marginBottom: 10 }}>
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>הכנסות לפי סניף - 6 חודשים אחרונים</div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip
                    formatter={(value: any) => [fmtM(Number(value)), '']}
                    contentStyle={{ direction: 'rtl', fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {BRANCHES.map((br, idx) => (
                    <Line
                      key={br.id}
                      type="monotone"
                      dataKey={br.name}
                      stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Overhead info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>העמסת מטה:</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#6366f1' }}>{overheadPct}%</span>
          </div>

          {/* Comparison Table */}
          <motion.div variants={fadeIn(0.4)} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>טבלת השוואה - {period.label}</div>
              </div>

              {/* Presentation mode banner */}
              {presentationMode && (
                <div style={{ padding: '8px 20px', textAlign: 'center', fontSize: 13, fontWeight: 600, background: '#f8fafc', color: '#6366f1', borderBottom: '1px solid #f1f5f9' }}>
                  מצב ישיבה פעיל - נתוני שכר מוסתרים
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...headerCellStyle, textAlign: 'right' }}>מדד</th>
                      {branches.map(br => (
                        <th key={br.id} style={headerCellStyle}>
                          <span style={{ color: '#6366f1' }}>{br.name}</span>
                        </th>
                      ))}
                      <th style={{ ...headerCellStyle, color: '#0f172a' }}>סה"כ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const HIDDEN_IN_PRESENTATION = new Set(['laborEmployer', 'mgmtCosts', 'totalExpenses'])
                      const costRows: { label: string; key: keyof BranchData; color: string }[] = [
                        { label: 'הכנסות', key: 'totalRevenue', color: '#34d399' },
                        { label: 'רכישות מפעל', key: 'expSuppliersInternal', color: '#818cf8' },
                        { label: 'ספקים חיצוניים', key: 'expSuppliersExternal', color: '#ef4444' },
                        { label: 'לייבור', key: 'laborEmployer', color: '#f59e0b' },
                        { label: 'הנהלה וכלליות', key: 'mgmtCosts', color: '#64748b' },
                        { label: 'פחת', key: 'wasteTotal', color: '#ef4444' },
                      ]
                      const visibleCostRows = presentationMode ? costRows.filter(r => !HIDDEN_IN_PRESENTATION.has(r.key)) : costRows
                      const rows: JSX.Element[] = []

                      visibleCostRows.forEach((row) => {
                        const isBold = row.key === 'totalRevenue'
                        const totalVal = branches.reduce((s, b) => s + b[row.key], 0)
                        rows.push(
                          <tr key={row.key}>
                            <td style={{ ...cellStyle(isBold), textAlign: 'right' }}>{row.label}</td>
                            {branches.map(br => (
                              <td key={br.id} style={cellStyle(isBold, br[row.key] === 0 ? '#94a3b8' : row.color)}>
                                {br[row.key] === 0 ? '\u2014' : fmtM(Number(br[row.key]))}
                              </td>
                            ))}
                            <td style={cellStyle(true, '#0f172a')}>
                              {totalVal === 0 ? '\u2014' : fmtM(totalVal)}
                            </td>
                          </tr>
                        )
                      })

                      // Presentation mode: merged labor % row
                      if (presentationMode) {
                        rows.push(
                          <tr key="labor-exp-pct">
                            <td style={{ ...cellStyle(true), textAlign: 'right', color: '#6366f1' }}>עלויות עבודה %</td>
                            {branches.map(br => {
                              const pct = br.totalRevenue > 0 ? ((br.laborEmployer + br.totalExpenses + br.mgmtCosts) / br.totalRevenue * 100) : 0
                              return (
                                <td key={br.id} style={cellStyle(true, '#6366f1')}>
                                  {br.totalRevenue > 0 ? pct.toFixed(1) + '%' : '\u2014'}
                                </td>
                              )
                            })}
                            <td style={cellStyle(true, '#6366f1')}>
                              {totals.revenue > 0 ? ((totals.labor + totals.expenses + totals.mgmtCosts) / totals.revenue * 100).toFixed(1) + '%' : '\u2014'}
                            </td>
                          </tr>
                        )
                      }

                      // Gross profit
                      rows.push(
                        <tr key="grossProfit" style={{ background: '#fafafa' }}>
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}><span style={{ cursor: 'help' }} title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span></td>
                          {branches.map(br => {
                            const gp = brGross(br)
                            return <td key={br.id} style={cellStyle(true, gp >= 0 ? '#34d399' : '#ef4444')}>{fmtM(gp)}</td>
                          })}
                          <td style={cellStyle(true, totals.grossProfit >= 0 ? '#34d399' : '#ef4444')}>{fmtM(totals.grossProfit)}</td>
                        </tr>
                      )

                      // % Gross profit
                      rows.push(
                        <tr key="kpi-gross-pct" style={{ background: '#fafafa' }}>
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}>% רווח נשלט</td>
                          {branches.map(br => {
                            const gp = brGross(br)
                            const gpPct = br.totalRevenue > 0 ? (gp / br.totalRevenue * 100) : 0
                            return <td key={br.id} style={cellStyle(true, gpPct >= 0 ? '#34d399' : '#ef4444')}>{br.totalRevenue > 0 ? gpPct.toFixed(1) + '%' : '\u2014'}</td>
                          })}
                          <td style={cellStyle(true, totals.grossProfit >= 0 ? '#34d399' : '#ef4444')}>
                            {totals.revenue > 0 ? (totals.grossProfit / totals.revenue * 100).toFixed(1) + '%' : '\u2014'}
                          </td>
                        </tr>
                      )

                      // Fixed costs
                      const opCostRows: { label: string; key: keyof BranchData; color: string }[] = [
                        { label: 'עלויות קבועות', key: 'fixedCosts', color: '#64748b' },
                      ]
                      opCostRows.forEach((row) => {
                        const totalVal = branches.reduce((s, b) => s + Number(b[row.key]), 0)
                        rows.push(
                          <tr key={row.key}>
                            <td style={{ ...cellStyle(false), textAlign: 'right' }}>{row.label}</td>
                            {branches.map(br => (
                              <td key={br.id} style={cellStyle(false, Number(br[row.key]) === 0 ? '#94a3b8' : row.color)}>
                                {Number(br[row.key]) === 0 ? '\u2014' : fmtM(Number(br[row.key]))}
                              </td>
                            ))}
                            <td style={cellStyle(true, '#0f172a')}>
                              {totalVal === 0 ? '\u2014' : fmtM(totalVal)}
                            </td>
                          </tr>
                        )
                      })

                      // Overhead
                      if (overheadPct > 0) {
                        rows.push(
                          <tr key="overhead">
                            <td style={{ ...cellStyle(false), textAlign: 'right' }}>העמסת מטה {overheadPct}%</td>
                            {branches.map(br => (
                              <td key={br.id} style={cellStyle(false, '#94a3b8')}>{fmtM(brOH(br))}</td>
                            ))}
                            <td style={cellStyle(true, '#0f172a')}>{fmtM(totals.overhead)}</td>
                          </tr>
                        )
                      }

                      // Operating profit
                      rows.push(
                        <tr key="operatingProfit" style={{ background: '#fafafa' }}>
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}>רווח תפעולי</td>
                          {branches.map(br => {
                            const op = brOP(br)
                            return <td key={br.id} style={cellStyle(true, op >= 0 ? '#34d399' : '#ef4444')}>{fmtM(op)}</td>
                          })}
                          <td style={cellStyle(true, totals.operatingProfit >= 0 ? '#34d399' : '#ef4444')}>{fmtM(totals.operatingProfit)}</td>
                        </tr>
                      )

                      // KPI % rows
                      const avgLaborTarget = branches.length > 0 ? branches.reduce((s, b) => s + getTarget(b.id, 'labor_pct'), 0) / branches.length : 0
                      const avgWasteTarget = branches.length > 0 ? branches.reduce((s, b) => s + getTarget(b.id, 'waste_pct'), 0) / branches.length : 3

                      rows.push(
                        <tr key="kpi-labor">
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}>% לייבור</td>
                          {branches.map(br => {
                            const target = getTarget(br.id, 'labor_pct')
                            return (
                              <td key={br.id} style={cellStyle(true, target > 0 ? (br.laborPct <= target ? '#34d399' : '#ef4444') : '#374151')}>
                                {br.totalRevenue > 0 ? <>{br.laborPct.toFixed(1)}% {target > 0 && <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>(יעד {target}%)</span>}</> : '\u2014'}
                              </td>
                            )
                          })}
                          <td style={cellStyle(true, avgLaborTarget > 0 ? (totalLaborPct <= avgLaborTarget ? '#34d399' : '#ef4444') : '#374151')}>
                            {totalLaborPct.toFixed(1)}%
                          </td>
                        </tr>
                      )

                      rows.push(
                        <tr key="kpi-waste">
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}>% פחת</td>
                          {branches.map(br => {
                            const target = getTarget(br.id, 'waste_pct')
                            return (
                              <td key={br.id} style={cellStyle(true, br.wastePct <= target ? '#34d399' : '#ef4444')}>
                                {br.totalRevenue > 0 ? <>{br.wastePct.toFixed(1)}% <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>(יעד {target}%)</span></> : '\u2014'}
                              </td>
                            )
                          })}
                          <td style={cellStyle(true, totalWastePct <= avgWasteTarget ? '#34d399' : '#ef4444')}>
                            {totalWastePct.toFixed(1)}%
                          </td>
                        </tr>
                      )

                      rows.push(
                        <tr key="kpi-op-pct">
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}>% רווח תפעולי</td>
                          {branches.map(br => {
                            const opPct = br.totalRevenue > 0 ? (brOP(br) / br.totalRevenue * 100) : 0
                            return <td key={br.id} style={cellStyle(true, opPct >= 0 ? '#34d399' : '#ef4444')}>{br.totalRevenue > 0 ? opPct.toFixed(1) + '%' : '\u2014'}</td>
                          })}
                          <td style={cellStyle(true, totals.revenue > 0 ? ((totals.operatingProfit / totals.revenue * 100) >= 0 ? '#34d399' : '#ef4444') : '#94a3b8')}>
                            {totals.revenue > 0 ? (totals.operatingProfit / totals.revenue * 100).toFixed(1) + '%' : '\u2014'}
                          </td>
                        </tr>
                      )

                      // Revenue target
                      rows.push(
                        <tr key="kpi-revenue">
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}>יעד הכנסות</td>
                          {branches.map(br => {
                            const target = getTarget(br.id, 'revenue_target')
                            const hit = target > 0 && br.totalRevenue >= target
                            return (
                              <td key={br.id} style={cellStyle(true, target === 0 ? '#94a3b8' : hit ? '#34d399' : '#ef4444')}>
                                {target > 0 ? <>{fmtM(br.totalRevenue)} <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>/ {fmtM(target)}</span></> : '\u2014'}
                              </td>
                            )
                          })}
                          <td style={cellStyle(true, '#0f172a')}>{fmtM(totals.revenue)}</td>
                        </tr>
                      )

                      // Average basket
                      rows.push(
                        <tr key="kpi-basket">
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}>סל ממוצע</td>
                          {branches.map(br => {
                            const target = getTarget(br.id, 'basket_target')
                            const hit = target > 0 && br.avgBasket >= target
                            return (
                              <td key={br.id} style={cellStyle(true, target === 0 ? '#94a3b8' : hit ? '#34d399' : '#ef4444')}>
                                {br.avgBasket > 0 ? <>{'\u20AA'}{Math.round(br.avgBasket)} <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>(יעד {'\u20AA'}{target})</span></> : '\u2014'}
                              </td>
                            )
                          })}
                          <td style={cellStyle(true, '#0f172a')}>
                            {(() => { const t = branches.reduce((s, b) => s + b.totalTransactions, 0); const r = branches.reduce((s, b) => s + b.revCashier, 0); return t > 0 ? '\u20AA' + Math.round(r / t) : '\u2014' })()}
                          </td>
                        </tr>
                      )

                      // Daily transactions
                      rows.push(
                        <tr key="kpi-transactions">
                          <td style={{ ...cellStyle(true), textAlign: 'right' }}>עסקאות יומי (ממוצע)</td>
                          {branches.map(br => {
                            const target = getTarget(br.id, 'transaction_target')
                            const hit = target > 0 && br.avgDailyTransactions >= target
                            return (
                              <td key={br.id} style={cellStyle(true, target === 0 ? '#94a3b8' : hit ? '#34d399' : '#ef4444')}>
                                {br.avgDailyTransactions > 0 ? <>{Math.round(br.avgDailyTransactions)} <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>(יעד {target})</span></> : '\u2014'}
                              </td>
                            )
                          })}
                          <td style={cellStyle(true, '#0f172a')}>
                            {Math.round(branches.reduce((s, b) => s + b.avgDailyTransactions, 0))}
                          </td>
                        </tr>
                      )

                      return rows
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>

        </div>
      )}
    </div>
  )
}
