// ═══════════════════════════════════════════════════════════════════════════
// WeeklyInsightsCard — displays the most recent weekly-insights row
// ═══════════════════════════════════════════════════════════════════════════
// Reads from `weekly_insights` table (populated by the weekly-insights Edge
// Function every Monday at 10:00 IST). RLS ensures branch managers only see
// their own branch's row.
//
// Used on:
//   - CEODashboard (entity_type prop varies via selector)
//   - BranchHome   (entity_type='branch', entity_id=user's branch)
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Lightbulb, AlertTriangle, CheckCircle, Info, ChevronDown, ChevronUp } from 'lucide-react'

type EntityType = 'branch' | 'factory' | 'consolidated'

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

interface WeeklyInsightsRow {
  id: string
  period_start: string
  period_end: string
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

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
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
  const [row, setRow] = useState<WeeklyInsightsRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedAlertIdx, setExpandedAlertIdx] = useState<number | null>(null)
  const [showWins, setShowWins] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      let q = supabase
        .from('weekly_insights')
        .select('*')
        .eq('entity_type', entityType)
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
        setRow(data as WeeklyInsightsRow | null)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [entityType, entityId])

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ ...headerStyle, justifyContent: 'space-between' }}>
          <span style={titleStyle}>
            <Lightbulb size={18} color="#f59e0b" style={{ marginInlineEnd: 8, verticalAlign: 'middle' }} />
            {title ?? 'תובנות שבועיות'}
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>טוען...</span>
        </div>
      </div>
    )
  }

  if (!row) {
    return (
      <div style={cardStyle}>
        <div style={{ ...headerStyle, justifyContent: 'space-between' }}>
          <span style={titleStyle}>
            <Lightbulb size={18} color="#f59e0b" style={{ marginInlineEnd: 8, verticalAlign: 'middle' }} />
            {title ?? 'תובנות שבועיות'}
          </span>
        </div>
        <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          טרם נוצרו תובנות. הניתוח השבועי האוטומטי רץ כל יום שני בבוקר.
        </div>
      </div>
    )
  }

  const { insights, period_start, period_end } = row

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lightbulb size={18} color="#f59e0b" />
          <span style={titleStyle}>{title ?? 'תובנות שבועיות'}</span>
        </div>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {fmtPeriod(period_start, period_end)}
        </span>
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

      {/* Wins (collapsible) */}
      {insights.wins.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <button
            onClick={() => setShowWins(v => !v)}
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
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>
          סיכום
        </div>
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
          {insights.summary}
        </div>
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
  padding: '14px 20px',
  borderBottom: '1px solid #f1f5f9',
  background: '#fefce8',
}

const titleStyle = {
  fontSize: 14,
  fontWeight: 700,
  color: '#0f172a',
}
