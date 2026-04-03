import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, monthEnd, getFixedCostTotal } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
import BranchComparisonDashboard from './BranchComparisonDashboard'
import DepartmentHome from './DepartmentHome'
import UserManagement from './UserManagement'
import ReportsAlerts from './ReportsAlerts'
import DataImport from './DataImport'
import {
  FlaskConical, Croissant, Package, HardHat, BarChart3,
  Store, Settings, LogOut, TrendingUp, TrendingDown, Mail,
  AlertTriangle, ClipboardList, Truck, UserCog, Activity,
  Factory, ChevronDown, ChevronLeft, Database, Monitor, Home as HomeIcon,
  LayoutDashboard, X
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
  { label: 'דוחות והתראות', subtitle: 'לוג דוחות · כללי התראה', Icon: Mail,         color: '#f59e0b', page: 'reports_alerts' },
  { label: 'הגדרות מערכת', subtitle: 'יעדים · עובדים · עלויות', Icon: Settings, color: '#64748b', page: 'settings' },
  { label: 'ייבוא נתונים', subtitle: 'CSV מ-Base44 · העלאה',   Icon: Database, color: '#818cf8', page: 'data_import' },
]

const fmtK = (n: number) => n === 0 ? '—' : '₪' + Math.round(n).toLocaleString()

interface BranchKpi { id: number; name: string; color: string; revenue: number; laborCost: number; laborPct: number }

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
  const [operatingProfit, setOperatingProfit] = useState(0)
  const [prevOperatingProfit, setPrevOperatingProfit] = useState(0)
  const [totalLabor, setTotalLabor] = useState(0)
  const [prevTotalLabor, setPrevTotalLabor] = useState(0)
  const [factoryLabor, setFactoryLabor] = useState(0)
  const [revenueSheetOpen, setRevenueSheetOpen] = useState(false)
  const [laborSheetOpen, setLaborSheetOpen] = useState(false)

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
      setFactoryLabor(fLabor)

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
        bKpi.push({ id: br.id, name: br.name, color: br.color, revenue: rev, laborCost: lab, laborPct: labPct })
      }

      setBranchKpi(bKpi)
      setTotalBranchRevenue(totalBranchRev)
      const avgPct = totalBranchRev > 0 ? (totalBranchLab / totalBranchRev) * 100 : 0
      setAvgLaborPct(avgPct)
      setTotalLabor(fLabor + totalBranchLab)
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
      const pAvgPct = pTotalBranchRev > 0 ? (pTotalBranchLab / pTotalBranchRev) * 100 : 0
      setPrevAvgLaborPct(pAvgPct)
      setPrevTotalLabor(pFLabor + pTotalBranchLab)

      // Operating profit: revenue - suppliers - labor - waste - fixedCosts
      const monthKey = period.monthKey || from.slice(0, 7)
      const [wasteRes, fcFactory] = await Promise.all([
        supabase.from('factory_waste').select('amount').gte('date', from).lt('date', to),
        getFixedCostTotal('factory', monthKey),
      ])
      const fWaste = (wasteRes.data || []).reduce((s: any, r: any) => s + Number(r.amount || 0), 0)
      const fGross = fSales - fSupp - fLabor - fWaste
      setFactoryGross(fGross)
      const fOP = fGross - fcFactory

      // Branch operating profit
      let totalBranchFC = 0, totalBranchWaste = 0
      for (const br of BRANCHES) {
        const [brFc, brWaste] = await Promise.all([
          getFixedCostTotal(`branch_${br.id}`, monthKey),
          supabase.from('branch_waste').select('amount').eq('branch_id', br.id).gte('date', from).lt('date', to),
        ])
        totalBranchFC += brFc
        totalBranchWaste += (brWaste.data || []).reduce((s: any, r: any) => s + Number(r.amount || 0), 0)
      }
      const bGross = totalBranchRev - totalBranchExp - totalBranchLab - totalBranchWaste
      setTotalBranchGross(bGross)
      const bOP = bGross - totalBranchFC
      setOperatingProfit(fOP + bOP)

      // Previous period operating profit
      const pMonthKey = comparisonPeriod.from.slice(0, 7)
      const [pWasteRes, pFcFactory] = await Promise.all([
        supabase.from('factory_waste').select('amount').gte('date', pFrom).lt('date', pTo),
        getFixedCostTotal('factory', pMonthKey),
      ])
      const pFWaste = (pWasteRes.data || []).reduce((s: any, r: any) => s + Number(r.amount || 0), 0)
      const pFGross = pFSales - pFSupp - pFLabor - pFWaste
      setPrevFactoryGross(pFGross)
      const pFOP = pFGross - pFcFactory
      const pBGross = pTotalBranchRev - pTotalBranchExp - pTotalBranchLab
      setPrevBranchGross(pBGross)
      setPrevOperatingProfit(pFOP + pBGross)
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
    if (page === 'reports_alerts')       return <ReportsAlerts onBack={() => setPage(null)} />

    if (page === 'dept_creams')    return <DepartmentHome department="creams"    onBack={() => setPage(null)} />
    if (page === 'dept_dough')     return <DepartmentHome department="dough"     onBack={() => setPage(null)} />
    if (page === 'dept_packaging') return <DepartmentHome department="packaging" onBack={() => setPage(null)} />
    if (page === 'dept_cleaning')  return <DepartmentHome department="cleaning"  onBack={() => setPage(null)} />

    if (page === 'branch_dashboard') return <BranchManagerDashboard onBack={() => setPage(null)} />
    if (page === 'branch_comparison') return <BranchComparisonDashboard onBack={() => setPage(null)} />

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
              {/* הכנסות — clickable */}
              {(() => { const grandRevenue = factoryRevenue + totalBranchRevenue; return (
              <button onClick={() => setRevenueSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 pe-4 border-e border-slate-200 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors" style={{ borderInlineEnd: '1px solid #e2e8f0' }}>
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
              </button>
              )})()}
              {/* רווח תפעולי */}
              <div className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 px-4 border-e border-slate-200">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#7C3AED15' }}>
                  <ProfitIcon size={16} color="#7C3AED" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold mb-0.5">רווח תפעולי</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-lg font-extrabold ${operatingProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtK(operatingProfit)}</span>
                    <DiffBadge curr={operatingProfit} prev={prevOperatingProfit} />
                  </div>
                </div>
              </div>
              {/* % לייבור — clickable */}
              {(() => {
                const grandRevenue = factoryRevenue + totalBranchRevenue
                const grandLaborPct = grandRevenue > 0 ? (totalLabor / grandRevenue) * 100 : 0
                const prevGrandRevenue = prevFactoryRevenue + prevBranchRevenue
                const prevGrandLaborPct = prevGrandRevenue > 0 ? (prevTotalLabor / prevGrandRevenue) * 100 : 0
                return (
              <button onClick={() => setLaborSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 px-4 border-e border-slate-200 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors" style={{ borderInlineEnd: '1px solid #e2e8f0' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#3B82F615' }}>
                  <LaborIcon size={16} color="#3B82F6" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold mb-0.5">לייבור ממוצע</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-extrabold text-slate-900">{fmtK(totalLabor)}</span>
                    <DiffBadge curr={grandLaborPct} prev={prevGrandLaborPct} inverse />
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[11px] font-bold text-slate-500">{grandLaborPct.toFixed(1)}%</span>
                    <span className={`text-[11px] font-bold ${grandLaborPct <= 28 ? 'text-emerald-400' : 'text-rose-400'}`}>{grandLaborPct <= 28 ? '✓' : '✗'}</span>
                  </div>
                </div>
              </button>
              )})()}
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

        {/* ═══ 4-Card Grid Navigation ═══════════════════════════════════════ */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}
        >
          {/* Card 1: מפעל */}
          {showFactory && (
            <motion.div variants={fadeUp}>
              <button
                onClick={() => setExpandedSection(expandedSection === 'factory' ? null : 'factory')}
                style={{
                  width: '100%', border: 'none', borderRadius: '12px', padding: '14px',
                  background: '#EEEDFE', cursor: 'pointer', textAlign: 'right',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  outline: expandedSection === 'factory' ? '2.5px solid #534AB7' : 'none',
                }}
                className="hover:-translate-y-0.5 hover:shadow-md"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#534AB7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Monitor size={16} color="white" />
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#1e1b4b' }}>מפעל</div>
                    <div style={{ fontSize: '10px', color: '#7c6fcd', marginTop: '1px' }}>מחלקות · מכירות · לייבור</div>
                  </div>
                </div>
              </button>
            </motion.div>
          )}

          {/* Card 2: סניפים */}
          {showBranches && (
            <motion.div variants={fadeUp}>
              <button
                onClick={() => setExpandedSection(expandedSection === 'branches' ? null : 'branches')}
                style={{
                  width: '100%', border: 'none', borderRadius: '12px', padding: '14px',
                  background: '#E1F5EE', cursor: 'pointer', textAlign: 'right',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  outline: expandedSection === 'branches' ? '2.5px solid #0F6E56' : 'none',
                }}
                className="hover:-translate-y-0.5 hover:shadow-md"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#0F6E56', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <HomeIcon size={16} color="white" />
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#064e3b' }}>סניפים</div>
                    <div style={{ fontSize: '10px', color: '#3d9b7f', marginTop: '1px' }}>{branchList.map(b => b.name).join(' · ') || 'ניהול סניפים'}</div>
                  </div>
                </div>
              </button>
            </motion.div>
          )}

          {/* Card 3: ישיבות הנהלה */}
          {(canAccessPage('ceo_dashboard') || canAccessPage('branch_dashboard')) && (
            <motion.div variants={fadeUp}>
              <button
                onClick={() => setExpandedSection(expandedSection === 'meetings' ? null : 'meetings')}
                style={{
                  width: '100%', border: 'none', borderRadius: '12px', padding: '14px',
                  background: '#FAEEDA', cursor: 'pointer', textAlign: 'right',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  outline: expandedSection === 'meetings' ? '2.5px solid #BA7517' : 'none',
                }}
                className="hover:-translate-y-0.5 hover:shadow-md"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#BA7517', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Activity size={16} color="white" />
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#78350f' }}>ישיבות הנהלה</div>
                    <div style={{ fontSize: '10px', color: '#c68a2e', marginTop: '1px' }}>דשבורד מנכ"ל · השוואת סניפים</div>
                  </div>
                </div>
              </button>
            </motion.div>
          )}

          {/* Card 4: ניהול — admin only */}
          {appUser?.role === 'admin' && (
            <motion.div variants={fadeUp}>
              <button
                onClick={() => setExpandedSection(expandedSection === 'manage' ? null : 'manage')}
                style={{
                  width: '100%', border: 'none', borderRadius: '12px', padding: '14px',
                  background: '#f1f5f9', cursor: 'pointer', textAlign: 'right',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  outline: expandedSection === 'manage' ? '2.5px solid #64748b' : 'none',
                }}
                className="hover:-translate-y-0.5 hover:shadow-md"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Settings size={16} color="white" />
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#334155' }}>ניהול</div>
                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>משתמשים · דוחות · הגדרות</div>
                  </div>
                </div>
              </button>
            </motion.div>
          )}
        </motion.div>

        {/* ═══ Expanded Content Area ═══════════════════════════════════════════ */}

        {/* Factory content */}
        {expandedSection === 'factory' && showFactory && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="mb-4 py-0 overflow-hidden">
              <CardContent className="pb-5 pt-4">
                <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                  className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                  {filteredPanelFactory.map(item => {
                    const Icon = item.Icon
                    return (
                      <motion.div key={item.page} variants={fadeUp}>
                        <button onClick={() => setPage(item.page)}
                          className="w-full bg-slate-50 border-[1.5px] border-slate-200 rounded-xl p-3.5 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-current hover:-translate-y-0.5 hover:shadow-md">
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
            </Card>
          </motion.div>
        )}

        {/* Branches content */}
        {expandedSection === 'branches' && showBranches && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="mb-4 py-0 overflow-hidden">
              <CardContent className="pb-5 pt-4">
                <motion.div variants={staggerContainer} initial="hidden" animate="visible">
                  {/* Individual branch cards — stacked vertically */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {filteredBranches.map(br => {
                      const kpi = branchKpi.find(b => b.id === br.id)
                      const rev = kpi?.revenue ?? 0
                      const labPct = kpi?.laborPct ?? 0
                      return (
                        <motion.div key={br.id} variants={fadeUp}>
                          <button onClick={() => setPage(br.page)}
                            className="w-full bg-slate-50 rounded-xl p-3.5 px-4 cursor-pointer text-right transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
                            style={{ border: `1.5px solid ${br.color}30`, display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: br.color }}>
                              <Store size={18} color="white" />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div className="text-sm font-bold text-slate-900">{br.name}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">{rev > 0 ? `הכנסות: ${fmtK(rev)}` : 'אין נתונים'}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {rev > 0 && (
                                <span className={`text-xs font-bold ${labPct <= 28 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {labPct.toFixed(1)}% {labPct <= 28 ? '✓' : '✗'}
                                </span>
                              )}
                              <ChevronLeft size={14} color="#cbd5e1" />
                            </div>
                          </button>
                        </motion.div>
                      )
                    })}
                  </div>

                  {/* Branch comparison dashboard */}
                  <motion.div variants={fadeUp}>
                    <button onClick={() => setPage('branch_comparison')}
                      className="w-full bg-slate-50 border-[1.5px] border-indigo-400/20 rounded-xl p-3 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-indigo-400 hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-400/10 mt-3">
                      <div className="w-[38px] h-[38px] bg-indigo-400/10 rounded-[10px] flex items-center justify-center shrink-0">
                        <BarChart3 size={18} color="#818cf8" />
                      </div>
                      <div className="flex-1">
                        <div className="text-[13px] font-bold text-slate-900">השוואת סניפים</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">רווח והפסד השוואתי · גרפים</div>
                      </div>
                      <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                    </button>
                  </motion.div>

                  {/* Branch data import */}
                  <motion.div variants={fadeUp}>
                    <button onClick={() => setPage('branch_import')}
                      className="w-full bg-slate-50 border-[1.5px] border-indigo-400/20 rounded-xl p-3 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-indigo-400 hover:-translate-y-0.5 hover:shadow-md hover:shadow-indigo-400/10 mt-3">
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
            </Card>
          </motion.div>
        )}

        {/* Meetings content */}
        {expandedSection === 'meetings' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="mb-4 py-0 overflow-hidden">
              <CardContent className="pb-5 pt-4">
                <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                  className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                  {canAccessPage('ceo_dashboard') && (
                    <motion.div variants={fadeUp}>
                      <button onClick={() => setPage('ceo_dashboard')}
                        className="w-full bg-slate-50 border-[1.5px] border-slate-200 rounded-xl p-3.5 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-amber-400 hover:-translate-y-0.5 hover:shadow-md">
                        <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center shrink-0" style={{ background: '#f59e0b15' }}>
                          <TrophyIcon size={18} color="#f59e0b" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold text-slate-900">דשבורד מנכ"ל</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">מבט רשתי · כל הסניפים</div>
                        </div>
                        <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                      </button>
                    </motion.div>
                  )}
                  {canAccessPage('branch_dashboard') && (
                    <motion.div variants={fadeUp}>
                      <button onClick={() => setPage('branch_dashboard')}
                        className="w-full bg-slate-50 border-[1.5px] border-slate-200 rounded-xl p-3.5 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-emerald-400 hover:-translate-y-0.5 hover:shadow-md">
                        <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center shrink-0" style={{ background: '#34d39915' }}>
                          <ProfitIcon size={18} color="#34d399" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold text-slate-900">דשבורד מנהל סניפים</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">השוואת סניפים · P&L · KPI</div>
                        </div>
                        <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Manage content — admin only */}
        {expandedSection === 'manage' && appUser?.role === 'admin' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="mb-4 py-0 overflow-hidden">
              <CardContent className="pb-5 pt-4">
                <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                  className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                  {[
                    { label: 'ניהול משתמשים', subtitle: 'הרשאות · משתמשים · סניפים', Icon: UserCog, color: '#8b5cf6', page: 'user_management' },
                    { label: 'דוחות והתראות', subtitle: 'לוג דוחות · כללי התראה', Icon: Mail, color: '#f59e0b', page: 'reports_alerts' },
                    { label: 'הגדרות מערכת', subtitle: 'יעדים · עובדים · עלויות', Icon: Settings, color: '#64748b', page: 'settings' },
                    { label: 'ייבוא נתונים', subtitle: 'CSV מ-Base44 · העלאה', Icon: Database, color: '#818cf8', page: 'data_import' },
                  ].map(item => {
                    const Icon = item.Icon
                    return (
                      <motion.div key={item.page} variants={fadeUp}>
                        <button onClick={() => setPage(item.page)}
                          className="w-full bg-slate-50 border-[1.5px] border-slate-200 rounded-xl p-3.5 px-4 cursor-pointer flex items-center gap-3 text-right transition-all duration-150 hover:border-current hover:-translate-y-0.5 hover:shadow-md">
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
            </Card>
          </motion.div>
        )}


      </div>

      {/* Mobile Bottom Nav */}
      <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 h-14 bg-slate-900 hidden items-center justify-around z-[300] border-t border-slate-800" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <button onClick={() => setExpandedSection('factory')} className={`bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 ${expandedSection === 'factory' ? 'text-sky-400' : 'text-slate-400'}`}>
          <Monitor size={20} />
          <span>מפעל</span>
        </button>
        <button onClick={() => setExpandedSection('branches')} className={`bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 ${expandedSection === 'branches' ? 'text-sky-400' : 'text-slate-400'}`}>
          <Store size={20} />
          <span>סניפים</span>
        </button>
        <button onClick={() => setExpandedSection('meetings')} className={`bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 ${expandedSection === 'meetings' ? 'text-sky-400' : 'text-slate-400'}`}>
          <Activity size={20} />
          <span>הנהלה</span>
        </button>
        {appUser?.role === 'admin' && (
          <button onClick={() => setExpandedSection('manage')} className={`bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 ${expandedSection === 'manage' ? 'text-sky-400' : 'text-slate-400'}`}>
            <Settings size={20} />
            <span>ניהול</span>
          </button>
        )}
        <button onClick={() => logout()} className="bg-transparent border-none flex flex-col items-center gap-0.5 text-[10px] cursor-pointer py-1.5 px-3 text-slate-400">
          <LogOut size={20} />
          <span>יציאה</span>
        </button>
      </nav>

      {/* ─── Revenue Drill-Down Sheet ─────────────────────────────────────── */}
      <Sheet open={revenueSheetOpen} onOpenChange={setRevenueSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetHeader className="pb-3">
              <SheetTitle className="text-base font-bold text-slate-900">פירוט הכנסות — {period.label}</SheetTitle>
            </SheetHeader>
          {(() => {
            const grandRevenue = factoryRevenue + totalBranchRevenue
            const rows = [
              ...branchKpi.map(br => ({ name: br.name, revenue: br.revenue, pct: grandRevenue > 0 ? (br.revenue / grandRevenue) * 100 : 0 })),
              { name: 'מפעל (חיצוני)', revenue: factoryRevenue, pct: grandRevenue > 0 ? (factoryRevenue / grandRevenue) * 100 : 0 },
            ]
            return (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">גוף</TableHead>
                    <TableHead className="text-center">הכנסות</TableHead>
                    <TableHead className="text-center">% מסה"כ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium text-right">{r.name}</TableCell>
                      <TableCell className="text-center">{fmtK(r.revenue)}</TableCell>
                      <TableCell className="text-center">{r.pct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-50 font-bold">
                    <TableCell className="font-bold text-right">סה"כ</TableCell>
                    <TableCell className="text-center font-bold">{fmtK(grandRevenue)}</TableCell>
                    <TableCell className="text-center font-bold">100%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )
          })()}
          </SheetContent>
        </SheetPortal>
      </Sheet>

      {/* ─── Labor Drill-Down Sheet ───────────────────────────────────────── */}
      <Sheet open={laborSheetOpen} onOpenChange={setLaborSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetHeader className="pb-3">
              <SheetTitle className="text-base font-bold text-slate-900">פירוט לייבור — {period.label}</SheetTitle>
            </SheetHeader>
          {(() => {
            const grandRevenue = factoryRevenue + totalBranchRevenue
            const rows = [
              ...branchKpi.map(br => ({ name: br.name, labor: br.laborCost, pct: br.laborPct })),
              { name: 'מפעל', labor: factoryLabor, pct: factoryRevenue > 0 ? (factoryLabor / factoryRevenue) * 100 : 0 },
            ]
            const totalLaborPct = grandRevenue > 0 ? (totalLabor / grandRevenue) * 100 : 0
            return (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">גוף</TableHead>
                    <TableHead className="text-center">עלות מעסיק</TableHead>
                    <TableHead className="text-center">% מהכנסותיו</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium text-right">{r.name}</TableCell>
                      <TableCell className="text-center">{fmtK(r.labor)}</TableCell>
                      <TableCell className="text-center">
                        <span className={r.pct <= 28 ? 'text-emerald-500' : 'text-rose-500'}>{r.pct.toFixed(1)}%</span>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-50 font-bold">
                    <TableCell className="font-bold text-right">סה"כ</TableCell>
                    <TableCell className="text-center font-bold">{fmtK(totalLabor)}</TableCell>
                    <TableCell className="text-center font-bold">
                      <span className={totalLaborPct <= 28 ? 'text-emerald-500' : 'text-rose-500'}>{totalLaborPct.toFixed(1)}%</span>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )
          })()}
          </SheetContent>
        </SheetPortal>
      </Sheet>
    </div>
  )
}
