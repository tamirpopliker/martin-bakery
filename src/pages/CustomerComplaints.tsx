import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Search, X, CheckCircle2, RotateCcw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { useAppUser, isRestrictedBranchUser, type AppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'
import PeriodPicker from '../components/PeriodPicker'

interface Props {
  onBack: () => void
}

type Status = 'open' | 'closed'
type SourceKind = 'branch' | 'factory' | 'hq' | 'admin'

interface Complaint {
  id: number
  received_date: string
  recipient_user_id: string | null
  recipient_name: string
  source_kind: SourceKind | null
  source_branch_id: number | null
  complainant_name: string
  complainant_phone: string | null
  complainant_email: string | null
  complainant_address: string | null
  product_name: string | null
  production_date: string | null
  expiry_date: string | null
  description: string
  response: string | null
  status: Status
  closed_at: string | null
  closed_by_user_id: string | null
  closed_by_name: string | null
  created_at: string
  updated_at: string
}

type StatusFilter = 'all' | Status

const STATUS_LABELS: Record<Status, { label: string; bg: string; color: string }> = {
  open:   { label: 'פתוח', bg: '#fef3c7', color: '#92400e' },
  closed: { label: 'סגור', bg: '#d1fae5', color: '#065f46' },
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const fmtDate = (s: string | null | undefined) => s ? new Date(s + 'T12:00:00').toLocaleDateString('he-IL') : ''

function inferSourceKind(appUser: AppUser): SourceKind {
  if (appUser.role === 'admin') return 'admin'
  if (appUser.role === 'factory') return 'factory'
  if (appUser.role === 'branch') return 'branch'
  return 'admin'
}

interface FormState {
  received_date: string
  complainant_name: string
  complainant_phone: string
  complainant_email: string
  complainant_address: string
  product_name: string
  production_date: string
  expiry_date: string
  description: string
  response: string
}

const emptyForm = (): FormState => ({
  received_date: todayISO(),
  complainant_name: '',
  complainant_phone: '',
  complainant_email: '',
  complainant_address: '',
  product_name: '',
  production_date: '',
  expiry_date: '',
  description: '',
  response: '',
})

const fromComplaint = (c: Complaint): FormState => ({
  received_date: c.received_date,
  complainant_name: c.complainant_name,
  complainant_phone: c.complainant_phone || '',
  complainant_email: c.complainant_email || '',
  complainant_address: c.complainant_address || '',
  product_name: c.product_name || '',
  production_date: c.production_date || '',
  expiry_date: c.expiry_date || '',
  description: c.description,
  response: c.response || '',
})

export default function CustomerComplaints({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { period, setPeriod, from, to } = usePeriod()

  const [rows, setRows] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Complaint | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const isAdmin = appUser?.role === 'admin'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('customer_complaints')
      .select('*')
      .gte('received_date', from)
      .lt('received_date', to)
      .order('received_date', { ascending: false })
      .order('id', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Failed to load complaints', error)
          setRows([])
        } else {
          setRows((data || []) as Complaint[])
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [from, to])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (!q) return true
      const hay = [r.complainant_name, r.product_name, r.complainant_phone, r.complainant_email, r.recipient_name]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, statusFilter, search])

  const counts = useMemo(() => ({
    open: rows.filter(r => r.status === 'open').length,
    closed: rows.filter(r => r.status === 'closed').length,
    total: rows.length,
  }), [rows])

  function openNewDialog() {
    if (!appUser) return
    setEditing(null)
    setForm(emptyForm())
    setFormError('')
    setModalOpen(true)
  }

  function openEditDialog(c: Complaint) {
    setEditing(c)
    setForm(fromComplaint(c))
    setFormError('')
    setModalOpen(true)
  }

  function closeDialog() {
    setModalOpen(false)
    setEditing(null)
    setForm(emptyForm())
    setFormError('')
  }

  async function reload() {
    const { data, error } = await supabase
      .from('customer_complaints')
      .select('*')
      .gte('received_date', from)
      .lt('received_date', to)
      .order('received_date', { ascending: false })
      .order('id', { ascending: false })
    if (!error) setRows((data || []) as Complaint[])
  }

  async function saveDialog() {
    if (!appUser) return
    if (!form.received_date) { setFormError('יש להזין תאריך קבלה'); return }
    if (!form.complainant_name.trim()) { setFormError('יש להזין שם מתלונן'); return }
    if (!form.description.trim()) { setFormError('יש להזין תיאור התלונה'); return }

    setSaving(true)
    setFormError('')
    const payload = {
      received_date: form.received_date,
      complainant_name: form.complainant_name.trim(),
      complainant_phone: form.complainant_phone.trim() || null,
      complainant_email: form.complainant_email.trim() || null,
      complainant_address: form.complainant_address.trim() || null,
      product_name: form.product_name.trim() || null,
      production_date: form.production_date || null,
      expiry_date: form.expiry_date || null,
      description: form.description.trim(),
      response: form.response.trim() || null,
    }

    if (editing) {
      const { error } = await supabase
        .from('customer_complaints')
        .update(payload)
        .eq('id', editing.id)
      if (error) {
        console.error(error)
        setFormError('שמירה נכשלה: ' + error.message)
        setSaving(false)
        return
      }
    } else {
      const sourceKind = inferSourceKind(appUser)
      const sourceBranchId = appUser.role === 'branch' ? appUser.branch_id : null
      const { error } = await supabase
        .from('customer_complaints')
        .insert({
          ...payload,
          recipient_user_id: appUser.id,
          recipient_name: appUser.name,
          source_kind: sourceKind,
          source_branch_id: sourceBranchId,
          status: 'open',
        })
      if (error) {
        console.error(error)
        setFormError('יצירה נכשלה: ' + error.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    closeDialog()
    await reload()
  }

  async function toggleStatus() {
    if (!editing || !appUser) return
    setSaving(true)
    setFormError('')
    const isClosing = editing.status === 'open'
    const update = isClosing
      ? { status: 'closed' as Status, closed_at: new Date().toISOString(), closed_by_user_id: appUser.id, closed_by_name: appUser.name }
      : { status: 'open' as Status,  closed_at: null, closed_by_user_id: null, closed_by_name: null }

    const { error } = await supabase
      .from('customer_complaints')
      .update(update)
      .eq('id', editing.id)
    if (error) {
      console.error(error)
      setFormError('עדכון סטטוס נכשל: ' + error.message)
      setSaving(false)
      return
    }
    setSaving(false)
    closeDialog()
    await reload()
  }

  async function deleteComplaint() {
    if (!editing || !isAdmin) return
    if (!window.confirm('למחוק את התלונה לצמיתות?')) return
    setSaving(true)
    const { error } = await supabase
      .from('customer_complaints')
      .delete()
      .eq('id', editing.id)
    if (error) {
      console.error(error)
      setFormError('מחיקה נכשלה: ' + error.message)
      setSaving(false)
      return
    }
    setSaving(false)
    closeDialog()
    await reload()
  }

  const restrictedHint = appUser && isRestrictedBranchUser(appUser)
    ? 'התלונה תירשם על שמך לסניף שלך'
    : null

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader
        title="תלונות לקוח"
        subtitle="טופס 0701 · איכות ובקרה"
        onBack={onBack}
        action={
          <button onClick={openNewDialog} style={{
            background: '#dc2626', color: 'white', border: 'none', borderRadius: 10,
            padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Plus size={16} /> תלונה חדשה
          </button>
        }
      />

      <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
        {/* Counters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <CounterBadge label="סה״כ"   value={counts.total}  color="#0f172a" bg="#f1f5f9" />
          <CounterBadge label="פתוחות" value={counts.open}   color="#92400e" bg="#fef3c7" />
          <CounterBadge label="סגורות" value={counts.closed} color="#065f46" bg="#d1fae5" />
          <div style={{ marginRight: 'auto' }}>
            <PeriodPicker period={period} onChange={setPeriod} />
          </div>
        </div>

        {/* Filters bar */}
        <div style={{
          background: 'white', borderRadius: 12, border: '1px solid #f1f5f9',
          padding: 14, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all','open','closed'] as StatusFilter[]).map(s => {
              const label = s === 'all' ? 'הכל' : STATUS_LABELS[s].label
              const active = statusFilter === s
              return (
                <button key={s} onClick={() => setStatusFilter(s)} style={{
                  background: active ? '#0f172a' : '#f8fafc', color: active ? 'white' : '#475569',
                  border: '1px solid ' + (active ? '#0f172a' : '#e2e8f0'),
                  borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>{label}</button>
              )
            })}
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש: שם מתלונן, מוצר, טלפון..."
              style={{
                width: '100%', padding: '8px 32px 8px 12px', borderRadius: 8,
                border: '1px solid #e2e8f0', fontSize: 13, background: '#f8fafc',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '50px 110px 1fr 1fr 1fr 100px',
            gap: 12, padding: '12px 16px', background: '#f8fafc',
            fontSize: 12, fontWeight: 700, color: '#64748b', borderBottom: '1px solid #f1f5f9',
          }}>
            <div>#</div>
            <div>תאריך</div>
            <div>שם המתלונן</div>
            <div>שם המוצר</div>
            <div>מקבל</div>
            <div>סטטוס</div>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
              אין תלונות לתקופה הזו
            </div>
          ) : filtered.map((c, idx) => {
            const st = STATUS_LABELS[c.status]
            return (
              <motion.button
                key={c.id}
                onClick={() => openEditDialog(c)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{
                  display: 'grid', gridTemplateColumns: '50px 110px 1fr 1fr 1fr 100px',
                  gap: 12, padding: '14px 16px', width: '100%',
                  background: 'white', border: 'none', borderBottom: '1px solid #f8fafc',
                  cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fafbfc')}
                onMouseLeave={e => (e.currentTarget.style.background = 'white')}
              >
                <div style={{ fontSize: 13, color: '#94a3b8' }}>{idx + 1}</div>
                <div style={{ fontSize: 13, color: '#475569' }}>{fmtDate(c.received_date)}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.complainant_name}</div>
                <div style={{ fontSize: 13, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.product_name || '—'}</div>
                <div style={{ fontSize: 13, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.recipient_name}</div>
                <div>
                  <span style={{
                    background: st.bg, color: st.color, fontSize: 12, fontWeight: 700,
                    padding: '3px 10px', borderRadius: 999,
                  }}>{st.label}</span>
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={closeDialog}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 16, width: '100%', maxWidth: 720,
            maxHeight: '90vh', overflowY: 'auto', direction: 'rtl',
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }}>
            {/* Header */}
            <div style={{
              padding: '20px 24px', borderBottom: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              position: 'sticky', top: 0, background: 'white', zIndex: 1,
            }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                  {editing ? `תלונה #${editing.id}` : 'תלונה חדשה'}
                </div>
                {editing && (
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    נוצרה: {fmtDate(editing.created_at.slice(0, 10))} · מקבל: {editing.recipient_name}
                    {editing.closed_at && ` · נסגרה: ${fmtDate(editing.closed_at.slice(0, 10))} ע״י ${editing.closed_by_name || ''}`}
                  </div>
                )}
              </div>
              <button onClick={closeDialog} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#94a3b8',
              }}><X size={20} /></button>
            </div>

            {/* Form */}
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {restrictedHint && !editing && (
                <div style={{ background: '#eff6ff', color: '#1e40af', fontSize: 12, padding: '8px 12px', borderRadius: 8 }}>
                  {restrictedHint}
                </div>
              )}

              <Row>
                <Field label="תאריך קבלת התלונה *">
                  <input type="date" value={form.received_date}
                    onChange={e => setForm(f => ({ ...f, received_date: e.target.value }))}
                    style={inputStyle} />
                </Field>
                <Field label="שם מתלונן *">
                  <input type="text" value={form.complainant_name}
                    onChange={e => setForm(f => ({ ...f, complainant_name: e.target.value }))}
                    style={inputStyle} />
                </Field>
              </Row>

              <Row>
                <Field label="טלפון">
                  <input type="tel" value={form.complainant_phone}
                    onChange={e => setForm(f => ({ ...f, complainant_phone: e.target.value }))}
                    style={inputStyle} />
                </Field>
                <Field label="מייל">
                  <input type="email" value={form.complainant_email}
                    onChange={e => setForm(f => ({ ...f, complainant_email: e.target.value }))}
                    style={inputStyle} />
                </Field>
              </Row>

              <Field label="כתובת">
                <input type="text" value={form.complainant_address}
                  onChange={e => setForm(f => ({ ...f, complainant_address: e.target.value }))}
                  style={inputStyle} />
              </Field>

              <Row>
                <Field label="שם המוצר">
                  <input type="text" value={form.product_name}
                    onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
                    style={inputStyle} />
                </Field>
                <Field label="תאריך ייצור">
                  <input type="date" value={form.production_date}
                    onChange={e => setForm(f => ({ ...f, production_date: e.target.value }))}
                    style={inputStyle} />
                </Field>
                <Field label="תאריך פג תוקף">
                  <input type="date" value={form.expiry_date}
                    onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))}
                    style={inputStyle} />
                </Field>
              </Row>

              <Field label="תיאור התלונה *">
                <textarea value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={4} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              </Field>

              <Field label="מענה שניתן ללקוח">
                <textarea value={form.response}
                  onChange={e => setForm(f => ({ ...f, response: e.target.value }))}
                  rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              </Field>

              {formError && (
                <div style={{ background: '#fef2f2', color: '#991b1b', fontSize: 13, padding: '10px 14px', borderRadius: 8, border: '1px solid #fecaca' }}>
                  {formError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '14px 24px', borderTop: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
              position: 'sticky', bottom: 0, background: 'white',
            }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {editing && (
                  <button onClick={toggleStatus} disabled={saving} style={{
                    background: editing.status === 'open' ? '#10b981' : '#f59e0b',
                    color: 'white', border: 'none', borderRadius: 8,
                    padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, opacity: saving ? 0.6 : 1,
                  }}>
                    {editing.status === 'open' ? <><CheckCircle2 size={16} /> סמן כסגור</> : <><RotateCcw size={16} /> פתח מחדש</>}
                  </button>
                )}
                {editing && isAdmin && (
                  <button onClick={deleteComplaint} disabled={saving} style={{
                    background: 'white', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8,
                    padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, opacity: saving ? 0.6 : 1,
                  }}>
                    <Trash2 size={14} /> מחק
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={closeDialog} disabled={saving} style={{
                  background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8,
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>ביטול</button>
                <button onClick={saveDialog} disabled={saving} style={{
                  background: '#0f172a', color: 'white', border: 'none', borderRadius: 8,
                  padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}>{saving ? 'שומר...' : (editing ? 'שמור שינויים' : 'שמור תלונה')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── small helpers ─────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: '1px solid #e2e8f0', fontSize: 14, background: 'white',
  fontFamily: 'inherit', color: '#0f172a',
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{label}</label>
      {children}
    </div>
  )
}

function CounterBadge({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{
      background: bg, color, padding: '8px 14px', borderRadius: 10,
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
    }}>
      <span>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800 }}>{value}</span>
    </div>
  )
}
