import { describe, it, expect } from 'vitest'
import {
  computeHQAllocation,
  marginPct,
  branchControllableProfit,
  branchOperatingProfit,
  factoryControllableProfit,
  factoryOperatingProfit,
  consolidatedControllableProfit,
  consolidatedOperatingProfit,
  type HQContext,
} from '../plFormulas'

const baseHQ: HQContext = {
  isActual: false,
  hqCost: 0,
  totalExternalRevenue: 0,
  estimatePct: 10,
  branchExternalRev: {},
  factoryExternalRev: 0,
}

describe('computeHQAllocation', () => {
  it('estimate mode: entityRev × estimatePct%', () => {
    const { allocation, isActual } = computeHQAllocation(100_000, { ...baseHQ, estimatePct: 10 })
    expect(allocation).toBe(10_000)
    expect(isActual).toBe(false)
  })

  it('actual mode: hqCost × (entityRev / totalRev)', () => {
    const ctx: HQContext = { ...baseHQ, isActual: true, hqCost: 120_000, totalExternalRevenue: 1_000_000 }
    const { allocation, isActual } = computeHQAllocation(250_000, ctx)
    expect(allocation).toBeCloseTo(30_000, 6) // 120k * 0.25
    expect(isActual).toBe(true)
  })

  it('actual flag but zero total revenue falls back to estimate (no divide-by-zero)', () => {
    const ctx: HQContext = { ...baseHQ, isActual: true, hqCost: 120_000, totalExternalRevenue: 0, estimatePct: 8 }
    const { allocation, isActual } = computeHQAllocation(50_000, ctx)
    expect(allocation).toBe(4_000) // 50k * 8%
    expect(isActual).toBe(false)
  })
})

describe('marginPct', () => {
  it('computes percentage of revenue', () => {
    expect(marginPct(150, 1000)).toBeCloseTo(15, 6)
  })
  it('returns 0 when revenue is 0 (guarded)', () => {
    expect(marginPct(150, 0)).toBe(0)
  })
})

describe('branch profit', () => {
  const parts = {
    revenue: 1_000_000,
    factoryPurchases: 400_000,
    externalSuppliers: 50_000,
    labor: 300_000,
    managerSalary: 40_000,
    repairs: 10_000,
    deliveries: 5_000,
    infrastructure: 8_000,
    otherExpenses: 7_000,
  }

  it('controllable = revenue − all variable costs', () => {
    // 1,000,000 − (400k+50k+300k+40k+10k+5k+8k+7k) = 180,000
    expect(branchControllableProfit(parts)).toBe(180_000)
  })

  it('does NOT deduct waste — waste is a KPI, not a P&L line (CLAUDE.md)', () => {
    // The function has no `waste` parameter by design. Passing a huge waste via a
    // spread must not change the result, proving waste can never leak into profit.
    const withWaste = { ...parts, waste: 999_999 } as typeof parts
    expect(branchControllableProfit(withWaste)).toBe(180_000)
  })

  it('operating = controllable − fixed − overhead', () => {
    expect(branchOperatingProfit(180_000, 100_000, 30_000)).toBe(50_000)
  })
})

describe('factory profit', () => {
  it('controllable = revenue − suppliers − labor − managerSalary − repairs (waste excluded)', () => {
    const c = factoryControllableProfit({
      revenue: 800_000, suppliers: 300_000, labor: 200_000, managerSalary: 60_000, repairs: 20_000,
    })
    expect(c).toBe(220_000)
  })
  it('operating = controllable − fixed − overhead', () => {
    expect(factoryOperatingProfit(220_000, 90_000, 25_000)).toBe(105_000)
  })
})

describe('consolidated profit', () => {
  it('controllable = revenue − suppliers − labor − managerSalary', () => {
    const c = consolidatedControllableProfit({
      revenue: 2_000_000, suppliers: 600_000, labor: 500_000, managerSalary: 100_000,
    })
    expect(c).toBe(800_000)
  })

  it('operating = controllable − repairs − fixed − overhead (waste excluded)', () => {
    const o = consolidatedOperatingProfit({
      controllableProfit: 800_000, repairs: 30_000, fixedCosts: 200_000, overhead: 120_000,
    })
    expect(o).toBe(450_000)
  })
})

describe('regression pin — end-to-end branch formula (indicative May-like numbers)', () => {
  it('locks the full branch chain to a known result', () => {
    const parts = {
      revenue: 1_384_787,
      factoryPurchases: 801_895,
      externalSuppliers: 0,
      labor: 320_000,
      managerSalary: 25_000,
      repairs: 4_000,
      deliveries: 0,
      infrastructure: 0,
      otherExpenses: 119_518,
    }
    const controllable = branchControllableProfit(parts)
    const operating = branchOperatingProfit(controllable, 60_000, 30_000)
    expect(controllable).toBe(114_374)
    expect(operating).toBe(24_374)
    expect(Math.round(marginPct(operating, parts.revenue) * 100) / 100).toBe(1.76)
  })
})
