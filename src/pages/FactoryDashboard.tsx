import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase, fetchGlobalEmployees, getWorkingDays, calcGlobalLaborForDept } from '../lib/supabase'
import type { GlobalEmployee } from '../lib/supabase'
import { ArrowRight, TrendingUp, TrendingDown, ChevronDown, ChevronUp, AlertTriangle, Trash2, Wrench, Truck } from 'lucide-react'
import { RevenueIcon, ProfitIcon, LaborIcon, FixedCostIcon } from '@/components/icons'
import { usePeriod } from '../lib/PeriodContext'
import { getMonthsInRange } from '../lib/period'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'

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
const DEPT_COLORS: Record<Dept, string> = { creams: '#818cf8', dough: '#c084fc', packaging: '#0ea5e9', cleaning: '#64748b' }

const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString()
const fmtP = (n: number) => n.toFixed(1) + '%'
const pct  = (a: number, b: number) => b > 0 ? (a / b) * 100 : 0

const DEFAULT_TARGETS: KpiTargets = { labor_pct: 25, waste_pct: 5, repairs_pct: 3, gross_profit_pct: 40, production_pct: 45, operating_profit_pct: 30 }

function kpiColor(actual: number, target: number, higherIsBetter = false) {
  const diff = higherIsBetter ? actual - target : target - actual
  if (diff >= 0)  return '#34d399'
  if (diff >= -3) return '#fbbf24'
  if (diff >= -7) return '#f97316'
  return '#fb7185'
}

function DiffBadge({ curr, prev, inverse }: { curr: number; prev: number; inverse?: boolean }) {
  if (prev === 0 && curr === 0) return null
  if (prev === 0) return null
  const d = ((curr - prev) / Math.abs(prev)) * 100
  const up = d > 0
  const good = inverse ? !up : up
  const color = Math.abs(d) < 1 ? '#94a3b8' : good ? '#059669' : '#e11d48'
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold mt-0.5" style={{ color }}>
      <Icon size={12} /> {Math.abs(d).toFixed(1)}%
    </span>
  )
}

// ─── צבע יחס ייצור ──────────────────────────────────────────────────────────
function prodRatioColor(ratio: number): string {
  if (ratio >= 1.1) return '#047857'   // ירוק כהה — יעילות גבוהה
  if (ratio >= 1.0) return '#34d399'   // ירוק — התאמה
  if (ratio >= 0.9) return '#fbbf24'   // כתום — סביר
  return '#fb7185'                      // אדום — בזבוז
}

// ─── KpiTooltip ──────────────────────────────────────────────────────────────
function KpiTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div
      className="relative"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[13px] font-sans py-2 px-3.5 rounded-[10px] whitespace-nowrap pointer-events-none z-50 shadow-lg transition-opacity duration-150"
        style={{ opacity: show ? 1 : 0 }}>
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-slate-800" />
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
      supabase.from('labor').select('entity_id, employee_name, hours_100, hours_125, hours_150, gross_salary, employer_cost').eq('entity_type', 'factory').gte('date', from).lt('date', to),
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

    // ── לייבור (סינון עובדים גלובליים כדי למנוע ספירה כפולה) ──
    const lData = laborRes.data || []
    const globalNames = new Set(globalEmpsData.map(e => e.name))
    const hourlyLaborData = lData.filter((r: any) => !globalNames.has(r.employee_name))
    const lDept: Record<Dept, { hours: number; gross: number; employer: number }> = {
      creams: { hours: 0, gross: 0, employer: 0 }, dough: { hours: 0, gross: 0, employer: 0 },
      packaging: { hours: 0, gross: 0, employer: 0 }, cleaning: { hours: 0, gross: 0, employer: 0 },
    }
    hourlyLaborData.forEach((r: any) => {
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
      supabase.from('labor').select('employee_name, employer_cost').eq('entity_type', 'factory').gte('date', pFrom).lt('date', pTo),
      supabase.from('supplier_invoices').select('amount').gte('date', pFrom).lt('date', pTo),
      getWorkingDays(comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)),
      supabase.from('daily_production').select('amount').gte('date', pFrom).lt('date', pTo),
    ])
    const sum = (res: any) => (res.data || []).reduce((s: number, r: any) => s + Number(r.amount || r.employer_cost || 0), 0)
    const pSalesTotal = sum(pSales) + sum(pB2b)
    const pGlobalLaborCreams = calcGlobalLaborForDept(globalEmpsData, 'creams', pWd)
    const pGlobalLaborDough = calcGlobalLaborForDept(globalEmpsData, 'dough', pWd)
    const pTotalGlobalLabor = pGlobalLaborCreams + pGlobalLaborDough
    // סינון עובדים גלובליים מלייבור חודש קודם כדי למנוע ספירה כפולה
    const pHourlyLabor = (pLabor.data || []).filter((r: any) => !globalNames.has(r.employee_name)).reduce((s: number, r: any) => s + Number(r.employer_cost || 0), 0)
    setPrev({ sales: pSalesTotal, suppliers: sum(pSupp), waste: sum(pWaste), repairs: sum(pRepairs), labor: pHourlyLabor + pTotalGlobalLabor, production: sum(pProd) })

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

  function toggle(key: string) { setOpenSection(openSection === key ? null : key) }

  if (loading) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center" style={{ direction: 'rtl' }}>
      <div className="text-center py-16 text-slate-400">טוען נתונים...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900" onClick={onBack}>
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
          <ProfitIcon size={20} color="#6366f1" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 m-0">דשבורד מפעל</h1>
          <p className="text-[13px] text-slate-400 m-0">סיכום כלל המחלקות · KPI · רווח תפעולי</p>
        </div>
        <div className="mr-auto">
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="px-8 py-6 max-w-[1200px] mx-auto">

        {/* ─── התראות חריגה (הועברו למעלה) ──────────────────────────────── */}
        {(() => {
          const anomalies: { label: string; actual: number; target: number; color: string }[] = []
          if (wastePct > targets.waste_pct + 2)
            anomalies.push({ label: '⚠️ פחת חריג', actual: wastePct, target: targets.waste_pct, color: '#fb7185' })
          if (laborPct > targets.labor_pct + 3)
            anomalies.push({ label: '⚠️ לייבור חורג', actual: laborPct, target: targets.labor_pct, color: '#fbbf24' })
          if (repairsPct > targets.repairs_pct + 2)
            anomalies.push({ label: '⚠️ תיקונים חריגים', actual: repairsPct, target: targets.repairs_pct, color: '#f97316' })
          if (grossPct < targets.gross_profit_pct - 5)
            anomalies.push({ label: '⚠️ רווח גולמי נמוך', actual: grossPct, target: targets.gross_profit_pct, color: '#fb7185' })
          if (anomalies.length === 0) return null
          return (
            <motion.div variants={fadeIn} initial="hidden" animate="visible" className="mb-4">
              {anomalies.map(a => (
                <div key={a.label} className="flex items-center gap-3 rounded-xl px-4 py-3 mb-2" style={{ background: a.color + '12', border: `1.5px solid ${a.color}40` }}>
                  <AlertTriangle size={18} color={a.color} />
                  <span className="font-bold text-[13px]" style={{ color: a.color }}>{a.label}</span>
                  <span className="text-slate-500 text-xs">
                    בפועל: {a.actual.toFixed(1)}% · יעד: {a.target.toFixed(1)}%
                  </span>
                </div>
              ))}
            </motion.div>
          )
        })()}

        {/* ─── נוסחת רווח (Hero — הועברה למעלה) ────────────────────────── */}
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 gap-3.5 mb-5">
          <motion.div variants={fadeUp}>
            <KpiTooltip text="הכנסות פחות עלויות ישירות (שכר + חומרי גלם) — הרווח לפני הוצאות תפעול">
              <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: grossProfit >= 0 ? '#34d399' : '#fb7185' }}>
                <CardContent className="p-5">
                  <div className="text-xs text-slate-500 mb-1">מכירות − לייבור − ספקים</div>
                  <div className="text-[11px] text-slate-400 mb-2">{fmtM(totalSales)} − {fmtM(totalLabor)} − {fmtM(totalSuppliers)}</div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[32px] font-extrabold" style={{ color: grossProfit >= 0 ? '#059669' : '#e11d48' }}>
                      = רווח גולמי <CountUp end={Math.round(grossProfit)} duration={1.5} separator="," prefix="₪" />
                    </span>
                    <DiffBadge curr={grossProfit} prev={prevGrossProfit} />
                  </div>
                </CardContent>
              </Card>
            </KpiTooltip>
          </motion.div>
          <motion.div variants={fadeUp}>
            <KpiTooltip text="השורה התחתונה — מה שנשאר אחרי כל ההוצאות כולל עלויות קבועות, פחת ותיקונים">
              <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>
                <CardContent className="p-5">
                  <div className="text-xs text-slate-500 mb-1">רווח גולמי − עלויות קבועות − פחת − תיקונים</div>
                  <div className="text-[11px] text-slate-400 mb-2">{fmtM(grossProfit)} − {fmtM(fixedCosts)} − {fmtM(totalWaste)} − {fmtM(totalRepairs)}</div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[32px] font-extrabold" style={{ color: operatingProfit >= 0 ? '#059669' : '#e11d48' }}>
                      = רווח תפעולי <CountUp end={Math.round(operatingProfit)} duration={1.5} separator="," prefix="₪" />
                    </span>
                    <DiffBadge curr={operatingProfit} prev={prevOperatingProfit} />
                  </div>
                </CardContent>
              </Card>
            </KpiTooltip>
          </motion.div>
        </motion.div>

        {/* ─── כותרת: סיכום חודשי ─────────────────────────────────────── */}
        <div className="text-xs font-bold text-slate-400 mb-2.5 tracking-wide">סיכום חודשי</div>

        {/* ─── 6 כרטיסי סיכום (קומפקטיים) ────────────────────────────── */}
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-3 gap-2.5 mb-4">
          {[
            { key: 'sales',      label: 'מכירות',          val: totalSales,       prev: prev.sales,       color: '#818cf8', bg: '#eff6ff',  iconEl: <RevenueIcon size={14} color="#10B981" />, iconBg: '#10B981', inv: false, tooltip: 'סה״כ הכנסות מכל המקורות — קרמים, בצקים, B2B ושונות' },
            { key: 'suppliers',  label: 'ספקים (חומ"ג)',    val: totalSuppliers,   prev: prev.suppliers,   color: '#64748b', bg: '#f8fafc',  iconEl: <Truck size={14} color="#64748b" />, iconBg: '#64748b', inv: true,  tooltip: 'סה״כ חשבוניות ספקים — חומרי גלם ואריזה' },
            { key: 'production', label: 'עלות ייצור',       val: totalProduction,  prev: prev.production,  color: '#059669', bg: '#ecfdf5',  iconEl: <FixedCostIcon size={14} color="#059669" />, iconBg: '#059669', inv: true,  tooltip: 'סה״כ ייצור יומי מדווח — לחץ לפירוט לפי מחלקות ויחס ייצור' },
            { key: 'waste',      label: 'פחת',              val: totalWaste,       prev: prev.waste,       color: '#fb7185', bg: '#fef2f2',  iconEl: <Trash2 size={14} color="#fb7185" />, iconBg: '#fb7185', inv: true,  tooltip: 'סחורה שהלכה לפח — לחץ לפירוט לפי מחלקות' },
            { key: 'repairs',    label: 'תיקונים/ציוד',     val: totalRepairs,     prev: prev.repairs,     color: '#f97316', bg: '#fff7ed',  iconEl: <Wrench size={14} color="#f97316" />, iconBg: '#f97316', inv: true,  tooltip: 'תחזוקה ותיקון ציוד — לחץ לפירוט לפי מחלקות' },
            { key: 'labor',      label: 'לייבור',           val: totalLabor,       prev: prev.labor,       color: '#fbbf24', bg: '#fffbeb',  iconEl: <LaborIcon size={14} color="#3B82F6" />, iconBg: '#3B82F6', inv: true,  tooltip: 'עלות מעסיק כוללת — שעתיים × 1.3 + בונוסים + גלובליים' },
          ].map(c => {
            const isOpen = openSection === c.key
            return (
              <motion.div key={c.key} variants={fadeUp}>
                <KpiTooltip text={c.tooltip}>
                  <button onClick={() => toggle(c.key)}
                    className="w-full rounded-xl px-3.5 py-3 cursor-pointer text-right transition-all duration-150 flex items-center gap-2.5"
                    style={{ background: isOpen ? c.color : c.bg, border: `1.5px solid ${c.color}33` }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: isOpen ? 'rgba(255,255,255,0.2)' : `${c.iconBg}15` }}>
                      {c.iconEl}
                    </div>
                    <div className="flex-1">
                      <div className="text-[17px] font-extrabold" style={{ color: isOpen ? 'white' : c.color }}>
                        <CountUp end={Math.round(c.val)} duration={1.5} separator="," prefix="₪" />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px]" style={{ color: isOpen ? 'rgba(255,255,255,0.7)' : '#64748b' }}>{c.label}</span>
                        <DiffBadge curr={c.val} prev={c.prev} inverse={c.inv} />
                      </div>
                    </div>
                    {isOpen ? <ChevronUp size={14} color={isOpen ? 'rgba(255,255,255,0.6)' : '#cbd5e1'} /> : <ChevronDown size={14} color="#cbd5e1" />}
                  </button>
                </KpiTooltip>
              </motion.div>
            )
          })}
        </motion.div>

        {/* ─── Drilldowns ─────────────────────────────────────────────────── */}
        {openSection === 'sales' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm mb-4 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-slate-700">💰 פירוט מכירות לפי מקור</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-[120px]">מקור</TableHead>
                      <TableHead>התפלגות</TableHead>
                      <TableHead className="text-left">סכום</TableHead>
                      <TableHead className="text-left w-[80px]">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { label: 'קרמים', val: salesCreams, color: '#818cf8' },
                      { label: 'בצקים', val: salesDough,  color: '#c084fc' },
                      { label: 'B2B',   val: salesB2B,    color: '#6366f1' },
                      { label: 'שונות', val: salesMisc,   color: '#34d399' },
                    ].map(r => (
                      <TableRow key={r.label}>
                        <TableCell className="font-semibold text-slate-700">{r.label}</TableCell>
                        <TableCell>
                          <div className="h-2 bg-slate-100 rounded overflow-hidden">
                            <div className="h-full rounded" style={{ width: `${pct(r.val, totalSales)}%`, background: r.color }} />
                          </div>
                        </TableCell>
                        <TableCell className="text-left font-extrabold" style={{ color: r.color }}>{fmtM(r.val)}</TableCell>
                        <TableCell className="text-left text-xs text-slate-400">{fmtP(pct(r.val, totalSales))}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-blue-50 border-t-2 border-blue-200 font-extrabold">
                      <TableCell className="text-slate-700">סה"כ</TableCell>
                      <TableCell />
                      <TableCell className="text-left" style={{ color: '#818cf8' }}>{fmtM(totalSales)}</TableCell>
                      <TableCell className="text-left" style={{ color: '#818cf8' }}>100%</TableCell>
                    </TableRow>
                    {salesInternal > 0 && (
                      <TableRow className="bg-purple-50 border-t border-dashed border-violet-300">
                        <TableCell className="font-semibold text-violet-600 text-xs">מתוכם — סניפים</TableCell>
                        <TableCell />
                        <TableCell className="text-left font-bold text-violet-600">{fmtM(salesInternal)}</TableCell>
                        <TableCell className="text-left text-xs text-violet-400">{fmtP(pct(salesInternal, totalSales))}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {openSection === 'suppliers' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm mb-4 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-slate-700">🏢 דירוג ספקים (חומ"ג)</CardTitle>
              </CardHeader>
              <CardContent>
                {supplierRows.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">אין נתונים</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="w-[40px]">#</TableHead>
                        <TableHead className="w-[130px]">ספק</TableHead>
                        <TableHead>התפלגות</TableHead>
                        <TableHead className="text-left w-[110px]">סכום</TableHead>
                        <TableHead className="text-left w-[70px]">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {supplierRows.map((s, i) => (
                        <TableRow key={s.name}>
                          <TableCell>
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: i < 3 ? '#64748b' : '#f1f5f9', color: i < 3 ? 'white' : '#64748b' }}>{i + 1}</span>
                          </TableCell>
                          <TableCell className="font-semibold text-slate-700 text-xs">{s.name}</TableCell>
                          <TableCell>
                            <div className="h-2 bg-slate-100 rounded overflow-hidden">
                              <div className="h-full rounded bg-slate-500" style={{ width: `${pct(s.total, totalSuppliers)}%`, minWidth: s.total > 0 ? '4px' : '0' }} />
                            </div>
                          </TableCell>
                          <TableCell className="text-left font-bold text-slate-900 text-xs">{fmtM(s.total)}</TableCell>
                          <TableCell className="text-left text-[11px] text-slate-500">{fmtP(pct(s.total, totalSuppliers))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {openSection === 'waste' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm mb-4 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-slate-700">🗑️ פחת לפי מחלקות</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  {(['creams', 'dough', 'packaging'] as Dept[]).map(d => (
                    <div key={d} className="bg-rose-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-extrabold" style={{ color: '#fb7185' }}>{fmtM(wasteDept[d])}</div>
                      <div className="text-[13px] text-slate-500 mt-1.5">{DEPT_LABELS[d]}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{fmtP(pct(wasteDept[d], totalSales))} מהכנסות</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {openSection === 'repairs' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm mb-4 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-slate-700">🔧 תיקונים/ציוד לפי מחלקות</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-3">
                  {DEPTS.map(d => (
                    <div key={d} className="bg-orange-50 rounded-xl p-4 text-center">
                      <div className="text-[22px] font-extrabold text-orange-500">{fmtM(repairsDept[d])}</div>
                      <div className="text-[13px] text-slate-500 mt-1.5">{DEPT_LABELS[d]}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {openSection === 'production' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm mb-4 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-slate-700">🏭 עלות ייצור לפי מחלקות</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {(['creams', 'dough', 'packaging'] as const).map(d => (
                    <div key={d} className="bg-emerald-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-extrabold text-emerald-700">{fmtM(prodDept[d])}</div>
                      <div className="text-[13px] text-slate-500 mt-1.5">{{ creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה' }[d]}</div>
                      {totalProduction > 0 && (
                        <div className="text-xs text-slate-400 mt-0.5">{fmtP(pct(prodDept[d], totalProduction))} מסה"כ ייצור</div>
                      )}
                    </div>
                  ))}
                </div>
                {/* מדד ייצור / (לייבור+ספקים) */}
                <div className="rounded-xl px-5 py-4 flex items-center justify-between" style={{ background: productionRatio >= 1 ? '#f0fdf4' : '#fef2f2', border: `1.5px solid ${productionRatio >= 1 ? '#86efac' : '#fca5a5'}` }}>
                  <div>
                    <div className="text-[13px] font-semibold text-slate-700">יחס ייצור / (לייבור + ספקים)</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{fmtM(totalProduction)} / ({fmtM(totalLabor)} + {fmtM(totalSuppliers)})</div>
                  </div>
                  <div className="text-[28px] font-extrabold" style={{ color: prodRatioColor(productionRatio) }}>
                    {productionRatio.toFixed(2)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {openSection === 'labor' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm mb-4 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-slate-700">👷 לייבור לפי מחלקות</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-[120px]">מחלקה</TableHead>
                      <TableHead className="text-center">שעות</TableHead>
                      <TableHead className="text-center">ברוטו</TableHead>
                      <TableHead className="text-center">עלות מעסיק</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const globalByDept: Record<Dept, number> = { creams: globalLaborCreams, dough: globalLaborDough, packaging: 0, cleaning: 0 }
                      return DEPTS.map(d => {
                        const deptTotal = laborDept[d].employer + globalByDept[d]
                        return (
                          <TableRow key={d}>
                            <TableCell className="font-semibold" style={{ color: DEPT_COLORS[d] }}>{DEPT_LABELS[d]}</TableCell>
                            <TableCell className="text-center text-slate-500">{laborDept[d].hours.toFixed(1)}</TableCell>
                            <TableCell className="text-center font-bold text-slate-700">{fmtM(laborDept[d].gross)}</TableCell>
                            <TableCell className="text-center font-bold" style={{ color: '#fb7185' }}>
                              {fmtM(deptTotal)}
                              {globalByDept[d] > 0 && <span className="text-[10px] text-slate-400 block">כולל גלובלי {fmtM(globalByDept[d])}</span>}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    })()}
                    <TableRow className="bg-amber-50 border-t-2 border-amber-200 font-extrabold">
                      <TableCell className="text-slate-700">סה"כ</TableCell>
                      <TableCell className="text-center text-slate-500">{totalHours.toFixed(1)}</TableCell>
                      <TableCell className="text-center text-slate-700">{fmtM(totalGross)}</TableCell>
                      <TableCell className="text-center" style={{ color: '#fb7185' }}>{fmtM(totalLabor)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ─── כותרת: מדדי KPI ──────────────────────────────────────── */}
        <div className="text-xs font-bold text-slate-400 mb-2.5 mt-1.5 tracking-wide border-t border-slate-200 pt-3.5">מדדי KPI</div>

        {/* ─── יחס ייצור — כרטיס ייעודי ──────────────────────────── */}
        {(totalLabor + totalSuppliers) > 0 && (
          <motion.div variants={fadeUp} initial="hidden" animate="visible">
            <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden mb-2.5" style={{ borderRightColor: prodRatioColor(productionRatio) }}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-slate-700">יחס ייצור</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{fmtM(totalProduction)} / ({fmtM(totalLabor)} + {fmtM(totalSuppliers)})</div>
                </div>
                <KpiTooltip text={'יחס בין דוח הייצור לעלויות בפועל (חומ"ג + לייבור) · 1.0 = התאמה מלאה · פחות מ-1 = בזבוז חומרי גלם · מעל 1 = ניצול יעיל'}>
                  <div className="text-[28px] font-extrabold cursor-default" style={{ color: prodRatioColor(productionRatio) }}>
                    {productionRatio.toFixed(2)}
                  </div>
                </KpiTooltip>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ─── KPI מדדים — 5 בשורה ──────────────────────────────────── */}
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-5 gap-2.5 mb-5">
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
              <motion.div key={k.label} variants={fadeUp}>
                <KpiTooltip text={k.tooltip}>
                  <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: color }}>
                    <CardContent className="p-3.5">
                      <div className="text-[22px] font-extrabold" style={{ color }}>
                        <CountUp end={k.val} duration={1.5} decimals={1} suffix="%" />
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{k.label}</div>
                      <div className="flex justify-between items-center mt-1.5">
                        <span className="text-[10px] font-bold px-1.5 py-px rounded-full" style={{ background: color + '20', color }}>
                          יעד {fmtP(k.target)}
                        </span>
                        <span className="text-[10px] font-bold" style={{ color: Math.abs(diff) < 1 ? '#94a3b8' : (diff > 0 ? (k.higher ? '#059669' : '#e11d48') : (k.higher ? '#e11d48' : '#059669')) }}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </KpiTooltip>
              </motion.div>
            )
          })}
        </motion.div>

        {/* ─── כותרת: דוח רווח והפסד ──────────────────────────────── */}
        <div className="text-xs font-bold text-slate-400 mb-2.5 tracking-wide border-t border-slate-200 pt-3.5">דוח רווח והפסד</div>

        {/* ─── טבלת רווח תפעולי ───────────────────────────────────────────── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="shadow-sm overflow-hidden">
            <CardHeader>
              <CardTitle className="text-sm font-bold text-slate-700">📊 טבלת רווח תפעולי</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 border-b-2 border-slate-200">
                    <TableHead className="w-[140px]">שורה</TableHead>
                    <TableHead className="text-center">קרמים</TableHead>
                    <TableHead className="text-center">בצקים</TableHead>
                    <TableHead className="text-center">B2B+שונות</TableHead>
                    <TableHead className="text-center">אריזה+ניקיון</TableHead>
                    <TableHead className="text-left w-[110px]">סה"כ</TableHead>
                    <TableHead className="text-left w-[70px]">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const packCleanLabor = laborDept.packaging.employer + laborDept.cleaning.employer
                    const packCleanRepairs = repairsDept.packaging + repairsDept.cleaning
                    const b2bMiscSales = salesB2B + salesMisc
                    const creamsLaborTotal = laborDept.creams.employer + globalLaborCreams
                    const doughLaborTotal  = laborDept.dough.employer + globalLaborDough

                    const rows = [
                      { label: 'מכירות',           c1: salesCreams,                         c2: salesDough,                        c3: b2bMiscSales,                                      c4: 0,                                              color: '#818cf8', bold: true },
                      { label: 'ספקים (חומ"ג)',     c1: 0,                                   c2: 0,                                 c3: 0,                                                 c4: 0,                                              color: '#64748b', neg: true, noSplit: true, totalOverride: totalSuppliers },
                      { label: 'לייבור',           c1: creamsLaborTotal,                    c2: doughLaborTotal,                   c3: 0,                                                 c4: packCleanLabor,                                 color: '#fbbf24', neg: true },
                      { label: 'רווח גולמי',       c1: salesCreams - creamsLaborTotal,      c2: salesDough - doughLaborTotal,      c3: b2bMiscSales,                                      c4: -packCleanLabor,                                color: grossProfit >= 0 ? '#34d399' : '#fb7185', bold: true, sep: true, totalOverride: grossProfit },
                      { label: 'עלויות קבועות',    c1: 0,                                   c2: 0,                                 c3: 0,                                                 c4: 0,                                              color: '#64748b', neg: true, noSplit: true, totalOverride: fixedCosts },
                      { label: 'פחת',              c1: wasteDept.creams,                    c2: wasteDept.dough,                   c3: 0,                                                 c4: wasteDept.packaging,                            color: '#fb7185', neg: true },
                      { label: 'תיקונים/ציוד',     c1: repairsDept.creams,                  c2: repairsDept.dough,                 c3: 0,                                                 c4: packCleanRepairs,                               color: '#f97316', neg: true },
                      { label: 'רווח תפעולי',      c1: 0,                                   c2: 0,                                 c3: 0,                                                 c4: 0,                                              color: operatingProfit >= 0 ? '#34d399' : '#fb7185', bold: true, sep: true, isOpProfit: true },
                    ]

                    return rows.map((row) => {
                      const total = row.isOpProfit ? operatingProfit : row.totalOverride != null ? row.totalOverride : row.c1 + row.c2 + row.c3 + row.c4
                      const rowPct = pct(Math.abs(total), totalSales)
                      return (
                        <TableRow key={row.label} className={row.sep ? 'bg-slate-50 border-t-2 border-slate-200' : ''}>
                          <TableCell className={`${row.bold ? 'font-bold' : 'font-medium'} text-slate-700`}>{row.label}</TableCell>
                          {[row.c1, row.c2, row.c3, row.c4].map((val, j) => (
                            <TableCell key={j} className={`text-center ${row.bold ? 'font-bold' : ''}`} style={{ color: row.isOpProfit ? row.color : val === 0 ? '#94a3b8' : row.neg ? '#64748b' : row.color }}>
                              {row.isOpProfit ? '—' : row.noSplit ? '—' : val !== 0 ? fmtM(Math.abs(val)) : '—'}
                            </TableCell>
                          ))}
                          <TableCell className="text-left font-extrabold" style={{ color: row.color }}>{fmtM(Math.abs(total))}</TableCell>
                          <TableCell className="text-left font-bold text-xs" style={{ color: row.color }}>{totalSales > 0 ? fmtP(rowPct) : '—'}</TableCell>
                        </TableRow>
                      )
                    })
                  })()}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </motion.div>

      </div>
    </div>
  )
}
