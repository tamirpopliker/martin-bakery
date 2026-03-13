import { useState, useEffect } from 'react'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept } from '../lib/supabase'
import { ArrowRight, Trophy, TrendingUp, TrendingDown, Minus, DollarSign, Users, Receipt, Store, BarChart3, Globe, CreditCard, Building2, Truck } from 'lucide-react'
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'

interface Props { onBack: () => void }

const BRANCHES = [
  { id: 1, name: 'אברהם אבינו', color: '#3b82f6' },
  { id: 2, name: 'הפועלים',     color: '#10b981' },
  { id: 3, name: 'יעקב כהן',   color: '#a855f7' },
]

const PIE_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#0ea5e9', '#64748b']

interface BranchData {
  id: number; name: string; color: string
  revenue: number; expenses: number; labor: number; waste: number
  fixedCosts: number; grossProfit: number; operatingProfit: number
  revCashier: number; revCredit: number; revWebsite: number
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

    // טעינת יעדי KPI מכל הסניפים
    const { data: kpiData } = await supabase.from('branch_kpi_targets').select('labor_pct')
    if (kpiData && kpiData.length > 0) {
      const avg = kpiData.reduce((s, r) => s + Number(r.labor_pct || 28), 0) / kpiData.length
      setAvgLaborTarget(avg)
    }

    // ── נתוני מפעל ──
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
    // סינון עובדים גלובליים מלייבור כדי למנוע ספירה כפולה
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
      // revenue (with source breakdown)
      const { data: revData } = await supabase.from('branch_revenue').select('source, amount')
        .eq('branch_id', br.id).gte('date', from).lt('date', to)
      const revenue = revData ? revData.reduce((s, r) => s + Number(r.amount), 0) : 0
      // Accumulate by source (total + per-branch)
      let brCashier = 0, brCredit = 0, brWebsite = 0
      if (revData) {
        for (const r of revData) {
          const amt = Number(r.amount)
          if (r.source === 'cashier') { totalCashier += amt; brCashier += amt }
          else if (r.source === 'credit') { totalCredit += amt; brCredit += amt }
          else if (r.source === 'website') { totalWebsite += amt; brWebsite += amt }
        }
      }

      // expenses
      const { data: expData } = await supabase.from('branch_expenses').select('expense_type, amount')
        .eq('branch_id', br.id).gte('date', from).lt('date', to)
      const expenses = expData ? expData.reduce((s, r) => s + Number(r.amount), 0) : 0
      if (expData) {
        for (const r of expData) {
          const type = r.expense_type || 'other'
          totalExpByType[type] = (totalExpByType[type] || 0) + Number(r.amount)
        }
      }

      // labor
      const { data: labData } = await supabase.from('branch_labor').select('employer_cost')
        .eq('branch_id', br.id).gte('date', from).lt('date', to)
      const labor = labData ? labData.reduce((s, r) => s + Number(r.employer_cost), 0) : 0
      totalExpByType['labor'] = (totalExpByType['labor'] || 0) + labor

      // waste
      const { data: wstData } = await supabase.from('branch_waste').select('amount')
        .eq('branch_id', br.id).gte('date', from).lt('date', to)
      const waste = wstData ? wstData.reduce((s, r) => s + Number(r.amount), 0) : 0
      totalExpByType['waste'] = (totalExpByType['waste'] || 0) + waste

      // fixed costs
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

    // expense breakdown for pie
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

    // daily revenue for line chart
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

    // previous month totals
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
    // Previous month factory data
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
    // סינון עובדים גלובליים מלייבור חודש קודם
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

  // Factory profits
  const factoryGrossProfit     = factorySales - factoryLabor - factorySuppliers
  const factoryOperatingProfit = factoryGrossProfit - factoryFixed - factoryWaste - factoryRepairs

  // Grand totals (factory + branches)
  const grandRevenue   = totalRevenue + factorySales
  const grandLabor     = totalLabor + factoryLabor
  const grandGross     = totalGross + factoryGrossProfit
  const grandOperating = totalOperating + factoryOperatingProfit
  const grandLaborPct  = grandRevenue > 0 ? (grandLabor / grandRevenue) * 100 : 0

  // bar chart data — branches + factory
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

  // sorted by operating profit
  const ranked = [...branches].sort((a, b) => b.operatingProfit - a.operatingProfit)

  function DiffBadge({ current, previous }: { current: number; previous: number }) {
    if (previous === 0 && current === 0) return <Minus size={12} color="#94a3b8" />
    if (previous === 0) return <TrendingUp size={12} color="#10b981" />
    const pct = ((current - previous) / Math.abs(previous)) * 100
    const isUp = pct > 0
    const color = isUp ? '#10b981' : '#ef4444'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', fontWeight: '700', color }}>
        {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {Math.abs(pct).toFixed(1)}%
      </span>
    )
  }

  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  }

  return (
    <div style={S.page}>

      {/* כותרת */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' as const }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '40px', height: '40px', background: '#fef3c7', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Trophy size={20} color="#f59e0b" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>דשבורד מנכ"ל</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>מבט רשתי · מפעל + סניפים · {period.label}</p>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>טוען נתונים...</div>
        ) : (
          <>
            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px', marginBottom: '24px' }}>
              <div style={{ ...S.card, padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Store size={16} color="#3b82f6" />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>סה"כ הכנסות</span>
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(grandRevenue).toLocaleString()}</div>
                <DiffBadge current={grandRevenue} previous={prevTotalRev} />
              </div>

              <div style={{ ...S.card, padding: '18px', border: `2px solid ${grandGross >= 0 ? '#10b981' : '#ef4444'}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <DollarSign size={16} color={grandGross >= 0 ? '#10b981' : '#ef4444'} />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>רווח גולמי</span>
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: grandGross >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(grandGross).toLocaleString()}</div>
                <DiffBadge current={grandGross} previous={prevTotalGross} />
              </div>

              <div style={{ ...S.card, padding: '18px', border: `2px solid ${grandOperating >= 0 ? '#10b981' : '#ef4444'}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <BarChart3 size={16} color={grandOperating >= 0 ? '#10b981' : '#ef4444'} />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>רווח תפעולי</span>
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: grandOperating >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(grandOperating).toLocaleString()}</div>
                <DiffBadge current={grandOperating} previous={prevTotalOperating} />
              </div>

              <div style={{ ...S.card, padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Users size={16} color="#f59e0b" />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>% לייבור כולל</span>
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: grandLaborPct <= avgLaborTarget ? '#10b981' : '#ef4444' }}>{grandLaborPct.toFixed(1)}%</div>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>יעד {avgLaborTarget.toFixed(0)}%</span>
              </div>
            </div>

            {/* KPI cards row 2 — costs + revenue breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '14px', marginBottom: '24px' }}>
              <div style={{ ...S.card, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Building2 size={15} color="#64748b" />
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>סה"כ עלויות קבועות</span>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(totalFixed + factoryFixed).toLocaleString()}</div>
              </div>

              <div style={{ ...S.card, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Users size={15} color="#f59e0b" />
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>סה"כ לייבור</span>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(grandLabor).toLocaleString()}</div>
              </div>

              <div style={{ ...S.card, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Truck size={15} color="#ef4444" />
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>סה"כ ספקים</span>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(factorySuppliers + branchSuppliers).toLocaleString()}</div>
              </div>

              <div style={{ ...S.card, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Receipt size={15} color="#3b82f6" />
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>הכנסות קופה</span>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(revCashier).toLocaleString()}</div>
              </div>

              <div style={{ ...S.card, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <CreditCard size={15} color="#f59e0b" />
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>הכנסות הקפה</span>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(revCredit + factoryB2b).toLocaleString()}</div>
              </div>

              <div style={{ ...S.card, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Globe size={15} color="#8b5cf6" />
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>הכנסות אתר</span>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(revWebsite).toLocaleString()}</div>
              </div>

              <div style={{ ...S.card, padding: '16px', border: '2px solid #10b98122' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <TrendingUp size={15} color="#10b981" />
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>סה"כ הכנסות כולל</span>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#10b981' }}>₪{Math.round(revCashier + revCredit + factoryB2b + revWebsite).toLocaleString()}</div>
              </div>
            </div>

            {/* Revenue breakdown cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '24px' }}>
              <div style={{ ...S.card, padding: '18px', borderTop: '3px solid #3b82f6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Receipt size={16} color="#3b82f6" />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>קופות סניפים</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(revCashier).toLocaleString()}</div>
                {grandRevenue > 0 && <span style={{ fontSize: '12px', color: '#94a3b8' }}>{((revCashier / grandRevenue) * 100).toFixed(1)}% מסה"כ הכנסות</span>}
              </div>

              <div style={{ ...S.card, padding: '18px', borderTop: '3px solid #f59e0b' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <CreditCard size={16} color="#f59e0b" />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>הקפה (סניפים + B2B מפעל)</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(revCredit + factoryB2b).toLocaleString()}</div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>סניפים: ₪{Math.round(revCredit).toLocaleString()}</span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>B2B: ₪{Math.round(factoryB2b).toLocaleString()}</span>
                </div>
              </div>

              <div style={{ ...S.card, padding: '18px', borderTop: '3px solid #8b5cf6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Globe size={16} color="#8b5cf6" />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>הכנסות מהאתר</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>₪{Math.round(revWebsite).toLocaleString()}</div>
                {grandRevenue > 0 && <span style={{ fontSize: '12px', color: '#94a3b8' }}>{((revWebsite / grandRevenue) * 100).toFixed(1)}% מסה"כ הכנסות</span>}
              </div>
            </div>

            {/* Charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>

              {/* Bar chart — revenue by branch */}
              <div style={S.card}>
                <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>הכנסות/הוצאות לפי יחידה</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={barData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₪${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => `₪${v.toLocaleString()}`} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="הכנסות" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="הוצאות" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="רווח תפעולי" radius={[4, 4, 0, 0]}>
                      {barData.map((entry, index) => (
                        <Cell key={index} fill={entry['רווח תפעולי'] >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Pie chart — expense breakdown */}
              <div style={S.card}>
                <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>התפלגות הוצאות</h3>
                {expenseBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={expenseBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: '11px' }}>
                        {expenseBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => `₪${v.toLocaleString()}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>אין נתונים</div>
                )}
              </div>
            </div>

            {/* Line chart — daily revenue */}
            {dailyRevenue.length > 0 && (
              <div style={{ ...S.card, marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>הכנסות יומיות לפי סניף</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={dailyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₪${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => `₪${v.toLocaleString()}`} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    {BRANCHES.map(br => (
                      <Line key={br.id} type="monotone" dataKey={br.name} stroke={br.color} strokeWidth={2} dot={{ r: 3 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Ranking table — branches + factory */}
            <div className="table-scroll"><div style={S.card}>
              <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>דירוג יחידות לפי רווחיות</h3>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 100px 100px 80px 70px 100px 100px', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                  <span>#</span>
                  <span>יחידה</span>
                  <span>הכנסות</span>
                  <span>הוצאות</span>
                  <span>לייבור</span>
                  <span style={{ textAlign: 'center' }}>% לייבור</span>
                  <span>רווח גולמי</span>
                  <span>רווח תפעולי</span>
                </div>

                {/* Factory row */}
                {(() => {
                  const fLabPct = factorySales > 0 ? (factoryLabor / factorySales) * 100 : 0
                  const fExpenses = factoryLabor + factorySuppliers
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 100px 100px 80px 70px 100px 100px', alignItems: 'center', padding: '12px 16px', background: '#eff6ff', borderBottom: '2px solid #bfdbfe' }}>
                      <span style={{ fontSize: '14px' }}>🏭</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#6366f1' }} />
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>מפעל</span>
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>₪{Math.round(factorySales).toLocaleString()}</span>
                      <span style={{ fontSize: '13px', color: '#ef4444' }}>₪{Math.round(fExpenses).toLocaleString()}</span>
                      <span style={{ fontSize: '13px', color: '#f59e0b' }}>₪{Math.round(factoryLabor).toLocaleString()}</span>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: fLabPct <= avgLaborTarget ? '#10b981' : '#ef4444', textAlign: 'center' }}>{fLabPct.toFixed(1)}%</span>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: factoryGrossProfit >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(factoryGrossProfit).toLocaleString()}</span>
                      <span style={{ fontSize: '14px', fontWeight: '800', color: factoryOperatingProfit >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(factoryOperatingProfit).toLocaleString()}</span>
                    </div>
                  )
                })()}

                {/* Branch rows */}
                {ranked.map((br, i) => {
                  const labPct = br.revenue > 0 ? (br.labor / br.revenue) * 100 : 0
                  return (
                    <div key={br.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 100px 100px 80px 70px 100px 100px', alignItems: 'center', padding: '12px 16px', borderBottom: i < ranked.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <span style={{ fontSize: '16px', fontWeight: '800', color: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : '#cd7f32' }}>
                        {i + 1}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: br.color }} />
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>{br.name}</span>
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>₪{Math.round(br.revenue).toLocaleString()}</span>
                      <span style={{ fontSize: '13px', color: '#ef4444' }}>₪{Math.round(br.expenses + br.labor).toLocaleString()}</span>
                      <span style={{ fontSize: '13px', color: '#f59e0b' }}>₪{Math.round(br.labor).toLocaleString()}</span>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: labPct <= avgLaborTarget ? '#10b981' : '#ef4444', textAlign: 'center' }}>{labPct.toFixed(1)}%</span>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: br.grossProfit >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(br.grossProfit).toLocaleString()}</span>
                      <span style={{ fontSize: '14px', fontWeight: '800', color: br.operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(br.operatingProfit).toLocaleString()}</span>
                    </div>
                  )
                })}

                {/* Grand total */}
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 100px 100px 80px 70px 100px 100px', padding: '13px 16px', background: '#fef3c7', borderTop: '2px solid #fde68a', fontWeight: '700' }}>
                  <span />
                  <span style={{ fontSize: '14px', color: '#374151' }}>סה"כ כולל</span>
                  <span style={{ fontSize: '13px', color: '#374151' }}>₪{Math.round(grandRevenue).toLocaleString()}</span>
                  <span style={{ fontSize: '13px', color: '#ef4444' }}>₪{Math.round(totalExpenses + totalLabor + factoryLabor + factorySuppliers).toLocaleString()}</span>
                  <span style={{ fontSize: '13px', color: '#f59e0b' }}>₪{Math.round(grandLabor).toLocaleString()}</span>
                  <span style={{ fontSize: '12px', color: grandLaborPct <= avgLaborTarget ? '#10b981' : '#ef4444', textAlign: 'center' }}>{grandLaborPct.toFixed(1)}%</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: grandGross >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(grandGross).toLocaleString()}</span>
                  <span style={{ fontSize: '14px', fontWeight: '800', color: grandOperating >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(grandOperating).toLocaleString()}</span>
                </div>
              </div>
            </div></div>

            {/* Branch revenue breakdown table */}
            <div className="table-scroll" style={{ marginTop: '24px' }}><div style={S.card}>
              <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>פירוק הכנסות לפי סניף</h3>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 95px 95px 95px 100px 90px 100px 110px', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                  <span>סניף</span>
                  <span>הכנסות קופה</span>
                  <span>הכנסות הקפה</span>
                  <span>הכנסות אתר</span>
                  <span>סה"כ הכנסות</span>
                  <span>לייבור</span>
                  <span>עלויות קבועות</span>
                  <span>רווח תפעולי</span>
                </div>

                {branches.map((br, i) => (
                  <div key={br.id} style={{ display: 'grid', gridTemplateColumns: '1fr 95px 95px 95px 100px 90px 100px 110px', alignItems: 'center', padding: '12px 16px', borderBottom: i < branches.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: br.color }} />
                      <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>{br.name}</span>
                    </div>
                    <span style={{ fontSize: '13px', color: '#374151' }}>₪{Math.round(br.revCashier).toLocaleString()}</span>
                    <span style={{ fontSize: '13px', color: '#374151' }}>₪{Math.round(br.revCredit).toLocaleString()}</span>
                    <span style={{ fontSize: '13px', color: '#374151' }}>₪{Math.round(br.revWebsite).toLocaleString()}</span>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>₪{Math.round(br.revenue).toLocaleString()}</span>
                    <span style={{ fontSize: '13px', color: '#f59e0b' }}>₪{Math.round(br.labor).toLocaleString()}</span>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>₪{Math.round(br.fixedCosts).toLocaleString()}</span>
                    <span style={{ fontSize: '14px', fontWeight: '800', color: br.operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(br.operatingProfit).toLocaleString()}</span>
                  </div>
                ))}

                {/* Grand total */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 95px 95px 95px 100px 90px 100px 110px', padding: '13px 16px', background: '#fef3c7', borderTop: '2px solid #fde68a', fontWeight: '700' }}>
                  <span style={{ fontSize: '14px', color: '#374151' }}>סה"כ כולל</span>
                  <span style={{ fontSize: '13px', color: '#374151' }}>₪{Math.round(revCashier).toLocaleString()}</span>
                  <span style={{ fontSize: '13px', color: '#374151' }}>₪{Math.round(revCredit + factoryB2b).toLocaleString()}</span>
                  <span style={{ fontSize: '13px', color: '#374151' }}>₪{Math.round(revWebsite).toLocaleString()}</span>
                  <span style={{ fontSize: '13px', fontWeight: '800', color: '#374151' }}>₪{Math.round(grandRevenue).toLocaleString()}</span>
                  <span style={{ fontSize: '13px', color: '#f59e0b' }}>₪{Math.round(grandLabor).toLocaleString()}</span>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>₪{Math.round(totalFixed + factoryFixed).toLocaleString()}</span>
                  <span style={{ fontSize: '14px', fontWeight: '800', color: grandOperating >= 0 ? '#10b981' : '#ef4444' }}>₪{Math.round(grandOperating).toLocaleString()}</span>
                </div>
              </div>
            </div></div>
          </>
        )}
      </div>
    </div>
  )
}
