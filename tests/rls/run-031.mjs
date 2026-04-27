// One-off: apply migration 031 via test-admin client (admin RLS allows INSERT).
import { signInAs } from './helpers.mjs'

const { client } = await signInAs('admin')

// Insert hq_estimate_pct=10 if not present
const { data: existing } = await client.from('system_settings').select('key,value').eq('key', 'hq_estimate_pct').maybeSingle()

if (existing) {
  console.log(`hq_estimate_pct already set: ${existing.value}`)
} else {
  const { error } = await client.from('system_settings').insert({ key: 'hq_estimate_pct', value: '10' })
  if (error) { console.error('insert failed:', error.message); process.exit(1) }
  console.log('hq_estimate_pct=10 inserted')
}

const { data: verify } = await client.from('system_settings').select('key,value').eq('key', 'hq_estimate_pct').maybeSingle()
console.log('verified:', verify)

await client.auth.signOut()
