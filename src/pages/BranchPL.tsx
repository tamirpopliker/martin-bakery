import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchBranchTrends, fetchBranchPL, getOverheadPct, BranchPLResult, MonthTrend } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react'
import { RevenueIcon, ProfitIcon, LaborIcon, FixedCostIcon } from '@/components/icons'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}


function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString() }

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function BranchPL({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to, monthKey, comparisonPeriod } = usePeriod()
  const [loading, setLoading] = useState(false)

  // P&L result from shared function
  const [pl, setPl] = useState<BranchPLResult | null>(null)

  const [overheadPct, setOverheadPct] = useState(5)

  // KPI targets (dynamic)
  const [laborTarget, setLaborTarget] = useState(0)
  const [wasteTarget, setWasteTarget] = useState(3)
  const [revenueTarget, setRevenueTarget] = useState(0)

  // previous month
  const [prevRevenue, setPrevRevenue]   = useState(0)
  const [prevProfit, setPrevProfit]     = useState(0)
  const [prevLabor, setPrevLabor]       = useState(0)

  async function fetchData() {
    setLoading(true)

    // Fetch overhead from system_settings
    const oh = await getOverheadPct()
    setOverheadPct(oh)

    // P&L via shared function
    const plResult = await fetchBranchPL(branchId, from, to, monthKey || from.slice(0, 7), oh)

    // Override supplier split from branch_pl_summary View (single source of truth)
    const viewMonth = from.substring(0, 7) + '-01'
    const { data: plSummary } = await supabase
      .from('branch_pl_summary')
      .select('internal_supplier_cost, external_supplier_cost, total_supplier_cost')
      .eq('branch_id', branchId)
      .eq('month', viewMonth)
      .maybeSingle()

    if (plSummary) {
      plResult.expSuppliersInternal = Number(plSummary.internal_supplier_cost || 0)
      plResult.expSuppliersExternal = Number(plSummary.external_supplier_cost || 0)
      plResult.expSuppliers = Number(plSummary.total_supplier_cost || 0)
    }

    setPl(plResult)

    // KPI targets
    const { data: kpiData } = await supabase.from('branch_kpi_targets').select('*').eq('branch_id', branchId).maybeSingle()
    if (kpiData) {
      setLaborTarget(Number(kpiData.labor_pct) || 0)
      setWasteTarget(Number(kpiData.waste_pct) || 3)
      setRevenueTarget(Number(kpiData.revenue_target) || 0)
    }

    // previous month (comparison period)
    const pFrom = comparisonPeriod.from, pTo = comparisonPeriod.to
    const entityType = `branch_${branchId}`

    const { data: prevRev } = await supabase.from('branch_revenue').select('amount')
      .eq('branch_id', branchId).gte('date', pFrom).lt('date', pTo)
    const pRevTotal = prevRev ? prevRev.reduce((s, r) => s + Number(r.amount), 0) : 0
    setPrevRevenue(pRevTotal)

    const { data: prevExp } = await supabase.from('branch_expenses').select('amount')
      .eq('branch_id', branchId).gte('date', pFrom).lt('date', pTo)
    const pExpTotal = prevExp ? prevExp.reduce((s, r) => s + Number(r.amount), 0) : 0

    const { data: prevLab } = await supabase.from('branch_labor').select('employer_cost')
      .eq('branch_id', branchId).gte('date', pFrom).lt('date', pTo)
    const pLabTotal = prevLab ? prevLab.reduce((s, r) => s + Number(r.employer_cost), 0) : 0
    setPrevLabor(pLabTotal)

    const { data: prevWst } = await supabase.from('branch_waste').select('amount')
      .eq('branch_id', branchId).gte('date', pFrom).lt('date', pTo)
    const pWstTotal = prevWst ? prevWst.reduce((s, r) => s + Number(r.amount), 0) : 0

    const { data: prevFc } = await supabase.from('fixed_costs').select('amount, entity_id')
      .eq('entity_type', entityType).eq('month', comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7))
    const pFcTotal = prevFc ? prevFc.filter(r => r.entity_id !== 'mgmt').reduce((s, r) => s + Number(r.amount), 0) : 0
    const pMgmtTotal = prevFc ? prevFc.filter(r => r.entity_id === 'mgmt').reduce((s, r) => s + Number(r.amount), 0) : 0

    const prevGross = pRevTotal - pLabTotal - pExpTotal
    setPrevProfit(prevGross - pFcTotal - pMgmtTotal - pWstTotal - (pRevTotal * oh / 100))

    setLoading(false)
  }

  useEffect(() => { fetchData() }, [from, to, branchId])

  const [trendData, setTrendData] = useState<MonthTrend[]>([])
  useEffect(() => {
    getOverheadPct().then(oh => fetchBranchTrends(branchId, monthKey || from.slice(0, 7), oh)).then(setTrendData)
  }, [branchId, monthKey, from])

  // derived values from PL result
  const totalRevenue    = pl?.revenue ?? 0
  const revCashier      = pl?.revCashier ?? 0
  const revWebsite      = pl?.revWebsite ?? 0
  const revCredit       = pl?.revCredit ?? 0
  const expSuppliers    = pl?.expSuppliers ?? 0
  const expSuppliersInternal = pl?.expSuppliersInternal ?? 0
  const expSuppliersExternal = pl?.expSuppliersExternal ?? 0
  const expRepairs      = pl?.expRepairs ?? 0
  const expInfra        = pl?.expInfra ?? 0
  const expDelivery     = pl?.expDelivery ?? 0
  const expOther        = pl?.expOther ?? 0
  const laborEmployer   = pl?.laborEmployer ?? 0
  const wasteTotal      = pl?.wasteTotal ?? 0
  const fixedCosts      = pl?.fixedCosts ?? 0
  const mgmtCosts       = pl?.mgmtCosts ?? 0
  const overheadAmount  = pl?.overheadAmount ?? 0
  const controllableMargin = pl?.controllableMargin ?? 0
  const operatingProfit = pl?.operatingProfit ?? 0

  const totalExpenses   = expSuppliers + expRepairs + expInfra + expDelivery + expOther
  const grossProfit     = totalRevenue - laborEmployer - totalExpenses
  const laborPct        = totalRevenue > 0 ? (laborEmployer / totalRevenue) * 100 : 0
  const wastePct        = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0
  const grossPct        = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0
  const operatingPct    = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0
  const controllablePct = totalRevenue > 0 ? (controllableMargin / totalRevenue) * 100 : 0

  function DiffArrow({ current, previous }: { current: number; previous: number }) {
    if (previous === 0) return <Minus size={14} color="#94a3b8" />
    const p = ((current - previous) / Math.abs(previous)) * 100
    const color = p > 0 ? '#34d399' : '#fb7185'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', fontWeight: '700', color }}>
        {p > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        {Math.abs(p).toFixed(1)}%
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* כותרת */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ProfitIcon size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>דוח רווח והפסד — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>P&L חודשי · רווח נשלט · רווח תפעולי</p>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '900px', margin: '0 auto' }}>

        {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>טוען נתונים...</div>}

        {!loading && (
          <>
            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '14px', marginBottom: '20px' }}>
              {/* הכנסות */}
              <Card className="shadow-sm"><CardContent className="p-6" style={{ padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#10B98115' }}>
                    <RevenueIcon size={16} color="#10B981" />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>הכנסות</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>{fmtM(totalRevenue)}</div>
                <DiffArrow current={totalRevenue} previous={prevRevenue} />
              </CardContent></Card>

              {/* הוצאות */}
              <Card className="shadow-sm"><CardContent className="p-6" style={{ padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fb718515' }}>
                    <FixedCostIcon size={16} color="#fb7185" />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>הוצאות</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#fb7185' }}>{fmtM(totalExpenses)}</div>
              </CardContent></Card>

              {/* לייבור */}
              <Card className="shadow-sm"><CardContent className="p-6" style={{ padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#3B82F615' }}>
                    <LaborIcon size={16} color="#3B82F6" />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>% לייבור</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: laborTarget > 0 ? (laborPct <= laborTarget ? '#34d399' : '#fb7185') : '#334155' }}>{laborPct.toFixed(1)}%</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{laborTarget > 0 ? `יעד ${laborTarget}%` : '\u2014'}</span>
              </CardContent></Card>

              {/* רווח נשלט */}
              <Card className="shadow-sm" style={{ border: `2px solid ${grossProfit >= 0 ? '#34d399' : '#fb7185'}22` }}><CardContent className="p-6" style={{ padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#7C3AED15' }}>
                    <ProfitIcon size={16} color={grossProfit >= 0 ? '#7C3AED' : '#fb7185'} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }} className="cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: grossProfit >= 0 ? '#34d399' : '#fb7185' }}>{fmtM(grossProfit)}</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{grossPct.toFixed(1)}% מהכנסות</span>
              </CardContent></Card>

              {/* רווח תפעולי */}
              <Card className="shadow-sm" style={{ border: `2px solid ${operatingProfit >= 0 ? '#34d399' : '#fb7185'}22` }}><CardContent className="p-6" style={{ padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#7C3AED15' }}>
                    <ProfitIcon size={16} color={operatingProfit >= 0 ? '#7C3AED' : '#fb7185'} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>רווח תפעולי</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>{fmtM(operatingProfit)}</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{operatingPct.toFixed(1)}% מהכנסות</span>
              </CardContent></Card>
            </div>

            {/* נוסחת רווח */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
              <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderRight: `4px solid ${grossProfit >= 0 ? '#34d399' : '#fb7185'}` }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>הכנסות − לייבור − הוצאות</div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: grossProfit >= 0 ? '#34d399' : '#fb7185' }}>= רווח נשלט {fmtM(grossProfit)}</div>
              </div>
              <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderRight: `4px solid ${operatingProfit >= 0 ? '#34d399' : '#fb7185'}` }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>גולמי − קבועות − הנהלה − פחת − מטה</div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>= רווח תפעולי {fmtM(operatingProfit)}</div>
              </div>
            </div>

            {/* P&L table */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm" style={{ marginBottom: '20px' }}><CardContent className="p-6">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{period.label}</h2>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>השוואה ל{comparisonPeriod.label}</span>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>

                {/* הכנסות */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '11px 18px', background: '#f0fdf4', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#34d399' }}>הכנסות</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#34d399', textAlign: 'left' as const }}>סכום (₪)</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#34d399', textAlign: 'left' as const }}>%</span>
                </div>
                {[
                  { label: 'קופה', amount: revCashier },
                  { label: 'אתר', amount: revWebsite },
                  { label: 'הקפה', amount: revCredit },
                ].map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151', textAlign: 'left' as const }}>{fmtM(l.amount)}</span>
                    <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 ? (l.amount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '12px 18px', background: '#f0fdf4', borderBottom: '2px solid #bbf7d0' }}>
                  <span style={{ fontSize: '14px', fontWeight: '800', color: '#34d399' }}>סה"כ הכנסות</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#34d399', textAlign: 'left' as const }}>{fmtM(totalRevenue)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#34d399', textAlign: 'left' as const }}>100%</span>
                </div>

                {/* הוצאות */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '11px 18px', background: '#fff1f2', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#fb7185' }}>הוצאות</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#fb7185', textAlign: 'left' as const }}>סכום (₪)</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#fb7185', textAlign: 'left' as const }}>%</span>
                </div>
                {[
                  { label: 'רכישות מהמפעל', amount: expSuppliersInternal },
                  { label: 'ספקים חיצוניים', amount: expSuppliersExternal },
                  { label: 'תיקונים', amount: expRepairs },
                  { label: 'תשתיות', amount: expInfra },
                  { label: 'משלוחים', amount: expDelivery },
                  { label: 'אחר', amount: expOther },
                  { label: 'לייבור (עלות מעסיק)', amount: laborEmployer },
                ].map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: l.amount > 0 ? '#fb7185' : '#94a3b8', textAlign: 'left' as const }}>
                      {l.amount > 0 ? fmtM(l.amount) : '—'}
                    </span>
                    <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 && l.amount > 0 ? (l.amount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '12px 18px', background: '#fff1f2', borderBottom: '2px solid #fecdd3' }}>
                  <span style={{ fontSize: '14px', fontWeight: '800', color: '#fb7185' }}>סה"כ הוצאות + לייבור</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#fb7185', textAlign: 'left' as const }}>{fmtM(totalExpenses + laborEmployer)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#fb7185', textAlign: 'left' as const }}>{totalRevenue > 0 ? ((totalExpenses + laborEmployer) / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                </div>

                {/* רווח נשלט */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '14px 18px', background: grossProfit >= 0 ? '#f0fdf4' : '#fff1f2', borderBottom: '2px solid #e2e8f0' }}>
                  <span style={{ fontSize: '15px', fontWeight: '800', color: grossProfit >= 0 ? '#34d399' : '#fb7185' }} className="cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: grossProfit >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{fmtM(grossProfit)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: grossProfit >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{grossPct.toFixed(1)}%</span>
                </div>

                {/* ניכויים נוספים (waste + mgmt) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '11px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b' }}>ניכויים נוספים</span>
                  <span />
                  <span />
                </div>
                {[
                  { label: 'הנהלה וכלליות', amount: mgmtCosts },
                  { label: 'פחת', amount: wasteTotal },
                ].map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: l.amount > 0 ? '#64748b' : '#94a3b8', textAlign: 'left' as const }}>
                      {l.amount > 0 ? fmtM(l.amount) : '—'}
                    </span>
                    <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 && l.amount > 0 ? (l.amount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}

                {/* רווח נשלט — controllable margin */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '14px 18px', background: controllableMargin >= 0 ? '#eff6ff' : '#fff1f2', borderTop: '2px solid #93c5fd', borderBottom: '2px solid #93c5fd' }}>
                  <span style={{ fontSize: '15px', fontWeight: '800', color: controllableMargin >= 0 ? '#3b82f6' : '#fb7185', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    רווח נשלט
                    <span title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן" style={{ cursor: 'help', display: 'inline-flex' }}>
                      <Info size={14} color="#93c5fd" />
                    </span>
                  </span>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: controllableMargin >= 0 ? '#3b82f6' : '#fb7185', textAlign: 'left' as const }}>{fmtM(controllableMargin)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: controllableMargin >= 0 ? '#3b82f6' : '#fb7185', textAlign: 'left' as const }}>{controllablePct.toFixed(1)}%</span>
                </div>

                {/* עלויות קבועות + מטה */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '11px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b' }}>עלויות קבועות</span>
                  <span />
                  <span />
                </div>
                {[
                  { label: 'עלויות קבועות', amount: fixedCosts },
                ].map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: l.amount > 0 ? '#64748b' : '#94a3b8', textAlign: 'left' as const }}>
                      {l.amount > 0 ? fmtM(l.amount) : '—'}
                    </span>
                    <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 && l.amount > 0 ? (l.amount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}
                {/* העמסת מטה — editable % */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: '#fafafa' }}>
                  <span style={{ fontSize: '14px', color: '#374151', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    העמסת מטה
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#818cf8' }}>{overheadPct}%</span>
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: overheadAmount > 0 ? '#64748b' : '#94a3b8', textAlign: 'left' as const }}>
                    {overheadAmount > 0 ? fmtM(overheadAmount) : '—'}
                  </span>
                  <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 && overheadAmount > 0 ? (overheadAmount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                </div>

                {/* רווח תפעולי */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '16px 18px', background: operatingProfit >= 0 ? '#f0fdf4' : '#fff1f2' }}>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>רווח תפעולי</span>
                  <span style={{ fontSize: '20px', fontWeight: '800', color: operatingProfit >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{fmtM(operatingProfit)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: operatingProfit >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{operatingPct.toFixed(1)}%</span>
                </div>
              </div>
            </CardContent></Card>
            </motion.div>

            {/* KPI bars */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm"><CardContent className="p-6">
              <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>מדדים מרכזיים</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                <KpiBar label="% לייבור מהכנסות" value={laborPct} target={laborTarget} color="#fbbf24" branchColor={branchColor} />
                <KpiBar label="% פחת מהכנסות" value={wastePct} target={wasteTarget} color="#fb7185" branchColor={branchColor} />
                <KpiBar label="% רווח תפעולי" value={operatingPct} target={30} color="#34d399" branchColor={branchColor} invertWarning />
              </div>
            </CardContent></Card>
            </motion.div>

            {/* 6-month trend chart */}
            {trendData.length > 0 && (
              <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <Card className="shadow-sm" style={{ marginTop: '20px' }}><CardContent className="p-6">
                <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>מגמות 6 חודשים</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => '₪' + (v / 1000).toFixed(0) + 'k'} />
                    <Tooltip formatter={(value: number, name: string) => ['₪' + Math.round(value).toLocaleString(), name]} />
                    <Legend />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="revenue" name="הכנסות" stroke="#378ADD" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="grossProfit" name="רווח נשלט" stroke="#639922" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="operatingProfit" name="רווח תפעולי" stroke="#534AB7" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent></Card>
              </motion.div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

function KpiBar({ label, value, target, color, branchColor, invertWarning }: {
  label: string; value: number; target: number; color: string; branchColor: string; invertWarning?: boolean
}) {
  const warn = invertWarning ? value < target : value > target
  const barWidth = Math.min(Math.abs(value), 100)
  return (
    <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>{label}</span>
        <span style={{ fontSize: '14px', fontWeight: '800', color: warn ? '#fb7185' : '#34d399' }}>{value.toFixed(1)}%</span>
      </div>
      <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', position: 'relative' as const, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${barWidth}%`, background: warn ? '#fb7185' : color, borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>יעד: {target}%</div>
    </div>
  )
}
