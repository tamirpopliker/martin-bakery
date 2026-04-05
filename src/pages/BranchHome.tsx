import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { ArrowRight, ShoppingBag, Receipt, Users, Trash2, BarChart3, BarChart2, Settings, Building2, TrendingUp, Upload, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import BranchTeam from './BranchTeam'
import BranchDashboard from './BranchDashboard'
import DataImport from './DataImport'

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
  | 'branch-team'

interface MenuItem {
  page: BranchPage
  label: string
  subtitle: string
  Icon: any
  ready: boolean
  cardBg: string
  cardBorder: string
}

const MENU_ITEMS: MenuItem[] = [
  { page: 'dashboard', label: 'דשבורד סניף',   subtitle: 'KPI · הכנסות · הוצאות · גרפים', Icon: BarChart2, ready: true, cardBg: '#eff6ff', cardBorder: '#93c5fd' },
  { page: 'revenue',   label: 'הכנסות',        subtitle: 'קופה · אתר · הקפה',        Icon: ShoppingBag, ready: true, cardBg: '#f0fdf4', cardBorder: '#bbf7d0' },
  { page: 'expenses',  label: 'הוצאות',         subtitle: 'ספקים · תיקונים · תשתיות', Icon: Receipt,     ready: true, cardBg: '#fef2f2', cardBorder: '#fecaca' },
  { page: 'labor',     label: 'לייבור',          subtitle: 'שעות · עלות מעסיק',         Icon: Users,       ready: true, cardBg: '#fffbeb', cardBorder: '#fde68a' },
  { page: 'branch-team', label: 'ניהול צוות',       subtitle: 'סידור עבודה · משימות · עובדים', Icon: Users,       ready: true, cardBg: '#f0f9ff', cardBorder: '#bae6fd' },
  { page: 'waste',     label: 'פחת',             subtitle: 'סחורה · חומרי גלם',         Icon: Trash2,      ready: true, cardBg: '#fdf2f8', cardBorder: '#fbcfe8' },
  { page: 'suppliers', label: 'ספקים',           subtitle: 'ניהול · קטגוריות',           Icon: Building2,   ready: true, cardBg: '#ecfeff', cardBorder: '#a5f3fc' },
  { page: 'customers', label: 'לקוחות הקפה',    subtitle: 'חובות · תשלומים',            Icon: TrendingUp,  ready: true, cardBg: '#f5f3ff', cardBorder: '#ddd6fe' },
  { page: 'orders',    label: 'הזמנות מהמפעל',  subtitle: 'אישור · עריכה · חומרי גלם', Icon: Package,     ready: true, cardBg: '#fef3c7', cardBorder: '#fde68a' },
  // BranchPL removed — P&L now integrated in BranchDashboard
  { page: 'settings',     label: 'הגדרות סניף',    subtitle: 'KPI · עלויות קבועות · עובדים', Icon: Settings,    ready: true, cardBg: '#f8fafc', cardBorder: '#e2e8f0' },
  { page: 'data_import',  label: 'ייבוא נתונים',   subtitle: 'CSV מ-Base44 · העלאה',         Icon: Upload,      ready: true, cardBg: '#f0f9ff', cardBorder: '#bae6fd' },
]

export default function BranchHome({ branch, onBack }: Props) {
  const [page, setPage] = useState<BranchPage | null>(null)
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
  if (page === 'employees') return (
    <BranchEmployees branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
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

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ width: '44px', height: '44px', background: branch.color, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${branch.color}55` }}>
          <Building2 size={22} color="white" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>סניף {branch.name}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>ניהול הכנסות · הוצאות · KPI</p>
        </div>
      </div>

      {/* ─── כרטיסי מודולים ──────────────────────────────────────────────── */}
      <div className="page-container" style={{ padding: '36px', maxWidth: '960px', margin: '0 auto' }}>
        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {MENU_ITEMS.map(item => {
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
                    background: isHov && item.ready ? branch.color : item.cardBg,
                    border: `2px solid ${isHov && item.ready ? branch.color : item.cardBorder}`,
                    borderRadius: '22px', padding: '32px',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '18px',
                    cursor: 'pointer', transition: 'all 0.18s',
                    transform: isHov && item.ready ? 'translateY(-4px)' : 'none',
                    boxShadow: isHov && item.ready ? `0 16px 40px ${branch.color}35` : '0 2px 8px rgba(0,0,0,0.06)',
                    textAlign: 'right', opacity: item.ready ? 1 : 0.6,
                    position: 'relative' as const
                  }}
                >
                  {!item.ready && (
                    <span style={{ position: 'absolute', top: '14px', left: '14px', background: '#f1f5f9', color: '#94a3b8', fontSize: '11px', padding: '3px 8px', borderRadius: '8px', fontWeight: '600' }}>
                      בקרוב
                    </span>
                  )}
                  {item.page === 'orders' && pendingOrders > 0 && (
                    <span style={{ position: 'absolute', top: '14px', left: '14px', background: '#fb7185', color: 'white', fontSize: '12px', fontWeight: '800', minWidth: '24px', height: '24px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', boxShadow: '0 2px 8px rgba(251,113,133,0.4)' }}>
                      {pendingOrders}
                    </span>
                  )}
                  <div style={{ width: '60px', height: '60px', background: isHov && item.ready ? 'rgba(255,255,255,0.22)' : branch.color + '18', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={30} color={isHov && item.ready ? 'white' : branch.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: '19px', fontWeight: '800', color: isHov && item.ready ? 'white' : '#0f172a' }}>{item.label}</div>
                    <div style={{ fontSize: '14px', color: isHov && item.ready ? 'rgba(255,255,255,0.7)' : '#64748b', marginTop: '5px' }}>{item.subtitle}</div>
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
