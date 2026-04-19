import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchBranchRevenueTrend } from '../lib/supabase'
import type { BranchRevenueTrend } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import PageHeader from '../components/PageHeader'
import { Plus, Pencil, Trash2, Search, X, ShoppingBag, CreditCard, Monitor, Upload, FileText, Check, AlertCircle, HelpCircle } from 'lucide-react'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { parseCashOnTabPDF } from '../lib/parseCashOnTab'
import type { CashOnTabRow } from '../lib/parseCashOnTab'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
  onNavigate?: (page: string) => void
}

const BRANCH_REGISTERS: Record<number, number[]> = {
  1: [1, 2, 3, 6],
  2: [4, 5, 7],
  3: [9, 10, 11, 13],
}

type Source = 'cashier' | 'website' | 'credit'

interface Entry {
  id: number
  date: string
  source: Source
  amount: number
  transaction_count: number | null
  customer: string | null
  doc_number: string | null
  notes: string | null
}

const SOURCE_CONFIG: Record<Source, { label: string; Icon: any; color: string; bg: string }> = {
  cashier: { label: 'קופה',  Icon: ShoppingBag, color: '#818cf8', bg: '#e0e7ff' },
  website: { label: 'אתר',   Icon: Monitor,     color: '#c084fc', bg: '#f3e8ff' },
  credit:  { label: 'הקפה',  Icon: CreditCard,  color: '#fbbf24', bg: '#fef3c7' },
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

function AutocompleteInput({ value, onChange, suggestions, placeholder, color }: {
  value: string; onChange: (v: string) => void
  suggestions: string[]; placeholder: string; color: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input type="text" value={value} placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' }} />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 50, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginTop: '4px', overflow: 'hidden' }}>
          {filtered.slice(0, 6).map(s => (
            <div key={s} onMouseDown={() => { onChange(s); setOpen(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '14px', color: '#374151', borderBottom: '1px solid #f1f5f9' }}
              onMouseEnter={e => (e.currentTarget.style.background = color + '15')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}>{s}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BranchRevenue({ branchId, branchName, branchColor, onBack, onNavigate }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [tab, setTab]               = useState<Source>('cashier')
  const [entries, setEntries]       = useState<Entry[]>([])
  const [creditCustomers, setCreditCustomers] = useState<string[]>([])
  const [searchFilter, setSearchFilter] = useState('')
  const [editId, setEditId]         = useState<number | null>(null)
  const [editData, setEditData]     = useState<Partial<Entry>>({})
  const [loading, setLoading]       = useState(false)
  const [openRegisters, setOpenRegisters] = useState(0)

  // טופס
  const [date, setDate]     = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [txCount, setTxCount] = useState('')
  const [customer, setCustomer] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [notes, setNotes]   = useState('')

  // PDF import state
  const [pdfSheetOpen, setPdfSheetOpen] = useState(false)
  const [pdfParsing, setPdfParsing]     = useState(false)
  const [pdfRows, setPdfRows]           = useState<(CashOnTabRow & { selected: boolean; exists: boolean })[]>([])
  const [pdfImporting, setPdfImporting] = useState(false)
  const [pdfResult, setPdfResult]       = useState<{ imported: number; skipped: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [trendData, setTrendData] = useState<BranchRevenueTrend[]>([])
  const [closingsInPeriod, setClosingsInPeriod] = useState<Array<{ date: string; register_number: number; cash_sales: number; credit_sales: number; transaction_count: number | null }>>([])

  async function handlePdfFile(file: File) {
    setPdfParsing(true)
    setPdfResult(null)
    try {
      const parsed = await parseCashOnTabPDF(file)
      // Check which dates already exist
      const dates = parsed.map(r => r.date)
      const { data: existing } = await supabase.from('branch_revenue')
        .select('date')
        .eq('branch_id', branchId)
        .eq('source', 'cashier')
        .in('date', dates)
      const existingDates = new Set((existing || []).map((r: any) => r.date))

      setPdfRows(parsed.map(r => ({
        ...r,
        selected: !existingDates.has(r.date),
        exists: existingDates.has(r.date),
      })))
      if (parsed.length === 0) {
        setPdfResult({ imported: 0, skipped: 0 })
      }
    } catch (err) {
      console.error('PDF parse error:', err)
      setPdfRows([])
      setPdfResult({ imported: 0, skipped: 0 })
    }
    setPdfParsing(false)
  }

  async function importPdfRows() {
    const selected = pdfRows.filter(r => r.selected)
    if (selected.length === 0) return
    setPdfImporting(true)
    let imported = 0, skipped = 0

    for (const row of selected) {
      // Check if already exists
      const { data: existing } = await supabase.from('branch_revenue')
        .select('id')
        .eq('branch_id', branchId)
        .eq('date', row.date)
        .eq('source', 'cashier')
        .limit(1)

      if (existing && existing.length > 0) {
        // Update existing
        await supabase.from('branch_revenue').update({
          amount: row.amount,
          transaction_count: row.transactions || null,
        }).eq('id', existing[0].id)
        imported++
      } else {
        // Insert new
        const { error } = await supabase.from('branch_revenue').insert({
          branch_id: branchId,
          date: row.date,
          source: 'cashier' as Source,
          amount: row.amount,
          transaction_count: row.transactions || null,
        })
        if (error) { skipped++ } else { imported++ }
      }
    }

    setPdfResult({ imported, skipped })
    setPdfImporting(false)
    await fetchEntries()
  }

  async function fetchEntries() {
    // Explicit .range bypasses PostgREST's default 1000-row cap so every record for the period is loaded.
    const { data } = await supabase.from('branch_revenue').select('*')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .order('date', { ascending: false })
      .range(0, 99999)
    if (data) setEntries(data)
  }

  async function fetchCreditCustomers() {
    const { data } = await supabase.from('branch_revenue').select('customer')
      .eq('branch_id', branchId).eq('source', 'credit')
    if (data) setCreditCustomers([...new Set(data.map((r: any) => r.customer).filter(Boolean))] as string[])
  }

  useEffect(() => {
    fetchEntries(); fetchCreditCustomers()
    const refMonth = from.slice(0, 7)
    fetchBranchRevenueTrend(branchId, refMonth).then(setTrendData)
    setAmount(''); setTxCount(''); setCustomer(''); setDocNumber(''); setNotes(''); setSearchFilter('')
  }, [from, to, branchId, tab])

  useEffect(() => {
    async function loadClosings() {
      const { data } = await supabase.from('register_closings')
        .select('date, register_number, cash_sales, credit_sales, transaction_count')
        .eq('branch_id', branchId)
        .gte('date', from).lt('date', to)
        .order('date')
        .range(0, 99999)
      setClosingsInPeriod((data || []) as any)
    }
    loadClosings()
  }, [branchId, from, to])

  useEffect(() => {
    async function loadOpenRegisters() {
      const regs = BRANCH_REGISTERS[branchId] || []
      if (regs.length === 0) { setOpenRegisters(0); return }
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase.from('register_closings')
        .select('register_number').eq('branch_id', branchId).eq('date', today)
      const closed = new Set((data || []).map((r: any) => r.register_number))
      setOpenRegisters(regs.filter(r => !closed.has(r)).length)
    }
    loadOpenRegisters()
  }, [branchId])

  async function addEntry() {
    if (!amount || !date) return
    if (tab === 'credit' && !customer) return
    setLoading(true)
    await supabase.from('branch_revenue').insert({
      branch_id: branchId, source: tab, date,
      amount: parseFloat(amount),
      transaction_count: txCount ? parseInt(txCount) : null,
      customer: customer || null, doc_number: docNumber || null, notes: notes || null
    })
    if (tab === 'credit' && customer && !creditCustomers.includes(customer))
      setCreditCustomers(p => [...p, customer].sort())
    setAmount(''); setTxCount(''); setDocNumber(''); setNotes(''); setCustomer('')
    await fetchEntries()
    setLoading(false)
  }

  async function deleteEntry(id: number) {
    if (!confirm('למחוק?')) return
    await supabase.from('branch_revenue').delete().eq('id', id)
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    await supabase.from('branch_revenue').update(editData).eq('id', id)
    setEditId(null); await fetchEntries()
  }

  // חישובים — קופה משלבת נתונים היסטוריים מ-branch_revenue ונתונים חדשים מ-register_closings
  const closingsCash = closingsInPeriod.reduce((s, c) => s + Number(c.cash_sales), 0)
  const closingsCredit = closingsInPeriod.reduce((s, c) => s + Number(c.credit_sales), 0)
  const closingsTx = closingsInPeriod.reduce((s, c) => s + (Number(c.transaction_count) || 0), 0)
  const closingsTotal = closingsCash + closingsCredit

  const legacyCashierEntries = entries.filter(e => e.source === 'cashier')
  const legacyCashierTotal = legacyCashierEntries.reduce((s, e) => s + Number(e.amount), 0)
  const legacyCashierTx = legacyCashierEntries.reduce((s, e) => s + (Number(e.transaction_count) || 0), 0)

  const totalCashier = legacyCashierTotal + closingsTotal
  const totalWebsite = entries.filter(e => e.source === 'website').reduce((s, e) => s + Number(e.amount), 0)
  const totalCredit  = entries.filter(e => e.source === 'credit').reduce((s, e) => s + Number(e.amount), 0)
  const totalRevenue = totalCashier + totalWebsite + totalCredit
  const totalTx      = legacyCashierTx + closingsTx
  const avgBasket    = totalTx > 0 ? totalCashier / totalTx : 0

  const tabEntries = entries.filter(e => e.source === tab)
  const filtered   = searchFilter
    ? tabEntries.filter(e => (e.customer || '').toLowerCase().includes(searchFilter.toLowerCase()) || (e.doc_number || '').includes(searchFilter))
    : tabEntries
  const tabTotal = filtered.reduce((s, e) => s + Number(e.amount), 0)

  const dailySummary = Object.values(
    (() => {
      const acc: Record<string, any> = {}
      // כל המקורות מטבלת branch_revenue (כולל קופה היסטורית)
      for (const e of entries) {
        if (!acc[e.date]) acc[e.date] = { date: e.date, cashier: 0, website: 0, credit: 0, total: 0, transactions: 0 }
        acc[e.date][e.source] += Number(e.amount)
        acc[e.date].total += Number(e.amount)
        if (e.source === 'cashier') acc[e.date].transactions += Number(e.transaction_count || 0)
      }
      // קופה — מטבלת register_closings (מזומן + אשראי) — מתווסף למקור "קופה"
      for (const c of closingsInPeriod) {
        if (!acc[c.date]) acc[c.date] = { date: c.date, cashier: 0, website: 0, credit: 0, total: 0, transactions: 0 }
        const sum = Number(c.cash_sales) + Number(c.credit_sales)
        acc[c.date].cashier += sum
        acc[c.date].total += sum
        acc[c.date].transactions += Number(c.transaction_count || 0)
      }
      return acc
    })()
  ).sort((a: any, b: any) => b.date.localeCompare(a.date))

  const cfg = SOURCE_CONFIG[tab]

  const S = {
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>

      <PageHeader title="הכנסות" subtitle={branchName} onBack={onBack} />

      {/* Close register CTA */}
      {onNavigate && (BRANCH_REGISTERS[branchId] || []).length > 0 && (
        <div style={{ padding: '12px 20px 0', maxWidth: 1000, margin: '0 auto' }}>
          <button onClick={() => onNavigate('register_closings')}
            style={{ width: '100%', background: openRegisters > 0 ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', color: 'white', border: 'none', borderRadius: 12, padding: '14px 20px', fontSize: 15, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, boxShadow: openRegisters > 0 ? '0 4px 12px rgba(239,68,68,0.25)' : '0 4px 12px rgba(99,102,241,0.25)', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShoppingBag size={20} />
              <span>סגור קופה</span>
            </div>
            {openRegisters > 0 ? (
              <span style={{ background: 'white', color: '#dc2626', fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 999 }}>
                {openRegisters} קופות טרם נסגרו היום
              </span>
            ) : (
              <span style={{ background: 'rgba(255,255,255,0.25)', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999 }}>
                כל הקופות סגורות ✓
              </span>
            )}
          </button>
        </div>
      )}

      {/* KPI summary cards */}
      <div style={{ padding: '0 20px', maxWidth: '1000px', margin: '0 auto 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {[
            { label: 'קופה',  val: totalCashier, color: '#818cf8' },
            { label: 'אתר',   val: totalWebsite, color: '#c084fc' },
            { label: 'הקפה',  val: totalCredit,  color: '#fbbf24' },
            { label: 'סה"כ',  val: totalRevenue, color: '#0f172a' },
          ].map(s => (
            <div key={s.label} style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, padding: '16px', textAlign: 'center' as const }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: s.color }}>₪{Math.round(s.val).toLocaleString()}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Underline tabs */}
      <div style={{ display: 'flex', padding: '0 20px', maxWidth: '1000px', margin: '0 auto', borderBottom: '1px solid #f1f5f9' }}>
        {(Object.entries(SOURCE_CONFIG) as [Source, any][]).map(([key, c]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '12px 22px', background: 'none', border: 'none', borderBottom: tab === key ? '2px solid #0f172a' : '2px solid transparent', cursor: 'pointer', fontSize: '14px', fontWeight: tab === key ? '700' : '500', color: tab === key ? '#0f172a' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <c.Icon size={15} />{c.label}
          </button>
        ))}
        {avgBasket > 0 && (
          <span style={{ marginRight: 'auto', alignSelf: 'center', fontSize: '12px', color: '#94a3b8', paddingLeft: '16px' }}>
            סל ממוצע: ₪{Math.round(avgBasket)}
          </span>
        )}
      </div>

      <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>

        {/* חיפוש */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
          {tab === 'credit' && (
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={15} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input type="text" placeholder="חפש לפי לקוח..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                style={{ ...S.input, paddingRight: '36px' }} />
              {searchFilter && <button onClick={() => setSearchFilter('')} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={14} color="#94a3b8" /></button>}
            </div>
          )}
        </div>

        {/* קופה — סיכום מסגירות קופה (קריאה בלבד) */}
        {tab === 'cashier' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <AlertCircle size={16} color="#6366f1" />
                <span style={{ fontSize: 13, color: '#6366f1', fontWeight: 700 }}>נתונים מסגירות קופה — לקריאה בלבד</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <div style={{ padding: 14, background: '#ecfdf5', borderRadius: 12, border: '1px solid #a7f3d0' }}>
                  <div style={{ fontSize: 12, color: '#047857', fontWeight: 700 }}>סה"כ מכירות מזומן</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#065f46' }}>₪{Math.round(closingsCash).toLocaleString()}</div>
                </div>
                <div style={{ padding: 14, background: '#eff6ff', borderRadius: 12, border: '1px solid #bfdbfe' }}>
                  <div style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 700 }}>סה"כ מכירות אשראי</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#1e3a8a' }}>₪{Math.round(closingsCredit).toLocaleString()}</div>
                </div>
                <div style={{ padding: 14, background: '#f5f3ff', borderRadius: 12, border: '1px solid #ddd6fe' }}>
                  <div style={{ fontSize: 12, color: '#6d28d9', fontWeight: 700 }}>סה"כ עסקאות</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#4c1d95' }}>{closingsTx.toLocaleString()}</div>
                </div>
                <div style={{ padding: 14, background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>סל ממוצע</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{avgBasket > 0 ? '₪' + Math.round(avgBasket) : '—'}</div>
                </div>
              </div>
              {onNavigate && (
                <button onClick={() => onNavigate('register_closings')}
                  style={{ marginTop: 14, background: '#6366f1', color: 'white', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  מעבר לסגירת קופות ←
                </button>
              )}
            </div>

            {/* טבלת סגירות קופה — קריאה בלבד */}
            {closingsInPeriod.length > 0 && (
              <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#374151' }}>סגירות קופה — לתקופה</h3>
                  <span style={{ background: '#eef2ff', color: '#4338ca', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999 }}>
                    מסגירת קופה
                  </span>
                </div>
                <div className="table-scroll" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        {['תאריך', 'קופה', 'מזומן', 'אשראי', 'עסקאות'].map(h => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#94a3b8', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...closingsInPeriod].sort((a, b) => b.date.localeCompare(a.date)).map((c, i) => (
                        <tr key={`${c.date}-${c.register_number}-${i}`} style={{ borderBottom: '1px solid #f8fafc' }}>
                          <td style={{ padding: '9px 14px', fontSize: 13, color: '#64748b' }}>{new Date(c.date + 'T12:00:00').toLocaleDateString('he-IL')}</td>
                          <td style={{ padding: '9px 14px', fontWeight: 700, color: '#0f172a' }}>{c.register_number}</td>
                          <td style={{ padding: '9px 14px', color: '#10b981', fontWeight: 700 }}>₪{Number(c.cash_sales).toLocaleString()}</td>
                          <td style={{ padding: '9px 14px', color: '#3b82f6', fontWeight: 700 }}>₪{Number(c.credit_sales).toLocaleString()}</td>
                          <td style={{ padding: '9px 14px', color: '#64748b' }}>{c.transaction_count || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid #f1f5f9', background: '#f8fafc' }}>
                  <span style={{ fontWeight: 700, color: '#374151', fontSize: 13 }}>סה"כ — {closingsInPeriod.length} סגירות</span>
                  <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 15 }}>₪{Math.round(closingsTotal).toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* טבלת נתונים היסטוריים — branch_revenue source='cashier' עם עריכה ומחיקה */}
            {legacyCashierEntries.length > 0 && (
              <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#374151' }}>נתונים היסטוריים — רשומות ישנות</h3>
                  <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999 }}>
                    ישן
                  </span>
                </div>
                <div className="table-scroll" style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px 130px 36px 36px', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                    <span>תאריך</span>
                    <span>הערות</span>
                    <span style={{ textAlign: 'center' }}>עסקאות</span>
                    <span style={{ textAlign: 'left' }}>סכום</span>
                    <span /><span />
                  </div>
                  {legacyCashierEntries.map(entry => (
                    <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px 130px 36px 36px', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #f8fafc' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                      {editId === entry.id ? (
                        <>
                          <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} />
                          <input type="text" value={editData.notes || ''} onChange={e => setEditData({ ...editData, notes: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 13, fontFamily: 'inherit' }} />
                          <input type="number" value={editData.transaction_count || ''} onChange={e => setEditData({ ...editData, transaction_count: parseInt(e.target.value) })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 12, textAlign: 'center' }} />
                          <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
                          <button onClick={() => saveEdit(entry.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✓</button>
                          <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 13, color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                          <div><div style={{ fontWeight: 600, color: '#374151', fontSize: 14 }}>{entry.notes || '—'}</div></div>
                          <span style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>{entry.transaction_count || '—'}</span>
                          <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 14 }}>₪{Number(entry.amount).toLocaleString()}</span>
                          <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Pencil size={14} color="#94a3b8" /></button>
                          <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={14} color="#fb7185" /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid #f1f5f9', background: '#f8fafc' }}>
                  <span style={{ fontWeight: 700, color: '#374151', fontSize: 13 }}>סה"כ היסטורי — {legacyCashierEntries.length} רשומות</span>
                  <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 15 }}>₪{Math.round(legacyCashierTotal).toLocaleString()}</span>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* טופס הזנה — לאתר/הקפה בלבד */}
        {tab !== 'cashier' && (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, padding: '20px', marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת {cfg.label}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>סכום ללא מע״מ (₪)</label>
              <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEntry()}
                style={{ ...S.input, textAlign: 'right' as const }} />
            </div>

            {(tab === 'cashier' || tab === 'website') && (
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>מספר עסקאות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                <input type="number" placeholder="0" value={txCount} onChange={e => setTxCount(e.target.value)}
                  style={{ ...S.input, textAlign: 'right' as const }} />
              </div>
            )}

            {tab === 'credit' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
                  <label style={S.label}>לקוח *</label>
                  <AutocompleteInput value={customer} onChange={setCustomer} suggestions={creditCustomers} placeholder="שם לקוח..." color={cfg.color} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>מספר תעודה <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                  <input type="text" placeholder="מס׳ תעודה" value={docNumber} onChange={e => setDocNumber(e.target.value)} style={S.input} />
                </div>
              </>
            )}

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <input type="text" placeholder="הערה..." value={notes} onChange={e => setNotes(e.target.value)} style={S.input} />
            </div>
          </div>

          {(tab === 'cashier' || tab === 'website') && amount && txCount && parseInt(txCount) > 0 && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#065f46' }}>
              סל ממוצע: <strong>₪{(parseFloat(amount) / parseInt(txCount)).toFixed(0)}</strong>
            </div>
          )}

          <button onClick={addEntry}
            disabled={loading || !amount || (tab === 'credit' && !customer)}
            style={{ background: loading || !amount || (tab === 'credit' && !customer) ? '#e2e8f0' : '#6366f1', color: loading || !amount || (tab === 'credit' && !customer) ? '#94a3b8' : 'white', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} />הוסף
          </button>
        </div>
        </motion.div>
        )}

        {/* טבלת רשומות — לא רלוונטי ל-קופה (נתונים מסגירות) */}
        {tab !== 'cashier' && (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div className="table-scroll">
        <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: tab === 'credit' ? '110px 1fr 110px 130px 36px 36px' : '110px 1fr 80px 130px 36px 36px', padding: '10px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
            <span>תאריך</span>
            <span>{tab === 'credit' ? 'לקוח' : 'הערות'}</span>
            <span style={{ textAlign: 'center' }}>{tab === 'credit' ? 'תעודה' : 'עסקאות'}</span>
            <span style={{ textAlign: 'left' }}>סכום</span>
            <span /><span />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין רשומות לחודש זה</div>
          ) : filtered.map((entry, i) => (
            <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: tab === 'credit' ? '110px 1fr 110px 130px 36px 36px' : '110px 1fr 80px 130px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f8fafc' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
              {editId === entry.id ? (
                <>
                  <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                  {tab === 'credit'
                    ? <AutocompleteInput value={editData.customer || ''} onChange={v => setEditData({ ...editData, customer: v })} suggestions={creditCustomers} placeholder="לקוח" color="#6366f1" />
                    : <input type="text" value={editData.notes || ''} onChange={e => setEditData({ ...editData, notes: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                  }
                  <input type={tab === 'credit' ? 'text' : 'number'} value={tab === 'credit' ? (editData.doc_number || '') : (editData.transaction_count || '')} onChange={e => setEditData({ ...editData, ...(tab === 'credit' ? { doc_number: e.target.value } : { transaction_count: parseInt(e.target.value) }) })} style={{ border: '1px solid #6366f1', borderRadius: '6px', padding: '4px 8px', fontSize: '12px', textAlign: 'center' as const }} />
                  <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #6366f1', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                  <button onClick={() => saveEdit(entry.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                  <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                  <div><div style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{tab === 'credit' ? (entry.customer || '—') : (entry.notes || '—')}</div></div>
                  <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center' }}>{tab === 'credit' ? (entry.doc_number || '—') : (entry.transaction_count || '—')}</span>
                  <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                  <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                  <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#fb7185" /></button>
                </>
              )}
            </div>
          ))}

          {filtered.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ fontWeight: '700', color: '#374151', fontSize: '14px' }}>סה"כ — {filtered.length} רשומות</span>
              <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '18px' }}>₪{tabTotal.toLocaleString()}</span>
            </div>
          )}
        </div>
        </div>
        </motion.div>
        )}

        {/* סיכום יומי */}
        {dailySummary.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className="table-scroll">
          <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 0' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>סיכום יומי — כל המקורות</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 110px 70px', padding: '9px 18px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
              <span>תאריך</span><span>קופה</span><span>אתר</span><span>הקפה</span><span>סה"כ</span><span style={{ textAlign: 'center' }}>עסקאות</span>
            </div>
            {dailySummary.map((day: any, i: number) => (
              <div key={day.date} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 110px 70px', padding: '11px 18px', borderBottom: '1px solid #f8fafc', alignItems: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                <span style={{ fontSize: '13px', color: '#374151', fontWeight: '600' }}>{new Date(day.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}</span>
                <span style={{ color: '#818cf8', fontWeight: '600', fontSize: '13px' }}>{day.cashier > 0 ? '₪' + day.cashier.toLocaleString() : '—'}</span>
                <span style={{ color: '#c084fc', fontWeight: '600', fontSize: '13px' }}>{day.website > 0 ? '₪' + day.website.toLocaleString() : '—'}</span>
                <span style={{ color: '#fbbf24', fontWeight: '600', fontSize: '13px' }}>{day.credit > 0 ? '₪' + day.credit.toLocaleString() : '—'}</span>
                <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>₪{day.total.toLocaleString()}</span>
                <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{day.transactions || '—'}</span>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 110px 70px', padding: '12px 18px', borderTop: '1px solid #f1f5f9', fontWeight: '700' }}>
              <span style={{ color: '#374151', fontSize: '13px' }}>סה"כ</span>
              <span style={{ color: '#818cf8' }}>₪{totalCashier.toLocaleString()}</span>
              <span style={{ color: '#c084fc' }}>₪{totalWebsite.toLocaleString()}</span>
              <span style={{ color: '#fbbf24' }}>₪{totalCredit.toLocaleString()}</span>
              <span style={{ color: '#0f172a', fontSize: '15px' }}>₪{totalRevenue.toLocaleString()}</span>
              <span style={{ textAlign: 'center', color: '#64748b' }}>{totalTx || '—'}</span>
            </div>
          </div>
          </div>
          </motion.div>
        )}

        {/* מגמת 6 חודשים */}
        {trendData.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, padding: '20px', marginTop: 16 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>מגמת 6 חודשים — הכנסות</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => '₪' + (v / 1000).toFixed(0) + 'K'} />
                  <Tooltip formatter={(value: number) => '₪' + Math.round(value).toLocaleString()} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line type="monotone" dataKey="cashier" name="קופה" stroke="#818cf8" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="website" name="אתר" stroke="#c084fc" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="credit" name="הקפה" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="total" name="סה״כ" stroke={branchColor} strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
          </div>
          </motion.div>
        )}

      </div>

      {/* PDF Import Sheet */}
      <Sheet open={pdfSheetOpen} onOpenChange={setPdfSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetHeader>
              <SheetTitle>העלאת דוח קופה — CashOnTab</SheetTitle>
            </SheetHeader>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* File input area */}
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{ border: '2px dashed #818cf8', borderRadius: '12px', padding: '32px', textAlign: 'center', cursor: 'pointer', background: '#f8fafc', transition: 'all 0.15s' }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = '#e0e7ff' }}
                onDragLeave={e => { e.currentTarget.style.background = '#f8fafc' }}
                onDrop={e => { e.preventDefault(); e.currentTarget.style.background = '#f8fafc'; const f = e.dataTransfer.files[0]; if (f?.type === 'application/pdf') handlePdfFile(f) }}>
                <FileText size={32} color="#818cf8" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>גרור קובץ PDF או לחץ לבחירה</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>דוח "השוואת מכירות - יומי" מ-CashOnTab</div>
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); e.target.value = '' }} />

              {pdfParsing && <div style={{ textAlign: 'center', color: '#818cf8', fontSize: '14px', padding: '16px' }}>מפענח PDF...</div>}

              {/* Preview table */}
              {pdfRows.length > 0 && !pdfResult && (
                <>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                    זוהו {pdfRows.length} שורות · {pdfRows.filter(r => r.exists).length} קיימות כבר
                  </div>
                  <div style={{ maxHeight: '300px', overflow: 'auto', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '36px 100px 110px 80px', padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b', position: 'sticky', top: 0 }}>
                      <span>✓</span><span>תאריך</span><span>סכום ללא מע"מ</span><span>עסקאות</span>
                    </div>
                    {pdfRows.map((row, i) => (
                      <div key={row.date} style={{
                        display: 'grid', gridTemplateColumns: '36px 100px 110px 80px',
                        padding: '10px 14px', borderBottom: '1px solid #f1f5f9',
                        background: row.exists ? '#fef9c3' : (i % 2 === 0 ? 'white' : '#fafafa'),
                        alignItems: 'center',
                      }}>
                        <input type="checkbox" checked={row.selected}
                          onChange={() => setPdfRows(prev => prev.map((r, j) => j === i ? { ...r, selected: !r.selected } : r))}
                          style={{ width: '16px', height: '16px', accentColor: '#818cf8' }} />
                        <span style={{ fontSize: '13px', color: '#374151' }}>
                          {new Date(row.date + 'T12:00:00').toLocaleDateString('he-IL')}
                          {row.exists && <AlertCircle size={12} color="#f59e0b" style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                        </span>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: '#818cf8' }}>₪{row.amount.toLocaleString()}</span>
                        <span style={{ fontSize: '13px', color: '#64748b', textAlign: 'center' }}>{row.transactions}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button onClick={() => setPdfRows(prev => prev.map(r => ({ ...r, selected: true })))}
                      style={{ fontSize: '12px', color: '#818cf8', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>סמן הכל</button>
                    <span style={{ color: '#e2e8f0' }}>|</span>
                    <button onClick={() => setPdfRows(prev => prev.map(r => ({ ...r, selected: false })))}
                      style={{ fontSize: '12px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>בטל הכל</button>
                    <span style={{ color: '#e2e8f0' }}>|</span>
                    <button onClick={() => setPdfRows(prev => prev.map(r => ({ ...r, selected: !r.exists })))}
                      style={{ fontSize: '12px', color: '#f59e0b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>רק חדשות</button>
                  </div>

                  <button onClick={importPdfRows}
                    disabled={pdfImporting || pdfRows.filter(r => r.selected).length === 0}
                    style={{
                      background: pdfImporting || pdfRows.filter(r => r.selected).length === 0 ? '#e2e8f0' : '#818cf8',
                      color: pdfImporting || pdfRows.filter(r => r.selected).length === 0 ? '#94a3b8' : 'white',
                      border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    }}>
                    <Upload size={16} />
                    {pdfImporting ? 'מייבא...' : `ייבא ${pdfRows.filter(r => r.selected).length} רשומות`}
                  </button>
                </>
              )}

              {/* Result */}
              {pdfResult && (
                <div style={{
                  background: pdfResult.imported > 0 ? '#f0fdf4' : '#fef2f2',
                  border: `1.5px solid ${pdfResult.imported > 0 ? '#86efac' : '#fca5a5'}`,
                  borderRadius: '12px', padding: '20px', textAlign: 'center'
                }}>
                  {pdfResult.imported > 0 ? (
                    <Check size={32} color="#22c55e" style={{ margin: '0 auto 8px' }} />
                  ) : (
                    <AlertCircle size={32} color="#ef4444" style={{ margin: '0 auto 8px' }} />
                  )}
                  <div style={{ fontSize: '16px', fontWeight: '700', color: pdfResult.imported > 0 ? '#166534' : '#991b1b' }}>
                    {pdfResult.imported > 0 ? 'הייבוא הושלם!' : 'לא זוהו נתונים בקובץ'}
                  </div>
                  {pdfResult.imported > 0 && (
                    <div style={{ fontSize: '14px', color: '#15803d', marginTop: '8px' }}>
                      יובאו <strong>{pdfResult.imported}</strong> רשומות בהצלחה
                      {pdfResult.skipped > 0 && <>, <strong>{pdfResult.skipped}</strong> נכשלו</>}
                    </div>
                  )}
                  {pdfResult.imported === 0 && pdfRows.length === 0 && (
                    <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px' }}>
                      ודא שהקובץ הוא דוח "השוואת מכירות - יומי" מ-CashOnTab בפורמט PDF
                    </div>
                  )}
                  <button onClick={() => { setPdfSheetOpen(false); setPdfRows([]); setPdfResult(null) }}
                    style={{ marginTop: '16px', background: pdfResult.imported > 0 ? '#22c55e' : '#94a3b8', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                    סגור
                  </button>
                </div>
              )}
            </div>
          </SheetContent>
        </SheetPortal>
      </Sheet>
    </div>
  )
}
