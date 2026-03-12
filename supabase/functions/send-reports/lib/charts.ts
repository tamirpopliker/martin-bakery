const QUICKCHART_BASE = 'https://quickchart.io/chart'

interface DatasetConfig {
  label: string
  data: number[]
  backgroundColor?: string | string[]
  borderColor?: string
  borderDash?: number[]
  fill?: boolean
}

function buildChartUrl(config: Record<string, unknown>, width = 600, height = 280): string {
  const encoded = encodeURIComponent(JSON.stringify(config))
  return `${QUICKCHART_BASE}?c=${encoded}&w=${width}&h=${height}&bkg=white&f=png`
}

// ─── Bar Chart ──────────────────────────────────────────────────────────────

export function barChart(
  labels: string[],
  datasets: DatasetConfig[],
  width = 600,
  height = 280,
): string {
  return buildChartUrl({
    type: 'bar',
    data: { labels, datasets },
    options: {
      plugins: { legend: { rtl: true, labels: { font: { size: 13 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 11 } } },
        x: { ticks: { font: { size: 11 } } },
      },
    },
  }, width, height)
}

// ─── Line Chart ─────────────────────────────────────────────────────────────

export function lineChart(
  labels: string[],
  datasets: DatasetConfig[],
  width = 600,
  height = 280,
): string {
  return buildChartUrl({
    type: 'line',
    data: {
      labels,
      datasets: datasets.map(ds => ({
        ...ds,
        fill: ds.fill ?? false,
        tension: 0.3,
        pointRadius: 4,
      })),
    },
    options: {
      plugins: { legend: { rtl: true, labels: { font: { size: 13 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 11 } } },
        x: { ticks: { font: { size: 11 } } },
      },
    },
  }, width, height)
}

// ─── Horizontal Bar Chart ───────────────────────────────────────────────────

export function horizontalBarChart(
  labels: string[],
  data: number[],
  colors: string[],
  width = 600,
  height = 250,
): string {
  return buildChartUrl({
    type: 'horizontalBar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, barThickness: 28 }],
    },
    options: {
      legend: { display: false },
      scales: {
        xAxes: [{ ticks: { beginAtZero: true, callback: (v: number) => v + '%' } }],
      },
    },
  }, width, height)
}

// ─── Specific report charts ─────────────────────────────────────────────────

/** Revenue vs daily target — last 7 days */
export function branchRevenueChart(
  days: Array<{ label: string; revenue: number; target: number }>,
): string {
  return barChart(
    days.map(d => d.label),
    [
      { label: 'הכנסות בפועל', data: days.map(d => d.revenue), backgroundColor: '#3b82f6' },
      { label: 'יעד יומי', data: days.map(d => d.target), backgroundColor: '#cbd5e1' },
    ],
  )
}

/** Daily waste bar chart */
export function branchWasteChart(
  days: Array<{ label: string; waste: number }>,
): string {
  return barChart(
    days.map(d => d.label),
    [{ label: 'פחת (₪)', data: days.map(d => d.waste), backgroundColor: '#ef4444' }],
  )
}

/** Factory productivity line chart — daily vs 30-day average */
export function factoryProductivityChart(
  days: Array<{ label: string; productivity: number }>,
  avg30: number,
): string {
  return lineChart(
    days.map(d => d.label),
    [
      { label: 'פריון יומי (₪/שעה)', data: days.map(d => d.productivity), borderColor: '#3b82f6' },
      { label: 'ממוצע 30 יום', data: days.map(() => avg30), borderColor: '#94a3b8', borderDash: [6, 3] },
    ],
  )
}

/** Factory production by product bar chart */
export function factoryProductionChart(
  products: Array<{ label: string; amount: number; color: string }>,
): string {
  return barChart(
    products.map(p => p.label),
    [{ label: 'כמות ייצור (₪)', data: products.map(p => p.amount), backgroundColor: products.map(p => p.color) }],
  )
}

/** Admin: branch target achievement horizontal bar */
export function adminBranchComparisonChart(
  branches: Array<{ name: string; achievementPct: number; color: string }>,
): string {
  return horizontalBarChart(
    branches.map(b => b.name),
    branches.map(b => Math.round(b.achievementPct)),
    branches.map(b => b.color),
  )
}

/** Admin: weekly revenue trend line chart */
export function adminRevenueTrendChart(
  days: Array<{ label: string; revenue: number }>,
): string {
  return lineChart(
    days.map(d => d.label),
    [{ label: 'הכנסות כוללות (₪)', data: days.map(d => d.revenue), borderColor: '#0f172a', fill: true, backgroundColor: 'rgba(15,23,42,0.08)' }],
  )
}
