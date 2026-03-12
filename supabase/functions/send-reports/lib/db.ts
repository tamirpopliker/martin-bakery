import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Edge Functions get these automatically
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const db: SupabaseClient = createClient(supabaseUrl, supabaseKey)

// ─── Date helpers (ported from src/lib/supabase.ts) ─────────────────────────

export function monthEnd(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export function prevMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function getMonthRange(yyyyMM: string): { from: string; to: string } {
  return { from: yyyyMM + '-01', to: monthEnd(yyyyMM) }
}

export function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export function formatHebrewDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const dayNames = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
  return `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`
}

// ─── Branch helpers ─────────────────────────────────────────────────────────

export const BRANCH_NAMES: Record<number, string> = {
  1: 'אברהם אבינו',
  2: 'הפועלים',
  3: 'יעקב כהן',
}

export const BRANCH_COLORS: Record<number, string> = {
  1: '#3b82f6',
  2: '#10b981',
  3: '#a855f7',
}

export const DEPARTMENT_NAMES: Record<string, string> = {
  creams: 'קרמים',
  dough: 'בצקים',
  packaging: 'אריזה',
  cleaning: 'ניקיון',
}

// ─── Query helpers ──────────────────────────────────────────────────────────

export async function getWorkingDaysCount(monthKey: string): Promise<number> {
  const { data } = await db
    .from('fixed_costs')
    .select('amount')
    .eq('entity_type', 'working_days')
    .eq('month', monthKey)
    .single()
  return data?.amount || 26
}

export async function getBranchRevenue(branchId: number, from: string, to: string) {
  const { data } = await db
    .from('branch_revenue')
    .select('date, source, amount, transaction_count')
    .eq('branch_id', branchId)
    .gte('date', from)
    .lt('date', to)
  return data || []
}

export async function getBranchLabor(branchId: number, from: string, to: string) {
  const { data } = await db
    .from('branch_labor')
    .select('date, employer_cost, gross_salary')
    .eq('branch_id', branchId)
    .gte('date', from)
    .lt('date', to)
  return data || []
}

export async function getBranchWaste(branchId: number, from: string, to: string) {
  const { data } = await db
    .from('branch_waste')
    .select('date, amount, category')
    .eq('branch_id', branchId)
    .gte('date', from)
    .lt('date', to)
  return data || []
}

export async function getBranchKpiTargets(branchId: number) {
  const { data } = await db
    .from('branch_kpi_targets')
    .select('labor_pct, waste_pct, revenue_target, basket_target, transaction_target')
    .eq('branch_id', branchId)
    .single()
  return data || { labor_pct: 28, waste_pct: 3, revenue_target: 0, basket_target: 0, transaction_target: 0 }
}

export async function getFactoryProduction(department: string, from: string, to: string) {
  const { data } = await db
    .from('daily_production')
    .select('date, amount')
    .eq('department', department)
    .gte('date', from)
    .lt('date', to)
  return data || []
}

export async function getFactorySales(department: string, from: string, to: string) {
  const { data } = await db
    .from('factory_sales')
    .select('date, amount')
    .eq('department', department)
    .eq('is_internal', false)
    .gte('date', from)
    .lt('date', to)
  return data || []
}

export async function getFactoryWaste(department: string, from: string, to: string) {
  const { data } = await db
    .from('factory_waste')
    .select('date, amount, category')
    .eq('department', department)
    .gte('date', from)
    .lt('date', to)
  return data || []
}

export async function getFactoryLabor(department: string, from: string, to: string) {
  const { data } = await db
    .from('labor')
    .select('date, employer_cost, hours_100, hours_125, hours_150')
    .eq('entity_type', 'factory')
    .eq('entity_id', department)
    .gte('date', from)
    .lt('date', to)
  return data || []
}

export async function getFactoryKpiTargets(department: string) {
  const { data } = await db
    .from('kpi_targets')
    .select('labor_pct, waste_pct, repairs_pct, gross_profit_pct, production_pct, operating_profit_pct')
    .eq('department', department)
    .single()
  return data || { labor_pct: 25, waste_pct: 5, repairs_pct: 3, gross_profit_pct: 40, production_pct: 45, operating_profit_pct: 30 }
}

export async function logReport(
  reportType: string, email: string, role: string, reportDate: string,
  status: 'sent' | 'failed' = 'sent', errorMessage?: string
) {
  await db.from('report_log').insert({
    report_type: reportType,
    recipient_email: email,
    recipient_role: role,
    report_date: reportDate,
    status,
    error_message: errorMessage,
  })
}
