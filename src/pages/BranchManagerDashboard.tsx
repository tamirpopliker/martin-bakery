import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ArrowRight, Store, TrendingUp, TrendingDown, Minus, Trash2 } from 'lucide-react'
import { RevenueIcon, ProfitIcon, LaborIcon, FixedCostIcon } from '@/components/icons'

const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.1 } } }
const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } } }
const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props {
  onBack: () => void
}

interface BranchData {
  id: number
  name: string
  color: string
  revCashier: number
  revWebsite: number
  revCredit: number
  totalRevenue: number
  expSuppliers: number
  expRepairs: number
  expInfra: number
  expDelivery: number
  expOther: number
  totalExpenses: number
  laborGross: number
  laborEmployer: number
  wasteTotal: number
  fixedCosts: number
  mgmtCosts: number
  grossProfit: number
  operatingProfit: number
  laborPct: number
  wastePct: number
  grossPct: number
  operatingPct: number
}

const BRANCHES = [
  { id: 1, name: 'אברהם אבינו', color: '#818cf8' },
  { id: 2, name: 'הפועלים',     color: '#34d399' },
  { id: 3, name: 'יעקב כהן',   color: '#c084fc' },
]

function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString() }

export default function BranchManagerDashboard({ onBack }: Props) {
  const { period, setPeriod, from, to, comparisonPeriod } = usePeriod()
  const [loading, setLoading] = useState(true)
  const [branches, setBranches] = useState<BranchData[]>([])
  const [prevBranches, setPrevBranches] = useState<BranchData[]>([])
  const [overheadPct, setOverheadPct] = useState(() => {
    const saved = localStorage.getItem('overhead_pct')
    return saved ? Number(saved) : 5
  })
  const brOH = (br: BranchData) => br.totalRevenue * overheadPct / 100
  const brOP = (br: BranchData) => br.operatingProfit - brOH(br)

  async function fetchBranchData(branchId: number, name: string, color: string, dateFrom: string, dateTo: string, monthKey: string): Promise<BranchData> {
    const entityType = `branch_${branchId}`

    const [revRes, expRes, labRes, wstRes, fcRes] = await Promise.all([
      supabase.from('branch_revenue').select('source, amount').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('branch_expenses').select('expense_type, amount').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('branch_labor').select('employer_cost, gross_salary').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('branch_waste').select('amount').eq('branch_id', branchId).gte('date', dateFrom).lt('date', dateTo),
      supabase.from('fixed_costs').select('amount, entity_id').eq('entity_type', entityType).eq('month', monthKey),
    ])

    const revData = revRes.data || []
    const expData = expRes.data || []
    const labData = labRes.data || []
    const wstData = wstRes.data || []
    const fcData = fcRes.data || []

    const revCashier = revData.filter(r => r.source === 'cashier').reduce((s, r) => s + Number(r.amount), 0)
    const revWebsite = revData.filter(r => r.source === 'website').reduce((s, r) => s + Number(r.amount), 0)
    const revCredit = revData.filter(r => r.source === 'credit').reduce((s, r) => s + Number(r.amount), 0)
    const totalRevenue = revCashier + revWebsite + revCredit

    const expSuppliers = expData.filter(r => r.expense_type === 'suppliers' || r.expense_type === 'supplier').reduce((s, r) => s + Number(r.amount), 0)
    const expRepairs = expData.filter(r => r.expense_type === 'repairs' || r.expense_type === 'repair').reduce((s, r) => s + Number(r.amount), 0)
    const expInfra = expData.filter(r => r.expense_type === 'infrastructure').reduce((s, r) => s + Number(r.amount), 0)
    const expDelivery = expData.filter(r => r.expense_type === 'deliveries' || r.expense_type === 'delivery').reduce((s, r) => s + Number(r.amount), 0)
    const expOther = expData.filter(r => r.expense_type === 'other').reduce((s, r) => s + Number(r.amount), 0)
    const totalExpenses = expSuppliers + expRepairs + expInfra + expDelivery + expOther

    const laborGross = labData.reduce((s, r) => s + Number(r.gross_salary), 0)
    const laborEmployer = labData.reduce((s, r) => s + Number(r.employer_cost), 0)
    const wasteTotal = wstData.reduce((s, r) => s + Number(r.amount), 0)
    const fixedCosts = fcData.filter((r: any) => r.entity_id !== 'mgmt').reduce((s, r) => s + Number(r.amount), 0)
    const mgmtCosts = fcData.filter((r: any) => r.entity_id === 'mgmt').reduce((s, r) => s + Number(r.amount), 0)

    const grossProfit = totalRevenue - laborEmployer - totalExpenses
    const operatingProfit = grossProfit - fixedCosts - mgmtCosts - wasteTotal

    return {
      id: branchId, name, color,
      revCashier, revWebsite, revCredit, totalRevenue,
      expSuppliers, expRepairs, expInfra, expDelivery, expOther, totalExpenses,
      laborGross, laborEmployer, wasteTotal, fixedCosts, mgmtCosts,
      grossProfit, operatingProfit,
      laborPct: totalRevenue > 0 ? (laborEmployer / totalRevenue) * 100 : 0,
      wastePct: totalRevenue > 0 ? (wasteTotal / totalRevenue) * 100 : 0,
      grossPct: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
      operatingPct: totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0,
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const monthKey = from.slice(0, 7)
      const prevMonthKey = comparisonPeriod.from.slice(0, 7)

      const [current, previous] = await Promise.all([
        Promise.all(BRANCHES.map(br => fetchBranchData(br.id, br.name, br.color, from, to, monthKey))),
        Promise.all(BRANCHES.map(br => fetchBranchData(br.id, br.name, br.color, comparisonPeriod.from, comparisonPeriod.to, prevMonthKey))),
      ])

      setBranches(current)
      setPrevBranches(previous)
      setLoading(false)
    }
    load()
  }, [from, to])

  // Totals
  const totals = {
    revenue: branches.reduce((s, b) => s + b.totalRevenue, 0),
    expenses: branches.reduce((s, b) => s + b.totalExpenses, 0),
    labor: branches.reduce((s, b) => s + b.laborEmployer, 0),
    waste: branches.reduce((s, b) => s + b.wasteTotal, 0),
    fixedCosts: branches.reduce((s, b) => s + b.fixedCosts, 0),
    mgmtCosts: branches.reduce((s, b) => s + b.mgmtCosts, 0),
    overhead: branches.reduce((s, b) => s + brOH(b), 0),
    grossProfit: branches.reduce((s, b) => s + b.grossProfit, 0),
    operatingProfit: branches.reduce((s, b) => s + brOP(b), 0),
  }
  const prevTotals = {
    revenue: prevBranches.reduce((s, b) => s + b.totalRevenue, 0),
    grossProfit: prevBranches.reduce((s, b) => s + b.grossProfit, 0),
    operatingProfit: prevBranches.reduce((s, b) => s + brOP(b), 0),
  }
  const totalLaborPct = totals.revenue > 0 ? (totals.labor / totals.revenue) * 100 : 0
  const totalWastePct = totals.revenue > 0 ? (totals.waste / totals.revenue) * 100 : 0

  function DiffArrow({ current, previous }: { current: number; previous: number }) {
    if (previous === 0) return <Minus size={12} color="#94a3b8" />
    const p = ((current - previous) / Math.abs(previous)) * 100
    const color = p > 0 ? '#34d399' : '#fb7185'
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold" style={{ color }}>
        {p > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {Math.abs(p).toFixed(1)}%
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #818cf8, #34d399)', boxShadow: '0 4px 14px rgba(129,140,248,0.3)' }}>
          <ProfitIcon size={22} color="white" />
        </div>
        <div>
          <h1 className="m-0 text-[22px] font-extrabold text-slate-900">דשבורד מנהל סניפים</h1>
          <p className="m-0 text-[13px] text-slate-400">השוואת ביצועים · P&L · KPI</p>
        </div>
        <div className="mr-auto">
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </div>

      {loading && <div className="text-center py-16 text-slate-400">טוען נתונים...</div>}

      {!loading && (
        <div className="page-container px-8 py-6 max-w-[1200px] mx-auto">

          {/* Overhead % control */}
          <div className="flex items-center gap-2 mb-3.5 justify-end">
            <span className="text-[13px] font-semibold text-slate-500">העמסת מטה:</span>
            <input
              type="number"
              value={overheadPct}
              onChange={e => {
                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                setOverheadPct(v)
                localStorage.setItem('overhead_pct', String(v))
              }}
              className="w-[50px] border border-slate-200 rounded-lg px-2 py-1 text-sm text-center font-semibold text-indigo-400 bg-white"
            />
            <span className="text-[13px] text-slate-500">%</span>
          </div>

          {/* KPI Cards */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3.5 mb-6"
          >
            {/* Revenue */}
            <motion.div variants={fadeUp}>
              <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: '#818cf8' }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: '#10B98115' }}>
                      <RevenueIcon size={15} color="#10B981" />
                    </div>
                    <span className="text-xs font-semibold text-slate-500">סה"כ הכנסות</span>
                  </div>
                  <div className="text-[22px] font-extrabold text-slate-900">
                    <CountUp end={Math.round(totals.revenue)} duration={1.5} separator="," prefix="₪" />
                  </div>
                  <DiffArrow current={totals.revenue} previous={prevTotals.revenue} />
                </CardContent>
              </Card>
            </motion.div>

            {/* Expenses */}
            <motion.div variants={fadeUp}>
              <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: '#fb7185' }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: '#fb718515' }}>
                      <FixedCostIcon size={15} color="#fb7185" />
                    </div>
                    <span className="text-xs font-semibold text-slate-500">סה"כ הוצאות</span>
                  </div>
                  <div className="text-[22px] font-extrabold" style={{ color: '#e11d48' }}>
                    <CountUp end={Math.round(totals.expenses)} duration={1.5} separator="," prefix="₪" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Labor % */}
            <motion.div variants={fadeUp}>
              <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: '#fbbf24' }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: '#3B82F615' }}>
                      <LaborIcon size={15} color="#3B82F6" />
                    </div>
                    <span className="text-xs font-semibold text-slate-500">% לייבור</span>
                  </div>
                  <div className="text-[22px] font-extrabold" style={{ color: totalLaborPct <= 28 ? '#059669' : '#e11d48' }}>
                    <CountUp end={totalLaborPct} duration={1.5} suffix="%" decimals={1} />
                  </div>
                  <span className="text-[11px] text-slate-400">יעד 28%</span>
                </CardContent>
              </Card>
            </motion.div>

            {/* Waste % */}
            <motion.div variants={fadeUp}>
              <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: '#fb7185' }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: '#fb718515' }}>
                      <Trash2 size={15} color="#fb7185" />
                    </div>
                    <span className="text-xs font-semibold text-slate-500">% פחת</span>
                  </div>
                  <div className="text-[22px] font-extrabold" style={{ color: totalWastePct <= 4 ? '#059669' : '#e11d48' }}>
                    <CountUp end={totalWastePct} duration={1.5} suffix="%" decimals={1} />
                  </div>
                  <span className="text-[11px] text-slate-400">יעד 4%</span>
                </CardContent>
              </Card>
            </motion.div>

            {/* Gross Profit */}
            <motion.div variants={fadeUp}>
              <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: totals.grossProfit >= 0 ? '#34d399' : '#fb7185' }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: '#7C3AED15' }}>
                      <ProfitIcon size={15} color={totals.grossProfit >= 0 ? '#7C3AED' : '#fb7185'} />
                    </div>
                    <span className="text-xs font-semibold text-slate-500">רווח גולמי</span>
                  </div>
                  <div className="text-[22px] font-extrabold" style={{ color: totals.grossProfit >= 0 ? '#059669' : '#e11d48' }}>
                    <CountUp end={Math.round(totals.grossProfit)} duration={1.5} separator="," prefix="₪" />
                  </div>
                  <DiffArrow current={totals.grossProfit} previous={prevTotals.grossProfit} />
                </CardContent>
              </Card>
            </motion.div>

            {/* Operating Profit */}
            <motion.div variants={fadeUp}>
              <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default border-r-4 overflow-hidden" style={{ borderRightColor: totals.operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: '#7C3AED15' }}>
                      <ProfitIcon size={15} color={totals.operatingProfit >= 0 ? '#7C3AED' : '#fb7185'} />
                    </div>
                    <span className="text-xs font-semibold text-slate-500">רווח תפעולי</span>
                  </div>
                  <div className="text-[22px] font-extrabold" style={{ color: totals.operatingProfit >= 0 ? '#059669' : '#e11d48' }}>
                    <CountUp end={Math.round(totals.operatingProfit)} duration={1.5} separator="," prefix="₪" />
                  </div>
                  <DiffArrow current={totals.operatingProfit} previous={prevTotals.operatingProfit} />
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>

          {/* Branch Cards */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5 mb-6"
          >
            {branches.map((br, bi) => {
              const prev = prevBranches[bi]
              return (
                <motion.div key={br.id} variants={fadeUp}>
                  <Card className="shadow-sm overflow-hidden border-t-4" style={{ borderTopColor: br.color }}>
                    <CardContent className="p-6">
                      {/* Branch header */}
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-11 h-11 rounded-[14px] flex items-center justify-center" style={{ background: br.color, boxShadow: `0 4px 14px ${br.color}40` }}>
                          <Store size={22} color="white" />
                        </div>
                        <div className="flex-1">
                          <div className="text-lg font-extrabold text-slate-900">{br.name}</div>
                          <div className="text-xs text-slate-400">{period.label}</div>
                        </div>
                        <div className="text-left">
                          <div className="text-xl font-extrabold" style={{ color: brOP(br) >= 0 ? '#34d399' : '#fb7185' }}>
                            {fmtM(brOP(br))}
                          </div>
                          <div className="text-[11px] text-slate-400">רווח תפעולי</div>
                        </div>
                      </div>

                      {/* KPI row */}
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {[
                          { label: 'לייבור', val: br.laborPct.toFixed(1) + '%', ok: br.laborPct <= 28, target: '28%' },
                          { label: 'פחת', val: br.wastePct.toFixed(1) + '%', ok: br.wastePct <= 4, target: '4%' },
                          { label: 'גולמי', val: br.grossPct.toFixed(1) + '%', ok: br.grossProfit >= 0, target: '' },
                          { label: 'תפעולי', val: (br.totalRevenue > 0 ? (brOP(br) / br.totalRevenue * 100).toFixed(1) : '0.0') + '%', ok: brOP(br) >= 0, target: '' },
                        ].map(kpi => (
                          <div key={kpi.label} className={`rounded-[10px] p-2 text-center ${kpi.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
                            <div className="text-[15px] font-extrabold" style={{ color: kpi.ok ? '#34d399' : '#fb7185' }}>{kpi.val}</div>
                            <div className="text-[10px] text-slate-500">{kpi.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* P&L breakdown */}
                      <div className="border border-slate-200 rounded-xl overflow-hidden text-[13px]">
                        {[
                          { label: 'הכנסות', amount: br.totalRevenue, color: '#34d399', bold: true },
                          { label: '  קופה', amount: br.revCashier, color: '#374151' },
                          { label: '  אתר', amount: br.revWebsite, color: '#374151' },
                          { label: '  הקפה', amount: br.revCredit, color: '#374151' },
                          { label: 'לייבור', amount: -br.laborEmployer, color: '#fb7185', bold: true },
                          { label: 'הוצאות', amount: -br.totalExpenses, color: '#fb7185', bold: true },
                          { label: '  ספקים', amount: -br.expSuppliers, color: '#374151' },
                          ...(br.expRepairs > 0 ? [{ label: '  תיקונים', amount: -br.expRepairs, color: '#374151' }] : []),
                          ...(br.expDelivery > 0 ? [{ label: '  משלוחים', amount: -br.expDelivery, color: '#374151' }] : []),
                          ...(br.expInfra > 0 ? [{ label: '  תשתיות', amount: -br.expInfra, color: '#374151' }] : []),
                          ...(br.expOther > 0 ? [{ label: '  אחר', amount: -br.expOther, color: '#374151' }] : []),
                          { label: 'רווח גולמי', amount: br.grossProfit, color: br.grossProfit >= 0 ? '#34d399' : '#fb7185', bold: true, bg: br.grossProfit >= 0 ? '#f0fdf4' : '#fef2f2' },
                          ...(br.fixedCosts > 0 ? [{ label: 'עלויות קבועות', amount: -br.fixedCosts, color: '#64748b' }] : []),
                          ...(br.mgmtCosts > 0 ? [{ label: 'הנהלה וכלליות', amount: -br.mgmtCosts, color: '#64748b' }] : []),
                          { label: 'פחת', amount: -br.wasteTotal, color: '#64748b' },
                          ...(overheadPct > 0 ? [{ label: `העמסת מטה ${overheadPct}%`, amount: -brOH(br), color: '#64748b' }] : []),
                          { label: 'רווח תפעולי', amount: brOP(br), color: brOP(br) >= 0 ? '#34d399' : '#fb7185', bold: true, bg: brOP(br) >= 0 ? '#f0fdf4' : '#fef2f2' },
                        ].map((line, i) => (
                          <div key={i} className={`grid grid-cols-[1fr_120px] px-3.5 py-[7px] border-b border-slate-50 ${(line as any).bold ? 'font-bold' : 'font-normal'}`}
                            style={{ background: (line as any).bg || (i % 2 === 0 ? 'white' : '#fafafa') }}>
                            <span className="text-slate-700">{line.label}</span>
                            <span className={`text-left ${(line as any).bold ? 'font-bold' : 'font-medium'}`} style={{ color: line.color }}>
                              {line.amount === 0 ? '—' : fmtM(Math.abs(line.amount))}{line.amount < 0 ? '-' : ''}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Comparison */}
                      {prev && prev.totalRevenue > 0 && (
                        <div className="mt-3 flex gap-2 justify-center">
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            הכנסות: <DiffArrow current={br.totalRevenue} previous={prev.totalRevenue} />
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            רווח: <DiffArrow current={brOP(br)} previous={brOP(prev)} />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </motion.div>

          {/* Comparison Table */}
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold text-slate-900">
                    טבלת השוואה — {period.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-2 border-slate-200">
                        <TableHead className="text-right text-slate-500 font-semibold text-xs px-3.5 py-2.5">מדד</TableHead>
                        {branches.map(br => (
                          <TableHead key={br.id} className="text-center font-bold text-[13px] px-3.5 py-2.5">
                            <span style={{ color: br.color }}>{br.name}</span>
                          </TableHead>
                        ))}
                        <TableHead className="text-center font-bold text-[13px] text-slate-900 px-3.5 py-2.5">סה"כ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        { label: 'הכנסות', key: 'totalRevenue' as const, color: '#34d399' },
                        { label: 'הוצאות', key: 'totalExpenses' as const, color: '#fb7185' },
                        { label: 'לייבור', key: 'laborEmployer' as const, color: '#fbbf24' },
                        { label: 'פחת', key: 'wasteTotal' as const, color: '#fb7185' },
                        { label: 'עלויות קבועות', key: 'fixedCosts' as const, color: '#64748b' },
                        { label: 'הנהלה וכלליות', key: 'mgmtCosts' as const, color: '#64748b' },
                        { label: 'רווח גולמי', key: 'grossProfit' as const, color: '#34d399' },
                      ].map((row, ri) => {
                        const isBold = row.key === 'grossProfit' || row.key === 'operatingProfit' || row.key === 'totalRevenue'
                        const totalVal = branches.reduce((s, b) => s + b[row.key], 0)
                        return (
                          <TableRow key={row.key} className={isBold ? 'bg-slate-50' : ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                            <TableCell className={`px-3.5 py-2.5 text-slate-700 ${isBold ? 'font-bold' : 'font-medium'}`}>{row.label}</TableCell>
                            {branches.map(br => {
                              const val = br[row.key]
                              const isProfit = row.key === 'grossProfit' || row.key === 'operatingProfit'
                              const c = isProfit ? (val >= 0 ? '#34d399' : '#fb7185') : row.color
                              return (
                                <TableCell key={br.id} className={`px-3.5 py-2.5 text-center ${isBold ? 'font-bold' : 'font-medium'}`} style={{ color: val === 0 ? '#94a3b8' : c }}>
                                  {val === 0 ? '—' : fmtM(val)}
                                </TableCell>
                              )
                            })}
                            <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: (row.key === 'grossProfit' || row.key === 'operatingProfit') ? (totalVal >= 0 ? '#34d399' : '#fb7185') : '#0f172a' }}>
                              {totalVal === 0 ? '—' : fmtM(totalVal)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      {/* Overhead row */}
                      {overheadPct > 0 && (
                        <TableRow className="bg-slate-50/50">
                          <TableCell className="px-3.5 py-2.5 font-medium text-slate-700">העמסת מטה {overheadPct}%</TableCell>
                          {branches.map(br => (
                            <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-medium text-slate-500">
                              {fmtM(brOH(br))}
                            </TableCell>
                          ))}
                          <TableCell className="px-3.5 py-2.5 text-center font-bold text-slate-900">
                            {fmtM(totals.overhead)}
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className="bg-slate-50">
                        <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">רווח תפעולי</TableCell>
                        {branches.map(br => {
                          const op = brOP(br)
                          return (
                            <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: op >= 0 ? '#34d399' : '#fb7185' }}>
                              {op === 0 ? '—' : fmtM(op)}
                            </TableCell>
                          )
                        })}
                        <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totals.operatingProfit >= 0 ? '#34d399' : '#fb7185' }}>
                          {totals.operatingProfit === 0 ? '—' : fmtM(totals.operatingProfit)}
                        </TableCell>
                      </TableRow>
                      {/* KPI rows */}
                      <TableRow className="border-t-2 border-slate-200 bg-slate-50">
                        <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% לייבור</TableCell>
                        {branches.map(br => (
                          <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: br.laborPct <= 28 ? '#34d399' : '#fb7185' }}>
                            {br.totalRevenue > 0 ? br.laborPct.toFixed(1) + '%' : '—'}
                          </TableCell>
                        ))}
                        <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totalLaborPct <= 28 ? '#34d399' : '#fb7185' }}>
                          {totalLaborPct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                      <TableRow className="bg-slate-50">
                        <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% פחת</TableCell>
                        {branches.map(br => (
                          <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: br.wastePct <= 4 ? '#34d399' : '#fb7185' }}>
                            {br.totalRevenue > 0 ? br.wastePct.toFixed(1) + '%' : '—'}
                          </TableCell>
                        ))}
                        <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totalWastePct <= 4 ? '#34d399' : '#fb7185' }}>
                          {totalWastePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                      <TableRow className="bg-slate-50">
                        <TableCell className="px-3.5 py-2.5 font-bold text-slate-700">% רווח תפעולי</TableCell>
                        {branches.map(br => {
                          const opPct = br.totalRevenue > 0 ? (brOP(br) / br.totalRevenue * 100) : 0
                          return (
                            <TableCell key={br.id} className="px-3.5 py-2.5 text-center font-bold" style={{ color: opPct >= 0 ? '#34d399' : '#fb7185' }}>
                              {br.totalRevenue > 0 ? opPct.toFixed(1) + '%' : '—'}
                            </TableCell>
                          )
                        })}
                        <TableCell className="px-3.5 py-2.5 text-center font-bold" style={{ color: totals.revenue > 0 ? ((totals.operatingProfit / totals.revenue * 100) >= 0 ? '#34d399' : '#fb7185') : '#94a3b8' }}>
                          {totals.revenue > 0 ? (totals.operatingProfit / totals.revenue * 100).toFixed(1) + '%' : '—'}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </motion.div>

        </div>
      )}
    </div>
  )
}
