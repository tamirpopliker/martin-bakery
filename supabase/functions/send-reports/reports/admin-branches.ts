import { type Recipient } from '../lib/recipients.ts'
import { type ReportSchedule } from '../lib/schedule.ts'
import {
  getBranchRevenue, getBranchLabor, getBranchWaste, getBranchKpiTargets,
  getWorkingDaysCount, nextDay, subtractDays, formatHebrewDate, formatShortDate,
  getMonthRange, BRANCH_NAMES, BRANCH_COLORS, logReport,
} from '../lib/db.ts'
import { adminBranchComparisonChart, adminRevenueTrendChart } from '../lib/charts.ts'
import { generateInsights } from '../lib/insights.ts'
import { sendEmail } from '../lib/email.ts'
import {
  emailLayout, sectionHeader, dataTable, chartImg, insightsBox, highlightBox,
  fmtCurrency, fmtPct, statusBadge,
} from '../lib/templates.ts'

const ALL_BRANCHES = [1, 2, 3]

const HEBREW_MONTHS: Record<string, string> = {
  '01': 'ינואר', '02': 'פברואר', '03': 'מרץ', '04': 'אפריל',
  '05': 'מאי', '06': 'יוני', '07': 'יולי', '08': 'אוגוסט',
  '09': 'ספטמבר', '10': 'אוקטובר', '11': 'נובמבר', '12': 'דצמבר',
}

interface BranchSummary {
  id: number
  name: string
  color: string
  revenue: number
  achievementPct: number
  wastePct: number
  laborPct: number
  avgBasket: number
  transactions: number
}

async function fetchBranchSummary(branchId: number, from: string, to: string, monthKey: string): Promise<BranchSummary> {
  const [revData, laborData, wasteData, targets, workingDays] = await Promise.all([
    getBranchRevenue(branchId, from, to),
    getBranchLabor(branchId, from, to),
    getBranchWaste(branchId, from, to),
    getBranchKpiTargets(branchId),
    getWorkingDaysCount(monthKey),
  ])

  const totalRevenue = revData.reduce((s, r) => s + Number(r.amount), 0)
  const cashierRevenue = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + Number(r.amount), 0)
  const transactions = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + (Number(r.transaction_count) || 0), 0)
  const avgBasket = transactions > 0 ? cashierRevenue / transactions : 0
  const laborCost = laborData.reduce((s, r) => s + Number(r.employer_cost), 0)
  const laborPct = totalRevenue > 0 ? (laborCost / totalRevenue) * 100 : 0
  const wasteTotal = wasteData.reduce((s, r) => s + Number(r.amount), 0)
  const wastePct = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0
  const dailyTarget = workingDays > 0 ? (targets.revenue_target || 0) / workingDays : 0
  // Calculate days in range
  const daysInRange = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000))
  const periodTarget = dailyTarget * daysInRange
  const achievementPct = periodTarget > 0 ? (totalRevenue / periodTarget) * 100 : 0

  return {
    id: branchId,
    name: BRANCH_NAMES[branchId] || `סניף ${branchId}`,
    color: BRANCH_COLORS[branchId] || '#64748b',
    revenue: totalRevenue,
    achievementPct,
    wastePct,
    laborPct,
    avgBasket,
    transactions,
  }
}

// ── Daily ──
export async function sendAdminBranchesDailyReport(user: Recipient, schedule: ReportSchedule) {
  const { reportDate, monthKey } = schedule
  const from = reportDate
  const to = nextDay(reportDate)
  const dateStr = formatHebrewDate(reportDate)

  // Fetch all branches
  const branches = await Promise.all(ALL_BRANCHES.map(id => fetchBranchSummary(id, from, to, monthKey)))

  // Best/worst by revenue
  const sorted = [...branches].sort((a, b) => b.revenue - a.revenue)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]

  // ── 7-day revenue trend ──
  const trendDays: Array<{ label: string; revenue: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = subtractDays(reportDate, i)
    const label = formatShortDate(d)
    let totalRev = 0
    for (const branchId of ALL_BRANCHES) {
      const rev = await getBranchRevenue(branchId, d, nextDay(d))
      totalRev += rev.reduce((s, r) => s + Number(r.amount), 0)
    }
    trendDays.push({ label, revenue: Math.round(totalRev) })
  }

  const comparisonChartUrl = adminBranchComparisonChart(branches.map(b => ({
    name: b.name, achievementPct: b.achievementPct, color: b.color,
  })))
  const trendChartUrl = adminRevenueTrendChart(trendDays)

  // ── Table ──
  const table = dataTable(
    ['סניף', 'הכנסות', 'עמידה ביעד', 'פחת %', 'לייבור %', 'סל ממוצע', 'עסקאות'],
    branches.map(b => [
      `<strong style="color:${b.color};">${b.name}</strong>`,
      fmtCurrency(b.revenue),
      `${Math.round(b.achievementPct)}%`,
      `${fmtPct(b.wastePct)} ${statusBadge(b.wastePct <= 3)}`,
      `${fmtPct(b.laborPct)} ${statusBadge(b.laborPct <= 28)}`,
      fmtCurrency(b.avgBasket),
      String(b.transactions),
    ]),
  )

  // ── AI ──
  const insights = await generateInsights('admin_branches', {
    branches: branches.map(b => ({
      name: b.name, revenue: Math.round(b.revenue),
      achievementPct: Math.round(b.achievementPct),
      wastePct: b.wastePct.toFixed(1), laborPct: b.laborPct.toFixed(1),
    })),
    bestBranch: best.name, worstBranch: worst.name,
  }, 3)

  // ── Build HTML ──
  const body = `
    <div style="text-align:center;margin-bottom:20px;">
      ${highlightBox('הסניף הטוב ביותר', `${best.name} — ${fmtCurrency(best.revenue)}`, '#10b981')}
      ${highlightBox('הסניף החלש ביותר', `${worst.name} — ${fmtCurrency(worst.revenue)}`, '#ef4444')}
    </div>
    ${sectionHeader('סיכום כל הסניפים')}
    ${table}
    ${sectionHeader('השוואת עמידה ביעד')}
    ${chartImg(comparisonChartUrl, 'גרף השוואת סניפים')}
    ${sectionHeader('מגמת הכנסות — 7 ימים אחרונים')}
    ${chartImg(trendChartUrl, 'גרף מגמת הכנסות')}
    ${insightsBox(insights)}
  `

  const html = emailLayout('דוח יומי — סניפים', body, dateStr)

  const result = await sendEmail({
    to: user.email,
    subject: `📊 דוח יומי · סניפים · ${dateStr}`,
    html,
  })

  await logReport('daily', user.email, user.role, reportDate, result.success ? 'sent' : 'failed', result.error)
}

// ── Weekly ──
export async function sendAdminBranchesWeeklyReport(user: Recipient, schedule: ReportSchedule) {
  const { weekStart, weekEnd, monthKey } = schedule
  const from = weekStart
  const to = nextDay(weekEnd)

  const branches = await Promise.all(ALL_BRANCHES.map(id => fetchBranchSummary(id, from, to, monthKey)))
  const sorted = [...branches].sort((a, b) => b.revenue - a.revenue)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]

  // Daily trend for the week
  const trendDays: Array<{ label: string; revenue: number }> = []
  for (let i = 0; i < 6; i++) {
    const d = subtractDays(weekEnd, 5 - i)
    const label = formatShortDate(d)
    let totalRev = 0
    for (const branchId of ALL_BRANCHES) {
      const rev = await getBranchRevenue(branchId, d, nextDay(d))
      totalRev += rev.reduce((s, r) => s + Number(r.amount), 0)
    }
    trendDays.push({ label, revenue: Math.round(totalRev) })
  }

  const comparisonChartUrl = adminBranchComparisonChart(branches.map(b => ({
    name: b.name, achievementPct: b.achievementPct, color: b.color,
  })))
  const trendChartUrl = adminRevenueTrendChart(trendDays)

  const table = dataTable(
    ['סניף', 'הכנסות', 'עמידה ביעד', 'פחת %', 'לייבור %', 'סל ממוצע', 'עסקאות'],
    branches.map(b => [
      `<strong style="color:${b.color};">${b.name}</strong>`,
      fmtCurrency(b.revenue), `${Math.round(b.achievementPct)}%`,
      `${fmtPct(b.wastePct)} ${statusBadge(b.wastePct <= 3)}`,
      `${fmtPct(b.laborPct)} ${statusBadge(b.laborPct <= 28)}`,
      fmtCurrency(b.avgBasket), String(b.transactions),
    ]),
  )

  const insights = await generateInsights('admin_branches', {
    branches: branches.map(b => ({
      name: b.name, revenue: Math.round(b.revenue),
      achievementPct: Math.round(b.achievementPct),
      wastePct: b.wastePct.toFixed(1), laborPct: b.laborPct.toFixed(1),
    })),
    bestBranch: best.name, worstBranch: worst.name,
  }, 3)

  const body = `
    <div style="text-align:center;margin-bottom:20px;">
      ${highlightBox('הסניף הטוב ביותר', `${best.name} — ${fmtCurrency(best.revenue)}`, '#10b981')}
      ${highlightBox('הסניף החלש ביותר', `${worst.name} — ${fmtCurrency(worst.revenue)}`, '#ef4444')}
    </div>
    ${sectionHeader('סיכום שבועי — כל הסניפים')}
    ${table}
    ${sectionHeader('השוואת עמידה ביעד')}
    ${chartImg(comparisonChartUrl, 'גרף השוואת סניפים')}
    ${sectionHeader('מגמת הכנסות שבועית')}
    ${chartImg(trendChartUrl, 'גרף מגמה')}
    ${insightsBox(insights)}
  `

  const html = emailLayout(
    'סיכום שבועי — סניפים',
    body,
    `${formatHebrewDate(weekStart)} — ${formatHebrewDate(weekEnd)}`,
  )

  const result = await sendEmail({
    to: user.email,
    subject: `📈 סיכום שבועי · סניפים`,
    html,
  })

  await logReport('weekly', user.email, user.role, weekStart, result.success ? 'sent' : 'failed', result.error)
}

// ── Monthly ──
export async function sendAdminBranchesMonthlyReport(user: Recipient, schedule: ReportSchedule) {
  const { prevMonthKey, prevYearMonthKey } = schedule
  const monthName = HEBREW_MONTHS[prevMonthKey.slice(5)] || prevMonthKey
  const range = getMonthRange(prevMonthKey)
  const yoyRange = getMonthRange(prevYearMonthKey)

  const branches = await Promise.all(ALL_BRANCHES.map(id => fetchBranchSummary(id, range.from, range.to, prevMonthKey)))
  const yoyBranches = await Promise.all(ALL_BRANCHES.map(id => fetchBranchSummary(id, yoyRange.from, yoyRange.to, prevYearMonthKey)))

  const sorted = [...branches].sort((a, b) => b.revenue - a.revenue)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]

  const table = dataTable(
    ['סניף', 'הכנסות', 'שנה שעברה', 'שינוי', 'עמידה ביעד', 'פחת %', 'לייבור %'],
    branches.map((b, i) => {
      const yoy = yoyBranches[i]
      const delta = yoy.revenue > 0 ? ((b.revenue - yoy.revenue) / yoy.revenue) * 100 : 0
      return [
        `<strong style="color:${b.color};">${b.name}</strong>`,
        fmtCurrency(b.revenue), fmtCurrency(yoy.revenue),
        `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
        `${Math.round(b.achievementPct)}%`,
        `${fmtPct(b.wastePct)} ${statusBadge(b.wastePct <= 3)}`,
        `${fmtPct(b.laborPct)} ${statusBadge(b.laborPct <= 28)}`,
      ]
    }),
  )

  const comparisonChartUrl = adminBranchComparisonChart(branches.map(b => ({
    name: b.name, achievementPct: b.achievementPct, color: b.color,
  })))

  const insights = await generateInsights('admin_branches', {
    branches: branches.map((b, i) => ({
      name: b.name, revenue: Math.round(b.revenue),
      yoyRevenue: Math.round(yoyBranches[i].revenue),
      achievementPct: Math.round(b.achievementPct),
      wastePct: b.wastePct.toFixed(1), laborPct: b.laborPct.toFixed(1),
    })),
    bestBranch: best.name, worstBranch: worst.name,
  }, 3)

  const body = `
    <div style="text-align:center;margin-bottom:20px;">
      ${highlightBox('הסניף הטוב ביותר', `${best.name} — ${fmtCurrency(best.revenue)}`, '#10b981')}
      ${highlightBox('הסניף החלש ביותר', `${worst.name} — ${fmtCurrency(worst.revenue)}`, '#ef4444')}
    </div>
    ${sectionHeader('סיכום חודשי — כל הסניפים + השוואה שנתית')}
    ${table}
    ${sectionHeader('השוואת עמידה ביעד')}
    ${chartImg(comparisonChartUrl, 'גרף השוואת סניפים')}
    ${insightsBox(insights)}
  `

  const html = emailLayout(
    'סיכום חודשי — סניפים',
    body,
    `${monthName} ${prevMonthKey.slice(0, 4)}`,
  )

  const result = await sendEmail({
    to: user.email,
    subject: `📅 סיכום חודשי · סניפים · ${monthName} ${prevMonthKey.slice(0, 4)}`,
    html,
  })

  await logReport('monthly', user.email, user.role, prevMonthKey, result.success ? 'sent' : 'failed', result.error)
}
