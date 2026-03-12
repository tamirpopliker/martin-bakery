import { type Recipient } from '../lib/recipients.ts'
import { getAccessibleDepartments } from '../lib/recipients.ts'
import { type ReportSchedule } from '../lib/schedule.ts'
import {
  getFactoryProduction, getFactoryWaste, getFactoryLabor,
  nextDay, subtractDays, formatHebrewDate, formatShortDate,
  DEPARTMENT_NAMES, logReport,
} from '../lib/db.ts'
import { factoryProductivityChart, factoryProductionChart } from '../lib/charts.ts'
import { generateInsights } from '../lib/insights.ts'
import { sendEmail } from '../lib/email.ts'
import { emailLayout, sectionHeader, kpiRow, dataTable, chartImg, insightsBox, fmtCurrency, fmtPct } from '../lib/templates.ts'

const DEPT_COLORS: Record<string, string> = {
  creams: '#f59e0b', dough: '#3b82f6', packaging: '#10b981', cleaning: '#a855f7',
}

export async function sendFactoryDailyReport(user: Recipient, schedule: ReportSchedule) {
  const departments = getAccessibleDepartments(user)
  const { reportDate } = schedule
  const from = reportDate
  const to = nextDay(reportDate)
  const dateStr = formatHebrewDate(reportDate)

  // 30-day range for averages
  const avg30From = subtractDays(reportDate, 30)

  // ── Fetch data per department ──
  const deptData: Array<{
    dept: string; name: string
    production: number; waste: number; laborCost: number; laborHours: number
    prod30: number; waste30: number; labor30: number; hours30: number
  }> = []

  for (const dept of departments) {
    const [prodDay, wasteDay, laborDay, prod30, waste30, labor30] = await Promise.all([
      getFactoryProduction(dept, from, to),
      getFactoryWaste(dept, from, to),
      getFactoryLabor(dept, from, to),
      getFactoryProduction(dept, avg30From, to),
      getFactoryWaste(dept, avg30From, to),
      getFactoryLabor(dept, avg30From, to),
    ])

    const production = prodDay.reduce((s, r) => s + Number(r.amount), 0)
    const waste = wasteDay.reduce((s, r) => s + Number(r.amount), 0)
    const laborCost = laborDay.reduce((s, r) => s + Number(r.employer_cost), 0)
    const laborHours = laborDay.reduce((s, r) => s + Number(r.hours_100) + Number(r.hours_125) + Number(r.hours_150), 0)

    const prod30Total = prod30.reduce((s, r) => s + Number(r.amount), 0)
    const waste30Total = waste30.reduce((s, r) => s + Number(r.amount), 0)
    const labor30Total = labor30.reduce((s, r) => s + Number(r.employer_cost), 0)
    const hours30Total = labor30.reduce((s, r) => s + Number(r.hours_100) + Number(r.hours_125) + Number(r.hours_150), 0)

    deptData.push({
      dept, name: DEPARTMENT_NAMES[dept] || dept,
      production, waste, laborCost, laborHours,
      prod30: prod30Total / 30, waste30: waste30Total / 30,
      labor30: labor30Total / 30, hours30: hours30Total / 30,
    })
  }

  // ── Totals ──
  const totalProduction = deptData.reduce((s, d) => s + d.production, 0)
  const totalWaste = deptData.reduce((s, d) => s + d.waste, 0)
  const totalLaborCost = deptData.reduce((s, d) => s + d.laborCost, 0)
  const totalHours = deptData.reduce((s, d) => s + d.laborHours, 0)
  const wastePct = totalProduction > 0 ? (totalWaste / totalProduction) * 100 : 0
  const productivity = totalHours > 0 ? totalProduction / totalHours : 0

  const avgWaste30 = deptData.reduce((s, d) => s + d.waste30, 0)
  const avgProd30 = deptData.reduce((s, d) => s + d.prod30, 0)
  const avgHours30 = deptData.reduce((s, d) => s + d.hours30, 0)
  const avgWastePct30 = avgProd30 > 0 ? (avgWaste30 / avgProd30) * 100 : 0
  const avgProductivity30 = avgHours30 > 0 ? avgProd30 / avgHours30 : 0
  const avgLaborCost30 = deptData.reduce((s, d) => s + d.labor30, 0)

  // ── Weekly productivity chart ──
  const weekDays: Array<{ label: string; productivity: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = subtractDays(reportDate, i)
    const label = formatShortDate(d)
    let dayProd = 0, dayHours = 0
    for (const dept of departments) {
      const [prod, labor] = await Promise.all([
        getFactoryProduction(dept, d, nextDay(d)),
        getFactoryLabor(dept, d, nextDay(d)),
      ])
      dayProd += prod.reduce((s, r) => s + Number(r.amount), 0)
      dayHours += labor.reduce((s, r) => s + Number(r.hours_100) + Number(r.hours_125) + Number(r.hours_150), 0)
    }
    weekDays.push({ label, productivity: dayHours > 0 ? Math.round(dayProd / dayHours) : 0 })
  }

  const productivityChartUrl = factoryProductivityChart(weekDays, Math.round(avgProductivity30))

  // ── Production by product chart ──
  const prodChartData = deptData
    .filter(d => d.production > 0)
    .map(d => ({ label: d.name, amount: Math.round(d.production), color: DEPT_COLORS[d.dept] || '#64748b' }))
  const productionChartUrl = factoryProductionChart(prodChartData)

  // ── Production table ──
  const prodTable = dataTable(
    ['מחלקה', 'ייצור', 'פסולת', 'פסולת %', 'עלות עובדים', 'פריון (₪/ש׳)'],
    deptData.map(d => {
      const wp = d.production > 0 ? (d.waste / d.production) * 100 : 0
      const pr = d.laborHours > 0 ? d.production / d.laborHours : 0
      return [
        `<strong>${d.name}</strong>`,
        fmtCurrency(d.production),
        fmtCurrency(d.waste),
        fmtPct(wp),
        fmtCurrency(d.laborCost),
        fmtCurrency(pr),
      ]
    }),
  )

  // ── AI Insights ──
  const insights = await generateInsights('factory', {
    production: Math.round(totalProduction),
    wastePct: wastePct.toFixed(1),
    wasteAvg30: avgWastePct30.toFixed(1),
    productivityPerHour: Math.round(productivity),
    prodAvg30: Math.round(avgProductivity30),
    laborCost: Math.round(totalLaborCost),
    laborAvg30: Math.round(avgLaborCost30),
  }, 2)

  // ── Build HTML ──
  const kpis = kpiRow([
    { label: 'ייצור כולל', value: fmtCurrency(totalProduction), target: fmtCurrency(avgProd30), isGood: totalProduction >= avgProd30 },
    { label: 'פסולת %', value: fmtPct(wastePct), target: `ממוצע ${fmtPct(avgWastePct30)}`, isGood: wastePct <= avgWastePct30 },
    { label: 'פריון (₪/ש׳)', value: fmtCurrency(productivity), target: `ממוצע ${fmtCurrency(avgProductivity30)}`, isGood: productivity >= avgProductivity30 },
    { label: 'עלות עובדים', value: fmtCurrency(totalLaborCost), target: `ממוצע ${fmtCurrency(avgLaborCost30)}`, isGood: totalLaborCost <= avgLaborCost30 * 1.1 },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('ייצור לפי מחלקות')}
    ${prodTable}
    ${sectionHeader('ייצור לפי מוצרים — אתמול')}
    ${chartImg(productionChartUrl, 'גרף ייצור')}
    ${sectionHeader('פריון יומי לאורך השבוע')}
    ${chartImg(productivityChartUrl, 'גרף פריון')}
    ${insightsBox(insights)}
  `

  const html = emailLayout('דוח יומי — מפעל', body, dateStr)

  const result = await sendEmail({
    to: user.email,
    subject: `🏭 דוח יומי · מפעל · ${dateStr}`,
    html,
  })

  await logReport('daily', user.email, user.role, reportDate, result.success ? 'sent' : 'failed', result.error)
}
