// Conversation state for the voice agent.
//
// Stage 5: text input only. The microphone lands in stage 6, and it feeds
// `send()` exactly the same way typing does — nothing here changes then.
//
// See AGENT_PLAN.md sections 9, 11 (stage 5).

import { useCallback, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePeriod } from '../../lib/PeriodContext'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  /** Tools the agent ran for this reply — shown collapsed, for trust and debugging. */
  trace?: Array<{ tool: string; ok: boolean; ms: number }>
  error?: boolean
}

const MAX_TURNS = 20

export function useAgent() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const { from, to, monthKey } = usePeriod()

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setBusy(false)
  }, [])

  const send = useCallback(async (text: string) => {
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
          context: {
            period: { from, to, monthKey },
            today: new Date().toLocaleDateString('sv-SE'), // YYYY-MM-DD, local
          },
        },
      })

      if (error) throw error

      if (data?.error) {
        setMessages((m) => [...m, { role: 'assistant', content: data.error, error: true }])
        return
      }

      setMessages((m) => [...m, {
        role: 'assistant',
        content: data?.reply ?? 'לא התקבלה תשובה.',
        trace: data?.trace?.map((t: { tool: string; ok: boolean; ms: number }) => ({
          tool: t.tool, ok: t.ok, ms: t.ms,
        })),
      }])
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setMessages((m) => [...m, {
        role: 'assistant',
        content: msg.includes('Failed to fetch')
          ? 'אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב.'
          : 'משהו השתבש. נסה שוב.',
        error: true,
      }])
    } finally {
      setBusy(false)
    }
  }, [messages, busy, from, to, monthKey])

  return { messages, busy, send, reset }
}
