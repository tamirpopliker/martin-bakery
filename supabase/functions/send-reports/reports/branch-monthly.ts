import { type Recipient } from '../lib/recipients.ts'
import { type ReportSchedule } from '../lib/schedule.ts'
import {
  getBranchRevenue, getBranchLabor, getBranchWaste, getBranchKpiTargets,
  getMonthRange, formatHebrewDate, BRANCH_NAMES, logReport,
} from '../lib/db.ts'
import { barChart, lineChart } from '../lib/charts.ts'
import { generateInsights } from '../lib/insights.ts'
import { sendEmail } from '../lib/email.ts'
import { emailLayout, sectionHeader, kpiRow, dataTable, chartImg, insightsBox, fmtCurrency, fmtPct, statusBadge } from '../lib/templates.ts'

const HEBREW_MONTHS: Record<string, string> = {
  '01': 'ינואר', '02': 'פברואר', '03': 'מרץ', '04': 'אפריל',
  '05': 'מאי', '06': 'יוני', '07': 'יולי', '08': 'אוגוסט',
  '09': 'ספטמבר', '10': 'אוקטובר', '11': 'נובמבר', '12': 'דצמבר',
}

export async function sendBranchMonthlyReport(user: Recipient, schedule: ReportSchedule) {
  const branchId = user.branch_id!
  const { prevMonthKey, prevYearMonthKey } = schedule
  const branchName = BRANCH_NAMES[branchId] || `סניף ${branchId}`
  const monthName = HEBREW_MONTHS[prevMonthKey.slice(5)] || prevMonthKey

  const range = getMonthRange(prevMonthKey)
  const yoyRange = getMonthRange(prevYearMonthKey)

  // ── Fetch current month + same month last year ──
  const [revData, laborData, wasteData, targets,
         yoyRevData, yoyLaborData, yoyWasteData] = await Promise.all([
    getBranchRevenue(branchId, range.from, range.to),
    getBranchLabor(branchId, range.from, range.to),
    getBranchWaste(branchId, range.from, range.to),
    getBranchKpiTargets(branchId),
    getBranchRevenue(branchId, yoyRange.from, yoyRange.to),
    getBranchLabor(branchId, yoyRange.from, yoyRange.to),
    getBranchWaste(branchId, yoyRange.from, yoyRange.to),
  ])

  // ── Current month KPIs ──
  const totalRevenue = revData.reduce((s, r) => s + Number(r.amount), 0)
  const cashierRevenue = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + Number(r.amount), 0)
  const transactions = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + (Number(r.transaction_count) || 0), 0)
  const avgBasket = transactions > 0 ? cashierRevenue / transactions : 0
  const laborCost = laborData.reduce((s, r) => s + Number(r.employer_cost), 0)
  const laborPct = totalRevenue > 0 ? (laborCost / totalRevenue) * 100 : 0
  const wasteTotal = wasteData.reduce((s, r) => s + Number(r.amount), 0)
  const wastePct = totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0
  const achievementPct = (targets.revenue_target || 0) > 0 ? (totalRevenue / targets.revenue_target) * 100 : 0

  // ── YoY KPIs ──
  const yoyRevenue = yoyRevData.reduce((s, r) => s + Number(r.amount), 0)
  const yoyLaborCost = yoyLaborData.reduce((s, r) => s + Number(r.employer_cost), 0)
  const yoyWasteTotal = yoyWasteData.reduce((s, r) => s + Number(r.amount), 0)
  const yoyLaborPct = yoyRevenue > 0 ? (yoyLaborCost / yoyRevenue) * 100 : 0
  const yoyWastePct = yoyRevenue > 0 ? (yoyWasteTotal / yoyRevenue) * 100 : 0
  const revDelta = yoyRevenue > 0 ? ((totalRevenue - yoyRevenue) / yoyRevenue) * 100 : 0

  // ── Comparison table ──
  const comparisonTable = dataTable(
    ['מדד', `${monthName} ${prevMonthKey.slice(0, 4)}`, `${monthName} ${prevYearMonthKey.slice(0, 4)}`, 'שינוי'],
    [
      ['הכנסות', fmtCurrency(totalRevenue), fmtCurrency(yoyRevenue), `${revDelta >= 0 ? '+' : ''}${revDelta.toFixed(1)}%`],
      ['לייבור %', fmtPct(laborPct), fmtPct(yoyLaborPct), statusBadge(laborPct <= yoyLaborPct)],
      ['פחת %', fmtPct(wastePct), fmtPct(yoyWastePct), statusBadge(wastePct <= yoyWastePct)],
      ['סל ממוצע', fmtCurrency(avgBasket), '—', '—'],
      ['עסקאות', String(transactions), '—', '—'],
    ]
  )

  // ── Monthly revenue by week chart ──
  // Group revenue by week of month
  const weeks: Record<string, number> = {}
  for (const r of revData) {
    const weekNum = Math.ceil(new Date(r.date + 'T00:00:00').getDate() / 7)
    const key = `שבוע ${weekNum}`
    weeks[key] = (weeks[key] || 0) + Number(r.amount)
  }
  const weekLabels = Object.keys(weeks).sort()
  const weeklyRevenueChart = barChart(
    weekLabels,
    [{ label: 'הכנסות שבועיות', data: weekLabels.map(w => Math.round(weeks[w])), backgroundColor: '#3b82f6' }],
  )

  // ── AI Insights ──
  const insights = await generateInsights('branch', {
    revenue: Math.round(totalRevenue),
    revenueTarget: Math.round(targets.revenue_target || 0),
    achievementPct: Math.round(achievementPct),
    laborPct: laborPct.toFixed(1),
    laborTarget: targets.labor_pct,
    wastePct: wastePct.toFixed(1),
    wasteTarget: targets.waste_pct,
    avgBasket: Math.round(avgBasket),
    basketTarget: targets.basket_target || 0,
    transactions,
    transactionTarget: targets.transaction_target || 0,
    yoyRevenueDelta: revDelta.toFixed(1),
    dailyRevenue: weekLabels.map(w => weeks[w]),
  }, 3)

  // ── Build HTML ──
  const kpis = kpiRow([
    { label: 'הכנסות חודשיות', value: fmtCurrency(totalRevenue), target: fmtCurrency(targets.revenue_target || 0), isGood: achievementPct >= 90 },
    { label: 'עמידה ביעד', value: `${Math.round(achievementPct)}%`, target: '100%', isGood: achievementPct >= 90 },
    { label: 'פחת %', value: fmtPct(wastePct), target: fmtPct(targets.waste_pct), isGood: wastePct <= targets.waste_pct },
    { label: 'לייבור %', value: fmtPct(laborPct), target: fmtPct(targets.labor_pct), isGood: laborPct <= targets.labor_pct },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('השוואה לחודש המקביל בשנה שעברה')}
    ${comparisonTable}
    ${sectionHeader('הכנסות לפי שבועות')}
    ${chartImg(weeklyRevenueChart, 'גרף הכנסות חודשי')}
    ${insightsBox(insights)}
  `

  const html = emailLayout(
    `סיכום חודשי — סניף ${branchName}`,
    body,
    `${monthName} ${prevMonthKey.slice(0, 4)}`,
  )

  const result = await sendEmail({
    to: user.email,
    subject: `📅 סיכום חודשי · סניף ${branchName} · ${monthName} ${prevMonthKey.slice(0, 4)}`,
    html,
  })

  await logReport('monthly', user.email, user.role, prevMonthKey, result.success ? 'sent' : 'failed', result.error)
}
