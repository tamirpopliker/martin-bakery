import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Setup ──────────────────────────────────────────────────────────────────
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const db = createClient(supabaseUrl, supabaseKey)

const RESEND_API_URL = 'https://api.resend.com/emails'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('REPORT_FROM_EMAIL') || 'reports@martinbakery.co.il'
const APP_URL = 'https://martin-bakery.co.il'

// ─── Types ──────────────────────────────────────────────────────────────────
interface AlertRule {
  id: number
  name: string
  entity_type: 'branch' | 'factory'
  entity_id: string
  metric: 'revenue' | 'waste' | 'labor_cost' | 'production'
  condition: 'below' | 'above'
  threshold: number
  threshold_type: 'absolute' | 'percent'
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function todayISO(): string {
  // Israel timezone (UTC+2 / UTC+3)
  const now = new Date()
  const il = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
  return il.toISOString().slice(0, 10)
}

function entityLabel(rule: AlertRule, branches: { id: number; name: string }[]): string {
  if (rule.entity_type === 'branch') {
    const br = branches.find(b => b.id === Number(rule.entity_id))
    return br ? br.name : `סניף ${rule.entity_id}`
  }
  const deptNames: Record<string, string> = {
    creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה', cleaning: 'ניקיון',
  }
  return deptNames[rule.entity_id] || rule.entity_id
}

const METRIC_LABELS: Record<string, string> = {
  revenue: 'הכנסות', waste: 'פחת', labor_cost: 'עלות לייבור', production: 'ייצור',
}

const CONDITION_LABELS: Record<string, string> = {
  below: 'מתחת ל-', above: 'מעל ל-',
}

// ─── Fetch actual values ────────────────────────────────────────────────────
async function getActualValue(rule: AlertRule, date: string): Promise<number | null> {
  const nextDay = new Date(date + 'T00:00:00')
  nextDay.setDate(nextDay.getDate() + 1)
  const to = nextDay.toISOString().slice(0, 10)

  if (rule.metric === 'revenue' && rule.entity_type === 'branch') {
    const { data } = await db.from('branch_revenue')
      .select('amount')
      .eq('branch_id', Number(rule.entity_id))
      .gte('date', date).lt('date', to)
    return data ? data.reduce((s: number, r: any) => s + Number(r.amount), 0) : null
  }

  if (rule.metric === 'waste' && rule.entity_type === 'branch') {
    const { data } = await db.from('branch_waste')
      .select('amount')
      .eq('branch_id', Number(rule.entity_id))
      .gte('date', date).lt('date', to)
    return data ? data.reduce((s: number, r: any) => s + Number(r.amount), 0) : null
  }

  if (rule.metric === 'waste' && rule.entity_type === 'factory') {
    const { data } = await db.from('factory_waste')
      .select('amount')
      .eq('department', rule.entity_id)
      .gte('date', date).lt('date', to)
    return data ? data.reduce((s: number, r: any) => s + Number(r.amount), 0) : null
  }

  if (rule.metric === 'labor_cost' && rule.entity_type === 'factory') {
    const { data } = await db.from('labor')
      .select('employer_cost')
      .eq('entity_type', 'factory')
      .eq('entity_id', rule.entity_id)
      .gte('date', date).lt('date', to)
    return data ? data.reduce((s: number, r: any) => s + Number(r.employer_cost), 0) : null
  }

  if (rule.metric === 'labor_cost' && rule.entity_type === 'branch') {
    const { data } = await db.from('branch_labor')
      .select('employer_cost')
      .eq('branch_id', Number(rule.entity_id))
      .gte('date', date).lt('date', to)
    return data ? data.reduce((s: number, r: any) => s + Number(r.employer_cost), 0) : null
  }

  if (rule.metric === 'production' && rule.entity_type === 'factory') {
    const { data } = await db.from('daily_production')
      .select('amount')
      .eq('department', rule.entity_id)
      .gte('date', date).lt('date', to)
    return data ? data.reduce((s: number, r: any) => s + Number(r.amount), 0) : null
  }

  return null
}

// ─── Check if alert was already sent today ──────────────────────────────────
async function alreadySentToday(ruleId: number, date: string): Promise<boolean> {
  const nextDay = new Date(date + 'T00:00:00')
  nextDay.setDate(nextDay.getDate() + 1)
  const { data } = await db.from('alert_log')
    .select('id')
    .eq('rule_id', ruleId)
    .gte('triggered_at', date + 'T00:00:00+00:00')
    .lt('triggered_at', nextDay.toISOString().slice(0, 10) + 'T00:00:00+00:00')
    .limit(1)
  return (data?.length || 0) > 0
}

// ─── Send alert email ───────────────────────────────────────────────────────
async function sendAlertEmail(
  to: string[],
  ruleName: string,
  entityName: string,
  metricLabel: string,
  conditionLabel: string,
  threshold: number,
  actual: number,
): Promise<boolean> {
  if (!RESEND_API_KEY || to.length === 0) return false

  const fmtN = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })

  const html = `
    <div dir="rtl" style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #818cf8, #6366f1); border-radius: 16px; padding: 24px; color: white; margin-bottom: 20px;">
        <h1 style="margin: 0 0 8px; font-size: 20px;">⚠️ התרעה: ${ruleName}</h1>
        <p style="margin: 0; opacity: 0.9; font-size: 14px;">${entityName} · ${metricLabel}</p>
      </div>
      <div style="background: #f8fafc; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
          <span style="color: #64748b; font-size: 13px;">ערך בפועל</span>
          <span style="font-weight: 800; font-size: 18px; color: #ef4444;">${fmtN(actual)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
          <span style="color: #64748b; font-size: 13px;">סף התרעה (${conditionLabel})</span>
          <span style="font-weight: 700; font-size: 16px; color: #374151;">${fmtN(threshold)}</span>
        </div>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 8px;">
          <span style="color: #94a3b8; font-size: 12px;">🕐 ${now}</span>
        </div>
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <a href="${APP_URL}" style="display: inline-block; background: #818cf8; color: white; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 700; font-size: 14px;">
          פתח את המערכת
        </a>
      </div>
    </div>
  `

  for (const recipient of to) {
    try {
      await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `מרטין התרעות <${FROM_EMAIL}>`,
          to: recipient,
          subject: `⚠️ התרעה: ${ruleName} — ${entityName}`,
          html,
        }),
      })
    } catch (err) {
      console.error('Alert email error:', err)
    }
  }
  return true
}

// ─── Get admin emails ───────────────────────────────────────────────────────
async function getAdminEmails(): Promise<string[]> {
  const { data } = await db.from('app_users').select('email').eq('role', 'admin')
  return (data || []).map((u: any) => u.email)
}

// ─── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  try {
    // Auth
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (cronSecret) {
      const authHeader = req.headers.get('Authorization')
      const headerToken = authHeader?.replace('Bearer ', '')
      let bodyToken: string | undefined
      try {
        const body = await req.clone().json()
        bodyToken = body.cron_secret
      } catch { /* no body */ }
      if (bodyToken !== cronSecret && headerToken !== cronSecret) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    const today = todayISO()

    // Check if Saturday (skip)
    const dayOfWeek = new Date(today + 'T12:00:00').getDay()
    if (dayOfWeek === 6) {
      return json({ status: 'skipped', reason: 'Saturday', date: today })
    }

    // Load active rules
    const { data: rules } = await db.from('alert_rules')
      .select('*')
      .eq('active', true)

    if (!rules || rules.length === 0) {
      return json({ status: 'ok', date: today, checked: 0, triggered: 0 })
    }

    // Load branches for labels
    const { data: branches } = await db.from('branches')
      .select('id, name')
      .eq('active', true)

    const adminEmails = await getAdminEmails()
    let triggered = 0

    for (const rule of rules as AlertRule[]) {
      // Skip if already sent today
      if (await alreadySentToday(rule.id, today)) continue

      const actual = await getActualValue(rule, today)
      if (actual === null || actual === 0) continue // No data yet today

      const threshold = rule.threshold
      let isTriggered = false

      if (rule.condition === 'below' && actual < threshold) isTriggered = true
      if (rule.condition === 'above' && actual > threshold) isTriggered = true

      if (!isTriggered) continue

      triggered++
      const label = entityLabel(rule, branches || [])
      const metricLabel = METRIC_LABELS[rule.metric] || rule.metric
      const condLabel = CONDITION_LABELS[rule.condition] || rule.condition

      const emailSent = await sendAlertEmail(
        adminEmails, rule.name, label, metricLabel, condLabel, threshold, actual,
      )

      // Log
      await db.from('alert_log').insert({
        rule_id: rule.id,
        actual_value: actual,
        threshold_value: threshold,
        email_sent: emailSent,
        recipient_emails: adminEmails,
      })
    }

    return json({
      status: 'ok',
      date: today,
      checked: rules.length,
      triggered,
    })
  } catch (err) {
    console.error('check-alerts error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })
}
