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