import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Package, CheckCircle, Pencil, Check, X, AlertTriangle, CheckSquare, Square } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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
  pending:  { label: 'ממתין',  color: '#a16207', bg: '#fefce8' },
  approved: { label: 'אושר',   color: '#166534', bg: '#f0fdf4' },
  disputed: { label: 'נערך',   color: '#991b1b', bg: '#fef2f2' },
}

const SOURCE_LABELS: Record<string, string> = {
  creams: 'קרמים',
  dough: 'בצקים',
  b2b: 'B2B',
  misc: 'שונות',
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function BranchOrders({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to } = usePeriod()

  const [orders, setOrders]             = useState<Order[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [editId, setEditId]             = useState<string | null>(null) // "table_id"
  const [editAmount, setEditAmount]     = useState('')
  const [loading, setLoading]           = useState(false)
  const [bulkLoading, setBulkLoading]   = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())

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
        ...r, branch_status: r.branch_status || 'pending', source_table: 'factory_sales' as const, source_type: r.department,
      })),
      ...(b2bRes.data || []).map((r: any) => ({
        ...r, branch_status: r.branch_status || 'pending', source_table: 'factory_b2b_sales' as const, source_type: r.sale_type,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    setOrders(all)
    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()
    setEditId(null)
  }, [from, to])

  // ─── יצירת הוצאה בסניף ──────────────────────────────────────────────────────
  async function createBranchExpense(order: Order) {
    const docNum = order.doc_number || `factory_${order.source_table}_${order.id}`
    // Upsert by doc_number + branch_id to avoid duplicates
    const { data: existing } = await supabase.from('branch_expenses')
      .select('id')
      .eq('branch_id', branchId)
      .eq('doc_number', docNum)
      .eq('from_factory', true)
      .maybeSingle()
    if (existing) return // already exists

    await supabase.from('branch_expenses').insert({
      branch_id: branchId,
      date: order.date,
      expense_type: 'suppliers',
      supplier: 'מפעל ייצור',
      amount: order.amount,
      doc_number: docNum,
      from_factory: true,
      notes: 'הזמנה פנימית מהמפעל — אושרה אוטומטית',
    })
  }

  // ─── פעולות ─────────────────────────────────────────────────────────────────
  async function approveOrder(order: Order) {
    await supabase.from(order.source_table)
      .update({ branch_status: 'approved' })
      .eq('id', order.id)
    await createBranchExpense(order)
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

  function toggleSelect(order: Order) {
    const key = `${order.source_table}_${order.id}`
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function toggleSelectAll() {
    const pendingFiltered = filtered.filter(o => o.branch_status === 'pending')
    const allKeys = pendingFiltered.map(o => `${o.source_table}_${o.id}`)
    const allSelected = allKeys.length > 0 && allKeys.every(k => selectedIds.has(k))
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allKeys))
    }
  }

  async function bulkApprove() {
    if (!confirm('לאשר את כל ההזמנות הממתינות?')) return
    setBulkLoading(true)
    const pending = orders.filter(o => o.branch_status === 'pending')
    await approveOrders(pending)
    setBulkLoading(false)
  }

  async function approveSelected() {
    if (selectedIds.size === 0) return
    if (!confirm(`לאשר ${selectedIds.size} הזמנות נבחרות?`)) return
    setBulkLoading(true)
    const selected = orders.filter(o => selectedIds.has(`${o.source_table}_${o.id}`))
    await approveOrders(selected)
    setSelectedIds(new Set())
    setBulkLoading(false)
  }

  async function approveOrders(list: Order[]) {
    const fsPending = list.filter(o => o.source_table === 'factory_sales').map(o => o.id)
    const b2bPending = list.filter(o => o.source_table === 'factory_b2b_sales').map(o => o.id)

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
    // Create branch expenses for all approved orders
    await Promise.all(list.map(o => createBranchExpense(o)))
    await fetchOrders()
  }

  // ─── חישובים ──────────────────────────────────────────────────────────────
  const filtered = statusFilter === 'all'
    ? orders
    : orders.filter(o => o.branch_status === statusFilter)

  const total = filtered.reduce((s, o) => s + Number(o.amount), 0)
  const pendingCount = orders.filter(o => o.branch_status === 'pending').length
  const pendingTotal = orders.filter(o => o.branch_status === 'pending').reduce((s, o) => s + Number(o.amount), 0)

  const pendingFiltered = filtered.filter(o => o.branch_status === 'pending')
  const allPendingSelected = pendingFiltered.length > 0 && pendingFiltered.every(o => selectedIds.has(`${o.source_table}_${o.id}`))
  const selectedCount = selectedIds.size

  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all',      label: 'הכל',     count: orders.length },
    { key: 'pending',  label: 'ממתינים', count: orders.filter(o => o.branch_status === 'pending').length },
    { key: 'approved', label: 'מאושרים', count: orders.filter(o => o.branch_status === 'approved').length },
    { key: 'disputed', label: 'נערכו',   count: orders.filter(o => o.branch_status === 'disputed').length },
  ]

  return (
    <div style={{ direction: 'rtl', background: '#f8fafc', minHeight: '100vh' }}>

      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>הזמנות מהמפעל</h1>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{branchName}</p>
          </div>
          <button onClick={onBack} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px', fontSize: 13, color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>← חזרה</button>
        </div>
      </div>

      <div style={{ padding: '0 24px', maxWidth: '960px', margin: '0 auto' }}>

        {/* ─── Pending alert ─────────────────────────────────────────── */}
        {pendingCount > 0 && (
          <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '16px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle size={18} color="#a16207" />
              <div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                  {pendingCount} הזמנות ממתינות לאישור
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                  סה"כ ₪{pendingTotal.toLocaleString()}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={toggleSelectAll}
                style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'inherit' }}>
                {allPendingSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                {allPendingSelected ? 'בטל סימון' : 'סמן הכל'}
              </button>
              {selectedCount > 0 && (
                <button onClick={approveSelected} disabled={bulkLoading}
                  style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: bulkLoading ? 0.6 : 1, fontFamily: 'inherit' }}>
                  <CheckCircle size={14} />
                  אשר נבחרים ({selectedCount})
                </button>
              )}
              <button onClick={bulkApprove} disabled={bulkLoading}
                style={{ background: selectedCount > 0 ? 'white' : '#6366f1', color: selectedCount > 0 ? '#64748b' : 'white', border: selectedCount > 0 ? '1px solid #e2e8f0' : 'none', borderRadius: '8px', padding: '6px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: bulkLoading ? 0.6 : 1, fontFamily: 'inherit' }}>
                <CheckCircle size={14} />
                אשר הכל
              </button>
            </div>
          </div>
        )}

        {/* ─── Status tabs + PeriodPicker ──────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ display: 'flex', gap: '2px', flex: 1, justifyContent: 'flex-end', borderBottom: '1px solid #f1f5f9' }}>
            {statusTabs.map(st => (
              <button key={st.key} onClick={() => setStatusFilter(st.key)}
                style={{
                  background: 'none',
                  color: statusFilter === st.key ? '#0f172a' : '#94a3b8',
                  border: 'none',
                  borderBottom: statusFilter === st.key ? '2px solid #6366f1' : '2px solid transparent',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: statusFilter === st.key ? '700' : '500',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  fontFamily: 'inherit',
                }}>
                {st.label}
                <span style={{
                  background: '#f1f5f9',
                  color: '#64748b',
                  padding: '1px 7px', borderRadius: '8px', fontSize: '11px', fontWeight: '600',
                }}>{st.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── Orders table ────────────────────────────────────────────────── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div className="table-scroll">
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '36px 90px 70px 1fr 100px 90px 80px 100px', padding: '10px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#94a3b8', alignItems: 'center' }}>
            <span />
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
                display: 'grid', gridTemplateColumns: '36px 90px 70px 1fr 100px 90px 80px 100px',
                alignItems: 'center', padding: '12px 20px',
                borderBottom: '1px solid #f8fafc',
                background: selectedIds.has(editKey) ? '#fafafa' : 'white',
              }}>
                {/* checkbox */}
                {order.branch_status === 'pending' ? (
                  <button onClick={() => toggleSelect(order)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}>
                    {selectedIds.has(editKey) ? <CheckSquare size={16} color="#6366f1" /> : <Square size={16} color="#94a3b8" />}
                  </button>
                ) : <span />}
                <span style={{ fontSize: '13px', color: '#64748b' }}>
                  {new Date(order.date + 'T12:00:00').toLocaleDateString('he-IL')}
                </span>
                <span style={{
                  fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '6px',
                  background: '#f1f5f9', color: '#64748b', textAlign: 'center',
                }}>
                  {SOURCE_LABELS[order.source_type] || order.source_type}
                </span>
                <span style={{ fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  {order.customer}
                  {order.notes && <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '6px' }}>({order.notes})</span>}
                </span>
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>{order.doc_number || '—'}</span>

                {/* amount - edit */}
                {isEditing ? (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input type="number" value={editAmount}
                      onChange={e => setEditAmount(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveEditedAmount(order)}
                      style={{ width: '80px', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', textAlign: 'right' as const }}
                      autoFocus />
                  </div>
                ) : (
                  <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>
                    ₪{Number(order.amount).toLocaleString()}
                  </span>
                )}

                {/* status pill */}
                <span style={{
                  fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '6px',
                  background: status.bg, color: status.color, textAlign: 'center',
                }}>
                  {status.label}
                </span>

                {/* actions */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {isEditing ? (
                    <>
                      <button onClick={() => saveEditedAmount(order)}
                        style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                        <Check size={14} />
                      </button>
                      <button onClick={() => { setEditId(null); setEditAmount('') }}
                        style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      {order.branch_status === 'pending' && (
                        <button onClick={() => approveOrder(order)}
                          title="אשר"
                          style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: '600' }}>
                          <CheckCircle size={13} /> אשר
                        </button>
                      )}
                      <button onClick={() => { setEditId(editKey); setEditAmount(String(order.amount)) }}
                        title="ערוך סכום"
                        style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px', cursor: 'pointer' }}>
                        <Pencil size={13} color="#94a3b8" />
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
              padding: '14px 20px', background: '#fafafa',
              borderTop: '1px solid #f1f5f9',
            }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                סה"כ — {filtered.length} הזמנות
              </span>
              <span style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>
                ₪{total.toLocaleString()}
              </span>
            </div>
          )}
          </div>
        </div>
        </motion.div>

      </div>
    </div>
  )
}
