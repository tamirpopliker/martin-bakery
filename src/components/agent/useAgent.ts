// Conversation state for the voice agent.
//
// Stage 5: text input only. The microphone lands in stage 6, and it feeds
// `send()` exactly the same way typing does — nothing here changes then.
//
// See AGENT_PLAN.md sections 9, 11 (stage 5).

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePeriod } from '../../lib/PeriodContext'
import type { PendingAction } from './ConfirmationCard'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  /** Tools the agent ran for this reply — shown collapsed, for trust and debugging. */
  trace?: Array<{ tool: string; ok: boolean; ms: number }>
  error?: boolean
  /** Set once the write has actually happened. */
  done?: boolean
  /** What the confirmation card showed, kept after the card is dismissed. */
  summaryOf?: string
}

const MAX_TURNS = 20

/**
 * Turns a thrown error into something a human can act on.
 *
 * supabase-js wraps non-2xx responses in a FunctionsHttpError whose message is
 * just "Edge Function returned a non-2xx status code" — the Hebrew reason the
 * server sent is inside `context`, and has to be read out of the Response.
 */
async function describeError(e: unknown): Promise<string> {
  const err = e as { message?: string; context?: Response }
  const msg = err?.message ?? ''

  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.'
  }

  try {
    if (err?.context && typeof err.context.json === 'function') {
      const body = await err.context.clone().json()
      if (body?.error) return body.error
    }
  } catch { /* body wasn't JSON */ }

  const status = err?.context?.status
  if (status === 401 || status === 403) return 'אין לך הרשאה לפעולה הזו.'
  if (status === 429 || status === 503) return 'השירות עמוס כרגע. נסה שוב בעוד רגע.'
  if (status === 504) return 'הבקשה ארכה יותר מדי. נסה לנסח קצר יותר.'
  if (status) return `השרת החזיר שגיאה (${status}). נסה שוב.`

  return msg ? `תקלה: ${msg}` : 'משהו השתבש. נסה שוב.'
}

export function useAgent() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const conversationRef = useRef<string>(crypto.randomUUID())
  // Mirrors of state, so conversation mode can read the outcome of a turn
  // without waiting for a re-render.
  const pendingRef = useRef<PendingAction | null>(null)
  const lastReplyRef = useRef<string>('')
  const { from, to, monthKey } = usePeriod()

  useEffect(() => { pendingRef.current = pending }, [pending])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setPending(null)
    setBusy(false)
    conversationRef.current = crypto.randomUUID()
  }, [])

  /**
   * Confirm or cancel a parked write. Only the id is sent — the server
   * re-reads the arguments, so what runs is exactly what was on the card.
   */
  const resolve = useCallback(async (confirm: boolean) => {
    if (!pending || busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('agent', {
        body: { action_id: pending.action_id, reject: !confirm },
      })
      if (error) throw error

      // Keep a one-line record of what was proposed, so the conversation
      // still shows it after the card is gone.
      const stub = `${pending.title}${pending.amount ? ` · ${pending.amount}` : ''}`
      pendingRef.current = null
      setPending(null)
      setMessages((m) => [...m, {
        role: 'assistant',
        content: data?.error ?? data?.reply ?? 'בוצע.',
        summaryOf: stub,
        error: !!data?.error,
        done: !data?.error && confirm,
      }])
    } catch (e) {
      const detail = await describeError(e)
      console.error('[agent] resolve failed:', e)
      setMessages((m) => [...m, {
        role: 'assistant',
        content: `${detail} שום דבר לא נרשם.`,
        error: true,
      }])
      setPending(null)
    } finally {
      setBusy(false)
    }
  }, [pending, busy])

  const send = useCallback(async (text: string, fromVoice = false) => {
    const clean = text.trim()
    if (!clean || busy) return

    if (messages.length >= MAX_TURNS * 2) {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: 'השיחה ארוכה. כדאי לפתוח שיחה חדשה כדי שאשאר מדויק.',
        error: true,
      }])
      return
    }

    const history = [...messages, { role: 'user' as const, content: clean }]
    setMessages(history)
    setBusy(true)

    try {
      const { data, error } = await supabase.functions.invoke('agent', {
        body: {
          // Only role+content go to the model; trace is display-only.
          messages: history.map(({ role, content }) => ({ role, content })),
          conversation_id: conversationRef.current,
          transcript: fromVoice ? clean : undefined,
          input_mode: fromVoice ? 'voice' : 'text',
          context: {
            period: { from, to, monthKey },
            today: new Date().toLocaleDateString('sv-SE'), // YYYY-MM-DD, local
          },
        },
      })

      if (error) throw error

      if (data?.error) {
        lastReplyRef.current = data.error
        setMessages((m) => [...m, { role: 'assistant', content: data.error, error: true }])
        return
      }

      const traceOut = data?.trace?.map((t: { tool: string; ok: boolean; ms: number }) => ({
        tool: t.tool, ok: t.ok, ms: t.ms,
      }))

      // A write was proposed — nothing has happened yet.
      if (data?.pending) {
        // Set the ref synchronously: conversation mode checks it the moment
        // this resolves, long before React re-renders.
        pendingRef.current = data.pending as PendingAction
        lastReplyRef.current = ''
        setPending(data.pending as PendingAction)
        if (data.reply) {
          setMessages((m) => [...m, { role: 'assistant', content: data.reply, trace: traceOut }])
        }
        return
      }

      const reply = data?.reply ?? 'לא התקבלה תשובה.'
      lastReplyRef.current = reply
      setMessages((m) => [...m, { role: 'assistant', content: reply, trace: traceOut }])
    } catch (e) {
      // "Something went wrong" is useless when the whole point of this phase
      // is finding out what breaks. Surface what we actually know.
      const detail = await describeError(e)
      console.error('[agent] send failed:', e)
      lastReplyRef.current = detail
      setMessages((m) => [...m, {
        role: 'assistant',
        content: detail,
        error: true,
      }])
    } finally {
      setBusy(false)
    }
  }, [messages, busy, from, to, monthKey])

  /**
   * Conversation-mode turn. Returns the reply to speak, or null when a
   * confirmation card opened — the caller must then shut the microphone.
   */
  const turn = useCallback(async (text: string): Promise<string | null> => {
    const before = pendingRef.current
    await send(text, true)
    // send() has already updated state; read through the ref to avoid a stale
    // closure over `pending`.
    if (pendingRef.current && pendingRef.current !== before) return null
    return lastReplyRef.current
  }, [send])

  return { messages, pending, busy, send, reset, resolve, turn }
}
