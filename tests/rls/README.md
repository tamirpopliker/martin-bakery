# RLS test suite

Verifies Row-Level Security policies on `suppliers_new` for the three app roles
(`admin`, `factory`, `branch`). Tests run against the **production** Supabase project
using dedicated test users.

Each test signs in via username/password (Supabase Auth, not Google OAuth), performs
INSERT/UPDATE/DELETE attempts on `suppliers_new`, and asserts the expected outcome
(allowed or blocked by RLS). Test rows are prefixed with `[TEST]` and cleaned up at the
end of each run by an admin client.

## One-time setup

1. **Copy `.env.test.local.example` to `.env.test.local`** in the repo root and fill in
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` (find them in your `.env.local` or in the
   Supabase Dashboard → Project Settings → API). Leave the password lines empty for now.
   `.env.test.local` is gitignored (matches `*.local`).

2. **Create the Auth users automatically** with the setup script (recommended):
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=eyJ... node tests/rls/setup-users.mjs
   ```
   - The service-role key is in Supabase Dashboard → Project Settings → API → `service_role`.
   - Pass it inline (as above) so it never touches disk. Never commit it.
   - The script prints 3 generated passwords. Copy them into `.env.test.local`.

   *Alternative — manual:* Dashboard → Authentication → Users → Add user, create
   `test-admin@martin.local`, `test-factory@martin.local`, `test-branch@martin.local`
   with passwords of your choice, then put those passwords into `.env.test.local`.

3. **Run [`sql/030_test_users.sql`](../../sql/030_test_users.sql)** in the SQL Editor.
   Idempotent — safe to re-run. Creates `app_users` rows and links `auth_uid`.

4. **Verify linking:**
   ```sql
   SELECT email, role, branch_id, auth_uid IS NOT NULL AS linked
   FROM app_users WHERE email LIKE 'test-%@martin.local';
   ```
   All three rows should have `linked = true`.

## Running

From the repo root:

```bash
node tests/rls/admin.test.mjs
node tests/rls/factory.test.mjs
node tests/rls/branch.test.mjs
```

Exit code 0 on success, 1 on any failed assertion, 2 on setup error
(missing env, sign-in failure).

Or invoke the per-role skills inside Claude Code: `/test-as-admin`,
`/test-as-factory`, `/test-as-branch`.
