/**
 * Unified P&L calculation — single source of truth for all dashboards.
 * Uses actual DB schema: branch_revenue, branch_expenses (expense_type, from_factory),
 * branch_labor, branch_waste, fixed_costs (entity_type, entity_id).
 */
import { supabase } from './supabase'

export interface PLResult {
  // Revenue
  revenue: number

  // Variable costs
  factoryPurchases: number      // branch_expenses WHERE from_factory=true
  externalSuppliers: number     // branch_expenses WHERE expense_type='suppliers' AND from_factory=false
  labor: number                 // branch_labor → employer_cost
  managerSalary: number         // employer_costs WHERE is_manager=true (current month, else latest prior)
  managerIsActual: boolean      // true when managerSalary is from current-month employer_costs
  waste: number                 // branch_waste
  repairs: number               // branch_expenses WHERE expense_type='repairs'
  deliveries: number            // branch_expenses WHERE expense_type='deliveries'
  infrastructure: number        // branch_expenses WHERE expense_type='infrastructure'
  otherExpenses: number         // branch_expenses WHERE expense_type='other'

  // Controllable profit
  controllableProfit: number
  controllableMargin: number    // % of revenue

  // Fixed costs
  fixedCosts: number            // fixed_costs (excluding mgmt)
  overhead: number              // overhead allocation

  // Operating profit
  operatingProfit: number
  operatingMargin: number       // % of revenue

  // Config
  overheadPct: number           // actual overhead % used

  // Meta
  branchId: number
  periodStart: string
  periodEnd: string
  laborIsActual: boolean
}

export async function calculateBranchPL(
  branchId: number,
  periodStart: string,
  periodEnd: string,
  overheadPct?: number,
  monthKey?: string
): Promise<PLResult> {
  const mk = monthKey || periodStart.slice(0, 7)

  // Fetch overhead_pct from DB if not provided
  let pct = overheadPct
  if (pct === undefined || pct === null) {
    const { data: branchData } = await supabase
      .from('branches')
      .select('overhead_pct')
      .eq('id', branchId)
      .single()
    pct = Number(branchData?.overhead_pct ?? 5.0)
  }

  const [revRes, expRes, labRes, wasteRes, fcRes, intSalesRes, closingsRes] = await Promise.all([
    supabase.from('branch_revenue').select('amount')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
    supabase.from('branch_expenses').select('expense_type, amount, from_factory')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
    supabase.from('branch_labor').select('employer_cost')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
    supabase.from('branch_waste').select('amount')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
    supabase.from('fixed_costs').select('amount, entity_id')
      .eq('entity_type', `branch_${branchId}`).eq('month', mk),
    supabase.from('internal_sales').select('total_amount')
      .eq('branch_id', branchId).eq('status', 'completed')
      .gte('order_date', periodStart).lt('order_date', periodEnd).range(0, 99999),
    // Register closings (cash + credit) merge into the cashier bucket for current-period revenue.
    supabase.from('register_closings').select('cash_sales, credit_sales')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
  ])

  // Revenue (legacy branch_revenue + newer register_closings)
  const legacyRevenue = (revRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
  const closingsRevenue = (closingsRes.data || []).reduce((s, c) => s + Number(c.cash_sales || 0) + Number(c.credit_sales || 0), 0)
  const revenue = legacyRevenue + closingsRevenue

  // Factory purchases: prefer internal_sales (completed), fallback to branch_expenses from_factory
  const intSalesTotal = (intSalesRes.data || []).reduce((s, r) => s + Number(r.total_amount), 0)
  const expFromFactory = (expRes.data || []).filter(r => r.from_factory).reduce((s, r) => s + Number(r.amount), 0)
  const factoryPurchases = intSalesTotal > 0 ? intSalesTotal : expFromFactory

  // Expenses by type (excluding from_factory — handled above)
  let externalSuppliers = 0, repairs = 0
  let deliveries = 0, infrastructure = 0, otherExpenses = 0
  for (const r of (expRes.data || [])) {
    if (r.from_factory) continue // handled via internal_sales
    const amt = Number(r.amount)
    const t = r.expense_type || 'other'
    if (t === 'suppliers' || t === 'supplier') {
      externalSuppliers += amt
    } else if (t === 'repairs' || t === 'repair') {
      repairs += amt
    } else if (t === 'deliveries' || t === 'delivery') {
      deliveries += amt
    } else if (t === 'infrastructure') {
      infrastructure += amt
    } else {
      otherExpenses += amt
    }
  }

  // Labor + Manager salary — check employer_costs first to prevent double-counting
  const [mYear, mMonth] = mk.split('-').map(Number)
  const { data: actualLabAll } = await supabase.from('employer_costs')
    .select('actual_employer_cost, is_manager').eq('branch_id', branchId).eq('month', mMonth).eq('year', mYear)
  const laborIsActual = (actualLabAll && actualLabAll.length > 0) ? true : false

  let labor: number
  if (laborIsActual) {
    labor = actualLabAll!.filter(r => !r.is_manager).reduce((s, r) => s + Number(r.actual_employer_cost), 0)
  } else {
    labor = (labRes.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)
  }

  // Manager salary: prefer current-month employer_costs is_manager=true; otherwise the latest
  // prior month that does have is_manager=true for this branch (summed across all manager rows).
  const currentMonthManagers = (actualLabAll || []).filter(r => r.is_manager)
  let managerSalary = 0
  let managerIsActual = false
  if (currentMonthManagers.length > 0) {
    managerSalary = currentMonthManagers.reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    managerIsActual = true
  } else {
    const { data: prevMgr } = await supabase.from('employer_costs')
      .select('actual_employer_cost, month, year')
      .eq('branch_id', branchId).eq('is_manager', true)
      .or(`year.lt.${mYear},and(year.eq.${mYear},month.lt.${mMonth})`)
      .order('year', { ascending: false }).order('month', { ascending: false })
    if (prevMgr && prevMgr.length > 0) {
      const { year: lY, month: lM } = prevMgr[0]
      managerSalary = prevMgr
        .filter(r => r.year === lY && r.month === lM)
        .reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    }
  }

  // Waste
  const waste = (wasteRes.data || []).reduce((s, r) => s + Number(r.amount), 0)

  // Fixed costs: separate manager salary (entity_id='mgmt') from others
  let fixedCosts = 0
  let mgmtFromFixed = 0
  for (const r of (fcRes.data || [])) {
    const amt = Number(r.amount)
    if (r.entity_id === 'mgmt') {
      mgmtFromFixed += amt
    } else {
      fixedCosts += amt
    }
  }
  // Legacy fallback: no manager data in employer_costs at all → fall back to fixed_costs mgmt.
  if (managerSalary === 0) {
    if (mgmtFromFixed > 0) {
      managerSalary = mgmtFromFixed
    } else {
      const { data: prevMgmt } = await supabase.from('fixed_costs')
        .select('amount').eq('entity_type', `branch_${branchId}`).eq('entity_id', 'mgmt')
        .lt('month', mk).order('month', { ascending: false }).limit(1)
      if (prevMgmt && prevMgmt.length > 0) {
        managerSalary = Number(prevMgmt[0].amount)
      }
    }
  }

  // Controllable profit = revenue - all variable costs
  const controllableProfit = revenue
    - factoryPurchases - externalSuppliers
    - labor - managerSalary
    - waste - repairs - deliveries - infrastructure - otherExpenses

  const controllableMargin = revenue > 0 ? (controllableProfit / revenue) * 100 : 0

  // Overhead
  const overhead = revenue * pct / 100

  // Operating profit
  const operatingProfit = controllableProfit - fixedCosts - overhead
  const operatingMargin = revenue > 0 ? (operatingProfit / revenue) * 100 : 0

  return {
    revenue, factoryPurchases, externalSuppliers, labor, managerSalary, managerIsActual,
    waste, repairs, deliveries, infrastructure, otherExpenses,
    controllableProfit, controllableMargin,
    fixedCosts, overhead, operatingProfit, operatingMargin,
    overheadPct: pct,
    branchId, periodStart, periodEnd, laborIsActual,
  }
}

export interface FactoryPLResult {
  revenue: number
  internalRevenue: number
  externalRevenue: number
  suppliers: number          // supplier_invoices
  labor: number
  waste: number
  repairs: number
  controllableProfit: number
  fixedCosts: number
  operatingProfit: number
}

export async function calculateFactoryPL(
  periodStart: string,
  periodEnd: string,
  monthKey?: string
): Promise<FactoryPLResult> {
  const mk = monthKey || periodStart.slice(0, 7)

  const [fSalesExt, fSalesInt, fB2bExt, fB2bInt, fLab, fSupp, fWaste, fRepairs, fFixed, intSalesRes] = await Promise.all([
    supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_sales').select('amount').eq('is_internal', true).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_b2b_sales').select('amount').eq('is_internal', true).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('labor').select('employer_cost').eq('entity_type', 'factory').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('supplier_invoices').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_waste').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_repairs').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('fixed_costs').select('amount').eq('entity_type', 'factory').eq('month', mk),
    supabase.from('internal_sales').select('total_amount').eq('status', 'completed').gte('order_date', periodStart).lt('order_date', periodEnd),
  ])

  const sum = (d: any) => (d.data || []).reduce((s: number, r: any) => s + Number(r.amount || r.employer_cost || 0), 0)

  const externalRevenue = sum(fSalesExt) + sum(fB2bExt)
  // Internal revenue: prefer internal_sales, fallback to factory_sales/b2b is_internal
  const intSalesTotal = (intSalesRes.data || []).reduce((s, r) => s + Number(r.total_amount), 0)
  const legacyInternal = sum(fSalesInt) + sum(fB2bInt)
  const internalRevenue = intSalesTotal > 0 ? intSalesTotal : legacyInternal
  const revenue = externalRevenue + internalRevenue
  const suppliers = sum(fSupp)
  // Factory labor — check employer_costs first (branch_id IS NULL, not HQ)
  const [mYear, mMonth] = mk.split('-').map(Number)
  const { data: actualFactLab } = await supabase.from('employer_costs')
    .select('actual_employer_cost').is('branch_id', null).eq('is_headquarters', false).eq('month', mMonth).eq('year', mYear)
  const labor = (actualFactLab && actualFactLab.length > 0)
    ? actualFactLab.reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    : sum(fLab)
  const waste = sum(fWaste)
  const repairs = sum(fRepairs)
  const fixedCosts = sum(fFixed)

  const controllableProfit = revenue - suppliers - labor - waste - repairs
  const operatingProfit = controllableProfit - fixedCosts

  return {
    revenue, internalRevenue, externalRevenue,
    suppliers, labor, waste, repairs,
    controllableProfit, fixedCosts, operatingProfit,
  }
}

export interface ConsolidatedResult {
  branches: PLResult[]
  factory: FactoryPLResult
  consolidated: {
    revenue: number
    suppliers: number
    labor: number
    waste: number
    repairs: number
    fixedCosts: number
    overhead: number
    controllableProfit: number
    operatingProfit: number
  }
  elimination: number  // should be ~0
  eliminationWarning: string | null
}

export async function calculateConsolidatedPL(
  branchIds: number[],
  periodStart: string,
  periodEnd: string,
  overheadPct: number = 5,
  monthKey?: string
): Promise<ConsolidatedResult> {
  const [branches, factory] = await Promise.all([
    Promise.all(branchIds.map(id => calculateBranchPL(id, periodStart, periodEnd, overheadPct, monthKey))),
    calculateFactoryPL(periodStart, periodEnd, monthKey),
  ])

  const totalBranchInternal = branches.reduce((s, b) => s + b.factoryPurchases, 0)
  const elimination = factory.internalRevenue - totalBranchInternal

  const consolidated = {
    revenue: branches.reduce((s, b) => s + b.revenue, 0) + factory.externalRevenue,
    suppliers: factory.suppliers + branches.reduce((s, b) => s + b.externalSuppliers, 0),
    labor: factory.labor + branches.reduce((s, b) => s + b.labor, 0),
    waste: factory.waste + branches.reduce((s, b) => s + b.waste, 0),
    repairs: factory.repairs + branches.reduce((s, b) => s + b.repairs, 0),
    fixedCosts: factory.fixedCosts + branches.reduce((s, b) => s + b.fixedCosts, 0),
    overhead: branches.reduce((s, b) => s + b.overhead, 0),
    controllableProfit: 0,
    operatingProfit: 0,
  }

  consolidated.controllableProfit = consolidated.revenue - consolidated.suppliers - consolidated.labor
  consolidated.operatingProfit = consolidated.controllableProfit - consolidated.waste - consolidated.repairs - consolidated.fixedCosts - consolidated.overhead

  return {
    branches,
    factory,
    consolidated,
    elimination,
    eliminationWarning: Math.abs(elimination) > 1
      ? `⚠️ פער של ₪${Math.round(Math.abs(elimination)).toLocaleString()} בנתונים פנימיים`
      : null,
  }
}
