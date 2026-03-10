import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Plus, Trash2, Pencil, Users, UserPlus, Clock, ChevronDown, ChevronUp, X } from 'lucide-react'

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
  wage_type: 'hourly' | 'global'
  department: string
  bonus: number | null
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
  const baseCost = (h100 * rate + h125 * rate * 1.25 + h150 * rate * 1.5) * EMPLOYER_FACTOR
  const hourlyBonus = emp?.bonus || 0
  const totalHours = h100 + h125 + h150
  return baseCost + (totalHours * hourlyBonus)
}

function calcGross(emp: Employee | null, h100: number, h125: number, h150: number, hourlyRate?: number): number {
  const rate = hourlyRate ?? emp?.hourly_rate ?? 0
  if (!rate) return 0
  const basePay = h100 * rate + h125 * rate * 1.25 + h150 * rate * 1.5
  const hourlyBonus = emp?.bonus || 0
  return basePay + ((h100 + h125 + h150) * hourlyBonus)
}

function fmtM(n: number) { return '₪' + Math.round(n).toLocaleString() }

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function DepartmentLabor({ department, onBack }: Props) {
  const cfg = DEPT_CONFIG[department]

  const [tab, setTab] = useState<'manual' | 'casual' | 'history'>('manual')
  const [employees, setEmployees]   = useState<Employee[]>([])
  const [entries, setEntries]       = useState<LaborEntry[]>([])
  const { period, setPeriod, from, to } = usePeriod()
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

  // ── פירוט עובד ──
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null)

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
      .gte('date', from)
      .lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  useEffect(() => { fetchEmployees() }, [department])
  useEffect(() => { fetchEntries() },  [from, to, department])

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
    const employer_cost = calcCost(emp, h100, h125, h150)
    const gross_salary = calcGross(emp, h100, h125, h150)
    await supabase.from('labor').insert({
      entity_type: 'factory', entity_id: department,
      date: manDate, employee_id: emp.id, employee_name: emp.name,
      hours_100: h100, hours_125: h125, hours_150: h150,
      gross_salary, employer_cost, is_casual: false
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
    const employer_cost = calcCost(null, h100, h125, h150, rate)
    const gross_salary = calcGross(null, h100, h125, h150, rate)
    await supabase.from('labor').insert({
      entity_type: 'factory', entity_id: department,
      date: casDate, employee_id: null, employee_name: casName,
      hours_100: h100, hours_125: h125, hours_150: h150,
      gross_salary, employer_cost, is_casual: true, hourly_rate: rate
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

  // קיבוץ לפי עובד
  const employeeSummary = entries.reduce<Record<string, { totalCost: number, totalHours: number, count: number, isCasual: boolean }>>((acc, e) => {
    const name = e.employee_name
    if (!acc[name]) acc[name] = { totalCost: 0, totalHours: 0, count: 0, isCasual: e.is_casual }
    acc[name].totalCost += Number(e.gross_salary)
    acc[name].totalHours += Number(e.hours_100) + Number(e.hours_125) + Number(e.hours_150)
    acc[name].count += 1
    return acc
  }, {})
  const sortedEmployees = Object.entries(employeeSummary).sort((a, b) => b[1].totalCost - a[1].totalCost)
  const maxEmpCost = sortedEmployees.length > 0 ? sortedEmployees[0][1].totalCost : 1

  // רשומות של עובד נבחר
  const selectedEntries = selectedEmployee
    ? entries.filter(e => e.employee_name === selectedEmployee).sort((a, b) => a.date.localeCompare(b.date))
    : []

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
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
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
                        {e.name}{e.hourly_rate ? ` · ₪${e.hourly_rate}/ש׳${e.bonus ? ` +₪${e.bonus} בונוס` : ''}` : ' · גלובלי'}
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
              {previewCost > 0 && (() => {
                const ph100 = parseFloat(manH100) || 0, ph125 = parseFloat(manH125) || 0, ph150 = parseFloat(manH150) || 0
                const pTotalH = ph100 + ph125 + ph150
                const pBase = selEmp?.hourly_rate ? (ph100 * selEmp.hourly_rate + ph125 * selEmp.hourly_rate * 1.25 + ph150 * selEmp.hourly_rate * 1.5) * EMPLOYER_FACTOR : 0
                const pBonus = (selEmp?.bonus || 0) * pTotalH
                return (
                  <div style={{ background: cfg.bg, border: `1px solid ${cfg.color}33`, borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>עלות מעסיק (×1.3):</span>
                    <span style={{ fontSize: '18px', fontWeight: '800', color: cfg.color }}>{fmtM(previewCost)}</span>
                    {selEmp?.hourly_rate && (
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                        ({pTotalH.toFixed(1)} ש׳ · ₪{selEmp.hourly_rate}/ש׳{selEmp.bonus ? ` + בונוס ₪${pBonus.toFixed(0)}` : ''})
                      </span>
                    )}
                  </div>
                )
              })()}

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
              <PeriodPicker period={period} onChange={setPeriod} />
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#64748b', marginRight: 'auto' }}>
                <span>סה"כ: <strong style={{ color: cfg.color }}>{fmtM(totalCost)}</strong></span>
                <span>שעות: <strong>{totalHours.toFixed(1)}</strong></span>
                <span>מזדמנים: <strong>{casualCount}</strong></span>
              </div>
            </div>

            {/* ── פירוט לפי עובד ── */}
            {sortedEmployees.length > 0 && (
              <div style={{ background: 'white', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', background: cfg.bg, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={16} color={cfg.color} />
                  </div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#374151' }}>פירוט עלות לפי עובד</h3>
                  <span style={{ fontSize: '12px', color: '#94a3b8', marginRight: 'auto' }}>{sortedEmployees.length} עובדים</span>
                </div>
                {sortedEmployees.map(([name, data], i) => {
                  const pct = totalCost > 0 ? (data.totalCost / totalCost * 100) : 0
                  const barW = maxEmpCost > 0 ? (data.totalCost / maxEmpCost * 100) : 0
                  return (
                    <div key={name}
                      onClick={() => setSelectedEmployee(name)}
                      style={{ padding: '14px 20px', borderBottom: i < sortedEmployees.length - 1 ? '1px solid #f1f5f9' : 'none', cursor: 'pointer', background: i % 2 === 0 ? 'white' : '#fafafa', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = cfg.bg}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ width: '28px', height: '28px', background: data.isCasual ? '#fef3c7' : cfg.bg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', color: data.isCasual ? '#d97706' : cfg.color }}>
                          {name.charAt(0)}
                        </div>
                        <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px', flex: 1 }}>
                          {name}
                          {data.isCasual && <span style={{ fontSize: '11px', background: '#fef3c7', color: '#d97706', padding: '1px 6px', borderRadius: '10px', marginRight: '6px', fontWeight: '600' }}>מזדמן</span>}
                        </span>
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{data.totalHours.toFixed(1)} ש׳ · {data.count} רשומות</span>
                        <span style={{ fontWeight: '800', color: cfg.color, fontSize: '15px', minWidth: '90px', textAlign: 'left' }}>{fmtM(data.totalCost)}</span>
                        <span style={{ fontSize: '12px', color: '#64748b', minWidth: '45px', textAlign: 'left' }}>{pct.toFixed(1)}%</span>
                        <ChevronDown size={16} color="#94a3b8" />
                      </div>
                      <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${barW}%`, background: data.isCasual ? '#f59e0b' : cfg.color, borderRadius: '3px', transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  )
                })}
                {/* סה"כ */}
                <div style={{ padding: '12px 20px', background: cfg.bg, borderTop: `2px solid ${cfg.color}33`, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontWeight: '700', color: '#374151', fontSize: '13px', flex: 1 }}>סה"כ עלות מחלקתית</span>
                  <span style={{ fontWeight: '800', color: cfg.color, fontSize: '17px' }}>{fmtM(totalCost)}</span>
                </div>
              </div>
            )}

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

      {/* ── מודל פירוט יומי לעובד ── */}
      {selectedEmployee && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
          onClick={() => setSelectedEmployee(null)}>
          <div style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '700px', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}>
            {/* כותרת */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px', position: 'sticky', top: 0, background: 'white', zIndex: 1, borderRadius: '20px 20px 0 0' }}>
              <div style={{ width: '36px', height: '36px', background: cfg.bg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '700', color: cfg.color }}>
                {selectedEmployee.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>{selectedEmployee}</h3>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>פירוט שכר יומי — {period.label}</p>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '20px', fontWeight: '800', color: cfg.color }}>{fmtM(employeeSummary[selectedEmployee]?.totalCost || 0)}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>סה"כ החודש</div>
              </div>
              <button onClick={() => setSelectedEmployee(null)}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={18} color="#64748b" />
              </button>
            </div>

            {/* סיכום */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', padding: '16px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#374151' }}>{selectedEntries.length}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>ימי עבודה</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#374151' }}>{selectedEntries.reduce((s, e) => s + Number(e.hours_100), 0).toFixed(1)}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>שעות 100%</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#f59e0b' }}>{selectedEntries.reduce((s, e) => s + Number(e.hours_125), 0).toFixed(1)}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>שעות 125%</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#ef4444' }}>{selectedEntries.reduce((s, e) => s + Number(e.hours_150), 0).toFixed(1)}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>שעות 150%</div>
              </div>
            </div>

            {/* טבלת ימים */}
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 50px 70px 70px 70px 1fr', padding: '10px 24px', background: '#f8fafc', fontSize: '11px', fontWeight: '700', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                <span>תאריך</span>
                <span>יום</span>
                <span style={{ textAlign: 'center' }}>100%</span>
                <span style={{ textAlign: 'center' }}>125%</span>
                <span style={{ textAlign: 'center' }}>150%</span>
                <span style={{ textAlign: 'left' }}>עלות</span>
              </div>
              {selectedEntries.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>אין רשומות</div>
              ) : selectedEntries.map((entry, i) => {
                const d = new Date(entry.date + 'T12:00:00')
                const dayName = d.toLocaleDateString('he-IL', { weekday: 'short' })
                const dayNum = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
                const dayTotal = Number(entry.hours_100) + Number(entry.hours_125) + Number(entry.hours_150)
                return (
                  <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '90px 50px 70px 70px 70px 1fr', alignItems: 'center', padding: '12px 24px', borderBottom: i < selectedEntries.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <span style={{ fontSize: '13px', color: '#374151', fontWeight: '600' }}>{dayNum}</span>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>{dayName}</span>
                    <span style={{ fontSize: '13px', color: '#64748b', textAlign: 'center' }}>{Number(entry.hours_100) > 0 ? entry.hours_100 : '—'}</span>
                    <span style={{ fontSize: '13px', color: Number(entry.hours_125) > 0 ? '#f59e0b' : '#64748b', textAlign: 'center', fontWeight: Number(entry.hours_125) > 0 ? '600' : '400' }}>{Number(entry.hours_125) > 0 ? entry.hours_125 : '—'}</span>
                    <span style={{ fontSize: '13px', color: Number(entry.hours_150) > 0 ? '#ef4444' : '#64748b', textAlign: 'center', fontWeight: Number(entry.hours_150) > 0 ? '600' : '400' }}>{Number(entry.hours_150) > 0 ? entry.hours_150 : '—'}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '700', color: cfg.color, fontSize: '14px' }}>{fmtM(Number(entry.gross_salary))}</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>{dayTotal.toFixed(1)} ש׳</span>
                    </div>
                  </div>
                )
              })}
              {/* סה"כ */}
              {selectedEntries.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '90px 50px 70px 70px 70px 1fr', padding: '14px 24px', background: cfg.bg, borderTop: `2px solid ${cfg.color}33`, fontWeight: '700', fontSize: '13px' }}>
                  <span style={{ color: '#374151' }}>סה"כ</span>
                  <span />
                  <span style={{ color: '#64748b', textAlign: 'center' }}>{selectedEntries.reduce((s, e) => s + Number(e.hours_100), 0).toFixed(1)}</span>
                  <span style={{ color: '#f59e0b', textAlign: 'center' }}>{selectedEntries.reduce((s, e) => s + Number(e.hours_125), 0).toFixed(1)}</span>
                  <span style={{ color: '#ef4444', textAlign: 'center' }}>{selectedEntries.reduce((s, e) => s + Number(e.hours_150), 0).toFixed(1)}</span>
                  <span style={{ color: cfg.color, fontSize: '16px' }}>{fmtM(employeeSummary[selectedEmployee]?.totalCost || 0)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}