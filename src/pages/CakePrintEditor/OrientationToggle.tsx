import type { Orientation, WizardAction } from './types'

interface Props {
  orientation: Orientation
  dispatch: React.Dispatch<WizardAction>
  size?: 'sm' | 'md'
}

export default function OrientationToggle({ orientation, dispatch, size = 'md' }: Props) {
  function set(o: Orientation) {
    if (o !== orientation) dispatch({ type: 'set_orientation', orientation: o })
  }

  const padX = size === 'sm' ? 12 : 18
  const padY = size === 'sm' ? 6 : 8
  const fontSize = size === 'sm' ? 12 : 13

  return (
    <div style={{ background: '#f1f5f9', padding: 4, borderRadius: 12, display: 'inline-flex', gap: 4 }}>
      <button
        type="button"
        onClick={() => set('portrait')}
        style={{
          padding: `${padY}px ${padX}px`,
          borderRadius: 9,
          border: 'none',
          background: orientation === 'portrait' ? 'white' : 'transparent',
          boxShadow: orientation === 'portrait' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
          fontSize,
          fontWeight: 700,
          color: orientation === 'portrait' ? '#0f172a' : '#64748b',
          cursor: 'pointer',
        }}
      >
        דף אנכי
      </button>
      <button
        type="button"
        onClick={() => set('landscape')}
        style={{
          padding: `${padY}px ${padX}px`,
          borderRadius: 9,
          border: 'none',
          background: orientation === 'landscape' ? 'white' : 'transparent',
          boxShadow: orientation === 'landscape' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
          fontSize,
          fontWeight: 700,
          color: orientation === 'landscape' ? '#0f172a' : '#64748b',
          cursor: 'pointer',
        }}
      >
        דף אופקי
      </button>
    </div>
  )
}
