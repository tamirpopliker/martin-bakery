import { supabase } from './supabase'

export type RevenueBySource = {
  pos: Record<number, number>      // branchId → ₪ (cash + credit-card from register_closings + legacy branch_revenue.source='cashier')
  website: Record<number, number>  // branchId → ₪
  credit: Record<number, number>   // branchId → ₪ (legacy manual הקפה + B2B invoices attributed to the branch, net of VAT)
  creditFactory: number            // ₪ — B2B invoices with no branch (factory-level), net of VAT
}

/**
 * Single source of truth for per-branch revenue split into 3 channels:
 *   - pos: register_closings (cash_sales + credit_sales) + legacy branch_revenue with source='cashier'
 *   - website: branch_revenue with source='website'
 *   - credit (הקפה): legacy manual branch_revenue.source='credit' PLUS B2B invoices
 *     (b2b_invoices.total_before_vat) attributed by the invoice's branch_id.
 *     B2B is read directly from b2b_invoices — the source of truth — rather than
 *     the fragile branch_revenue source='credit_b2b' duplicate rows (which are
 *     intentionally ignored here to avoid double-counting and to capture invoices
 *     that never created a duplicate row).
 *   - creditFactory: B2B invoices with branch_id = null (factory-level).
 *
 * הקפה is net of VAT (b2b before_vat), consistent with the manual entry
 * "סכום ללא מע"מ". Aggregates in a single round-trip per table.
 */
export async function fetchRevenueBySource(
  branchIds: number[],
  from: string,
  to: string,
): Promise<RevenueBySource> {
  const empty: RevenueBySource = { pos: {}, website: {}, credit: {}, creditFactory: 0 }
  if (branchIds.length === 0) return empty

  const [revRes, closeRes, b2bRes] = await Promise.all([
    supabase
      .from('branch_revenue')
      .select('branch_id, source, amount')
      .in('branch_id', branchIds)
      .gte('date', from)
      .lt('date', to),
    supabase
      .from('register_closings')
      .select('branch_id, cash_sales, credit_sales, check_sales')
      .in('branch_id', branchIds)
      .gte('date', from)
      .lt('date', to),
    supabase
      .from('b2b_invoices')
      .select('branch_id, total_before_vat')
      .gte('invoice_date', from)
      .lt('invoice_date', to),
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
    // Manual הקפה + B2B invoices (credit_b2b, backfilled for every branch invoice).
    else if (row.source === 'credit' || row.source === 'credit_b2b') credit[bid] = (credit[bid] || 0) + amount
  }

  for (const row of closeRes.data || []) {
    const bid = Number(row.branch_id)
    pos[bid] = (pos[bid] || 0)
      + (Number(row.cash_sales) || 0)
      + (Number(row.credit_sales) || 0)
      + (Number((row as any).check_sales) || 0)
  }

  // Factory-level B2B (no branch) has no branch_revenue home, so read it straight
  // from b2b_invoices. Branch-attributed B2B is already in credit above (backfilled
  // credit_b2b rows), so it is NOT re-added here.
  let creditFactory = 0
  for (const row of b2bRes.data || []) {
    if (row.branch_id == null) creditFactory += Number(row.total_before_vat) || 0
  }

  return { pos, website, credit, creditFactory }
}
