import { useState } from 'react'
import { ArrowRight, TrendingUp, Trash2, Wrench, ClipboardList, LayoutDashboard, FlaskConical, Croissant, Package, Truck } from 'lucide-react'
import DailyProduction from './DailyProduction'
import FactoryWaste from './FactoryWaste'
import FactoryRepairs from './FactoryRepairs'
import DepartmentLabor from './DepartmentLabor'
import DepartmentDashboard from './DepartmentDashboard'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
type Department = 'creams' | 'dough' | 'packaging' | 'cleaning'
type DeptPage = 'production' | 'waste' | 'repairs' | 'labor' | 'dashboard'

interface Props {
  department: Department
  onBack: () => void
}

interface MenuItem {
  page: DeptPage
  label: string
  subtitle: string
  Icon: any
  depts: Department[] // באילו מחלקות הפריט מופיע
  cardBg: string      // רקע רך לכרטיס
  cardBorder: string   // צבע גבול
}

// ─── קונפיגורציה ────────────────────────────────────────────────────────────
const DEPT_CONFIG: Record<Department, { label: string; color: string; Icon: any; subtitle: string }> = {
  creams:    { label: 'קרמים',       color: '#3b82f6', Icon: FlaskConical, subtitle: 'ייצור · פחת · תיקונים · לייבור · דשבורד' },
  dough:     { label: 'בצקים',       color: '#8b5cf6', Icon: Croissant,    subtitle: 'ייצור · פחת · תיקונים · לייבור · דשבורד' },
  packaging: { label: 'אריזה',       color: '#0ea5e9', Icon: Package,      subtitle: 'כמויות · פחת · תיקונים · לייבור' },
  cleaning:  { label: 'ניקיון/נהג',  color: '#64748b', Icon: Truck,        subtitle: 'תיקונים · לייבור' },
}

const MENU_ITEMS: MenuItem[] = [
  { page: 'production', label: 'ייצור יומי',   subtitle: 'הזנת נתוני ייצור יומיים',           Icon: TrendingUp,       depts: ['creams', 'dough'],                         cardBg: '#eff6ff', cardBorder: '#bfdbfe' },
  { page: 'production', label: 'כמויות יומיות', subtitle: 'הזנת כמויות אריזה',                 Icon: TrendingUp,       depts: ['packaging'],                                cardBg: '#eff6ff', cardBorder: '#bfdbfe' },
  { page: 'waste',      label: 'פחת',           subtitle: 'מעקב פחת חומרי גלם וסחורה',        Icon: Trash2,           depts: ['creams', 'dough', 'packaging'],              cardBg: '#fef2f2', cardBorder: '#fecaca' },
  { page: 'repairs',    label: 'תיקונים',       subtitle: 'תיקונים · רכישות ציוד',              Icon: Wrench,           depts: ['creams', 'dough', 'packaging', 'cleaning'],  cardBg: '#fff7ed', cardBorder: '#fed7aa' },
  { page: 'labor',      label: 'לייבור',        subtitle: 'שעות עבודה · עלות מעסיק',            Icon: ClipboardList,    depts: ['creams', 'dough', 'packaging', 'cleaning'],  cardBg: '#fffbeb', cardBorder: '#fde68a' },
  { page: 'dashboard',  label: 'דשבורד',        subtitle: 'KPI · גרפים · פירוט יומי',           Icon: LayoutDashboard,  depts: ['creams', 'dough'],                           cardBg: '#eef2ff', cardBorder: '#c7d2fe' },
]

// ─── קומפוננטה ──────────────────────────────────────────────────────────────
export default function DepartmentHome({ department, onBack }: Props) {
  const [page, setPage] = useState<DeptPage | null>(null)
  const [hovCard, setHovCard] = useState<DeptPage | null>(null)

  const cfg = DEPT_CONFIG[department]
  const items = MENU_ITEMS.filter(item => item.depts.includes(department))

  // ─── ניתוב פנימי ────────────────────────────────────────────────────────────
  if (page === 'production') return (
    <DailyProduction department={department} onBack={() => setPage(null)} />
  )
  if (page === 'waste') return (
    <FactoryWaste department={department} onBack={() => setPage(null)} />
  )
  if (page === 'repairs') return (
    <FactoryRepairs department={department} onBack={() => setPage(null)} />
  )
  if (page === 'labor') return (
    <DepartmentLabor department={department} onBack={() => setPage(null)} />
  )
  if (page === 'dashboard' && (department === 'creams' || department === 'dough')) return (
    <DepartmentDashboard department={department} onBack={() => setPage(null)} />
  )

  // ─── מסך Hub ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '44px', height: '44px', background: cfg.color, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${cfg.color}55` }}>
          <cfg.Icon size={22} color="white" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>מחלקת {cfg.label}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>{cfg.subtitle}</p>
        </div>
      </div>

      {/* ─── כרטיסי מודולים ──────────────────────────────────────────────── */}
      <div className="page-container" style={{ padding: '36px', maxWidth: '960px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
          {items.map(item => {
            const Icon = item.Icon
            const isHov = hovCard === item.page
            return (
              <button
                key={item.page}
                onClick={() => setPage(item.page)}
                onMouseEnter={() => setHovCard(item.page)}
                onMouseLeave={() => setHovCard(null)}
                style={{
                  background: isHov ? cfg.color : item.cardBg,
                  border: `2px solid ${isHov ? cfg.color : item.cardBorder}`,
                  borderRadius: '22px', padding: '32px',
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '18px',
                  cursor: 'pointer', transition: 'all 0.18s',
                  transform: isHov ? 'translateY(-4px)' : 'none',
                  boxShadow: isHov ? `0 16px 40px ${cfg.color}35` : '0 2px 8px rgba(0,0,0,0.06)',
                  textAlign: 'right',
                }}
              >
                <div style={{ width: '60px', height: '60px', background: isHov ? 'rgba(255,255,255,0.22)' : cfg.color + '18', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={30} color={isHov ? 'white' : cfg.color} />
                </div>
                <div>
                  <div style={{ fontSize: '19px', fontWeight: '800', color: isHov ? 'white' : '#0f172a' }}>{item.label}</div>
                  <div style={{ fontSize: '14px', color: isHov ? 'rgba(255,255,255,0.7)' : '#64748b', marginTop: '5px' }}>{item.subtitle}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
