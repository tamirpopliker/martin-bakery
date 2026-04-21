import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'
import { Plus, X, Cake, Clock, CheckCircle2, CalendarCheck, Ban, Printer, Search, CheckCheck } from 'lucide-react'

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
  preset_cake_name: string | null       // set when a ready-made medium-round cake was chosen
  status: 'new' | 'in_progress' | 'sent_to_branch' | 'delivered_to_customer' | 'cancelled'
  created_by: string | null
  created_at: string
}

type CakeType = 'חלבי' | 'פרווה'

export function displayOrderNumber(o: Pick<SpecialOrder, 'order_number' | 'order_number_manual'>): string {
  return o.order_number_manual?.trim() || o.order_number
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new:                   { label: 'הזמנה חדשה', color: '#9a3412', bg: '#ffedd5', border: '#fdba74' },
  in_progress:           { label: 'בטיפול',     color: '#1e40af', bg: '#dbeafe', border: '#93c5fd' },
  sent_to_branch:        { label: 'נשלח לסניף', color: '#166534', bg: '#dcfce7', border: '#86efac' },
  delivered_to_customer: { label: 'יצאה ללקוח', color: '#5b21b6', bg: '#ede9fe', border: '#c4b5fd' },
  cancelled:             { label: 'בוטלה',      color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
}

const HISTORY_STATUSES = ['sent_to_branch', 'delivered_to_customer', 'cancelled']

const MEDIUM_ROUND = 'עגולה בינונית'
const BASE_SIZES = ['עגולה גדולה', MEDIUM_ROUND, 'ריבוע', 'רבע פלטה', 'לב']
const TORTE_FLAVORS = ['וניל', 'שוקולד']
const CREAMS_BETWEEN: Record<CakeType, string[]> = {
  'חלבי':  ['שאנטי שוקולד', 'וניל'],
  'פרווה': ['קרם שוקולד פרווה', 'קרם וניל פרווה'],
}
const FILLINGS: Record<CakeType, string[]> = {
  'חלבי':  ['ריבת חלב', 'תות', 'אוכמניות', 'שוקולד'],
  'פרווה': ['תות', 'אוכמניות', 'שוקולד', 'קרמל'],
}
const PRESET_CAKES: Record<CakeType, string[]> = {
  'חלבי':  ['ריבת חלב', 'שאנטי שוקולד', 'פירות יער', 'היער השחור'],
  'פרווה': ['קרם שוקולד', 'שוקו שוקו', 'קרמל', 'אוכמניות'],
}
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
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [viewOrder, setViewOrder] = useState<SpecialOrder | null>(null)
  const [printOrder, setPrintOrder] = useState<SpecialOrder | null>(null)

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
  const active = orders.filter(o => !HISTORY_STATUSES.includes(o.status))
  const history = orders.filter(o => HISTORY_STATUSES.includes(o.status))
  const pending = orders.filter(o => o.status === 'new')
  const ready = orders.filter(o => o.status === 'sent_to_branch' && o.pickup_date >= today)
  const pickupToday = orders.filter(o => o.pickup_date === today && !['cancelled', 'delivered_to_customer'].includes(o.status))

  const tabOrders = tab === 'active' ? active : history
  const afterStatusFilter = statusFilter === 'all' ? tabOrders : tabOrders.filter(o => o.status === statusFilter)
  const searchLower = search.trim().toLowerCase()
  const filtered = searchLower
    ? afterStatusFilter.filter(o =>
        o.customer_name.toLowerCase().includes(searchLower) ||
        displayOrderNumber(o).toLowerCase().includes(searchLower))
    : afterStatusFilter

  async function changeStatus(o: SpecialOrder, newStatus: SpecialOrder['status']) {
    const { error } = await supabase.from('special_orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', o.id)
    if (error) {
      console.error('[BranchSpecialOrders changeStatus] error:', error)
      alert(`עדכון סטטוס ההזמנה נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    if (viewOrder?.id === o.id) setViewOrder(null)
    fetchOrders()
  }

  async function cancelOrder(o: SpecialOrder) {
    if (!confirm(`לבטל את הזמנה ${displayOrderNumber(o)}?`)) return
    await changeStatus(o, 'cancelled')
  }

  async function markDeliveredToCustomer(o: SpecialOrder) {
    await changeStatus(o, 'delivered_to_customer')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader
        title={`הזמנות מיוחדות — סניף ${branchName}`}
        subtitle="עוגות מעוצבות · לפי הזמנה"
        onBack={onBack}
      />

      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        {/* ─── Summary Cards ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <SummaryCard label="פעילות" value={active.length} icon={<Cake size={18} />} color="#6366f1" />
          <SummaryCard label="ממתינות לאישור" value={pending.length} icon={<Clock size={18} />} color="#f59e0b" />
          <SummaryCard label="מוכנות לאיסוף" value={ready.length} icon={<CheckCircle2 size={18} />} color="#10b981" badge={ready.length > 0} />
          <SummaryCard label="איסוף היום" value={pickupToday.length} icon={<CalendarCheck size={18} />} color="#ec4899" />
        </div>

        {/* ─── Tabs ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 2, background: '#f1f5f9', padding: 4, borderRadius: 10, marginBottom: 14, maxWidth: 320 }}>
          <TabButton label="פעילות" count={active.length} active={tab === 'active'} onClick={() => { setTab('active'); setStatusFilter('all') }} />
          <TabButton label="היסטוריה" count={history.length} active={tab === 'history'} onClick={() => { setTab('history'); setStatusFilter('all') }} />
        </div>

        {/* ─── Search ───────────────────────────────────────────────── */}
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={16} color="#94a3b8" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="חיפוש לפי שם לקוח או מספר הזמנה..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', border: '1px solid #e2e8f0', borderRadius: 10,
              padding: '10px 36px 10px 12px', fontSize: 14, fontFamily: 'inherit',
              direction: 'rtl', boxSizing: 'border-box', background: 'white',
            }}
          />
        </div>

        {/* ─── Filters ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <FilterChip label="הכל" active={statusFilter === 'all'} count={tabOrders.length} onClick={() => setStatusFilter('all')} />
          {Object.entries(STATUS_LABELS)
            .filter(([k]) => tab === 'active' ? !HISTORY_STATUSES.includes(k) : HISTORY_STATUSES.includes(k))
            .map(([key, cfg]) => (
              <FilterChip
                key={key}
                label={cfg.label}
                active={statusFilter === key}
                count={tabOrders.filter(o => o.status === key).length}
                onClick={() => setStatusFilter(key)}
                color={cfg.color}
              />
            ))}
        </div>

        {/* ─── Orders List ──────────────────────────────────────────── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>טוען...</div>
        ) : filtered.length === 0 ? (
          search ? (
            <div style={{ background: 'white', borderRadius: 12, padding: 48, textAlign: 'center', color: '#94a3b8', border: '1px solid #f1f5f9' }}>
              לא נמצאו הזמנות תואמות לחיפוש
            </div>
          ) : tab === 'active' ? (
            <div style={{ background: 'white', borderRadius: 16, padding: '56px 20px', textAlign: 'center', border: '1px dashed #e2e8f0' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Cake size={32} color="#6366f1" />
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>אין הזמנות פעילות</div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>התחל בהזמנת עוגה חדשה ללקוח</div>
              <button
                onClick={() => setShowForm(true)}
                style={{
                  background: branchColor, color: 'white', border: 'none', borderRadius: 12,
                  padding: '12px 28px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  boxShadow: `0 4px 14px ${branchColor}55`,
                }}
              >
                <Plus size={18} />
                הזמנה חדשה
              </button>
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: 12, padding: 48, textAlign: 'center', color: '#94a3b8', border: '1px solid #f1f5f9' }}>
              אין הזמנות בהיסטוריה
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(o => (
              <OrderCard
                key={o.id}
                order={o}
                today={today}
                onDetails={() => setViewOrder(o)}
                onChangeStatus={(s) => changeStatus(o, s)}
                onCancel={() => cancelOrder(o)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Floating Action Button (only in active tab) ───────────── */}
      {tab === 'active' && (
        <button
          onClick={() => setShowForm(true)}
          title="הזמנה חדשה"
          aria-label="הזמנה חדשה"
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 50,
            width: 56, height: 56, borderRadius: '50%',
            background: '#6366f1', color: 'white', border: 'none',
            fontSize: 28, lineHeight: 1, fontWeight: 300,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 20px rgba(99, 102, 241, 0.4)',
            transition: 'transform 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.06)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          +
        </button>
      )}

      {/* ─── Order Form Modal ─────────────────────────────────────── */}
      {showForm && (
        <OrderForm
          branchId={branchId}
          branchName={branchName}
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
          branchName={branchName}
          onClose={() => setViewOrder(null)}
          onCancel={() => cancelOrder(viewOrder)}
          onDeliverToCustomer={() => markDeliveredToCustomer(viewOrder)}
          onPrint={() => setPrintOrder(viewOrder)}
        />
      )}

      {/* ─── Customer Print Confirmation ─────────────────────────── */}
      {printOrder && (
        <PrintConfirmation
          order={printOrder}
          branchName={branchName}
          onClose={() => setPrintOrder(null)}
        />
      )}
    </div>
  )
}

// ─── Tab Button ──────────────────────────────────────────────────────────
function TabButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, background: active ? 'white' : 'transparent',
        color: active ? '#0f172a' : '#64748b',
        border: 'none', borderRadius: 8, padding: '8px 14px',
        fontSize: 13, fontWeight: 700, cursor: 'pointer',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        transition: 'all 0.15s',
      }}
    >
      {label}
      <span style={{ background: active ? '#f1f5f9' : 'rgba(100,116,139,0.12)', color: active ? '#475569' : '#64748b', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
        {count}
      </span>
    </button>
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

// ─── Order Card ──────────────────────────────────────────────────────────
function OrderCard({ order, today, onDetails, onChangeStatus, onCancel }: {
  order: SpecialOrder
  today: string
  onDetails: () => void
  onChangeStatus: (s: SpecialOrder['status']) => void
  onCancel: () => void
}) {
  const st = STATUS_LABELS[order.status]
  const isToday = order.pickup_date === today && !HISTORY_STATUSES.includes(order.status)
  const mainFilling = order.preset_cake_name || order.filling
  const summary = `${order.type} · ${order.base_size} · ${mainFilling}`
  const pickupDateLabel = new Date(order.pickup_date).toLocaleDateString('he-IL')
  const pickupTimeLabel = order.pickup_time ? ` · ${order.pickup_time}` : ''

  const [menuOpen, setMenuOpen] = useState(false)

  // Branch-side status transitions available on the card
  const nextActions: { key: SpecialOrder['status']; label: string; danger?: boolean }[] = []
  if (order.status === 'sent_to_branch') {
    nextActions.push({ key: 'delivered_to_customer', label: 'יצאה ללקוח' })
  }
  if (!HISTORY_STATUSES.includes(order.status)) {
    nextActions.push({ key: 'cancelled', label: 'בטל הזמנה', danger: true })
  }

  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #f1f5f9',
        borderRight: isToday ? '3px solid #E24B4A' : '1px solid #f1f5f9',
        borderRadius: 12,
        padding: '14px 16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        position: 'relative',
      }}
    >
      {/* Header: customer name + order number badge + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#0f172a' }}>{order.customer_name}</div>
        </div>
        <span style={{
          background: '#dbeafe', color: '#1e40af',
          borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}>
          #{displayOrderNumber(order)}
        </span>
        <span style={{
          background: st.bg, color: st.color, border: `1px solid ${st.border}`,
          borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {st.label}
        </span>
      </div>

      {/* Cake summary */}
      <div style={{ fontSize: 13, color: '#475569', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {summary}
      </div>

      {/* Pickup line — red if today */}
      <div style={{ fontSize: 13, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: isToday ? '#E24B4A' : '#64748b', fontWeight: isToday ? 700 : 500 }}>
          איסוף: {pickupDateLabel}{pickupTimeLabel}
        </span>
        {isToday && (
          <span style={{ background: '#E24B4A', color: 'white', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>
            היום
          </span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end', flexWrap: 'wrap', position: 'relative' }}>
        {nextActions.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              style={{
                background: 'white', color: '#475569', border: '1px solid #e2e8f0',
                borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              שנה סטטוס ▾
            </button>
            {menuOpen && (
              <>
                <div
                  onClick={() => setMenuOpen(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 20 }}
                />
                <div
                  style={{
                    position: 'absolute', top: '100%', marginTop: 4, left: 0,
                    background: 'white', border: '1px solid #e2e8f0', borderRadius: 10,
                    boxShadow: '0 6px 20px rgba(15,23,42,0.12)', padding: 4, zIndex: 21,
                    minWidth: 160, display: 'flex', flexDirection: 'column', gap: 2,
                  }}
                >
                  {nextActions.map(a => (
                    <button
                      key={a.key}
                      onClick={() => {
                        setMenuOpen(false)
                        if (a.key === 'cancelled') { onCancel(); return }
                        onChangeStatus(a.key)
                      }}
                      style={{
                        background: 'none', border: 'none',
                        color: a.danger ? '#991b1b' : '#0f172a',
                        borderRadius: 6, padding: '8px 10px', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = a.danger ? '#fee2e2' : '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <button
          onClick={onDetails}
          style={{
            background: '#6366f1', color: 'white', border: 'none',
            borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          פרטים
        </button>
      </div>
    </div>
  )
}

// ─── Order View Modal ─────────────────────────────────────────────────────
function OrderView({ order, branchName, onClose, onCancel, onDeliverToCustomer, onPrint }: {
  order: SpecialOrder
  branchName: string
  onClose: () => void
  onCancel: () => void
  onDeliverToCustomer: () => void
  onPrint: () => void
}) {
  void branchName
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
          {order.preset_cake_name ? (
            <Field label="עוגה מוכנה" value={order.preset_cake_name} />
          ) : (
            <>
              <Field label="טעם טורט" value={order.torte_flavor} />
              <Field label="קרם בין השכבות" value={order.cream_between} />
              <Field label="מילוי" value={order.filling} />
            </>
          )}
          <Field label="ציפוי" value={order.coating} />
          <Field label="כתר עליון" value={order.crown} />
          {order.extras && order.extras.length > 0 && (
            <Field label="תוספות" value={order.extras.join(' · ')} />
          )}
        </Section>

        {order.notes && (
          <Section title="הערות סניף">
            <div style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{order.notes}</div>
          </Section>
        )}

        {/* factory_notes intentionally hidden from the branch view */}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, paddingTop: 8 }}>
          <button
            onClick={onPrint}
            style={{
              background: '#6366f1', color: 'white', border: 'none',
              borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Printer size={14} />
            הדפס אישור
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {order.status === 'sent_to_branch' && (
              <button
                onClick={onDeliverToCustomer}
                style={{
                  background: '#10b981', color: 'white', border: 'none',
                  borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <CheckCheck size={14} />
                יצאה ללקוח
              </button>
            )}
            {!HISTORY_STATUSES.includes(order.status) && (
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
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Print Confirmation (A5 customer receipt) ────────────────────────────
function PrintConfirmation({ order, branchName, onClose }: { order: SpecialOrder; branchName: string; onClose: () => void }) {
  const pickupLabel = new Date(order.pickup_date).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  function doPrint() {
    window.print()
    setTimeout(onClose, 400)
  }

  return (
    <>
      {/* Confirmation dialog (hidden during print) */}
      <div
        className="so-print-dialog"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 20, direction: 'rtl' }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ background: 'white', borderRadius: 16, maxWidth: 420, width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>הדפס אישור ללקוח</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, display: 'flex' }}>
              <X size={20} />
            </button>
          </div>
          <div style={{ padding: 20, fontSize: 13, color: '#475569' }}>
            יודפס דף A5 עם פרטי ההזמנה של {order.customer_name}.
          </div>
          <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>ביטול</button>
            <button onClick={doPrint} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Printer size={14} /> הדפס
            </button>
          </div>
        </div>
      </div>

      {/* Printable content */}
      <div id="so-confirmation-print" style={{ direction: 'rtl', color: '#000', fontFamily: 'Arial, sans-serif' }}>
        <div className="confirm-root" style={{ padding: '16mm 14mm' }}>
          <div style={{ textAlign: 'center', marginBottom: 20, borderBottom: '3px double #0d6165', paddingBottom: 14 }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: '#0d6165', fontFamily: 'serif', letterSpacing: 2 }}>מרטין</div>
            <div style={{ fontSize: 11, color: '#0d6165', letterSpacing: 4, marginTop: 2 }}>קונדיטוריה ובית מאפה · 1964</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>סניף {branchName}</div>
          </div>

          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>אישור הזמנה</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#2563eb', marginTop: 4, letterSpacing: 1 }}>
              #{displayOrderNumber(order)}
            </div>
          </div>

          <PrintRow label="שם הלקוח" value={order.customer_name} strong />
          <PrintRow label="תאריך איסוף" value={pickupLabel} strong />
          {order.pickup_time && <PrintRow label="שעת איסוף" value={order.pickup_time} strong />}

          <div style={{ margin: '18px 0 8px', fontSize: 13, fontWeight: 800, color: '#0d6165', borderBottom: '1px solid #0d6165', paddingBottom: 4 }}>
            פרטי העוגה
          </div>
          <PrintRow label="סוג" value={order.type} />
          <PrintRow label="גודל וצורה" value={order.base_size} />
          {order.preset_cake_name ? (
            <PrintRow label="עוגה מוכנה" value={order.preset_cake_name} strong />
          ) : (
            <>
              <PrintRow label="טעם טורט" value={order.torte_flavor} />
              <PrintRow label="קרם בין השכבות" value={order.cream_between} />
              <PrintRow label="מילוי" value={order.filling} />
            </>
          )}
          <PrintRow label="ציפוי" value={order.coating} />
          <PrintRow label="כתר עליון" value={order.crown} />
          {order.extras && order.extras.length > 0 && <PrintRow label="תוספות" value={order.extras.join(' · ')} />}

          {order.notes && (
            <>
              <div style={{ margin: '16px 0 6px', fontSize: 13, fontWeight: 800, color: '#0d6165', borderBottom: '1px solid #0d6165', paddingBottom: 4 }}>
                הערות
              </div>
              <div style={{ fontSize: 12, color: '#0f172a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{order.notes}</div>
            </>
          )}

          <div style={{ marginTop: 20, paddingTop: 10, borderTop: '1px solid #cbd5e1', fontSize: 10, color: '#64748b', textAlign: 'center', lineHeight: 1.6 }}>
            אנא הציגו אישור זה בעת האיסוף · תודה שבחרתם בקונדיטוריית מרטין
          </div>
        </div>
      </div>

      <style>{`
        #so-confirmation-print { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          .so-print-dialog { display: none !important; }
          #so-confirmation-print, #so-confirmation-print * { visibility: visible !important; }
          #so-confirmation-print {
            display: block !important;
            position: absolute !important; inset: 0 !important;
            background: white !important; color: #000 !important;
          }
          @page { size: A5; margin: 0; }
        }
      `}</style>
    </>
  )
}

function PrintRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13, padding: '4px 0', borderBottom: '1px dotted #e2e8f0' }}>
      <div style={{ minWidth: 110, color: '#64748b', fontWeight: 600 }}>{label}:</div>
      <div style={{ color: '#0f172a', fontWeight: strong ? 800 : 500 }}>{value}</div>
    </div>
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
function OrderForm({ branchId, branchName, branchColor, userId, onClose, onSaved }: {
  branchId: number; branchName: string; branchColor: string; userId: string | null
  onClose: () => void; onSaved: () => void
}) {
  const [customerName, setCustomerName] = useState('')
  const [orderNumberManual, setOrderNumberManual] = useState('')
  const [pickupDate, setPickupDate] = useState('')
  const [pickupTime, setPickupTime] = useState('')
  const [type, setTypeRaw] = useState<CakeType>('חלבי')
  const [baseSize, setBaseSizeRaw] = useState('')
  const [torteFlavor, setTorteFlavor] = useState('')
  const [creamBetween, setCreamBetween] = useState('')
  const [filling, setFilling] = useState('')
  const [presetCake, setPresetCake] = useState('')
  const [coating, setCoating] = useState('')
  const [crown, setCrown] = useState('')
  const [extras, setExtras] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPresetMode = baseSize === MEDIUM_ROUND && !!presetCake
  const creamOptions = CREAMS_BETWEEN[type]
  const fillingOptions = FILLINGS[type]
  const presetOptions = PRESET_CAKES[type]

  // Reset selections that are no longer valid when the type changes
  function setType(newType: CakeType) {
    setTypeRaw(newType)
    if (!CREAMS_BETWEEN[newType].includes(creamBetween)) setCreamBetween('')
    if (!FILLINGS[newType].includes(filling)) setFilling('')
    if (presetCake && !PRESET_CAKES[newType].includes(presetCake)) setPresetCake('')
  }

  // Clear the preset when a non-medium base size is chosen
  function setBaseSize(newSize: string) {
    setBaseSizeRaw(newSize)
    if (newSize !== MEDIUM_ROUND) setPresetCake('')
  }

  function toggleExtra(v: string) {
    setExtras(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  async function save() {
    setError(null)
    if (!customerName.trim()) return setError('שם לקוח חובה')
    if (!orderNumberManual.trim()) return setError('מספר הזמנה חובה')
    if (!pickupDate) return setError('תאריך איסוף חובה')
    if (!baseSize) return setError('גודל וצורת בסיס חובה')
    if (isPresetMode) {
      if (!presetCake) return setError('יש לבחור עוגה מוכנה')
    } else {
      if (baseSize === MEDIUM_ROUND) return setError('יש לבחור עוגה מוכנה')
      if (!torteFlavor) return setError('טעם טורט חובה')
      if (!creamBetween) return setError('קרם בין השכבות חובה')
      if (!filling) return setError('מילוי חובה')
    }
    if (!coating) return setError('ציפוי חובה')
    if (!crown) return setError('כתר עליון חובה')

    setSaving(true)

    const systemOrderNumber = generateOrderNumber(branchId)
    const manualNumber = orderNumberManual.trim()
    // When a preset is chosen the torte/cream/filling columns are NOT NULL, so
    // reuse the preset name to satisfy the constraint — displays key off preset_cake_name.
    const torteForSave = isPresetMode ? presetCake : torteFlavor
    const creamForSave = isPresetMode ? presetCake : creamBetween
    const fillingForSave = isPresetMode ? presetCake : filling
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
      torte_flavor: torteForSave,
      cream_between: creamForSave,
      filling: fillingForSave,
      preset_cake_name: isPresetMode ? presetCake : null,
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

    // Notify every factory + admin user about the new cake order
    const { data: recipients } = await supabase.from('app_users')
      .select('id')
      .in('role', ['factory', 'admin'])
    if (recipients && recipients.length > 0) {
      const pickupLabel = new Date(pickupDate).toLocaleDateString('he-IL')
      const message = `הזמנת עוגה חדשה מסניף ${branchName} — ${customerName}, איסוף ${pickupLabel}`
      const notifications = recipients.map((u: any) => ({
        user_id: u.id,
        order_id: inserted.id,
        message,
      }))
      const { error: notifErr } = await supabase.from('order_notifications').insert(notifications)
      if (notifErr) {
        // The order saved. Only the notifications failed — warn but don't block the user.
        console.warn('[BranchSpecialOrders] notifications insert failed:', notifErr)
      }
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
        <RadioGroup label="סוג *" value={type} onChange={(v) => setType(v as CakeType)} options={['חלבי', 'פרווה']} color={branchColor} />

        {/* Required cake fields */}
        <SelectGroup label="גודל וצורת בסיס *" value={baseSize} onChange={setBaseSize} options={BASE_SIZES} color={branchColor} />

        {/* Preset cake picker — only for 'עגולה בינונית' */}
        {baseSize === MEDIUM_ROUND && (
          <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3730a3', marginBottom: 6 }}>
              בחר עוגה מוכנה *
            </div>
            <select
              value={presetCake}
              onChange={e => setPresetCake(e.target.value)}
              style={{
                width: '100%', border: '1px solid #c7d2fe', borderRadius: 8,
                padding: '9px 10px', fontSize: 14, fontFamily: 'inherit', background: 'white', direction: 'rtl',
              }}
            >
              <option value="">— בחר —</option>
              {presetOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {presetCake && (
              <div style={{ fontSize: 12, color: '#4338ca', marginTop: 8 }}>
                שדות טעם טורט · קרם · מילוי אינם נדרשים — העוגה המוכנה מגדירה אותם.
              </div>
            )}
          </div>
        )}

        {!isPresetMode && (
          <>
            <SelectGroup label="טעם טורט *" value={torteFlavor} onChange={setTorteFlavor} options={TORTE_FLAVORS} color={branchColor} />
            <SelectGroup label="קרם בין השכבות *" value={creamBetween} onChange={setCreamBetween} options={creamOptions} color={branchColor} />
            <SelectGroup label="מילוי *" value={filling} onChange={setFilling} options={fillingOptions} color={branchColor} />
          </>
        )}

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
