import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Calendar } from 'lucide-react'
import { computePeriod, type PeriodRange, type PeriodType } from '../lib/period'
import { Button } from '@/components/ui/button'

interface Props {
  period: PeriodRange
  onChange: (p: PeriodRange) => void
}

interface Preset {
  type: PeriodType
  label: string
  group: number
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

export default function PeriodPicker({ period, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  const customMonthValue = period.type === 'custom_month' ? (period.customMonth || '') : ''

  return (
    <div ref={ref} className="relative inline-flex items-center gap-2">

      {/* Quick toggle: חודש שעבר */}
      <Button
        variant={isLastMonth ? 'default' : 'outline'}
        size="sm"
        onClick={() => {
          if (isLastMonth) {
            onChange(computePeriod('month'))
          } else {
            onChange(computePeriod('last_month'))
          }
        }}
        className={`rounded-lg text-[13px] font-semibold ${isLastMonth ? 'bg-indigo-500 hover:bg-indigo-600 text-white' : ''}`}
      >
        חודש שעבר
      </Button>

      {/* Period label + dropdown trigger */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="rounded-lg gap-1.5 text-[13px] font-bold text-slate-800"
      >
        <Calendar size={14} className="text-slate-400" />
        {period.label}
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </Button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 bg-white/95 backdrop-blur-sm rounded-xl shadow-xl border border-slate-200 z-[100] min-w-[280px] overflow-hidden">
          {PRESETS.map((preset, i) => {
            const computed = computePeriod(preset.type)
            const isActive =
              period.type === preset.type ||
              (period.type === 'custom_month' && preset.type === 'month' && period.monthKey === computePeriod('month').monthKey) ||
              (period.type === 'custom_month' && preset.type === 'last_month' && period.monthKey === computePeriod('last_month').monthKey)
            const showSep = i > 0 && PRESETS[i - 1].group !== preset.group

            return (
              <div key={preset.type}>
                {showSep && <div className="h-px bg-slate-100 mx-3" />}
                <button
                  onClick={() => selectPreset(preset.type)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-right transition-colors duration-100
                    ${isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                  style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${isActive ? 'bg-indigo-500' : 'bg-slate-200'}`}
                    />
                    <span
                      className={`text-[13px] ${isActive ? 'font-bold text-indigo-700' : 'font-medium text-slate-600'}`}
                    >
                      {preset.label}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {computed.label}
                  </span>
                </button>
              </div>
            )
          })}

          {/* Custom month input */}
          <div className="h-px bg-slate-100 mx-3" />
          <div className="px-4 py-3">
            <div className="text-[11px] text-slate-400 font-semibold mb-2">
              חודש ספציפי
            </div>
            <input
              type="month"
              value={customMonthValue}
              onChange={e => handleCustomMonth(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all"
              style={{ fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
