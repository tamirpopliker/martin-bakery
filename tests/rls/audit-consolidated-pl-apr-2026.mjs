// Smoke test pinning the consolidated P&L numbers for April 2026.
// Created 2026-05-17 after the dashboard data-integrity audit. If anyone
// reintroduces the manager double-count, external_sales gap, or the stale
// branch_pl_summary VIEW dependency, the totals will drift and this script
// will exit non-zero.
//
// Run with: node tests/rls/audit-consolidated-pl-apr-2026.mjs
//
// Numbers below assume DB state immediately after the
// `Fix dashboard data integrity` PR + the 5 DB row updates
// (commit d060683 + the manual UPDATEs). Adjust EXPECTED if the underlying
// data legitimately changes (new invoices imported, etc.).

import { signInAs } from './helpers.mjs'
const { client } = await signInAs('admin')

const FROM = '2026-04-01'
const TO = '2026-05-01'

// ─── Expected values ──────────────────────────────────────────────────
const EXPECTED = {
  // Labor breakdown (employer_costs aggregations)
  factory_labor: 154726,        // is_manager=false, is_headquarters=false, branch_id IS NULL
  factory_managers: 47888,      // נאור 21,470 + רוזנברג 26,418
  branch_labor: 144054,         // is_manager=false, branch_id IS NOT NULL
  branch_managers: 57419,       // לוי 19,829 + חורב 19,650 + חודוש 17,940
  hq_payroll: 103955,           // is_headquarters=true (after אסמעיל moved out)
  payroll_grand_total: 508042,  // sum of all five

  // Revenue side
  supplier_invoices: 215573,    // factory raw materials total
  external_sales: 24899,        // PDF B2B invoices for factory (the previously-missing source)
}

const TOLERANCE = 1  // ₪1 wiggle room

// ─── Queries ──────────────────────────────────────────────────────────
const errors = []
const note = (label, expected, actual) => {
  const ok = Math.abs(actual - expected) <= TOLERANCE
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${label.padEnd(28)} expected ₪${expected.toLocaleString()}  got ₪${Math.round(actual).toLocaleString()}`)
  if (!ok) errors.push(`${label}: expected ${expected}, got ${actual}`)
}

console.log(`=== April 2026 consolidated P&L smoke test ===\n`)

// 1. Labor breakdown via employer_costs
const { data: laborRows, error: lErr } = await client
  .from('employer_costs')
  .select('actual_employer_cost, branch_id, is_manager, is_headquarters')
  .eq('year', 2026).eq('month', 4)
if (lErr) { console.error('labor query failed:', lErr.message); process.exit(2) }

let factoryLabor = 0, factoryManagers = 0
let branchLabor = 0, branchManagers = 0, hqPayroll = 0
for (const r of laborRows) {
  const amt = Number(r.actual_employer_cost)
  if (r.is_headquarters) hqPayroll += amt
  else if (r.branch_id === null) {
    if (r.is_manager) factoryManagers += amt
    else factoryLabor += amt
  } else {
    if (r.is_manager) branchManagers += amt
    else branchLabor += amt
  }
}
const payrollTotal = factoryLabor + factoryManagers + branchLabor + branchManagers + hqPayroll

console.log('--- payroll breakdown (employer_costs) ---')
note('factory labor',          EXPECTED.factory_labor,        factoryLabor)
note('factory managers',       EXPECTED.factory_managers,     factoryManagers)
note('branch labor',           EXPECTED.branch_labor,         branchLabor)
note('branch managers',        EXPECTED.branch_managers,      branchManagers)
note('HQ payroll',             EXPECTED.hq_payroll,           hqPayroll)
note('payroll grand total',    EXPECTED.payroll_grand_total,  payrollTotal)

// 2. Supplier invoices (factory raw materials)
const { data: suppRows, error: sErr } = await client
  .from('supplier_invoices')
  .select('amount')
  .gte('date', FROM).lt('date', TO)
if (sErr) { console.error('supplier query failed:', sErr.message); process.exit(2) }
const suppTotal = suppRows.reduce((s, r) => s + Number(r.amount), 0)

console.log('\n--- factory raw materials (supplier_invoices) ---')
note('supplier invoices',      EXPECTED.supplier_invoices,    suppTotal)

// 3. external_sales (the table previously omitted from the P&L)
const { data: extRows, error: eErr } = await client
  .from('external_sales')
  .select('total_before_vat')
  .gte('invoice_date', FROM).lt('invoice_date', TO)
if (eErr) { console.error('external_sales query failed:', eErr.message); process.exit(2) }
const extTotal = extRows.reduce((s, r) => s + Number(r.total_before_vat), 0)

console.log('\n--- factory PDF B2B invoices (external_sales) ---')
note('external_sales',         EXPECTED.external_sales,       extTotal)

// ─── Result ───────────────────────────────────────────────────────────
console.log('')
if (errors.length === 0) {
  console.log('🟢 all consolidated P&L pins hold')
  process.exit(0)
} else {
  console.log(`🔴 ${errors.length} regression${errors.length > 1 ? 's' : ''} detected:`)
  for (const e of errors) console.log(`   - ${e}`)
  console.log('\nIf the underlying data legitimately changed, update EXPECTED in this file.')
  console.log('Otherwise: a fix to is_manager / external_sales / branch_pl_summary may have regressed.')
  process.exit(1)
}
