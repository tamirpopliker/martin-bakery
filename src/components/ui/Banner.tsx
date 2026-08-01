// ─────────────────────────────────────────────────────────────────────────────
// Banner + ActionList — הודעות ו"דורש טיפול".
// Banner: ארבע חומרות (bad/warn/info/good) עם פעולה אופציונלית.
//   מחליף את הבאנרים המקומיים (סגירת קופה באיחור, לייבור משוער, חשבוניות באיחור).
// ActionList: הבלוק שפותח כל מסך בית — פריט = כותרת, הסבר, וכפתור שמבצע
//   את הפעולה במקום, בלי לנווט למסך אחר.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { AlertTriangle, Info, CheckCircle2, Clock } from 'lucide-react'

type Tone = 'bad' | 'warn' | 'info' | 'good'

const TONE: Record<Tone, { bg: string; border: string; text: string; icon: ReactNode }> = {
  bad:  { bg: 'var(--m-bad-tint)',  border: 'var(--m-bad-border)',  text: '#991b1b', icon: <AlertTriangle size={17} color="#dc2626" /> },
  warn: { bg: 'var(--m-warn-tint)', border: 'var(--m-warn-border)', text: 'var(--m-warn-strong)', icon: <Clock size={17} color="#d97706" /> },
  info: { bg: 'var(--m-info-tint)', border: 'var(--m-info-border)', text: 'var(--m-info-strong)', icon: <Info size={17} color="#0284c7" /> },
  good: { bg: 'var(--m-good-tint)', border: 'var(--m-good-border)', text: 'var(--m-good-strong)', icon: <CheckCircle2 size={17} color="#16a34a" /> },
}

export function Banner({ tone = 'info', title, detail, action }: {
  tone?: Tone; title: string; detail?: string; action?: ReactNode
}) {
  const t = TONE[tone]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 12, padding: '13px 15px' }}>
      <span style={{ flexShrink: 0, display: 'flex' }}>{t.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{title}</div>
        {detail && <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 1, lineHeight: 1.5 }}>{detail}</div>}
      </div>
      {action}
    </div>
  )
}

export interface ActionItem {
  key: string
  tone: Tone
  title: string
  detail?: string
  /** תוכן נוסף שנפתח בתוך הפריט — למשל רשימת תעודות לאישור אחת-אחת */
  expand?: ReactNode
  actions: ReactNode
}

/** "דורש טיפול" — פותח כל מסך בית. אם אין פריטים, לא מרנדרים כלום. */
export function ActionList({ items }: { items: ActionItem[] }) {
  if (items.length === 0) return null
  return (
    <div style={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 'var(--m-r-card)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderBottom: '1px solid #f1f5f9' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--m-bad)' }} />
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--m-text)' }}>דורש טיפול</span>
        <span className="m-num" style={{ fontSize: 12, color: '#94a3b8' }}>{items.length} פריטים · מטופל מכאן</span>
      </div>
      {items.map((item, i) => {
        const t = TONE[item.tone]
        return (
          <div key={item.key} style={{ padding: '15px 18px', borderBottom: i === items.length - 1 ? 'none' : '1px solid #f5f7f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {t.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--m-text)' }}>{item.title}</div>
                {item.detail && <div style={{ fontSize: 12.5, color: 'var(--m-text-muted)', marginTop: 2, lineHeight: 1.5 }}>{item.detail}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{item.actions}</div>
            </div>
            {item.expand}
          </div>
        )
      })}
    </div>
  )
}
