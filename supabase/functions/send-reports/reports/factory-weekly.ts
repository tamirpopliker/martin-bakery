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

export async function sendFactoryWeeklyReport(user: Recipient, schedule: ReportSchedule) {
  const departments = getAccessibleDepartments(user)
  const { weekStart, weekEnd } = schedule
  const from = weekStart
  const to = nextDay(weekEnd)

  // 30-day range for averages (from week end)
  const avg30From = subtractDays(weekEnd, 30)

  // ── Fetch data per department ──
  const deptData: Array<{
    dept: string; name: string
    production: number; waste: number; laborCost: number; laborHours: number
    prod30Avg: number; waste30Avg: number; labor30Avg: number; hours30Avg: number
  }> = []

  for (const dept of departments) {
    const [prodWeek, wasteWeek, laborWeek, prod30, waste30, labor30] = await Promise.all([
      getFactoryProduction(dept, from, to),
      getFactoryWaste(dept, from, to),
      getFactoryLabor(dept, from, to),
      getFactoryProduction(dept, avg30From, nextDay(weekEnd)),
      getFactoryWaste(dept, avg30From, nextDay(weekEnd)),
      getFactoryLabor(dept, avg30From, nextDay(weekEnd)),
    ])

    deptData.push({
      dept, name: DEPARTMENT_NAMES[dept] || dept,
      production: prodWeek.reduce((s, r) => s + Number(r.amount), 0),
      waste: wasteWeek.reduce((s, r) => s + Number(r.amount), 0),
      laborCost: laborWeek.reduce((s, r) => s + Number(r.employer_cost), 0),
      laborHours: laborWeek.reduce((s, r) => s + Number(r.hours_100) + Number(r.hours_125) + Number(r.hours_150), 0),
      prod30Avg: prod30.reduce((s, r) => s + Number(r.amount), 0) / 30,
      waste30Avg: waste30.reduce((s, r) => s + Number(r.amount), 0) / 30,
      labor30Avg: labor30.reduce((s, r) => s + Number(r.employer_cost), 0) / 30,
      hours30Avg: labor30.reduce((s, r) => s + Number(r.hours_100) + Number(r.hours_125) + Number(r.hours_150), 0) / 30,
    })
  }

  // ── Totals ──
  const totalProduction = deptData.reduce((s, d) => s + d.production, 0)
  const totalWaste = deptData.reduce((s, d) => s + d.waste, 0)
  const totalLaborCost = deptData.reduce((s, d) => s + d.laborCost, 0)
  const totalHours = deptData.reduce((s, d) => s + d.laborHours, 0)
  const wastePct = totalProduction > 0 ? (totalWaste / totalProduction) * 100 : 0
  const productivity = totalHours > 0 ? totalProduction / totalHours : 0

  const avgProd30Daily = deptData.reduce((s, d) => s + d.prod30Avg, 0)
  const avgHours30Daily = deptData.reduce((s, d) => s + d.hours30Avg, 0)
  const avgProductivity30 = avgHours30Daily > 0 ? avgProd30Daily / avgHours30Daily : 0

  // ── Daily productivity chart ──
  const weekDays: Array<{ label: string; productivity: number }> = []
  for (let i = 0; i < 6; i++) {
    const d = subtractDays(weekEnd, 5 - i)
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

  // ── Table ──
  const prodTable = dataTable(
    ['מחלקה', 'ייצור שבועי', 'פסולת', 'פסולת %', 'עלות עובדים', 'פריון'],
    deptData.map(d => {
      const wp = d.production > 0 ? (d.waste / d.production) * 100 : 0
      const pr = d.laborHours > 0 ? d.production / d.laborHours : 0
      return [
        `<strong>${d.name}</strong>`, fmtCurrency(d.production), fmtCurrency(d.waste),
        fmtPct(wp), fmtCurrency(d.laborCost), fmtCurrency(pr),
      ]
    }),
  )

  // ── AI ──
  const insights = await generateInsights('factory', {
    production: Math.round(totalProduction),
    wastePct: wastePct.toFixed(1),
    wasteAvg30: (totalProduction > 0 ? (deptData.reduce((s, d) => s + d.waste30Avg, 0) * 6 / totalProduction) * 100 : 0).toFixed(1),
    productivityPerHour: Math.round(productivity),
    prodAvg30: Math.round(avgProductivity30),
    laborCost: Math.round(totalLaborCost),
    laborAvg30: Math.round(deptData.reduce((s, d) => s + d.labor30Avg, 0) * 6),
  }, 3)

  // ── Build HTML ──
  const kpis = kpiRow([
    { label: 'ייצור שבועי', value: fmtCurrency(totalProduction), target: `ממוצע ${fmtCurrency(avgProd30Daily * 6)}`, isGood: totalProduction >= avgProd30Daily * 5 },
    { label: 'פסולת %', value: fmtPct(wastePct), target: 'ממוצע 30 יום', isGood: wastePct <= 5 },
    { label: 'פריון', value: `${fmtCurrency(productivity)}/ש׳`, target: `ממוצע ${fmtCurrency(avgProductivity30)}`, isGood: productivity >= avgProductivity30 },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('ייצור לפי מחלקות — שבועי')}
    ${prodTable}
    ${sectionHeader('ייצור לפי מוצרים')}
    ${chartImg(productionChartUrl, 'גרף ייצור שבועי')}
    ${sectionHeader('פריון יומי לאורך השבוע')}
    ${chartImg(productivityChartUrl, 'גרף פריון')}
    ${insightsBox(insights)}
  `

  const html = emailLayout(
    'סיכום שבועי — מפעל',
    body,
    `${formatHebrewDate(weekStart)} — ${formatHebrewDate(weekEnd)}`,
  )

  const result = await sendEmail({
    to: user.email,
    subject: `📈 סיכום שבועי · מפעל`,
    html,
  })

  await logReport('weekly', user.email, user.role, weekStart, result.success ? 'sent' : 'failed', result.error)
}
