import { type Recipient } from '../lib/recipients.ts'
import { type ReportSchedule } from '../lib/schedule.ts'
import {
  getFactoryProduction, getFactoryWaste, getFactoryLabor,
  nextDay, subtractDays, formatHebrewDate, formatShortDate,
  getMonthRange, DEPARTMENT_NAMES, logReport,
} from '../lib/db.ts'
import { factoryProductivityChart, factoryProductionChart, lineChart } from '../lib/charts.ts'
import { generateInsights } from '../lib/insights.ts'
import { sendEmail } from '../lib/email.ts'
import { emailLayout, sectionHeader, kpiRow, dataTable, chartImg, insightsBox, fmtCurrency, fmtPct, statusBadge } from '../lib/templates.ts'

const ALL_DEPTS = ['creams', 'dough', 'packaging']
const DEPT_COLORS: Record<string, string> = {
  creams: '#f59e0b', dough: '#3b82f6', packaging: '#10b981',
}

const HEBREW_MONTHS: Record<string, string> = {
  '01': 'ינואר', '02': 'פברואר', '03': 'מרץ', '04': 'אפריל',
  '05': 'מאי', '06': 'יוני', '07': 'יולי', '08': 'אוגוסט',
  '09': 'ספטמבר', '10': 'אוקטובר', '11': 'נובמבר', '12': 'דצמבר',
}

interface DeptSummary {
  dept: string; name: string; color: string
  production: number; waste: number; laborCost: number; laborHours: number
}

async function fetchAllDepts(from: string, to: string): Promise<DeptSummary[]> {
  const result: DeptSummary[] = []
  for (const dept of ALL_DEPTS) {
    const [prod, waste, labor] = await Promise.all([
      getFactoryProduction(dept, from, to),
      getFactoryWaste(dept, from, to),
      getFactoryLabor(dept, from, to),
    ])
    result.push({
      dept, name: DEPARTMENT_NAMES[dept] || dept, color: DEPT_COLORS[dept] || '#64748b',
      production: prod.reduce((s, r) => s + Number(r.amount), 0),
      waste: waste.reduce((s, r) => s + Number(r.amount), 0),
      laborCost: labor.reduce((s, r) => s + Number(r.employer_cost), 0),
      laborHours: labor.reduce((s, r) => s + Number(r.hours_100) + Number(r.hours_125) + Number(r.hours_150), 0),
    })
  }
  return result
}

// ── Daily ──
export async function sendAdminFactoryDailyReport(user: Recipient, schedule: ReportSchedule) {
  const { reportDate } = schedule
  const from = reportDate
  const to = nextDay(reportDate)
  const dateStr = formatHebrewDate(reportDate)

  const depts = await fetchAllDepts(from, to)
  const avg30From = subtractDays(reportDate, 30)
  const depts30 = await fetchAllDepts(avg30From, to)

  const totalProd = depts.reduce((s, d) => s + d.production, 0)
  const totalWaste = depts.reduce((s, d) => s + d.waste, 0)
  const totalLabor = depts.reduce((s, d) => s + d.laborCost, 0)
  const totalHours = depts.reduce((s, d) => s + d.laborHours, 0)
  const wastePct = totalProd > 0 ? (totalWaste / totalProd) * 100 : 0
  const productivity = totalHours > 0 ? totalProd / totalHours : 0

  const avgProd30 = depts30.reduce((s, d) => s + d.production, 0) / 30
  const avgHours30 = depts30.reduce((s, d) => s + d.laborHours, 0) / 30
  const avgProductivity30 = avgHours30 > 0 ? avgProd30 / avgHours30 : 0
  const avgLabor30 = depts30.reduce((s, d) => s + d.laborCost, 0) / 30
  const avgWastePct30 = avgProd30 > 0 ? (depts30.reduce((s, d) => s + d.waste, 0) / 30 / avgProd30) * 100 : 0

  // ── Weekly productivity chart ──
  const weekDays: Array<{ label: string; productivity: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = subtractDays(reportDate, i)
    const dayDepts = await fetchAllDepts(d, nextDay(d))
    const dayProd = dayDepts.reduce((s, dd) => s + dd.production, 0)
    const dayHours = dayDepts.reduce((s, dd) => s + dd.laborHours, 0)
    weekDays.push({ label: formatShortDate(d), productivity: dayHours > 0 ? Math.round(dayProd / dayHours) : 0 })
  }

  const productivityChartUrl = factoryProductivityChart(weekDays, Math.round(avgProductivity30))
  const prodChartData = depts.filter(d => d.production > 0).map(d => ({
    label: d.name, amount: Math.round(d.production), color: d.color,
  }))
  const productionChartUrl = factoryProductionChart(prodChartData)

  const table = dataTable(
    ['מחלקה', 'ייצור', 'פסולת', 'פסולת %', 'עלות עובדים', 'פריון (₪/ש׳)'],
    depts.map(d => {
      const wp = d.production > 0 ? (d.waste / d.production) * 100 : 0
      const pr = d.laborHours > 0 ? d.production / d.laborHours : 0
      return [
        `<strong style="color:${d.color};">${d.name}</strong>`,
        fmtCurrency(d.production), fmtCurrency(d.waste), fmtPct(wp),
        fmtCurrency(d.laborCost), fmtCurrency(pr),
      ]
    }),
  )

  const insights = await generateInsights('admin_factory', {
    totalProduction: Math.round(totalProd),
    wastePct: wastePct.toFixed(1),
    productivity: Math.round(productivity),
    laborCost: Math.round(totalLabor),
    departments: depts.map(d => ({
      name: d.name, production: Math.round(d.production),
      wastePct: d.production > 0 ? ((d.waste / d.production) * 100).toFixed(1) : '0',
    })),
  }, 3)

  const kpis = kpiRow([
    { label: 'ייצור כולל', value: fmtCurrency(totalProd), target: `ממוצע ${fmtCurrency(avgProd30)}`, isGood: totalProd >= avgProd30 * 0.9 },
    { label: 'פסולת %', value: fmtPct(wastePct), target: `ממוצע ${fmtPct(avgWastePct30)}`, isGood: wastePct <= avgWastePct30 },
    { label: 'פריון', value: `${fmtCurrency(productivity)}/ש׳`, target: `ממוצע ${fmtCurrency(avgProductivity30)}`, isGood: productivity >= avgProductivity30 },
    { label: 'עלות עובדים', value: fmtCurrency(totalLabor), target: `ממוצע ${fmtCurrency(avgLabor30)}`, isGood: totalLabor <= avgLabor30 * 1.1 },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('סיכום מפעל לפי מחלקות')}
    ${table}
    ${sectionHeader('ייצור לפי מחלקות — אתמול')}
    ${chartImg(productionChartUrl, 'גרף ייצור')}
    ${sectionHeader('פריון יומי — 7 ימים אחרונים')}
    ${chartImg(productivityChartUrl, 'גרף פריון')}
    ${insightsBox(insights)}
  `

  const html = emailLayout('דוח יומי — מפעל (אדמין)', body, dateStr)

  const result = await sendEmail({
    to: user.email,
    subject: `🏭 דוח יומי · מפעל · ${dateStr}`,
    html,
  })

  await logReport('daily', user.email, user.role, reportDate, result.success ? 'sent' : 'failed', result.error)
}

// ── Weekly ──
export async function sendAdminFactoryWeeklyReport(user: Recipient, schedule: ReportSchedule) {
  const { weekStart, weekEnd } = schedule
  const from = weekStart
  const to = nextDay(weekEnd)

  const depts = await fetchAllDepts(from, to)
  const avg30From = subtractDays(weekEnd, 30)
  const depts30 = await fetchAllDepts(avg30From, nextDay(weekEnd))

  const totalProd = depts.reduce((s, d) => s + d.production, 0)
  const totalWaste = depts.reduce((s, d) => s + d.waste, 0)
  const totalLabor = depts.reduce((s, d) => s + d.laborCost, 0)
  const totalHours = depts.reduce((s, d) => s + d.laborHours, 0)
  const wastePct = totalProd > 0 ? (totalWaste / totalProd) * 100 : 0
  const productivity = totalHours > 0 ? totalProd / totalHours : 0

  const weekDays: Array<{ label: string; productivity: number }> = []
  for (let i = 0; i < 6; i++) {
    const d = subtractDays(weekEnd, 5 - i)
    const dayDepts = await fetchAllDepts(d, nextDay(d))
    const dayProd = dayDepts.reduce((s, dd) => s + dd.production, 0)
    const dayHours = dayDepts.reduce((s, dd) => s + dd.laborHours, 0)
    weekDays.push({ label: formatShortDate(d), productivity: dayHours > 0 ? Math.round(dayProd / dayHours) : 0 })
  }

  const avgHours30 = depts30.reduce((s, d) => s + d.laborHours, 0) / 30
  const avgProd30 = depts30.reduce((s, d) => s + d.production, 0) / 30
  const avgProductivity30 = avgHours30 > 0 ? avgProd30 / avgHours30 : 0

  const productivityChartUrl = factoryProductivityChart(weekDays, Math.round(avgProductivity30))
  const prodChartData = depts.filter(d => d.production > 0).map(d => ({
    label: d.name, amount: Math.round(d.production), color: d.color,
  }))
  const productionChartUrl = factoryProductionChart(prodChartData)

  const table = dataTable(
    ['מחלקה', 'ייצור שבועי', 'פסולת', 'פסולת %', 'עלות עובדים', 'פריון'],
    depts.map(d => {
      const wp = d.production > 0 ? (d.waste / d.production) * 100 : 0
      const pr = d.laborHours > 0 ? d.production / d.laborHours : 0
      return [
        `<strong style="color:${d.color};">${d.name}</strong>`,
        fmtCurrency(d.production), fmtCurrency(d.waste), fmtPct(wp),
        fmtCurrency(d.laborCost), fmtCurrency(pr),
      ]
    }),
  )

  const insights = await generateInsights('admin_factory', {
    totalProduction: Math.round(totalProd), wastePct: wastePct.toFixed(1),
    productivity: Math.round(productivity), laborCost: Math.round(totalLabor),
    departments: depts.map(d => ({ name: d.name, production: Math.round(d.production) })),
  }, 3)

  const kpis = kpiRow([
    { label: 'ייצור שבועי', value: fmtCurrency(totalProd), target: `ממוצע ${fmtCurrency(avgProd30 * 6)}`, isGood: totalProd >= avgProd30 * 5 },
    { label: 'פסולת %', value: fmtPct(wastePct), target: '5%', isGood: wastePct <= 5 },
    { label: 'פריון', value: `${fmtCurrency(productivity)}/ש׳`, target: `ממוצע ${fmtCurrency(avgProductivity30)}`, isGood: productivity >= avgProductivity30 },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('סיכום שבועי — מפעל')}
    ${table}
    ${sectionHeader('ייצור לפי מחלקות')}
    ${chartImg(productionChartUrl, 'גרף ייצור')}
    ${sectionHeader('פריון יומי לאורך השבוע')}
    ${chartImg(productivityChartUrl, 'גרף פריון')}
    ${insightsBox(insights)}
  `

  const html = emailLayout(
    'סיכום שבועי — מפעל (אדמין)',
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

// ── Monthly ──
export async function sendAdminFactoryMonthlyReport(user: Recipient, schedule: ReportSchedule) {
  const { prevMonthKey, prevYearMonthKey } = schedule
  const monthName = HEBREW_MONTHS[prevMonthKey.slice(5)] || prevMonthKey
  const range = getMonthRange(prevMonthKey)
  const yoyRange = getMonthRange(prevYearMonthKey)

  const depts = await fetchAllDepts(range.from, range.to)
  const yoyDepts = await fetchAllDepts(yoyRange.from, yoyRange.to)

  const totalProd = depts.reduce((s, d) => s + d.production, 0)
  const totalWaste = depts.reduce((s, d) => s + d.waste, 0)
  const totalLabor = depts.reduce((s, d) => s + d.laborCost, 0)
  const totalHours = depts.reduce((s, d) => s + d.laborHours, 0)
  const wastePct = totalProd > 0 ? (totalWaste / totalProd) * 100 : 0
  const productivity = totalHours > 0 ? totalProd / totalHours : 0

  const yoyTotalProd = yoyDepts.reduce((s, d) => s + d.production, 0)
  const yoyTotalLabor = yoyDepts.reduce((s, d) => s + d.laborCost, 0)
  const prodDelta = yoyTotalProd > 0 ? ((totalProd - yoyTotalProd) / yoyTotalProd) * 100 : 0

  const table = dataTable(
    ['מחלקה', 'ייצור', 'שנה שעברה', 'שינוי', 'פסולת %', 'עלות עובדים'],
    depts.map((d, i) => {
      const yoy = yoyDepts[i]
      const delta = yoy.production > 0 ? ((d.production - yoy.production) / yoy.production) * 100 : 0
      const wp = d.production > 0 ? (d.waste / d.production) * 100 : 0
      return [
        `<strong style="color:${d.color};">${d.name}</strong>`,
        fmtCurrency(d.production), fmtCurrency(yoy.production),
        `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
        fmtPct(wp), fmtCurrency(d.laborCost),
      ]
    }),
  )

  const prodChartData = depts.filter(d => d.production > 0).map(d => ({
    label: d.name, amount: Math.round(d.production), color: d.color,
  }))
  const productionChartUrl = factoryProductionChart(prodChartData)

  const insights = await generateInsights('admin_factory', {
    totalProduction: Math.round(totalProd), wastePct: wastePct.toFixed(1),
    productivity: Math.round(productivity), laborCost: Math.round(totalLabor),
    yoyDelta: prodDelta.toFixed(1),
    departments: depts.map((d, i) => ({
      name: d.name, production: Math.round(d.production),
      yoyProduction: Math.round(yoyDepts[i].production),
    })),
  }, 3)

  const kpis = kpiRow([
    { label: 'ייצור חודשי', value: fmtCurrency(totalProd), target: fmtCurrency(yoyTotalProd), isGood: prodDelta >= 0 },
    { label: 'שינוי שנתי', value: `${prodDelta >= 0 ? '+' : ''}${prodDelta.toFixed(1)}%`, target: 'שנה שעברה', isGood: prodDelta >= 0 },
    { label: 'פסולת %', value: fmtPct(wastePct), target: '5%', isGood: wastePct <= 5 },
    { label: 'עלות עובדים', value: fmtCurrency(totalLabor), target: fmtCurrency(yoyTotalLabor), isGood: totalLabor <= yoyTotalLabor * 1.1 },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('השוואה לחודש המקביל בשנה שעברה')}
    ${table}
    ${sectionHeader('ייצור לפי מחלקות')}
    ${chartImg(productionChartUrl, 'גרף ייצור חודשי')}
    ${insightsBox(insights)}
  `

  const html = emailLayout(
    'סיכום חודשי — מפעל (אדמין)',
    body,
    `${monthName} ${prevMonthKey.slice(0, 4)}`,
  )

  const result = await sendEmail({
    to: user.email,
    subject: `📅 סיכום חודשי · מפעל · ${monthName} ${prevMonthKey.slice(0, 4)}`,
    html,
  })

  await logReport('monthly', user.email, user.role, prevMonthKey, result.success ? 'sent' : 'failed', result.error)
}
