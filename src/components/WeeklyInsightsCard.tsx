// ═══════════════════════════════════════════════════════════════════════════
// WeeklyInsightsCard — AI advisor card with weekly/monthly toggle + manual run
// ═══════════════════════════════════════════════════════════════════════════
// Reads from `insights` (the renamed weekly_insights table). RLS ensures
// branch managers only see their own branch's row.
//
// Used on:
//   - CEODashboard (entity_type prop varies via selector)
//   - BranchHome   (entity_type='branch', entity_id=user's branch)
//
// Includes a period toggle (weekly/monthly) and a "Run now" button that
// invokes the weekly-insights Edge Function on demand.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Lightbulb, AlertTriangle, CheckCircle, Info, ChevronDown, ChevronUp, Play, Loader2 } from 'lucide-react'

type EntityType = 'branch' | 'factory' | 'consolidated'
type PeriodType = 'weekly' | 'monthly'

interface Alert {
  severity: 'high' | 'medium' | 'low'
  metric: string
  message: string
  recommendation: string
}

interface Insights {
  headline: string
  alerts: Alert[]
  wins: string[]
  summary: string
}

interface InsightRow {
  id: string
  period_start: string
  period_end: string
  period_type: PeriodType
  entity_type: EntityType
  entity_id: number | null
  insights: Insights
  generated_at: string
}

const SEVERITY_STYLE = {
  high:   { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', icon: <AlertTriangle size={16} color="#dc2626" /> },
  medium: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', icon: <AlertTriangle size={16} color="#d97706" /> },
  low:    { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', icon: <Info size={16} color="#2563eb" /> },
}

function fmtPeriod(start: string, end: string, periodType: PeriodType): string {
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  if (periodType === 'monthly') {
    return s.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
  }
  const sStr = s.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
  const eStr = e.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${sStr} – ${eStr}`
}

interface Props {
  entityType: EntityType
  entityId?: number | null  // required when entityType='branch'
  title?: string             // override default title
}

export default function WeeklyInsightsCard({ entityType, entityId, title }: Props) {
  const [periodType, setPeriodType] = useState<PeriodType>('weekly')
  const [row, setRow] = useState<InsightRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [expandedAlertIdx, setExpandedAlertIdx] = useState<number | null>(null)
  const [showWins, setShowWins] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      let q = supabase
        .from('insights')
        .select('*')
        .eq('entity_type', entityType)
        .eq('period_type', periodType)
        .order('period_end', { ascending: false })
        .limit(1)

      if (entityType === 'branch') {
        q = q.eq('entity_id', entityId ?? -1)
      } else {
        q = q.is('entity_id', null)
      }

      const { data, error } = await q.maybeSingle()
      if (cancelled) return
      if (error) {
        console.error('[WeeklyInsightsCard] load error:', error)
        setRow(null)
      } else {
        setRow(data as InsightRow | null)
      }
      setExpandedAlertIdx(null)
      setShowWins(false)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [entityType, entityId, periodType, refreshKey])

  async function runNow() {
    setRunning(true)
    setRunError(null)
    try {
      const { data, error } = await supabase.functions.invoke('weekly-insights', {
        body: { period_type: periodType },
      })
      if (error) throw error
      const failed = (data as { failed?: number })?.failed ?? 0
      if (failed > 0) {
        setRunError(`${failed} מהיחידות נכשלו — בדוק את הלוגים`)
      }
      // Trigger reload regardless (partial success still updates available entities)
      setRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setRunError(msg)
    } finally {
      setRunning(false)
    }
  }

  const renderHeader = () => (
    <div style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
        <Lightbulb size={18} color="#f59e0b" />
        <span style={titleStyle}>{title ?? 'תובנות'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Period toggle */}
        <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
          {(['weekly', 'monthly'] as PeriodType[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodType(p)}
              style={{
                background: periodType === p ? '#7C3AED' : 'white',
                color: periodType === p ? 'white' : '#475569',
                border: 'none',
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {p === 'weekly' ? 'שבועי' : 'חודשי'}
            </button>
          ))}
        </div>
        {/* Run now */}
        <button
          onClick={runNow}
          disabled={running}
          title={`הפעל ניתוח ${periodType === 'weekly' ? 'שבועי' : 'חודשי'} עכשיו`}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: running ? '#e2e8f0' : '#0f172a',
            color: running ? '#94a3b8' : 'white',
            border: 'none',
            borderRadius: 8,
            padding: '5px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: running ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {running
            ? <><Loader2 size={12} className="animate-spin" /> מריץ...</>
            : <><Play size={12} /> הפעל עכשיו</>}
        </button>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div style={cardStyle}>
        {renderHeader()}
        <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>טוען…</div>
      </div>
    )
  }

  if (!row) {
    return (
      <div style={cardStyle}>
        {renderHeader()}
        {runError && (
          <div style={errorStyle}>שגיאה בהפעלה: {runError}</div>
        )}
        <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          טרם נוצרו תובנות {periodType === 'weekly' ? 'שבועיות' : 'חודשיות'}.
          {periodType === 'weekly'
            ? ' הניתוח השבועי האוטומטי רץ כל יום שני בבוקר, או לחץ "הפעל עכשיו".'
            : ' לחץ "הפעל עכשיו" כדי לנתח את החודש שעבר.'}
        </div>
      </div>
    )
  }

  const { insights, period_start, period_end, period_type } = row

  return (
    <div style={cardStyle}>
      {renderHeader()}

      {runError && (
        <div style={errorStyle}>שגיאה בהפעלה: {runError}</div>
      )}

      {/* Period subtitle */}
      <div style={{ padding: '8px 20px', background: '#fefce8', fontSize: 12, color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
        תקופה: {fmtPeriod(period_start, period_end, period_type)}
      </div>

      {/* Headline */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', background: '#fafafa' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', lineHeight: 1.5 }}>
          {insights.headline}
        </div>
      </div>

      {/* Alerts */}
      {insights.alerts.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
            התראות ({insights.alerts.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insights.alerts.map((alert, i) => {
              const style = SEVERITY_STYLE[alert.severity]
              const isExpanded = expandedAlertIdx === i
              return (
                <button
                  key={i}
                  onClick={() => setExpandedAlertIdx(isExpanded ? null : i)}
                  style={{
                    background: style.bg,
                    border: `1px solid ${style.border}`,
                    borderRadius: 8,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    textAlign: 'right' as const,
                    fontFamily: 'inherit',
                    direction: 'rtl' as const,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ marginTop: 2 }}>{style.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: style.text, marginBottom: 4 }}>
                        {alert.metric}
                      </div>
                      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
                        {alert.message}
                      </div>
                      {isExpanded && (
                        <div style={{
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: `1px dashed ${style.border}`,
                          fontSize: 12,
                          color: '#1f2937',
                          lineHeight: 1.5,
                        }}>
                          <span style={{ fontWeight: 600 }}>המלצה: </span>
                          {alert.recommendation}
                        </div>
                      )}
                    </div>
                    <div style={{ color: style.text, opacity: 0.5 }}>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Wins */}
      {insights.wins.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <button
            onClick={() => setShowWins((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, fontFamily: 'inherit',
            }}
          >
            <CheckCircle size={14} color="#10b981" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>
              נקודות חיוביות ({insights.wins.length})
            </span>
            {showWins ? <ChevronUp size={12} color="#94a3b8" /> : <ChevronDown size={12} color="#94a3b8" />}
          </button>
          {showWins && (
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {insights.wins.map((win, i) => (
                <li key={i} style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, paddingInlineStart: 20, position: 'relative' }}>
                  <span style={{ position: 'absolute', insetInlineStart: 0, color: '#10b981' }}>✓</span>
                  {win}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Summary */}
      <div style={{ padding: '14px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>סיכום</div>
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>{insights.summary}</div>
      </div>
    </div>
  )
}

const cardStyle = {
  background: 'white',
  borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  border: '1px solid #f1f5f9',
  overflow: 'hidden' as const,
  direction: 'rtl' as const,
}

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '12px 20px',
  borderBottom: '1px solid #f1f5f9',
  background: '#fefce8',
  flexWrap: 'wrap' as const,
}

const titleStyle = {
  fontSize: 14,
  fontWeight: 700,
  color: '#0f172a',
}

const errorStyle = {
  padding: '8px 20px',
  background: '#fef2f2',
  color: '#991b1b',
  fontSize: 12,
  borderBottom: '1px solid #fecaca',
}
