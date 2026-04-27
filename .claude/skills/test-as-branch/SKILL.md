---
name: test-as-branch
description: Run the RLS test suite as the branch test user. Verifies branch can CRUD scope=branch for own branch_id only, and is blocked from other branches, factory, and shared.
---

# test-as-branch

Run the branch RLS test suite and report results.

## Steps

1. Verify `.env.test.local` exists in the repo root. If not, instruct the user to set
   it up from `.env.test.local.example`. Stop.
2. Run from the repo root:
   ```bash
   node tests/rls/branch.test.mjs
   ```
3. Parse the output and report passed/failed counts. For any failure, show the test
   name and error message.
4. The test reads `TEST_BRANCH_ID` from `.env.test.local` (defaults to 1). It picks a
   different branch ID for the "other branch" assertion automatically.
5. Common failure modes:
   - "branch INSERT other-branch — should have been blocked" → migration 029 is missing
     or its branch_id check is broken. Most critical signal.
   - "branch INSERT own-branch failed" → migration 029 didn't apply, or the test user's
     branch_id in app_users doesn't match TEST_BRANCH_ID.
   - exit code 2 → setup broken; surface and stop.
