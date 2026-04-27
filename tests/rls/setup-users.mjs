// One-time setup: creates the 3 test Auth users via Supabase Admin API.
// Generates strong random passwords and prints them — you copy them into .env.test.local.
// Idempotent: re-runs skip users that already exist.
//
// REQUIRES: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (find it in
//   Supabase Dashboard → Project Settings → API → service_role).
//
// SECURITY: the service role key bypasses RLS entirely — treat it like a root password.
//   Preferred: pass inline so it never touches disk:
//     SUPABASE_SERVICE_ROLE_KEY=eyJhbG... node tests/rls/setup-users.mjs
//   Alternative: temporarily put it in .env.test.local, run the script, REMOVE it after.
//   Never commit it. .env.test.local is gitignored, but stay vigilant.
//
// Usage:
//   node tests/rls/setup-users.mjs

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env.test.local')
  if (!fs.existsSync(envPath)) return {}
  const env = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trim = line.trim()
    if (!trim || trim.startsWith('#')) continue
    const eq = trim.indexOf('=')
    if (eq < 0) continue
    env[trim.slice(0, eq).trim()] = trim.slice(eq + 1).trim()
  }
  return env
}

const fileEnv = loadDotEnv()
const SUPABASE_URL = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) {
  console.error('FATAL: SUPABASE_URL missing. Set it in .env.test.local or pass via env.')
  process.exit(2)
}
if (!SERVICE_KEY) {
  console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY missing.')
  console.error('Find it in: Supabase Dashboard → Project Settings → API → service_role.')
  console.error('Pass inline (recommended):')
  console.error('  SUPABASE_SERVICE_ROLE_KEY=eyJ... node tests/rls/setup-users.mjs')
  process.exit(2)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const users = [
  { role: 'admin',   username: fileEnv.TEST_ADMIN_USERNAME   || 'test-admin' },
  { role: 'factory', username: fileEnv.TEST_FACTORY_USERNAME || 'test-factory' },
  { role: 'branch',  username: fileEnv.TEST_BRANCH_USERNAME  || 'test-branch' },
]

const strongPassword = () => randomBytes(18).toString('base64url')

const created = []
const existed = []
let failed = 0

for (const u of users) {
  const email = `${u.username}@martin.local`
  const password = strongPassword()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error) {
    const msg = error.message || String(error)
    if (/already|registered|exists|duplicate/i.test(msg)) {
      console.log(`SKIP   ${email} (already exists)`)
      existed.push(email)
      continue
    }
    console.error(`FAIL   ${email}: ${msg}`)
    failed++
    continue
  }

  console.log(`OK     ${email} — ${data.user?.id}`)
  created.push({ role: u.role, email, password })
}

console.log()

if (created.length > 0) {
  console.log('====================================================================')
  console.log('SAVE THESE PASSWORDS NOW. They are shown only once.')
  console.log('Paste into .env.test.local:')
  console.log('====================================================================')
  for (const c of created) {
    console.log(`TEST_${c.role.toUpperCase()}_PASSWORD=${c.password}`)
  }
  console.log('====================================================================')
}

if (existed.length > 0) {
  console.log()
  console.log(`${existed.length} user(s) already existed and were skipped.`)
  console.log('If you lost their passwords, delete them in the Dashboard and re-run.')
}

console.log()
console.log('Next steps:')
console.log('  1. Save passwords above into .env.test.local.')
console.log('  2. If you put SUPABASE_SERVICE_ROLE_KEY in .env.test.local, REMOVE it now.')
console.log('  3. Run sql/030_test_users.sql in Supabase SQL Editor (creates app_users rows).')
console.log('  4. Run /test-as-admin, /test-as-factory, /test-as-branch (or node tests/rls/*.test.mjs).')

if (failed > 0) {
  console.error(`\n${failed} user(s) failed to create. See errors above.`)
  process.exit(1)
}
