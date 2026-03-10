import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, BarChart3, TrendingUp, TrendingDown, Minus, DollarSign, Users, ShoppingBag, Receipt } from 'lucide-react'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}


function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString() }

export default function BranchPL({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to, monthKey, comparisonPeriod } = usePeriod()
  const [loading, setLoading] = useState(false)

  // current month
  const [revCashier, setRevCashier] = useState(0)
  const [revWebsite, setRevWebsite] = useState(0)
  const [revCredit, setRevCredit]   = useState(0)
  const [expSuppliers, setExpSuppliers] = useState(0)
  const [expRepairs, setExpRepairs]     = useState(0)
  const [expInfra, setExpInfra]         = useState(0)
  const [expDelivery, setExpDelivery]   = useState(0)
  const [expOther, setExpOther]         = useState(0)
  const [laborEmployer, setLaborEmployer] = useState(0)
  const [wasteTotal, setWasteTotal]     = useState(0)
  const [fixedCosts, setFixedCosts]     = useState(0)

  // KPI targets (dynamic)
  const [laborTarget, setLaborTarget] = useState(28)
  const [wasteTarget, setWasteTarget] = useState(3)
  const [revenueTarget, setRevenueTarget] = useState(0)

  // previous month
  const [prevRevenue, setPrevRevenue]   = useState(0)
  const [prevProfit, setPrevProfit]     = useState(0)
  const [prevLabor, setPrevLabor]       = useState(0)

  const entityType = `branch_${branchId}`

  async function fetchData() {
    setLoading(true)

    // revenue by source
    const { data: revData } = await supabase.from('branch_revenue').select('source, amount')
      .eq('branch_id', branchId).gte('date', from).lt('date', to)
    if (revData) {
      setRevCashier(revData.filter(r => r.source === 'cashier').reduce((s, r) => s + Number(r.amount), 0))
      setRevWebsite(revData.filter(r => r.source === 'website').reduce((s, r) => s + Number(r.amount), 0))
      setRevCredit(revData.filter(r => r.source === 'credit').reduce((s, r) => s + Number(r.amount), 0))
    }

    // expenses by type
    const { data: expData } = await supabase.from('branch_expenses').select('expense_type, amount')
      .eq('branch_id', branchId).gte('date', from).lt('date', to)
    if (expData) {
      setExpSuppliers(expData.filter(r => r.expense_type === 'supplier' || r.expense_type === 'inventory').reduce((s, r) => s + Number(r.amount), 0))
      setExpRepairs(expData.filter(r => r.expense_type === 'repair').reduce((s, r) => s + Number(r.amount), 0))
      setExpInfra(expData.filter(r => r.expense_type === 'infrastructure').reduce((s, r) => s + Number(r.amount), 0))
      setExpDelivery(expData.filter(r => r.expense_type === 'delivery').reduce((s, r) => s + Number(r.amount), 0))
      setExpOther(expData.filter(r => r.expense_type === 'other').reduce((s, r) => s + Number(r.amount), 0))
    }

    // labor
    const { data: laborData } = await supabase.from('branch_labor').select('employer_cost')
      .eq('branch_id', branchId).gte('date', from).lt('date', to)
    if (laborData) setLaborEmployer(laborData.reduce((s, r) => s + Number(r.employer_cost), 0))

    // waste
    const { data: wasteData } = await supabase.from('branch_waste').select('amount')
      .eq('branch_id', branchId).gte('date', from).lt('date', to)
    if (wasteData) setWasteTotal(wasteData.reduce((s, r) => s + Number(r.amount), 0))

    // fixed costs
    const { data: fcData } = await supabase.from('fixed_costs').select('amount')
      .eq('entity_type', entityType).eq('month', monthKey || from.slice(0, 7))
    if (fcData) setFixedCosts(fcData.reduce((s, r) => s + Number(r.amount), 0))

    // KPI targets
    const { data: kpiData } = await supabase.from('branch_kpi_targets').select('*').eq('branch_id', branchId).single()
    if (kpiData) {
      setLaborTarget(Number(kpiData.labor_pct) || 28)
      setWasteTarget(Number(kpiData.waste_pct) || 3)
      setRevenueTarget(Number(kpiData.revenue_target) || 0)
    }

    // previous month (comparison period)
    const pFrom = comparisonPeriod.from, pTo = comparisonPeriod.to

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

    const { data: prevFc } = await supabase.from('fixed_costs').select('amount')
      .eq('entity_type', entityType).eq('month', comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7))
    const pFcTotal = prevFc ? prevFc.reduce((s, r) => s + Number(r.amount), 0) : 0

    const prevGross = pRevTotal - pLabTotal - pExpTotal
    setPrevProfit(prevGross - pFcTotal - pWstTotal)

    setLoading(false)
  }

  useEffect(() => { fetchData() }, [from, to, branchId])

  // calculations
  const totalRevenue   = revCashier + revWebsite + revCredit
  const totalExpenses  = expSuppliers + expRepairs + expInfra + expDelivery + expOther
  const grossProfit    = totalRevenue - laborEmployer - totalExpenses
  const operatingProfit = grossProfit - fixedCosts - wasteTotal
  const laborPct       = totalRevenue > 0 ? (laborEmployer / totalRevenue) * 100 : 0
  const wastePct       = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0
  const grossPct       = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0
  const operatingPct   = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0

  function DiffArrow({ current, previous }: { current: number; previous: number }) {
    if (previous === 0) return <Minus size={14} color="#94a3b8" />
    const p = ((current - previous) / Math.abs(previous)) * 100
    const color = p > 0 ? '#10b981' : '#ef4444'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', fontWeight: '700', color }}>
        {p > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        {Math.abs(p).toFixed(1)}%
      </span>
    )
  }

  const S = {
    page: { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card: { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
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
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BarChart3 size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>דוח רווח והפסד — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>P&L חודשי · רווח גולמי · רווח תפעולי</p>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: '900px', margin: '0 auto' }}>

        {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>טוען נתונים...</div>}

        {!loading && (
          <>
            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '14px', marginBottom: '20px' }}>
              {/* הכנסות */}
              <div style={{ ...S.card, padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <ShoppingBag size={16} color="#3b82f6" />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>הכנסות</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>{fmtM(totalRevenue)}</div>
                <DiffArrow current={totalRevenue} previous={prevRevenue} />
              </div>

              {/* הוצאות */}
              <div style={{ ...S.card, padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <Receipt size={16} color="#ef4444" />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>הוצאות</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#ef4444' }}>{fmtM(totalExpenses)}</div>
              </div>

              {/* לייבור */}
              <div style={{ ...S.card, padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <Users size={16} color="#f59e0b" />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>% לייבור</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: laborPct <= laborTarget ? '#10b981' : '#ef4444' }}>{laborPct.toFixed(1)}%</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>יעד {laborTarget}%</span>
              </div>

              {/* רווח גולמי */}
              <div style={{ ...S.card, padding: '18px', border: `2px solid ${grossProfit >= 0 ? '#10b981' : '#ef4444'}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <DollarSign size={16} color={grossProfit >= 0 ? '#10b981' : '#ef4444'} />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>רווח גולמי</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: grossProfit >= 0 ? '#10b981' : '#ef4444' }}>{fmtM(grossProfit)}</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{grossPct.toFixed(1)}% מהכנסות</span>
              </div>

              {/* רווח תפעולי */}
              <div style={{ ...S.card, padding: '18px', border: `2px solid ${operatingProfit >= 0 ? '#10b981' : '#ef4444'}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <BarChart3 size={16} color={operatingProfit >= 0 ? '#10b981' : '#ef4444'} />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>רווח תפעולי</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>{fmtM(operatingProfit)}</div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{operatingPct.toFixed(1)}% מהכנסות</span>
              </div>
            </div>

            {/* נוסחת רווח */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
              <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderRight: `4px solid ${grossProfit >= 0 ? '#10b981' : '#ef4444'}` }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>הכנסות − לייבור − הוצאות</div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: grossProfit >= 0 ? '#10b981' : '#ef4444' }}>= רווח גולמי {fmtM(grossProfit)}</div>
              </div>
              <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderRight: `4px solid ${operatingProfit >= 0 ? '#10b981' : '#ef4444'}` }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>רווח גולמי − עלויות קבועות − פחת</div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>= רווח תפעולי {fmtM(operatingProfit)}</div>
              </div>
            </div>

            {/* P&L table */}
            <div style={{ ...S.card, marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{period.label}</h2>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>השוואה ל{comparisonPeriod.label}</span>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>

                {/* הכנסות */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '11px 18px', background: '#f0fdf4', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#10b981' }}>הכנסות</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#10b981', textAlign: 'left' as const }}>סכום (₪)</span>
                </div>
                {[
                  { label: 'קופה', amount: revCashier },
                  { label: 'אתר', amount: revWebsite },
                  { label: 'הקפה', amount: revCredit },
                ].map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151', textAlign: 'left' as const }}>{fmtM(l.amount)}</span>
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '12px 18px', background: '#f0fdf4', borderBottom: '2px solid #bbf7d0' }}>
                  <span style={{ fontSize: '14px', fontWeight: '800', color: '#10b981' }}>סה"כ הכנסות</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#10b981', textAlign: 'left' as const }}>{fmtM(totalRevenue)}</span>
                </div>

                {/* הוצאות */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '11px 18px', background: '#fef2f2', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#ef4444' }}>הוצאות</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#ef4444', textAlign: 'left' as const }}>סכום (₪)</span>
                </div>
                {[
                  { label: 'ספקים / מלאי', amount: expSuppliers },
                  { label: 'תיקונים', amount: expRepairs },
                  { label: 'תשתיות', amount: expInfra },
                  { label: 'משלוחים', amount: expDelivery },
                  { label: 'אחר', amount: expOther },
                  { label: 'לייבור (עלות מעסיק)', amount: laborEmployer },
                ].map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: l.amount > 0 ? '#ef4444' : '#94a3b8', textAlign: 'left' as const }}>
                      {l.amount > 0 ? fmtM(l.amount) : '—'}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '12px 18px', background: '#fef2f2', borderBottom: '2px solid #fecaca' }}>
                  <span style={{ fontSize: '14px', fontWeight: '800', color: '#ef4444' }}>סה"כ הוצאות + לייבור</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#ef4444', textAlign: 'left' as const }}>{fmtM(totalExpenses + laborEmployer)}</span>
                </div>

                {/* רווח גולמי */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '14px 18px', background: grossProfit >= 0 ? '#f0fdf4' : '#fef2f2', borderBottom: '2px solid #e2e8f0' }}>
                  <div>
                    <span style={{ fontSize: '15px', fontWeight: '800', color: grossProfit >= 0 ? '#10b981' : '#ef4444' }}>רווח גולמי</span>
                    <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '10px' }}>{grossPct.toFixed(1)}%</span>
                  </div>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: grossProfit >= 0 ? '#10b981' : '#ef4444', textAlign: 'left' as const }}>{fmtM(grossProfit)}</span>
                </div>

                {/* עלויות קבועות + פחת */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '11px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b' }}>ניכויים נוספים</span>
                  <span />
                </div>
                {[
                  { label: 'עלויות קבועות', amount: fixedCosts },
                  { label: 'פחת', amount: wasteTotal },
                ].map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{l.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: l.amount > 0 ? '#64748b' : '#94a3b8', textAlign: 'left' as const }}>
                      {l.amount > 0 ? fmtM(l.amount) : '—'}
                    </span>
                  </div>
                ))}

                {/* רווח תפעולי */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', padding: '16px 18px', background: operatingProfit >= 0 ? '#f0fdf4' : '#fef2f2' }}>
                  <div>
                    <span style={{ fontSize: '16px', fontWeight: '800', color: operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>רווח תפעולי</span>
                    <span style={{ fontSize: '12px', color: '#94a3b8', marginRight: '10px' }}>{operatingPct.toFixed(1)}% מהכנסות</span>
                  </div>
                  <span style={{ fontSize: '20px', fontWeight: '800', color: operatingProfit >= 0 ? '#10b981' : '#ef4444', textAlign: 'left' as const }}>{fmtM(operatingProfit)}</span>
                </div>
              </div>
            </div>

            {/* KPI bars */}
            <div style={S.card}>
              <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>מדדים מרכזיים</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                <KpiBar label="% לייבור מהכנסות" value={laborPct} target={laborTarget} color="#f59e0b" branchColor={branchColor} />
                <KpiBar label="% פחת מהכנסות" value={wastePct} target={wasteTarget} color="#ef4444" branchColor={branchColor} />
                <KpiBar label="% רווח תפעולי" value={operatingPct} target={30} color="#10b981" branchColor={branchColor} invertWarning />
              </div>
            </div>
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
        <span style={{ fontSize: '14px', fontWeight: '800', color: warn ? '#ef4444' : '#10b981' }}>{value.toFixed(1)}%</span>
      </div>
      <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', position: 'relative' as const, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${barWidth}%`, background: warn ? '#ef4444' : color, borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>יעד: {target}%</div>
    </div>
  )
}
