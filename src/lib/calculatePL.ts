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
  managerSalary: number         // fixed_costs WHERE entity_id='mgmt'
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

  const [revRes, expRes, labRes, wasteRes, fcRes] = await Promise.all([
    supabase.from('branch_revenue').select('amount')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('branch_expenses').select('expense_type, amount, from_factory')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('branch_labor').select('employer_cost')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('branch_waste').select('amount')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('fixed_costs').select('amount, entity_id')
      .eq('entity_type', `branch_${branchId}`).eq('month', mk),
  ])

  // Revenue
  const revenue = (revRes.data || []).reduce((s, r) => s + Number(r.amount), 0)

  // Expenses by type
  let factoryPurchases = 0, externalSuppliers = 0, repairs = 0
  let deliveries = 0, infrastructure = 0, otherExpenses = 0
  for (const r of (expRes.data || [])) {
    const amt = Number(r.amount)
    const t = r.expense_type || 'other'
    if (r.from_factory) {
      factoryPurchases += amt
    } else if (t === 'suppliers' || t === 'supplier') {
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

  let labor: number, managerSalary: number
  if (laborIsActual) {
    // Actual payroll data: split into regular labor and manager salary
    labor = actualLabAll!.filter(r => !r.is_manager).reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    managerSalary = actualLabAll!.filter(r => r.is_manager).reduce((s, r) => s + Number(r.actual_employer_cost), 0)
  } else {
    // Estimated: labor from branch_labor, manager from fixed_costs
    labor = (labRes.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)
    managerSalary = 0 // will be set from fixed_costs below
  }

  // Waste
  const waste = (wasteRes.data || []).reduce((s, r) => s + Number(r.amount), 0)

  // Fixed costs: separate manager salary (entity_id='mgmt') from others
  let fixedCosts = 0
  for (const r of (fcRes.data || [])) {
    const amt = Number(r.amount)
    if (r.entity_id === 'mgmt') {
      // Only use fixed_costs manager salary if NO actual payroll data
      if (!laborIsActual) managerSalary += amt
    } else {
      fixedCosts += amt
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
    revenue, factoryPurchases, externalSuppliers, labor, managerSalary,
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

  const [fSalesExt, fSalesInt, fB2bExt, fB2bInt, fLab, fSupp, fWaste, fRepairs, fFixed] = await Promise.all([
    supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_sales').select('amount').eq('is_internal', true).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_b2b_sales').select('amount').eq('is_internal', true).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('labor').select('employer_cost').eq('entity_type', 'factory').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('supplier_invoices').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_waste').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_repairs').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('fixed_costs').select('amount').eq('entity_type', 'factory').eq('month', mk),
  ])

  const sum = (d: any) => (d.data || []).reduce((s: number, r: any) => s + Number(r.amount || r.employer_cost || 0), 0)

  const externalRevenue = sum(fSalesExt) + sum(fB2bExt)
  const internalRevenue = sum(fSalesInt) + sum(fB2bInt)
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
