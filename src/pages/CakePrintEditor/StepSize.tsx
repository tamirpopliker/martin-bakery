import { SIZE_PRESETS } from './presets'
import type { WizardAction, SizePresetKey } from './types'

interface Props {
  dispatch: React.Dispatch<WizardAction>
}

const ICONS: Record<SizePresetKey, string> = {
  round_medium: '⬤',
  round_large:  '⬤',
  square_20:    '▣',
  rect_full:    '▭',
}

const SUBTITLES: Record<SizePresetKey, string> = {
  round_medium: 'עוגה בינונית',
  round_large:  'עוגה גדולה',
  square_20:    'ריבועית',
  rect_full:    'גיליון שלם',
}

export default function StepSize({ dispatch }: Props) {
  function pick(key: SizePresetKey) {
    dispatch({ type: 'set_preset', preset: key })
    dispatch({ type: 'next_step' })
  }

  return (
    <div dir="rtl" style={{ maxWidth: 560, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>
          באיזה גודל העוגה?
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
          התמונה תיחתך אוטומטית לגודל שתבחר/י
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {(Object.keys(SIZE_PRESETS) as SizePresetKey[]).map(key => {
          const p = SIZE_PRESETS[key]
          return (
            <button
              key={key}
              type="button"
              onClick={() => pick(key)}
              style={{
                background: 'white',
                border: '2px solid #e2e8f0',
                borderRadius: 14,
                padding: '24px 16px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1'
                ;(e.currentTarget as HTMLButtonElement).style.background = '#f5f3ff'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#e2e8f0'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'white'
              }}
            >
              <div style={{ fontSize: 38, lineHeight: 1, color: '#6366f1' }}>{ICONS[key]}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{p.label}</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>{SUBTITLES[key]}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
