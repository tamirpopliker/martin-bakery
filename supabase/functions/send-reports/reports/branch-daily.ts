import { type Recipient } from '../lib/recipients.ts'
import { type ReportSchedule } from '../lib/schedule.ts'
import {
  getBranchRevenue, getBranchLabor, getBranchWaste, getBranchKpiTargets,
  getWorkingDaysCount, nextDay, subtractDays, formatHebrewDate, formatShortDate,
  BRANCH_NAMES, logReport,
} from '../lib/db.ts'
import { branchRevenueChart, branchWasteChart } from '../lib/charts.ts'
import { generateInsights } from '../lib/insights.ts'
import { sendEmail } from '../lib/email.ts'
import { emailLayout, sectionHeader, kpiRow, chartImg, insightsBox, fmtCurrency, fmtPct } from '../lib/templates.ts'

export async function sendBranchDailyReport(user: Recipient, schedule: ReportSchedule) {
  const branchId = user.branch_id!
  const { reportDate, monthKey } = schedule
  const from = reportDate
  const to = nextDay(reportDate)
  const branchName = BRANCH_NAMES[branchId] || `סניף ${branchId}`

  // ── Fetch data ──
  const [revData, laborData, wasteData, targets, workingDays] = await Promise.all([
    getBranchRevenue(branchId, from, to),
    getBranchLabor(branchId, from, to),
    getBranchWaste(branchId, from, to),
    getBranchKpiTargets(branchId),
    getWorkingDaysCount(monthKey),
  ])

  // ── Calculate KPIs ──
  const totalRevenue = revData.reduce((s, r) => s + Number(r.amount), 0)
  const cashierRevenue = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + Number(r.amount), 0)
  const transactions = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + (Number(r.transaction_count) || 0), 0)
  const avgBasket = transactions > 0 ? cashierRevenue / transactions : 0

  const laborCost = laborData.reduce((s, r) => s + Number(r.employer_cost), 0)
  const laborPct = totalRevenue > 0 ? (laborCost / totalRevenue) * 100 : 0

  const wasteTotal = wasteData.reduce((s, r) => s + Number(r.amount), 0)
  const wastePct = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0

  const dailyTarget = workingDays > 0 ? (targets.revenue_target || 0) / workingDays : 0
  const achievementPct = dailyTarget > 0 ? (totalRevenue / dailyTarget) * 100 : 0

  // ── Last 7 days for charts ──
  const sevenDaysAgo = subtractDays(reportDate, 6)
  const [last7Rev, last7Waste] = await Promise.all([
    getBranchRevenue(branchId, sevenDaysAgo, to),
    getBranchWaste(branchId, sevenDaysAgo, to),
  ])

  // Group by date
  const chartDays: Array<{ label: string; date: string; revenue: number; target: number }> = []
  const wasteDays: Array<{ label: string; waste: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = subtractDays(reportDate, i)
    const label = formatShortDate(d)
    const dayRev = last7Rev.filter(r => r.date === d).reduce((s, r) => s + Number(r.amount), 0)
    const dayWaste = last7Waste.filter(r => r.date === d).reduce((s, r) => s + Number(r.amount), 0)
    chartDays.push({ label, date: d, revenue: Math.round(dayRev), target: Math.round(dailyTarget) })
    wasteDays.push({ label, waste: Math.round(dayWaste) })
  }

  // ── Charts ──
  const revenueChartUrl = branchRevenueChart(chartDays)
  const wasteChartUrl = branchWasteChart(wasteDays)

  // ── AI Insights ──
  const insights = await generateInsights('branch', {
    revenue: Math.round(totalRevenue),
    revenueTarget: Math.round(dailyTarget),
    achievementPct: Math.round(achievementPct),
    laborPct: laborPct.toFixed(1),
    laborTarget: targets.labor_pct,
    wastePct: wastePct.toFixed(1),
    wasteTarget: targets.waste_pct,
    avgBasket: Math.round(avgBasket),
    basketTarget: targets.basket_target || 0,
    transactions,
    transactionTarget: targets.transaction_target || 0,
    dailyRevenue: chartDays.map(d => d.revenue),
  }, 2)

  // ── Build HTML ──
  const kpis = kpiRow([
    { label: 'הכנסות', value: fmtCurrency(totalRevenue), target: fmtCurrency(dailyTarget), isGood: achievementPct >= 90 },
    { label: 'פחת %', value: fmtPct(wastePct), target: fmtPct(targets.waste_pct), isGood: wastePct <= targets.waste_pct },
    { label: 'לייבור %', value: fmtPct(laborPct), target: fmtPct(targets.labor_pct), isGood: laborPct <= targets.labor_pct },
    { label: 'סל ממוצע', value: fmtCurrency(avgBasket), target: fmtCurrency(targets.basket_target || 0), isGood: avgBasket >= (targets.basket_target || 0) },
    { label: 'עסקאות', value: String(transactions), target: String(targets.transaction_target || 0), isGood: transactions >= (targets.transaction_target || 0) },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('הכנסות 7 ימים אחרונים vs יעד יומי')}
    ${chartImg(revenueChartUrl, 'גרף הכנסות')}
    ${sectionHeader('פחת יומי לאורך השבוע')}
    ${chartImg(wasteChartUrl, 'גרף פחת')}
    ${insightsBox(insights)}
  `

  const dateStr = formatHebrewDate(reportDate)
  const html = emailLayout(
    `דוח יומי — סניף ${branchName}`,
    body,
    dateStr,
  )

  // ── Send ──
  const result = await sendEmail({
    to: user.email,
    subject: `📊 דוח יומי · סניף ${branchName} · ${dateStr}`,
    html,
  })

  await logReport('daily', user.email, user.role, reportDate, result.success ? 'sent' : 'failed', result.error)
}
