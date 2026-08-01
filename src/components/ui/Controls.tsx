// ─────────────────────────────────────────────────────────────────────────────
// Controls — Button, Field, Select, SegmentedControl, Tag, Card, SectionTitle.
// הפקדים הבסיסיים. כל מסך במערכת בנוי מהם, כדי שלא ייווצרו שוב 40 גרסאות
// של אותו כפתור.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'confirm' | 'danger'

const BTN: Record<ButtonVariant, { bg: string; color: string; border: string; hover: string }> = {
  primary:   { bg: 'var(--m-ink)',      color: 'white',              border: 'none',                              hover: 'var(--m-ink-hover)' },
  accent:    { bg: 'var(--m-accent)',   color: 'white',              border: 'none',                              hover: 'var(--m-accent-hover)' },
  secondary: { bg: 'white',             color: 'var(--m-text-3)',    border: '1px solid var(--m-border-strong)',  hover: 'var(--m-surface-hover)' },
  ghost:     { bg: 'transparent',       color: 'var(--m-accent)',    border: 'none',                              hover: 'var(--m-accent-tint)' },
  confirm:   { bg: '#10b981',           color: 'white',              border: 'none',                              hover: '#059669' },
  danger:    { bg: 'white',             color: 'var(--m-bad-strong)',border: '1px solid var(--m-bad-border)',     hover: 'var(--m-bad-tint)' },
}

export function Button({ variant = 'secondary', size = 'md', disabled, children, onClick, icon }: {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  disabled?: boolean
  children: ReactNode
  onClick?: () => void
  icon?: ReactNode
}) {
  const [hover, setHover] = useState(false)
  const s = BTN[variant]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: disabled ? 'var(--m-border)' : hover ? s.hover : s.bg,
        color: disabled ? 'var(--m-text-faint)' : s.color,
        border: s.border, borderRadius: 'var(--m-r-control)',
        padding: size === 'sm' ? '6px 12px' : '9px 16px',
        fontSize: size === 'sm' ? 12.5 : 13,
        fontWeight: variant === 'secondary' ? 600 : 700,
        fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {icon}{children}
    </button>
  )
}

export function Field({ label, hint, error, ...props }: {
  label?: string; hint?: string; error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  const [focus, setFocus] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 12.5, fontWeight: 600, color: error ? 'var(--m-bad-strong)' : 'var(--m-text-3)' }}>{label}</label>}
      <input
        {...props}
        onFocus={e => { setFocus(true); props.onFocus?.(e) }}
        onBlur={e => { setFocus(false); props.onBlur?.(e) }}
        style={{
          width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13.5,
          color: 'var(--m-text)', padding: '9px 11px',
          border: `1px solid ${error ? '#fda4af' : focus ? 'var(--m-accent)' : 'var(--m-border-strong)'}`,
          borderRadius: 'var(--m-r-control)',
          background: error ? '#fff7f8' : 'white',
          boxShadow: focus ? '0 0 0 3px var(--m-accent-tint)' : 'none',
          outline: 'none',
        }}
      />
      {(error || hint) && <span style={{ fontSize: 11.5, color: error ? 'var(--m-bad-strong)' : '#94a3b8' }}>{error || hint}</span>}
    </div>
  )
}

export function Select({ label, children, ...props }: { label?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--m-text-3)' }}>{label}</label>}
      <select
        {...props}
        style={{
          width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13.5, color: 'var(--m-text)',
          padding: '9px 11px', border: '1px solid var(--m-border-strong)', borderRadius: 'var(--m-r-control)', background: 'white',
        }}
      >
        {children}
      </select>
    </div>
  )
}

/** בורר תקופה / פילטר טאבים. מחליף את הכפתורים של PeriodPicker. */
export function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--m-surface-hover)', border: '1px solid #e7ebef', borderRadius: 'var(--m-r-control)', padding: 3 }}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              background: active ? 'white' : 'transparent',
              color: active ? 'var(--m-text)' : '#64748b',
              fontWeight: active ? 700 : 500,
              border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5,
              fontFamily: 'inherit', cursor: 'pointer',
              boxShadow: active ? 'var(--m-shadow)' : 'none',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Tag({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'accent'; children: ReactNode }) {
  const map = {
    good:    ['var(--m-good-strong)', 'var(--m-good-tint)', 'var(--m-good-border)'],
    warn:    ['var(--m-warn-strong)', 'var(--m-warn-tint)', 'var(--m-warn-border)'],
    bad:     ['var(--m-bad-strong)',  'var(--m-bad-tint)',  'var(--m-bad-border)'],
    neutral: ['var(--m-text-3)',      'var(--m-surface-hover)', '#e2e8f0'],
    accent:  ['var(--m-accent-text)', 'var(--m-accent-tint)', 'var(--m-accent-border)'],
  }[tone]
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: map[0], background: map[1], border: `1px solid ${map[2]}`, borderRadius: 'var(--m-r-tag)', padding: '3px 9px' }}>
      {children}
    </span>
  )
}

export function Card({ title, subtitle, actions, children, pad = true }: {
  title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; pad?: boolean
}) {
  return (
    <div style={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 'var(--m-r-card)', overflow: 'hidden' }}>
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '15px 20px 12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--m-fs-card)', fontWeight: 800, color: 'var(--m-text)' }}>{title}</span>
          {subtitle && <span style={{ fontSize: 12.5, color: '#94a3b8' }}>{subtitle}</span>}
          <div style={{ flex: 1 }} />
          {actions}
        </div>
      )}
      <div style={{ padding: pad ? (title ? '0 20px 18px' : '18px 20px') : 0 }}>{children}</div>
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 'var(--m-fs-label)', fontWeight: 800, color: 'var(--m-text-faint)', letterSpacing: '.05em' }}>{children}</div>
}
