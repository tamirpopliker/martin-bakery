import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useBranches } from '../lib/BranchContext'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'
import { Printer, Cake, Clock, CheckCircle2, CalendarRange, ArrowRight, X, Save } from 'lucide-react'
import type { SpecialOrder } from './BranchSpecialOrders'
import { displayOrderNumber } from './BranchSpecialOrders'

interface Props {
  onBack: () => void
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new:           { label: 'חדשה',       color: '#1e40af', bg: '#dbeafe', border: '#93c5fd' },
  confirmed:     { label: 'אושרה',      color: '#5b21b6', bg: '#ede9fe', border: '#c4b5fd' },
  in_production: { label: 'בייצור',     color: '#92400e', bg: '#fef3c7', border: '#fcd34d' },
  ready:         { label: 'מוכנה',      color: '#166534', bg: '#dcfce7', border: '#86efac' },
  delivered:     { label: 'נמסרה',      color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
  cancelled:     { label: 'בוטלה',      color: '#991b1b', bg: '#fee2e2', border: '#fca5a5' },
}

const STATUS_FLOW: Record<string, { next: string; label: string }> = {
  new:           { next: 'confirmed',     label: 'אשר הזמנה' },
  confirmed:     { next: 'in_production', label: 'התחל ייצור' },
  in_production: { next: 'ready',         label: 'סמן כמוכנה' },
  ready:         { next: 'delivered',     label: 'סמן כנמסרה' },
}

// Branch name → color scheme
const BRANCH_COLORS: Record<string, { bg: string; text: string }> = {
  'אברהם אבינו': { bg: '#EEEDFE', text: '#3C3489' },
  'הפועלים':     { bg: '#E1F5EE', text: '#085041' },
  'יעקב כהן':    { bg: '#FBEAF0', text: '#72243E' },
}
const DEFAULT_BRANCH_COLOR = { bg: '#f1f5f9', text: '#475569' }

function getBranchColorScheme(branchName: string) {
  // Match by inclusion to be resilient against short/long names
  for (const [key, val] of Object.entries(BRANCH_COLORS)) {
    if (branchName.includes(key) || key.includes(branchName)) return val
  }
  return DEFAULT_BRANCH_COLOR
}

function tomorrowISO() {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export default function FactorySpecialOrders({ onBack }: Props) {
  const { branches, getBranchName } = useBranches()
  const { appUser } = useAppUser()
  const [orders, setOrders] = useState<SpecialOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [branchFilter, setBranchFilter] = useState<number | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [pickupFrom, setPickupFrom] = useState<string>('')
  const [pickupTo, setPickupTo] = useState<string>('')
  const [viewOrder, setViewOrder] = useState<SpecialOrder | null>(null)
  const [showPrintDialog, setShowPrintDialog] = useState(false)

  async function markMyNotificationsRead() {
    if (!appUser?.id) return
    await supabase.from('order_notifications')
      .update({ read: true })
      .eq('user_id', appUser.id)
      .eq('read', false)
  }

  useEffect(() => {
    markMyNotificationsRead()
    // eslint-disable-next-line
  }, [appUser?.id])

  async function fetchOrders() {
    setLoading(true)
    const { data } = await supabase.from('special_orders')
      .select('*')
      .order('pickup_date', { ascending: true })
    setOrders(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()
    const ch = supabase.channel('factory-special-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'special_orders' }, () => fetchOrders())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  async function updateStatus(order: SpecialOrder, newStatus: string) {
    await supabase.from('special_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', order.id)

    // Notify branch manager when ready
    if (newStatus === 'ready') {
      const { data: branchUsers } = await supabase.from('app_users')
        .select('id')
        .eq('role', 'branch')
        .eq('branch_id', order.branch_id)
      if (branchUsers && branchUsers.length > 0) {
        const notifications = branchUsers.map((u: any) => ({
          user_id: u.id,
          order_id: order.id,
          message: `הזמנה ${displayOrderNumber(order)} מוכנה לאיסוף — ${order.customer_name}`,
        }))
        await supabase.from('order_notifications').insert(notifications)
      }
    }

    if (viewOrder?.id === order.id) {
      setViewOrder({ ...order, status: newStatus as SpecialOrder['status'] })
    }
    fetchOrders()
  }

  async function saveFactoryNotes(order: SpecialOrder, notes: string) {
    await supabase.from('special_orders')
      .update({ factory_notes: notes || null, updated_at: new Date().toISOString() })
      .eq('id', order.id)
    if (viewOrder?.id === order.id) {
      setViewOrder({ ...order, factory_notes: notes || null })
    }
    fetchOrders()
  }

  // Summaries
  const today = new Date().toISOString().slice(0, 10)
  const weekEnd = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  }, [])
  const newCount = orders.filter(o => o.status === 'new').length
  const inProduction = orders.filter(o => o.status === 'in_production').length
  const readyCount = orders.filter(o => o.status === 'ready').length
  const weekCount = orders.filter(o => o.pickup_date >= today && o.pickup_date <= weekEnd && !['delivered', 'cancelled'].includes(o.status)).length

  const filtered = orders.filter(o => {
    if (branchFilter !== 'all' && o.branch_id !== branchFilter) return false
    if (statusFilter !== 'all' && o.status !== statusFilter) return false
    if (pickupFrom && o.pickup_date < pickupFrom) return false
    if (pickupTo && o.pickup_date > pickupTo) return false
    return true
  })

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader
        title="הזמנות מיוחדות — מפעל"
        subtitle="ניהול הזמנות עוגות מכל הסניפים"
        onBack={onBack}
        action={
          <button
            onClick={() => setShowPrintDialog(true)}
            style={{
              background: '#6366f1', color: 'white', border: 'none', borderRadius: 8,
              padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Printer size={16} />
            הדפס טבלת עבודה
          </button>
        }
      />

      <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <SummaryCard label="חדשות (לא אושרו)" value={newCount} icon={<Clock size={18} />} color="#2563eb" badge={newCount > 0} />
          <SummaryCard label="בייצור" value={inProduction} icon={<Cake size={18} />} color="#f59e0b" />
          <SummaryCard label="מוכנות" value={readyCount} icon={<CheckCircle2 size={18} />} color="#10b981" />
          <SummaryCard label="השבוע" value={weekCount} icon={<CalendarRange size={18} />} color="#6366f1" />
        </div>

        {/* Filters */}
        <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <FilterSelect
            label="סניף"
            value={String(branchFilter)}
            onChange={(v) => setBranchFilter(v === 'all' ? 'all' : Number(v))}
            options={[{ value: 'all', label: 'כל הסניפים' }, ...branches.map(b => ({ value: String(b.id), label: b.name }))]}
          />
          <FilterSelect
            label="סטטוס"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: 'all', label: 'כל הסטטוסים' }, ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v.label }))]}
          />
          <FilterDate label="איסוף מ-" value={pickupFrom} onChange={setPickupFrom} />
          <FilterDate label="איסוף עד-" value={pickupTo} onChange={setPickupTo} />
          {(branchFilter !== 'all' || statusFilter !== 'all' || pickupFrom || pickupTo) && (
            <button
              onClick={() => { setBranchFilter('all'); setStatusFilter('all'); setPickupFrom(''); setPickupTo('') }}
              style={{ background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              נקה סינון
            </button>
          )}
        </div>

        {/* Orders Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>טוען...</div>
        ) : filtered.length === 0 ? (
          <div style={{ background: 'white', borderRadius: 12, padding: 48, textAlign: 'center', color: '#94a3b8', border: '1px solid #f1f5f9' }}>
            אין הזמנות להצגה
          </div>
        ) : (
          <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>
                  <Th>מס׳ הזמנה</Th>
                  <Th>סניף</Th>
                  <Th>לקוח</Th>
                  <Th>איסוף</Th>
                  <Th>פרטי עוגה</Th>
                  <Th>סטטוס</Th>
                  <Th>פעולה</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const branchName = getBranchName(o.branch_id)
                  const cs = getBranchColorScheme(branchName)
                  const st = STATUS_LABELS[o.status]
                  const flow = STATUS_FLOW[o.status]
                  return (
                    <tr
                      key={o.id}
                      onClick={() => setViewOrder(o)}
                      style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#fafbff')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                    >
                      <Td><span style={{ color: '#2563eb', fontWeight: 700 }}>{displayOrderNumber(o)}</span></Td>
                      <Td>
                        <span style={{ background: cs.bg, color: cs.text, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, display: 'inline-block' }}>
                          {branchName}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{o.customer_name}</div>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 600 }}>{new Date(o.pickup_date).toLocaleDateString('he-IL')}</div>
                        {o.pickup_time && <div style={{ fontSize: 11, color: '#94a3b8' }}>{o.pickup_time}</div>}
                      </Td>
                      <Td>
                        <div style={{ fontSize: 12, color: '#475569', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {o.type} · {o.base_size} · {o.torte_flavor}
                        </div>
                      </Td>
                      <Td>
                        <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}`, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, display: 'inline-block' }}>
                          {st.label}
                        </span>
                      </Td>
                      <Td>
                        {flow && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus(o, flow.next) }}
                            style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            {flow.label}
                            <ArrowRight size={12} />
                          </button>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewOrder && (
        <OrderDetailModal
          order={viewOrder}
          branchName={getBranchName(viewOrder.branch_id)}
          onClose={() => setViewOrder(null)}
          onUpdateStatus={(s) => updateStatus(viewOrder, s)}
          onSaveNotes={(n) => saveFactoryNotes(viewOrder, n)}
        />
      )}

      {showPrintDialog && (
        <PrintDialog
          orders={orders}
          branches={branches.map(b => ({ id: b.id, name: b.name }))}
          onClose={() => setShowPrintDialog(false)}
        />
      )}
    </div>
  )
}

// ─── Summary Card ─────────────────────────────────────────────────────────
function SummaryCard({ label, value, icon, color, badge }: { label: string; value: number; icon: React.ReactNode; color: string; badge?: boolean }) {
  return (
    <div style={{
      background: 'white', border: '1px solid #f1f5f9', borderRadius: 12,
      padding: 16, display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)', position: 'relative',
    }}>
      {badge && value > 0 && (
        <span style={{ position: 'absolute', top: 8, left: 8, background: '#ef4444', color: 'white', borderRadius: 10, minWidth: 20, height: 20, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
          {value}
        </span>
      )}
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${color}15`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{value}</div>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', minWidth: 140 }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function FilterDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit' }}
      />
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>{children}</td>
}

// ─── Detail Modal ─────────────────────────────────────────────────────────
function OrderDetailModal({ order, branchName, onClose, onUpdateStatus, onSaveNotes }: {
  order: SpecialOrder; branchName: string; onClose: () => void
  onUpdateStatus: (status: string) => void; onSaveNotes: (notes: string) => void
}) {
  const [notes, setNotes] = useState(order.factory_notes || '')
  const [notesDirty, setNotesDirty] = useState(false)
  const st = STATUS_LABELS[order.status]
  const flow = STATUS_FLOW[order.status]
  const cs = getBranchColorScheme(branchName)

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, direction: 'rtl' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 16, maxWidth: 680, width: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}
      >
        <div style={{ position: 'sticky', top: 0, background: 'white', zIndex: 1, padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{displayOrderNumber(order)}</h3>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: cs.bg, color: cs.text, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                {branchName}
              </span>
              <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}`, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                {st.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, display: 'flex' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Section title="פרטי לקוח">
            <Field label="שם" value={order.customer_name} />
          </Section>

          <Section title="איסוף">
            <Field label="תאריך" value={new Date(order.pickup_date).toLocaleDateString('he-IL')} />
            {order.pickup_time && <Field label="שעה" value={order.pickup_time} />}
          </Section>

          <Section title="פרטי עוגה">
            <Field label="סוג" value={order.type} />
            <Field label="גודל וצורה" value={order.base_size} />
            <Field label="טעם טורט" value={order.torte_flavor} />
            <Field label="קרם בין השכבות" value={order.cream_between} />
            <Field label="מילוי" value={order.filling} />
            <Field label="ציפוי" value={order.coating} />
            <Field label="כתר עליון" value={order.crown} />
            {order.extras && order.extras.length > 0 && <Field label="תוספות" value={order.extras.join(' · ')} />}
          </Section>

          {order.notes && (
            <Section title="הערות סניף">
              <div style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{order.notes}</div>
            </Section>
          )}

          <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 800, marginBottom: 8, letterSpacing: 0.3 }}>הערות מפעל</div>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesDirty(true) }}
              rows={3}
              style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', direction: 'rtl' }}
            />
            {notesDirty && (
              <button
                onClick={() => { onSaveNotes(notes); setNotesDirty(false) }}
                style={{ marginTop: 8, background: '#10b981', color: 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Save size={14} /> שמור הערה
              </button>
            )}
          </div>

          {flow && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
              {order.status !== 'cancelled' && order.status !== 'delivered' && (
                <button
                  onClick={() => onUpdateStatus('cancelled')}
                  style={{ background: 'white', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  בטל הזמנה
                </button>
              )}
              <button
                onClick={() => onUpdateStatus(flow.next)}
                style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {flow.label}
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 800, marginBottom: 8, letterSpacing: 0.3 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13 }}>
      <div style={{ color: '#94a3b8', minWidth: 110, fontWeight: 600 }}>{label}:</div>
      <div style={{ color: '#0f172a', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

// ─── Print Dialog ─────────────────────────────────────────────────────────
function PrintDialog({ orders, branches, onClose }: {
  orders: SpecialOrder[]; branches: { id: number; name: string }[]; onClose: () => void
}) {
  const [printDate, setPrintDate] = useState(tomorrowISO())
  const [isPrinting, setIsPrinting] = useState(false)

  function doPrint() {
    setIsPrinting(true)
    setTimeout(() => {
      window.print()
      setTimeout(() => setIsPrinting(false), 500)
    }, 100)
  }

  const dayOrders = orders.filter(o => o.pickup_date === printDate && !['cancelled'].includes(o.status))
  const byBranch: Record<number, SpecialOrder[]> = {}
  for (const o of dayOrders) {
    if (!byBranch[o.branch_id]) byBranch[o.branch_id] = []
    byBranch[o.branch_id].push(o)
  }
  const branchName = (id: number) => branches.find(b => b.id === id)?.name || `סניף ${id}`
  const formatted = new Date(printDate).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <>
      {!isPrinting && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, direction: 'rtl' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, maxWidth: 460, width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>הדפס טבלת עבודה</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, display: 'flex' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 }}>בחר תאריך איסוף</div>
                <input
                  type="date"
                  value={printDate}
                  onChange={e => setPrintDate(e.target.value)}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 10px', fontSize: 14, fontFamily: 'inherit' }}
                />
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: 12, fontSize: 13, color: '#475569' }}>
                הזמנות לתאריך: <strong>{dayOrders.length}</strong>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button
                  onClick={onClose}
                  style={{ background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  ביטול
                </button>
                <button
                  onClick={doPrint}
                  disabled={dayOrders.length === 0}
                  style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: dayOrders.length === 0 ? 'not-allowed' : 'pointer', opacity: dayOrders.length === 0 ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Printer size={14} /> הדפס
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Printable document — hidden unless printing */}
      <div id="print-area" style={{ display: 'none' }}>
        <div className="print-root" style={{ direction: 'rtl', color: '#000', fontFamily: 'Arial, sans-serif' }}>
          <h1 style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center', margin: '0 0 6px', borderBottom: '2px solid #000', paddingBottom: 6 }}>
            טבלת עבודה קונדיטוריית מרטין — {formatted}
          </h1>
          <p style={{ textAlign: 'center', margin: '0 0 14px', fontSize: 12 }}>
            סה"כ הזמנות: {dayOrders.length}
          </p>

          {Object.entries(byBranch).map(([bid, list]) => (
            <div key={bid} style={{ marginBottom: 18, pageBreakInside: 'avoid' }}>
              <h2 style={{ fontSize: 15, fontWeight: 'bold', background: '#000', color: '#fff', padding: '6px 10px', margin: '0 0 6px' }}>
                סניף: {branchName(Number(bid))} ({list.length} הזמנות)
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={printThStyle}>מס׳</th>
                    <th style={printThStyle}>לקוח</th>
                    <th style={printThStyle}>שעה</th>
                    <th style={printThStyle}>פרטי עוגה</th>
                    <th style={printThStyle}>הערות</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(o => (
                    <tr key={o.id}>
                      <td style={printTdStyle}>{displayOrderNumber(o)}</td>
                      <td style={printTdStyle}>
                        <div style={{ fontWeight: 'bold' }}>{o.customer_name}</div>
                      </td>
                      <td style={printTdStyle}>{o.pickup_time || '—'}</td>
                      <td style={printTdStyle}>
                        <div><strong>סוג:</strong> {o.type}</div>
                        <div><strong>גודל:</strong> {o.base_size}</div>
                        <div><strong>טורט:</strong> {o.torte_flavor}</div>
                        <div><strong>קרם:</strong> {o.cream_between}</div>
                        <div><strong>מילוי:</strong> {o.filling}</div>
                        <div><strong>ציפוי:</strong> {o.coating}</div>
                        <div><strong>כתר:</strong> {o.crown}</div>
                        {o.extras && o.extras.length > 0 && <div><strong>תוספות:</strong> {o.extras.join(', ')}</div>}
                      </td>
                      <td style={printTdStyle}>
                        {o.notes && <div>{o.notes}</div>}
                        {o.factory_notes && <div style={{ marginTop: 4, borderTop: '1px dashed #888', paddingTop: 4 }}><strong>מפעל:</strong> {o.factory_notes}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {dayOrders.length === 0 && (
            <p style={{ textAlign: 'center', marginTop: 40, fontSize: 14 }}>אין הזמנות לתאריך זה</p>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area { display: block !important; position: absolute !important; inset: 0 !important; background: white !important; padding: 12mm !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </>
  )
}

const printThStyle: React.CSSProperties = {
  border: '1px solid #000',
  padding: '6px 8px',
  textAlign: 'right',
  background: '#fff',
  fontWeight: 'bold',
  fontSize: 11,
}

const printTdStyle: React.CSSProperties = {
  border: '1px solid #000',
  padding: '6px 8px',
  textAlign: 'right',
  verticalAlign: 'top',
  fontSize: 11,
  lineHeight: 1.4,
}
