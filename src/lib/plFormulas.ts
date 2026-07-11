/**
 * Pure P&L formulas — no DB, no side effects.
 *
 * Extracted from calculatePL.ts so the profit/allocation arithmetic can be
 * unit-tested in isolation (calculatePL.ts itself is coupled to Supabase and
 * hard to test directly). calculatePL.ts imports and uses these helpers, so a
 * test that pins a formula here pins the real production behaviour.
 *
 * DOMAIN RULES ENCODED HERE (see CLAUDE.md):
 *  - Waste is a KPI, NOT a P&L deduction. It is deliberately absent from every
 *    profit formula below — thrown-away product is already inside raw materials
 *    (factoryPurchases / externalSuppliers / factory suppliers). If you ever add
 *    `waste` to one of these formulas you are double-counting it.
 *  - Manager salary is a separate line, subtracted at the controllable-profit
 *    level (not inside fixed costs).
 */

export interface HQContext {
  isActual: boolean              // true when employer_costs has is_headquarters=true rows for the month
  hqCost: number                 // sum of those rows (₪)
  totalExternalRevenue: number   // sum across all branches + factory
  estimatePct: number            // % of revenue used when isActual=false
  branchExternalRev: Record<number, number>
  factoryExternalRev: number
}

/**
 * Allocate the period's HQ cost to a single entity by its external-revenue share.
 * - actual (employer_costs HQ rows uploaded): hqCost × (entityRev / totalRev)
 * - estimate: entityRev × estimatePct%
 */
export function computeHQAllocation(
  entityExternalRev: number,
  ctx: HQContext
): { allocation: number; isActual: boolean } {
  if (ctx.isActual && ctx.totalExternalRevenue > 0) {
    return {
      allocation: ctx.hqCost * (entityExternalRev / ctx.totalExternalRevenue),
      isActual: true,
    }
  }
  return {
    allocation: entityExternalRev * (ctx.estimatePct / 100),
    isActual: false,
  }
}

/** Margin as a percentage of revenue, guarded against divide-by-zero. */
export function marginPct(part: number, revenue: number): number {
  return revenue > 0 ? (part / revenue) * 100 : 0
}

// ── Branch ────────────────────────────────────────────────────────────────

export interface BranchControllableParts {
  revenue: number
  factoryPurchases: number
  externalSuppliers: number
  labor: number
  managerSalary: number
  repairs: number
  deliveries: number
  infrastructure: number
  otherExpenses: number
}

/**
 * Branch controllable profit = revenue − all variable costs.
 * NOTE: waste is intentionally not a parameter — it must never be deducted.
 */
export function branchControllableProfit(p: BranchControllableParts): number {
  return p.revenue
    - p.factoryPurchases - p.externalSuppliers
    - p.labor - p.managerSalary
    - p.repairs - p.deliveries - p.infrastructure - p.otherExpenses
}

/** Branch operating profit = controllable − fixed costs − HQ overhead. */
export function branchOperatingProfit(
  controllableProfit: number,
  fixedCosts: number,
  overhead: number
): number {
  return controllableProfit - fixedCosts - overhead
}

// ── Factory ─────────────────────────────────────────────────────────────────

export interface FactoryControllableParts {
  revenue: number
  suppliers: number
  labor: number
  managerSalary: number
  repairs: number
}

/**
 * Factory controllable profit = revenue − suppliers − labor − managerSalary − repairs.
 * Waste excluded — already counted inside `suppliers` (raw materials).
 */
export function factoryControllableProfit(p: FactoryControllableParts): number {
  return p.revenue - p.suppliers - p.labor - p.managerSalary - p.repairs
}

/** Factory operating profit = controllable − fixed costs − HQ overhead. */
export function factoryOperatingProfit(
  controllableProfit: number,
  fixedCosts: number,
  overhead: number
): number {
  return controllableProfit - fixedCosts - overhead
}

// ── Consolidated ─────────────────────────────────────────────────────────────

export interface ConsolidatedControllableParts {
  revenue: number
  suppliers: number
  labor: number
  managerSalary: number
}

/** Consolidated controllable profit = revenue − suppliers − labor − managerSalary. */
export function consolidatedControllableProfit(p: ConsolidatedControllableParts): number {
  return p.revenue - p.suppliers - p.labor - p.managerSalary
}

export interface ConsolidatedOperatingParts {
  controllableProfit: number
  repairs: number
  fixedCosts: number
  overhead: number
}

/**
 * Consolidated operating profit = controllable − repairs − fixed costs − HQ overhead.
 * Waste excluded — already inside `suppliers`.
 */
export function consolidatedOperatingProfit(p: ConsolidatedOperatingParts): number {
  return p.controllableProfit - p.repairs - p.fixedCosts - p.overhead
}
