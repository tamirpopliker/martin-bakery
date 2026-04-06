import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchBranchExpensesTrend, BranchExpensesTrend } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Plus, Pencil, Trash2, Search, X, Factory, AlertTriangle, Info } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
  onNavigate?: (page: string) => void
}

type ExpenseType = 'suppliers' | 'repairs' | 'infrastructure' | 'deliveries' | 'other'

interface Entry {
  id: number
  date: string
  expense_type: ExpenseType
  supplier: string
  amount: number
  doc_number: string | null
  notes: string | null
  from_factory: boolean
}

interface Supplier { id: number; name: string }

const TYPE_CONFIG: Record<ExpenseType, { label: string; color: string; bg: string }> = {
  suppliers:      { label: 'ספקים / מלאי',  color: '#818cf8', bg: '#e0e7ff' },
  repairs:        { label: 'תיקונים',         color: '#f97316', bg: '#fff7ed' },
  infrastructure: { label: 'תשתיות',          color: '#c084fc', bg: '#f3e8ff' },
  deliveries:     { label: 'משלוחים',         color: '#34d399', bg: '#d1fae5' },
  other:          { label: 'אחר',             color: '#64748b', bg: '#f1f5f9' },
}

const FACTORY_KEYWORDS = ['מפעל', 'פנימי']

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

function AutocompleteInput({ value, onChange, options, placeholder, color }: {
  value: string; onChange: (v: string) => void
  options: string[]; placeholder: string; color: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()) && o !== value)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input type="text" value={value} placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' }} />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 50, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginTop: '4px', overflow: 'hidden' }}>
          {filtered.slice(0, 6).map(o => (
            <div key={o} onMouseDown={() => { onChange(o); setOpen(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '14px', color: '#374151', borderBottom: '1px solid #f1f5f9' }}
              onMouseEnter={e => (e.currentTarget.style.background = color + '15')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}>{o}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BranchExpenses({ branchId, branchName, branchColor, onBack, onNavigate }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [entries, setEntries]         = useState<Entry[]>([])
  const [suppliers, setSuppliers]     = useState<Supplier[]>([])
  const [branchNames, setBranchNames] = useState<string[]>([])
  const [typeFilter, setTypeFilter]   = useState<ExpenseType | 'all'>('all')
  const [searchFilter, setSearchFilter] = useState('')
  const [editId, setEditId]           = useState<number | null>(null)
  const [editData, setEditData]       = useState<Partial<Entry>>({})
  const [loading, setLoading]         = useState(false)
  const [showFactoryWarning, setShowFactoryWarning] = useState(false)

  // טופס — supplier אינו חובה
  const [date, setDate]       = useState(new Date().toISOString().split('T')[0])
  const [expType, setExpType] = useState<ExpenseType>('suppliers')
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount]   = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [notes, setNotes]     = useState('')
  const [trendData, setTrendData] = useState<BranchExpensesTrend[]>([])

  async function fetchEntries() {
    const { data } = await supabase.from('branch_expenses').select('id, date, expense_type, supplier, amount, doc_number, notes, from_factory')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  async function fetchSuppliers() {
    const { data } = await supabase.from('suppliers').select('id,name').order('name')
    if (data) setSuppliers(data)
  }

  async function fetchBranchNames() {
    const { data } = await supabase.from('branches').select('name')
    if (data) setBranchNames(data.map((b: { name: string }) => b.name))
  }

  useEffect(() => {
    fetchEntries(); fetchSuppliers(); fetchBranchNames()
    fetchBranchExpensesTrend(branchId, from.slice(0, 7)).then(setTrendData)
  }, [from, to, branchId])

  const supplierNames = suppliers.map(s => s.name)

  function looksLikeFactorySupplier(name: string): boolean {
    const lower = name.trim().toLowerCase()
    if (FACTORY_KEYWORDS.some(kw => lower.includes(kw))) return true
    if (branchNames.some(bn => lower.includes(bn.toLowerCase()))) return true
    return false
  }

  // ─── כפתור פעיל כל עוד יש סכום ותאריך ──────────────────────────────────
  const canAdd = !loading && !!amount && parseFloat(amount) > 0 && !!date

  function handleAddEntry() {
    if (!canAdd) return
    if (expType === 'suppliers' && supplier && looksLikeFactorySupplier(supplier)) {
      setShowFactoryWarning(true)
      return
    }
    addEntry()
  }

  async function addEntry() {
    if (!canAdd) return
    setLoading(true)
    await supabase.from('branch_expenses').insert({
      branch_id: branchId, date, expense_type: expType,
      supplier: supplier || '—',
      amount: parseFloat(amount),
      doc_number: docNumber || null,
      notes: notes || null,
      from_factory: false
    })
    setAmount(''); setDocNumber(''); setNotes('')
    await fetchEntries()
    setLoading(false)
  }

  async function deleteEntry(id: number) {
    if (!confirm('למחוק הוצאה זו?')) return
    await supabase.from('branch_expenses').delete().eq('id', id)
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    await supabase.from('branch_expenses').update(editData).eq('id', id)
    setEditId(null); await fetchEntries()
  }

  const filtered = entries.filter(e => {
    if (typeFilter !== 'all' && e.expense_type !== typeFilter) return false
    if (searchFilter && !e.supplier.toLowerCase().includes(searchFilter.toLowerCase())) return false
    return true
  })

  // Split supplier entries into internal (factory) and external
  const showSuppliersSplit = typeFilter === 'suppliers' || typeFilter === 'all'
  const internalEntries = filtered.filter(e => e.expense_type === 'suppliers' && e.from_factory === true)
  const externalAndOtherEntries = filtered.filter(e => !(e.expense_type === 'suppliers' && e.from_factory === true))
  const internalTotal = internalEntries.reduce((s, e) => s + Number(e.amount), 0)

  const total    = filtered.reduce((s, e) => s + Number(e.amount), 0)
  const totalAll = entries.reduce((s, e) => s + Number(e.amount), 0)

  const byType = Object.entries(TYPE_CONFIG).map(([key, cfg]) => ({
    key: key as ExpenseType, ...cfg,
    total: entries.filter(e => e.expense_type === key).reduce((s, e) => s + Number(e.amount), 0)
  })).filter(t => t.total > 0)

  const bySupplier = Object.values(
    filtered.reduce((acc: Record<string, { name: string; total: number; count: number }>, e) => {
      if (!acc[e.supplier]) acc[e.supplier] = { name: e.supplier, total: 0, count: 0 }
      acc[e.supplier].total += Number(e.amount); acc[e.supplier].count++
      return acc
    }, {})
  ).sort((a, b) => b.total - a.total).slice(0, 5)

  const S = {
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  const gridCols = '100px 90px 1fr 100px 130px 36px 36px'

  function renderEntryRow(entry: Entry, i: number, list: Entry[], isInternal: boolean) {
    const tc = TYPE_CONFIG[entry.expense_type]
    return (
      <div key={entry.id}
        onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
        onMouseLeave={e => (e.currentTarget.style.background = 'white')}
        style={{
        display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center',
        padding: '12px 20px',
        borderBottom: '1px solid #f8fafc',
        borderRight: isInternal ? '3px solid #a78bfa' : 'none',
      }}>
        {editId === entry.id && !isInternal ? (
          <>
            <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
            <select value={editData.expense_type || ''} onChange={e => setEditData({ ...editData, expense_type: e.target.value as ExpenseType })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 6px', fontSize: '11px', fontFamily: 'inherit' }}>
              {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <AutocompleteInput value={editData.supplier || ''} onChange={v => setEditData({ ...editData, supplier: v })} options={supplierNames} placeholder="ספק" color={branchColor} />
            <input type="text" value={editData.doc_number || ''} onChange={e => setEditData({ ...editData, doc_number: e.target.value })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
            <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
            <button onClick={() => saveEdit(entry.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
            <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
            <span style={{ fontSize: '11px', background: tc.bg, color: tc.color, padding: '2px 7px', borderRadius: '20px', fontWeight: '600' }}>{tc.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: '600', color: '#374151', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {entry.supplier}
                  {isInternal && (
                    <span style={{ fontSize: '10px', background: '#ede9fe', color: '#7c3aed', padding: '1px 8px', borderRadius: '20px', fontWeight: '700', whiteSpace: 'nowrap' }}>פנימי</span>
                  )}
                </div>
                {isInternal && (
                  <div style={{ fontSize: '10px', color: '#a78bfa', fontStyle: 'italic' }}>נוצר אוטומטית מהזמנה מאושרת</div>
                )}
                {entry.notes && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{entry.notes}</div>}
              </div>
            </div>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>{entry.doc_number || '—'}</span>
            <span style={{ fontWeight: '800', color: '#fb7185', fontSize: '15px' }}>₪{Number(entry.amount).toLocaleString()}</span>
            {isInternal ? (
              <>
                <span />
                <span />
              </>
            ) : (
              <>
                <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#fb7185" /></button>
              </>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      {/* Header */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>הוצאות</h1>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{branchName}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' as const }}>
            <PeriodPicker period={period} onChange={setPeriod} />
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, padding: '8px 18px', textAlign: 'center' as const }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#fb7185' }}>₪{totalAll.toLocaleString()}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>סה"כ</div>
            </div>
            <button onClick={onBack} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px', fontSize: 13, color: '#64748b', cursor: 'pointer' }}>
              <ArrowRight size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
              חזרה
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px 24px', maxWidth: '1000px', margin: '0 auto' }}>

        {/* סיכום לפי סוג — clean gray pills */}
        {byType.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' as const, marginBottom: '20px' }}>
            {byType.map(t => (
              <button key={t.key} onClick={() => setTypeFilter(typeFilter === t.key ? 'all' : t.key)}
                style={{ background: typeFilter === t.key ? '#f1f5f9' : 'white', border: '1px solid #e2e8f0', borderRadius: 20, padding: '8px 16px', cursor: 'pointer', textAlign: 'right' as const, transition: 'all 0.15s' }}>
                <div style={{ fontSize: '16px', fontWeight: '700', color: typeFilter === t.key ? '#0f172a' : '#64748b' }}>₪{t.total.toLocaleString()}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{t.label}</div>
              </button>
            ))}
          </div>
        )}

        {/* Factory warning dialog */}
        {showFactoryWarning && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
            <div style={{ maxWidth: '440px', width: '90%', background: 'white', borderRadius: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.15)', padding: '24px', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                  <div style={{ background: '#fef3c7', borderRadius: '50%', padding: '12px' }}>
                    <AlertTriangle size={28} color="#f59e0b" />
                  </div>
                </div>
                <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: '700', color: '#374151' }}>
                  האם זו רכישה מהמפעל הפנימי?
                </h3>
                <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#64748b', lineHeight: '1.6' }}>
                  אם כן — אשר את ההזמנה בדף ההזמנות במקום להזין ידנית.
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                  <button onClick={() => { setShowFactoryWarning(false); onBack() }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e2e8f0', background: 'none', borderRadius: 8, padding: '8px 18px', fontSize: '14px', fontWeight: '700', color: '#7c3aed', cursor: 'pointer' }}>
                    <Factory size={16} />
                    כן, עבור להזמנות
                  </button>
                  <button onClick={() => { setShowFactoryWarning(false); addEntry() }}
                    style={{ background: '#64748b', color: 'white', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                    לא, ספק חיצוני
                  </button>
                </div>
            </div>
          </div>
        )}

        {/* Info banner — kept as-is per instructions */}
        <div className="bg-indigo-600 rounded-xl p-4 mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💡</span>
            <div>
              <p className="text-white font-bold text-base">הוצאות מהמפעל — שים לב</p>
              <p className="text-indigo-100 text-sm">רכישות מהמפעל מתעדכנות אוטומטית דרך מסך ההזמנות. אין צורך להזין אותן כאן ידנית.</p>
            </div>
          </div>
          <button
            onClick={() => onNavigate ? onNavigate('orders') : onBack()}
            className="bg-white text-indigo-700 font-bold px-4 py-2 rounded-lg text-sm whitespace-nowrap shrink-0"
          >
            מעבר להזמנות ←
          </button>
        </div>

        {/* טופס הוספה */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, padding: '20px', marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת הוצאה</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '12px', marginBottom: '14px' }}>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>סוג הוצאה</label>
              <select value={expType} onChange={e => setExpType(e.target.value as ExpenseType)}
                style={{ ...S.input, background: 'white' }}>
                {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
              <label style={S.label}>ספק <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <AutocompleteInput value={supplier} onChange={setSupplier} options={supplierNames} placeholder="שם ספק..." color={branchColor} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>סכום ללא מע״מ (₪) *</label>
              <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddEntry()}
                style={{ ...S.input, textAlign: 'right' as const, borderColor: amount ? '#e2e8f0' : '#fca5a5' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>מספר מסמך <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <input type="text" placeholder="מס׳ חשבונית" value={docNumber} onChange={e => setDocNumber(e.target.value)} style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const }}>
              <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
              <input type="text" placeholder="הערה..." value={notes} onChange={e => setNotes(e.target.value)} style={S.input} />
            </div>
          </div>

          <button onClick={handleAddEntry} disabled={!canAdd}
            style={{ background: canAdd ? '#6366f1' : '#e2e8f0', color: canAdd ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: canAdd ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} />הוסף הוצאה
          </button>
        </div>
        </motion.div>

        {/* פילטרים — clean gray pills */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
            <button onClick={() => setTypeFilter('all')} style={{ background: typeFilter === 'all' ? '#f1f5f9' : 'white', color: typeFilter === 'all' ? '#0f172a' : '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 20, padding: '6px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>הכל</button>
            {Object.entries(TYPE_CONFIG).map(([k, v]) => (
              <button key={k} onClick={() => setTypeFilter(k as ExpenseType)}
                style={{ background: typeFilter === k ? '#f1f5f9' : 'white', color: typeFilter === k ? '#0f172a' : '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 20, padding: '6px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                {v.label}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
            <Search size={15} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input type="text" placeholder="חפש ספק..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
              style={{ ...S.input, paddingRight: '36px' }} />
            {searchFilter && <button onClick={() => setSearchFilter('')} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={14} color="#94a3b8" /></button>}
          </div>
        </div>

        {/* סיכום ספקים */}
        {bySupplier.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '14px' }}>
            {bySupplier.map((s) => (
              <div key={s.name} style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '6px 12px', fontSize: '12px' }}>
                <span style={{ fontWeight: '600', color: '#374151' }}>{s.name}</span>
                <span style={{ color: '#fb7185', fontWeight: '700', marginRight: '6px' }}>₪{s.total.toLocaleString()}</span>
                <span style={{ color: '#94a3b8' }}>({s.count})</span>
              </div>
            ))}
          </div>
        )}

        {/* טבלה — internal factory section */}
        {showSuppliersSplit && internalEntries.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible" style={{ marginBottom: '16px' }}>
          <div className="table-scroll">
          <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, borderRight: '3px solid #a78bfa', overflow: 'hidden' }}>
              {/* Section header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Factory size={16} color="#7c3aed" />
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#7c3aed' }}>רכישות מהמפעל</span>
                  <span style={{ fontSize: '11px', background: '#ede9fe', color: '#7c3aed', padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>{internalEntries.length} רשומות</span>
                </div>
                <span style={{ fontSize: '16px', fontWeight: '700', color: '#7c3aed' }}>סה"כ רכישות מפעל: ₪{internalTotal.toLocaleString()}</span>
              </div>

              {/* Column headers */}
              <div style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '10px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
                <span>תאריך</span><span>סוג</span><span>ספק</span><span>מסמך</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
              </div>

              {internalEntries.map((entry, i) => renderEntryRow(entry, i, internalEntries, true))}
          </div>
          </div>
          </motion.div>
        )}

        {/* טבלה — external / other entries */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div className="table-scroll">
        <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
          {/* Section header when split is active */}
          {showSuppliersSplit && internalEntries.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>ספקים חיצוניים והוצאות נוספות</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '10px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
            <span>תאריך</span><span>סוג</span><span>ספק</span><span>מסמך</span><span style={{ textAlign: 'left' }}>סכום</span><span /><span />
          </div>

          {externalAndOtherEntries.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
              {filtered.length === 0 ? 'אין הוצאות לתקופה זו' : 'אין הוצאות חיצוניות לתקופה זו'}
            </div>
          ) : externalAndOtherEntries.map((entry, i) => renderEntryRow(entry, i, externalAndOtherEntries, false))}

          {filtered.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>סה"כ — {filtered.length} רשומות</span>
              <span style={{ fontSize: '20px', fontWeight: '700', color: '#fb7185' }}>₪{total.toLocaleString()}</span>
            </div>
          )}
        </div>
        </div>
        </motion.div>

        {/* מגמת 6 חודשים */}
        {trendData.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, padding: '20px', marginTop: 16 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>מגמת 6 חודשים — הוצאות</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis yAxisId="amount" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => '₪' + (v / 1000).toFixed(0) + 'K'} />
                  <YAxis yAxisId="pct" orientation="left" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v + '%'} />
                  <Tooltip formatter={(value: number, name: string) => name === '% מהכנסות' ? value + '%' : '₪' + Math.round(value).toLocaleString()} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line yAxisId="amount" type="monotone" dataKey="supplier" name="ספקים" stroke="#818cf8" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="repair" name="תיקונים" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="infrastructure" name="תשתיות" stroke="#c084fc" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="delivery" name="משלוחים" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="total" name="סה״כ" stroke="#fb7185" strokeWidth={2.5} dot={{ r: 3 }} />
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
