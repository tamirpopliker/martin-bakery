import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Plus, Pencil, Trash2, Search, X, Receipt } from 'lucide-react'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

type ExpenseType = 'suppliers' | 'repairs' | 'infrastructure' | 'deliveries' | 'other'

interface Entry {
  id: number
  date: string
  expense_type: ExpenseType
  supplier: string
  amount: number
  doc_number: string | null
  notes: string | null
  from_factory: boolean
}

interface Supplier { id: number; name: string }

const TYPE_CONFIG: Record<ExpenseType, { label: string; color: string; bg: string }> = {
  suppliers:      { label: 'ספקים / מלאי',  color: '#3b82f6', bg: '#dbeafe' },
  repairs:        { label: 'תיקונים',         color: '#f97316', bg: '#fff7ed' },
  infrastructure: { label: 'תשתיות',          color: '#8b5cf6', bg: '#ede9fe' },
  deliveries:     { label: 'משלוחים',         color: '#10b981', bg: '#d1fae5' },
  other:          { label: 'אחר',             color: '#64748b', bg: '#f1f5f9' },
}

function AutocompleteInput({ value, onChange, options, placeholder, color }: {
  value: string; onChange: (v: string) => void
  options: string[]; placeholder: string; color: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()) && o !== value)
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
          {filtered.slice(0, 6).map(o => (
            <div key={o} onMouseDown={() => { onChange(o); setOpen(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '14px', color: '#374151', borderBottom: '1px solid #f1f5f9' }}
              onMouseEnter={e => (e.currentTarget.style.background = color + '15')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}>{o}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BranchExpenses({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [entries, setEntries]         = useState<Entry[]>([])
  const [suppliers, setSuppliers]     = useState<Supplier[]>([])
  const [typeFilter, setTypeFilter]   = useState<ExpenseType | 'all'>('all')
  const [searchFilter, setSearchFilter] = useState('')
  const [editId, setEditId]           = useState<number | null>(null)
  const [editData, setEditData]       = useState<Partial<Entry>>({})
  const [loading, setLoading]         = useState(false)

  // טופס — supplier אינו חובה
  const [date, setDate]       = useState(new Date().toISOString().split('T')[0])
  const [expType, setExpType] = useState<ExpenseType>('suppliers')
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount]   = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [notes, setNotes]     = useState('')

  async function fetchEntries() {
    const { data } = await supabase.from('branch_expenses').select('*')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  async function fetchSuppliers() {
    const { data } = await supabase.from('suppliers').select('id,name').order('name')
    if (data) setSuppliers(data)
  }

  useEffect(() => { fetchEntries(); fetchSuppliers() }, [from, to, branchId])

  const supplierNames = suppliers.map(s => s.name)

  // ─── כפתור פעיל כל עוד יש סכום ותאריך ──────────────────────────────────
  const canAdd = !loading && !!amount && parseFloat(amount) > 0 && !!date

  async function addEntry() {
    if (!canAdd) return
    setLoading(true)
    await supabase.from('branch_expenses').insert({
      branch_id: branchId, date, expense_type: expType,
      supplier: supplier || '—',
      amount: parseFloat(amount),
      doc_number: docNumber || null,
      notes: notes || null,
      from_factory: false
    })
    setAmount(''); setDocNumber(''); setNotes('')
    await fetchEntries()
    setLoading(false)
  }

  async function deleteEntry(id: number) {
    if (!confirm('למחוק הוצאה זו?')) return
    await supabase.from('branch_expenses').delete().eq('id', id)
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    await supabase.from('branch_expenses').update(editData).eq('id', id)
    setEditId(null); await fetchEntries()
  }

  const filtered = entries.filter(e => {
    if (typeFilter !== 'all' && e.expense_type !== typeFilter) return false
    if (searchFilter && !e.supplier.toLowerCase().includes(searchFilter.toLowerCase())) return false
    return true
  })

  const total    = filtered.reduce((s, e) => s + Number(e.amount), 0)
  const totalAll = entries.reduce((s, e) => s + Number(e.amount), 0)

  const byType = Object.entries(TYPE_CONFIG).map(([key, cfg]) => ({
    key: key as ExpenseType, ...cfg,
    total: entries.filter(e => e.expense_type === key).reduce((s, e) => s + Number(e.amount), 0)
  })).filter(t => t.total > 0)

  const bySupplier = Object.values(
    filtered.reduce((acc: Record<string, any>, e) => {
      if (!acc[e.supplier]) acc[e.supplier] = { name: e.supplier, total: 0, count: 0 }
      acc[e.supplier].total += Number(e.amount); acc[e.supplier].count++
      return acc
    }, {})
  ).sort((a: any, b: any) => b.total - a.total).slice(0, 5)

  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={S.page}>
      {/* כותרת */}
      <div className="page-header" style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Receipt size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>הוצאות — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>ספקים · תיקונים · תשתיות · משלוחים</p>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '8px 18px' }}>
            <span style={{ fontSize: '18px', fontWeight: '800', color: '#ef4444' }}>₪{totalAll.toLocaleString()}</span>
            <span style={{ fontSize: '12px', color: '#64748b', marginRight: '6px' }}>סה"כ</span>
          </div>
        </div>
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1000px', margin: '0 auto' }}>

        {/* סיכום לפי סוג */}
        {byType.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' as const, marginBottom: '20px' }}>
            {byType.map(t => (
              <button key={t.key} onClick={() => setTypeFilter(typeFilter === t.key ? 'all' : t.key)}
                style={{ background: typeFilter === t.key ? t.color : t.bg, border: `1.5px solid ${t.color}33`, borderRadius: '12px', padding: '10px 16px', cursor: 'pointer', textAlign: 'right' as const, transition: 'all 0.15s' }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: typeFilter === t.key ? 'white' : t.color }}>₪{t.total.toLocaleString()}</div>
                <div style={{ fontSize: '11px', color: typeFilter === t.key ? 'rgba(255,255,255,0.8)' : '#64748b' }}>{t.label}</div>
              </button>
            ))}
          </div>
        )}

        {/* טופס הוספה */}
        <div style={{ ...S.card, marginBottom: '20px' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת הוצאה</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '12px', marginBottom: '14px' }}>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>סוג הוצאה</label>
              <select value={expType} onChange={e => setExpType(e.target.value as ExpenseType)}
                style={{ ...S.input, background: 'white' }}>
                {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
              <label style={S.label}>ספק <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <AutocompleteInput value={supplier} onChange={setSupplier} options={supplierNames} placeholder="שם ספק..." color={branchColor} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>סכום ללא מע״מ (₪) *</label>
              <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEntry()}
                style={{ ...S.input, textAlign: 'right' as const, borderColor: amount ? '#e2e8f0' : '#fca5a5' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>מספר מסמך <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <input type="text" placeholder="מס׳ חשבונית" value={docNumber} onChange={e => setDocNumber(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <input type="text" placeholder="הערה..." value={notes} onChange={e => setNotes(e.target.value)} style={S.input} />
            </div>
          </div>

          <button onClick={addEntry} disabled={!canAdd}
            style={{ background: canAdd ? branchColor : '#e2e8f0', color: canAdd ? 'white' : '#94a3b8', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: canAdd ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} />הוסף הוצאה
          </button>
        </div>

        {/* פילטרים */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
            <button onClick={() => setTypeFilter('all')} style={{ background: typeFilter === 'all' ? branchColor : '#f1f5f9', color: typeFilter === 'all' ? 'white' : '#64748b', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>הכל</button>
            {Object.entries(TYPE_CONFIG).map(([k, v]) => (
              <button key={k} onClick={() => setTypeFilter(k as ExpenseType)}
                style={{ background: typeFilter === k ? v.color : '#f1f5f9', color: typeFilter === k ? 'white' : '#64748b', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                {v.label}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
            <Search size={15} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input type="text" placeholder="חפש ספק..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
              style={{ ...S.input, paddingRight: '36px' }} />
            {searchFilter && <button onClick={() => setSearchFilter('')} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={14} color="#94a3b8" /></button>}
          </div>
        </div>

        {/* סיכום ספקים */}
        {bySupplier.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '14px' }}>
            {(bySupplier as any[]).map((s: any) => (
              <div key={s.name} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '6px 12px', fontSize: '12px' }}>
                <span style={{ fontWeight: '600', color: '#374151' }}>{s.name}</span>
                <span style={{ color: '#ef4444', fontWeight: '700', marginRight: '6px' }}>₪{s.total.toLocaleString()}</span>
                <span style={{ color: '#94a3b8' }}>({s.count})</span>
              </div>
            ))}
          </div>
        )}

        {/* טבלה */}
        <div className="table-scroll"><div style={S.card}>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 90px 1fr 100px 130px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
            <span>תאריך</span><span>סוג</span><span>ספק</span><span>מסמך</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין הוצאות לתקופה זו</div>
          ) : filtered.map((entry, i) => {
            const tc = TYPE_CONFIG[entry.expense_type]
            return (
              <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '100px 90px 1fr 100px 130px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                {editId === entry.id ? (
                  <>
                    <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                    <select value={editData.expense_type || ''} onChange={e => setEditData({ ...editData, expense_type: e.target.value as ExpenseType })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 6px', fontSize: '11px', fontFamily: 'inherit' }}>
                      {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <AutocompleteInput value={editData.supplier || ''} onChange={v => setEditData({ ...editData, supplier: v })} options={supplierNames} placeholder="ספק" color={branchColor} />
                    <input type="text" value={editData.doc_number || ''} onChange={e => setEditData({ ...editData, doc_number: e.target.value })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                    <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                    <button onClick={() => saveEdit(entry.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                    <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                    <span style={{ fontSize: '11px', background: tc.bg, color: tc.color, padding: '2px 7px', borderRadius: '20px', fontWeight: '600' }}>{tc.label}</span>
                    <div>
                      <div style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{entry.supplier}</div>
                      {entry.notes && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{entry.notes}</div>}
                    </div>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>{entry.doc_number || '—'}</span>
                    <span style={{ fontWeight: '800', color: '#ef4444', fontSize: '15px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                    <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                    <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                  </>
                )}
              </div>
            )
          })}

          {filtered.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', background: '#fef2f2', borderTop: '2px solid #fecaca', borderRadius: '0 0 20px 20px' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>סה"כ — {filtered.length} רשומות</span>
              <span style={{ fontSize: '20px', fontWeight: '800', color: '#ef4444' }}>₪{total.toLocaleString()}</span>
            </div>
          )}
        </div></div>
      </div>
    </div>
  )
}