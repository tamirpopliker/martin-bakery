import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept } from '../lib/supabase'
import { ArrowRight, TrendingUp, TrendingDown, Minus, Receipt, Globe, CreditCard, Truck } from 'lucide-react'
import { RevenueIcon, ProfitIcon, LaborIcon, FixedCostIcon, TrophyIcon } from '@/components/icons'
import { BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { usePeriod } from '../lib/PeriodContext'
import { useBranches } from '../lib/BranchContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

interface Props { onBack: () => void }

type KpiSheetType =
  | 'revenue_total' | 'gross_profit' | 'operating_profit' | 'labor_pct_total'
  | 'fixed_costs' | 'labor_total' | 'suppliers_total'
  | 'rev_cashier' | 'rev_credit' | 'rev_website' | 'rev_all_channels'


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
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } }
}
const fadeIn = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } }
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
  const { branches: BRANCHES } = useBranches()
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

  // Sheet (drawer) state
  const [sheetType, setSheetType] = useState<KpiSheetType | null>(null)
  const sheetOpen = sheetType !== null

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
    {
      name: 'סה"כ',
      הכנסות: Math.round(grandRevenue),
      הוצאות: Math.round(totalExpenses + totalLabor + totalWaste + totalFixed + factoryLabor + factorySuppliers + factoryWaste + factoryRepairs + factoryFixed),
      'רווח תפעולי': Math.round(grandOperating),
    },
  ]

  const ranked = [...branches].sort((a, b) => b.operatingProfit - a.operatingProfit)

  // ─── KPI Sheet metadata & content renderers ──────────────────────────────
  const KPI_META: Record<KpiSheetType, { title: string; icon: React.ReactNode; iconBg: string }> = {
    revenue_total:    { title: 'סה"כ הכנסות',        icon: <RevenueIcon size={18} color="#10B981" />,   iconBg: '#10B981' },
    gross_profit:     { title: 'רווח גולמי',         icon: <ProfitIcon size={18} color="#7C3AED" />,    iconBg: '#7C3AED' },
    operating_profit: { title: 'רווח תפעולי',        icon: <ProfitIcon size={18} color="#7C3AED" />,    iconBg: '#7C3AED' },
    labor_pct_total:  { title: '% לייבור כולל',      icon: <LaborIcon size={18} color="#3B82F6" />,     iconBg: '#3B82F6' },
    fixed_costs:      { title: 'סה"כ עלויות קבועות', icon: <FixedCostIcon size={18} color="#3B82F6" />, iconBg: '#3B82F6' },
    labor_total:      { title: 'סה"כ לייבור',        icon: <LaborIcon size={18} color="#3B82F6" />,     iconBg: '#3B82F6' },
    suppliers_total:  { title: 'סה"כ ספקים',         icon: <Truck size={18} className="text-rose-400" />, iconBg: '#fb7185' },
    rev_cashier:      { title: 'הכנסות קופה',        icon: <Receipt size={18} className="text-indigo-400" />, iconBg: '#818cf8' },
    rev_credit:       { title: 'הכנסות הקפה',        icon: <CreditCard size={18} className="text-amber-400" />, iconBg: '#fbbf24' },
    rev_website:      { title: 'הכנסות אתר',         icon: <Globe size={18} className="text-violet-400" />, iconBg: '#c084fc' },
    rev_all_channels: { title: 'סה"כ הכנסות כולל',   icon: <TrendingUp size={18} className="text-emerald-400" />, iconBg: '#34d399' },
  }

  function renderRevenueTable(getValue: (br: BranchData) => number, factoryValue: number, total: number) {
    return (
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="text-xs font-bold text-slate-500">סניף</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">סכום</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">% מסה"כ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((br, i) => {
            const val = getValue(br)
            const pct = total > 0 ? (val / total) * 100 : 0
            return (
              <TableRow key={br.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: br.color }} />
                    <span className="text-sm font-semibold text-slate-700">{br.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm font-semibold text-slate-700">{fmtN(val)}</TableCell>
                <TableCell className="text-sm text-slate-500">{pct.toFixed(1)}%</TableCell>
              </TableRow>
            )
          })}
          <TableRow className="bg-indigo-50/50">
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-indigo-400" />
                <span className="text-sm font-semibold text-slate-700">מפעל</span>
              </div>
            </TableCell>
            <TableCell className="text-sm font-semibold text-slate-700">{fmtN(factoryValue)}</TableCell>
            <TableCell className="text-sm text-slate-500">{total > 0 ? ((factoryValue / total) * 100).toFixed(1) : '0.0'}%</TableCell>
          </TableRow>
          <TableRow className="bg-amber-50 border-t-2 border-amber-200">
            <TableCell className="text-sm font-bold text-slate-800">סה"כ</TableCell>
            <TableCell className="text-sm font-extrabold text-slate-900">{fmtN(total)}</TableCell>
            <TableCell className="text-sm font-bold text-slate-500">100%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  function renderLaborTable() {
    const factoryLaborPct = factorySales > 0 ? (factoryLabor / factorySales) * 100 : 0
    return (
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="text-xs font-bold text-slate-500">יחידה</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">סכום לייבור</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">% מהכנסות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((br, i) => {
            const pct = br.revenue > 0 ? (br.labor / br.revenue) * 100 : 0
            const overTarget = pct > avgLaborTarget
            return (
              <TableRow key={br.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: br.color }} />
                    <span className="text-sm font-semibold text-slate-700">{br.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm font-semibold text-slate-700">{fmtN(br.labor)}</TableCell>
                <TableCell className={`text-sm font-semibold ${overTarget ? 'text-rose-500' : 'text-emerald-500'}`}>{pct.toFixed(1)}%</TableCell>
              </TableRow>
            )
          })}
          <TableRow className="bg-indigo-50/50">
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-indigo-400" />
                <span className="text-sm font-semibold text-slate-700">מפעל</span>
              </div>
            </TableCell>
            <TableCell className="text-sm font-semibold text-slate-700">{fmtN(factoryLabor)}</TableCell>
            <TableCell className={`text-sm font-semibold ${factoryLaborPct > avgLaborTarget ? 'text-rose-500' : 'text-emerald-500'}`}>{factoryLaborPct.toFixed(1)}%</TableCell>
          </TableRow>
          <TableRow className="bg-amber-50 border-t-2 border-amber-200">
            <TableCell className="text-sm font-bold text-slate-800">סה"כ</TableCell>
            <TableCell className="text-sm font-extrabold text-slate-900">{fmtN(grandLabor)}</TableCell>
            <TableCell className={`text-sm font-bold ${grandLaborPct > avgLaborTarget ? 'text-rose-500' : 'text-emerald-500'}`}>{grandLaborPct.toFixed(1)}%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  function renderProfitTable(mode: 'gross' | 'operating') {
    const rows = branches.map(br => {
      const rev = br.revenue
      const exp = mode === 'gross'
        ? br.labor + br.expenses
        : br.labor + br.expenses + br.fixedCosts + br.waste
      const profit = mode === 'gross' ? br.grossProfit : br.operatingProfit
      const pct = rev > 0 ? (profit / rev) * 100 : 0
      return { name: br.name, color: br.color, rev, exp, profit, pct }
    })
    const factoryExp = mode === 'gross'
      ? factoryLabor + factorySuppliers
      : factoryLabor + factorySuppliers + factoryFixed + factoryWaste + factoryRepairs
    const factoryProfit = mode === 'gross' ? factoryGrossProfit : factoryOperatingProfit
    const factoryPct = factorySales > 0 ? (factoryProfit / factorySales) * 100 : 0
    const totalProfit = mode === 'gross' ? grandGross : grandOperating
    const totalExp = rows.reduce((s, r) => s + r.exp, 0) + factoryExp
    const totalPct = grandRevenue > 0 ? (totalProfit / grandRevenue) * 100 : 0

    return (
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="text-xs font-bold text-slate-500">יחידה</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">הכנסות</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">הוצאות</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">רווח</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.name} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                  <span className="text-sm font-semibold text-slate-700">{r.name}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-slate-600">{fmtN(r.rev)}</TableCell>
              <TableCell className="text-sm text-slate-600">{fmtN(r.exp)}</TableCell>
              <TableCell className={`text-sm font-bold ${r.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(r.profit)}</TableCell>
              <TableCell className={`text-sm font-semibold ${r.pct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{r.pct.toFixed(1)}%</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-indigo-50/50">
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-indigo-400" />
                <span className="text-sm font-semibold text-slate-700">מפעל</span>
              </div>
            </TableCell>
            <TableCell className="text-sm text-slate-600">{fmtN(factorySales)}</TableCell>
            <TableCell className="text-sm text-slate-600">{fmtN(factoryExp)}</TableCell>
            <TableCell className={`text-sm font-bold ${factoryProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(factoryProfit)}</TableCell>
            <TableCell className={`text-sm font-semibold ${factoryPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{factoryPct.toFixed(1)}%</TableCell>
          </TableRow>
          <TableRow className="bg-amber-50 border-t-2 border-amber-200">
            <TableCell className="text-sm font-bold text-slate-800">סה"כ</TableCell>
            <TableCell className="text-sm font-bold text-slate-700">{fmtN(grandRevenue)}</TableCell>
            <TableCell className="text-sm font-bold text-slate-700">{fmtN(totalExp)}</TableCell>
            <TableCell className={`text-sm font-extrabold ${totalProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtN(totalProfit)}</TableCell>
            <TableCell className={`text-sm font-bold ${totalPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{totalPct.toFixed(1)}%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  function renderFixedCostsTable() {
    const total = totalFixed + factoryFixed
    return (
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="text-xs font-bold text-slate-500">יחידה</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">עלויות קבועות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((br, i) => (
            <TableRow key={br.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: br.color }} />
                  <span className="text-sm font-semibold text-slate-700">{br.name}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm font-semibold text-slate-700">{fmtN(br.fixedCosts)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-indigo-50/50">
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-indigo-400" />
                <span className="text-sm font-semibold text-slate-700">מפעל</span>
              </div>
            </TableCell>
            <TableCell className="text-sm font-semibold text-slate-700">{fmtN(factoryFixed)}</TableCell>
          </TableRow>
          <TableRow className="bg-amber-50 border-t-2 border-amber-200">
            <TableCell className="text-sm font-bold text-slate-800">סה"כ</TableCell>
            <TableCell className="text-sm font-extrabold text-slate-900">{fmtN(total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  function renderSuppliersTable() {
    const total = factorySuppliers + branchSuppliers
    return (
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="text-xs font-bold text-slate-500">יחידה</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">סכום ספקים</TableHead>
            <TableHead className="text-xs font-bold text-slate-500">% מסה"כ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-white">
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-indigo-400" />
                <span className="text-sm font-semibold text-slate-700">מפעל</span>
              </div>
            </TableCell>
            <TableCell className="text-sm font-semibold text-slate-700">{fmtN(factorySuppliers)}</TableCell>
            <TableCell className="text-sm text-slate-500">{total > 0 ? ((factorySuppliers / total) * 100).toFixed(1) : '0.0'}%</TableCell>
          </TableRow>
          <TableRow className="bg-slate-50/50">
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-400" />
                <span className="text-sm font-semibold text-slate-700">כלל הסניפים</span>
              </div>
            </TableCell>
            <TableCell className="text-sm font-semibold text-slate-700">{fmtN(branchSuppliers)}</TableCell>
            <TableCell className="text-sm text-slate-500">{total > 0 ? ((branchSuppliers / total) * 100).toFixed(1) : '0.0'}%</TableCell>
          </TableRow>
          <TableRow className="bg-amber-50 border-t-2 border-amber-200">
            <TableCell className="text-sm font-bold text-slate-800">סה"כ</TableCell>
            <TableCell className="text-sm font-extrabold text-slate-900">{fmtN(total)}</TableCell>
            <TableCell className="text-sm font-bold text-slate-500">100%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  function renderSheetContent(): React.ReactNode {
    if (!sheetType) return null
    switch (sheetType) {
      case 'revenue_total':    return renderRevenueTable(br => br.revenue, factorySales, grandRevenue)
      case 'rev_cashier':      return renderRevenueTable(br => br.revCashier, 0, revCashier)
      case 'rev_credit':       return renderRevenueTable(br => br.revCredit, factoryB2b, revCredit + factoryB2b)
      case 'rev_website':      return renderRevenueTable(br => br.revWebsite, 0, revWebsite)
      case 'rev_all_channels': return renderRevenueTable(br => br.revCashier + br.revCredit + br.revWebsite, factoryB2b, revCashier + revCredit + factoryB2b + revWebsite)
      case 'labor_total':      return renderLaborTable()
      case 'gross_profit':     return renderProfitTable('gross')
      case 'operating_profit': return renderProfitTable('operating')
      case 'labor_pct_total':  return renderProfitTable('operating')
      case 'fixed_costs':      return renderFixedCostsTable()
      case 'suppliers_total':  return renderSuppliersTable()
    }
  }

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
  function KpiCard({ icon, label, numericValue, prefix = '₪', suffix = '', decimals = 0, valueColor, diff, borderColor, iconBg, onClick }: {
    icon: React.ReactNode; label: string; numericValue: number; prefix?: string; suffix?: string; decimals?: number
    valueColor?: string; diff?: React.ReactNode; borderColor: string; iconBg?: string; onClick?: () => void
  }) {
    return (
      <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer border-r-4 overflow-hidden" style={{ borderRightColor: borderColor }} onClick={onClick}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            {iconBg ? (
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${iconBg}15` }}>
                {icon}
              </div>
            ) : icon}
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

  function KpiCardSm({ icon, label, numericValue, prefix = '₪', suffix = '', decimals = 0, valueColor, borderColor, iconBg, onClick }: {
    icon: React.ReactNode; label: string; numericValue: number; prefix?: string; suffix?: string; decimals?: number
    valueColor?: string; borderColor: string; iconBg?: string; onClick?: () => void
  }) {
    return (
      <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer border-r-4 overflow-hidden" style={{ borderRightColor: borderColor }} onClick={onClick}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1.5">
            {iconBg ? (
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: `${iconBg}15` }}>
                {icon}
              </div>
            ) : icon}
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
          <TrophyIcon size={20} color="#f59e0b" />
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
            {/* ═══ ROW 1: 4 Golden KPIs ═══ */}
            <motion.div className="grid grid-cols-4 gap-2.5 mb-2.5" variants={staggerContainer} initial="hidden" animate="visible">
              <motion.div variants={fadeUp}>
                <Card className="shadow-sm cursor-pointer hover:shadow-md transition-all" onClick={() => setSheetType('revenue_total')}>
                  <CardContent className="p-4">
                    <span className="text-[11px] font-semibold text-slate-400">הכנסות כוללות</span>
                    <div className="text-[22px] font-medium text-slate-900 mt-1">
                      <CountUp end={Math.round(grandRevenue)} duration={1.5} separator="," prefix="₪" />
                    </div>
                    <DiffBadge current={grandRevenue} previous={prevTotalRev} />
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div variants={fadeUp}>
                <Card className="shadow-sm cursor-pointer hover:shadow-md transition-all" onClick={() => setSheetType('gross_profit')}>
                  <CardContent className="p-4">
                    <span className="text-[11px] font-semibold text-slate-400">רווח גולמי</span>
                    <div className="text-[22px] font-medium mt-1" style={{ color: grandGross >= 0 ? '#639922' : '#E24B4A' }}>
                      <CountUp end={Math.round(grandGross)} duration={1.5} separator="," prefix="₪" />
                    </div>
                    <span className="text-[11px] text-slate-400">{grandRevenue > 0 ? ((grandGross / grandRevenue) * 100).toFixed(1) : '0.0'}% מהכנסות</span>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div variants={fadeUp}>
                <Card className="shadow-sm cursor-pointer hover:shadow-md transition-all" onClick={() => setSheetType('operating_profit')}>
                  <CardContent className="p-4">
                    <span className="text-[11px] font-semibold text-slate-400">רווח תפעולי</span>
                    <div className="text-[22px] font-medium mt-1" style={{ color: grandOperating >= 0 ? '#639922' : '#E24B4A' }}>
                      <CountUp end={Math.round(grandOperating)} duration={1.5} separator="," prefix="₪" />
                    </div>
                    <span className="text-[11px] text-slate-400">{grandRevenue > 0 ? ((grandOperating / grandRevenue) * 100).toFixed(1) : '0.0'}% מהכנסות</span>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div variants={fadeUp}>
                <Card className="shadow-sm cursor-pointer hover:shadow-md transition-all" onClick={() => setSheetType('labor_pct_total')}>
                  <CardContent className="p-4">
                    <span className="text-[11px] font-semibold text-slate-400">% לייבור כולל</span>
                    <div className="text-[22px] font-medium mt-1" style={{ color: grandLaborPct <= avgLaborTarget ? '#639922' : '#E24B4A' }}>
                      <CountUp end={grandLaborPct} duration={1.5} separator="," suffix="%" decimals={1} />
                    </div>
                    <span className="text-[11px] text-slate-400">יעד {avgLaborTarget.toFixed(0)}%</span>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>

            {/* ═══ ROW 2: Revenue Breakdown | Expense Breakdown ═══ */}
            <motion.div className="grid grid-cols-2 gap-2.5 mb-2.5" variants={fadeIn} initial="hidden" animate="visible">
              {/* Revenue breakdown */}
              <Card className="shadow-sm">
                <CardContent className="p-4">
                  <span className="text-[13px] font-bold text-slate-700 block mb-3">פירוט הכנסות</span>
                  {(() => {
                    const items = [
                      { label: 'קופה', value: revCashier, sheet: 'rev_cashier' as KpiSheetType },
                      { label: 'הקפה / B2B', value: revCredit + factoryB2b, sheet: 'rev_credit' as KpiSheetType },
                      { label: 'אתר', value: revWebsite, sheet: 'rev_website' as KpiSheetType },
                    ]
                    const maxVal = Math.max(...items.map(i => i.value), 1)
                    return items.map(item => (
                      <div key={item.label} className="mb-3 cursor-pointer" onClick={() => setSheetType(item.sheet)}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[12px] text-slate-600">{item.label}</span>
                          <span className="text-[12px] font-bold text-slate-700">{fmtN(item.value)}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(item.value / maxVal) * 100}%`, background: '#534AB7' }} />
                        </div>
                      </div>
                    ))
                  })()}
                </CardContent>
              </Card>

              {/* Expense breakdown */}
              <Card className="shadow-sm">
                <CardContent className="p-4">
                  <span className="text-[13px] font-bold text-slate-700 block mb-3">פירוט הוצאות</span>
                  {(() => {
                    const items = [
                      { label: 'ספקים', value: factorySuppliers + branchSuppliers, sheet: 'suppliers_total' as KpiSheetType },
                      { label: 'לייבור', value: grandLabor, sheet: 'labor_total' as KpiSheetType },
                      { label: 'עלויות קבועות', value: totalFixed + factoryFixed, sheet: 'fixed_costs' as KpiSheetType },
                    ]
                    const maxVal = Math.max(...items.map(i => i.value), 1)
                    return items.map(item => (
                      <div key={item.label} className="mb-3 cursor-pointer" onClick={() => setSheetType(item.sheet)}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[12px] text-slate-600">{item.label}</span>
                          <span className="text-[12px] font-bold text-slate-700">{fmtN(item.value)}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(item.value / maxVal) * 100}%`, background: '#E24B4A' }} />
                        </div>
                      </div>
                    ))
                  })()}
                </CardContent>
              </Card>
            </motion.div>

            {/* ═══ ROW 3: Branch Performance ═══ */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-2.5">
              <Card className="shadow-sm">
                <CardContent className="p-4">
                  <span className="text-[13px] font-bold text-slate-700 block mb-3">ביצועי סניפים</span>
                  <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${branches.length + 1}, 1fr)` }}>
                    {branches.map(br => {
                      const opPct = br.revenue > 0 ? (br.operatingProfit / br.revenue) * 100 : 0
                      return (
                        <div key={br.id} className="bg-slate-50 rounded-lg p-3">
                          <div className="flex items-center gap-1.5 mb-2">
                            <div className="w-2 h-2 rounded-full" style={{ background: br.color }} />
                            <span className="text-[12px] font-semibold text-slate-700">{br.name}</span>
                          </div>
                          <div className="text-[15px] font-bold text-slate-900">{fmtN(br.revenue)}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">הכנסות</div>
                          <div className="mt-2 text-[15px] font-bold" style={{ color: opPct >= 0 ? '#639922' : '#E24B4A' }}>
                            {opPct.toFixed(1)}%
                          </div>
                          <div className="text-[11px] text-slate-400">רווח תפעולי</div>
                        </div>
                      )
                    })}
                    {/* Factory column */}
                    <div className="bg-indigo-50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className="w-2 h-2 rounded-full bg-indigo-400" />
                        <span className="text-[12px] font-semibold text-slate-700">מפעל</span>
                      </div>
                      <div className="text-[15px] font-bold text-slate-900">{fmtN(factorySales)}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">הכנסות</div>
                      <div className="mt-2 text-[15px] font-bold" style={{ color: factoryOperatingProfit >= 0 ? '#639922' : '#E24B4A' }}>
                        {factorySales > 0 ? ((factoryOperatingProfit / factorySales) * 100).toFixed(1) : '0.0'}%
                      </div>
                      <div className="text-[11px] text-slate-400">רווח תפעולי</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* ═══ Charts ═══ */}
            <motion.div className="grid grid-cols-2 gap-2.5 mb-2.5" variants={fadeIn} initial="hidden" animate="visible">
              <Card className="shadow-sm">
                <CardHeader className="pb-0"><CardTitle className="text-sm font-bold text-slate-700">הכנסות/הוצאות לפי יחידה</CardTitle></CardHeader>
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

              <Card className="shadow-sm">
                <CardHeader className="pb-0"><CardTitle className="text-sm font-bold text-slate-700">התפלגות הוצאות</CardTitle></CardHeader>
                <CardContent>
                  {expenseBreakdown.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={expenseBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={40} paddingAngle={2} label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: '11px' }}>
                          {expenseBreakdown.map((_, i) => (<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
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

            {/* Daily revenue area chart */}
            {dailyRevenue.length > 0 && (
              <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <Card className="shadow-sm mb-2.5">
                <CardHeader className="pb-0"><CardTitle className="text-sm font-bold text-slate-700">הכנסות יומיות לפי סניף</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
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
          </>
        )}
      </div>

      {/* ─── KPI Detail Sheet ─────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) setSheetType(null) }}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            {sheetType && (
              <>
                <SheetHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: `${KPI_META[sheetType].iconBg}15` }}>
                      {KPI_META[sheetType].icon}
                    </div>
                    <div>
                      <SheetTitle>{KPI_META[sheetType].title}</SheetTitle>
                      <SheetDescription>{period.label}</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="p-4">
                  {renderSheetContent()}
                </div>
              </>
            )}
          </SheetContent>
        </SheetPortal>
      </Sheet>
    </div>
  )
}
