import { useState, useEffect } from 'react'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept, countWorkingDaysInRange } from '../lib/supabase'
import type { GlobalEmployee } from '../lib/supabase'
import { ArrowRight, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle } from 'lucide-react'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
type Department = 'creams' | 'dough'

interface Props {
  department: Department
  onBack: () => void
}

interface DayData {
  date: string
  production: number   // ייצור (₪)
  sales: number        // מכירות (₪)
  waste: number        // פחת (₪)
  repairs: number      // תיקונים (₪)
  labor: number        // לייבור (₪)
}

interface KpiTarget {
  labor_pct: number       // יעד לייבור/הכנסות %
  waste_pct: number       // יעד פחת/הכנסות %
  repairs_pct: number     // יעד תיקונים/הכנסות %
  gross_profit_pct: number // יעד רווח גולמי %
}

// ─── קונפיגורציה ────────────────────────────────────────────────────────────
const DEPT_CONFIG = {
  creams: { label: 'קרמים', color: '#3b82f6', bg: '#dbeafe' },
  dough:  { label: 'בצקים', color: '#8b5cf6', bg: '#ede9fe' },
}

// יעדי ברירת מחדל — יוחלפו מהגדרות בעתיד
const DEFAULT_TARGETS: KpiTarget = {
  labor_pct: 25,
  waste_pct: 5,
  repairs_pct: 3,
  gross_profit_pct: 40,
}

// ─── עזרים ──────────────────────────────────────────────────────────────────
function pct(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

function fmtPct(n: number) { return n.toFixed(1) + '%' }
function fmtMoney(n: number) { return '₪' + Math.round(n).toLocaleString() }

// צבע KPI לפי חריגה — 4 רמות
function kpiColor(actual: number, target: number, higherIsBetter = false): { color: string; bg: string; label: string } {
  const diff = higherIsBetter ? actual - target : target - actual
  if (diff >= 0)              return { color: '#10b981', bg: '#f0fdf4', label: 'תקין' }
  if (diff >= -3)             return { color: '#f59e0b', bg: '#fffbeb', label: 'סביר' }
  if (diff >= -7)             return { color: '#f97316', bg: '#fff7ed', label: 'חריגה' }
  return                             { color: '#ef4444', bg: '#fef2f2', label: 'חריגה קריטית' }
}

// ─── KpiTooltip ──────────────────────────────────────────────────────────────
function KpiTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      <div style={{
        position: 'absolute',
        bottom: 'calc(100% + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#1e293b',
        color: 'white',
        fontSize: '13px',
        fontFamily: "'Segoe UI', Arial, sans-serif",
        padding: '8px 14px',
        borderRadius: '10px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        opacity: show ? 1 : 0,
        transition: 'opacity 0.15s ease',
        zIndex: 50,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      }}>
        {text}
        {/* חץ למטה */}
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid #1e293b',
        }} />
      </div>
    </div>
  )
}

// ─── גרף עמודות SVG ─────────────────────────────────────────────────────────
function BarChart({ data, color, labelKey, valueKey, maxVal }: {
  data: any[]; color: string; labelKey: string; valueKey: string; maxVal?: number
}) {
  if (!data.length) return <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px', padding: '24px' }}>אין נתונים</div>
  const max = maxVal || Math.max(...data.map(d => d[valueKey])) || 1
  const W = 600, H = 140, PAD = { top: 10, bottom: 28, left: 8, right: 8 }
  const barW = Math.max(8, (W - PAD.left - PAD.right) / data.length - 4)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '140px' }}>
      {data.map((d, i) => {
        const h = ((d[valueKey] || 0) / max) * (H - PAD.top - PAD.bottom)
        const x = PAD.left + i * ((W - PAD.left - PAD.right) / data.length) + ((W - PAD.left - PAD.right) / data.length - barW) / 2
        const y = H - PAD.bottom - h
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} rx={4} fill={color} opacity={0.85} />
            {data.length <= 14 && h > 12 && (
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="9" fill={color} fontWeight="700">
                {d[valueKey] >= 1000 ? Math.round(d[valueKey] / 1000) + 'K' : Math.round(d[valueKey])}
              </text>
            )}
            <text x={x + barW / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
              {d[labelKey]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── גרף קו כפול (השוואה) ───────────────────────────────────────────────────
function CompareLineChart({ current, previous, color }: {
  current: number[]; previous: number[]; color: string
}) {
  const all = [...current, ...previous].filter(Boolean)
  if (!all.length) return <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px', padding: '24px' }}>אין נתונים להשוואה</div>
  const max = Math.max(...all) || 1
  const W = 600, H = 120, PAD = { top: 10, bottom: 16, left: 8, right: 8 }
  const len = Math.max(current.length, previous.length)

  const toX = (i: number) => PAD.left + (i / (len - 1 || 1)) * (W - PAD.left - PAD.right)
  const toY = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom)

  const line = (arr: number[], clr: string, dash?: string) => {
    const pts = arr.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
    return <polyline points={pts} fill="none" stroke={clr} strokeWidth="2" strokeDasharray={dash} strokeLinejoin="round" />
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '120px' }}>
      {line(previous, '#cbd5e1', '5 3')}
      {line(current, color)}
      {current.map((v, i) => <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill={color} />)}
    </svg>
  )
}

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function DepartmentDashboard({ department, onBack }: Props) {
  const cfg = DEPT_CONFIG[department]

  const { period: globalPeriod, setPeriod: setGlobalPeriod, from, to, comparisonPeriod, monthKey } = usePeriod()
  const [days, setDays]           = useState<DayData[]>([])
  const [prevDays, setPrevDays]   = useState<DayData[]>([])
  const [loading, setLoading]     = useState(true)
  const [targets, setTargets]     = useState<KpiTarget>(DEFAULT_TARGETS)
  const [globalEmps, setGlobalEmps] = useState<GlobalEmployee[]>([])
  const [workingDaysMonth, setWorkingDaysMonth] = useState(26)


  // ─── שליפת נתונים ────────────────────────────────────────────────────────
  async function fetchRange(from: string, to: string): Promise<DayData[]> {
    const [prod, sales, waste, repairs, labor] = await Promise.all([
      supabase.from('daily_production').select('date,amount').eq('department', department).gte('date', from).lt('date', to),
      supabase.from('factory_sales').select('date,amount').eq('department', department).gte('date', from).lt('date', to),
      supabase.from('factory_waste').select('date,amount').eq('department', department).gte('date', from).lt('date', to),
      supabase.from('factory_repairs').select('date,amount').eq('department', department).gte('date', from).lt('date', to),
      supabase.from('labor').select('date,employer_cost').eq('entity_type', 'factory').eq('entity_id', department).gte('date', from).lt('date', to),
    ])

    // קיבוץ לפי יום
    const allDates = new Set([
      ...(prod.data || []).map((r: any) => r.date),
      ...(sales.data || []).map((r: any) => r.date),
      ...(waste.data || []).map((r: any) => r.date),
      ...(repairs.data || []).map((r: any) => r.date),
      ...(labor.data || []).map((r: any) => r.date),
    ])

    const sum = (arr: any[], dateStr: string, field: string) =>
      (arr || []).filter(r => r.date === dateStr).reduce((s: number, r: any) => s + Number(r[field] || 0), 0)

    return [...allDates].sort().map(date => ({
      date,
      production: sum(prod.data || [], date, 'amount'),
      sales:      sum(sales.data || [], date, 'amount'),
      waste:      sum(waste.data || [], date, 'amount'),
      repairs:    sum(repairs.data || [], date, 'amount'),
      labor:      sum(labor.data || [], date, 'employer_cost'),
    }))
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const prevFrom = comparisonPeriod.from
      const prevTo = comparisonPeriod.to
      const [cur, prv, kpiRes, gEmps, wDays] = await Promise.all([
        fetchRange(from, to),
        fetchRange(prevFrom, prevTo),
        supabase.from('kpi_targets').select('*').eq('department', department).single(),
        fetchGlobalEmployees(),
        getWorkingDays(monthKey || from.slice(0, 7)),
      ])
      setDays(cur)
      setPrevDays(prv)
      setGlobalEmps(gEmps)
      setWorkingDaysMonth(wDays)
      if (kpiRes.data) {
        setTargets({
          labor_pct: Number(kpiRes.data.labor_pct) || DEFAULT_TARGETS.labor_pct,
          waste_pct: Number(kpiRes.data.waste_pct) || DEFAULT_TARGETS.waste_pct,
          repairs_pct: Number(kpiRes.data.repairs_pct) || DEFAULT_TARGETS.repairs_pct,
          gross_profit_pct: Number(kpiRes.data.gross_profit_pct) || DEFAULT_TARGETS.gross_profit_pct,
        })
      }
      setLoading(false)
    }
    load()
  }, [from, to, department])

  // ─── אגרגטים ────────────────────────────────────────────────────────────
  const agg = (arr: DayData[], field: keyof DayData) => arr.reduce((s, d) => s + Number(d[field]), 0)

  const totalSales    = agg(days, 'sales')
  const totalProd     = agg(days, 'production')
  const totalWaste    = agg(days, 'waste')
  const totalRepairs  = agg(days, 'repairs')
  const hourlyLabor   = agg(days, 'labor')

  // חישוב ימי עבודה בתקופה הנוכחית לצורך חלוקת עובדים גלובליים
  const workingDaysInPeriod = countWorkingDaysInRange(from, to)
  const globalLaborCost = calcGlobalLaborForDept(globalEmps, department, workingDaysMonth, workingDaysInPeriod)
  const totalLabor      = hourlyLabor + globalLaborCost

  // רווח גולמי = מכירות − עלות ייצור − לייבור
  const grossProfit     = totalSales - totalProd - totalLabor
  // רווח תפעולי = רווח גולמי − פחת − תיקונים
  const operatingProfit = grossProfit - totalWaste - totalRepairs

  const prevSales       = agg(prevDays, 'sales')
  const prevProd        = agg(prevDays, 'production')
  const prevLabor       = agg(prevDays, 'labor')
  const prevGross       = prevSales - prevProd - prevLabor
  const prevOperating   = prevGross - agg(prevDays, 'waste') - agg(prevDays, 'repairs')

  // עובדים גלובליים רלוונטיים למחלקה זו
  const relevantGlobalEmps = globalEmps.filter(e => e.department === department || e.department === 'both')

  // KPI אחוזים
  const laborPct       = pct(totalLabor,       totalSales)
  const wastePct       = pct(totalWaste,       totalSales)
  const repairsPct     = pct(totalRepairs,     totalSales)
  const grossPct       = pct(grossProfit,      totalSales)
  const operatingPct   = pct(operatingProfit,  totalSales)

  // ─── KPI cards config ────────────────────────────────────────────────────
  const kpis = [
    { label: 'לייבור / הכנסות',  actual: laborPct,     target: targets.labor_pct,            higherIsBetter: false, amount: totalLabor, tooltip: `מכל ₪ שנכנס כמה הלך לשכר · יעד: עד ${targets.labor_pct}%` },
    { label: 'פחת / הכנסות',     actual: wastePct,     target: targets.waste_pct,             higherIsBetter: false, amount: totalWaste, tooltip: `פחת זה כסף שהלך לפח — כל אחוז פחות משפר את הרווח · יעד: עד ${targets.waste_pct}%` },
    { label: 'תיקונים / הכנסות', actual: repairsPct,   target: targets.repairs_pct,           higherIsBetter: false, amount: totalRepairs, tooltip: `כמה עלה תחזוק וציוד ביחס למה שנכנס · יעד: עד ${targets.repairs_pct}%` },
    { label: 'רווח גולמי %',     actual: grossPct,     target: targets.gross_profit_pct,      higherIsBetter: true,  amount: grossProfit, tooltip: `אחוז הרווח הגולמי מההכנסות — משקף יעילות ייצור · יעד: ${targets.gross_profit_pct}%` },
    { label: 'רווח תפעולי %',    actual: operatingPct, target: targets.gross_profit_pct - 10, higherIsBetter: true,  amount: operatingProfit, tooltip: `אחוז הרווח הסופי מההכנסות · יעד: מעל ${targets.gross_profit_pct - 10}%` },
  ]

  // נתונים לגרף עמודות יומי
  const chartDays = days.slice(-14).map(d => ({
    label: new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }),
    sales:   d.sales,
    labor:   d.labor,
    waste:   d.waste,
  }))

  // ─── רינדור ─────────────────────────────────────────────────────────────
  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '22px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  }

  if (loading) return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#94a3b8', fontSize: '16px' }}>טוען נתונים...</div>
    </div>
  )

  return (
    <div style={S.page}>

      {/* ─── כותרת ────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '40px', height: '40px', background: cfg.bg, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <TrendingUp size={20} color={cfg.color} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>דשבורד — {cfg.label}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>KPI · גרפים · פירוט יומי</p>
        </div>

        {/* בחירת תקופה */}
        <div style={{ marginRight: 'auto' }}>
          <PeriodPicker period={globalPeriod} onChange={setGlobalPeriod} />
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>

        {/* ─── סיכום כספי ────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'מכירות',       val: totalSales,      color: cfg.color,  bg: cfg.bg, tooltip: 'סה״כ מה שנמכר — לפני שמחסירים הוצאות' },
            { label: 'ייצור (עלות)', val: totalProd,       color: '#64748b',  bg: '#f1f5f9', tooltip: 'עלות חומרי הגלם שנצרכו בייצור — ספקים וחומרים' },
            { label: 'לייבור',       val: totalLabor,      color: '#f59e0b',  bg: '#fffbeb', tooltip: 'שכר ברוטו × 1.3 עלות מעביד + בונוסים — כולל שעתיים וגלובליים' },
            { label: 'פחת + תיקונים', val: totalWaste + totalRepairs, color: '#ef4444', bg: '#fef2f2', tooltip: 'סחורה שהלכה לפח וציוד שהתקלקל — שתי הוצאות שכדאי לצמצם' },
            { label: 'רווח גולמי',   val: grossProfit,     color: grossProfit >= 0 ? '#10b981' : '#ef4444', bg: grossProfit >= 0 ? '#f0fdf4' : '#fef2f2', tooltip: 'מכירות פחות עלות ייצור ולייבור — הרווח לפני הוצאות נוספות' },
            { label: 'רווח תפעולי',  val: operatingProfit, color: operatingProfit >= 0 ? '#10b981' : '#ef4444', bg: operatingProfit >= 0 ? '#f0fdf4' : '#fef2f2', tooltip: 'הרווח הסופי אחרי כל ההוצאות — השורה התחתונה' },
          ].map(s => (
            <KpiTooltip key={s.label} text={s.tooltip}>
              <div style={{ ...S.card, background: s.bg, border: `1px solid ${s.color}22`, padding: '16px 18px' }}>
                <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{fmtMoney(s.val)}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>{s.label}</div>
              </div>
            </KpiTooltip>
          ))}
        </div>

        {/* ─── KPI cards ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {kpis.map(kpi => {
            const style = kpiColor(kpi.actual, kpi.target, kpi.higherIsBetter)
            const diff = kpi.actual - kpi.target
            const Icon = diff === 0 ? Minus : (kpi.higherIsBetter ? (diff > 0 ? TrendingUp : TrendingDown) : (diff < 0 ? TrendingUp : TrendingDown))
            const iconColor = style.color
            return (
              <KpiTooltip key={kpi.label} text={kpi.tooltip}>
                <div style={{ ...S.card, background: style.bg, border: `1.5px solid ${style.color}33` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: style.color, background: style.color + '20', padding: '2px 8px', borderRadius: '20px' }}>{style.label}</span>
                    <Icon size={18} color={iconColor} />
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: '800', color: style.color }}>{fmtPct(kpi.actual)}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{kpi.label}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    יעד: {fmtPct(kpi.target)} · {fmtMoney(kpi.amount)}
                  </div>
                </div>
              </KpiTooltip>
            )
          })}
        </div>

        {/* ─── גרפים ─────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>

          {/* מכירות יומיות */}
          <div style={S.card}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '12px' }}>📊 מכירות יומיות</div>
            <BarChart data={chartDays} color={cfg.color} labelKey="label" valueKey="sales" />
          </div>

          {/* לייבור יומי */}
          <div style={S.card}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '12px' }}>👷 לייבור יומי</div>
            <BarChart data={chartDays} color="#f59e0b" labelKey="label" valueKey="labor" />
          </div>

          {/* השוואה לתקופה קודמת */}
          <div style={{ ...S.card, gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>📈 השוואה לתקופה קודמת — מכירות</span>
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '20px', height: '2px', background: cfg.color, display: 'inline-block', borderRadius: '2px' }} />
                  תקופה נוכחית
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '20px', height: '2px', background: '#cbd5e1', display: 'inline-block', borderRadius: '2px', borderTop: '2px dashed #cbd5e1' }} />
                  תקופה קודמת
                </span>
              </div>
            </div>
            <CompareLineChart
              current={days.map(d => d.sales)}
              previous={prevDays.map(d => d.sales)}
              color={cfg.color}
            />
            {/* השוואה מספרית */}
            <div style={{ display: 'flex', gap: '20px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
              {[
                { label: 'מכירות', cur: totalSales, prev: prevSales },
                { label: 'רווח גולמי', cur: grossProfit, prev: prevGross },
                { label: 'רווח תפעולי', cur: operatingProfit, prev: prevOperating },
              ].map(c => {
                const chg = c.prev !== 0 ? ((c.cur - c.prev) / Math.abs(c.prev)) * 100 : 0
                return (
                  <div key={c.label} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>{c.label}:</span>
                    <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>{fmtMoney(c.cur)}</span>
                    {c.prev > 0 && (
                      <span style={{ fontSize: '12px', fontWeight: '700', color: chg >= 0 ? '#10b981' : '#ef4444' }}>
                        {chg >= 0 ? '↑' : '↓'}{Math.abs(chg).toFixed(1)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ─── טבלת פירוט יומי ───────────────────────────────────────── */}
        <div style={S.card}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#374151', marginBottom: '16px' }}>📋 פירוט יומי</div>

          {/* כותרת */}
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '10px 16px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
            <span>תאריך</span>
            <span style={{ textAlign: 'left' }}>מכירות</span>
            <span style={{ textAlign: 'left' }}>ייצור</span>
            <span style={{ textAlign: 'left' }}>לייבור</span>
            <span style={{ textAlign: 'left' }}>פחת</span>
            <span style={{ textAlign: 'left' }}>תיקונים</span>
            <span style={{ textAlign: 'left' }}>רווח גולמי</span>
            <span style={{ textAlign: 'left' }}>רווח תפעולי</span>
          </div>

          {days.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>אין נתונים לתקופה זו</div>
          ) : [...days].reverse().map((d, i) => {
            const gp = d.sales - d.production - d.labor
            const op = gp - d.waste - d.repairs
            const gpStyle = kpiColor(pct(gp, d.sales), targets.gross_profit_pct, true)
            const opStyle = kpiColor(pct(op, d.sales), targets.gross_profit_pct - 10, true)
            return (
              <div key={d.date} style={{
                display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr 1fr 1fr 1fr',
                alignItems: 'center', padding: '12px 16px',
                borderBottom: i < days.length - 1 ? '1px solid #f1f5f9' : 'none',
                background: i % 2 === 0 ? 'white' : '#fafafa'
              }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>
                  {new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}
                </span>
                <span style={{ fontSize: '14px', fontWeight: '700', color: cfg.color }}>{d.sales > 0 ? fmtMoney(d.sales) : '—'}</span>
                <span style={{ fontSize: '13px', color: '#64748b' }}>{d.production > 0 ? fmtMoney(d.production) : '—'}</span>
                <span style={{ fontSize: '13px', color: '#f59e0b', fontWeight: d.labor > 0 ? '600' : '400' }}>{d.labor > 0 ? fmtMoney(d.labor) : '—'}</span>
                <span style={{ fontSize: '13px', color: '#ef4444', fontWeight: d.waste > 0 ? '600' : '400' }}>{d.waste > 0 ? fmtMoney(d.waste) : '—'}</span>
                <span style={{ fontSize: '13px', color: '#f97316', fontWeight: d.repairs > 0 ? '600' : '400' }}>{d.repairs > 0 ? fmtMoney(d.repairs) : '—'}</span>
                <span style={{
                  fontSize: '13px', fontWeight: '700',
                  color: gpStyle.color,
                  background: gpStyle.bg,
                  padding: '2px 8px', borderRadius: '6px', display: 'inline-block'
                }}>
                  {d.sales > 0 ? fmtMoney(gp) : '—'}
                </span>
                <span style={{
                  fontSize: '13px', fontWeight: '700',
                  color: opStyle.color,
                  background: opStyle.bg,
                  padding: '2px 8px', borderRadius: '6px', display: 'inline-block'
                }}>
                  {d.sales > 0 ? fmtMoney(op) : '—'}
                </span>
              </div>
            )
          })}

          {/* שורת סה"כ */}
          {days.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '14px 16px', background: cfg.bg, borderTop: `2px solid ${cfg.color}33`, borderRadius: '0 0 20px 20px', fontWeight: '700' }}>
              <span style={{ fontSize: '13px', color: '#374151' }}>סה"כ</span>
              <span style={{ color: cfg.color }}>{fmtMoney(totalSales)}</span>
              <span style={{ color: '#64748b' }}>{fmtMoney(totalProd)}</span>
              <span style={{ color: '#f59e0b' }}>{fmtMoney(totalLabor)}</span>
              <span style={{ color: '#ef4444' }}>{fmtMoney(totalWaste)}</span>
              <span style={{ color: '#f97316' }}>{fmtMoney(totalRepairs)}</span>
              <span style={{ color: grossProfit >= 0 ? '#10b981' : '#ef4444' }}>{fmtMoney(grossProfit)}</span>
              <span style={{ color: operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>{fmtMoney(operatingProfit)}</span>
            </div>
          )}
        </div>

        {/* ─── פירוט לייבור — עובדים גלובליים ──────────────────────── */}
        {relevantGlobalEmps.length > 0 && (
          <div style={{ ...S.card, marginTop: '20px' }}>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#374151', marginBottom: '16px' }}>👷 פירוט לייבור — עובדים גלובליים</div>

            {/* כותרת */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 70px 70px 70px 110px 120px', padding: '10px 16px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
              <span>עובד</span>
              <span style={{ textAlign: 'center' }}>ימים</span>
              <span style={{ textAlign: 'center' }}>100%</span>
              <span style={{ textAlign: 'center' }}>125%</span>
              <span style={{ textAlign: 'center' }}>150%</span>
              <span style={{ textAlign: 'left' }}>ברוטו</span>
              <span style={{ textAlign: 'left' }}>עלות מעסיק</span>
            </div>

            {relevantGlobalEmps.map((emp, i) => {
              const isBoth = emp.department === 'both'
              const factor = isBoth ? 0.5 : 1
              const bruto = emp.global_daily_rate
              const employerCost = bruto * 1.3 * factor * (workingDaysInPeriod / (workingDaysMonth || 1))
              return (
                <div key={emp.id} style={{
                  display: 'grid', gridTemplateColumns: '1.5fr 80px 70px 70px 70px 110px 120px',
                  alignItems: 'center', padding: '12px 16px',
                  borderBottom: i < relevantGlobalEmps.length - 1 ? '1px solid #f1f5f9' : 'none',
                  background: i % 2 === 0 ? 'white' : '#fafafa'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{emp.name}</span>
                    <span style={{ fontSize: '11px', background: '#f0fdf4', color: '#166534', padding: '1px 8px', borderRadius: '10px', fontWeight: '600' }}>גלובלי</span>
                    {isBoth && (
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>(50%)</span>
                    )}
                  </div>
                  <span style={{ fontSize: '13px', color: '#64748b', textAlign: 'center' }}>{workingDaysInPeriod}</span>
                  <span style={{ fontSize: '13px', color: '#cbd5e1', textAlign: 'center' }}>—</span>
                  <span style={{ fontSize: '13px', color: '#cbd5e1', textAlign: 'center' }}>—</span>
                  <span style={{ fontSize: '13px', color: '#cbd5e1', textAlign: 'center' }}>—</span>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>{fmtMoney(bruto)}</span>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: cfg.color }}>{fmtMoney(employerCost)}</span>
                </div>
              )
            })}

            {/* שורת סה"כ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 70px 70px 70px 110px 120px', padding: '14px 16px', background: cfg.bg, borderTop: `2px solid ${cfg.color}33`, borderRadius: '0 0 20px 20px', fontWeight: '700' }}>
              <span style={{ fontSize: '13px', color: '#374151' }}>סה"כ גלובלי</span>
              <span />
              <span />
              <span />
              <span />
              <span />
              <span style={{ color: cfg.color, fontSize: '15px' }}>{fmtMoney(globalLaborCost)}</span>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}