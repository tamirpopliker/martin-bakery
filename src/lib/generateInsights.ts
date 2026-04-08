/**
 * Insights generation module.
 * Analyzes monthly data and produces prioritized, actionable insights
 * for display on the branch/company dashboard.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type InsightType = 'warning' | 'success' | 'info'

export interface Insight {
  id: string
  type: InsightType
  priority: 1 | 2 | 3
  title: string
  body: string
}

export interface LaborData {
  totalCost: number
  targetPct: number          // e.g. 30 for 30%
  revenue: number
  overtimeEmployees?: {      // employees with overtime hours
    name: string
    hours: number
  }[]
}

export interface RevenueData {
  actual: number
  target: number
  lastYearSameMonth?: number
}

export interface WasteData {
  totalAmount: number
  targetPct: number          // e.g. 2 for 2%
  revenue: number
  categories?: {
    name: string
    amount: number
  }[]
}

export interface ControllableProfitData {
  actual: number
  target: number
  revenue: number
}

export interface FactoryPurchasesData {
  amount: number
  avgMonthly: number         // average over last 6-12 months
  isHolidayMonth: boolean
}

export interface ScheduleData {
  shortages: {               // days with unfilled shifts
    day: string              // e.g. "יום ראשון 15/04"
    missingCount: number
  }[]
}

export interface ConstraintsData {
  employeesWithoutConstraints: string[]   // employee names
}

export interface HolidayData {
  upcomingHoliday?: {
    name: string
    daysUntil: number
  }
}

export interface InsightsInput {
  labor?: LaborData
  revenue?: RevenueData
  waste?: WasteData
  controllableProfit?: ControllableProfitData
  factoryPurchases?: FactoryPurchasesData
  schedule?: ScheduleData
  constraints?: ConstraintsData
  holiday?: HolidayData
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

function formatCurrency(n: number): string {
  return `₪${Math.round(Math.abs(n)).toLocaleString('he-IL')}`
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`
}

// ─── Generator ──────────────────────────────────────────────────────────────

export function generateInsights(input: InsightsInput): Insight[] {
  const insights: Insight[] = []

  // ── 1. Labor over/under target ──────────────────────────────────────────
  if (input.labor) {
    const { totalCost, targetPct, revenue } = input.labor
    const actualPct = pct(totalCost, revenue)
    const diff = actualPct - targetPct

    if (diff > 2) {
      insights.push({
        id: 'labor-over',
        type: 'warning',
        priority: 1,
        title: 'עלות עבודה מעל היעד',
        body: `עלות עבודה עומדת על ${formatPct(actualPct)} מההכנסות (יעד: ${formatPct(targetPct)}). חריגה של ${formatPct(diff)}.`,
      })
    } else if (diff < -2) {
      insights.push({
        id: 'labor-under',
        type: 'success',
        priority: 2,
        title: 'עלות עבודה מתחת ליעד',
        body: `עלות עבודה עומדת על ${formatPct(actualPct)} מההכנסות (יעד: ${formatPct(targetPct)}). חיסכון של ${formatPct(Math.abs(diff))}.`,
      })
    }

    // ── 2. Labor overtime per employee ──────────────────────────────────
    if (input.labor.overtimeEmployees) {
      for (const emp of input.labor.overtimeEmployees) {
        if (emp.hours > 0) {
          insights.push({
            id: `overtime-${emp.name}`,
            type: 'warning',
            priority: 2,
            title: `שעות נוספות: ${emp.name}`,
            body: `${emp.name} עבד/ה ${emp.hours} שעות נוספות החודש.`,
          })
        }
      }
    }
  }

  // ── 3. Upcoming holiday alert ───────────────────────────────────────────
  if (input.holiday?.upcomingHoliday) {
    const { name, daysUntil } = input.holiday.upcomingHoliday
    if (daysUntil <= 14) {
      insights.push({
        id: 'holiday-alert',
        type: 'info',
        priority: daysUntil <= 7 ? 1 : 2,
        title: `חג קרב: ${name}`,
        body: `${name} בעוד ${daysUntil} ימים. יש לוודא שהמשמרות מאוישות ושההזמנות מעודכנות.`,
      })
    }
  }

  // ── 4. Revenue forecast vs target + YoY ─────────────────────────────────
  if (input.revenue) {
    const { actual, target, lastYearSameMonth } = input.revenue
    const diffPct = pct(actual - target, target)

    if (actual < target) {
      insights.push({
        id: 'revenue-below-target',
        type: 'warning',
        priority: 1,
        title: 'הכנסות מתחת ליעד',
        body: `הכנסות בפועל: ${formatCurrency(actual)} מתוך יעד ${formatCurrency(target)} (${formatPct(Math.abs(diffPct))} מתחת).`,
      })
    } else {
      insights.push({
        id: 'revenue-above-target',
        type: 'success',
        priority: 2,
        title: 'הכנסות מעל היעד',
        body: `הכנסות בפועל: ${formatCurrency(actual)} מתוך יעד ${formatCurrency(target)} (${formatPct(diffPct)} מעל).`,
      })
    }

    if (lastYearSameMonth && lastYearSameMonth > 0) {
      const yoyPct = pct(actual - lastYearSameMonth, lastYearSameMonth)
      const direction = yoyPct >= 0 ? 'עלייה' : 'ירידה'
      insights.push({
        id: 'revenue-yoy',
        type: yoyPct >= 0 ? 'info' : 'warning',
        priority: 3,
        title: 'השוואה לשנה שעברה',
        body: `${direction} של ${formatPct(Math.abs(yoyPct))} בהכנסות לעומת אותו חודש בשנה שעברה (${formatCurrency(lastYearSameMonth)}).`,
      })
    }
  }

  // ── 5. Waste over/under target with category detail ─────────────────────
  if (input.waste) {
    const { totalAmount, targetPct, revenue, categories } = input.waste
    const actualPct = pct(totalAmount, revenue)
    const diff = actualPct - targetPct

    if (diff > 0.5) {
      let detail = ''
      if (categories && categories.length > 0) {
        const sorted = [...categories].sort((a, b) => b.amount - a.amount)
        const topCategories = sorted.slice(0, 3).map(c => `${c.name}: ${formatCurrency(c.amount)}`)
        detail = ` קטגוריות מובילות: ${topCategories.join(', ')}.`
      }
      insights.push({
        id: 'waste-over',
        type: 'warning',
        priority: 1,
        title: 'פחת מעל היעד',
        body: `פחת עומד על ${formatPct(actualPct)} מההכנסות (יעד: ${formatPct(targetPct)}).${detail}`,
      })
    } else if (diff < -0.5) {
      insights.push({
        id: 'waste-under',
        type: 'success',
        priority: 3,
        title: 'פחת מתחת ליעד',
        body: `פחת עומד על ${formatPct(actualPct)} מההכנסות (יעד: ${formatPct(targetPct)}). יפה מאוד!`,
      })
    }
  }

  // ── 6. Controllable profit vs target ────────────────────────────────────
  if (input.controllableProfit) {
    const { actual, target, revenue } = input.controllableProfit
    const actualPct = pct(actual, revenue)
    const targetPct = pct(target, revenue)
    const diff = actual - target

    if (diff < 0) {
      insights.push({
        id: 'profit-below',
        type: 'warning',
        priority: 1,
        title: 'רווח נשלט מתחת ליעד',
        body: `רווח נשלט: ${formatCurrency(actual)} (${formatPct(actualPct)}) מול יעד ${formatCurrency(target)} (${formatPct(targetPct)}). הפרש: ${formatCurrency(Math.abs(diff))}.`,
      })
    } else {
      insights.push({
        id: 'profit-above',
        type: 'success',
        priority: 2,
        title: 'רווח נשלט מעל היעד',
        body: `רווח נשלט: ${formatCurrency(actual)} (${formatPct(actualPct)}) מול יעד ${formatCurrency(target)} (${formatPct(targetPct)}). עודף: ${formatCurrency(diff)}.`,
      })
    }
  }

  // ── 7. Factory purchases (high/low/holiday context) ─────────────────────
  if (input.factoryPurchases) {
    const { amount, avgMonthly, isHolidayMonth } = input.factoryPurchases
    const deviationPct = pct(amount - avgMonthly, avgMonthly)

    if (deviationPct > 20) {
      insights.push({
        id: 'factory-high',
        type: isHolidayMonth ? 'info' : 'warning',
        priority: isHolidayMonth ? 3 : 2,
        title: 'רכישות מהמפעל גבוהות מהממוצע',
        body: `רכישות מהמפעל: ${formatCurrency(amount)} (ממוצע: ${formatCurrency(avgMonthly)}). ${isHolidayMonth ? 'ייתכן שזה קשור לחג.' : `חריגה של ${formatPct(deviationPct)}.`}`,
      })
    } else if (deviationPct < -20) {
      insights.push({
        id: 'factory-low',
        type: 'info',
        priority: 3,
        title: 'רכישות מהמפעל נמוכות מהממוצע',
        body: `רכישות מהמפעל: ${formatCurrency(amount)} (ממוצע: ${formatCurrency(avgMonthly)}). ירידה של ${formatPct(Math.abs(deviationPct))}.`,
      })
    }
  }

  // ── 8. Schedule shortages ───────────────────────────────────────────────
  if (input.schedule && input.schedule.shortages.length > 0) {
    const total = input.schedule.shortages.reduce((s, d) => s + d.missingCount, 0)
    const days = input.schedule.shortages.map(d => d.day).join(', ')
    insights.push({
      id: 'schedule-shortage',
      type: 'warning',
      priority: 1,
      title: 'חוסרים בסידור עבודה',
      body: `חסרים ${total} עובדים בימים: ${days}.`,
    })
  }

  // ── 9. Missing constraints ──────────────────────────────────────────────
  if (input.constraints && input.constraints.employeesWithoutConstraints.length > 0) {
    const names = input.constraints.employeesWithoutConstraints
    insights.push({
      id: 'missing-constraints',
      type: 'info',
      priority: 2,
      title: 'עובדים ללא אילוצים',
      body: `${names.length} עובדים טרם הגישו אילוצים: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` ועוד ${names.length - 5}` : ''}.`,
    })
  }

  // ── Sort by priority (1 first) ──────────────────────────────────────────
  insights.sort((a, b) => a.priority - b.priority)

  return insights
}
