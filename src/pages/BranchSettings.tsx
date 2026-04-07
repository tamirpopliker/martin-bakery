import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { ArrowRight, Save, Plus, Pencil, Trash2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import DataImport from './DataImport'

// ─── types ────────────────────────────────────────────────────────────────
interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

type Tab = 'kpi' | 'costs' | 'employees' | 'import'

interface BranchKpi {
  id?: number
  branch_id: number
  labor_pct: number
  waste_pct: number
  revenue_target: number
  basket_target: number
  transaction_target: number
  controllable_margin_pct: number
}

interface FixedCost {
  id: number
  name: string
  amount: number
  month: string
}

interface BranchEmployee {
  id: number
  branch_id: number
  name: string
  active: boolean
}

const DEFAULT_FIXED_COSTS = ['ארנונה', 'שכירות', 'גז', 'חשמל', 'מים', 'אינטרנט', 'ביטוח']

function fmtM(n: number) { return '₪' + Math.round(n || 0).toLocaleString() }

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── component ────────────────────────────────────────────────────────────────
export default function BranchSettings({ branchId, branchName, branchColor, onBack }: Props) {
  const { appUser } = useAppUser()
  const isAdmin = appUser?.role === 'admin'

  const allowedTabs: Tab[] = isAdmin
    ? ['kpi', 'costs', 'employees', 'import']
    : ['employees']

  const [tab, setTab] = useState<Tab>(isAdmin ? 'kpi' : 'employees')

  // ── KPI ──
  const [kpi, setKpi] = useState<BranchKpi>({ branch_id: branchId, labor_pct: 0, waste_pct: 3, revenue_target: 0, basket_target: 0, transaction_target: 0, controllable_margin_pct: 0 })
  const [kpiSaved, setKpiSaved] = useState(false)

  // ── fixed costs ──
  const [costs, setCosts]             = useState<FixedCost[]>([])
  const [costMonth, setCostMonth]     = useState(new Date().toISOString().slice(0, 7))
  const [newCostName, setNewCostName] = useState('')
  const [newCostAmt, setNewCostAmt]   = useState('')
  const [editCostId, setEditCostId]   = useState<number | null>(null)
  const [editCostData, setEditCostData] = useState<Partial<FixedCost>>({})
  const [loadingCost, setLoadingCost] = useState(false)

  // ── employees ──
  const [employees, setEmployees] = useState<BranchEmployee[]>([])
  const [newEmpName, setNewEmpName] = useState('')
  const [editEmpId, setEditEmpId] = useState<number | null>(null)
  const [editEmpData, setEditEmpData] = useState<Partial<BranchEmployee>>({})
  const [loadingEmp, setLoadingEmp] = useState(false)

  const entityType = `branch_${branchId}`

  // ─── fetches ──────────────────────────────────────────────────────────────
  async function fetchKpi() {
    const { data } = await supabase.from('branch_kpi_targets').select('*').eq('branch_id', branchId).maybeSingle()
    if (data) setKpi(data)
  }

  async function fetchCosts() {
    const { data } = await supabase.from('fixed_costs').select('*')
      .eq('month', costMonth).eq('entity_type', entityType).order('name')
    if (data) setCosts(data)
  }

  async function fetchEmployees() {
    const { data } = await supabase.from('branch_employees').select('*')
      .eq('branch_id', branchId).order('name')
    if (data) setEmployees(data)
  }

  useEffect(() => { fetchKpi(); fetchEmployees() }, [branchId])
  useEffect(() => { fetchCosts() }, [costMonth, branchId])

  // ─── KPI save ─────────────────────────────────────────────────────────────
  async function saveKpi() {
    const payload = {
      branch_id: branchId, labor_pct: kpi.labor_pct, waste_pct: kpi.waste_pct,
      revenue_target: kpi.revenue_target, basket_target: kpi.basket_target, transaction_target: kpi.transaction_target,
      controllable_margin_pct: kpi.controllable_margin_pct
    }
    const { data, error } = await supabase.from('branch_kpi_targets')
      .upsert(payload, { onConflict: 'branch_id' })
      .select().single()
    if (error) {
      console.error('saveKpi error:', error)
      if (kpi.id) {
        await supabase.from('branch_kpi_targets').update({
          labor_pct: kpi.labor_pct, waste_pct: kpi.waste_pct, revenue_target: kpi.revenue_target,
          basket_target: kpi.basket_target, transaction_target: kpi.transaction_target,
          controllable_margin_pct: kpi.controllable_margin_pct
        }).eq('id', kpi.id)
      } else {
        const { data: ins } = await supabase.from('branch_kpi_targets').insert(payload).select().single()
        if (ins) setKpi(ins)
      }
    } else if (data) {
      setKpi(data)
    }
    setKpiSaved(true)
    setTimeout(() => setKpiSaved(false), 2000)
  }

  // ─── fixed costs CRUD ───────────────────────────────────────────────────
  async function addCost() {
    if (!newCostName || !newCostAmt) return
    setLoadingCost(true)
    await supabase.from('fixed_costs').insert({
      name: newCostName, amount: parseFloat(newCostAmt),
      month: costMonth, entity_type: entityType, entity_id: entityType
    })
    setNewCostName(''); setNewCostAmt('')
    await fetchCosts()
    setLoadingCost(false)
  }

  async function saveCost(id: number) {
    await supabase.from('fixed_costs').update(editCostData).eq('id', id)
    setEditCostId(null); await fetchCosts()
  }

  async function deleteCost(id: number) {
    if (!confirm('למחוק עלות זו?')) return
    await supabase.from('fixed_costs').delete().eq('id', id)
    await fetchCosts()
  }

  async function copyFromPrev() {
    const [y, m] = costMonth.split('-').map(Number)
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    const { data } = await supabase.from('fixed_costs').select('*').eq('month', prev).eq('entity_type', entityType)
    if (!data || data.length === 0) { alert('אין עלויות בחודש הקודם'); return }
    setLoadingCost(true)
    for (const c of data) {
      await supabase.from('fixed_costs').insert({ name: c.name, amount: c.amount, month: costMonth, entity_type: entityType, entity_id: entityType })
    }
    await fetchCosts()
    setLoadingCost(false)
  }

  // ─── employees CRUD ──────────────────────────────────────────────────────
  async function addEmployee() {
    const name = newEmpName.trim()
    if (!name) return
    setLoadingEmp(true)
    await supabase.from('branch_employees').insert({ branch_id: branchId, name, active: true })
    setNewEmpName('')
    await fetchEmployees()
    setLoadingEmp(false)
  }

  async function saveEmployee(id: number) {
    await supabase.from('branch_employees').update(editEmpData).eq('id', id)
    setEditEmpId(null); await fetchEmployees()
  }

  async function deleteEmployee(id: number) {
    if (!confirm('למחוק עובד?')) return
    await supabase.from('branch_employees').delete().eq('id', id)
    await fetchEmployees()
  }

  async function toggleActive(emp: BranchEmployee) {
    await supabase.from('branch_employees').update({ active: !emp.active }).eq('id', emp.id)
    await fetchEmployees()
  }

  // ─── calculations ──────────────────────────────────────────────────────
  const totalCosts = costs.reduce((s, c) => s + Number(c.amount), 0)
  const activeEmps = employees.filter(e => e.active)

  // ─── styles ──────────────────────────────────────────────────────────────
  const S = {
    label: { fontSize: 13, fontWeight: 600 as const, color: '#64748b', marginBottom: 6, display: 'block' as const },
    input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, background: 'white' },
  }

  const tabItems: { key: Tab; label: string }[] = [
    { key: 'kpi', label: 'יעדי KPI' },
    { key: 'costs', label: 'עלויות קבועות' },
    { key: 'employees', label: 'עובדים' },
    { key: 'import', label: 'ייבוא נתונים' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>

      <PageHeader title="הגדרות סניף" subtitle={branchName} onBack={onBack} />

      {/* Tabs */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '0 20px', display: 'flex', gap: 0 }}>
        {tabItems.filter(t => allowedTabs.includes(t.key)).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid #6366f1' : '2px solid transparent', padding: '12px 16px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? '#6366f1' : '#64748b', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: '20px', maxWidth: 800, margin: '0 auto' }}>

        {/* restricted tab guard */}
        {!allowedTabs.includes(tab) && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', marginBottom: 16 }}>אין לך הרשאה</p>
            <button onClick={() => setTab('employees')} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', fontSize: 13, color: '#64748b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowRight size={14} /> חזרה לעובדים
            </button>
          </div>
        )}

        {/* KPI Targets */}
        {tab === 'kpi' && allowedTabs.includes('kpi') && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20, background: 'white', borderRadius: 12, padding: '12px 16px', border: '1px solid #f1f5f9' }}>
              יעדים ניתנים לעדכון - יש להגדיר יעד לייבור לכל סניף, ברירת מחדל פחת 3%
            </div>

            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 24, marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 22px', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>יעדי KPI - {branchName}</h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                <div>
                  <label style={S.label}>יעד % לייבור מהכנסות</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="number" min={0} max={100} step={0.5}
                      value={kpi.labor_pct}
                      onChange={e => setKpi(p => ({ ...p, labor_pct: parseFloat(e.target.value) || 0 }))}
                      style={{ ...S.input, width: 100, textAlign: 'center' as const }} />
                    <span style={{ fontSize: 14, color: '#64748b' }}>%</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>נמוך = טוב</span>
                </div>

                <div>
                  <label style={S.label}>יעד % פחת מהכנסות</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="number" min={0} max={100} step={0.5}
                      value={kpi.waste_pct}
                      onChange={e => setKpi(p => ({ ...p, waste_pct: parseFloat(e.target.value) || 0 }))}
                      style={{ ...S.input, width: 100, textAlign: 'center' as const }} />
                    <span style={{ fontSize: 14, color: '#64748b' }}>%</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>נמוך = טוב</span>
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>
                    יעד % רווח נשלט
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number" step="0.5" min="0" max="100"
                      value={kpi.controllable_margin_pct}
                      onChange={e => setKpi(p => ({ ...p, controllable_margin_pct: parseFloat(e.target.value) || 0 }))}
                      style={{ width: 80, textAlign: 'center', fontSize: 14, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}
                    />
                    <span style={{ color: '#94a3b8', fontSize: 13 }}>%</span>
                  </div>
                  <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>גבוה = טוב</p>
                </div>

                <div>
                  <label style={S.label}>יעד הכנסות חודשי (₪)</label>
                  <input type="number" min={0} step={1000}
                    value={kpi.revenue_target}
                    onChange={e => setKpi(p => ({ ...p, revenue_target: parseFloat(e.target.value) || 0 }))}
                    style={{ ...S.input, width: 160, textAlign: 'right' as const }} />
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>גבוה = טוב</span>
                </div>

                <div>
                  <label style={S.label}>יעד סל ממוצע (₪)</label>
                  <input type="number" min={0} step={1}
                    value={kpi.basket_target}
                    onChange={e => setKpi(p => ({ ...p, basket_target: parseFloat(e.target.value) || 0 }))}
                    style={{ ...S.input, width: 120, textAlign: 'right' as const }} />
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>גבוה = טוב</span>
                </div>

                <div>
                  <label style={S.label}>יעד עסקאות יומי</label>
                  <input type="number" min={0} step={1}
                    value={kpi.transaction_target}
                    onChange={e => setKpi(p => ({ ...p, transaction_target: parseInt(e.target.value) || 0 }))}
                    style={{ ...S.input, width: 120, textAlign: 'right' as const }} />
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>גבוה = טוב</span>
                </div>
              </div>
            </div>

            <button onClick={saveKpi}
              style={{ background: kpiSaved ? '#34d399' : '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Save size={16} />{kpiSaved ? 'נשמר!' : 'שמור יעדים'}
            </button>
          </motion.div>
        )}

        {/* Fixed Costs */}
        {tab === 'costs' && allowedTabs.includes('costs') && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
              <input type="month" value={costMonth} onChange={e => setCostMonth(e.target.value)}
                style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 14px', fontSize: 14, background: 'white', fontFamily: 'inherit' }} />
              <button onClick={copyFromPrev}
                style={{ background: 'none', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                העתק מחודש קודם
              </button>
              <div style={{ marginRight: 'auto', fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
                סה"כ: {fmtM(totalCosts)}
              </div>
            </div>

            {/* Add cost */}
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 24, marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>הוספת עלות קבועה</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 14 }}>
                {DEFAULT_FIXED_COSTS.map(name => (
                  <button key={name} onClick={() => setNewCostName(name)}
                    style={{ background: newCostName === name ? '#6366f1' : '#f1f5f9', color: newCostName === name ? 'white' : '#64748b', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {name}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 2, display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שם הסעיף</label>
                  <input type="text" placeholder="שם עלות..." value={newCostName}
                    onChange={e => setNewCostName(e.target.value)} style={S.input} />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>סכום חודשי (₪)</label>
                  <input type="number" placeholder="0" value={newCostAmt}
                    onChange={e => setNewCostAmt(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCost()}
                    style={{ ...S.input, textAlign: 'right' as const }} />
                </div>
                <button onClick={addCost} disabled={loadingCost || !newCostName || !newCostAmt}
                  style={{ background: loadingCost || !newCostName || !newCostAmt ? '#e2e8f0' : '#6366f1', color: loadingCost || !newCostName || !newCostAmt ? '#94a3b8' : 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const }}>
                  <Plus size={16} />הוסף
                </button>
              </div>
            </div>

            {/* Costs list */}
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>
                <span>סעיף</span><span style={{ textAlign: 'center' }}>סכום חודשי</span><span /><span />
              </div>

              {costs.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                  אין עלויות לחודש זה - הוסף או העתק מחודש קודם
                </div>
              ) : costs.map((cost, i) => (
                <div key={cost.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', alignItems: 'center', padding: '13px 20px', borderBottom: '1px solid #f8fafc' }}>
                  {editCostId === cost.id ? (
                    <>
                      <input type="text" value={editCostData.name || ''} onChange={e => setEditCostData({ ...editCostData, name: e.target.value })} autoFocus style={{ border: '1px solid #6366f1', borderRadius: 8, padding: '6px 10px', fontSize: 14, fontFamily: 'inherit' }} />
                      <input type="number" value={editCostData.amount || ''} onChange={e => setEditCostData({ ...editCostData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #6366f1', borderRadius: 8, padding: '6px 10px', fontSize: 14, textAlign: 'center' as const }} />
                      <button onClick={() => saveCost(cost.id)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>&#10003;</button>
                      <button onClick={() => setEditCostId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>&#10005;</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: 600, color: '#374151', fontSize: 14 }}>{cost.name}</span>
                      <span style={{ textAlign: 'center', fontWeight: 700, color: '#0f172a', fontSize: 15 }}>{fmtM(cost.amount)}</span>
                      <button onClick={() => { setEditCostId(cost.id); setEditCostData(cost) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteCost(cost.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              ))}

              {costs.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', padding: '14px 20px', background: '#fafafa', borderTop: '1px solid #f1f5f9', fontWeight: 700 }}>
                  <span style={{ color: '#374151' }}>סה"כ - {costs.length} סעיפים</span>
                  <span style={{ textAlign: 'center', fontSize: 15, color: '#0f172a' }}>{fmtM(totalCosts)}</span>
                  <span /><span />
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Employees */}
        {tab === 'employees' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16, background: 'white', borderRadius: 12, padding: '12px 16px', border: '1px solid #f1f5f9' }}>
              רשימת עובדים קבועים - משמשת לאוטוקומפליט בהזנת לייבור
            </div>

            {/* Add employee */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input type="text" placeholder="שם עובד חדש..." value={newEmpName}
                onChange={e => setNewEmpName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEmployee()}
                style={{ ...S.input, flex: 1 }} />
              <button onClick={addEmployee} disabled={loadingEmp || !newEmpName.trim()}
                style={{ background: loadingEmp || !newEmpName.trim() ? '#e2e8f0' : '#6366f1', color: loadingEmp || !newEmpName.trim() ? '#94a3b8' : 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const }}>
                <Plus size={16} />הוסף עובד
              </button>
            </div>

            {/* Employee list */}
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 36px 36px', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>
                <span>#</span><span>שם</span><span style={{ textAlign: 'center' }}>סטטוס</span><span /><span />
              </div>

              {employees.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>לא הוגדרו עובדים</div>
              ) : employees.map((emp, i) => (
                <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f8fafc', opacity: emp.active ? 1 : 0.5 }}>
                  {editEmpId === emp.id ? (
                    <>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{i + 1}</span>
                      <input type="text" value={editEmpData.name || ''} onChange={e => setEditEmpData({ ...editEmpData, name: e.target.value })}
                        autoFocus style={{ border: '1px solid #6366f1', borderRadius: 8, padding: '6px 10px', fontSize: 14, fontFamily: 'inherit' }} />
                      <span />
                      <button onClick={() => saveEmployee(emp.id)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>&#10003;</button>
                      <button onClick={() => setEditEmpId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>&#10005;</button>
                    </>
                  ) : (
                    <>
                      <span style={{ width: 28, height: 28, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#64748b' }}>{i + 1}</span>
                      <span style={{ fontWeight: 600, color: '#374151', fontSize: 14 }}>{emp.name}</span>
                      <button onClick={() => toggleActive(emp)}
                        style={{ background: emp.active ? '#f0fdf4' : '#fef2f2', color: emp.active ? '#34d399' : '#ef4444', border: 'none', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        {emp.active ? 'פעיל' : 'לא פעיל'}
                      </button>
                      <button onClick={() => { setEditEmpId(emp.id); setEditEmpData(emp) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteEmployee(emp.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              ))}

              {employees.length > 0 && (
                <div style={{ padding: '12px 20px', background: '#fafafa', borderTop: '1px solid #f1f5f9', fontSize: 13, color: '#64748b', fontWeight: 600 }}>
                  {activeEmps.length} פעילים מתוך {employees.length} עובדים
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Data Import */}
        {tab === 'import' && allowedTabs.includes('import') && (
          <DataImport onBack={() => setTab('kpi')} />
        )}

      </div>
    </div>
  )
}
