import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight, Plus, Pencil, Trash2, Search, X, ShoppingBag, CreditCard, Monitor } from 'lucide-react'
import { RevenueIcon } from '@/components/icons'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
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

export default function BranchRevenue({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [tab, setTab]               = useState<Source>('cashier')
  const [entries, setEntries]       = useState<Entry[]>([])
  const [creditCustomers, setCreditCustomers] = useState<string[]>([])
  const [searchFilter, setSearchFilter] = useState('')
  const [editId, setEditId]         = useState<number | null>(null)
  const [editData, setEditData]     = useState<Partial<Entry>>({})
  const [loading, setLoading]       = useState(false)

  // טופס
  const [date, setDate]     = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [txCount, setTxCount] = useState('')
  const [customer, setCustomer] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [notes, setNotes]   = useState('')

  async function fetchEntries() {
    const { data } = await supabase.from('branch_revenue').select('*')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  async function fetchCreditCustomers() {
    const { data } = await supabase.from('branch_revenue').select('customer')
      .eq('branch_id', branchId).eq('source', 'credit')
    if (data) setCreditCustomers([...new Set(data.map((r: any) => r.customer).filter(Boolean))] as string[])
  }

  useEffect(() => {
    fetchEntries(); fetchCreditCustomers()
    setAmount(''); setTxCount(''); setCustomer(''); setDocNumber(''); setNotes(''); setSearchFilter('')
  }, [from, to, branchId, tab])

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

  // חישובים
  const totalCashier = entries.filter(e => e.source === 'cashier').reduce((s, e) => s + Number(e.amount), 0)
  const totalWebsite = entries.filter(e => e.source === 'website').reduce((s, e) => s + Number(e.amount), 0)
  const totalCredit  = entries.filter(e => e.source === 'credit').reduce((s, e) => s + Number(e.amount), 0)
  const totalRevenue = totalCashier + totalWebsite + totalCredit
  const totalTx      = entries.filter(e => e.source === 'cashier').reduce((s, e) => s + (Number(e.transaction_count) || 0), 0)
  const avgBasket    = totalTx > 0 ? totalCashier / totalTx : 0

  const tabEntries = entries.filter(e => e.source === tab)
  const filtered   = searchFilter
    ? tabEntries.filter(e => (e.customer || '').toLowerCase().includes(searchFilter.toLowerCase()) || (e.doc_number || '').includes(searchFilter))
    : tabEntries
  const tabTotal = filtered.reduce((s, e) => s + Number(e.amount), 0)

  const dailySummary = Object.values(
    entries.reduce((acc: Record<string, any>, e) => {
      if (!acc[e.date]) acc[e.date] = { date: e.date, cashier: 0, website: 0, credit: 0, total: 0, transactions: 0 }
      acc[e.date][e.source] += Number(e.amount)
      acc[e.date].total += Number(e.amount)
      if (e.source === 'cashier') acc[e.date].transactions += Number(e.transaction_count || 0)
      return acc
    }, {})
  ).sort((a: any, b: any) => b.date.localeCompare(a.date))

  const cfg = SOURCE_CONFIG[tab]

  const S = {
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* כותרת + 4 כרטיסי סיכום */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ width: '38px', height: '38px', background: branchColor + '20', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <RevenueIcon size={18} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>הכנסות — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>קופה · אתר · הקפה · ללא מע״מ</p>
        </div>

        {/* PeriodPicker + 4 כרטיסי סיכום בכותרת */}
        <div style={{ marginRight: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          {[
            { label: 'קופה',  val: totalCashier, color: '#818cf8' },
            { label: 'אתר',   val: totalWebsite, color: '#c084fc' },
            { label: 'הקפה',  val: totalCredit,  color: '#fbbf24' },
            { label: 'סה"כ',  val: totalRevenue, color: branchColor },
          ].map(s => (
            <div key={s.label} style={{ background: s.color + '12', border: `1.5px solid ${s.color}30`, borderRadius: '10px', padding: '6px 14px', textAlign: 'center' as const, minWidth: '80px' }}>
              <div style={{ fontSize: '15px', fontWeight: '800', color: s.color }}>₪{Math.round(s.val).toLocaleString()}</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* טאבים — 3 נפרדים */}
      <div style={{ display: 'flex', padding: '0 32px', background: 'white', borderBottom: '1px solid #e2e8f0' }}>
        {(Object.entries(SOURCE_CONFIG) as [Source, any][]).map(([key, c]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '13px 22px', background: 'none', border: 'none', borderBottom: tab === key ? `3px solid ${c.color}` : '3px solid transparent', cursor: 'pointer', fontSize: '14px', fontWeight: tab === key ? '700' : '500', color: tab === key ? c.color : '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <c.Icon size={15} />{c.label}
          </button>
        ))}
        {avgBasket > 0 && (
          <span style={{ marginRight: 'auto', alignSelf: 'center', fontSize: '12px', color: '#94a3b8', paddingLeft: '16px' }}>
            סל ממוצע: ₪{Math.round(avgBasket)}
          </span>
        )}
      </div>

      <div className="page-container" style={{ padding: '20px 32px', maxWidth: '1000px', margin: '0 auto' }}>

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

        {/* טופס הזנה */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <Card className="shadow-sm mb-5" style={{ borderTop: `3px solid ${cfg.color}` }}>
          <CardContent className="p-6">
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
            style={{ background: loading || !amount || (tab === 'credit' && !customer) ? '#e2e8f0' : cfg.color, color: loading || !amount || (tab === 'credit' && !customer) ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} />הוסף
          </button>
          </CardContent>
        </Card>
        </motion.div>

        {/* טבלת רשומות */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div className="table-scroll">
        <Card className="shadow-sm mb-4">
          <CardContent className="p-0">
          <div style={{ display: 'grid', gridTemplateColumns: tab === 'credit' ? '110px 1fr 110px 130px 36px 36px' : '110px 1fr 80px 130px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
            <span>תאריך</span>
            <span>{tab === 'credit' ? 'לקוח' : 'הערות'}</span>
            <span style={{ textAlign: 'center' }}>{tab === 'credit' ? 'תעודה' : 'עסקאות'}</span>
            <span style={{ textAlign: 'left' }}>סכום</span>
            <span /><span />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין רשומות לחודש זה</div>
          ) : filtered.map((entry, i) => (
            <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: tab === 'credit' ? '110px 1fr 110px 130px 36px 36px' : '110px 1fr 80px 130px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              {editId === entry.id ? (
                <>
                  <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                  {tab === 'credit'
                    ? <AutocompleteInput value={editData.customer || ''} onChange={v => setEditData({ ...editData, customer: v })} suggestions={creditCustomers} placeholder="לקוח" color={cfg.color} />
                    : <input type="text" value={editData.notes || ''} onChange={e => setEditData({ ...editData, notes: e.target.value })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                  }
                  <input type={tab === 'credit' ? 'text' : 'number'} value={tab === 'credit' ? (editData.doc_number || '') : (editData.transaction_count || '')} onChange={e => setEditData({ ...editData, ...(tab === 'credit' ? { doc_number: e.target.value } : { transaction_count: parseInt(e.target.value) }) })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 8px', fontSize: '12px', textAlign: 'center' as const }} />
                  <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                  <button onClick={() => saveEdit(entry.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                  <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                  <div><div style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{tab === 'credit' ? (entry.customer || '—') : (entry.notes || '—')}</div></div>
                  <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center' }}>{tab === 'credit' ? (entry.doc_number || '—') : (entry.transaction_count || '—')}</span>
                  <span style={{ fontWeight: '800', color: cfg.color, fontSize: '15px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                  <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                  <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#fb7185" /></button>
                </>
              )}
            </div>
          ))}

          {filtered.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', background: cfg.bg, borderTop: `2px solid ${cfg.color}33`, borderRadius: '0 0 20px 20px' }}>
              <span style={{ fontWeight: '700', color: '#374151', fontSize: '14px' }}>סה"כ — {filtered.length} רשומות</span>
              <span style={{ fontWeight: '800', color: cfg.color, fontSize: '18px' }}>₪{tabTotal.toLocaleString()}</span>
            </div>
          )}
          </CardContent>
        </Card>
        </div>
        </motion.div>

        {/* סיכום יומי */}
        {dailySummary.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className="table-scroll">
          <Card className="shadow-sm">
            <CardContent className="p-6">
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>📅 סיכום יומי — כל המקורות</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 110px 70px', padding: '9px 18px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
              <span>תאריך</span><span>קופה</span><span>אתר</span><span>הקפה</span><span>סה"כ</span><span style={{ textAlign: 'center' }}>עסקאות</span>
            </div>
            {dailySummary.map((day: any, i: number) => (
              <div key={day.date} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 110px 70px', padding: '11px 18px', borderBottom: i < dailySummary.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#374151', fontWeight: '600' }}>{new Date(day.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}</span>
                <span style={{ color: '#818cf8', fontWeight: '600', fontSize: '13px' }}>{day.cashier > 0 ? '₪' + day.cashier.toLocaleString() : '—'}</span>
                <span style={{ color: '#c084fc', fontWeight: '600', fontSize: '13px' }}>{day.website > 0 ? '₪' + day.website.toLocaleString() : '—'}</span>
                <span style={{ color: '#fbbf24', fontWeight: '600', fontSize: '13px' }}>{day.credit > 0 ? '₪' + day.credit.toLocaleString() : '—'}</span>
                <span style={{ fontWeight: '800', color: branchColor, fontSize: '14px' }}>₪{day.total.toLocaleString()}</span>
                <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{day.transactions || '—'}</span>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 110px 70px', padding: '12px 18px', background: branchColor + '15', borderTop: `2px solid ${branchColor}33`, borderRadius: '0 0 20px 20px', fontWeight: '800' }}>
              <span style={{ color: '#374151', fontSize: '13px' }}>סה"כ</span>
              <span style={{ color: '#818cf8' }}>₪{totalCashier.toLocaleString()}</span>
              <span style={{ color: '#c084fc' }}>₪{totalWebsite.toLocaleString()}</span>
              <span style={{ color: '#fbbf24' }}>₪{totalCredit.toLocaleString()}</span>
              <span style={{ color: branchColor, fontSize: '15px' }}>₪{totalRevenue.toLocaleString()}</span>
              <span style={{ textAlign: 'center', color: '#64748b' }}>{totalTx || '—'}</span>
            </div>
            </CardContent>
          </Card>
          </div>
          </motion.div>
        )}

      </div>
    </div>
  )
}
