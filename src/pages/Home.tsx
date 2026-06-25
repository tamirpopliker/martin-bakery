import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, monthEnd, getFixedCostTotal, fetchFactoryPL, getOverheadPct } from '../lib/supabase'
import { calculateConsolidatedPL } from '../lib/calculatePL'
import { fetchRevenueBySource } from '../lib/revenueBySource'
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
import FactoryDepartments from './FactoryDepartments'
import FactoryEquipment from './FactoryEquipment'
import B2BCustomers from './B2BCustomers'
import EmployerCostsUpload from './EmployerCostsUpload'
import FactorySpecialOrders from './FactorySpecialOrders'
import SuppliersReport from './SuppliersReport'
import ManagementReports from './ManagementReports'
import HRDashboard from './HRDashboard'
import BonusKPI from './BonusKPI'
import MonthlyChangesReport from './MonthlyChangesReport'
import QualityHub from './QualityHub'
import CustomerComplaints from './CustomerComplaints'
import FreezerLog from './FreezerLog'
import {
  FlaskConical, Croissant, Package, HardHat, BarChart3,
  Store, Settings, LogOut, TrendingUp, TrendingDown, Mail,
  AlertTriangle, ClipboardList, Truck, UserCog, Activity,
  Factory, ChevronDown, ChevronLeft, Database, Monitor, Home as HomeIcon,
  LayoutDashboard, X, Users, FileSpreadsheet, ArrowRightLeft, ShoppingCart, Wrench, Building2, CreditCard, Briefcase, Cake,
  IdCard, FileSignature, Globe, BookOpen, ShieldCheck,
} from 'lucide-react'
import { TrophyIcon, ProfitIcon, RevenueIcon, LaborIcon } from '@/components/icons'

// ─── קבועים ─────────────────────────────────────────────────────────────────

const PANEL_FACTORY = [
  { label: 'מחלקות',           subtitle: 'קרמים · בצקים · אריזה · ניקיון/נהג',  Icon: Building2,       color: '#6366f1', page: 'factory_departments' },
  { label: 'מכירות פנימיות',   subtitle: 'תעודות משלוח לסניפים',                Icon: ArrowRightLeft,  color: '#f59e0b', page: 'internal_sales' },
  { label: 'מכירות חיצוניות',  subtitle: 'לקוחות עסקיים · B2B',                 Icon: TrendingUp,      color: '#6366f1', page: 'factory_b2b' },
  { label: 'הזמנות עוגות מיוחדות', subtitle: 'עוגות מעוצבות · הדפסה · כל הסניפים',  Icon: Cake,             color: '#ec4899', page: 'factory_special_orders' },
  { label: 'לייבור מרוכז',     subtitle: 'העלאת דוח נוכחות PDF · כל המחלקות',   Icon: HardHat,         color: '#f59e0b', page: 'labor' },
  { label: 'דוח ייצור מרוכז',  subtitle: 'העלאת דוח ייצור מ-Excel',             Icon: FileSpreadsheet, color: '#10b981', page: 'production_report_upload' },
  { label: 'פחת / תיקונים / ציוד', subtitle: 'פחת · תיקונים · ציוד · כל המחלקות', Icon: Wrench,          color: '#64748b', page: 'factory_equipment' },
  { label: 'ספקים',             subtitle: 'חשבוניות · ניהול ספקים',              Icon: ClipboardList,   color: '#34d399', page: 'suppliers' },
  { label: 'דשבורד מפעל',      subtitle: 'KPI · רווח · גרפים',                  Icon: ProfitIcon,      color: '#6366f1', page: 'factory_dashboard' },
  { label: 'קטלוג מוצרים',     subtitle: 'מחירים · מחלקות · היסטוריה',          Icon: ShoppingCart,     color: '#8b5cf6', page: 'product_catalog' },
  { label: 'עובדים',            subtitle: 'ניהול עובדי מפעל',                    Icon: Users,           color: '#8b5cf6', page: 'factory_employees' },
  { label: 'איכות ובקרה',      subtitle: 'תלונות · משרד הבריאות · תחזוקה',       Icon: ShieldCheck,     color: '#dc2626', page: 'quality_hub' },
  { label: 'הגדרות מפעל',      subtitle: 'יעדים · עלויות קבועות',               Icon: Settings,        color: '#64748b', page: 'settings' },
]

const PANEL_MANAGE = [
  { label: 'מחלקת HR', subtitle: 'עובדים · מסמכים · קליטה · יומן שינויים', Icon: IdCard, color: '#0d9488', page: 'hr_dashboard' },
  { label: 'לקוחות הקפה (B2B)', subtitle: 'חשבוניות · תשלומים · מעקב חובות', Icon: CreditCard, color: '#dc2626', page: 'b2b_customers' },
  { label: 'דשבורד מנכ"ל', subtitle: 'מבט רשתי · כל הסניפים', Icon: TrophyIcon,   color: '#f59e0b', page: 'ceo_dashboard' },
  { label: 'דוחות ניהול', subtitle: 'בקרת הכנסות · לייבור · קופות · שלמות נתונים', Icon: ClipboardList, color: '#6366f1', page: 'management_reports' },
  { label: 'בונוס KPI', subtitle: 'חישוב ואישור בונוס חודשי למנהלי סניף', Icon: TrophyIcon, color: '#f59e0b', page: 'bonus_kpi' },
  { label: 'דוח ספקים מאוחד', subtitle: 'איחוד שמות ספקים · סיכום לפי סניף', Icon: Briefcase, color: '#6366f1', page: 'suppliers_report' },
  { label: 'דוחות והתראות', subtitle: 'לוג דוחות · כללי התראה', Icon: Mail,         color: '#f59e0b', page: 'reports_alerts' },
  { label: 'הגדרות מערכת', subtitle: 'העמסת מטה · הגדרות כלליות', Icon: Settings, color: '#64748b', page: 'system_settings' },
  { label: 'ייבוא נתונים', subtitle: 'CSV מ-Base44 · העלאה',   Icon: Database, color: '#818cf8', page: 'data_import' },
]

const fmtK = (n: number) => n === 0 ? '—' : '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })

interface BranchKpi {
  id: number; name: string; color: string;
  revenue: number; laborCost: number; laborPct: number;
  managerSalary: number; waste: number; operatingProfit: number; hqAllocation: number;
  factoryPurchases: number   // intercompany cost (subtracted in br.operatingProfit; added back for the consolidated OP display)
}

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
  // When FactoryEmployees' edit button is clicked, we stash the employee key
  // here and switch to hr_dashboard. HRDashboard reads it on mount and opens
  // the EmployeeDetail directly. Cleared when we leave hr_dashboard.
  const [hrInitialKey, setHrInitialKey] = useState<{ kind: 'branch' | 'factory'; id: number } | null>(null)
  // Remembers which page navigated into hr_dashboard, so its back button
  // returns the user there instead of dumping them at the home screen.
  const [hrOriginPage, setHrOriginPage] = useState<string | null>(null)
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
  const showManage = managePanelItems.length > 0
  // KPI strip + drill-down sheets are admin-only. Factory/scheduler/quality_only
  // do not get consolidated branch+factory financials on the home page.
  const isAdmin = appUser?.role === 'admin'

  // Modified internal sales badge (internal_sales only)
  const [modifiedCount, setModifiedCount] = useState(0)

  // Unread special-order notifications for this user (factory/admin badge + banner).
  // Counts rows in order_notifications; cleared when the user opens FactorySpecialOrders.
  const [newSpecialOrdersCount, setNewSpecialOrdersCount] = useState(0)
  useEffect(() => {
    if (!appUser?.id) return
    let cancelled = false
    async function loadUnreadCount() {
      const { count } = await supabase.from('order_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', appUser!.id)
        .eq('read', false)
      if (!cancelled) setNewSpecialOrdersCount(count || 0)
    }
    loadUnreadCount()
    // Poll every 60 seconds so the badge stays fresh without a realtime subscription.
    const interval = setInterval(loadUnreadCount, 60_000)
    // Also refresh when the tab returns to the foreground — avoids stale counts after long idle.
    function onVisible() { if (document.visibilityState === 'visible') loadUnreadCount() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [appUser?.id])

  useEffect(() => {
    async function loadModified() {
      const { count } = await supabase.from('internal_sales')
        .select('id', { count: 'exact', head: true }).eq('status', 'modified')
      setModifiedCount(count || 0)
    }
    loadModified()

    // Realtime subscription — fires on any status change
    const channel = supabase.channel('internal-sales-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_sales', filter: 'status=eq.modified' }, () => loadModified())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'internal_sales' }, () => loadModified())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // KPI data
  const [factoryRevenue, setFactoryRevenue] = useState(0)
  // External-only factory sales (factoryPL.sales minus internal sales to branches).
  // Used for the "פירוט הכנסות" drill-down where the row must not double-count
  // factory→branch transfers that already appear as branch revenue.
  const [factoryExternalRevenue, setFactoryExternalRevenue] = useState(0)
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
  const [branchOperatingProfit, setBranchOperatingProfit] = useState(0)
  const [prevBranchOperatingProfit, setPrevBranchOperatingProfit] = useState(0)
  const [branchLaborCost, setBranchLaborCost] = useState(0)
  const [prevBranchLaborCost, setPrevBranchLaborCost] = useState(0)
  const [branchWaste, setBranchWaste] = useState(0)
  const [prevBranchWaste, setPrevBranchWaste] = useState(0)

  // B2B overdue badge
  const [overdueCount, setOverdueCount] = useState(0)
  useEffect(() => {
    async function loadOverdue() {
      const { count } = await supabase.from('b2b_invoices').select('id', { count: 'exact', head: true }).eq('status', 'overdue')
      setOverdueCount(count || 0)
    }
    loadOverdue()
    const ch = supabase.channel('b2b-overdue').on('postgres_changes', { event: '*', schema: 'public', table: 'b2b_invoices' }, () => loadOverdue()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])
  const [factoryLabor, setFactoryLabor] = useState(0)
  const [factoryManagerSalary, setFactoryManagerSalary] = useState(0)
  const [factoryWasteState, setFactoryWasteState] = useState(0)
  const [factoryOp, setFactoryOp] = useState(0)
  const [hqAllocationTotal, setHqAllocationTotal] = useState(0)
  const [hqIsActual, setHqIsActual] = useState(false)
  const [revenueSheetOpen, setRevenueSheetOpen] = useState(false)
  const [laborSheetOpen, setLaborSheetOpen] = useState(false)
  const [opSheetOpen, setOpSheetOpen] = useState(false)
  const [wasteSheetOpen, setWasteSheetOpen] = useState(false)
  const [branchLaborTargets, setBranchLaborTargets] = useState<Record<number, number>>({})
  // Revenue-by-source (קופות / אתר / הקפה) — per-branch maps + prev-period totals + drill-down flags
  const [posByBranch, setPosByBranch] = useState<Record<number, number>>({})
  const [websiteByBranch, setWebsiteByBranch] = useState<Record<number, number>>({})
  const [creditByBranch, setCreditByBranch] = useState<Record<number, number>>({})
  const [prevPosTotal, setPrevPosTotal] = useState(0)
  const [prevWebsiteTotal, setPrevWebsiteTotal] = useState(0)
  const [prevCreditTotal, setPrevCreditTotal] = useState(0)
  const [posSheetOpen, setPosSheetOpen] = useState(false)
  const [websiteSheetOpen, setWebsiteSheetOpen] = useState(false)
  const [creditSheetOpen, setCreditSheetOpen] = useState(false)

  // ─── Data Loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    // KPIs are admin-only — don't fetch consolidated financials for other roles.
    if (!isAdmin) return
    // Wait for the async branch list from BranchContext — otherwise .in('branch_id', []) returns 0 rows.
    if (branchList.length === 0) return
    async function loadKpi() {
     try {
      const monthKey = period.monthKey || from.slice(0, 7)
      const overheadPct = await getOverheadPct()

      // Factory P&L via shared function
      const factoryPL = await fetchFactoryPL(from, to, monthKey)
      const fSales = factoryPL.sales
      const fLabor = factoryPL.labor
      setFactoryRevenue(fSales)
      setFactoryExternalRevenue(fSales - (factoryPL.salesInternal || 0))
      setFactoryLabor(fLabor)
      setFactoryGross(factoryPL.controllableMargin)

      // Fetch per-branch labor targets
      const { data: kpiData } = await supabase.from('branch_kpi_targets').select('branch_id, labor_pct')
      const laborTargetMap: Record<number, number> = {}
      if (kpiData) {
        kpiData.forEach((r: any) => { laborTargetMap[r.branch_id] = Number(r.labor_pct || 0) })
        setBranchLaborTargets(laborTargetMap)
      }

      // Branch data — the branch_pl_summary VIEW reads from the stale branch_labor
      // table (not employer_costs), so all per-branch numbers below come from
      // calculateConsolidatedPL.
      const branchIds = BRANCHES.map(br => br.id)

      // Revenue split by source (קופות / אתר / הקפה) — drives the new card row below the KPI strip.
      const sources = await fetchRevenueBySource(branchIds, from, to)
      setPosByBranch(sources.pos)
      setWebsiteByBranch(sources.website)
      setCreditByBranch(sources.credit)

      // ─── Consolidated KPI (intercompany-eliminated) — matches CEODashboard ──────
      // The KPI strip on the home page now reports consolidated figures (branches +
      // factory external + HQ included in labor). Per the owner's request: HQ
      // employees are mostly on global salary so their cost belongs in the labor
      // line, not as a separate overhead row.
      const cons = await calculateConsolidatedPL(branchIds, from, to, overheadPct, monthKey)
      // Total revenue = sum(branches' external POS/B2B from calculateBranchPL) +
      // factory's external (intercompany eliminated). Uses calculateConsolidatedPL so
      // the figure matches the CEO Dashboard's "הכנסות אמיתיות" KPI exactly.
      const consolidatedRevenue = cons.branches.reduce((s, b) => s + b.revenue, 0) + cons.factory.externalRevenue
      setTotalBranchRevenue(consolidatedRevenue)
      // Labor (consolidated) = factory labor + factory managers + branch labor +
      // branch managers + HQ allocation (HQ is the global-salary of headquarters staff,
      // counted as labor per the owner's request).
      const branchManagers = cons.branches.reduce((s, b) => s + b.managerSalary, 0)
      setBranchLaborCost(
        cons.consolidated.labor + cons.factory.managerSalary + branchManagers + cons.consolidated.overhead
      )
      setBranchWaste(cons.consolidated.waste)
      // Operating profit (consolidated) — true OP after waste deduction.
      // Branch factoryPurchases are added back because the factory side already netted
      // out the matching internalRevenue (intercompany elimination).
      const factoryConsOp = cons.factory.operatingProfit - cons.factory.internalRevenue
      const totalConsOp = factoryConsOp + cons.branches.reduce(
        (s, b) => s + b.operatingProfit + b.factoryPurchases, 0)
      setBranchOperatingProfit(totalConsOp)
      setFactoryOp(factoryConsOp)
      setFactoryManagerSalary(cons.factory.managerSalary)
      setFactoryWasteState(cons.factory.waste)
      setHqAllocationTotal(cons.consolidated.overhead)
      setHqIsActual(cons.factory.hqIsActual)
      // Build per-branch KPI rows from calculateBranchPL — single source of truth.
      let alertCount = 0
      let totalBranchRev = 0, totalBranchLab = 0, totalBranchOP = 0
      const enriched: BranchKpi[] = BRANCHES.map(br => {
        const cb = cons.branches.find(c => c.branchId === br.id)
        const rev = cb?.revenue ?? 0
        const lab = cb?.labor ?? 0
        const labPct = rev > 0 ? (lab / rev) * 100 : 0
        const brTarget = laborTargetMap[br.id] || 0
        if (brTarget > 0 && labPct > brTarget) alertCount++
        totalBranchRev += rev
        totalBranchLab += lab
        totalBranchOP += cb?.operatingProfit ?? 0
        return {
          id: br.id, name: br.name, color: br.color,
          revenue: rev, laborCost: lab, laborPct: labPct,
          managerSalary: cb?.managerSalary || 0,
          waste: cb?.waste || 0,
          operatingProfit: cb?.operatingProfit ?? 0,
          hqAllocation: cb?.overhead || 0,
          factoryPurchases: cb?.factoryPurchases || 0,
        }
      })
      setBranchKpi(enriched)
      setAvgLaborPct(totalBranchRev > 0 ? (totalBranchLab / totalBranchRev) * 100 : 0)
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

      // ─── Consolidated KPI for the comparison period (parallel to current period) ──
      // Same reasoning as the current period: branch_pl_summary VIEW is stale,
      // so we derive everything from calculateConsolidatedPL.
      const prevCons = await calculateConsolidatedPL(branchIds, pFrom, pTo, overheadPct, pMonthKey)
      let pTotalBranchRev = 0, pTotalBranchLab = 0, pTotalBranchOP = 0
      for (const cb of prevCons.branches) {
        pTotalBranchRev += cb.revenue
        pTotalBranchLab += cb.labor
        pTotalBranchOP += cb.operatingProfit
      }
      const pAvgPct = pTotalBranchRev > 0 ? (pTotalBranchLab / pTotalBranchRev) * 100 : 0
      setPrevAvgLaborPct(pAvgPct)
      setPrevTotalLabor(prevFactoryPL.labor + pTotalBranchLab)
      setPrevBranchGross(pTotalBranchRev > 0 ? pTotalBranchRev - pTotalBranchLab : 0)
      setPrevOperatingProfit(prevFactoryPL.operatingProfit + pTotalBranchOP)

      // Revenue split by source — comparison period (used only for DiffBadge on the new card row).
      const prevSources = await fetchRevenueBySource(branchIds, pFrom, pTo)
      const sumValues = (m: Record<number, number>) => Object.values(m).reduce((s, v) => s + v, 0)
      setPrevPosTotal(sumValues(prevSources.pos))
      setPrevWebsiteTotal(sumValues(prevSources.website))
      setPrevCreditTotal(sumValues(prevSources.credit))

      const prevConsolidatedRevenue = prevCons.branches.reduce((s, b) => s + b.revenue, 0) + prevCons.factory.externalRevenue
      setPrevBranchRevenue(prevConsolidatedRevenue)
      const prevBranchManagers = prevCons.branches.reduce((s, b) => s + b.managerSalary, 0)
      setPrevBranchLaborCost(
        prevCons.consolidated.labor + prevCons.factory.managerSalary + prevBranchManagers + prevCons.consolidated.overhead
      )
      setPrevBranchWaste(prevCons.consolidated.waste)
      const prevFactoryConsOp = prevCons.factory.operatingProfit - prevCons.factory.internalRevenue
      const prevTotalConsOp = prevFactoryConsOp + prevCons.branches.reduce(
        (s, b) => s + b.operatingProfit + b.factoryPurchases, 0)
      setPrevBranchOperatingProfit(prevTotalConsOp)
     } catch (err) {
       // Surface any failure so the empty-state on the home page is debuggable.
       console.error('[Home loadKpi] failed:', err)
     }
    }
    loadKpi()
  }, [from, to, branchList.length, isAdmin])

  // Employee role gets their own dedicated home page (after all hooks)
  if (appUser?.role === 'employee') return <EmployeeHome onNavigate={(p: string) => setPage(p)} />

  // Branch manager goes directly to their branch home
  if (appUser?.role === 'branch' && appUser.branch_id) {
    const branchData = branchList.find(b => b.id === appUser.branch_id)
    if (branchData) {
      return <BranchHome branch={{ id: branchData.id, name: branchData.name, color: branchData.color }} onBack={() => supabase.auth.signOut()} />
    }
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

    if (page === 'suppliers')            return <Suppliers onBack={() => setPage(null)} onNavigate={(p) => setPage(p)} />

    if (page === 'creams_dashboard')     return <DepartmentDashboard department="creams" onBack={() => setPage(null)} />
    if (page === 'dough_dashboard')      return <DepartmentDashboard department="dough"  onBack={() => setPage(null)} />
    if (page === 'factory_dashboard')    return <FactoryDashboard onBack={() => setPage(null)} />
    if (page === 'factory_b2b')          return <FactoryB2B onBack={() => setPage(null)} />
    if (page === 'factory_special_orders') return <FactorySpecialOrders onBack={() => setPage(null)} />
    if (page === 'settings')             return <FactorySettings onBack={() => setPage(null)} />
    if (page === 'factory_employees')  return <FactoryEmployees onBack={() => setPage(null)} onEditEmployee={(id) => { setHrInitialKey({ kind: 'factory', id }); setHrOriginPage('factory_employees'); setPage('hr_dashboard') }} />
    if (page === 'production_report_upload') return <ProductionReportUpload onBack={() => setPage(null)} />
    if (page === 'internal_sales') return <InternalSalesUpload onBack={() => setPage(null)} />
    if (page === 'product_catalog') return <ProductCatalog onBack={() => setPage(null)} />
    if (page === 'ceo_dashboard')        return <CEODashboard onBack={() => setPage(null)} />
    if (page === 'data_import')          return <DataImport onBack={() => setPage(null)} />
    if (page === 'branch_import')        return <DataImport onBack={() => setPage(null)} branchOnly />
    if (page === 'user_management')      return <UserManagement onBack={() => setPage(null)} />
    if (page === 'system_settings')      return <UserManagement onBack={() => setPage(null)} initialTab="settings" />
    if (page === 'reports_alerts')       return <ReportsAlerts onBack={() => setPage(null)} />
    if (page === 'quality_hub')          return <QualityHub scope="factory" onBack={() => setPage(null)} onNavigate={(p) => setPage(p)} />
    if (page === 'customer_complaints')  return <CustomerComplaints onBack={() => setPage('quality_hub')} />
    if (page === 'factory_freezer_log')  return <FreezerLog onBack={() => setPage('quality_hub')} />

    if (page === 'hr_dashboard') return <HRDashboard onBack={() => { const origin = hrOriginPage; setHrInitialKey(null); setHrOriginPage(null); setPage(origin) }} initialEmployeeKey={hrInitialKey} />
    if (page === 'changes_report') return <MonthlyChangesReport onBack={() => setPage(null)} />
    if (page === 'b2b_customers') return <B2BCustomers onBack={() => setPage(null)} />
    if (page === 'suppliers_report') return <SuppliersReport onBack={() => setPage(null)} />
    if (page === 'management_reports') return <ManagementReports onBack={() => setPage(null)} />
    if (page === 'bonus_kpi') return <BonusKPI onBack={() => setPage(null)} />
    if (page === 'employer_costs') return <EmployerCostsUpload onBack={() => setPage(null)} onNavigate={(p) => setPage(p)} />
    if (page === 'factory_departments') return <FactoryDepartments onBack={() => setPage(null)} />
    if (page === 'factory_equipment')  return <FactoryEquipment onBack={() => setPage(null)} />
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

        {/* ─── KPI Strip (admin only — others get nav cards without consolidated KPIs) ──────────────────────────────────────────────── */}
        {isAdmin && (<>
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.1 }}>
          <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 20, padding: 0 }}>
            <div className="kpi-grid flex items-center gap-0 flex-wrap" style={{ padding: '14px 24px' }}>
              {(() => {
                // All four cards are scoped to the branches for the selected period.
                const branchLaborPct = totalBranchRevenue > 0 ? (branchLaborCost / totalBranchRevenue) * 100 : 0
                const prevBranchLaborPct = prevBranchRevenue > 0 ? (prevBranchLaborCost / prevBranchRevenue) * 100 : 0
                const branchWastePct = totalBranchRevenue > 0 ? (branchWaste / totalBranchRevenue) * 100 : 0
                const prevBranchWastePct = prevBranchRevenue > 0 ? (prevBranchWaste / prevBranchRevenue) * 100 : 0
                return <>
                  {/* הכנסות — clickable (drill-down) */}
                  <button onClick={() => setRevenueSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 pe-4 border-e border-slate-200 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors" style={{ borderInlineEnd: '1px solid #e2e8f0' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#10B98115' }}>
                      <RevenueIcon size={16} color="#10B981" />
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold mb-0.5">הכנסות</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-extrabold text-slate-900">{fmtK(totalBranchRevenue)}</span>
                        <DiffBadge curr={totalBranchRevenue} prev={prevBranchRevenue} />
                      </div>
                    </div>
                  </button>

                  {/* רווח תפעולי — clickable (drill-down) */}
                  <button onClick={() => setOpSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 px-4 border-e border-slate-200 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors" style={{ borderInlineEnd: '1px solid #e2e8f0' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#7C3AED15' }}>
                      <ProfitIcon size={16} color="#7C3AED" />
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold mb-0.5">רווח תפעולי</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-lg font-extrabold ${branchOperatingProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtK(branchOperatingProfit)}</span>
                        <DiffBadge curr={branchOperatingProfit} prev={prevBranchOperatingProfit} />
                      </div>
                      {totalBranchRevenue > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{((branchOperatingProfit / totalBranchRevenue) * 100).toFixed(1)}% מהכנסות</div>
                      )}
                    </div>
                  </button>

                  {/* לייבור — clickable (drill-down) — shows ₪ and % */}
                  <button onClick={() => setLaborSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 px-4 border-e border-slate-200 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors" style={{ borderInlineEnd: '1px solid #e2e8f0' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#3B82F615' }}>
                      <LaborIcon size={16} color="#3B82F6" />
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold mb-0.5">לייבור</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-extrabold text-slate-900">{fmtK(branchLaborCost)}</span>
                        <DiffBadge curr={branchLaborCost} prev={prevBranchLaborCost} inverse />
                      </div>
                      {totalBranchRevenue > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{branchLaborPct.toFixed(1)}% מהכנסות</div>
                      )}
                    </div>
                  </button>

                  {/* פחת — clickable (drill-down) */}
                  <button onClick={() => setWasteSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 ps-4 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#F59E0B15' }}>
                      <AlertTriangle size={16} color="#F59E0B" />
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold mb-0.5">פחת</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-extrabold text-slate-900">{fmtK(branchWaste)}</span>
                        <DiffBadge curr={branchWaste} prev={prevBranchWaste} inverse />
                      </div>
                      {totalBranchRevenue > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{branchWastePct.toFixed(1)}% מהכנסות</div>
                      )}
                    </div>
                  </button>
                </>
              })()}
            </div>
          </div>
        </motion.div>

        {/* ─── Revenue-by-Source Strip (קופות / אתר / הקפה) ───────────────── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.15 }}>
          <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 20, padding: 0 }}>
            <div className="flex items-center gap-0 flex-wrap" style={{ padding: '14px 24px' }}>
              {(() => {
                const posTotal = Object.values(posByBranch).reduce((s, v) => s + v, 0)
                const websiteTotal = Object.values(websiteByBranch).reduce((s, v) => s + v, 0)
                const creditTotal = Object.values(creditByBranch).reduce((s, v) => s + v, 0)
                return <>
                  {/* קופות */}
                  <button onClick={() => setPosSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 pe-4 border-e border-slate-200 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors" style={{ borderInlineEnd: '1px solid #e2e8f0' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#F59E0B15' }}>
                      <CreditCard size={16} color="#F59E0B" />
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold mb-0.5">קופות</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-extrabold text-slate-900">{fmtK(posTotal)}</span>
                        <DiffBadge curr={posTotal} prev={prevPosTotal} />
                      </div>
                    </div>
                  </button>

                  {/* אתר */}
                  <button onClick={() => setWebsiteSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 px-4 border-e border-slate-200 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors" style={{ borderInlineEnd: '1px solid #e2e8f0' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#0EA5E915' }}>
                      <Globe size={16} color="#0EA5E9" />
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold mb-0.5">אתר</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-extrabold text-slate-900">{fmtK(websiteTotal)}</span>
                        <DiffBadge curr={websiteTotal} prev={prevWebsiteTotal} />
                      </div>
                    </div>
                  </button>

                  {/* הקפה */}
                  <button onClick={() => setCreditSheetOpen(true)} className="flex-1 min-w-[140px] flex items-center gap-2.5 py-1 ps-4 bg-transparent border-0 cursor-pointer text-right hover:bg-slate-50 rounded-lg transition-colors">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#8B5CF615' }}>
                      <BookOpen size={16} color="#8B5CF6" />
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold mb-0.5">הקפה</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-extrabold text-slate-900">{fmtK(creditTotal)}</span>
                        <DiffBadge curr={creditTotal} prev={prevCreditTotal} />
                      </div>
                    </div>
                  </button>
                </>
              })()}
            </div>
          </div>
        </motion.div>
        </>)}

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

          {/* Card: לקוחות הקפה — admin only, direct link */}
          {appUser?.role === 'admin' && (
            <motion.div variants={fadeUp}>
              <button onClick={() => setPage('b2b_customers')}
                style={{ width: '100%', border: overdueCount > 0 ? '1px solid #fecaca' : '1px solid #f1f5f9', borderRadius: '12px', padding: '14px', background: 'white', cursor: 'pointer', textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', position: 'relative' }}
                className="hover:shadow-md hover:border-[#c7d2fe]">
                {overdueCount > 0 && (
                  <div style={{ position: 'absolute', top: -6, left: -6, background: '#ef4444', color: 'white', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{overdueCount}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <CreditCard size={16} color="#dc2626" />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>לקוחות הקפה (B2B)</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: '1px' }}>חשבוניות · תשלומים · מעקב חובות</div>
                    {overdueCount > 0 && <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginTop: 2 }}>{overdueCount} חשבוניות באיחור</div>}
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
                    const badgeCount = item.page === 'internal_sales'
                      ? modifiedCount
                      : item.page === 'factory_special_orders'
                        ? newSpecialOrdersCount
                        : 0
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
                                {item.page === 'factory_special_orders'
                                  ? `${badgeCount} הזמנות עוגות חדשות`
                                  : `${badgeCount} הזמנות ממתינות לאישורך`}
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
                    { label: 'מחלקת HR', subtitle: 'עובדים · מסמכים · קליטה · יומן שינויים', Icon: IdCard, color: '#0d9488', page: 'hr_dashboard' },
                    { label: 'דוח שינויים חודשי', subtitle: 'קליטות · עזיבות · שכר · בנק', Icon: FileSignature, color: '#7c3aed', page: 'changes_report' },
                    { label: 'דוח מעסיק', subtitle: 'עלות שכר אמיתית · חודשי', Icon: Briefcase, color: '#0ea5e9', page: 'employer_costs' },
                    { label: 'דוחות ניהול', subtitle: 'בקרת הכנסות · לייבור · קופות · שלמות נתונים', Icon: ClipboardList, color: '#6366f1', page: 'management_reports' },
                    { label: 'בונוס KPI', subtitle: 'חישוב ואישור בונוס חודשי למנהלי סניף', Icon: TrophyIcon, color: '#f59e0b', page: 'bonus_kpi' },
                    { label: 'דוח ספקים מאוחד', subtitle: 'איחוד שמות ספקים · סיכום לפי סניף', Icon: Briefcase, color: '#6366f1', page: 'suppliers_report' },
                    { label: 'ניהול משתמשים', subtitle: 'הרשאות · משתמשים · סניפים', Icon: UserCog, color: '#8b5cf6', page: 'user_management' },
                    { label: 'דוחות והתראות', subtitle: 'לוג דוחות · כללי התראה', Icon: Mail, color: '#f59e0b', page: 'reports_alerts' },
                    { label: 'הגדרות מערכת', subtitle: 'העמסת מטה · הגדרות כלליות', Icon: Settings, color: '#64748b', page: 'system_settings' },
                    { label: 'ייבוא נתונים', subtitle: 'CSV מ-Base44 · העלאה', Icon: Database, color: '#818cf8', page: 'data_import' },
                  ].map(item => {
                    const Icon = item.Icon
                    const badge = item.page === 'b2b_customers' ? overdueCount : 0
                    return (
                      <motion.div key={item.page} variants={fadeUp}>
                        <button onClick={() => setPage(item.page)}
                          style={{ width: '100%', background: 'white', border: badge > 0 ? '1px solid #fecaca' : '1px solid #f1f5f9', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', position: 'relative' }}
                          className="hover:shadow-md hover:border-[#c7d2fe]">
                          {badge > 0 && (
                            <div style={{ position: 'absolute', top: -6, left: -6, background: '#ef4444', color: 'white', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{badge}</div>
                          )}
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Icon size={18} color="#6366f1" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{item.label}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{item.subtitle}</div>
                            {badge > 0 && <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginTop: 2 }}>{badge} חשבוניות באיחור</div>}
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
            // Source of truth for which branches exist is BRANCHES (from
            // BranchContext); the values come from branchKpi (populated by
            // the loadKpi effect). If branchKpi hasn't loaded yet, we still
            // want to show the branch rows so the user can see what's
            // pending — falling back to a 0 marker for the value.
            const grandRevenue = totalBranchRevenue
            const branchSum = branchKpi.reduce((s, br) => s + br.revenue, 0)
            const factoryRevenue = Math.max(0, grandRevenue - branchSum)
            const branchRows = BRANCHES.map(br => {
              const kpi = branchKpi.find(k => k.id === br.id)
              const revenue = kpi?.revenue ?? 0
              return {
                name: br.name,
                revenue,
                pct: grandRevenue > 0 ? (revenue / grandRevenue) * 100 : 0,
              }
            })
            const rows = [
              ...branchRows,
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
      {/* Wider than the default 420px because the table has 4 columns
          (גוף, עלות, % מהכנסותיו, % מסה"כ) and the % columns wrap otherwise. */}
      <Sheet open={laborSheetOpen} onOpenChange={setLaborSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent className="w-[560px]">
            <SheetHeader className="pb-3">
              <SheetTitle className="text-base font-bold text-slate-900">פירוט לייבור — {period.label}</SheetTitle>
            </SheetHeader>
          {(() => {
            const grandRevenue = totalBranchRevenue   // already consolidated (branches + factory external)
            // Per-entity rows: branches and factory show employer cost WITHOUT HQ allocation.
            // HQ is a separate row at the bottom so the figures match what each entity's own
            // dashboard reports (where HQ is shown as "העמסת מטה" on its own line).
            type LaborRow = { name: string; cost: number; pctOfOwn: number | null; entityId?: number }
            const rows: LaborRow[] = branchKpi.map(br => {
              const entityCost = br.laborCost + br.managerSalary
              return {
                name: br.name,
                cost: entityCost,
                pctOfOwn: br.revenue > 0 ? (entityCost / br.revenue) * 100 : 0,
                entityId: br.id,
              }
            })
            const factoryEntityCost = factoryLabor + factoryManagerSalary
            rows.push({
              name: 'מפעל',
              cost: factoryEntityCost,
              pctOfOwn: factoryRevenue > 0 ? (factoryEntityCost / factoryRevenue) * 100 : 0,
            })
            // HQ row — full allocation across the business. No "own revenue" so the % column is —.
            rows.push({
              name: 'מטה',
              cost: hqAllocationTotal,
              pctOfOwn: null,
            })
            const totalAll = rows.reduce((s, r) => s + r.cost, 0)
            const totalPct = grandRevenue > 0 ? (totalAll / grandRevenue) * 100 : 0
            const pctOfGrand = (cost: number) => grandRevenue > 0 ? (cost / grandRevenue) * 100 : 0
            return (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">גוף</TableHead>
                    <TableHead className="text-center">עלות מעסיק</TableHead>
                    <TableHead className="text-center">% מהכנסותיו</TableHead>
                    <TableHead className="text-center">% מסה"כ הכנסות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium text-right">{r.name}</TableCell>
                      <TableCell className="text-center">{fmtK(r.cost)}</TableCell>
                      <TableCell className="text-center">
                        {r.pctOfOwn === null
                          ? <span className="text-slate-400">—</span>
                          : (() => { const t = branchLaborTargets[r.entityId ?? 0] || 0; return <span className={t > 0 ? (r.pctOfOwn! <= t ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-700'}>{r.pctOfOwn!.toFixed(1)}%</span> })()
                        }
                      </TableCell>
                      <TableCell className="text-center text-slate-700">
                        {pctOfGrand(r.cost).toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-50 font-bold">
                    <TableCell className="font-bold text-right">סה"כ</TableCell>
                    <TableCell className="text-center font-bold">{fmtK(totalAll)}</TableCell>
                    <TableCell className="text-center font-bold">
                      <span className="text-slate-700">{totalPct.toFixed(1)}%</span>
                    </TableCell>
                    <TableCell className="text-center font-bold">
                      <span className="text-slate-700">{totalPct.toFixed(1)}%</span>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )
          })()}
          </SheetContent>
        </SheetPortal>
      </Sheet>

      {/* ─── Operating Profit Drill-Down Sheet ─────────────────────────────── */}
      <Sheet open={opSheetOpen} onOpenChange={setOpSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetHeader className="pb-3">
              <SheetTitle className="text-base font-bold text-slate-900">פירוט רווח תפעולי — {period.label}</SheetTitle>
            </SheetHeader>
            {(() => {
              // Per-entity OP for the consolidated view: branches add back factoryPurchases
              // (intercompany — eliminated at the company level). Waste is NOT added back:
              // calculatePL no longer deducts it (raw materials already include it), so
              // b.operatingProfit is already the correct figure.
              const rows = [
                ...branchKpi.map(b => ({
                  name: b.name,
                  op: b.operatingProfit + b.factoryPurchases,
                  rev: b.revenue,
                })),
                { name: 'מפעל', op: factoryOp, rev: factoryExternalRevenue },
              ]
              const totalOp = rows.reduce((s, r) => s + r.op, 0)
              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">גוף</TableHead>
                      <TableHead className="text-center">רווח תפעולי</TableHead>
                      <TableHead className="text-center">% מהכנסותיו</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => {
                      const pct = r.rev > 0 ? (r.op / r.rev) * 100 : 0
                      return (
                        <TableRow key={r.name}>
                          <TableCell className="font-medium text-right">{r.name}</TableCell>
                          <TableCell className={`text-center ${r.op >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtK(r.op)}</TableCell>
                          <TableCell className={`text-center ${pct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{pct.toFixed(1)}%</TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow className="bg-slate-50 font-bold">
                      <TableCell className="font-bold text-right">סה"כ</TableCell>
                      <TableCell className={`text-center font-bold ${totalOp >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtK(totalOp)}</TableCell>
                      <TableCell className="text-center font-bold">
                        <span className={totalOp >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                          {totalBranchRevenue > 0 ? ((totalOp / totalBranchRevenue) * 100).toFixed(1) + '%' : '—'}
                        </span>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )
            })()}
          </SheetContent>
        </SheetPortal>
      </Sheet>

      {/* ─── Waste Drill-Down Sheet ───────────────────────────────────────── */}
      <Sheet open={wasteSheetOpen} onOpenChange={setWasteSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetHeader className="pb-3">
              <SheetTitle className="text-base font-bold text-slate-900">פירוט פחת — {period.label}</SheetTitle>
            </SheetHeader>
            {(() => {
              const rows = [
                ...branchKpi.map(b => ({ name: b.name, waste: b.waste, rev: b.revenue })),
                { name: 'מפעל', waste: factoryWasteState, rev: factoryRevenue },
              ]
              const totalWaste = rows.reduce((s, r) => s + r.waste, 0)
              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">גוף</TableHead>
                      <TableHead className="text-center">פחת</TableHead>
                      <TableHead className="text-center">% מהכנסותיו</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => {
                      const pct = r.rev > 0 ? (r.waste / r.rev) * 100 : 0
                      return (
                        <TableRow key={r.name}>
                          <TableCell className="font-medium text-right">{r.name}</TableCell>
                          <TableCell className="text-center">{fmtK(r.waste)}</TableCell>
                          <TableCell className={`text-center ${pct > 3 ? 'text-rose-500' : 'text-emerald-500'}`}>{pct.toFixed(1)}%</TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow className="bg-slate-50 font-bold">
                      <TableCell className="font-bold text-right">סה"כ</TableCell>
                      <TableCell className="text-center font-bold">{fmtK(totalWaste)}</TableCell>
                      <TableCell className="text-center font-bold">
                        {totalBranchRevenue > 0 ? ((totalWaste / totalBranchRevenue) * 100).toFixed(1) + '%' : '—'}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )
            })()}
          </SheetContent>
        </SheetPortal>
      </Sheet>

      {/* ─── Source Drill-Down Sheets: קופות / אתר / הקפה ─────────────────── */}
      {(() => {
        type SourceSheet = {
          open: boolean
          setOpen: (v: boolean) => void
          title: string
          data: Record<number, number>
        }
        const sheets: SourceSheet[] = [
          { open: posSheetOpen,     setOpen: setPosSheetOpen,     title: 'פירוט קופות',  data: posByBranch },
          { open: websiteSheetOpen, setOpen: setWebsiteSheetOpen, title: 'פירוט אתר',    data: websiteByBranch },
          { open: creditSheetOpen,  setOpen: setCreditSheetOpen,  title: 'פירוט הקפה',   data: creditByBranch },
        ]
        return sheets.map(({ open, setOpen, title, data }) => {
          const rows = BRANCHES.map(br => ({ name: br.name, amount: data[br.id] ?? 0 }))
          const total = rows.reduce((s, r) => s + r.amount, 0)
          return (
            <Sheet key={title} open={open} onOpenChange={setOpen}>
              <SheetPortal>
                <SheetBackdrop />
                <SheetContent>
                  <SheetHeader className="pb-3">
                    <SheetTitle className="text-base font-bold text-slate-900">{title} — {period.label}</SheetTitle>
                  </SheetHeader>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">סניף</TableHead>
                        <TableHead className="text-center">סכום</TableHead>
                        <TableHead className="text-center">% מהמקור</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(r => (
                        <TableRow key={r.name}>
                          <TableCell className="font-medium text-right">{r.name}</TableCell>
                          <TableCell className="text-center">{fmtK(r.amount)}</TableCell>
                          <TableCell className="text-center">{total > 0 ? ((r.amount / total) * 100).toFixed(1) + '%' : '—'}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-slate-50 font-bold">
                        <TableCell className="font-bold text-right">סה"כ</TableCell>
                        <TableCell className="text-center font-bold">{fmtK(total)}</TableCell>
                        <TableCell className="text-center font-bold">{total > 0 ? '100%' : '—'}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </SheetContent>
              </SheetPortal>
            </Sheet>
          )
        })
      })()}
    </div>
  )
}
// build 1775723518
