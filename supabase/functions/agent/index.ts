// ═══════════════════════════════════════════════════════════════════════
// agent — the reasoning half of the voice agent.
//
// Stage 4: READ ONLY. Every tool in the catalogue is a SELECT. There is no
// path from this function to an INSERT or UPDATE. Writes arrive in stage 7
// behind the confirmation mechanism, and until then the worst a
// misunderstanding can do is put a wrong number on the screen.
//
// That is deliberate: it buys a window where the agent can be talked to all
// day, its comprehension tuned, and mistakes cost nothing.
//
// POST { messages, context } → { reply, trace, usage }
//
// See AGENT_PLAN.md sections 9, 10, 11 (stage 4).
// ═══════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { authenticateAgentRequest, corsHeaders, json } from '../_shared/agentAuth.ts'
import { TOOL_BY_NAME, toolsFor } from '../_shared/agentTools.ts'

const MODEL = 'claude-sonnet-5'
const MAX_TOOL_ROUNDS = 6
const MAX_MESSAGES = 40

interface AgentContext {
  currentPage?: string
  period?: { from?: string; to?: string; monthKey?: string }
  selectedBranch?: number | null
  today?: string
}

function buildSystemPrompt(userName: string, ctx: AgentContext, todayFallback: string): string {
  const today = ctx.today || todayFallback
  const lines = [
    'אתה עוזר תפעולי של קונדיטוריית מרטין — מפעל ושלושה סניפים. אתה עונה בעברית בלבד.',
    '',
    '## ההקשר הנוכחי',
    `המשתמש: ${userName} (מנהל מערכת — רואה את כל הסניפים).`,
    `התאריך היום: ${today}.`,
  ]
  if (ctx.currentPage) lines.push(`המסך שהמשתמש נמצא בו: ${ctx.currentPage}.`)
  if (ctx.selectedBranch != null) lines.push(`הסניף שנבחר במסך: ${ctx.selectedBranch}.`)
  if (ctx.period?.from && ctx.period?.to) {
    lines.push(`התקופה שנבחרה במסך: מ-${ctx.period.from} עד ${ctx.period.to} (הסוף לא כולל).`)
  }

  lines.push(
    '',
    '## כללים',
    '',
    '**הקלט הגיע מדיבור.** התמלול עלול לשבש מילים. אם שם או מונח נשמע מוזר, נסה להתאים אותו למה שקיים במערכת לפני שאתה מוותר. אם המשפט לא ברור — שאל, אל תנחש.',
    '',
    '**אל תנחש מספרים, תאריכים או סניפים.** אם חסר פרט — שאל שאלה קצרה. עדיף שאלה אחת מאשר תשובה שגויה.',
    '',
    '**סניף.** המשתמש רואה את כל הסניפים ואין לו סניף ברירת מחדל. אם הסניף לא ברור מההקשר של המסך — קרא ל-get_branches ושאל באיזה סניף מדובר.',
    '',
    `**תאריכים.** "אתמול", "שלשום", "החודש שעבר" מחושבים מ-${today}. טווחים תמיד ניתנים כ-from כולל ו-to לא כולל: חודש אוגוסט 2026 הוא from=2026-08-01, to=2026-09-01.`,
    '',
    '**אל תחשב מספרים בעצמך.** אל תסכם, תחלק או תחשב אחוזים בראש. קרא לכלי המתאים והשתמש במה שהוא החזיר. מספר שתמציא לא יתאים למה שמופיע בדשבורד, וזו התקלה הגרועה ביותר שיכולה לקרות כאן.',
    '',
    '**מע"מ.** סכומי המכירות המאוחסנים הם נטו (18% מע"מ כבר הופחת). אם המשתמש שואל על סכום ברוטו — אמור במפורש איזה מהם אתה מציג.',
    '',
    '**קיצור.** התשובות נקראות על מסך טלפון. משפט או שניים. מספרים ברורים, בלי הקדמות.',
    '',
    '**משימה אחת בכל פעם.** אם התבקשו כמה דברים — טפל בראשון ושאל אם להמשיך.',
    '',
    '## מה אתה לא יכול לעשות כרגע',
    'אתה יכול רק **לקרוא** נתונים. אינך יכול לרשום פחת, הוצאה, סגירת קופה או הזמנה, ואינך יכול לשנות או למחוק דבר. אם מתבקשת פעולת כתיבה — הסבר בפשטות שיכולת הרישום עדיין לא הופעלה, ושכרגע אתה יכול לענות על שאלות בלבד. אל תעמיד פנים שביצעת משהו.',
  )
  return lines.join('\n')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await authenticateAgentRequest(req)
  if (!auth.ok) return json({ error: auth.error }, auth.status)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.error('[agent] missing ANTHROPIC_API_KEY')
    return json({ error: 'הסוכן אינו מוגדר' }, 500)
  }

  let body: { messages?: unknown; context?: AgentContext }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'בקשה לא תקינה' }, 400)
  }

  const incoming = Array.isArray(body.messages) ? body.messages : []
  if (!incoming.length) return json({ error: 'לא התקבלה הודעה' }, 400)
  if (incoming.length > MAX_MESSAGES) {
    return json({ error: 'השיחה ארוכה מדי, פתח שיחה חדשה' }, 400)
  }

  const ctx = body.context ?? {}
  const todayFallback = new Date().toISOString().slice(0, 10)
  const system = buildSystemPrompt(auth.user.name || auth.user.email, ctx, todayFallback)
  const tools = toolsFor(auth.user)

  // deno-lint-ignore no-explicit-any
  const messages: any[] = [...incoming]
  const trace: Array<{ tool: string; args: unknown; ok: boolean; ms: number }> = []
  let inputTokens = 0
  let outputTokens = 0

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          system,
          tools,
          messages,
        }),
      })

      if (!res.ok) {
        const detail = await res.text()
        console.error(`[agent] anthropic ${res.status}: ${detail.slice(0, 500)}`)
        if (res.status === 429) return json({ error: 'הסוכן עמוס, נסה שוב בעוד רגע' }, 503)
        return json({ error: 'הסוכן נתקל בתקלה' }, 502)
      }

      const reply = await res.json()
      inputTokens += reply.usage?.input_tokens ?? 0
      outputTokens += reply.usage?.output_tokens ?? 0

      const toolUses = (reply.content ?? []).filter((c: { type: string }) => c.type === 'tool_use')

      if (!toolUses.length || reply.stop_reason !== 'tool_use') {
        const text = (reply.content ?? [])
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text)
          .join('\n')
          .trim()

        console.log(`[agent] ${auth.user.email} · ${trace.length} tools · ${inputTokens}/${outputTokens} tok`)
        return json({
          reply: text || 'לא הצלחתי לנסח תשובה. נסה לשאול אחרת.',
          trace,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        })
      }

      messages.push({ role: 'assistant', content: reply.content })

      const results = []
      for (const use of toolUses) {
        const tool = TOOL_BY_NAME.get(use.name)
        const t0 = Date.now()

        // Re-check authorisation with the ACTUAL arguments. The catalogue was
        // filtered before Claude saw it, but a model can still emit a call for
        // a tool it was not given.
        if (!tool || !tool.allowedRoles.includes(auth.user.role)) {
          trace.push({ tool: use.name, args: use.input, ok: false, ms: 0 })
          results.push({
            type: 'tool_result', tool_use_id: use.id, is_error: true,
            content: 'הכלי אינו זמין',
          })
          continue
        }

        // Belt and braces: stage 4 is read-only by construction, but if a
        // mutating tool is ever added to this catalogue by mistake, it stops here.
        if (tool.mutates) {
          trace.push({ tool: use.name, args: use.input, ok: false, ms: 0 })
          results.push({
            type: 'tool_result', tool_use_id: use.id, is_error: true,
            content: 'פעולות כתיבה אינן מופעלות בשלב זה',
          })
          continue
        }

        try {
          const out = await tool.run(use.input ?? {}, { db: auth.db, user: auth.user })
          trace.push({ tool: use.name, args: use.input, ok: true, ms: Date.now() - t0 })
          results.push({
            type: 'tool_result', tool_use_id: use.id,
            content: JSON.stringify(out),
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'שגיאה'
          console.warn(`[agent] tool ${use.name} failed: ${msg}`)
          trace.push({ tool: use.name, args: use.input, ok: false, ms: Date.now() - t0 })
          results.push({
            type: 'tool_result', tool_use_id: use.id, is_error: true,
            content: msg,
          })
        }
      }

      messages.push({ role: 'user', content: results })
    }

    return json({
      reply: 'לא הצלחתי להגיע לתשובה. נסה לנסח את השאלה בצורה ממוקדת יותר.',
      trace,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    })
  } catch (e) {
    console.error('[agent] unexpected:', e)
    return json({ error: 'הסוכן נתקל בתקלה' }, 500)
  }
})
