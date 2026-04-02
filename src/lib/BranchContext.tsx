import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchBranches, type Branch } from './supabase'

// ─── צבעי ברירת מחדל לסניפים ─────────────────────────────────────────────────
const DEFAULT_COLORS = ['#818cf8', '#34d399', '#c084fc', '#fb7185', '#fbbf24', '#38bdf8', '#f97316', '#a78bfa']

function getBranchColor(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length]
}

// ─── טיפוסים ─────────────────────────────────────────────────────────────────
export interface BranchWithColor extends Branch {
  color: string
}

interface BranchContextValue {
  branches: BranchWithColor[]
  loading: boolean
  getBranchName: (id: number) => string
  getBranchShortName: (id: number) => string
  getBranchColor: (id: number) => string
  refreshBranches: () => Promise<void>
}

const BranchContext = createContext<BranchContextValue>({
  branches: [],
  loading: true,
  getBranchName: () => '',
  getBranchShortName: () => '',
  getBranchColor: () => '#818cf8',
  refreshBranches: async () => {},
})

// ─── Provider ────────────────────────────────────────────────────────────────
export function BranchProvider({ children }: { children: React.ReactNode }) {
  const [branches, setBranches] = useState<BranchWithColor[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const data = await fetchBranches()
    const withColors = data.map((b, i) => ({ ...b, color: getBranchColor(i) }))
    setBranches(withColors)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const getBranchName = useCallback((id: number) => {
    return branches.find(b => b.id === id)?.name ?? `סניף ${id}`
  }, [branches])

  const getBranchShortName = useCallback((id: number) => {
    const b = branches.find(b => b.id === id)
    return b?.short_name || b?.name || `סניף ${id}`
  }, [branches])

  const getBranchColorById = useCallback((id: number) => {
    return branches.find(b => b.id === id)?.color ?? '#818cf8'
  }, [branches])

  return (
    <BranchContext.Provider value={{
      branches,
      loading,
      getBranchName,
      getBranchShortName,
      getBranchColor: getBranchColorById,
      refreshBranches: load,
    }}>
      {children}
    </BranchContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useBranches() {
  return useContext(BranchContext)
}
