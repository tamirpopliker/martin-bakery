import { useRef, useState } from 'react'
import { Upload, AlertTriangle } from 'lucide-react'
import { uploadCakeImage } from './uploadImage'
import type { WizardAction } from './types'

interface Props {
  branchId: number
  dispatch: React.Dispatch<WizardAction>
}

export default function StepUpload({ branchId, dispatch }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function handleFile(file: File) {
    setError(null)
    setBusy(true)
    const res = await uploadCakeImage(branchId, file)
    setBusy(false)
    if (!res.success) {
      setError(res.error || 'העלאה נכשלה.')
      return
    }
    dispatch({
      type: 'set_image',
      src: res.url!,
      path: res.path!,
      naturalW: res.naturalW!,
      naturalH: res.naturalH!,
    })
    dispatch({ type: 'next_step' })
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div dir="rtl" style={{ maxWidth: 560, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>
          העלאת תמונה
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
          התמונה תודפס על נייר אכיל לעוגה
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = '' // allow re-selecting the same file
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          width: '100%',
          minHeight: 220,
          borderRadius: 16,
          border: `2px dashed ${dragOver ? '#6366f1' : '#cbd5e1'}`,
          background: dragOver ? '#eef2ff' : '#f8fafc',
          cursor: busy ? 'wait' : 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          transition: 'all 0.15s',
          color: '#475569',
        }}
      >
        {busy ? (
          <div style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>מעלה...</div>
        ) : (
          <>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Upload size={28} color="#6366f1" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              לחץ/י לבחירה או גרור/י לכאן
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              JPG / PNG / WEBP · עד 15MB
            </div>
          </>
        )}
      </button>

      {error && (
        <div style={{
          marginTop: 16, padding: '12px 14px', borderRadius: 10,
          background: '#fef2f2', border: '1px solid #fecaca',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: '#b91c1c', lineHeight: 1.5 }}>{error}</div>
        </div>
      )}
    </div>
  )
}
