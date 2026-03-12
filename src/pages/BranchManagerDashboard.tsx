import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Store, TrendingUp, TrendingDown, Minus, Users, Receipt, ShoppingBag, Trash2, DollarSign, BarChart3 } from 'lucide-react'

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

const BRANCHES = [
  { id: 1, name: 'אברהם אבינו', color: '#3b82f6' },
  { id: 2, name: 'הפועלים',     color: '#10b981' },
  { id: 3, name: 'יעקב כהן',   color: '#a855f7' },
]

function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString() }

export default function BranchManagerDashboard({ onBack }: Props) {
  const { period, setPeriod, from, to, comparisonPeriod } = usePeriod()
  const [loading, setLoading] = useState(true)
  const [branches, setBranches] = useState<BranchData[]>([])
  const [prevBranches, setPrevBranches] = useState<BranchData[]>([])
  const [overheadPct, setOverheadPct] = useState(() => {
    const saved = localStorage.getItem('overhead_pct')
    return saved ? Number(saved) : 5
  })
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

  function DiffArrow({ current, previous }: { current: number; previous: number }) {
    if (previous === 0) return <Minus size={12} color="#94a3b8" />
    const p = ((current - previous) / Math.abs(previous)) * 100
    const color = p > 0 ? '#10b981' : '#ef4444'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '11px', fontWeight: '700', color }}>
        {p > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {Math.abs(p).toFixed(1)}%
      </span>
    )
  }

  const S = {
    page: { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card: { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as React.CSSProperties,
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' as const }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '44px', height: '44px', background: 'linear-gradient(135deg, #3b82f6, #10b981)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(59,130,246,0.3)' }}>
          <BarChart3 size={22} color="white" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>דשבורד מנהל סניפים</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>השוואת ביצועים · P&L · KPI</p>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8', fontSize: '16px' }}>טוען נתונים...</div>}

      {!loading && (
        <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1200px', margin: '0 auto' }}>

          {/* Overhead % control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>העמסת מטה:</span>
            <input
              type="number"
              value={overheadPct}
              onChange={e => {
                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                setOverheadPct(v)
                localStorage.setItem('overhead_pct', String(v))
              }}
              style={{ width: '50px', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '4px 8px', fontSize: '14px', textAlign: 'center' as const, fontWeight: '600', color: '#3b82f6', background: 'white' }}
            />
            <span style={{ fontSize: '13px', color: '#64748b' }}>%</span>
          </div>

          {/* ── KPI Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            <div style={{ ...S.card, padding: '18px', borderTop: '3px solid #3b82f6' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <ShoppingBag size={15} color="#3b82f6" />
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>סה"כ הכנסות</span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>{fmtM(totals.revenue)}</div>
              <DiffArrow current={totals.revenue} previous={prevTotals.revenue} />
            </div>

            <div style={{ ...S.card, padding: '18px', borderTop: '3px solid #ef4444' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Receipt size={15} color="#ef4444" />
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>סה"כ הוצאות</span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#ef4444' }}>{fmtM(totals.expenses)}</div>
            </div>

            <div style={{ ...S.card, padding: '18px', borderTop: '3px solid #f59e0b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Users size={15} color="#f59e0b" />
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>% לייבור</span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: totalLaborPct <= 28 ? '#10b981' : '#ef4444' }}>{totalLaborPct.toFixed(1)}%</div>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>יעד 28%</span>
            </div>

            <div style={{ ...S.card, padding: '18px', borderTop: '3px solid #ef4444' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Trash2 size={15} color="#ef4444" />
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>% פחת</span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: totalWastePct <= 4 ? '#10b981' : '#ef4444' }}>{totalWastePct.toFixed(1)}%</div>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>יעד 4%</span>
            </div>

            <div style={{ ...S.card, padding: '18px', borderTop: `3px solid ${totals.grossProfit >= 0 ? '#10b981' : '#ef4444'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <DollarSign size={15} color={totals.grossProfit >= 0 ? '#10b981' : '#ef4444'} />
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>רווח גולמי</span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: totals.grossProfit >= 0 ? '#10b981' : '#ef4444' }}>{fmtM(totals.grossProfit)}</div>
              <DiffArrow current={totals.grossProfit} previous={prevTotals.grossProfit} />
            </div>

            <div style={{ ...S.card, padding: '18px', borderTop: `3px solid ${totals.operatingProfit >= 0 ? '#10b981' : '#ef4444'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <BarChart3 size={15} color={totals.operatingProfit >= 0 ? '#10b981' : '#ef4444'} />
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>רווח תפעולי</span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: totals.operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>{fmtM(totals.operatingProfit)}</div>
              <DiffArrow current={totals.operatingProfit} previous={prevTotals.operatingProfit} />
            </div>
          </div>

          {/* ── Branch Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            {branches.map((br, bi) => {
              const prev = prevBranches[bi]
              return (
                <div key={br.id} style={{ ...S.card, borderTop: `4px solid ${br.color}` }}>
                  {/* Branch header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                    <div style={{ width: '44px', height: '44px', background: br.color, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${br.color}40` }}>
                      <Store size={22} color="white" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>{br.name}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{period.label}</div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '20px', fontWeight: '800', color: brOP(br) >= 0 ? '#10b981' : '#ef4444' }}>
                        {fmtM(brOP(br))}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>רווח תפעולי</div>
                    </div>
                  </div>

                  {/* KPI row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
                    {[
                      { label: 'לייבור', val: br.laborPct.toFixed(1) + '%', ok: br.laborPct <= 28, target: '28%' },
                      { label: 'פחת', val: br.wastePct.toFixed(1) + '%', ok: br.wastePct <= 4, target: '4%' },
                      { label: 'גולמי', val: br.grossPct.toFixed(1) + '%', ok: br.grossProfit >= 0, target: '' },
                      { label: 'תפעולי', val: (br.totalRevenue > 0 ? (brOP(br) / br.totalRevenue * 100).toFixed(1) : '0.0') + '%', ok: brOP(br) >= 0, target: '' },
                    ].map(kpi => (
                      <div key={kpi.label} style={{ background: kpi.ok ? '#f0fdf4' : '#fef2f2', borderRadius: '10px', padding: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '15px', fontWeight: '800', color: kpi.ok ? '#10b981' : '#ef4444' }}>{kpi.val}</div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>{kpi.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* P&L breakdown */}
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', fontSize: '13px' }}>
                    {[
                      { label: 'הכנסות', amount: br.totalRevenue, color: '#10b981', bold: true },
                      { label: '  קופה', amount: br.revCashier, color: '#374151' },
                      { label: '  אתר', amount: br.revWebsite, color: '#374151' },
                      { label: '  הקפה', amount: br.revCredit, color: '#374151' },
                      { label: 'לייבור', amount: -br.laborEmployer, color: '#ef4444', bold: true },
                      { label: 'הוצאות', amount: -br.totalExpenses, color: '#ef4444', bold: true },
                      { label: '  ספקים', amount: -br.expSuppliers, color: '#374151' },
                      ...(br.expRepairs > 0 ? [{ label: '  תיקונים', amount: -br.expRepairs, color: '#374151' }] : []),
                      ...(br.expDelivery > 0 ? [{ label: '  משלוחים', amount: -br.expDelivery, color: '#374151' }] : []),
                      ...(br.expInfra > 0 ? [{ label: '  תשתיות', amount: -br.expInfra, color: '#374151' }] : []),
                      ...(br.expOther > 0 ? [{ label: '  אחר', amount: -br.expOther, color: '#374151' }] : []),
                      { label: 'רווח גולמי', amount: br.grossProfit, color: br.grossProfit >= 0 ? '#10b981' : '#ef4444', bold: true, bg: br.grossProfit >= 0 ? '#f0fdf4' : '#fef2f2' },
                      ...(br.fixedCosts > 0 ? [{ label: 'עלויות קבועות', amount: -br.fixedCosts, color: '#64748b' }] : []),
                      ...(br.mgmtCosts > 0 ? [{ label: 'הנהלה וכלליות', amount: -br.mgmtCosts, color: '#64748b' }] : []),
                      { label: 'פחת', amount: -br.wasteTotal, color: '#64748b' },
                      ...(overheadPct > 0 ? [{ label: `העמסת מטה ${overheadPct}%`, amount: -brOH(br), color: '#64748b' }] : []),
                      { label: 'רווח תפעולי', amount: brOP(br), color: brOP(br) >= 0 ? '#10b981' : '#ef4444', bold: true, bg: brOP(br) >= 0 ? '#f0fdf4' : '#fef2f2' },
                    ].map((line, i) => (
                      <div key={i} style={{
                        display: 'grid', gridTemplateColumns: '1fr 120px',
                        padding: '7px 14px',
                        background: (line as any).bg || (i % 2 === 0 ? 'white' : '#fafafa'),
                        borderBottom: '1px solid #f1f5f9',
                        fontWeight: (line as any).bold ? '700' : '400',
                      }}>
                        <span style={{ color: '#374151' }}>{line.label}</span>
                        <span style={{ textAlign: 'left', color: line.color, fontWeight: (line as any).bold ? '700' : '500' }}>
                          {line.amount === 0 ? '—' : fmtM(Math.abs(line.amount))}{line.amount < 0 ? '-' : ''}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Comparison */}
                  {prev && prev.totalRevenue > 0 && (
                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        הכנסות: <DiffArrow current={br.totalRevenue} previous={prev.totalRevenue} />
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        רווח: <DiffArrow current={brOP(br)} previous={brOP(prev)} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Comparison Table ── */}
          <div className="table-scroll"><div style={S.card}>
            <h2 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>
              טבלת השוואה — {period.label}
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'right', color: '#64748b', fontWeight: '600', fontSize: '12px' }}>מדד</th>
                    {branches.map(br => (
                      <th key={br.id} style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', fontSize: '13px' }}>
                        <span style={{ color: br.color }}>{br.name}</span>
                      </th>
                    ))}
                    <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>סה"כ</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'הכנסות', key: 'totalRevenue' as const, color: '#10b981' },
                    { label: 'הוצאות', key: 'totalExpenses' as const, color: '#ef4444' },
                    { label: 'לייבור', key: 'laborEmployer' as const, color: '#f59e0b' },
                    { label: 'פחת', key: 'wasteTotal' as const, color: '#ef4444' },
                    { label: 'עלויות קבועות', key: 'fixedCosts' as const, color: '#64748b' },
                    { label: 'הנהלה וכלליות', key: 'mgmtCosts' as const, color: '#64748b' },
                    { label: 'רווח גולמי', key: 'grossProfit' as const, color: '#10b981' },
                  ].map((row, ri) => {
                    const isBold = row.key === 'grossProfit' || row.key === 'operatingProfit' || row.key === 'totalRevenue'
                    const totalVal = branches.reduce((s, b) => s + b[row.key], 0)
                    return (
                      <tr key={row.key} style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isBold ? '#f8fafc' : ri % 2 === 0 ? 'white' : '#fafafa',
                      }}>
                        <td style={{ padding: '10px 14px', fontWeight: isBold ? '700' : '500', color: '#374151' }}>{row.label}</td>
                        {branches.map(br => {
                          const val = br[row.key]
                          const isProfit = row.key === 'grossProfit' || row.key === 'operatingProfit'
                          const c = isProfit ? (val >= 0 ? '#10b981' : '#ef4444') : row.color
                          return (
                            <td key={br.id} style={{ padding: '10px 14px', textAlign: 'center', fontWeight: isBold ? '700' : '500', color: val === 0 ? '#94a3b8' : c }}>
                              {val === 0 ? '—' : fmtM(val)}
                            </td>
                          )
                        })}
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: (row.key === 'grossProfit' || row.key === 'operatingProfit') ? (totalVal >= 0 ? '#10b981' : '#ef4444') : '#0f172a' }}>
                          {totalVal === 0 ? '—' : fmtM(totalVal)}
                        </td>
                      </tr>
                    )
                  })}
                  {/* Overhead row */}
                  {overheadPct > 0 && (
                    <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#fafafa' }}>
                      <td style={{ padding: '10px 14px', fontWeight: '500', color: '#374151' }}>העמסת מטה {overheadPct}%</td>
                      {branches.map(br => (
                        <td key={br.id} style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '500', color: '#64748b' }}>
                          {fmtM(brOH(br))}
                        </td>
                      ))}
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: '#0f172a' }}>
                        {fmtM(totals.overhead)}
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                    <td style={{ padding: '10px 14px', fontWeight: '700', color: '#374151' }}>רווח תפעולי</td>
                    {branches.map(br => {
                      const op = brOP(br)
                      return (
                        <td key={br.id} style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: op >= 0 ? '#10b981' : '#ef4444' }}>
                          {op === 0 ? '—' : fmtM(op)}
                        </td>
                      )
                    })}
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: totals.operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>
                      {totals.operatingProfit === 0 ? '—' : fmtM(totals.operatingProfit)}
                    </td>
                  </tr>
                  {/* KPI row */}
                  <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                    <td style={{ padding: '10px 14px', fontWeight: '700', color: '#374151' }}>% לייבור</td>
                    {branches.map(br => (
                      <td key={br.id} style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: br.laborPct <= 28 ? '#10b981' : '#ef4444' }}>
                        {br.totalRevenue > 0 ? br.laborPct.toFixed(1) + '%' : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: totalLaborPct <= 28 ? '#10b981' : '#ef4444' }}>
                      {totalLaborPct.toFixed(1)}%
                    </td>
                  </tr>
                  <tr style={{ background: '#f8fafc' }}>
                    <td style={{ padding: '10px 14px', fontWeight: '700', color: '#374151' }}>% פחת</td>
                    {branches.map(br => (
                      <td key={br.id} style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: br.wastePct <= 4 ? '#10b981' : '#ef4444' }}>
                        {br.totalRevenue > 0 ? br.wastePct.toFixed(1) + '%' : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: totalWastePct <= 4 ? '#10b981' : '#ef4444' }}>
                      {totalWastePct.toFixed(1)}%
                    </td>
                  </tr>
                  <tr style={{ background: '#f8fafc' }}>
                    <td style={{ padding: '10px 14px', fontWeight: '700', color: '#374151' }}>% רווח תפעולי</td>
                    {branches.map(br => {
                      const opPct = br.totalRevenue > 0 ? (brOP(br) / br.totalRevenue * 100) : 0
                      return (
                        <td key={br.id} style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: opPct >= 0 ? '#10b981' : '#ef4444' }}>
                          {br.totalRevenue > 0 ? opPct.toFixed(1) + '%' : '—'}
                        </td>
                      )
                    })}
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: totals.revenue > 0 ? ((totals.operatingProfit / totals.revenue * 100) >= 0 ? '#10b981' : '#ef4444') : '#94a3b8' }}>
                      {totals.revenue > 0 ? (totals.operatingProfit / totals.revenue * 100).toFixed(1) + '%' : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div></div>

        </div>
      )}
    </div>
  )
}
