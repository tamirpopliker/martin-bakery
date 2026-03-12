import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, Settings, Save, Plus, Pencil, Trash2, Users, Target, DollarSign, Database } from 'lucide-react'
import DataImport from './DataImport'

// ─── טיפוסים ────────────────────────────────────────────────────────────────
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

// ─── קומפוננטה ────────────────────────────────────────────────────────────────
export default function BranchSettings({ branchId, branchName, branchColor, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('kpi')

  // ── KPI ──
  const [kpi, setKpi] = useState<BranchKpi>({ branch_id: branchId, labor_pct: 28, waste_pct: 3, revenue_target: 0, basket_target: 0, transaction_target: 0 })
  const [kpiSaved, setKpiSaved] = useState(false)

  // ── עלויות קבועות ──
  const [costs, setCosts]             = useState<FixedCost[]>([])
  const [costMonth, setCostMonth]     = useState(new Date().toISOString().slice(0, 7))
  const [newCostName, setNewCostName] = useState('')
  const [newCostAmt, setNewCostAmt]   = useState('')
  const [editCostId, setEditCostId]   = useState<number | null>(null)
  const [editCostData, setEditCostData] = useState<Partial<FixedCost>>({})
  const [loadingCost, setLoadingCost] = useState(false)

  // ── עובדים ──
  const [employees, setEmployees] = useState<BranchEmployee[]>([])
  const [newEmpName, setNewEmpName] = useState('')
  const [editEmpId, setEditEmpId] = useState<number | null>(null)
  const [editEmpData, setEditEmpData] = useState<Partial<BranchEmployee>>({})
  const [loadingEmp, setLoadingEmp] = useState(false)

  const entityType = `branch_${branchId}`

  // ─── שליפות ──────────────────────────────────────────────────────────────
  async function fetchKpi() {
    const { data } = await supabase.from('branch_kpi_targets').select('*').eq('branch_id', branchId).single()
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
    if (kpi.id) {
      await supabase.from('branch_kpi_targets').update({
        labor_pct: kpi.labor_pct, waste_pct: kpi.waste_pct, revenue_target: kpi.revenue_target,
        basket_target: kpi.basket_target, transaction_target: kpi.transaction_target
      }).eq('id', kpi.id)
    } else {
      const { data } = await supabase.from('branch_kpi_targets').insert({
        branch_id: branchId, labor_pct: kpi.labor_pct, waste_pct: kpi.waste_pct, revenue_target: kpi.revenue_target,
        basket_target: kpi.basket_target, transaction_target: kpi.transaction_target
      }).select().single()
      if (data) setKpi(data)
    }
    setKpiSaved(true)
    setTimeout(() => setKpiSaved(false), 2000)
  }

  // ─── עלויות קבועות CRUD ───────────────────────────────────────────────────
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

  // ─── עובדים CRUD ──────────────────────────────────────────────────────────
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

  // ─── חישובים ──────────────────────────────────────────────────────────────
  const totalCosts = costs.reduce((s, c) => s + Number(c.amount), 0)
  const activeEmps = employees.filter(e => e.active)

  // ─── סגנונות ──────────────────────────────────────────────────────────────
  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={S.page}>

      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Settings size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>הגדרות סניף — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>יעדי KPI · עלויות קבועות · עובדים</p>
        </div>
      </div>

      {/* ─── טאבים ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', padding: '0 32px', background: 'white', borderBottom: '1px solid #e2e8f0' }}>
        {([
          ['kpi',       '🎯 יעדי KPI',       Target],
          ['costs',     '💰 עלויות קבועות',  DollarSign],
          ['employees', '👷 עובדים',          Users],
          ['import',    '📥 ייבוא נתונים',  Database],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as Tab)}
            style={{ padding: '14px 22px', background: 'none', border: 'none', borderBottom: tab === key ? `3px solid ${branchColor}` : '3px solid transparent', cursor: 'pointer', fontSize: '14px', fontWeight: tab === key ? '700' : '500', color: tab === key ? branchColor : '#64748b' }}>
            {label}
          </button>
        ))}
      </div>

      <div className="page-container" style={{ padding: '28px 32px', maxWidth: '800px', margin: '0 auto' }}>

        {/* ══ יעדי KPI ════════════════════════════════════════════════════ */}
        {tab === 'kpi' && (
          <>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
              💡 יעדים ניתנים לעדכון — ערכי ברירת מחדל: לייבור 28%, פחת 3%
            </div>

            <div style={{ ...S.card, marginBottom: '20px', borderTop: `4px solid ${branchColor}` }}>
              <h3 style={{ margin: '0 0 22px', fontSize: '16px', fontWeight: '800', color: branchColor }}>יעדי KPI — {branchName}</h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                {/* לייבור */}
                <div>
                  <label style={S.label}>יעד % לייבור מהכנסות</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="number" min={0} max={100} step={0.5}
                      value={kpi.labor_pct}
                      onChange={e => setKpi(p => ({ ...p, labor_pct: parseFloat(e.target.value) || 0 }))}
                      style={{ ...S.input, width: '100px', textAlign: 'center' as const }} />
                    <span style={{ fontSize: '14px', color: '#64748b' }}>%</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginTop: '4px' }}>נמוך = טוב</span>
                </div>

                {/* פחת */}
                <div>
                  <label style={S.label}>יעד % פחת מהכנסות</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="number" min={0} max={100} step={0.5}
                      value={kpi.waste_pct}
                      onChange={e => setKpi(p => ({ ...p, waste_pct: parseFloat(e.target.value) || 0 }))}
                      style={{ ...S.input, width: '100px', textAlign: 'center' as const }} />
                    <span style={{ fontSize: '14px', color: '#64748b' }}>%</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginTop: '4px' }}>נמוך = טוב</span>
                </div>

                {/* יעד הכנסות */}
                <div>
                  <label style={S.label}>יעד הכנסות חודשי (₪)</label>
                  <input type="number" min={0} step={1000}
                    value={kpi.revenue_target}
                    onChange={e => setKpi(p => ({ ...p, revenue_target: parseFloat(e.target.value) || 0 }))}
                    style={{ ...S.input, width: '160px', textAlign: 'right' as const }} />
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginTop: '4px' }}>גבוה = טוב</span>
                </div>

                {/* יעד סל ממוצע */}
                <div>
                  <label style={S.label}>יעד סל ממוצע (₪)</label>
                  <input type="number" min={0} step={1}
                    value={kpi.basket_target}
                    onChange={e => setKpi(p => ({ ...p, basket_target: parseFloat(e.target.value) || 0 }))}
                    style={{ ...S.input, width: '120px', textAlign: 'right' as const }} />
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginTop: '4px' }}>גבוה = טוב</span>
                </div>

                {/* יעד עסקאות */}
                <div>
                  <label style={S.label}>יעד עסקאות יומי</label>
                  <input type="number" min={0} step={1}
                    value={kpi.transaction_target}
                    onChange={e => setKpi(p => ({ ...p, transaction_target: parseInt(e.target.value) || 0 }))}
                    style={{ ...S.input, width: '120px', textAlign: 'right' as const }} />
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginTop: '4px' }}>גבוה = טוב</span>
                </div>
              </div>
            </div>

            <button onClick={saveKpi}
              style={{ background: kpiSaved ? '#10b981' : branchColor, color: 'white', border: 'none', borderRadius: '10px', padding: '12px 32px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Save size={18} />{kpiSaved ? '✓ נשמר!' : 'שמור יעדים'}
            </button>
          </>
        )}

        {/* ══ עלויות קבועות ════════════════════════════════════════════════ */}
        {tab === 'costs' && (
          <>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
              <input type="month" value={costMonth} onChange={e => setCostMonth(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', background: 'white', fontFamily: 'inherit' }} />
              <button onClick={copyFromPrev}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                📋 העתק מחודש קודם
              </button>
              <div style={{ marginRight: 'auto', fontWeight: '800', fontSize: '16px', color: '#0f172a' }}>
                סה"כ: {fmtM(totalCosts)}
              </div>
            </div>

            {/* הוספה מהירה */}
            <div style={{ ...S.card, marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת עלות קבועה</h2>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '14px' }}>
                {DEFAULT_FIXED_COSTS.map(name => (
                  <button key={name} onClick={() => setNewCostName(name)}
                    style={{ background: newCostName === name ? branchColor : '#f1f5f9', color: newCostName === name ? 'white' : '#64748b', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {name}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
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
                  style={{ background: loadingCost || !newCostName || !newCostAmt ? '#e2e8f0' : branchColor, color: loadingCost || !newCostName || !newCostAmt ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' as const }}>
                  <Plus size={16} />הוסף
                </button>
              </div>
            </div>

            {/* רשימה */}
            <div className="table-scroll"><div style={S.card}>
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
                      <input type="text" value={editCostData.name || ''} onChange={e => setEditCostData({ ...editCostData, name: e.target.value })} autoFocus style={{ border: '1.5px solid ' + branchColor, borderRadius: '8px', padding: '6px 10px', fontSize: '14px', fontFamily: 'inherit' }} />
                      <input type="number" value={editCostData.amount || ''} onChange={e => setEditCostData({ ...editCostData, amount: parseFloat(e.target.value) })} style={{ border: '1.5px solid ' + branchColor, borderRadius: '8px', padding: '6px 10px', fontSize: '14px', textAlign: 'center' as const }} />
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 36px 36px', padding: '14px 20px', background: branchColor + '15', borderTop: `2px solid ${branchColor}33`, borderRadius: '0 0 20px 20px', fontWeight: '700' }}>
                  <span style={{ color: '#374151' }}>סה"כ — {costs.length} סעיפים</span>
                  <span style={{ textAlign: 'center', fontSize: '17px', color: branchColor }}>{fmtM(totalCosts)}</span>
                  <span /><span />
                </div>
              )}
            </div></div>
          </>
        )}

        {/* ══ עובדים ════════════════════════════════════════════════════════ */}
        {tab === 'employees' && (
          <>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
              💡 רשימת עובדים קבועים — משמשת לאוטוקומפליט בהזנת לייבור
            </div>

            {/* הוספה */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input type="text" placeholder="שם עובד חדש..." value={newEmpName}
                onChange={e => setNewEmpName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEmployee()}
                style={{ ...S.input, flex: 1 }} />
              <button onClick={addEmployee} disabled={loadingEmp || !newEmpName.trim()}
                style={{ background: loadingEmp || !newEmpName.trim() ? '#e2e8f0' : branchColor, color: loadingEmp || !newEmpName.trim() ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' as const }}>
                <Plus size={16} />הוסף עובד
              </button>
            </div>

            {/* רשימה */}
            <div className="table-scroll"><div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>#</span><span>שם</span><span style={{ textAlign: 'center' }}>סטטוס</span><span /><span />
              </div>

              {employees.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>לא הוגדרו עובדים</div>
              ) : employees.map((emp, i) => (
                <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: i < employees.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa', opacity: emp.active ? 1 : 0.5 }}>
                  {editEmpId === emp.id ? (
                    <>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>{i + 1}</span>
                      <input type="text" value={editEmpData.name || ''} onChange={e => setEditEmpData({ ...editEmpData, name: e.target.value })}
                        autoFocus style={{ border: '1.5px solid ' + branchColor, borderRadius: '8px', padding: '6px 10px', fontSize: '14px', fontFamily: 'inherit' }} />
                      <span />
                      <button onClick={() => saveEmployee(emp.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={() => setEditEmpId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ width: '28px', height: '28px', background: branchColor + '15', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', color: branchColor }}>{i + 1}</span>
                      <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{emp.name}</span>
                      <button onClick={() => toggleActive(emp)}
                        style={{ background: emp.active ? '#f0fdf4' : '#fef2f2', color: emp.active ? '#10b981' : '#ef4444', border: 'none', borderRadius: '20px', padding: '3px 10px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
                        {emp.active ? 'פעיל' : 'לא פעיל'}
                      </button>
                      <button onClick={() => { setEditEmpId(emp.id); setEditEmpData(emp) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteEmployee(emp.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              ))}

              {employees.length > 0 && (
                <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderRadius: '0 0 20px 20px', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                  {activeEmps.length} פעילים מתוך {employees.length} עובדים
                </div>
              )}
            </div></div>
          </>
        )}

        {/* ══ ייבוא נתונים ═══════════════════════════════════════════════ */}
        {tab === 'import' && (
          <DataImport onBack={() => setTab('kpi')} />
        )}

      </div>
    </div>
  )
}
