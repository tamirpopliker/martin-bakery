// ═══════════════════════════════════════════════════════════════════════
// Read-only tool catalogue for the voice agent — phase 1, stage 4.
//
// Every tool is declared here. There is no dynamic SQL and no query builder
// reachable from the model: Claude can only call what is in this list, with
// arguments that pass the schema below.
//
// NOTHING HERE WRITES. Writes arrive in stage 7 behind the confirmation
// mechanism. Until then the worst a misunderstanding can do is return the
// wrong number to the screen.
//
// Revenue mirrors src/lib/calculatePL.ts and is verified to the shekel
// against דשבורד מנכ"ל — see getBranchRevenue below.
//
// See AGENT_PLAN.md sections 4.1–4.4.
// ═══════════════════════════════════════════════════════════════════════

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { AppUser } from './agentAuth.ts'

// ─── Branch revenue ─────────────────────────────────────────────────────
//
// MIRRORS src/lib/calculatePL.ts:142-178 — the only formula that matches the
// dashboard. Verified to the shekel against דשבורד מנכ"ל for July 2026:
//   אברהם אבינו 568,759 · הפועלים 463,459 · יעקב כהן 251,618
//
// Deliberately does NOT use _shared/laborQueries.ts::getBranchRevenueWithClosings.
// That function predates three changes and under-reports revenue:
//   1. omits register_closings.check_sales   (added by migration 059)
//   2. omits b2b_invoices                    (B2B הקפה, net of VAT)
//   3. does not exclude source='credit_b2b'  (double-counts against b2b_invoices)
// For July 2026 it was short by ₪7,168 (אברהם אבינו) and ₪15,485 (הפועלים).
// Fixing it would change the email reports' numbers, so it is left alone here
// and flagged separately.
//
// If calculatePL.ts changes, change this too.
async function getBranchRevenue(
  db: SupabaseClient,
  branchId: number,
  from: string,
  to: string,
): Promise<{ total: number; legacy: number; closings: number; b2b: number }> {
  const [revRes, closeRes, b2bRes] = await Promise.all([
    db.from('branch_revenue').select('amount, source')
      .eq('branch_id', branchId).gte('date', from).lt('date', to).range(0, 99999),
    db.from('register_closings').select('cash_sales, credit_sales, check_sales')
      .eq('branch_id', branchId).gte('date', from).lt('date', to).range(0, 99999),
    db.from('b2b_invoices').select('total_before_vat')
      .eq('branch_id', branchId).gte('invoice_date', from).lt('invoice_date', to).range(0, 99999),
  ])

  // credit_b2b rows are backfill and would double-count against b2b_invoices.
  const legacy = (revRes.data ?? [])
    .filter((r) => r.source !== 'credit_b2b')
    .reduce((s, r) => s + Number(r.amount || 0), 0)

  const closings = (closeRes.data ?? []).reduce(
    (s, c) => s + Number(c.cash_sales || 0) + Number(c.credit_sales || 0) + Number(c.check_sales || 0),
    0,
  )

  const b2b = (b2bRes.data ?? []).reduce((s, r) => s + Number(r.total_before_vat || 0), 0)

  return { total: legacy + closings + b2b, legacy, closings, b2b }
}

export interface ToolContext {
  db: SupabaseClient
  user: AppUser
}

export interface AgentTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  mutates: boolean
  allowedRoles: string[]
  // Written now, enforced in phase 2 — see AGENT_PLAN.md 3.3
  requiredPage?: (args: Record<string, unknown>) => string
  deniedForRestricted?: boolean
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

// ─── helpers ────────────────────────────────────────────────────────────

const ils = (n: number) => Math.round(n * 100) / 100

/**
 * Date-range guard. The `month`/`date` columns store the first of the month
 * or a plain date, so the end bound MUST be exclusive — `.lte(end)` silently
 * pulls in the following month. See CLAUDE.md "Known gotchas".
 */
function range(args: Record<string, unknown>): { from: string; to: string } {
  const from = String(args.from ?? '')
  const to = String(args.to ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('טווח תאריכים לא תקין')
  }
  if (from >= to) throw new Error('תאריך ההתחלה חייב להיות לפני תאריך הסיום')
  return { from, to }
}

async function assertBranch(db: SupabaseClient, branchId: unknown): Promise<number> {
  const id = Number(branchId)
  if (!Number.isInteger(id)) throw new Error('מזהה סניף לא תקין')
  // branches is the only source of branch identity — never hardcode ids.
  const { data } = await db.from('branches').select('id, name').eq('id', id).maybeSingle()
  if (!data) throw new Error('סניף לא קיים')
  return id
}

const dateRangeSchema = {
  from: { type: 'string', description: 'תאריך התחלה כולל, YYYY-MM-DD' },
  to: { type: 'string', description: 'תאריך סיום לא כולל, YYYY-MM-DD' },
}

// ─── tools ──────────────────────────────────────────────────────────────

export const TOOLS: AgentTool[] = [
  {
    name: 'get_branches',
    description: 'רשימת הסניפים הפעילים עם המזהים שלהם. יש לקרוא לפני כל פעולה שדורשת סניף, אם הסניף לא ידוע מההקשר.',
    mutates: false,
    allowedRoles: ['admin'],
    input_schema: { type: 'object', properties: {}, required: [] },
    async run(_args, { db }) {
      const { data } = await db
        .from('branches')
        .select('id, name, short_name, manager_name')
        .eq('active', true)
        .order('id')
      return { branches: data ?? [] }
    },
  },

  {
    name: 'get_branch_revenue',
    description:
      'סך ההכנסות של סניף בטווח תאריכים, מפוצל לפי ערוץ: קופה (סגירות קופה — מזומן, אשראי ושיקים), אתר, ו-B2B הקפה. הסכומים נטו, ללא מע"מ. זהה למה שמוצג בדשבורד המנכ"ל.',
    mutates: false,
    allowedRoles: ['admin'],
    requiredPage: (a) => `branch_${a.branch_id}_revenue`,
    deniedForRestricted: true,
    input_schema: {
      type: 'object',
      properties: { branch_id: { type: 'integer' }, ...dateRangeSchema },
      required: ['branch_id', 'from', 'to'],
    },
    async run(args, { db }) {
      const branchId = await assertBranch(db, args.branch_id)
      const { from, to } = range(args)
      const r = await getBranchRevenue(db, branchId, from, to)
      return {
        branch_id: branchId, from, to,
        total: ils(r.total),
        by_channel: {
          'קופה': ils(r.closings),
          'אתר': ils(r.legacy),
          'B2B הקפה': ils(r.b2b),
        },
      }
    },
  },

  {
    name: 'list_branch_waste',
    description:
      'רישומי פחת של סניף בטווח תאריכים, עם סך הכל ופילוח לפי קטגוריה. פחת נרשם לפי סכום בלבד, ללא מוצר.',
    mutates: false,
    allowedRoles: ['admin'],
    requiredPage: (a) => `branch_${a.branch_id}_waste`,
    deniedForRestricted: true,
    input_schema: {
      type: 'object',
      properties: { branch_id: { type: 'integer' }, ...dateRangeSchema },
      required: ['branch_id', 'from', 'to'],
    },
    async run(args, { db }) {
      const branchId = await assertBranch(db, args.branch_id)
      const { from, to } = range(args)
      const { data } = await db
        .from('branch_waste')
        .select('date, amount, category, notes')
        .eq('branch_id', branchId)
        .gte('date', from).lt('date', to)
        .order('date')
      const rows = data ?? []
      const byCategory: Record<string, number> = {}
      let total = 0
      for (const r of rows) {
        const amt = Number(r.amount || 0)
        total += amt
        const c = r.category || 'לא מסווג'
        byCategory[c] = ils((byCategory[c] ?? 0) + amt)
      }
      return {
        branch_id: branchId, from, to,
        total: ils(total), count: rows.length,
        by_category: byCategory,
        entries: rows.slice(0, 50),
      }
    },
  },

  {
    name: 'list_branch_expenses',
    description:
      'הוצאות של סניף בטווח תאריכים, עם פילוח לפי סוג וספק. שדה from_factory מסמן רכישות מהמפעל — אלה מקבלות קדימות על פני מכירות פנימיות ואין לספור אותן פעמיים.',
    mutates: false,
    allowedRoles: ['admin'],
    requiredPage: (a) => `branch_${a.branch_id}_expenses`,
    deniedForRestricted: true,
    input_schema: {
      type: 'object',
      properties: { branch_id: { type: 'integer' }, ...dateRangeSchema },
      required: ['branch_id', 'from', 'to'],
    },
    async run(args, { db }) {
      const branchId = await assertBranch(db, args.branch_id)
      const { from, to } = range(args)
      const { data } = await db
        .from('branch_expenses')
        .select('date, amount, supplier, expense_type, from_factory, doc_number')
        .eq('branch_id', branchId)
        .gte('date', from).lt('date', to)
        .order('date')
      const rows = data ?? []
      const byType: Record<string, number> = {}
      let total = 0
      let fromFactory = 0
      for (const r of rows) {
        const amt = Number(r.amount || 0)
        total += amt
        if (r.from_factory) fromFactory += amt
        const t = r.expense_type || 'אחר'
        byType[t] = ils((byType[t] ?? 0) + amt)
      }
      return {
        branch_id: branchId, from, to,
        total: ils(total), count: rows.length,
        from_factory_total: ils(fromFactory),
        by_type: byType,
        entries: rows.slice(0, 50),
      }
    },
  },

  {
    name: 'list_register_closings',
    description:
      'סגירות קופה של סניף בטווח תאריכים. הסכומים המאוחסנים הם נטו (ללא מע"מ) — הקלט במסך הוא ברוטו. כולל סטיות והפקדות.',
    mutates: false,
    allowedRoles: ['admin'],
    requiredPage: (a) => `branch_${a.branch_id}_closings`,
    input_schema: {
      type: 'object',
      properties: {
        branch_id: { type: 'integer' },
        register_number: { type: 'integer', description: 'אופציונלי — לסינון קופה מסוימת' },
        ...dateRangeSchema,
      },
      required: ['branch_id', 'from', 'to'],
    },
    async run(args, { db }) {
      const branchId = await assertBranch(db, args.branch_id)
      const { from, to } = range(args)
      let q = db
        .from('register_closings')
        .select('date, register_number, opening_balance, cash_sales, credit_sales, check_sales, actual_cash, deposit_amount, variance, variance_action, next_opening_balance, transaction_count')
        .eq('branch_id', branchId)
        .gte('date', from).lt('date', to)
      if (args.register_number != null) q = q.eq('register_number', Number(args.register_number))
      const { data } = await q.order('date').order('register_number')
      const rows = data ?? []
      const sum = (k: string) => ils(rows.reduce((s, r) => s + Number((r as Record<string, unknown>)[k] || 0), 0))
      return {
        branch_id: branchId, from, to, count: rows.length,
        cash_sales_net: sum('cash_sales'),
        credit_sales_net: sum('credit_sales'),
        check_sales_net: sum('check_sales'),
        total_variance: sum('variance'),
        transactions: rows.reduce((s, r) => s + Number(r.transaction_count || 0), 0),
        closings: rows.slice(0, 50),
      }
    },
  },

  {
    name: 'get_change_fund_balance',
    description: 'יתרת קופת העודף הנוכחית של סניף, ותנועות אחרונות.',
    mutates: false,
    allowedRoles: ['admin'],
    requiredPage: (a) => `branch_${a.branch_id}_change_fund`,
    input_schema: {
      type: 'object',
      properties: {
        branch_id: { type: 'integer' },
        limit: { type: 'integer', description: 'כמה תנועות אחרונות להחזיר, ברירת מחדל 10' },
      },
      required: ['branch_id'],
    },
    async run(args, { db }) {
      const branchId = await assertBranch(db, args.branch_id)
      const limit = Math.min(Number(args.limit ?? 10), 50)
      // balance_after of the most recent row is the running balance
      const { data } = await db
        .from('change_fund')
        .select('date, type, amount, description, balance_after, created_at')
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false })
        .limit(limit)
      const rows = data ?? []
      return {
        branch_id: branchId,
        balance: rows.length ? ils(Number(rows[0].balance_after || 0)) : 0,
        recent: rows,
      }
    },
  },
]

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

/**
 * Catalogue filtered for the caller. Phase 1 enforces `allowedRoles` only —
 * `requiredPage` and `deniedForRestricted` are declared but not yet checked
 * (AGENT_PLAN.md 3.3). Claude never sees a tool it may not call.
 */
export function toolsFor(user: AppUser) {
  return TOOLS
    .filter((t) => t.allowedRoles.includes(user.role))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
}
