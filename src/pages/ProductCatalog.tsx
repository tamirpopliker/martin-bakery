import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, TrendingUp, TrendingDown, Check, X, ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/PageHeader'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { onBack: () => void }

interface Product {
  id: number
  product_name: string
  department: string | null
  current_price: number
  last_price: number | null
  price_updated_at: string | null
  created_at: string
}

interface PriceHistoryEntry {
  date: string
  price: number
  order_number: string | null
  branch_name: string | null
  quantity: number
}

const DEPT_OPTIONS = ['בצקים', 'קרמים', 'אריזה', 'ניקיון', 'שונות']

const S = {
  container: { padding: '24px 32px', maxWidth: 1060, margin: '0 auto' } as React.CSSProperties,
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '10px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' },
}

const fmtPrice = (n: number) => '₪' + Number(n).toFixed(2)
const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`
}

export default function ProductCatalog({ onBack }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [filterDept, setFilterDept] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editDept, setEditDept] = useState('')
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null)
  const [historyEntries, setHistoryEntries] = useState<PriceHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadProducts = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('products').select('*').order('product_name')
    if (filterDept !== 'all') q = q.eq('department', filterDept)
    const { data } = await q
    setProducts(data || [])
    setLoading(false)
  }, [filterDept])

  useEffect(() => { loadProducts() }, [loadProducts])

  const filtered = search
    ? products.filter(p => p.product_name.includes(search))
    : products

  function startEdit(p: Product) {
    setEditId(p.id)
    setEditPrice(String(p.current_price))
    setEditDept(p.department || 'אחר')
  }

  async function saveEdit(p: Product) {
    const newPrice = parseFloat(editPrice)
    if (isNaN(newPrice) || newPrice < 0) return
    const updates: any = { department: editDept }
    if (newPrice !== p.current_price) {
      updates.last_price = p.current_price
      updates.current_price = newPrice
      updates.price_updated_at = new Date().toISOString()
    }
    await supabase.from('products').update(updates).eq('id', p.id)
    // Sync department mapping
    await supabase.from('product_department_mapping')
      .upsert({ product_name: p.product_name, department: editDept }, { onConflict: 'product_name' })
    setEditId(null)
    loadProducts()
  }

  async function updateDeptInline(p: Product, dept: string) {
    await supabase.from('products').update({ department: dept }).eq('id', p.id)
    await supabase.from('product_department_mapping')
      .upsert({ product_name: p.product_name, department: dept }, { onConflict: 'product_name' })
    setProducts(prev => prev.map(pr => pr.id === p.id ? { ...pr, department: dept } : pr))
  }

  async function openHistory(p: Product) {
    setHistoryProduct(p)
    setHistoryLoading(true)
    // Fetch all internal_sale_items for this product with sale info
    const { data: items } = await supabase.from('internal_sale_items')
      .select('unit_price, quantity_supplied, quantity_confirmed, sale_id')
      .eq('product_name', p.product_name)
      .order('created_at', { ascending: false })

    if (items && items.length > 0) {
      const saleIds = [...new Set(items.map(i => i.sale_id))]
      const { data: sales } = await supabase.from('internal_sales')
        .select('id, order_date, order_number, branch_id')
        .in('id', saleIds)
      const { data: branchesData } = await supabase.from('branches').select('id, name')

      const saleMap = new Map((sales || []).map(s => [s.id, s]))
      const branchMap = new Map((branchesData || []).map(b => [b.id, b.name]))

      const entries: PriceHistoryEntry[] = items.map(item => {
        const sale = saleMap.get(item.sale_id)
        return {
          date: sale?.order_date || '',
          price: Number(item.unit_price),
          order_number: sale?.order_number || null,
          branch_name: sale ? (branchMap.get(sale.branch_id) || null) : null,
          quantity: Number(item.quantity_confirmed ?? item.quantity_supplied),
        }
      }).filter(e => e.date)

      setHistoryEntries(entries)
    } else {
      setHistoryEntries([])
    }
    setHistoryLoading(false)
  }

  function getPriceChange(p: Product): { pct: number; direction: 'up' | 'down' | 'none' } {
    if (!p.last_price || p.last_price === 0 || p.last_price === p.current_price) return { pct: 0, direction: 'none' }
    const pct = ((p.current_price - p.last_price) / p.last_price) * 100
    return { pct: Math.abs(pct), direction: pct > 0 ? 'up' : 'down' }
  }

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="קטלוג מוצרים" subtitle={`${products.length} מוצרים`} onBack={onBack} />
      <div style={S.container}>

        {/* History modal */}
        {historyProduct && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  היסטוריית מחירים — {historyProduct.product_name}
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  מחיר נוכחי: {fmtPrice(historyProduct.current_price)}
                  {historyProduct.department && ` · ${historyProduct.department}`}
                </p>
              </div>
              <button onClick={() => { setHistoryProduct(null); setHistoryEntries([]) }}
                style={{ ...S.btn, background: '#f1f5f9', color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ChevronLeft size={14} /> חזרה
              </button>
            </div>
            {historyLoading ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>טוען...</div>
            ) : historyEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>אין היסטוריית מחירים</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={S.th}>תאריך</th>
                  <th style={S.th}>תעודה</th>
                  <th style={S.th}>סניף</th>
                  <th style={S.th}>כמות</th>
                  <th style={S.th}>מחיר</th>
                </tr></thead>
                <tbody>
                  {historyEntries.map((e, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                      <td style={S.td}>{fmtDate(e.date)}</td>
                      <td style={S.td}>{e.order_number || '—'}</td>
                      <td style={S.td}>{e.branch_name || '—'}</td>
                      <td style={S.td}>{e.quantity}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmtPrice(e.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Main catalog */}
        {!historyProduct && (
          <div style={S.card}>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>מחלקה</label>
                <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, background: 'white' }}>
                  <option value="all">כל המחלקות</option>
                  {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>חיפוש</label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', right: 10, top: 9 }} />
                  <input type="text" placeholder="חפש מוצר..." value={search} onChange={e => setSearch(e.target.value)}
                    style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 32px 6px 12px', fontSize: 13, width: '100%' }} />
                </div>
              </div>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>
                {search ? 'לא נמצאו מוצרים' : 'אין מוצרים בקטלוג'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={S.th}>מוצר</th>
                  <th style={{ ...S.th, width: 110 }}>מחלקה</th>
                  <th style={{ ...S.th, width: 100 }}>מחיר נוכחי</th>
                  <th style={{ ...S.th, width: 90 }}>מחיר קודם</th>
                  <th style={{ ...S.th, width: 80 }}>שינוי</th>
                  <th style={{ ...S.th, width: 100 }}>עודכן</th>
                  <th style={{ ...S.th, width: 70 }}></th>
                </tr></thead>
                <tbody>
                  {filtered.map((p, i) => {
                    const change = getPriceChange(p)
                    const isEditing = editId === p.id
                    return (
                      <tr key={p.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc', cursor: 'pointer' }}
                        onClick={() => { if (!isEditing) openHistory(p) }}>
                        <td style={{ ...S.td, fontWeight: 500 }}>{p.product_name}</td>
                        <td style={S.td} onClick={e => e.stopPropagation()}>
                          {isEditing ? (
                            <select value={editDept} onChange={e => setEditDept(e.target.value)}
                              style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%', background: 'white' }}>
                              {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          ) : (
                            <select value={p.department || 'אחר'} onChange={e => updateDeptInline(p, e.target.value)}
                              style={{ border: '1px solid transparent', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%', background: 'transparent', cursor: 'pointer' }}>
                              {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          )}
                        </td>
                        <td style={S.td} onClick={e => e.stopPropagation()}>
                          {isEditing ? (
                            <input type="number" step="0.01" value={editPrice} onChange={e => setEditPrice(e.target.value)}
                              style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontSize: 13, width: '100%', textAlign: 'left' }}
                              onClick={e => e.stopPropagation()} />
                          ) : (
                            <span style={{ fontWeight: 600 }}>{fmtPrice(p.current_price)}</span>
                          )}
                        </td>
                        <td style={{ ...S.td, color: '#94a3b8' }}>
                          {p.last_price !== null ? fmtPrice(p.last_price) : '—'}
                        </td>
                        <td style={S.td}>
                          {change.direction !== 'none' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600,
                              color: change.direction === 'up' ? '#dc2626' : '#16a34a' }}>
                              {change.direction === 'up' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                              {change.pct.toFixed(1)}%
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: '#cbd5e1' }}>—</span>
                          )}
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{fmtDate(p.price_updated_at)}</td>
                        <td style={S.td} onClick={e => e.stopPropagation()}>
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: 3 }}>
                              <button onClick={() => saveEdit(p)}
                                style={{ ...S.btn, padding: '3px 8px', fontSize: 11, background: '#0f172a', color: 'white' }}>
                                <Check size={13} />
                              </button>
                              <button onClick={() => setEditId(null)}
                                style={{ ...S.btn, padding: '3px 8px', fontSize: 11, background: '#f1f5f9', color: '#64748b' }}>
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); startEdit(p) }}
                              style={{ ...S.btn, padding: '3px 8px', fontSize: 11, background: '#f1f5f9', color: '#6366f1' }}
                              title="עריכה">
                              ✏️
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {filtered.length > 0 && (
              <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 12, color: '#94a3b8' }}>
                {filtered.length} מוצרים {search && `(מתוך ${products.length})`}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}
