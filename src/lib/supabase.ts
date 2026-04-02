import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://nlklndgmtmwoacipjyek.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
  }
})

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
}

/** Fetch all active branches, ordered by id */
export async function fetchBranches(): Promise<Branch[]> {
  const { data } = await supabase
    .from('branches')
    .select('id, name, short_name, address, active')
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
    supabase.from('fixed_costs').select('month, amount').in('month', months),
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
  const fixedCostsByM: Record<string, number> = {}
  ;(fixedCostsRes.data || []).forEach((r: any) => {
    if (r.month) fixedCostsByM[r.month] = (fixedCostsByM[r.month] || 0) + Number(r.amount || 0)
  })
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
export async function fetchBranchTrends(branchId: number, refMonth: string): Promise<MonthTrend[]> {
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
  const fcByM: Record<string, number> = {}
  ;(fcRes.data || []).forEach((r: any) => { if (r.month) fcByM[r.month] = (fcByM[r.month] || 0) + Number(r.amount || 0) })

  return months.map(m => {
    const revenue = revByM[m] || 0
    const grossProfit = revenue - (labByM[m] || 0) - (expByM[m] || 0)
    const operatingProfit = grossProfit - (fcByM[m] || 0) - (wasteByM[m] || 0) - (revenue * 0.05)
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
  const fcByM: Record<string, number> = {}
  ;(fcRes.data || []).forEach((r: any) => { if (r.month) fcByM[r.month] = (fcByM[r.month] || 0) + Number(r.amount || 0) })

  return months.map(m => {
    const revenue = (salesByM[m] || 0) + (b2bByM[m] || 0)
    const totalLabor = (labByM[m] || 0) + globalEmpCost
    const grossProfit = revenue - (suppByM[m] || 0) - totalLabor
    const operatingProfit = grossProfit - (fcByM[m] || 0) - (repByM[m] || 0) - (wasteByM[m] || 0)
    return { month: m, label: HEB_MONTHS[parseInt(m.split('-')[1]) - 1], revenue, grossProfit, operatingProfit }
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
    .single()
  return data?.amount || 26
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