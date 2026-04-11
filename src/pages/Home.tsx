import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, monthEnd, getFixedCostTotal, fetchFactoryPL, getOverheadPct } from '../lib/supabase'
import { fetchAllBranchesProfit } from '../lib/profitCalc'
import { usePeriod } from '../lib/PeriodContext'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PeriodPicker from '../components/PeriodPicker'
import InstallPWA from '../components/InstallPWA'
import EmployeeHome from './EmployeeHome'
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
import FactoryEmployees from './FactoryEmployees'
import CEODashboard from './CEODashboard'
import BranchHome from './BranchHome'
import BranchManagerDashboard from './BranchManagerDashboard'
import BranchComparisonDashboard from './BranchComparisonDashboard'
import DepartmentHome from './DepartmentHome'
import UserManagement from './UserManagement'
import ReportsAlerts from './ReportsAlerts'
import DataImport from './DataImport'
import ProductionReportUpload from './ProductionReportUpload'
import InternalSalesUpload from './InternalSalesUpload'
import ProductCatalog from './ProductCatalog'
import {
  FlaskConical, Croissant, Package, HardHat, BarChart3,
  Store, Settings, LogOut, TrendingUp, TrendingDown, Mail,
  AlertTriangle, ClipboardList, Truck, UserCog, Activity,
  Factory, ChevronDown, ChevronLeft, Database, Monitor, Home as HomeIcon,
  LayoutDashboard, X, Users, FileSpreadsheet, ArrowRightLeft, ShoppingCart
} from 'lucide-react'
import { TrophyIcon, ProfitIcon, RevenueIcon, LaborIcon } from '@/components/icons'

// ─── קבועים ─────────────────────────────────────────────────────────────────

const PANEL_FACTORY = [
  { label: 'קרמים',        subtitle: 'ייצור · פחת · תיקונים',         Icon: FlaskConical, color: '#818cf8', page: 'dept_creams' },
  { label: 'בצקים',        subtitle: 'ייצור · פחת · תיקונים',         Icon: Croissant,    color: '#8b5cf6', page: 'dept_dough' },
  { label: 'אריזה',        subtitle: 'כמויות · תיקונים · לייבור',     Icon: Package,      color: '#0ea5e9', page: 'dept_packaging' },
  { label: 'ניקיון/נהג',   subtitle: 'תיקונים · לייבור',              Icon: Truck,        color: '#64748b', page: 'dept_cleaning' },
  { label: 'לייבור מרוכז', subtitle: 'העלאת דוח נוכחות PDF · כל המחלקות',       Icon: HardHat,      color: '#f59e0b', page: 'labor' },
  { label: 'מכירות',        subtitle: 'קרמים · בצקים · B2B · שונות',  Icon: TrendingUp,   color: '#6366f1', page: 'factory_b2b' },
  { label: 'ספקים',         subtitle: 'חשבוניות · ניהול ספקים',        Icon: ClipboardList, color: '#34d399', page: 'suppliers' },
  { label: 'דשבורד מפעל',  subtitle: 'KPI · רווח · גרפים',           Icon: ProfitIcon,    color: '#6366f1', page: 'factory_dashboard' },
  { label: 'עובדים',        subtitle: 'ניהול עובדי מפעל',              Icon: Users,        color: '#8b5cf6', page: 'factory_employees' },
  { label: 'מכירות פנימיות', subtitle: 'תעודות משלוח לסניפים',        Icon: ArrowRightLeft,  color: '#f59e0b', page: 'internal_sales' },
  { label: 'קטלוג מוצרים',  subtitle: 'מחירים · מחלקות · היסטוריה',  Icon: ShoppingCart,    color: '#8b5cf6', page: 'product_catalog' },
  { label: 'דוח ייצור מרוכז', subtitle: 'העלאת דוח ייצור מ-Excel',    Icon: FileSpreadsheet, color: '#10b981', page: 'production_report_upload' },
  { label: 'הגדרות מפעל',  subtitle: 'יעדים · עלויות קבועות',        Icon: Settings,     color: '#64748b', page: 'settings' },
]

const PANEL_MANAGE = [
  { label: 'דשבורד מנכ"ל', subtitle: 'מבט רשתי · כל הסניפים', Icon: TrophyIcon,   color: '#f59e0b', page: 'ceo_dashboard' },
  { label: 'דוחות והתראות', subtitle: 'לוג דוחות · כללי התראה', Icon: Mail,         color: '#f59e0b', page: 'reports_alerts' },
  { label: 'הגדרות מערכת', subtitle: 'העמסת מטה · הגדרות כלליות', Icon: Settings, color: '#64748b', page: 'system_settings' },
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

  // Determine which sections to show based on role
  const showFactory = filteredPanelFactory.length > 0
  const showBranches = appUser?.role === 'admin' || (appUser?.role === 'branch' && filteredBranches.length > 0)
  const showManage = appUser?.role === 'admin' && managePanelItems.length > 0

  // Modified internal sales badges
  const [modifiedSales, setModifiedSales] = useState<{ total: number; byDept: Record<string, number> }>({ total: 0, byDept: {} })

  useEffect(() => {
    async function loadModified() {
      const { data } = await supabase.from('internal_sales')
        .select('id').eq('status', 'modified')
      if (!data) return
      const saleIds = data.map(s => s.id)
      if (saleIds.length === 0) { setModifiedSales({ total: 0, byDept: {} }); return }
      const { data: items } = await supabase.from('internal_sale_items')
        .select('department, sale_id').in('sale_id', saleIds)
      const byDept: Record<string, number> = {}
      const salesPerDept = new Map<string, Set<number>>()
      for (const item of (items || [])) {
        const dept = item.department || 'אחר'
        if (!salesPerDept.has(dept)) salesPerDept.set(dept, new Set())
        salesPerDept.get(dept)!.add(item.sale_id)
      }
      for (const [dept, saleSet] of salesPerDept) byDept[dept] = saleSet.size
      setModifiedSales({ total: data.length, byDept })
    }
    loadModified()

    // Realtime subscription
    const channel = supabase.channel('internal-sales-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_sales' }, () => loadModified())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

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
  const [branchLaborTargets, setBranchLaborTargets] = useState<Record<number, number>>({})

  // ─── Data Loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadKpi() {
      const monthKey = period.monthKey || from.slice(0, 7)
      const overheadPct = await getOverheadPct()

      // Factory P&L via shared function
      const factoryPL = await fetchFactoryPL(from, to, monthKey)
      const fSales = factoryPL.sales
      const fLabor = factoryPL.labor
      setFactoryRevenue(fSales)
      setFactoryLabor(fLabor)
      setFactoryGross(factoryPL.controllableMargin)

      // Fetch per-branch labor targets
      const { data: kpiData } = await supabase.from('branch_kpi_targets').select('branch_id, labor_pct')
      const laborTargetMap: Record<number, number> = {}
      if (kpiData) {
        kpiData.forEach((r: any) => { laborTargetMap[r.branch_id] = Number(r.labor_pct || 0) })
        setBranchLaborTargets(laborTargetMap)
      }

      // Branch data via View (single query for all branches)
      const branchIds = BRANCHES.map(br => br.id)
      const branchProfits = await fetchAllBranchesProfit(branchIds, from, to)

      const bKpi: BranchKpi[] = []
      let totalBranchRev = 0, totalBranchLab = 0, alertCount = 0
      let totalBranchOP = 0

      for (const br of BRANCHES) {
        const bp = branchProfits.find(p => p.branchId === br.id)
        const rev = bp?.revenue || 0
        const lab = bp?.laborCost || 0
        const labPct = rev > 0 ? (lab / rev) * 100 : 0
        const brTarget = laborTargetMap[br.id] || 0
        if (brTarget > 0 && labPct > brTarget) alertCount++
        totalBranchRev += rev
        totalBranchLab += lab
        totalBranchOP += bp?.operatingProfit || 0
        bKpi.push({ id: br.id, name: br.name, color: br.color, revenue: rev, laborCost: lab, laborPct: labPct })
      }

      setBranchKpi(bKpi)
      setTotalBranchRevenue(totalBranchRev)
      const avgPct = totalBranchRev > 0 ? (totalBranchLab / totalBranchRev) * 100 : 0
      setAvgLaborPct(avgPct)
      setTotalLabor(fLabor + totalBranchLab)
      setAlerts(alertCount)
      setTotalBranchGross(totalBranchRev > 0 ? totalBranchRev - totalBranchLab : 0)
      setOperatingProfit(factoryPL.operatingProfit + totalBranchOP)

      // Previous period (comparison) via shared functions
      const pFrom = comparisonPeriod.from, pTo = comparisonPeriod.to
      const pMonthKey = pFrom.slice(0, 7)

      const prevFactoryPL = await fetchFactoryPL(pFrom, pTo, pMonthKey)
      setPrevFactoryRevenue(prevFactoryPL.sales)
      setPrevFactoryGross(prevFactoryPL.controllableMargin)

      const prevBranchProfits = await fetchAllBranchesProfit(branchIds, pFrom, pTo)
      let pTotalBranchRev = 0, pTotalBranchLab = 0, pTotalBranchOP = 0
      for (const bp of prevBranchProfits) {
        pTotalBranchRev += bp.revenue
        pTotalBranchLab += bp.laborCost
        pTotalBranchOP += bp.operatingProfit
      }
      setPrevBranchRevenue(pTotalBranchRev)
      const pAvgPct = pTotalBranchRev > 0 ? (pTotalBranchLab / pTotalBranchRev) * 100 : 0
      setPrevAvgLaborPct(pAvgPct)
      setPrevTotalLabor(prevFactoryPL.labor + pTotalBranchLab)
      setPrevBranchGross(pTotalBranchRev > 0 ? pTotalBranchRev - pTotalBranchLab : 0)
      setPrevOperatingProfit(prevFactoryPL.operatingProfit + pTotalBranchOP)
    }
    loadKpi()
  }, [from, to])

  // Employee role gets their own dedicated home page (after all hooks)
  if (appUser?.role === 'employee') return <EmployeeHome onNavigate={(p: string) => setPage(p)} />

  // Scheduler goes directly to their branch's team management page
  if (appUser?.role === 'scheduler' && appUser.branch_id) {
    const schedulerBranch = branchList.find(b => b.id === appUser.branch_id)
    if (schedulerBranch) {
      return <BranchHome branch={{ id: schedulerBranch.id, name: schedulerBranch.name, color: schedulerBranch.color }} onBack={() => supabase.auth.signOut()} />
    }
    // Branches not loaded yet — show loading
    if (branchList.length === 0) {
      return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>טוען...</div>
      </div>
    }
  }

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
    if (page === 'factory_employees')  return <FactoryEmployees onBack={() => setPage(null)} />
    if (page === 'production_report_upload') return <ProductionReportUpload onBack={() => setPage(null)} />
    if (page === 'internal_sales') return <InternalSalesUpload onBack={() => setPage(null)} />
    if (page === 'product_catalog') return <ProductCatalog onBack={() => setPage(null)} />
    if (page === 'ceo_dashboard')        return <CEODashboard onBack={() => setPage(null)} />
    if (page === 'data_import')          return <DataImport onBack={() => setPage(null)} />
    if (page === 'branch_import')        return <DataImport onBack={() => setPage(null)} branchOnly />
    if (page === 'user_management')      return <UserManagement onBack={() => setPage(null)} />
    if (page === 'system_settings')      return <UserManagement onBack={() => setPage(null)} initialTab="settings" />
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
    <div className="min-h-screen font-sans" style={{ direction: 'rtl', background: '#f8fafc' }}>

      <div className="max-w-[900px] mx-auto px-6 py-5">

        {/* ─── כותרת ─────────────────────────────────────────────────────── */}
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          className="mb-4 flex items-center justify-between flex-wrap gap-2.5"
        >
          <div className="flex items-center gap-3.5">
            <div style={{ width: 44, height: 44, borderRadius: 10, background: '#0d6165', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'white', fontSize: 20, fontWeight: 900, fontFamily: 'serif' }}>מ</span>
            </div>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>שלום, {appUser?.name || 'משתמש'}</h1>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
                {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <InstallPWA />
            <PeriodPicker period={period} onChange={setPeriod} />
            <button
              onClick={() => logout()}
              title="יציאה"
              style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <LogOut size={16} color="#64748b" />
            </button>
          </div>
        </motion.div>

        {/* ─── KPI Strip ──────────────────────────────────────────────────── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.1 }}>
          <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 20, padding: 0 }}>
            <div className="kpi-grid flex items-center gap-0 flex-wrap" style={{ padding: '14px 24px' }}>
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
                    {(() => { const avgT = Object.values(branchLaborTargets).length > 0 ? Object.values(branchLaborTargets).reduce((a, b) => a + b, 0) / Object.values(branchLaborTargets).length : 0; return avgT > 0 ? <span className={`text-[11px] font-bold ${grandLaborPct <= avgT ? 'text-emerald-400' : 'text-rose-400'}`}>{grandLaborPct <= avgT ? '\u2713' : '\u2717'}</span> : null })()}
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
            </div>
          </div>
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
                  width: '100%', border: expandedSection === 'factory' ? '2px solid #6366f1' : '1px solid #f1f5f9', borderRadius: '12px', padding: '14px',
                  background: 'white', cursor: 'pointer', textAlign: 'right',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
                className="hover:shadow-md hover:border-[#c7d2fe]"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Monitor size={16} color="#6366f1" />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>מפעל</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: '1px' }}>מחלקות · מכירות · לייבור</div>
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
                  width: '100%', border: expandedSection === 'branches' ? '2px solid #6366f1' : '1px solid #f1f5f9', borderRadius: '12px', padding: '14px',
                  background: 'white', cursor: 'pointer', textAlign: 'right',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
                className="hover:shadow-md hover:border-[#c7d2fe]"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <HomeIcon size={16} color="#6366f1" />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>סניפים</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: '1px' }}>{branchList.map(b => b.name).join(' · ') || 'ניהול סניפים'}</div>
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
                  width: '100%', border: expandedSection === 'meetings' ? '2px solid #6366f1' : '1px solid #f1f5f9', borderRadius: '12px', padding: '14px',
                  background: 'white', cursor: 'pointer', textAlign: 'right',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
                className="hover:shadow-md hover:border-[#c7d2fe]"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Activity size={16} color="#6366f1" />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>ישיבות הנהלה</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: '1px' }}>דשבורד מנכ"ל · השוואת סניפים</div>
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
                  width: '100%', border: expandedSection === 'manage' ? '2px solid #6366f1' : '1px solid #f1f5f9', borderRadius: '12px', padding: '14px',
                  background: 'white', cursor: 'pointer', textAlign: 'right',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
                className="hover:shadow-md hover:border-[#c7d2fe]"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Settings size={16} color="#6366f1" />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>ניהול</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: '1px' }}>משתמשים · דוחות · הגדרות</div>
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
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 16, padding: '16px 16px 20px' }}>
                <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                  className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                  {filteredPanelFactory.map(item => {
                    const Icon = item.Icon
                    // Badge logic for modified internal sales
                    const deptMap: Record<string, string> = { dept_creams: 'קרמים', dept_dough: 'בצקים' }
                    const badgeCount = item.page === 'internal_sales' ? modifiedSales.total
                      : deptMap[item.page] ? (modifiedSales.byDept[deptMap[item.page]] || 0) : 0
                    return (
                      <motion.div key={item.page} variants={fadeUp}>
                        <button onClick={() => setPage(item.page)}
                          style={{ width: '100%', background: 'white', border: badgeCount > 0 ? '1px solid #fed7aa' : '1px solid #f1f5f9', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', position: 'relative' }}
                          className="hover:shadow-md hover:border-[#c7d2fe]">
                          {badgeCount > 0 && (
                            <div style={{ position: 'absolute', top: -6, left: -6, background: '#ef4444', color: 'white', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, boxShadow: '0 1px 4px rgba(239,68,68,0.4)' }}>
                              {badgeCount}
                            </div>
                          )}
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Icon size={18} color="#6366f1" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{item.label}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{item.subtitle}</div>
                            {badgeCount > 0 && (
                              <div style={{ fontSize: 11, color: '#ea580c', fontWeight: 600, marginTop: 2 }}>
                                {badgeCount} הזמנות ממתינות לאישורך
                              </div>
                            )}
                          </div>
                          <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                        </button>
                      </motion.div>
                    )
                  })}
                </motion.div>
            </div>
          </motion.div>
        )}

        {/* Branches content */}
        {expandedSection === 'branches' && showBranches && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 16, padding: '16px 16px 20px' }}>
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
                            style={{ width: '100%', background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
                            className="hover:shadow-md hover:border-[#c7d2fe]">
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Store size={18} color="#6366f1" />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{br.name}</div>
                              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{rev > 0 ? `הכנסות: ${fmtK(rev)}` : 'אין נתונים'}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {rev > 0 && (
                                <span className={`text-xs font-bold ${(() => { const t = branchLaborTargets[br.id] || 0; return t > 0 ? (labPct <= t ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-500' })()}`}>
                                  {labPct.toFixed(1)}%{(() => { const t = branchLaborTargets[br.id] || 0; return t > 0 ? (labPct <= t ? ' \u2713' : ' \u2717') : '' })()}
                                </span>
                              )}
                              <ChevronLeft size={14} color="#cbd5e1" />
                            </div>
                          </button>
                        </motion.div>
                      )
                    })}
                  </div>

                  {/* Branch comparison dashboard — admin only */}
                  {canAccessPage('branch_comparison') && <motion.div variants={fadeUp}>
                    <button onClick={() => setPage('branch_comparison')}
                      style={{ width: '100%', background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginTop: 12 }}
                      className="hover:shadow-md hover:border-[#c7d2fe]">
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <BarChart3 size={18} color="#6366f1" />
                      </div>
                      <div className="flex-1">
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>השוואת סניפים</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>רווח והפסד השוואתי · גרפים</div>
                      </div>
                      <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                    </button>
                  </motion.div>}

                  {/* Branch data import */}
                  <motion.div variants={fadeUp}>
                    <button onClick={() => setPage('branch_import')}
                      style={{ width: '100%', background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginTop: 12 }}
                      className="hover:shadow-md hover:border-[#c7d2fe]">
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Database size={18} color="#6366f1" />
                      </div>
                      <div className="flex-1">
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>ייבוא נתוני סניפים</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>CSV מ-Base44 · כל הסניפים ביחד</div>
                      </div>
                      <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                    </button>
                  </motion.div>
                </motion.div>
            </div>
          </motion.div>
        )}

        {/* Meetings content */}
        {expandedSection === 'meetings' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 16, padding: '16px 16px 20px' }}>
                <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                  className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                  {canAccessPage('ceo_dashboard') && (
                    <motion.div variants={fadeUp}>
                      <button onClick={() => setPage('ceo_dashboard')}
                        style={{ width: '100%', background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
                        className="hover:shadow-md hover:border-[#c7d2fe]">
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <TrophyIcon size={18} color="#6366f1" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>דשבורד מנכ"ל</div>
                          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>מבט רשתי · כל הסניפים</div>
                        </div>
                        <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                      </button>
                    </motion.div>
                  )}
                  {canAccessPage('branch_dashboard') && (
                    <motion.div variants={fadeUp}>
                      <button onClick={() => setPage('branch_dashboard')}
                        style={{ width: '100%', background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
                        className="hover:shadow-md hover:border-[#c7d2fe]">
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <ProfitIcon size={18} color="#6366f1" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>דשבורד מנהל סניפים</div>
                          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>השוואת סניפים · P&L · KPI</div>
                        </div>
                        <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                      </button>
                    </motion.div>
                  )}
                </motion.div>
            </div>
          </motion.div>
        )}

        {/* Manage content — admin only */}
        {expandedSection === 'manage' && appUser?.role === 'admin' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 16, padding: '16px 16px 20px' }}>
                <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                  className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                  {[
                    { label: 'ניהול משתמשים', subtitle: 'הרשאות · משתמשים · סניפים', Icon: UserCog, color: '#8b5cf6', page: 'user_management' },
                    { label: 'דוחות והתראות', subtitle: 'לוג דוחות · כללי התראה', Icon: Mail, color: '#f59e0b', page: 'reports_alerts' },
                    { label: 'הגדרות מערכת', subtitle: 'העמסת מטה · הגדרות כלליות', Icon: Settings, color: '#64748b', page: 'system_settings' },
                    { label: 'ייבוא נתונים', subtitle: 'CSV מ-Base44 · העלאה', Icon: Database, color: '#818cf8', page: 'data_import' },
                  ].map(item => {
                    const Icon = item.Icon
                    return (
                      <motion.div key={item.page} variants={fadeUp}>
                        <button onClick={() => setPage(item.page)}
                          style={{ width: '100%', background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
                          className="hover:shadow-md hover:border-[#c7d2fe]">
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Icon size={18} color="#6366f1" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{item.label}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{item.subtitle}</div>
                          </div>
                          <ChevronLeft size={14} color="#cbd5e1" className="shrink-0" />
                        </button>
                      </motion.div>
                    )
                  })}
                </motion.div>
            </div>
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
                        {(() => { const t = branchLaborTargets[branchKpi.find(b => b.name === r.name)?.id ?? 0] || 0; return <span className={t > 0 ? (r.pct <= t ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-700'}>{r.pct.toFixed(1)}%</span> })()}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-50 font-bold">
                    <TableCell className="font-bold text-right">סה"כ</TableCell>
                    <TableCell className="text-center font-bold">{fmtK(totalLabor)}</TableCell>
                    <TableCell className="text-center font-bold">
                      {(() => { const avgT = Object.values(branchLaborTargets).length > 0 ? Object.values(branchLaborTargets).reduce((a, b) => a + b, 0) / Object.values(branchLaborTargets).length : 0; return <span className={avgT > 0 ? (totalLaborPct <= avgT ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-700'}>{totalLaborPct.toFixed(1)}%</span> })()}
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
// build 1775723518
