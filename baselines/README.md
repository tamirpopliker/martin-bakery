# Financial baselines — regression guard for P&L refactors

These snapshots freeze the numbers the app produces **today**, so that any refactor
touching revenue / cost / P&L logic can be checked against them. The workflow:

1. Before a refactor, note the current baseline file (e.g. `financial_baseline_2026-07-11.json`).
2. Make the change on a branch.
3. Re-run the SQL below against the same Supabase project.
4. Diff the results against the baseline. **A number that moved is a red flag** — either the
   refactor changed behaviour (investigate) or it fixed a real bug (expected — then regenerate
   the baseline and document why).

This complements the unit tests in `src/lib/__tests__/plFormulas.test.ts`, which lock the pure
profit **formulas**. The baseline locks the aggregated **numbers** end-to-end.

## Known data caveats (read before trusting a diff)

- **First reliable month = May 2026.** Everything before it (the cashier-source migration
  overlap) was partial data and is excluded from the baseline.
- **June/July fixed costs are partial**, and **July is a partial month**.
- One `branch_waste` row has a corrupt date (year 275760); month bucketing excludes it.

## Waste (פחת) is a KPI, not a P&L deduction

Waste is end-of-day leftover product. It is **not** subtracted from profit, because that product
was already counted in purchases (raw materials) — subtracting it again would double-count.
It is tracked only as a standalone KPI. The unit tests in
`src/lib/__tests__/plFormulas.test.ts` enforce this.

## SQL — branch revenue by month (app definition)

```sql
with months as (
  select generate_series(date '2026-05-01', date '2026-07-01', interval '1 month')::date as m
),
legacy as (
  select b.id bid, b.name, date_trunc('month',r.date)::date m, sum(r.amount) amt
  from branch_revenue r join branches b on b.id=r.branch_id group by 1,2,3
),
clos as (
  select branch_id bid, date_trunc('month',date)::date m,
         sum(cash_sales+coalesce(credit_sales,0)+coalesce(check_sales,0)) amt
  from register_closings group by 1,2
)
select b.name as branch, to_char(mo.m,'YYYY-MM') as month,
  round(coalesce(l.amt,0),2) as legacy_revenue,
  round(coalesce(c.amt,0),2) as closings_revenue,
  round(coalesce(l.amt,0)+coalesce(c.amt,0),2) as total_revenue
from months mo cross join branches b
left join legacy l on l.bid=b.id and l.m=mo.m
left join clos c on c.bid=b.id and c.m=mo.m
order by mo.m, b.name;
```

## SQL — monthly cost components

```sql
with m as (select generate_series(date '2026-05-01', date '2026-07-01', interval '1 month')::date mo)
select to_char(m.mo,'YYYY-MM') as ym,
 (select round(sum(actual_employer_cost),2) from employer_costs e
    where e.year=extract(year from m.mo)::int and e.month=extract(month from m.mo)::int) as employer_cost_total,
 (select round(sum(actual_employer_cost),2) from employer_costs e
    where e.year=extract(year from m.mo)::int and e.month=extract(month from m.mo)::int and e.is_headquarters) as hq_cost,
 (select round(sum(coalesce(amount_without_vat,amount)),2) from supplier_invoices si where date_trunc('month',si.date)=m.mo) as suppliers_ex_vat,
 (select round(sum(amount),2) from fixed_costs fc where fc.month=to_char(m.mo,'YYYY-MM')) as fixed_costs_total,
 (select round(sum(amount),2) from branch_waste w where date_trunc('month',w.date)=m.mo) as branch_waste,
 (select round(sum(amount),2) from factory_sales fs where fs.is_internal=true and date_trunc('month',fs.date)=m.mo) as factory_internal
from m order by m.mo;
```
