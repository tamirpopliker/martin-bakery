import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchBranchTrends, getOverheadPct } from '../lib/supabase'
import type { MonthTrend } from '../lib/supabase'
import { calculateBranchPL, type PLResult } from '../lib/calculatePL'
import { usePeriod } from '../lib/PeriodContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import PeriodPicker from '../components/PeriodPicker'
import PageHeader from '../components/PageHeader'
import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react'
import { RevenueIcon, ProfitIcon, LaborIcon, FixedCostIcon } from '@/components/icons'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}


function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) }

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function BranchPL({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to, monthKey, comparisonPeriod } = usePeriod()
  const [loading, setLoading] = useState(false)

  // P&L result from unified function
  const [pl, setPl] = useState<PLResult | null>(null)

  const [overheadPct, setOverheadPct] = useState(5)

  // KPI targets (dynamic)
  const [laborTarget, setLaborTarget] = useState(0)
  const [wasteTarget, setWasteTarget] = useState(3)
  const [revenueTarget, setRevenueTarget] = useState(0)

  // previous month
  const [prevRevenue, setPrevRevenue]   = useState(0)
  const [prevProfit, setPrevProfit]     = useState(0)
  const [prevLabor, setPrevLabor]       = useState(0)

  // Revenue breakdown (not in PLResult, fetched separately for UI)
  const [revCashier, setRevCashier] = useState(0)
  const [revWebsite, setRevWebsite] = useState(0)
  const [revCredit, setRevCredit] = useState(0)

  async function fetchData() {
    setLoading(true)

    const curMonthKey = monthKey || from.slice(0, 7)

    // P&L via unified calculateBranchPL — overhead fetched from branches table
    const plResult = await calculateBranchPL(branchId, from, to, undefined, curMonthKey)
    setOverheadPct(plResult.overheadPct)
    setPl(plResult)

    // Revenue breakdown by source (for UI table)
    const { data: revRows } = await supabase.from('branch_revenue').select('source, amount')
      .eq('branch_id', branchId).gte('date', from).lt('date', to)
    let cashier = 0, website = 0, credit = 0
    for (const r of (revRows || [])) {
      const amt = Number(r.amount)
      if (r.source === 'cashier') cashier += amt
      else if (r.source === 'website') website += amt
      else if (r.source === 'credit') credit += amt
    }
    setRevCashier(cashier)
    setRevWebsite(website)
    setRevCredit(credit)

    // KPI targets
    const { data: kpiData } = await supabase.from('branch_kpi_targets').select('*').eq('branch_id', branchId).maybeSingle()
    if (kpiData) {
      setLaborTarget(Number(kpiData.labor_pct) || 0)
      setWasteTarget(Number(kpiData.waste_pct) || 3)
      setRevenueTarget(Number(kpiData.revenue_target) || 0)
    }

    // Previous period via unified calculateBranchPL
    const prevMonthKey = comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)
    const prevPl = await calculateBranchPL(branchId, comparisonPeriod.from, comparisonPeriod.to, undefined, prevMonthKey)
    setPrevRevenue(prevPl.revenue)
    setPrevLabor(prevPl.labor)
    setPrevProfit(prevPl.operatingProfit)

    setLoading(false)
  }

  useEffect(() => { fetchData() }, [from, to, branchId])

  const [trendData, setTrendData] = useState<MonthTrend[]>([])
  useEffect(() => {
    getOverheadPct().then(oh => fetchBranchTrends(branchId, monthKey || from.slice(0, 7), oh)).then(setTrendData)
  }, [branchId, monthKey, from])

  // derived values from PLResult
  const totalRevenue         = pl?.revenue ?? 0
  const expSuppliersInternal = pl?.factoryPurchases ?? 0
  const expSuppliersExternal = pl?.externalSuppliers ?? 0
  const expSuppliers         = expSuppliersInternal + expSuppliersExternal
  const expRepairs           = pl?.repairs ?? 0
  const expInfra             = pl?.infrastructure ?? 0
  const expDelivery          = pl?.deliveries ?? 0
  const expOther             = pl?.otherExpenses ?? 0
  const laborEmployer        = pl?.labor ?? 0
  const wasteTotal           = pl?.waste ?? 0
  const fixedCosts           = pl?.fixedCosts ?? 0
  const mgmtCosts            = pl?.managerSalary ?? 0
  const overheadAmount       = pl?.overhead ?? 0
  const controllableMargin   = pl?.controllableProfit ?? 0
  const operatingProfit      = pl?.operatingProfit ?? 0

  const totalExpenses   = expSuppliers + expRepairs + expInfra + expDelivery + expOther
  const grossProfit     = totalRevenue - laborEmployer - totalExpenses
  const laborPct        = totalRevenue > 0 ? (laborEmployer / totalRevenue) * 100 : 0
  const wastePct        = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0
  const grossPct        = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0
  const operatingPct    = pl?.operatingMargin ?? 0
  const controllablePct = pl?.controllableMargin ?? 0

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

  const plRowStyle = { display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '10px 18px', borderBottom: '1px solid #f8fafc' } as const
  const plSectionHeader = { display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: '#fafafa' } as const
  const summaryRowStyle = { display: 'grid', gridTemplateColumns: '1fr 130px 70px', padding: '12px 18px', background: '#fafafa', borderBottom: '1px solid #f1f5f9' } as const

  return (
    <div style={{ direction: 'rtl', background: '#f8fafc', minHeight: '100vh' }}>

      <PageHeader title="רווח והפסד" subtitle={branchName} onBack={onBack} />

      <div style={{ padding: '0 24px', maxWidth: '900px', margin: '0 auto' }}>

        {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>טוען נתונים...</div>}

        {!loading && (
          <>
            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '14px', marginBottom: '20px' }}>
              {/* הכנסות */}
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
                    <RevenueIcon size={16} color="#64748b" />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }}>הכנסות</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>{fmtM(totalRevenue)}</div>
                <DiffArrow current={totalRevenue} previous={prevRevenue} />
              </div>

              {/* הוצאות */}
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
                    <FixedCostIcon size={16} color="#64748b" />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }}>הוצאות</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>{fmtM(totalExpenses)}</div>
              </div>

              {/* לייבור */}
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
                    <LaborIcon size={16} color="#64748b" />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }}>% לייבור</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: laborTarget > 0 ? (laborPct <= laborTarget ? '#34d399' : '#fb7185') : '#0f172a' }}>{laborPct.toFixed(1)}%</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{laborTarget > 0 ? `יעד ${laborTarget}%` : '\u2014'}</span>
              </div>

              {/* רווח נשלט */}
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
                    <ProfitIcon size={16} color="#64748b" />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }} className="cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: grossProfit >= 0 ? '#34d399' : '#fb7185' }}>{fmtM(grossProfit)}</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{grossPct.toFixed(1)}% מהכנסות</span>
              </div>

              {/* רווח תפעולי */}
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
                    <ProfitIcon size={16} color="#64748b" />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }}>רווח תפעולי</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>{fmtM(operatingProfit)}</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{operatingPct.toFixed(1)}% מהכנסות</span>
              </div>
            </div>

            {/* Profit formula */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>הכנסות − לייבור − הוצאות</div>
                <div style={{ fontSize: '18px', fontWeight: '700', color: grossProfit >= 0 ? '#34d399' : '#fb7185' }}>= רווח נשלט {fmtM(grossProfit)}</div>
              </div>
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>גולמי − קבועות − הנהלה − פחת − מטה</div>
                <div style={{ fontSize: '18px', fontWeight: '700', color: operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>= רווח תפעולי {fmtM(operatingProfit)}</div>
              </div>
            </div>

            {/* P&L table */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{period.label}</h2>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>השוואה ל{comparisonPeriod.label}</span>
              </div>

              <div style={{ border: '1px solid #f1f5f9', borderRadius: '12px', overflow: 'hidden' }}>

                {/* הכנסות header */}
                <div style={plSectionHeader}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>הכנסות</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b', textAlign: 'left' as const }}>סכום (₪)</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b', textAlign: 'left' as const }}>%</span>
                </div>
                {[
                  { label: 'קופה', amount: revCashier },
                  { label: 'אתר', amount: revWebsite },
                  { label: 'הקפה', amount: revCredit },
                ].map((l, i) => (
                  <div key={i} style={plRowStyle}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151', textAlign: 'left' as const }}>{fmtM(l.amount)}</span>
                    <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 ? (l.amount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}
                <div style={summaryRowStyle}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>סה"כ הכנסות</span>
                  <span style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', textAlign: 'left' as const }}>{fmtM(totalRevenue)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', textAlign: 'left' as const }}>100%</span>
                </div>

                {/* הוצאות header */}
                <div style={plSectionHeader}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>הוצאות</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b', textAlign: 'left' as const }}>סכום (₪)</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b', textAlign: 'left' as const }}>%</span>
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
                  <div key={i} style={plRowStyle}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: l.amount > 0 ? '#374151' : '#94a3b8', textAlign: 'left' as const }}>
                      {l.amount > 0 ? fmtM(l.amount) : '—'}
                    </span>
                    <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 && l.amount > 0 ? (l.amount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}
                <div style={summaryRowStyle}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>סה"כ הוצאות + לייבור</span>
                  <span style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', textAlign: 'left' as const }}>{fmtM(totalExpenses + laborEmployer)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', textAlign: 'left' as const }}>{totalRevenue > 0 ? ((totalExpenses + laborEmployer) / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                </div>

                {/* רווח נשלט (gross) */}
                <div style={{ ...summaryRowStyle, background: '#fafafa', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }} className="cursor-help" title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן: לייבור, ספקים, שכר מנהל, פחת ותיקונים. לא כולל עלויות קבועות והעמסת מטה.">רווח נשלט</span>
                  <span style={{ fontSize: '16px', fontWeight: '700', color: grossProfit >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{fmtM(grossProfit)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: grossProfit >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{grossPct.toFixed(1)}%</span>
                </div>

                {/* ניכויים נוספים */}
                <div style={plSectionHeader}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>ניכויים נוספים</span>
                  <span />
                  <span />
                </div>
                {[
                  { label: 'הנהלה וכלליות', amount: mgmtCosts },
                  { label: 'פחת', amount: wasteTotal },
                ].map((l, i) => (
                  <div key={i} style={plRowStyle}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: l.amount > 0 ? '#374151' : '#94a3b8', textAlign: 'left' as const }}>
                      {l.amount > 0 ? fmtM(l.amount) : '—'}
                    </span>
                    <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 && l.amount > 0 ? (l.amount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}

                {/* רווח נשלט — controllable margin */}
                <div style={{ ...summaryRowStyle, background: '#fafafa', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    רווח נשלט
                    <span title="מדד יעילות — כולל רק עלויות שהמנהל שולט בהן" style={{ cursor: 'help', display: 'inline-flex' }}>
                      <Info size={14} color="#94a3b8" />
                    </span>
                  </span>
                  <span style={{ fontSize: '16px', fontWeight: '700', color: controllableMargin >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{fmtM(controllableMargin)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: controllableMargin >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{controllablePct.toFixed(1)}%</span>
                </div>

                {/* עלויות קבועות */}
                <div style={plSectionHeader}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>עלויות קבועות</span>
                  <span />
                  <span />
                </div>
                {[
                  { label: 'עלויות קבועות', amount: fixedCosts },
                ].map((l, i) => (
                  <div key={i} style={plRowStyle}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: l.amount > 0 ? '#374151' : '#94a3b8', textAlign: 'left' as const }}>
                      {l.amount > 0 ? fmtM(l.amount) : '—'}
                    </span>
                    <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 && l.amount > 0 ? (l.amount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}
                {/* העמסת מטה */}
                <div style={plRowStyle}>
                  <span style={{ fontSize: '14px', color: '#374151', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    העמסת מטה
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#94a3b8' }}>{overheadPct}%</span>
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: overheadAmount > 0 ? '#374151' : '#94a3b8', textAlign: 'left' as const }}>
                    {overheadAmount > 0 ? fmtM(overheadAmount) : '—'}
                  </span>
                  <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'left' as const }}>{totalRevenue > 0 && overheadAmount > 0 ? (overheadAmount / totalRevenue * 100).toFixed(1) + '%' : '—'}</span>
                </div>

                {/* רווח תפעולי */}
                <div style={{ ...summaryRowStyle, background: '#fafafa' }}>
                  <span style={{ fontSize: '15px', fontWeight: '600', color: '#0f172a' }}>רווח תפעולי</span>
                  <span style={{ fontSize: '18px', fontWeight: '700', color: operatingProfit >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{fmtM(operatingProfit)}</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: operatingProfit >= 0 ? '#34d399' : '#fb7185', textAlign: 'left' as const }}>{operatingPct.toFixed(1)}%</span>
                </div>
              </div>
            </div>
            </motion.div>

            {/* KPI bars */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '20px' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>מדדים מרכזיים</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                <KpiBar label="% לייבור מהכנסות" value={laborPct} target={laborTarget} color="#fbbf24" branchColor={branchColor} />
                <KpiBar label="% פחת מהכנסות" value={wastePct} target={wasteTarget} color="#fb7185" branchColor={branchColor} />
                <KpiBar label="% רווח תפעולי" value={operatingPct} target={30} color="#34d399" branchColor={branchColor} invertWarning />
              </div>
            </div>
            </motion.div>

            {/* 6-month trend chart */}
            {trendData.length > 0 && (
              <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '20px', marginTop: '20px' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>מגמות 6 חודשים</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => '₪' + (v / 1000).toFixed(0) + 'k'} />
                    <Tooltip formatter={(value: number, name: string) => ['₪' + Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 2 }), name]} />
                    <Legend />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="revenue" name="הכנסות" stroke="#378ADD" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="grossProfit" name="רווח נשלט" stroke="#639922" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="operatingProfit" name="רווח תפעולי" stroke="#534AB7" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
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
