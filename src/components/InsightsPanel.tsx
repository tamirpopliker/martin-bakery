import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Lightbulb, TrendingUp, Users, Trash2, DollarSign } from 'lucide-react'
import type { InsightsSummary, EntityInsights, MetricStatus, Severity, MetricKey } from '../lib/branchInsights'

const SEVERE = '#c8413f'
const WARN = '#b8742a'
const OK = '#2f8a64'
const INK = '#0b1424'
const INK2 = '#475569'
const INK3 = '#8b95a8'

const SEV_BG: Record<Severity, string> = {
  severe: '#fef6f6', warn: '#fef9f1', ok: '#f5f9f7', none: '#fafbfc',
}
const SEV_FG: Record<Severity, string> = {
  severe: SEVERE, warn: WARN, ok: OK, none: INK3,
}
const SEV_CHIP_BG: Record<Severity, string> = {
  severe: '#fdf3f3', warn: '#fdf6ec', ok: '#f0f7f3', none: '#f1f5f9',
}
const SEV_LABEL: Record<Severity, string> = {
  severe: 'חמור', warn: 'לתשומת לב', ok: 'תקין', none: 'אין מידע',
}

const METRIC_ICON: Record<MetricKey, React.ComponentType<{ size?: number }>> = {
  profit: DollarSign,
  labor: Users,
  waste: Trash2,
  revenue: TrendingUp,
}

interface Props {
  summary: InsightsSummary
}

export default function InsightsPanel({ summary }: Props) {
  const [open, setOpen] = useState(false)
  const { counts } = summary

  return (
    <>
      <button onClick={() => setOpen(true)} className="insights-bar-btn"
        style={{
          width: '100%', textAlign: 'right',
          background: 'white', border: '1px solid #eef1f6',
          borderRadius: 12, padding: '12px 18px',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 1px 1px rgba(15,23,42,0.03)',
          display: 'flex', alignItems: 'center', gap: 14,
          cursor: 'pointer', marginBottom: 16,
          fontFamily: 'inherit',
        }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
          background: counts.severe > 0 ? '#fdf3f3' : counts.warn > 0 ? '#fdf6ec' : '#f0f7f3',
          color: counts.severe > 0 ? SEVERE : counts.warn > 0 ? WARN : OK,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Lightbulb size={16} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 14, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>תובנות החודש</span>
          <div style={{ display: 'flex', gap: 12, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
            <CountChip n={counts.severe} color={SEVERE} label="חמור" />
            <CountChip n={counts.warn}   color={WARN}   label="לתשומת לב" />
            <CountChip n={counts.ok}     color={OK}     label="תקין" />
          </div>
        </div>
        <span style={{ color: INK3, fontSize: 18, lineHeight: 1 }}>‹</span>
      </button>

      <AnimatePresence>
        {open && <Modal summary={summary} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  )
}

function CountChip({ n, color, label }: { n: number; color: string; label: string }) {
  if (n === 0) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      <strong style={{ fontWeight: 700 }}>{n}</strong> {label}
    </span>
  )
}

function Modal({ summary, onClose }: { summary: InsightsSummary; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(11,20,36,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 16px', overflowY: 'auto',
      }}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: 12, opacity: 0, scale: 0.985 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 8, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0.9, 0.3, 1] }}
        style={{
          background: 'white', borderRadius: 18,
          boxShadow: '0 24px 48px -12px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.06)',
          width: '100%', maxWidth: 880,
          padding: '26px 28px 30px', direction: 'rtl',
        }}>
        <ModalHead onClose={onClose} hidden={summary.counts.noTarget} />
        {summary.spotlight && <Spotlight spotlight={summary.spotlight} />}
        <Chips counts={summary.counts} />
        <Grid entities={summary.entities} />
      </motion.div>
    </motion.div>
  )
}

function ModalHead({ onClose, hidden }: { onClose: () => void; hidden: number }) {
  const month = new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 22 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: INK }}>תובנות החודש</h2>
        <div style={{ fontSize: 13, color: INK3, marginTop: 4 }}>
          {month}
          {hidden > 0 && ` · ${hidden} מדדים ללא יעד הוסתרו`}
        </div>
      </div>
      <button onClick={onClose}
        style={{
          background: '#fafbfc', border: 'none', width: 32, height: 32, borderRadius: 8,
          cursor: 'pointer', color: INK2, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <X size={16} />
      </button>
    </div>
  )
}

function Spotlight({ spotlight }: { spotlight: NonNullable<InsightsSummary['spotlight']> }) {
  const { entity, metric, pctOfTarget } = spotlight
  // ring shows abs % of target (capped 100). negative pct → ring shows abs.
  const ringPct = Math.min(100, Math.max(0, pctOfTarget < 0 ? 100 + pctOfTarget : pctOfTarget))
  const dashTotal = 264   // 2*PI*42
  const dashOffset = dashTotal * (1 - ringPct / 100)
  const Icon = METRIC_ICON[metric.key]
  const valueText = pctOfTarget < 0 ? Math.abs(pctOfTarget).toFixed(0) + '%' : '0%'

  return (
    <div style={{
      background: 'linear-gradient(135deg, #fef6f6 0%, #ffffff 60%)',
      border: '1px solid #fdf3f3',
      borderRadius: 16, padding: '22px 24px', marginBottom: 14, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ width: 80, height: 80, position: 'relative', flexShrink: 0 }}>
          <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
            <circle fill="none" stroke="#f3eded" strokeWidth="9" cx="50" cy="50" r="42" />
            <circle fill="none" stroke={SEVERE} strokeWidth="9" strokeLinecap="round"
              cx="50" cy="50" r="42" strokeDasharray={dashTotal} strokeDashoffset={dashOffset} />
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: SEVERE, letterSpacing: '-0.02em' }}>{valueText}</div>
            <div style={{ fontSize: 9.5, color: INK3, marginTop: 1 }}>{pctOfTarget < 0 ? 'מתחת ליעד' : 'מהיעד'}</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: SEVERE,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: SEVERE }} />
            דורש תשומת לב מיידית
          </div>
          <div style={{ margin: '8px 0 4px', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: INK,
            display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon size={16} />
            {entity.entityName} · {metric.label}
          </div>
          <div style={{ fontSize: 13, color: INK2, lineHeight: 1.55, maxWidth: '56ch' }}>
            {metric.actualLabel} מתוך {metric.targetLabel} · פער {metric.deltaLabel}
          </div>
        </div>
      </div>
    </div>
  )
}

function Chips({ counts }: { counts: InsightsSummary['counts'] }) {
  return (
    <div style={{ display: 'flex', gap: 10, margin: '16px 0 18px', flexWrap: 'wrap' }}>
      {counts.severe > 0 && <Chip n={counts.severe} color={SEVERE} label="חמור" />}
      {counts.warn   > 0 && <Chip n={counts.warn}   color={WARN}   label="לתשומת לב" />}
      {counts.ok     > 0 && <Chip n={counts.ok}     color={OK}     label="תקין" />}
      {counts.noTarget > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px',
          fontSize: 12.5, fontWeight: 600, color: INK3 }}>
          {counts.noTarget} מדדים ללא יעד
        </span>
      )}
    </div>
  )
}

function Chip({ n, color, label }: { n: number; color: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '8px 14px', borderRadius: 999,
      fontSize: 12.5, fontWeight: 600, color: INK2, background: '#fafbfc',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      <strong style={{ color: INK, fontSize: 13 }}>{n}</strong> {label}
    </span>
  )
}

function Grid({ entities }: { entities: EntityInsights[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      {entities.map(e => <EntityCard key={String(e.entityId)} entity={e} />)}
    </div>
  )
}

function EntityCard({ entity }: { entity: EntityInsights }) {
  return (
    <div style={{
      background: 'white', borderRadius: 16, padding: '16px 18px 14px',
      border: '1px solid #eef1f6',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{entity.entityName}</div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11.5, fontWeight: 700,
          padding: '4px 10px 4px 8px', borderRadius: 999,
          color: SEV_FG[entity.worstSeverity],
          background: SEV_CHIP_BG[entity.worstSeverity],
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: SEV_FG[entity.worstSeverity] }} />
          {SEV_LABEL[entity.worstSeverity]}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {entity.metrics.map(m => <MetricTile key={m.key} m={m} />)}
      </div>
    </div>
  )
}

function MetricTile({ m }: { m: MetricStatus }) {
  const Icon = METRIC_ICON[m.key]
  const fg = SEV_FG[m.severity]
  return (
    <div style={{
      padding: '12px 12px 10px', borderRadius: 10,
      background: SEV_BG[m.severity],
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 600, marginBottom: 6,
        color: m.severity === 'none' ? INK3 : fg,
        opacity: m.severity === 'none' ? 1 : 0.85,
      }}>
        <Icon size={13} />
        {m.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{
          fontSize: 16, fontWeight: 700, letterSpacing: '-0.025em',
          fontVariantNumeric: 'tabular-nums',
          color: m.severity === 'none' ? INK : fg,
        }}>{m.actualLabel}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: m.severity === 'none' ? INK3 : fg,
        }}>{m.deltaLabel}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: INK3, fontVariantNumeric: 'tabular-nums' }}>
        {m.targetLabel}
      </div>
    </div>
  )
}
