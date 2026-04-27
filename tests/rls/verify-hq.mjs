// Sanity-check the new HQ allocation logic — read DB directly and compute what
// calculatePL.ts will show for March 2026 (actual mode) vs April 2026 (estimate mode).

import { signInAs } from './helpers.mjs'

const { client } = await signInAs('admin')

async function audit(year, month, label) {
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const [hqRes, settingRes, branchesRes] = await Promise.all([
    client.from('employer_costs').select('actual_employer_cost, employee_name')
      .eq('year', year).eq('month', month).eq('is_headquarters', true),
    client.from('system_settings').select('value').eq('key', 'hq_estimate_pct').maybeSingle(),
    client.from('branches').select('id, name').eq('active', true).order('id'),
  ])

  const hqCost = (hqRes.data || []).reduce((s, r) => s + Number(r.actual_employer_cost || 0), 0)
  const isActual = (hqRes.data || []).length > 0
  const estimatePct = Number(settingRes.data?.value ?? 10)
  const branchIds = (branchesRes.data || []).map(b => b.id)

  const [revRes, closeRes, factSExt, factBExt] = await Promise.all([
    client.from('branch_revenue').select('branch_id, amount')
      .in('branch_id', branchIds).gte('date', periodStart).lt('date', nextMonth),
    client.from('register_closings').select('branch_id, cash_sales, credit_sales')
      .in('branch_id', branchIds).gte('date', periodStart).lt('date', nextMonth),
    client.from('factory_sales').select('amount').eq('is_internal', false)
      .gte('date', periodStart).lt('date', nextMonth),
    client.from('factory_b2b_sales').select('amount').eq('is_internal', false)
      .gte('date', periodStart).lt('date', nextMonth),
  ])

  const branchRev = {}
  for (const id of branchIds) branchRev[id] = 0
  for (const r of (revRes.data || [])) branchRev[r.branch_id] += Number(r.amount)
  for (const c of (closeRes.data || [])) branchRev[c.branch_id] += Number(c.cash_sales || 0) + Number(c.credit_sales || 0)
  const factRev =
    (factSExt.data || []).reduce((s, r) => s + Number(r.amount || 0), 0) +
    (factBExt.data || []).reduce((s, r) => s + Number(r.amount || 0), 0)
  const totalRev = Object.values(branchRev).reduce((a, b) => a + b, 0) + factRev

  const fmt = n => '₪' + Math.round(n).toLocaleString()

  console.log(`\n=== ${label} (${year}-${String(month).padStart(2, '0')}) ===`)
  console.log(`Mode: ${isActual ? 'ACTUAL — HQ employer_costs uploaded' : `ESTIMATE — ${estimatePct}% × revenue (employer_costs HQ rows missing)`}`)
  if (isActual) console.log(`HQ cost: ${fmt(hqCost)} (${hqRes.data.length} rows)`)
  console.log(`External revenue total: ${fmt(totalRev)}`)
  console.log()

  for (const b of branchesRes.data || []) {
    const rev = branchRev[b.id] || 0
    const alloc = isActual && totalRev > 0 ? hqCost * (rev / totalRev) : rev * estimatePct / 100
    const pctEff = rev > 0 ? (alloc / rev) * 100 : 0
    console.log(`  Branch ${b.id} ${b.name}:`)
    console.log(`    revenue=${fmt(rev)}  alloc=${fmt(alloc)}  effective=${pctEff.toFixed(2)}%`)
  }
  const fAlloc = isActual && totalRev > 0 ? hqCost * (factRev / totalRev) : factRev * estimatePct / 100
  const fPct = factRev > 0 ? (fAlloc / factRev) * 100 : 0
  console.log(`  Factory:`)
  console.log(`    revenue=${fmt(factRev)}  alloc=${fmt(fAlloc)}  effective=${fPct.toFixed(2)}%`)

  const allocSum = Object.entries(branchRev).reduce((s, [id, rev]) => s + (isActual && totalRev > 0 ? hqCost * (rev / totalRev) : rev * estimatePct / 100), 0) + fAlloc
  console.log(`\n  Sum of allocations: ${fmt(allocSum)}${isActual ? ` (should match HQ cost ${fmt(hqCost)})` : ''}`)
}

await audit(2026, 3, 'March 2026 — actuals expected')
await audit(2026, 4, 'April 2026 — estimate expected (or actuals if uploaded)')

await client.auth.signOut()
