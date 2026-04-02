import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, getLast6Months, monthEnd } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import PeriodPicker from '../components/PeriodPicker'
import InstallPWA from '../components/InstallPWA'
import DailyProduction from './DailyProduction'
import FactoryWaste from './FactoryWaste'
import FactoryRepairs from './FactoryRepairs'
import Labor from './Labor'
import Suppliers from './Suppliers'
import DepartmentDashboard from './DepartmentDashboard'
import FactoryDashboard from './FactoryDashboard'
import DepartmentLabor from './DepartmentLabor'
import FactoryB2B from './FactoryB2B'
import FactorySettings from './FactorySettings'
import CEODashboard from './CEODashboard'
import BranchHome from './BranchHome'
import BranchManagerDashboard from './BranchManagerDashboard'
import DepartmentHome from './DepartmentHome'
import UserManagement from './UserManagement'
import DataImport from './DataImport'
import {
  FlaskConical, Croissant, Package, HardHat, BarChart3,
  Store, Settings, LogOut, TrendingUp, TrendingDown,
  AlertTriangle, ClipboardList, Truck, UserCog,
  Factory, ChevronDown, ChevronLeft, Database,
  LayoutDashboard
} from 'lucide-react'
import { TrophyIcon, ProfitIcon, RevenueIcon, LaborIcon } from '@/components/icons'

// ─── קבועים ─────────────────────────────────────────────────────────────────

const PANEL_FACTORY = [
  { label: 'קרמים',        subtitle: 'ייצור · פחת · תיקונים',         Icon: FlaskConical, color: '#818cf8', page: 'dept_creams' },
  { label: 'בצקים',        subtitle: 'ייצור · פחת · תיקונים',         Icon: Croissant,    color: '#8b5cf6', page: 'dept_dough' },
  { label: 'אריזה',        subtitle: 'כמויות · תיקונים · לייבור',     Icon: Package,      color: '#0ea5e9', page: 'dept_packaging' },
  { label: 'ניקיון/נהג',   subtitle: 'תיקונים · לייבור',              Icon: Truck,        color: '#64748b', page: 'dept_cleaning' },
  { label: 'לייבור מרוכז', subtitle: 'העלאת CSV · כל המחלקות',       Icon: HardHat,      color: '#f59e0b', page: 'labor' },
  { label: 'מכירות',        subtitle: 'קרמים · בצקים · B2B · שונות',  Icon: TrendingUp,   color: '#6366f1', page: 'factory_b2b' },
  { label: 'ספקים',         subtitle: 'חשבוניות · ניהול ספקים',        Icon: ClipboardList, color: '#34d399', page: 'suppliers' },
  { label: 'דשבורד מפעל',  subtitle: 'KPI · רווח · גרפים',           Icon: ProfitIcon,    color: '#6366f1', page: 'factory_dashboard' },
  { label: 'הגדרות מפעל',  subtitle: 'יעדים · עובדים · עלויות',      Icon: Settings,     color: '#64748b', page: 'settings' },
]

const PANEL_MANAGE = [
  { label: 'דשבורד מנכ"ל', subtitle: 'מבט רשתי · כל הסניפים', Icon: TrophyIcon,   color: '#f59e0b', page: 'ceo_dashboard' },
  { label: 'הגדרות מערכת', subtitle: 'יעדים · עובדים · עלויות', Icon: Settings, color: '#64748b', page: 'settings' },
  { label: 'ייבוא נתונים', subtitle: 'CSV מ-Base44 · העלאה',   Icon: Database, color: '#818cf8', page: 'data_import' },
]

const fmtK = (n: number) => n === 0 ? '—' : '₪' + Math.round(n).toLocaleString()

interface BranchKpi { id: number; name: string; color: string; revenue: number; laborPct: number }

// ─── Animation Variants ──────────────────────────────────────────────────────
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }
const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } } }
const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── קומפוננטה ──────────────────────────────────────────────────────────────
export default function Home() {
  const { period, setPeriod, from, to, comparisonPeriod } = usePeriod()
  const { appUser, canAccessPage, logout } = useAppUser()
  const { branches: branchList } = useBranches()
  const [page, setPage]         = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>('factory')

  // ─── Dynamic branches for navigation ──────────────────────────────────────
  const BRANCHES = branchList.map(b => ({ id: b.id, name: b.name, color: b.color, page: `branch_${b.id}` }))

  // ─── Filtered navigation based on permissions ─────────────────────────────
  const filteredBranches = BRANCHES.filter(br => canAccessPage(br.page))
  const filteredPanelFactory = PANEL_FACTORY.filter(item => canAccessPage(item.page))
  const filteredPanelManage = PANEL_MANAGE.filter(item => canAccessPage(item.page))

  // Add user management for admins
  const managePanelItems = appUser?.role === 'admin'
    ? [...filteredPanelManage, { label: 'ניהול משתמשים', subtitle: 'הרשאות · משתמשים', Icon: UserCog, color: '#8b5cf6', page: 'user_management' }]
    : filteredPanelManage

  // Determine which sections to show
  const showFactory = filteredPanelFactory.length > 0
  const showBranches = filteredBranches.length > 0 || canAccessPage('branch_dashboard')
  const showManage = managePanelItems.length > 0

  // KPI data
  const [factoryRevenue, setFactoryRevenue] = useState(0)
  const [factoryGross, setFactoryGross]     = useState(0)
  const [totalBranchRevenue, setTotalBranchRevenue] = useState(0)
  const [totalBranchGross, setTotalBranchGross]     = useState(0)
  const [branchKpi, setBranchKpi]           = useState<BranchKpi[]>([])
  const [avgLaborPct, setAvgLaborPct]       = useState(0)
  const [alerts, setAlerts]                 = useState(0)
  const [prevFactoryRevenue, setPrevFactoryRevenue] = useState(0)
  const [prevFactoryGross, setPrevFactoryGross] = useState(0)
  const [prevBranchRevenue, setPrevBranchRevenue] = useState(0)
  const [prevBranchGross, setPrevBranchGross] = useState(0)
  const [prevAvgLaborPct, setPrevAvgLaborPct] = useState(0)
  const [trendData, setTrendData] = useState<{ month: string; label: string; revenue: number; labor: number; profit: number }[]>([])

  // ─── Data Loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadKpi() {
      // Factory data
      const [salesFs, salesB2b, laborRes, suppliersRes] = await Promise.all([
        supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', from).lt('date', to),
        supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', from).lt('date', to),
        supabase.from('labor').select('employer_cost').eq('entity_type', 'factory').gte('date', from).lt('date', to),
        supabase.from('supplier_invoices').select('amount').gte('date', from).lt('date', to),
      ])

      const fSales = (salesFs.data || []).reduce((s, r) => s + Number(r.amount), 0)
                   + (salesB2b.data || []).reduce((s, r) => s + Number(r.amount), 0)
      const fLabor = (laborRes.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)
      const fSupp  = (suppliersRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
      setFactoryRevenue(fSales)
      setFactoryGross(fSales - fLabor - fSupp)

      // Branch data
      const bKpi: BranchKpi[] = []
      let totalBranchRev = 0, totalBranchLab = 0, totalBranchExp = 0, alertCount = 0

      for (const br of BRANCHES) {
        const [revRes, labRes, expRes] = await Promise.all([
          supabase.from('branch_revenue').select('amount').eq('branch_id', br.id).gte('date', from).lt('date', to),
          supabase.from('branch_labor').select('employer_cost').eq('branch_id', br.id).gte('date', from).lt('date', to),
          supabase.from('branch_expenses').select('amount').eq('branch_id', br.id).gte('date', from).lt('date', to),
        ])
        const rev = (revRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
        const lab = (labRes.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)
        const exp = (expRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
        const labPct = rev > 0 ? (lab / rev) * 100 : 0
        if (labPct > 28) alertCount++
        totalBranchRev += rev
        totalBranchLab += lab
        totalBranchExp += exp
        bKpi.push({ id: br.id, name: br.name, color: br.color, revenue: rev, laborPct: labPct })
      }

      setBranchKpi(bKpi)
      setTotalBranchRevenue(totalBranchRev)
      setTotalBranchGross(totalBranchRev - totalBranchLab - totalBranchExp)
      const avgPct = totalBranchRev > 0 ? (totalBranchLab / totalBranchRev) * 100 : 0
      setAvgLaborPct(avgPct)
      setAlerts(alertCount)

      // Previous period (comparison)
      const pFrom = comparisonPeriod.from, pTo = comparisonPeriod.to
      const [pSalesFs, pSalesB2b, pLabor, pSupp] = await Promise.all([
        supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', pFrom).lt('date', pTo),
        supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', pFrom).lt('date', pTo),
        supabase.from('labor').select('employer_cost').eq('entity_type', 'factory').gte('date', pFrom).lt('date', pTo),
        supabase.from('supplier_invoices').select('amount').gte('date', pFrom).lt('date', pTo),
      ])
      const pFSales = (pSalesFs.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
                     + (pSalesB2b.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
      const pFLabor = (pLabor.data || []).reduce((s: any, r: any) => s + Number(r.employer_cost), 0)
      const pFSupp = (pSupp.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
      setPrevFactoryRevenue(pFSales)
      setPrevFactoryGross(pFSales - pFLabor - pFSupp)

      let pTotalBranchRev = 0, pTotalBranchLab = 0, pTotalBranchExp = 0
      for (const br of BRANCHES) {
        const [pRevRes, pLabRes, pExpRes] = await Promise.all([
          supabase.from('branch_revenue').select('amount').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo),
          supabase.from('branch_labor').select('employer_cost').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo),
          supabase.from('branch_expenses').select('amount').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo),
        ])
        pTotalBranchRev += (pRevRes.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
        pTotalBranchLab += (pLabRes.data || []).reduce((s: any, r: any) => s + Number(r.employer_cost), 0)
        pTotalBranchExp += (pExpRes.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
      }
      setPrevBranchRevenue(pTotalBranchRev)
      setPrevBranchGross(pTotalBranchRev - pTotalBranchLab - pTotalBranchExp)
      const pAvgPct = pTotalBranchRev > 0 ? (pTotalBranchLab / pTotalBranchRev) * 100 : 0
      setPrevAvgLaborPct(pAvgPct)

      // 6-month trend (optimized: single range query per table)
      const refMonth = period.monthKey || period.from.slice(0, 7)
      const months6 = getLast6Months(refMonth)
      const tFrom = months6[0] + '-01', tTo = monthEnd(months6[5])
      const [tSalesFs, tSalesB2b, tLabor6, tSupp6] = await Promise.all([
        supabase.from('factory_sales').select('date, amount').eq('is_internal', false).gte('date', tFrom).lt('date', tTo),
        supabase.from('factory_b2b_sales').select('date, amount').eq('is_internal', false).gte('date', tFrom).lt('date', tTo),
        supabase.from('labor').select('date, employer_cost').eq('entity_type', 'factory').gte('date', tFrom).lt('date', tTo),
        supabase.from('supplier_invoices').select('date, amount').gte('date', tFrom).lt('date', tTo),
      ])
      const groupByMonth = (data: any[], field: string) => {
        const map: Record<string, number> = {}
        ;(data || []).forEach((r: any) => {
          const m = r.date?.slice(0, 7)
          if (m) map[m] = (map[m] || 0) + Number(r[field] || 0)
        })
        return map
      }
      const salesByM = groupByMonth([...(tSalesFs.data || []), ...(tSalesB2b.data || [])], 'amount')
      const laborByM = groupByMonth(tLabor6.data || [], 'employer_cost')
      const suppByM = groupByMonth(tSupp6.data || [], 'amount')
      const hebrewMonths = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
      setTrendData(months6.map(m => {
        const rev = salesByM[m] || 0
        const lab = laborByM[m] || 0
        const sup = suppByM[m] || 0
        return { month: m, label: hebrewMonths[parseInt(m.split('-')[1]) - 1], revenue: rev, labor: lab, profit: rev - lab - sup }
      }))
    }
    loadKpi()
  }, [from, to])

  // ─── Page routing with floating home button ────────────────────────────────
  function renderPage(): JSX.Element | null {
    if (page === 'creams_production')    return <DailyProduction department="creams"    onBack={() => setPage(null)} />
    if (page === 'dough_production')     return <DailyProduction department="dough"     onBack={() => setPage(null)} />
    if (page === 'packaging_production') return <DailyProduction department="packaging" onBack={() => setPage(null)} />

    if (page === 'creams_waste')         return <FactoryWaste department="creams"    onBack={() => setPage(null)} />
    if (page === 'dough_waste')          return <FactoryWaste department="dough"     onBack={() => setPage(null)} />
    if (page === 'packaging_waste')      return <FactoryWaste department="packaging" onBack={() => setPage(null)} />

    if (page === 'creams_repairs')       return <FactoryRepairs department="creams"    onBack={() => setPage(null)} />
    if (page === 'dough_repairs')        return <FactoryRepairs department="dough"     onBack={() => setPage(null)} />
    if (page === 'packaging_repairs')    return <FactoryRepairs department="packaging" onBack={() => setPage(null)} />
    if (page === 'cleaning_repairs')     return <FactoryRepairs department="cleaning"  onBack={() => setPage(null)} />

    if (page === 'labor')                return <Labor onBack={() => setPage(null)} />
    if (page === 'creams_labor')         return <DepartmentLabor department="creams"    onBack={() => setPage(null)} />
    if (page === 'dough_labor')          return <DepartmentLabor department="dough"     onBack={() => setPage(null)} />
    if (page === 'packaging_labor')      return <DepartmentLabor department="packaging" onBack={() => setPage(null)} />
    if (page === 'cleaning_labor')       return <DepartmentLabor department="cleaning"  onBack={() => setPage(null)} />

    if (page === 'suppliers')            return <Suppliers onBack={() => setPage(null)} />

    if (page === 'creams_dashboard')     return <DepartmentDashboard department="creams" onBack={() => setPage(null)} />
    if (page === 'dough_dashboard')      return <DepartmentDashboard department="dough"  onBack={() => setPage(null)} />
    if (page === 'factory_dashboard')    return <FactoryDashboard onBack={() => setPage(null)} />
    if (page === 'factory_b2b')          return <FactoryB2B onBack={() => setPage(null)} />
    if (page === 'settings')             return <FactorySettings onBack={() => setPage(null)} />
    if (page === 'ceo_dashboard')        return <CEODashboard onBack={() => setPage(null)} />
    if (page === 'data_import')          return <DataImport onBack={() => setPage(null)} />
    if (page === 'branch_import')        return <DataImport onBack={() => setPage(null)} branchOnly />
    if (page === 'user_management')      return <UserManagement onBack={() => setPage(null)} />

    if (page === 'dept_creams')    return <DepartmentHome department="creams"    onBack={() => setPage(null)} />
    if (page === 'dept_dough')     return <DepartmentHome department="dough"     onBack={() => setPage(null)} />
    if (page === 'dept_packaging') return <DepartmentHome department="packaging" onBack={() => setPage(null)} />
    if (page === 'dept_cleaning')  return <DepartmentHome department="cleaning"  onBack={() => setPage(null)} />

    if (page === 'branch_dashboard') return <BranchManagerDashboard onBack={() => setPage(null)} />

    // Dynamic branch routing
    const branchMatch = page?.match(/^branch_(\d+)$/)
    if (branchMatch) {
      const branchId = Number(branchMatch[1])
      const br = BRANCHES.find(b => b.id === branchId)
      if (br) return <BranchHome branch={{ id: br.id, name: br.name, color: br.color }} onBack={() => setPage(null)} />
    }

    return null
  }

  // If a page is active, show it with floating home button
  if (page) {
    const pageContent = renderPage()
    if (pageContent) {
      return (
        <>
          {pageContent}
          {/* Floating Home Button */}
          <motion.button
            onClick={() => setPage(null)}
            title="חזרה לדף הבית"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.3 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="fixed bottom-6 left-6 w-[52px] h-[52px] rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-white border-none shadow-lg shadow-indigo-400/40 cursor-pointer flex items-center justify-center z-[9999] transition-shadow hover:shadow-xl hover:shadow-indigo-400/50"
          >
            <LayoutDashboard size={24} />
          </motion.button>
        </>
      )
    }
    // Unknown page — show "in development" fallback
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center font-sans" style={{ direction: 'rtl' }}>
        <Card className="text-center p-12 shadow-lg">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="text-5xl">🚧</div>
            <h2 className="text-xl font-bold text-slate-900 m-0">בפיתוח</h2>
            <p className="text-slate-400 m-0">מסך זה יהיה זמין בקרוב</p>
            <Button variant="default" size="lg" onClick={() => setPage(null)} className="rounded-xl px-6 text-[15px] font-bold">
              חזרה לדף הבית
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── DiffBadge ────────────────────────────────────────────────────────────
  function DiffBadge({ curr, prev, inverse }: { curr: number; prev: number; inverse?: boolean }) {
    if (prev === 0 && curr === 0) return null
    if (prev === 0) return null
    const d = ((curr - prev) / Math.abs(prev)) * 100
    const up = d > 0
    const good = inverse ? !up : up
    const color = Math.abs(d) < 1 ? '#94a3b8' : good ? '#34d399' : '#fb7185'
    const Icon = up ? TrendingUp : TrendingDown
    return (
      <span className="inline-flex items-center gap-[3px] text-xs font-bold mt-1" style={{ color }}>
        <Icon size={12} /> {Math.abs(d).toFixed(1)}%
      </span>
    )
  }

  // ─── Section toggle helper ─────────────────────────────────────────────────
  function toggleSection(key: string) {
    setExpandedSection(prev => prev === key ? null : key)
  }

  // ─── מסך הבית ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100 font-sans" style={{ direction: 'rtl' }}>

      <div className="max-w-[900px] mx-auto px-6 py-5">

        {/* ─── כותרת ─────────────────────────────────────────────────────── */}
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          className="mb-4 flex items-center justify-between flex-wrap gap-2.5"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-[42px] h-[42px] bg-gradient-to-br from-indigo-400 to-purple-500 rounded-[14px] flex items-center justify-center shadow-lg shadow-indigo-400/30">
              <Croissant size={22} color="white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 m-0">שלום, {appUser?.name || 'משתמש'}</h1>
              <p className="text-slate-400 text-xs m-0">
                {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <InstallPWA />
            <PeriodPicker period={period} onChange={setPeriod} />
            <Button
              variant="outline"
              size="icon"
              onClick={() => logout()}
              title="יציאה"
              className="w-9 h-9 rounded-[10px] hover:border-rose-400 hover:bg-rose-50"
            >
              <LogOut size={16} className="text-slate-500" />
            </Button>
          </div>
        </motion.div>

        {/* ─── KPI Strip ──────────────────────────────────────────────────── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.1 }}>
          <Card className="mb-5 py-0">
            <CardContent className="kpi-grid flex items-center gap-0 flex-wrap py-3.5 px-6">
              {/* הכנסות */}
              {(() => { const grandRevenue = factoryRevenue + totalBranchRevenue; return (
              <div className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 pe-4 border-e border-slate-200">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#10B98115' }}>
                  <RevenueIcon size={16} color="#10B981" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold mb-0.5">הכנסות</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-extrabold text-slate-900">{fmtK(grandRevenue)}</span>
                    <DiffBadge curr={factoryRevenue + totalBranchRevenue} prev={prevFactoryRevenue + prevBranchRevenue} />
                  </div>
                </div>
              </div>
              )})()}
              {/* רווח גולמי */}
              {(() => { const grandGross = factoryGross + totalBranchGross; return (
              <div className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 px-4 border-e border-slate-200">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#7C3AED15' }}>
                  <ProfitIcon size={16} color="#7C3AED" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold mb-0.5">רווח גולמי</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-lg font-extrabold ${grandGross >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtK(grandGross)}</span>
                    <DiffBadge curr={factoryGross + totalBranchGross} prev={prevFactoryGross + prevBranchGross} />
                  </div>
                </div>
              </div>
              )})()}
              {/* % לייבור */}
              <div className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 px-4 border-e border-slate-200">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#3B82F615' }}>
                  <LaborIcon size={16} color="#3B82F6" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold mb-0.5">לייבור ממוצע</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-extrabold text-slate-900">{avgLaborPct.toFixed(1)}%</span>
                    <span className={`text-[13px] font-bold ${avgLaborPct <= 28 ? 'text-emerald-400' : 'text-rose-400'}`}>{avgLaborPct <= 28 ? '✓' : '✗'}</span>
                    <DiffBadge curr={avgLaborPct} prev={prevAvgLaborPct} inverse />
                  </div>
                </div>
              </div>
              {/* התראות */}
              <div className="flex-1 min-w-[100px] flex items-center gap-2.5 py-1 ps-4">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: alerts > 0 ? '#fb718515' : '#10B98115' }}>
                  <AlertTriangle size={16} color={alerts > 0 ? '#fb7185' : '#10B981'} />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold mb-0.5">התראות</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-lg font-extrabold ${alerts > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{alerts}</span>
                    <span className="text-[11px] text-slate-400">{alerts === 0 ? 'תקין' : 'חריגה'}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ═══ Section 1: מפעל ═══════════════════════════════════════════════ */}
        {showFactory && (
          <motion.div variants={fadeUp} initial="hidden" animate="visible" transition={{ delay: 0.15 }}>
            <Card className="mb-4 py-0 overflow-hidden">
              {/* Section Header */}
              <button
                onClick={() => toggleSection('factory')}
                className="w-full bg-transparent border-none cursor-pointer p-4 px-5 flex items-center gap-3"
                style={{ borderBottom: expandedSection === 'factory' ? '1px solid #e2e8f0' : 'none' }}
              >
                <div className="w-10 h-10 bg-indigo-400/10 rounded-xl flex items-center justify-center shrink-0">
                  <Factory size={22} color="#818cf8" />
                </div>
                <div className="flex-1 text-right">
                  <div className="text-base font-extrabold text-slate-900">מפעל</div>
                  <div className="text-[11px] text-slate-400 mt-px">מחלקות · לייבור · מכירות · דשבורד</div>
                </div>
                <ChevronDown
                  size={20} color="#94a3b8"
                  className="shrink-0 transition-transform duration-200"
                  style={{ transform: expandedSection === 'factory' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
              {/* Section Content */}
              {expandedSection === 'factory' && (
                <CardContent className="pb-5 pt-4">
                  <motion.div
                    variants={staggerContainer}
                    initial="hidden"
                    animate="visible"
                    className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5"
                  >
                    {filteredPanelFactory.map(item => {
                      const Icon = item.Icon
                      return (
                        <motion.div key={item.page} variants={fadeUp}>
                          <button
                            onClick={() => setPage(item.page)}
                            className="w-full bg-slate-50 border-[1.5px] border-slate-200 rounded-xl p-3.5 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-current hover:-translate-y-0.5 hover:shadow-md"
                            style={{ '--tw-shadow-color': item.color + '15' } as React.CSSProperties}
                          >
                            <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center shrink-0" style={{ background: item.color + '15' }}>
                              <Icon size={18} color={item.color} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-bold text-slate-900">{item.label}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{item.subtitle}</div>
                            </div>
                            <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                          </button>
                        </motion.div>
                      )
                    })}
                  </motion.div>
                </CardContent>
              )}
            </Card>
          </motion.div>
        )}

        {/* ═══ Section 2: סניפים ═════════════════════════════════════════════ */}
        {showBranches && (
          <motion.div variants={fadeUp} initial="hidden" animate="visible" transition={{ delay: 0.2 }}>
            <Card className="mb-4 py-0 overflow-hidden">
              {/* Section Header */}
              <button
                onClick={() => toggleSection('branches')}
                className="w-full bg-transparent border-none cursor-pointer p-4 px-5 flex items-center gap-3"
                style={{ borderBottom: expandedSection === 'branches' ? '1px solid #e2e8f0' : 'none' }}
              >
                <div className="w-10 h-10 bg-emerald-400/10 rounded-xl flex items-center justify-center shrink-0">
                  <Store size={22} color="#34d399" />
                </div>
                <div className="flex-1 text-right">
                  <div className="text-base font-extrabold text-slate-900">סניפים</div>
                  <div className="text-[11px] text-slate-400 mt-px">ניהול סניפים · דשבורד מנהל</div>
                </div>
                <ChevronDown
                  size={20} color="#94a3b8"
                  className="shrink-0 transition-transform duration-200"
                  style={{ transform: expandedSection === 'branches' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
              {/* Section Content */}
              {expandedSection === 'branches' && (
                <CardContent className="pb-5 pt-4">
                  <motion.div variants={staggerContainer} initial="hidden" animate="visible">
                    {/* Branch Manager Dashboard button */}
                    {canAccessPage('branch_dashboard') && (
                      <motion.div variants={fadeUp}>
                        <button
                          onClick={() => setPage('branch_dashboard')}
                          className="w-full bg-gradient-to-br from-indigo-400/5 to-emerald-400/5 border-[1.5px] border-emerald-400/20 rounded-xl p-3.5 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-emerald-400 hover:-translate-y-0.5 hover:shadow-md hover:shadow-emerald-400/10 mb-3"
                        >
                          <div className="w-[38px] h-[38px] bg-gradient-to-br from-indigo-400 to-emerald-400 rounded-[10px] flex items-center justify-center shrink-0">
                            <ProfitIcon size={18} color="white" />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-bold text-slate-900">דשבורד מנהל סניפים</div>
                            <div className="text-[11px] text-slate-400 mt-px">השוואת סניפים · P&L · KPI</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-extrabold text-slate-900">{fmtK(totalBranchRevenue)}</span>
                            <ChevronLeft size={14} color="#cbd5e1" />
                          </div>
                        </button>
                      </motion.div>
                    )}

                    {/* Individual branch cards */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                      {filteredBranches.map(br => {
                        const kpi = branchKpi.find(b => b.id === br.id)
                        const rev = kpi?.revenue ?? 0
                        const labPct = kpi?.laborPct ?? 0
                        return (
                          <motion.div key={br.id} variants={fadeUp}>
                            <button
                              onClick={() => setPage(br.page)}
                              className="w-full bg-slate-50 rounded-xl p-3.5 px-4 cursor-pointer text-right transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
                              style={{ border: `1.5px solid ${br.color}30` }}
                            >
                              <div className="flex items-center gap-2.5 mb-2.5">
                                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: br.color }}>
                                  <Store size={16} color="white" />
                                </div>
                                <span className="text-sm font-bold text-slate-900">{br.name}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-base font-extrabold text-slate-900">{fmtK(rev)}</span>
                                <span className={`text-xs font-bold ${labPct <= 28 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {rev > 0 ? labPct.toFixed(1) + '%' : '—'} {rev > 0 ? (labPct <= 28 ? '✓' : '✗') : ''}
                                </span>
                              </div>
                            </button>
                          </motion.div>
                        )
                      })}
                    </div>

                    {/* Branch data import button */}
                    <motion.div variants={fadeUp}>
                      <button
                        onClick={() => setPage('branch_import')}
                        className="w-full bg-slate-50 border-[1.5px] border-indigo-400/20 rounded-xl p-3 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-indigo-400 hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-400/10 mt-3"
                      >
                        <div className="w-[38px] h-[38px] bg-indigo-400/10 rounded-[10px] flex items-center justify-center shrink-0">
                          <Database size={18} color="#818cf8" />
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] font-bold text-slate-900">ייבוא נתוני סניפים</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">CSV מ-Base44 · כל הסניפים ביחד</div>
                        </div>
                        <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                      </button>
                    </motion.div>
                  </motion.div>
                </CardContent>
              )}
            </Card>
          </motion.div>
        )}

        {/* ═══ Section 3: דשבורד מנכ"ל + ניהול ═══════════════════════════════ */}
        {showManage && (
          <motion.div variants={fadeUp} initial="hidden" animate="visible" transition={{ delay: 0.25 }}>
            <Card className="mb-4 py-0 overflow-hidden">
              {/* Section Header */}
              <button
                onClick={() => toggleSection('manage')}
                className="w-full bg-transparent border-none cursor-pointer p-4 px-5 flex items-center gap-3"
                style={{ borderBottom: expandedSection === 'manage' ? '1px solid #e2e8f0' : 'none' }}
              >
                <div className="w-10 h-10 bg-amber-400/10 rounded-xl flex items-center justify-center shrink-0">
                  <TrophyIcon size={22} color="#f59e0b" />
                </div>
                <div className="flex-1 text-right">
                  <div className="text-base font-extrabold text-slate-900">דשבורד מנכ"ל + ניהול</div>
                  <div className="text-[11px] text-slate-400 mt-px">דשבורד · הגדרות · ייבוא נתונים</div>
                </div>
                <ChevronDown
                  size={20} color="#94a3b8"
                  className="shrink-0 transition-transform duration-200"
                  style={{ transform: expandedSection === 'manage' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
              {/* Section Content */}
              {expandedSection === 'manage' && (
                <CardContent className="pb-5 pt-4">
                  <motion.div
                    variants={staggerContainer}
                    initial="hidden"
                    animate="visible"
                    className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5"
                  >
                    {managePanelItems.map(item => {
                      const Icon = item.Icon
                      return (
                        <motion.div key={item.page} variants={fadeUp}>
                          <button
                            onClick={() => setPage(item.page)}
                            className="w-full bg-slate-50 border-[1.5px] border-slate-200 rounded-xl p-3.5 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-current hover:-translate-y-0.5 hover:shadow-md"
                          >
                            <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center shrink-0" style={{ background: item.color + '15' }}>
                              <Icon size={18} color={item.color} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-bold text-slate-900">{item.label}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{item.subtitle}</div>
                            </div>
                            <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                          </button>
                        </motion.div>
                      )
                    })}
                  </motion.div>
                </CardContent>
              )}
            </Card>
          </motion.div>
        )}

        {/* ─── מגמות 6 חודשים ─── */}
        {trendData.length > 0 && trendData.some(d => d.revenue > 0) && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.3 }} className="mb-5">
            <Card className="py-0">
              <CardContent className="chart-container py-4 px-5">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[13px] font-bold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">מגמות 6 חודשים</span>
                  <div className="flex gap-3.5">
                    {[{ color: '#818cf8', label: 'הכנסות' }, { color: '#f59e0b', label: 'לייבור' }, { color: '#34d399', label: 'רווח' }].map(m => (
                      <span key={m.label} className="flex items-center gap-1 text-[11px] text-slate-400">
                        <span className="w-2 h-2 rounded-sm inline-block" style={{ background: m.color }} />
                        {m.label}
                      </span>
                    ))}
                  </div>
                </div>
                {(() => {
                  const W = 650, H = 160, PL = 50, PR = 12, PT = 8, PB = 24
                  const metrics = [
                    { key: 'revenue' as const, color: '#818cf8' },
                    { key: 'labor' as const, color: '#f59e0b' },
                    { key: 'profit' as const, color: '#34d399' },
                  ]
                  const allVals = trendData.flatMap(d => metrics.map(m => d[m.key]))
                  const maxPos = Math.max(...allVals, 0)
                  const minNeg = Math.min(...allVals, 0)
                  const totalRange = (maxPos - minNeg) || 1
                  const chartH = H - PT - PB
                  // Zero line position: fraction of chart height from top
                  const zeroY = PT + (maxPos / totalRange) * chartH
                  const groupW = (W - PL - PR) / trendData.length
                  const barW = groupW / (metrics.length + 1)
                  return (
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '160px' }}>
                      {/* Zero / baseline */}
                      <line x1={PL} y1={zeroY} x2={W - PR} y2={zeroY} stroke="#cbd5e1" strokeWidth="1" />
                      {/* Dashed line for negative zone */}
                      {minNeg < 0 && <text x={PL - 4} y={zeroY + 3} textAnchor="end" fontSize="9" fill="#94a3b8">0</text>}
                      {trendData.map((d, di) => {
                        const gx = PL + di * groupW
                        return metrics.map((m, mi) => {
                          const val = d[m.key]
                          if (val === 0) return null
                          const barX = gx + (mi + 0.5) * barW
                          if (val >= 0) {
                            const h = (val / totalRange) * chartH
                            return <rect key={`${di}-${mi}`} x={barX} y={zeroY - h} width={barW * 0.8} height={h} rx={3} fill={m.color} opacity={0.85} />
                          } else {
                            const h = (Math.abs(val) / totalRange) * chartH
                            return <rect key={`${di}-${mi}`} x={barX} y={zeroY} width={barW * 0.8} height={h} rx={3} fill="#fb7185" opacity={0.6} />
                          }
                        })
                      })}
                      {trendData.map((d, i) => (
                        <text key={i} x={PL + i * groupW + groupW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#94a3b8">{d.label}</text>
                      ))}
                    </svg>
                  )
                })()}
              </CardContent>
            </Card>
          </motion.div>
        )}

      </div>

      {/* Mobile Bottom Nav */}
      <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 h-14 bg-slate-900 hidden items-center justify-around z-[300] border-t border-slate-800" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <button onClick={() => setExpandedSection('factory')} className={`bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 ${expandedSection === 'factory' ? 'text-sky-400' : 'text-slate-400'}`}>
          <Factory size={22} />
          <span>מפעל</span>
        </button>
        <button onClick={() => setExpandedSection('branches')} className={`bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 ${expandedSection === 'branches' ? 'text-sky-400' : 'text-slate-400'}`}>
          <Store size={22} />
          <span>סניפים</span>
        </button>
        <button onClick={() => setExpandedSection('manage')} className={`bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 ${expandedSection === 'manage' ? 'text-sky-400' : 'text-slate-400'}`}>
          <Settings size={22} />
          <span>ניהול</span>
        </button>
        <button onClick={() => logout()} className="bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 text-slate-400">
          <LogOut size={22} />
          <span>יציאה</span>
        </button>
      </nav>
    </div>
  )
}
