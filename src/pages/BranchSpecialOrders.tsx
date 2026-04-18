import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'
import { Plus, X, Cake, Clock, CheckCircle2, CalendarCheck, Ban } from 'lucide-react'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

export interface SpecialOrder {
  id: number
  order_number: string                  // system-generated unique key
  order_number_manual: string | null    // manually-entered display number
  branch_id: number
  customer_name: string
  customer_phone: string | null
  order_date: string
  pickup_date: string
  pickup_time: string | null
  type: 'חלבי' | 'פרווה'
  base_size: string
  torte_flavor: string
  cream_between: string
  filling: string
  coating: string
  crown: string
  extras: string[] | null
  notes: string | null
  factory_notes: string | null
  status: 'new' | 'in_progress' | 'sent_to_branch' | 'cancelled'
  created_by: string | null
  created_at: string
}

export function displayOrderNumber(o: Pick<SpecialOrder, 'order_number' | 'order_number_manual'>): string {
  return o.order_number_manual?.trim() || o.order_number
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new:            { label: 'הזמנה חדשה', color: '#9a3412', bg: '#ffedd5', border: '#fdba74' },
  in_progress:    { label: 'בטיפול',     color: '#1e40af', bg: '#dbeafe', border: '#93c5fd' },
  sent_to_branch: { label: 'נשלח לסניף', color: '#166534', bg: '#dcfce7', border: '#86efac' },
  cancelled:      { label: 'בוטלה',      color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
}

const BASE_SIZES = ['עגולה גדולה', 'ריבוע', 'רבע פלטה', 'לב']
const TORTE_FLAVORS = ['וניל', 'שוקולד']
const CREAMS_BETWEEN = ['שאנטי שוקולד', 'וניל']
const FILLINGS = ['ריבת חלב', 'תות', 'אוכמניות', 'שוקולד']
const COATINGS = ['מזרה סוכריות', 'קוקוס קלוי', 'אגוזי מלח טחונים', 'קרם חלק', 'שתי וערב']
const CROWNS = ['ללא', 'לבן', 'חום', 'ורוד', 'תכלת', 'תכלת-לבן', 'ורוד-לבן', 'חום-לבן']
const EXTRAS = ['דובדבנים', 'דובדבנים אקסטרה', 'כדורי שוקולד', 'אגוזי מלך (בתוך העוגה)']

function todayISO() { return new Date().toISOString().slice(0, 10) }

function generateOrderNumber(branchId: number) {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  return `SO-${branchId}-${stamp}`
}

export default function BranchSpecialOrders({ branchId, branchName, branchColor, onBack }: Props) {
  const { appUser } = useAppUser()
  const [orders, setOrders] = useState<SpecialOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showForm, setShowForm] = useState(false)
  const [viewOrder, setViewOrder] = useState<SpecialOrder | null>(null)

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
      .eq('branch_id', branchId)
      .order('pickup_date', { ascending: true })
    setOrders(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()
    const ch = supabase.channel(`branch-special-orders-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'special_orders', filter: `branch_id=eq.${branchId}` }, () => fetchOrders())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [branchId])

  const today = todayISO()
  const active = orders.filter(o => !['sent_to_branch', 'cancelled'].includes(o.status))
  const pending = orders.filter(o => o.status === 'new')
  const ready = orders.filter(o => o.status === 'sent_to_branch' && o.pickup_date >= today)
  const pickupToday = orders.filter(o => o.pickup_date === today && o.status !== 'cancelled')

  const filtered = statusFilter === 'all'
    ? orders
    : statusFilter === 'active'
      ? active
      : orders.filter(o => o.status === statusFilter)

  async function cancelOrder(o: SpecialOrder) {
    if (!confirm(`לבטל את הזמנה ${displayOrderNumber(o)}?`)) return
    await supabase.from('special_orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', o.id)
    setViewOrder(null)
    fetchOrders()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader
        title={`הזמנות מיוחדות — סניף ${branchName}`}
        subtitle="עוגות מעוצבות · לפי הזמנה"
        onBack={onBack}
        action={
          <button
            onClick={() => setShowForm(true)}
            style={{
              background: branchColor, color: 'white', border: 'none', borderRadius: 8,
              padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Plus size={16} />
            הזמנה חדשה
          </button>
        }
      />

      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        {/* ─── Summary Cards ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <SummaryCard label="פעילות" value={active.length} icon={<Cake size={18} />} color="#6366f1" />
          <SummaryCard label="ממתינות לאישור" value={pending.length} icon={<Clock size={18} />} color="#f59e0b" />
          <SummaryCard label="מוכנות לאיסוף" value={ready.length} icon={<CheckCircle2 size={18} />} color="#10b981" badge={ready.length > 0} />
          <SummaryCard label="איסוף היום" value={pickupToday.length} icon={<CalendarCheck size={18} />} color="#ec4899" />
        </div>

        {/* ─── Filters ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <FilterChip label="הכל" active={statusFilter === 'all'} count={orders.length} onClick={() => setStatusFilter('all')} />
          <FilterChip label="פעילות" active={statusFilter === 'active'} count={active.length} onClick={() => setStatusFilter('active')} />
          {Object.entries(STATUS_LABELS).map(([key, cfg]) => (
            <FilterChip
              key={key}
              label={cfg.label}
              active={statusFilter === key}
              count={orders.filter(o => o.status === key).length}
              onClick={() => setStatusFilter(key)}
              color={cfg.color}
            />
          ))}
        </div>

        {/* ─── Orders List ──────────────────────────────────────────── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>טוען...</div>
        ) : filtered.length === 0 ? (
          <div style={{ background: 'white', borderRadius: 12, padding: 48, textAlign: 'center', color: '#94a3b8', border: '1px solid #f1f5f9' }}>
            אין הזמנות להצגה
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(o => (
              <OrderRow key={o.id} order={o} onClick={() => setViewOrder(o)} />
            ))}
          </div>
        )}
      </div>

      {/* ─── Order Form Modal ─────────────────────────────────────── */}
      {showForm && (
        <OrderForm
          branchId={branchId}
          branchColor={branchColor}
          userId={appUser?.id || null}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchOrders() }}
        />
      )}

      {/* ─── View Order Modal ─────────────────────────────────────── */}
      {viewOrder && (
        <OrderView
          order={viewOrder}
          onClose={() => setViewOrder(null)}
          onCancel={() => cancelOrder(viewOrder)}
        />
      )}
    </div>
  )
}

// ─── Summary Card ─────────────────────────────────────────────────────────
function SummaryCard({ label, value, icon, color, badge }: { label: string; value: number; icon: React.ReactNode; color: string; badge?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'white', border: '1px solid #f1f5f9', borderRadius: 12,
        padding: 16, display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)', position: 'relative',
      }}
    >
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
    </motion.div>
  )
}

// ─── Filter Chip ──────────────────────────────────────────────────────────
function FilterChip({ label, active, count, onClick, color }: { label: string; active: boolean; count: number; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? (color || '#6366f1') : 'white',
        color: active ? 'white' : '#475569',
        border: `1px solid ${active ? (color || '#6366f1') : '#e2e8f0'}`,
        borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      {label}
      <span style={{ background: active ? 'rgba(255,255,255,0.25)' : '#f1f5f9', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
        {count}
      </span>
    </button>
  )
}

// ─── Order Row ────────────────────────────────────────────────────────────
function OrderRow({ order, onClick }: { order: SpecialOrder; onClick: () => void }) {
  const st = STATUS_LABELS[order.status]
  const summary = `${order.type} · ${order.base_size} · ${order.torte_flavor}`
  return (
    <button
      onClick={onClick}
      style={{
        background: 'white', border: '1px solid #f1f5f9', borderRadius: 12,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
        cursor: 'pointer', textAlign: 'right', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#c7d2fe')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#f1f5f9')}
    >
      <div style={{ flexShrink: 0, minWidth: 120 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#2563eb' }}>{displayOrderNumber(order)}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{new Date(order.order_date).toLocaleDateString('he-IL')}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{order.customer_name}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
          איסוף: {new Date(order.pickup_date).toLocaleDateString('he-IL')}{order.pickup_time ? ` · ${order.pickup_time}` : ''}
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {summary}
        </div>
      </div>
      <span style={{
        background: st.bg, color: st.color, border: `1px solid ${st.border}`,
        borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}>
        {st.label}
      </span>
    </button>
  )
}

// ─── Order View Modal ─────────────────────────────────────────────────────
function OrderView({ order, onClose, onCancel }: { order: SpecialOrder; onClose: () => void; onCancel: () => void }) {
  const st = STATUS_LABELS[order.status]
  return (
    <Modal onClose={onClose} title={`הזמנה ${displayOrderNumber(order)}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}`, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
            {st.label}
          </span>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            נוצרה: {new Date(order.created_at).toLocaleString('he-IL')}
          </span>
        </div>

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
          {order.extras && order.extras.length > 0 && (
            <Field label="תוספות" value={order.extras.join(' · ')} />
          )}
        </Section>

        {(order.notes || order.factory_notes) && (
          <Section title="הערות">
            {order.notes && <Field label="הערות סניף" value={order.notes} />}
            {order.factory_notes && <Field label="הערות מפעל" value={order.factory_notes} />}
          </Section>
        )}

        {!['sent_to_branch', 'cancelled'].includes(order.status) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
            <button
              onClick={onCancel}
              style={{
                background: 'white', color: '#991b1b', border: '1px solid #fca5a5',
                borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Ban size={14} />
              בטל הזמנה
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 800, marginBottom: 8, letterSpacing: 0.3 }}>
        {title}
      </div>
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

// ─── Modal ────────────────────────────────────────────────────────────────
function Modal({ onClose, title, children, width = 600 }: { onClose: () => void; title: string; children: React.ReactNode; width?: number }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        padding: 20, direction: 'rtl',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 16, maxWidth: width, width: '100%',
          maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{
          position: 'sticky', top: 0, background: 'white', zIndex: 1,
          padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, display: 'flex' }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  )
}

// ─── Order Form ───────────────────────────────────────────────────────────
function OrderForm({ branchId, branchColor, userId, onClose, onSaved }: {
  branchId: number; branchColor: string; userId: string | null
  onClose: () => void; onSaved: () => void
}) {
  const [customerName, setCustomerName] = useState('')
  const [orderNumberManual, setOrderNumberManual] = useState('')
  const [pickupDate, setPickupDate] = useState('')
  const [pickupTime, setPickupTime] = useState('')
  const [type, setType] = useState<'חלבי' | 'פרווה'>('חלבי')
  const [baseSize, setBaseSize] = useState('')
  const [torteFlavor, setTorteFlavor] = useState('')
  const [creamBetween, setCreamBetween] = useState('')
  const [filling, setFilling] = useState('')
  const [coating, setCoating] = useState('')
  const [crown, setCrown] = useState('')
  const [extras, setExtras] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleExtra(v: string) {
    setExtras(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  async function save() {
    setError(null)
    if (!customerName.trim()) return setError('שם לקוח חובה')
    if (!orderNumberManual.trim()) return setError('מספר הזמנה חובה')
    if (!pickupDate) return setError('תאריך איסוף חובה')
    if (!baseSize) return setError('גודל וצורת בסיס חובה')
    if (!torteFlavor) return setError('טעם טורט חובה')
    if (!creamBetween) return setError('קרם בין השכבות חובה')
    if (!filling) return setError('מילוי חובה')
    if (!coating) return setError('ציפוי חובה')
    if (!crown) return setError('כתר עליון חובה')

    setSaving(true)

    const systemOrderNumber = generateOrderNumber(branchId)
    const manualNumber = orderNumberManual.trim()
    const { data: inserted, error: insErr } = await supabase.from('special_orders').insert({
      order_number: systemOrderNumber,
      order_number_manual: manualNumber,
      branch_id: branchId,
      customer_name: customerName.trim(),
      order_date: todayISO(),
      pickup_date: pickupDate,
      pickup_time: pickupTime || null,
      type,
      base_size: baseSize,
      torte_flavor: torteFlavor,
      cream_between: creamBetween,
      filling,
      coating,
      crown,
      extras: extras.length > 0 ? extras : null,
      notes: notes.trim() || null,
      status: 'new',
      created_by: userId,
    }).select().single()

    if (insErr || !inserted) {
      setError('שגיאה בשמירת הזמנה: ' + (insErr?.message || ''))
      setSaving(false)
      return
    }

    // Notify all factory users
    const { data: factoryUsers } = await supabase.from('app_users').select('id').eq('role', 'factory')
    if (factoryUsers && factoryUsers.length > 0) {
      const notifications = factoryUsers.map((u: any) => ({
        user_id: u.id,
        order_id: inserted.id,
        message: `הזמנה חדשה ${manualNumber} — ${customerName} · איסוף ${new Date(pickupDate).toLocaleDateString('he-IL')}`,
      }))
      await supabase.from('order_notifications').insert(notifications)
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal onClose={onClose} title="הזמנת עוגה מיוחדת" width={700}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* Customer + Pickup */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <TextInput label="שם לקוח *" value={customerName} onChange={setCustomerName} />
          <TextInput label="מספר הזמנה *" value={orderNumberManual} onChange={setOrderNumberManual} />
          <TextInput label="תאריך איסוף *" value={pickupDate} onChange={setPickupDate} type="date" min={todayISO()} />
          <TextInput label="שעת איסוף" value={pickupTime} onChange={setPickupTime} type="time" />
        </div>

        {/* Type */}
        <RadioGroup label="סוג *" value={type} onChange={(v) => setType(v as 'חלבי' | 'פרווה')} options={['חלבי', 'פרווה']} color={branchColor} />

        {/* Required cake fields */}
        <SelectGroup label="גודל וצורת בסיס *" value={baseSize} onChange={setBaseSize} options={BASE_SIZES} color={branchColor} />
        <SelectGroup label="טעם טורט *" value={torteFlavor} onChange={setTorteFlavor} options={TORTE_FLAVORS} color={branchColor} />
        <SelectGroup label="קרם בין השכבות *" value={creamBetween} onChange={setCreamBetween} options={CREAMS_BETWEEN} color={branchColor} />
        <SelectGroup label="מילוי *" value={filling} onChange={setFilling} options={FILLINGS} color={branchColor} />
        <SelectGroup label="ציפוי *" value={coating} onChange={setCoating} options={COATINGS} color={branchColor} />
        <SelectGroup label="כתר עליון *" value={crown} onChange={setCrown} options={CROWNS} color={branchColor} />

        {/* Extras multi-select */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 }}>תוספות (אופציונלי)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {EXTRAS.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => toggleExtra(e)}
                style={{
                  background: extras.includes(e) ? branchColor : 'white',
                  color: extras.includes(e) ? 'white' : '#475569',
                  border: `1px solid ${extras.includes(e) ? branchColor : '#e2e8f0'}`,
                  borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 }}>הערות חופשיות</div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            style={{
              width: '100%', border: '1px solid #e2e8f0', borderRadius: 8,
              padding: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
          <button
            onClick={onClose}
            style={{ background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            ביטול
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{ background: branchColor, color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'שומר...' : 'שמור הזמנה'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function TextInput({ label, value, onChange, type = 'text', min }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; min?: string
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <input
        type={type}
        value={value}
        min={min}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '9px 10px', fontSize: 14, fontFamily: 'inherit', direction: 'rtl',
        }}
      />
    </div>
  )
}

function SelectGroup({ label, value, onChange, options, color }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; color: string
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map(o => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            style={{
              background: value === o ? color : 'white',
              color: value === o ? 'white' : '#475569',
              border: `1px solid ${value === o ? color : '#e2e8f0'}`,
              borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

function RadioGroup({ label, value, onChange, options, color }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; color: string
}) {
  return <SelectGroup label={label} value={value} onChange={onChange} options={options} color={color} />
}
