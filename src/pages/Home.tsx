import { useState } from 'react'
import { supabase } from '../lib/supabase'
import DailyProduction from './DailyProduction'
import FactorySales from './FactorySales'
import FactoryWaste from './FactoryWaste'
import FactoryRepairs from './FactoryRepairs'
import Labor from './Labor'
import Suppliers from './Suppliers'
import DepartmentDashboard from './DepartmentDashboard'
import FactoryDashboard from './FactoryDashboard'
import DepartmentLabor from './DepartmentLabor'
import FactoryB2B from './FactoryB2B'
import FactorySettings from './FactorySettings'
import BranchHome from './BranchHome'
import {
  FlaskConical, Croissant, Package, HardHat, BarChart3,
  Store, Trophy, Settings, LogOut, TrendingUp, Wallet,
  AlertTriangle, Users, ChevronLeft, ChevronDown,
  ShoppingCart, Trash2, Wrench, ClipboardList, LayoutDashboard,
  Truck
} from 'lucide-react'

// ─── טיפוסים ───────────────────────────────────────────────────────────────
type Department = 'creams' | 'dough' | 'packaging' | 'cleaning'

interface SubItem {
  label: string
  page: string
  Icon: any
}

interface Module {
  title: string
  subtitle: string
  Icon: any
  color: string
  bg: string
  section: string
  page?: string          // ניווט ישיר (ללא תפריט משנה)
  dept?: Department      // אם יש תפריט משנה
  sub?: SubItem[]
}

// ─── תפריט משנה לפי מחלקת ייצור ────────────────────────────────────────────
function makeSub(dept: Department): SubItem[] {
  const base: SubItem[] = [
    { label: dept === 'packaging' ? 'כמויות יומיות' : 'ייצור יומי', page: `${dept}_production`, Icon: TrendingUp },
  ]
  if (dept !== 'cleaning') {
    base.push({ label: 'מכירות',   page: `${dept}_sales`,   Icon: ShoppingCart })
    base.push({ label: 'פחת',      page: `${dept}_waste`,   Icon: Trash2 })
  }
  base.push({ label: 'תיקונים',  page: `${dept}_repairs`, Icon: Wrench })
  base.push({ label: 'לייבור',   page: `${dept}_labor`,   Icon: ClipboardList })
  if (dept !== 'cleaning') {
    base.push({ label: 'דשבורד',  page: `${dept}_dashboard`, Icon: LayoutDashboard })
  }
  return base
}

// ─── מודולים ─────────────────────────────────────────────────────────────
const modules: Module[] = [
  { title: 'קרמים',         subtitle: 'ייצור · מכירות · פחת',   Icon: FlaskConical, color: '#3b82f6', bg: '#dbeafe', section: 'מפעל', dept: 'creams',    sub: makeSub('creams') },
  { title: 'בצקים',         subtitle: 'ייצור · מכירות · פחת',   Icon: Croissant,    color: '#8b5cf6', bg: '#ede9fe', section: 'מפעל', dept: 'dough',     sub: makeSub('dough') },
  { title: 'אריזה',         subtitle: 'כמויות · תיקונים · לייבור', Icon: Package,   color: '#0ea5e9', bg: '#e0f2fe', section: 'מפעל', dept: 'packaging', sub: makeSub('packaging') },
  { title: 'ניקיון/נהג',    subtitle: 'תיקונים · לייבור',        Icon: Truck,       color: '#64748b', bg: '#f1f5f9', section: 'מפעל', dept: 'cleaning',  sub: makeSub('cleaning') },
  { title: 'לייבור מרוכז',  subtitle: 'העלאת CSV · כל המחלקות', Icon: HardHat,     color: '#f59e0b', bg: '#fef3c7', section: 'מפעל', page: 'labor' },
  { title: 'ספקים',         subtitle: 'חשבוניות · ניהול ספקים',  Icon: ClipboardList, color: '#10b981', bg: '#d1fae5', section: 'מפעל', page: 'suppliers' },
  { title: 'מכירות B2B',    subtitle: 'עסקיים · מכירות שונות',   Icon: TrendingUp,    color: '#6366f1', bg: '#e0e7ff', section: 'מפעל', page: 'factory_b2b' },
  { title: 'דשבורד מפעל',   subtitle: 'KPI · רווח · גרפים',     Icon: BarChart3,   color: '#6366f1', bg: '#e0e7ff', section: 'מפעל', page: 'factory_dashboard' },
  { title: 'אברהם אבינו',   subtitle: 'הכנסות · הוצאות',         Icon: Store,       color: '#3b82f6', bg: '#dbeafe', section: 'סניפים', page: 'branch_1' },
  { title: 'הפועלים',       subtitle: 'הכנסות · הוצאות',         Icon: Store,       color: '#10b981', bg: '#d1fae5', section: 'סניפים', page: 'branch_2' },
  { title: 'יעקב כהן',      subtitle: 'הכנסות · הוצאות',         Icon: Store,       color: '#a855f7', bg: '#f3e8ff', section: 'סניפים', page: 'branch_3' },
  { title: 'דשבורד מנכ"ל',  subtitle: 'מבט רשתי',                Icon: Trophy,      color: '#f59e0b', bg: '#fef3c7', section: 'ניהול', page: 'ceo_dashboard' },
  { title: 'הגדרות',        subtitle: 'יעדים · עובדים · עלויות', Icon: Settings,    color: '#64748b', bg: '#f1f5f9', section: 'ניהול', page: 'settings' },
]

const SECTIONS = ['מפעל', 'סניפים', 'ניהול']

const stats = [
  { label: 'הכנסות היום',  value: '—', Icon: Wallet,        color: '#3b82f6', bg: '#eff6ff',  border: '#bfdbfe' },
  { label: 'רווח גולמי',   value: '—', Icon: TrendingUp,    color: '#10b981', bg: '#f0fdf4',  border: '#bbf7d0' },
  { label: 'לייבור',        value: '—', Icon: Users,         color: '#f59e0b', bg: '#fffbeb',  border: '#fde68a' },
  { label: 'פחת',           value: '—', Icon: AlertTriangle, color: '#ef4444', bg: '#fef2f2',  border: '#fecaca' },
]

// ─── קומפוננטת Home ──────────────────────────────────────────────────────────
export default function Home() {
  const [page, setPage]               = useState<string | null>(null)
  const [openDept, setOpenDept]       = useState<string | null>(null)
  const [hovNav, setHovNav]           = useState<string | null>(null)
  const [hovCard, setHovCard]         = useState<string | null>(null)

  // ─── ניתוב מסכים ──────────────────────────────────────────────────────
  // ייצור יומי
  if (page === 'creams_production')    return <DailyProduction department="creams"    onBack={() => setPage(null)} />
  if (page === 'dough_production')     return <DailyProduction department="dough"     onBack={() => setPage(null)} />
  if (page === 'packaging_production') return <DailyProduction department="packaging" onBack={() => setPage(null)} />

  // מכירות
  if (page === 'creams_sales')         return <FactorySales department="creams"    onBack={() => setPage(null)} />
  if (page === 'dough_sales')          return <FactorySales department="dough"     onBack={() => setPage(null)} />
  if (page === 'packaging_sales')      return <FactorySales department="packaging" onBack={() => setPage(null)} />

  // פחת
  if (page === 'creams_waste')         return <FactoryWaste department="creams"    onBack={() => setPage(null)} />
  if (page === 'dough_waste')          return <FactoryWaste department="dough"     onBack={() => setPage(null)} />
  if (page === 'packaging_waste')      return <FactoryWaste department="packaging" onBack={() => setPage(null)} />

  // תיקונים
  if (page === 'creams_repairs')       return <FactoryRepairs department="creams"    onBack={() => setPage(null)} />
  if (page === 'dough_repairs')        return <FactoryRepairs department="dough"     onBack={() => setPage(null)} />
  if (page === 'packaging_repairs')    return <FactoryRepairs department="packaging" onBack={() => setPage(null)} />
  if (page === 'cleaning_repairs')     return <FactoryRepairs department="cleaning"  onBack={() => setPage(null)} />

  // לייבור
  if (page === 'labor')                return <Labor onBack={() => setPage(null)} />
  // לייבור מחלקתי
  if (page === 'creams_labor')         return <DepartmentLabor department="creams"    onBack={() => setPage(null)} />
  if (page === 'dough_labor')          return <DepartmentLabor department="dough"     onBack={() => setPage(null)} />
  if (page === 'packaging_labor')      return <DepartmentLabor department="packaging" onBack={() => setPage(null)} />
  if (page === 'cleaning_labor')       return <DepartmentLabor department="cleaning"  onBack={() => setPage(null)} />

  // ספקים
  if (page === 'suppliers')            return <Suppliers onBack={() => setPage(null)} />

  // דשבורד מחלקתי
  if (page === 'creams_dashboard')     return <DepartmentDashboard department="creams" onBack={() => setPage(null)} />
  if (page === 'dough_dashboard')      return <DepartmentDashboard department="dough"  onBack={() => setPage(null)} />
  if (page === 'factory_dashboard')    return <FactoryDashboard onBack={() => setPage(null)} />
  if (page === 'factory_b2b')          return <FactoryB2B onBack={() => setPage(null)} />
  if (page === 'settings')             return <FactorySettings onBack={() => setPage(null)} />

  // סניפים
  if (page === 'branch_1') return <BranchHome branch={{ id: 1, name: 'אברהם אבינו', color: '#3b82f6' }} onBack={() => setPage(null)} />
  if (page === 'branch_2') return <BranchHome branch={{ id: 2, name: 'הפועלים',     color: '#10b981' }} onBack={() => setPage(null)} />
  if (page === 'branch_3') return <BranchHome branch={{ id: 3, name: 'יעקב כהן',   color: '#a855f7' }} onBack={() => setPage(null)} />

  // placeholders למסכים שטרם נבנו
  if (page) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '48px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚧</div>
        <h2 style={{ margin: '0 0 8px', color: '#0f172a' }}>בפיתוח</h2>
        <p style={{ color: '#94a3b8', marginBottom: '24px' }}>מסך זה יהיה זמין בקרוב</p>
        <button onClick={() => setPage(null)} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}>
          חזרה לדף הבית
        </button>
      </div>
    </div>
  )

  // ─── מסך הבית ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl', display: 'flex' }}>

      {/* ══ סיידבר ══════════════════════════════════════════════════════ */}
      <aside style={{
        width: '272px', minWidth: '272px', background: '#0f172a',
        display: 'flex', flexDirection: 'column',
        minHeight: '100vh', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto'
      }}>
        {/* לוגו */}
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '44px', height: '44px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 14px rgba(59,130,246,0.4)' }}>
              <Croissant size={22} color="white" />
            </div>
            <div>
              <div style={{ color: 'white', fontWeight: '800', fontSize: '18px' }}>מרטין</div>
              <div style={{ color: '#475569', fontSize: '12px' }}>מערכת ניהול</div>
            </div>
          </div>
        </div>

        {/* ניווט */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
          {SECTIONS.map(section => (
            <div key={section} style={{ marginBottom: '20px' }}>
              <div style={{ color: '#334155', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '0 10px', marginBottom: '4px' }}>
                {section}
              </div>

              {modules.filter(m => m.section === section).map(mod => {
                const Icon = mod.Icon
                const hasSub = !!mod.sub
                const isOpen = openDept === mod.title
                const isHov  = hovNav === mod.title

                return (
                  <div key={mod.title}>
                    {/* שורת מודול */}
                    <button
                      onClick={() => {
                        if (hasSub) {
                          setOpenDept(isOpen ? null : mod.title)
                        } else if (mod.page) {
                          setPage(mod.page)
                        }
                      }}
                      onMouseEnter={() => setHovNav(mod.title)}
                      onMouseLeave={() => setHovNav(null)}
                      style={{
                        width: '100%', background: isHov || isOpen ? '#1e293b' : 'transparent',
                        border: 'none', borderRadius: '10px', padding: '9px 10px',
                        display: 'flex', alignItems: 'center', gap: '10px',
                        cursor: 'pointer', marginBottom: '1px', transition: 'background 0.12s'
                      }}
                    >
                      <div style={{ width: '32px', height: '32px', background: mod.bg, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={16} color={mod.color} />
                      </div>
                      <div style={{ flex: 1, textAlign: 'right' }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: isHov || isOpen ? 'white' : '#cbd5e1' }}>{mod.title}</div>
                        <div style={{ fontSize: '10px', color: '#475569', marginTop: '1px' }}>{mod.subtitle}</div>
                      </div>
                      {hasSub && (
                        <ChevronDown size={14} color="#475569"
                          style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                      )}
                      {!hasSub && mod.page && <ChevronLeft size={13} color="#334155" style={{ flexShrink: 0 }} />}
                    </button>

                    {/* תפריט משנה */}
                    {hasSub && isOpen && (
                      <div style={{ marginBottom: '4px', paddingRight: '14px' }}>
                        {mod.sub!.map(sub => {
                          const SubIcon = sub.Icon
                          const isSubHov = hovNav === sub.page
                          return (
                            <button
                              key={sub.page}
                              onClick={() => setPage(sub.page)}
                              onMouseEnter={() => setHovNav(sub.page)}
                              onMouseLeave={() => setHovNav(null)}
                              style={{
                                width: '100%', background: isSubHov ? '#1e293b' : 'transparent',
                                border: 'none', borderRadius: '8px', padding: '7px 10px',
                                display: 'flex', alignItems: 'center', gap: '8px',
                                cursor: 'pointer', transition: 'background 0.12s'
                              }}
                            >
                              <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: mod.color, flexShrink: 0, marginRight: '2px' }} />
                              <SubIcon size={13} color={isSubHov ? mod.color : '#64748b'} />
                              <span style={{ fontSize: '12px', fontWeight: '500', color: isSubHov ? 'white' : '#94a3b8' }}>
                                {sub.label}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </nav>

        {/* התנתקות */}
        <div style={{ padding: '12px 10px', borderTop: '1px solid #1e293b' }}>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ width: '100%', background: 'transparent', color: '#64748b', border: '1px solid #1e293b', borderRadius: '10px', padding: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            <LogOut size={15} />יציאה מהמערכת
          </button>
        </div>
      </aside>

      {/* ══ תוכן ראשי ════════════════════════════════════════════════════ */}
      <main style={{ flex: 1, padding: '36px 40px', overflowY: 'auto' }}>

        {/* כותרת */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>שלום, מנהל ראשי 👋</h1>
          <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>
            {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* כרטיסי KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '40px' }}>
          {stats.map(stat => {
            const Icon = stat.Icon
            return (
              <div key={stat.label} style={{ background: 'white', borderRadius: '18px', padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${stat.border}` }}>
                <div style={{ width: '40px', height: '40px', background: stat.bg, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                  <Icon size={20} color={stat.color} />
                </div>
                <div style={{ fontSize: '26px', fontWeight: '800', color: '#0f172a' }}>{stat.value}</div>
                <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>{stat.label}</div>
              </div>
            )
          })}
        </div>

        {/* כרטיסי מודולים */}
        {SECTIONS.map(section => (
          <div key={section} style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#374151', margin: '0 0 14px' }}>{section}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
              {modules.filter(m => m.section === section).map(mod => {
                const Icon = mod.Icon
                const isHov = hovCard === mod.title
                const hasSub = !!mod.sub

                return (
                  <button
                    key={mod.title}
                    onClick={() => {
                      if (hasSub) {
                        setOpenDept(openDept === mod.title ? null : mod.title)
                        // גלול לסיידבר
                      } else if (mod.page) {
                        setPage(mod.page)
                      }
                    }}
                    onMouseEnter={() => setHovCard(mod.title)}
                    onMouseLeave={() => setHovCard(null)}
                    style={{
                      background: isHov ? mod.color : 'white',
                      border: `1.5px solid ${isHov ? mod.color : '#e2e8f0'}`,
                      borderRadius: '18px', padding: '20px',
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '14px',
                      cursor: 'pointer', transition: 'all 0.18s',
                      transform: isHov ? 'translateY(-3px)' : 'none',
                      boxShadow: isHov ? `0 12px 30px ${mod.color}35` : '0 1px 3px rgba(0,0,0,0.05)',
                      textAlign: 'right'
                    }}
                  >
                    <div style={{ width: '46px', height: '46px', background: isHov ? 'rgba(255,255,255,0.22)' : mod.bg, borderRadius: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={23} color={isHov ? 'white' : mod.color} />
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: '700', color: isHov ? 'white' : '#0f172a' }}>{mod.title}</div>
                      <div style={{ fontSize: '11px', color: isHov ? 'rgba(255,255,255,0.65)' : '#94a3b8', marginTop: '3px' }}>{mod.subtitle}</div>
                    </div>
                    {hasSub && (
                      <div style={{ fontSize: '10px', color: isHov ? 'rgba(255,255,255,0.5)' : '#cbd5e1', marginTop: '-6px' }}>
                        לחץ לפתיחת תפריט ←
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

      </main>
    </div>
  )
}