// ─────────────────────────────────────────────────────────────────────────────
// DataTable — טבלת הנתונים היחידה במערכת (≈24 מסכי הזנה + כל הדוחות).
// מסגרת אחת, בלי פסים מתחלפים, מספרים לשמאל, שורת סיכום, ושורות מסומנות
// למצב בעייתי. מחליף את ה-<table> של shadcn ואת הטבלאות המקומיות.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  /** רוחב קבוע בפיקסלים; בלי width — התא נמתח (1fr) */
  width?: number
  /** מספרים/סכומים — יושר לשמאל + tabular-nums */
  numeric?: boolean
  render: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  /** כותרת מעל הטבלה + פילטרים/פעולות */
  title?: string
  toolbar?: ReactNode
  /** מסמן שורה כבעייתית (חסר ספק, פער בקופה, חשבונית באיחור) */
  rowTone?: (row: T) => 'bad' | 'warn' | 'good' | undefined
  /** שורת סיכום בתחתית — תא לכל עמודה (או null) */
  footer?: { label: string; cells: (ReactNode | null)[] }
  onRowClick?: (row: T) => void
  /** מצב ריק */
  empty?: { title: string; hint?: string; action?: ReactNode }
  loading?: boolean
}

export default function DataTable<T>({
  columns, rows, rowKey, title, toolbar, rowTone, footer, onRowClick, empty, loading,
}: DataTableProps<T>) {
  const [hover, setHover] = useState<string | number | null>(null)
  const grid = columns.map(c => (c.width ? `${c.width}px` : '1fr')).join(' ')

  const toneBg = (t?: string) =>
    t === 'bad' ? 'var(--m-bad-row)' : t === 'warn' ? '#fffdf6' : t === 'good' ? 'var(--m-good-tint)' : undefined

  return (
    <div style={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 'var(--m-r-card)', overflow: 'hidden' }}>
      {(title || toolbar) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
          {title && <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--m-text)' }}>{title}</span>}
          <div style={{ flex: 1 }} />
          {toolbar}
        </div>
      )}

      <div className="table-scroll">
        <div style={{ minWidth: 600 }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '9px 18px', background: 'var(--m-surface-sub)', borderBottom: '1px solid var(--m-border)', fontSize: 11, fontWeight: 800, color: 'var(--m-text-faint)' }}>
            {columns.map(c => (
              <span key={c.key} style={{ textAlign: c.numeric ? 'left' : 'right' }}>{c.header}</span>
            ))}
          </div>

          {loading && [0, 1, 2].map(i => (
            <div key={i} style={{ padding: '14px 18px', borderBottom: '1px solid var(--m-border-soft)' }}>
              <div style={{ height: 14, background: '#f1f4f7', borderRadius: 6, width: `${90 - i * 15}%` }} />
            </div>
          ))}

          {!loading && rows.length === 0 && empty && (
            <div style={{ padding: '34px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, textAlign: 'center' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--m-text)' }}>{empty.title}</div>
              {empty.hint && <div style={{ fontSize: 12.5, color: 'var(--m-text-muted)' }}>{empty.hint}</div>}
              {empty.action}
            </div>
          )}

          {!loading && rows.map(row => {
            const k = rowKey(row)
            const tone = rowTone?.(row)
            const bg = toneBg(tone) ?? (hover === k ? 'var(--m-surface-sub)' : undefined)
            return (
              <div
                key={k}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onRowClick?.(row)}
                style={{
                  display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '12px 18px',
                  alignItems: 'center', borderBottom: '1px solid var(--m-border-soft)',
                  background: bg, cursor: onRowClick ? 'pointer' : 'default', minHeight: 'var(--m-row-h)',
                  boxSizing: 'border-box',
                }}
              >
                {columns.map(c => (
                  <div
                    key={c.key}
                    className={c.numeric ? 'm-num' : undefined}
                    style={{ fontSize: 13, color: 'var(--m-text-2)', textAlign: c.numeric ? 'left' : 'right', minWidth: 0 }}
                  >
                    {c.render(row)}
                  </div>
                ))}
              </div>
            )
          })}

          {footer && !loading && rows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '14px 18px', alignItems: 'center', background: 'var(--m-surface-hover)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--m-text)' }}>{footer.label}</div>
              {footer.cells.map((cell, i) => (
                <div key={i} className="m-num" style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--m-text)', textAlign: columns[i + 1]?.numeric ? 'left' : 'right' }}>
                  {cell}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
