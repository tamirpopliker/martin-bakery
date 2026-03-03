import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Pencil, Trash2, Trash } from 'lucide-react'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface Entry {
  id: number
  date: string
  amount: number
  category: 'finished' | 'raw' | 'packaging'
  notes: string | null
}

const CATEGORIES = {
  finished:  { label: 'מוצר מוגמר',   color: '#ef4444', bg: '#fef2f2' },
  raw:       { label: 'חומרי גלם',     color: '#f97316', bg: '#fff7ed' },
  packaging: { label: 'אריזה',         color: '#f59e0b', bg: '#fffbeb' },
}

export default function BranchWaste({ branchId, branchName, branchColor, onBack }: Props) {
  const [entries, setEntries]         = useState<Entry[]>([])
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [catFilter, setCatFilter]     = useState<'finished' | 'raw' | 'packaging' | 'all'>('all')
  const [editId, setEditId]           = useState<number | null>(null)
  const [editData, setEditData]       = useState<Partial<Entry>>({})
  const [loading, setLoading]         = useState(false)
  const [expandedId, setExpandedId]   = useState<number | null>(null)

  // טופס
  const [date, setDate]               = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount]           = useState('')
  const [category, setCategory]       = useState<'finished' | 'raw' | 'packaging'>('finished')
  const [notes, setNotes]             = useState('')

  async function fetchEntries() {
    const { data } = await supabase
      .from('branch_waste').select('*')
      .eq('branch_id', branchId)
      .gte('date', monthFilter + '-01')
      .lte('date', monthFilter + '-31')
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  useEffect(() => { fetchEntries() }, [monthFilter, branchId])

  async function addEntry() {
    if (!amount || !date) return
    setLoading(true)
    await supabase.from('branch_waste').insert({
      branch_id: branchId, date, amount: parseFloat(amount),
      category, notes: notes || null
    })
    setAmount(''); setNotes('')
    await fetchEntries()
    setLoading(false)
  }

  async function deleteEntry(id: number) {
    if (!confirm('למחוק?')) return
    await supabase.from('branch_waste').delete().eq('id', id)
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    await supabase.from('branch_waste').update(editData).eq('id', id)
    setEditId(null)
    await fetchEntries()
  }

  const filtered = catFilter === 'all' ? entries : entries.filter(e => e.category === catFilter)
  const total = filtered.reduce((s, e) => s + Number(e.amount), 0)

  const byCategory = Object.entries(CATEGORIES).map(([k, v]) => ({
    key: k, label: v.label, color: v.color, bg: v.bg,
    total: entries.filter(e => e.category === k).reduce((s, e) => s + Number(e.amount), 0)
  }))

  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={S.page}>
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
        </button>
        <div style={{ width: '40px', height: '40px', background: '#fef2f2', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Trash size={20} color="#ef4444" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>פחת — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>סחורה פגומה · חומרי גלם · אריזה</p>
        </div>
        <div style={{ marginRight: 'auto', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '8px 18px' }}>
          <span style={{ fontSize: '18px', fontWeight: '800', color: '#ef4444' }}>₪{total.toLocaleString()}</span>
          <span style={{ fontSize: '12px', color: '#64748b', marginRight: '6px' }}>סה"כ החודש</span>
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: '900px', margin: '0 auto' }}>

        {/* סיכום לפי קטגוריה */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {byCategory.map(c => (
            <button key={c.key} onClick={() => setCatFilter(catFilter === c.key as any ? 'all' : c.key as any)}
              style={{ background: catFilter === c.key ? c.color : c.bg, border: `1.5px solid ${c.color}33`, borderRadius: '14px', padding: '14px 16px', cursor: 'pointer', textAlign: 'right' as const, transition: 'all 0.15s' }}>
              <div style={{ fontSize: '20px', fontWeight: '800', color: catFilter === c.key ? 'white' : c.color }}>₪{c.total.toLocaleString()}</div>
              <div style={{ fontSize: '12px', color: catFilter === c.key ? 'rgba(255,255,255,0.8)' : '#64748b', marginTop: '3px' }}>{c.label}</div>
            </button>
          ))}
        </div>

        {/* טופס */}
        <div style={{ ...S.card, marginBottom: '20px' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת פחת</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>סכום (₪)</label>
              <input type="number" placeholder="0" value={amount}
                onChange={e => setAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEntry()}
                style={{ ...S.input, textAlign: 'right' as const }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>קטגוריה</label>
              <select value={category} onChange={e => setCategory(e.target.value as any)}
                style={{ ...S.input, background: 'white' }}>
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
              <label style={S.label}>הסבר <span style={{ fontWeight: 400, color: '#94a3b8' }}>(חשוב)</span></label>
              <input type="text" placeholder="מה נפסל ולמה..." value={notes}
                onChange={e => setNotes(e.target.value)} style={S.input} />
            </div>
          </div>
          <button onClick={addEntry} disabled={loading || !amount}
            style={{ background: loading || !amount ? '#e2e8f0' : '#ef4444', color: loading || !amount ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} />הוסף פחת
          </button>
        </div>

        {/* פילטר חודש */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', alignItems: 'center' }}>
          <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
            style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', background: 'white', fontFamily: 'inherit' }} />
          {catFilter !== 'all' && (
            <button onClick={() => setCatFilter('all')}
              style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>
              ✕ נקה סינון
            </button>
          )}
        </div>

        {/* טבלה */}
        <div style={S.card}>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 100px 1fr 130px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
            <span>תאריך</span><span>קטגוריה</span><span>הסבר</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין פחת לחודש זה</div>
          ) : filtered.map((entry, i) => {
            const cat = CATEGORIES[entry.category]
            const isExpanded = expandedId === entry.id
            return (
              <div key={entry.id}>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 100px 1fr 130px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa', cursor: entry.notes ? 'pointer' : 'default' }}
                  onClick={() => entry.notes && setExpandedId(isExpanded ? null : entry.id)}>
                  {editId === entry.id ? (
                    <>
                      <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid #ef4444', borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                      <select value={editData.category || ''} onChange={e => setEditData({ ...editData, category: e.target.value as any })} style={{ border: '1px solid #ef4444', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', fontFamily: 'inherit' }}>
                        {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <input type="text" value={editData.notes || ''} onChange={e => setEditData({ ...editData, notes: e.target.value })} style={{ border: '1px solid #ef4444', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                      <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #ef4444', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                      <button onClick={e => { e.stopPropagation(); saveEdit(entry.id) }} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={e => { e.stopPropagation(); setEditId(null) }} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                      <span style={{ fontSize: '11px', background: cat.bg, color: cat.color, padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>{cat.label}</span>
                      <span style={{ fontSize: '13px', color: '#374151' }}>{entry.notes || '—'}</span>
                      <span style={{ fontWeight: '800', color: '#ef4444', fontSize: '15px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                      <button onClick={e => { e.stopPropagation(); setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={e => { e.stopPropagation(); deleteEntry(entry.id) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {filtered.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', background: '#fef2f2', borderTop: '2px solid #fecaca', borderRadius: '0 0 20px 20px' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>סה"כ — {filtered.length} רשומות</span>
              <span style={{ fontSize: '20px', fontWeight: '800', color: '#ef4444' }}>₪{total.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}