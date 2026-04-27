---
name: test-as-factory
description: Run the RLS test suite as the factory test user. Verifies factory can CRUD scope=factory and is blocked from shared and branch scopes.
---

# test-as-factory

Run the factory RLS test suite and report results.

## Steps

1. Verify `.env.test.local` exists in the repo root. If not, instruct the user to set
   it up from `.env.test.local.example`. Stop.
2. Run from the repo root:
   ```bash
   node tests/rls/factory.test.mjs
   ```
3. Parse the output and report passed/failed counts. For any failure, show the test
   name and error message.
4. Common failure modes:
   - "should have been blocked" → RLS is too permissive (factory can write where they
     shouldn't).
   - "non-RLS error" → likely a schema mismatch or app_users row missing. Surface the
     actual error.
   - exit code 2 → setup broken (sign-in failed, env missing). Tell the user what to
     fix; don't retry.
