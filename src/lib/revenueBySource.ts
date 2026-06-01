import { supabase } from './supabase'

export type RevenueBySource = {
  pos: Record<number, number>      // branchId → ₪ (cash + credit-card from register_closings + legacy branch_revenue.source='cashier')
  website: Record<number, number>  // branchId → ₪
  credit: Record<number, number>   // branchId → ₪ (כולל credit_b2b)
}

/**
 * Single source of truth for per-branch revenue split into 3 channels:
 *   - pos: register_closings (cash_sales + credit_sales) + legacy branch_revenue with source='cashier'
 *   - website: branch_revenue with source='website'
 *   - credit: branch_revenue with source='credit' OR 'credit_b2b' (b2b הקפה)
 *
 * Aggregates across all given branches in a single round-trip per table (no per-branch fan-out).
 * Date bounds follow the codebase convention: .gte('date', from).lt('date', to).
 */
export async function fetchRevenueBySource(
  branchIds: number[],
  from: string,
  to: string,
): Promise<RevenueBySource> {
  const empty: RevenueBySource = { pos: {}, website: {}, credit: {} }
  if (branchIds.length === 0) return empty

  const [revRes, closeRes] = await Promise.all([
    supabase
      .from('branch_revenue')
      .select('branch_id, source, amount')
      .in('branch_id', branchIds)
      .gte('date', from)
      .lt('date', to),
    supabase
      .from('register_closings')
      .select('branch_id, cash_sales, credit_sales')
      .in('branch_id', branchIds)
      .gte('date', from)
      .lt('date', to),
  ])

  const pos: Record<number, number> = {}
  const website: Record<number, number> = {}
  const credit: Record<number, number> = {}
  for (const bid of branchIds) {
    pos[bid] = 0
    website[bid] = 0
    credit[bid] = 0
  }

  for (const row of revRes.data || []) {
    const bid = Number(row.branch_id)
    const amount = Number(row.amount) || 0
    if (row.source === 'cashier') pos[bid] = (pos[bid] || 0) + amount
    else if (row.source === 'website') website[bid] = (website[bid] || 0) + amount
    else if (row.source === 'credit' || row.source === 'credit_b2b') credit[bid] = (credit[bid] || 0) + amount
  }

  for (const row of closeRes.data || []) {
    const bid = Number(row.branch_id)
    pos[bid] = (pos[bid] || 0) + (Number(row.cash_sales) || 0) + (Number(row.credit_sales) || 0)
  }

  return { pos, website, credit }
}
