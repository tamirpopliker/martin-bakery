// RLS tests for the scheduling tables (migration 064_scheduling_rls.sql).
// Run AFTER applying migrations 063 + 064 to the Supabase project.
//   node tests/rls/scheduling.test.mjs
//
// Verifies:
//   • branch manager can write schedule_constraints for their own branch
//   • branch manager is blocked from writing another branch's rows
//   • factory role is blocked from writing scheduling data
//   • admin can write anywhere
//   • (optional) an employee can write ONLY their own rows — enable by adding
//     TEST_EMPLOYEE_USERNAME / _PASSWORD / _ID (their branch_employees.id) and
//     TEST_EMPLOYEE_OTHER_ID (another employee in the same branch) to
//     .env.test.local.
//
// Uses a far-future date so it never collides with real availability. All test
// rows are cleaned up at the end.

import { env, signInAs, assertOk, assertBlocked, summary } from './helpers.mjs'

const TEST_DATE = '2099-01-04' // a Sunday, far in the future
const branchId = Number(env.TEST_BRANCH_ID || 1)
const otherBranchId = branchId === 1 ? 2 : 1

const { client: branch } = await signInAs('branch')

// Discover a real employee + shift in the manager's branch to reference.
const { data: emps } = await branch.from('branch_employees')
  .select('id').eq('branch_id', branchId).eq('active', true).limit(1)
const { data: shiftsRows } = await branch.from('branch_shifts')
  .select('id').eq('branch_id', branchId).limit(1)

if (!emps?.length || !shiftsRows?.length) {
  console.log('SKIP: no employees/shifts in the test branch — seed some first.')
  summary()
}

const empId = emps[0].id
const shiftId = shiftsRows[0].id

function constraintRow(bid, eid) {
  return { branch_id: bid, employee_id: eid, date: TEST_DATE, shift_id: shiftId, availability: 'unavailable' }
}

console.log('\n── schedule_constraints (branch manager) ──')
assertOk(
  await branch.from('schedule_constraints')
    .upsert(constraintRow(branchId, empId), { onConflict: 'employee_id,date,shift_id' }),
  'branch writes availability for own branch'
)
assertBlocked(
  await branch.from('schedule_constraints').insert(constraintRow(otherBranchId, empId)),
  'branch blocked from writing another branch'
)

console.log('\n── schedule_constraints (factory) ──')
const { client: factory } = await signInAs('factory')
assertBlocked(
  await factory.from('schedule_constraints').insert(constraintRow(branchId, empId)),
  'factory blocked from writing branch scheduling'
)

console.log('\n── schedule_constraints (admin) ──')
const { client: admin } = await signInAs('admin')
assertOk(
  await admin.from('schedule_constraints')
    .upsert({ ...constraintRow(branchId, empId), availability: 'prefer_not' }, { onConflict: 'employee_id,date,shift_id' }),
  'admin writes availability for any branch'
)

// Optional: employee self-write scope
if (env.TEST_EMPLOYEE_USERNAME && env.TEST_EMPLOYEE_ID) {
  console.log('\n── schedule_constraints (employee self-write) ──')
  const selfId = Number(env.TEST_EMPLOYEE_ID)
  const { client: employee } = await signInAs('employee')
  assertOk(
    await employee.from('schedule_constraints')
      .upsert(constraintRow(branchId, selfId), { onConflict: 'employee_id,date,shift_id' }),
    'employee writes own availability'
  )
  if (env.TEST_EMPLOYEE_OTHER_ID) {
    assertBlocked(
      await employee.from('schedule_constraints').insert(constraintRow(branchId, Number(env.TEST_EMPLOYEE_OTHER_ID))),
      'employee blocked from writing another employee'
    )
  }
} else {
  console.log('\n(skip employee self-write — set TEST_EMPLOYEE_USERNAME/_PASSWORD/_ID to enable)')
}

// Cleanup — admin removes all test rows for the far-future date
await admin.from('schedule_constraints').delete().eq('date', TEST_DATE)

summary()
