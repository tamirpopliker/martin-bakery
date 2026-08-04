// Press and hold to speak. Release to send. Drag up to cancel.
//
// The WhatsApp pattern, on purpose — zero learning curve.
// See AGENT_PLAN.md section 8.1.

import type { VoiceState } from './useVoiceInput'

interface Props {
  state: VoiceState
  level: number
  seconds: number
  disabled?: boolean
  onStart: (clientY: number) => void
  onMove: (clientY: number) => void
  onEnd: () => void
}

export default function MicButton({ state, level, seconds, disabled, onStart, onMove, onEnd }: Props) {
  const recording = state === 'recording' || state === 'cancelling'
  const cancelling = state === 'cancelling'
  const busy = state === 'transcribing'

  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-label="החזק כדי לדבר"
      onPointerDown={(e) => {
        if (disabled || busy) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        onStart(e.clientY)
      }}
      onPointerMove={(e) => onMove(e.clientY)}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onContextMenu={(e) => e.preventDefault()}
      className={[
        'relative flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full transition-colors',
        cancelling ? 'bg-rose-600 text-white'
          : recording ? 'bg-indigo-600 text-white'
          : busy ? 'bg-slate-200 text-slate-400'
          : 'bg-slate-100 text-slate-600 active:bg-slate-200',
      ].join(' ')}
      style={{ touchAction: 'none' }}
    >
      {/* live level ring */}
      {recording && (
        <span
          className={`absolute inset-0 rounded-full ${cancelling ? 'bg-rose-500/25' : 'bg-indigo-500/25'}`}
          style={{ transform: `scale(${1 + level * 0.7})`, transition: 'transform 80ms linear' }}
        />
      )}

      <span className="relative">
        {busy ? <Spinner /> : cancelling ? <TrashIcon /> : <MicIcon />}
      </span>

      {recording && (
        <span className="absolute -top-9 right-1/2 translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 px-2.5 py-1 text-[11px] text-white">
          {cancelling ? 'שחרר לביטול' : `${seconds}״ · גרור למעלה לביטול`}
        </span>
      )}
    </button>
  )
}

function MicIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}
