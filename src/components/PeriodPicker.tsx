import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { computePeriod, type PeriodRange, type PeriodType } from '../lib/period'

interface Props {
  period: PeriodRange
  onChange: (p: PeriodRange) => void
}

// ─── Preset definitions ─────────────────────────────────────────────────────
interface Preset {
  type: PeriodType
  label: string
  group: number // for visual separators
}

const PRESETS: Preset[] = [
  { type: 'month',              label: 'החודש הנוכחי',       group: 0 },
  { type: 'last_month',         label: 'חודש שעבר',         group: 0 },
  { type: 'this_week',          label: 'השבוע',             group: 1 },
  { type: 'last_week',          label: 'שבוע שעבר',         group: 1 },
  { type: 'quarter',            label: 'רבעון נוכחי',       group: 2 },
  { type: 'quarter_last_year',  label: 'רבעון מקביל אשתקד', group: 2 },
  { type: 'year',               label: 'שנה נוכחית',        group: 3 },
  { type: 'last_year',          label: 'שנה שעברה',         group: 3 },
]

// ─── Component ──────────────────────────────────────────────────────────────
export default function PeriodPicker({ period, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const isLastMonth = period.type === 'last_month'

  function selectPreset(type: PeriodType) {
    onChange(computePeriod(type))
    setOpen(false)
  }

  function handleCustomMonth(val: string) {
    if (!val) return
    onChange(computePeriod('custom_month', val))
    setOpen(false)
  }

  // Determine the month value for the custom input
  const customMonthValue = period.type === 'custom_month' ? (period.customMonth || '') : ''

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: "'Segoe UI', Arial, sans-serif" }}>

      {/* ─── Quick button: חודש שעבר ─────────────────────────────────── */}
      <button
        onClick={() => {
          if (isLastMonth) {
            onChange(computePeriod('month'))
          } else {
            onChange(computePeriod('last_month'))
          }
        }}
        style={{
          background: isLastMonth ? '#3b82f6' : '#f1f5f9',
          color: isLastMonth ? 'white' : '#64748b',
          border: isLastMonth ? '1.5px solid #3b82f6' : '1.5px solid #e2e8f0',
          borderRadius: '10px',
          padding: '7px 14px',
          fontSize: '13px',
          fontWeight: '600',
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        חודש שעבר
      </button>

      {/* ─── Period label + dropdown trigger ──────────────────────────── */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'white',
          border: '1.5px solid #e2e8f0',
          borderRadius: '10px',
          padding: '7px 12px',
          fontSize: '13px',
          fontWeight: '700',
          color: '#0f172a',
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        {period.label}
        <ChevronDown
          size={14}
          color="#94a3b8"
          style={{
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>

      {/* ─── Dropdown panel ──────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          background: 'white',
          borderRadius: '14px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
          border: '1px solid #e2e8f0',
          zIndex: 100,
          minWidth: '260px',
          overflow: 'hidden',
        }}>
          {PRESETS.map((preset, i) => {
            const computed = computePeriod(preset.type)
            const isActive =
              period.type === preset.type ||
              (period.type === 'custom_month' && preset.type === 'month' && period.monthKey === computePeriod('month').monthKey) ||
              (period.type === 'custom_month' && preset.type === 'last_month' && period.monthKey === computePeriod('last_month').monthKey)
            const showSep = i > 0 && PRESETS[i - 1].group !== preset.group

            return (
              <div key={preset.type}>
                {showSep && <div style={{ height: '1px', background: '#e2e8f0' }} />}
                <button
                  onClick={() => selectPreset(preset.type)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    background: isActive ? '#eff6ff' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'right',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f8fafc' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: isActive ? '#3b82f6' : '#e2e8f0',
                      border: isActive ? '2px solid #3b82f6' : '2px solid #cbd5e1',
                      flexShrink: 0,
                    }} />
                    <span style={{
                      fontSize: '13px',
                      fontWeight: isActive ? '700' : '500',
                      color: isActive ? '#1e40af' : '#374151',
                    }}>
                      {preset.label}
                    </span>
                  </div>
                  <span style={{
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontWeight: '500',
                  }}>
                    {computed.label}
                  </span>
                </button>
              </div>
            )
          })}

          {/* ─── Custom month input ────────────────────────────────── */}
          <div style={{ height: '1px', background: '#e2e8f0' }} />
          <div style={{ padding: '10px 16px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', marginBottom: '6px' }}>
              חודש ספציפי
            </div>
            <input
              type="month"
              value={customMonthValue}
              onChange={e => handleCustomMonth(e.target.value)}
              style={{
                width: '100%',
                border: '1.5px solid #e2e8f0',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '13px',
                fontFamily: 'inherit',
                background: '#f8fafc',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
