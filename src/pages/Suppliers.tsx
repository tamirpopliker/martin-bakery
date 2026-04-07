import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import {
  Plus, Pencil, Trash2, Search, X,
  Building2
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
const COLOR = '#34d399'
const BG    = '#d1fae5'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

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
        style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 50, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.08)', marginTop: 4, overflow: 'hidden' }}>
          {filtered.slice(0, 6).map(o => (
            <div key={o} onMouseDown={() => { onChange(o); setOpen(false) }}
              style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 14, color: '#374151', borderBottom: '1px solid #f8fafc' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
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

  const { period, setPeriod, from, to } = usePeriod()

  // ─── שליפות ─────────────────────────────────────────────────────────────
  async function fetchSuppliers() {
    const { data } = await supabase.from('suppliers').select('*').order('name')
    if (data) setSuppliers(data)
  }

  async function fetchInvoices() {
    const { data } = await supabase
      .from('supplier_invoices').select('*')
      .gte('date', from)
      .lt('date', to)
      .order('date', { ascending: false })
    if (data) setInvoices(data)
  }

  useEffect(() => { fetchSuppliers() }, [])
  useEffect(() => { fetchInvoices()  }, [from, to])

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

  const bySupplier = suppliers.map(s => ({
    name: s.name,
    total: filteredInv.filter(i => i.supplier_id === s.id).reduce((a, i) => a + Number(i.amount), 0)
  })).filter(s => s.total > 0).sort((a, b) => b.total - a.total)

  const filteredSupp = suppliers.filter(s =>
    !searchSupp || s.name.toLowerCase().includes(searchSupp.toLowerCase())
  )

  // ─── סגנונות ─────────────────────────────────────────────────────────────
  const S = {
    label: { fontSize: 13 as const, fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' as const },
    input: { border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
    select: { border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', background: 'white', width: '100%' },
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>

      {/* ─── כותרת ──────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>ספקים</h1>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>חומרי גלם · חשבוניות ספקים</p>
            </div>
            <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 10, padding: '8px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>₪{totalInv.toLocaleString()}</span>
              <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 6 }}>סה"כ החודש</span>
            </div>
          </div>
          <button onClick={onBack} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px', fontSize: 13, color: '#64748b', cursor: 'pointer' }}>{'\u2190'} חזרה</button>
        </div>
      </div>

      {/* ─── טאבים ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, padding: '0 20px', background: 'white', borderBottom: '1px solid #f1f5f9' }}>
        {([['invoices', 'חשבוניות'], ['suppliers', 'ניהול ספקים']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '13px 22px', background: 'none', border: 'none', borderBottom: tab === key ? '2px solid #6366f1' : '2px solid transparent', cursor: 'pointer', fontSize: 13, fontWeight: tab === key ? 700 : 500, color: tab === key ? '#6366f1' : '#64748b', transition: 'all 0.15s' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: '24px 20px', maxWidth: 1000, margin: '0 auto' }}>

        {/* ══════════════════════ טאב חשבוניות ══════════════════════════ */}
        {tab === 'invoices' && (
          <>
            {/* טופס הוספה */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 24, marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>הוספת חשבונית</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>

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
                style={{ background: loadingInv || !invAmount || !invSupplier ? '#e2e8f0' : '#6366f1', color: loadingInv || !invAmount || !invSupplier ? '#94a3b8' : 'white', border: 'none', borderRadius: 10, padding: '9px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={16} />הוסף חשבונית
              </button>
            </div>

            {/* פילטרים */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' as const }}>
              <PeriodPicker period={period} onChange={setPeriod} />
              <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                <Search size={14} color="#94a3b8" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" placeholder="חפש לפי ספק או מסמך..." value={searchInv} onChange={e => setSearchInv(e.target.value)}
                  style={{ ...S.input, paddingRight: 36 }} />
                {searchInv && <button onClick={() => setSearchInv('')} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><X size={13} color="#94a3b8" /></button>}
              </div>
            </div>

            {/* סיכום לפי ספק */}
            {bySupplier.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 16 }}>
                {bySupplier.map(s => (
                  <div key={s.name} style={{ background: '#f1f5f9', borderRadius: 8, padding: '6px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{s.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>₪{s.total.toLocaleString()}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>({Math.round(s.total / totalInv * 100)}%)</span>
                  </div>
                ))}
              </div>
            )}

            {/* טבלת חשבוניות */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll">
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 110px 120px 36px 36px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                  <span>תאריך</span><span>ספק</span><span>סוג</span><span>מסמך</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
                </div>

                {filteredInv.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>אין חשבוניות לחודש זה</div>
                ) : filteredInv.map((inv, i) => (
                  <div key={inv.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 110px 120px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f8fafc' }}>
                    {editInvId === inv.id ? (
                      <>
                        <input type="date" value={editInvData.date || ''} onChange={e => setEditInvData({ ...editInvData, date: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
                        <AutocompleteInput value={(editInvData as any).supplier_name ?? supplierName(inv.supplier_id)} onChange={v => setEditInvData({ ...editInvData, supplier_id: suppliers.find(s => s.name === v)?.id, ...(({ supplier_name: _ , ...rest }) => rest)(editInvData as any), ...{ supplier_name: v } as any })} options={supplierNames} placeholder="ספק" />
                        <select value={editInvData.doc_type || ''} onChange={e => setEditInvData({ ...editInvData, doc_type: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 6px', fontSize: 12, fontFamily: 'inherit' }}>
                          {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                        <input type="text" value={editInvData.doc_number || ''} onChange={e => setEditInvData({ ...editInvData, doc_number: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
                        <input type="number" value={editInvData.amount || ''} onChange={e => setEditInvData({ ...editInvData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
                        <button onClick={() => saveInvoice(inv.id)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✓</button>
                        <button onClick={() => setEditInvId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 13, color: '#64748b' }}>{new Date(inv.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                        <div>
                          <div style={{ fontWeight: 600, color: '#374151', fontSize: 13 }}>{supplierName(inv.supplier_id)}</div>
                          {inv.notes && <div style={{ fontSize: 11, color: '#94a3b8' }}>{inv.notes}</div>}
                        </div>
                        <span style={{ fontSize: 11, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{inv.doc_type}</span>
                        <span style={{ fontSize: 13, color: '#94a3b8' }}>{inv.doc_number || '—'}</span>
                        <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 14 }}>₪{Number(inv.amount).toLocaleString()}</span>
                        <button onClick={() => { setEditInvId(inv.id); setEditInvData(inv) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Pencil size={13} color="#94a3b8" /></button>
                        <button onClick={() => deleteInvoice(inv.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={13} color="#94a3b8" /></button>
                      </>
                    )}
                  </div>
                ))}

                {/* סה"כ */}
                {filteredInv.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 110px 120px 36px 36px', padding: '13px 20px', background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#374151', gridColumn: '1/5' }}>סה"כ — {filteredInv.length} חשבוניות</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>₪{totalInv.toLocaleString()}</span>
                    <span /><span />
                  </div>
                )}
              </div>
            </div>
            </motion.div>
          </>
        )}

        {/* ══════════════════════ טאב ספקים ══════════════════════════════ */}
        {tab === 'suppliers' && (
          <>
            {/* הוספת ספק */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 24, marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>הוספת ספק</h2>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שם ספק</label>
                  <input type="text" placeholder="שם הספק..." value={newSuppName}
                    onChange={e => setNewSuppName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSupplier()}
                    style={S.input} />
                </div>
                <button onClick={addSupplier} disabled={loadingSupp || !newSuppName.trim()}
                  style={{ background: loadingSupp || !newSuppName.trim() ? '#e2e8f0' : '#6366f1', color: loadingSupp || !newSuppName.trim() ? '#94a3b8' : 'white', border: 'none', borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' as const }}>
                  <Plus size={16} />הוסף
                </button>
              </div>
            </div>

            {/* חיפוש */}
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input type="text" placeholder="חפש ספק..." value={searchSupp} onChange={e => setSearchSupp(e.target.value)}
                style={{ ...S.input, paddingRight: 36 }} />
            </div>

            {/* רשימת ספקים */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll">
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 36px 36px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                  <span>שם ספק</span><span style={{ textAlign: 'center' }}>ס"כ החודש</span><span /><span />
                </div>

                {filteredSupp.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>אין ספקים</div>
                ) : filteredSupp.map((sup, i) => {
                  const monthTotal = invoices.filter(inv => inv.supplier_id === sup.id).reduce((a, inv) => a + Number(inv.amount), 0)
                  return (
                    <div key={sup.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f8fafc' }}>
                      {editSuppId === sup.id ? (
                        <>
                          <input type="text" value={editSuppName} onChange={e => setEditSuppName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveSupplier(sup.id)}
                            autoFocus style={{ border: '1px solid #6366f1', borderRadius: 8, padding: '6px 10px', fontSize: 14, fontFamily: 'inherit' }} />
                          <span />
                          <button onClick={() => saveSupplier(sup.id)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✓</button>
                          <button onClick={() => setEditSuppId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Building2 size={15} color="#64748b" />
                            </div>
                            <span style={{ fontWeight: 600, color: '#374141', fontSize: 13 }}>{sup.name}</span>
                          </div>
                          <span style={{ textAlign: 'center', fontWeight: 700, color: monthTotal > 0 ? '#0f172a' : '#cbd5e1', fontSize: 13 }}>
                            {monthTotal > 0 ? '₪' + monthTotal.toLocaleString() : '—'}
                          </span>
                          <button onClick={() => { setEditSuppId(sup.id); setEditSuppName(sup.name) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Pencil size={13} color="#94a3b8" /></button>
                          <button onClick={() => deleteSupplier(sup.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={13} color="#94a3b8" /></button>
                        </>
                      )}
                    </div>
                  )
                })}

                {filteredSupp.length > 0 && (
                  <div style={{ padding: '10px 20px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
                    {filteredSupp.length} ספקים
                  </div>
                )}
              </div>
            </div>
            </motion.div>
          </>
        )}

      </div>
    </div>
  )
}
