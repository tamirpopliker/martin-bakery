import { useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Trash2, Wrench, ClipboardList, LayoutDashboard, FlaskConical, Croissant, Package, Truck } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import DailyProduction from './DailyProduction'
import FactoryWaste from './FactoryWaste'
import FactoryRepairs from './FactoryRepairs'
import DepartmentLabor from './DepartmentLabor'
import DepartmentDashboard from './DepartmentDashboard'

// ─── אנימציות ─────────────────────────────────────────────────────────────────
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }
const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } } }

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
}

// ─── קונפיגורציה ────────────────────────────────────────────────────────────
const DEPT_CONFIG: Record<Department, { label: string; color: string; Icon: any; subtitle: string }> = {
  creams:    { label: 'קרמים',       color: '#6366f1', Icon: FlaskConical, subtitle: 'ייצור · פחת · תיקונים · לייבור · דשבורד' },
  dough:     { label: 'בצקים',       color: '#6366f1', Icon: Croissant,    subtitle: 'ייצור · פחת · תיקונים · לייבור · דשבורד' },
  packaging: { label: 'אריזה',       color: '#6366f1', Icon: Package,      subtitle: 'כמויות · פחת · תיקונים · לייבור' },
  cleaning:  { label: 'ניקיון/נהג',  color: '#6366f1', Icon: Truck,        subtitle: 'תיקונים · לייבור' },
}

const MENU_ITEMS: MenuItem[] = [
  { page: 'production', label: 'ייצור יומי',   subtitle: 'הזנת נתוני ייצור יומיים',           Icon: TrendingUp,       depts: ['creams', 'dough'] },
  { page: 'production', label: 'כמויות יומיות', subtitle: 'הזנת כמויות אריזה',                 Icon: TrendingUp,       depts: ['packaging'] },
  { page: 'waste',      label: 'פחת',           subtitle: 'מעקב פחת חומרי גלם וסחורה',        Icon: Trash2,           depts: ['creams', 'dough', 'packaging'] },
  { page: 'repairs',    label: 'תיקונים',       subtitle: 'תיקונים · רכישות ציוד',              Icon: Wrench,           depts: ['creams', 'dough', 'packaging', 'cleaning'] },
  { page: 'labor',      label: 'לייבור',        subtitle: 'שעות עבודה · עלות מעסיק',            Icon: ClipboardList,    depts: ['creams', 'dough', 'packaging', 'cleaning'] },
  { page: 'dashboard',  label: 'דשבורד',        subtitle: 'KPI · גרפים · פירוט יומי',           Icon: LayoutDashboard,  depts: ['creams', 'dough'] },
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
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <PageHeader
        title={`מחלקת ${cfg.label}`}
        subtitle={cfg.subtitle}
        onBack={onBack}
      />

      {/* ─── כרטיסי מודולים ──────────────────────────────────────────────── */}
      <div className="page-container" style={{ padding: '36px', maxWidth: '960px', margin: '0 auto' }}>
        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {items.map(item => {
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
                    border: `1px solid ${isHov ? '#c7d2fe' : '#e2e8f0'}`,
                    borderRadius: 12, padding: 20,
                    display: 'flex', alignItems: 'center', gap: 14,
                    boxShadow: isHov ? '0 4px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)',
                    cursor: 'pointer', transition: 'all 0.18s',
                    textAlign: 'right', cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={18} color="#6366f1" />
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
