import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { ShoppingBag, Receipt, Users, Trash2, BarChart3, BarChart2, Settings, Building2, TrendingUp, Upload, Package, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PageHeader from '../components/PageHeader'
import { useAppUser } from '../lib/UserContext'
import BranchRevenue from './BranchRevenue'
import BranchExpenses from './BranchExpenses'
import BranchLabor from './BranchLabor'
import BranchWaste from './BranchWaste'
// BranchPL removed from navigation — P&L data now shown in BranchDashboard
import BranchSettings from './BranchSettings'
import BranchCreditCustomers from './BranchCreditCustomers'
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
// calculateBranchPL moved to BranchManagerDashboard

// ─── אנימציות ─────────────────────────────────────────────────────────────────
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }
const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } } }

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

interface MenuItem {
  page: BranchPage
  label: string
  subtitle: string
  Icon: any
  ready: boolean
  cardBg?: string
  cardBorder?: string
}

const MENU_ITEMS: MenuItem[] = [
  { page: 'dashboard', label: 'דשבורד סניף',   subtitle: 'KPI · הכנסות · הוצאות · גרפים', Icon: BarChart2, ready: true },
  { page: 'revenue',   label: 'הכנסות',        subtitle: 'קופה · אתר · הקפה',        Icon: ShoppingBag, ready: true },
  { page: 'expenses',  label: 'הוצאות',         subtitle: 'ספקים · תיקונים · תשתיות', Icon: Receipt,     ready: true },
  { page: 'labor',     label: 'לייבור',          subtitle: 'שעות · עלות מעסיק',         Icon: Users,       ready: true },
  { page: 'branch-team', label: 'ניהול צוות',       subtitle: 'סידור עבודה · משימות · עובדים', Icon: Users,       ready: true },
  { page: 'waste',     label: 'פחת',             subtitle: 'סחורה · חומרי גלם',         Icon: Trash2,      ready: true },
  { page: 'suppliers', label: 'ספקים',           subtitle: 'ניהול · קטגוריות',           Icon: Building2,   ready: true },
  { page: 'customers', label: 'לקוחות הקפה',    subtitle: 'חובות · תשלומים',            Icon: TrendingUp,  ready: true },
  { page: 'orders',    label: 'הזמנות מהמפעל',  subtitle: 'אישור · עריכה · חומרי גלם', Icon: Package,     ready: true },
  // BranchPL removed — P&L now integrated in BranchDashboard
  { page: 'settings',     label: 'הגדרות סניף',    subtitle: 'KPI · עלויות קבועות · עובדים', Icon: Settings,    ready: true },
  { page: 'data_import',  label: 'ייבוא נתונים',   subtitle: 'CSV מ-Base44 · העלאה',         Icon: Upload,      ready: true },
]

export default function BranchHome({ branch, onBack }: Props) {
  const { appUser } = useAppUser()
  const isAdmin = appUser?.role === 'admin'
  const [page, setPage] = useState<BranchPage | null>(null)
  const [pageData, setPageData] = useState<any>(null)
  const [hovCard, setHovCard] = useState<BranchPage | null>(null)
  const [pendingOrders, setPendingOrders] = useState(0)

  // ─── טעינת הזמנות ממתינות ──────────────────────────────────────────────────
  useEffect(() => {
    async function loadPendingCount() {
      const [fs, b2b] = await Promise.all([
        supabase.from('factory_sales').select('id', { count: 'exact', head: true })
          .eq('target_branch_id', branch.id).eq('branch_status', 'pending'),
        supabase.from('factory_b2b_sales').select('id', { count: 'exact', head: true })
          .eq('target_branch_id', branch.id).eq('branch_status', 'pending'),
      ])
      setPendingOrders((fs.count || 0) + (b2b.count || 0))
    }
    loadPendingCount()
  }, [branch.id])

  // ─── ניתוב פנימי ──────────────────────────────────────────────────────────
  if (page === 'dashboard') return (
    <BranchDashboard branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'revenue') return (
    <BranchRevenue branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
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
    <BranchCreditCustomers branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'suppliers') return (
    <BranchSuppliers branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'orders') return (
    <BranchOrders branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'branch-team') return (
    <BranchTeam branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} onNavigate={(p) => setPage(p as BranchPage)} />
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

  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>

      <PageHeader title={`סניף ${branch.name}`} subtitle={today} onBack={onBack} />

      {/* ─── כרטיסי מודולים ──────────────────────────────────────────────── */}
      <div style={{ padding: '36px', maxWidth: '960px', margin: '0 auto' }}>


        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {MENU_ITEMS.filter(item => {
            // Scheduler can only see team management
            if (appUser?.role === 'scheduler') return item.page === 'branch-team'
            // Hide settings and data_import for non-admin users
            if (!isAdmin && (item.page === 'settings' || item.page === 'data_import')) return false
            return true
          }).map(item => {
            const Icon = item.Icon
            const isHov = hovCard === item.page
            return (
              <motion.div key={item.page} variants={fadeUp}>
                <button
                  onClick={() => setPage(item.page)}
                  onMouseEnter={() => setHovCard(item.page)}
                  onMouseLeave={() => setHovCard(null)}
                  style={{
                    width: '100%',
                    background: 'white',
                    border: `1px solid ${isHov && item.ready ? '#c7d2fe' : '#f1f5f9'}`,
                    borderRadius: 12, padding: '20px',
                    display: 'flex', alignItems: 'center', gap: 14,
                    cursor: 'pointer', transition: 'all 0.18s',
                    boxShadow: isHov && item.ready ? '0 4px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)',
                    textAlign: 'right', opacity: item.ready ? 1 : 0.6,
                    position: 'relative' as const
                  }}
                >
                  {!item.ready && (
                    <span style={{ position: 'absolute', top: 10, left: 10, background: '#f1f5f9', color: '#94a3b8', fontSize: 11, padding: '3px 8px', borderRadius: 8, fontWeight: 600 }}>
                      בקרוב
                    </span>
                  )}
                  {item.page === 'orders' && pendingOrders > 0 && (
                    <span style={{ position: 'absolute', top: 10, left: 10, background: '#fb7185', color: 'white', fontSize: 12, fontWeight: 800, minWidth: 24, height: 24, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', boxShadow: '0 2px 8px rgba(251,113,133,0.4)' }}>
                      {pendingOrders}
                    </span>
                  )}
                  <div style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={18} color="#6366f1" strokeWidth={1.5} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{item.subtitle}</div>
                  </div>
                </button>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}
