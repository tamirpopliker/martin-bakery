// The agent panel — full screen on mobile, side drawer on desktop.
//
// Stage 5: typing only. The microphone button lands in stage 6 in the
// composer row below.
//
// See AGENT_PLAN.md sections 9.1 (mobile-first) and 11 (stage 5).

import { useEffect, useRef, useState } from 'react'
import { useAgent, type AgentMessage } from './useAgent'
import { useVoiceInput } from './useVoiceInput'
import MicButton from './MicButton'
import ConfirmationCard from './ConfirmationCard'

const SUGGESTIONS = [
  'כמה פחת היה החודש בהפועלים?',
  'מה ההכנסות של אברהם אבינו החודש?',
  'תרשום פחת של 200 שקל אתמול בהפועלים',
]

export default function AgentSheet({ onClose }: { onClose: () => void }) {
  const { messages, pending, busy, send, reset, resolve } = useAgent()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Speech goes straight through. A mis-heard read costs nothing, and a
  // mis-heard write is caught by the confirmation card before it lands.
  const voice = useVoiceInput((text) => send(text, true))
  const recording = voice.state === 'recording' || voice.state === 'cancelling'

  // While a write is awaiting approval the microphone is unavailable —
  // approval is a tap, never a spoken word.
  const locked = !!pending

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit() {
    const t = draft.trim()
    if (!t || busy) return
    setDraft('')
    send(t)
    inputRef.current?.focus()
  }

  return (
    // z-[400] beats the mobile bottom nav (z-300) so the sheet covers it
    // completely — otherwise the nav sits on top of the composer.
    <div className="fixed inset-0 z-[400] flex md:justify-start" dir="rtl">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative flex h-full w-full flex-col bg-white shadow-2xl md:h-full md:w-[440px]">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white">
            <MicIcon />
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-medium text-slate-900">עוזר מרטין</div>
            <div className="text-xs text-slate-500">החזק את המיקרופון ודבר</div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={reset}
              className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              שיחה חדשה
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="סגור"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <CloseIcon />
          </button>
        </div>

        {/* messages */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="pt-6">
              <p className="text-center text-sm text-slate-400">
                החזק את המיקרופון ושאל על פחת, הכנסות,<br />הוצאות או קופת עודף
              </p>
              <div className="mt-5 space-y-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-right text-[13px] text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => <Bubble key={i} m={m} />)}

          {pending && (
            <ConfirmationCard
              pending={pending}
              busy={busy}
              onConfirm={() => resolve(true)}
              onReject={() => resolve(false)}
            />
          )}

          {busy && !pending && (
            <div className="flex gap-1.5 px-1 py-2">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* composer — pb clears the iOS/Android home indicator */}
        <div
          className="border-t border-slate-200 px-3 pt-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          {voice.error && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
              <span className="flex-1">{voice.error}</span>
              <button onClick={voice.clearError} className="text-rose-400 hover:text-rose-700">✕</button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <MicButton
              state={voice.state}
              level={voice.level}
              seconds={voice.seconds}
              disabled={busy || locked}
              onStart={voice.start}
              onMove={voice.move}
              onEnd={voice.end}
            />

            {recording ? (
              <div className="flex h-11 flex-1 items-center rounded-2xl bg-indigo-50 px-4 text-[15px] text-indigo-700">
                {voice.state === 'cancelling' ? 'שחרר לביטול' : 'מקשיב…'}
              </div>
            ) : (
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                }}
                rows={1}
                placeholder={
                  locked ? 'אשר או בטל את הפעולה למעלה'
                  : voice.state === 'transcribing' ? 'מתמלל…'
                  : 'החזק את המיקרופון או כתוב…'
                }
                disabled={voice.state === 'transcribing' || locked}
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 px-4 py-2.5 text-[15px] outline-none focus:border-indigo-400 disabled:bg-slate-50"
              />
            )}

            <button
              onClick={submit}
              disabled={!draft.trim() || busy || recording || locked}
              aria-label="שלח"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition disabled:bg-slate-200 disabled:text-slate-400"
            >
              <SendIcon />
            </button>
          </div>

          <p className="mt-2 text-center text-[11px] text-slate-400">
            כל רישום דורש אישור בלחיצה
          </p>
        </div>
      </div>
    </div>
  )
}

function Bubble({ m }: { m: AgentMessage }) {
  const [showTrace, setShowTrace] = useState(false)
  const isUser = m.role === 'user'

  return (
    <div className={isUser ? 'flex justify-start' : 'flex justify-end'}>
      <div className={`max-w-[85%] ${isUser ? '' : 'w-full'}`}>
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-tr-sm bg-indigo-600 px-3.5 py-2.5 text-[15px] leading-relaxed text-white'
              : m.error
                ? 'rounded-2xl rounded-tl-sm bg-rose-50 px-3.5 py-2.5 text-[15px] leading-relaxed text-rose-900'
                : m.done
                  ? 'rounded-2xl rounded-tl-sm bg-emerald-50 px-3.5 py-2.5 text-[15px] leading-relaxed text-emerald-900'
                  : 'rounded-2xl rounded-tl-sm bg-slate-100 px-3.5 py-2.5 text-[15px] leading-relaxed text-slate-800'
          }
        >
          {m.summaryOf && (
            <div className={`mb-1 text-[12px] ${m.done ? 'text-emerald-700/70' : 'text-slate-500'}`}>
              {m.summaryOf}
            </div>
          )}
          <div className="whitespace-pre-wrap">
            {m.done && '✓ '}{m.content}
          </div>
        </div>

        {!!m.trace?.length && (
          <div className="mt-1 px-1">
            <button
              onClick={() => setShowTrace((v) => !v)}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              {showTrace ? 'הסתר' : `${m.trace.length} שאילתות`}
            </button>
            {showTrace && (
              <div className="mt-1 space-y-0.5">
                {m.trace.map((t, i) => (
                  <div key={i} className="font-mono text-[11px] text-slate-400">
                    {t.ok ? '✓' : '✗'} {t.tool} · {t.ms}ms
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── icons ── */

function MicIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  )
}
