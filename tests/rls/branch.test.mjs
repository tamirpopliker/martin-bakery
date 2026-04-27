// RLS test suite — branch role
// Branch should: CRUD scope=branch for own branch_id. Be blocked from other branches, factory, shared.

import { env, signInAs, makeTestSupplier, cleanupTestSuppliers, assertOk, assertBlocked, summary } from './helpers.mjs'

const OWN = parseInt(env.TEST_BRANCH_ID || '1', 10)
const OTHER = OWN === 1 ? 2 : 1

console.log(`=== RLS test: branch (own=${OWN}, other=${OTHER}) ===`)

const admin = (await signInAs('admin')).client
await cleanupTestSuppliers(admin)
await admin.auth.signOut()

const { client } = await signInAs('branch')

// PERMITTED: own branch
const r1 = await client.from('suppliers_new').insert(makeTestSupplier('branch', OWN)).select().single()
assertOk(r1, `branch INSERT own-branch (${OWN})`)
const ownId = r1.data?.id

if (ownId) {
  const ru = await client.from('suppliers_new').update({ contact: 'branch-updated' }).eq('id', ownId)
  assertOk(ru, 'branch UPDATE own-branch row')
  const rd = await client.from('suppliers_new').delete().eq('id', ownId)
  assertOk(rd, 'branch DELETE own-branch row')
}

// BLOCKED: other branch
const r2 = await client.from('suppliers_new').insert(makeTestSupplier('branch', OTHER)).select().single()
assertBlocked(r2, `branch INSERT other-branch (${OTHER})`)

// BLOCKED: factory
const r3 = await client.from('suppliers_new').insert(makeTestSupplier('factory')).select().single()
assertBlocked(r3, 'branch INSERT factory')

// BLOCKED: shared
const r4 = await client.from('suppliers_new').insert(makeTestSupplier('shared')).select().single()
assertBlocked(r4, 'branch INSERT shared')

await client.auth.signOut()

// Cleanup
const adminAgain = (await signInAs('admin')).client
await cleanupTestSuppliers(adminAgain)
await adminAgain.auth.signOut()

summary()
