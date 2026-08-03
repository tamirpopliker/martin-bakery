// ─── Period system — unified date range management ──────────────────────────

import { monthEnd, prevMonth } from './supabase'

// ─── Types ──────────────────────────────────────────────────────────────────
export type PeriodType =
  | 'month'
  | 'last_month'
  | 'custom_month'
  | 'custom_range'
  | 'this_week'
  | 'last_week'
  | 'quarter'
  | 'quarter_last_year'
  | 'year'
  | 'last_year'

export interface PeriodRange {
  from: string            // YYYY-MM-DD  (inclusive)
  to: string              // YYYY-MM-DD  (exclusive — use with .lt())
  label: string           // Hebrew display label
  type: PeriodType
  monthKey: string | null // YYYY-MM for single-month periods, null for multi
  customMonth?: string    // YYYY-MM when type === 'custom_month', or start month of a custom_range
  customTo?: string       // YYYY-MM end month when type === 'custom_range'
}

// ─── Hebrew helpers ─────────────────────────────────────────────────────────
const HEB_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

export function hebrewMonthName(yyyyMM: string): string {
  const m = parseInt(yyyyMM.split('-')[1], 10)
  return HEB_MONTHS[m - 1] || yyyyMM
}

function hebrewMonthYear(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-')
  return `${HEB_MONTHS[parseInt(m, 10) - 1]} ${y}`
}

// ─── Date arithmetic helpers ────────────────────────────────────────────────

/** Current month as YYYY-MM */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/** Current year as number */
function currentYear(): number {
  return new Date().getFullYear()
}

/** Get quarter number (1-4) for a month (1-12) */
function quarterOf(month: number): number {
  return Math.ceil(month / 3)
}

/** First day of quarter: quarterStart(1, 2026) → "2026-01-01" */
function quarterStartDate(q: number, year: number): string {
  const m = (q - 1) * 3 + 1
  return `${year}-${String(m).padStart(2, '0')}-01`
}

/** First day AFTER quarter ends: quarterEnd(1, 2026) → "2026-04-01" */
function quarterEndDate(q: number, year: number): string {
  if (q === 4) return `${year + 1}-01-01`
  const m = q * 3 + 1
  return `${year}-${String(m).padStart(2, '0')}-01`
}

/** Get Sunday of the current week (Israel: week starts Sunday) */
function sundayOfWeek(d: Date): Date {
  const result = new Date(d)
  const day = result.getDay() // 0=Sun
  result.setDate(result.getDate() - day)
  result.setHours(0, 0, 0, 0)
  return result
}

/** Format Date → YYYY-MM-DD */
function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Add days to a date */
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// ─── Compute period range ───────────────────────────────────────────────────

export function computePeriod(type: PeriodType, customMonth?: string, customTo?: string): PeriodRange {
  const now = new Date()
  const cm = currentMonth()
  const cy = currentYear()
  const [, cmMonth] = cm.split('-').map(Number)
  const cq = quarterOf(cmMonth)

  switch (type) {
    case 'month': {
      return {
        from: cm + '-01',
        to: monthEnd(cm),
        label: hebrewMonthYear(cm),
        type: 'month',
        monthKey: cm,
      }
    }

    case 'last_month': {
      const pm = prevMonth(cm)
      return {
        from: pm + '-01',
        to: monthEnd(pm),
        label: hebrewMonthYear(pm),
        type: 'last_month',
        monthKey: pm,
      }
    }

    case 'custom_month': {
      const m = customMonth || cm
      return {
        from: m + '-01',
        to: monthEnd(m),
        label: hebrewMonthYear(m),
        type: 'custom_month',
        monthKey: m,
        customMonth: m,
      }
    }

    case 'custom_range': {
      // Multi-month range (e.g. מאי–אוגוסט). monthKey is null so P&L iterates months.
      const fromM = customMonth || cm
      const toM = customTo || fromM
      const [f, t] = fromM <= toM ? [fromM, toM] : [toM, fromM]
      const fy = f.split('-')[0], ty = t.split('-')[0]
      const label = fy === ty
        ? `${hebrewMonthName(f)}–${hebrewMonthName(t)} ${ty}`
        : `${hebrewMonthYear(f)} – ${hebrewMonthYear(t)}`
      return {
        from: f + '-01',
        to: monthEnd(t),
        label,
        type: 'custom_range',
        monthKey: null,
        customMonth: f,
        customTo: t,
      }
    }

    case 'this_week': {
      const sun = sundayOfWeek(now)
      const nextSun = addDays(sun, 7)
      return {
        from: fmt(sun),
        to: fmt(nextSun),
        label: 'השבוע',
        type: 'this_week',
        monthKey: null,
      }
    }

    case 'last_week': {
      const thisSun = sundayOfWeek(now)
      const lastSun = addDays(thisSun, -7)
      return {
        from: fmt(lastSun),
        to: fmt(thisSun),
        label: 'שבוע שעבר',
        type: 'last_week',
        monthKey: null,
      }
    }

    case 'quarter': {
      return {
        from: quarterStartDate(cq, cy),
        to: quarterEndDate(cq, cy),
        label: `Q${cq} ${cy}`,
        type: 'quarter',
        monthKey: null,
      }
    }

    case 'quarter_last_year': {
      return {
        from: quarterStartDate(cq, cy - 1),
        to: quarterEndDate(cq, cy - 1),
        label: `Q${cq} ${cy - 1}`,
        type: 'quarter_last_year',
        monthKey: null,
      }
    }

    case 'year': {
      return {
        from: `${cy}-01-01`,
        to: `${cy + 1}-01-01`,
        label: `${cy}`,
        type: 'year',
        monthKey: null,
      }
    }

    case 'last_year': {
      return {
        from: `${cy - 1}-01-01`,
        to: `${cy}-01-01`,
        label: `${cy - 1}`,
        type: 'last_year',
        monthKey: null,
      }
    }
  }
}

// ─── Comparison period for DiffBadge ────────────────────────────────────────

export function getComparisonPeriod(period: PeriodRange): PeriodRange {
  switch (period.type) {
    case 'month':
    case 'last_month':
    case 'custom_month': {
      const pm = prevMonth(period.monthKey!)
      return {
        from: pm + '-01',
        to: monthEnd(pm),
        label: hebrewMonthYear(pm),
        type: 'custom_month',
        monthKey: pm,
        customMonth: pm,
      }
    }

    case 'custom_range': {
      // Equal-length range immediately preceding the selected one.
      const n = getMonthsInRange(period.from, period.to).length || 1
      const [fy, fm] = period.from.split('-').map(Number)
      let sy = fy, sm = fm - n
      while (sm < 1) { sm += 12; sy-- }
      const compFrom = `${sy}-${String(sm).padStart(2, '0')}`
      return {
        from: compFrom + '-01',
        to: period.from,
        label: `${n} חודשים קודמים`,
        type: 'custom_range',
        monthKey: null,
      }
    }

    case 'this_week':
      return computePeriod('last_week')

    case 'last_week': {
      // Two weeks ago
      const thisSun = sundayOfWeek(new Date())
      const twoWeeksAgo = addDays(thisSun, -14)
      const oneWeekAgo = addDays(thisSun, -7)
      return {
        from: fmt(twoWeeksAgo),
        to: fmt(oneWeekAgo),
        label: 'לפני שבועיים',
        type: 'last_week',
        monthKey: null,
      }
    }

    case 'quarter': {
      // Previous quarter
      const [y] = period.from.split('-').map(Number)
      const m = parseInt(period.from.split('-')[1], 10)
      const q = quarterOf(m)
      const pq = q === 1 ? 4 : q - 1
      const py = q === 1 ? y - 1 : y
      return {
        from: quarterStartDate(pq, py),
        to: quarterEndDate(pq, py),
        label: `Q${pq} ${py}`,
        type: 'quarter',
        monthKey: null,
      }
    }

    case 'quarter_last_year': {
      // Same quarter, two years ago
      const [y] = period.from.split('-').map(Number)
      const m = parseInt(period.from.split('-')[1], 10)
      const q = quarterOf(m)
      return {
        from: quarterStartDate(q, y - 1),
        to: quarterEndDate(q, y - 1),
        label: `Q${q} ${y - 1}`,
        type: 'quarter_last_year',
        monthKey: null,
      }
    }

    case 'year': {
      const y = parseInt(period.from.split('-')[0], 10)
      return {
        from: `${y - 1}-01-01`,
        to: `${y}-01-01`,
        label: `${y - 1}`,
        type: 'last_year',
        monthKey: null,
      }
    }

    case 'last_year': {
      const y = parseInt(period.from.split('-')[0], 10)
      return {
        from: `${y - 1}-01-01`,
        to: `${y}-01-01`,
        label: `${y - 1}`,
        type: 'last_year',
        monthKey: null,
      }
    }
  }
}

// ─── Utility: all YYYY-MM month keys in a date range ────────────────────────

export function getMonthsInRange(from: string, to: string): string[] {
  const months: string[] = []
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)

  let y = fy, m = fm
  // `to` is exclusive (first day of next period), so stop before it
  const toMonth = ty * 12 + tm
  while (y * 12 + m < toMonth) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}
