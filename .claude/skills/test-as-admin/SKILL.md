---
name: test-as-admin
description: Run the RLS test suite as the admin test user. Verifies admin can perform full CRUD on suppliers_new across all scopes (factory/shared/branch).
---

# test-as-admin

Run the admin RLS test suite and report results.

## Steps

1. Verify `.env.test.local` exists in the repo root. If not, instruct the user to
   copy `.env.test.local.example` to `.env.test.local` and fill in passwords. Stop.
2. Run from the repo root:
   ```bash
   node tests/rls/admin.test.mjs
   ```
3. Parse the output and report:
   - Total passed/failed.
   - For any failure, show the test name and the error message.
4. If exit code is 2, the setup is broken (missing env, sign-in failed) — surface
   the FATAL line and tell the user what to fix. Do not retry.
5. If exit code is 1, RLS policies are not behaving as expected. Show which assertions
   failed.

## Don't

- Don't try to create the test users yourself — they require Dashboard access.
- Don't put credentials anywhere except `.env.test.local`.
- Don't run with elevated privileges (service role key) — these tests use the anon key.
