/**
 * Structured insights for the CEO dashboard's redesigned insights panel.
 * Per entity (branches + factory), computes severity per metric and rolls up
 * to a summary used by the bar/modal.
 */

export type Severity = 'severe' | 'warn' | 'ok' | 'none'

export type MetricKey = 'profit' | 'labor' | 'waste' | 'revenue'

export interface MetricStatus {
  key: MetricKey
  label: string             // "רווח נשלט"
  actualLabel: string       // "19K" or "10.1%"
  targetLabel: string       // "יעד 64K" or "ללא יעד"
  deltaLabel: string        // "−83K" or "+237%" or "—"
  severity: Severity
  hasTarget: boolean
  /** Raw numeric severity score (% off target). Used to pick the spotlight. */
  severityScore: number
}

export interface EntityInsights {
  entityId: number | 'factory'
  entityName: string
  metrics: MetricStatus[]
  worstSeverity: Severity
  /** The single worst metric for the spotlight ranking. */
  worstMetric: MetricStatus | null
  /** % of-target for the worst metric (signed; negative when below). */
  worstMetricPctOfTarget: number
  worstMetricRevenue: number   // entity revenue, used for spotlight context
}

export interface InsightsSummary {
  entities: EntityInsights[]      // sorted: severe → warn → ok
  spotlight: { entity: EntityInsights; metric: MetricStatus; pctOfTarget: number } | null
  counts: { severe: number; warn: number; ok: number; noTarget: number }
}

export interface EntityInput {
  id: number | 'factory'
  name: string
  revenue: number             // for percentage-based metrics + spotlight context
  controllableProfit: number  // ₪
  profitTarget: number        // ₪. 0 = no target.
  laborCost: number           // ₪ (used to compute %)
  laborPctTarget: number      // e.g. 28. 0 = no target.
  waste: number               // ₪
  wastePctTarget: number      // e.g. 3. 0 = no target.
  revenueTarget: number       // ₪. 0 = no target (very common).
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + 'M'
  if (abs >= 1_000) return Math.round(n / 1_000).toLocaleString() + 'K'
  return Math.round(n).toLocaleString()
}

function fmtPctValue(n: number): string {
  return n.toFixed(1) + '%'
}

function severityFromPct(pctOff: number): Severity {
  // pctOff is signed: negative = below target (bad for profit/revenue, good for labor/waste).
  // Caller passes already-normalized "bad direction" magnitude.
  const abs = Math.abs(pctOff)
  if (abs > 20) return 'severe'
  if (abs > 5) return 'warn'
  return 'ok'
}

// ─── Per-metric builders ──────────────────────────────────────────────────

function buildProfitMetric(input: EntityInput): MetricStatus {
  const { controllableProfit, profitTarget } = input
  if (!profitTarget || profitTarget <= 0) {
    return {
      key: 'profit', label: 'רווח נשלט',
      actualLabel: '₪' + fmtMoney(controllableProfit),
      targetLabel: 'ללא יעד', deltaLabel: '—',
      severity: 'none', hasTarget: false, severityScore: 0,
    }
  }
  const delta = controllableProfit - profitTarget
  const pctOff = (delta / profitTarget) * 100   // negative = under
  const sev: Severity = delta >= 0 ? 'ok' : severityFromPct(pctOff)
  return {
    key: 'profit', label: 'רווח נשלט',
    actualLabel: '₪' + fmtMoney(controllableProfit),
    targetLabel: 'יעד ₪' + fmtMoney(profitTarget),
    deltaLabel: (delta >= 0 ? '+' : '−') + '₪' + fmtMoney(delta),
    severity: sev, hasTarget: true,
    severityScore: Math.abs(pctOff),
  }
}

function buildLaborMetric(input: EntityInput): MetricStatus {
  const { laborCost, revenue, laborPctTarget } = input
  if (!laborPctTarget || laborPctTarget <= 0 || revenue <= 0) {
    const pct = revenue > 0 ? (laborCost / revenue) * 100 : 0
    return {
      key: 'labor', label: 'לייבור',
      actualLabel: fmtPctValue(pct),
      targetLabel: 'ללא יעד', deltaLabel: '—',
      severity: 'none', hasTarget: false, severityScore: 0,
    }
  }
  const actualPct = (laborCost / revenue) * 100
  const diff = actualPct - laborPctTarget   // positive = over (bad)
  const pctOff = (diff / laborPctTarget) * 100
  const sev: Severity = diff <= 0 ? 'ok' : severityFromPct(pctOff)
  return {
    key: 'labor', label: 'לייבור',
    actualLabel: fmtPctValue(actualPct),
    targetLabel: 'יעד ' + fmtPctValue(laborPctTarget),
    deltaLabel: (diff >= 0 ? '+' : '−') + Math.abs(diff).toFixed(1) + 'pt',
    severity: sev, hasTarget: true,
    severityScore: Math.abs(pctOff),
  }
}

function buildWasteMetric(input: EntityInput): MetricStatus {
  const { waste, revenue, wastePctTarget } = input
  if (!wastePctTarget || wastePctTarget <= 0 || revenue <= 0) {
    const pct = revenue > 0 ? (waste / revenue) * 100 : 0
    return {
      key: 'waste', label: 'פחת',
      actualLabel: fmtPctValue(pct),
      targetLabel: 'ללא יעד', deltaLabel: '—',
      severity: 'none', hasTarget: false, severityScore: 0,
    }
  }
  const actualPct = (waste / revenue) * 100
  const diff = actualPct - wastePctTarget  // positive = over (bad)
  const pctOff = (diff / wastePctTarget) * 100
  const sev: Severity = diff <= 0 ? 'ok' : severityFromPct(pctOff)
  return {
    key: 'waste', label: 'פחת',
    actualLabel: fmtPctValue(actualPct),
    targetLabel: 'יעד ' + fmtPctValue(wastePctTarget),
    deltaLabel: (diff >= 0 ? '+' : '−') + Math.abs(diff).toFixed(1) + 'pt',
    severity: sev, hasTarget: true,
    severityScore: Math.abs(pctOff),
  }
}

function buildRevenueMetric(input: EntityInput): MetricStatus {
  const { revenue, revenueTarget } = input
  if (!revenueTarget || revenueTarget <= 0) {
    return {
      key: 'revenue', label: 'הכנסות',
      actualLabel: '₪' + fmtMoney(revenue),
      targetLabel: 'ללא יעד', deltaLabel: '—',
      severity: 'none', hasTarget: false, severityScore: 0,
    }
  }
  const delta = revenue - revenueTarget
  const pctOff = (delta / revenueTarget) * 100
  const sev: Severity = delta >= 0 ? 'ok' : severityFromPct(pctOff)
  return {
    key: 'revenue', label: 'הכנסות',
    actualLabel: '₪' + fmtMoney(revenue),
    targetLabel: 'יעד ₪' + fmtMoney(revenueTarget),
    deltaLabel: (delta >= 0 ? '+' : '−') + '₪' + fmtMoney(delta),
    severity: sev, hasTarget: true,
    severityScore: Math.abs(pctOff),
  }
}

const SEV_RANK: Record<Severity, number> = { severe: 3, warn: 2, ok: 1, none: 0 }

// ─── Public API ───────────────────────────────────────────────────────────

export function buildInsightsSummary(inputs: EntityInput[]): InsightsSummary {
  const entities: EntityInsights[] = inputs.map(input => {
    const metrics: MetricStatus[] = [
      buildProfitMetric(input),
      buildLaborMetric(input),
      buildWasteMetric(input),
      buildRevenueMetric(input),
    ]
    const worstSeverity = metrics.reduce<Severity>((acc, m) => {
      return SEV_RANK[m.severity] > SEV_RANK[acc] ? m.severity : acc
    }, 'none')
    const worstMetric = metrics
      .filter(m => m.severity === 'severe' || m.severity === 'warn')
      .sort((a, b) => b.severityScore - a.severityScore)[0] ?? null
    const profitMetric = metrics.find(m => m.key === 'profit')
    const profitPctOfTarget = (() => {
      if (!profitMetric?.hasTarget) return 0
      // recover pctOff from severityScore + delta sign
      const delta = input.controllableProfit - input.profitTarget
      return input.profitTarget > 0 ? (delta / input.profitTarget) * 100 : 0
    })()
    return {
      entityId: input.id,
      entityName: input.name,
      metrics,
      worstSeverity,
      worstMetric,
      worstMetricPctOfTarget: profitPctOfTarget,
      worstMetricRevenue: input.revenue,
    }
  })

  // Sort: severe first → warn → ok → none
  entities.sort((a, b) => {
    const r = SEV_RANK[b.worstSeverity] - SEV_RANK[a.worstSeverity]
    if (r !== 0) return r
    return (b.worstMetric?.severityScore ?? 0) - (a.worstMetric?.severityScore ?? 0)
  })

  // Spotlight = the single worst metric across all entities (severe only)
  let spotlight: InsightsSummary['spotlight'] = null
  let spotlightScore = -1
  for (const ent of entities) {
    for (const m of ent.metrics) {
      if (m.severity !== 'severe') continue
      if (m.severityScore > spotlightScore) {
        spotlightScore = m.severityScore
        spotlight = { entity: ent, metric: m, pctOfTarget: ent.worstMetricPctOfTarget }
      }
    }
  }

  const counts = entities.reduce(
    (acc, e) => {
      if (e.worstSeverity === 'severe') acc.severe++
      else if (e.worstSeverity === 'warn') acc.warn++
      else if (e.worstSeverity === 'ok') acc.ok++
      else acc.noTarget++
      return acc
    },
    { severe: 0, warn: 0, ok: 0, noTarget: 0 }
  )

  return { entities, spotlight, counts }
}
