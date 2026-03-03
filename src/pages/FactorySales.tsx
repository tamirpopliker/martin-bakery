import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Pencil, Trash2, ChevronDown, ChevronUp, Search, X } from 'lucide-react'

// ─── טיפוסים ───────────────────────────────────────────────────────────────
type Department = 'creams' | 'dough' | 'packaging'

interface Props {
  department: Department
  onBack: () => void
}

interface Entry {
  id: number
  date: string
  customer: string
  amount: number
  doc_number: string
  notes: string
}

interface DayGroup {
  date: string
  entries: Entry[]
  total: number
}

// ─── קונפיגורציה לפי מחלקה ─────────────────────────────────────────────────
const DEPT_CONFIG = {
  creams:    { label: 'קרמים',  color: '#3b82f6', bg: '#dbeafe' },
  dough:     { label: 'בצקים',  color: '#8b5cf6', bg: '#ede9fe' },
  packaging: { label: 'אריזה',  color: '#0ea5e9', bg: '#e0f2fe' },
}

function hebrewDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('he-IL', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}

// ─── Autocomplete ────────────────────────────────────────────────────────────
function AutocompleteInput({
  value, onChange, suggestions, placeholder, color
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder: string
  color: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = suggestions.filter(s =>
    s.toLowerCase().includes(value.toLowerCase()) && s !== value
  )

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={{
          border: '1.5px solid #e2e8f0', borderRadius: '10px',
          padding: '10px 14px', fontSize: '14px', outline: 'none',
          fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const,
          textAlign: 'right'
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 50,
          background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginTop: '4px', overflow: 'hidden'
        }}>
          {filtered.slice(0, 6).map(s => (
            <div
              key={s}
              onMouseDown={() => { onChange(s); setOpen(false) }}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: '14px',
                color: '#374151', borderBottom: '1px solid #f1f5f9'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = color + '15')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── קומפוננטה ראשית ────────────────────────────────────────────────────────
export default function FactorySales({ department, onBack }: Props) {
  const cfg = DEPT_CONFIG[department]

  const [entries, setEntries]         = useState<Entry[]>([])
  const [allCustomers, setAllCustomers] = useState<string[]>([])
  const [date, setDate]               = useState(new Date().toISOString().split('T')[0])
  const [customer, setCustomer]       = useState('')
  const [amount, setAmount]           = useState('')
  const [docNumber, setDocNumber]     = useState('')
  const [notes, setNotes]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [customerFilter, setCustomerFilter] = useState('')
  const [expandedDays, setExpandedDays]     = useState<Set<string>>(new Set())
  const [editId, setEditId]           = useState<number | null>(null)
  const [editData, setEditData]       = useState<Partial<Entry>>({})

  // ─── שליפה ──────────────────────────────────────────────────────────────
  async function fetchEntries() {
    const { data } = await supabase
      .from('factory_sales')
      .select('*')
      .eq('department', department)
      .gte('date', monthFilter + '-01')
      .lte('date', monthFilter + '-31')
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  // שליפת כל הלקוחות לכל הזמנים (להשלמה אוטומטית)
  async function fetchAllCustomers() {
    const { data } = await supabase
      .from('factory_sales')
      .select('customer')
      .eq('department', department)
    if (data) {
      const unique = [...new Set(data.map(r => r.customer).filter(Boolean))] as string[]
      setAllCustomers(unique.sort())
    }
  }

  useEffect(() => {
    fetchEntries()
    fetchAllCustomers()
  }, [monthFilter, department])

  // ─── הוספה ──────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!amount || !date || !customer) return
    setLoading(true)
    await supabase.from('factory_sales').insert({
      department, date, customer,
      amount: parseFloat(amount),
      doc_number: docNumber,
      notes
    })
    // עדכון רשימת לקוחות אם חדש
    if (!allCustomers.includes(customer)) {
      setAllCustomers(prev => [...prev, customer].sort())
    }
    setAmount(''); setDocNumber(''); setNotes('')
    await fetchEntries()
    setLoading(false)
  }

  // ─── מחיקה ──────────────────────────────────────────────────────────────
  async function handleDelete(id: number) {
    if (!confirm('למחוק רשומה זו?')) return
    await supabase.from('factory_sales').delete().eq('id', id)
    await fetchEntries()
  }

  // ─── עריכה ──────────────────────────────────────────────────────────────
  async function handleEdit(id: number) {
    await supabase.from('factory_sales').update(editData).eq('id', id)
    setEditId(null)
    await fetchEntries()
  }

  // ─── קיבוץ לפי יום ──────────────────────────────────────────────────────
  const filtered = customerFilter
    ? entries.filter(e => e.customer.toLowerCase().includes(customerFilter.toLowerCase()))
    : entries

  const groups: DayGroup[] = Object.values(
    filtered.reduce((acc, e) => {
      if (!acc[e.date]) acc[e.date] = { date: e.date, entries: [], total: 0 }
      acc[e.date].entries.push(e)
      acc[e.date].total += Number(e.amount)
      return acc
    }, {} as Record<string, DayGroup>)
  ).sort((a, b) => b.date.localeCompare(a.date))

  const grandTotal = filtered.reduce((s, e) => s + Number(e.amount), 0)

  function toggleDay(date: string) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    })
  }

  // ─── סגנונות ────────────────────────────────────────────────────────────
  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={S.page}>

      {/* ─── כותרת ─────────────────────────────────────────────── */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
        </button>
        <div style={{ width: '40px', height: '40px', background: cfg.bg, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '20px' }}>🧾</span>
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>מכירות — {cfg.label}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>תעודות מכירה ללקוחות, ללא מע״מ</p>
        </div>
        <div style={{ marginRight: 'auto', background: cfg.bg, border: `1px solid ${cfg.color}33`, borderRadius: '10px', padding: '8px 18px' }}>
          <span style={{ fontSize: '18px', fontWeight: '800', color: cfg.color }}>
            ₪{grandTotal.toLocaleString()}
          </span>
          <span style={{ fontSize: '12px', color: '#64748b', marginRight: '6px' }}>סה"כ החודש</span>
        </div>
      </div>

      <div style={{ padding: '28px 32px', maxWidth: '960px', margin: '0 auto' }}>

        {/* ─── טופס הזנה ─────────────────────────────────────────── */}
        <div style={{ ...S.card, marginBottom: '20px' }}>
          <h2 style={{ margin: '0 0 18px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת מכירה</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '12px', marginBottom: '14px' }}>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>שם לקוח</label>
              <AutocompleteInput
                value={customer}
                onChange={setCustomer}
                suggestions={allCustomers}
                placeholder="בחר או הקלד לקוח..."
                color={cfg.color}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>סכום ללא מע״מ (₪)</label>
              <input
                type="number" placeholder="0" value={amount}
                onChange={e => setAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                style={{ ...S.input, textAlign: 'right' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>מספר תעודה <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופציונלי)</span></label>
              <input type="text" placeholder="מס׳ תעודה" value={docNumber}
                onChange={e => setDocNumber(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופציונלי)</span></label>
              <input type="text" placeholder="הערה..." value={notes}
                onChange={e => setNotes(e.target.value)} style={S.input} />
            </div>

          </div>
          <button
            onClick={handleAdd}
            disabled={loading || !amount || !customer}
            style={{
              background: loading || !amount || !customer ? '#e2e8f0' : cfg.color,
              color: loading || !amount || !customer ? '#94a3b8' : 'white',
              border: 'none', borderRadius: '10px', padding: '10px 28px',
              fontSize: '15px', fontWeight: '700', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}
          >
            <Plus size={18} />הוסף מכירה
          </button>
        </div>

        {/* ─── פילטרים ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
          <input
            type="month" value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', background: 'white', fontFamily: 'inherit' }}
          />
          <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
            <Search size={15} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="סנן לפי לקוח..."
              value={customerFilter}
              onChange={e => setCustomerFilter(e.target.value)}
              style={{ ...S.input, paddingRight: '36px' }}
            />
            {customerFilter && (
              <button
                onClick={() => setCustomerFilter('')}
                style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
              >
                <X size={14} color="#94a3b8" />
              </button>
            )}
          </div>
        </div>

        {/* ─── קבוצות לפי יום ────────────────────────────────────── */}
        {groups.length === 0 ? (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px', color: '#94a3b8' }}>אין מכירות לתקופה זו</div>
        ) : groups.map(group => {
          const isOpen = expandedDays.has(group.date)
          return (
            <div key={group.date} style={{ ...S.card, marginBottom: '12px', padding: '0', overflow: 'hidden' }}>

              {/* שורת יום — לחיצה לפתיחה */}
              <div
                onClick={() => toggleDay(group.date)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '16px 20px', cursor: 'pointer',
                  background: isOpen ? cfg.bg : 'white',
                  transition: 'background 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {isOpen ? <ChevronUp size={18} color={cfg.color} /> : <ChevronDown size={18} color="#94a3b8" />}
                  <span style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>
                    {hebrewDate(group.date)}
                  </span>
                  <span style={{
                    background: cfg.color + '20', color: cfg.color,
                    borderRadius: '20px', padding: '2px 10px',
                    fontSize: '12px', fontWeight: '600'
                  }}>
                    {group.entries.length} {group.entries.length === 1 ? 'מכירה' : 'מכירות'}
                  </span>
                </div>
                <span style={{ fontSize: '18px', fontWeight: '800', color: cfg.color }}>
                  ₪{group.total.toLocaleString()}
                </span>
              </div>

              {/* פירוט ─ נפתח בלחיצה */}
              {isOpen && (
                <div>
                  {/* כותרת עמודות */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 100px 110px 36px 36px',
                    padding: '8px 20px', background: '#f8fafc',
                    borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0',
                    fontSize: '11px', fontWeight: '700', color: '#64748b'
                  }}>
                    <span>לקוח</span><span>תעודה</span><span style={{ textAlign: 'left' }}>סכום</span>
                    <span /><span />
                  </div>

                  {group.entries.map((entry, i) => (
                    <div key={entry.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 100px 110px 36px 36px',
                      alignItems: 'center', padding: '12px 20px',
                      borderBottom: i < group.entries.length - 1 ? '1px solid #f1f5f9' : 'none',
                      background: i % 2 === 0 ? 'white' : '#fafafa'
                    }}>
                      {editId === entry.id ? (
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '4px' }}>
                            <AutocompleteInput value={editData.customer || ''} onChange={v => setEditData({ ...editData, customer: v })} suggestions={allCustomers} placeholder="לקוח" color={cfg.color} />
                            <input type="text" value={editData.notes || ''} onChange={e => setEditData({ ...editData, notes: e.target.value })} placeholder="הערה" style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '12px', fontFamily: 'inherit' }} />
                          </div>
                          <input type="text" value={editData.doc_number || ''} onChange={e => setEditData({ ...editData, doc_number: e.target.value })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} />
                          <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} />
                          <button onClick={() => handleEdit(entry.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                          <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                        </>
                      ) : (
                        <>
                          <div>
                            <div style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{entry.customer}</div>
                            {entry.notes && <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{entry.notes}</div>}
                          </div>
                          <span style={{ fontSize: '13px', color: '#94a3b8' }}>{entry.doc_number || '—'}</span>
                          <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '15px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                          <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Pencil size={14} color="#94a3b8" />
                          </button>
                          <button onClick={() => handleDelete(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Trash2 size={14} color="#ef4444" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* ─── שורת סה"כ ─────────────────────────────────────────── */}
        {groups.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: cfg.bg, border: `2px solid ${cfg.color}33`,
            borderRadius: '14px', padding: '16px 24px', marginTop: '4px'
          }}>
            <span style={{ fontSize: '15px', fontWeight: '700', color: '#374151' }}>
              סה"כ — {filtered.length} מכירות ב-{groups.length} ימים
            </span>
            <span style={{ fontSize: '22px', fontWeight: '800', color: cfg.color }}>
              ₪{grandTotal.toLocaleString()}
            </span>
          </div>
        )}

      </div>
    </div>
  )
}