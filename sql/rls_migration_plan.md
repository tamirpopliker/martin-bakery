# RLS Migration Plan — martin-bakery

**תאריך:** 2026-04-21
**מצב:** תוכנית — טרם הורץ SQL. נדרשת החלטת משתמש לפני ביצוע.
**קלט:** סריקת כל `sql/*.sql` + ה-`.from('...')` ב-`src/` + לוגיקת הרשאות ב-`src/lib/UserContext.tsx`.

---

## 1. סיכום ניהולי

* הקוד פונה ל-**57** טבלאות. רק **24** מופיעות עם `CREATE TABLE` ב-`sql/` — נותרו **~28** טבלאות שנוצרו בדשבורד Supabase בלי migration, ולכן מצב ה-RLS שלהן **לא ידוע מהקוד** וצריך לאמת בדשבורד.
* טבלאות **ליבה פיננסיות** (`branch_revenue`, `branch_expenses`, `branch_labor`, `branch_waste`, `fixed_costs`, `factory_sales`, `factory_b2b_sales`, `factory_repairs`, `factory_waste`, `daily_production`, `employees`) — **אין להן הגדרת RLS ב-sql/** וזה הסיכון הגדול ביותר. אם RLS לא פעיל עליהן, כל מי שיש לו את ה-anon key (חשוף בדפדפן) יכול לקרוא/לעדכן/למחוק את כל הדאטה העסקי.
* טבלאות **שיש להן RLS ב-sql/** — חלקן עם **policies רופפות**: `branch_kpi_targets` נותנת לכל משתמש מאומת UPDATE; `system_settings` גם; `branch_employees` מאפשרת לכל branch user ANY לעדכן עובדים של סניפים אחרים.
* **אי-עקביות סכמתית:** ה-CHECK של `app_users.role` מאפשר רק `('admin','factory','branch')`, אבל הקוד וה-policies עצמם מתייחסים גם ל-`'employee'` ול-`'scheduler'`. הפוליסי ב-018 (`branch_manage_messages`) לעולם לא תמתאם למשתמש שכזה — כי אי-אפשר לשמור את ה-role הזה בטבלה.
* **היקף אמיתי של התיקון:** 28 טבלאות להוסיף RLS + ~5 טבלאות לחדד policies קיימות + תיקון schema של `app_users.role`. הערכת זמן גסה: 1-2 ימי עבודה לתיקון + בדיקה.

---

## 2. מצב קיים — טבלה מקיפה

### 2.1 טבלאות עם migration ו-RLS

| טבלה | מקור | RLS | Policy מסכם | הערכת הדוק |
|---|---|---|---|---|
| `app_users` | 004 | ✅ | SELECT: all authenticated; ALL: admin | 🟡 "all read" חושף אימיילים ו-branch_id |
| `branches` | 006 | ✅ | SELECT: all; ALL: admin | 🟢 OK |
| `alert_rules` | 007 | ✅ | SELECT: all; ALL: admin | 🟡 all יכול לקרוא rules |
| `alert_log` | 007 | ✅ | SELECT: all; ALL: admin | 🟡 all יכול לראות לוג |
| `system_settings` | 008/012 | ✅ | SELECT: all. 012 מוסיף **UPDATE+INSERT: all authenticated** | 🔴 כל משתמש יכול לעדכן `overhead_pct` |
| `branch_employees` | 009 | ✅ | SELECT: all; ALL: admin OR branch | 🔴 branch user יכול לעדכן עובדים של סניפים אחרים |
| `branch_kpi_targets` | 011 | ✅ | **ALL: any authenticated** | 🔴 כל משתמש יכול לעדכן יעדי KPI |
| `production_reports` | 013 | ✅ | ALL: admin OR factory | 🟢 OK |
| `internal_sales` | 014 | ✅ | ALL: admin OR factory OR branch | 🟡 לא מסונן לפי branch_id — branch 1 יכול לגעת ב-branch 2 |
| `internal_sale_items` | 014 | ✅ | ALL: admin OR factory OR branch | 🟡 אותה בעיה |
| `product_department_mapping` | 014 | ✅ | ALL: admin OR factory | 🟢 OK |
| `products` | 015 | ✅ | ALL: admin OR factory | 🟢 OK |
| `external_sales` | 016 | ✅ | ALL: admin OR factory | 🟢 OK |
| `b2b_customers` | 017 | ✅ | ALL: admin | 🟢 OK |
| `b2b_invoices` | 017 | ✅ | ALL: admin | 🟢 OK |
| `b2b_payments` | 017 | ✅ | ALL: admin | 🟢 OK |
| `branch_messages` | 018 | ✅ | ALL: admin OR branch OR `'employee'` | 🔴 `'employee'` לא תקף + לא מסונן לפי branch_id |
| `message_reads` | 018 | ✅ | ALL: admin OR branch OR `'employee'` | 🔴 אותה בעיה |
| `scheduled_messages` | 019 | ✅ | ALL: admin OR branch | 🟡 לא מסונן לפי branch_id |
| `scheduled_message_log` | 019 | ✅ | ALL: admin OR branch | 🟡 אותה בעיה |
| `employer_costs` | 020 | ✅ | ALL: admin | 🟢 OK |
| `employer_costs_uploads` | 020 | ✅ | ALL: admin | 🟢 OK |
| `labor` | 022 | ✅ | SELECT: all authenticated (קריאה בלבד) | 🟢 OK (אבל אין policy ל-write — כלומר אף אחד לא יכול לכתוב דרך הקליינט. להבדוק שזה מכוון.) |
| `register_closings` | 023 | ✅ | ALL: admin OR branch | 🟡 לא מסונן לפי branch_id |
| `change_fund` | 023 | ✅ | ALL: admin OR branch | 🟡 אותה בעיה |
| `special_orders` | 024 | ✅ | ALL: admin OR branch OR factory | 🟡 לא מסונן לפי branch_id |
| `order_notifications` | 024 | ✅ | ALL: any authenticated | 🟡 רחב מאוד |

### 2.2 טבלאות עם migration אבל **ללא** RLS

| טבלה | מקור | הערה |
|---|---|---|
| `report_log` | 005 | 🔴 CREATE בלי ALTER ENABLE RLS |
| `internal_customer_map` | internal_orders_schema.sql | 🔴 CREATE בלי RLS — מיפוי קריטי |

### 2.3 טבלאות שנוצרו בדשבורד (אין להן כל migration) — **מצב RLS לא ידוע**

> **יש לאמת בדשבורד Supabase (Authentication → Policies) עבור כל אחת מהבאות:**

| טבלה | נקרא מ-(דוגמאות) | חומרת הסיכון אם RLS כבוי |
|---|---|---|
| `employees` | FactoryEmployees, Labor, calculatePL | 🔴 שמות עובדים + שכר + department |
| `branch_revenue` | BranchRevenue, calculatePL, Home | 🔴 הכנסות יומיות של כל הסניפים |
| `branch_expenses` | BranchExpenses, calculatePL, BranchOrders | 🔴 הוצאות של כל הסניפים |
| `branch_labor` | BranchLabor, calculatePL | 🔴 שכר עובדים של כל הסניפים |
| `branch_waste` | BranchWaste, calculatePL | 🔴 פסולת של כל הסניפים |
| `fixed_costs` | BranchSettings, FactorySettings, calculatePL | 🔴 עלויות קבועות + שכר מנהלים |
| `factory_sales` | calculatePL, FactoryDashboard, InternalSalesUpload | 🔴 מכירות מפעל |
| `factory_b2b_sales` | calculatePL, FactoryB2B, FactoryDashboard | 🔴 מכירות B2B |
| `factory_repairs` | FactoryRepairs, FactoryEquipment | 🟠 עלויות תחזוקה |
| `factory_waste` | FactoryWaste, FactoryEquipment | 🟠 פסולת מפעל |
| `daily_production` | DailyProduction, ProductionReportUpload, DepartmentDashboard | 🟠 ייצור יומי |
| `suppliers` | Suppliers, FactorySettings | 🟠 רשימת ספקים |
| `supplier_invoices` | Suppliers, SuppliersReport | 🔴 חשבוניות ספקים |
| `unified_suppliers` | SuppliersReport | 🟠 איחוד ספקים |
| `branch_suppliers` | BranchSuppliers | 🟠 ספקים של סניף |
| `customers` | BranchCreditCustomers | 🟠 לקוחות אשראי |
| `schedule_constraints` | ManagerConstraintsView, EmployeeConstraints, WeeklySchedule | 🟠 זמינות עובדים |
| `schedule_publications` | WeeklySchedule, ScheduleHistory, MySchedule | 🟠 פרסום סידור |
| `shift_assignments` | WeeklySchedule, MySchedule, ScheduleHistory | 🟠 שיבוצים |
| `shift_roles` | ShiftSettings, WeeklySchedule, EmployeeConstraints | 🟢 הגדרות תפקיד |
| `shift_staffing_requirements` | ShiftSettings, WeeklySchedule | 🟢 דרישות איוש |
| `special_days` | ShiftSettings, WeeklySchedule | 🟢 חגים |
| `branch_shifts` | ShiftSettings, WeeklySchedule, MySchedule | 🟢 הגדרות משמרת |
| `employee_role_assignments` | EmployeeConstraints, WeeklySchedule | 🟢 תפקידי עובדים |
| `kpi_targets` | FactorySettings | 🟠 יעדי מפעל |
| `packaging_products` | FactoryDashboard | 🟠 מוצרי אריזה |
| `message_attachments` | BranchCommunication | 🟡 קבצים מצורפים |
| `branch_pl_summary` | profitCalc.ts | 🔴 VIEW (לא טבלה) — RLS תלוי בטבלאות המקור |

### 2.4 סיכומי חומרה

| רמה | ספירה | משמעות |
|---|---|---|
| 🔴 קריטי (חשיפת נתונים פיננסיים גולמיים) | **11** | `employees`, `branch_revenue`, `branch_expenses`, `branch_labor`, `branch_waste`, `fixed_costs`, `factory_sales`, `factory_b2b_sales`, `supplier_invoices`, `report_log`, `internal_customer_map` |
| 🔴 Policy רופפת (UPDATE פתוח לכולם) | **4** | `branch_kpi_targets`, `system_settings`, `branch_employees`, `branch_messages`/`message_reads` (role='employee' לא תקף) |
| 🟠 ללא RLS — סיכון בינוני | **17** | שאר טבלאות ה-2.3 |
| 🟡 RLS קיים אבל לא מסונן לפי `branch_id` | **8** | `internal_sales`, `internal_sale_items`, `scheduled_messages`, `register_closings`, `change_fund`, `special_orders`, `order_notifications`, `app_users` |
| 🟢 OK | 13 | ראה 2.1 |

---

## 3. ניתוח תפקידים — מי אמור לגשת למה

בהתבסס על `src/lib/UserContext.tsx`:

### 3.1 `admin`
* גישה ללא הגבלה — יכול לראות את כל הסניפים, כל המפעל, כל הדוחות.
* **RLS מומלץ:** `FOR ALL USING (app_users.role='admin')` בכל טבלה.

### 3.2 `factory`
* גישה: דשבורד מפעל, B2B, לייבור מפעל, ספקים, הזמנות פנימיות, מכירות חיצוניות, ייצור יומי, ציוד, טיפולים, פסולת, קטלוג מוצרים, עובדי מפעל.
* **לא** אמור לגשת לנתוני סניפים (`branch_revenue`, `branch_expenses`, etc.)
* מחלקה (`managed_department`) מסננת רק בצד הלקוח (`getDeptFromPage` + `excluded_departments`). אין סינון שרת.
* **RLS מומלץ:**
  * טבלאות מפעל (`factory_*`, `daily_production`, `products`, `employees` WHERE department IN factory depts): factory יכול לגעת.
  * טבלאות סניף: factory לא יכול לגעת כלל.

### 3.3 `branch`
* גישה: דשבורד הסניף שלו (`branch_id` מטבלת `app_users`), קופה, הכנסות, הוצאות, לייבור, פסולת, הזמנות פנימיות, סידור עבודה.
* Restricted variant (`@martin.local` email): רק סידור עבודה + הזמנות מיוחדות.
* **לא** אמור לגשת לנתוני סניפים אחרים או למפעל.
* **RLS מומלץ:** כל טבלה עם `branch_id` צריכה `FOR ALL USING (branch_id = (SELECT branch_id FROM app_users WHERE auth_uid = auth.uid()))`.

### 3.4 `employee` (**קיים רק ב-TypeScript — לא ב-DB CHECK**)
* גישה מוגדרת ב-UserContext: `employee-home`, `employee-schedule`, `employee-constraints`, `employee-tasks`.
* ב-DB אין אפשרות לשמור `role='employee'` (ראה §4 — החלטות פתוחות).

### 3.5 `scheduler` (**קיים רק ב-TypeScript — לא ב-DB CHECK**)
* גישה: תכנון סידור, היסטוריה, אילוצים, הגדרות משמרת.

---

## 4. תוכנית תיקון לפי עדיפויות

> **כל ה-SQL להלן הוא הצעה. אל תריץ אותו לפני שאישרת את הנקודות ב-§5.**

### 4.1 עדיפות קריטית — טבלאות פיננסיות ללא RLS

#### 4.1.1 `branch_revenue`, `branch_expenses`, `branch_labor`, `branch_waste`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- תיקון 1: RLS על טבלאות הכנסה/הוצאה של סניפים
-- branch יראה/יערוך רק את הסניף שלו. admin — הכל.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE branch_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_waste ENABLE ROW LEVEL SECURITY;

-- branch_revenue
DROP POLICY IF EXISTS "branch_own_revenue" ON branch_revenue;
CREATE POLICY "branch_own_revenue" ON branch_revenue FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_uid = auth.uid()
        AND (role = 'admin'
             OR (role = 'branch' AND branch_id = branch_revenue.branch_id))
    )
  );

-- branch_expenses (אותה הגדרה)
DROP POLICY IF EXISTS "branch_own_expenses" ON branch_expenses;
CREATE POLICY "branch_own_expenses" ON branch_expenses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_uid = auth.uid()
        AND (role = 'admin'
             OR (role = 'branch' AND branch_id = branch_expenses.branch_id))
    )
  );

-- branch_labor (אותה הגדרה)
DROP POLICY IF EXISTS "branch_own_labor" ON branch_labor;
CREATE POLICY "branch_own_labor" ON branch_labor FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_uid = auth.uid()
        AND (role = 'admin'
             OR (role = 'branch' AND branch_id = branch_labor.branch_id))
    )
  );

-- branch_waste (אותה הגדרה)
DROP POLICY IF EXISTS "branch_own_waste" ON branch_waste;
CREATE POLICY "branch_own_waste" ON branch_waste FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_uid = auth.uid()
        AND (role = 'admin'
             OR (role = 'branch' AND branch_id = branch_waste.branch_id))
    )
  );
```

**סיכונים פוטנציאליים:**
* `calculatePL.ts` קורא ל-`branch_revenue` ללא פילטר לכל הסניפים יחד (לצורך CEODashboard). אם יש משתמש `factory` עם גישה ל-CEODashboard — הקריאה תחזיר רצף ריק. **לבדוק: האם משתמש `factory` באמת ניגש ל-CEODashboard?** לפי UserContext:113-120, `ceo_dashboard` חסום לכל מי שאינו admin — אז זה בטוח.
* אם יש cron/Edge Function שמחשב דוחות — ודא שהן רצות עם `service_role` (שמעקף RLS).

#### 4.1.2 `fixed_costs`

```sql
ALTER TABLE fixed_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fixed_costs_scoped" ON fixed_costs;
CREATE POLICY "fixed_costs_scoped" ON fixed_costs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          -- factory רואה עלויות של המפעל (entity_id = 'factory' או NULL)
          OR (u.role = 'factory' AND (fixed_costs.entity_id = 'factory' OR fixed_costs.entity_id IS NULL))
          -- branch רואה רק של הסניף שלו (entity_id = branch_id::text)
          OR (u.role = 'branch' AND fixed_costs.entity_id = u.branch_id::text)
        )
    )
  );
```

**סיכון:** צריך לוודא את **פורמט** `entity_id` — בדיקת דגימה של הטבלה הכרחית. אם זה למשל `'1'` ולא `1`, כבר כתבנו נכון. אם יש מפתחות אחרים (`'headquarters'`, `'hq'`, וכו') — צריך להרחיב.

#### 4.1.3 `employees`

```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- admin: מלא
DROP POLICY IF EXISTS "admin_manage_employees" ON employees;
CREATE POLICY "admin_manage_employees" ON employees FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

-- factory: רואה עובדי מפעל בלבד (department IN factory departments)
-- בנוסף, excluded_departments חל בצד הלקוח בלבד — אם רוצים גם שרת, צריך sub-select
DROP POLICY IF EXISTS "factory_read_employees" ON employees;
CREATE POLICY "factory_read_employees" ON employees FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND u.role = 'factory'
        AND employees.department IN ('creams','dough','packaging','cleaning')
    )
  );

DROP POLICY IF EXISTS "factory_write_employees" ON employees;
CREATE POLICY "factory_write_employees" ON employees FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND u.role = 'factory'
        AND employees.department IN ('creams','dough','packaging','cleaning')
    )
  );

-- branch: לא רואה employees כלל (יש להם branch_employees נפרדת)
-- NULL policy = deny — לא צריך לכתוב policy עבורם
```

**סיכון:** הקובץ `Labor.tsx` משתמש ב-`labor` כדי לקשר בין שם עובד ל-hours/employer_cost. אם `employees` חסום ל-branch — יש לוודא ש-branch לא משתמש ב-Labor.tsx. לפי UserContext:148-163, `labor` הוא factory-scope — אז זה בטוח.

#### 4.1.4 `factory_sales`, `factory_b2b_sales`

```sql
ALTER TABLE factory_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_b2b_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "factory_sales_access" ON factory_sales;
CREATE POLICY "factory_sales_access" ON factory_sales FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR u.role = 'factory'
          -- branch יכול לראות רק רשומות is_internal=true שממוענות אליו
          OR (u.role = 'branch' AND factory_sales.is_internal = true
              AND factory_sales.target_branch_id = u.branch_id)
        )
    )
  );

-- factory_b2b_sales — אותה הגדרה
DROP POLICY IF EXISTS "factory_b2b_sales_access" ON factory_b2b_sales;
CREATE POLICY "factory_b2b_sales_access" ON factory_b2b_sales FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR u.role = 'factory'
          OR (u.role = 'branch' AND factory_b2b_sales.is_internal = true
              AND factory_b2b_sales.target_branch_id = u.branch_id)
        )
    )
  );
```

**סיכון:** `BranchOrders.tsx` עושה `update` ל-`factory_sales` לשינוי `branch_status` — ודא ש-policy מאפשרת UPDATE ל-branch רק על שורות ממוענות אליו. הנוסחה לעיל אכן מאפשרת זאת (ה-USING חל גם על UPDATE).

#### 4.1.5 `supplier_invoices`, `suppliers`, `branch_suppliers`, `unified_suppliers`, `customers`

```sql
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE unified_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- suppliers: admin + factory (ספקי המפעל)
DROP POLICY IF EXISTS "suppliers_access" ON suppliers;
CREATE POLICY "suppliers_access" ON suppliers FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

-- supplier_invoices: admin + factory
DROP POLICY IF EXISTS "supplier_invoices_access" ON supplier_invoices;
CREATE POLICY "supplier_invoices_access" ON supplier_invoices FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

-- unified_suppliers: admin only (דוח ניהולי)
DROP POLICY IF EXISTS "unified_suppliers_access" ON unified_suppliers;
CREATE POLICY "unified_suppliers_access" ON unified_suppliers FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

-- branch_suppliers: admin + branch-own
DROP POLICY IF EXISTS "branch_suppliers_access" ON branch_suppliers;
CREATE POLICY "branch_suppliers_access" ON branch_suppliers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = branch_suppliers.branch_id))
    )
  );

-- customers (credit customers): admin + branch-own
-- **ספק: אם הטבלה אין עמודת branch_id, יש להחליט מה הסקופ**
DROP POLICY IF EXISTS "customers_access" ON customers;
CREATE POLICY "customers_access" ON customers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = customers.branch_id))
    )
  );
```

### 4.2 עדיפות גבוהה — `daily_production`, `factory_repairs`, `factory_waste`, `kpi_targets`, `packaging_products`

```sql
ALTER TABLE daily_production ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_repairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_waste ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE packaging_products ENABLE ROW LEVEL SECURITY;

-- כולן admin + factory
DROP POLICY IF EXISTS "daily_production_access" ON daily_production;
CREATE POLICY "daily_production_access" ON daily_production FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

DROP POLICY IF EXISTS "factory_repairs_access" ON factory_repairs;
CREATE POLICY "factory_repairs_access" ON factory_repairs FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

DROP POLICY IF EXISTS "factory_waste_access" ON factory_waste;
CREATE POLICY "factory_waste_access" ON factory_waste FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

DROP POLICY IF EXISTS "kpi_targets_access" ON kpi_targets;
CREATE POLICY "kpi_targets_access" ON kpi_targets FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

DROP POLICY IF EXISTS "packaging_products_access" ON packaging_products;
CREATE POLICY "packaging_products_access" ON packaging_products FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));
```

### 4.3 עדיפות גבוהה — חידוד policies קיימות

#### 4.3.1 `branch_kpi_targets` — להחליף "any authenticated" בסינון לפי branch_id

```sql
DROP POLICY IF EXISTS "Allow authenticated select" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated insert" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated update" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated delete" ON branch_kpi_targets;

CREATE POLICY "branch_kpi_targets_access" ON branch_kpi_targets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = branch_kpi_targets.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = branch_kpi_targets.branch_id))
    )
  );
```

**שים לב:** UserContext:129 חוסם `branch_settings` לכל מי שאינו admin בצד הלקוח — כלומר רק admin באמת נכנס. ה-RLS כאן מקשיח את זה גם ברמת ה-DB. אם בעתיד תרצו שגם branch יגדיר KPI — תצטרכו גם לעדכן את UserContext.

#### 4.3.2 `system_settings` — להסיר UPDATE כללי

```sql
-- הסרת ה-policies הרופפות מ-012
DROP POLICY IF EXISTS "Allow authenticated select" ON system_settings;
DROP POLICY IF EXISTS "Allow authenticated update" ON system_settings;
DROP POLICY IF EXISTS "Allow authenticated insert" ON system_settings;

-- החזרה למצב שנקבע ב-008: SELECT פתוח, WRITE רק admin
CREATE POLICY "Everyone can read system_settings" ON system_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage system_settings" ON system_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
```

**סיכון:** `BranchSettings.tsx` או `ChangeFund.tsx` עשויים לנסות לשמור `change_fund_base_{branch_id}` ל-`system_settings` כ-branch user — צריך לבדוק. אם כן, או להעביר ל-טבלה ייעודית או להוסיף policy ייחודית ל-`key LIKE 'change_fund_base_%'`.

#### 4.3.3 `branch_employees` — להוסיף סינון לפי branch_id

**הערה מעדכנת (2026-04-21, לפני commit של שלב 1):** סקירה של הסכימה
חשפה שני עמודות רגישות — `hourly_rate` ו-`retention_bonus` (בונוס
התמדה, הוסף ב-010_branch_employees_bonus.sql). לפי מדיניות אבטחה
נכונה, `employee` לא אמור לראות שכר של עמיתיו.

**החלטה לשלב 1 (interim):** SELECT נשאר פתוח לכל authenticated.
WRITE בלבד מסונן לפי branch-own. זה מתקן את הבאג הקריטי של כתיבה
צולבת בין סניפים, ולא משנה את מצב חשיפת עמודות השכר (שהיה פתוח ממילא).

**שלב 2 — TODO:** ליצור `VIEW branch_employees_safe` ללא
`hourly_rate`/`retention_bonus`, להחליף את כל ה-queries הקוראים של
`employee`/`branch` מ-`branch_employees` ל-`branch_employees_safe`,
ואז להדק `branch_employees_select_all` לסינון branch-own.

```sql
-- SELECT: פתוח (interim — עד שלב 2)
DROP POLICY IF EXISTS "Everyone can read branch_employees" ON branch_employees;
DROP POLICY IF EXISTS "branch_employees_select_all" ON branch_employees;
CREATE POLICY "branch_employees_select_all" ON branch_employees
  FOR SELECT TO authenticated USING (true);

-- WRITE: admin + branch-own בלבד (הבאג הקריטי מתוקן כאן)
DROP POLICY IF EXISTS "Admins can manage branch_employees" ON branch_employees;
DROP POLICY IF EXISTS "branch_employees_scoped" ON branch_employees;
DROP POLICY IF EXISTS "branch_employees_write_scoped" ON branch_employees;
CREATE POLICY "branch_employees_write_scoped" ON branch_employees
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_employees.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_employees.branch_id))
    )
  );

-- הסבר על ההגיון של שני Policies בו-זמנית:
-- PostgreSQL משלב מרובי policies ב-OR. עבור SELECT, הפוליסי הראשון מחזיר
-- true (פתוח) → השני לא מוריד הרשאה. עבור INSERT/UPDATE/DELETE, רק הפוליסי
-- השני חל (FOR SELECT לא חל על כתיבה) → מסונן ל-admin + branch-own.
```

#### 4.3.4 `branch_messages`, `message_reads` — לתקן role='employee'

```sql
-- 'employee' לא תקף לפי CHECK ב-004. להסיר או להרחיב את ה-CHECK.
-- כרגע: להחליף ל-'branch' ו-admin, ולסנן לפי branch_id
DROP POLICY IF EXISTS "branch_manage_messages" ON branch_messages;
CREATE POLICY "branch_messages_scoped" ON branch_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = branch_messages.branch_id))
    )
  );

DROP POLICY IF EXISTS "branch_manage_reads" ON message_reads;
CREATE POLICY "message_reads_scoped" ON message_reads FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        -- message_reads מקושר לעובד. בהנחה שהעובד שייך לסניף, להצטרף עם branch_employees
        AND (u.role = 'admin' OR EXISTS (
              SELECT 1 FROM branch_employees be
              WHERE be.id = message_reads.employee_id AND be.branch_id = u.branch_id
            ))
    )
  );
```

### 4.4 עדיפות בינונית — שאר טבלאות הסידור

```sql
ALTER TABLE schedule_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_staffing_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE special_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_role_assignments ENABLE ROW LEVEL SECURITY;

-- כולן: admin + branch-own (העמודה branch_id או דרך join ל-branch_employees)
-- דוגמה ל-schedule_constraints (שיש לה branch_id):
CREATE POLICY "schedule_constraints_scoped" ON schedule_constraints FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = schedule_constraints.branch_id))
    )
  );

-- אותה הגדרה עבור:
-- schedule_publications, shift_assignments, branch_shifts, shift_staffing_requirements,
-- shift_roles, special_days — כולן עם branch_id.

-- employee_role_assignments — אין branch_id ישירה, דרך employee_id -> branch_employees:
CREATE POLICY "employee_role_assignments_scoped" ON employee_role_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin' OR EXISTS (
              SELECT 1 FROM branch_employees be
              WHERE be.id = employee_role_assignments.employee_id AND be.branch_id = u.branch_id
            ))
    )
  );
```

### 4.5 עדיפות בינונית — חידוד policies רופפות (סינון branch_id)

* `internal_sales` / `internal_sale_items`: להוסיף `branch_id = u.branch_id` לתפקיד `branch`.
* `register_closings` / `change_fund`: אותה הוספה.
* `special_orders` / `order_notifications`: אותה הוספה.
* `scheduled_messages` / `scheduled_message_log`: אותה הוספה.

### 4.6 עדיפות נמוכה — `report_log`, `internal_customer_map`, `message_attachments`

```sql
ALTER TABLE report_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "report_log_admin_only" ON report_log FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

ALTER TABLE internal_customer_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal_customer_map_admin_factory" ON internal_customer_map FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message_attachments_scoped" ON message_attachments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin' OR u.role = 'branch')  -- או צימוד ל-branch_messages דרך message_id
    )
  );
```

### 4.7 אי-עקביות schema — `app_users.role`

```sql
-- הקוד מתייחס ל-'employee' ו-'scheduler' שלא מותרים ב-CHECK. להרחיב:
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'factory', 'branch', 'employee', 'scheduler'));
```

**אזהרה:** אם ה-policy ב-018 מתייחסת ל-`'employee'` **ואף משתמש לא קיים עם role זה** — ייתכן שאף אחד מעולם לא השתמש בממשק "employee home". לוודא עם המשתמש האם זה feature פעיל או לא.

---

## 5. החלטות שצריכות את המשתמש

> **לפני הרצת SQL כלשהו — נא לענות על אלה:**

1. **`employee` ו-`scheduler` — feature חי?** ה-UserContext מתייחס אליהם, ה-policy ב-018 מתייחסת ל-`employee`, אבל ה-CHECK חוסם אותם ואף משתמש לא seed-ed עם role כזה. האם יש משתמשים בפרודקשן עם role אלה?

2. **`employees` — האם `factory` המנהל מחלקה (managed_department='creams') אמור לראות עובדים של מחלקות אחרות?** בצד הלקוח `excluded_departments` חוסם את זה; לא ברור האם לחקות זאת ב-RLS.

3. **`fixed_costs.entity_id` — מה הפורמט?** `'1'` (string של branch_id)? `'factory'`? `'headquarters'`? אני צריך לראות `SELECT DISTINCT entity_id FROM fixed_costs` לפני שהPolicy מוצקה.

4. **`customers` — האם הטבלה מכילה עמודת `branch_id`?** (אני מניח שכן כי `BranchCreditCustomers` מסננת לפי branch_id, אבל לא ראיתי את ה-schema)

5. **`register_closings`, `change_fund`, `internal_sales` וכו' — האם `factory` אמור לראות?** כיום ה-policy של `internal_sales` מאפשרת לכל factory לגעת. אם factory לא אמור לגעת, צריך להסיר.

6. **Edge Functions / cron** — האם הדוחות היומיים (email-reports, alert-scheduler) רצים עם `service_role`? אם לא, תיקון ה-RLS ישבור אותם. צריך לאמת.

7. **`labor` — האם מישהו אמור לכתוב אליה מהלקוח?** כרגע ה-policy ב-022 היא read-only. אם הטעינה היא דרך Edge Function עם service_role, הכל טוב. אחרת — אין דרך לעדכן.

8. **`system_settings` כ-`change_fund_base_{branch_id}`** — האם branch user יכול לשנות את הבסיס? אם כן, לא ניתן להגביל את system_settings לadmin בלבד בלי לשבור את זה.

9. **`branch_employees` — האם branch user אמור לראות עובדים של סניפים אחרים?** `Labor.tsx` מציג שמות; `WeeklySchedule` מציג רק עובדי הסניף. האם SELECT ל-branch-other מותר או אסור?

10. **האם להחיל את התיקון במעבר אחד או הדרגתי?** — הצעה: שלב 1 קריטי (§4.1 + §4.3), שלב 2 גבוה (§4.2), שלב 3 בינוני (§4.4 + §4.5), שלב 4 נמוך (§4.6 + §4.7). כל שלב עם בדיקה ידנית של המסכים המושפעים.

---

## 6. סיכום חששות וסיכונים

* **WITH CHECK חסר** — בכל ה-`FOR ALL USING (...)` מומלץ להוסיף `WITH CHECK (...)` זהה. אחרת UPDATE שמעביר שורה מ-branch 1 ל-branch 2 יעבור בלי רטט (ה-USING בודק את השורה הישנה; WITH CHECK בודק את החדשה).
* **Recursion** — policy שעושה `EXISTS (SELECT FROM app_users WHERE auth_uid = auth.uid())` תלויה בכך ש-`app_users` עצמה **לא** חוסמת את ה-SELECT הזה. הפולסי הקיימת ב-004 אכן מאפשרת `SELECT TO authenticated USING (true)` — אז זה בטוח. **אל תהדקו את `app_users` SELECT בלי להבין את ההשלכה.**
* **VIEW `branch_pl_summary`** — RLS לא חל על VIEWs באופן ישיר. אם ה-VIEW עצמו `SECURITY DEFINER` — הוא עוקף את ה-RLS של המקורות. אם הוא רגיל — הוא יורש את ה-RLS של הטבלאות המקור. לאמת זאת בדשבורד.
* **Edge Functions** — עם `service_role` מעקפים RLS. זה מצופה, אבל גם מסוכן אם service_role דולף.
* **Realtime channels** — ה-קוד משתמש ב-`supabase.channel(...).on('postgres_changes', ...)`. Realtime עוקף את RLS של ה-client-key אם לא מוגדר מפורשות — לבדוק פר-channel.
* **פרסום מיגרציה** — ברגע שה-policies נמצאות ב-sql/, `CREATE POLICY` יכשל אם כבר קיימת. כל בלוק לעיל כולל `DROP POLICY IF EXISTS` כדי להיות idempotent.
* **אימות production**: אחרי הרצה, להתחבר בכל role ולוודא שכל המסכים הרלוונטיים עובדים (admin, factory, factory-dept-manager, branch, branch-restricted). **רצוי לעשות את זה ב-staging, לא בפרודקשן.**

---

## 7. סדר המלצה לביצוע (אחרי אישור §5)

1. **יום 1 (קריטי):** §4.1 — טבלאות כספיות + §4.3.1 (branch_kpi_targets) + §4.3.2 (system_settings).
2. **יום 1 אחר-הצהריים:** בדיקה ידנית של כל סוג משתמש (admin, factory, branch) בכל המסכים הפיננסיים.
3. **יום 2 בוקר:** §4.2 + §4.3.3 + §4.3.4 (branch_employees, branch_messages).
4. **יום 2 אחר-הצהריים:** §4.4 + §4.5 (סידור עבודה + חידוד policies קיימות).
5. **יום 3:** §4.6 + §4.7 (cleanup) + מעבר פרונט-אנד על הודעות שגיאה (RLS רוב הזמן חוזרת כ-42501, שה-`humanizeError` כבר מתרגם לעברית).
6. **שימור:** להוסיף כל טבלה עתידית ל-`sql/NNN_*.sql` יחד עם RLS — לא ליצור ישירות בדשבורד.

---

## 8. מטא

**מחברת/קובץ:** `sql/rls_migration_plan.md`
**מה נסרק:** 28 קבצים ב-`sql/` + 310 קריאות `.from()` ב-`src/` + UserContext.
**מה לא נבדק (דרוש גישה לדשבורד Supabase):**
* האם RLS מופעל בפועל על הטבלאות מסעיף 2.3.
* Policies שקיימות בדשבורד אבל לא ב-migrations.
* `SECURITY DEFINER` של VIEWs.
* Realtime channel permissions.
