import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchBranchWasteTrend } from '../lib/supabase'
import type { BranchWasteTrend } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import PageHeader from '../components/PageHeader'
import { Plus, Pencil, Trash2, Trash } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

type WasteCategory = 'returned_product' | 'end_of_day' | 'finished' | 'raw' | 'packaging'

interface Entry {
  id: number
  date: string
  amount: number
  category: WasteCategory
  product_id: number | null
  product_name?: string
  notes: string | null
}

interface Product {
  id: number
  name: string
}

const CATEGORIES: Record<string, { label: string; color: string; bg: string }> = {
  returned_product: { label: 'החזר מוצר פגום', color: '#ef4444', bg: '#fef2f2' },
  end_of_day:       { label: 'זריקת מלאי סוף יום', color: '#f97316', bg: '#fff7ed' },
  finished:         { label: 'מוצר מוגמר',   color: '#fb7185', bg: '#fff1f2' },
  raw:              { label: 'חומרי גלם',     color: '#f97316', bg: '#fff7ed' },
  packaging:        { label: 'אריזה',         color: '#fbbf24', bg: '#fffbeb' },
}

// Branch waste uses only these categories
const BRANCH_CATEGORIES: WasteCategory[] = ['returned_product', 'end_of_day']

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function BranchWaste({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [entries, setEntries]         = useState<Entry[]>([])
  const [catFilter, setCatFilter]     = useState<WasteCategory | 'all'>('all')
  const [editId, setEditId]           = useState<number | null>(null)
  const [editData, setEditData]       = useState<Partial<Entry>>({})
  const [loading, setLoading]         = useState(false)
  const [expandedId, setExpandedId]   = useState<number | null>(null)

  // טופס
  const [date, setDate]               = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount]           = useState('')
  const [category, setCategory]       = useState<WasteCategory>('returned_product')
  const [notes, setNotes]             = useState('')
  const [trendData, setTrendData]     = useState<BranchWasteTrend[]>([])

  // Products
  const [products, setProducts]       = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [showProductDropdown, setShowProductDropdown] = useState(false)

  async function fetchEntries() {
    const { data } = await supabase
      .from('branch_waste').select('*, products(name)')
      .eq('branch_id', branchId)
      .gte('date', from)
      .lt('date', to)
      .order('date', { ascending: false })
    if (data) {
      setEntries(data.map((e: any) => ({
        ...e,
        product_name: e.products?.name || null,
      })))
    }
  }

  async function loadProducts() {
    const { data } = await supabase
      .from('products')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
    if (data) setProducts(data)
  }

  useEffect(() => {
    fetchEntries()
    loadProducts()
    fetchBranchWasteTrend(branchId, from.slice(0, 7)).then(setTrendData)
  }, [from, to, branchId])

  async function addEntry() {
    if (!amount || !date) return
    setLoading(true)
    await supabase.from('branch_waste').insert({
      branch_id: branchId, date, amount: parseFloat(amount),
      category, product_id: selectedProduct, notes: notes || null
    })
    setAmount(''); setNotes(''); setSelectedProduct(null); setProductSearch('')
    await fetchEntries()
    setLoading(false)
  }

  async function addProduct(name: string) {
    const { data } = await supabase.from('products').insert({
      name, is_active: true, created_by_branch_id: branchId
    }).select('id, name').single()
    if (data) {
      setProducts(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedProduct(data.id)
      setProductSearch(data.name)
      setShowProductDropdown(false)
    }
  }

  const filteredProducts = products.filter(p =>
    p.name.includes(productSearch) || productSearch === ''
  )

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

  const byCategory = BRANCH_CATEGORIES.map(k => ({
    key: k, label: CATEGORIES[k].label, color: CATEGORIES[k].color, bg: CATEGORIES[k].bg,
    total: entries.filter(e => e.category === k).reduce((s, e) => s + Number(e.amount), 0)
  }))

  // Top wasted product
  const productTotals = new Map<string, number>()
  entries.forEach(e => {
    if (e.product_name) {
      productTotals.set(e.product_name, (productTotals.get(e.product_name) || 0) + Number(e.amount))
    }
  })
  const topProduct = [...productTotals.entries()].sort((a, b) => b[1] - a[1])[0]

  const S = {
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={{ direction: 'rtl', background: '#f8fafc', minHeight: '100vh' }}>
      <PageHeader title="פחת" subtitle={branchName} onBack={onBack} />

      <div style={{ padding: '0 24px', maxWidth: '900px', margin: '0 auto' }}>

        {/* Category summary pills */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '20px' }}>
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

        {/* Top product insight */}
        {topProduct && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#92400e' }}>
            הפחת הגבוה ביותר: <strong>{topProduct[0]}</strong> — ₪{Math.round(topProduct[1]).toLocaleString()}
          </div>
        )}

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
              <select value={category} onChange={e => setCategory(e.target.value as WasteCategory)}
                style={{ ...S.input, background: 'white' }}>
                {BRANCH_CATEGORIES.map(k => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
              </select>
            </div>
            {/* Product selector */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, position: 'relative' as const }}>
              <label style={S.label}>מוצר</label>
              <input type="text" placeholder="חפש מוצר..."
                value={productSearch}
                onChange={e => { setProductSearch(e.target.value); setShowProductDropdown(true); setSelectedProduct(null) }}
                onFocus={() => setShowProductDropdown(true)}
                style={S.input} />
              {showProductDropdown && productSearch && (
                <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 200, overflow: 'auto', zIndex: 20 }}>
                  {filteredProducts.slice(0, 10).map(p => (
                    <div key={p.id}
                      onClick={() => { setSelectedProduct(p.id); setProductSearch(p.name); setShowProductDropdown(false) }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f8fafc' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                      {p.name}
                    </div>
                  ))}
                  {filteredProducts.length === 0 && productSearch.trim() && (
                    <div onClick={() => addProduct(productSearch.trim())}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#6366f1', fontWeight: 600 }}>
                      + הוסף "{productSearch.trim()}" כמוצר חדש
                    </div>
                  )}
                </div>
              )}
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
          <div style={{ display: 'grid', gridTemplateColumns: '90px 120px 100px 1fr 100px 36px 36px', padding: '10px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
            <span>תאריך</span><span>קטגוריה</span><span>מוצר</span><span>הסבר</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין פחת לחודש זה</div>
          ) : filtered.map((entry) => {
            const cat = CATEGORIES[entry.category]
            const isExpanded = expandedId === entry.id
            return (
              <div key={entry.id}>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 120px 100px 1fr 100px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f8fafc', cursor: entry.notes ? 'pointer' : 'default' }}
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
                      <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>{cat?.label || entry.category}</span>
                      <span style={{ fontSize: '12px', color: '#6366f1', fontWeight: 500 }}>{entry.product_name || '—'}</span>
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
