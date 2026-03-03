import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Trash2, Pencil, Users, UserPlus, Clock } from 'lucide-react'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
type Department = 'creams' | 'dough' | 'packaging' | 'cleaning'

interface Props {
  department: Department
  onBack: () => void
}

interface Employee {
  id: number
  name: string
  hourly_rate: number | null
  salary_type: 'hourly' | 'global'
  department: string
}

interface LaborEntry {
  id: number
  date: string
  employee_id: number | null
  employee_name: string
  hours_100: number
  hours_125: number
  hours_150: number
  gross_salary: number
  is_casual: boolean
  hourly_rate: number | null
}

// ─── קונפיגורציה ────────────────────────────────────────────────────────────
const DEPT_CONFIG = {
  creams:   { label: 'קרמים',     color: '#3b82f6', bg: '#dbeafe' },
  dough:    { label: 'בצקים',     color: '#8b5cf6', bg: '#ede9fe' },
  packaging:{ label: 'אריזה',     color: '#0ea5e9', bg: '#e0f2fe' },
  cleaning: { label: 'ניקיון/נהג', color: '#64748b', bg: '#f1f5f9' },
}

const EMPLOYER_FACTOR = 1.3

function calcCost(emp: Employee | null, h100: number, h125: number, h150: number, hourlyRate?: number): number {
  const rate = hourlyRate ?? emp?.hourly_rate ?? 0
  if (!rate) return 0
  return (h100 * rate + h125 * rate * 1.25 + h150 * rate * 1.5) * EMPLOYER_FACTOR
}

function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString() }

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function DepartmentLabor({ department, onBack }: Props) {
  const cfg = DEPT_CONFIG[department]

  const [tab, setTab] = useState<'manual' | 'casual' | 'history'>('manual')
  const [employees, setEmployees]   = useState<Employee[]>([])
  const [entries, setEntries]       = useState<LaborEntry[]>([])
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [loading, setLoading]       = useState(false)

  // ── טופס הזנה ידנית ──
  const [manDate, setManDate]       = useState(new Date().toISOString().split('T')[0])
  const [manEmpId, setManEmpId]     = useState<number | ''>('')
  const [manH100, setManH100]       = useState('')
  const [manH125, setManH125]       = useState('')
  const [manH150, setManH150]       = useState('')

  // ── טופס עובד מזדמן ──
  const [casDate, setCasDate]       = useState(new Date().toISOString().split('T')[0])
  const [casName, setCasName]       = useState('')
  const [casH100, setCasH100]       = useState('')
  const [casH125, setCasH125]       = useState('')
  const [casH150, setCasH150]       = useState('')
  const [casRate, setCasRate]       = useState('')

  // ── עריכה ──
  const [editId, setEditId]         = useState<number | null>(null)
  const [editData, setEditData]     = useState<Partial<LaborEntry>>({})

  // ─── שליפות ──────────────────────────────────────────────────────────────
  async function fetchEmployees() {
    const { data } = await supabase
      .from('employees').select('*')
      .eq('department', department)
      .order('name')
    if (data) setEmployees(data)
  }

  async function fetchEntries() {
    const { data } = await supabase
      .from('labor').select('*')
      .eq('entity_type', 'factory')
      .eq('entity_id', department)
      .gte('date', monthFilter + '-01')
      .lte('date', monthFilter + '-31')
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  useEffect(() => { fetchEmployees() }, [department])
  useEffect(() => { fetchEntries() },  [monthFilter, department])

  // ─── הזנה ידנית ──────────────────────────────────────────────────────────
  async function addManual() {
    if (!manEmpId || !manDate) return
    const emp = employees.find(e => e.id === manEmpId)
    if (!emp) return
    const h100 = parseFloat(manH100) || 0
    const h125 = parseFloat(manH125) || 0
    const h150 = parseFloat(manH150) || 0
    if (h100 + h125 + h150 === 0) return
    setLoading(true)
    const gross_salary = calcCost(emp, h100, h125, h150)
    await supabase.from('labor').insert({
      entity_type: 'factory', entity_id: department,
      date: manDate, employee_id: emp.id, employee_name: emp.name,
      hours_100: h100, hours_125: h125, hours_150: h150,
      gross_salary, is_casual: false
    })
    setManH100(''); setManH125(''); setManH150('')
    await fetchEntries()
    setLoading(false)
  }

  // ─── עובד מזדמן ──────────────────────────────────────────────────────────
  async function addCasual() {
    if (!casName || !casRate || !casDate) return
    const h100 = parseFloat(casH100) || 0
    const h125 = parseFloat(casH125) || 0
    const h150 = parseFloat(casH150) || 0
    if (h100 + h125 + h150 === 0) return
    setLoading(true)
    const rate = parseFloat(casRate)
    const gross_salary = calcCost(null, h100, h125, h150, rate)
    await supabase.from('labor').insert({
      entity_type: 'factory', entity_id: department,
      date: casDate, employee_id: null, employee_name: casName,
      hours_100: h100, hours_125: h125, hours_150: h150,
      gross_salary, is_casual: true, hourly_rate: rate
    })
    setCasName(''); setCasH100(''); setCasH125(''); setCasH150(''); setCasRate('')
    await fetchEntries()
    setLoading(false)
  }

  // ─── מחיקה / עריכה ───────────────────────────────────────────────────────
  async function deleteEntry(id: number) {
    if (!confirm('למחוק רשומה זו?')) return
    await supabase.from('labor').delete().eq('id', id)
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    await supabase.from('labor').update(editData).eq('id', id)
    setEditId(null)
    await fetchEntries()
  }

  // ─── חישובים ─────────────────────────────────────────────────────────────
  const totalCost    = entries.reduce((s, e) => s + Number(e.gross_salary), 0)
  const totalH100    = entries.reduce((s, e) => s + Number(e.hours_100), 0)
  const totalH125    = entries.reduce((s, e) => s + Number(e.hours_125), 0)
  const totalH150    = entries.reduce((s, e) => s + Number(e.hours_150), 0)
  const totalHours   = totalH100 + totalH125 + totalH150
  const casualCount  = entries.filter(e => e.is_casual).length

  // עובד נבחר בטופס
  const selEmp = employees.find(e => e.id === manEmpId)
  const previewCost = selEmp
    ? calcCost(selEmp, parseFloat(manH100) || 0, parseFloat(manH125) || 0, parseFloat(manH150) || 0)
    : 0

  const casPreviewCost = casRate
    ? calcCost(null, parseFloat(casH100) || 0, parseFloat(casH125) || 0, parseFloat(casH150) || 0, parseFloat(casRate))
    : 0

  // ─── סגנונות ─────────────────────────────────────────────────────────────
  const S = {
    page:   { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:   { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    label:  { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input:  { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' as const },
    btnAdd: (disabled: boolean) => ({
      background: disabled ? '#e2e8f0' : cfg.color,
      color: disabled ? '#94a3b8' : 'white',
      border: 'none', borderRadius: '10px', padding: '10px 24px',
      fontSize: '15px', fontWeight: '700' as const,
      cursor: disabled ? 'not-allowed' as const : 'pointer' as const,
      display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' as const
    }),
  }

  return (
    <div style={S.page}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
        </button>
        <div style={{ width: '40px', height: '40px', background: cfg.bg, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Users size={20} color={cfg.color} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>לייבור — {cfg.label}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>הזנת שעות עבודה · עלות מעסיק ×1.3</p>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', gap: '16px' }}>
          <div style={{ background: cfg.bg, border: `1px solid ${cfg.color}33`, borderRadius: '10px', padding: '8px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: '800', color: cfg.color }}>{fmtM(totalCost)}</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>סה"כ החודש</div>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#374151' }}>{totalHours.toFixed(1)}</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>שעות כולל</div>
          </div>
        </div>
      </div>

      {/* ─── טאבים ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', padding: '0 32px', background: 'white', borderBottom: '1px solid #e2e8f0' }}>
        {([
          ['manual',  '👤 הזנה ידנית',    Users],
          ['casual',  '🆕 עובד מזדמן',    UserPlus],
          ['history', '📋 היסטוריה',      Clock],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)}
            style={{ padding: '14px 22px', background: 'none', border: 'none', borderBottom: tab === key ? `3px solid ${cfg.color}` : '3px solid transparent', cursor: 'pointer', fontSize: '14px', fontWeight: tab === key ? '700' : '500', color: tab === key ? cfg.color : '#64748b' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: '28px 32px', maxWidth: '900px', margin: '0 auto' }}>

        {/* ══ הזנה ידנית ══════════════════════════════════════════════════ */}
        {tab === 'manual' && (
          <>
            <div style={{ ...S.card, marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 18px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הזנת שעות לעובד</h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>תאריך</label>
                  <input type="date" value={manDate} onChange={e => setManDate(e.target.value)} style={S.input} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
                  <label style={S.label}>עובד</label>
                  <select value={manEmpId} onChange={e => setManEmpId(Number(e.target.value))}
                    style={{ ...S.input, background: 'white' }}>
                    <option value="">— בחר עובד —</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.name}{e.hourly_rate ? ` · ₪${e.hourly_rate}/ש׳` : ' · גלובלי'}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שעות 100%</label>
                  <input type="number" placeholder="0" value={manH100} onChange={e => setManH100(e.target.value)} style={S.input} min="0" step="0.5" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שעות 125%</label>
                  <input type="number" placeholder="0" value={manH125} onChange={e => setManH125(e.target.value)} style={S.input} min="0" step="0.5" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שעות 150%</label>
                  <input type="number" placeholder="0" value={manH150} onChange={e => setManH150(e.target.value)} style={S.input} min="0" step="0.5" />
                </div>
              </div>

              {/* תצוגה מקדימה של עלות */}
              {previewCost > 0 && (
                <div style={{ background: cfg.bg, border: `1px solid ${cfg.color}33`, borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>עלות מעסיק מחושבת (×1.3):</span>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: cfg.color }}>{fmtM(previewCost)}</span>
                  {selEmp?.hourly_rate && (
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      ({((parseFloat(manH100)||0) + (parseFloat(manH125)||0) + (parseFloat(manH150)||0)).toFixed(1)} ש׳ · ₪{selEmp.hourly_rate}/ש׳)
                    </span>
                  )}
                </div>
              )}

              <button onClick={addManual}
                disabled={loading || !manEmpId || (parseFloat(manH100)||0) + (parseFloat(manH125)||0) + (parseFloat(manH150)||0) === 0}
                style={S.btnAdd(loading || !manEmpId || (parseFloat(manH100)||0) + (parseFloat(manH125)||0) + (parseFloat(manH150)||0) === 0)}>
                <Plus size={18} />הוסף רשומה
              </button>

              {employees.length === 0 && (
                <div style={{ marginTop: '12px', fontSize: '13px', color: '#f59e0b', background: '#fffbeb', borderRadius: '8px', padding: '10px 14px' }}>
                  ⚠️ אין עובדים רשומים למחלקה זו — הוסף עובדים בלייבור המרוכז
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ עובד מזדמן ══════════════════════════════════════════════════ */}
        {tab === 'casual' && (
          <div style={{ ...S.card, marginBottom: '20px' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>עובד מזדמן</h2>
            <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#94a3b8' }}>שעות + שכר שעתי → עלות מחושבת ×1.3 אוטומטית</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>תאריך</label>
                <input type="date" value={casDate} onChange={e => setCasDate(e.target.value)} style={S.input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
                <label style={S.label}>שם עובד</label>
                <input type="text" placeholder="שם מלא..." value={casName} onChange={e => setCasName(e.target.value)} style={S.input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>שכר שעתי (₪)</label>
                <input type="number" placeholder="0" value={casRate} onChange={e => setCasRate(e.target.value)} style={S.input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>שעות 100%</label>
                <input type="number" placeholder="0" value={casH100} onChange={e => setCasH100(e.target.value)} style={S.input} min="0" step="0.5" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>שעות 125%</label>
                <input type="number" placeholder="0" value={casH125} onChange={e => setCasH125(e.target.value)} style={S.input} min="0" step="0.5" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>שעות 150%</label>
                <input type="number" placeholder="0" value={casH150} onChange={e => setCasH150(e.target.value)} style={S.input} min="0" step="0.5" />
              </div>
            </div>

            {/* תצוגה מקדימה */}
            {casPreviewCost > 0 && (
              <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', display: 'flex', gap: '16px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#92400e' }}>עלות מעסיק מחושבת (×1.3):</span>
                <span style={{ fontSize: '20px', fontWeight: '800', color: '#d97706' }}>{fmtM(casPreviewCost)}</span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  = ({casH100||0} + {casH125||0}×1.25 + {casH150||0}×1.5) × ₪{casRate} × 1.3
                </span>
              </div>
            )}

            <button onClick={addCasual}
              disabled={loading || !casName || !casRate || (parseFloat(casH100)||0) + (parseFloat(casH125)||0) + (parseFloat(casH150)||0) === 0}
              style={S.btnAdd(loading || !casName || !casRate || (parseFloat(casH100)||0) + (parseFloat(casH125)||0) + (parseFloat(casH150)||0) === 0)}>
              <Plus size={18} />הוסף עובד מזדמן
            </button>
          </div>
        )}

        {/* ══ היסטוריה ════════════════════════════════════════════════════ */}
        {tab === 'history' && (
          <>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
              <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', background: 'white', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#64748b', marginRight: 'auto' }}>
                <span>סה"כ: <strong style={{ color: cfg.color }}>{fmtM(totalCost)}</strong></span>
                <span>שעות: <strong>{totalHours.toFixed(1)}</strong></span>
                <span>מזדמנים: <strong>{casualCount}</strong></span>
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              {/* כותרת */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 70px 70px 110px 36px 36px', padding: '10px 20px', background: '#f8fafc', fontSize: '11px', fontWeight: '700', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                <span>תאריך</span><span>עובד</span>
                <span style={{ textAlign: 'center' }}>100%</span>
                <span style={{ textAlign: 'center' }}>125%</span>
                <span style={{ textAlign: 'center' }}>150%</span>
                <span style={{ textAlign: 'left' }}>עלות</span>
                <span /><span />
              </div>

              {entries.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין רשומות לחודש זה</div>
              ) : entries.map((entry, i) => (
                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 70px 70px 110px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editId === entry.id ? (
                    <>
                      <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                      <input type="text" value={editData.employee_name || ''} onChange={e => setEditData({ ...editData, employee_name: e.target.value })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                      <input type="number" value={editData.hours_100 ?? ''} onChange={e => setEditData({ ...editData, hours_100: parseFloat(e.target.value) || 0 })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 6px', fontSize: '12px', textAlign: 'center' }} />
                      <input type="number" value={editData.hours_125 ?? ''} onChange={e => setEditData({ ...editData, hours_125: parseFloat(e.target.value) || 0 })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 6px', fontSize: '12px', textAlign: 'center' }} />
                      <input type="number" value={editData.hours_150 ?? ''} onChange={e => setEditData({ ...editData, hours_150: parseFloat(e.target.value) || 0 })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 6px', fontSize: '12px', textAlign: 'center' }} />
                      <input type="number" value={editData.gross_salary ?? ''} onChange={e => setEditData({ ...editData, gross_salary: parseFloat(e.target.value) || 0 })} style={{ border: '1px solid ' + cfg.color, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                      <button onClick={() => saveEdit(entry.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                      <div>
                        <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{entry.employee_name}</span>
                        {entry.is_casual && (
                          <span style={{ fontSize: '11px', background: '#fef3c7', color: '#d97706', padding: '1px 6px', borderRadius: '10px', marginRight: '6px', fontWeight: '600' }}>מזדמן</span>
                        )}
                        {entry.hourly_rate && (
                          <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '4px' }}>₪{entry.hourly_rate}/ש׳</span>
                        )}
                      </div>
                      <span style={{ fontSize: '13px', color: '#64748b', textAlign: 'center' }}>{Number(entry.hours_100) > 0 ? entry.hours_100 : '—'}</span>
                      <span style={{ fontSize: '13px', color: '#64748b', textAlign: 'center' }}>{Number(entry.hours_125) > 0 ? entry.hours_125 : '—'}</span>
                      <span style={{ fontSize: '13px', color: '#64748b', textAlign: 'center' }}>{Number(entry.hours_150) > 0 ? entry.hours_150 : '—'}</span>
                      <span style={{ fontWeight: '700', color: cfg.color, fontSize: '14px' }}>{fmtM(Number(entry.gross_salary))}</span>
                      <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              ))}

              {/* סה"כ */}
              {entries.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 70px 70px 110px 36px 36px', padding: '13px 20px', background: cfg.bg, borderTop: `2px solid ${cfg.color}33`, fontWeight: '700', fontSize: '13px' }}>
                  <span style={{ color: '#374151' }}>סה"כ</span>
                  <span style={{ color: '#64748b' }}>{entries.length} רשומות</span>
                  <span style={{ color: '#64748b', textAlign: 'center' }}>{totalH100.toFixed(1)}</span>
                  <span style={{ color: '#64748b', textAlign: 'center' }}>{totalH125.toFixed(1)}</span>
                  <span style={{ color: '#64748b', textAlign: 'center' }}>{totalH150.toFixed(1)}</span>
                  <span style={{ color: cfg.color, fontSize: '15px' }}>{fmtM(totalCost)}</span>
                  <span /><span />
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}