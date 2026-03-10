import { createContext, useContext, useState, useMemo, type ReactNode } from 'react'
import { computePeriod, getComparisonPeriod, type PeriodRange } from './period'

interface PeriodContextType {
  period: PeriodRange
  setPeriod: (p: PeriodRange) => void
  comparisonPeriod: PeriodRange
  /** Shortcut: period.from (YYYY-MM-DD inclusive) */
  from: string
  /** Shortcut: period.to (YYYY-MM-DD exclusive) */
  to: string
  /** YYYY-MM for single-month periods, null for multi-month */
  monthKey: string | null
}

const PeriodContext = createContext<PeriodContextType | null>(null)

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<PeriodRange>(() => computePeriod('month'))

  const value = useMemo<PeriodContextType>(() => ({
    period,
    setPeriod,
    comparisonPeriod: getComparisonPeriod(period),
    from: period.from,
    to: period.to,
    monthKey: period.monthKey,
  }), [period])

  return (
    <PeriodContext.Provider value={value}>
      {children}
    </PeriodContext.Provider>
  )
}

export function usePeriod(): PeriodContextType {
  const ctx = useContext(PeriodContext)
  if (!ctx) throw new Error('usePeriod must be used within PeriodProvider')
  return ctx
}
