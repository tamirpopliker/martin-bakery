import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  ArrowRight, Plus, Pencil, Trash2, Search, X,
  Building2, FileText, ChevronDown
} from 'lucide-react'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Supplier { id: number; name: string; created_at: string }

interface Invoice {
  id: number
  date: string
  supplier_id: number
  doc_type: string
  doc_number: string
  amount: number
  notes: string
}

// ─── קבועים ─────────────────────────────────────────────────────────────────
const DOC_TYPES = ['חשבונית מס', 'חשבונית עסקה', 'תעודת משלוח', 'קבלה', 'אחר']
const COLOR = '#10b981'
const BG    = '#d1fae5'

// ─── Autocomplete ────────────────────────────────────────────────────────────
function AutocompleteInput({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void
  options: string[]; placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()) && o !== value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text" value={value} placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 50, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginTop: '4px', overflow: 'hidden' }}>
          {filtered.slice(0, 6).map(o => (
            <div key={o} onMouseDown={() => { onChange(o); setOpen(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '14px', color: '#374151', borderBottom: '1px solid #f1f5f9' }}
              onMouseEnter={e => (e.currentTarget.style.background = BG)}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}
            >{o}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function Suppliers({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'invoices' | 'suppliers'>('invoices')

  // ── מצב חשבוניות ──
  const [invoices, setInvoices]       = useState<Invoice[]>([])
  const [suppliers, setSuppliers]     = useState<Supplier[]>([])
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [searchInv, setSearchInv]     = useState('')
  const [editInvId, setEditInvId]     = useState<number | null>(null)
  const [editInvData, setEditInvData] = useState<Partial<Invoice>>({})
  const [loadingInv, setLoadingInv]   = useState(false)

  // טופס חשבונית חדשה
  const [invDate, setInvDate]         = useState(new Date().toISOString().split('T')[0])
  const [invSupplier, setInvSupplier] = useState('')
  const [invDocType, setInvDocType]   = useState(DOC_TYPES[0])
  const [invDocNum, setInvDocNum]     = useState('')
  const [invAmount, setInvAmount]     = useState('')
  const [invNotes, setInvNotes]       = useState('')

  // ── מצב ספקים ──
  const [editSuppId, setEditSuppId]   = useState<number | null>(null)
  const [editSuppName, setEditSuppName] = useState('')
  const [newSuppName, setNewSuppName] = useState('')
  const [searchSupp, setSearchSupp]   = useState('')
  const [loadingSupp, setLoadingSupp] = useState(false)

  // ─── שליפות ─────────────────────────────────────────────────────────────
  async function fetchSuppliers() {
    const { data } = await supabase.from('suppliers').select('*').order('name')
    if (data) setSuppliers(data)
  }

  async function fetchInvoices() {
    const { data } = await supabase
      .from('supplier_invoices').select('*')
      .gte('date', monthFilter + '-01')
      .lte('date', monthFilter + '-31')
      .order('date', { ascending: false })
    if (data) setInvoices(data)
  }

  useEffect(() => { fetchSuppliers() }, [])
  useEffect(() => { fetchInvoices()  }, [monthFilter])

  const supplierName = (id: number) => suppliers.find(s => s.id === id)?.name || '—'
  const supplierNames = suppliers.map(s => s.name)

  // ─── חשבוניות CRUD ───────────────────────────────────────────────────────
  async function addInvoice() {
    if (!invAmount || !invDate || !invSupplier) return
    const sup = suppliers.find(s => s.name === invSupplier)
    if (!sup) { alert('ספק לא נמצא — הוסף אותו תחילה בטאב ספקים'); return }
    setLoadingInv(true)
    await supabase.from('supplier_invoices').insert({
      date: invDate, supplier_id: sup.id,
      doc_type: invDocType, doc_number: invDocNum,
      amount: parseFloat(invAmount), notes: invNotes
    })
    setInvAmount(''); setInvDocNum(''); setInvNotes('')
    await fetchInvoices()
    setLoadingInv(false)
  }

  async function deleteInvoice(id: number) {
    if (!confirm('למחוק חשבונית זו?')) return
    await supabase.from('supplier_invoices').delete().eq('id', id)
    await fetchInvoices()
  }

  async function saveInvoice(id: number) {
    // המרת שם ספק ל-id אם השתנה
    let data: any = { ...editInvData }
    if (editInvData.supplier_id === undefined && (editInvData as any).supplier_name) {
      const sup = suppliers.find(s => s.name === (editInvData as any).supplier_name)
      if (sup) data.supplier_id = sup.id
      delete data.supplier_name
    }
    await supabase.from('supplier_invoices').update(data).eq('id', id)
    setEditInvId(null)
    await fetchInvoices()
  }

  // ─── ספקים CRUD ──────────────────────────────────────────────────────────
  async function addSupplier() {
    if (!newSuppName.trim()) return
    setLoadingSupp(true)
    await supabase.from('suppliers').insert({ name: newSuppName.trim() })
    setNewSuppName('')
    await fetchSuppliers()
    setLoadingSupp(false)
  }

  async function saveSupplier(id: number) {
    await supabase.from('suppliers').update({ name: editSuppName }).eq('id', id)
    setEditSuppId(null)
    await fetchSuppliers()
  }

  async function deleteSupplier(id: number) {
    if (!confirm('למחוק ספק זה? חשבוניות קיימות לא יימחקו.')) return
    await supabase.from('suppliers').delete().eq('id', id)
    await fetchSuppliers()
  }

  // ─── חישובים ─────────────────────────────────────────────────────────────
  const filteredInv = invoices.filter(inv => {
    const name = supplierName(inv.supplier_id).toLowerCase()
    return !searchInv || name.includes(searchInv.toLowerCase()) || inv.doc_number?.includes(searchInv)
  })
  const totalInv = filteredInv.reduce((s, i) => s + Number(i.amount), 0)

  // סיכום לפי ספק
  const bySupplier = suppliers.map(s => ({
    name: s.name,
    total: filteredInv.filter(i => i.supplier_id === s.id).reduce((a, i) => a + Number(i.amount), 0)
  })).filter(s => s.total > 0).sort((a, b) => b.total - a.total)

  const filteredSupp = suppliers.filter(s =>
    !searchSupp || s.name.toLowerCase().includes(searchSupp.toLowerCase())
  )

  // ─── סגנונות ─────────────────────────────────────────────────────────────
  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
    select: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', background: 'white', width: '100%' },
  }

  return (
    <div style={S.page}>

      {/* ─── כותרת ──────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
        </button>
        <div style={{ width: '40px', height: '40px', background: BG, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Building2 size={20} color={COLOR} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>ספקים וחשבוניות</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>חומרי גלם · חשבוניות ספקים</p>
        </div>
        <div style={{ marginRight: 'auto', background: BG, border: `1px solid ${COLOR}33`, borderRadius: '10px', padding: '8px 18px' }}>
          <span style={{ fontSize: '18px', fontWeight: '800', color: COLOR }}>₪{totalInv.toLocaleString()}</span>
          <span style={{ fontSize: '12px', color: '#64748b', marginRight: '6px' }}>סה"כ החודש</span>
        </div>
      </div>

      {/* ─── טאבים ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0', padding: '0 32px', background: 'white', borderBottom: '1px solid #e2e8f0' }}>
        {([['invoices', '🧾 חשבוניות'], ['suppliers', '🏢 ניהול ספקים']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '14px 24px', background: 'none', border: 'none', borderBottom: tab === key ? `3px solid ${COLOR}` : '3px solid transparent', cursor: 'pointer', fontSize: '14px', fontWeight: tab === key ? '700' : '500', color: tab === key ? COLOR : '#64748b', transition: 'all 0.15s' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: '28px 32px', maxWidth: '1000px', margin: '0 auto' }}>

        {/* ══════════════════════ טאב חשבוניות ══════════════════════════ */}
        {tab === 'invoices' && (
          <>
            {/* טופס הוספה */}
            <div style={{ ...S.card, marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 18px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת חשבונית</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>

                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>תאריך</label>
                  <input type="date" value={invDate} onChange={e => setInvDate(e.target.value)} style={S.input} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>ספק</label>
                  <AutocompleteInput value={invSupplier} onChange={setInvSupplier} options={supplierNames} placeholder="בחר ספק..." />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>סוג מסמך</label>
                  <select value={invDocType} onChange={e => setInvDocType(e.target.value)} style={S.select}>
                    {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>מספר מסמך <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                  <input type="text" placeholder="מס׳ חשבונית" value={invDocNum} onChange={e => setInvDocNum(e.target.value)} style={S.input} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>סכום ללא מע״מ (₪)</label>
                  <input type="number" placeholder="0" value={invAmount} onChange={e => setInvAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addInvoice()}
                    style={{ ...S.input, textAlign: 'right' }} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                  <input type="text" placeholder="הערה..." value={invNotes} onChange={e => setInvNotes(e.target.value)} style={S.input} />
                </div>

              </div>
              <button onClick={addInvoice} disabled={loadingInv || !invAmount || !invSupplier}
                style={{ background: loadingInv || !invAmount || !invSupplier ? '#e2e8f0' : COLOR, color: loadingInv || !invAmount || !invSupplier ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={18} />הוסף חשבונית
              </button>
            </div>

            {/* פילטרים */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
              <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', background: 'white', fontFamily: 'inherit' }} />
              <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                <Search size={15} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" placeholder="חפש לפי ספק או מסמך..." value={searchInv} onChange={e => setSearchInv(e.target.value)}
                  style={{ ...S.input, paddingRight: '36px' }} />
                {searchInv && <button onClick={() => setSearchInv('')} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}><X size={14} color="#94a3b8" /></button>}
              </div>
            </div>

            {/* סיכום לפי ספק */}
            {bySupplier.length > 0 && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' as const, marginBottom: '16px' }}>
                {bySupplier.map(s => (
                  <div key={s.name} style={{ background: BG, border: `1px solid ${COLOR}33`, borderRadius: '10px', padding: '8px 14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>{s.name}</span>
                    <span style={{ fontSize: '13px', fontWeight: '800', color: COLOR }}>₪{s.total.toLocaleString()}</span>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>({Math.round(s.total / totalInv * 100)}%)</span>
                  </div>
                ))}
              </div>
            )}

            {/* טבלת חשבוניות */}
            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 110px 120px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>תאריך</span><span>ספק</span><span>סוג</span><span>מסמך</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
              </div>

              {filteredInv.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין חשבוניות לחודש זה</div>
              ) : filteredInv.map((inv, i) => (
                <div key={inv.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 110px 120px 36px 36px', alignItems: 'center', padding: '13px 20px', borderBottom: i < filteredInv.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editInvId === inv.id ? (
                    <>
                      <input type="date" value={editInvData.date || ''} onChange={e => setEditInvData({ ...editInvData, date: e.target.value })} style={{ border: '1px solid ' + COLOR, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                      <AutocompleteInput value={(editInvData as any).supplier_name ?? supplierName(inv.supplier_id)} onChange={v => setEditInvData({ ...editInvData, supplier_id: suppliers.find(s => s.name === v)?.id, ...(({ supplier_name: _ , ...rest }) => rest)(editInvData as any), ...{ supplier_name: v } as any })} options={supplierNames} placeholder="ספק" />
                      <select value={editInvData.doc_type || ''} onChange={e => setEditInvData({ ...editInvData, doc_type: e.target.value })} style={{ border: '1px solid ' + COLOR, borderRadius: '6px', padding: '4px 6px', fontSize: '12px', fontFamily: 'inherit' }}>
                        {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                      <input type="text" value={editInvData.doc_number || ''} onChange={e => setEditInvData({ ...editInvData, doc_number: e.target.value })} style={{ border: '1px solid ' + COLOR, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                      <input type="number" value={editInvData.amount || ''} onChange={e => setEditInvData({ ...editInvData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid ' + COLOR, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                      <button onClick={() => saveInvoice(inv.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={() => setEditInvId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(inv.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                      <div>
                        <div style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{supplierName(inv.supplier_id)}</div>
                        {inv.notes && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{inv.notes}</div>}
                      </div>
                      <span style={{ fontSize: '12px', background: BG, color: COLOR, padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>{inv.doc_type}</span>
                      <span style={{ fontSize: '13px', color: '#94a3b8' }}>{inv.doc_number || '—'}</span>
                      <span style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px' }}>₪{Number(inv.amount).toLocaleString()}</span>
                      <button onClick={() => { setEditInvId(inv.id); setEditInvData(inv) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteInvoice(inv.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              ))}

              {/* סה"כ */}
              {filteredInv.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 110px 120px 36px 36px', padding: '14px 20px', background: BG, borderTop: `2px solid ${COLOR}33`, borderRadius: '0 0 20px 20px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151', gridColumn: '1/5' }}>סה"כ — {filteredInv.length} חשבוניות</span>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: COLOR }}>₪{totalInv.toLocaleString()}</span>
                  <span /><span />
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════════════════ טאב ספקים ══════════════════════════════ */}
        {tab === 'suppliers' && (
          <>
            {/* הוספת ספק */}
            <div style={{ ...S.card, marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 18px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת ספק</h2>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שם ספק</label>
                  <input type="text" placeholder="שם הספק..." value={newSuppName}
                    onChange={e => setNewSuppName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSupplier()}
                    style={S.input} />
                </div>
                <button onClick={addSupplier} disabled={loadingSupp || !newSuppName.trim()}
                  style={{ background: loadingSupp || !newSuppName.trim() ? '#e2e8f0' : COLOR, color: loadingSupp || !newSuppName.trim() ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' as const }}>
                  <Plus size={18} />הוסף
                </button>
              </div>
            </div>

            {/* חיפוש */}
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <Search size={15} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input type="text" placeholder="חפש ספק..." value={searchSupp} onChange={e => setSearchSupp(e.target.value)}
                style={{ ...S.input, paddingRight: '36px' }} />
            </div>

            {/* רשימת ספקים */}
            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>שם ספק</span><span style={{ textAlign: 'center' }}>ס"כ החודש</span><span /><span />
              </div>

              {filteredSupp.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין ספקים</div>
              ) : filteredSupp.map((sup, i) => {
                const monthTotal = invoices.filter(inv => inv.supplier_id === sup.id).reduce((a, inv) => a + Number(inv.amount), 0)
                return (
                  <div key={sup.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 36px 36px', alignItems: 'center', padding: '13px 20px', borderBottom: i < filteredSupp.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    {editSuppId === sup.id ? (
                      <>
                        <input type="text" value={editSuppName} onChange={e => setEditSuppName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveSupplier(sup.id)}
                          autoFocus style={{ border: '1.5px solid ' + COLOR, borderRadius: '8px', padding: '6px 10px', fontSize: '14px', fontFamily: 'inherit' }} />
                        <span />
                        <button onClick={() => saveSupplier(sup.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                        <button onClick={() => setEditSuppId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '34px', height: '34px', background: BG, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Building2 size={16} color={COLOR} />
                          </div>
                          <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{sup.name}</span>
                        </div>
                        <span style={{ textAlign: 'center', fontWeight: '700', color: monthTotal > 0 ? COLOR : '#cbd5e1', fontSize: '14px' }}>
                          {monthTotal > 0 ? '₪' + monthTotal.toLocaleString() : '—'}
                        </span>
                        <button onClick={() => { setEditSuppId(sup.id); setEditSuppName(sup.name) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                        <button onClick={() => deleteSupplier(sup.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                      </>
                    )}
                  </div>
                )
              })}

              {filteredSupp.length > 0 && (
                <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderRadius: '0 0 20px 20px', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                  {filteredSupp.length} ספקים
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}