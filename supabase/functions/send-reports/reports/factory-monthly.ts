import { type Recipient } from '../lib/recipients.ts'
import { getAccessibleDepartments } from '../lib/recipients.ts'
import { type ReportSchedule } from '../lib/schedule.ts'
import {
  getFactoryProduction, getFactoryWaste, getFactoryLabor,
  getMonthRange, DEPARTMENT_NAMES, logReport,
} from '../lib/db.ts'
import { factoryProductionChart, lineChart } from '../lib/charts.ts'
import { generateInsights } from '../lib/insights.ts'
import { sendEmail } from '../lib/email.ts'
import { emailLayout, sectionHeader, kpiRow, dataTable, chartImg, insightsBox, fmtCurrency, fmtPct, statusBadge } from '../lib/templates.ts'

const DEPT_COLORS: Record<string, string> = {
  creams: '#f59e0b', dough: '#3b82f6', packaging: '#10b981', cleaning: '#a855f7',
}

const HEBREW_MONTHS: Record<string, string> = {
  '01': 'ינואר', '02': 'פברואר', '03': 'מרץ', '04': 'אפריל',
  '05': 'מאי', '06': 'יוני', '07': 'יולי', '08': 'אוגוסט',
  '09': 'ספטמבר', '10': 'אוקטובר', '11': 'נובמבר', '12': 'דצמבר',
}

export async function sendFactoryMonthlyReport(user: Recipient, schedule: ReportSchedule) {
  const departments = getAccessibleDepartments(user)
  const { prevMonthKey, prevYearMonthKey } = schedule
  const monthName = HEBREW_MONTHS[prevMonthKey.slice(5)] || prevMonthKey
  const range = getMonthRange(prevMonthKey)
  const yoyRange = getMonthRange(prevYearMonthKey)

  // ── Fetch current month + YoY per department ──
  const deptData: Array<{
    dept: string; name: string; color: string
    production: number; waste: number; laborCost: number; laborHours: number
    yoyProduction: number; yoyWaste: number; yoyLaborCost: number
  }> = []

  for (const dept of departments) {
    const [prod, waste, labor, yoyProd, yoyWaste, yoyLabor] = await Promise.all([
      getFactoryProduction(dept, range.from, range.to),
      getFactoryWaste(dept, range.from, range.to),
      getFactoryLabor(dept, range.from, range.to),
      getFactoryProduction(dept, yoyRange.from, yoyRange.to),
      getFactoryWaste(dept, yoyRange.from, yoyRange.to),
      getFactoryLabor(dept, yoyRange.from, yoyRange.to),
    ])

    deptData.push({
      dept, name: DEPARTMENT_NAMES[dept] || dept, color: DEPT_COLORS[dept] || '#64748b',
      production: prod.reduce((s, r) => s + Number(r.amount), 0),
      waste: waste.reduce((s, r) => s + Number(r.amount), 0),
      laborCost: labor.reduce((s, r) => s + Number(r.employer_cost), 0),
      laborHours: labor.reduce((s, r) => s + Number(r.hours_100) + Number(r.hours_125) + Number(r.hours_150), 0),
      yoyProduction: yoyProd.reduce((s, r) => s + Number(r.amount), 0),
      yoyWaste: yoyWaste.reduce((s, r) => s + Number(r.amount), 0),
      yoyLaborCost: yoyLabor.reduce((s, r) => s + Number(r.employer_cost), 0),
    })
  }

  // ── Totals ──
  const totalProd = deptData.reduce((s, d) => s + d.production, 0)
  const totalWaste = deptData.reduce((s, d) => s + d.waste, 0)
  const totalLabor = deptData.reduce((s, d) => s + d.laborCost, 0)
  const totalHours = deptData.reduce((s, d) => s + d.laborHours, 0)
  const wastePct = totalProd > 0 ? (totalWaste / totalProd) * 100 : 0
  const productivity = totalHours > 0 ? totalProd / totalHours : 0

  const yoyTotalProd = deptData.reduce((s, d) => s + d.yoyProduction, 0)
  const yoyTotalWaste = deptData.reduce((s, d) => s + d.yoyWaste, 0)
  const yoyTotalLabor = deptData.reduce((s, d) => s + d.yoyLaborCost, 0)
  const prodDelta = yoyTotalProd > 0 ? ((totalProd - yoyTotalProd) / yoyTotalProd) * 100 : 0

  // ── Comparison table ──
  const comparisonTable = dataTable(
    ['מחלקה', 'ייצור', 'ייצור שנה שעברה', 'שינוי', 'פסולת %', 'עלות עובדים'],
    deptData.map(d => {
      const wp = d.production > 0 ? (d.waste / d.production) * 100 : 0
      const delta = d.yoyProduction > 0 ? ((d.production - d.yoyProduction) / d.yoyProduction) * 100 : 0
      return [
        `<strong>${d.name}</strong>`,
        fmtCurrency(d.production),
        fmtCurrency(d.yoyProduction),
        `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
        fmtPct(wp),
        fmtCurrency(d.laborCost),
      ]
    }),
  )

  // ── Production chart ──
  const prodChartData = deptData
    .filter(d => d.production > 0)
    .map(d => ({ label: d.name, amount: Math.round(d.production), color: d.color }))
  const productionChartUrl = factoryProductionChart(prodChartData)

  // ── AI ──
  const insights = await generateInsights('admin_factory', {
    totalProduction: Math.round(totalProd),
    wastePct: wastePct.toFixed(1),
    productivity: Math.round(productivity),
    laborCost: Math.round(totalLabor),
    departments: deptData.map(d => ({
      name: d.name,
      production: Math.round(d.production),
      wastePct: d.production > 0 ? ((d.waste / d.production) * 100).toFixed(1) : '0',
      yoyDelta: d.yoyProduction > 0 ? (((d.production - d.yoyProduction) / d.yoyProduction) * 100).toFixed(1) : 'N/A',
    })),
  }, 3)

  // ── Build HTML ──
  const kpis = kpiRow([
    { label: 'ייצור חודשי', value: fmtCurrency(totalProd), target: fmtCurrency(yoyTotalProd), isGood: prodDelta >= 0 },
    { label: 'שינוי שנתי', value: `${prodDelta >= 0 ? '+' : ''}${prodDelta.toFixed(1)}%`, target: 'שנה שעברה', isGood: prodDelta >= 0 },
    { label: 'פסולת %', value: fmtPct(wastePct), target: '5%', isGood: wastePct <= 5 },
    { label: 'עלות עובדים', value: fmtCurrency(totalLabor), target: fmtCurrency(yoyTotalLabor), isGood: totalLabor <= yoyTotalLabor * 1.1 },
  ])

  const body = `
    ${kpis}
    ${sectionHeader('השוואה לחודש המקביל בשנה שעברה')}
    ${comparisonTable}
    ${sectionHeader('ייצור לפי מחלקות')}
    ${chartImg(productionChartUrl, 'גרף ייצור חודשי')}
    ${insightsBox(insights)}
  `

  const html = emailLayout(
    'סיכום חודשי — מפעל',
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
