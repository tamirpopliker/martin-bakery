import { useState, useEffect } from 'react'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept } from '../lib/supabase'
import type { GlobalEmployee } from '../lib/supabase'
import { ArrowRight, TrendingUp, TrendingDown, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { usePeriod } from '../lib/PeriodContext'
import { getMonthsInRange } from '../lib/period'
import PeriodPicker from '../components/PeriodPicker'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Props { onBack: () => void }
type Dept = 'creams' | 'dough' | 'packaging' | 'cleaning'

interface KpiTargets {
  labor_pct: number; waste_pct: number; repairs_pct: number
  gross_profit_pct: number; production_pct: number; operating_profit_pct: number
}

// ─── קבועים ──────────────────────────────────────────────────────────────────
const DEPTS: Dept[] = ['creams', 'dough', 'packaging', 'cleaning']
const DEPT_LABELS: Record<Dept, string> = { creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה', cleaning: 'ניקיון/נהג' }
const DEPT_COLORS: Record<Dept, string> = { creams: '#3b82f6', dough: '#8b5cf6', packaging: '#0ea5e9', cleaning: '#64748b' }

const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString()
const fmtP = (n: number) => n.toFixed(1) + '%'
const pct  = (a: number, b: number) => b > 0 ? (a / b) * 100 : 0

const DEFAULT_TARGETS: KpiTargets = { labor_pct: 25, waste_pct: 5, repairs_pct: 3, gross_profit_pct: 40, production_pct: 45, operating_profit_pct: 30 }

function kpiColor(actual: number, target: number, higherIsBetter = false) {
  const diff = higherIsBetter ? actual - target : target - actual
  if (diff >= 0)  return '#10b981'
  if (diff >= -3) return '#f59e0b'
  if (diff >= -7) return '#f97316'
  return '#ef4444'
}

function DiffBadge({ curr, prev, inverse }: { curr: number; prev: number; inverse?: boolean }) {
  if (prev === 0 && curr === 0) return null
  if (prev === 0) return null
  const d = ((curr - prev) / Math.abs(prev)) * 100
  const up = d > 0
  const good = inverse ? !up : up
  const color = Math.abs(d) < 1 ? '#94a3b8' : good ? '#10b981' : '#ef4444'
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontWeight: '700', color, marginTop: '2px' }}>
      <Icon size={12} /> {Math.abs(d).toFixed(1)}%
    </span>
  )
}

// ─── צבע יחס ייצור ──────────────────────────────────────────────────────────
function prodRatioColor(ratio: number): string {
  if (ratio >= 1.1) return '#047857'   // ירוק כהה — יעילות גבוהה
  if (ratio >= 1.0) return '#10b981'   // ירוק — התאמה
  if (ratio >= 0.9) return '#f59e0b'   // כתום — סביר
  return '#ef4444'                      // אדום — בזבוז
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
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid #1e293b',
        }} />
      </div>
    </div>
  )
}

// ─── קומפוננטה ראשית ──────────────────────────────────────────────────────────
export default function FactoryDashboard({ onBack }: Props) {
  const { period, setPeriod, from, to, monthKey, comparisonPeriod } = usePeriod()
  const [loading, setLoading] = useState(true)
  const [openSection, setOpenSection] = useState<string | null>(null)

  // ─── נתונים ─────────────────────────────────────────────────────────────
  // מכירות
  const [salesCreams, setSalesCreams]   = useState(0)
  const [salesDough, setSalesDough]     = useState(0)
  const [salesB2B, setSalesB2B]         = useState(0)
  const [salesMisc, setSalesMisc]       = useState(0)
  const [salesInternal, setSalesInternal] = useState(0)

  // ספקים (מ-factory_b2b_sales misc, מקובץ לפי customer)
  const [supplierRows, setSupplierRows] = useState<{ name: string; total: number }[]>([])
  const [totalSuppliers, setTotalSuppliers] = useState(0)

  // פחת לפי מחלקה
  const [wasteDept, setWasteDept] = useState<Record<Dept, number>>({ creams: 0, dough: 0, packaging: 0, cleaning: 0 })

  // עלות ייצור לפי מחלקה
  const [prodDept, setProdDept] = useState<Record<string, number>>({ creams: 0, dough: 0, packaging: 0 })

  // תיקונים לפי מחלקה
  const [repairsDept, setRepairsDept] = useState<Record<Dept, number>>({ creams: 0, dough: 0, packaging: 0, cleaning: 0 })

  // לייבור לפי מחלקה
  const [laborDept, setLaborDept] = useState<Record<Dept, { hours: number; gross: number; employer: number }>>({
    creams: { hours: 0, gross: 0, employer: 0 }, dough: { hours: 0, gross: 0, employer: 0 },
    packaging: { hours: 0, gross: 0, employer: 0 }, cleaning: { hours: 0, gross: 0, employer: 0 },
  })

  // עלויות קבועות
  const [fixedCosts, setFixedCosts] = useState(0)

  // KPI targets
  const [targets, setTargets] = useState<KpiTargets>(DEFAULT_TARGETS)

  // עובדים גלובליים
  const [globalEmps, setGlobalEmps] = useState<GlobalEmployee[]>([])
  const [wdCount, setWdCount] = useState(26)

  // חודש קודם
  const [prev, setPrev] = useState({ sales: 0, suppliers: 0, waste: 0, repairs: 0, labor: 0, production: 0 })

  // ─── שליפת נתונים ────────────────────────────────────────────────────────
  async function fetchAll() {
    setLoading(true)

    const [
      salesFs, salesB2b,
      wasteRes, repairsRes, laborRes,
      fixedRes, kpiRes,
      suppInvRes, suppNamesRes,
      globalEmpsData, wdData,
      prodRes,
    ] = await Promise.all([
      supabase.from('factory_sales').select('department, amount, is_internal').gte('date', from).lt('date', to),
      supabase.from('factory_b2b_sales').select('sale_type, customer, amount, is_internal').gte('date', from).lt('date', to),
      supabase.from('factory_waste').select('department, amount').gte('date', from).lt('date', to),
      supabase.from('factory_repairs').select('department, amount').gte('date', from).lt('date', to),
      supabase.from('labor').select('entity_id, hours_100, hours_125, hours_150, gross_salary, employer_cost').eq('entity_type', 'factory').gte('date', from).lt('date', to),
      monthKey
        ? supabase.from('fixed_costs').select('amount').eq('entity_type', 'factory').eq('month', monthKey)
        : supabase.from('fixed_costs').select('amount').eq('entity_type', 'factory').in('month', getMonthsInRange(from, to)),
      supabase.from('kpi_targets').select('*'),
      supabase.from('supplier_invoices').select('supplier_id, amount').gte('date', from).lt('date', to),
      supabase.from('suppliers').select('id, name'),
      fetchGlobalEmployees(),
      getWorkingDays(monthKey || from.slice(0, 7)),
      supabase.from('daily_production').select('department, amount').gte('date', from).lt('date', to),
    ])

    // ── עובדים גלובליים ──
    setGlobalEmps(globalEmpsData)
    setWdCount(wdData)

    // ── מכירות ──
    const fs = salesFs.data || []
    setSalesCreams(fs.filter((r: any) => r.department === 'creams').reduce((s: number, r: any) => s + Number(r.amount), 0))
    setSalesDough(fs.filter((r: any) => r.department === 'dough').reduce((s: number, r: any) => s + Number(r.amount), 0))

    const b2b = salesB2b.data || []
    setSalesB2B(b2b.filter((r: any) => r.sale_type === 'b2b').reduce((s: number, r: any) => s + Number(r.amount), 0))

    // שונות (misc) — הכנסה, לא ספקים
    const miscTotal = b2b.filter((r: any) => r.sale_type === 'misc').reduce((s: number, r: any) => s + Number(r.amount), 0)
    setSalesMisc(miscTotal)

    // מכירות פנימיות לסניפים (subset of the above — for display)
    const internalFsTotal = fs.filter((r: any) => r.is_internal).reduce((s: number, r: any) => s + Number(r.amount), 0)
    const internalB2bTotal = b2b.filter((r: any) => r.is_internal).reduce((s: number, r: any) => s + Number(r.amount), 0)
    setSalesInternal(internalFsTotal + internalB2bTotal)

    // ── ספקים (מטבלת supplier_invoices) ──
    const suppInvData = suppInvRes.data || []
    const suppTotal = suppInvData.reduce((s: number, r: any) => s + Number(r.amount), 0)
    setTotalSuppliers(suppTotal)

    // דירוג ספקים (מקובץ לפי supplier_id → שם)
    const idToName: Record<number, string> = {}
    if (suppNamesRes.data) suppNamesRes.data.forEach((s: any) => { idToName[s.id] = s.name })
    const supMap: Record<string, number> = {}
    suppInvData.forEach((r: any) => {
      const name = idToName[r.supplier_id] || `ספק #${r.supplier_id}`
      supMap[name] = (supMap[name] || 0) + Number(r.amount)
    })
    const supArr = Object.entries(supMap).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total)
    setSupplierRows(supArr)

    // ── פחת ──
    const wData = wasteRes.data || []
    const wDept: Record<Dept, number> = { creams: 0, dough: 0, packaging: 0, cleaning: 0 }
    wData.forEach((r: any) => { if (wDept[r.department as Dept] !== undefined) wDept[r.department as Dept] += Number(r.amount) })
    setWasteDept(wDept)

    // ── עלות ייצור ──
    const prodData = prodRes.data || []
    const pDeptMap: Record<string, number> = { creams: 0, dough: 0, packaging: 0 }
    prodData.forEach((r: any) => { if (pDeptMap[r.department] !== undefined) pDeptMap[r.department] += Number(r.amount) })
    setProdDept(pDeptMap)

    // ── תיקונים ──
    const rData = repairsRes.data || []
    const rDept: Record<Dept, number> = { creams: 0, dough: 0, packaging: 0, cleaning: 0 }
    rData.forEach((r: any) => { if (rDept[r.department as Dept] !== undefined) rDept[r.department as Dept] += Number(r.amount) })
    setRepairsDept(rDept)

    // ── לייבור ──
    const lData = laborRes.data || []
    const lDept: Record<Dept, { hours: number; gross: number; employer: number }> = {
      creams: { hours: 0, gross: 0, employer: 0 }, dough: { hours: 0, gross: 0, employer: 0 },
      packaging: { hours: 0, gross: 0, employer: 0 }, cleaning: { hours: 0, gross: 0, employer: 0 },
    }
    lData.forEach((r: any) => {
      const d = r.entity_id as Dept
      if (lDept[d]) {
        lDept[d].hours    += Number(r.hours_100 || 0) + Number(r.hours_125 || 0) + Number(r.hours_150 || 0)
        lDept[d].gross    += Number(r.gross_salary || 0)
        lDept[d].employer += Number(r.employer_cost || 0)
      }
    })
    setLaborDept(lDept)

    // ── עלויות קבועות ──
    const fData = fixedRes.data || []
    setFixedCosts(fData.reduce((s: number, r: any) => s + Number(r.amount), 0))

    // ── KPI ──
    const kData = kpiRes.data || []
    if (kData.length > 0) {
      // ממוצע של כל המחלקות
      const avg: KpiTargets = { ...DEFAULT_TARGETS }
      const fields: (keyof KpiTargets)[] = ['labor_pct', 'waste_pct', 'repairs_pct', 'gross_profit_pct', 'production_pct']
      fields.forEach(f => {
        const vals = kData.map((r: any) => Number(r[f])).filter(Boolean)
        if (vals.length) avg[f] = vals.reduce((s, v) => s + v, 0) / vals.length
      })
      setTargets(avg)
    }

    // ── חודש קודם ──
    const pFrom = comparisonPeriod.from, pTo = comparisonPeriod.to
    const [pSales, pB2b, pWaste, pRepairs, pLabor, pSupp, pWd, pProd] = await Promise.all([
      supabase.from('factory_sales').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_b2b_sales').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_waste').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('factory_repairs').select('amount').gte('date', pFrom).lt('date', pTo),
      supabase.from('labor').select('employer_cost').eq('entity_type', 'factory').gte('date', pFrom).lt('date', pTo),
      supabase.from('supplier_invoices').select('amount').gte('date', pFrom).lt('date', pTo),
      getWorkingDays(comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)),
      supabase.from('daily_production').select('amount').gte('date', pFrom).lt('date', pTo),
    ])
    const sum = (res: any) => (res.data || []).reduce((s: number, r: any) => s + Number(r.amount || r.employer_cost || 0), 0)
    const pSalesTotal = sum(pSales) + sum(pB2b)
    const pGlobalLaborCreams = calcGlobalLaborForDept(globalEmpsData, 'creams', pWd)
    const pGlobalLaborDough = calcGlobalLaborForDept(globalEmpsData, 'dough', pWd)
    const pTotalGlobalLabor = pGlobalLaborCreams + pGlobalLaborDough
    setPrev({ sales: pSalesTotal, suppliers: sum(pSupp), waste: sum(pWaste), repairs: sum(pRepairs), labor: sum(pLabor) + pTotalGlobalLabor, production: sum(pProd) })

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [from, to])

  // ─── חישובים ─────────────────────────────────────────────────────────────
  const totalSales   = salesCreams + salesDough + salesB2B + salesMisc
  const totalWaste   = DEPTS.reduce((s, d) => s + wasteDept[d], 0)
  const totalRepairs = DEPTS.reduce((s, d) => s + repairsDept[d], 0)
  const hourlyLabor  = DEPTS.reduce((s, d) => s + laborDept[d].employer, 0)
  const totalGross   = DEPTS.reduce((s, d) => s + laborDept[d].gross, 0)
  const totalHours   = DEPTS.reduce((s, d) => s + laborDept[d].hours, 0)

  // עובדים גלובליים — עלות מעסיק לפי מחלקה
  const globalLaborCreams = calcGlobalLaborForDept(globalEmps, 'creams', wdCount)
  const globalLaborDough  = calcGlobalLaborForDept(globalEmps, 'dough', wdCount)
  const totalGlobalLabor  = globalLaborCreams + globalLaborDough
  const totalLabor        = hourlyLabor + totalGlobalLabor
  const totalProduction   = prodDept.creams + prodDept.dough + prodDept.packaging
  const productionRatio   = (totalLabor + totalSuppliers) > 0 ? totalProduction / (totalLabor + totalSuppliers) : 0

  // נוסחת רווח — שתי שורות
  const grossProfit     = totalSales - totalLabor - totalSuppliers
  const operatingProfit = grossProfit - fixedCosts - totalWaste - totalRepairs

  // KPI
  const laborPct    = pct(totalLabor, totalSales)
  const wastePct    = pct(totalWaste, totalSales)
  const repairsPct  = pct(totalRepairs, totalSales)
  const grossPct    = pct(grossProfit, totalSales)
  const operatingPct = pct(operatingProfit, totalSales)

  // חישוב רווח חודש קודם (ל-DiffBadge)
  const prevGrossProfit     = prev.sales - prev.labor - prev.suppliers
  const prevOperatingProfit = prevGrossProfit - prev.waste - prev.repairs

  // ─── סגנונות ─────────────────────────────────────────────────────────────
  const S = {
    page: { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card: { background: 'white', borderRadius: '20px', padding: '22px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  }

  function toggle(key: string) { setOpenSection(openSection === key ? null : key) }

  if (loading) return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#94a3b8', fontSize: '16px' }}>טוען נתונים...</div>
    </div>
  )

  return (
    <div style={S.page}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' as const }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '40px', height: '40px', background: '#e0e7ff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <TrendingUp size={20} color="#6366f1" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>דשבורד מפעל</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>סיכום כלל המחלקות · KPI · רווח תפעולי</p>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1200px', margin: '0 auto' }}>

        {/* ─── התראות חריגה (הועברו למעלה) ──────────────────────────────── */}
        {(() => {
          const anomalies: { label: string; actual: number; target: number; color: string }[] = []
          if (wastePct > targets.waste_pct + 2)
            anomalies.push({ label: '⚠️ פחת חריג', actual: wastePct, target: targets.waste_pct, color: '#ef4444' })
          if (laborPct > targets.labor_pct + 3)
            anomalies.push({ label: '⚠️ לייבור חורג', actual: laborPct, target: targets.labor_pct, color: '#f59e0b' })
          if (repairsPct > targets.repairs_pct + 2)
            anomalies.push({ label: '⚠️ תיקונים חריגים', actual: repairsPct, target: targets.repairs_pct, color: '#f97316' })
          if (grossPct < targets.gross_profit_pct - 5)
            anomalies.push({ label: '⚠️ רווח גולמי נמוך', actual: grossPct, target: targets.gross_profit_pct, color: '#ef4444' })
          if (anomalies.length === 0) return null
          return (
            <div style={{ marginBottom: '16px' }}>
              {anomalies.map(a => (
                <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: a.color + '12', border: `1.5px solid ${a.color}40`, borderRadius: '14px', padding: '12px 18px', marginBottom: '8px' }}>
                  <AlertTriangle size={18} color={a.color} />
                  <span style={{ fontWeight: '700', color: a.color, fontSize: '13px' }}>{a.label}</span>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>
                    בפועל: {a.actual.toFixed(1)}% · יעד: {a.target.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* ─── נוסחת רווח (Hero — הועברה למעלה) ────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
          <KpiTooltip text="הכנסות פחות עלויות ישירות (שכר + חומרי גלם) — הרווח לפני הוצאות תפעול">
            <div style={{ background: 'white', borderRadius: '16px', padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRight: `4px solid ${grossProfit >= 0 ? '#10b981' : '#ef4444'}` }}>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>מכירות − לייבור − ספקים</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>{fmtM(totalSales)} − {fmtM(totalLabor)} − {fmtM(totalSuppliers)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '32px', fontWeight: '800', color: grossProfit >= 0 ? '#10b981' : '#ef4444' }}>= רווח גולמי {fmtM(grossProfit)}</span>
                <DiffBadge curr={grossProfit} prev={prevGrossProfit} />
              </div>
            </div>
          </KpiTooltip>
          <KpiTooltip text="השורה התחתונה — מה שנשאר אחרי כל ההוצאות כולל עלויות קבועות, פחת ותיקונים">
            <div style={{ background: 'white', borderRadius: '16px', padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRight: `4px solid ${operatingProfit >= 0 ? '#10b981' : '#ef4444'}` }}>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>רווח גולמי − עלויות קבועות − פחת − תיקונים</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>{fmtM(grossProfit)} − {fmtM(fixedCosts)} − {fmtM(totalWaste)} − {fmtM(totalRepairs)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '32px', fontWeight: '800', color: operatingProfit >= 0 ? '#10b981' : '#ef4444' }}>= רווח תפעולי {fmtM(operatingProfit)}</span>
                <DiffBadge curr={operatingProfit} prev={prevOperatingProfit} />
              </div>
            </div>
          </KpiTooltip>
        </div>

        {/* ─── כותרת: סיכום חודשי ─────────────────────────────────────── */}
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', marginBottom: '10px', letterSpacing: '0.5px' }}>סיכום חודשי</div>

        {/* ─── 6 כרטיסי סיכום (קומפקטיים) ────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
          {[
            { key: 'sales',      label: 'מכירות',          val: totalSales,       prev: prev.sales,       color: '#3b82f6', bg: '#eff6ff',  icon: '💰', inv: false, tooltip: 'סה״כ הכנסות מכל המקורות — קרמים, בצקים, B2B ושונות' },
            { key: 'suppliers',  label: 'ספקים (חומ"ג)',    val: totalSuppliers,   prev: prev.suppliers,   color: '#64748b', bg: '#f8fafc',  icon: '🏢', inv: true,  tooltip: 'סה״כ חשבוניות ספקים — חומרי גלם ואריזה' },
            { key: 'production', label: 'עלות ייצור',       val: totalProduction,  prev: prev.production,  color: '#059669', bg: '#ecfdf5',  icon: '🏭', inv: true,  tooltip: 'סה״כ ייצור יומי מדווח — לחץ לפירוט לפי מחלקות ויחס ייצור' },
            { key: 'waste',      label: 'פחת',              val: totalWaste,       prev: prev.waste,       color: '#ef4444', bg: '#fef2f2',  icon: '🗑️', inv: true,  tooltip: 'סחורה שהלכה לפח — לחץ לפירוט לפי מחלקות' },
            { key: 'repairs',    label: 'תיקונים/ציוד',     val: totalRepairs,     prev: prev.repairs,     color: '#f97316', bg: '#fff7ed',  icon: '🔧', inv: true,  tooltip: 'תחזוקה ותיקון ציוד — לחץ לפירוט לפי מחלקות' },
            { key: 'labor',      label: 'לייבור',           val: totalLabor,       prev: prev.labor,       color: '#f59e0b', bg: '#fffbeb',  icon: '👷', inv: true,  tooltip: 'עלות מעסיק כוללת — שעתיים × 1.3 + בונוסים + גלובליים' },
          ].map(c => {
            const isOpen = openSection === c.key
            return (
              <KpiTooltip key={c.key} text={c.tooltip}>
                <button onClick={() => toggle(c.key)}
                  style={{ width: '100%', background: isOpen ? c.color : c.bg, border: `1.5px solid ${c.color}33`, borderRadius: '14px', padding: '12px 14px', cursor: 'pointer', textAlign: 'right', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '17px', fontWeight: '800', color: isOpen ? 'white' : c.color }}>{fmtM(c.val)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      <span style={{ fontSize: '11px', color: isOpen ? 'rgba(255,255,255,0.7)' : '#64748b' }}>{c.label}</span>
                      <DiffBadge curr={c.val} prev={c.prev} inverse={c.inv} />
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={14} color={isOpen ? 'rgba(255,255,255,0.6)' : '#cbd5e1'} /> : <ChevronDown size={14} color="#cbd5e1" />}
                </button>
              </KpiTooltip>
            )
          })}
        </div>

        {/* ─── Drilldowns ─────────────────────────────────────────────────── */}
        {openSection === 'sales' && (
          <div style={{ ...S.card, marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>💰 פירוט מכירות לפי מקור</h3>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              {[
                { label: 'קרמים', val: salesCreams, tab: 'קרמים', color: '#3b82f6' },
                { label: 'בצקים', val: salesDough,  tab: 'בצקים', color: '#8b5cf6' },
                { label: 'B2B',   val: salesB2B,    tab: 'B2B',   color: '#6366f1' },
                { label: 'שונות', val: salesMisc,   tab: 'שונות', color: '#10b981' },
              ].map((r, i) => (
                <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px 80px', padding: '12px 18px', borderBottom: i < 3 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600', color: '#374151' }}>{r.label}</span>
                  <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct(r.val, totalSales)}%`, background: r.color, borderRadius: '4px' }} />
                  </div>
                  <span style={{ fontWeight: '800', color: r.color, textAlign: 'left' as const }}>{fmtM(r.val)}</span>
                  <span style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'left' as const }}>{fmtP(pct(r.val, totalSales))}</span>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px 80px', padding: '14px 18px', background: '#eff6ff', borderTop: '2px solid #bfdbfe', fontWeight: '800' }}>
                <span style={{ color: '#374151' }}>סה"כ</span><span />
                <span style={{ color: '#3b82f6', textAlign: 'left' as const }}>{fmtM(totalSales)}</span>
                <span style={{ color: '#3b82f6', textAlign: 'left' as const }}>100%</span>
              </div>
              {salesInternal > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px 80px', padding: '12px 18px', background: '#faf5ff', borderTop: '1px dashed #c084fc', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600', color: '#7c3aed', fontSize: '12px' }}>מתוכם — סניפים</span>
                  <div />
                  <span style={{ fontWeight: '700', color: '#7c3aed', textAlign: 'left' as const }}>{fmtM(salesInternal)}</span>
                  <span style={{ fontSize: '12px', color: '#a78bfa', textAlign: 'left' as const }}>{fmtP(pct(salesInternal, totalSales))}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {openSection === 'suppliers' && (
          <div style={{ ...S.card, marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>🏢 דירוג ספקים (חומ"ג)</h3>
            {supplierRows.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>אין נתונים</div>
            ) : (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 130px 1fr 110px 70px', padding: '10px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                  <span>#</span><span>ספק</span><span></span><span style={{ textAlign: 'left' as const }}>סכום</span><span style={{ textAlign: 'left' as const }}>%</span>
                </div>
                {supplierRows.map((s, i) => (
                  <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '40px 130px 1fr 110px 70px', padding: '11px 18px', borderBottom: i < supplierRows.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa', alignItems: 'center' }}>
                    <span style={{ width: '24px', height: '24px', background: i < 3 ? '#64748b' : '#f1f5f9', color: i < 3 ? 'white' : '#64748b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700' }}>{i + 1}</span>
                    <span style={{ fontWeight: '600', color: '#374151', fontSize: '12px' }}>{s.name}</span>
                    <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct(s.total, totalSuppliers)}%`, background: '#64748b', borderRadius: '4px', minWidth: s.total > 0 ? '4px' : '0' }} />
                    </div>
                    <span style={{ fontWeight: '700', color: '#0f172a', textAlign: 'left' as const, fontSize: '12px' }}>{fmtM(s.total)}</span>
                    <span style={{ fontSize: '11px', color: '#64748b', textAlign: 'left' as const }}>{fmtP(pct(s.total, totalSuppliers))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {openSection === 'waste' && (
          <div style={{ ...S.card, marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>🗑️ פחת לפי מחלקות</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {(['creams', 'dough', 'packaging'] as Dept[]).map(d => (
                <div key={d} style={{ background: '#fef2f2', borderRadius: '14px', padding: '18px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: '800', color: '#ef4444' }}>{fmtM(wasteDept[d])}</div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>{DEPT_LABELS[d]}</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{fmtP(pct(wasteDept[d], totalSales))} מהכנסות</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {openSection === 'repairs' && (
          <div style={{ ...S.card, marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>🔧 תיקונים/ציוד לפי מחלקות</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {DEPTS.map(d => (
                <div key={d} style={{ background: '#fff7ed', borderRadius: '14px', padding: '18px', textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: '800', color: '#f97316' }}>{fmtM(repairsDept[d])}</div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>{DEPT_LABELS[d]}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {openSection === 'production' && (
          <div style={{ ...S.card, marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>🏭 עלות ייצור לפי מחלקות</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
              {(['creams', 'dough', 'packaging'] as const).map(d => (
                <div key={d} style={{ background: '#ecfdf5', borderRadius: '14px', padding: '18px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: '800', color: '#059669' }}>{fmtM(prodDept[d])}</div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>{{ creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה' }[d]}</div>
                  {totalProduction > 0 && (
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{fmtP(pct(prodDept[d], totalProduction))} מסה"כ ייצור</div>
                  )}
                </div>
              ))}
            </div>
            {/* מדד ייצור / (לייבור+ספקים) */}
            <div style={{ background: productionRatio >= 1 ? '#f0fdf4' : '#fef2f2', border: `1.5px solid ${productionRatio >= 1 ? '#86efac' : '#fca5a5'}`, borderRadius: '14px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>יחס ייצור / (לייבור + ספקים)</div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{fmtM(totalProduction)} / ({fmtM(totalLabor)} + {fmtM(totalSuppliers)})</div>
              </div>
              <div style={{ fontSize: '28px', fontWeight: '800', color: prodRatioColor(productionRatio) }}>
                {productionRatio.toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {openSection === 'labor' && (
          <div style={{ ...S.card, marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>👷 לייבור לפי מחלקות</h3>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(3, 1fr)', padding: '10px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>מחלקה</span><span style={{ textAlign: 'center' }}>שעות</span><span style={{ textAlign: 'center' }}>ברוטו</span><span style={{ textAlign: 'center' }}>עלות מעסיק</span>
              </div>
              {(() => {
                const globalByDept: Record<Dept, number> = { creams: globalLaborCreams, dough: globalLaborDough, packaging: 0, cleaning: 0 }
                return DEPTS.map((d, i) => {
                  const deptTotal = laborDept[d].employer + globalByDept[d]
                  return (
                    <div key={d} style={{ display: 'grid', gridTemplateColumns: '120px repeat(3, 1fr)', padding: '12px 18px', borderBottom: i < 3 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa', alignItems: 'center' }}>
                      <span style={{ fontWeight: '600', color: DEPT_COLORS[d] }}>{DEPT_LABELS[d]}</span>
                      <span style={{ textAlign: 'center', color: '#64748b' }}>{laborDept[d].hours.toFixed(1)}</span>
                      <span style={{ textAlign: 'center', fontWeight: '700', color: '#374151' }}>{fmtM(laborDept[d].gross)}</span>
                      <span style={{ textAlign: 'center', fontWeight: '700', color: '#ef4444' }}>
                        {fmtM(deptTotal)}
                        {globalByDept[d] > 0 && <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block' }}>כולל גלובלי {fmtM(globalByDept[d])}</span>}
                      </span>
                    </div>
                  )
                })
              })()}
              <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(3, 1fr)', padding: '14px 18px', background: '#fffbeb', borderTop: '2px solid #fde68a', fontWeight: '800' }}>
                <span style={{ color: '#374151' }}>סה"כ</span>
                <span style={{ textAlign: 'center', color: '#64748b' }}>{totalHours.toFixed(1)}</span>
                <span style={{ textAlign: 'center', color: '#374151' }}>{fmtM(totalGross)}</span>
                <span style={{ textAlign: 'center', color: '#ef4444' }}>{fmtM(totalLabor)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ─── כותרת: מדדי KPI ──────────────────────────────────────── */}
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', marginBottom: '10px', marginTop: '6px', letterSpacing: '0.5px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>מדדי KPI</div>

        {/* ─── יחס ייצור — כרטיס ייעודי ──────────────────────────── */}
        {(totalLabor + totalSuppliers) > 0 && (
          <div style={{ background: 'white', borderRadius: '14px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderRight: `4px solid ${prodRatioColor(productionRatio)}`, marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>יחס ייצור</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{fmtM(totalProduction)} / ({fmtM(totalLabor)} + {fmtM(totalSuppliers)})</div>
            </div>
            <KpiTooltip text={'יחס בין דוח הייצור לעלויות בפועל (חומ"ג + לייבור) · 1.0 = התאמה מלאה · פחות מ-1 = בזבוז חומרי גלם · מעל 1 = ניצול יעיל'}>
              <div style={{ fontSize: '28px', fontWeight: '800', color: prodRatioColor(productionRatio), cursor: 'default' }}>
                {productionRatio.toFixed(2)}
              </div>
            </KpiTooltip>
          </div>
        )}

        {/* ─── KPI מדדים — 5 בשורה ──────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '20px' }}>
          {[
            { label: 'לייבור / הכנסות', val: laborPct,     target: targets.labor_pct,            higher: false, tooltip: `מכל ₪ שנכנס כמה הלך לשכר · יעד: עד ${targets.labor_pct}%` },
            { label: 'פחת / הכנסות',    val: wastePct,      target: targets.waste_pct,             higher: false, tooltip: `פחת זה כסף שהלך לפח — כל אחוז פחות משפר את הרווח · יעד: עד ${targets.waste_pct}%` },
            { label: 'תיקונים / הכנסות',val: repairsPct,    target: targets.repairs_pct,           higher: false, tooltip: `כמה עלה תחזוק וציוד ביחס להכנסות · יעד: עד ${targets.repairs_pct}%` },
            { label: 'רווח גולמי %',    val: grossPct,      target: targets.gross_profit_pct,      higher: true,  tooltip: `אחוז הרווח הגולמי מההכנסות — מכירות פחות ספקים ולייבור · יעד: ${targets.gross_profit_pct}%` },
            { label: 'רווח תפעולי %',   val: operatingPct,  target: targets.operating_profit_pct,  higher: true,  tooltip: `אחוז הרווח הסופי מההכנסות — אחרי כל ההוצאות · יעד: מעל ${targets.operating_profit_pct}%` },
          ].map(k => {
            const color = kpiColor(k.val, k.target, k.higher)
            const diff = k.val - k.target
            return (
              <KpiTooltip key={k.label} text={k.tooltip}>
                <div style={{ background: 'white', borderRadius: '14px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderRight: `4px solid ${color}` }}>
                  <div style={{ fontSize: '22px', fontWeight: '800', color }}>{fmtP(k.val)}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>{k.label}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    <span style={{ fontSize: '10px', background: color + '20', color, padding: '1px 6px', borderRadius: '20px', fontWeight: '700' }}>
                      יעד {fmtP(k.target)}
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: '700', color: Math.abs(diff) < 1 ? '#94a3b8' : (diff > 0 ? (k.higher ? '#10b981' : '#ef4444') : (k.higher ? '#ef4444' : '#10b981')) }}>
                      {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </KpiTooltip>
            )
          })}
        </div>

        {/* ─── כותרת: דוח רווח והפסד ──────────────────────────────── */}
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', marginBottom: '10px', letterSpacing: '0.5px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>דוח רווח והפסד</div>

        {/* ─── טבלת רווח תפעולי ───────────────────────────────────────────── */}
        <div style={{ ...S.card }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>📊 טבלת רווח תפעולי</h3>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', fontSize: '13px' }}>
            {/* כותרת — 4 עמודות נתונים: קרמים, בצקים, B2B+שונות, אריזה+ניקיון */}
            <div style={{ display: 'grid', gridTemplateColumns: '140px repeat(4, 1fr) 110px 70px', padding: '10px 16px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#64748b', fontSize: '11px' }}>
              <span>שורה</span>
              <span style={{ textAlign: 'center' }}>קרמים</span>
              <span style={{ textAlign: 'center' }}>בצקים</span>
              <span style={{ textAlign: 'center' }}>B2B+שונות</span>
              <span style={{ textAlign: 'center' }}>אריזה+ניקיון</span>
              <span style={{ textAlign: 'left' as const }}>סה"כ</span>
              <span style={{ textAlign: 'left' as const }}>%</span>
            </div>

            {/* שורות — cols: קרמים, בצקים, b2b+שונות, אריזה+ניקיון */}
            {(() => {
              const packCleanLabor = laborDept.packaging.employer + laborDept.cleaning.employer
              const packCleanRepairs = repairsDept.packaging + repairsDept.cleaning
              const b2bMiscSales = salesB2B + salesMisc
              const creamsLaborTotal = laborDept.creams.employer + globalLaborCreams
              const doughLaborTotal  = laborDept.dough.employer + globalLaborDough

              const rows = [
                { label: 'מכירות',           c1: salesCreams,                         c2: salesDough,                        c3: b2bMiscSales,                                      c4: 0,                                              color: '#3b82f6', bold: true },
                { label: 'ספקים (חומ"ג)',     c1: 0,                                   c2: 0,                                 c3: 0,                                                 c4: 0,                                              color: '#64748b', neg: true, noSplit: true, totalOverride: totalSuppliers },
                { label: 'לייבור',           c1: creamsLaborTotal,                    c2: doughLaborTotal,                   c3: 0,                                                 c4: packCleanLabor,                                 color: '#f59e0b', neg: true },
                { label: 'רווח גולמי',       c1: salesCreams - creamsLaborTotal,      c2: salesDough - doughLaborTotal,      c3: b2bMiscSales,                                      c4: -packCleanLabor,                                color: grossProfit >= 0 ? '#10b981' : '#ef4444', bold: true, sep: true, totalOverride: grossProfit },
                { label: 'עלויות קבועות',    c1: 0,                                   c2: 0,                                 c3: 0,                                                 c4: 0,                                              color: '#64748b', neg: true, noSplit: true, totalOverride: fixedCosts },
                { label: 'פחת',              c1: wasteDept.creams,                    c2: wasteDept.dough,                   c3: 0,                                                 c4: wasteDept.packaging,                            color: '#ef4444', neg: true },
                { label: 'תיקונים/ציוד',     c1: repairsDept.creams,                  c2: repairsDept.dough,                 c3: 0,                                                 c4: packCleanRepairs,                               color: '#f97316', neg: true },
                { label: 'רווח תפעולי',      c1: 0,                                   c2: 0,                                 c3: 0,                                                 c4: 0,                                              color: operatingProfit >= 0 ? '#10b981' : '#ef4444', bold: true, sep: true, isOpProfit: true },
              ]

              return rows.map((row, i) => {
                const total = row.isOpProfit ? operatingProfit : row.totalOverride != null ? row.totalOverride : row.c1 + row.c2 + row.c3 + row.c4
                const rowPct = pct(Math.abs(total), totalSales)
                return (
                  <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '140px repeat(4, 1fr) 110px 70px', padding: '11px 16px', background: row.sep ? '#f8fafc' : i % 2 === 0 ? 'white' : '#fafafa', borderTop: row.sep ? '2px solid #e2e8f0' : '1px solid #f1f5f9', alignItems: 'center' }}>
                    <span style={{ fontWeight: row.bold ? '700' : '500', color: '#374151' }}>{row.label}</span>
                    {[row.c1, row.c2, row.c3, row.c4].map((val, j) => (
                      <span key={j} style={{ textAlign: 'center', fontWeight: row.bold ? '700' : '400', color: row.isOpProfit ? row.color : val === 0 ? '#94a3b8' : row.neg ? '#64748b' : row.color }}>
                        {row.isOpProfit ? '—' : row.noSplit ? '—' : val !== 0 ? fmtM(Math.abs(val)) : '—'}
                      </span>
                    ))}
                    <span style={{ fontWeight: '800', color: row.color, textAlign: 'left' as const }}>{fmtM(Math.abs(total))}</span>
                    <span style={{ fontWeight: '700', color: row.color, textAlign: 'left' as const, fontSize: '12px' }}>{totalSales > 0 ? fmtP(rowPct) : '—'}</span>
                  </div>
                )
              })
            })()}
          </div>
        </div>

      </div>
    </div>
  )
}
