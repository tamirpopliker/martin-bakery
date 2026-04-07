import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Plus, Pencil, Trash2, Save, Settings, Users, Target, DollarSign, Database, Download, Calendar } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import DataImport from './DataImport'
import DataExport from './DataExport'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
interface Props { onBack: () => void }

type Tab = 'kpi' | 'costs' | 'import' | 'export'
type Dept = 'creams' | 'dough'

interface KpiTarget {
  id?: number
  department: Dept
  labor_pct: number
  waste_pct: number
  repairs_pct: number
  gross_profit_pct: number
  production_pct: number
  operating_profit_pct: number
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
  employee_number: string | null
  department: string
  wage_type: 'hourly' | 'global'
  hourly_rate: number | null
  global_daily_rate: number | null
  bonus: number | null
  active: boolean
}

// ─── Animation variants ─────────────────────────────────────────────────────
const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── קבועים ─────────────────────────────────────────────────────────────────
const DEPTS: { key: Dept; label: string; color: string }[] = [
  { key: 'creams', label: 'קרמים', color: '#818cf8' },
  { key: 'dough',  label: 'בצקים', color: '#c084fc' },
]

const ALL_DEPTS = [
  { key: 'creams',    label: 'קרמים' },
  { key: 'dough',     label: 'בצקים' },
  { key: 'packaging', label: 'אריזה' },
  { key: 'cleaning',  label: 'ניקיון/נהג' },
]


const DEFAULT_FIXED_COSTS: { name: string; amount: number }[] = [
  { name: 'אינטרנט',       amount: 400 },
  { name: 'ארנונה',        amount: 7500 },
  { name: 'ביטוח',         amount: 6000 },
  { name: 'גז',            amount: 5000 },
  { name: 'חשמל',          amount: 18000 },
  { name: 'מים',            amount: 2000 },
  { name: 'משגיח כשרות',   amount: 2000 },
  { name: 'פינוי קרטוניה', amount: 400 },
  { name: 'שכירות',        amount: 60000 },
  { name: 'שמירה',         amount: 2000 },
]

const KPI_FIELDS: { key: keyof KpiTarget; label: string; higher: boolean; hint: string }[] = [
  { key: 'labor_pct',       label: 'לייבור / הכנסות %',     higher: false, hint: 'נמוך יותר = טוב יותר' },
  { key: 'waste_pct',       label: 'פחת / הכנסות %',        higher: false, hint: 'נמוך יותר = טוב יותר' },
  { key: 'repairs_pct',     label: 'תיקונים / הכנסות %',    higher: false, hint: 'נמוך יותר = טוב יותר' },
  { key: 'gross_profit_pct',label: 'רווח נשלט %',          higher: true,  hint: 'גבוה יותר = טוב יותר' },
  { key: 'production_pct',  label: 'ייצור / הכנסות %',      higher: false, hint: 'נמוך יותר = טוב יותר' },
  { key: 'operating_profit_pct', label: 'רווח תפעולי %',   higher: true,  hint: 'גבוה יותר = טוב יותר' },
]

function fmtM(n: number) { return '₪' + Math.round(n || 0).toLocaleString() }

// ─── קומפוננטה ראשית ─────────────────────────────────────────────────────────
export default function FactorySettings({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('kpi')

  // ── KPI ──
  const [kpiTargets, setKpiTargets] = useState<Record<Dept, KpiTarget>>({
    creams: { department: 'creams', labor_pct: 25, waste_pct: 5, repairs_pct: 3, gross_profit_pct: 40, production_pct: 45, operating_profit_pct: 30 },
    dough:  { department: 'dough',  labor_pct: 25, waste_pct: 5, repairs_pct: 3, gross_profit_pct: 40, production_pct: 45, operating_profit_pct: 30 },
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
  const [newEmp, setNewEmp]         = useState<Partial<Employee>>({ wage_type: 'hourly', department: 'creams' })
  const [loadingEmp, setLoadingEmp] = useState(false)

  // ── ימי עבודה ──
  interface WorkingDaysRow { id: number; month: string; amount: number }
  const [wageFilter, setWageFilter] = useState<'all' | 'hourly' | 'global'>('all')
  const [wdMonth, setWdMonth]             = useState(new Date().toISOString().slice(0, 7))
  const [workingDays, setWorkingDays]     = useState<WorkingDaysRow[]>([])
  const [editWdId, setEditWdId]           = useState<number | null>(null)
  const [editWdVal, setEditWdVal]         = useState(26)
  const [newWdMonth, setNewWdMonth]       = useState('')
  const [newWdCount, setNewWdCount]       = useState(26)

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


  async function fetchWorkingDays() {
    const { data } = await supabase
      .from('fixed_costs')
      .select('id, month, amount')
      .eq('entity_type', 'working_days')
      .order('month', { ascending: false })
    if (data) setWorkingDays(data as WorkingDaysRow[])
  }

  useEffect(() => { fetchKpi(); fetchEmployees(); fetchWorkingDays() }, [])
  useEffect(() => { fetchCosts() }, [costMonth])

  // ─── KPI save ────────────────────────────────────────────────────────────
  async function saveKpi() {
    for (const dept of DEPTS) {
      const target = kpiTargets[dept.key]
      const { id, department, ...fields } = target as KpiTarget & { id?: number }
      if (id) {
        await supabase.from('kpi_targets').update(fields).eq('id', id)
      } else {
        const { data } = await supabase.from('kpi_targets').insert({ department: dept.key, ...fields }).select().single()
        if (data) setKpiTargets(prev => ({ ...prev, [dept.key]: data }))
      }
    }
    await fetchKpi()
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

  async function loadDefaults() {
    if (costs.length > 0 && !confirm('כבר קיימות עלויות לחודש זה. לטעון ברירות מחדל בנוסף?')) return
    setLoadingCost(true)
    const existingNames = new Set(costs.map(c => c.name))
    for (const d of DEFAULT_FIXED_COSTS) {
      if (!existingNames.has(d.name)) {
        await supabase.from('fixed_costs').insert({
          name: d.name, amount: d.amount,
          month: costMonth, entity_type: 'factory', entity_id: 'factory'
        })
      }
    }
    await fetchCosts()
    setLoadingCost(false)
  }

  // ─── עובדים CRUD ─────────────────────────────────────────────────────────
  async function addEmployee() {
    if (!newEmp.name || !newEmp.department || !newEmp.wage_type) return
    setLoadingEmp(true)
    await supabase.from('employees').insert({
      name: newEmp.name,
      employee_number: newEmp.employee_number || null,
      department: newEmp.department,
      wage_type: newEmp.wage_type,
      hourly_rate: newEmp.wage_type === 'hourly' ? (newEmp.hourly_rate || null) : null,
      global_daily_rate: newEmp.wage_type === 'global' ? (newEmp.global_daily_rate || null) : null,
      bonus: newEmp.bonus || null
    })
    setNewEmp({ wage_type: 'hourly', department: 'creams' })
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

  async function toggleActive(emp: Employee) {
    await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id)
    await fetchEmployees()
  }

  // ─── ימי עבודה CRUD ──────────────────────────────────────────────────────
  async function addWorkingDay() {
    if (!newWdMonth) return
    await supabase.from('fixed_costs').insert({
      entity_type: 'working_days', entity_id: 'factory',
      name: 'ימי עבודה', month: newWdMonth, amount: newWdCount,
    })
    setNewWdMonth('')
    setNewWdCount(26)
    await fetchWorkingDays()
  }

  async function saveWorkingDay(id: number) {
    await supabase.from('fixed_costs').update({ amount: editWdVal }).eq('id', id)
    setEditWdId(null)
    await fetchWorkingDays()
  }

  async function deleteWorkingDay(id: number) {
    if (!confirm('למחוק?')) return
    await supabase.from('fixed_costs').delete().eq('id', id)
    await fetchWorkingDays()
  }

  // ─── חישובים ─────────────────────────────────────────────────────────────
  const totalFixedCosts = costs.reduce((s, c) => s + Number(c.amount), 0)
  const filteredEmps = employees.filter(e => {
    if (wageFilter !== 'all' && e.wage_type !== wageFilter) return false
    if (deptFilter !== 'all' && e.department !== deptFilter) return false
    return true
  })

  // ─── סגנונות ─────────────────────────────────────────────────────────────
  const S = {
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      <PageHeader title="הגדרות מפעל" onBack={onBack} />

      {/* ─── טאבים ───────────────────────────────────────────────────────── */}
      <div className="flex px-8 bg-white border-b border-slate-200">
        {([
          ['kpi',              'יעדי KPI',       Target],
          ['costs',            'עלויות קבועות',  DollarSign],
          ['import',           'ייבוא נתונים',  Database],
          ['export',           'ייצוא נתונים',  Download],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as Tab)}
            className={`py-3.5 px-5 bg-transparent border-0 border-b-[3px] cursor-pointer text-sm ${tab === key ? 'font-bold text-slate-900 border-b-slate-500' : 'font-medium text-slate-500 border-b-transparent'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="page-container" style={{ padding: '28px 32px', maxWidth: '960px', margin: '0 auto' }}>

        {/* KPI targets */}
        {tab === 'kpi' && (
          <>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
              יעדים נפרדים לקרמים ולבצקים. 4 רמות צבע: תקין · סביר · חריגה · קריטי
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              {DEPTS.map(dept => (
                <Card key={dept.key} className="shadow-sm" style={{ borderTop: `4px solid ${dept.color}` }}>
                  <CardContent className="p-6">
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
                            { label: '±0%', color: '#34d399' },
                            { label: '±3%', color: '#fbbf24' },
                            { label: '±7%', color: '#f97316' },
                            { label: '>7%', color: '#fb7185' },
                          ].map(r => (
                            <span key={r.label} style={{ background: r.color + '20', color: r.color, fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>{r.label}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  </CardContent>
                </Card>
              ))}
            </div>

            <button onClick={saveKpi}
              style={{ background: kpiSaved ? '#34d399' : '#0f172a', color: 'white', border: 'none', borderRadius: '10px', padding: '12px 32px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Save size={18} />{kpiSaved ? '✓ נשמר!' : 'שמור יעדים'}
            </button>
          </>
        )}

        {/* Fixed costs */}
        {tab === 'costs' && (
          <>
            {/* כותרת + פילטר חודש */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
              <input type="month" value={costMonth} onChange={e => setCostMonth(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', background: 'white', fontFamily: 'inherit' }} />
              <button onClick={loadDefaults} disabled={loadingCost}
                style={{ background: '#0f172a', color: 'white', border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                טען ברירות מחדל
              </button>
              <button onClick={copyFromPrevMonth}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                העתק מחודש קודם
              </button>
              <div style={{ marginRight: 'auto', fontWeight: '800', fontSize: '16px', color: '#0f172a' }}>
                סה"כ: {fmtM(totalFixedCosts)}
              </div>
            </div>

            {/* הוספה מהירה */}
            <Card className="shadow-sm mb-5">
              <CardContent className="p-6">
              <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת עלות קבועה</h2>

              {/* כפתורי ברירת מחדל */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '14px' }}>
                {DEFAULT_FIXED_COSTS.map(d => (
                  <button key={d.name} onClick={() => { setNewCostName(d.name); setNewCostAmount(String(d.amount)) }}
                    style={{ background: newCostName === d.name ? '#0f172a' : '#f1f5f9', color: newCostName === d.name ? 'white' : '#64748b', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {d.name}
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
              </CardContent>
            </Card>

            {/* רשימת עלויות */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm">
              <CardContent className="p-6">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>סעיף</span><span style={{ textAlign: 'center' }}>סכום חודשי</span><span /><span />
              </div>

              {costs.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
                  <div style={{ marginBottom: '16px' }}>אין עלויות לחודש זה</div>
                  <button onClick={loadDefaults} disabled={loadingCost}
                    style={{ background: '#0f172a', color: 'white', border: 'none', borderRadius: '12px', padding: '12px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', marginLeft: '8px' }}>
                    טען ברירות מחדל ({fmtM(DEFAULT_FIXED_COSTS.reduce((s, d) => s + d.amount, 0))})
                  </button>
                  <button onClick={copyFromPrevMonth}
                    style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '12px', padding: '12px 28px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>
                    העתק מחודש קודם
                  </button>
                </div>
              ) : costs.map((cost, i) => (
                <div key={cost.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', alignItems: 'center', padding: '13px 20px', borderBottom: i < costs.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editCostId === cost.id ? (
                    <>
                      <input type="text" value={editCostData.name || ''} onChange={e => setEditCostData({ ...editCostData, name: e.target.value })}
                        autoFocus style={{ border: '1.5px solid #0f172a', borderRadius: '8px', padding: '6px 10px', fontSize: '14px', fontFamily: 'inherit' }} />
                      <input type="number" value={editCostData.amount || ''} onChange={e => setEditCostData({ ...editCostData, amount: parseFloat(e.target.value) })}
                        style={{ border: '1.5px solid #0f172a', borderRadius: '8px', padding: '6px 10px', fontSize: '14px', textAlign: 'center' as const }} />
                      <button onClick={() => saveCost(cost.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={() => setEditCostId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{cost.name}</span>
                      <span style={{ textAlign: 'center', fontWeight: '700', color: '#0f172a', fontSize: '15px' }}>{fmtM(cost.amount)}</span>
                      <button onClick={() => { setEditCostId(cost.id); setEditCostData(cost) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteCost(cost.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#fb7185" /></button>
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
              </CardContent>
            </Card>
            </motion.div>
          </>
        )}

        {/* Data import */}
        {tab === 'import' && (
          <DataImport onBack={() => setTab('kpi')} />
        )}

        {/* Data export */}
        {tab === 'export' && (
          <DataExport />
        )}

      </div>
    </div>
  )
}
