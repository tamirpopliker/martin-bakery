import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Package, CheckCircle, Pencil, Check, X, AlertTriangle } from 'lucide-react'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'disputed'

interface Order {
  id: number
  date: string
  customer: string
  amount: number
  doc_number: string | null
  notes: string | null
  branch_status: string
  source_table: 'factory_sales' | 'factory_b2b_sales'
  source_type: string // department or sale_type
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: 'ממתין',  color: '#4f46e5', bg: '#e0e7ff' },
  approved: { label: 'אושר',   color: '#16a34a', bg: '#dcfce7' },
  disputed: { label: 'נערך',   color: '#d97706', bg: '#fef3c7' },
}

const SOURCE_LABELS: Record<string, string> = {
  creams: 'קרמים',
  dough: 'בצקים',
  b2b: 'B2B',
  misc: 'שונות',
}

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function BranchOrders({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to } = usePeriod()

  const [orders, setOrders]             = useState<Order[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [editId, setEditId]             = useState<string | null>(null) // "table_id"
  const [editAmount, setEditAmount]     = useState('')
  const [loading, setLoading]           = useState(false)
  const [bulkLoading, setBulkLoading]   = useState(false)

  // ─── שליפת הזמנות ──────────────────────────────────────────────────────────
  async function fetchOrders() {
    setLoading(true)
    const [fsRes, b2bRes] = await Promise.all([
      supabase.from('factory_sales')
        .select('id, date, customer, amount, doc_number, notes, branch_status, department')
        .eq('target_branch_id', branchId)
        .gte('date', from).lt('date', to)
        .order('date', { ascending: false }),
      supabase.from('factory_b2b_sales')
        .select('id, date, customer, amount, doc_number, notes, branch_status, sale_type')
        .eq('target_branch_id', branchId)
        .gte('date', from).lt('date', to)
        .order('date', { ascending: false }),
    ])

    const all: Order[] = [
      ...(fsRes.data || []).map((r: any) => ({
        ...r, source_table: 'factory_sales' as const, source_type: r.department,
      })),
      ...(b2bRes.data || []).map((r: any) => ({
        ...r, source_table: 'factory_b2b_sales' as const, source_type: r.sale_type,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    setOrders(all)
    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()
    setEditId(null)
  }, [from, to])

  // ─── פעולות ─────────────────────────────────────────────────────────────────
  async function approveOrder(order: Order) {
    await supabase.from(order.source_table)
      .update({ branch_status: 'approved' })
      .eq('id', order.id)
    await fetchOrders()
  }

  async function saveEditedAmount(order: Order) {
    const newAmount = parseFloat(editAmount)
    if (isNaN(newAmount) || newAmount <= 0) return
    await supabase.from(order.source_table)
      .update({ amount: newAmount, branch_status: 'disputed' })
      .eq('id', order.id)
    setEditId(null)
    setEditAmount('')
    await fetchOrders()
  }

  async function bulkApprove() {
    if (!confirm('לאשר את כל ההזמנות הממתינות?')) return
    setBulkLoading(true)
    const pending = orders.filter(o => o.branch_status === 'pending')

    // Group by table for efficiency
    const fsPending = pending.filter(o => o.source_table === 'factory_sales').map(o => o.id)
    const b2bPending = pending.filter(o => o.source_table === 'factory_b2b_sales').map(o => o.id)

    const updates = []
    if (fsPending.length > 0) {
      updates.push(
        supabase.from('factory_sales').update({ branch_status: 'approved' }).in('id', fsPending)
      )
    }
    if (b2bPending.length > 0) {
      updates.push(
        supabase.from('factory_b2b_sales').update({ branch_status: 'approved' }).in('id', b2bPending)
      )
    }
    await Promise.all(updates)
    setBulkLoading(false)
    await fetchOrders()
  }

  // ─── חישובים ──────────────────────────────────────────────────────────────
  const filtered = statusFilter === 'all'
    ? orders
    : orders.filter(o => o.branch_status === statusFilter)

  const total = filtered.reduce((s, o) => s + Number(o.amount), 0)
  const pendingCount = orders.filter(o => o.branch_status === 'pending').length
  const pendingTotal = orders.filter(o => o.branch_status === 'pending').reduce((s, o) => s + Number(o.amount), 0)

  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all',      label: 'הכל',     count: orders.length },
    { key: 'pending',  label: 'ממתינים', count: orders.filter(o => o.branch_status === 'pending').length },
    { key: 'approved', label: 'מאושרים', count: orders.filter(o => o.branch_status === 'approved').length },
    { key: 'disputed', label: 'נערכו',   count: orders.filter(o => o.branch_status === 'disputed').length },
  ]

  // ─── סגנונות ──────────────────────────────────────────────────────────────
  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  }

  return (
    <div style={S.page}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '44px', height: '44px', background: branchColor, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${branchColor}55` }}>
          <Package size={22} color="white" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>הזמנות מהמפעל — סניף {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>אישור · עריכה · חומרי גלם</p>
        </div>
      </div>

      <div style={{ padding: '28px 32px', maxWidth: '960px', margin: '0 auto' }}>

        {/* ─── סיכום + אישור כולל ─────────────────────────────────────────── */}
        {pendingCount > 0 && (
          <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '16px', padding: '18px 24px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <AlertTriangle size={22} color="#d97706" />
              <div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#92400e' }}>
                  {pendingCount} הזמנות ממתינות לאישור
                </div>
                <div style={{ fontSize: '13px', color: '#b45309' }}>
                  סה"כ ₪{pendingTotal.toLocaleString()}
                </div>
              </div>
            </div>
            <button onClick={bulkApprove} disabled={bulkLoading}
              style={{ background: '#16a34a', color: 'white', border: 'none', borderRadius: '12px', padding: '10px 24px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: bulkLoading ? 0.6 : 1 }}>
              <CheckCircle size={18} />
              אשר הכל
            </button>
          </div>
        )}

        {/* ─── טאבי סטטוס + PeriodPicker ──────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ display: 'flex', gap: '6px', flex: 1, justifyContent: 'flex-end' }}>
            {statusTabs.map(st => (
              <button key={st.key} onClick={() => setStatusFilter(st.key)}
                style={{
                  background: statusFilter === st.key ? branchColor : '#f1f5f9',
                  color: statusFilter === st.key ? 'white' : '#64748b',
                  border: 'none', borderRadius: '10px', padding: '8px 16px',
                  fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                {st.label}
                <span style={{
                  background: statusFilter === st.key ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                  padding: '1px 7px', borderRadius: '8px', fontSize: '11px', fontWeight: '700',
                }}>{st.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── טבלת הזמנות ────────────────────────────────────────────────── */}
        <div style={S.card}>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 80px 1fr 120px 100px 100px 80px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
            <span>תאריך</span>
            <span>מקור</span>
            <span>לקוח</span>
            <span>תעודה</span>
            <span style={{ textAlign: 'left' }}>סכום</span>
            <span>סטטוס</span>
            <span>פעולות</span>
          </div>

          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>טוען...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
              {statusFilter === 'all' ? 'אין הזמנות מהמפעל בתקופה זו' : `אין הזמנות בסטטוס "${statusTabs.find(s => s.key === statusFilter)?.label}"`}
            </div>
          ) : filtered.map((order, i) => {
            const editKey = `${order.source_table}_${order.id}`
            const isEditing = editId === editKey
            const status = STATUS_LABELS[order.branch_status] || STATUS_LABELS.pending

            return (
              <div key={editKey} style={{
                display: 'grid', gridTemplateColumns: '100px 80px 1fr 120px 100px 100px 80px',
                alignItems: 'center', padding: '13px 20px',
                borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none',
                background: i % 2 === 0 ? 'white' : '#fafafa',
              }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>
                  {new Date(order.date + 'T12:00:00').toLocaleDateString('he-IL')}
                </span>
                <span style={{
                  fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '6px',
                  background: '#f1f5f9', color: '#475569', textAlign: 'center',
                }}>
                  {SOURCE_LABELS[order.source_type] || order.source_type}
                </span>
                <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>
                  {order.customer}
                  {order.notes && <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '6px' }}>({order.notes})</span>}
                </span>
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>{order.doc_number || '—'}</span>

                {/* סכום — עריכה */}
                {isEditing ? (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input type="number" value={editAmount}
                      onChange={e => setEditAmount(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveEditedAmount(order)}
                      style={{ width: '80px', border: `1.5px solid ${branchColor}`, borderRadius: '6px', padding: '4px 8px', fontSize: '13px', textAlign: 'right' as const }}
                      autoFocus />
                  </div>
                ) : (
                  <span style={{ fontWeight: '800', color: branchColor, fontSize: '15px' }}>
                    ₪{Number(order.amount).toLocaleString()}
                  </span>
                )}

                {/* סטטוס */}
                <span style={{
                  fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '8px',
                  background: status.bg, color: status.color, textAlign: 'center',
                }}>
                  {status.label}
                </span>

                {/* פעולות */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {isEditing ? (
                    <>
                      <button onClick={() => saveEditedAmount(order)}
                        style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                        <Check size={14} />
                      </button>
                      <button onClick={() => { setEditId(null); setEditAmount('') }}
                        style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      {order.branch_status === 'pending' && (
                        <button onClick={() => approveOrder(order)}
                          title="אשר"
                          style={{ background: '#dcfce7', border: 'none', borderRadius: '6px', padding: '5px', cursor: 'pointer' }}>
                          <CheckCircle size={16} color="#16a34a" />
                        </button>
                      )}
                      <button onClick={() => { setEditId(editKey); setEditAmount(String(order.amount)) }}
                        title="ערוך סכום"
                        style={{ background: '#f1f5f9', border: 'none', borderRadius: '6px', padding: '5px', cursor: 'pointer' }}>
                        <Pencil size={14} color="#64748b" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {filtered.length > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 20px', background: `${branchColor}12`,
              borderTop: `2px solid ${branchColor}33`, borderRadius: '0 0 20px 20px',
            }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>
                סה"כ — {filtered.length} הזמנות
              </span>
              <span style={{ fontSize: '20px', fontWeight: '800', color: branchColor }}>
                ₪{total.toLocaleString()}
              </span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
