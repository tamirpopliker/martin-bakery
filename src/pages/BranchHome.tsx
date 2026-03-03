import { useState } from 'react'
import { ArrowRight, ShoppingBag, Receipt, Users, Trash2, Wrench, BarChart3, Settings, Building2, TrendingUp } from 'lucide-react'
import BranchRevenue from './BranchRevenue'
import BranchExpenses from './BranchExpenses'
import BranchLabor from './BranchLabor'
import BranchWaste from './BranchWaste'

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

interface MenuItem {
  page: BranchPage
  label: string
  subtitle: string
  Icon: any
  ready: boolean
}

const MENU_ITEMS: MenuItem[] = [
  { page: 'revenue',   label: 'הכנסות',        subtitle: 'קופה · אתר · הקפה',        Icon: ShoppingBag, ready: true  },
  { page: 'expenses',  label: 'הוצאות',         subtitle: 'ספקים · תיקונים · תשתיות', Icon: Receipt,     ready: true  },
  { page: 'labor',     label: 'לייבור',          subtitle: 'שעות · עלות מעסיק',         Icon: Users,       ready: true  },
  { page: 'waste',     label: 'פחת',             subtitle: 'סחורה · חומרי גלם',         Icon: Trash2,      ready: true  },
  { page: 'suppliers', label: 'ספקים',           subtitle: 'ניהול ספקים',                Icon: Building2,   ready: false },
  { page: 'customers', label: 'לקוחות הקפה',    subtitle: 'ניהול · היסטוריה',           Icon: TrendingUp,  ready: false },
  { page: 'report',    label: 'דוח רווח והפסד', subtitle: 'פרק · השוואה · ייצוא',      Icon: BarChart3,   ready: false },
  { page: 'settings',  label: 'הגדרות סניף',    subtitle: 'יעדים · משתמשים',            Icon: Settings,    ready: false },
]

export default function BranchHome({ branch, onBack }: Props) {
  const [page, setPage] = useState<BranchPage | null>(null)
  const [hovCard, setHovCard] = useState<BranchPage | null>(null)

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
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
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
      <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px' }}>
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
                  background: isHov && item.ready ? branch.color : 'white',
                  border: `1.5px solid ${isHov && item.ready ? branch.color : '#e2e8f0'}`,
                  borderRadius: '18px', padding: '22px',
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '14px',
                  cursor: 'pointer', transition: 'all 0.18s',
                  transform: isHov && item.ready ? 'translateY(-3px)' : 'none',
                  boxShadow: isHov && item.ready ? `0 12px 30px ${branch.color}35` : '0 1px 3px rgba(0,0,0,0.05)',
                  textAlign: 'right', opacity: item.ready ? 1 : 0.6,
                  position: 'relative' as const
                }}
              >
                {!item.ready && (
                  <span style={{ position: 'absolute', top: '12px', left: '12px', background: '#f1f5f9', color: '#94a3b8', fontSize: '10px', padding: '2px 6px', borderRadius: '6px', fontWeight: '600' }}>
                    בקרוב
                  </span>
                )}
                <div style={{ width: '46px', height: '46px', background: isHov && item.ready ? 'rgba(255,255,255,0.22)' : branch.color + '15', borderRadius: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={23} color={isHov && item.ready ? 'white' : branch.color} />
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: isHov && item.ready ? 'white' : '#0f172a' }}>{item.label}</div>
                  <div style={{ fontSize: '12px', color: isHov && item.ready ? 'rgba(255,255,255,0.7)' : '#94a3b8', marginTop: '3px' }}>{item.subtitle}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}