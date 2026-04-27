// RLS test suite — factory role
// Factory should: CRUD scope=factory. Be blocked from scope=shared and scope=branch.

import { signInAs, makeTestSupplier, cleanupTestSuppliers, assertOk, assertBlocked, summary } from './helpers.mjs'

console.log('=== RLS test: factory ===')

const admin = (await signInAs('admin')).client
await cleanupTestSuppliers(admin)
await admin.auth.signOut()

const { client } = await signInAs('factory')

// PERMITTED: factory scope
const r1 = await client.from('suppliers_new').insert(makeTestSupplier('factory')).select().single()
assertOk(r1, 'factory INSERT factory')
const factoryId = r1.data?.id

if (factoryId) {
  const ru = await client.from('suppliers_new').update({ contact: 'factory-updated' }).eq('id', factoryId)
  assertOk(ru, 'factory UPDATE own factory row')
  const rd = await client.from('suppliers_new').delete().eq('id', factoryId)
  assertOk(rd, 'factory DELETE own factory row')
}

// BLOCKED: shared
const r2 = await client.from('suppliers_new').insert(makeTestSupplier('shared')).select().single()
assertBlocked(r2, 'factory INSERT shared')

// BLOCKED: branch
const r3 = await client.from('suppliers_new').insert(makeTestSupplier('branch', 1)).select().single()
assertBlocked(r3, 'factory INSERT branch')

await client.auth.signOut()

// Cleanup with admin
const adminAgain = (await signInAs('admin')).client
await cleanupTestSuppliers(adminAgain)
await adminAgain.auth.signOut()

summary()
