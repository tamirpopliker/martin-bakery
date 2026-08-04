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
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
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
    '## מה אתה יכול לעשות',
    '',
    '**קריאה** — פחת, הכנסות, הוצאות, סגירות קופה, יתרת קופת עודף.',
    '',
    '**כתיבה — פחת** (`add_branch_waste`), **הוצאות** (`add_branch_expense`) **וקופת עודף** (`add_change_fund_movement`).',
    '',
    'קריאה לכלי כתיבה **אינה מבצעת** את הפעולה. היא מייצרת כרטיס אישור שמוצג למשתמש, ובו הסניף, התאריך, הסכום בפונט גדול, ואזהרות אוטומטיות — כולל על סכום חריג, תאריך רחוק, ורישום כפול. המשתמש מאשר או מבטל בלחיצה.',
    '',
    '**לכן — לעולם אל תבקש אישור בטקסט לפני שאתה קורא לכלי.** אל תכתוב "לאשר?", "האם לרשום?", "הסכום גבוה, לאשר?". הכרטיס עושה את זה טוב ממך, והשאלה שלך רק מוסיפה סבב מיותר.',
    '',
    '**סכום גדול אינו סיבה לשאול.** הכרטיס יזהיר לבד. גם תאריך ישן וגם רישום כפול — הכל מטופל בכרטיס.',
    '',
    'ברגע שיש לך **סניף, תאריך וסכום** — קרא לכלי מיד, בלי טקסט מקדים.',
    '',
    '**שאל רק על פרט שבאמת חסר.** אם לא נאמר סניף ואי אפשר להסיק אותו מהשיחה — שאל על הסניף בלבד, במשפט קצר, ואל תוסיף לזה שאלות נוספות.',
    '',
    'ואל תכריז "רשמתי" — כשהפעולה תבוצע בפועל, המערכת תודיע על כך בעצמה.',
    '',
    '**שם ספק** — מסור אותו כפי שנאמר. המערכת מתאימה אותו לשמות הקיימים בסניף, כך שאין צורך שתדע את האיות המדויק ואין צורך לשאול עליו.',
    '',
    '**קופת עודף** — הסכום תמיד חיובי, והכיוון נקבע לפי הסוג:',
    '· „הכניסו 300 לקופת העודף” → income',
    '· „הוצאתי 300 מקופת העודף” → expense',
    '· „משכתי 500 מקופת העודף לקופה 4” → withdraw_to_register עם register_number',
    '· „העברתי 500 מקופה 4 לקופת העודף” → push_from_register עם register_number',
    'משיכה ודחיפה מחייבות מספר קופה. אם לא נאמר — שאל עליו בלבד. אם אינך יודע אילו קופות יש בסניף, קרא ל-get_change_fund_balance והוא יחזיר את רשימתן.',
    '',
    '**הזמנת עוגה** (`create_special_order`) — משפט אחד יכול למלא את כל השדות. מסור כל ערך כפי שנאמר; המערכת מתאימה אותו לרשימה הסגורה, כך שאל תתקן ואל תתרגם בעצמך. אם חסרים שדות, הכלי יחזיר רשימה מלאה של מה שחסר — **שאל עליהם פעם אחת ביחד**, לא אחד-אחד.',
    '',
    'סגירת קופה **עדיין לא זמינה**. אם מתבקשת, אמור זאת בפשטות ואל תעמיד פנים שביצעת משהו.',
  )
  return lines.join('\n')
}

const CONFIRMATION_TTL_MS = 15 * 60 * 1000

/**
 * Executes or rejects a parked action.
 *
 * Every guard that matters lives here, because this is the only path that
 * writes: the row must belong to the caller, must still be pending, and must
 * not have expired. A row can only ever be consumed once — the status update
 * is conditional on it still being pending.
 */
async function resolveAction(
  auth: { user: { id: string; email: string; role: string }; db: SupabaseClient },
  actionId: string,
  reject: boolean,
): Promise<Response> {
  const { data: action, error } = await auth.db
    .from('agent_actions')
    .select('id, user_id, tool_name, tool_args, status, created_at')
    .eq('id', actionId)
    .maybeSingle()

  if (error || !action) return json({ error: 'הפעולה לא נמצאה' }, 404)
  if (action.user_id !== auth.user.id) return json({ error: 'הפעולה אינה שלך' }, 403)
  if (action.status !== 'pending_confirmation') {
    return json({ error: 'הפעולה כבר טופלה' }, 409)
  }
  if (Date.now() - Date.parse(action.created_at) > CONFIRMATION_TTL_MS) {
    await auth.db.from('agent_actions').update({ status: 'expired' }).eq('id', action.id)
    return json({ error: 'האישור פג. בקש את הפעולה מחדש.' }, 410)
  }

  if (reject) {
    await auth.db.from('agent_actions')
      .update({ status: 'rejected', executed_at: new Date().toISOString() })
      .eq('id', action.id).eq('status', 'pending_confirmation')
    return json({ reply: 'בוטל. לא נרשם כלום.' })
  }

  const tool = TOOL_BY_NAME.get(action.tool_name)
  if (!tool?.mutates || !tool.allowedRoles.includes(auth.user.role)) {
    return json({ error: 'הפעולה אינה זמינה' }, 403)
  }

  // Claim the row first. If this updates nothing, someone else already
  // consumed it and we must not write.
  const { data: claimed } = await auth.db
    .from('agent_actions')
    .update({ status: 'executed', executed_at: new Date().toISOString() })
    .eq('id', action.id).eq('status', 'pending_confirmation')
    .select('id')
  if (!claimed?.length) return json({ error: 'הפעולה כבר טופלה' }, 409)

  try {
    const out = await tool.run(
      (action.tool_args ?? {}) as Record<string, unknown>,
      { db: auth.db, user: auth.user as never },
    ) as { table?: string; id?: string; message?: string }

    await auth.db.from('agent_actions')
      .update({ result_table: out?.table ?? null, result_id: out?.id ?? null })
      .eq('id', action.id)

    console.log(`[agent] ${auth.user.email} executed ${action.tool_name} -> ${out?.id}`)
    return json({ reply: out?.message ?? 'בוצע.', executed: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'שגיאה'
    await auth.db.from('agent_actions')
      .update({ status: 'failed', error: msg })
      .eq('id', action.id)
    console.error(`[agent] ${action.tool_name} failed: ${msg}`)
    return json({ error: msg }, 500)
  }
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

  let body: {
    messages?: unknown
    context?: AgentContext
    conversation_id?: string
    transcript?: string
    input_mode?: string
    action_id?: string
    reject?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'בקשה לא תקינה' }, 400)
  }

  // ── Confirmation path ──
  // The client sends ONLY an id. Arguments are re-read from the database, so
  // what runs is exactly what was displayed and approved.
  if (body.action_id) {
    return await resolveAction(auth, body.action_id, body.reject === true)
  }

  const conversationId = typeof body.conversation_id === 'string' && body.conversation_id
    ? body.conversation_id
    : crypto.randomUUID()
  const transcript = typeof body.transcript === 'string' ? body.transcript : null
  const inputMode = body.input_mode === 'text' ? 'text' : 'voice'

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
  const usageOut = () => ({ input_tokens: inputTokens, output_tokens: outputTokens })

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

        // ── The stop. A write is never executed here. ──
        // It is summarised, parked, and handed to the user as a card. The
        // loop ends: one task at a time, and nothing happens without a tap.
        if (tool.mutates) {
          if (!tool.summarize) {
            console.error(`[agent] mutating tool ${tool.name} has no summarize()`)
            return json({ error: 'הפעולה אינה זמינה' }, 500)
          }
          try {
            const summary = await tool.summarize(use.input ?? {}, { db: auth.db, user: auth.user })
            trace.push({ tool: use.name, args: use.input, ok: true, ms: Date.now() - t0 })

            if (summary.blocker) {
              return json({ reply: summary.blocker, trace, usage: usageOut() })
            }

            const { data: action, error: insErr } = await auth.db
              .from('agent_actions')
              .insert({
                user_id: auth.user.id,
                conversation_id: conversationId,
                tool_name: tool.name,
                tool_args: use.input ?? {},
                status: 'pending_confirmation',
                summary_he: summary.title,
                transcript: transcript ?? null,
                input_mode: inputMode,
              })
              .select('id')
              .single()

            if (insErr) {
              console.error('[agent] agent_actions insert failed:', insErr.message)
              return json({ error: 'לא ניתן להכין את הפעולה לאישור' }, 500)
            }

            return json({
              reply: '',
              pending: {
                action_id: action.id,
                title: summary.title,
                fields: summary.fields,
                amount: summary.amount ?? null,
                warnings: summary.warnings,
              },
              trace,
              usage: usageOut(),
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'שגיאה'
            trace.push({ tool: use.name, args: use.input, ok: false, ms: Date.now() - t0 })
            results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: msg })
            continue
          }
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
