import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Plus, Pencil, Trash2, Search, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { RevenueIcon } from '@/components/icons'
import { detectBranchId, getBranchNameById } from '../lib/internalCustomers'
import { useBranches } from '../lib/BranchContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Props { onBack: () => void }

type SaleTab = 'b2b'

interface Entry {
  id: number
  date: string
  customer: string
  amount: number
  doc_number: string
  notes: string
  is_internal?: boolean
  target_branch_id?: number | null
  branch_status?: string | null
}

interface TabConfig {
  label: string
  subtitle: string
  color: string
  bg: string
  table: string
  filterCol: string
  filterVal: string
}

// ─── Animation variants ─────────────────────────────────────────────────────
const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── קונפיגורציה לכל טאב ─────────────────────────────────────────────────────
const TAB_CONFIG: Record<SaleTab, TabConfig> = {
  b2b:    { label: 'מכירות חיצוניות (B2B)', subtitle: 'לקוחות עסקיים חיצוניים', color: '#818cf8', bg: '#e0e7ff', table: 'factory_b2b_sales', filterCol: 'sale_type', filterVal: 'b2b' },
}

// ─── Autocomplete ────────────────────────────────────────────────────────────
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
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 50, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginTop: '4px', overflow: 'hidden' }}>
          {filtered.slice(0, 6).map(s => (
            <div key={s} onMouseDown={() => { onChange(s); setOpen(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '14px', color: '#374151', borderBottom: '1px solid #f1f5f9' }}
            >{s}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function FactoryB2B({ onBack }: Props) {
  const [tab, setTab]                   = useState<SaleTab>('b2b')
  const cfg = TAB_CONFIG[tab]
  const { period, setPeriod, from, to } = usePeriod()
  const { branches }                    = useBranches()
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null)

  const [entries, setEntries]           = useState<Entry[]>([])
  const [allCustomers, setAllCustomers] = useState<string[]>([])
  const [searchFilter, setSearchFilter] = useState('')
  const [editId, setEditId]             = useState<number | null>(null)
  const [editData, setEditData]         = useState<Partial<Entry>>({})
  const [loading, setLoading]           = useState(false)
  const [showRanking, setShowRanking]   = useState(false)

  // טופס
  const [date, setDate]                 = useState(new Date().toISOString().split('T')[0])
  const [customer, setCustomer]         = useState('')
  const [amount, setAmount]             = useState('')
  const [docNumber, setDocNumber]       = useState('')
  const [notes, setNotes]               = useState('')

  // ─── שליפות ──────────────────────────────────────────────────────────────
  async function fetchEntries() {
    const { data } = await supabase
      .from(cfg.table)
      .select('*')
      .eq(cfg.filterCol, cfg.filterVal)
      .gte('date', from)
      .lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  async function fetchCustomers() {
    // אחד את רשימת הלקוחות מכל הטבלאות
    const [res1, res2] = await Promise.all([
      supabase.from('factory_sales').select('customer'),
      supabase.from('factory_b2b_sales').select('customer'),
    ])
    const all = [...(res1.data || []), ...(res2.data || [])]
    const unique = [...new Set(all.map((r: any) => r.customer).filter(Boolean))] as string[]
    setAllCustomers(unique.sort())
  }

  useEffect(() => {
    fetchEntries()
    fetchCustomers()
    setSearchFilter('')
    setEditId(null)
  }, [tab, from, to])

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  async function addEntry() {
    if (!amount || !date || !customer) return

    // warn if free-text matches a branch but user didn't pick from branch buttons
    if (!selectedBranch) {
      const fallbackBranch = detectBranchId(customer)
      if (fallbackBranch !== null) {
        const proceed = confirm('נראה שהלקוח תואם סניף פנימי. האם להמשיך בלי לבחור סניף?')
        if (!proceed) return
      }
    }

    setLoading(true)
    const payload: any = {
      date, customer,
      amount: parseFloat(amount),
      doc_number: docNumber,
      notes,
      [cfg.filterCol]: cfg.filterVal,
      is_internal: selectedBranch !== null,
      target_branch_id: selectedBranch,
      branch_status: selectedBranch !== null ? 'pending' : null,
    }
    await supabase.from(cfg.table).insert(payload)
    if (!allCustomers.includes(customer)) setAllCustomers(p => [...p, customer].sort())
    setAmount(''); setDocNumber(''); setNotes(''); setSelectedBranch(null)
    await fetchEntries()
    setLoading(false)
  }

  async function deleteEntry(id: number) {
    if (!confirm('למחוק רשומה זו?')) return
    await supabase.from(cfg.table).delete().eq('id', id)
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    const updates: any = { ...editData }
    // אם שם הלקוח שונה — בדוק מחדש אם פנימי
    if (editData.customer) {
      const branchId = detectBranchId(editData.customer)
      updates.is_internal = branchId !== null
      updates.target_branch_id = branchId
      updates.branch_status = branchId !== null ? 'pending' : null
    }
    await supabase.from(cfg.table).update(updates).eq('id', id)
    setEditId(null)
    await fetchEntries()
  }

  // ─── חישובים ─────────────────────────────────────────────────────────────
  const filtered = searchFilter
    ? entries.filter(e => e.customer.toLowerCase().includes(searchFilter.toLowerCase()) || e.doc_number?.includes(searchFilter))
    : entries

  const total = filtered.reduce((s, e) => s + Number(e.amount), 0)

  // דירוג לקוחות
  const ranking = Object.values(
    entries.reduce((acc: Record<string, { name: string; total: number; count: number }>, e) => {
      if (!acc[e.customer]) acc[e.customer] = { name: e.customer, total: 0, count: 0 }
      acc[e.customer].total += Number(e.amount)
      acc[e.customer].count++
      return acc
    }, {})
  ).sort((a, b) => b.total - a.total)

  const grandTotal = entries.reduce((s, e) => s + Number(e.amount), 0)

  // detect if free-text customer matches a branch name
  const matchingBranches = !selectedBranch && customer.trim()
    ? branches.filter(b => b.name.includes(customer.trim()) || customer.trim().includes(b.name))
    : []

  // ─── סגנונות ─────────────────────────────────────────────────────────────
  const S = {
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div className="min-h-screen" style={{ direction: 'rtl', background: '#f8fafc' }}>

      <PageHeader title="מכירות חיצוניות (B2B)" subtitle="לקוחות עסקיים חיצוניים" onBack={onBack} />

      <div className="page-container" style={{ padding: '28px 32px', maxWidth: '960px', margin: '0 auto' }}>

        {/* ─── תיאור ────────────────────────────────────────────────────── */}
        <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 18px', marginBottom: '20px', fontSize: 13, color: '#0f172a', fontWeight: 600, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          {cfg.subtitle}
          <span style={{ fontWeight: 400, color: '#94a3b8', marginRight: '8px' }}>— ללא מע״מ, נכנסות להכנסות ברווח נשלט</span>
        </div>

        {/* ─── טופס הוספה ───────────────────────────────────────────────── */}
        <Card className="shadow-sm mb-5">
          <CardContent className="p-6">
          <h2 style={{ margin: '0 0 18px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת מכירה — {cfg.label}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
              <label style={S.label}>מכירה לסניף (פנימי)</label>
              <div className="flex flex-row gap-2 flex-wrap mb-2">
                {branches.map(b => (
                  <Button key={b.id} type="button" size="sm"
                    variant={selectedBranch === b.id ? 'default' : 'outline'}
                    className={selectedBranch === b.id ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : ''}
                    onClick={() => {
                      setSelectedBranch(b.id)
                      setCustomer(b.name)
                    }}
                  >
                    {b.name}
                  </Button>
                ))}
              </div>
              <label style={S.label}>לקוח חיצוני:</label>
              <AutocompleteInput value={customer} onChange={(v) => { setCustomer(v); setSelectedBranch(null) }} suggestions={allCustomers}
                placeholder="שם לקוח..."
                color={cfg.color} />
              {matchingBranches.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <div className="mb-1 font-semibold">נראה שזו רכישה פנימית — האם לבחור סניף?</div>
                  <div className="flex flex-row gap-2 flex-wrap">
                    {matchingBranches.map(b => (
                      <Button key={b.id} type="button" size="sm" variant="outline"
                        className="border-amber-400 text-amber-800 hover:bg-amber-100"
                        onClick={() => {
                          setSelectedBranch(b.id)
                          setCustomer(b.name)
                        }}
                      >
                        {b.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>סכום ללא מע״מ (₪)</label>
              <input type="number" placeholder="0" value={amount}
                onChange={e => setAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEntry()}
                style={{ ...S.input, textAlign: 'right' as const }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>מספר תעודה <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <input type="text" placeholder="מס׳ תעודה" value={docNumber}
                onChange={e => setDocNumber(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <input type="text" placeholder="הערה..." value={notes}
                onChange={e => setNotes(e.target.value)} style={S.input} />
            </div>

          </div>
          <button onClick={addEntry} disabled={loading || !amount || !customer}
            style={{ background: loading || !amount || !customer ? '#e2e8f0' : '#6366f1', color: loading || !amount || !customer ? '#94a3b8' : 'white', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} />הוסף
          </button>
          </CardContent>
        </Card>

        {/* ─── פילטרים + דירוג ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
            <Search size={15} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input type="text" placeholder="חפש לפי לקוח..." value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              style={{ ...S.input, paddingRight: '36px' }} />
            {searchFilter && <button onClick={() => setSearchFilter('')} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={14} color="#94a3b8" /></button>}
          </div>
          <button onClick={() => setShowRanking(v => !v)}
            style={{ background: showRanking ? '#6366f1' : 'white', color: showRanking ? 'white' : '#64748b', border: showRanking ? 'none' : '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
            דירוג לקוחות
          </button>
        </div>

        {/* ─── דירוג לקוחות ────────────────────────────────────────────── */}
        {showRanking && ranking.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="shadow-sm mb-4">
            <CardContent className="p-6">
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>דירוג לקוחות — {period.label}</h3>
            {ranking.map((r, i) => {
              const pctVal = grandTotal > 0 ? (r.total / grandTotal) * 100 : 0
              return (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <span style={{ width: '22px', height: '22px', background: i < 3 ? '#6366f1' : '#f1f5f9', color: i < 3 ? 'white' : '#64748b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px', flex: 1 }}>{r.name}</span>
                  <div style={{ width: '140px', background: '#f1f5f9', borderRadius: '20px', height: '8px', overflow: 'hidden' }}>
                    <div style={{ width: `${pctVal}%`, background: '#6366f1', height: '100%', borderRadius: '20px' }} />
                  </div>
                  <span style={{ fontWeight: '700', color: '#6366f1', fontSize: '14px', minWidth: '80px', textAlign: 'left' as const }}>
                    ₪{r.total.toLocaleString()}
                  </span>
                  <span style={{ fontSize: '12px', color: '#94a3b8', minWidth: '40px' }}>{pctVal.toFixed(1)}%</span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>{r.count} עסקאות</span>
                </div>
              )
            })}
            </CardContent>
          </Card>
          </motion.div>
        )}

        {/* ─── טבלת רשומות ──────────────────────────────────────────────── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div className="table-scroll"><Card className="shadow-sm">
          <CardContent className="p-6">
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 130px 36px 36px', padding: '10px 20px', background: 'white', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
            <span>תאריך</span><span>לקוח</span><span>תעודה</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין רשומות לחודש זה</div>
          ) : filtered.map((entry, i) => (
            <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 130px 36px 36px', alignItems: 'center', padding: '13px 20px', borderBottom: '1px solid #f8fafc', background: 'transparent' }}>
              {editId === entry.id ? (
                <>
                  <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                  <AutocompleteInput value={editData.customer || ''} onChange={v => setEditData({ ...editData, customer: v })} suggestions={allCustomers} placeholder="לקוח" color="#6366f1" />
                  <input type="text" value={editData.doc_number || ''} onChange={e => setEditData({ ...editData, doc_number: e.target.value })} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                  <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                  <button onClick={() => saveEdit(entry.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                  <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                  <div>
                    <div style={{ fontWeight: '600', color: '#374151', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {entry.customer}
                      {entry.is_internal && (
                        <span style={{
                          fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '6px',
                          background: entry.branch_status === 'approved' ? '#dcfce7' : entry.branch_status === 'disputed' ? '#fef3c7' : '#e0e7ff',
                          color: entry.branch_status === 'approved' ? '#16a34a' : entry.branch_status === 'disputed' ? '#d97706' : '#4f46e5',
                        }}>
                          פנימי · {entry.branch_status === 'approved' ? 'אושר' : entry.branch_status === 'disputed' ? 'נערך' : 'ממתין'}
                          {entry.target_branch_id ? ` · ${getBranchNameById(entry.target_branch_id) || ''}` : ''}
                        </span>
                      )}
                    </div>
                    {entry.notes && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{entry.notes}</div>}
                  </div>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>{entry.doc_number || '—'}</span>
                  <span style={{ fontWeight: '800', color: '#6366f1', fontSize: '15px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                  <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                  <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#fb7185" /></button>
                </>
              )}
            </div>
          ))}

          {filtered.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: '#fafafa', borderTop: '1px solid #f1f5f9', borderRadius: '0 0 12px 12px' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>סה"כ — {filtered.length} רשומות</span>
              <span style={{ fontSize: '20px', fontWeight: '800', color: '#6366f1' }}>₪{total.toLocaleString()}</span>
            </div>
          )}
          </CardContent>
        </Card></div>
        </motion.div>

      </div>
    </div>
  )
}
