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
│   ├── pages/                       # 28 page components (כל המסכים)
│   ├── components/
│   │   ├── PeriodPicker.tsx         # בורר תקופות (חודש / שבוע / רבעון / שנה)
│   │   ├── icons/                   # אייקונים מותאמים (Revenue, Profit, Labor, FixedCost, Trophy)
│   │   └── ui/                      # shadcn/ui: button, card, table, sheet
│   ├── lib/
│   │   ├── supabase.ts             # Supabase client (PKCE) + date utils + labor calc + fetchBranches
│   │   ├── UserContext.tsx          # Auth context, AppUser, role-based access (canAccessPage)
│   │   ├── BranchContext.tsx        # Dynamic branches from Supabase (useBranches hook)
│   │   ├── PeriodContext.tsx        # Period state management (usePeriod hook)
│   │   ├── period.ts               # Period computation, Hebrew month names, comparison periods
│   │   ├── internalCustomers.ts    # מיפוי לקוחות פנימיים → סניפים (detectBranchId)
│   │   └── utils.ts                # cn() helper
│   └── types/
│       └── index.ts                # Type definitions
├── supabase/
│   └── functions/
│       ├── check-alerts/           # Edge Function — בדיקת התרעות כל שעה
│       │   └── index.ts            # Check rules → query data → send email → log
│       └── send-reports/           # Edge Function — דוחות אימייל
│           ├── index.ts            # Orchestrator: cron → reports → email
│           ├── lib/
│           │   ├── db.ts           # DB queries, date utils, branch/dept names
│           │   ├── schedule.ts     # Daily/Weekly/Monthly schedule logic (Israel TZ)
│           │   ├── recipients.ts   # Fetch app_users, filter by role
│           │   ├── charts.ts       # QuickChart.io URL generation
│           │   ├── insights.ts     # Claude AI insights (claude-haiku-4-5)
│           │   ├── email.ts        # Resend API email sending
│           │   └── templates.ts    # HTML email components
│           └── reports/
│               ├── branch-daily.ts
│               ├── branch-weekly.ts
│               ├── branch-monthly.ts
│               ├── factory-daily.ts
│               ├── factory-weekly.ts
│               ├── factory-monthly.ts
│               ├── admin-branches.ts
│               └── admin-factory.ts
├── sql/                             # Migration/setup scripts
│   ├── 004_app_users.sql           # טבלת משתמשים + RLS + seed data
│   ├── 005_email_reports_setup.sql # branch_kpi_targets columns + report_log
│   ├── 006_dynamic_branches.sql    # טבלת branches דינמית + seed 3 סניפים + RLS
│   ├── 007_alerts.sql              # alert_rules + alert_log + RLS
│   ├── internal_orders_schema.sql  # Internal orders: is_internal, target_branch_id, branch_status
│   ├── check_internal.sql          # Query for checking internal sales
│   └── fix_internal_sales.sql      # Retroactive fix for internal sales
├── package.json                     # React 19, Supabase, Tailwind 4, shadcn, Framer Motion, Recharts
├── vite.config.ts                   # Vite + React + Tailwind plugin
├── components.json                  # shadcn/ui config (base-nova style)
├── vercel.json                      # Vercel deployment config
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
| role | TEXT | 'admin' / 'factory' / 'branch' |
| branch_id | INT | לסניפים: 1=אברהם אבינו, 2=הפועלים, 3=יעקב כהן |
| excluded_departments | TEXT[] | מחלקות שמשתמש factory לא רואה |
| can_settings | BOOLEAN | האם יכול לגשת להגדרות |
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

### employees — עובדים גלובליים
(referenced in supabase.ts — fetchGlobalEmployees)

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

### אזור סניפים (×3: אברהם אבינו / הפועלים / יעקב כהן)
| מסך | קובץ | תיאור |
|------|-------|--------|
| BranchHome | BranchHome.tsx | Hub סניף עם 10 אפשרויות |
| BranchRevenue | BranchRevenue.tsx | הכנסות: קופה / אתר / הקפה |
| BranchExpenses | BranchExpenses.tsx | הוצאות: ספקים / תיקונים / תשתיות / משלוחים / אחר |
| BranchLabor | BranchLabor.tsx | לייבור סניף עם יכולת חילוץ PDF |
| BranchWaste | BranchWaste.tsx | פחת סניף |
| BranchCreditCustomers | BranchCreditCustomers.tsx | ניהול לקוחות הקפה ותשלומים |
| BranchSuppliers | BranchSuppliers.tsx | ספקים וקטגוריות |
| BranchOrders | BranchOrders.tsx | הזמנות מהמפעל — אישור/ערעור |
| BranchPL | BranchPL.tsx | דוח רווח והפסד עם השוואת תקופות |
| BranchSettings | BranchSettings.tsx | יעדים, עלויות קבועות, עובדים |
| BranchManagerDashboard | BranchManagerDashboard.tsx | השוואת 3 סניפים עם חלוקת overhead |

### אזור ניהול
| מסך | קובץ | תיאור |
|------|-------|--------|
| CEODashboard | CEODashboard.tsx | דשבורד מנכ"ל — אנליטיקות מתקדמות, Recharts, CountUp, Framer Motion |
| AlertsManagement | AlertsManagement.tsx | ניהול התרעות — כללים, לוג, הוספה/עריכה — admin only |
| UserManagement | UserManagement.tsx | ניהול משתמשים, תפקידים, הרשאות + ניהול סניפים — admin only |
| DataImport | DataImport.tsx | ייבוא CSV מ-Base44 — תומך ב-16 טבלאות |
| DataExport | DataExport.tsx | ייצוא 20+ טבלאות ל-CSV/ZIP |

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

---

## שירותים חיצוניים מחוברים

| שירות | שימוש | מפתח סביבה |
|--------|--------|-------------|
| **Supabase** | DB + Auth + Storage | `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` |
| **Resend** | שליחת אימיילים (דוחות) | `RESEND_API_KEY` |
| **Anthropic Claude** | AI insights בדוחות (claude-haiku-4-5) | `ANTHROPIC_API_KEY` |
| **QuickChart.io** | יצירת גרפים לאימיילים | ללא מפתח (public API) |
| **Google OAuth** | התחברות עם Google | דרך Supabase Auth |
| **Vercel** | Hosting + Deployment | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |
| **cron-job.org** | Scheduling דוחות | `CRON_SECRET` |

---

## פיצ'רים שהושלמו ועובדים

1. **Authentication** — Google OAuth + email/password דרך Supabase Auth (PKCE)
2. **Role-based access control** — admin/factory/branch עם excluded_departments ו-can_settings
3. **דף הבית (Home)** — KPI cards, מעבר ל-3 אזורים, גרפים 6 חודשים
4. **ייצור יומי** — הזנה, עריכה, מחיקה, גרפים SVG
5. **פחת מפעל** — לפי מחלקה וקטגוריה
6. **תיקונים וציוד** — repair / new_equipment
7. **לייבור מרוכז** — העלאת CSV, חישוב אוטומטי (×1.3), ניהול עובדים (שעתיים + גלובליים)
8. **מכירות מפעל** — קרמים, בצקים, B2B, שונות
9. **הזמנות פנימיות** — זיהוי אוטומטי של מכירות לסניפים, branch_status (pending/approved/disputed)
10. **ספקים וחשבוניות** — ניהול ספקים + חשבוניות מס
11. **דשבורד מפעל** — KPI, רווח גולמי, פרודוקטיביות, 6-month trends
12. **דשבורד מחלקתי** — אנליטיקות לקרמים ובצקים
13. **הגדרות מפעל** — יעדי KPI, עלויות קבועות, עובדים, import/export
14. **הכנסות סניפים** — קופה / אתר / הקפה
15. **הוצאות סניפים** — 5 קטגוריות הוצאה
16. **לייבור סניפים** — כולל חילוץ מ-PDF
17. **פחת סניפים** — finished/raw/packaging
18. **לקוחות הקפה** — ניהול לקוחות + תשלומים
19. **ספקי סניפים** — לפי קטגוריה
20. **הזמנות מהמפעל** — אישור/ערעור הזמנות פנימיות
21. **דוח רווח והפסד** — סניפי, עם השוואת תקופות
22. **הגדרות סניף** — יעדים, עלויות קבועות, עובדים
23. **דשבורד מנהל סניפים** — השוואת 3 סניפים + חלוקת overhead
24. **דשבורד מנכ"ל** — אנליטיקות מתקדמות עם אנימציות (Framer Motion + CountUp)
25. **ניהול משתמשים** — CRUD לאדמין, הקצאת תפקידים והרשאות
26. **ייבוא נתונים** — CSV/ZIP מ-Base44, תומך 16 סוגי טבלאות, dedup, validation
27. **ייצוא נתונים** — 20+ טבלאות ל-CSV/ZIP עם סינון תקופה
28. **דוחות אימייל אוטומטיים** — Edge Function עם 8 סוגי דוחות, AI insights
29. **PeriodPicker** — בורר תקופות גמיש (חודש/שבוע/רבעון/שנה/מותאם)
30. **עיצוב מודרני** — shadcn/ui, Framer Motion, Recharts, responsive mobile-first
31. **RTL + Hebrew** — כל הממשק בעברית עם תמיכה מלאה ב-RTL
32. **שדרוג ויזואלי כלל-מערכתי** — צבע indigo אחיד, shadcn/ui, Framer Motion animations, עקביות ויזואלית בכל הדפים
33. **סניפים דינמיים** — טבלת branches ב-Supabase, BranchContext, הסרת כל הערכים הקשיחים מהקוד, ממשק ניהול סניפים ב-UserManagement
34. **PWA** — manifest.json, Service Worker, כפתור התקנה, תמיכה ב-iOS/Android, offline cache
35. **מערכת התרעות** — alert_rules, alert_log, Edge Function check-alerts (רצה כל שעה דרך cron-job.org), ממשק ניהול התרעות AlertsManagement.tsx עם הפעלה/כיבוי, הוספה, ולוג שליחות — גישה לadmin בלבד
36. **מודול ניהול צוות מלא** — schedule_constraints (זמינות עובדים לפי משמרת), shift_roles, branch_shifts, shift_staffing_requirements, employee_role_assignments, shift_assignments. ShiftSettings (תפקידים/משמרות/דרישות/תפקידי עובדים/חגים). WeeklySchedule (סידור שבועי, שיבוץ אוטומטי עם ניקוד, פרסום, ייצוא PDF/וואטסאפ). EmployeeConstraints (לוח שבועי, תאים חכמים, מובייל). ManagerConstraintsView (תצוגת זמינות הצוות). MySchedule (סידור אישי לעובד). ScheduleHistory (ארכיון סידורים). חונך-מתלמד (training_status). חגים מ-Hebcal API. send-schedule Edge Function לשליחת סידור במייל
37. **תפקיד עובד (employee role)** — app_users עם role='employee', EmployeeHome, auth trigger אוטומטי ליצירת חשבון, send-invitation Edge Function, ייבוא עובדים בצובר מ-UserManagement
38. **לוגו קונדיטוריית מרטין** — מוטמע בכל הדפים הרלוונטיים (Login, Home, EmployeeHome, מיילים), צבע מותג #0d6165
39. **עיצוב Clean UI מינימליסטי** — כל האפליקציה, white space, indigo (#6366f1) palette, shadow-sm cards, border-gray-100, רקע gray-50, טבלאות נקיות ללא רקע שורות, headers אחידים

---

## פיצ'רים שהתחילו ולא הסתיימו

אין פיצ'רים פתוחים כרגע.

---

## החלטות ארכיטקטורה חשובות

1. **ניווט state-based** — אין React Router עם URL paths. כל הניווט מנוהל ב-state פנימי של Home.tsx. לא לשנות לroutert-based.
2. **Supabase PKCE Auth** — ה-auth flow הוא PKCE. אין tokens ב-URL.
3. **מחלקות מפעל** — 4 קבועות: creams, dough, packaging, cleaning (ניקיון+נהג+הנהלה+משרד = cleaning)
4. **3 סניפים קיימים** — branch_id: 1=אברהם אבינו, 2=הפועלים (עמק שרה), 3=יעקב כהן. IDs לא ניתנים לשינוי (נתונים היסטוריים).
5. **עלות מעסיק ×1.3** — כשאין employer_cost ב-CSV, מחושב אוטומטית gross_salary × 1.3.
6. **PeriodContext** — כל דף שצריך תקופה משתמש ב-usePeriod(). לא ליצור מנגנון תקופות נפרד.
7. **UserContext** — canAccessPage() קובע גישה. לא להוסיף מנגנון auth נוסף.
8. **RTL** — dir="rtl" על html. כל ה-CSS כתוב עם RTL ב-mind. אל תוסיף dir="ltr".
9. **shadcn/ui** — כל UI components חדשים צריכים להיות מ-shadcn/ui (base-nova style).
10. **Tailwind CSS 4** — גרסה 4, עם @tailwindcss/vite plugin. CSS variables ב-oklch.
11. **Edge Function scheduling** — cron חיצוני (cron-job.org), לא pg_cron (לא זמין ב-Free plan).
12. **ייבוא נתונים מ-Base44** — המערכת הקודמת. ייבוא כ-ZIP עם CSVs. מבנה קבצים ספציפי.
13. **סניפים: שבוע עבודה** — א-ו (ראשון עד שישי), שבת סגור. שבוע מתחיל ביום ראשון.
14. **סניפים דינמיים** — רשימת הסניפים נטענת מטבלת branches דרך BranchContext. אין יותר שמות סניפים קשיחים בקוד. הוספת סניף = שורה חדשה בטבלה בלבד.
15. **PWA** — manifest.json + Service Worker. Cache First לנכסים סטטיים, Network First לקריאות Supabase.
16. **התרעות** — Edge Function check-alerts רצה כל שעה (07:00-20:00 ישראל) דרך cron-job.org. כללי התרעה מנוהלים דרך ממשק admin.

---

## הערות לשיחה הבאה

1. **Dev server** — `npm run dev` על port 5177 (מוגדר ב-.claude/launch.json).
2. **כל הטקסט בעברית** — UI, הודעות שגיאה, labels, placeholder — הכל בעברית.
3. **Home.tsx הוא קובץ מרכזי** — ~740 שורות, מכיל את כל הניווט ו-KPI cards.
4. **CEODashboard.tsx הכי גדול** — 40KB+, עם ויזואליזציות מורכבות. משמש כ"סטנדרט הזהב" לעיצוב.
5. **DataImport.tsx** — מנוע ייבוא מורכב שתומך בזיהוי אוטומטי של סוגי קבצים, dedup, וvalidation.
6. **Email from** — reports@martinbakery.co.il (default ב-Edge Function).
7. **Employees** — שני סוגים: שעתיים (hourly, דרך CSV) וגלובליים (salary, דרך employees table). שניהם נכללים בחישובי לייבור.
8. **כללי התרעה ריקים** — טרם הוגדרו ערכי סף. יש לעשות דרך AlertsManagement.
9. **SQL files 006 ו-007 טרם הורצו על Supabase** — צריך להריץ בדשבורד.
10. **theme_color של PWA** — #818cf8 (indigo).
11. **מודול סידור עבודה** — טבלאות: shift_roles, employee_role_assignments, branch_shifts, shift_staffing_requirements, schedule_constraints (עם shift_id). דפים: ShiftSettings (4 לשוניות), EmployeeConstraints (לוח שבועי + תפקידים), ManagerConstraintsView (תצוגת יום/משמרת), EmployeeHome (דף בית עובד).
12. **תפקידי עובדים** — role='employee' ב-app_users עם employee_id → branch_employees. הצטרפות דרך send-invitation Edge Function שיוצר app_users אוטומטית.
13. **מצב ישיבה** — BranchManagerDashboard מציג מצב ישיבה כברירת מחדל (מסתיר נתוני שכר).
14. **P&L אחיד** — "רווח נשלט" (Controllable Margin) + "רווח תפעולי". fetchBranchPL / fetchFactoryPL ב-supabase.ts.
15. **ספקים פנימיים** — from_factory=true ב-branch_expenses. פיצול בטבלאות P&L: "רכישות מפעל" + "ספקים חיצוניים".
