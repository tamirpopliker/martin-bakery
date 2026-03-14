import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept } from '../lib/supabase'
import { ArrowRight, Trophy, TrendingUp, TrendingDown, Minus, DollarSign, Users, Receipt, Store, BarChart3, Globe, CreditCard, Building2, Truck } from 'lucide-react'
import { BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'

interface Props { onBack: () => void }

// Softer color palette: indigo / emerald / violet
const BRANCHES = [
  { id: 1, name: 'אברהם אבינו', color: '#818cf8' },
  { id: 2, name: 'הפועלים',     color: '#34d399' },
  { id: 3, name: 'יעקב כהן',   color: '#c084fc' },
]

const PIE_COLORS = ['#818cf8', '#fb7185', '#fbbf24', '#34d399', '#c084fc', '#38bdf8', '#94a3b8']

// Soft chart palette
const CHART_INDIGO  = '#818cf8'
const CHART_ROSE    = '#fb7185'
const CHART_EMERALD = '#34d399'

// Animation variants
const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } }
}
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
}
const fadeIn = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } }
}

interface BranchData {
  id: number; name: string; color: string
  revenue: number; expenses: number; labor: number; waste: number
  fixedCosts: number; grossProfit: number; operatingProfit: number
  revCashier: number; revCredit: number; revWebsite: number
}

function fmtN(n: number) { return '₪' + Math.round(n).toLocaleString() }

// ─── Custom styled tooltip ──────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-100 px-4 py-3 min-w-[160px]">
      <p className="text-[11px] font-bold text-slate-500 mb-1.5 border-b border-slate-100 pb-1.5">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-6 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: entry.color || entry.fill }} />
            <span className="text-[11px] text-slate-600">{entry.name}</span>
          </div>
          <span className="text-[12px] font-bold text-slate-800">₪{Number(entry.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-100 px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.payload.fill }} />
        <span className="text-[12px] font-semibold text-slate-700">{d.name}</span>
      </div>
      <div className="text-[13px] font-bold text-slate-900 mt-1">₪{Number(d.value).toLocaleString()}</div>
    </div>
  )
}

export default function CEODashboard({ onBack }: Props) {
  const { period, setPeriod, from, to, monthKey, comparisonPeriod } = usePeriod()
  const [loading, setLoading] = useState(false)
  const [branches, setBranches] = useState<BranchData[]>([])
  const [prevTotalRev, setPrevTotalRev] = useState(0)
  const [prevTotalGross, setPrevTotalGross] = useState(0)
  const [prevTotalOperating, setPrevTotalOperating] = useState(0)
  const [dailyRevenue, setDailyRevenue] = useState<{ date: string; [key: string]: string | number }[]>([])
  const [expenseBreakdown, setExpenseBreakdown] = useState<{ name: string; value: number }[]>([])
  const [avgLaborTarget, setAvgLaborTarget] = useState(28)

  // Factory data
  const [factorySales, setFactorySales]     = useState(0)
  const [factoryLabor, setFactoryLabor]     = useState(0)
  const [factorySuppliers, setFactorySuppliers] = useState(0)
  const [factoryWaste, setFactoryWaste]     = useState(0)
  const [factoryRepairs, setFactoryRepairs] = useState(0)
  const [factoryFixed, setFactoryFixed]     = useState(0)

  // Revenue breakdown
  const [revCashier, setRevCashier] = useState(0)
  const [revCredit, setRevCredit]   = useState(0)
  const [revWebsite, setRevWebsite] = useState(0)
  const [factoryB2b, setFactoryB2b] = useState(0)
  const [branchSuppliers, setBranchSuppliers] = useState(0)

  async function fetchData() {
    setLoading(true)

    const { data: kpiData } = await supabase.from('branch_kpi_targets').select('labor_pct')
    if (kpiData && kpiData.length > 0) {
      const avg = kpiData.reduce((s, r) => s + Number(r.labor_pct || 28), 0) / kpiData.length
      setAvgLaborTarget(avg)
    }

    const [fSalesFs, fSalesB2b, fLabor, fSupp, fWaste, fRepairs, fFixed, globalEmpsData, wdData] = await Promise.all([
      supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', from).lt('date', to),
      supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', from).lt('date', to),
      supabase.from('labor').select('employee_name, employer_cost').eq('entity_type', 'factory').gte('date', from).lt('date', to),
      supabase.from('supplier_invoices').select('amount').gte('date', from).lt('date', to),
      supabase.from('factory_waste').select('amount').gte('date', from).lt('date', to),
      supabase.from('factory_repairs').select('amount').gte('date', from).lt('date', to),
      supabase.from('fixed_costs').select('amount').eq('entity_type', 'factory').eq('month', monthKey || from.slice(0, 7)),
      fetchGlobalEmployees(),
      getWorkingDays(monthKey || from.slice(0, 7)),
    ])

    const fSalesDirect = (fSalesFs.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const fSalesB2bTotal = (fSalesB2b.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const fSalesTotal = fSalesDirect + fSalesB2bTotal
    const globalNames = new Set(globalEmpsData.map(e => e.name))
    const fHourlyLabor = (fLabor.data || []).filter((r: any) => !globalNames.has(r.employee_name)).reduce((s, r) => s + Number(r.employer_cost), 0)
    const fGlobalLaborCreams = calcGlobalLaborForDept(globalEmpsData, 'creams', wdData)
    const fGlobalLaborDough  = calcGlobalLaborForDept(globalEmpsData, 'dough', wdData)
    const fLaborTotal = fHourlyLabor + fGlobalLaborCreams + fGlobalLaborDough
    const fSuppTotal  = (fSupp.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const fWasteTotal = (fWaste.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const fRepairsTotal = (fRepairs.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const fFixedTotal = (fFixed.data || []).reduce((s, r) => s + Number(r.amount), 0)

    setFactorySales(fSalesTotal)
    setFactoryLabor(fLaborTotal)
    setFactorySuppliers(fSuppTotal)
    setFactoryWaste(fWasteTotal)
    setFactoryRepairs(fRepairsTotal)
    setFactoryFixed(fFixedTotal)
    setFactoryB2b(fSalesB2bTotal)

    const branchResults: BranchData[] = []
    let totalExpByType: Record<string, number> = {}
    let totalCashier = 0, totalCredit = 0, totalWebsite = 0

    for (const br of BRANCHES) {
      const { data: revData } = await supabase.from('branch_revenue').select('source, amount')
        .eq('branch_id', br.id).gte('date', from).lt('date', to)
      const revenue = revData ? revData.reduce((s, r) => s + Number(r.amount), 0) : 0
      let brCashier = 0, brCredit = 0, brWebsite = 0
      if (revData) {
        for (const r of revData) {
          const amt = Number(r.amount)
          if (r.source === 'cashier') { totalCashier += amt; brCashier += amt }
          else if (r.source === 'credit') { totalCredit += amt; brCredit += amt }
          else if (r.source === 'website') { totalWebsite += amt; brWebsite += amt }
        }
      }

      const { data: expData } = await supabase.from('branch_expenses').select('expense_type, amount')
        .eq('branch_id', br.id).gte('date', from).lt('date', to)
      const expenses = expData ? expData.reduce((s, r) => s + Number(r.amount), 0) : 0
      if (expData) {
        for (const r of expData) {
          const type = r.expense_type || 'other'
          totalExpByType[type] = (totalExpByType[type] || 0) + Number(r.amount)
        }
      }

      const { data: labData } = await supabase.from('branch_labor').select('employer_cost')
        .eq('branch_id', br.id).gte('date', from).lt('date', to)
      const labor = labData ? labData.reduce((s, r) => s + Number(r.employer_cost), 0) : 0
      totalExpByType['labor'] = (totalExpByType['labor'] || 0) + labor

      const { data: wstData } = await supabase.from('branch_waste').select('amount')
        .eq('branch_id', br.id).gte('date', from).lt('date', to)
      const waste = wstData ? wstData.reduce((s, r) => s + Number(r.amount), 0) : 0
      totalExpByType['waste'] = (totalExpByType['waste'] || 0) + waste

      const { data: fcData } = await supabase.from('fixed_costs').select('amount')
        .eq('entity_type', `branch_${br.id}`).eq('month', monthKey || from.slice(0, 7))
      const fixedCosts = fcData ? fcData.reduce((s, r) => s + Number(r.amount), 0) : 0
      totalExpByType['fixed'] = (totalExpByType['fixed'] || 0) + fixedCosts

      const grossProfit = revenue - labor - expenses
      const operatingProfit = grossProfit - fixedCosts - waste

      branchResults.push({ ...br, revenue, expenses, labor, waste, fixedCosts, grossProfit, operatingProfit, revCashier: brCashier, revCredit: brCredit, revWebsite: brWebsite })
    }

    setBranches(branchResults)
    setRevCashier(totalCashier)
    setRevCredit(totalCredit)
    setRevWebsite(totalWebsite)
    setBranchSuppliers((totalExpByType['supplier'] || 0) + (totalExpByType['inventory'] || 0))

    const typeLabels: Record<string, string> = {
      supplier: 'ספקים/מלאי', inventory: 'ספקים/מלאי', repair: 'תיקונים',
      infrastructure: 'תשתיות', delivery: 'משלוחים', other: 'אחר',
      labor: 'לייבור', waste: 'פחת', fixed: 'עלויות קבועות',
    }
    const merged: Record<string, number> = {}
    for (const [k, v] of Object.entries(totalExpByType)) {
      const label = typeLabels[k] || k
      merged[label] = (merged[label] || 0) + v
    }
    setExpenseBreakdown(Object.entries(merged).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value: Math.round(value) })))

    const { data: dailyData } = await supabase.from('branch_revenue').select('branch_id, date, amount')
      .in('branch_id', BRANCHES.map(b => b.id)).gte('date', from).lt('date', to)
      .order('date')
    if (dailyData) {
      const byDate: Record<string, Record<string, number>> = {}
      for (const r of dailyData) {
        if (!byDate[r.date]) byDate[r.date] = {}
        const brName = BRANCHES.find(b => b.id === r.branch_id)?.name || ''
        byDate[r.date][brName] = (byDate[r.date][brName] || 0) + Number(r.amount)
      }
      setDailyRevenue(Object.entries(byDate).sort().map(([date, vals]) => ({
        date: new Date(date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }),
        ...vals,
      })))
    }

    const pFrom = comparisonPeriod.from, pTo = comparisonPeriod.to
    const pm = comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)
    let pRev = 0, pExp = 0, pLab = 0, pWst = 0, pFc = 0
    for (const br of BRANCHES) {
      const { data: r } = await supabase.from('branch_revenue').select('amount').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo)
      pRev += r ? r.reduce((s, x) => s + Number(x.amount), 0) : 0
      const { data: e } = await supabase.from('branch_expenses').select('amount').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo)
      pExp += e ? e.reduce((s, x) => s + Number(x.amount), 0) : 0
      const { data: l } = await supabase.from('branch_labor').select('employer_cost').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo)
      pLab += l ? l.reduce((s, x) => s + Number(x.employer_cost), 0) : 0
      const { data: w } = await supabase.from('branch_waste').select('amount').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo)
      pWst += w ? w.reduce((s, x) => s + Number(x.amount), 0) : 0
      const { data: fc } = await supabase.from('fixed_costs').select('amount').eq('entity_type', `branch_${br.id}`).eq('month', pm)
      pFc += fc ? fc.reduce((s, x) => s + Number(x.amount), 0) : 0
    }
    const [pfSalesFs2, pfSalesB2b2, pfLabor2, pfSupp2, pfWaste2, pfRepairs2, pfFixed2, pfWd] = await Promise.all([
      supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', pFrom).lt('date', pTo),
      supabase.from('labor').select('employee_name, employer_cost').eq('entity_type', 'factory').gte('date', pFrom).lt('date', pTo),
      supabase.from('supplier_invoices').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_waste').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_repairs').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('fixed_costs').select('amount').eq('entity_type', 'factory').eq('month', pm),
      getWorkingDays(pm),
    ])
    const pfSalesTotal = (pfSalesFs2.data || []).reduce((s, r) => s + Number(r.amount), 0)
                        + (pfSalesB2b2.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const pfHourlyLabor = (pfLabor2.data || []).filter((r: any) => !globalNames.has(r.employee_name)).reduce((s, r) => s + Number(r.employer_cost), 0)
    const pfGlobalLaborCreams = calcGlobalLaborForDept(globalEmpsData, 'creams', pfWd)
    const pfGlobalLaborDough  = calcGlobalLaborForDept(globalEmpsData, 'dough', pfWd)
    const pfLaborTotal = pfHourlyLabor + pfGlobalLaborCreams + pfGlobalLaborDough
    const pfSuppTotal  = (pfSupp2.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const pfWasteTotal = (pfWaste2.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const pfRepairsTotal = (pfRepairs2.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const pfFixedTotal = (pfFixed2.data || []).reduce((s, r) => s + Number(r.amount), 0)
    const pfGross = pfSalesTotal - pfLaborTotal - pfSuppTotal
    const pfOperating = pfGross - pfFixedTotal - pfWasteTotal - pfRepairsTotal

    const prevGross = pRev - pLab - pExp
    setPrevTotalRev(pRev + pfSalesTotal)
    setPrevTotalGross(prevGross + pfGross)
    setPrevTotalOperating((prevGross - pFc - pWst) + pfOperating)

    setLoading(false)
  }

  useEffect(() => { fetchData() }, [from, to])

  const totalRevenue    = branches.reduce((s, b) => s + b.revenue, 0)
  const totalExpenses   = branches.reduce((s, b) => s + b.expenses, 0)
  const totalLabor      = branches.reduce((s, b) => s + b.labor, 0)
  const totalWaste      = branches.reduce((s, b) => s + b.waste, 0)
  const totalFixed      = branches.reduce((s, b) => s + b.fixedCosts, 0)
  const totalGross      = branches.reduce((s, b) => s + b.grossProfit, 0)
  const totalOperating  = branches.reduce((s, b) => s + b.operatingProfit, 0)

  const factoryGrossProfit     = factorySales - factoryLabor - factorySuppliers
  const factoryOperatingProfit = factoryGrossProfit - factoryFixed - factoryWaste - factoryRepairs

  const grandRevenue   = totalRevenue + factorySales
  const grandLabor     = totalLabor + factoryLabor
  const grandGross     = totalGross + factoryGrossProfit
  const grandOperating = totalOperating + factoryOperatingProfit
  const grandLaborPct  = grandRevenue > 0 ? (grandLabor / grandRevenue) * 100 : 0

  const barData = [
    ...branches.map(b => ({
      name: b.name,
      הכנסות: Math.round(b.revenue),
      הוצאות: Math.round(b.expenses + b.labor + b.waste + b.fixedCosts),
      'רווח תפעולי': Math.round(b.operatingProfit),
    })),
    {
      name: 'מפעל',
      הכנסות: Math.round(factorySales),
      הוצאות: Math.round(factoryLabor + factorySuppliers + factoryWaste + factoryRepairs + factoryFixed),
      'רווח תפעולי': Math.round(factoryOperatingProfit),
    },
  ]

  const ranked = [...branches].sort((a, b) => b.operatingProfit - a.operatingProfit)

  function DiffBadge({ current, previous }: { current: number; previous: number }) {
    if (previous === 0 && current === 0) return <Minus size={12} className="text-slate-400" />
    if (previous === 0) return <TrendingUp size={12} className="text-emerald-400" />
    const pct = ((current - previous) / Math.abs(previous)) * 100
    const isUp = pct > 0
    return (
      <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
        {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {Math.abs(pct).toFixed(1)}%
      </span>
    )
  }

  // KPI card with hover + colored right border (appears on visual left in RTL)
  function KpiCard({ icon, label, numericValue, prefix = '₪', suffix = '', decimals = 0, valueColor, diff, borderColor }: {
    icon: React.ReactNode; label: string; numericValue: number; prefix?: string; suffix?: string; decimals?: number
    valueColor?: string; diff?: React.ReactNode; borderColor: string
  }) {
    return (
      <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: borderColor }}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            {icon}
            <span className="text-xs font-semibold text-slate-500">{label}</span>
          </div>
          <div className="text-2xl font-extrabold" style={{ color: valueColor || '#0f172a' }}>
            <CountUp end={numericValue} duration={1.5} separator="," prefix={prefix} suffix={suffix} decimals={decimals} />
          </div>
          {diff}
        </CardContent>
      </Card>
    )
  }

  function KpiCardSm({ icon, label, numericValue, prefix = '₪', suffix = '', decimals = 0, valueColor, borderColor }: {
    icon: React.ReactNode; label: string; numericValue: number; prefix?: string; suffix?: string; decimals?: number
    valueColor?: string; borderColor: string
  }) {
    return (
      <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: borderColor }}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1.5">
            {icon}
            <span className="text-[11px] font-semibold text-slate-500">{label}</span>
          </div>
          <div className="text-xl font-extrabold" style={{ color: valueColor || '#0f172a' }}>
            <CountUp end={numericValue} duration={1.5} separator="," prefix={prefix} suffix={suffix} decimals={decimals} />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
          <Trophy size={20} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 m-0">דשבורד מנכ"ל</h1>
          <p className="text-[13px] text-slate-400 m-0">מבט רשתי · מפעל + סניפים · {period.label}</p>
        </div>
        <div className="mr-auto">
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>

        {loading ? (
          <div className="text-center py-16 text-slate-400">טוען נתונים...</div>
        ) : (
          <>
            {/* KPI cards — Row 1 */}
            <motion.div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3.5 mb-6" variants={staggerContainer} initial="hidden" animate="visible">
              <motion.div variants={fadeUp}>
                <KpiCard
                  icon={<Store size={16} className="text-indigo-400" />}
                  label="סה&quot;כ הכנסות"
                  numericValue={Math.round(grandRevenue)}
                  borderColor="#818cf8"
                  diff={<DiffBadge current={grandRevenue} previous={prevTotalRev} />}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <KpiCard
                  icon={<DollarSign size={16} style={{ color: grandGross >= 0 ? '#34d399' : '#fb7185' }} />}
                  label="רווח גולמי"
                  numericValue={Math.round(grandGross)}
                  valueColor={grandGross >= 0 ? '#059669' : '#e11d48'}
                  borderColor={grandGross >= 0 ? '#34d399' : '#fb7185'}
                  diff={<DiffBadge current={grandGross} previous={prevTotalGross} />}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <KpiCard
                  icon={<BarChart3 size={16} style={{ color: grandOperating >= 0 ? '#34d399' : '#fb7185' }} />}
                  label="רווח תפעולי"
                  numericValue={Math.round(grandOperating)}
                  valueColor={grandOperating >= 0 ? '#059669' : '#e11d48'}
                  borderColor={grandOperating >= 0 ? '#34d399' : '#fb7185'}
                  diff={<DiffBadge current={grandOperating} previous={prevTotalOperating} />}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <KpiCard
                  icon={<Users size={16} className="text-amber-400" />}
                  label="% לייבור כולל"
                  numericValue={grandLaborPct}
                  prefix=""
                  suffix="%"
                  decimals={1}
                  valueColor={grandLaborPct <= avgLaborTarget ? '#059669' : '#e11d48'}
                  borderColor="#fbbf24"
                  diff={<span className="text-xs text-slate-400">יעד {avgLaborTarget.toFixed(0)}%</span>}
                />
              </motion.div>
            </motion.div>

            {/* KPI cards — Row 2 */}
            <motion.div className="grid grid-cols-[repeat(auto-fill,minmax(155px,1fr))] gap-3.5 mb-6" variants={staggerContainer} initial="hidden" animate="visible">
              <motion.div variants={fadeUp}><KpiCardSm icon={<Building2 size={15} className="text-slate-400" />} label='סה"כ עלויות קבועות' numericValue={Math.round(totalFixed + factoryFixed)} borderColor="#94a3b8" /></motion.div>
              <motion.div variants={fadeUp}><KpiCardSm icon={<Users size={15} className="text-amber-400" />} label='סה"כ לייבור' numericValue={Math.round(grandLabor)} borderColor="#fbbf24" /></motion.div>
              <motion.div variants={fadeUp}><KpiCardSm icon={<Truck size={15} className="text-rose-400" />} label='סה"כ ספקים' numericValue={Math.round(factorySuppliers + branchSuppliers)} borderColor="#fb7185" /></motion.div>
              <motion.div variants={fadeUp}><KpiCardSm icon={<Receipt size={15} className="text-indigo-400" />} label="הכנסות קופה" numericValue={Math.round(revCashier)} borderColor="#818cf8" /></motion.div>
              <motion.div variants={fadeUp}><KpiCardSm icon={<CreditCard size={15} className="text-amber-400" />} label="הכנסות הקפה" numericValue={Math.round(revCredit + factoryB2b)} borderColor="#fbbf24" /></motion.div>
              <motion.div variants={fadeUp}><KpiCardSm icon={<Globe size={15} className="text-violet-400" />} label="הכנסות אתר" numericValue={Math.round(revWebsite)} borderColor="#c084fc" /></motion.div>
              <motion.div variants={fadeUp}>
                <KpiCardSm
                  icon={<TrendingUp size={15} className="text-emerald-400" />}
                  label='סה"כ הכנסות כולל'
                  numericValue={Math.round(revCashier + revCredit + factoryB2b + revWebsite)}
                  valueColor="#059669"
                  borderColor="#34d399"
                />
              </motion.div>
            </motion.div>

            {/* Revenue breakdown cards */}
            <motion.div className="grid grid-cols-3 gap-3.5 mb-6" variants={staggerContainer} initial="hidden" animate="visible">
              <motion.div variants={fadeUp}>
                <Card className="shadow-sm hover:shadow-md transition-all duration-200 border-t-[3px] border-t-indigo-400 h-full">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Receipt size={16} className="text-indigo-400" />
                      <span className="text-xs font-semibold text-slate-500">קופות סניפים</span>
                    </div>
                    <div className="text-[22px] font-extrabold text-slate-900">
                      <CountUp end={Math.round(revCashier)} duration={1.5} separator="," prefix="₪" />
                    </div>
                    {grandRevenue > 0 && <span className="text-xs text-slate-400">{((revCashier / grandRevenue) * 100).toFixed(1)}% מסה"כ הכנסות</span>}
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={fadeUp}>
                <Card className="shadow-sm hover:shadow-md transition-all duration-200 border-t-[3px] border-t-amber-400 h-full">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CreditCard size={16} className="text-amber-400" />
                      <span className="text-xs font-semibold text-slate-500">הקפה (סניפים + B2B מפעל)</span>
                    </div>
                    <div className="text-[22px] font-extrabold text-slate-900">
                      <CountUp end={Math.round(revCredit + factoryB2b)} duration={1.5} separator="," prefix="₪" />
                    </div>
                    <div className="flex gap-3 mt-1">
                      <span className="text-[11px] text-slate-400">סניפים: {fmtN(revCredit)}</span>
                      <span className="text-[11px] text-slate-400">B2B: {fmtN(factoryB2b)}</span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={fadeUp}>
                <Card className="shadow-sm hover:shadow-md transition-all duration-200 border-t-[3px] border-t-violet-400 h-full">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe size={16} className="text-violet-400" />
                      <span className="text-xs font-semibold text-slate-500">הכנסות מהאתר</span>
                    </div>
                    <div className="text-[22px] font-extrabold text-slate-900">
                      <CountUp end={Math.round(revWebsite)} duration={1.5} separator="," prefix="₪" />
                    </div>
                    {grandRevenue > 0 && <span className="text-xs text-slate-400">{((revWebsite / grandRevenue) * 100).toFixed(1)}% מסה"כ הכנסות</span>}
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>

            {/* Charts row */}
            <motion.div className="grid grid-cols-2 gap-5 mb-6" variants={fadeIn} initial="hidden" animate="visible">
              {/* Bar chart */}
              <Card className="shadow-sm">
                <CardHeader className="pb-0">
                  <CardTitle className="text-sm font-bold text-slate-700">הכנסות/הוצאות לפי יחידה</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={barData} barGap={4}>
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `₪${(v / 1000).toFixed(0)}K`} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9', radius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="הכנסות" fill={CHART_INDIGO} radius={[8, 8, 0, 0]} />
                      <Bar dataKey="הוצאות" fill={CHART_ROSE} radius={[8, 8, 0, 0]} />
                      <Bar dataKey="רווח תפעולי" radius={[8, 8, 0, 0]}>
                        {barData.map((entry, index) => (
                          <Cell key={index} fill={entry['רווח תפעולי'] >= 0 ? CHART_EMERALD : CHART_ROSE} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Pie chart */}
              <Card className="shadow-sm">
                <CardHeader className="pb-0">
                  <CardTitle className="text-sm font-bold text-slate-700">התפלגות הוצאות</CardTitle>
                </CardHeader>
                <CardContent>
                  {expenseBreakdown.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={expenseBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={40} paddingAngle={2} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: '11px' }}>
                          {expenseBreakdown.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-slate-400">אין נתונים</div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Area chart — daily revenue with gradient fill */}
            {dailyRevenue.length > 0 && (
              <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <Card className="shadow-sm mb-6">
                <CardHeader className="pb-0">
                  <CardTitle className="text-sm font-bold text-slate-700">הכנסות יומיות לפי סניף</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={dailyRevenue}>
                      <defs>
                        {BRANCHES.map(br => (
                          <linearGradient key={br.id} id={`grad-${br.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={br.color} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={br.color} stopOpacity={0.02} />
                          </linearGradient>
                        ))}
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `₪${(v / 1000).toFixed(0)}K`} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      {BRANCHES.map(br => (
                        <Area key={br.id} type="monotone" dataKey={br.name} stroke={br.color} strokeWidth={2.5} fill={`url(#grad-${br.id})`} dot={{ r: 3, fill: 'white', stroke: br.color, strokeWidth: 2 }} activeDot={{ r: 5, fill: br.color, stroke: 'white', strokeWidth: 2 }} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              </motion.div>
            )}

            {/* Ranking table */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm mb-6">
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-bold text-slate-700">דירוג יחידות לפי רווחיות</CardTitle>
              </CardHeader>
              <CardContent className="table-scroll">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                      <TableHead className="w-10 text-[11px] font-bold text-slate-500">#</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">יחידה</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">הכנסות</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">הוצאות</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">לייבור</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500 text-center">% לייבור</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">רווח גולמי</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">רווח תפעולי</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const fLabPct = factorySales > 0 ? (factoryLabor / factorySales) * 100 : 0
                      const fExpenses = factoryLabor + factorySuppliers
                      return (
                        <TableRow className="bg-indigo-50/50 hover:bg-indigo-50 border-b-2 border-indigo-200">
                          <TableCell className="text-sm">🏭</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <div className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
                              <span className="text-sm font-bold text-slate-700">מפעל</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-[13px] font-semibold text-slate-700">{fmtN(factorySales)}</TableCell>
                          <TableCell className="text-[13px] text-rose-500">{fmtN(fExpenses)}</TableCell>
                          <TableCell className="text-[13px] text-amber-500">{fmtN(factoryLabor)}</TableCell>
                          <TableCell className="text-center">
                            <span className={`text-xs font-bold ${fLabPct <= avgLaborTarget ? 'text-emerald-500' : 'text-rose-500'}`}>{fLabPct.toFixed(1)}%</span>
                          </TableCell>
                          <TableCell>
                            <span className={`text-[13px] font-bold ${factoryGrossProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(factoryGrossProfit)}</span>
                          </TableCell>
                          <TableCell>
                            <span className={`text-sm font-extrabold ${factoryOperatingProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(factoryOperatingProfit)}</span>
                          </TableCell>
                        </TableRow>
                      )
                    })()}

                    {ranked.map((br, i) => {
                      const labPct = br.revenue > 0 ? (br.labor / br.revenue) * 100 : 0
                      return (
                        <TableRow key={br.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                          <TableCell>
                            <span className="text-base font-extrabold" style={{ color: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : '#cd7f32' }}>
                              {i + 1}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ background: br.color }} />
                              <span className="text-sm font-semibold text-slate-700">{br.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-[13px] font-semibold text-slate-700">{fmtN(br.revenue)}</TableCell>
                          <TableCell className="text-[13px] text-rose-500">{fmtN(br.expenses + br.labor)}</TableCell>
                          <TableCell className="text-[13px] text-amber-500">{fmtN(br.labor)}</TableCell>
                          <TableCell className="text-center">
                            <span className={`text-xs font-bold ${labPct <= avgLaborTarget ? 'text-emerald-500' : 'text-rose-500'}`}>{labPct.toFixed(1)}%</span>
                          </TableCell>
                          <TableCell>
                            <span className={`text-[13px] font-bold ${br.grossProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(br.grossProfit)}</span>
                          </TableCell>
                          <TableCell>
                            <span className={`text-sm font-extrabold ${br.operatingProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(br.operatingProfit)}</span>
                          </TableCell>
                        </TableRow>
                      )
                    })}

                    <TableRow className="bg-amber-50 hover:bg-amber-100 border-t-2 border-amber-200 font-bold">
                      <TableCell />
                      <TableCell className="text-sm text-slate-700">סה"כ כולל</TableCell>
                      <TableCell className="text-[13px] text-slate-700">{fmtN(grandRevenue)}</TableCell>
                      <TableCell className="text-[13px] text-rose-500">{fmtN(totalExpenses + totalLabor + factoryLabor + factorySuppliers)}</TableCell>
                      <TableCell className="text-[13px] text-amber-500">{fmtN(grandLabor)}</TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs ${grandLaborPct <= avgLaborTarget ? 'text-emerald-500' : 'text-rose-500'}`}>{grandLaborPct.toFixed(1)}%</span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-[13px] font-bold ${grandGross >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(grandGross)}</span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-sm font-extrabold ${grandOperating >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(grandOperating)}</span>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            </motion.div>

            {/* Revenue breakdown table */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-bold text-slate-700">פירוק הכנסות לפי סניף</CardTitle>
              </CardHeader>
              <CardContent className="table-scroll">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                      <TableHead className="text-[11px] font-bold text-slate-500">סניף</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">הכנסות קופה</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">הכנסות הקפה</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">הכנסות אתר</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">סה"כ הכנסות</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">לייבור</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">עלויות קבועות</TableHead>
                      <TableHead className="text-[11px] font-bold text-slate-500">רווח תפעולי</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {branches.map((br, i) => (
                      <TableRow key={br.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: br.color }} />
                            <span className="text-sm font-semibold text-slate-700">{br.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-[13px] text-slate-700">{fmtN(br.revCashier)}</TableCell>
                        <TableCell className="text-[13px] text-slate-700">{fmtN(br.revCredit)}</TableCell>
                        <TableCell className="text-[13px] text-slate-700">{fmtN(br.revWebsite)}</TableCell>
                        <TableCell className="text-[13px] font-bold text-slate-700">{fmtN(br.revenue)}</TableCell>
                        <TableCell className="text-[13px] text-amber-500">{fmtN(br.labor)}</TableCell>
                        <TableCell className="text-[13px] text-slate-500">{fmtN(br.fixedCosts)}</TableCell>
                        <TableCell>
                          <span className={`text-sm font-extrabold ${br.operatingProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(br.operatingProfit)}</span>
                        </TableCell>
                      </TableRow>
                    ))}

                    <TableRow className="bg-amber-50 hover:bg-amber-100 border-t-2 border-amber-200 font-bold">
                      <TableCell className="text-sm text-slate-700">סה"כ כולל</TableCell>
                      <TableCell className="text-[13px] text-slate-700">{fmtN(revCashier)}</TableCell>
                      <TableCell className="text-[13px] text-slate-700">{fmtN(revCredit + factoryB2b)}</TableCell>
                      <TableCell className="text-[13px] text-slate-700">{fmtN(revWebsite)}</TableCell>
                      <TableCell className="text-[13px] font-extrabold text-slate-700">{fmtN(grandRevenue)}</TableCell>
                      <TableCell className="text-[13px] text-amber-500">{fmtN(grandLabor)}</TableCell>
                      <TableCell className="text-[13px] text-slate-500">{fmtN(totalFixed + factoryFixed)}</TableCell>
                      <TableCell>
                        <span className={`text-sm font-extrabold ${grandOperating >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(grandOperating)}</span>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
