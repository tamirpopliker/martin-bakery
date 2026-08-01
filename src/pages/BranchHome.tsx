import { useState, useEffect, type ComponentType } from 'react'
import { supabase, fetchBranchPL, getOverheadPct, type BranchPLResult } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ShoppingBag, Receipt, Users, Trash2, BarChart2, Settings, Building2, Upload, Package, ArrowRight, MessageSquare, Calculator, Wallet, Cake, KeyRound, ImagePlus, IdCard, FileSignature, ShieldCheck, ClipboardCheck, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppShell, { type NavGroup, type NavItem } from '@/components/ui/AppShell'
import StatCard from '@/components/ui/StatCard'
import { ActionList, type ActionItem } from '@/components/ui/Banner'
import { Button as MButton } from '@/components/ui/Controls'
import { useAppUser, isRestrictedBranchUser } from '../lib/UserContext'
import BranchRevenue from './BranchRevenue'
import BranchExpenses from './BranchExpenses'
import BranchLabor from './BranchLabor'
import BranchWaste from './BranchWaste'
// BranchPL removed from navigation — P&L data now shown in BranchDashboard
import BranchSettings from './BranchSettings'
import BranchB2BHistory from './BranchB2BHistory'
import BranchSuppliers from './BranchSuppliers'
import BranchOrders from './BranchOrders'
import BranchEmployees from './BranchEmployees'
import EmployeeArchive from './EmployeeArchive'
import BranchTeam from './BranchTeam'
import ManagerConstraintsView from './ManagerConstraintsView'
import ShiftSettings from './ShiftSettings'
import WeeklySchedule from './WeeklySchedule'
import ScheduleHistory from './ScheduleHistory'
import BranchDashboard from './BranchDashboard'
import DataImport from './DataImport'
import BranchCommunication from './BranchCommunication'
import RegisterClosings from './RegisterClosings'
import RegisterReconciliation from './RegisterReconciliation'
import ChangeFund from './ChangeFund'
import BranchSpecialOrders from './BranchSpecialOrders'
import WeeklyInsightsCard from '../components/WeeklyInsightsCard'
import CakePrintEditor from './CakePrintEditor'
import ChangePassword from './ChangePassword'
import HRDashboard from './HRDashboard'
import MonthlyChangesReport from './MonthlyChangesReport'
import QualityHub from './QualityHub'
import CustomerComplaints from './CustomerComplaints'
// calculateBranchPL moved to BranchManagerDashboard

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Branch {
  id: number
  name: string
  color: string
}

interface Props {
  branch: Branch
  onBack: () => void
}

type BranchPage =
  | 'dashboard'
  | 'revenue'
  | 'expenses'
  | 'labor'
  | 'waste'
  | 'suppliers'
  | 'customers'
  | 'report'
  | 'settings'
  | 'data_import'
  | 'orders'
  | 'employees'
  | 'branch-employees'
  | 'employee-archive'
  | 'branch-team'
  | 'manager-constraints'
  | 'shift-settings'
  | 'weekly-schedule'
  | 'schedule-history'
  | 'communication'
  | 'register_closings'
  | 'change_fund'
  | 'special_orders'
  | 'cake_print_editor'
  | 'change_password'
  | 'hr_dashboard'
  | 'changes_report'
  | 'quality_hub'
  | 'customer_complaints'
  | 'register_reconciliation'

// ─── תפריט הסיידבר ─────────────────────────────────────────────────────────
// אותם מפתחות ניווט כמו קודם, מקובצים לפי טבלת הקבוצות ב-README.
// הבאדג'ים (הזמנות / הודעות / הזמנות מיוחדות) עוברים לפריט הסיידבר.
type MenuGroup = 'daily' | 'orders' | 'control' | 'settings'
type BadgeKind = 'orders' | 'messages' | 'special'

interface MenuItem {
  page: BranchPage
  label: string
  Icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  group: MenuGroup
  badge?: BadgeKind
}

const MENU_ITEMS: MenuItem[] = [
  // יומיומי
  { page: 'register_closings', label: 'סגירת קופות', Icon: Calculator,  group: 'daily' },
  { page: 'revenue',           label: 'הכנסות',      Icon: ShoppingBag, group: 'daily' },
  { page: 'change_fund',       label: 'קופת עודף',   Icon: Wallet,      group: 'daily' },
  { page: 'expenses',          label: 'הוצאות',      Icon: Receipt,     group: 'daily' },
  { page: 'labor',             label: 'לייבור',      Icon: Users,       group: 'daily' },
  { page: 'waste',             label: 'פחת',         Icon: Trash2,      group: 'daily' },
  // הזמנות
  { page: 'orders',            label: 'הזמנות מהמפעל',        Icon: Package,   group: 'orders', badge: 'orders' },
  { page: 'special_orders',    label: 'הזמנות עוגות מיוחדות', Icon: Cake,      group: 'orders', badge: 'special' },
  { page: 'cake_print_editor', label: 'הדפסת תמונה לעוגה',    Icon: ImagePlus, group: 'orders' },
  // צוות ובקרה
  { page: 'branch-team',             label: 'ניהול צוות',       Icon: Users,         group: 'control' },
  { page: 'communication',           label: 'מרכז תקשורת',      Icon: MessageSquare, group: 'control', badge: 'messages' },
  { page: 'dashboard',               label: 'דשבורד סניף',      Icon: BarChart2,     group: 'control' },
  { page: 'quality_hub',             label: 'איכות ובקרה',      Icon: ShieldCheck,   group: 'control' },
  { page: 'suppliers',               label: 'ספקים',            Icon: Building2,     group: 'control' },
  { page: 'register_reconciliation', label: 'בקרת סגירות קופה', Icon: ClipboardCheck, group: 'control' },
  // הגדרות (admin)
  { page: 'settings',        label: 'הגדרות סניף',   Icon: Settings,      group: 'settings' },
  { page: 'data_import',     label: 'ייבוא נתונים',  Icon: Upload,        group: 'settings' },
  { page: 'hr_dashboard',    label: 'מחלקת HR',      Icon: IdCard,        group: 'settings' },
  { page: 'changes_report',  label: 'דוח שינויים',   Icon: FileSignature, group: 'settings' },
  { page: 'change_password', label: 'שינוי סיסמה',   Icon: KeyRound,      group: 'settings' },
]

const GROUP_TITLES: Record<MenuGroup, string> = {
  daily: 'יומיומי',
  orders: 'הזמנות',
  control: 'צוות ובקרה',
  settings: 'הגדרות',
}
const GROUP_ORDER: MenuGroup[] = ['daily', 'orders', 'control', 'settings']

// מפתח הפריט "דף הבית" — מייצג page === null (מסך הבית עצמו).
const HOME_KEY = '__home__'

export default function BranchHome({ branch, onBack }: Props) {
  const { appUser } = useAppUser()
  const { period, setPeriod, from, to, monthKey, comparisonPeriod } = usePeriod()
  const isAdmin = appUser?.role === 'admin'
  // "restricted" = עובד קבוע במשמרת (username-auth) — רואה תפריט מצומצם, בלי P&L.
  const restricted = !!appUser && isRestrictedBranchUser(appUser)
  const managerView = !!appUser && !restricted
  const [page, setPage] = useState<BranchPage | null>(null)
  const [pageData, setPageData] = useState<any>(null)
  // When BranchTeam's edit button hands off to HR Dashboard, we stash the key
  // here and switch to hr_dashboard so the EmployeeDetail opens straight away.
  const [hrInitialKey, setHrInitialKey] = useState<{ kind: 'branch'; id: number } | null>(null)
  const [hrOriginPage, setHrOriginPage] = useState<BranchPage | null>(null)
  const [pendingOrders, setPendingOrders] = useState(0)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [unreadSpecialOrders, setUnreadSpecialOrders] = useState(0)
  const [registerDaysBehind, setRegisterDaysBehind] = useState<number | null>(null)

  // Labor / P&L for the "דורש טיפול" labor item and the KPI StatCards.
  // Same call BranchDashboard makes — fetchBranchPL + branch_kpi_targets.
  const [pl, setPl] = useState<BranchPLResult | null>(null)
  const [prevPl, setPrevPl] = useState<BranchPLResult | null>(null)
  const [laborTarget, setLaborTarget] = useState(0)
  const [wasteTarget, setWasteTarget] = useState(3)

  // ─── טעינת התראות הזמנות מיוחדות ──────────────────────────────────────────
  useEffect(() => {
    async function loadUnreadSpecial() {
      if (!appUser?.id) return
      const { count } = await supabase.from('order_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', appUser.id)
        .eq('read', false)
      setUnreadSpecialOrders(count || 0)
    }
    loadUnreadSpecial()
    const ch = supabase.channel(`unread-special-${appUser?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_notifications' }, () => loadUnreadSpecial())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [appUser?.id])

  // ─── טעינת הודעות לא נקראות ──────────────────────────────────────────────────
  useEffect(() => {
    async function loadUnreadMsgs() {
      if (!appUser?.employee_id) return
      const { data: msgs } = await supabase.from('branch_messages').select('id').eq('branch_id', branch.id)
      if (!msgs || msgs.length === 0) { setUnreadMessages(0); return }
      const { data: reads } = await supabase.from('message_reads').select('message_id').eq('employee_id', appUser.employee_id).in('message_id', msgs.map(m => m.id))
      const readIds = new Set((reads || []).map(r => r.message_id))
      setUnreadMessages(msgs.filter(m => !readIds.has(m.id)).length)
    }
    loadUnreadMsgs()
    const ch = supabase.channel(`unread-msgs-${branch.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branch_messages', filter: `branch_id=eq.${branch.id}` }, () => loadUnreadMsgs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, () => loadUnreadMsgs())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [branch.id, appUser?.employee_id])

  // ─── טעינת הזמנות ממתינות ──────────────────────────────────────────────────
  useEffect(() => {
    async function loadPendingCount() {
      const [fs, b2b, internal] = await Promise.all([
        supabase.from('factory_sales').select('id', { count: 'exact', head: true })
          .eq('target_branch_id', branch.id).eq('branch_status', 'pending'),
        supabase.from('factory_b2b_sales').select('id', { count: 'exact', head: true })
          .eq('target_branch_id', branch.id).eq('branch_status', 'pending'),
        supabase.from('internal_sales').select('id', { count: 'exact', head: true })
          .eq('branch_id', branch.id).eq('status', 'pending'),
      ])
      setPendingOrders((fs.count || 0) + (b2b.count || 0) + (internal.count || 0))
    }
    loadPendingCount()

    // Surface a banner if the manager hasn't closed the register in the last few days.
    async function loadDaysBehind() {
      const { data } = await supabase.from('register_closings')
        .select('date').eq('branch_id', branch.id)
        .order('date', { ascending: false }).limit(1)
      if (!data || data.length === 0) { setRegisterDaysBehind(999); return }
      const last = new Date(data[0].date + 'T12:00:00')
      const days = Math.floor((Date.now() - last.getTime()) / 86400000)
      setRegisterDaysBehind(days)
    }
    loadDaysBehind()
  }, [branch.id])

  // ─── טעינת P&L לסניף (מדדים + פריט "לייבור מעל יעד") ─────────────────────────
  // אותה שליפה של BranchDashboard. לא רץ למשתמשים מוגבלים (אין להם הרשאת P&L).
  useEffect(() => {
    if (!managerView) return
    let cancelled = false
    async function loadPL() {
      try {
        const oh = await getOverheadPct()
        const curMonthKey = monthKey || from.slice(0, 7)
        const prevMonthKey = comparisonPeriod.monthKey || comparisonPeriod.from.slice(0, 7)
        const [current, prev, kpiRes] = await Promise.all([
          fetchBranchPL(branch.id, from, to, curMonthKey, oh),
          fetchBranchPL(branch.id, comparisonPeriod.from, comparisonPeriod.to, prevMonthKey, oh),
          supabase.from('branch_kpi_targets').select('labor_pct, waste_pct').eq('branch_id', branch.id).maybeSingle(),
        ])
        if (cancelled) return
        setPl(current)
        setPrevPl(prev)
        if (kpiRes.data?.labor_pct) setLaborTarget(kpiRes.data.labor_pct)
        if (kpiRes.data?.waste_pct) setWasteTarget(kpiRes.data.waste_pct)
      } catch (err) {
        console.error('BranchHome P&L fetch error:', err)
      }
    }
    loadPL()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id, from, to, monthKey, managerView])

  // ─── ניתוב פנימי ──────────────────────────────────────────────────────────
  if (page === 'dashboard') return (
    <BranchDashboard branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'revenue') return (
    <BranchRevenue branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} onNavigate={(p) => setPage(p as BranchPage)} />
  )
  if (page === 'register_reconciliation') return (
    <RegisterReconciliation onBack={() => setPage(null)} />
  )
  if (page === 'register_closings') return (
    <RegisterClosings branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'change_fund') return (
    <ChangeFund branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'expenses') return (
    <BranchExpenses branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} onNavigate={(p) => setPage(p as BranchPage)} />
  )
  if (page === 'labor') return (
    <BranchLabor branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'waste') return (
    <BranchWaste branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  // BranchPL route removed — P&L integrated in dashboard
  if (page === 'settings') return (
    <BranchSettings branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'customers') return (
    <BranchB2BHistory branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'suppliers') return (
    <BranchSuppliers branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'communication') return (
    <BranchCommunication branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'orders') return (
    <BranchOrders branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'special_orders') return (
    <BranchSpecialOrders branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'cake_print_editor') return (
    <CakePrintEditor branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'hr_dashboard') return <HRDashboard
    initialEmployeeKey={hrInitialKey}
    onBack={() => { const origin = hrOriginPage; setHrInitialKey(null); setHrOriginPage(null); setPage(origin) }}
  />
  if (page === 'changes_report') return <MonthlyChangesReport onBack={() => setPage(null)} />
  if (page === 'quality_hub') return (
    <QualityHub
      scope="branch"
      branchName={branch.name}
      onBack={() => setPage(null)}
      onNavigate={(p) => setPage(p as BranchPage)}
    />
  )
  if (page === 'customer_complaints') return (
    <CustomerComplaints onBack={() => setPage('quality_hub')} />
  )
  if (page === 'change_password') return (
    <ChangePassword onBack={() => setPage(null)} />
  )
  if (page === 'branch-team') return (
    <BranchTeam branchId={branch.id} branchName={branch.name} branchColor={branch.color}
      onBack={() => setPage(null)} onNavigate={(p) => setPage(p as BranchPage)}
      onEditEmployee={(id) => { setHrInitialKey({ kind: 'branch', id }); setHrOriginPage('branch-team'); setPage('hr_dashboard') }} />
  )
  if (page === 'manager-constraints') return (
    <ManagerConstraintsView branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage('branch-team')} />
  )
  if (page === 'shift-settings') return (
    <ShiftSettings branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage('branch-team')} />
  )
  if (page === 'weekly-schedule') return (
    <WeeklySchedule branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage('branch-team')} initialWeekStart={pageData?.initialWeekStart} />
  )
  if (page === 'schedule-history') return (
    <ScheduleHistory branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage('branch-team')} onNavigate={(p, data) => { setPageData(data); setPage(p as BranchPage) }} />
  )
  if (page === 'employees') return (
    <BranchEmployees branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} onNavigate={(p) => setPage(p as BranchPage)} />
  )
  if (page === 'branch-employees') return (
    <BranchEmployees branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage('branch-team')} onNavigate={(p) => setPage(p as BranchPage)} />
  )
  if (page === 'employee-archive') return (
    <EmployeeArchive branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage('branch-employees')} />
  )
  if (page === 'data_import') return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={() => setPage(null)} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ width: '44px', height: '44px', background: branch.color, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${branch.color}55` }}>
          <Upload size={22} color="white" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>ייבוא נתונים — סניף {branch.name}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>העלאת דוח נוכחות PDF</p>
        </div>
      </div>
      <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>
        <DataImport branchOnly />
      </div>
    </div>
  )

  // placeholder למסכים שטרם נבנו
  if (page) return (
    <div className="min-h-screen bg-slate-100" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '48px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚧</div>
        <h2 style={{ margin: '0 0 8px', color: '#0f172a' }}>בפיתוח</h2>
        <p style={{ color: '#94a3b8', marginBottom: '24px' }}>מסך זה יהיה זמין בקרוב</p>
        <button onClick={() => setPage(null)} style={{ background: branch.color, color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}>
          חזרה לסניף
        </button>
      </div>
    </div>
  )

  // ─── מסך הבית: סיידבר (AppShell) + "דורש טיפול" + מדדים + תובנות ──────────────

  // אותם כללי הרשאות שהיו על גריד הכרטיסים — עכשיו מסננים את פריטי הסיידבר.
  function isVisible(item: MenuItem): boolean {
    if (appUser && isRestrictedBranchUser(appUser)) {
      return ['branch-team', 'special_orders', 'cake_print_editor', 'change_password', 'quality_hub'].includes(item.page)
    }
    if (!isAdmin && (item.page === 'settings' || item.page === 'data_import' || item.page === 'hr_dashboard' || item.page === 'changes_report')) return false
    if (item.page === 'change_password' && !isRestrictedBranchUser(appUser ?? { role: '', email: '' })) return false
    return true
  }

  const badgeValue = (b: BadgeKind): number =>
    b === 'orders' ? pendingOrders : b === 'messages' ? unreadMessages : unreadSpecialOrders
  const badgeColor = (b: BadgeKind): string | undefined =>
    b === 'messages' ? 'var(--m-info)' : b === 'special' ? 'var(--m-good)' : undefined // orders = אדום (ברירת מחדל)

  const homeItem: NavItem = { key: HOME_KEY, label: 'דף הבית', Icon: Home }
  const groups: NavGroup[] = []
  for (const g of GROUP_ORDER) {
    let items: NavItem[] = MENU_ITEMS.filter(it => it.group === g && isVisible(it)).map(it => ({
      key: it.page,
      label: it.label,
      Icon: it.Icon,
      badge: it.badge ? badgeValue(it.badge) : undefined,
      badgeColor: it.badge ? badgeColor(it.badge) : undefined,
    }))
    if (g === 'daily') items = [homeItem, ...items]
    if (items.length > 0) groups.push({ title: GROUP_TITLES[g], items })
  }

  // ─── "דורש טיפול" ───────────────────────────────────────────────────────────
  const totalRevenue = pl?.revenue ?? 0
  const controllable = pl?.controllableMargin ?? 0
  const laborEmployer = pl?.laborEmployer ?? 0
  const wasteTotal = pl?.wasteTotal ?? 0
  const laborPct = totalRevenue > 0 ? (laborEmployer / totalRevenue) * 100 : 0
  const wastePct = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0
  const prevLaborPct = prevPl && prevPl.revenue > 0 ? (prevPl.laborEmployer / prevPl.revenue) * 100 : undefined
  const prevWastePct = prevPl && prevPl.revenue > 0 ? (prevPl.wasteTotal / prevPl.revenue) * 100 : undefined
  const laborOverTarget = laborTarget > 0 && laborPct > laborTarget

  const actionItems: ActionItem[] = []
  if (registerDaysBehind !== null && registerDaysBehind >= 2) {
    actionItems.push({
      key: 'register',
      tone: registerDaysBehind >= 5 ? 'bad' : 'warn',
      title: registerDaysBehind >= 999 ? 'עדיין לא נסגרו קופות בסניף' : `סגירת הקופה האחרונה הייתה לפני ${registerDaysBehind} ימים`,
      detail: 'מומלץ להזין סגירת קופה מדי יום — בלעדיה נתוני הדשבורד לא משקפים את המצב בפועל',
      actions: <MButton variant="primary" size="sm" onClick={() => setPage('register_closings')}>פתח אשף סגירה</MButton>,
    })
  }
  if (pendingOrders > 0) {
    actionItems.push({
      key: 'orders',
      tone: 'warn',
      title: `${pendingOrders} תעודות ממתינות מהמפעל`,
      detail: 'תעודות משלוח שטרם אושרו — אישור מעדכן את המלאי ואת ההוצאות',
      actions: (
        <>
          <MButton variant="secondary" size="sm" onClick={() => setPage('orders')}>עבור אחת-אחת</MButton>
          <MButton variant="confirm" size="sm" onClick={() => setPage('orders')}>אשר את כולן</MButton>
        </>
      ),
    })
  }
  if (laborOverTarget) {
    actionItems.push({
      key: 'labor',
      tone: 'bad',
      title: `לייבור מעל היעד — ${laborPct.toFixed(1)}% מול ${laborTarget}%`,
      detail: 'עלות השכר חורגת מהיעד החודשי. בדיקת סידור העבודה יכולה לצמצם את הפער',
      actions: <MButton variant="secondary" size="sm" onClick={() => setPage('branch-team')}>לניהול צוות</MButton>,
    })
  }

  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <AppShell
      entityName={branch.name}
      entitySubtitle="סניף"
      groups={groups}
      activeKey={HOME_KEY}
      onNavigate={(key) => setPage(key === HOME_KEY ? null : (key as BranchPage))}
      title={`סניף ${branch.name}`}
      headerActions={
        <>
          {managerView && <PeriodPicker period={period} onChange={setPeriod} />}
          <span style={{ fontSize: 12.5, color: 'var(--m-text-muted)' }}>{today}</span>
          {appUser?.role === 'branch'
            ? <MButton variant="secondary" size="sm" onClick={() => { supabase.auth.signOut() }}>התנתק</MButton>
            : <MButton variant="secondary" size="sm" onClick={onBack}>חזרה</MButton>}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {managerView && <ActionList items={actionItems} />}

        {managerView && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
            <StatCard label="הכנסות" value={totalRevenue} previous={prevPl?.revenue} />
            <StatCard label="רווח נשלט" value={controllable} previous={prevPl?.controllableMargin} />
            <StatCard label="לייבור" value={laborPct} previous={prevLaborPct} isPct inverse lowerIsBetter target={laborTarget || undefined} />
            <StatCard label="פחת" value={wastePct} previous={prevWastePct} isPct inverse lowerIsBetter target={wasteTarget || undefined} />
          </div>
        )}

        {managerView && (
          <WeeklyInsightsCard
            entityType="branch"
            entityId={branch.id}
            title={`תובנות שבועיות — ${branch.name}`}
          />
        )}

        {restricted && (
          <div style={{ color: 'var(--m-text-muted)', fontSize: 13.5, padding: '8px 2px' }}>
            בחר פעולה מהתפריט כדי להתחיל.
          </div>
        )}
      </div>
    </AppShell>
  )
}
