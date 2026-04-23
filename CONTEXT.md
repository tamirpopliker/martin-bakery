# CONTEXT — martin-bakery

מערכת ניהול פנימית למאפייה "מרטין" — מפעל + 3 סניפים.
React 19 + Supabase + Tailwind CSS 4 + shadcn/ui. עברית RTL מלאה.

---

## מבנה הפרויקט

```
martin-bakery/
├── src/
│   ├── App.tsx                      # Auth check + UserProvider + PeriodProvider
│   ├── main.tsx                     # React entry point
│   ├── index.css                    # Tailwind + RTL + responsive breakpoints
│   ├── pages/                       # 55 page components (כל המסכים)
│   ├── components/
│   │   ├── PeriodPicker.tsx         # בורר תקופות (חודש / שבוע / רבעון / שנה)
│   │   ├── PageHeader.tsx           # כותרת עמוד אחידה
│   │   ├── InsightsCard.tsx         # כרטיס תובנות AI
│   │   ├── InstallPWA.tsx           # התקנת PWA
│   │   ├── ProductionHistory.tsx    # היסטוריית ייצור
│   │   ├── icons/                   # אייקונים מותאמים (Revenue, Profit, Labor, FixedCost, Trophy)
│   │   └── ui/                      # shadcn/ui: button, card, table, sheet
│   ├── lib/
│   │   ├── supabase.ts             # Supabase client (PKCE) + date utils + labor calc + fetchBranches
│   │   ├── UserContext.tsx          # Auth context, AppUser, role-based access (canAccessPage)
│   │   ├── BranchContext.tsx        # Dynamic branches from Supabase (useBranches hook)
│   │   ├── PeriodContext.tsx        # Period state management (usePeriod hook)
│   │   ├── NavigationContext.tsx    # ניהול ניווט state-based
│   │   ├── period.ts               # Period computation, Hebrew month names, comparison periods
│   │   ├── internalCustomers.ts    # מיפוי לקוחות פנימיים → סניפים (detectBranchId)
│   │   ├── calculatePL.ts          # חישוב רווח והפסד
│   │   ├── profitCalc.ts           # חישובי רווחיות
│   │   ├── generateInsights.ts     # יצירת תובנות AI
│   │   ├── parseCashOnTab.ts       # פרסור דוח קופה רושמת
│   │   ├── parseTimeWatch.ts       # פרסור דוח שעון נוכחות
│   │   ├── parseWorkingHours.ts    # פרסור שעות עבודה
│   │   └── utils.ts                # cn() helper
│   └── types/
│       └── index.ts                # Type definitions
├── supabase/
│   └── functions/
│       ├── check-alerts/           # Edge Function — בדיקת התרעות כל שעה
│       │   └── index.ts            # Check rules → query data → send email → log
│       ├── send-reports/           # Edge Function — דוחות אימייל
│       │   ├── index.ts            # Orchestrator: cron → reports → email
│       │   ├── lib/
│       │   │   ├── db.ts           # DB queries, date utils, branch/dept names
│       │   │   ├── schedule.ts     # Daily/Weekly/Monthly schedule logic (Israel TZ)
│       │   │   ├── recipients.ts   # Fetch app_users, filter by role
│       │   │   ├── charts.ts       # QuickChart.io URL generation
│       │   │   ├── insights.ts     # Claude AI insights (claude-haiku-4-5)
│       │   │   ├── email.ts        # Resend API email sending
│       │   │   └── templates.ts    # HTML email components
│       │   └── reports/
│       │       ├── branch-daily.ts
│       │       ├── branch-weekly.ts
│       │       ├── branch-monthly.ts
│       │       ├── factory-daily.ts
│       │       ├── factory-weekly.ts
│       │       ├── factory-monthly.ts
│       │       ├── admin-branches.ts
│       │       └── admin-factory.ts
│       ├── extract-invoice/        # Edge Function — חילוץ נתונים מחשבוניות PDF
│       │   └── index.ts
│       ├── invite-existing-users/  # Edge Function — הזמנת משתמשים קיימים
│       │   └── index.ts
│       ├── send-invitation/        # Edge Function — שליחת הזמנה למשתמש חדש
│       │   └── index.ts
│       ├── send-schedule/          # Edge Function — שליחת סידור עבודה
│       │   └── index.ts
│       └── send-scheduled-messages/ # Edge Function — שליחת הודעות מתוזמנות
│           └── index.ts
├── sql/                             # Migration/setup scripts
│   ├── 004_app_users.sql           # טבלת משתמשים + RLS + seed data
│   ├── 005_email_reports_setup.sql # branch_kpi_targets columns + report_log
│   ├── 006_dynamic_branches.sql    # טבלת branches דינמית + seed 3 סניפים + RLS
│   ├── 007_alerts.sql              # alert_rules + alert_log + RLS
│   ├── 008_auth_trigger.sql        # Auto-provision app_users on Google OAuth sign-in
│   ├── 008_report_subscriptions.sql # הרשמה לדוחות + התראות per user
│   ├── 009_branch_employees.sql    # טבלת עובדי סניף + RLS
│   ├── 010_branch_employees_bonus.sql # עמודת בונוס התמדה
│   ├── 010_department_manager.sql  # managed_department column on app_users
│   ├── 011_fix_branch_kpi_rls.sql  # תיקון RLS ליעדי סניפים
│   ├── 012_system_settings.sql     # הגדרות מערכת גלובליות (overhead_pct)
│   ├── 012_fix_yaakov_cohen_expenses.sql # תיקון הוצאות יעקב כהן
│   ├── 013_production_reports.sql  # דוחות ייצור מרוכזים
│   ├── 014_internal_sales.sql      # מכירות פנימיות + פריטים + מיפוי מחלקות
│   ├── 015_products.sql            # קטלוג מוצרים + מעקב מחירים
│   ├── 016_external_sales.sql      # מכירות חיצוניות B2B
│   ├── 017_b2b_customers.sql       # לקוחות B2B + חשבוניות + תשלומים
│   ├── 018_branch_messages.sql     # הודעות סניף + מעקב קריאה
│   ├── 019_scheduled_messages.sql  # הודעות מתוזמנות + לוג שליחה
│   ├── 020_employer_costs.sql      # עלויות מעסיק + העלאות
│   ├── internal_orders_schema.sql  # Internal orders: is_internal, target_branch_id, branch_status
│   ├── check_internal.sql          # Query for checking internal sales
│   └── fix_internal_sales.sql      # Retroactive fix for internal sales
├── package.json                     # React 19, Supabase, Tailwind 4, shadcn, Framer Motion, Recharts
├── vite.config.ts                   # Vite + React + Tailwind plugin
├── components.json                  # shadcn/ui config (base-nova style)
├── vercel.json                      # Vercel deployment config
├── eslint.config.js                 # ESLint configuration
├── .env.local                       # VITE_SUPABASE_ANON_KEY
└── .env.vercel                      # Vercel tokens + Supabase config
```

---

## טבלאות Supabase

### app_users — משתמשים והרשאות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | UUID PK | auto-generated |
| email | TEXT UNIQUE | אימייל |
| name | TEXT | שם |
| role | TEXT | 'admin' / 'factory' / 'branch' / 'employee' |
| branch_id | INT | לסניפים: 1=אברהם אבינו, 2=הפועלים, 3=יעקב כהן |
| excluded_departments | TEXT[] | מחלקות שמשתמש factory לא רואה |
| can_settings | BOOLEAN | האם יכול לגשת להגדרות |
| managed_department | TEXT | מחלקה מנוהלת: creams/dough/packaging/cleaning/NULL |
| report_daily | BOOLEAN | מנוי לדוח יומי |
| report_weekly | BOOLEAN | מנוי לדוח שבועי |
| report_monthly | BOOLEAN | מנוי לדוח חודשי |
| reports_enabled | BOOLEAN | דוחות מופעלים |
| alerts_enabled | BOOLEAN | התראות מופעלות |
| auth_uid | UUID | מקושר ל-Supabase auth |
| created_at | TIMESTAMPTZ | |

### daily_production — ייצור יומי
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| date | DATE | תאריך |
| department | TEXT | creams / dough / packaging |
| amount | NUMERIC | כמות |

### labor — לייבור מפעל
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| entity_type | TEXT | 'factory' |
| entity_id | TEXT | department name |
| date | DATE | |
| employee_name | TEXT | שם עובד |
| hours_100 | NUMERIC | שעות רגילות |
| hours_125 | NUMERIC | שעות 125% |
| hours_150 | NUMERIC | שעות 150% |
| gross_salary | NUMERIC | שכר ברוטו |
| employer_cost | NUMERIC | עלות מעסיק (ברירת מחדל ×1.3) |
| hourly_rate | NUMERIC | תעריף לשעה |
| bonus | NUMERIC | בונוס |

### factory_sales — מכירות מפעל
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| date | DATE | |
| department | TEXT | |
| customer | TEXT | שם לקוח |
| amount | NUMERIC | |
| doc_number | TEXT | מספר מסמך |
| notes | TEXT | |
| is_internal | BOOLEAN | האם מכירה פנימית לסניף |
| target_branch_id | INT | סניף יעד |
| branch_status | TEXT | 'pending' / 'approved' / 'disputed' |

### factory_b2b_sales — מכירות B2B/שונות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| date | DATE | |
| sale_type | TEXT | 'b2b' / 'misc' |
| customer | TEXT | |
| amount | NUMERIC | |
| doc_number | TEXT | |
| notes | TEXT | |
| is_internal | BOOLEAN | |
| target_branch_id | INT | |
| branch_status | TEXT | |

### supplier_invoices — חשבוניות ספקים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| date | DATE | |
| supplier_name | TEXT | |
| amount | NUMERIC | |
| doc_number | TEXT | |
| doc_type | TEXT | סוג מסמך |
| notes | TEXT | |

### factory_waste — פחת מפעל
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| date | DATE | |
| department | TEXT | |
| amount | NUMERIC | |
| category | TEXT | קטגוריית פחת |
| description | TEXT | |

### factory_repairs — תיקונים וציוד
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| date | DATE | |
| department | TEXT | |
| amount | NUMERIC | |
| type | TEXT | 'repair' / 'new_equipment' |
| description | TEXT | |

### fixed_costs — עלויות קבועות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| name | TEXT | שם ההוצאה |
| amount | NUMERIC | |
| month | TEXT | YYYY-MM |
| entity_type | TEXT | 'factory' / 'branch' / 'working_days' |
| entity_id | TEXT | |

### kpi_targets — יעדי KPI מפעל
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| department | TEXT | |
| labor_pct | NUMERIC | יעד לייבור % |
| waste_pct | NUMERIC | יעד פחת % |
| repairs_pct | NUMERIC | יעד תיקונים % |
| gross_profit_pct | NUMERIC | יעד רווח גולמי % |
| production_pct | NUMERIC | יעד ייצור % |
| operating_profit_pct | NUMERIC | יעד רווח תפעולי % |

### suppliers — ספקים (מפעל)
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| name | TEXT | שם ספק |

### employees — עובדים גלובליים (שכר גלובלי)
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| name | TEXT | שם עובד |
| department | TEXT | מחלקה |
| wage_type | TEXT | 'global' |
| global_daily_rate | NUMERIC | תעריף יומי |
| bonus | NUMERIC | בונוס |
| active | BOOLEAN | |

### branch_employees — עובדי סניפים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | |
| name | TEXT | שם עובד |
| email | TEXT | |
| phone | TEXT | |
| hourly_rate | NUMERIC | תעריף לשעה |
| retention_bonus | NUMERIC | בונוס התמדה לשעה (0 = אין) |
| active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

### branch_revenue — הכנסות סניפים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | 1/2/3 |
| date | DATE | |
| source | TEXT | 'cashier' / 'website' / 'credit' |
| amount | NUMERIC | |
| transaction_count | INT | מספר עסקאות |
| customer | TEXT | |
| doc_number | TEXT | |
| notes | TEXT | |

### branch_expenses — הוצאות סניפים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | |
| date | DATE | |
| expense_type | TEXT | suppliers/repairs/infrastructure/deliveries/other |
| amount | NUMERIC | |
| supplier | TEXT | |
| doc_number | TEXT | |
| notes | TEXT | |
| from_factory | BOOLEAN | האם הוצאה מהמפעל |

### branch_labor — לייבור סניפים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | |
| date | DATE | |
| employee_name | TEXT | |
| hours | NUMERIC | |
| gross_salary | NUMERIC | |
| employer_cost | NUMERIC | |
| notes | TEXT | |

### branch_waste — פחת סניפים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | |
| date | DATE | |
| amount | NUMERIC | |
| category | TEXT | finished/raw/packaging |
| notes | TEXT | |

### branch_kpi_targets — יעדי KPI סניפים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| branch_id | INT PK | |
| labor_pct | NUMERIC | |
| waste_pct | NUMERIC | |
| revenue_target | NUMERIC | |
| basket_target | NUMERIC | |
| transaction_target | INT | |

### branch_suppliers — ספקי סניפים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | |
| name | TEXT | |
| phone | TEXT | |
| category | TEXT | מזון/ניקיון/ציוד/תשתיות/אריזה/שונות |
| notes | TEXT | |
| active | BOOLEAN | |

### branch_credit_customers — לקוחות הקפה
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | |
| name | TEXT | |
| phone | TEXT | |
| credit_limit | NUMERIC | |
| notes | TEXT | |
| active | BOOLEAN | |

### branch_credit_payments — תשלומי הקפה
(referenced in BranchCreditCustomers page)

### internal_customer_map — מיפוי לקוחות פנימיים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| customer_pattern | TEXT UNIQUE | |
| branch_id | INT | |
| active | BOOLEAN | |

### products — קטלוג מוצרים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| product_name | TEXT UNIQUE | שם מוצר |
| department | TEXT | מחלקה |
| current_price | NUMERIC | מחיר נוכחי |
| last_price | NUMERIC | מחיר קודם |
| price_updated_at | TIMESTAMPTZ | תאריך עדכון מחיר |
| created_at | TIMESTAMPTZ | |

### product_department_mapping — מיפוי מוצרים למחלקות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| product_name | TEXT UNIQUE | |
| department | TEXT | |

### production_reports — דוחות ייצור מרוכזים
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| report_date | DATE | |
| product_name | TEXT | |
| department | TEXT | |
| quantity | NUMERIC | |
| unit_price | NUMERIC | |
| total_cost | NUMERIC | |
| uploaded_at | TIMESTAMPTZ | |
| uploaded_by | TEXT | |

### internal_sales — מכירות פנימיות (מפעל → סניף)
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| order_number | TEXT | |
| order_date | DATE | |
| branch_id | INT | |
| department | TEXT | |
| status | TEXT | 'pending' / 'modified' / 'completed' |
| total_amount | NUMERIC | |
| uploaded_by | TEXT | |
| confirmed_by | TEXT | |
| completed_at | TIMESTAMPTZ | |

### internal_sale_items — פריטי מכירה פנימית
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| sale_id | INT FK → internal_sales | |
| product_name | TEXT | |
| department | TEXT | |
| quantity_supplied | NUMERIC | כמות שסופקה |
| quantity_confirmed | NUMERIC | כמות שאושרה |
| unit_price | NUMERIC | |
| total_price | NUMERIC | |

### external_sales — מכירות חיצוניות B2B
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| customer_name | TEXT | |
| invoice_number | TEXT | |
| invoice_date | DATE | |
| total_before_vat | NUMERIC | סה"כ לפני מע"מ |
| uploaded_by | TEXT | |

### b2b_customers — לקוחות B2B
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| name | TEXT | |
| company_number | TEXT | |
| phone | TEXT | |
| address | TEXT | |
| branch_id | INT | |
| credit_limit | NUMERIC | |
| notes | TEXT | |

### b2b_invoices — חשבוניות B2B
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| customer_id | INT FK → b2b_customers | |
| invoice_number | TEXT | |
| invoice_date | DATE | |
| due_date | DATE | |
| total_before_vat | NUMERIC | |
| total_with_vat | NUMERIC | |
| status | TEXT | 'open' / 'partial' / 'paid' / 'overdue' |
| branch_id | INT | |

### b2b_payments — תשלומי B2B
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| invoice_id | INT FK → b2b_invoices | |
| payment_date | DATE | |
| amount | NUMERIC | |
| notes | TEXT | |

### branch_messages — הודעות סניף
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | |
| title | TEXT | |
| body | TEXT | |
| type | TEXT | 'urgent' / 'task' / 'info' / 'praise' |
| created_by | TEXT | |
| created_at | TIMESTAMPTZ | |
| scheduled_at | TIMESTAMPTZ | |
| is_pinned | BOOLEAN | |

### message_reads — מעקב קריאת הודעות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| message_id | INT FK → branch_messages | |
| employee_id | INT | |
| read_at | TIMESTAMPTZ | |

### scheduled_messages — הודעות מתוזמנות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| branch_id | INT | |
| title | TEXT | |
| body | TEXT | |
| type | TEXT | סוג הודעה |
| recipient_type | TEXT | 'all' / ספציפי |
| recipient_id | INT | |
| recipient_role | TEXT | |
| schedule_type | TEXT | 'weekly' |
| days_of_week | INT[] | ימים בשבוע |
| specific_dates | DATE[] | תאריכים ספציפיים |
| send_time | TEXT | שעת שליחה |
| is_active | BOOLEAN | |
| last_sent_at | TIMESTAMPTZ | |
| next_send_at | TIMESTAMPTZ | |

### scheduled_message_log — לוג שליחת הודעות מתוזמנות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| scheduled_message_id | INT FK → scheduled_messages | |
| sent_at | TIMESTAMPTZ | |
| recipients_count | INT | |
| reads_count | INT | |

### employer_costs — עלויות מעסיק
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| employee_number | INT | |
| employee_name | TEXT | |
| month | INT | |
| year | INT | |
| department_number | INT | |
| department_name | TEXT | |
| actual_employer_cost | NUMERIC | |
| actual_hours | NUMERIC | |
| actual_days | NUMERIC | |
| branch_id | INT | |
| is_headquarters | BOOLEAN | |

### employer_costs_uploads — לוג העלאות עלויות מעסיק
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| month | INT | |
| year | INT | |
| filename | TEXT | |
| uploaded_at | TIMESTAMPTZ | |
| uploaded_by | TEXT | |
| status | TEXT | |
| unmatched_count | INT | |

### system_settings — הגדרות מערכת
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| key | TEXT PK | מפתח הגדרה (e.g. 'overhead_pct') |
| value | TEXT | ערך |
| updated_at | TIMESTAMPTZ | |

### report_log — לוג דוחות אימייל
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| sent_at | TIMESTAMPTZ | |
| report_type | TEXT | daily/weekly/monthly |
| recipient_email | TEXT | |
| recipient_role | TEXT | admin/factory/branch |
| status | TEXT | sent/failed |
| error_message | TEXT | |
| report_date | TEXT | |

### branches — סניפים (דינמי)
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| name | TEXT | שם הסניף |
| short_name | TEXT | שם קצר לתצוגה |
| address | TEXT | כתובת |
| active | BOOLEAN | האם פעיל |
| created_at | TIMESTAMPTZ | |

### alert_rules — כללי התרעות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| name | TEXT | שם ההתרעה |
| entity_type | TEXT | 'branch' / 'factory' |
| entity_id | TEXT | branch_id או department |
| metric | TEXT | revenue / waste / labor_cost / production |
| condition | TEXT | 'below' / 'above' |
| threshold | NUMERIC | ערך סף |
| threshold_type | TEXT | 'absolute' / 'percent' |
| active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

### alert_log — לוג התרעות
| שדה | טיפוס | תיאור |
|-----|--------|--------|
| id | SERIAL PK | |
| rule_id | INT FK → alert_rules | |
| triggered_at | TIMESTAMPTZ | |
| actual_value | NUMERIC | ערך בפועל |
| threshold_value | NUMERIC | ערך הסף |
| email_sent | BOOLEAN | |
| recipient_emails | TEXT[] | |

### packaging_products — מוצרי אריזה
(referenced in DataExport)

### customers — לקוחות
(referenced in DataExport)

---

## מסכים ו-Routes

האפליקציה משתמשת בניווט state-based (לא React Router עם URL paths).
`App.tsx` → Login or Home → ניווט פנימי דרך state.

### כניסה
| מסך | קובץ | תיאור |
|------|-------|--------|
| Login | Login.tsx | Google OAuth + email/password |

### Home — דף ראשי
| מסך | קובץ | תיאור |
|------|-------|--------|
| Home | Home.tsx | Hub ראשי עם KPI cards, גישה ל-3 אזורים: מפעל / סניפים / ניהול |

### אזור מפעל
| מסך | קובץ | תיאור |
|------|-------|--------|
| DepartmentHome | DepartmentHome.tsx | דף בית מחלקה (קרמים/בצקים/אריזה/ניקיון) |
| DailyProduction | DailyProduction.tsx | הזנת ייצור יומי + גרפים SVG |
| FactoryWaste | FactoryWaste.tsx | פחת לפי קטגוריה (חומרי גלם/אריזה/מוצרים) |
| FactoryRepairs | FactoryRepairs.tsx | תיקונים וציוד חדש |
| DepartmentLabor | DepartmentLabor.tsx | לייבור לפי מחלקה |
| DepartmentDashboard | DepartmentDashboard.tsx | דשבורד אנליטי למחלקות קרמים ובצקים |
| Labor | Labor.tsx | לייבור מרוכז — העלאת CSV, ניהול עובדים, חישוב שכר |
| FactoryB2B | FactoryB2B.tsx | מכירות: קרמים / בצקים / B2B / שונות |
| Suppliers | Suppliers.tsx | ספקים וחשבוניות |
| FactoryDashboard | FactoryDashboard.tsx | דשבורד מפעל מלא עם KPI וגרפים |
| FactorySettings | FactorySettings.tsx | יעדי KPI, עלויות קבועות, עובדים, ייבוא/ייצוא |
| FactoryEmployees | FactoryEmployees.tsx | ניהול עובדי מפעל |
| FactoryEquipment | FactoryEquipment.tsx | ניהול ציוד מפעל |
| FactoryDepartments | FactoryDepartments.tsx | ניהול מחלקות מפעל |
| ProductCatalog | ProductCatalog.tsx | קטלוג מוצרים + מעקב מחירים |
| ProductionReportUpload | ProductionReportUpload.tsx | העלאת דוחות ייצור מ-Excel |
| InternalSalesUpload | InternalSalesUpload.tsx | העלאת מכירות פנימיות |

### אזור סניפים (×3: אברהם אבינו / הפועלים / יעקב כהן)
| מסך | קובץ | תיאור |
|------|-------|--------|
| BranchHome | BranchHome.tsx | Hub סניף עם אפשרויות ניווט |
| BranchRevenue | BranchRevenue.tsx | הכנסות: קופה / אתר / הקפה |
| BranchExpenses | BranchExpenses.tsx | הוצאות: ספקים / תיקונים / תשתיות / משלוחים / אחר |
| BranchLabor | BranchLabor.tsx | לייבור סניף עם יכולת חילוץ PDF |
| BranchWaste | BranchWaste.tsx | פחת סניף |
| BranchCreditCustomers | BranchCreditCustomers.tsx | ניהול לקוחות הקפה ותשלומים |
| BranchSuppliers | BranchSuppliers.tsx | ספקים וקטגוריות |
| BranchOrders | BranchOrders.tsx | הזמנות מהמפעל — אישור/ערעור |
| BranchPL | BranchPL.tsx | דוח רווח והפסד עם השוואת תקופות |
| BranchSettings | BranchSettings.tsx | יעדים, עלויות קבועות, עובדים |
| BranchDashboard | BranchDashboard.tsx | דשבורד סניף |
| BranchManagerDashboard | BranchManagerDashboard.tsx | השוואת 3 סניפים עם חלוקת overhead |
| BranchComparisonDashboard | BranchComparisonDashboard.tsx | דשבורד השוואת סניפים |
| BranchEmployees | BranchEmployees.tsx | ניהול עובדי סניף |
| BranchTeam | BranchTeam.tsx | צוות סניף |
| BranchCommunication | BranchCommunication.tsx | מרכז תקשורת סניף — הודעות + מעקב |
| BranchB2BHistory | BranchB2BHistory.tsx | היסטוריית מכירות B2B לסניף |
| B2BCustomers | B2BCustomers.tsx | ניהול לקוחות B2B + חשבוניות + תשלומים |

### אזור עובדים
| מסך | קובץ | תיאור |
|------|-------|--------|
| EmployeeHome | EmployeeHome.tsx | דף בית עובד |
| EmployeeMessages | EmployeeMessages.tsx | הודעות לעובד |
| EmployeeConstraints | EmployeeConstraints.tsx | הגשת אילוצי משמרות |
| EmployeeArchive | EmployeeArchive.tsx | ארכיון עובד |
| MySchedule | MySchedule.tsx | סידור עבודה אישי |

### אזור ניהול משמרות / סידור עבודה
| מסך | קובץ | תיאור |
|------|-------|--------|
| WorkSchedule | WorkSchedule.tsx | סידור עבודה שבועי |
| WeeklySchedule | WeeklySchedule.tsx | תצוגת סידור שבועית |
| ShiftSettings | ShiftSettings.tsx | הגדרות משמרות |
| ScheduleHistory | ScheduleHistory.tsx | היסטוריית סידורים |
| ManagerConstraintsView | ManagerConstraintsView.tsx | תצוגת אילוצי עובדים למנהל |
| TeamManagement | TeamManagement.tsx | ניהול צוותים |

### אזור ניהול
| מסך | קובץ | תיאור |
|------|-------|--------|
| CEODashboard | CEODashboard.tsx | דשבורד מנכ"ל — אנליטיקות מתקדמות, Recharts, CountUp, Framer Motion |
| AlertsManagement | AlertsManagement.tsx | ניהול התרעות — כללים, לוג, הוספה/עריכה — admin only |
| ReportsAlerts | ReportsAlerts.tsx | ניהול דוחות והתרעות |
| UserManagement | UserManagement.tsx | ניהול משתמשים, תפקידים, הרשאות + ניהול סניפים — admin only |
| DataImport | DataImport.tsx | ייבוא CSV מ-Base44 — תומך ב-16 טבלאות |
| DataExport | DataExport.tsx | ייצוא 20+ טבלאות ל-CSV/ZIP |
| EmployerCostsUpload | EmployerCostsUpload.tsx | העלאת עלויות מעסיק |

---

## Edge Functions

### send-reports (Supabase Edge Function)
**מה עושה:** שולח דוחות אימייל אוטומטיים לכל המשתמשים לפי תפקיד ותדירות.

**סוגי דוחות:**

| דוח | תפקיד | תדירות | תוכן |
|------|--------|---------|--------|
| branch-daily | branch | יומי (א-ו) | הכנסות, פחת, לייבור, גרפים 7 ימים, AI insights |
| branch-weekly | branch | שבועי (יום א) | סיכום שבועי א-ו, פירוט יומי |
| branch-monthly | branch | חודשי (2-3 לחודש) | השוואה שנתית, פירוט שבועי |
| factory-daily | factory | יומי | ייצור לפי מחלקה, פרודוקטיביות 7 ימים, פחת |
| factory-weekly | factory | שבועי | ייצור/פחת/לייבור לפי מחלקה |
| factory-monthly | factory | חודשי | השוואה שנתית, דלתא לפי מחלקה |
| admin-branches | admin | יומי/שבועי/חודשי | השוואת 3 סניפים |
| admin-factory | admin | יומי/שבועי/חודשי | סיכום כל המחלקות |

**Schedule:** cron חיצוני (cron-job.org) → Edge Function URL יומי ב-09:00 UTC.
**אימות:** CRON_SECRET header.

### check-alerts (Supabase Edge Function)
**מה עושה:** בודק כללי התרעה פעילים מול נתוני היום ושולח אימייל למנהלים בעת חריגה.

**לוגיקה:**
1. טוען alert_rules (active=true)
2. לכל כלל — שולף נתונים מהטבלה הרלוונטית (branch_revenue, factory_waste, labor, daily_production)
3. אם actual חורג מ-threshold → שולח אימייל HTML בעברית דרך Resend
4. רושם ב-alert_log
5. Dedup: לא שולח אותה התרעה פעמיים באותו יום

**Schedule:** cron חיצוני (cron-job.org) → כל שעה, 07:00-20:00 שעון ישראל.
**אימות:** CRON_SECRET header.

### extract-invoice (Supabase Edge Function)
**מה עושה:** חילוץ נתונים מחשבוניות PDF (OCR / parsing).

### invite-existing-users (Supabase Edge Function)
**מה עושה:** הזמנת משתמשים קיימים במערכת (שליחת לינק כניסה).

### send-invitation (Supabase Edge Function)
**מה עושה:** שליחת הזמנה למשתמש חדש להצטרף למערכת.

### send-schedule (Supabase Edge Function)
**מה עושה:** שליחת סידור עבודה שבועי לעובדים.

### send-scheduled-messages (Supabase Edge Function)
**מה עושה:** שליחת הודעות מתוזמנות לעובדים לפי לו"ז שהוגדר.

---

## שירותים חיצוניים מחוברים

| שירות | שימוש | מפתח סביבה |
|--------|--------|-------------|
| **Supabase** | DB + Auth + Storage | `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` |
| **Resend** | שליחת אימיילים (דוחות) | `RESEND_API_KEY` |
| **Anthropic Claude** | AI insights בדוחות (claude-haiku-4-5) | `ANTHROPIC_API_KEY` |
| **QuickChart.io** | יצירת גרפים לאימיילים | ללא מפתח (public API) |
| **Google OAuth** | התחברות עם Google | דרך Supabase Auth |

---

## פיצ'רים שהושלמו

1. **מערכת ניהול עובדים** — CRUD עובדי סניף ומפעל, בונוס התמדה, שיוך למחלקות, הזמנת משתמשים (BranchEmployees, FactoryEmployees, EmployeeHome)
2. **סידור עבודה ומשמרות** — לוח שבועי, הגדרות משמרות וחגים, אילוצי עובדים, היסטוריית סידורים, תצוגה אישית (WorkSchedule, WeeklySchedule, ShiftSettings, MySchedule, ManagerConstraintsView)
3. **מערכת תקשורת** — הודעות לסניף (urgent/task/info/praise), הצמדה, מעקב קריאה, הודעות מתוזמנות חוזרות, edge function לשליחה אוטומטית (BranchCommunication, EmployeeMessages, send-scheduled-messages)
4. **ניהול לקוחות B2B** — לקוחות, חשבוניות, תשלומים, תנאי תשלום (שוטף+30/60/90), מעקב חוב, חילוץ חשבוניות מ-PDF דרך Claude vision (B2BCustomers, BranchB2BHistory, extract-invoice)
5. **קטלוג מוצרים** — מוצרים לפי מחלקה, מעקב מחירים, היסטוריית שינויים (ProductCatalog, products table)
6. **מכירות פנימיות (מפעל → סניף)** — העלאת Excel, מיפוי מחלקות, workflow אישור בסניף, מעקב סטטוס pending/modified/completed (InternalSalesUpload, BranchOrders, internal_sales)
7. **העלאת עלויות מעסיק** — פרסור Excel, matching חכם לפי מספר שכר, זיהוי מטה/מנהלים, שילוב בחישובי P&L (EmployerCostsUpload, employer_costs)
8. **דוחות אימייל אוטומטיים** — 8 סוגי דוחות (branch/factory/admin × daily/weekly/monthly), AI insights, גרפים, הרשמה אישית, cron חיצוני (send-reports)
9. **מערכת התרעות** — כללים מותאמים, בדיקה אוטומטית כל שעה, dedup, אימייל HTML בעברית (check-alerts, AlertsManagement)
10. **Auto-provision עובדים** — trigger על auth.users שמזהה עובד לפי email ויוצר app_users אוטומטית עם role='employee' (008_auth_trigger.sql)
11. **תמיכת PWA** — כפתור התקנה, זיהוי standalone mode (InstallPWA)
12. **דשבורדים** — דשבורד סניף, השוואת סניפים, דשבורד מנכ"ל, דשבורד מחלקתי (BranchDashboard, BranchManagerDashboard, CEODashboard, DepartmentDashboard)
13. **תיקון חישוב הכנסות מאוחד** — VIEW `branch_pl_summary` נבנה מחדש עם CTEs (היה LATERAL JOIN שגרם לכפל פי 3.7). `register_closings` הוא כעת המקור הקנוני להכנסות קופה; `branch_revenue` עם `source='cashier'` נעול מהזנה חדשה. תיקון ב-`Home.tsx`: הוסר overwrite של `totalBranchRevenue` (שורות 261, 295), נוסף state `factoryExternalRevenue = factoryPL.sales - factoryPL.salesInternal`.
14. **תיקון חישוב לייבור מפעל — שילוב `employees(global)` ב-`calculateFactoryPL`** — כשאין `employer_costs` לחודש (כגון באפריל 2026 לפני העלאת דוח הנה"ח), הפונקציה נופלת כעת לחישוב מוערך של שכרי עובדים גלובליים (מ-`employees` עם `wage_type='global'`, באמצעות `calcGlobalLaborForDept` על creams + dough) בתוספת עובדים שעתיים מ-`labor` — פרט לאלה שמופיעים גם בטבלת `employees` עם `wage_type='global'` (כדי למנוע כפל ספירה). `fetchFactoryPL` ב-`supabase.ts` הפך ל-wrapper דק סביב `calculateFactoryPL` כדי שלא יהיה drift עתידי בין שני המסלולים.
15. **תיקון כפילות שכר מנהלים** — שכר מנהלים הופיע פעמיים בחישוב הרווח התפעולי של הסניפים: פעם משורת "שכר מנהלים" (מ-`employer_costs` עם `is_manager=true`, עם fallback לחודש קודם) ופעם בתוך "עלויות קבועות" (`fixed_costs.manager_salary` עם `entity_id='branch_X'` במקום `'mgmt'` — כי `BranchSettings.tsx:143` מזין אוטומטית `entity_id = entityType`, והבדיקה `if (r.entity_id === 'mgmt')` ב-`calculateBranchPL` לא תפסה אותן). נמחקו 9 רשומות `manager_salary` מ-`fixed_costs`. רווח תפעולי של העסק עלה ב-68K לחודש (אברהם אבינו +22.7K, הפועלים +22.7K, יעקב כהן +22.7K — עבר מהפסד לרווח).

16. **RLS שלב 1 — הושלם 2026-04-23** — הופעל Row Level Security + policies על 18 טבלאות קריטיות (sql/025_rls_critical.sql). אומת: `rowsecurity=true` על כל 18, אדמין רואה דשבורד מנכ"ל מלא (כל הסניפים + מפעל). מקור התוכנית: `sql/rls_migration_plan.md` §4.1 + §4.3.
   - **§4.1.1 — הכנסה/הוצאה/שכר/פסולת סניפים**: `branch_revenue`, `branch_expenses`, `branch_labor`, `branch_waste` → admin=all, branch=own, factory=none.
   - **§4.1.2 — `fixed_costs`**: סינון לפי `entity_type` (לא `entity_id` — תיקון מול התוכנית המקורית). admin=all, branch=own branch row, factory=factory row.
   - **§4.1.3 — `employees`**: factory רואה לפי `managed_department` (NULL ⇒ רואה הכל), admin=all, branch=none.
   - **§4.1.4 — `factory_sales`, `factory_b2b_sales`**: branch רואה רק `is_internal=true` של הסניף שלו, factory=all, admin=all.
   - **§4.1.5 — ספקים ולקוחות אשראי**: `suppliers`, `supplier_invoices`, `unified_suppliers`, `branch_suppliers`, `branch_credit_customers` → admin + branch-own.
   - **§4.3 — חידוד policies קיימות**: `branch_kpi_targets` (הוסר FOR ALL authenticated), `system_settings` (WRITE רק admin — חזרה ל-008), `branch_employees` (WRITE מסונן; SELECT נשאר פתוח — שלב 2), `branch_messages` + `message_reads` (תיקון role 'employee' נשען על `app_users.branch_id` מ-008, סינון `branch_id`).
   - כל FOR ALL כולל `WITH CHECK` למניעת UPDATE שמעביר שורה בין סניפים. הסקריפט אידמפוטנטי וטרנזקציוני.

---

## פיצ'רים פתוחים

1. **InsightsCard לא מוצג ב-BranchDashboard** — הקומפוננטה מיובאת ומעובדת (`BranchDashboard.tsx:269`) אבל לא מוצגת בפועל למשתמש. יש לבדוק תנאי הצגה, האם `insights` מתמלא בזמן, ו-CSS/layout שעלול להסתיר.

2. **אחוזים שגויים ב-BranchManagerDashboard** — הנוסחאות (`BranchManagerDashboard.tsx:110-113`) מכפילות ב-100, אבל התוצאות שמוצגות למשתמש שגויות. יש לבדוק האם הנתונים שמגיעים מ-`calculateBranchPL` כבר באחוזים, האם יש overhead שנספר פעמיים, או בעיית נתוני מקור.

3. **בעיות בדוח עלויות מעסיק (EmployerCostsUpload):**
   - **Race condition** — `saveAll()` (`EmployerCostsUpload.tsx:148-171`) מבצע DELETE ואז INSERT בנפרד ללא transaction. אם ה-INSERT נכשל אחרי ה-DELETE, הנתונים אובדים. בנוסף, עדכוני branch_employees רצים ברצף ב-loop במקום `Promise.all`.
   - **שדה `is_manager` חסר בסכמה** — הקוד (`EmployerCostsUpload.tsx:160`, `calculatePL.ts:104-105`, `supabase.ts:564`) קורא וכותב שדה `is_manager`, אבל `sql/020_employer_costs.sql` לא מכיל את העמודה. עלול לגרום לשגיאת INSERT.
   - **חיבור לדשבורדים לא אומת** — `employer_costs` נצרך ע"י `calculatePL.ts` ו-`supabase.ts:fetchBranchPL()` עם דגל `laborIsActual`. לא אומת שהדשבורדים (BranchDashboard, BranchManagerDashboard, CEODashboard) מציגים את הנתונים הנכונים בפועל לאחר העלאה.

4. **לייבור מפעל לא מוצג באף דשבורד** — טבלת `labor` ריקה עבור `entity_type='factory'` באפריל 2026 (אפשר שגם בחודשים אחרים). צריך להחליט על מנגנון הזנה.

5. **טבלת `employer_costs` ריקה לחלוטין לאפריל 2026** — ייתכן שההעלאה נכשלה בגלל הבאגים הידועים ב-EmployerCostsUpload (race condition, `is_manager` חסר, שדה מחלקת מפעל חסר בטופס עובד חדש). דחוף לתקן ולנסות להעלות שוב.

6. **מכירות חיצוניות של המפעל לאפריל 2026 הן 1,120₪ בלבד** (מ-`factory_b2b_sales`). לאמת מול העסק האם אין באמת מכירות חיצוניות, או שיש ולא הוזנו.

---

## החלטות ארכיטקטורה חשובות

1. **ניווט state-based (לא URL routing)** — כל הניווט מנוהל דרך `NavigationContext.tsx` עם state (`currentPage`, `pageData`), לא React Router. המשמעות: אין deep linking, אין back button של הדפדפן, אבל פשטות בניהול. `react-router-dom` מותקן ב-package.json אבל לא בשימוש פעיל.

2. **Period system גלובלי** — `PeriodContext` עוטף את כל האפליקציה ומספק `from`/`to`/`monthKey` לכל הדפים. `PeriodPicker` מאפשר בחירת חודש/שבוע/רבעון/שנה. תקופת השוואה מחושבת אוטומטית (שנה קודמת).

3. **עלויות מעסיק מחליפות הערכות** — כש-`employer_costs` קיימים לחודש נתון, המערכת מעדיפה אותם על פני חישוב משוער (hours × rate × 1.3). הדגל `laborIsActual` מסמן שהנתונים אמיתיים.

4. **תפקיד employee** — נוסף לאחר admin/factory/branch. Auto-provision דרך auth trigger. עובד רואה רק: סידור אישי, הודעות, אילוצים.

5. **Edge Functions עם CRON_SECRET** — כל ה-edge functions שרצות ב-cron מאומתות ע"י header `CRON_SECRET`. cron חיצוני דרך cron-job.org.

6. **RLS על כל הטבלאות** — Row Level Security מופעל עם policies לפי role. admin רואה הכל, factory רואה מפעל (לפי `managed_department` ב-`employees`; לפי `is_internal` ב-`factory_sales`/`factory_b2b_sales`), branch רואה סניף שלו (לפי `branch_id` תואם), employee רואה מידע אישי. שלב 1 הושלם 2026-04-23 על 18 טבלאות קריטיות (sql/025_rls_critical.sql, תוכנית ב-sql/rls_migration_plan.md). שלב 2 פתוח: §4.2 (`daily_production`, `factory_repairs`, `factory_waste`, `kpi_targets`, `packaging_products`) + הידוק SELECT על `branch_employees` עם VIEW `branch_employees_safe` שחושף הכל חוץ מ-`hourly_rate`/`retention_bonus`.

7. **חישוב overhead** — אחוז העמסת מטה (`overhead_pct`) נשמר ב-`system_settings` ומוחל על הכנסות הסניפים ב-BranchManagerDashboard.

8. **מכירות פנימיות כ-workflow** — מכירה פנימית עוברת: upload Excel → `internal_sales` (pending) → סניף מאשר/עורך → completed. המחירים נלקחים מ-`products`.

9. **מקור קנוני להכנסות קופה: `register_closings`** (לא `branch_revenue`). `branch_revenue` משמש רק למקורות לא-קופאיים (website, credit). ה-VIEW `branch_pl_summary` מיישם זאת עם `NOT EXISTS` — לכל `(branch_id, date)`, אם קיימת סגירת קופה היא מחליפה הזנה ידנית. לגבי נתונים היסטוריים: אין חפיפה באפריל 2026 (המעבר היה נקי ב-15-16/4), אבל ה-VIEW מוגן לעתיד.

10. **שכר מנהלים בסמכות `employer_costs` בלבד** — השכר מחושב ב-`calculateBranchPL` לפי `is_manager=true` ב-`employer_costs` (עם fallback לחודש האחרון שיש בו). אין להזין שכר מנהלים ב-`fixed_costs` (הוסר 2026-04-20). כפילות שכר מנהלים עלולה להיווצר שוב אם מזינים ידנית ב-BranchSettings שם כמו "שכר מנהל" — זה נכנס לעלויות הקבועות.

---

## הערות לשיחה הבאה

- **RLS שלב 2 — לפתוח בצ'אט הבא ייעודי**:
  1. **אימות ידני של שלב 1** — להיכנס עם branch user (אבי חורב / avi29030@gmail.com) ועם factory user (נאור / naor2708@gmail.com) לוודא שהמערכת לא שבורה ושהסינון לפי role עובד בפועל (branch רואה רק סניף שלו, factory רואה רק מפעל + `is_internal` שלו).
  2. **VIEW `branch_employees_safe`** — ליצור VIEW שחושף את כל העמודות של `branch_employees` *חוץ מ-*`hourly_rate` ו-`retention_bonus`. להדק את ה-SELECT policy על `branch_employees` עצמה (כרגע פתוח ל-interim). להחליף את כל ה-frontend-reads שצריך מ-safe במקום מהטבלה.
  3. **שלב 2 של התוכנית (§4.2)** — `daily_production`, `factory_repairs`, `factory_waste`, `kpi_targets`, `packaging_products` לפי `sql/rls_migration_plan.md`.
- **עדיפות 1**: לתקן את EmployerCostsUpload (3 באגים ידועים) ולהעלות עלויות מעסיק לאפריל 2026.
- **עדיפות 2**: להבין למה אין נתוני לייבור מפעל בטבלת `labor`. לבדוק אם זו בעיית הזנה או שיש מנגנון נפרד שלא עובד.
- **עדיפות 3**: לוודא מול העסק האם יש הכנסות חיצוניות של המפעל שלא נרשמות (B2B/אירועים/קייטרינג).
- **עדיפות 4**: ולידציה ב-`BranchSettings.tsx:addCost` שתחסום שמות כמו `manager_salary`/"שכר מנהל"/"שכר הנהלה" ב-`fixed_costs` ותציג הודעה מסבירה שהשדה נכנס דרך דוח עלויות מעסיק. אחרת הכפילות שתוקנה ב-2026-04-20 עלולה לחזור.
- לתקן את עמודת `is_manager` החסרה ב-`employer_costs` — להריץ ALTER TABLE או לעדכן את `020_employer_costs.sql`.
- לבדוק למה InsightsCard לא מוצג למשתמש ב-BranchDashboard — בדיקת runtime, console errors, ובדיקה ש-`generateInsights` מחזיר תוצאות.
- לאמת את האחוזים ב-BranchManagerDashboard — להשוות נתוני DB לתצוגה בדפדפן.
- לטפל ב-race condition ב-EmployerCostsUpload — לעטוף DELETE+INSERT ב-RPC/transaction, או להשתמש ב-upsert.
- לבדוק שהדשבורדים מציגים נכון עלויות מעסיק בפועל (לא רק הערכות).
- `types/index.ts` ריק — ייתכן שהטיפוסים מפוזרים בקבצים. לשקול קונסולידציה.
