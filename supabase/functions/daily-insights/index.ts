// ═══════════════════════════════════════════════════════════════════════════
// daily-insights — nightly business-advisor agent
// ═══════════════════════════════════════════════════════════════════════════
// Runs at 22:00 IST (via pg_cron — see sql/048_schedule_daily_insights.sql).
//
// For each entity (each active branch + factory + consolidated):
//   1. Call get_<entity>_advisor_metrics(...) RPC to aggregate today's data
//   2. Compute derived KPIs (labor %, waste %, controllable/operating profit)
//   3. Send a compact Hebrew prompt to Claude Haiku 4.5 with structured output
//   4. Upsert the response into daily_insights (one row per entity per day)
//
// Cost: ~$0.005/day total across 5 entities (~₪0.50/month).
// Manual trigger:  curl -X POST <fn-url>/daily-insights -H "Authorization: Bearer <SERVICE_KEY>"
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MODEL = 'claude-haiku-4-5'
// Haiku 4.5 pricing per 1M tokens (as of 2026)
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

// Today in Israel timezone (cron may run in UTC)
function todayInIsrael(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date()) // YYYY-MM-DD
}

// ─── Derived KPIs ───────────────────────────────────────────────────────────
// Mirrors calculatePL.ts: waste NOT deducted from controllable/operating profit.

interface BranchMetrics {
  entity_type: 'branch'
  entity_id: number
  entity_name: string
  date: string
  period: string
  mtd: {
    revenue: number
    suppliers_internal: number
    suppliers_external: number
    labor_workers: number
    labor_managers: number
    labor_is_actual: boolean
    waste: number
    repairs: number
    deliveries: number
    infrastructure: number
    other_expenses: number
    fixed_costs: number
  }
  today: { revenue: number }
  targets: { labor_pct: number; waste_pct: number }
}

interface FactoryMetrics {
  entity_type: 'factory'
  entity_id: null
  entity_name: string
  date: string
  period: string
  mtd: {
    revenue_external: number
    revenue_internal: number
    suppliers: number
    labor_workers: number
    labor_managers: number
    labor_is_actual: boolean
    waste: number
    repairs: number
    fixed_costs: number
  }
}

interface ConsolidatedMetrics {
  entity_type: 'consolidated'
  entity_id: null
  entity_name: string
  date: string
  period: string
  factory: FactoryMetrics
  branches: BranchMetrics[]
}

function pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : 0
}

// Build a compact Hebrew context object the model will analyze.
// Pre-computed percentages save the model from arithmetic and reduce token use.
function deriveBranchView(m: BranchMetrics) {
  const totalLabor = m.mtd.labor_workers + m.mtd.labor_managers
  const totalSuppliers = m.mtd.suppliers_internal + m.mtd.suppliers_external
  const variableCosts = totalSuppliers + totalLabor + m.mtd.repairs + m.mtd.deliveries + m.mtd.infrastructure + m.mtd.other_expenses
  const controllableProfit = m.mtd.revenue - variableCosts
  const operatingProfit = controllableProfit - m.mtd.fixed_costs
  return {
    שם: m.entity_name,
    תקופה: m.period,
    הכנסות_חודשיות: Math.round(m.mtd.revenue),
    הכנסות_היום: Math.round(m.today.revenue),
    ספקים_פנימיים_מפעל: Math.round(m.mtd.suppliers_internal),
    ספקים_חיצוניים: Math.round(m.mtd.suppliers_external),
    אחוז_ספקים_מהכנסות: pct(totalSuppliers, m.mtd.revenue),
    לייבור_עובדים: Math.round(m.mtd.labor_workers),
    שכר_מנהל: Math.round(m.mtd.labor_managers),
    אחוז_לייבור_מהכנסות: pct(totalLabor, m.mtd.revenue),
    יעד_אחוז_לייבור: m.targets.labor_pct,
    סטטוס_נתוני_שכר: m.mtd.labor_is_actual ? 'מדויק' : 'משוער',
    פחת_שח: Math.round(m.mtd.waste),
    אחוז_פחת_מהכנסות: pct(m.mtd.waste, m.mtd.revenue),
    יעד_אחוז_פחת: m.targets.waste_pct,
    תיקונים: Math.round(m.mtd.repairs),
    משלוחים: Math.round(m.mtd.deliveries),
    תשתיות: Math.round(m.mtd.infrastructure),
    הוצאות_אחרות: Math.round(m.mtd.other_expenses),
    עלויות_קבועות: Math.round(m.mtd.fixed_costs),
    רווח_נשלט: Math.round(controllableProfit),
    אחוז_רווח_נשלט: pct(controllableProfit, m.mtd.revenue),
    רווח_תפעולי: Math.round(operatingProfit),
    אחוז_רווח_תפעולי: pct(operatingProfit, m.mtd.revenue),
  }
}

function deriveFactoryView(m: FactoryMetrics) {
  const revenue = m.mtd.revenue_external + m.mtd.revenue_internal
  const totalLabor = m.mtd.labor_workers + m.mtd.labor_managers
  const variableCosts = m.mtd.suppliers + totalLabor + m.mtd.repairs
  const controllableProfit = revenue - variableCosts
  const operatingProfit = controllableProfit - m.mtd.fixed_costs
  return {
    שם: m.entity_name,
    תקופה: m.period,
    מכירות_חיצוניות: Math.round(m.mtd.revenue_external),
    מכירות_פנימיות_לסניפים: Math.round(m.mtd.revenue_internal),
    סך_מכירות: Math.round(revenue),
    חומרי_גלם_ספקים: Math.round(m.mtd.suppliers),
    אחוז_חומרי_גלם: pct(m.mtd.suppliers, revenue),
    לייבור_עובדים: Math.round(m.mtd.labor_workers),
    שכר_מנהלים: Math.round(m.mtd.labor_managers),
    אחוז_לייבור: pct(totalLabor, revenue),
    סטטוס_נתוני_שכר: m.mtd.labor_is_actual ? 'מדויק' : 'משוער',
    פחת: Math.round(m.mtd.waste),
    אחוז_פחת: pct(m.mtd.waste, revenue),
    תיקונים: Math.round(m.mtd.repairs),
    עלויות_קבועות: Math.round(m.mtd.fixed_costs),
    רווח_נשלט: Math.round(controllableProfit),
    אחוז_רווח_נשלט: pct(controllableProfit, revenue),
    רווח_תפעולי: Math.round(operatingProfit),
    אחוז_רווח_תפעולי: pct(operatingProfit, revenue),
  }
}

function deriveConsolidatedView(m: ConsolidatedMetrics) {
  const branches = m.branches.map(deriveBranchView)
  const factory = deriveFactoryView(m.factory)
  // Whole-company external revenue (intercompany eliminated)
  const totalRevenue = branches.reduce((s, b) => s + b.הכנסות_חודשיות, 0) + factory.מכירות_חיצוניות
  const totalLabor = branches.reduce((s, b) => s + b.לייבור_עובדים + b.שכר_מנהל, 0) + factory.לייבור_עובדים + factory.שכר_מנהלים
  const totalWaste = branches.reduce((s, b) => s + b.פחת_שח, 0) + factory.פחת
  const totalOP = branches.reduce((s, b) => s + b.רווח_תפעולי, 0) + factory.רווח_תפעולי
  return {
    שם: 'מאוחד (כל העסק)',
    תקופה: m.period,
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

const SYSTEM_PROMPT = `אתה יועץ עסקי מומחה לרשת מאפיות ישראלית. תפקידך:
- לנתח את הנתונים הכספיים של היחידה (סניף / מפעל / מאוחד) לחודש הנוכחי
- לזהות חריגות חיוביות ושליליות לעומת היעדים
- להציע פעולות קונקרטיות שניתן לבצע מחר בבוקר
- לכתוב בעברית פשוטה, ישירה, ללא מילים גבוהות

חוקי ניתוח:
- אחוז לייבור גבוה מהיעד → severity high
- אחוז פחת גבוה מהיעד ב-50%+ → severity high; מעל היעד אבל פחות → medium
- רווח תפעולי שלילי → severity high
- אחוז רווח תפעולי בין 5%-10% → low; מעל 15% → win
- אם הכנסות היום הן 0 ועדיין יום מסחר רגיל — תזכיר שצריך לוודא שדוח סגירת הקופה נקלט
- ספקים פנימיים נורמלי 60%-75% מההכנסות בסניף; חורג מטווח זה → alert
- תנסח המלצות ככה שהמנהל יכול לבצע — לא "לבדוק את הלייבור" אלא "להפחית משמרת אחת ביום שלישי וחמישי"

לא להמציא נתונים, רק לפרש את מה שמוצג. אם נתון חסר, תאמר זאת.`

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'משפט אחד שמסכם את מצב היחידה החודש',
    },
    alerts: {
      type: 'array',
      description: 'התראות על חריגות מהיעדים',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          metric: { type: 'string', description: 'שם המדד בעברית (למשל: לייבור, פחת, רווח תפעולי)' },
          message: { type: 'string', description: 'תיאור החריגה בעברית, עד 2 משפטים' },
          recommendation: { type: 'string', description: 'המלצה קונקרטית בעברית' },
        },
        required: ['severity', 'metric', 'message', 'recommendation'],
        additionalProperties: false,
      },
    },
    wins: {
      type: 'array',
      description: 'דברים חיוביים שכדאי להדגיש בעברית',
      items: { type: 'string' },
    },
    summary: {
      type: 'string',
      description: 'פסקת סיכום (3-5 משפטים) בעברית',
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
  const userPrompt = `הנה הנתונים החודשיים של היחידה:\n\n${JSON.stringify(metricsView, null, 2)}\n\nספק תובנות בפורמט המבוקש.`

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

async function generateForBranch(db: SupabaseClient, branchId: number, date: string) {
  const { data, error } = await db.rpc('get_branch_advisor_metrics', { p_branch_id: branchId, p_date: date })
  if (error) throw error
  const metrics = data as BranchMetrics
  const view = deriveBranchView(metrics)
  const { insights, input_tokens, output_tokens } = await callClaude(view)
  const cost_usd = (input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return upsertInsight(db, {
    date, entity_type: 'branch', entity_id: branchId,
    insights, metrics_snapshot: view,
    input_tokens, output_tokens, cost_usd,
  })
}

async function generateForFactory(db: SupabaseClient, date: string) {
  const { data, error } = await db.rpc('get_factory_advisor_metrics', { p_date: date })
  if (error) throw error
  const metrics = data as FactoryMetrics
  const view = deriveFactoryView(metrics)
  const { insights, input_tokens, output_tokens } = await callClaude(view)
  const cost_usd = (input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return upsertInsight(db, {
    date, entity_type: 'factory', entity_id: null,
    insights, metrics_snapshot: view,
    input_tokens, output_tokens, cost_usd,
  })
}

async function generateForConsolidated(db: SupabaseClient, date: string) {
  const { data, error } = await db.rpc('get_consolidated_advisor_metrics', { p_date: date })
  if (error) throw error
  const metrics = data as ConsolidatedMetrics
  const view = deriveConsolidatedView(metrics)
  const { insights, input_tokens, output_tokens } = await callClaude(view)
  const cost_usd = (input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return upsertInsight(db, {
    date, entity_type: 'consolidated', entity_id: null,
    insights, metrics_snapshot: view,
    input_tokens, output_tokens, cost_usd,
  })
}

interface InsightRow {
  date: string
  entity_type: string
  entity_id: number | null
  insights: unknown
  metrics_snapshot: unknown
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

async function upsertInsight(db: SupabaseClient, row: InsightRow) {
  const { error } = await db.from('daily_insights').upsert({ ...row, model: MODEL }, {
    onConflict: 'date,entity_type,entity_id',
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
    // Allow overriding date via ?date=YYYY-MM-DD for backfill/testing.
    const url = new URL(req.url)
    const date = url.searchParams.get('date') || todayInIsrael()

    const { data: branches, error: brErr } = await db.from('branches').select('id, name').eq('active', true)
    if (brErr) throw brErr

    const tasks: Array<Promise<{ entity_type: string; entity_id: number | null; cost_usd: number }>> = [
      ...((branches || []) as Array<{ id: number }>).map((b) => generateForBranch(db, b.id, date)),
      generateForFactory(db, date),
      generateForConsolidated(db, date),
    ]

    const results = await Promise.allSettled(tasks)
    const succeeded = results.filter((r) => r.status === 'fulfilled')
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? { index: i, reason: String(r.reason).slice(0, 300) } : null))
      .filter(Boolean)

    const totalCost = succeeded.reduce((s, r) => s + (r as PromiseFulfilledResult<{ cost_usd: number }>).value.cost_usd, 0)

    return jsonResponse({
      ok: true,
      date,
      succeeded: succeeded.length,
      failed: failed.length,
      failures: failed,
      total_cost_usd: Number(totalCost.toFixed(6)),
    })
  } catch (err) {
    console.error('daily-insights error:', err)
    return jsonResponse({ error: String(err) }, 500)
  }
})
