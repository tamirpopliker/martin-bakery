import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Insight } from '../lib/generateInsights'

const TYPE_STYLES = {
  warning: { bg: '#fffbeb', border: '#fbbf24', icon: '⚠️' },
  success: { bg: '#f0fdf4', border: '#4ade80', icon: '✅' },
  info:    { bg: '#eff6ff', border: '#60a5fa', icon: 'ℹ️' },
}

interface InsightsCardProps {
  insights: Insight[]
  title?: string
}

export default function InsightsCard({ insights, title }: InsightsCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const highPriority = insights.filter(i => i.priority <= 2)
  const lowPriority = insights.filter(i => i.priority === 3)
  const visibleInsights = showAll ? insights : highPriority

  const today = new Date().toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div style={{
      background: 'white',
      borderRadius: 16,
      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      overflow: 'hidden',
      direction: 'rtl',
    }}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          background: 'none',
          border: 'none',
          borderBottom: collapsed ? 'none' : '1px solid #f1f5f9',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
          {title || '💡 תובנות החודש'}
        </span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {today} {collapsed ? '▸' : '▾'}
        </span>
      </button>

      {/* Body */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '12px 20px 20px' }}>
              {highPriority.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '24px 0',
                  color: '#64748b',
                  fontSize: 14,
                }}>
                  ✅ הכל תקין החודש
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {visibleInsights.map((insight, idx) => {
                    const style = TYPE_STYLES[insight.type]
                    return (
                      <motion.div
                        key={insight.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05, duration: 0.3 }}
                        style={{
                          background: style.bg,
                          borderRight: `4px solid ${style.border}`,
                          borderRadius: 8,
                          padding: '12px 16px',
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 4,
                        }}>
                          <span style={{ fontSize: 14 }}>{style.icon}</span>
                          <span style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#1e293b',
                          }}>
                            {insight.title}
                          </span>
                        </div>
                        <div style={{
                          fontSize: 12,
                          color: '#475569',
                          lineHeight: 1.6,
                          paddingRight: 22,
                        }}>
                          {insight.body}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              )}

              {/* Expand / collapse toggle for priority 3 */}
              {lowPriority.length > 0 && (
                <button
                  onClick={() => setShowAll(s => !s)}
                  style={{
                    display: 'block',
                    margin: '12px auto 0',
                    padding: '6px 16px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    fontSize: 12,
                    color: '#64748b',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {showAll
                    ? 'הצג פחות'
                    : `הצג הכל (${lowPriority.length})`}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
