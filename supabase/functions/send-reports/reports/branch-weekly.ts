import { type Recipient } from '../lib/recipients.ts'
import { type ReportSchedule } from '../lib/schedule.ts'
import {
  getBranchRevenue, getBranchLabor, getBranchWaste, getBranchKpiTargets,
  getBranchInternalPurchases, getBranchFactoryExpenses,
  getWorkingDaysCount, nextDay, formatHebrewDate, formatShortDate, subtractDays,
  BRANCH_NAMES, logReport,
} from '../lib/db.ts'
import { branchRevenueChart, branchWasteChart } from '../lib/charts.ts'
import { generateInsights } from '../lib/insights.ts'
import { sendEmail } from '../lib/email.ts'
import { emailLayout, sectionHeader, kpiRow, dataTable, chartImg, insightsBox, fmtCurrency, fmtPct } from '../lib/templates.ts'

export async function sendBranchWeeklyReport(user: Recipient, schedule: ReportSchedule) {
  const branchId = user.branch_id!
  const { weekStart, weekEnd, monthKey } = schedule
  const from = weekStart
  const to = nextDay(weekEnd)
  const branchName = BRANCH_NAMES[branchId] || `סניף ${branchId}`

  // Previous week for comparison
  const prevWeekStart = subtractDays(weekStart, 7)
  const prevWeekEnd = subtractDays(weekEnd, 7)
  const prevFrom = prevWeekStart
  const prevTo = nextDay(prevWeekEnd)

  // ── Fetch current + previous week data ──
  const [revData, laborData, wasteData, targets, workingDays,
    internalPurchases, factoryExpenses,
    prevRevData, prevLaborData, prevWasteData] = await Promise.all([
    getBranchRevenue(branchId, from, to),
    getBranchLabor(branchId, from, to),
    getBranchWaste(branchId, from, to),
    getBranchKpiTargets(branchId),
    getWorkingDaysCount(monthKey),
    getBranchInternalPurchases(branchId, from, to),
    getBranchFactoryExpenses(branchId, from, to),
    getBranchRevenue(branchId, prevFrom, prevTo),
    getBranchLabor(branchId, prevFrom, prevTo),
    getBranchWaste(branchId, prevFrom, prevTo),
  ])

  // ── Current week KPIs ──
  const totalRevenue = revData.reduce((s, r) => s + Number(r.amount), 0)
  const cashierRevenue = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + Number(r.amount), 0)
  const transactions = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + (Number(r.transaction_count) || 0), 0)
  const avgBasket = transactions > 0 ? cashierRevenue / transactions : 0

  const laborCost = laborData.reduce((s, r) => s + Number(r.employer_cost), 0)
  const laborPct = totalRevenue > 0 ? (laborCost / totalRevenue) * 100 : 0

  const wasteTotal = wasteData.reduce((s, r) => s + Number(r.amount), 0)
  const wastePct = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0

  const factoryPurchases = factoryExpenses.reduce((s: number, r: any) => s + Number(r.amount), 0)
  const internalTotal = internalPurchases.reduce((s: number, r: any) => s + Number(r.total_amount), 0)

  // Previous week
  const prevRevenue = prevRevData.reduce((s, r) => s + Number(r.amount), 0)
  const prevLabor = prevLaborData.reduce((s, r) => s + Number(r.employer_cost), 0)
  const prevWaste = prevWasteData.reduce((s, r) => s + Number(r.amount), 0)

  // Weekly target
  const dailyTarget = workingDays > 0 ? (targets.revenue_target || 0) / workingDays : 0
  const weeklyTarget = dailyTarget * 6
  const achievementPct = weeklyTarget > 0 ? (totalRevenue / weeklyTarget) * 100 : 0

  // ── Daily breakdown for charts ──
  const chartDays: Array<{ label: string; revenue: number; target: number }> = []
  const wasteDays: Array<{ label: string; waste: number }> = []

  for (let i = 0; i < 6; i++) {
    const d = subtractDays(weekEnd, 5 - i)
    const label = formatShortDate(d)
    const dayRev = revData.filter(r => r.date === d).reduce((s, r) => s + Number(r.amount), 0)
    const dayWaste = wasteData.filter(r => r.date === d).reduce((s, r) => s + Number(r.amount), 0)
    chartDays.push({ label, revenue: Math.round(dayRev), target: Math.round(dailyTarget) })
    wasteDays.push({ label, waste: Math.round(dayWaste) })
  }

  const revenueChartUrl = branchRevenueChart(chartDays)
  const wasteChartUrl = branchWasteChart(wasteDays)

  // ── KPI comparison table ──
  const changeArrow = (cur: number, prev: number, inverse = false) => {
    if (prev === 0) return ''
    const pct = ((cur - prev) / prev * 100)
    const isGood = inverse ? pct < 0 : pct > 0
    return `<span style="color:${isGood ? '#16a34a' : '#dc2626'};font-weight:700">${pct > 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%</span>`
  }

  const comparisonTable = dataTable(
    ['מדד', 'השבוע', 'שבוע שעבר', 'שינוי'],
    [
      ['הכנסות', fmtCurrency(totalRevenue), fmtCurrency(prevRevenue), changeArrow(totalRevenue, prevRevenue)],
      ['עלות עובדים', fmtCurrency(laborCost), fmtCurrency(prevLabor), changeArrow(laborCost, prevLabor, true)],
      ['פחת', fmtCurrency(wasteTotal), fmtCurrency(prevWaste), changeArrow(wasteTotal, prevWaste, true)],
      ['קניות מהמפעל', fmtCurrency(factoryPurchases || internalTotal), '—', ''],
    ],
  )

  // ── AI Insights ──
  const insights = await generateInsights('branch', {
    revenue: Math.round(totalRevenue),
    revenueTarget: Math.round(weeklyTarget),
    achievementPct: Math.round(achievementPct),
    laborPct: laborPct.toFixed(1),
    laborTarget: targets.labor_pct,
    wastePct: wastePct.toFixed(1),
    wasteTarget: targets.waste_pct,
    avgBasket: Math.round(avgBasket),
    basketTarget: targets.basket_target || 0,
    transactions,
    transactionTarget: (targets.transaction_target || 0) * 6,
    dailyRevenue: chartDays.map(d => d.revenue),
    prevWeekRevenue: Math.round(prevRevenue),
    factoryPurchases: Math.round(factoryPurchases || internalTotal),
  }, 3)

  // ── Build HTML ──
  const kpis = kpiRow([
    { label: 'הכנסות שבועיות', value: fmtCurrency(totalRevenue), target: fmtCurrency(weeklyTarget), isGood: achievementPct >= 90 },
    { label: 'פחת %', value: fmtPct(wastePct), target: fmtPct(targets.waste_pct), isGood: wastePct <= targets.waste_pct },
    { label: 'לייבור %', value: fmtPct(laborPct), target: fmtPct(targets.labor_pct), isGood: laborPct <= targets.labor_pct },
    { label: 'סל ממוצע', value: fmtCurrency(avgBasket), target: fmtCurrency(targets.basket_target || 0), isGood: avgBasket >= (targets.basket_target || 0) },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('השוואה לשבוע קודם')}
    ${comparisonTable}
    ${sectionHeader('הכנסות יומיות לאורך השבוע')}
    ${chartImg(revenueChartUrl, 'גרף הכנסות שבועי')}
    ${sectionHeader('פחת יומי לאורך השבוע')}
    ${chartImg(wasteChartUrl, 'גרף פחת שבועי')}
    ${insightsBox(insights)}
  `

  const html = emailLayout(
    `סיכום שבועי — סניף ${branchName}`,
    body,
    `${formatHebrewDate(weekStart)} — ${formatHebrewDate(weekEnd)}`,
  )

  const result = await sendEmail({
    to: user.email,
    subject: `📈 סיכום שבועי · סניף ${branchName}`,
    html,
  })

  await logReport('weekly', user.email, user.role, weekStart, result.success ? 'sent' : 'failed', result.error)
}
