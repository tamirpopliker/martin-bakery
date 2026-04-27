import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://nlklndgmtmwoacipjyek.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
  }
})

/** Fetch overhead_pct from system_settings (defaults to 5 if not found) */
export async function getOverheadPct(): Promise<number> {
  const { data } = await supabase.from('system_settings').select('value').eq('key', 'overhead_pct').maybeSingle()
  return data ? Number(data.value) : 5
}

/** Returns first day of next month — use with .lt('date', monthEnd(m)) instead of .lte('date', m+'-31') */
export function monthEnd(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** Returns previous month as YYYY-MM */
export function prevMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Returns { from, to } date range for a month */
export function getMonthRange(yyyyMM: string): { from: string; to: string } {
  return { from: yyyyMM + '-01', to: monthEnd(yyyyMM) }
}

/** Returns array of last 6 months ending with given month */
export function getLast6Months(yyyyMM: string): string[] {
  const months: string[] = []
  let current = yyyyMM
  for (let i = 0; i < 6; i++) {
    months.unshift(current)
    current = prevMonth(current)
  }
  return months
}

// ─── סניפים ─────────────────────────────────────────────────────────────────

export interface Branch {
  id: number
  name: string
  short_name: string | null
  address: string | null
  active: boolean
  overhead_pct: number | null
}

/** Fetch all active branches, ordered by id */
export async function fetchBranches(): Promise<Branch[]> {
  const { data } = await supabase
    .from('branches')
    .select('id, name, short_name, address, active, overhead_pct')
    .eq('active', true)
    .order('id')
  return (data || []) as Branch[]
}

// ─── מגמות 6 חודשים ─────────────────────────────────────────────────────

export interface MonthTrend {
  month: string       // YYYY-MM
  label: string       // שם חודש בעברית
  revenue: number     // הכנסות כוללות
  grossProfit: number // רווח גולמי
  operatingProfit: number // רווח תפעולי
}

const HEB_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']

export async function fetchSixMonthTrends(refMonth: string): Promise<MonthTrend[]> {
  const months = getLast6Months(refMonth)
  const tFrom = months[0] + '-01'
  const tTo = monthEnd(months[5])

  // Parallel fetch all needed tables for the 6-month range
  const [
    branchRevRes, factorySalesRes, factoryB2bRes,
    supplierRes, laborRes, branchLaborRes,
    fixedCostsRes, factoryRepairsRes, branchExpensesRes,
    factoryWasteRes, branchWasteRes, globalEmpRes,
  ] = await Promise.all([
    supabase.from('branch_revenue').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('factory_sales').select('date, amount, is_internal').gte('date', tFrom).lt('date', tTo),
    supabase.from('factory_b2b_sales').select('date, amount, is_internal').gte('date', tFrom).lt('date', tTo),
    supabase.from('supplier_invoices').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('labor').select('date, employer_cost').gte('date', tFrom).lt('date', tTo),
    supabase.from('branch_labor').select('date, employer_cost').gte('date', tFrom).lt('date', tTo),
    supabase.from('fixed_costs').select('month, amount, entity_type').neq('entity_type', 'working_days').in('month', months),
    supabase.from('factory_repairs').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('branch_expenses').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('factory_waste').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('branch_waste').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('employees').select('global_daily_rate, bonus').eq('wage_type', 'global').eq('active', true),
  ])

  // Global employee monthly cost: (salary × 1.3 + bonus) per employee
  const globalEmpMonthlyCost = (globalEmpRes.data || []).reduce((s, emp: any) => {
    return s + ((emp.global_daily_rate || 0) * 1.3) + (emp.bonus || 0)
  }, 0)

  // Group helper
  const groupByMonth = (data: any[] | null, field: string, filterFn?: (r: any) => boolean) => {
    const map: Record<string, number> = {}
    ;(data || []).forEach(r => {
      if (filterFn && !filterFn(r)) return
      const m = r.date?.slice(0, 7) || r.month
      if (m) map[m] = (map[m] || 0) + Number(r[field] || 0)
    })
    return map
  }

  // Revenue
  const branchRevByM = groupByMonth(branchRevRes.data, 'amount')
  const factorySalesByM = groupByMonth(factorySalesRes.data, 'amount', r => !r.is_internal)
  const factoryB2bByM = groupByMonth(factoryB2bRes.data, 'amount', r => !r.is_internal)

  // Costs for gross profit
  const suppliersByM = groupByMonth(supplierRes.data, 'amount')
  const factoryLaborByM = groupByMonth(laborRes.data, 'employer_cost')
  const branchLaborByM = groupByMonth(branchLaborRes.data, 'employer_cost')
  const factoryWasteByM = groupByMonth(factoryWasteRes.data, 'amount')
  const branchWasteByM = groupByMonth(branchWasteRes.data, 'amount')

  // Costs for operating profit
  const rawFixedCostsByM: Record<string, number> = {}
  ;(fixedCostsRes.data || []).forEach((r: any) => {
    if (r.month) rawFixedCostsByM[r.month] = (rawFixedCostsByM[r.month] || 0) + Number(r.amount || 0)
  })
  const fixedCostsByM = fillFixedCostsMap(rawFixedCostsByM, months)
  const repairsByM = groupByMonth(factoryRepairsRes.data, 'amount')
  const branchExpByM = groupByMonth(branchExpensesRes.data, 'amount')

  return months.map(m => {
    const revenue = (branchRevByM[m] || 0) + (factorySalesByM[m] || 0) + (factoryB2bByM[m] || 0)
    const totalLabor = (factoryLaborByM[m] || 0) + (branchLaborByM[m] || 0) + globalEmpMonthlyCost
    const totalWaste = (factoryWasteByM[m] || 0) + (branchWasteByM[m] || 0)
    const grossProfit = revenue - (suppliersByM[m] || 0) - totalLabor
    const operatingProfit = grossProfit - (fixedCostsByM[m] || 0) - (repairsByM[m] || 0) - (branchExpByM[m] || 0) - totalWaste
    const monthIdx = parseInt(m.split('-')[1]) - 1
    return { month: m, label: HEB_MONTHS[monthIdx], revenue, grossProfit, operatingProfit }
  })
}

/** Fetch 6-month trends for a single branch */
export async function fetchBranchTrends(branchId: number, refMonth: string, overheadPct = 5): Promise<MonthTrend[]> {
  const months = getLast6Months(refMonth)
  const tFrom = months[0] + '-01'
  const tTo = monthEnd(months[5])

  const [revRes, labRes, expRes, wasteRes, fcRes] = await Promise.all([
    supabase.from('branch_revenue').select('date, amount').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo),
    supabase.from('branch_labor').select('date, employer_cost').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo),
    supabase.from('branch_expenses').select('date, amount').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo),
    supabase.from('branch_waste').select('date, amount').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo),
    supabase.from('fixed_costs').select('month, amount').eq('entity_type', `branch_${branchId}`).in('month', months),
  ])

  const grp = (data: any[] | null, field: string) => {
    const map: Record<string, number> = {}
    ;(data || []).forEach(r => { const m = r.date?.slice(0, 7); if (m) map[m] = (map[m] || 0) + Number(r[field] || 0) })
    return map
  }
  const revByM = grp(revRes.data, 'amount')
  const labByM = grp(labRes.data, 'employer_cost')
  const expByM = grp(expRes.data, 'amount')
  const wasteByM = grp(wasteRes.data, 'amount')
  const rawFcByM: Record<string, number> = {}
  ;(fcRes.data || []).forEach((r: any) => { if (r.month) rawFcByM[r.month] = (rawFcByM[r.month] || 0) + Number(r.amount || 0) })
  const fcByM = fillFixedCostsMap(rawFcByM, months)

  return months.map(m => {
    const revenue = revByM[m] || 0
    const grossProfit = revenue - (labByM[m] || 0) - (expByM[m] || 0)
    const operatingProfit = grossProfit - (fcByM[m] || 0) - (wasteByM[m] || 0) - (revenue * overheadPct / 100)
    return { month: m, label: HEB_MONTHS[parseInt(m.split('-')[1]) - 1], revenue, grossProfit, operatingProfit }
  })
}

/** Fetch 6-month trends for factory only (no branches) */
export async function fetchFactoryTrends(refMonth: string): Promise<MonthTrend[]> {
  const months = getLast6Months(refMonth)
  const tFrom = months[0] + '-01'
  const tTo = monthEnd(months[5])

  const [salesRes, b2bRes, suppRes, labRes, wasteRes, repairsRes, fcRes, empRes] = await Promise.all([
    supabase.from('factory_sales').select('date, amount, is_internal').gte('date', tFrom).lt('date', tTo),
    supabase.from('factory_b2b_sales').select('date, amount, is_internal').gte('date', tFrom).lt('date', tTo),
    supabase.from('supplier_invoices').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('labor').select('date, employer_cost').gte('date', tFrom).lt('date', tTo),
    supabase.from('factory_waste').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('factory_repairs').select('date, amount').gte('date', tFrom).lt('date', tTo),
    supabase.from('fixed_costs').select('month, amount').eq('entity_type', 'factory').in('month', months),
    supabase.from('employees').select('global_daily_rate, bonus').eq('wage_type', 'global').eq('active', true),
  ])

  const globalEmpCost = (empRes.data || []).reduce((s, e: any) => s + ((e.global_daily_rate || 0) * 1.3) + (e.bonus || 0), 0)

  const grp = (data: any[] | null, field: string, filterFn?: (r: any) => boolean) => {
    const map: Record<string, number> = {}
    ;(data || []).forEach(r => { if (filterFn && !filterFn(r)) return; const m = r.date?.slice(0, 7); if (m) map[m] = (map[m] || 0) + Number(r[field] || 0) })
    return map
  }
  const salesByM = grp(salesRes.data, 'amount', r => !r.is_internal)
  const b2bByM = grp(b2bRes.data, 'amount', r => !r.is_internal)
  const suppByM = grp(suppRes.data, 'amount')
  const labByM = grp(labRes.data, 'employer_cost')
  const wasteByM = grp(wasteRes.data, 'amount')
  const repByM = grp(repairsRes.data, 'amount')
  const rawFcByM: Record<string, number> = {}
  ;(fcRes.data || []).forEach((r: any) => { if (r.month) rawFcByM[r.month] = (rawFcByM[r.month] || 0) + Number(r.amount || 0) })
  const fcByM = fillFixedCostsMap(rawFcByM, months)

  return months.map(m => {
    const revenue = (salesByM[m] || 0) + (b2bByM[m] || 0)
    const totalLabor = (labByM[m] || 0) + globalEmpCost
    const grossProfit = revenue - (suppByM[m] || 0) - totalLabor
    const operatingProfit = grossProfit - (fcByM[m] || 0) - (repByM[m] || 0) - (wasteByM[m] || 0)
    return { month: m, label: HEB_MONTHS[parseInt(m.split('-')[1]) - 1], revenue, grossProfit, operatingProfit }
  })
}

// ─── מגמות סניף מפורטות ──────────────────────────────────────────────────

export interface BranchRevenueTrend { month: string; label: string; cashier: number; website: number; credit: number; total: number }
export interface BranchLaborTrend { month: string; label: string; laborCost: number; revenue: number; laborPct: number }
export interface BranchExpensesTrend { month: string; label: string; factory: number; supplier: number; repair: number; infrastructure: number; delivery: number; other: number; total: number; pctOfRevenue: number }
export interface BranchWasteTrend { month: string; label: string; finished: number; raw: number; packaging: number; total: number; pctOfRevenue: number }

export async function fetchBranchRevenueTrend(branchId: number, refMonth: string): Promise<BranchRevenueTrend[]> {
  const months = getLast6Months(refMonth)
  const tFrom = months[0] + '-01', tTo = monthEnd(months[5])
  const [revRes, closingsRes] = await Promise.all([
    supabase.from('branch_revenue').select('date, amount, source').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo).range(0, 99999),
    supabase.from('register_closings').select('date, cash_sales, credit_sales').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo).range(0, 99999),
  ])
  const byM: Record<string, { cashier: number; website: number; credit: number }> = {}
  months.forEach(m => { byM[m] = { cashier: 0, website: 0, credit: 0 } })
  ;(revRes.data || []).forEach((r: any) => {
    const m = r.date?.slice(0, 7)
    if (m && byM[m]) byM[m][r.source as 'cashier' | 'website' | 'credit'] += Number(r.amount || 0)
  })
  // Merge register_closings into the cashier bucket so the trend shows the real register revenue.
  ;(closingsRes.data || []).forEach((c: any) => {
    const m = c.date?.slice(0, 7)
    if (m && byM[m]) byM[m].cashier += Number(c.cash_sales || 0) + Number(c.credit_sales || 0)
  })
  return months.map(m => ({ month: m, label: HEB_MONTHS[parseInt(m.split('-')[1]) - 1], ...byM[m], total: byM[m].cashier + byM[m].website + byM[m].credit }))
}

export async function fetchBranchLaborTrend(branchId: number, refMonth: string): Promise<BranchLaborTrend[]> {
  const months = getLast6Months(refMonth)
  const tFrom = months[0] + '-01', tTo = monthEnd(months[5])
  const [labRes, revRes, closingsRes] = await Promise.all([
    supabase.from('branch_labor').select('date, employer_cost').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo).range(0, 99999),
    supabase.from('branch_revenue').select('date, amount').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo).range(0, 99999),
    supabase.from('register_closings').select('date, cash_sales, credit_sales').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo).range(0, 99999),
  ])
  const grp = (data: any[] | null, field: string) => {
    const map: Record<string, number> = {}
    ;(data || []).forEach(r => { const m = r.date?.slice(0, 7); if (m) map[m] = (map[m] || 0) + Number(r[field] || 0) })
    return map
  }
  const labByM = grp(labRes.data, 'employer_cost')
  const revByM = grp(revRes.data, 'amount')
  // Add register_closings revenue to the denominator so the labor % reflects the true register take.
  ;(closingsRes.data || []).forEach((c: any) => {
    const m = c.date?.slice(0, 7)
    if (m) revByM[m] = (revByM[m] || 0) + Number(c.cash_sales || 0) + Number(c.credit_sales || 0)
  })
  return months.map(m => {
    const laborCost = labByM[m] || 0, revenue = revByM[m] || 0
    return { month: m, label: HEB_MONTHS[parseInt(m.split('-')[1]) - 1], laborCost, revenue, laborPct: revenue > 0 ? Math.round((laborCost / revenue) * 1000) / 10 : 0 }
  })
}

export async function fetchBranchExpensesTrend(branchId: number, refMonth: string): Promise<BranchExpensesTrend[]> {
  const months = getLast6Months(refMonth)
  const tFrom = months[0] + '-01', tTo = monthEnd(months[5])
  const [expRes, revRes, intSalesRes] = await Promise.all([
    supabase.from('branch_expenses').select('date, amount, expense_type, from_factory').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo),
    supabase.from('branch_revenue').select('date, amount').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo),
    supabase.from('internal_sales').select('order_date, total_amount').eq('branch_id', branchId).eq('status', 'completed').gte('order_date', tFrom).lt('order_date', tTo),
  ])
  const byM: Record<string, Record<string, number>> = {}
  const revByM: Record<string, number> = {}
  const factoryByM: Record<string, number> = {}
  months.forEach(m => { byM[m] = { supplier: 0, repair: 0, infrastructure: 0, delivery: 0, other: 0 }; revByM[m] = 0; factoryByM[m] = 0 })
  ;(expRes.data || []).forEach((r: any) => {
    if (r.from_factory) return // handled via internal_sales
    const m = r.date?.slice(0, 7), t = r.expense_type || 'other'
    if (m && byM[m]) byM[m][t === 'inventory' ? 'supplier' : t] = (byM[m][t === 'inventory' ? 'supplier' : t] || 0) + Number(r.amount || 0)
  })
  ;(revRes.data || []).forEach((r: any) => { const m = r.date?.slice(0, 7); if (m) revByM[m] = (revByM[m] || 0) + Number(r.amount || 0) })
  ;(intSalesRes.data || []).forEach((r: any) => { const m = r.order_date?.slice(0, 7); if (m && factoryByM[m] !== undefined) factoryByM[m] += Number(r.total_amount || 0) })
  return months.map(m => {
    const e = byM[m], factory = factoryByM[m] || 0
    const expTotal = Object.values(e).reduce((s, v) => s + v, 0)
    const total = expTotal + factory, rev = revByM[m] || 0
    return { month: m, label: HEB_MONTHS[parseInt(m.split('-')[1]) - 1], factory, supplier: e.supplier, repair: e.repair, infrastructure: e.infrastructure, delivery: e.delivery, other: e.other, total, pctOfRevenue: rev > 0 ? Math.round((total / rev) * 1000) / 10 : 0 }
  })
}

export async function fetchBranchWasteTrend(branchId: number, refMonth: string): Promise<BranchWasteTrend[]> {
  const months = getLast6Months(refMonth)
  const tFrom = months[0] + '-01', tTo = monthEnd(months[5])
  const [wasteRes, revRes] = await Promise.all([
    supabase.from('branch_waste').select('date, amount, category').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo),
    supabase.from('branch_revenue').select('date, amount').eq('branch_id', branchId).gte('date', tFrom).lt('date', tTo),
  ])
  const byM: Record<string, { finished: number; raw: number; packaging: number }> = {}
  const revByM: Record<string, number> = {}
  months.forEach(m => { byM[m] = { finished: 0, raw: 0, packaging: 0 }; revByM[m] = 0 })
  ;(wasteRes.data || []).forEach((r: any) => {
    const m = r.date?.slice(0, 7), cat = r.category || 'finished'
    if (m && byM[m] && cat in byM[m]) byM[m][cat as 'finished' | 'raw' | 'packaging'] += Number(r.amount || 0)
  })
  ;(revRes.data || []).forEach((r: any) => { const m = r.date?.slice(0, 7); if (m) revByM[m] = (revByM[m] || 0) + Number(r.amount || 0) })
  return months.map(m => {
    const total = byM[m].finished + byM[m].raw + byM[m].packaging, rev = revByM[m] || 0
    return { month: m, label: HEB_MONTHS[parseInt(m.split('-')[1]) - 1], ...byM[m], total, pctOfRevenue: rev > 0 ? Math.round((total / rev) * 1000) / 10 : 0 }
  })
}

// ─── עובדים גלובליים ──────────────────────────────────────────────────────

export interface GlobalEmployee {
  id: number
  name: string
  department: string          // 'creams' | 'dough' | 'both'
  global_daily_rate: number   // monthly salary (field name is legacy)
  bonus: number
  active: boolean
}

/** Fetch working days count for a given month from fixed_costs (entity_type='working_days') */
export async function getWorkingDays(month: string): Promise<number> {
  const { data } = await supabase
    .from('fixed_costs')
    .select('amount')
    .eq('entity_type', 'working_days')
    .eq('month', month)
    .maybeSingle()
  return data?.amount || 26
}

/**
 * Get fixed costs for a given entity and month.
 * If no data exists for the requested month, falls back to the closest month that has data (before or after).
 */
export async function getFixedCostsForMonth(entityType: string, month: string): Promise<{ name: string; amount: number }[]> {
  const { data } = await supabase
    .from('fixed_costs')
    .select('name, amount')
    .eq('entity_type', entityType)
    .eq('month', month)
  if (data && data.length > 0) return data

  // Fallback: find the closest month with data (try before first, then after)
  const { data: before } = await supabase
    .from('fixed_costs')
    .select('month')
    .eq('entity_type', entityType)
    .lt('month', month)
    .order('month', { ascending: false })
    .limit(1)

  const { data: after } = await supabase
    .from('fixed_costs')
    .select('month')
    .eq('entity_type', entityType)
    .gt('month', month)
    .order('month', { ascending: true })
    .limit(1)

  // Pick the closest month
  const beforeMonth = before?.[0]?.month
  const afterMonth = after?.[0]?.month
  let closestMonth: string | null = null
  if (beforeMonth && afterMonth) {
    // Both exist — pick whichever is closer
    const diffBefore = Math.abs(new Date(month + '-01').getTime() - new Date(beforeMonth + '-01').getTime())
    const diffAfter = Math.abs(new Date(afterMonth + '-01').getTime() - new Date(month + '-01').getTime())
    closestMonth = diffBefore <= diffAfter ? beforeMonth : afterMonth
  } else {
    closestMonth = beforeMonth || afterMonth || null
  }

  if (!closestMonth) return []

  const { data: fallback } = await supabase
    .from('fixed_costs')
    .select('name, amount')
    .eq('entity_type', entityType)
    .eq('month', closestMonth)
  return fallback || []
}

/**
 * Get total fixed costs amount for a given entity and month (with fallback).
 */
export async function getFixedCostTotal(entityType: string, month: string): Promise<number> {
  const costs = await getFixedCostsForMonth(entityType, month)
  return costs.reduce((s, c) => s + Number(c.amount || 0), 0)
}

/**
 * Fill fixed costs map for trend data: for months with no data, use the latest previous month's data.
 */
export function fillFixedCostsMap(fcByMonth: Record<string, number>, months: string[]): Record<string, number> {
  const filled: Record<string, number> = { ...fcByMonth }
  // Find any known value to use as default for months without data
  const knownValues = Object.values(fcByMonth).filter(v => v > 0)
  const defaultVal = knownValues.length > 0 ? knownValues[0] : 0

  // Forward pass: carry known values forward, use defaultVal for leading empty months
  let lastKnown = 0
  for (const m of months) {
    if (filled[m] !== undefined && filled[m] > 0) {
      lastKnown = filled[m]
    } else {
      filled[m] = lastKnown || defaultVal
    }
  }
  return filled
}

/** Count working days in a date range, excluding Saturdays (day===6) */
export function countWorkingDaysInRange(from: string, to: string): number {
  let count = 0
  const d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end) {
    if (d.getDay() !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

/** Fetch all active global employees */
export async function fetchGlobalEmployees(): Promise<GlobalEmployee[]> {
  const { data } = await supabase
    .from('employees')
    .select('id, name, department, global_daily_rate, bonus, active')
    .eq('wage_type', 'global')
    .eq('active', true)
  return (data || []) as GlobalEmployee[]
}

/**
 * Calculate total employer cost of global employees for a department in a period.
 * monthly employer cost = monthly_salary × 1.3
 * period cost = employer_cost × (workingDaysInPeriod / workingDaysInMonth)
 * 'both' employees → 50 % split to creams + dough
 */
export function calcGlobalLaborForDept(
  globalEmployees: GlobalEmployee[],
  department: 'creams' | 'dough',
  workingDaysInMonth: number,
  workingDaysInPeriod?: number,
): number {
  if (workingDaysInMonth <= 0) return 0
  const days = workingDaysInPeriod ?? workingDaysInMonth
  let total = 0
  for (const emp of globalEmployees) {
    // עלות מעביד ×1.3 רק על המשכורת, בונוס בלי ×1.3
    const employerCost = (emp.global_daily_rate || 0) * 1.3 + (emp.bonus || 0)
    const periodCost = employerCost * (days / workingDaysInMonth)
    if (emp.department === department) total += periodCost
    else if (emp.department === 'both') total += periodCost * 0.5
  }
  return total
}

// ─── Unified P&L Types & Functions ─────────────────────────────────────────

export interface PLRow {
  label: string
  amount: number
  pct?: number // % of revenue
  bold?: boolean
  separator?: boolean // render a line above this row
  color?: 'profit' | 'expense' | '' // for coloring
}

export interface BranchPLResult {
  revenue: number
  revCashier: number
  revWebsite: number
  revCredit: number
  expSuppliers: number
  expSuppliersInternal: number  // from_factory=true
  expSuppliersExternal: number  // from_factory=false or null
  expRepairs: number
  expInfra: number
  expDelivery: number
  expOther: number
  laborEmployer: number
  laborIsActual: boolean
  mgmtCosts: number
  mgmtIsActual: boolean
  wasteTotal: number
  fixedCosts: number
  controllableMargin: number
  overheadAmount: number
  operatingProfit: number
  rows: PLRow[]
}

export interface FactoryPLResult {
  sales: number
  salesInternal: number
  suppliers: number
  labor: number
  waste: number
  repairs: number
  fixedCosts: number
  controllableMargin: number
  operatingProfit: number
  rows: PLRow[]
}

export interface ConsolidatedPLResult {
  revenue: number
  suppliers: number
  labor: number
  waste: number
  repairs: number
  fixedCosts: number
  controllableMargin: number
  operatingProfit: number
  rows: PLRow[]
}

/**
 * Fetch complete P&L for a branch.
 *
 * The `overheadPct` argument is retained for backwards compatibility but
 * ignored — the headquarters allocation now drives the overhead line, mirroring
 * the labor pattern (estimate from system_settings, replaced by actual
 * employer_costs HQ rows once uploaded). See lib/calculatePL.ts for the canonical
 * helper `getHQAllocationContext`.
 */
export async function fetchBranchPL(branchId: number, dateFrom: string, dateTo: string, monthKey: string, _legacyOverheadPct = 5): Promise<BranchPLResult> {
  void _legacyOverheadPct
  const { getHQAllocationContext, computeHQAllocation } = await import('./calculatePL')
  const hq = await getHQAllocationContext(dateFrom, dateTo, monthKey)
  const [revRes, expRes, labRes, wasteRes, fcRes, intSalesRes, closingsRes] = await Promise.all([
    supabase.from('branch_revenue').select('source, amount').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo).range(0, 99999),
    supabase.from('branch_expenses').select('expense_type, amount, from_factory').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo).range(0, 99999),
    supabase.from('branch_labor').select('employer_cost').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo).range(0, 99999),
    supabase.from('branch_waste').select('amount').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo).range(0, 99999),
    supabase.from('fixed_costs').select('amount, entity_id').eq('entity_type', `branch_${branchId}`).eq('month', monthKey),
    supabase.from('internal_sales').select('total_amount').eq('branch_id', branchId).eq('status', 'completed').gte('order_date', dateFrom).lt('order_date', dateTo).range(0, 99999),
    // Cashier revenue from the newer register_closings system (cash + credit sold at the register).
    supabase.from('register_closings').select('cash_sales, credit_sales').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo).range(0, 99999),
  ])

  let revCashier = 0, revWebsite = 0, revCredit = 0
  for (const r of (revRes.data || [])) {
    const amt = Number(r.amount)
    if (r.source === 'cashier') revCashier += amt
    else if (r.source === 'website') revWebsite += amt
    else if (r.source === 'credit') revCredit += amt
    else revCashier += amt // default to cashier
  }
  // Merge register_closings (new source) into the cashier bucket.
  for (const c of (closingsRes.data || [])) {
    revCashier += Number(c.cash_sales || 0) + Number(c.credit_sales || 0)
  }
  const revenue = revCashier + revWebsite + revCredit

  // Factory purchases: prefer internal_sales (completed), fallback to branch_expenses from_factory
  const intSalesTotal = (intSalesRes.data || []).reduce((s, r) => s + Number(r.total_amount), 0)
  const expFromFactory = (expRes.data || []).filter(r => r.from_factory).reduce((s, r) => s + Number(r.amount), 0)
  const expSuppliersInternal = intSalesTotal > 0 ? intSalesTotal : expFromFactory

  let expSuppliersExternal = 0
  let expRepairs = 0, expInfra = 0, expDelivery = 0, expOther = 0
  for (const r of (expRes.data || [])) {
    if (r.from_factory) continue // handled via internal_sales
    const amt = Number(r.amount)
    const t = r.expense_type || 'other'
    if (t === 'suppliers' || t === 'supplier' || t === 'inventory') {
      expSuppliersExternal += amt
    }
    else if (t === 'repairs' || t === 'repair') expRepairs += amt
    else if (t === 'infrastructure') expInfra += amt
    else if (t === 'deliveries' || t === 'delivery') expDelivery += amt
    else expOther += amt
  }
  const expSuppliers = expSuppliersInternal + expSuppliersExternal

  // Labor + Manager — check employer_costs first to prevent double-counting
  const [mYear, mMonth] = monthKey.split('-').map(Number)
  const { data: actualLabAll } = await supabase.from('employer_costs')
    .select('actual_employer_cost, is_manager').eq('branch_id', branchId).eq('month', mMonth).eq('year', mYear)
  const laborIsActual = (actualLabAll && actualLabAll.length > 0) ? true : false

  let laborEmployer: number
  if (laborIsActual) {
    laborEmployer = actualLabAll!.filter(r => !r.is_manager).reduce((s, r) => s + Number(r.actual_employer_cost), 0)
  } else {
    laborEmployer = (labRes.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)
  }

  // Manager salary: prefer current-month employer_costs is_manager=true; otherwise the latest
  // prior month that does have is_manager=true for this branch.
  const currentMonthManagers = (actualLabAll || []).filter(r => r.is_manager)
  let mgmtCosts = 0
  let mgmtIsActual = false
  if (currentMonthManagers.length > 0) {
    mgmtCosts = currentMonthManagers.reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    mgmtIsActual = true
  } else {
    const { data: prevMgr } = await supabase.from('employer_costs')
      .select('actual_employer_cost, month, year')
      .eq('branch_id', branchId).eq('is_manager', true)
      .or(`year.lt.${mYear},and(year.eq.${mYear},month.lt.${mMonth})`)
      .order('year', { ascending: false }).order('month', { ascending: false })
    if (prevMgr && prevMgr.length > 0) {
      const { year: lY, month: lM } = prevMgr[0]
      mgmtCosts = prevMgr
        .filter(r => r.year === lY && r.month === lM)
        .reduce((s, r) => s + Number(r.actual_employer_cost), 0)
    }
  }

  const wasteTotal = (wasteRes.data || []).reduce((s, r) => s + Number(r.amount), 0)

  let fixedCosts = 0
  let mgmtFromFixed = 0
  for (const r of (fcRes.data || [])) {
    const amt = Number(r.amount)
    if (r.entity_id === 'mgmt') { mgmtFromFixed += amt }
    else fixedCosts += amt
  }
  // Legacy fallback: no manager data in employer_costs at all → fall back to fixed_costs mgmt.
  if (mgmtCosts === 0) {
    if (mgmtFromFixed > 0) {
      mgmtCosts = mgmtFromFixed
    } else {
      const { data: prevMgmt } = await supabase.from('fixed_costs')
        .select('amount').eq('entity_type', `branch_${branchId}`).eq('entity_id', 'mgmt')
        .lt('month', monthKey).order('month', { ascending: false }).limit(1)
      if (prevMgmt && prevMgmt.length > 0) {
        mgmtCosts = Number(prevMgmt[0].amount)
      }
    }
  }

  // Controllable margin = revenue - all expenses - labor - mgmt - waste
  const totalExpenses = expSuppliers + expRepairs + expInfra + expDelivery + expOther
  const controllableMargin = revenue - totalExpenses - laborEmployer - mgmtCosts - wasteTotal

  // Headquarters allocation
  const branchExtRev = hq.branchExternalRev[branchId] ?? revenue
  const { allocation: overheadAmount, isActual: hqIsActual } = computeHQAllocation(branchExtRev, hq)
  const effectivePct = revenue > 0 ? (overheadAmount / revenue) * 100 : 0

  const operatingProfit = controllableMargin - fixedCosts - overheadAmount

  const pct = (n: number) => revenue > 0 ? (n / revenue) * 100 : 0

  const rows: PLRow[] = [
    { label: 'הכנסות', amount: revenue, bold: true, color: '' },
    { label: 'רכישות מפעל', amount: expSuppliersInternal, color: 'expense' },
    { label: 'ספקים חיצוניים', amount: expSuppliersExternal, color: 'expense' },
    { label: laborIsActual ? 'לייבור ✓' : 'לייבור ~', amount: laborEmployer, color: 'expense' },
    { label: mgmtIsActual ? 'שכר מנהל ✓' : 'שכר מנהל (משוער)', amount: mgmtCosts, color: 'expense' },
    { label: 'פחת', amount: wasteTotal, color: 'expense' },
    { label: 'תיקונים', amount: expRepairs, color: 'expense' },
    { label: 'רווח נשלט', amount: controllableMargin, pct: pct(controllableMargin), bold: true, separator: true, color: 'profit' },
    { label: 'עלויות קבועות', amount: fixedCosts, color: 'expense' },
    { label: hqIsActual ? `העמסת מטה ✓ ${effectivePct.toFixed(1)}%` : `העמסת מטה (משוער) ${effectivePct.toFixed(1)}%`, amount: overheadAmount, color: 'expense' },
    { label: 'רווח תפעולי', amount: operatingProfit, pct: pct(operatingProfit), bold: true, separator: true, color: 'profit' },
  ]

  return {
    revenue, revCashier, revWebsite, revCredit,
    expSuppliers, expSuppliersInternal, expSuppliersExternal,
    expRepairs, expInfra, expDelivery, expOther,
    laborEmployer, laborIsActual, mgmtCosts, mgmtIsActual, wasteTotal, fixedCosts,
    controllableMargin, overheadAmount, operatingProfit, rows,
  }
}

/**
 * Fetch complete P&L for the factory.
 *
 * Thin wrapper around `calculateFactoryPL` (lib/calculatePL.ts) — the canonical
 * factory-PL function, which handles the employer_costs / global-employees /
 * labor-table priority chain for factory labor. This wrapper just adapts the
 * return shape to the legacy `FactoryPLResult` used by Home.tsx and the
 * consolidated-PL helper below (sales vs revenue, controllableMargin vs
 * controllableProfit, plus a pre-rendered `rows` array).
 */
export async function fetchFactoryPL(dateFrom: string, dateTo: string, monthKey: string): Promise<FactoryPLResult> {
  const { calculateFactoryPL } = await import('./calculatePL')
  const pl = await calculateFactoryPL(dateFrom, dateTo, monthKey)

  const sales = pl.revenue
  const salesInternal = pl.internalRevenue
  const suppliers = pl.suppliers
  const labor = pl.labor
  const waste = pl.waste
  const repairs = pl.repairs
  const fixedCosts = pl.fixedCosts
  const controllableMargin = pl.controllableProfit
  const operatingProfit = pl.operatingProfit
  const overhead = pl.overhead
  const overheadPct = pl.overheadPct
  const hqIsActual = pl.hqIsActual

  const pct = (n: number) => sales > 0 ? (n / sales) * 100 : 0

  const rows: PLRow[] = [
    { label: 'מכירות', amount: sales, bold: true, color: '' },
    { label: 'חומרי גלם', amount: suppliers, color: 'expense' },
    { label: 'לייבור', amount: labor, color: 'expense' },
    { label: 'פחת', amount: waste, color: 'expense' },
    { label: 'תיקונים', amount: repairs, color: 'expense' },
    { label: 'רווח נשלט', amount: controllableMargin, pct: pct(controllableMargin), bold: true, separator: true, color: 'profit' },
    { label: 'עלויות קבועות', amount: fixedCosts, color: 'expense' },
    { label: hqIsActual ? `העמסת מטה ✓ ${overheadPct.toFixed(1)}%` : `העמסת מטה (משוער) ${overheadPct.toFixed(1)}%`, amount: overhead, color: 'expense' },
    { label: 'רווח תפעולי', amount: operatingProfit, pct: pct(operatingProfit), bold: true, separator: true, color: 'profit' },
  ]

  return { sales, salesInternal, suppliers, labor, waste, repairs, fixedCosts, controllableMargin, operatingProfit, rows }
}

/**
 * Fetch consolidated P&L (intercompany eliminated).
 * Revenue = branch revenue + factory external sales only.
 * Costs = actual supplier costs (no internal transfer prices).
 */
export async function fetchConsolidatedPL(
  branchIds: number[],
  dateFrom: string,
  dateTo: string,
  monthKey: string,
  overheadPct = 5
): Promise<ConsolidatedPLResult> {
  // Branch totals
  let branchRevenue = 0, branchLabor = 0, branchWaste = 0, branchExpenses = 0, branchFixed = 0
  let branchInternalExpenses = 0 // from_factory=true expenses to eliminate
  for (const brId of branchIds) {
    const pl = await fetchBranchPL(brId, dateFrom, dateTo, monthKey, overheadPct)
    branchRevenue += pl.revenue
    branchLabor += pl.laborEmployer
    branchWaste += pl.wasteTotal
    branchExpenses += pl.expSuppliers + pl.expRepairs
    branchFixed += pl.fixedCosts
    // Fetch internal expenses (from_factory=true) to eliminate in consolidated view
    const { data: intExp } = await supabase.from('branch_expenses')
      .select('amount')
      .eq('branch_id', brId)
      .eq('from_factory', true)
      .gte('date', dateFrom).lt('date', dateTo)
    branchInternalExpenses += (intExp || []).reduce((s, r) => s + Number(r.amount), 0)
  }
  // Eliminate intercompany: subtract internal purchases from branch expenses
  branchExpenses -= branchInternalExpenses

  // Factory (external only for consolidated)
  const factoryPL = await fetchFactoryPL(dateFrom, dateTo, monthKey)
  const factoryExternalSales = factoryPL.sales - factoryPL.salesInternal

  const revenue = branchRevenue + factoryExternalSales
  const suppliers = factoryPL.suppliers // actual raw materials only
  const labor = branchLabor + factoryPL.labor
  const waste = branchWaste + factoryPL.waste
  const repairs = branchExpenses + factoryPL.repairs
  const fixedCosts = branchFixed + factoryPL.fixedCosts

  const controllableMargin = revenue - suppliers - labor - waste - repairs
  const operatingProfit = controllableMargin - fixedCosts

  const pct = (n: number) => revenue > 0 ? (n / revenue) * 100 : 0

  const rows: PLRow[] = [
    { label: 'הכנסות אמיתיות', amount: revenue, bold: true, color: '' },
    { label: 'חומרי גלם', amount: suppliers, color: 'expense' },
    { label: 'לייבור', amount: labor, color: 'expense' },
    { label: 'פחת', amount: waste, color: 'expense' },
    { label: 'תיקונים / הוצאות', amount: repairs, color: 'expense' },
    { label: 'רווח נשלט', amount: controllableMargin, pct: pct(controllableMargin), bold: true, separator: true, color: 'profit' },
    { label: 'עלויות קבועות', amount: fixedCosts, color: 'expense' },
    { label: 'רווח תפעולי', amount: operatingProfit, pct: pct(operatingProfit), bold: true, separator: true, color: 'profit' },
  ]

  return { revenue, suppliers, labor, waste, repairs, fixedCosts, controllableMargin, operatingProfit, rows }
}