// ═══════════════════════════════════════════════════════════════════════════
// WeeklyInsightsSelector — entity picker + insights card for CEO dashboard
// ═══════════════════════════════════════════════════════════════════════════
// Pills row to switch between consolidated / factory / each branch, with the
// matching WeeklyInsightsCard underneath. RLS on weekly_insights handles
// per-role visibility; this component just renders what comes back.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import WeeklyInsightsCard from './WeeklyInsightsCard'

interface Branch {
  id: number
  name: string
}

type Selection =
  | { kind: 'consolidated' }
  | { kind: 'factory' }
  | { kind: 'branch'; id: number; name: string }

interface Props {
  branches: Branch[]
}

export default function WeeklyInsightsSelector({ branches }: Props) {
  const [selection, setSelection] = useState<Selection>({ kind: 'consolidated' })

  const pillBase = {
    padding: '6px 14px',
    borderRadius: 999,
    border: '1px solid #e2e8f0',
    background: 'white',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    color: '#475569',
    fontFamily: 'inherit',
  } as const
  const pillActive = {
    ...pillBase,
    background: '#7C3AED',
    border: '1px solid #7C3AED',
    color: 'white',
  } as const

  const isActive = (s: Selection) => {
    if (s.kind !== selection.kind) return false
    if (s.kind === 'branch' && selection.kind === 'branch') return s.id === selection.id
    return true
  }

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          onClick={() => setSelection({ kind: 'consolidated' })}
          style={isActive({ kind: 'consolidated' }) ? pillActive : pillBase}
        >
          מאוחד
        </button>
        <button
          onClick={() => setSelection({ kind: 'factory' })}
          style={isActive({ kind: 'factory' }) ? pillActive : pillBase}
        >
          מפעל
        </button>
        {branches.map(br => (
          <button
            key={br.id}
            onClick={() => setSelection({ kind: 'branch', id: br.id, name: br.name })}
            style={isActive({ kind: 'branch', id: br.id, name: br.name }) ? pillActive : pillBase}
          >
            {br.name}
          </button>
        ))}
      </div>

      {/* Card */}
      {selection.kind === 'consolidated' && (
        <WeeklyInsightsCard entityType="consolidated" title="תובנות שבועיות — כל העסק" />
      )}
      {selection.kind === 'factory' && (
        <WeeklyInsightsCard entityType="factory" title="תובנות שבועיות — מפעל" />
      )}
      {selection.kind === 'branch' && (
        <WeeklyInsightsCard
          entityType="branch"
          entityId={selection.id}
          title={`תובנות שבועיות — ${selection.name}`}
        />
      )}
    </div>
  )
}
