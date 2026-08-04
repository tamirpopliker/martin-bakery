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

/** What the user is shown before a write happens. Built server-side from the
 *  validated arguments — never from anything the client sent. */
export interface ActionSummary {
  title: string
  fields: Array<{ label: string; value: string }>
  /** Rendered large and bold — the number a rushed user must not miss. */
  amount?: string
  warnings: string[]
  /** Blocks confirmation entirely. Duplicates of a unique record, etc. */
  blocker?: string
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
  /** Required for mutating tools. Validates and describes; must not write. */
  summarize?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ActionSummary>
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

// ─── write helpers ──────────────────────────────────────────────────────

const LARGE_AMOUNT = 5000
const OLD_DATE_DAYS = 30

function parseAmount(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error('סכום לא תקין')
  if (n <= 0) throw new Error('הסכום חייב להיות גדול מאפס')
  if (n > 1_000_000) throw new Error('הסכום גדול מדי')
  return Math.round(n * 100) / 100
}

function parseDate(v: unknown): string {
  const s = String(v ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('תאריך לא תקין')
  if (Number.isNaN(Date.parse(s))) throw new Error('תאריך לא קיים')
  return s
}

/** Warnings that apply to any dated money entry. */
function commonWarnings(amount: number, date: string, today: string): string[] {
  const w: string[] = []
  if (amount > LARGE_AMOUNT) w.push(`סכום חריג — מעל ${LARGE_AMOUNT.toLocaleString('he-IL')} ₪`)
  if (date > today) w.push('התאריך עתידי')
  else {
    const days = Math.floor((Date.parse(today) - Date.parse(date)) / 86_400_000)
    if (days > OLD_DATE_DAYS) w.push(`התאריך לפני ${days} ימים`)
  }
  return w
}

async function branchName(db: SupabaseClient, id: number): Promise<string> {
  const { data } = await db.from('branches').select('short_name, name').eq('id', id).maybeSingle()
  return data?.short_name || data?.name || `סניף ${id}`
}

const money = (n: number) => `${n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₪`
const heDate = (s: string) => s.split('-').reverse().join('/')

// The three values actually present in branch_waste. Not invented — queried.
const WASTE_CATEGORIES: Record<string, string> = {
  end_of_day: 'סוף יום',
  finished: 'מוצר מוגמר',
  returned_product: 'מוצר שהוחזר',
}
const DEFAULT_WASTE_CATEGORY = 'end_of_day'

// Queried from branch_expenses, not assumed.
const EXPENSE_TYPES: Record<string, string> = {
  suppliers: 'ספקים',
  deliveries: 'משלוחים',
  repairs: 'תיקונים',
  other: 'אחר',
}
const DEFAULT_EXPENSE_TYPE = 'suppliers'

/**
 * Supplier names in branch_expenses are free text and already inconsistent —
 * "בית הבגט"/"בית הבאגט", "טרה"/"טרה חלב", "דני וגלית"/"דני וגלית בעמ",
 * "—ליאם אריזות". Writing whatever was transcribed would make that worse, so
 * a spoken name is matched against what already exists and the established
 * spelling wins. An unmatched name is still allowed — it is simply flagged on
 * the card so the user knows they are creating a new one.
 */
function normaliseSupplier(s: string): string {
  return s
    .replace(/[֑-ׇ]/g, '')
    .replace(/בע["'׳״]?מ\.?/g, '')      // בע"מ / בעמ / בע'מ
    .replace(/[."'׳״\-–—,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Hebrew is written with and without matres lectionis, and transcription
 * flips between them constantly — "בית הבאגט" for "בית הבגט", "לחמניה" for
 * "לחמנייה". Dropping א/ו/י entirely collapses both spellings onto the same
 * key. Used only after exact and containment have failed.
 */
function skeleton(s: string): string {
  return normaliseSupplier(s).replace(/[אוי]/g, '')
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length || !b.length) return Math.max(a.length, b.length)
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1])
    }
    prev = cur
  }
  return prev[b.length]
}

async function resolveSupplier(
  db: SupabaseClient,
  branchId: number,
  spoken: string,
): Promise<{ name: string; isNew: boolean }> {
  const raw = spoken.trim()
  if (!raw) throw new Error('שם ספק חסר')
  const target = normaliseSupplier(raw)
  if (!target) throw new Error('שם ספק לא תקין')

  // Names from every branch, not just this one — a supplier new to this branch
  // is usually still an existing supplier. This branch's usage ranks first so
  // its established spelling wins a tie.
  const [histRes, listRes] = await Promise.all([
    db.from('branch_expenses').select('supplier, branch_id')
      .not('supplier', 'is', null).range(0, 9999),
    db.from('suppliers_new').select('name').eq('active', true),
  ])

  const here = new Map<string, number>()
  const elsewhere = new Map<string, number>()
  for (const r of histRes.data ?? []) {
    const n = (r.supplier ?? '').trim()
    if (!n || n === '—') continue
    const m = r.branch_id === branchId ? here : elsewhere
    m.set(n, (m.get(n) ?? 0) + 1)
  }
  for (const r of listRes.data ?? []) {
    const n = (r.name ?? '').trim()
    if (n && !here.has(n) && !elsewhere.has(n)) elsewhere.set(n, 0)
  }

  const known = [
    ...[...here.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
    ...[...elsewhere.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
  ]

  // 1. exact, normalised
  for (const name of known) if (normaliseSupplier(name) === target) return { name, isNew: false }

  // 2. same consonant skeleton — catches בית הבאגט / בית הבגט
  const targetSkel = skeleton(raw)
  if (targetSkel.length >= 3) {
    for (const name of known) if (skeleton(name) === targetSkel) return { name, isNew: false }
  }

  // 3. one contains the other — "טרה" spoken, "טרה חלב" on file
  for (const name of known) {
    const n = normaliseSupplier(name)
    if (n.length < 3 || target.length < 3) continue
    if (n.includes(target) || target.includes(n)) return { name, isNew: false }
  }

  // 4. near miss — one or two characters, scaled so short names stay strict
  const budget = target.length <= 6 ? 1 : 2
  let best: { name: string; d: number } | null = null
  for (const name of known) {
    const d = editDistance(normaliseSupplier(name), target)
    if (d <= budget && (!best || d < best.d)) best = { name, d }
  }
  if (best) return { name: best.name, isNew: false }

  return { name: raw, isNew: true }
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
      return {
        branch_id: branchId,
        // Falls back to the configured base fund when there are no movements,
        // same as the screen and the RPC — not a bare 0.
        balance: ils(await fundBalance(db, branchId)),
        registers: await branchRegisters(db, branchId),
        recent: data ?? [],
      }
    },
  },
]

// ═══════════════════════════════════════════════════════════════════════
// Writes
//
// A mutating tool is NEVER executed when Claude calls it. The call is
// summarised, parked in agent_actions as pending_confirmation, and shown
// to the user. Only an explicit tap runs `run`, and by then the arguments
// are re-read from the database — the client only ever sends an id.
//
// That is what makes it impossible to approve 340 and have 34,000 written.
// See AGENT_PLAN.md section 7.
// ═══════════════════════════════════════════════════════════════════════

TOOLS.push({
  name: 'add_branch_waste',
  description:
    'רישום פחת לסניף. פחת נרשם לפי סכום בלבד — אין צורך במוצר. ' +
    'קטגוריות: end_of_day (סוף יום, ברירת המחדל), finished (מוצר מוגמר), returned_product (מוצר שהוחזר). ' +
    'הפעולה אינה מתבצעת מיד — היא מוצגת למשתמש לאישור.',
  mutates: true,
  allowedRoles: ['admin'],
  requiredPage: (a) => `branch_${a.branch_id}_waste`,
  deniedForRestricted: true,
  input_schema: {
    type: 'object',
    properties: {
      branch_id: { type: 'integer', description: 'מזהה הסניף' },
      date: { type: 'string', description: 'תאריך הפחת, YYYY-MM-DD' },
      amount: { type: 'number', description: 'סכום הפחת בשקלים' },
      category: {
        type: 'string',
        enum: ['end_of_day', 'finished', 'returned_product'],
        description: 'ברירת מחדל end_of_day',
      },
      notes: { type: 'string', description: 'הערה חופשית, אופציונלי' },
    },
    required: ['branch_id', 'date', 'amount'],
  },

  async summarize(args, { db }) {
    const branchId = await assertBranch(db, args.branch_id)
    const date = parseDate(args.date)
    const amount = parseAmount(args.amount)
    const category = String(args.category ?? DEFAULT_WASTE_CATEGORY)
    if (!WASTE_CATEGORIES[category]) throw new Error('קטגוריית פחת לא מוכרת')

    const today = new Date().toISOString().slice(0, 10)
    const warnings = commonWarnings(amount, date, today)

    // Same branch, same day, same amount — almost certainly a repeat.
    const { data: dupe } = await db
      .from('branch_waste')
      .select('id')
      .eq('branch_id', branchId).eq('date', date).eq('amount', amount)
      .limit(1)
    if (dupe?.length) warnings.push('כבר קיים רישום פחת זהה לאותו יום ובאותו סכום')

    const fields = [
      { label: 'סניף', value: await branchName(db, branchId) },
      { label: 'תאריך', value: heDate(date) },
      { label: 'קטגוריה', value: WASTE_CATEGORIES[category] },
    ]
    if (args.notes) fields.push({ label: 'הערה', value: String(args.notes) })

    return { title: 'רישום פחת', fields, amount: money(amount), warnings }
  },

  async run(args, { db }) {
    // Re-validate. These arguments came from the database, but the tool must
    // be safe to call on its own terms.
    const branchId = await assertBranch(db, args.branch_id)
    const date = parseDate(args.date)
    const amount = parseAmount(args.amount)
    const category = String(args.category ?? DEFAULT_WASTE_CATEGORY)
    if (!WASTE_CATEGORIES[category]) throw new Error('קטגוריית פחת לא מוכרת')

    const { data, error } = await db
      .from('branch_waste')
      .insert({
        branch_id: branchId,
        date,
        amount,
        category,
        notes: args.notes ? String(args.notes) : null,
        // product_id stays null — waste is recorded by amount only.
      })
      .select('id')
      .single()

    if (error) {
      console.error('[add_branch_waste]', error.message)
      throw new Error('הרישום נכשל')
    }

    return {
      table: 'branch_waste',
      id: String(data.id),
      message: `נרשם פחת ${money(amount)} ב${await branchName(db, branchId)} לתאריך ${heDate(date)}`,
    }
  },
})

TOOLS.push({
  name: 'add_branch_expense',
  description:
    'רישום הוצאה לסניף. ' +
    'סוגים: suppliers (ספקים, ברירת המחדל), deliveries (משלוחים), repairs (תיקונים), other (אחר). ' +
    'שם הספק נאמר כפי שהוא — המערכת מתאימה אותו לשמות הקיימים. ' +
    'הפעולה אינה מתבצעת מיד — היא מוצגת למשתמש לאישור.',
  mutates: true,
  allowedRoles: ['admin'],
  requiredPage: (a) => `branch_${a.branch_id}_expenses`,
  deniedForRestricted: true,
  input_schema: {
    type: 'object',
    properties: {
      branch_id: { type: 'integer', description: 'מזהה הסניף' },
      date: { type: 'string', description: 'תאריך ההוצאה, YYYY-MM-DD' },
      amount: { type: 'number', description: 'סכום ההוצאה בשקלים' },
      supplier: { type: 'string', description: 'שם הספק כפי שנאמר' },
      expense_type: {
        type: 'string',
        enum: ['suppliers', 'deliveries', 'repairs', 'other'],
        description: 'ברירת מחדל suppliers',
      },
      doc_number: { type: 'string', description: 'מספר חשבונית, אופציונלי' },
      notes: { type: 'string', description: 'הערה חופשית, אופציונלי' },
    },
    required: ['branch_id', 'date', 'amount', 'supplier'],
  },

  async summarize(args, { db }) {
    const branchId = await assertBranch(db, args.branch_id)
    const date = parseDate(args.date)
    const amount = parseAmount(args.amount)
    const type = String(args.expense_type ?? DEFAULT_EXPENSE_TYPE)
    if (!EXPENSE_TYPES[type]) throw new Error('סוג הוצאה לא מוכר')

    const supplier = await resolveSupplier(db, branchId, String(args.supplier ?? ''))

    const today = new Date().toISOString().slice(0, 10)
    const warnings = commonWarnings(amount, date, today)
    if (supplier.isNew) warnings.push(`"${supplier.name}" הוא ספק חדש — לא נרשמו לו הוצאות בסניף הזה`)

    const { data: dupe } = await db
      .from('branch_expenses')
      .select('id')
      .eq('branch_id', branchId).eq('date', date).eq('amount', amount)
      .eq('supplier', supplier.name)
      .limit(1)
    if (dupe?.length) warnings.push('כבר קיימת הוצאה זהה לאותו ספק, יום וסכום')

    const fields = [
      { label: 'סניף', value: await branchName(db, branchId) },
      { label: 'תאריך', value: heDate(date) },
      { label: 'ספק', value: supplier.name },
      { label: 'סוג', value: EXPENSE_TYPES[type] },
    ]
    if (args.doc_number) fields.push({ label: 'חשבונית', value: String(args.doc_number) })
    if (args.notes) fields.push({ label: 'הערה', value: String(args.notes) })

    return { title: 'רישום הוצאה', fields, amount: money(amount), warnings }
  },

  async run(args, { db }) {
    const branchId = await assertBranch(db, args.branch_id)
    const date = parseDate(args.date)
    const amount = parseAmount(args.amount)
    const type = String(args.expense_type ?? DEFAULT_EXPENSE_TYPE)
    if (!EXPENSE_TYPES[type]) throw new Error('סוג הוצאה לא מוכר')
    const supplier = await resolveSupplier(db, branchId, String(args.supplier ?? ''))

    const { data, error } = await db
      .from('branch_expenses')
      .insert({
        branch_id: branchId,
        date,
        amount,
        supplier: supplier.name,
        expense_type: type,
        doc_number: args.doc_number ? String(args.doc_number) : null,
        notes: args.notes ? String(args.notes) : null,
        // ALWAYS false. from_factory=true rows take precedence over
        // internal_sales; creating one here would double-count factory
        // purchases. Those rows come from the factory flow only.
        from_factory: false,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[add_branch_expense]', error.message)
      throw new Error('הרישום נכשל')
    }

    return {
      table: 'branch_expenses',
      id: String(data.id),
      message: `נרשמה הוצאה ${money(amount)} ל${supplier.name} ב${await branchName(db, branchId)} לתאריך ${heDate(date)}`,
    }
  },
})

const FUND_TYPES: Record<string, string> = {
  income: 'הכנסה לקופת עודף',
  expense: 'הוצאה מקופת עודף',
  withdraw_to_register: 'משיכה לקופה',
  push_from_register: 'דחיפה מקופה',
}

/** Registers are derived from history, never from a hardcoded map. */
async function branchRegisters(db: SupabaseClient, branchId: number): Promise<number[]> {
  const { data } = await db
    .from('register_closings')
    .select('register_number')
    .eq('branch_id', branchId)
    .range(0, 9999)
  return [...new Set((data ?? []).map((r) => Number(r.register_number)))].sort((a, b) => a - b)
}

/** Current fund balance: last movement, else the configured base. Mirrors the RPC. */
async function fundBalance(db: SupabaseClient, branchId: number): Promise<number> {
  const { data } = await db
    .from('change_fund').select('balance_after')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false }).limit(1)
  if (data?.length) return Number(data[0].balance_after || 0)

  const { data: setting } = await db
    .from('system_settings').select('value')
    .eq('key', `change_fund_base_${branchId}`).maybeSingle()
  return setting ? Number(setting.value || 0) : 0
}

TOOLS.push({
  name: 'add_change_fund_movement',
  description:
    'תנועה בקופת העודף של סניף. סוגים: income (כסף נכנס לקופת העודף), expense (כסף יוצא ממנה), ' +
    'withdraw_to_register (משיכה מקופת העודף אל קופה רושמת — דורש מספר קופה), ' +
    'push_from_register (העברה מקופה רושמת אל קופת העודף — דורש מספר קופה). ' +
    'הסכום תמיד חיובי; הכיוון נקבע לפי הסוג. הפעולה מוצגת למשתמש לאישור לפני ביצוע.',
  mutates: true,
  allowedRoles: ['admin'],
  requiredPage: (a) => `branch_${a.branch_id}_change_fund`,
  input_schema: {
    type: 'object',
    properties: {
      branch_id: { type: 'integer' },
      type: {
        type: 'string',
        enum: ['income', 'expense', 'withdraw_to_register', 'push_from_register'],
      },
      amount: { type: 'number', description: 'סכום חיובי בשקלים' },
      register_number: { type: 'integer', description: 'חובה עבור משיכה או דחיפה' },
      description: { type: 'string', description: 'תיאור, אופציונלי' },
    },
    required: ['branch_id', 'type', 'amount'],
  },

  async summarize(args, { db }) {
    const branchId = await assertBranch(db, args.branch_id)
    const amount = parseAmount(args.amount)
    const type = String(args.type ?? '')
    if (!FUND_TYPES[type]) throw new Error('סוג תנועה לא מוכר')

    const needsRegister = type === 'withdraw_to_register' || type === 'push_from_register'
    let register: number | null = null
    const warnings: string[] = []

    if (needsRegister) {
      if (args.register_number == null) throw new Error('יש לציין מספר קופה')
      register = Number(args.register_number)
      const registers = await branchRegisters(db, branchId)
      if (registers.length && !registers.includes(register)) {
        return {
          title: FUND_TYPES[type], fields: [], warnings: [],
          blocker: `קופה ${register} אינה שייכת לסניף. הקופות בסניף: ${registers.join(', ')}.`,
        }
      }
    }

    if (amount > LARGE_AMOUNT) {
      warnings.push(`סכום חריג — מעל ${LARGE_AMOUNT.toLocaleString('he-IL')} ₪`)
    }

    const before = await fundBalance(db, branchId)
    const signed = (type === 'income' || type === 'push_from_register') ? amount : -amount
    const after = ils(before + signed)

    if (after < 0) {
      warnings.push(`היתרה תרד מתחת לאפס (${money(after)})`)
    }

    const fields = [
      { label: 'סניף', value: await branchName(db, branchId) },
      { label: 'פעולה', value: FUND_TYPES[type] },
    ]
    if (register != null) fields.push({ label: 'קופה', value: String(register) })
    fields.push(
      { label: 'יתרה נוכחית', value: money(before) },
      { label: 'יתרה אחרי', value: money(after) },
    )
    if (args.description) fields.push({ label: 'תיאור', value: String(args.description) })

    return {
      title: FUND_TYPES[type],
      fields,
      amount: `${signed < 0 ? '−' : '+'}${money(amount)}`,
      warnings,
    }
  },

  async run(args, { db }) {
    const branchId = await assertBranch(db, args.branch_id)
    const amount = parseAmount(args.amount)
    const type = String(args.type ?? '')
    if (!FUND_TYPES[type]) throw new Error('סוג תנועה לא מוכר')

    // One RPC, one transaction. The balance chain and the register's opening
    // move together or not at all — see sql/072_change_fund_movement.sql.
    const { data, error } = await db.rpc('change_fund_movement', {
      p_branch_id: branchId,
      p_type: type,
      p_amount: amount,
      p_description: args.description ? String(args.description) : null,
      p_register_number: args.register_number != null ? Number(args.register_number) : null,
    })

    if (error) {
      console.error('[add_change_fund_movement]', error.message)
      // The function raises Hebrew messages; pass them through when present.
      throw new Error(/[֐-׿]/.test(error.message) ? error.message : 'הרישום נכשל')
    }

    const out = data as { id: number; balance_after: number }
    return {
      table: 'change_fund',
      id: String(out.id),
      message: `${FUND_TYPES[type]} ${money(amount)} — היתרה בקופת העודף כעת ${money(Number(out.balance_after))}`,
    }
  },
})

// ─── Special cake orders ────────────────────────────────────────────────
//
// MIRRORED from src/pages/BranchSpecialOrders.tsx:57-76. Edge functions
// cannot import from src/. If the form's constants change, change these too.

const MEDIUM_ROUND = 'עגולה בינונית'
const BASE_SIZES = ['עגולה גדולה', MEDIUM_ROUND, 'ריבוע', 'רבע פלטה', 'לב']
const TORTE_FLAVORS = ['וניל', 'שוקולד']
const CREAMS: Record<string, string[]> = {
  'חלבי': ['שאנטי שוקולד', 'וניל'],
  'פרווה': ['קרם שוקולד פרווה', 'קרם וניל פרווה'],
}
const FILLINGS: Record<string, string[]> = {
  'חלבי': ['ריבת חלב', 'תות', 'אוכמניות', 'שוקולד', 'קרם בלבד'],
  'פרווה': ['תות', 'אוכמניות', 'שוקולד', 'קרמל', 'קרם בלבד'],
}
const PRESETS: Record<string, string[]> = {
  'חלבי': ['ריבת חלב', 'שאנטי שוקולד', 'פירות יער', 'היער השחור'],
  'פרווה': ['קרם שוקולד', 'שוקו שוקו', 'קרמל', 'אוכמניות'],
}
const COATINGS = ['מזרה סוכריות', 'קוקוס קלוי', 'אגוזי מלך טחונים', 'קרם חלק', 'שתי וערב']
const SPRINKLE = 'מזרה סוכריות'
const SPRINKLE_COLORS = ['צבעוניות', 'לבנות', 'חומות', 'ורודות', 'תכלת']
const CROWNS = ['ללא', 'לבן', 'חום', 'ורוד', 'תכלת', 'תכלת-לבן', 'ורוד-לבן', 'חום-לבן']
const EXTRAS = ['דובדבנים', 'דובדבנים אקסטרה', 'כדורי שוקולד', 'אגוזי מלך (בתוך העוגה)']

/** Loose match against a closed list, so transcription wobble still lands. */
function pickOption(spoken: unknown, options: string[]): string | null {
  const raw = String(spoken ?? '').trim()
  if (!raw) return null
  const t = normaliseSupplier(raw)
  for (const o of options) if (normaliseSupplier(o) === t) return o
  const ts = skeleton(raw)
  if (ts.length >= 2) for (const o of options) if (skeleton(o) === ts) return o
  for (const o of options) {
    const n = normaliseSupplier(o)
    if (n.includes(t) || t.includes(n)) return o
  }
  for (const o of options) if (editDistance(normaliseSupplier(o), t) <= (t.length <= 6 ? 1 : 2)) return o
  return null
}

TOOLS.push({
  name: 'create_special_order',
  description:
    'יצירת הזמנת עוגה מיוחדת. ' +
    'סוג: חלבי או פרווה. גדלים: ' + BASE_SIZES.join(' / ') + '. ' +
    `אם הגודל הוא "${MEDIUM_ROUND}" — חובה לבחור עוגה מוכנה (preset_cake), ואין צורך בטורט/קרם/מילוי. ` +
    'אחרת — חובה טורט, קרם ומילוי. ' +
    'ציפויים: ' + COATINGS.join(' / ') + `. אם הציפוי הוא "${SPRINKLE}" — חובה גוון: ` + SPRINKLE_COLORS.join(' / ') + '. ' +
    'כתר: ' + CROWNS.join(' / ') + '. ' +
    'מסור את הערכים כפי שנאמרו — המערכת מתאימה אותם לרשימה. ' +
    'הפעולה מוצגת לאישור לפני ביצוע.',
  mutates: true,
  allowedRoles: ['admin'],
  requiredPage: (a) => `branch_${a.branch_id}_special_orders`,
  input_schema: {
    type: 'object',
    properties: {
      branch_id: { type: 'integer' },
      customer_name: { type: 'string', description: 'שם הלקוח' },
      pickup_date: { type: 'string', description: 'תאריך איסוף, YYYY-MM-DD' },
      pickup_time: { type: 'string', description: 'שעת איסוף, HH:MM, אופציונלי' },
      customer_phone: { type: 'string', description: 'טלפון, אופציונלי' },
      type: { type: 'string', enum: ['חלבי', 'פרווה'] },
      base_size: { type: 'string', description: BASE_SIZES.join(' / ') },
      preset_cake: { type: 'string', description: `רק כאשר הגודל הוא ${MEDIUM_ROUND}` },
      torte_flavor: { type: 'string', description: TORTE_FLAVORS.join(' / ') },
      cream_between: { type: 'string', description: 'תלוי בסוג' },
      filling: { type: 'string', description: 'תלוי בסוג' },
      coating: { type: 'string', description: COATINGS.join(' / ') },
      sprinkle_color: { type: 'string', description: `רק כאשר הציפוי הוא ${SPRINKLE}` },
      crown: { type: 'string', description: CROWNS.join(' / ') },
      extras: { type: 'array', items: { type: 'string' }, description: EXTRAS.join(' / ') },
      notes: { type: 'string' },
      order_number_manual: { type: 'string', description: 'מספר הזמנה ידני, אופציונלי' },
    },
    required: ['branch_id', 'customer_name', 'pickup_date', 'type', 'base_size', 'coating', 'crown'],
  },

  async summarize(args, { db }) {
    const branchId = await assertBranch(db, args.branch_id)
    const missing: string[] = []

    const customer = String(args.customer_name ?? '').trim()
    if (!customer) missing.push('שם לקוח')

    const pickup = String(args.pickup_date ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickup)) missing.push('תאריך איסוף')

    const type = pickOption(args.type, ['חלבי', 'פרווה'])
    if (!type) missing.push('סוג — חלבי או פרווה')

    const baseSize = pickOption(args.base_size, BASE_SIZES)
    if (!baseSize) missing.push(`גודל — ${BASE_SIZES.join(' / ')}`)

    const coatingBase = pickOption(args.coating, COATINGS)
    if (!coatingBase) missing.push(`ציפוי — ${COATINGS.join(' / ')}`)

    const crown = pickOption(args.crown, CROWNS)
    if (!crown) missing.push(`כתר — ${CROWNS.join(' / ')}`)

    let preset: string | null = null
    let torte: string | null = null
    let cream: string | null = null
    let filling: string | null = null

    if (baseSize === MEDIUM_ROUND && type) {
      preset = pickOption(args.preset_cake, PRESETS[type])
      if (!preset) missing.push(`עוגה מוכנה — ${PRESETS[type].join(' / ')}`)
    } else if (baseSize && type) {
      torte = pickOption(args.torte_flavor, TORTE_FLAVORS)
      if (!torte) missing.push(`טעם טורט — ${TORTE_FLAVORS.join(' / ')}`)
      cream = pickOption(args.cream_between, CREAMS[type])
      if (!cream) missing.push(`קרם — ${CREAMS[type].join(' / ')}`)
      filling = pickOption(args.filling, FILLINGS[type])
      if (!filling) missing.push(`מילוי — ${FILLINGS[type].join(' / ')}`)
    }

    let coating = coatingBase
    if (coatingBase === SPRINKLE) {
      const colour = pickOption(args.sprinkle_color, SPRINKLE_COLORS)
      if (!colour) missing.push(`גוון סוכריות — ${SPRINKLE_COLORS.join(' / ')}`)
      else coating = `${SPRINKLE} - ${colour}`
    }

    const extras = Array.isArray(args.extras)
      ? (args.extras as unknown[]).map((e) => pickOption(e, EXTRAS)).filter(Boolean) as string[]
      : []

    // Everything missing is reported at once, so the user is asked one time
    // rather than dragged through a field-by-field interrogation.
    if (missing.length) {
      return {
        title: 'הזמנת עוגה', fields: [], warnings: [],
        blocker: `חסר כדי ליצור את ההזמנה:\n· ${missing.join('\n· ')}`,
      }
    }

    const warnings: string[] = []
    const today = new Date().toISOString().slice(0, 10)
    if (pickup < today) warnings.push('תאריך האיסוף כבר עבר')

    const { data: dupe } = await db
      .from('special_orders')
      .select('order_number')
      .eq('branch_id', branchId).eq('customer_name', customer).eq('pickup_date', pickup)
      .not('status', 'eq', 'cancelled')
      .limit(1)
    if (dupe?.length) warnings.push(`כבר קיימת הזמנה ל${customer} לאותו תאריך`)

    const fields = [
      { label: 'סניף', value: await branchName(db, branchId) },
      { label: 'לקוח', value: customer },
      { label: 'איסוף', value: heDate(pickup) + (args.pickup_time ? ` ${args.pickup_time}` : '') },
      { label: 'סוג', value: type! },
      { label: 'בסיס', value: baseSize! },
    ]
    if (preset) fields.push({ label: 'עוגה מוכנה', value: preset })
    else fields.push(
      { label: 'טורט', value: torte! },
      { label: 'קרם', value: cream! },
      { label: 'מילוי', value: filling! },
    )
    fields.push({ label: 'ציפוי', value: coating! }, { label: 'כתר', value: crown! })
    if (extras.length) fields.push({ label: 'תוספות', value: extras.join(', ') })
    if (args.customer_phone) fields.push({ label: 'טלפון', value: String(args.customer_phone) })
    if (args.notes) fields.push({ label: 'הערות', value: String(args.notes) })

    return { title: 'הזמנת עוגה מיוחדת', fields, warnings }
  },

  async run(args, { db, user }) {
    const branchId = await assertBranch(db, args.branch_id)
    const type = pickOption(args.type, ['חלבי', 'פרווה'])!
    const baseSize = pickOption(args.base_size, BASE_SIZES)!
    const isPreset = baseSize === MEDIUM_ROUND

    let coating = pickOption(args.coating, COATINGS)!
    if (coating === SPRINKLE) {
      const colour = pickOption(args.sprinkle_color, SPRINKLE_COLORS)
      if (!colour) throw new Error('חסר גוון סוכריות')
      coating = `${SPRINKLE} - ${colour}`
    }

    const extras = Array.isArray(args.extras)
      ? (args.extras as unknown[]).map((e) => pickOption(e, EXTRAS)).filter(Boolean) as string[]
      : []

    const { data, error } = await db.rpc('create_special_order', {
      p_branch_id: branchId,
      p_customer_name: String(args.customer_name).trim(),
      p_pickup_date: String(args.pickup_date),
      p_type: type,
      p_base_size: baseSize,
      p_coating: coating,
      p_crown: pickOption(args.crown, CROWNS)!,
      p_torte_flavor: isPreset ? null : pickOption(args.torte_flavor, TORTE_FLAVORS),
      p_cream_between: isPreset ? null : pickOption(args.cream_between, CREAMS[type]),
      p_filling: isPreset ? null : pickOption(args.filling, FILLINGS[type]),
      p_preset_cake: isPreset ? pickOption(args.preset_cake, PRESETS[type]) : null,
      p_pickup_time: args.pickup_time ? String(args.pickup_time) : null,
      p_customer_phone: args.customer_phone ? String(args.customer_phone) : null,
      p_extras: extras.length ? extras : null,
      p_notes: args.notes ? String(args.notes) : null,
      p_manual_number: args.order_number_manual ? String(args.order_number_manual) : null,
      p_created_by: user.id,
    })

    if (error) {
      console.error('[create_special_order]', error.message)
      throw new Error(/[֐-׿]/.test(error.message) ? error.message : 'יצירת ההזמנה נכשלה')
    }

    const out = data as { id: number; order_number: string; notified: number }
    return {
      table: 'special_orders',
      id: String(out.id),
      message: `נוצרה הזמנה ${out.order_number} ל${String(args.customer_name).trim()}. המפעל עודכן.`,
    }
  },
})

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
