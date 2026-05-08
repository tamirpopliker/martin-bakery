// ═══════════════════════════════════════════════════════════════════════
// Shared labor + revenue queries for Edge Functions.
//
// Mirrors the priority chain from src/lib/calculatePL.ts so email reports
// and alerts use the SAME numbers as the in-app dashboards:
//   - Branch revenue = branch_revenue + register_closings (cash + credit)
//   - Branch labor   = employer_costs (is_manager=false) for the month if
//                      uploaded; otherwise branch_labor (per-day estimate)
//   - Factory labor  = employer_costs (factory dept rows) for the month if
//                      uploaded; otherwise labor (entity_type='factory')
//
// All functions take a SupabaseClient instance so callers control the auth
// context (service-role for Edge Functions; can be reused by other Deno-side
// callers too).
// ═══════════════════════════════════════════════════════════════════════

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Factory department name → employer_costs.department_number (per the upload's
// DEPT_MAP). MUST match src/pages/EmployerCostsUpload.tsx and the upload UI.
const FACTORY_DEPT_NUMBERS: Record<string, number[]> = {
  dough: [5],
  creams: [6],
  cleaning: [7],
  packaging: [8],
}

/** Returns YYYY-MM key for the first day of the month containing `from`. */
function monthKeyOf(from: string): string {
  return from.slice(0, 7)
}

/** Returns true if [from, to) covers exactly one full calendar month. */
function isFullMonthRange(from: string, to: string): boolean {
  const [fy, fm, fd] = from.split('-').map(Number)
  if (fd !== 1) return false
  const expectedTo = fm === 12
    ? `${fy + 1}-01-01`
    : `${fy}-${String(fm + 1).padStart(2, '0')}-01`
  return to === expectedTo
}

// ─── Revenue ────────────────────────────────────────────────────────────

export interface RevenueRow {
  date: string
  source: string
  amount: number
  transaction_count?: number
}

/**
 * Branch revenue including register_closings cash+credit. Returns rows in the
 * same shape as the legacy branch_revenue query so existing consumers that
 * `.reduce((s, r) => s + Number(r.amount), 0)` keep working.
 */
export async function getBranchRevenueWithClosings(
  db: SupabaseClient,
  branchId: number,
  from: string,
  to: string,
): Promise<RevenueRow[]> {
  const [revRes, closeRes] = await Promise.all([
    db.from('branch_revenue')
      .select('date, source, amount, transaction_count')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .range(0, 99999),
    db.from('register_closings')
      .select('date, cash_sales, credit_sales')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .range(0, 99999),
  ])
  const revenue: RevenueRow[] = (revRes.data || []) as RevenueRow[]
  const closings: RevenueRow[] = (closeRes.data || []).map((c) => ({
    date: c.date,
    source: 'cashier',
    amount: Number(c.cash_sales || 0) + Number(c.credit_sales || 0),
    transaction_count: 0,
  }))
  return [...revenue, ...closings]
}

// ─── Labor ──────────────────────────────────────────────────────────────

export interface LaborRow {
  date: string
  employer_cost: number
  gross_salary?: number
  hours_100?: number
  hours_125?: number
  hours_150?: number
}

/**
 * Branch labor with employer_costs fallback.
 * - If the date range spans a full calendar month AND employer_costs has rows
 *   for that month+branch, returns synthesized monthly-total rows from
 *   employer_costs (excluding is_manager=true).
 * - Otherwise returns branch_labor rows (daily estimate).
 *
 * Result shape matches the legacy branch_labor query so callers can keep using
 * `.reduce((s, r) => s + Number(r.employer_cost), 0)`.
 */
export async function getBranchLaborWithFallback(
  db: SupabaseClient,
  branchId: number,
  from: string,
  to: string,
): Promise<LaborRow[]> {
  if (isFullMonthRange(from, to)) {
    const monthKey = monthKeyOf(from)
    const [year, month] = monthKey.split('-').map(Number)
    const { data: ec } = await db
      .from('employer_costs')
      .select('actual_employer_cost, is_manager')
      .eq('branch_id', branchId)
      .eq('year', year)
      .eq('month', month)
    if (ec && ec.length > 0) {
      const total = ec
        .filter((r) => !r.is_manager)
        .reduce((s, r) => s + Number(r.actual_employer_cost || 0), 0)
      // Synthesize a single row dated to the first of the month so consumers
      // that aggregate by date still work.
      return [{ date: from, employer_cost: total }]
    }
  }
  const { data } = await db
    .from('branch_labor')
    .select('date, employer_cost, gross_salary')
    .eq('branch_id', branchId)
    .gte('date', from).lt('date', to)
  return (data || []) as LaborRow[]
}

/**
 * Manager salary for the branch for the month (from employer_costs). Returns
 * 0 if no employer_costs uploaded for that month — callers can sum into total
 * labor or display separately.
 */
export async function getBranchManagerSalary(
  db: SupabaseClient,
  branchId: number,
  monthKey: string,
): Promise<number> {
  const [year, month] = monthKey.split('-').map(Number)
  const { data } = await db
    .from('employer_costs')
    .select('actual_employer_cost')
    .eq('branch_id', branchId)
    .eq('is_manager', true)
    .eq('year', year)
    .eq('month', month)
  return (data || []).reduce((s, r) => s + Number(r.actual_employer_cost || 0), 0)
}

/**
 * Factory labor with employer_costs fallback.
 * - For full-month ranges, sums employer_costs rows whose department_number
 *   maps to the requested department (per FACTORY_DEPT_NUMBERS).
 * - Otherwise returns rows from `labor` table (legacy daily breakdown).
 */
export async function getFactoryLaborWithFallback(
  db: SupabaseClient,
  department: string,
  from: string,
  to: string,
): Promise<LaborRow[]> {
  if (isFullMonthRange(from, to)) {
    const deptNums = FACTORY_DEPT_NUMBERS[department] || []
    if (deptNums.length > 0) {
      const monthKey = monthKeyOf(from)
      const [year, month] = monthKey.split('-').map(Number)
      const { data: ec } = await db
        .from('employer_costs')
        .select('actual_employer_cost, actual_hours, is_manager, is_headquarters, department_number')
        .is('branch_id', null)
        .eq('is_manager', false)
        .eq('is_headquarters', false)
        .eq('year', year)
        .eq('month', month)
        .in('department_number', deptNums)
      if (ec && ec.length > 0) {
        const cost = ec.reduce((s, r) => s + Number(r.actual_employer_cost || 0), 0)
        const hours = ec.reduce((s, r) => s + Number(r.actual_hours || 0), 0)
        return [{
          date: from,
          employer_cost: cost,
          hours_100: hours,
          hours_125: 0,
          hours_150: 0,
        }]
      }
    }
  }
  const { data } = await db
    .from('labor')
    .select('date, employer_cost, hours_100, hours_125, hours_150')
    .eq('entity_type', 'factory')
    .eq('entity_id', department)
    .gte('date', from).lt('date', to)
  return (data || []) as LaborRow[]
}
