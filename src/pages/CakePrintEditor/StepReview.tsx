import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Download, Printer, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EditorCanvasHandle } from './EditorCanvas'
import { buildExportFilename, downloadDataUrl } from './exportToPng'
import { PRINT_STYLES } from './printStyles'
import type { WizardState, WizardAction } from './types'

const EditorCanvas = lazy(() => import('./EditorCanvas'))

interface Props {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

export default function StepReview({ state, dispatch }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<EditorCanvasHandle | null>(null)
  const [displayWidth, setDisplayWidth] = useState(560)
  const [printDataUrl, setPrintDataUrl] = useState<string | null>(null)

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

  function handleDownload() {
    const url = canvasRef.current?.exportPng()
    if (!url || !state.preset) return
    downloadDataUrl(url, buildExportFilename(state.preset))
  }

  function handlePrint() {
    const url = canvasRef.current?.exportPng()
    if (!url) return
    setPrintDataUrl(url)
    // Wait one frame so the hidden img mounts before window.print().
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print()
      })
    })
  }

  return (
    <div dir="rtl" style={{ maxWidth: 720, margin: '0 auto', padding: '20px 24px' }}>
      <style>{PRINT_STYLES}</style>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
          סקירה אחרונה
        </h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          A4 · 210×297 מ"מ · 300 DPI
        </p>
      </div>

      <div ref={wrapRef} style={{ marginBottom: 18 }}>
        <Suspense fallback={<CanvasFallback width={displayWidth} />}>
          <EditorCanvas
            ref={canvasRef}
            state={state}
            dispatch={dispatch}
            mode="preview"
            displayWidth={displayWidth}
          />
        </Suspense>
      </div>

      <div style={{
        background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
        padding: '10px 14px', fontSize: 13, color: '#92400e', marginBottom: 16,
      }}>
        💡 ודא/י "גודל מקורי / 100%" בדיאלוג ההדפסה
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <Button onClick={handleDownload} style={{ background: '#6366f1', color: 'white', display: 'flex', gap: 8 }}>
          <Download size={16} /> הורד PNG
        </Button>
        <Button onClick={handlePrint} style={{ background: '#0f172a', color: 'white', display: 'flex', gap: 8 }}>
          <Printer size={16} /> הדפס
        </Button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="outline" onClick={() => dispatch({ type: 'go_step', step: 4 })} style={{ display: 'flex', gap: 6 }}>
          <Edit3 size={14} /> חזור לעריכת טקסט
        </Button>
        <Button variant="outline" onClick={() => dispatch({ type: 'go_step', step: 3 })} style={{ display: 'flex', gap: 6 }}>
          <Edit3 size={14} /> חזור לתמונה
        </Button>
      </div>

      {/* Print target — populated only when "הדפס" is clicked */}
      {printDataUrl && (
        <div id="cake-print-target" style={{ display: 'none' }}>
          <img src={printDataUrl} style={{ width: '210mm', height: '297mm', display: 'block' }} alt="" />
        </div>
      )}
    </div>
  )
}

function CanvasFallback({ width }: { width: number }) {
  const h = (width / 2480) * 3508
  return (
    <div style={{ width, height: h, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
      טוען עורך...
    </div>
  )
}
