import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { useBranches } from '../lib/BranchContext'
import { calculateBranchPL, type PLResult } from '../lib/calculatePL'
import PageHeader from '../components/PageHeader'
import PeriodPicker from '../components/PeriodPicker'
import { Button } from '@/components/ui/button'
import SuppliersReport from './SuppliersReport'
import {
  Calendar, TrendingUp, TrendingDown, AlertTriangle, Download,
  BarChart3, Briefcase, ShieldCheck, Wallet,
} from 'lucide-react'

interface Props { onBack: () => void }

// Per-branch register layout — mirrors the same constant used elsewhere.
const BRANCH_REGISTERS: Record<number, number[]> = {
  1: [1, 2, 3, 6],
  2: [4, 5, 7],
  3: [9, 10, 11, 13],
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
const fmt = (n: number) => '₪' + Math.round(n).toLocaleString()
const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%'

function monthDays(year: number, month: number): Date[] {
  const days: Date[] = []
  const d = new Date(year, month - 1, 1)
  while (d.getMonth() === month - 1) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function toIsoDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function parseMonthKey(mk: string): { year: number; month: number } {
  const [y, m] = mk.split('-').map(Number)
  return { year: y, month: m }
}

// ─── Tabs definition ──────────────────────────────────────────────────────────
type TabKey = 'revenue' | 'labor' | 'cashier' | 'comparison' | 'suppliers' | 'integrity'
const TABS: Array<{ key: TabKey; label: string; Icon: any }> = [
  { key: 'revenue',    label: 'בקרת הכנסות',      Icon: Calendar },
  { key: 'labor',      label: 'לייבור משוער/בפועל', Icon: TrendingUp },
  { key: 'cashier',    label: 'בקרת קופות',        Icon: Wallet },
  { key: 'comparison', label: 'השוואת תקופות',      Icon: BarChart3 },
  { key: 'suppliers',  label: 'דוח ספקים',          Icon: Briefcase },
  { key: 'integrity',  label: 'שלמות נתונים',       Icon: ShieldCheck },
]

// ═══════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════
export default function ManagementReports({ onBack }: Props) {
  const [tab, setTab] = useState<TabKey>('revenue')
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="דוחות ניהול" onBack={onBack} />

      {/* Tab bar */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', position: 'sticky', top: 64, zIndex: 5 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px', display: 'flex', gap: 0, overflowX: 'auto' }}>
          {TABS.map(t => {
            const Icon = t.Icon
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '12px 16px',
                  fontSize: 13, fontWeight: 700, background: 'transparent', border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                  color: active ? '#6366f1' : '#94a3b8',
                  borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
                  marginBottom: -1,
                }}>
                <Icon size={14} /> {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px' }}>
        {tab === 'revenue' && <RevenueControlTab />}
        {tab === 'labor' && <LaborActualTab />}
        {tab === 'cashier' && <CashierControlTab />}
        {tab === 'comparison' && <ComparisonTab />}
        {tab === 'suppliers' && <SuppliersReport onBack={onBack} hideHeader />}
        {tab === 'integrity' && <DataIntegrityTab />}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — Revenue control (calendar + anomalies)
// ═══════════════════════════════════════════════════════════════════════════
function RevenueControlTab() {
  const { period, setPeriod, from, to } = usePeriod()
  const { branches } = useBranches()
  const { year, month } = parseMonthKey(period.monthKey || from.slice(0, 7))
  const days = useMemo(() => monthDays(year, month), [year, month])

  const [byBranchDay, setByBranchDay] = useState<Record<number, Record<string, number>>>({})
  const [specialDays, setSpecialDays] = useState<Record<number, Set<string>>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (branches.length === 0) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const branchIds = branches.map(b => b.id)
      const [revRes, closingsRes, specialRes] = await Promise.all([
        supabase.from('branch_revenue').select('branch_id, date, amount')
          .in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
        supabase.from('register_closings').select('branch_id, date, cash_sales, credit_sales')
          .in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
        supabase.from('special_days').select('branch_id, date')
          .in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
      ])
      if (cancelled) return
      const byBr: Record<number, Record<string, number>> = {}
      for (const b of branchIds) byBr[b] = {}
      for (const r of (revRes.data || [])) {
        const bId = (r as any).branch_id as number
        const d = (r as any).date as string
        byBr[bId][d] = (byBr[bId][d] || 0) + Number((r as any).amount)
      }
      for (const c of (closingsRes.data || [])) {
        const bId = (c as any).branch_id as number
        const d = (c as any).date as string
        const sum = Number((c as any).cash_sales || 0) + Number((c as any).credit_sales || 0)
        byBr[bId][d] = (byBr[bId][d] || 0) + sum
      }
      const sDays: Record<number, Set<string>> = {}
      for (const b of branchIds) sDays[b] = new Set()
      for (const s of (specialRes.data || [])) {
        sDays[(s as any).branch_id as number]?.add((s as any).date as string)
      }
      setByBranchDay(byBr)
      setSpecialDays(sDays)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [from, to, branches.length])

  // Anomalies: days where amount is 2x above or below the branch's monthly mean (excluding zero days)
  const anomalies = useMemo(() => {
    const out: Array<{ branchId: number; branchName: string; date: string; amount: number; avg: number; ratio: number }> = []
    for (const b of branches) {
      const days = byBranchDay[b.id] || {}
      const values = Object.values(days).filter(v => v > 0)
      if (values.length < 3) continue
      const avg = values.reduce((s, v) => s + v, 0) / values.length
      for (const [date, amount] of Object.entries(days)) {
        if (amount <= 0) continue
        const ratio = amount / avg
        if (ratio >= 2 || ratio <= 0.5) {
          out.push({ branchId: b.id, branchName: b.name, date, amount, avg, ratio })
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  }, [byBranchDay, branches])

  // Missing days per branch
  const missingDays = useMemo(() => {
    const today = toIsoDate(new Date())
    const out: Record<number, number> = {}
    for (const b of branches) {
      const days = byBranchDay[b.id] || {}
      const sDays = specialDays[b.id] || new Set()
      let missing = 0
      for (const d of monthDays(year, month)) {
        const iso = toIsoDate(d)
        if (iso > today) continue
        if (d.getDay() === 6) continue              // Saturday
        if (sDays.has(iso)) continue                // holiday
        if (!(days[iso] > 0)) missing++
      }
      out[b.id] = missing
    }
    return out
  }, [byBranchDay, specialDays, branches, year, month])

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    // sheet 1: missing days per branch
    const missRows = branches.map(b => ({ 'סניף': b.name, 'ימים חסרים': missingDays[b.id] || 0 }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(missRows), 'ימים חסרים')
    // sheet 2: anomalies
    const anoRows = anomalies.map(a => ({
      'תאריך': a.date, 'סניף': a.branchName, 'סכום': Math.round(a.amount),
      'ממוצע חודשי': Math.round(a.avg), 'יחס': Number(a.ratio.toFixed(2)),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(anoRows), 'חריגות')
    XLSX.writeFile(wb, `revenue_control_${period.monthKey || from.slice(0, 7)}.xlsx`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TopBar>
        <PeriodPicker period={period} onChange={setPeriod} />
        <div style={{ flex: 1 }} />
        <Button onClick={exportExcel} className="bg-indigo-500 hover:bg-indigo-600"><Download size={14} /> ייצוא Excel</Button>
      </TopBar>

      {loading && <Loading />}

      {!loading && (
        <>
          {/* Calendars per branch */}
          {branches.map(b => {
            const days = byBranchDay[b.id] || {}
            const sDays = specialDays[b.id] || new Set()
            const today = toIsoDate(new Date())
            return (
              <Card key={b.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    ימים חסרים: <span style={{ color: missingDays[b.id] > 0 ? '#dc2626' : '#059669', fontWeight: 700 }}>{missingDays[b.id]}</span>
                  </div>
                </div>
                <CalendarGrid year={year} month={month} render={(d) => {
                  const iso = toIsoDate(d)
                  const hasRev = (days[iso] || 0) > 0
                  const isSat = d.getDay() === 6
                  const isHol = sDays.has(iso)
                  const future = iso > today
                  let bg = '#fef2f2', fg = '#b91c1c'   // missing
                  if (hasRev) { bg = '#dcfce7'; fg = '#166534' }
                  else if (isSat || isHol) { bg = '#f1f5f9'; fg = '#94a3b8' }
                  else if (future) { bg = '#ffffff'; fg = '#cbd5e1' }
                  return (
                    <div title={hasRev ? fmt(days[iso]) : iso} style={{
                      background: bg, color: fg,
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 6, fontSize: 13, fontWeight: 600,
                    }}>{d.getDate()}</div>
                  )
                }} />
                <Legend3 />
              </Card>
            )
          })}

          {/* Anomalies */}
          <Card>
            <SectionTitle icon={<AlertTriangle size={14} color="#f59e0b" />} title={`חריגות (${anomalies.length})`} />
            {anomalies.length === 0 ? <Empty>אין חריגות לתקופה</Empty> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                    <Th>תאריך</Th><Th>סניף</Th><Th>סכום</Th><Th>ממוצע</Th><Th>יחס</Th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((a, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <Td>{new Date(a.date + 'T12:00:00').toLocaleDateString('he-IL')}</Td>
                      <Td>{a.branchName}</Td>
                      <Td mono>{fmt(a.amount)}</Td>
                      <Td mono>{fmt(a.avg)}</Td>
                      <Td>
                        <span style={{ color: a.ratio >= 2 ? '#059669' : '#dc2626', fontWeight: 700 }}>
                          {a.ratio.toFixed(2)}x
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — Labor estimated vs actual
// ═══════════════════════════════════════════════════════════════════════════
function LaborActualTab() {
  const { branches } = useBranches()
  const [rows, setRows] = useState<Array<{
    branchId: number; branchName: string; year: number; month: number;
    estLabor: number; actLabor: number; estMgr: number; actMgr: number;
  }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (branches.length === 0) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const branchIds = branches.map(b => b.id)
      // Find all (branch, year, month) combos that have employer_costs data
      const { data: empData } = await supabase.from('employer_costs')
        .select('branch_id, year, month, actual_employer_cost, is_manager')
        .in('branch_id', branchIds).range(0, 99999)
      if (cancelled) return
      const combos = new Map<string, { branchId: number; year: number; month: number; actLabor: number; actMgr: number }>()
      for (const r of (empData || [])) {
        const key = `${(r as any).branch_id}-${(r as any).year}-${(r as any).month}`
        const existing = combos.get(key) || { branchId: (r as any).branch_id, year: (r as any).year, month: (r as any).month, actLabor: 0, actMgr: 0 }
        const amt = Number((r as any).actual_employer_cost)
        if ((r as any).is_manager) existing.actMgr += amt
        else existing.actLabor += amt
        combos.set(key, existing)
      }

      const result = [] as typeof rows
      for (const c of combos.values()) {
        const mFrom = `${c.year}-${String(c.month).padStart(2, '0')}-01`
        const lastDay = new Date(c.year, c.month, 0).getDate()
        const mTo = `${c.year}-${String(c.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
        const mk = `${c.year}-${String(c.month).padStart(2, '0')}`

        const [laborRes, fixedRes] = await Promise.all([
          supabase.from('branch_labor').select('hours, hourly_rate, employer_cost')
            .eq('branch_id', c.branchId).gte('date', mFrom).lte('date', mTo).range(0, 99999),
          supabase.from('fixed_costs').select('amount')
            .eq('entity_type', `branch_${c.branchId}`).eq('entity_id', 'mgmt').eq('month', mk),
        ])
        const estLabor = (laborRes.data || []).reduce((s, r) => {
          const h = Number((r as any).hours || 0)
          const rate = Number((r as any).hourly_rate || 0)
          const ec = Number((r as any).employer_cost || 0)
          return s + (h * rate > 0 ? h * rate * 1.3 : ec)
        }, 0)
        const estMgr = (fixedRes.data || []).reduce((s, r) => s + Number((r as any).amount), 0)
        const br = branches.find(x => x.id === c.branchId)
        result.push({
          branchId: c.branchId, branchName: br?.name || `סניף ${c.branchId}`,
          year: c.year, month: c.month, estLabor, actLabor: c.actLabor, estMgr, actMgr: c.actMgr,
        })
      }
      result.sort((a, b) => (b.year - a.year) || (b.month - a.month) || a.branchId - b.branchId)
      if (!cancelled) { setRows(result); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [branches.length])

  function diffColor(est: number, act: number): string {
    if (est === 0 && act === 0) return '#94a3b8'
    const denom = est || act || 1
    const diff = Math.abs((act - est) / denom) * 100
    if (diff < 5) return '#059669'
    if (diff < 15) return '#f59e0b'
    return '#dc2626'
  }

  function exportExcel() {
    const rowsForExcel = rows.map(r => ({
      'סניף': r.branchName, 'חודש': `${r.year}-${String(r.month).padStart(2, '0')}`,
      'לייבור משוער': Math.round(r.estLabor), 'לייבור בפועל': Math.round(r.actLabor),
      'הפרש לייבור ₪': Math.round(r.actLabor - r.estLabor),
      'שכר מנהל משוער': Math.round(r.estMgr), 'שכר מנהל בפועל': Math.round(r.actMgr),
      'הפרש שכר מנהל ₪': Math.round(r.actMgr - r.estMgr),
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsForExcel), 'לייבור משוער/בפועל')
    XLSX.writeFile(wb, 'labor_est_vs_actual.xlsx')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TopBar>
        <div style={{ flex: 1, fontSize: 12, color: '#94a3b8' }}>כל החודשים עם נתוני עלות מעסיק</div>
        <Button onClick={exportExcel} className="bg-indigo-500 hover:bg-indigo-600" disabled={rows.length === 0}>
          <Download size={14} /> ייצוא Excel
        </Button>
      </TopBar>

      {loading && <Loading />}
      {!loading && rows.length === 0 && <Card><Empty>אין נתוני עלות מעסיק</Empty></Card>}

      {!loading && rows.length > 0 && (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                <Th>חודש</Th><Th>סניף</Th>
                <Th>לייבור משוער</Th><Th>לייבור בפועל</Th><Th>הפרש</Th>
                <Th>שכר מנהל משוער</Th><Th>שכר מנהל בפועל</Th><Th>הפרש</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const laborDiff = r.actLabor - r.estLabor
                const laborPct = r.estLabor > 0 ? (laborDiff / r.estLabor) * 100 : 0
                const mgrDiff = r.actMgr - r.estMgr
                const mgrPct = r.estMgr > 0 ? (mgrDiff / r.estMgr) * 100 : 0
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <Td>{`${r.year}-${String(r.month).padStart(2, '0')}`}</Td>
                    <Td>{r.branchName}</Td>
                    <Td mono>{fmt(r.estLabor)}</Td>
                    <Td mono>{fmt(r.actLabor)}</Td>
                    <Td>
                      <span style={{ color: diffColor(r.estLabor, r.actLabor), fontWeight: 700 }}>
                        {fmt(laborDiff)} <span style={{ fontSize: 11, opacity: 0.8 }}>({pct(laborPct)})</span>
                      </span>
                    </Td>
                    <Td mono>{fmt(r.estMgr)}</Td>
                    <Td mono>{fmt(r.actMgr)}</Td>
                    <Td>
                      <span style={{ color: diffColor(r.estMgr, r.actMgr), fontWeight: 700 }}>
                        {fmt(mgrDiff)} <span style={{ fontSize: 11, opacity: 0.8 }}>({pct(mgrPct)})</span>
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — Cashier control
// ═══════════════════════════════════════════════════════════════════════════
function CashierControlTab() {
  const { period, setPeriod, from, to } = usePeriod()
  const { branches } = useBranches()

  const [weekClosings, setWeekClosings] = useState<Array<{ branch_id: number; register_number: number; date: string }>>([])
  const [monthClosings, setMonthClosings] = useState<Array<{ branch_id: number; register_number: number; date: string; variance: number }>>([])
  const [funds, setFunds] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (branches.length === 0) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const branchIds = branches.map(b => b.id)
      const now = new Date()
      const dow = now.getDay()                                      // 0=Sun, 6=Sat
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - dow)
      const weekStartIso = toIsoDate(weekStart)

      const [weekRes, monthRes, fundsRes] = await Promise.all([
        supabase.from('register_closings').select('branch_id, register_number, date')
          .in('branch_id', branchIds).gte('date', weekStartIso).range(0, 99999),
        supabase.from('register_closings').select('branch_id, register_number, date, variance')
          .in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
        supabase.from('change_fund').select('branch_id, balance_after, created_at')
          .in('branch_id', branchIds).order('created_at', { ascending: false }).range(0, 99999),
      ])
      if (cancelled) return

      setWeekClosings((weekRes.data || []) as any)
      setMonthClosings((monthRes.data || []) as any)

      // Latest balance per branch
      const seen: Record<number, number> = {}
      for (const r of (fundsRes.data || [])) {
        const bId = (r as any).branch_id as number
        if (!(bId in seen)) seen[bId] = Number((r as any).balance_after)
      }
      setFunds(seen)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [branches.length, from, to])

  // Registers not closed today (per branch)
  const unclosedToday = useMemo(() => {
    const today = toIsoDate(new Date())
    const out: Array<{ branchId: number; branchName: string; registerNumber: number }> = []
    for (const b of branches) {
      const regs = BRANCH_REGISTERS[b.id] || []
      const closedTodaySet = new Set(weekClosings.filter(c => c.branch_id === b.id && c.date === today).map(c => c.register_number))
      for (const r of regs) {
        if (!closedTodaySet.has(r)) out.push({ branchId: b.id, branchName: b.name, registerNumber: r })
      }
    }
    return out
  }, [weekClosings, branches])

  // Recurring negative variance (>=3 in the period)
  const recurringIssues = useMemo(() => {
    const counts = new Map<string, { branchId: number; branchName: string; register: number; times: number; total: number }>()
    for (const r of monthClosings) {
      if (Number(r.variance) >= 0) continue
      const key = `${r.branch_id}:${r.register_number}`
      const br = branches.find(b => b.id === r.branch_id)
      const prev = counts.get(key) || {
        branchId: r.branch_id, branchName: br?.name || `סניף ${r.branch_id}`,
        register: r.register_number, times: 0, total: 0,
      }
      prev.times += 1
      prev.total += Number(r.variance)
      counts.set(key, prev)
    }
    return [...counts.values()].filter(c => c.times >= 3).sort((a, b) => a.total - b.total)
  }, [monthClosings, branches])

  // Cumulative shortages per register for the period
  const cumulativeByRegister = useMemo(() => {
    const map = new Map<string, { branchName: string; register: number; total: number }>()
    for (const r of monthClosings) {
      if (Number(r.variance) >= 0) continue
      const key = `${r.branch_id}:${r.register_number}`
      const br = branches.find(b => b.id === r.branch_id)
      const prev = map.get(key) || { branchName: br?.name || `סניף ${r.branch_id}`, register: r.register_number, total: 0 }
      prev.total += Number(r.variance)
      map.set(key, prev)
    }
    return [...map.values()].sort((a, b) => a.total - b.total)
  }, [monthClosings, branches])

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      unclosedToday.map(u => ({ 'סניף': u.branchName, 'קופה': u.registerNumber }))
    ), 'קופות לא נסגרו היום')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      recurringIssues.map(r => ({ 'סניף': r.branchName, 'קופה': r.register, 'מספר פערים שליליים': r.times, 'סה"כ חוסרים': Math.round(r.total) }))
    ), 'פערים חוזרים')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      branches.map(b => ({ 'סניף': b.name, 'יתרת קופת עודף': Math.round(funds[b.id] || 0) }))
    ), 'קופת עודף')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      cumulativeByRegister.map(c => ({ 'סניף': c.branchName, 'קופה': c.register, 'סה"כ חוסרים': Math.round(c.total) }))
    ), 'חוסרים מצטברים')
    XLSX.writeFile(wb, `cashier_control_${period.monthKey || from.slice(0, 7)}.xlsx`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TopBar>
        <PeriodPicker period={period} onChange={setPeriod} />
        <div style={{ flex: 1 }} />
        <Button onClick={exportExcel} className="bg-indigo-500 hover:bg-indigo-600"><Download size={14} /> ייצוא Excel</Button>
      </TopBar>

      {loading && <Loading />}

      {!loading && (
        <>
          <Card>
            <SectionTitle icon={<AlertTriangle size={14} color="#dc2626" />} title={`קופות לא נסגרו היום (${unclosedToday.length})`} />
            {unclosedToday.length === 0 ? <Empty>כל הקופות סגורות ✓</Empty> : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unclosedToday.map((u, i) => (
                  <span key={i} style={{ background: '#fee2e2', color: '#991b1b', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                    {u.branchName} · קופה {u.registerNumber}
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle icon={<TrendingDown size={14} color="#dc2626" />} title={`פערים חוזרים (${recurringIssues.length})`} />
            {recurringIssues.length === 0 ? <Empty>אין פערים חוזרים</Empty> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: '#f8fafc', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                  <Th>סניף</Th><Th>קופה</Th><Th>פעמים</Th><Th>סה"כ חוסרים</Th>
                </tr></thead>
                <tbody>
                  {recurringIssues.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <Td>{r.branchName}</Td><Td>{r.register}</Td>
                      <Td>{r.times}</Td>
                      <Td mono><span style={{ color: '#dc2626', fontWeight: 700 }}>{fmt(r.total)}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <SectionTitle icon={<Wallet size={14} color="#6366f1" />} title="יתרות קופת עודף" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {branches.map(b => (
                <div key={b.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{b.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>{fmt(funds[b.id] || 0)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle icon={<BarChart3 size={14} color="#94a3b8" />} title="חוסרים מצטברים לפי קופה (התקופה)" />
            {cumulativeByRegister.length === 0 ? <Empty>אין חוסרים בתקופה</Empty> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: '#f8fafc', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                  <Th>סניף</Th><Th>קופה</Th><Th>סה"כ חוסרים</Th>
                </tr></thead>
                <tbody>
                  {cumulativeByRegister.map((c, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <Td>{c.branchName}</Td><Td>{c.register}</Td>
                      <Td mono><span style={{ color: '#dc2626', fontWeight: 700 }}>{fmt(c.total)}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4 — Period comparison
// ═══════════════════════════════════════════════════════════════════════════
interface PeriodRange { from: string; to: string; monthKey: string; label: string }

function monthRange(monthKey: string): PeriodRange {
  const [y, m] = monthKey.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const nextM = m === 12 ? 1 : m + 1
  const nextY = m === 12 ? y + 1 : y
  const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`
  return { from: start, to: end, monthKey, label: monthKey }
}

function ComparisonTab() {
  const { branches } = useBranches()
  const nowMk = new Date().toISOString().slice(0, 7)
  const [mkA, setMkA] = useState(nowMk)
  const [mkB, setMkB] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1)
    return d.toISOString().slice(0, 7)
  })
  const [rowsA, setRowsA] = useState<PLResult[]>([])
  const [rowsB, setRowsB] = useState<PLResult[]>([])
  const [trend, setTrend] = useState<Array<Record<string, number | string>>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (branches.length === 0) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const pA = monthRange(mkA), pB = monthRange(mkB)
      const [a, b] = await Promise.all([
        Promise.all(branches.map(br => calculateBranchPL(br.id, pA.from, pA.to, undefined, pA.monthKey))),
        Promise.all(branches.map(br => calculateBranchPL(br.id, pB.from, pB.to, undefined, pB.monthKey))),
      ])
      if (cancelled) return
      setRowsA(a); setRowsB(b)

      // 6-month trend per branch
      const months: string[] = []
      const end = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(end.getFullYear(), end.getMonth() - i, 1)
        months.push(d.toISOString().slice(0, 7))
      }
      const trendRows: Array<Record<string, number | string>> = []
      for (const mk of months) {
        const pr = monthRange(mk)
        const { data } = await supabase.from('branch_revenue').select('branch_id, amount')
          .gte('date', pr.from).lt('date', pr.to).range(0, 99999)
        const row: Record<string, number | string> = { month: mk }
        for (const br of branches) row[br.name] = 0
        for (const r of (data || [])) {
          const bId = (r as any).branch_id as number
          const br = branches.find(x => x.id === bId)
          if (br) row[br.name] = (Number(row[br.name] || 0) + Number((r as any).amount))
        }
        trendRows.push(row)
      }
      if (!cancelled) { setTrend(trendRows); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [mkA, mkB, branches.length])

  function exportExcel() {
    const data = branches.map((br, i) => {
      const a = rowsA[i], b = rowsB[i]
      if (!a || !b) return null
      return {
        'סניף': br.name,
        [`הכנסות ${mkA}`]: Math.round(a.revenue), [`הכנסות ${mkB}`]: Math.round(b.revenue),
        'דלתא הכנסות': Math.round(a.revenue - b.revenue),
        [`לייבור% ${mkA}`]: a.revenue > 0 ? Number(((a.labor + a.managerSalary) / a.revenue * 100).toFixed(1)) : 0,
        [`לייבור% ${mkB}`]: b.revenue > 0 ? Number(((b.labor + b.managerSalary) / b.revenue * 100).toFixed(1)) : 0,
        [`פחת% ${mkA}`]: a.revenue > 0 ? Number((a.waste / a.revenue * 100).toFixed(1)) : 0,
        [`פחת% ${mkB}`]: b.revenue > 0 ? Number((b.waste / b.revenue * 100).toFixed(1)) : 0,
        [`רווח נשלט ${mkA}`]: Math.round(a.controllableProfit), [`רווח נשלט ${mkB}`]: Math.round(b.controllableProfit),
        [`רווח תפעולי ${mkA}`]: Math.round(a.operatingProfit), [`רווח תפעולי ${mkB}`]: Math.round(b.operatingProfit),
      }
    }).filter(Boolean)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data as any[]), 'השוואת תקופות')
    XLSX.writeFile(wb, `comparison_${mkA}_vs_${mkB}.xlsx`)
  }

  function MonthInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <input type="month" value={value} onChange={e => onChange(e.target.value)}
        style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 12px', fontSize: 14, fontFamily: 'inherit' }} />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TopBar>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>תקופה א׳</span>
          <MonthInput value={mkA} onChange={setMkA} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>תקופה ב׳</span>
          <MonthInput value={mkB} onChange={setMkB} />
        </div>
        <div style={{ flex: 1 }} />
        <Button onClick={exportExcel} className="bg-indigo-500 hover:bg-indigo-600" disabled={rowsA.length === 0}><Download size={14} /> ייצוא Excel</Button>
      </TopBar>

      {loading && <Loading />}

      {!loading && rowsA.length > 0 && (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                <Th>סניף</Th>
                <Th>{`הכנסות ${mkA}`}</Th><Th>{`הכנסות ${mkB}`}</Th><Th>Δ</Th>
                <Th>{`לייבור% ${mkA}`}</Th><Th>{`לייבור% ${mkB}`}</Th>
                <Th>{`פחת% ${mkA}`}</Th><Th>{`פחת% ${mkB}`}</Th>
                <Th>{`נשלט ${mkA}`}</Th><Th>{`נשלט ${mkB}`}</Th>
                <Th>{`תפעולי ${mkA}`}</Th><Th>{`תפעולי ${mkB}`}</Th>
              </tr>
            </thead>
            <tbody>
              {branches.map((br, i) => {
                const a = rowsA[i], b = rowsB[i]
                if (!a || !b) return null
                const dRev = a.revenue - b.revenue
                const aLabPct = a.revenue > 0 ? (a.labor + a.managerSalary) / a.revenue * 100 : 0
                const bLabPct = b.revenue > 0 ? (b.labor + b.managerSalary) / b.revenue * 100 : 0
                const aWstPct = a.revenue > 0 ? a.waste / a.revenue * 100 : 0
                const bWstPct = b.revenue > 0 ? b.waste / b.revenue * 100 : 0
                const up = dRev > 0
                return (
                  <tr key={br.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <Td>{br.name}</Td>
                    <Td mono>{fmt(a.revenue)}</Td><Td mono>{fmt(b.revenue)}</Td>
                    <Td>
                      <span style={{ color: up ? '#059669' : '#dc2626', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {fmt(dRev)}
                      </span>
                    </Td>
                    <Td>{aLabPct.toFixed(1)}%</Td><Td>{bLabPct.toFixed(1)}%</Td>
                    <Td>{aWstPct.toFixed(1)}%</Td><Td>{bWstPct.toFixed(1)}%</Td>
                    <Td mono>{fmt(a.controllableProfit)}</Td><Td mono>{fmt(b.controllableProfit)}</Td>
                    <Td mono>{fmt(a.operatingProfit)}</Td><Td mono>{fmt(b.operatingProfit)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {!loading && trend.length > 0 && (
        <Card>
          <SectionTitle icon={<BarChart3 size={14} color="#6366f1" />} title="הכנסות 6 חודשים אחרונים" />
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => '₪' + (v / 1000).toFixed(0) + 'K'} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {branches.map((br, i) => (
                  <Line key={br.id} type="monotone" dataKey={br.name} stroke={['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'][i % 5]} strokeWidth={2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 6 — Data integrity
// ═══════════════════════════════════════════════════════════════════════════
function DataIntegrityTab() {
  const { period, setPeriod, from, to } = usePeriod()
  const { branches } = useBranches()
  const { year, month } = parseMonthKey(period.monthKey || from.slice(0, 7))

  const [scores, setScores] = useState<Array<{
    branchId: number; branchName: string;
    revPct: number; laborPct: number; wastePct: number;
    employerUploaded: boolean; registersClosed: number; registersTotal: number;
    overall: number;
  }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (branches.length === 0) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const branchIds = branches.map(b => b.id)
      const today = toIsoDate(new Date())
      // All workdays in month up to today (excludes Saturdays, includes holidays — simple heuristic)
      const workdays: string[] = []
      for (const d of monthDays(year, month)) {
        const iso = toIsoDate(d)
        if (iso > today) break
        if (d.getDay() !== 6) workdays.push(iso)
      }
      const totalWorkdays = workdays.length || 1

      const [revRes, laborRes, wasteRes, uploadsRes, closingsRes, specialRes] = await Promise.all([
        supabase.from('branch_revenue').select('branch_id, date').in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
        supabase.from('branch_labor').select('branch_id, date').in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
        supabase.from('branch_waste').select('branch_id, date').in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
        supabase.from('employer_costs_uploads').select('branch_id').eq('month', month).eq('year', year),
        supabase.from('register_closings').select('branch_id, register_number, date').in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
        supabase.from('special_days').select('branch_id, date').in('branch_id', branchIds).gte('date', from).lt('date', to).range(0, 99999),
      ])
      if (cancelled) return

      const specByBr: Record<number, Set<string>> = {}
      for (const b of branchIds) specByBr[b] = new Set()
      for (const s of (specialRes.data || [])) specByBr[(s as any).branch_id]?.add((s as any).date)

      const uploadedSet = new Set<number>()
      for (const u of (uploadsRes.data || [])) {
        const bId = (u as any).branch_id
        if (bId !== null && bId !== undefined) uploadedSet.add(bId)
      }

      function distinctDates(rows: any[] | null, bId: number, excludeHolidays: boolean): number {
        const set = new Set<string>()
        for (const r of (rows || [])) {
          if (r.branch_id !== bId) continue
          const d = r.date as string
          if (excludeHolidays && specByBr[bId]?.has(d)) continue
          set.add(d)
        }
        return set.size
      }

      const result = [] as typeof scores
      for (const b of branches) {
        const revDays = distinctDates(revRes.data, b.id, true)
        const laborDays = distinctDates(laborRes.data, b.id, true)
        const wasteDays = distinctDates(wasteRes.data, b.id, true)
        // Revenue: if no register_closings exist for the branch, count branch_revenue rows
        // Register closings take precedence — sum distinct dates from both
        const revDaysFromClosings = distinctDates(closingsRes.data, b.id, true)
        const revTotal = Math.max(revDays, revDaysFromClosings)

        const workdaysExHoliday = workdays.filter(d => !specByBr[b.id]?.has(d)).length || 1

        const revPct = Math.min(100, (revTotal / workdaysExHoliday) * 100)
        const laborPct = Math.min(100, (laborDays / workdaysExHoliday) * 100)
        const wastePct = Math.min(100, (wasteDays / workdaysExHoliday) * 100)

        // Active registers closed on last workday
        const regs = BRANCH_REGISTERS[b.id] || []
        const lastWorkday = workdays[workdays.length - 1]
        const closedSet = new Set(
          (closingsRes.data || []).filter((c: any) => c.branch_id === b.id && c.date === lastWorkday).map((c: any) => c.register_number)
        )
        const closed = regs.filter(r => closedSet.has(r)).length

        const uploaded = uploadedSet.has(b.id)
        const regScore = regs.length > 0 ? (closed / regs.length) * 100 : 100
        const uploadScore = uploaded ? 100 : 0

        // Weighted overall: revenue 30%, labor 25%, waste 15%, uploads 15%, registers 15%
        const overall = revPct * 0.30 + laborPct * 0.25 + wastePct * 0.15 + uploadScore * 0.15 + regScore * 0.15

        result.push({
          branchId: b.id, branchName: b.name,
          revPct, laborPct, wastePct,
          employerUploaded: uploaded, registersClosed: closed, registersTotal: regs.length,
          overall,
        })
      }
      if (!cancelled) { setScores(result); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [branches.length, from, to, year, month])

  function scoreColor(n: number): string {
    if (n >= 90) return '#059669'
    if (n >= 70) return '#f59e0b'
    return '#dc2626'
  }
  function scoreBg(n: number): string {
    if (n >= 90) return '#dcfce7'
    if (n >= 70) return '#fef3c7'
    return '#fee2e2'
  }

  function exportExcel() {
    const rows = scores.map(s => ({
      'סניף': s.branchName,
      'הכנסות %': Math.round(s.revPct), 'לייבור %': Math.round(s.laborPct), 'פחת %': Math.round(s.wastePct),
      'עלות מעסיק הועלה': s.employerUploaded ? 'כן' : 'לא',
      'קופות נסגרו': `${s.registersClosed}/${s.registersTotal}`,
      'ציון כולל': Math.round(s.overall),
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'שלמות נתונים')
    XLSX.writeFile(wb, `data_integrity_${period.monthKey || from.slice(0, 7)}.xlsx`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TopBar>
        <PeriodPicker period={period} onChange={setPeriod} />
        <div style={{ flex: 1 }} />
        <Button onClick={exportExcel} className="bg-indigo-500 hover:bg-indigo-600"><Download size={14} /> ייצוא Excel</Button>
      </TopBar>

      {loading && <Loading />}

      {!loading && (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                <Th>סניף</Th>
                <Th>הכנסות %</Th><Th>לייבור %</Th><Th>פחת %</Th>
                <Th>עלות מעסיק</Th><Th>קופות נסגרו</Th>
                <Th>ציון כולל</Th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <Td>{s.branchName}</Td>
                  <Td><Pill value={s.revPct} /></Td>
                  <Td><Pill value={s.laborPct} /></Td>
                  <Td><Pill value={s.wastePct} /></Td>
                  <Td>{s.employerUploaded ? <span style={{ color: '#059669', fontWeight: 700 }}>✓</span> : <span style={{ color: '#dc2626', fontWeight: 700 }}>✗</span>}</Td>
                  <Td><span style={{ fontWeight: 700 }}>{s.registersClosed}/{s.registersTotal}</span></Td>
                  <Td>
                    <span style={{
                      background: scoreBg(s.overall), color: scoreColor(s.overall),
                      padding: '4px 12px', borderRadius: 999, fontSize: 13, fontWeight: 800,
                    }}>{Math.round(s.overall)}%</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )

  function Pill({ value }: { value: number }) {
    return (
      <span style={{
        background: scoreBg(value), color: scoreColor(value),
        padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
      }}>{Math.round(value)}%</span>
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared UI bits
// ═══════════════════════════════════════════════════════════════════════════
function TopBar({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
      {children}
    </div>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
      {icon} {title}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{children}</th>
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td style={{ padding: '8px 10px', color: '#475569', fontFamily: mono ? 'monospace' : 'inherit' }}>{children}</td>
}

function Loading() {
  return <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>טוען...</div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>{children}</div>
}

function Legend3() {
  const chip = (bg: string, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}>
      <span style={{ width: 10, height: 10, background: bg, borderRadius: 2 }} /> {label}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
      {chip('#dcfce7', 'הוזן')}
      {chip('#fef2f2', 'חסר')}
      {chip('#f1f5f9', 'שבת/חג')}
    </div>
  )
}

function CalendarGrid({ year, month, render }: { year: number; month: number; render: (d: Date) => React.ReactNode }) {
  const days = monthDays(year, month)
  const first = days[0]
  const leadingBlanks = first.getDay()                               // 0..6 (Sun..Sat)
  const weekdayLabels = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {weekdayLabels.map(l => (
          <div key={l} style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textAlign: 'center', padding: '4px 0' }}>{l}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={'b' + i} style={{ aspectRatio: '1 / 1' }} />
        ))}
        {days.map(d => (
          <div key={toIsoDate(d)} style={{ aspectRatio: '1 / 1' }}>
            {render(d)}
          </div>
        ))}
      </div>
    </div>
  )
}
