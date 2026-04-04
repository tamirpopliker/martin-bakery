/**
 * Profit calculation functions using the branch_pl_summary Supabase View.
 * Single source of truth for P&L calculations across all dashboards.
 */
import { supabase } from './supabase'

export interface BranchProfitResult {
  branchId: number
  revenue: number
  internalSupplierCost: number
  externalSupplierCost: number
  totalSupplierCost: number
  laborCost: number
  grossProfit: number
  operatingProfit: number
  grossMargin: number      // % of revenue
  operatingMargin: number  // % of revenue
}

/**
 * Fetch P&L summary for a single branch from the branch_pl_summary view.
 * The view aggregates data per branch per month.
 */
export async function fetchBranchProfit(
  branchId: number,
  startDate: string,
  endDate: string
): Promise<BranchProfitResult> {
  // month column is DATE type — must use YYYY-MM-01 format
  const startMonth = startDate.slice(0, 7) + '-01'
  const endMonth = endDate.slice(0, 7) + '-01'

  const { data, error } = await supabase
    .from('branch_pl_summary')
    .select('*')
    .eq('branch_id', branchId)
    .gte('month', startMonth)
    .lte('month', endMonth)

  if (error) {
    console.error('fetchBranchProfit error:', error)
    return emptyResult(branchId)
  }

  if (!data || data.length === 0) {
    return emptyResult(branchId)
  }

  // Aggregate across months if multiple
  const revenue = data.reduce((s, r) => s + Number(r.revenue || 0), 0)
  const internalSupplierCost = data.reduce((s, r) => s + Number(r.internal_supplier_cost || 0), 0)
  const externalSupplierCost = data.reduce((s, r) => s + Number(r.external_supplier_cost || 0), 0)
  const totalSupplierCost = data.reduce((s, r) => s + Number(r.total_supplier_cost || 0), 0)
  const laborCost = data.reduce((s, r) => s + Number(r.labor_cost || 0), 0)
  const grossProfit = data.reduce((s, r) => s + Number(r.gross_profit || 0), 0)
  const operatingProfit = data.reduce((s, r) => s + Number(r.operating_profit || 0), 0)

  return {
    branchId,
    revenue,
    internalSupplierCost,
    externalSupplierCost,
    totalSupplierCost,
    laborCost,
    grossProfit,
    operatingProfit,
    grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    operatingMargin: revenue > 0 ? (operatingProfit / revenue) * 100 : 0,
  }
}

/**
 * Fetch P&L summary for multiple branches at once.
 */
export async function fetchAllBranchesProfit(
  branchIds: number[],
  startDate: string,
  endDate: string
): Promise<BranchProfitResult[]> {
  // month column is DATE type — must use YYYY-MM-01 format
  const startMonth = startDate.slice(0, 7) + '-01'
  const endMonth = endDate.slice(0, 7) + '-01'

  const { data, error } = await supabase
    .from('branch_pl_summary')
    .select('*')
    .in('branch_id', branchIds)
    .gte('month', startMonth)
    .lte('month', endMonth)

  if (error) {
    console.error('fetchAllBranchesProfit error:', error)
    return branchIds.map(id => emptyResult(id))
  }

  // Group by branch_id and aggregate
  return branchIds.map(branchId => {
    const rows = (data || []).filter(r => r.branch_id === branchId)
    if (rows.length === 0) return emptyResult(branchId)

    const revenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0)
    const internalSupplierCost = rows.reduce((s, r) => s + Number(r.internal_supplier_cost || 0), 0)
    const externalSupplierCost = rows.reduce((s, r) => s + Number(r.external_supplier_cost || 0), 0)
    const totalSupplierCost = rows.reduce((s, r) => s + Number(r.total_supplier_cost || 0), 0)
    const laborCost = rows.reduce((s, r) => s + Number(r.labor_cost || 0), 0)
    const grossProfit = rows.reduce((s, r) => s + Number(r.gross_profit || 0), 0)
    const operatingProfit = rows.reduce((s, r) => s + Number(r.operating_profit || 0), 0)

    return {
      branchId,
      revenue,
      internalSupplierCost,
      externalSupplierCost,
      totalSupplierCost,
      laborCost,
      grossProfit,
      operatingProfit,
      grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      operatingMargin: revenue > 0 ? (operatingProfit / revenue) * 100 : 0,
    }
  })
}

function emptyResult(branchId: number): BranchProfitResult {
  return {
    branchId,
    revenue: 0,
    internalSupplierCost: 0,
    externalSupplierCost: 0,
    totalSupplierCost: 0,
    laborCost: 0,
    grossProfit: 0,
    operatingProfit: 0,
    grossMargin: 0,
    operatingMargin: 0,
  }
}
