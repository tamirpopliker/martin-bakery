# martin-bakery

Internal management system for Martin Bakery — factory + 3 branches. Vite + React 19 + TypeScript + Supabase, deployed to Vercel. UI is Hebrew/RTL.

For full project structure, page-by-page breakdown, and architecture, see `CONTEXT.md`. For outstanding work, see `TODO.md` and `REVIEW_2026_04_20.md`.

## Dev commands

- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build`
- `npm run lint` — ESLint
- `npm run preview` — preview production build

## Canonical sources of truth — do not duplicate

These exist because past duplication caused real bugs (dashboards and email reports showing different numbers). Always reuse, never re-implement:

- **`src/lib/calculatePL.ts`** — the only P&L calculator. `calculateBranchPL`, `calculateFactoryPL`, `calculateConsolidatedPL`. Any component or page that needs profit/loss numbers calls these. Do not inline the formula in a component.
- **`src/lib/dbHelpers.ts::safeDbOperation`** — the standard wrapper for Supabase mutations. Translates Postgres error codes to Hebrew. Use it instead of `if (error) { alert(...); return }`.
- **DB view `branch_pl_summary`** — pre-aggregated per-branch P&L. Prefer `fetchAllBranchesProfit` over fanning out `calculateBranchPL` per branch in a loop.
- **`src/lib/period.ts`** — period computation, Hebrew month names, comparison periods. Don't hand-roll date math for periods.
- **`src/lib/internalCustomers.ts::detectBranchId`** — mapping internal customer names → branch IDs. Centralized; do not pattern-match branch names elsewhere.

## Domain rules that aren't visible in code

- **VAT** = 18% (Israel, Jan-2025+). Single constant; if you need it in a new place, extract to `lib/` rather than re-declaring.
- **Labor cost priority**: `employer_costs` table → fall back to `labor` table. Never sum both.
- **Internal sales priority**: `branch_expenses` rows with `from_factory=true` take precedence over `internal_sales`. Avoid double-counting.
- **Manager salary**: lives in `fixed_costs` with `entity_id='mgmt'`. Excluded from per-branch fixed costs, added separately as "controlled profit" subtraction. The fallback chain is encoded in `calculatePL.ts` — read it before changing.
- **Auth / username mode**: `Login.tsx` synthesizes `<username>@martin.local` emails so Supabase Auth + RLS work while users see a username UX. Don't expose the synthetic email anywhere.
- **Anon key is in the browser** — every new table needs RLS with branch-scoped policies. Never trust the client.

## Known gotchas

- **Date filters**: bound end-of-period with `.lt('month', nextMonth)`, **not** `.lte('month', endMonth)`. The `month` column stores the first of the month, so `.lte` includes the next month.
- **Manager salary double-count**: when querying `fixed_costs`, exclude `entity_id='mgmt'` unless you specifically want it.
- **Edge Functions don't share code with `src/`** — `supabase/functions/send-reports/lib/db.ts` and `check-alerts/` have their own DB layer. Any change to revenue/labor/P&L logic in `src/lib/` must be mirrored there manually, or owners get email reports with wrong numbers.
- **`xlsx` is heavy** — currently imported eagerly in 8 files. New uploaders should `import()` it lazily.
- **Mutations are not atomic** — Supabase JS client has no transactions. For multi-step writes (delete-then-insert), use a Postgres function (RPC) rather than sequencing client-side.

## Conventions

- UI text: Hebrew. Identifiers, comments, commit messages: English.
- TypeScript `strict: true` is enforced. Avoid `any`; prefer real types in `src/types/index.ts`.
- All mutations go through `safeDbOperation`. Don't write raw `if (error) alert(...)`.
- New pages register their access rules in `UserContext.tsx::canAccessPage`.
- Branches are dynamic — read via `useBranches()`, never hardcode branch IDs/names.
