import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchBranchWasteTrend, BranchWasteTrend } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Plus, Pencil, Trash2, Trash } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

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
  finished:  { label: 'מוצר מוגמר',   color: '#fb7185', bg: '#fff1f2' },
  raw:       { label: 'חומרי גלם',     color: '#f97316', bg: '#fff7ed' },
  packaging: { label: 'אריזה',         color: '#fbbf24', bg: '#fffbeb' },
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function BranchWaste({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [entries, setEntries]         = useState<Entry[]>([])
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
  const [trendData, setTrendData]     = useState<BranchWasteTrend[]>([])

  async function fetchEntries() {
    const { data } = await supabase
      .from('branch_waste').select('*')
      .eq('branch_id', branchId)
      .gte('date', from)
      .lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  useEffect(() => {
    fetchEntries()
    fetchBranchWasteTrend(branchId, from.slice(0, 7)).then(setTrendData)
  }, [from, to, branchId])

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
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={{ direction: 'rtl', background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>פחת</h1>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{branchName}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <PeriodPicker period={period} onChange={setPeriod} />
            <span style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>₪{total.toLocaleString()}</span>
            <button onClick={onBack} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px', fontSize: 13, color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>← חזרה</button>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 24px', maxWidth: '900px', margin: '0 auto' }}>

        {/* Category summary pills */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {byCategory.map(c => (
            <button key={c.key} onClick={() => setCatFilter(catFilter === c.key as any ? 'all' : c.key as any)}
              style={{
                background: catFilter === c.key ? '#f1f5f9' : 'white',
                border: catFilter === c.key ? '1px solid #cbd5e1' : '1px solid #f1f5f9',
                borderRadius: '12px',
                padding: '14px 16px',
                cursor: 'pointer',
                textAlign: 'right' as const,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'all 0.15s',
                fontFamily: 'inherit',
              }}>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>₪{c.total.toLocaleString()}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>{c.label}</div>
            </button>
          ))}
        </div>

        {/* Add form */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '20px', marginBottom: '20px' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>הוספת פחת</h2>
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
            style={{ background: loading || !amount ? '#e2e8f0' : '#6366f1', color: loading || !amount ? '#94a3b8' : 'white', border: 'none', borderRadius: '8px', padding: '10px 28px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'inherit' }}>
            <Plus size={16} />הוסף פחת
          </button>
        </div>

        {/* Filter clear */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', alignItems: 'center' }}>
          {catFilter !== 'all' && (
            <button onClick={() => setCatFilter('all')}
              style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 14px', fontSize: '13px', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>
              ✕ נקה סינון
            </button>
          )}
        </div>

        {/* Table */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div className="table-scroll">
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 100px 1fr 130px 36px 36px', padding: '10px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
            <span>תאריך</span><span>קטגוריה</span><span>הסבר</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין פחת לחודש זה</div>
          ) : filtered.map((entry) => {
            const cat = CATEGORIES[entry.category]
            const isExpanded = expandedId === entry.id
            return (
              <div key={entry.id}>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 100px 1fr 130px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f8fafc', cursor: entry.notes ? 'pointer' : 'default' }}
                  onClick={() => entry.notes && setExpandedId(isExpanded ? null : entry.id)}>
                  {editId === entry.id ? (
                    <>
                      <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                      <select value={editData.category || ''} onChange={e => setEditData({ ...editData, category: e.target.value as any })} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', fontFamily: 'inherit' }}>
                        {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <input type="text" value={editData.notes || ''} onChange={e => setEditData({ ...editData, notes: e.target.value })} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                      <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                      <button onClick={e => { e.stopPropagation(); saveEdit(entry.id) }} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={e => { e.stopPropagation(); setEditId(null) }} style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                      <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>{cat.label}</span>
                      <span style={{ fontSize: '13px', color: '#374151' }}>{entry.notes || '—'}</span>
                      <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                      <button onClick={e => { e.stopPropagation(); setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={e => { e.stopPropagation(); deleteEntry(entry.id) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#94a3b8" /></button>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {filtered.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', background: '#fafafa', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>סה"כ — {filtered.length} רשומות</span>
              <span style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>₪{total.toLocaleString()}</span>
            </div>
          )}
          </div>
        </div>
        </motion.div>

        {/* 6-month trend */}
        {trendData.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '20px', marginTop: '16px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>מגמת 6 חודשים — פחת</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis yAxisId="amount" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => '₪' + (v / 1000).toFixed(0) + 'K'} />
                <YAxis yAxisId="pct" orientation="left" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v + '%'} />
                <Tooltip formatter={(value: number, name: string) => name === '% מהכנסות' ? value + '%' : '₪' + Math.round(value).toLocaleString()} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line yAxisId="amount" type="monotone" dataKey="finished" name="מוצר מוגמר" stroke="#fb7185" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="amount" type="monotone" dataKey="raw" name="חומרי גלם" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="amount" type="monotone" dataKey="packaging" name="אריזה" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="amount" type="monotone" dataKey="total" name="סה״כ" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line yAxisId="pct" type="monotone" dataKey="pctOfRevenue" name="% מהכנסות" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 4 }} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
