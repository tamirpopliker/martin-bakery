/**
 * Unified P&L calculation — single source of truth for all dashboards.
 * Uses actual DB schema: branch_revenue, branch_expenses (expense_type, from_factory),
 * branch_labor, branch_waste, fixed_costs (entity_type, entity_id).
 */
import { supabase, fetchGlobalEmployees, calcGlobalLaborForDept, getWorkingDays, countWorkingDaysInRange, getFixedCostTotal, getFixedCostsForMonth } from './supabase'
import type { HQContext } from './plFormulas'
import {
  computeHQAllocation,
  marginPct,
  branchControllableProfit,
  branchOperatingProfit,
  factoryControllableProfit,
  factoryOperatingProfit,
  consolidatedControllableProfit,
  consolidatedOperatingProfit,
} from './plFormulas'

// Re-exported for backwards compatibility: existing modules import these from
// './calculatePL' (e.g. supabase.ts dynamic import). Source of truth now lives
// in ./plFormulas (pure, unit-tested).
export type { HQContext } from './plFormulas'
export { computeHQAllocation } from './plFormulas'

const HQ_ESTIMATE_PCT_DEFAULT = 10

/**
 * Headquarters-cost allocation context for a period. Mirrors the labor pattern:
 * estimate (revenue × pct) until employer_costs is uploaded with is_headquarters=true rows;
 * actual once uploaded (each entity charged its share of external-revenue × actual HQ cost).
 *
 * Pre-fetch this once per period and pass into calculateBranchPL / calculateFactoryPL to avoid
 * repeated cross-entity queries.
 */
export async function getHQAllocationContext(
  periodStart: string,
  periodEnd: string,
  monthKey: string
): Promise<HQContext> {
  const [year, month] = monthKey.split('-').map(Number)

  const { data: branchesData } = await supabase.from('branches').select('id').eq('active', true)
  const branchIds: number[] = (branchesData || []).map((b: { id: number }) => b.id)

  const [hqRes, settingRes, revRes, closeRes, factSalesExtRes, factB2BExtRes] = await Promise.all([
    supabase.from('employer_costs').select('actual_employer_cost')
      .eq('year', year).eq('month', month).eq('is_headquarters', true),
    supabase.from('system_settings').select('value').eq('key', 'hq_estimate_pct').maybeSingle(),
    branchIds.length
      ? supabase.from('branch_revenue').select('branch_id, amount')
          .in('branch_id', branchIds).gte('date', periodStart).lt('date', periodEnd).range(0, 99999)
      : Promise.resolve({ data: [] }),
    branchIds.length
      ? supabase.from('register_closings').select('branch_id, cash_sales, credit_sales, check_sales')
          .in('branch_id', branchIds).gte('date', periodStart).lt('date', periodEnd).range(0, 99999)
      : Promise.resolve({ data: [] }),
    supabase.from('factory_sales').select('amount').eq('is_internal', false)
      .gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false)
      .gte('date', periodStart).lt('date', periodEnd),
  ])

  const hqRows = hqRes.data || []
  const isActual = hqRows.length > 0
  const hqCost = isActual ? hqRows.reduce((s, r) => s + Number(r.actual_employer_cost || 0), 0) : 0
  const estimatePct = Number(settingRes.data?.value ?? HQ_ESTIMATE_PCT_DEFAULT)

  const branchExternalRev: Record<number, number> = {}
  for (const id of branchIds) branchExternalRev[id] = 0
  for (const r of (revRes.data || []) as { branch_id: number; amount: number }[]) {
    branchExternalRev[r.branch_id] = (branchExternalRev[r.branch_id] || 0) + Number(r.amount)
  }
  for (const c of (closeRes.data || []) as { branch_id: number; cash_sales: number; credit_sales: number; check_sales?: number }[]) {
    branchExternalRev[c.branch_id] = (branchExternalRev[c.branch_id] || 0)
      + Number(c.cash_sales || 0) + Number(c.credit_sales || 0) + Number(c.check_sales || 0)
  }

  const factoryExternalRev =
    (factSalesExtRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0) +
    (factB2BExtRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0)

  const totalExternalRevenue =
    Object.values(branchExternalRev).reduce((s, v) => s + v, 0) + factoryExternalRev

  return {
    isActual, hqCost, totalExternalRevenue, estimatePct,
    branchExternalRev, factoryExternalRev,
  }
}

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
  overhead: number              // headquarters allocation (estimate × revenue, or actual share)

  // Operating profit
  operatingProfit: number
  operatingMargin: number       // % of revenue

  // Config
  overheadPct: number           // effective HQ allocation % applied

  // Meta
  branchId: number
  periodStart: string
  periodEnd: string
  laborIsActual: boolean
  hqIsActual: boolean           // true when HQ allocation is from employer_costs (vs. estimate)
}

export async function calculateBranchPL(
  branchId: number,
  periodStart: string,
  periodEnd: string,
  _legacyOverheadPct?: number,    // ignored — HQ allocation now drives overhead
  monthKey?: string,
  hqContext?: HQContext           // pre-fetched context (optional perf optimization)
): Promise<PLResult> {
  void _legacyOverheadPct
  const mk = monthKey || periodStart.slice(0, 7)
  const hq = hqContext || await getHQAllocationContext(periodStart, periodEnd, mk)

  const [revRes, expRes, labRes, wasteRes, fcRes, intSalesRes, closingsRes] = await Promise.all([
    supabase.from('branch_revenue').select('amount')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
    supabase.from('branch_expenses').select('expense_type, amount, from_factory')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
    supabase.from('branch_labor').select('employer_cost, employee_name')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
    supabase.from('branch_waste').select('amount')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
    // getFixedCostsForMonth falls back to the closest prior month when this
    // month has no fixed_costs row (recurring amount), so a missing month no
    // longer zeroes out branch fixed costs. Returns entity_id for the mgmt split.
    getFixedCostsForMonth(`branch_${branchId}`, mk),
    supabase.from('internal_sales').select('total_amount')
      .eq('branch_id', branchId).eq('status', 'completed')
      .gte('order_date', periodStart).lt('order_date', periodEnd).range(0, 99999),
    // Register closings (cash + credit + check) merge into the cashier bucket
    // for current-period revenue. check_sales is added 2026-06-30; legacy rows
    // default to 0 so the sum stays identical for historical periods.
    supabase.from('register_closings').select('cash_sales, credit_sales, check_sales')
      .eq('branch_id', branchId).gte('date', periodStart).lt('date', periodEnd).range(0, 99999),
  ])

  // Revenue (legacy branch_revenue + newer register_closings)
  const legacyRevenue = (revRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
  const closingsRevenue = (closingsRes.data || []).reduce((s, c) =>
    s + Number(c.cash_sales || 0) + Number(c.credit_sales || 0) + Number(c.check_sales || 0), 0)
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
    .select('actual_employer_cost, is_manager, employee_name, employee_number').eq('branch_id', branchId).eq('month', mMonth).eq('year', mYear)
  const laborIsActual = (actualLabAll && actualLabAll.length > 0) ? true : false

  // ── Global-salary branch employees ─────────────────────────────────────
  // Branch employees with monthly_salary set are paid a fixed amount every
  // month regardless of clocked hours (e.g. branch manager on a global salary).
  // They don't necessarily appear in branch_labor and — if they were added mid
  // month after payroll upload — may not appear in employer_costs either. So
  // we always compute their expected contribution here and fold it into
  // labor / managerSalary if the primary source is missing them.
  const { data: brGlobals } = await supabase.from('branch_employees')
    .select('name, monthly_salary, is_manager, payroll_number')
    .eq('branch_id', branchId).eq('active', true)
    .not('monthly_salary', 'is', null).gt('monthly_salary', 0)
  const workingDaysInMonth = await getWorkingDays(mk)
  const workingDaysInPeriod = countWorkingDaysInRange(periodStart, periodEnd)
  const monthFrac = workingDaysInMonth > 0 ? workingDaysInPeriod / workingDaysInMonth : 1
  const brGlobalNames = new Set((brGlobals || []).map(e => e.name))
  const empCostNames = new Set((actualLabAll || []).map(r => r.employee_name).filter(Boolean))
  // Match against employer_costs by the STABLE payroll number (employee_number),
  // not just by name — nicknames differ (e.g. branch "אבי חורב" vs payroll
  // "אברהם אבי חנן חורב") and a name-only check double-counts a manager who IS
  // already in the payroll upload.
  const empCostNumbers = new Set((actualLabAll || []).map(r => Number(r.employee_number)).filter(n => !isNaN(n)))
  const globalsNotInEmpCosts = (brGlobals || []).filter(e =>
    !empCostNames.has(e.name) &&
    !(e.payroll_number != null && empCostNumbers.has(Number(e.payroll_number))))
  const globalMgrFromBranchEmps = globalsNotInEmpCosts
    .filter(e => e.is_manager)
    .reduce((s, e) => s + Number(e.monthly_salary) * 1.3 * monthFrac, 0)
  const globalNonMgrFromBranchEmps = globalsNotInEmpCosts
    .filter(e => !e.is_manager)
    .reduce((s, e) => s + Number(e.monthly_salary) * 1.3 * monthFrac, 0)

  let labor: number
  if (laborIsActual) {
    // employer_costs already includes any global employee that was in payroll.
    // Add globals that were NOT uploaded (empCostNames doesn't cover them).
    labor = actualLabAll!.filter(r => !r.is_manager).reduce((s, r) => s + Number(r.actual_employer_cost), 0)
      + globalNonMgrFromBranchEmps
  } else {
    // Estimate: branch_labor for hourly, plus fixed globals. Exclude globals
    // from the hourly sum by name so we don't double-count when a global
    // employee also happens to have clocked hours.
    const hourlyLabor = (labRes.data || [])
      .filter((r: any) => !brGlobalNames.has(r.employee_name))
      .reduce((s: number, r: any) => s + Number(r.employer_cost), 0)
    labor = hourlyLabor + globalNonMgrFromBranchEmps
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
  for (const r of (fcRes || [])) {
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
    } else if (globalMgrFromBranchEmps > 0) {
      // New: branch employees flagged is_manager with a monthly_salary but
      // not represented in employer_costs / fixed_costs yet (e.g. new hire).
      managerSalary = globalMgrFromBranchEmps
    } else {
      const { data: prevMgmt } = await supabase.from('fixed_costs')
        .select('amount').eq('entity_type', `branch_${branchId}`).eq('entity_id', 'mgmt')
        .lt('month', mk).order('month', { ascending: false }).limit(1)
      if (prevMgmt && prevMgmt.length > 0) {
        managerSalary = Number(prevMgmt[0].amount)
      }
    }
  } else if (globalMgrFromBranchEmps > 0) {
    // A global-salary manager exists that wasn't in the primary payroll upload
    // for this month — still add them so their salary isn't lost.
    managerSalary += globalMgrFromBranchEmps
  }

  // Controllable profit = revenue - all variable costs.
  // Waste is intentionally NOT deducted here: thrown-away products are already counted
  // in factoryPurchases / externalSuppliers (raw materials). `waste` remains on the
  // result so dashboards can display it as a standalone management KPI.
  const controllableProfit = branchControllableProfit({
    revenue, factoryPurchases, externalSuppliers, labor, managerSalary,
    repairs, deliveries, infrastructure, otherExpenses,
  })

  const controllableMargin = marginPct(controllableProfit, revenue)

  // Headquarters allocation (estimate or actual share of HQ cost)
  const branchExtRev = hq.branchExternalRev[branchId] ?? revenue
  const { allocation: overhead, isActual: hqIsActual } = computeHQAllocation(branchExtRev, hq)
  const effectivePct = marginPct(overhead, revenue)

  // Operating profit
  const operatingProfit = branchOperatingProfit(controllableProfit, fixedCosts, overhead)
  const operatingMargin = marginPct(operatingProfit, revenue)

  return {
    revenue, factoryPurchases, externalSuppliers, labor, managerSalary, managerIsActual,
    waste, repairs, deliveries, infrastructure, otherExpenses,
    controllableProfit, controllableMargin,
    fixedCosts, overhead, operatingProfit, operatingMargin,
    overheadPct: effectivePct,
    branchId, periodStart, periodEnd, laborIsActual, hqIsActual,
  }
}

export interface FactoryPLResult {
  revenue: number
  internalRevenue: number
  externalRevenue: number
  suppliers: number          // supplier_invoices
  labor: number              // factory employees only (is_manager=false, is_headquarters=false)
  managerSalary: number      // factory managers (is_manager=true, is_headquarters=false). Already part of labor in earlier
                             // versions; now broken out so the dashboard can show "שכר מנהלים" for the factory.
  managerIsActual: boolean   // true when managerSalary comes from current-month employer_costs
  waste: number
  repairs: number
  controllableProfit: number
  fixedCosts: number
  overhead: number           // headquarters allocation (factory's share)
  overheadPct: number        // effective HQ % applied to factory external revenue
  operatingProfit: number
  hqIsActual: boolean
}

export async function calculateFactoryPL(
  periodStart: string,
  periodEnd: string,
  monthKey?: string,
  hqContext?: HQContext
): Promise<FactoryPLResult> {
  const mk = monthKey || periodStart.slice(0, 7)
  const hq = hqContext || await getHQAllocationContext(periodStart, periodEnd, mk)

  const [fSalesExt, fSalesInt, fB2bExt, fB2bInt, fLab, fSupp, fWaste, fRepairs, intSalesRes, extSalesRes] = await Promise.all([
    supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_sales').select('amount').eq('is_internal', true).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_b2b_sales').select('amount').eq('is_internal', true).gte('date', periodStart).lt('date', periodEnd),
    supabase.from('labor').select('employer_cost, employee_name').eq('entity_type', 'factory').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('supplier_invoices').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_waste').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('factory_repairs').select('amount').gte('date', periodStart).lt('date', periodEnd),
    supabase.from('internal_sales').select('total_amount').eq('status', 'completed').gte('order_date', periodStart).lt('order_date', periodEnd),
    supabase.from('external_sales').select('total_before_vat').gte('invoice_date', periodStart).lt('invoice_date', periodEnd),
  ])

  const sum = (d: any) => (d.data || []).reduce((s: number, r: any) => s + Number(r.amount || r.employer_cost || 0), 0)

  // External revenue: factory_sales/b2b is_internal=false + external_sales (PDF-imported invoices,
  // kept in a separate table — already shown in CEODashboard's revenue-breakdown panel but historically
  // missing from the P&L calculation here).
  const extSalesTotal = (extSalesRes.data || []).reduce((s: number, r: any) => s + Number(r.total_before_vat), 0)
  const externalRevenue = sum(fSalesExt) + sum(fB2bExt) + extSalesTotal
  // Internal revenue: prefer internal_sales, fallback to factory_sales/b2b is_internal
  const intSalesTotal = (intSalesRes.data || []).reduce((s, r) => s + Number(r.total_amount), 0)
  const legacyInternal = sum(fSalesInt) + sum(fB2bInt)
  const internalRevenue = intSalesTotal > 0 ? intSalesTotal : legacyInternal
  const revenue = externalRevenue + internalRevenue
  const suppliers = sum(fSupp)
  // Factory labor — priority order:
  //   1. employer_costs (branch_id IS NULL, is_headquarters=false) — "actual" payroll from Excel upload
  //   2. estimate: fixed monthly salary of global employees + hourly employer_cost from the `labor`
  //      table, EXCLUDING rows of global employees. Global employees earn a fixed monthly salary
  //      that already covers any hours worked, so any hours of theirs that also appear in `labor`
  //      are informational only and must not be double-counted.
  const [mYear, mMonth] = mk.split('-').map(Number)
  const { data: actualFactLab } = await supabase.from('employer_costs')
    .select('actual_employer_cost, is_manager').is('branch_id', null).eq('is_headquarters', false).eq('month', mMonth).eq('year', mYear)
  let labor: number
  let managerSalary = 0
  let managerIsActual = false
  if (actualFactLab && actualFactLab.length > 0) {
    // Split managers (is_manager=true) from regular employees (is_manager=false).
    labor = actualFactLab.filter(r => !r.is_manager).reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    managerSalary = actualFactLab.filter(r => r.is_manager).reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    managerIsActual = true
  } else {
    const globalEmps = await fetchGlobalEmployees()
    const globalNames = new Set(globalEmps.map(e => e.name))
    // Managers are billed via managerSalary (fetched separately below from prior
    // employer_costs) — exclude them from globalLabor + hourlyLabor here so we
    // don't double-count their cost in estimate mode. Pull the full manager
    // list from employees (not just globals) so hourly-rate managers — if any —
    // are caught too.
    const globalEmpsNonMgr = globalEmps.filter(e => !e.is_manager)
    const { data: allMgrs } = await supabase
      .from('employees').select('name').eq('is_manager', true).eq('active', true)
    const mgrNames = new Set<string>((allMgrs || []).map((r: any) => r.name))
    const workingDaysInMonth = await getWorkingDays(mk)
    const globalLabor =
      calcGlobalLaborForDept(globalEmpsNonMgr, 'creams', workingDaysInMonth)
      + calcGlobalLaborForDept(globalEmpsNonMgr, 'dough', workingDaysInMonth)
    const hourlyLabor = (fLab.data || [])
      .filter((r: any) => !globalNames.has(r.employee_name) && !mgrNames.has(r.employee_name))
      .reduce((s: number, r: any) => s + Number(r.employer_cost || 0), 0)
    labor = globalLabor + hourlyLabor
    // Estimate path: fall back to the most-recent month's manager amount if any.
    const { data: prevMgr } = await supabase.from('employer_costs')
      .select('actual_employer_cost, year, month')
      .is('branch_id', null).eq('is_headquarters', false).eq('is_manager', true)
      .or(`year.lt.${mYear},and(year.eq.${mYear},month.lt.${mMonth})`)
      .order('year', { ascending: false }).order('month', { ascending: false })
    if (prevMgr && prevMgr.length > 0) {
      const { year: lY, month: lM } = prevMgr[0]
      managerSalary = prevMgr
        .filter(r => r.year === lY && r.month === lM)
        .reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    }
  }
  const waste = sum(fWaste)
  const repairs = sum(fRepairs)
  // Fixed costs are a recurring monthly amount — use getFixedCostTotal, which
  // falls back to the closest prior month when the current month wasn't entered
  // (same source the factory dashboard uses). A direct .eq('month') returned 0
  // whenever the month's fixed_costs row was missing.
  const fixedCosts = await getFixedCostTotal('factory', mk)

  // Waste excluded — already counted in `suppliers` (raw materials). Kept on the result
  // as a KPI only. See calculateBranchPL for the same reasoning.
  const controllableProfit = factoryControllableProfit({ revenue, suppliers, labor, managerSalary, repairs })

  // Headquarters allocation — factory pays its share of HQ cost based on external revenue.
  const { allocation: overhead, isActual: hqIsActual } = computeHQAllocation(hq.factoryExternalRev, hq)
  const overheadPct = marginPct(overhead, externalRevenue)

  const operatingProfit = factoryOperatingProfit(controllableProfit, fixedCosts, overhead)

  return {
    revenue, internalRevenue, externalRevenue,
    suppliers, labor, managerSalary, managerIsActual, waste, repairs,
    controllableProfit, fixedCosts, overhead, overheadPct, operatingProfit, hqIsActual,
  }
}

export interface ConsolidatedResult {
  branches: PLResult[]
  factory: FactoryPLResult
  consolidated: {
    revenue: number
    suppliers: number
    labor: number               // is_manager=false rows only (factory + branches)
    managerSalary: number       // is_manager=true rows (factory + branches)
    waste: number
    repairs: number
    fixedCosts: number
    overhead: number            // HQ allocation across all entities
    controllableProfit: number  // revenue − suppliers − labor − managerSalary
    operatingProfit: number     // controllableProfit − waste − repairs − fixedCosts − overhead
  }
  elimination: number  // should be ~0
  eliminationWarning: string | null
}

export async function calculateConsolidatedPL(
  branchIds: number[],
  periodStart: string,
  periodEnd: string,
  _legacyOverheadPct: number = 5,    // ignored — HQ allocation is the source of truth
  monthKey?: string
): Promise<ConsolidatedResult> {
  void _legacyOverheadPct
  const mk = monthKey || periodStart.slice(0, 7)
  const hq = await getHQAllocationContext(periodStart, periodEnd, mk)

  const [branches, factory] = await Promise.all([
    Promise.all(branchIds.map(id => calculateBranchPL(id, periodStart, periodEnd, undefined, mk, hq))),
    calculateFactoryPL(periodStart, periodEnd, mk, hq),
  ])

  const totalBranchInternal = branches.reduce((s, b) => s + b.factoryPurchases, 0)
  const elimination = factory.internalRevenue - totalBranchInternal

  const consolidated = {
    revenue: branches.reduce((s, b) => s + b.revenue, 0) + factory.externalRevenue,
    suppliers: factory.suppliers + branches.reduce((s, b) => s + b.externalSuppliers, 0),
    labor: factory.labor + branches.reduce((s, b) => s + b.labor, 0),
    managerSalary: factory.managerSalary + branches.reduce((s, b) => s + b.managerSalary, 0),
    waste: factory.waste + branches.reduce((s, b) => s + b.waste, 0),
    repairs: factory.repairs + branches.reduce((s, b) => s + b.repairs, 0),
    fixedCosts: factory.fixedCosts + branches.reduce((s, b) => s + b.fixedCosts, 0),
    overhead: factory.overhead + branches.reduce((s, b) => s + b.overhead, 0),
    controllableProfit: 0,
    operatingProfit: 0,
  }

  consolidated.controllableProfit = consolidatedControllableProfit(consolidated)
  // Waste excluded from operating profit — already inside `suppliers`. See per-entity functions.
  consolidated.operatingProfit = consolidatedOperatingProfit(consolidated)

  return {
    branches,
    factory,
    consolidated,
    elimination,
    eliminationWarning: Math.abs(elimination) > 1
      ? `⚠️ פער של ₪${Math.round(Math.abs(elimination)).toLocaleString(undefined, { maximumFractionDigits: 2 })} בנתונים פנימיים`
      : null,
  }
}
