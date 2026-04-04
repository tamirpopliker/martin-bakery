import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, getOverheadPct } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { useBranches } from '../lib/BranchContext'
import { ArrowRight, BarChart3 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import PeriodPicker from '../components/PeriodPicker'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// ─── Types ──────────────────────────────────────────────────────────────────
interface BranchPL {
  id: number
  name: string
  color: string
  revenue: number
  labor: number
  suppliers: number
  repairs: number
  deliveries: number
  fixedCosts: number
  admin: number
  waste: number
  overhead: number
  operatingProfit: number
}

type PLKey = 'revenue' | 'labor' | 'suppliers' | 'repairs' | 'deliveries' | 'fixedCosts' | 'admin' | 'waste' | 'overhead' | 'operatingProfit'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

const fmtK = (n: number) => {
  if (n === 0) return '—'
  const prefix = n < 0 ? '-' : ''
  return prefix + '₪' + Math.abs(Math.round(n)).toLocaleString()
}

const fmtPct = (value: number, revenue: number) => {
  if (revenue === 0) return '(0.0%)'
  const pct = (Math.abs(value) / revenue) * 100
  return `(${pct.toFixed(1)}%)`
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function BranchComparisonDashboard({ onBack }: { onBack: () => void }) {
  const { period, setPeriod, from, to, monthKey } = usePeriod()
  const { branches } = useBranches()

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [data, setData] = useState<BranchPL[]>([])
  const [loading, setLoading] = useState(true)

  // Initialize selected branches when branches load
  useEffect(() => {
    if (branches.length > 0 && selectedIds.length === 0) {
      setSelectedIds(branches.map(b => b.id))
    }
  }, [branches])

  // Load data
  useEffect(() => {
    if (selectedIds.length === 0) { setData([]); setLoading(false); return }

    async function load() {
      setLoading(true)
      const overheadPct = await getOverheadPct()
      const results: BranchPL[] = []

      for (const br of branches.filter(b => selectedIds.includes(b.id))) {
        const [revRes, labRes, expRes, wasteRes, fcRes] = await Promise.all([
          supabase.from('branch_revenue').select('amount')
            .eq('branch_id', br.id).gte('date', from).lt('date', to),
          supabase.from('branch_labor').select('employer_cost')
            .eq('branch_id', br.id).gte('date', from).lt('date', to),
          supabase.from('branch_expenses').select('amount, expense_type')
            .eq('branch_id', br.id).gte('date', from).lt('date', to),
          supabase.from('branch_waste').select('amount')
            .eq('branch_id', br.id).gte('date', from).lt('date', to),
          supabase.from('fixed_costs').select('amount, entity_id')
            .eq('entity_type', `branch_${br.id}`)
            .eq('month', monthKey || from.slice(0, 7)),
        ])

        const revenue = (revRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
        const labor = (labRes.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)

        const expenses = expRes.data || []
        const suppliers = expenses.filter(r => r.expense_type === 'suppliers').reduce((s, r) => s + Number(r.amount), 0)
        const repairs = expenses.filter(r => r.expense_type === 'repairs').reduce((s, r) => s + Number(r.amount), 0)
        const deliveries = expenses.filter(r => r.expense_type === 'deliveries').reduce((s, r) => s + Number(r.amount), 0)

        const fcData = fcRes.data || []
        const fixedCosts = fcData.filter(r => r.entity_id !== 'mgmt').reduce((s, r) => s + Number(r.amount), 0)
        const admin = fcData.filter(r => r.entity_id === 'mgmt').reduce((s, r) => s + Number(r.amount), 0)
        const waste = (wasteRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
        const overhead = revenue * overheadPct / 100

        const operatingProfit = revenue - labor - suppliers - repairs - deliveries - fixedCosts - admin - waste - overhead

        results.push({
          id: br.id, name: br.name, color: br.color,
          revenue, labor, suppliers, repairs, deliveries, fixedCosts, admin, waste, overhead, operatingProfit,
        })
      }

      setData(results)
      setLoading(false)
    }
    load()
  }, [selectedIds, from, to])

  // Toggle branch selection
  function toggleBranch(id: number) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function selectAll() {
    setSelectedIds(branches.map(b => b.id))
  }

  // Totals
  const totals: Record<PLKey, number> = {
    revenue: data.reduce((s, d) => s + d.revenue, 0),
    labor: data.reduce((s, d) => s + d.labor, 0),
    suppliers: data.reduce((s, d) => s + d.suppliers, 0),
    repairs: data.reduce((s, d) => s + d.repairs, 0),
    deliveries: data.reduce((s, d) => s + d.deliveries, 0),
    fixedCosts: data.reduce((s, d) => s + d.fixedCosts, 0),
    admin: data.reduce((s, d) => s + d.admin, 0),
    waste: data.reduce((s, d) => s + d.waste, 0),
    overhead: data.reduce((s, d) => s + d.overhead, 0),
    operatingProfit: data.reduce((s, d) => s + d.operatingProfit, 0),
  }

  // Chart data
  const chartData = data.map(d => ({
    name: d.name,
    'הכנסות': d.revenue,
    'רווח תפעולי': d.operatingProfit,
  }))

  // P&L rows
  const plRows: { label: string; key: PLKey; positive: boolean; bold?: boolean }[] = [
    { label: 'הכנסות', key: 'revenue', positive: true },
    { label: 'לייבור', key: 'labor', positive: false },
    { label: 'ספקים', key: 'suppliers', positive: false },
    { label: 'תיקונים', key: 'repairs', positive: false },
    { label: 'משלוחים', key: 'deliveries', positive: false },
    { label: 'הוצאות קבועות', key: 'fixedCosts', positive: false },
    { label: 'הנהלה וכלליות', key: 'admin', positive: false },
    { label: 'פחת וסחורה שנזרקה', key: 'waste', positive: false },
    { label: 'העמסת מטה', key: 'overhead', positive: false },
    { label: 'רווח תפעולי', key: 'operatingProfit', positive: true, bold: true },
  ]

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} /> חזרה
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '40px', height: '40px', background: '#818cf8', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BarChart3 size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: 0 }}>השוואת סניפים</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>רווח והפסד השוואתי · {data.length} סניפים נבחרו</p>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>

      <div style={{ padding: '28px 36px', maxWidth: '1200px', margin: '0 auto' }}>

        {/* Branch selector */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b' }}>סניפים:</span>
            <button onClick={selectAll}
              style={{
                padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                border: selectedIds.length === branches.length ? '2px solid #818cf8' : '1px solid #e2e8f0',
                background: selectedIds.length === branches.length ? '#eef2ff' : 'white',
                color: selectedIds.length === branches.length ? '#4f46e5' : '#64748b',
              }}>
              הכל
            </button>
            {branches.map(br => (
              <button key={br.id} onClick={() => toggleBranch(br.id)}
                style={{
                  padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                  border: selectedIds.includes(br.id) ? `2px solid ${br.color}` : '1px solid #e2e8f0',
                  background: selectedIds.includes(br.id) ? br.color + '15' : 'white',
                  color: selectedIds.includes(br.id) ? br.color : '#64748b',
                }}>
                {br.name} {selectedIds.includes(br.id) ? '✓' : ''}
              </button>
            ))}
          </div>
        </motion.div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8', fontSize: '16px' }}>טוען נתונים...</div>
        ) : data.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8', fontSize: '16px' }}>בחר לפחות סניף אחד</div>
        ) : (
          <>
            {/* P&L Comparison Table */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible" style={{ marginBottom: '24px' }}>
              <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `160px ${data.map(() => '1fr').join(' ')} 1fr`,
                  padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
                  fontSize: '12px', fontWeight: '700', color: '#64748b',
                }}>
                  <span>שורת P&L</span>
                  {data.map(d => (
                    <span key={d.id} style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: d.color, marginLeft: '6px' }} />
                      {d.name}
                    </span>
                  ))}
                  <span style={{ textAlign: 'center', fontWeight: '800', color: '#0f172a' }}>סה"כ</span>
                </div>

                {plRows.map((row, ri) => {
                  const isProfit = row.key === 'operatingProfit'
                  const isRevenue = row.key === 'revenue'
                  const isLast = ri === plRows.length - 1
                  return (
                    <div key={row.key} style={{
                      display: 'grid',
                      gridTemplateColumns: `160px ${data.map(() => '1fr').join(' ')} 1fr`,
                      padding: '12px 20px', borderBottom: '1px solid #f1f5f9',
                      fontSize: '13px', alignItems: 'center',
                      background: isLast ? '#f8fafc' : isRevenue ? '#f0fdf4' : 'white',
                      fontWeight: row.bold ? '700' : '400',
                    }}>
                      <span style={{ fontWeight: '600', color: '#374151' }}>{row.label}</span>
                      {data.map(d => {
                        const val = d[row.key]
                        const displayVal = isRevenue ? val : -Math.abs(val)
                        const color = val === 0 ? '#94a3b8'
                          : isProfit ? (val >= 0 ? '#16a34a' : '#dc2626')
                          : isRevenue ? '#0f172a' : '#64748b'
                        return (
                          <span key={d.id} style={{ textAlign: 'center', color, fontWeight: row.bold ? '800' : '500' }}>
                            {isRevenue
                              ? fmtK(val)
                              : isProfit
                                ? `${fmtK(val)} ${fmtPct(val, d.revenue)}`
                                : `${fmtK(displayVal)} ${fmtPct(val, d.revenue)}`
                            }
                          </span>
                        )
                      })}
                      <span style={{
                        textAlign: 'center', fontWeight: '800',
                        color: isProfit
                          ? (totals.operatingProfit >= 0 ? '#16a34a' : '#dc2626')
                          : '#0f172a',
                      }}>
                        {isRevenue
                          ? fmtK(totals[row.key])
                          : isProfit
                            ? `${fmtK(totals[row.key])} ${fmtPct(totals[row.key], totals.revenue)}`
                            : `${fmtK(-Math.abs(totals[row.key]))} ${fmtPct(totals[row.key], totals.revenue)}`
                        }
                      </span>
                    </div>
                  )
                })}

                {/* Margin % row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `160px ${data.map(() => '1fr').join(' ')} 1fr`,
                  padding: '12px 20px', fontSize: '12px', alignItems: 'center',
                  background: '#eef2ff',
                }}>
                  <span style={{ fontWeight: '600', color: '#4f46e5' }}>מרג'ין %</span>
                  {data.map(d => {
                    const pct = d.revenue > 0 ? (d.operatingProfit / d.revenue) * 100 : 0
                    return (
                      <span key={d.id} style={{ textAlign: 'center', fontWeight: '700', color: pct >= 0 ? '#16a34a' : '#dc2626' }}>
                        {pct.toFixed(1)}%
                      </span>
                    )
                  })}
                  <span style={{
                    textAlign: 'center', fontWeight: '800',
                    color: totals.revenue > 0 && totals.operatingProfit >= 0 ? '#16a34a' : '#dc2626',
                  }}>
                    {totals.revenue > 0 ? ((totals.operatingProfit / totals.revenue) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              </Card>
            </motion.div>

            {/* Bar Chart */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.15 }}>
              <Card className="shadow-sm">
                <CardContent className="p-5">
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '16px' }}>
                    הכנסות מול רווח תפעולי
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartData} layout="vertical" barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}K`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#374151', fontWeight: 600 }} width={90} />
                      <Tooltip
                        formatter={(value: number, name: string) => [`₪${Math.round(value).toLocaleString()}`, name]}
                        contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px', direction: 'rtl' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                      <Bar dataKey="הכנסות" fill="#818cf8" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="רווח תפעולי" fill="#34d399" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
