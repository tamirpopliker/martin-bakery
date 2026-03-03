import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Pencil, Trash2, Save, Settings, Users, Target, DollarSign } from 'lucide-react'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Props { onBack: () => void }

type Tab = 'kpi' | 'costs' | 'employees'
type Dept = 'creams' | 'dough'

interface KpiTarget {
  id?: number
  department: Dept
  labor_pct: number
  waste_pct: number
  repairs_pct: number
  gross_profit_pct: number
  production_pct: number
}

interface FixedCost {
  id: number
  name: string
  amount: number
  month: string
}

interface Employee {
  id: number
  name: string
  department: string
  salary_type: 'hourly' | 'global'
  hourly_rate: number | null
  monthly_salary: number | null
  bonus: number | null
}

// ─── קבועים ─────────────────────────────────────────────────────────────────
const DEPTS: { key: Dept; label: string; color: string }[] = [
  { key: 'creams', label: 'קרמים', color: '#3b82f6' },
  { key: 'dough',  label: 'בצקים', color: '#8b5cf6' },
]

const ALL_DEPTS = [
  { key: 'creams',    label: 'קרמים' },
  { key: 'dough',     label: 'בצקים' },
  { key: 'packaging', label: 'אריזה' },
  { key: 'cleaning',  label: 'ניקיון/נהג' },
]

const DEFAULT_FIXED_COSTS = ['ארנונה', 'שכירות', 'גז', 'חשמל', 'מים', 'אינטרנט', 'ביטוח']

const KPI_FIELDS: { key: keyof KpiTarget; label: string; higher: boolean; hint: string }[] = [
  { key: 'labor_pct',       label: 'לייבור / הכנסות %',     higher: false, hint: 'נמוך יותר = טוב יותר' },
  { key: 'waste_pct',       label: 'פחת / הכנסות %',        higher: false, hint: 'נמוך יותר = טוב יותר' },
  { key: 'repairs_pct',     label: 'תיקונים / הכנסות %',    higher: false, hint: 'נמוך יותר = טוב יותר' },
  { key: 'gross_profit_pct',label: 'רווח גולמי %',          higher: true,  hint: 'גבוה יותר = טוב יותר' },
  { key: 'production_pct',  label: 'ייצור / הכנסות %',      higher: false, hint: 'נמוך יותר = טוב יותר' },
]

function fmtM(n: number) { return '₪' + Math.round(n || 0).toLocaleString() }

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function FactorySettings({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('kpi')

  // ── KPI ──
  const [kpiTargets, setKpiTargets] = useState<Record<Dept, KpiTarget>>({
    creams: { department: 'creams', labor_pct: 25, waste_pct: 5, repairs_pct: 3, gross_profit_pct: 40, production_pct: 45 },
    dough:  { department: 'dough',  labor_pct: 25, waste_pct: 5, repairs_pct: 3, gross_profit_pct: 40, production_pct: 45 },
  })
  const [kpiSaved, setKpiSaved] = useState(false)

  // ── עלויות קבועות ──
  const [costs, setCosts]           = useState<FixedCost[]>([])
  const [costMonth, setCostMonth]   = useState(new Date().toISOString().slice(0, 7))
  const [newCostName, setNewCostName] = useState('')
  const [newCostAmount, setNewCostAmount] = useState('')
  const [editCostId, setEditCostId] = useState<number | null>(null)
  const [editCostData, setEditCostData] = useState<Partial<FixedCost>>({})
  const [loadingCost, setLoadingCost] = useState(false)

  // ── עובדים ──
  const [employees, setEmployees]   = useState<Employee[]>([])
  const [deptFilter, setDeptFilter] = useState('all')
  const [editEmpId, setEditEmpId]   = useState<number | null>(null)
  const [editEmpData, setEditEmpData] = useState<Partial<Employee>>({})
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [newEmp, setNewEmp]         = useState<Partial<Employee>>({ salary_type: 'hourly', department: 'creams' })
  const [loadingEmp, setLoadingEmp] = useState(false)

  // ─── שליפות ──────────────────────────────────────────────────────────────
  async function fetchKpi() {
    const { data } = await supabase.from('kpi_targets').select('*')
    if (data && data.length > 0) {
      const map: any = {}
      data.forEach((r: any) => { map[r.department] = r })
      setKpiTargets(prev => ({ ...prev, ...map }))
    }
  }

  async function fetchCosts() {
    const { data } = await supabase
      .from('fixed_costs')
      .select('*')
      .eq('month', costMonth)
      .eq('entity_type', 'factory')
      .order('name')
    if (data) setCosts(data)
  }

  async function fetchEmployees() {
    const { data } = await supabase.from('employees').select('*').order('department').order('name')
    if (data) setEmployees(data)
  }

  useEffect(() => { fetchKpi(); fetchEmployees() }, [])
  useEffect(() => { fetchCosts() }, [costMonth])

  // ─── KPI save ────────────────────────────────────────────────────────────
  async function saveKpi() {
    for (const dept of DEPTS) {
      const target = kpiTargets[dept.key]
      if (target.id) {
        await supabase.from('kpi_targets').update(target).eq('id', target.id)
      } else {
        const { data } = await supabase.from('kpi_targets').insert({ ...target }).select().single()
        if (data) setKpiTargets(prev => ({ ...prev, [dept.key]: data }))
      }
    }
    setKpiSaved(true)
    setTimeout(() => setKpiSaved(false), 2000)
  }

  // ─── עלויות קבועות CRUD ──────────────────────────────────────────────────
  async function addCost() {
    if (!newCostName || !newCostAmount) return
    setLoadingCost(true)
    await supabase.from('fixed_costs').insert({
      name: newCostName, amount: parseFloat(newCostAmount),
      month: costMonth, entity_type: 'factory', entity_id: 'factory'
    })
    setNewCostName(''); setNewCostAmount('')
    await fetchCosts()
    setLoadingCost(false)
  }

  async function saveCost(id: number) {
    await supabase.from('fixed_costs').update(editCostData).eq('id', id)
    setEditCostId(null)
    await fetchCosts()
  }

  async function deleteCost(id: number) {
    if (!confirm('למחוק עלות זו?')) return
    await supabase.from('fixed_costs').delete().eq('id', id)
    await fetchCosts()
  }

  async function copyFromPrevMonth() {
    const [y, m] = costMonth.split('-').map(Number)
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    const { data } = await supabase.from('fixed_costs').select('*').eq('month', prev).eq('entity_type', 'factory')
    if (!data || data.length === 0) { alert('אין עלויות בחודש הקודם'); return }
    setLoadingCost(true)
    for (const c of data) {
      await supabase.from('fixed_costs').insert({ name: c.name, amount: c.amount, month: costMonth, entity_type: 'factory', entity_id: 'factory' })
    }
    await fetchCosts()
    setLoadingCost(false)
  }

  // ─── עובדים CRUD ─────────────────────────────────────────────────────────
  async function addEmployee() {
    if (!newEmp.name || !newEmp.department || !newEmp.salary_type) return
    setLoadingEmp(true)
    await supabase.from('employees').insert({
      name: newEmp.name, department: newEmp.department,
      salary_type: newEmp.salary_type,
      hourly_rate: newEmp.salary_type === 'hourly' ? (newEmp.hourly_rate || null) : null,
      monthly_salary: newEmp.salary_type === 'global' ? (newEmp.monthly_salary || null) : null,
      bonus: newEmp.bonus || null
    })
    setNewEmp({ salary_type: 'hourly', department: 'creams' })
    setShowAddEmp(false)
    await fetchEmployees()
    setLoadingEmp(false)
  }

  async function saveEmployee(id: number) {
    await supabase.from('employees').update(editEmpData).eq('id', id)
    setEditEmpId(null)
    await fetchEmployees()
  }

  async function deleteEmployee(id: number) {
    if (!confirm('למחוק עובד זה?')) return
    await supabase.from('employees').delete().eq('id', id)
    await fetchEmployees()
  }

  // ─── חישובים ─────────────────────────────────────────────────────────────
  const totalFixedCosts = costs.reduce((s, c) => s + Number(c.amount), 0)
  const filteredEmps = deptFilter === 'all' ? employees : employees.filter(e => e.department === deptFilter)

  // ─── סגנונות ─────────────────────────────────────────────────────────────
  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={S.page}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
        </button>
        <div style={{ width: '40px', height: '40px', background: '#f1f5f9', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Settings size={20} color="#64748b" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>הגדרות מפעל</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>יעדי KPI · עלויות קבועות · ניהול עובדים</p>
        </div>
      </div>

      {/* ─── טאבים ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', padding: '0 32px', background: 'white', borderBottom: '1px solid #e2e8f0' }}>
        {([
          ['kpi',       '🎯 יעדי KPI',       Target],
          ['costs',     '💰 עלויות קבועות',  DollarSign],
          ['employees', '👷 עובדים',          Users],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as Tab)}
            style={{ padding: '14px 22px', background: 'none', border: 'none', borderBottom: tab === key ? '3px solid #64748b' : '3px solid transparent', cursor: 'pointer', fontSize: '14px', fontWeight: tab === key ? '700' : '500', color: tab === key ? '#0f172a' : '#64748b' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: '28px 32px', maxWidth: '960px', margin: '0 auto' }}>

        {/* ══ יעדי KPI ════════════════════════════════════════════════════ */}
        {tab === 'kpi' && (
          <>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
              💡 יעדים נפרדים לקרמים ולבצקים. 4 רמות צבע: ✅ תקין · 🟡 סביר · 🟠 חריגה · 🔴 קריטי
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              {DEPTS.map(dept => (
                <div key={dept.key} style={{ ...S.card, borderTop: `4px solid ${dept.color}` }}>
                  <h3 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: '800', color: dept.color }}>{dept.label}</h3>
                  {KPI_FIELDS.map(field => (
                    <div key={field.key} style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>{field.label}</label>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>{field.hint}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="number" min="0" max="100" step="0.5"
                          value={kpiTargets[dept.key][field.key] as number}
                          onChange={e => setKpiTargets(prev => ({
                            ...prev,
                            [dept.key]: { ...prev[dept.key], [field.key]: parseFloat(e.target.value) || 0 }
                          }))}
                          style={{ ...S.input, width: '100px', textAlign: 'center' as const }}
                        />
                        <span style={{ fontSize: '14px', color: '#64748b' }}>%</span>
                        {/* ויזואל 4 רמות */}
                        <div style={{ display: 'flex', gap: '3px', marginRight: 'auto' }}>
                          {[
                            { label: '±0%', color: '#10b981' },
                            { label: '±3%', color: '#f59e0b' },
                            { label: '±7%', color: '#f97316' },
                            { label: '>7%', color: '#ef4444' },
                          ].map(r => (
                            <span key={r.label} style={{ background: r.color + '20', color: r.color, fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>{r.label}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <button onClick={saveKpi}
              style={{ background: kpiSaved ? '#10b981' : '#0f172a', color: 'white', border: 'none', borderRadius: '10px', padding: '12px 32px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Save size={18} />{kpiSaved ? '✓ נשמר!' : 'שמור יעדים'}
            </button>
          </>
        )}

        {/* ══ עלויות קבועות ════════════════════════════════════════════════ */}
        {tab === 'costs' && (
          <>
            {/* כותרת + פילטר חודש */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
              <input type="month" value={costMonth} onChange={e => setCostMonth(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', background: 'white', fontFamily: 'inherit' }} />
              <button onClick={copyFromPrevMonth}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                📋 העתק מחודש קודם
              </button>
              <div style={{ marginRight: 'auto', fontWeight: '800', fontSize: '16px', color: '#0f172a' }}>
                סה"כ: {fmtM(totalFixedCosts)}
              </div>
            </div>

            {/* הוספה מהירה */}
            <div style={{ ...S.card, marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת עלות קבועה</h2>

              {/* כפתורי ברירת מחדל */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '14px' }}>
                {DEFAULT_FIXED_COSTS.map(name => (
                  <button key={name} onClick={() => setNewCostName(name)}
                    style={{ background: newCostName === name ? '#0f172a' : '#f1f5f9', color: newCostName === name ? 'white' : '#64748b', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {name}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                <div style={{ flex: 2, display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שם הסעיף</label>
                  <input type="text" placeholder="שם עלות..." value={newCostName}
                    onChange={e => setNewCostName(e.target.value)}
                    style={S.input} />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>סכום חודשי (₪)</label>
                  <input type="number" placeholder="0" value={newCostAmount}
                    onChange={e => setNewCostAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCost()}
                    style={{ ...S.input, textAlign: 'right' as const }} />
                </div>
                <button onClick={addCost} disabled={loadingCost || !newCostName || !newCostAmount}
                  style={{ background: loadingCost || !newCostName || !newCostAmount ? '#e2e8f0' : '#0f172a', color: loadingCost || !newCostName || !newCostAmount ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' as const }}>
                  <Plus size={16} />הוסף
                </button>
              </div>
            </div>

            {/* רשימת עלויות */}
            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>סעיף</span><span style={{ textAlign: 'center' }}>סכום חודשי</span><span /><span />
              </div>

              {costs.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
                  אין עלויות לחודש זה — הוסף או העתק מחודש קודם
                </div>
              ) : costs.map((cost, i) => (
                <div key={cost.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', alignItems: 'center', padding: '13px 20px', borderBottom: i < costs.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editCostId === cost.id ? (
                    <>
                      <input type="text" value={editCostData.name || ''} onChange={e => setEditCostData({ ...editCostData, name: e.target.value })}
                        autoFocus style={{ border: '1.5px solid #0f172a', borderRadius: '8px', padding: '6px 10px', fontSize: '14px', fontFamily: 'inherit' }} />
                      <input type="number" value={editCostData.amount || ''} onChange={e => setEditCostData({ ...editCostData, amount: parseFloat(e.target.value) })}
                        style={{ border: '1.5px solid #0f172a', borderRadius: '8px', padding: '6px 10px', fontSize: '14px', textAlign: 'center' as const }} />
                      <button onClick={() => saveCost(cost.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={() => setEditCostId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{cost.name}</span>
                      <span style={{ textAlign: 'center', fontWeight: '700', color: '#0f172a', fontSize: '15px' }}>{fmtM(cost.amount)}</span>
                      <button onClick={() => { setEditCostId(cost.id); setEditCostData(cost) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteCost(cost.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              ))}

              {costs.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', padding: '14px 20px', background: '#f1f5f9', borderTop: '2px solid #e2e8f0', borderRadius: '0 0 20px 20px', fontWeight: '700' }}>
                  <span style={{ color: '#374151' }}>סה"כ — {costs.length} סעיפים</span>
                  <span style={{ textAlign: 'center', fontSize: '17px', color: '#0f172a' }}>{fmtM(totalFixedCosts)}</span>
                  <span /><span />
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ עובדים ══════════════════════════════════════════════════════ */}
        {tab === 'employees' && (
          <>
            {/* פילטר מחלקה + הוספה */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' as const }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setDeptFilter('all')}
                  style={{ background: deptFilter === 'all' ? '#0f172a' : '#f1f5f9', color: deptFilter === 'all' ? 'white' : '#64748b', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  הכל
                </button>
                {ALL_DEPTS.map(d => (
                  <button key={d.key} onClick={() => setDeptFilter(d.key)}
                    style={{ background: deptFilter === d.key ? '#0f172a' : '#f1f5f9', color: deptFilter === d.key ? 'white' : '#64748b', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                    {d.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAddEmp(v => !v)}
                style={{ marginRight: 'auto', background: showAddEmp ? '#64748b' : '#0f172a', color: 'white', border: 'none', borderRadius: '10px', padding: '9px 20px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={16} />{showAddEmp ? 'ביטול' : 'הוסף עובד'}
              </button>
            </div>

            {/* טופס הוספת עובד */}
            {showAddEmp && (
              <div style={{ ...S.card, marginBottom: '20px', borderTop: '3px solid #0f172a' }}>
                <h3 style={{ margin: '0 0 18px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>עובד חדש</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
                    <label style={S.label}>שם מלא</label>
                    <input type="text" placeholder="שם עובד..." value={newEmp.name || ''}
                      onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))} style={S.input} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                    <label style={S.label}>מחלקה</label>
                    <select value={newEmp.department || 'creams'} onChange={e => setNewEmp(p => ({ ...p, department: e.target.value }))}
                      style={{ ...S.input, background: 'white' }}>
                      {ALL_DEPTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                    <label style={S.label}>סוג שכר</label>
                    <select value={newEmp.salary_type || 'hourly'} onChange={e => setNewEmp(p => ({ ...p, salary_type: e.target.value as any }))}
                      style={{ ...S.input, background: 'white' }}>
                      <option value="hourly">שעתי</option>
                      <option value="global">גלובלי</option>
                    </select>
                  </div>
                  {newEmp.salary_type === 'hourly' ? (
                    <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                      <label style={S.label}>שכר שעתי (₪)</label>
                      <input type="number" placeholder="0" value={newEmp.hourly_rate || ''}
                        onChange={e => setNewEmp(p => ({ ...p, hourly_rate: parseFloat(e.target.value) || null }))}
                        style={{ ...S.input, textAlign: 'right' as const }} />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                      <label style={S.label}>שכר חודשי (₪)</label>
                      <input type="number" placeholder="0" value={newEmp.monthly_salary || ''}
                        onChange={e => setNewEmp(p => ({ ...p, monthly_salary: parseFloat(e.target.value) || null }))}
                        style={{ ...S.input, textAlign: 'right' as const }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                    <label style={S.label}>בונוס (₪) <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                    <input type="number" placeholder="0" value={newEmp.bonus || ''}
                      onChange={e => setNewEmp(p => ({ ...p, bonus: parseFloat(e.target.value) || null }))}
                      style={{ ...S.input, textAlign: 'right' as const }} />
                  </div>
                </div>
                <button onClick={addEmployee} disabled={loadingEmp || !newEmp.name}
                  style={{ background: loadingEmp || !newEmp.name ? '#e2e8f0' : '#0f172a', color: loadingEmp || !newEmp.name ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Plus size={18} />הוסף עובד
                </button>
              </div>
            )}

            {/* רשימת עובדים */}
            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 120px 100px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>שם</span><span>מחלקה</span><span>סוג</span><span style={{ textAlign: 'center' }}>שכר</span><span style={{ textAlign: 'center' }}>בונוס</span><span /><span />
              </div>

              {filteredEmps.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין עובדים</div>
              ) : filteredEmps.map((emp, i) => (
                <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 120px 100px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: i < filteredEmps.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editEmpId === emp.id ? (
                    <>
                      <input type="text" value={editEmpData.name || ''} onChange={e => setEditEmpData(p => ({ ...p, name: e.target.value }))} autoFocus style={{ border: '1.5px solid #0f172a', borderRadius: '8px', padding: '5px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                      <select value={editEmpData.department || ''} onChange={e => setEditEmpData(p => ({ ...p, department: e.target.value }))} style={{ border: '1px solid #0f172a', borderRadius: '6px', padding: '5px 6px', fontSize: '12px', fontFamily: 'inherit' }}>
                        {ALL_DEPTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                      </select>
                      <select value={editEmpData.salary_type || ''} onChange={e => setEditEmpData(p => ({ ...p, salary_type: e.target.value as any }))} style={{ border: '1px solid #0f172a', borderRadius: '6px', padding: '5px 6px', fontSize: '12px', fontFamily: 'inherit' }}>
                        <option value="hourly">שעתי</option>
                        <option value="global">גלובלי</option>
                      </select>
                      <input type="number" value={editEmpData.salary_type === 'global' ? (editEmpData.monthly_salary || '') : (editEmpData.hourly_rate || '')} onChange={e => setEditEmpData(p => p.salary_type === 'global' ? { ...p, monthly_salary: parseFloat(e.target.value) } : { ...p, hourly_rate: parseFloat(e.target.value) })} style={{ border: '1px solid #0f172a', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', textAlign: 'center' as const }} />
                      <input type="number" value={editEmpData.bonus || ''} onChange={e => setEditEmpData(p => ({ ...p, bonus: parseFloat(e.target.value) || null }))} style={{ border: '1px solid #0f172a', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', textAlign: 'center' as const }} />
                      <button onClick={() => saveEmployee(emp.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={() => setEditEmpId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{emp.name}</span>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>{ALL_DEPTS.find(d => d.key === emp.department)?.label || emp.department}</span>
                      <span style={{ fontSize: '12px', background: emp.salary_type === 'hourly' ? '#dbeafe' : '#d1fae5', color: emp.salary_type === 'hourly' ? '#1d4ed8' : '#065f46', padding: '2px 8px', borderRadius: '20px', fontWeight: '600', textAlign: 'center' }}>
                        {emp.salary_type === 'hourly' ? 'שעתי' : 'גלובלי'}
                      </span>
                      <span style={{ textAlign: 'center', fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>
                        {emp.salary_type === 'hourly'
                          ? (emp.hourly_rate ? `₪${emp.hourly_rate}/ש׳` : '—')
                          : (emp.monthly_salary ? fmtM(emp.monthly_salary) : '—')}
                      </span>
                      <span style={{ textAlign: 'center', color: '#f59e0b', fontWeight: '600', fontSize: '13px' }}>
                        {emp.bonus ? fmtM(emp.bonus) : '—'}
                      </span>
                      <button onClick={() => { setEditEmpId(emp.id); setEditEmpData(emp) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteEmployee(emp.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              ))}

              {filteredEmps.length > 0 && (
                <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderRadius: '0 0 20px 20px', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                  {filteredEmps.length} עובדים
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}