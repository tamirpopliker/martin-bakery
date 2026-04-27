// RLS test suite — admin role
// Admin should be able to CRUD suppliers in any scope.

import { signInAs, makeTestSupplier, cleanupTestSuppliers, assertOk, summary } from './helpers.mjs'

console.log('=== RLS test: admin ===')

const { client } = await signInAs('admin')
await cleanupTestSuppliers(client)

// INSERT
const r1 = await client.from('suppliers_new').insert(makeTestSupplier('factory')).select().single()
assertOk(r1, 'admin INSERT factory')
const factoryId = r1.data?.id

const r2 = await client.from('suppliers_new').insert(makeTestSupplier('shared')).select().single()
assertOk(r2, 'admin INSERT shared')

const r3 = await client.from('suppliers_new').insert(makeTestSupplier('branch', 1)).select().single()
assertOk(r3, 'admin INSERT branch (id=1)')

const r4 = await client.from('suppliers_new').insert(makeTestSupplier('branch', 2)).select().single()
assertOk(r4, 'admin INSERT branch (id=2 — cross-branch)')

// UPDATE
if (factoryId) {
  const r = await client.from('suppliers_new').update({ contact: 'updated' }).eq('id', factoryId)
  assertOk(r, 'admin UPDATE factory row')
}

// DELETE (single row — full cleanup happens at the end)
if (factoryId) {
  const r = await client.from('suppliers_new').delete().eq('id', factoryId)
  assertOk(r, 'admin DELETE factory row')
}

await cleanupTestSuppliers(client)
await client.auth.signOut()
summary()
