// ─────────────────────────────────────────────────────────────────────────────
// StatCard + TargetBar + DiffBadge — כל מדד במערכת.
// כלל: מדד עם יעד מקבל צבע לפי המצב מול היעד; מדד בלי יעד נשאר נייטרלי.
// מחליף את כרטיסי ה-KPI ב-Home / BranchDashboard / FactoryDashboard /
// DepartmentDashboard / CEODashboard.
// ─────────────────────────────────────────────────────────────────────────────

import { TrendingUp, TrendingDown } from 'lucide-react'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString()

/** שינוי מול תקופת ההשוואה. inverse=true כשעלייה היא רעה (לייבור, פחת). */
export function DiffBadge({ current, previous, inverse }: { current: number; previous: number; inverse?: boolean }) {
  if (!previous) return null
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const up = pct > 0
  const good = inverse ? !up : up
  const color = Math.abs(pct) < 1 ? 'var(--m-text-faint)' : good ? 'var(--m-good)' : 'var(--m-bad)'
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className="m-num" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 800, color }}>
      <Icon size={12} />{Math.abs(pct).toFixed(1)}%
    </span>
  )
}

/** פס יעד: מילוי = בפועל, קו שחור = היעד. lowerIsBetter ללייבור/פחת. */
export function TargetBar({ actual, target, lowerIsBetter }: { actual: number; target: number; lowerIsBetter: boolean }) {
  if (!target) return null
  const ratio = actual / target
  const ok = lowerIsBetter ? ratio <= 1 : ratio >= 1
  const near = lowerIsBetter ? ratio <= 1.15 : ratio >= 0.85
  const bar = ok ? 'var(--m-good-bar)' : near ? 'var(--m-warn-bar)' : 'var(--m-bad-bar)'
  // הקו השחור נקבע ב-70% מהרוחב; המילוי נמדד ביחס אליו כדי שהיעד תמיד באותו מקום.
  const fill = Math.min(ratio * 70, 100)
  return (
    <div style={{ position: 'relative', height: 6, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${fill}%`, background: bar, borderRadius: 999 }} />
      <div style={{ position: 'absolute', insetInlineStart: '70%', top: -2, bottom: -2, width: 2, background: 'var(--m-ink)' }} />
    </div>
  )
}

interface StatCardProps {
  label: string
  /** מספר גולמי; formatted דורס אותו כשצריך תצוגה מיוחדת */
  value: number
  formatted?: string
  previous?: number
  inverse?: boolean
  /** אחוזים במקום שקלים */
  isPct?: boolean
  target?: number
  lowerIsBetter?: boolean
  /** שורת הסבר קטנה: "9.3% מההכנסות" */
  footnote?: string
  /** ספארקליין: מערך מספרים (6-12 נקודות) */
  spark?: number[]
  /** תג קטן ליד השם: "מעל יעד" */
  flag?: { text: string; tone: 'good' | 'warn' | 'bad' }
  onClick?: () => void
}

export default function StatCard({
  label, value, formatted, previous, inverse, isPct, target, lowerIsBetter = true,
  footnote, spark, flag, onClick,
}: StatCardProps) {
  const offTarget = target ? (lowerIsBetter ? value > target : value < target) : false
  const valueColor = target ? (offTarget ? 'var(--m-bad)' : 'var(--m-text)') : 'var(--m-text)'
  const tone = flag?.tone === 'bad' ? ['var(--m-bad-strong)', 'var(--m-bad-tint)']
    : flag?.tone === 'warn' ? ['var(--m-warn-strong)', 'var(--m-warn-tint)']
    : ['var(--m-good-strong)', 'var(--m-good-tint)']

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--m-surface)',
        border: `1px solid ${offTarget ? '#fde2e6' : 'var(--m-border)'}`,
        borderRadius: 'var(--m-r-card)', padding: '15px 16px',
        display: 'flex', flexDirection: 'column', gap: 8,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--m-text-muted)', fontWeight: 600 }}>{label}</span>
        {flag && (
          <span style={{ fontSize: 10, fontWeight: 800, color: tone[0], background: tone[1], borderRadius: 5, padding: '1px 5px' }}>{flag.text}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span className="m-num" style={{ fontSize: 'var(--m-fs-kpi)', fontWeight: 800, color: valueColor }}>
          {formatted ?? (isPct ? value.toFixed(1) + '%' : fmt(value))}
        </span>
        {previous !== undefined && <DiffBadge current={value} previous={previous} inverse={inverse} />}
      </div>

      {target ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <TargetBar actual={value} target={target} lowerIsBetter={lowerIsBetter} />
          <span style={{ fontSize: 11, color: '#94a3b8' }}>יעד {isPct ? target + '%' : fmt(target)}</span>
        </div>
      ) : spark && spark.length > 1 ? (
        <Spark points={spark} />
      ) : footnote ? (
        <span style={{ fontSize: 11.5, color: '#94a3b8' }}>{footnote}</span>
      ) : null}

      {target && footnote && <span style={{ fontSize: 11.5, color: '#94a3b8' }}>{footnote}</span>}
    </div>
  )
}

function Spark({ points }: { points: number[] }) {
  const max = Math.max(...points), min = Math.min(...points)
  const span = max - min || 1
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 200},${26 - ((p - min) / span) * 22}`).join(' ')
  const rising = points[points.length - 1] >= points[0]
  return (
    <svg width="100%" height="28" viewBox="0 0 200 28" preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke={rising ? 'var(--m-good-bar)' : 'var(--m-bad-bar)'} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
