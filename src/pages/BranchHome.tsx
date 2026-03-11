import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, ShoppingBag, Receipt, Users, Trash2, Wrench, BarChart3, Settings, Building2, TrendingUp, Upload, Package } from 'lucide-react'
import BranchRevenue from './BranchRevenue'
import BranchExpenses from './BranchExpenses'
import BranchLabor from './BranchLabor'
import BranchWaste from './BranchWaste'
import BranchPL from './BranchPL'
import BranchSettings from './BranchSettings'
import BranchCreditCustomers from './BranchCreditCustomers'
import BranchSuppliers from './BranchSuppliers'
import BranchOrders from './BranchOrders'
import DataImport from './DataImport'

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
  { page: 'revenue',   label: 'הכנסות',        subtitle: 'קופה · אתר · הקפה',        Icon: ShoppingBag, ready: true, cardBg: '#f0fdf4', cardBorder: '#bbf7d0' },
  { page: 'expenses',  label: 'הוצאות',         subtitle: 'ספקים · תיקונים · תשתיות', Icon: Receipt,     ready: true, cardBg: '#fef2f2', cardBorder: '#fecaca' },
  { page: 'labor',     label: 'לייבור',          subtitle: 'שעות · עלות מעסיק',         Icon: Users,       ready: true, cardBg: '#fffbeb', cardBorder: '#fde68a' },
  { page: 'waste',     label: 'פחת',             subtitle: 'סחורה · חומרי גלם',         Icon: Trash2,      ready: true, cardBg: '#fdf2f8', cardBorder: '#fbcfe8' },
  { page: 'suppliers', label: 'ספקים',           subtitle: 'ניהול · קטגוריות',           Icon: Building2,   ready: true, cardBg: '#ecfeff', cardBorder: '#a5f3fc' },
  { page: 'customers', label: 'לקוחות הקפה',    subtitle: 'חובות · תשלומים',            Icon: TrendingUp,  ready: true, cardBg: '#f5f3ff', cardBorder: '#ddd6fe' },
  { page: 'orders',    label: 'הזמנות מהמפעל',  subtitle: 'אישור · עריכה · חומרי גלם', Icon: Package,     ready: true, cardBg: '#fef3c7', cardBorder: '#fde68a' },
  { page: 'report',    label: 'דוח רווח והפסד', subtitle: 'P&L · השוואה חודשית',       Icon: BarChart3,   ready: true, cardBg: '#eff6ff', cardBorder: '#bfdbfe' },
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
  if (page === 'revenue') return (
    <BranchRevenue branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'expenses') return (
    <BranchExpenses branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'labor') return (
    <BranchLabor branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'waste') return (
    <BranchWaste branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
  if (page === 'report') return (
    <BranchPL branchId={branch.id} branchName={branch.name} branchColor={branch.color} onBack={() => setPage(null)} />
  )
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
  if (page === 'data_import') return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={() => setPage(null)} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '44px', height: '44px', background: branch.color, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${branch.color}55` }}>
          <Upload size={22} color="white" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>ייבוא נתונים — סניף {branch.name}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>העלאת CSV מ-Base44</p>
        </div>
      </div>
      <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>
        <DataImport branchOnly />
      </div>
    </div>
  )

  // placeholder למסכים שטרם נבנו
  if (page) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>
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
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '44px', height: '44px', background: branch.color, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${branch.color}55` }}>
          <Building2 size={22} color="white" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>סניף {branch.name}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>ניהול הכנסות · הוצאות · KPI</p>
        </div>
      </div>

      {/* ─── כרטיסי מודולים ──────────────────────────────────────────────── */}
      <div style={{ padding: '36px', maxWidth: '960px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
          {MENU_ITEMS.map(item => {
            const Icon = item.Icon
            const isHov = hovCard === item.page
            return (
              <button
                key={item.page}
                onClick={() => setPage(item.page)}
                onMouseEnter={() => setHovCard(item.page)}
                onMouseLeave={() => setHovCard(null)}
                style={{
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
                  <span style={{ position: 'absolute', top: '14px', left: '14px', background: '#ef4444', color: 'white', fontSize: '12px', fontWeight: '800', minWidth: '24px', height: '24px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', boxShadow: '0 2px 8px rgba(239,68,68,0.4)' }}>
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
            )
          })}
        </div>
      </div>
    </div>
  )
}