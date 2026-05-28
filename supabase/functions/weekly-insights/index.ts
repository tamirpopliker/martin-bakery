// ═══════════════════════════════════════════════════════════════════════════
// weekly-insights — Monday-morning business-advisor agent
// ═══════════════════════════════════════════════════════════════════════════
// Runs every Monday at 10:00 IST (via pg_cron — see sql/050_schedule_weekly_insights.sql).
// Analyzes the PRIOR Sunday-Saturday week.
//
// For each entity (each active branch + factory + consolidated):
//   1. Call get_<entity>_weekly_metrics(period_start, period_end) RPC
//   2. Compute derived KPIs (labor %, waste %, controllable/operating profit)
//   3. Send a compact Hebrew prompt to Claude Haiku 4.5 with structured output
//   4. Upsert the response into weekly_insights
//
// Cost: ~$0.005/run × 4 runs/month ≈ ₪0.10/month.
// Manual trigger:
//   curl -X POST <fn-url>/weekly-insights -H "Authorization: Bearer <SERVICE_KEY>"
// With a specific week:
//   curl -X POST '<fn-url>/weekly-insights?period_end=2026-05-23'
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MODEL = 'claude-haiku-4-5'
const INPUT_COST_PER_MTOK = 1.00
const OUTPUT_COST_PER_MTOK = 5.00

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Today in Israel timezone
function todayInIsrael(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date()) // YYYY-MM-DD
}

// Day of week in Israel for a YYYY-MM-DD date (0=Sun, 6=Sat).
// We treat the date as midnight UTC and read the UTC day-of-week — for our
// week-boundary math the timezone offset doesn't change which calendar day
// the YYYY-MM-DD string represents.
function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay()
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Given a reference date, return the prior Sun-Sat week (Sat is the most
// recent Saturday strictly before the reference).
//   ref Monday  → last Sun..Sat ending 2 days ago
//   ref Sunday  → last Sun..Sat ending yesterday
//   ref Saturday → prior week (NOT today)
function previousWeek(refDate: string): { period_start: string; period_end: string } {
  const dow = dayOfWeek(refDate)
  const daysToLastSat = dow === 6 ? 7 : dow + 1
  const period_end = addDays(refDate, -daysToLastSat)
  const period_start = addDays(period_end, -6)
  return { period_start, period_end }
}

// ─── Derived KPIs ───────────────────────────────────────────────────────────

interface BranchMetrics {
  entity_type: 'branch'
  entity_id: number
  entity_name: string
  period_start: string
  period_end: string
  period_days: number
  proration_factor: number
  period: {
    revenue: number
    suppliers_internal: number
    suppliers_external: number
    labor_workers: number
    labor_managers_prorated: number
    labor_is_actual: boolean
    waste: number
    repairs: number
    deliveries: number
    infrastructure: number
    other_expenses: number
    fixed_costs_prorated: number
  }
  monthly_context: {
    manager_salary_full_month: number
    fixed_costs_full_month: number
    days_in_month: number
  }
  targets: { labor_pct: number; waste_pct: number }
}

interface FactoryMetrics {
  entity_type: 'factory'
  entity_id: null
  entity_name: string
  period_start: string
  period_end: string
  period_days: number
  proration_factor: number
  period: {
    revenue_external: number
    revenue_internal: number
    suppliers: number
    labor_workers: number
    labor_managers_prorated: number
    labor_is_actual: boolean
    waste: number
    repairs: number
    fixed_costs_prorated: number
  }
  monthly_context: {
    manager_salary_full_month: number
    fixed_costs_full_month: number
    days_in_month: number
  }
}

interface ConsolidatedMetrics {
  entity_type: 'consolidated'
  entity_id: null
  entity_name: string
  period_start: string
  period_end: string
  factory: FactoryMetrics
  branches: BranchMetrics[]
}

function pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : 0
}

function deriveBranchView(m: BranchMetrics) {
  const totalLabor = m.period.labor_workers + m.period.labor_managers_prorated
  const totalSuppliers = m.period.suppliers_internal + m.period.suppliers_external
  const variableCosts = totalSuppliers + totalLabor + m.period.repairs + m.period.deliveries + m.period.infrastructure + m.period.other_expenses
  const controllableProfit = m.period.revenue - variableCosts
  const operatingProfit = controllableProfit - m.period.fixed_costs_prorated
  return {
    שם: m.entity_name,
    תקופה: `${m.period_start} עד ${m.period_end} (${m.period_days} ימים)`,
    הכנסות_השבוע: Math.round(m.period.revenue),
    ספקים_פנימיים_מפעל: Math.round(m.period.suppliers_internal),
    ספקים_חיצוניים: Math.round(m.period.suppliers_external),
    אחוז_ספקים_מהכנסות: pct(totalSuppliers, m.period.revenue),
    לייבור_עובדים: Math.round(m.period.labor_workers),
    שכר_מנהל_פרורציה: Math.round(m.period.labor_managers_prorated),
    אחוז_לייבור_מהכנסות: pct(totalLabor, m.period.revenue),
    יעד_אחוז_לייבור: m.targets.labor_pct,
    סטטוס_נתוני_שכר: m.period.labor_is_actual ? 'מדויק (מפיירוןל אמיתי)' : 'משוער (אומדן שעתי)',
    פחת_שח: Math.round(m.period.waste),
    אחוז_פחת_מהכנסות: pct(m.period.waste, m.period.revenue),
    יעד_אחוז_פחת: m.targets.waste_pct,
    תיקונים: Math.round(m.period.repairs),
    משלוחים: Math.round(m.period.deliveries),
    תשתיות: Math.round(m.period.infrastructure),
    הוצאות_אחרות: Math.round(m.period.other_expenses),
    עלויות_קבועות_פרורציה: Math.round(m.period.fixed_costs_prorated),
    רווח_נשלט: Math.round(controllableProfit),
    אחוז_רווח_נשלט: pct(controllableProfit, m.period.revenue),
    רווח_תפעולי: Math.round(operatingProfit),
    אחוז_רווח_תפעולי: pct(operatingProfit, m.period.revenue),
    הקשר_חודשי: {
      שכר_מנהל_חודשי: Math.round(m.monthly_context.manager_salary_full_month),
      עלויות_קבועות_חודשיות: Math.round(m.monthly_context.fixed_costs_full_month),
      ימים_בחודש: m.monthly_context.days_in_month,
    },
  }
}

function deriveFactoryView(m: FactoryMetrics) {
  const revenue = m.period.revenue_external + m.period.revenue_internal
  const totalLabor = m.period.labor_workers + m.period.labor_managers_prorated
  const variableCosts = m.period.suppliers + totalLabor + m.period.repairs
  const controllableProfit = revenue - variableCosts
  const operatingProfit = controllableProfit - m.period.fixed_costs_prorated
  return {
    שם: m.entity_name,
    תקופה: `${m.period_start} עד ${m.period_end} (${m.period_days} ימים)`,
    מכירות_חיצוניות: Math.round(m.period.revenue_external),
    מכירות_פנימיות_לסניפים: Math.round(m.period.revenue_internal),
    סך_מכירות: Math.round(revenue),
    חומרי_גלם_ספקים: Math.round(m.period.suppliers),
    אחוז_חומרי_גלם: pct(m.period.suppliers, revenue),
    לייבור_עובדים: Math.round(m.period.labor_workers),
    שכר_מנהלים_פרורציה: Math.round(m.period.labor_managers_prorated),
    אחוז_לייבור: pct(totalLabor, revenue),
    סטטוס_נתוני_שכר: m.period.labor_is_actual ? 'מדויק' : 'משוער',
    פחת: Math.round(m.period.waste),
    אחוז_פחת: pct(m.period.waste, revenue),
    תיקונים: Math.round(m.period.repairs),
    עלויות_קבועות_פרורציה: Math.round(m.period.fixed_costs_prorated),
    רווח_נשלט: Math.round(controllableProfit),
    אחוז_רווח_נשלט: pct(controllableProfit, revenue),
    רווח_תפעולי: Math.round(operatingProfit),
    אחוז_רווח_תפעולי: pct(operatingProfit, revenue),
  }
}

function deriveConsolidatedView(m: ConsolidatedMetrics) {
  const branches = m.branches.map(deriveBranchView)
  const factory = deriveFactoryView(m.factory)
  const totalRevenue = branches.reduce((s, b) => s + b.הכנסות_השבוע, 0) + factory.מכירות_חיצוניות
  const totalLabor = branches.reduce((s, b) => s + b.לייבור_עובדים + b.שכר_מנהל_פרורציה, 0) + factory.לייבור_עובדים + factory.שכר_מנהלים_פרורציה
  const totalWaste = branches.reduce((s, b) => s + b.פחת_שח, 0) + factory.פחת
  const totalOP = branches.reduce((s, b) => s + b.רווח_תפעולי, 0) + factory.רווח_תפעולי
  return {
    שם: 'מאוחד (כל העסק)',
    תקופה: `${m.period_start} עד ${m.period_end}`,
    סה_כ_הכנסות_חיצוניות: Math.round(totalRevenue),
    סה_כ_לייבור: Math.round(totalLabor),
    אחוז_לייבור_כולל: pct(totalLabor, totalRevenue),
    סה_כ_פחת: Math.round(totalWaste),
    אחוז_פחת_כולל: pct(totalWaste, totalRevenue),
    סה_כ_רווח_תפעולי: Math.round(totalOP),
    אחוז_רווח_תפעולי: pct(totalOP, totalRevenue),
    סניפים: branches,
    מפעל: factory,
  }
}

// ─── Claude prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `אתה יועץ עסקי מומחה לרשת מאפיות ישראלית. תפקידך לנתח את **השבוע שעבר** (ראשון-שבת) של היחידה (סניף / מפעל / מאוחד) ולספק תובנות פעולה.

עיקרי הניתוח:
- האם השבוע היה רווחי תפעולית? למה כן/למה לא?
- אילו מדדים חרגו מהיעדים (לייבור, פחת, רווח)?
- האם יש אנומליות שיכולות להעיד על בעיה (למשל ספקים גבוהים מאוד יחסית להכנסות)?
- 2-4 פעולות קונקרטיות שניתן לבצע השבוע

חוקי דירוג חומרה (severity):
- אחוז לייבור מעל יעד ב-2 נק׳+ → high; חרגה קלה → medium
- אחוז פחת מעל היעד ב-50%+ → high; חריגה קלה → medium
- רווח תפעולי שלילי (לאחר פרורציה של קבועים) → high
- אחוז רווח תפעולי 5%-15% → low; מעל 15% → win

חוקי ניסוח:
- כתוב פשוט, ישיר, ללא מילים גבוהות
- המלצות קונקרטיות שמנהל יכול לבצע — לא "לבדוק את הלייבור" אלא "להוריד משמרת חצי-יום ביום ב׳"
- אם נתון "סטטוס_נתוני_שכר" הוא "משוער" — תזכיר שהמספר משוער ולא לפעול עליו בלעדית
- אל תתעלם מהקשר חודשי: עלויות קבועות ושכר מנהל חולקו באופן פרופורציוני (≈7/30 מהחודש)

חשוב לדעת על הספקים הפנימיים (מפעל לסניפים):
- אלו מוצרים שהמפעל מוכר לסניפים — הם עלות לסניף, הכנסה למפעל
- טווח רגיל בסניף: 60%-75% מההכנסות
- חריגה מעל 80% → תזכיר שצריך לבחון אם יש פערי תזמון בין הזמנה למכירה

לא להמציא נתונים. רק לפרש את מה שמוצג.`

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'משפט אחד שמסכם את השבוע',
    },
    alerts: {
      type: 'array',
      description: 'התראות על חריגות מהיעדים',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          metric: { type: 'string', description: 'שם המדד בעברית' },
          message: { type: 'string', description: 'תיאור החריגה (עד 2 משפטים)' },
          recommendation: { type: 'string', description: 'המלצה קונקרטית' },
        },
        required: ['severity', 'metric', 'message', 'recommendation'],
        additionalProperties: false,
      },
    },
    wins: {
      type: 'array',
      description: 'דברים חיוביים מהשבוע',
      items: { type: 'string' },
    },
    summary: {
      type: 'string',
      description: 'פסקת סיכום (3-5 משפטים)',
    },
  },
  required: ['headline', 'alerts', 'wins', 'summary'],
  additionalProperties: false,
}

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>
  usage: { input_tokens: number; output_tokens: number }
}

async function callClaude(metricsView: unknown): Promise<{
  insights: unknown
  input_tokens: number
  output_tokens: number
}> {
  const userPrompt = `נתוני השבוע שעבר של היחידה:\n\n${JSON.stringify(metricsView, null, 2)}\n\nספק תובנות בפורמט המבוקש.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: 'json_schema', schema: INSIGHTS_SCHEMA },
      },
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 500)}`)
  }

  const data = (await res.json()) as ClaudeResponse
  const text = data.content.find((b) => b.type === 'text')?.text || ''
  const insights = JSON.parse(text)

  return {
    insights,
    input_tokens: data.usage.input_tokens,
    output_tokens: data.usage.output_tokens,
  }
}

// ─── Per-entity generation ──────────────────────────────────────────────────

async function generateForBranch(db: SupabaseClient, branchId: number, periodStart: string, periodEnd: string) {
  const { data, error } = await db.rpc('get_branch_weekly_metrics', {
    p_branch_id: branchId, p_period_start: periodStart, p_period_end: periodEnd,
  })
  if (error) throw error
  const metrics = data as BranchMetrics
  const view = deriveBranchView(metrics)
  const { insights, input_tokens, output_tokens } = await callClaude(view)
  const cost_usd = (input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return upsertInsight(db, {
    period_start: periodStart, period_end: periodEnd,
    entity_type: 'branch', entity_id: branchId,
    insights, metrics_snapshot: view,
    input_tokens, output_tokens, cost_usd,
  })
}

async function generateForFactory(db: SupabaseClient, periodStart: string, periodEnd: string) {
  const { data, error } = await db.rpc('get_factory_weekly_metrics', {
    p_period_start: periodStart, p_period_end: periodEnd,
  })
  if (error) throw error
  const metrics = data as FactoryMetrics
  const view = deriveFactoryView(metrics)
  const { insights, input_tokens, output_tokens } = await callClaude(view)
  const cost_usd = (input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return upsertInsight(db, {
    period_start: periodStart, period_end: periodEnd,
    entity_type: 'factory', entity_id: null,
    insights, metrics_snapshot: view,
    input_tokens, output_tokens, cost_usd,
  })
}

async function generateForConsolidated(db: SupabaseClient, periodStart: string, periodEnd: string) {
  const { data, error } = await db.rpc('get_consolidated_weekly_metrics', {
    p_period_start: periodStart, p_period_end: periodEnd,
  })
  if (error) throw error
  const metrics = data as ConsolidatedMetrics
  const view = deriveConsolidatedView(metrics)
  const { insights, input_tokens, output_tokens } = await callClaude(view)
  const cost_usd = (input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return upsertInsight(db, {
    period_start: periodStart, period_end: periodEnd,
    entity_type: 'consolidated', entity_id: null,
    insights, metrics_snapshot: view,
    input_tokens, output_tokens, cost_usd,
  })
}

interface InsightRow {
  period_start: string
  period_end: string
  entity_type: string
  entity_id: number | null
  insights: unknown
  metrics_snapshot: unknown
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

async function upsertInsight(db: SupabaseClient, row: InsightRow) {
  const { error } = await db.from('weekly_insights').upsert({ ...row, model: MODEL }, {
    onConflict: 'period_end,entity_type,entity_id',
  })
  if (error) throw error
  return { entity_type: row.entity_type, entity_id: row.entity_id, cost_usd: row.cost_usd }
}

// ─── HTTP handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'missing ANTHROPIC_API_KEY env var' }, 500)
  }

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY)
    const url = new URL(req.url)

    // Allow overriding period via ?period_end=YYYY-MM-DD (the Saturday of the prior week).
    // Otherwise compute the previous Sun-Sat relative to today (Israel TZ).
    let periodStart: string, periodEnd: string
    const overrideEnd = url.searchParams.get('period_end')
    if (overrideEnd) {
      periodEnd = overrideEnd
      periodStart = addDays(periodEnd, -6)
    } else {
      const range = previousWeek(todayInIsrael())
      periodStart = range.period_start
      periodEnd = range.period_end
    }

    const { data: branches, error: brErr } = await db.from('branches').select('id, name').eq('active', true)
    if (brErr) throw brErr

    const tasks: Array<Promise<{ entity_type: string; entity_id: number | null; cost_usd: number }>> = [
      ...((branches || []) as Array<{ id: number }>).map((b) => generateForBranch(db, b.id, periodStart, periodEnd)),
      generateForFactory(db, periodStart, periodEnd),
      generateForConsolidated(db, periodStart, periodEnd),
    ]

    const results = await Promise.allSettled(tasks)
    const succeeded = results.filter((r) => r.status === 'fulfilled')
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? { index: i, reason: String(r.reason).slice(0, 300) } : null))
      .filter(Boolean)

    const totalCost = succeeded.reduce(
      (s, r) => s + (r as PromiseFulfilledResult<{ cost_usd: number }>).value.cost_usd,
      0
    )

    return jsonResponse({
      ok: true,
      period_start: periodStart,
      period_end: periodEnd,
      succeeded: succeeded.length,
      failed: failed.length,
      failures: failed,
      total_cost_usd: Number(totalCost.toFixed(6)),
    })
  } catch (err) {
    console.error('weekly-insights error:', err)
    return jsonResponse({ error: String(err) }, 500)
  }
})
