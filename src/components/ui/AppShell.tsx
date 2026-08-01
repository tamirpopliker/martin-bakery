// ─────────────────────────────────────────────────────────────────────────────
// AppShell — מסגרת העמוד האחידה לכל מסכי המערכת.
// סיידבר קבוע (ימין ב-RTL) + כותרת עמוד + אזור תוכן.
// מחליף את "כפתור הבית הצף" ואת כרטיסי הניווט של Home/BranchHome.
//
// הניווט נשאר state-based כמו היום: השל לא מכיר routing — הוא מקבל
// items ו-activeKey ומחזיר onNavigate(key) לקומפוננטת האב.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'

export interface NavItem {
  key: string
  label: string
  Icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  /** מונה אדום/כחול ליד הפריט (הזמנות ממתינות, הודעות שלא נקראו) */
  badge?: number
  badgeColor?: string
  /** טקסט קטן בקצה השורה — למשל "31.2%" ללייבור מעל יעד */
  note?: string
  noteColor?: string
  /** נקודה אדומה קטנה — "דורש טיפול" */
  dot?: boolean
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

interface AppShellProps {
  /** שם היחידה בראש הסיידבר: "אברהם אבינו" / "בצקים" / "כל הרשת" */
  entityName: string
  entitySubtitle?: string
  groups: NavGroup[]
  activeKey: string
  onNavigate: (key: string) => void
  /** כותרת העמוד הנוכחי */
  title: string
  /** אלמנטים בכותרת: PeriodPicker, פעמון, כפתור ראשי */
  headerActions?: ReactNode
  /** מוצג מתחת לכותרת בתוך אזור התוכן */
  children: ReactNode
  user?: { name: string; role: string }
  onSearch?: () => void
}

export default function AppShell({
  entityName, entitySubtitle, groups, activeKey, onNavigate,
  title, headerActions, children, user, onSearch,
}: AppShellProps) {
  const [hover, setHover] = useState<string | null>(null)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--m-canvas)', direction: 'rtl', fontFamily: 'var(--m-font)' }}>
      <aside
        className="app-sidebar"
        style={{
          width: 'var(--m-sidebar-w)', flexShrink: 0, background: 'var(--m-surface)',
          borderInlineStart: '1px solid #eef1f4', padding: '18px 14px',
          display: 'flex', flexDirection: 'column', gap: 18,
          position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--m-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 17, fontWeight: 800 }}>מ</div>
          <div style={{ lineHeight: 1.2, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--m-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entityName}</div>
            {entitySubtitle && <div style={{ fontSize: 11, color: '#94a3b8' }}>{entitySubtitle}</div>}
          </div>
        </div>

        {onSearch && (
          <button
            onClick={onSearch}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, background: 'var(--m-surface-hover)',
              border: '1px solid #e7ebef', borderRadius: 'var(--m-r-control)', padding: '8px 10px',
              color: '#64748b', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'right',
            }}
          >
            <Search size={15} color="#94a3b8" />
            <span style={{ flex: 1 }}>חיפוש מסך או פעולה</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', background: 'white', border: '1px solid #e2e8f0', borderRadius: 5, padding: '1px 5px' }}>⌘K</span>
          </button>
        )}

        {groups.map(group => (
          <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--m-text-faint)', letterSpacing: '.06em', padding: '6px 8px' }}>{group.title}</div>
            {group.items.map(item => {
              const active = item.key === activeKey
              const hot = hover === item.key
              const Icon = item.Icon
              return (
                <button
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                  onMouseEnter={() => setHover(item.key)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px',
                    borderRadius: 9, border: 'none', cursor: 'pointer', textAlign: 'right',
                    fontFamily: 'inherit', fontSize: 13.5,
                    background: active ? 'var(--m-accent-tint)' : hot ? 'var(--m-surface-hover)' : 'transparent',
                    color: active ? 'var(--m-accent-text)' : 'var(--m-text-3)',
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {Icon && <Icon size={16} color={active ? 'currentColor' : '#94a3b8'} strokeWidth={1.9} />}
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--m-bad)' }} />}
                  {item.note && <span style={{ fontSize: 11, fontWeight: 800, color: item.noteColor || 'var(--m-text-muted)' }}>{item.note}</span>}
                  {!!item.badge && item.badge > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'white', background: item.badgeColor || 'var(--m-bad)', borderRadius: 999, padding: '1px 6px' }}>{item.badge}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}

        {user && (
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 9, padding: 9, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--m-accent-tint)', color: 'var(--m-accent-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
              {user.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            <div style={{ lineHeight: 1.25, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--m-text)' }}>{user.name}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{user.role}</div>
            </div>
          </div>
        )}
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          className="page-header"
          style={{
            height: 'var(--m-header-h)', background: 'var(--m-surface)', borderBottom: '1px solid #eef1f4',
            display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', flexShrink: 0,
            position: 'sticky', top: 0, zIndex: 20,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--m-text)' }}>{title}</span>
          <div style={{ flex: 1 }} />
          {headerActions}
        </header>

        <div className="app-main" style={{ flex: 1, padding: '22px 26px 32px', maxWidth: 'var(--m-content-max)', width: '100%', boxSizing: 'border-box' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
