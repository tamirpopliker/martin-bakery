// One-off audit: compare employer_costs (March 2026) totals to dashboard.
// Reads .env.test.local for credentials.

import { signInAs } from './helpers.mjs'

const YEAR = 2026
const MONTH = 3

const { client } = await signInAs('admin')

// 1. Per-branch labor + manager
const { data: branchRows, error: e1 } = await client
  .from('employer_costs')
  .select('branch_id, is_manager, is_headquarters, actual_employer_cost, employee_name')
  .eq('year', YEAR).eq('month', MONTH)
  .not('branch_id', 'is', null)

if (e1) { console.error('branchRows error:', e1.message); process.exit(1) }

const byBranch = {}
for (const r of branchRows) {
  const k = r.branch_id
  byBranch[k] ||= { labor: 0, manager: 0, laborRows: 0, mgrRows: 0 }
  const amt = Number(r.actual_employer_cost || 0)
  if (r.is_manager) { byBranch[k].manager += amt; byBranch[k].mgrRows++ }
  else { byBranch[k].labor += amt; byBranch[k].laborRows++ }
}

// 2. Factory: branch_id IS NULL
const { data: factRows, error: e2 } = await client
  .from('employer_costs')
  .select('is_manager, is_headquarters, actual_employer_cost, employee_name')
  .eq('year', YEAR).eq('month', MONTH)
  .is('branch_id', null)

if (e2) { console.error('factRows error:', e2.message); process.exit(1) }

let factLabor = 0, factHQ = 0, factMgr = 0
let factRowsLabor = 0, factRowsHQ = 0, factRowsMgr = 0
for (const r of factRows) {
  const amt = Number(r.actual_employer_cost || 0)
  if (r.is_manager) { factMgr += amt; factRowsMgr++ }
  else if (r.is_headquarters) { factHQ += amt; factRowsHQ++ }
  else { factLabor += amt; factRowsLabor++ }
}

const fmt = n => '₪' + Math.round(n).toLocaleString()

console.log('=== employer_costs audit — March 2026 ===\n')

const branchNames = { 1: 'אברהם אבינו', 2: 'הפועלים', 3: 'יעקב כהן' }
const dashboard = {
  1: { labor: 62002, manager: 20336 },
  2: { labor: 74133, manager: 20138 },
  3: { labor: 24836, manager: 19196 },
}
const factDashLabor = 196681

for (const [bid, d] of Object.entries(byBranch).sort()) {
  const id = Number(bid)
  const dash = dashboard[id] || { labor: 0, manager: 0 }
  const lDiff = d.labor - dash.labor
  const mDiff = d.manager - dash.manager
  console.log(`Branch ${id} — ${branchNames[id] || '?'}`)
  console.log(`  Labor:    DB ${fmt(d.labor)}   |  Dashboard ${fmt(dash.labor)}   |  diff ${fmt(lDiff)}   (${d.laborRows} rows)`)
  console.log(`  Manager:  DB ${fmt(d.manager)}   |  Dashboard ${fmt(dash.manager)}   |  diff ${fmt(mDiff)}   (${d.mgrRows} rows)`)
  console.log()
}

console.log('Factory (branch_id IS NULL) — breakdown')
console.log(`  Labor (mgr=false, HQ=false):    ${fmt(factLabor)}  (${factRowsLabor} rows)`)
console.log(`  Headquarters (HQ=true):         ${fmt(factHQ)}  (${factRowsHQ} rows)`)
console.log(`  Manager (mgr=true):             ${fmt(factMgr)}  (${factRowsMgr} rows)`)
console.log()
console.log('Detail of factory manager + HQ rows:')
for (const r of factRows) {
  if (r.is_manager || r.is_headquarters) {
    const tags = []
    if (r.is_manager) tags.push('manager')
    if (r.is_headquarters) tags.push('HQ')
    console.log(`  ${fmt(Number(r.actual_employer_cost || 0)).padStart(10)}  [${tags.join(',')}]  ${r.employee_name}`)
  }
}
console.log()
console.log(`Dashboard factory labor formula: SUM(actual_employer_cost) WHERE branch_id IS NULL AND is_headquarters=false`)
const factoryDashboardCalc = factLabor + factMgr  // is_headquarters=false includes both manager and non-manager
console.log(`= ${fmt(factLabor)} (mgr=false) + ${fmt(factMgr)} (mgr=true, HQ=false ?) = ${fmt(factoryDashboardCalc)}`)
console.log(`Actual dashboard shows: ${fmt(factDashLabor)}`)
console.log(`If diff non-zero, factory managers may have HQ=true (and thus excluded by is_headquarters=false filter)`)

await client.auth.signOut()
