import { Suspense, useEffect, useRef, useState } from 'react'
import { RotateCw, RotateCcw, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import OrientationToggle from './OrientationToggle'
import EditorCanvas from './lazyEditorCanvas'
import type { WizardState, WizardAction } from './types'

interface Props {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

export default function StepFitImage({ state, dispatch }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [displayWidth, setDisplayWidth] = useState(560)

  useEffect(() => {
    function recompute() {
      if (!wrapRef.current) return
      const w = Math.min(wrapRef.current.clientWidth, 720)
      setDisplayWidth(Math.max(280, w))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [])

  function rotate(delta: number) {
    const next = (state.imageTransform.rotation + delta + 360) % 360
    dispatch({ type: 'update_image_transform', patch: { rotation: next } })
  }

  function setScale(scale: number) {
    dispatch({ type: 'update_image_transform', patch: { scale } })
  }

  return (
    <div dir="rtl" style={{ maxWidth: 720, margin: '0 auto', padding: '20px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
          התאמת התמונה
        </h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          גרור/י לזיזה · גלגל עכבר לזום
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <OrientationToggle orientation={state.orientation} dispatch={dispatch} size="sm" />
      </div>

      <div ref={wrapRef} style={{ marginBottom: 18 }}>
        <Suspense fallback={<CanvasFallback width={displayWidth} landscape={state.orientation === 'landscape'} />}>
          <EditorCanvas state={state} dispatch={dispatch} mode="fit" displayWidth={displayWidth} />
        </Suspense>
      </div>

      <div style={{
        display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'center',
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 16px',
        flexWrap: 'wrap', marginBottom: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>זום</span>
          <input
            type="range"
            min={50}
            max={400}
            step={5}
            value={Math.round(state.imageTransform.scale * 100)}
            onChange={e => setScale(Number(e.target.value) / 100)}
            style={{ flex: 1, accentColor: '#6366f1' }}
          />
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 600, minWidth: 38, textAlign: 'left' }}>
            {Math.round(state.imageTransform.scale * 100)}%
          </span>
        </div>

        <button
          type="button"
          onClick={() => rotate(-90)}
          title="סובב/י נגד כיוון השעון"
          style={iconBtn}
        ><RotateCcw size={16} /></button>
        <button
          type="button"
          onClick={() => rotate(90)}
          title="סובב/י עם כיוון השעון"
          style={iconBtn}
        ><RotateCw size={16} /></button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'reset_image_transform' })}
          title="אפס/י"
          style={iconBtn}
        ><Maximize2 size={16} /></button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <Button variant="outline" onClick={() => dispatch({ type: 'go_step', step: 2 })}>
          ← שינוי גודל
        </Button>
        <Button onClick={() => dispatch({ type: 'next_step' })} style={{ background: '#6366f1', color: 'white' }}>
          המשך לטקסט →
        </Button>
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 8,
  border: '1px solid #e2e8f0', background: 'white',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#475569',
}

function CanvasFallback({ width, landscape }: { width: number; landscape?: boolean }) {
  const h = landscape ? (width / 3508) * 2480 : (width / 2480) * 3508
  return (
    <div style={{ width, height: h, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
      טוען עורך...
    </div>
  )
}
