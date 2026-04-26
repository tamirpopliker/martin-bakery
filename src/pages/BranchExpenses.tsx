import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase, fetchBranchExpensesTrend } from '../lib/supabase'
import type { BranchExpensesTrend } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import PageHeader from '../components/PageHeader'
import { Plus, Pencil, Trash2, Search, X, Factory, AlertTriangle, Info } from 'lucide-react'
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

interface Supplier {
  id: number
  name: string
  scope?: 'factory' | 'branch' | 'shared'
  branch_id?: number | null
  category?: string | null
}

// שורה אחת בטופס הזנה רב-שורתית (לא נשמר ל-DB — רק מצב מקומי)
interface ExpenseRow {
  id: string
  date: string
  expenseType: ExpenseType
  supplier: string
  amount: string  // ללא מע"מ
  docNumber: string
  notes: string
  error?: string  // הודעת שגיאה ספציפית לשורה אם השמירה נכשלה
}

type FormMessage = { type: 'success' | 'error' | 'warn'; text: string }

function newEmptyRow(): ExpenseRow {
  return {
    id: (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
      ? (crypto as any).randomUUID()
      : 'r-' + Math.random().toString(36).slice(2),
    date: new Date().toISOString().split('T')[0],
    expenseType: 'suppliers',
    supplier: '',
    amount: '',
    docNumber: '',
    notes: '',
  }
}

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

export default function BranchExpenses({ branchId, branchName, branchColor, onBack, onNavigate = () => {} }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [entries, setEntries]         = useState<Entry[]>([])
  const [suppliers, setSuppliers]     = useState<Supplier[]>([])
  const [branchNames, setBranchNames] = useState<string[]>([])
  const [typeFilter, setTypeFilter]   = useState<ExpenseType | 'all'>('all')
  const [searchFilter, setSearchFilter] = useState('')
  const [editId, setEditId]           = useState<number | null>(null)
  const [editData, setEditData]       = useState<Partial<Entry>>({})

  // טופס רב-שורתי
  const [rows, setRows] = useState<ExpenseRow[]>([newEmptyRow()])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<FormMessage | null>(null)
  // מערך השורות שגרם לאזהרת "מפעל" — ה-dialog מציג אותן ומבקש אישור
  const [factoryWarningRows, setFactoryWarningRows] = useState<ExpenseRow[] | null>(null)

  const [trendData, setTrendData] = useState<BranchExpensesTrend[]>([])

  async function fetchEntries() {
    const { data } = await supabase.from('branch_expenses').select('id, date, expense_type, supplier, amount, doc_number, notes, from_factory')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  async function fetchSuppliers() {
    const { data, error } = await supabase
      .from('suppliers_new')
      .select('id, name, scope, branch_id, category')
      .or(`scope.eq.shared,and(scope.eq.branch,branch_id.eq.${branchId})`)
      .eq('active', true)
      .order('name')
    if (error) { console.error('[BranchExpenses fetchSuppliers] error:', error); return }
    if (data) setSuppliers(data as Supplier[])
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

  // ─── עזרי טופס רב-שורתי ─────────────────────────────────────────────────
  function addRow() {
    setRows(prev => [...prev, newEmptyRow()])
  }

  function removeRow(id: string) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)
  }

  function updateRow<K extends keyof ExpenseRow>(id: string, field: K, value: ExpenseRow[K]) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value, error: undefined } : r))
  }

  // ─── שמירה ב-batch ───────────────────────────────────────────────────────
  function handleSaveAll() {
    setMessage(null)
    const filledRows = rows.filter(r => parseFloat(r.amount) > 0)
    if (filledRows.length === 0) {
      setMessage({ type: 'error', text: 'אין שורות למילוי — הזן לפחות שורה אחת עם סכום' })
      return
    }
    // בדיקת ספקים שנראים כמו "מפעל ייצור" — דרושה אישור לפני שמירה
    const factoryLike = filledRows.filter(r =>
      r.expenseType === 'suppliers' && r.supplier && looksLikeFactorySupplier(r.supplier)
    )
    if (factoryLike.length > 0) {
      setFactoryWarningRows(factoryLike)
      return
    }
    saveAllConfirmed()
  }

  async function saveAllConfirmed() {
    setFactoryWarningRows(null)
    const filledRows = rows.filter(r => parseFloat(r.amount) > 0)
    if (filledRows.length === 0) return

    setSaving(true)
    const results = await Promise.allSettled(
      filledRows.map(async (row): Promise<string> => {
        if (!row.expenseType) throw new Error('סוג הוצאה חסר')
        const { error } = await supabase.from('branch_expenses').insert({
          branch_id: branchId,
          date: row.date,
          expense_type: row.expenseType,
          supplier: row.supplier || '—',
          amount: parseFloat(row.amount),
          doc_number: row.docNumber || null,
          notes: row.notes || null,
          from_factory: false,
        })
        if (error) throw new Error(error.message || 'שגיאת מסד נתונים')
        return row.id
      })
    )
    setSaving(false)

    const successIds = new Set<string>()
    const failedById = new Map<string, string>()  // id → error message
    results.forEach((result, i) => {
      const row = filledRows[i]
      if (result.status === 'fulfilled') {
        successIds.add(row.id)
      } else {
        const reason: any = result.reason
        failedById.set(row.id, reason?.message || 'שגיאה לא ידועה')
      }
    })

    setRows(prev => {
      const remaining = prev
        .filter(r => !successIds.has(r.id))
        .map(r => failedById.has(r.id) ? { ...r, error: failedById.get(r.id) } : r)
      return remaining.length === 0 ? [newEmptyRow()] : remaining
    })

    const successCount = successIds.size
    const failedCount = failedById.size
    if (failedCount === 0) {
      setMessage({ type: 'success', text: `נשמרו ${successCount} הוצאות בהצלחה ✓` })
    } else if (successCount === 0) {
      setMessage({ type: 'error', text: `כל ${failedCount} השורות נכשלו — בדוק הודעות שגיאה ליד כל שורה` })
    } else {
      setMessage({ type: 'warn', text: `${successCount} נשמרו, ${failedCount} נכשלו — הנכשלות נשארו לתיקון` })
    }

    await fetchEntries()
  }

  const filledCount = rows.filter(r => parseFloat(r.amount) > 0).length
  const canSave = !saving && filledCount > 0

  async function deleteEntry(id: number) {
    if (!confirm('למחוק הוצאה זו?')) return
    const { error } = await supabase.from('branch_expenses').delete().eq('id', id)
    if (error) {
      console.error('[BranchExpenses deleteEntry] error:', error)
      alert(`מחיקת ההוצאה נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    const { error } = await supabase.from('branch_expenses').update(editData).eq('id', id)
    if (error) {
      console.error('[BranchExpenses saveEdit] error:', error)
      alert(`עדכון ההוצאה נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
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
      <PageHeader title="הוצאות" subtitle={branchName} onBack={onBack} />

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

        {/* Factory warning dialog — מציג את השורות שזוהו כרכישת מפעל */}
        {factoryWarningRows && factoryWarningRows.length > 0 && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
            <div style={{ maxWidth: '480px', width: '90%', background: 'white', borderRadius: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.15)', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <div style={{ background: '#fef3c7', borderRadius: '50%', padding: '12px' }}>
                  <AlertTriangle size={28} color="#f59e0b" />
                </div>
              </div>
              <h3 style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: '700', color: '#374151', textAlign: 'center' }}>
                {factoryWarningRows.length === 1 ? 'שורה זו נראית כמו רכישה מהמפעל' : `${factoryWarningRows.length} שורות נראות כמו רכישה מהמפעל`}
              </h3>
              <p style={{ margin: '0 0 14px', fontSize: '14px', color: '#64748b', lineHeight: '1.6', textAlign: 'center' }}>
                אם הן רכישה מהמפעל הפנימי — אשר אותן בדף ההזמנות במקום כאן.
              </p>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: '#78350f', maxHeight: 140, overflowY: 'auto' }}>
                {factoryWarningRows.map(r => (
                  <div key={r.id} style={{ marginBottom: 4 }}>
                    • <strong>{r.supplier}</strong> — ₪{r.amount} ({r.date})
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button onClick={() => setFactoryWarningRows(null)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e2e8f0', background: 'white', borderRadius: 8, padding: '8px 18px', fontSize: '14px', fontWeight: '700', color: '#7c3aed', cursor: 'pointer' }}>
                  <Factory size={16} />
                  ביטול — אעבור להזמנות
                </button>
                <button onClick={() => saveAllConfirmed()}
                  style={{ background: '#64748b', color: 'white', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                  כל אלה ספקים חיצוניים — שמור
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

        {/* טופס הוספה רב-שורתי */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9', borderRadius: 12, padding: '20px', marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת הוצאות (ניתן להזין מספר שורות יחד)</h2>

          {message && (
            <div role="alert" style={{
              marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              background: message.type === 'success' ? '#ecfdf5' : message.type === 'warn' ? '#fef3c7' : '#fef2f2',
              border: '1px solid ' + (message.type === 'success' ? '#a7f3d0' : message.type === 'warn' ? '#fcd34d' : '#fecaca'),
              color: message.type === 'success' ? '#065f46' : message.type === 'warn' ? '#92400e' : '#991b1b',
            }}>
              <span>{message.text}</span>
              <button onClick={() => setMessage(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'inherit' }}>×</button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {rows.map((row) => {
              const isOnlyRow = rows.length === 1
              const amountValid = !!row.amount && parseFloat(row.amount) > 0
              return (
                <div key={row.id} style={{
                  border: row.error ? '1.5px solid #fca5a5' : '1px solid #f1f5f9',
                  borderRadius: 10, padding: 12, background: row.error ? '#fef2f2' : '#fafbfc'
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                      <label style={S.label}>תאריך</label>
                      <input type="date" value={row.date} onChange={e => updateRow(row.id, 'date', e.target.value)} style={S.input} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                      <label style={S.label}>סוג הוצאה</label>
                      <select value={row.expenseType} onChange={e => updateRow(row.id, 'expenseType', e.target.value as ExpenseType)}
                        style={{ ...S.input, background: 'white' }}>
                        {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
                      <label style={S.label}>ספק <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                      <AutocompleteInput value={row.supplier} onChange={v => updateRow(row.id, 'supplier', v)} options={supplierNames} placeholder="שם ספק..." color={branchColor} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                      <label style={S.label}>סכום ללא מע״מ (₪) *</label>
                      <input type="number" placeholder="0" value={row.amount}
                        onChange={e => updateRow(row.id, 'amount', e.target.value)}
                        style={{ ...S.input, textAlign: 'right' as const, borderColor: amountValid ? '#e2e8f0' : '#fca5a5' }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                      <label style={S.label}>מספר מסמך <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                      <input type="text" placeholder="מס׳ חשבונית" value={row.docNumber}
                        onChange={e => updateRow(row.id, 'docNumber', e.target.value)} style={S.input} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                      <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                      <input type="text" placeholder="הערה..." value={row.notes}
                        onChange={e => updateRow(row.id, 'notes', e.target.value)} style={S.input} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    {row.error
                      ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', fontSize: 13, fontWeight: 600 }}>
                          <AlertTriangle size={14} /> {row.error}
                        </div>
                      )
                      : <span />
                    }
                    <button onClick={() => removeRow(row.id)} disabled={isOnlyRow}
                      title={isOnlyRow ? 'לא ניתן למחוק את השורה האחרונה' : 'הסר שורה'}
                      style={{
                        background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px',
                        cursor: isOnlyRow ? 'not-allowed' : 'pointer',
                        color: isOnlyRow ? '#cbd5e1' : '#dc2626', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600
                      }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={addRow}
              style={{
                background: 'white', border: '1.5px dashed #cbd5e1', borderRadius: 8,
                padding: '10px 20px', fontSize: 14, fontWeight: 700, color: '#475569',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8
              }}>
              <Plus size={16} /> הוסף שורה נוספת
            </button>
            <button onClick={handleSaveAll} disabled={!canSave}
              style={{
                background: canSave ? '#6366f1' : '#e2e8f0',
                color: canSave ? 'white' : '#94a3b8',
                border: 'none', borderRadius: 8, padding: '10px 28px',
                fontSize: 15, fontWeight: 700,
                cursor: canSave ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 8,
                marginLeft: 'auto'
              }}>
              {saving ? '⏳ שומר…' : `💾 שמור הכל (${filledCount})`}
            </button>
          </div>
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
                  <Line yAxisId="amount" type="monotone" dataKey="factory" name="רכישות מפעל" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="supplier" name="ספקים" stroke="#818cf8" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="repair" name="תיקונים" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="infrastructure" name="תשתיות" stroke="#c084fc" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="delivery" name="משלוחים" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="amount" type="monotone" dataKey="total" name="סה״כ הוצאות" stroke="#fb7185" strokeWidth={2.5} dot={{ r: 3 }} />
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
