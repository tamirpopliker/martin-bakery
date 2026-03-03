import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Props { onBack: () => void }

type Period = 'today' | 'week' | 'month' | 'prev_month' | 'quarter' | 'custom'
type Dept   = 'creams' | 'dough' | 'packaging' | 'cleaning'

interface DeptData {
  sales:    number
  production: number
  waste:    number
  repairs:  number
  labor:    number
  suppliers: number
}

interface SupplierRow { name: string; total: number }

// ─── קבועים ──────────────────────────────────────────────────────────────────
const DEPTS: Dept[] = ['creams', 'dough', 'packaging', 'cleaning']
const DEPT_LABELS: Record<Dept, string> = { creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה', cleaning: 'ניקיון/נהג' }
const DEPT_COLORS: Record<Dept, string> = { creams: '#3b82f6', dough: '#8b5cf6', packaging: '#0ea5e9', cleaning: '#64748b' }

const EMPTY: DeptData = { sales: 0, production: 0, waste: 0, repairs: 0, labor: 0, suppliers: 0 }

// ─── עזרים ───────────────────────────────────────────────────────────────────
const fmtM  = (n: number) => '₪' + Math.round(n).toLocaleString()
const fmtP  = (n: number) => n.toFixed(1) + '%'
const pct   = (a: number, b: number) => b > 0 ? (a / b) * 100 : 0
const chgPct = (cur: number, prev: number) => prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0

function kpiColor(actual: number, target: number, higherIsBetter = false) {
  const diff = higherIsBetter ? actual - target : target - actual
  if (diff >= 0)    return '#10b981'
  if (diff >= -3)   return '#f59e0b'
  if (diff >= -7)   return '#f97316'
  return '#ef4444'
}

// ─── גרף קו SVG ──────────────────────────────────────────────────────────────
function LineChart({ series, colors, labels }: { series: number[][]; colors: string[]; labels: string[] }) {
  const all = series.flat().filter(Boolean)
  if (!all.length) return <div style={{ textAlign: 'center', color: '#94a3b8', padding: '32px', fontSize: '13px' }}>אין נתונים</div>
  const max = Math.max(...all)
  const W = 680, H = 140, P = { t: 12, b: 28, l: 8, r: 8 }
  const len = Math.max(...series.map(s => s.length))
  const toX = (i: number) => P.l + (i / (len - 1 || 1)) * (W - P.l - P.r)
  const toY = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '140px' }}>
      {series.map((s, si) => (
        <polyline key={si} points={s.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')}
          fill="none" stroke={colors[si]} strokeWidth="2.5" strokeLinejoin="round" opacity={0.9} />
      ))}
      {labels.map((l, i) => {
        if (len > 12 && i % 3 !== 0) return null
        return <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{l}</text>
      })}
    </svg>
  )
}

// ─── גרף עמודות SVG ───────────────────────────────────────────────────────────
function BarChart({ items, color }: { items: { label: string; value: number }[]; color: string }) {
  const max = Math.max(...items.map(i => i.value)) || 1
  const W = 500, H = 120, P = { t: 12, b: 24, l: 8, r: 8 }
  const bw = Math.max(12, (W - P.l - P.r) / items.length - 4)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '120px' }}>
      {items.map((item, i) => {
        const h = (item.value / max) * (H - P.t - P.b)
        const x = P.l + i * ((W - P.l - P.r) / items.length) + ((W - P.l - P.r) / items.length - bw) / 2
        const y = H - P.b - h
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} rx={4} fill={color} opacity={0.85} />
            <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{item.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── קומפוננטה ראשית ──────────────────────────────────────────────────────────
export default function FactoryDashboard({ onBack }: Props) {
  const [period, setPeriod]       = useState<Period>('month')
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [customFrom, setCustomFrom]   = useState('')
  const [customTo, setCustomTo]       = useState('')
  const [data, setData]           = useState<Record<Dept, DeptData>>({ creams: { ...EMPTY }, dough: { ...EMPTY }, packaging: { ...EMPTY }, cleaning: { ...EMPTY } })
  const [prevData, setPrevData]   = useState<Record<Dept, DeptData>>({ creams: { ...EMPTY }, dough: { ...EMPTY }, packaging: { ...EMPTY }, cleaning: { ...EMPTY } })
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [dailySales, setDailySales] = useState<{ date: string; creams: number; dough: number }[]>([])
  const [loading, setLoading]     = useState(true)
  const [openSection, setOpenSection] = useState<string | null>(null)

  // ─── חישוב טווח ────────────────────────────────────────────────────────
  function getRange(): { from: string; to: string } {
    const today = new Date()
    const t = today.toISOString().split('T')[0]
    if (period === 'today') return { from: t, to: t }
    if (period === 'week') {
      const mon = new Date(today); mon.setDate(today.getDate() - today.getDay() + 1)
      return { from: mon.toISOString().split('T')[0], to: t }
    }
    if (period === 'month')      return { from: monthFilter + '-01', to: monthFilter + '-31' }
    if (period === 'prev_month') {
      const [y, m] = monthFilter.split('-').map(Number)
      const p = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
      return { from: p + '-01', to: p + '-31' }
    }
    if (period === 'quarter') {
      const [y, m] = monthFilter.split('-').map(Number)
      const qStart = Math.floor((m - 1) / 3) * 3 + 1
      return { from: `${y}-${String(qStart).padStart(2, '0')}-01`, to: `${y}-${String(qStart + 2).padStart(2, '0')}-31` }
    }
    return { from: customFrom || t, to: customTo || t }
  }

  function getPrevRange(cur: { from: string; to: string }): { from: string; to: string } {
    const days = (new Date(cur.to).getTime() - new Date(cur.from).getTime()) / 86400000 + 1
    const prevTo = new Date(cur.from); prevTo.setDate(prevTo.getDate() - 1)
    const prevFrom = new Date(prevTo);  prevFrom.setDate(prevTo.getDate() - days + 1)
    return { from: prevFrom.toISOString().split('T')[0], to: prevTo.toISOString().split('T')[0] }
  }

  // ─── שליפת נתונים ──────────────────────────────────────────────────────
  async function fetchDeptData(from: string, to: string): Promise<Record<Dept, DeptData>> {
    const result: Record<Dept, DeptData> = { creams: { ...EMPTY }, dough: { ...EMPTY }, packaging: { ...EMPTY }, cleaning: { ...EMPTY } }

    const [sales, prod, waste, repairs, labor, invs] = await Promise.all([
      supabase.from('factory_sales').select('department,amount').gte('date', from).lte('date', to),
      supabase.from('daily_production').select('department,amount').gte('date', from).lte('date', to),
      supabase.from('factory_waste').select('department,amount').gte('date', from).lte('date', to),
      supabase.from('factory_repairs').select('department,amount').gte('date', from).lte('date', to),
      supabase.from('labor').select('entity_id,gross_salary').eq('entity_type', 'factory').gte('date', from).lte('date', to),
      supabase.from('supplier_invoices').select('amount').gte('date', from).lte('date', to),
    ])

    const sum = (arr: any[], dept: string, field: string) =>
      (arr || []).filter(r => r.department === dept || r.entity_id === dept).reduce((s: number, r: any) => s + Number(r[field] || 0), 0)

    DEPTS.forEach(d => {
      result[d].sales     = sum(sales.data || [], d, 'amount')
      result[d].production= sum(prod.data || [], d, 'amount')
      result[d].waste     = sum(waste.data || [], d, 'amount')
      result[d].repairs   = sum(repairs.data || [], d, 'amount')
      result[d].labor     = sum(labor.data || [], d, 'gross_salary')
    })
    // ספקים — לא מחולק למחלקות, נשמר בנפרד
    result.creams.suppliers = (invs.data || []).reduce((s: number, r: any) => s + Number(r.amount), 0)

    return result
  }

  async function fetchSupplierSummary(from: string, to: string) {
    const { data: invs } = await supabase
      .from('supplier_invoices').select('supplier_id,amount').gte('date', from).lte('date', to)
    const { data: supps } = await supabase.from('suppliers').select('id,name')
    if (!invs || !supps) return []
    const map: Record<number, number> = {}
    invs.forEach((i: any) => { map[i.supplier_id] = (map[i.supplier_id] || 0) + Number(i.amount) })
    return supps.map((s: any) => ({ name: s.name, total: map[s.id] || 0 }))
      .filter(s => s.total > 0).sort((a, b) => b.total - a.total)
  }

  async function fetchDailySales(from: string, to: string) {
    const { data } = await supabase.from('factory_sales').select('date,department,amount').gte('date', from).lte('date', to).order('date')
    if (!data) return []
    const byDate: Record<string, { creams: number; dough: number }> = {}
    data.forEach((r: any) => {
      if (!byDate[r.date]) byDate[r.date] = { creams: 0, dough: 0 }
      if (r.department === 'creams') byDate[r.date].creams += Number(r.amount)
      if (r.department === 'dough')  byDate[r.date].dough  += Number(r.amount)
    })
    return Object.entries(byDate).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date))
  }

  useEffect(() => {
    if (period === 'custom' && (!customFrom || !customTo)) return
    async function load() {
      setLoading(true)
      const range = getRange()
      const prev  = getPrevRange(range)
      const [cur, prv, supps, daily] = await Promise.all([
        fetchDeptData(range.from, range.to),
        fetchDeptData(prev.from, prev.to),
        fetchSupplierSummary(range.from, range.to),
        fetchDailySales(range.from, range.to),
      ])
      setData(cur)
      setPrevData(prv)
      setSuppliers(supps)
      setDailySales(daily)
      setLoading(false)
    }
    load()
  }, [period, monthFilter, customFrom, customTo])

  // ─── חישובים כלליים ────────────────────────────────────────────────────
  const totalSales    = DEPTS.reduce((s, d) => s + data[d].sales, 0)
  const totalProd     = DEPTS.reduce((s, d) => s + data[d].production, 0)
  const totalWaste    = DEPTS.reduce((s, d) => s + data[d].waste, 0)
  const totalRepairs  = DEPTS.reduce((s, d) => s + data[d].repairs, 0)
  const totalLabor    = DEPTS.reduce((s, d) => s + data[d].labor, 0)
  const totalSuppliers = data.creams.suppliers
  const grossProfit   = totalSales - totalSuppliers - totalWaste - totalRepairs - totalLabor

  const prevTotalSales = DEPTS.reduce((s, d) => s + prevData[d].sales, 0)
  const prevTotalLabor = DEPTS.reduce((s, d) => s + prevData[d].labor, 0)
  const prevGross      = prevTotalSales - prevData.creams.suppliers
    - DEPTS.reduce((s, d) => s + prevData[d].waste, 0)
    - DEPTS.reduce((s, d) => s + prevData[d].repairs, 0)
    - prevTotalLabor

  const laborPct  = pct(totalLabor,   totalSales)
  const wastePct  = pct(totalWaste,   totalSales)
  const grossPct  = pct(grossProfit,  totalSales)

  const TARGETS = { labor: 25, waste: 5, gross: 40 }

  // ─── סגנונות ─────────────────────────────────────────────────────────────
  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '22px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    sectionTitle: { fontSize: '14px', fontWeight: '700' as const, color: '#374151', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' },
  }

  const periodLabels: Record<Period, string> = {
    today: 'היום', week: 'השבוע', month: 'החודש', prev_month: 'חודש שעבר', quarter: 'רבעון', custom: 'מותאם'
  }

  if (loading) return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#94a3b8', fontSize: '16px' }}>טוען נתונים...</div>
    </div>
  )

  return (
    <div style={S.page}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' as const }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
        </button>
        <div style={{ width: '40px', height: '40px', background: '#e0e7ff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <TrendingUp size={20} color="#6366f1" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>דשבורד מפעל</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>סיכום כלל המחלקות · KPI · רווח תפעולי</p>
        </div>

        {/* בחירת תקופה */}
        <div style={{ marginRight: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' as const, alignItems: 'center' }}>
          {(['today', 'week', 'month', 'prev_month', 'quarter', 'custom'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{ background: period === p ? '#6366f1' : '#f1f5f9', color: period === p ? 'white' : '#64748b', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
              {periodLabels[p]}
            </button>
          ))}
          {(period === 'month' || period === 'prev_month' || period === 'quarter') && (
            <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
              style={{ border: '1.5px solid #e2e8f0', borderRadius: '8px', padding: '5px 10px', fontSize: '12px', fontFamily: 'inherit', background: 'white' }} />
          )}
          {period === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '8px', padding: '5px 10px', fontSize: '12px', fontFamily: 'inherit' }} />
              <span style={{ color: '#94a3b8', fontSize: '12px' }}>עד</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '8px', padding: '5px 10px', fontSize: '12px', fontFamily: 'inherit' }} />
            </>
          )}
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: '1200px', margin: '0 auto' }}>

        {/* ─── כרטיסי סיכום עליון (5.1) ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'הכנסות',       val: totalSales,   prev: prevTotalSales, color: '#3b82f6', bg: '#eff6ff' },
            { label: 'ספקים',        val: totalSuppliers, prev: prevData.creams.suppliers, color: '#64748b', bg: '#f8fafc' },
            { label: 'לייבור כולל',  val: totalLabor,   prev: prevTotalLabor, color: '#f59e0b', bg: '#fffbeb' },
            { label: 'פחת',          val: totalWaste,   prev: DEPTS.reduce((s, d) => s + prevData[d].waste, 0), color: '#ef4444', bg: '#fef2f2' },
            { label: 'תיקונים/ציוד', val: totalRepairs, prev: DEPTS.reduce((s, d) => s + prevData[d].repairs, 0), color: '#f97316', bg: '#fff7ed' },
            { label: 'רווח גולמי',   val: grossProfit,  prev: prevGross, color: grossProfit >= 0 ? '#10b981' : '#ef4444', bg: grossProfit >= 0 ? '#f0fdf4' : '#fef2f2' },
          ].map(s => {
            const chg = chgPct(s.val, s.prev)
            return (
              <div key={s.label} style={{ background: s.bg, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: `1px solid ${s.color}22` }}>
                <div style={{ fontSize: '18px', fontWeight: '800', color: s.color }}>{fmtM(s.val)}</div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{s.label}</div>
                {s.prev > 0 && (
                  <div style={{ fontSize: '11px', fontWeight: '700', color: chg >= 0 ? '#10b981' : '#ef4444', marginTop: '4px' }}>
                    {chg >= 0 ? '↑' : '↓'}{Math.abs(chg).toFixed(0)}% vs קודם
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ─── KPI שלושה מדדים ───────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'לייבור / הכנסות', val: laborPct, target: TARGETS.labor, higher: false },
            { label: 'פחת / הכנסות',    val: wastePct, target: TARGETS.waste,  higher: false },
            { label: 'רווח גולמי %',    val: grossPct, target: TARGETS.gross,  higher: true  },
          ].map(k => {
            const color = kpiColor(k.val, k.target, k.higher)
            const diff = k.val - k.target
            return (
              <div key={k.label} style={{ background: 'white', borderRadius: '16px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderRight: `4px solid ${color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '28px', fontWeight: '800', color }}>{fmtP(k.val)}</div>
                  <div style={{ fontSize: '12px', background: color + '20', color, padding: '3px 10px', borderRadius: '20px', fontWeight: '700' }}>
                    יעד {fmtP(k.target)}
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>{k.label}</div>
                <div style={{ fontSize: '12px', color: Math.abs(diff) < 1 ? '#94a3b8' : (diff > 0 ? (k.higher ? '#10b981' : '#ef4444') : (k.higher ? '#ef4444' : '#10b981')), marginTop: '4px', fontWeight: '600' }}>
                  {diff > 0 ? '+' : ''}{diff.toFixed(1)}% מהיעד
                </div>
              </div>
            )
          })}
        </div>

        {/* ─── טבלת רווח תפעולי (5.2) ────────────────────────────────────── */}
        <div style={{ ...S.card, marginBottom: '20px' }}>
          <div style={S.sectionTitle}>📊 טבלת רווח תפעולי</div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px repeat(4, 1fr) 110px', gap: '0', fontSize: '12px' }}>
            {/* כותרת */}
            <div style={{ display: 'contents' }}>
              {['שורה', 'קרמים', 'בצקים', 'אריזה+ניקיון', 'סה"כ', '%'].map(h => (
                <div key={h} style={{ padding: '10px 14px', background: '#f8fafc', fontWeight: '700', color: '#64748b', borderBottom: '2px solid #e2e8f0' }}>{h}</div>
              ))}
            </div>

            {/* שורות */}
            {[
              { label: 'מכירות', creams: data.creams.sales, dough: data.dough.sales, other: data.packaging.sales + data.cleaning.sales, color: '#3b82f6', bold: true },
              { label: 'ספקים (חומ"ג)', creams: totalSuppliers, dough: 0, other: 0, color: '#64748b', neg: true },
              { label: 'פחת', creams: data.creams.waste, dough: data.dough.waste, other: data.packaging.waste, color: '#ef4444', neg: true },
              { label: 'תיקונים/ציוד', creams: data.creams.repairs, dough: data.dough.repairs, other: data.packaging.repairs + data.cleaning.repairs, color: '#f97316', neg: true },
              { label: 'לייבור', creams: data.creams.labor, dough: data.dough.labor, other: data.packaging.labor + data.cleaning.labor, color: '#f59e0b', neg: true },
              { label: 'רווח גולמי', creams: data.creams.sales - data.creams.production - data.creams.waste - data.creams.repairs - data.creams.labor, dough: data.dough.sales - data.dough.production - data.dough.waste - data.dough.repairs - data.dough.labor, other: 0, color: grossProfit >= 0 ? '#10b981' : '#ef4444', bold: true, separator: true },
            ].map((row, i) => {
              const total = row.creams + row.dough + row.other
              const rowPct = pct(total, totalSales)
              return (
                <div key={row.label} style={{ display: 'contents' }}>
                  {[
                    <div style={{ padding: '11px 14px', fontWeight: row.bold ? '700' : '500', color: '#374151', background: row.separator ? '#f8fafc' : i % 2 === 0 ? 'white' : '#fafafa', borderTop: row.separator ? '2px solid #e2e8f0' : '1px solid #f1f5f9' }}>{row.label}</div>,
                    ...[row.creams, row.dough, row.other, total].map((val, j) => (
                      <div style={{ padding: '11px 14px', fontWeight: row.bold ? '700' : '400', color: row.neg ? '#64748b' : row.color, background: row.separator ? '#f8fafc' : i % 2 === 0 ? 'white' : '#fafafa', borderTop: row.separator ? '2px solid #e2e8f0' : '1px solid #f1f5f9' }}>
                        {val !== 0 ? (row.neg ? '−' : '') + fmtM(Math.abs(val)) : '—'}
                      </div>
                    )),
                    <div style={{ padding: '11px 14px', fontWeight: '700', color: row.color, background: row.separator ? '#f8fafc' : i % 2 === 0 ? 'white' : '#fafafa', borderTop: row.separator ? '2px solid #e2e8f0' : '1px solid #f1f5f9' }}>
                      {totalSales > 0 ? fmtP(rowPct) : '—'}
                    </div>
                  ].map((el, j) => <div key={j} style={{ display: 'contents' }}>{el}</div>)}
                </div>
              )
            })}
          </div>
        </div>

        {/* ─── גרפים (5.3) ────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>

          {/* גרף קו רווח גולמי */}
          <div style={S.card}>
            <div style={S.sectionTitle}>📈 מכירות יומיות לפי מחלקה</div>
            {dailySales.length > 1 ? (
              <>
                <LineChart
                  series={[dailySales.map(d => d.creams), dailySales.map(d => d.dough)]}
                  colors={['#3b82f6', '#8b5cf6']}
                  labels={dailySales.map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }))}
                />
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '12px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '16px', height: '3px', background: '#3b82f6', display: 'inline-block', borderRadius: '2px' }} />קרמים</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '16px', height: '3px', background: '#8b5cf6', display: 'inline-block', borderRadius: '2px' }} />בצקים</span>
                </div>
              </>
            ) : <div style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', padding: '32px' }}>אין נתונים מספיקים</div>}
          </div>

          {/* גרף עמודות השוואת מחלקות */}
          <div style={S.card}>
            <div style={S.sectionTitle}>📊 לייבור לפי מחלקה</div>
            <BarChart
              items={DEPTS.map(d => ({ label: DEPT_LABELS[d], value: data[d].labor }))}
              color="#f59e0b"
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '12px' }}>
              {DEPTS.map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: '11px' }}>
                  <div style={{ fontWeight: '700', color: DEPT_COLORS[d] }}>{fmtM(data[d].labor)}</div>
                  <div style={{ color: '#94a3b8' }}>{DEPT_LABELS[d]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── פירוטים בלחיצה (5.4) ───────────────────────────────────────── */}
        {[
          {
            key: 'suppliers', title: '🏢 פירוט ספקים',
            content: (
              <div>
                {suppliers.map(s => (
                  <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontWeight: '600', color: '#374151' }}>{s.name}</span>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <span style={{ fontWeight: '700', color: '#10b981' }}>{fmtM(s.total)}</span>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{fmtP(pct(s.total, totalSuppliers))}</span>
                    </div>
                  </div>
                ))}
                {suppliers.length === 0 && <div style={{ color: '#94a3b8', textAlign: 'center', padding: '24px' }}>אין נתונים</div>}
              </div>
            )
          },
          {
            key: 'labor', title: '👷 פירוט לייבור לפי מחלקה',
            content: (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                {DEPTS.map(d => (
                  <div key={d} style={{ background: '#f8fafc', borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: DEPT_COLORS[d] }}>{fmtM(data[d].labor)}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{DEPT_LABELS[d]}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{fmtP(pct(data[d].labor, totalSales))} מהכנסות</div>
                  </div>
                ))}
              </div>
            )
          },
          {
            key: 'waste', title: '🗑️ פירוט פחת לפי מחלקה',
            content: (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {(['creams', 'dough', 'packaging'] as Dept[]).map(d => (
                  <div key={d} style={{ background: '#fef2f2', borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#ef4444' }}>{fmtM(data[d].waste)}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{DEPT_LABELS[d]}</div>
                  </div>
                ))}
              </div>
            )
          },
          {
            key: 'sales', title: '💰 פירוט מכירות לפי מחלקה',
            content: (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                {DEPTS.map(d => (
                  <div key={d} style={{ background: '#eff6ff', borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: DEPT_COLORS[d] }}>{fmtM(data[d].sales)}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{DEPT_LABELS[d]}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{fmtP(pct(data[d].sales, totalSales))} מסה"כ</div>
                  </div>
                ))}
              </div>
            )
          },
        ].map(section => (
          <div key={section.key} style={{ ...S.card, marginBottom: '12px', padding: '0', overflow: 'hidden' }}>
            <button
              onClick={() => setOpenSection(openSection === section.key ? null : section.key)}
              style={{ width: '100%', background: 'none', border: 'none', padding: '16px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            >
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>{section.title}</span>
              {openSection === section.key ? <ChevronUp size={18} color="#94a3b8" /> : <ChevronDown size={18} color="#94a3b8" />}
            </button>
            {openSection === section.key && (
              <div style={{ padding: '0 22px 20px' }}>{section.content}</div>
            )}
          </div>
        ))}

      </div>
    </div>
  )
}