import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { supabase, monthEnd } from '../lib/supabase'
import { calculateBranchPL } from '../lib/calculatePL'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import PageHeader from '../components/PageHeader'
import { Plus, Trash2, Check, X, Save, Award } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────
interface Props { onBack: () => void }

type KpiSource = 'auto' | 'manual'
type KpiKind = 'higher_better' | 'lower_better' | 'binary'

// One row in the per-branch model (and the per-month snapshot extends this).
interface KpiParam {
  id: string
  name: string
  weight: number
  source: KpiSource
  kind: KpiKind
  target_field?: string  // branch_kpi_targets column (when source='auto')
}

// Runtime row: param + computed/entered values + bonus result
interface KpiRow extends KpiParam {
  target_value: number | null
  actual_value: number | string | null   // number for auto, 'YES'/'NO' for binary
  achieved_pct: number       // 0-...
  achieved: boolean
  bonus: number
}

interface BonusModel {
  branch_id: number
  base_amount: number
  threshold_pct: number
  parameters: KpiParam[]
}

interface BonusMonthly {
  id: number
  branch_id: number
  month: string
  status: 'draft' | 'approved'
  manager_name: string
  base_amount: number
  threshold_pct: number
  parameters: KpiRow[]
  total_bonus: number
  approved_by: string | null
  approved_at: string | null
}

interface KpiTargets {
  revenue_target: number | null
  labor_pct: number | null
  waste_pct: number | null
  basket_target: number | null
  controllable_margin_pct: number | null
  transaction_target: number | null
}

// Client-side default model — used when no branch_bonus_models row exists yet
// for the branch (e.g. before sql/055 ran or for a newly-created branch).
// Mirrors the SQL seed so the page is usable out of the box.
const DEFAULT_PARAMETERS: KpiParam[] = [
  { id: 'sales',   name: 'מכירות',                  weight: 25,  source: 'auto',   kind: 'higher_better', target_field: 'revenue_target' },
  { id: 'labor',   name: 'ממוצע לייבור',            weight: 25,  source: 'auto',   kind: 'lower_better',  target_field: 'labor_pct' },
  { id: 'waste',   name: 'פחת ממוצע',               weight: 10,  source: 'auto',   kind: 'lower_better',  target_field: 'waste_pct' },
  { id: 'basket',  name: 'סל ממוצע',                weight: 25,  source: 'auto',   kind: 'higher_better', target_field: 'basket_target' },
  { id: 'mystery', name: 'לקוח סמוי/דוח מנהל',       weight: 7.5, source: 'manual', kind: 'binary' },
  { id: 'safety',  name: 'ביקורות בטיחות מזון וניקיון', weight: 7.5, source: 'manual', kind: 'binary' },
]

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const TARGET_FIELD_LABELS: Record<string, string> = {
  revenue_target: 'הכנסות (₪)',
  labor_pct: '% לייבור',
  waste_pct: '% פחת',
  basket_target: 'סל ממוצע (₪)',
  controllable_margin_pct: '% רווח נשלט',
  transaction_target: 'עסקאות יומי',
}

const fmt = (n: number, frac = 0) => Math.round(n * Math.pow(10, frac)) / Math.pow(10, frac)
const fmtMoney = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

// ─── Component ──────────────────────────────────────────────────────────────
export default function BonusKPI({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const isAdmin = appUser?.role === 'admin'

  const now = new Date()
  const initialDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [year, setYear] = useState(initialDate.getFullYear())
  const [month, setMonth] = useState(initialDate.getMonth() + 1)
  const monthKey = `${year}-${String(month).padStart(2, '0')}`

  const [branchId, setBranchId] = useState<number | null>(null)
  const [monthly, setMonthly] = useState<BonusMonthly | null>(null)
  const [managerName, setManagerName] = useState('')
  const [baseAmount, setBaseAmount] = useState(2000)
  const [thresholdPct, setThresholdPct] = useState(97)
  const [parameters, setParameters] = useState<KpiParam[]>([])
  const [autoActuals, setAutoActuals] = useState<{ revenue: number; labor_pct: number; waste_pct: number; basket: number; controllable_margin_pct: number; daily_tx: number } | null>(null)
  const [targets, setTargets] = useState<KpiTargets | null>(null)
  const [manualValues, setManualValues] = useState<Record<string, 'YES' | 'NO'>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAddKpi, setShowAddKpi] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Default to first branch
  useEffect(() => {
    if (branches.length > 0 && branchId === null) setBranchId(branches[0].id)
  }, [branches, branchId])

  // Load everything for the (branch, month) pair
  useEffect(() => {
    if (!branchId) return
    loadBranch(branchId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, monthKey])

  async function loadBranch(bId: number) {
    setLoading(true)
    setDirty(false)
    setManualValues({})
    try {
      const [
        { data: branchRow },
        { data: modelRow },
        { data: monthlyRow },
        { data: kpiTargetRow },
      ] = await Promise.all([
        supabase.from('branches').select('manager_name').eq('id', bId).maybeSingle(),
        supabase.from('branch_bonus_models').select('*').eq('branch_id', bId).maybeSingle(),
        supabase.from('branch_bonus_monthly').select('*').eq('branch_id', bId).eq('month', monthKey).maybeSingle(),
        supabase.from('branch_kpi_targets').select('revenue_target, labor_pct, waste_pct, basket_target, controllable_margin_pct, transaction_target').eq('branch_id', bId).maybeSingle(),
      ])

      const branchManager = (branchRow?.manager_name as string) || ''

      // Effective config: prefer existing monthly snapshot (so historical edits stay stable),
      // else use the live model, else fall back to a sensible default.
      const m = modelRow as BonusModel | null
      const mm = monthlyRow as BonusMonthly | null

      setMonthly(mm)
      setManagerName(mm?.manager_name || branchManager)
      setBaseAmount(Number(mm?.base_amount ?? m?.base_amount ?? 2000))
      setThresholdPct(Number(mm?.threshold_pct ?? m?.threshold_pct ?? 97))
      // Parameter precedence:
      //   1. monthly snapshot (stable history for already-approved/drafted months)
      //   2. current branch model
      //   3. client-side defaults (so the page works before sql/055 or for new branches)
      const params: KpiParam[] = (mm?.parameters as KpiRow[] | undefined)?.map(stripRuntime)
        || m?.parameters
        || DEFAULT_PARAMETERS
      setParameters(params)
      setTargets((kpiTargetRow as KpiTargets) || {
        revenue_target: null, labor_pct: null, waste_pct: null,
        basket_target: null, controllable_margin_pct: null, transaction_target: null,
      })

      // Restore manual YES/NO from the snapshot if present
      const mv: Record<string, 'YES' | 'NO'> = {}
      if (mm?.parameters) {
        for (const p of mm.parameters) if (p.source === 'manual') mv[p.id] = p.actual_value === 'YES' ? 'YES' : 'NO'
      }
      setManualValues(mv)

      // Compute auto actuals for the (branch, month) — uses canonical helpers.
      const from = `${monthKey}-01`
      const to = monthEnd(monthKey)
      const [pl, { data: closings }] = await Promise.all([
        calculateBranchPL(bId, from, to, undefined, monthKey),
        supabase.from('register_closings').select('date, transaction_count, cash_sales, credit_sales').eq('branch_id', bId).gte('date', from).lt('date', to),
      ])
      const txCount = (closings || []).reduce((s, c: any) => s + (Number(c.transaction_count) || 0), 0)
      const closingsRevenue = (closings || []).reduce((s, c: any) => s + (Number(c.cash_sales) || 0) + (Number(c.credit_sales) || 0), 0)
      const basketRevenue = closingsRevenue > 0 ? closingsRevenue : pl.revenue
      // Working days in the month for daily-tx target: distinct dates with any closing activity.
      const workingDays = new Set((closings || []).map((c: any) => c.date)).size
      setAutoActuals({
        revenue: pl.revenue,
        labor_pct: pl.revenue > 0 ? (pl.labor / pl.revenue) * 100 : 0,
        waste_pct: pl.revenue > 0 ? (pl.waste / pl.revenue) * 100 : 0,
        basket: txCount > 0 ? basketRevenue / txCount : 0,
        controllable_margin_pct: pl.revenue > 0 ? (pl.controllableProfit / pl.revenue) * 100 : 0,
        daily_tx: workingDays > 0 ? txCount / workingDays : 0,
      })
    } catch (err) {
      console.error('[BonusKPI] load failed', err)
    }
    setLoading(false)
  }

  // Strip runtime-only fields from a snapshot row when seeding the editable model.
  function stripRuntime(r: KpiRow): KpiParam {
    const { id, name, weight, source, kind, target_field } = r
    return { id, name, weight, source, kind, target_field }
  }

  // Resolve target value for an auto param.
  function resolveTarget(p: KpiParam): number | null {
    if (p.source !== 'auto' || !p.target_field || !targets) return null
    const v = (targets as any)[p.target_field]
    return v == null ? null : Number(v)
  }

  function resolveActual(p: KpiParam): number | string | null {
    if (p.source === 'manual') return manualValues[p.id] || 'NO'
    if (!autoActuals || !p.target_field) return null
    switch (p.target_field) {
      case 'revenue_target':           return autoActuals.revenue
      case 'labor_pct':                return autoActuals.labor_pct
      case 'waste_pct':                return autoActuals.waste_pct
      case 'basket_target':            return autoActuals.basket
      case 'controllable_margin_pct':  return autoActuals.controllable_margin_pct
      case 'transaction_target':       return autoActuals.daily_tx
      default:                         return null
    }
  }

  // Compute achievement % for one row using the screenshot's convention:
  //   higher_better: actual / target × 100
  //   lower_better:  target / actual × 100  (inverse — lower is better)
  //   binary:        YES → 100, NO → 0
  // Bonus = base × (weight/100) when achievement_pct ≥ threshold, else 0.
  const rows: KpiRow[] = useMemo(() => {
    return parameters.map(p => {
      const target = resolveTarget(p)
      const actual = resolveActual(p)
      let achieved_pct = 0
      if (p.kind === 'binary') {
        achieved_pct = actual === 'YES' ? 100 : 0
      } else if (target != null && typeof actual === 'number' && target > 0 && actual > 0) {
        achieved_pct = p.kind === 'higher_better'
          ? (actual / target) * 100
          : (target / actual) * 100
      }
      const achieved = achieved_pct >= thresholdPct
      const bonus = achieved ? (baseAmount * p.weight) / 100 : 0
      return { ...p, target_value: target, actual_value: actual, achieved_pct, achieved, bonus }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parameters, autoActuals, targets, manualValues, baseAmount, thresholdPct])

  const totalWeight = parameters.reduce((s, p) => s + Number(p.weight || 0), 0)
  const totalBonus = rows.reduce((s, r) => s + r.bonus, 0)
  const weightsValid = Math.abs(totalWeight - 100) < 0.01

  function updateParam(id: string, patch: Partial<KpiParam>) {
    setParameters(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
    setDirty(true)
  }
  function removeParam(id: string) {
    setParameters(prev => prev.filter(p => p.id !== id))
    setDirty(true)
  }
  function addParam(p: KpiParam) {
    setParameters(prev => [...prev, p])
    setDirty(true)
  }
  function setManual(id: string, v: 'YES' | 'NO') {
    setManualValues(prev => ({ ...prev, [id]: v }))
    setDirty(true)
  }

  async function saveModel() {
    if (!branchId || !weightsValid) return
    setSaving(true)
    const { error } = await supabase.from('branch_bonus_models').upsert({
      branch_id: branchId,
      base_amount: baseAmount,
      threshold_pct: thresholdPct,
      parameters: parameters as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id' })
    if (error) { alert('שמירת המודל נכשלה: ' + error.message); setSaving(false); return }
    // Also persist current manager_name on branches
    if (managerName) await supabase.from('branches').update({ manager_name: managerName }).eq('id', branchId)
    setSaving(false)
    setDirty(false)
    alert('המודל נשמר')
  }

  async function approve() {
    if (!branchId || !weightsValid) return
    if (!confirm(`לאשר בונוס של ${fmtMoney(totalBonus)} לחודש ${HEBREW_MONTHS[month - 1]} ${year}?`)) return
    setSaving(true)
    const snapshot = {
      branch_id: branchId,
      month: monthKey,
      status: 'approved' as const,
      manager_name: managerName,
      base_amount: baseAmount,
      threshold_pct: thresholdPct,
      parameters: rows as any,
      total_bonus: Math.round(totalBonus),
      approved_by: appUser?.email || null,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('branch_bonus_monthly').upsert(snapshot, { onConflict: 'branch_id,month' })
    if (error) { alert('אישור הבונוס נכשל: ' + error.message); setSaving(false); return }
    if (managerName) await supabase.from('branches').update({ manager_name: managerName }).eq('id', branchId)
    setSaving(false)
    setDirty(false)
    await loadBranch(branchId)
    alert(`הבונוס אושר ונשמר: ${fmtMoney(totalBonus)}`)
  }

  function changeMonth(delta: number) {
    let m = month + delta, y = year
    if (m > 12) { m = 1; y++ } else if (m < 1) { m = 12; y-- }
    setYear(y); setMonth(m)
  }

  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', direction: 'rtl' }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>הדף מיועד למשתמשי אדמין בלבד.</div>
      </div>
    )
  }

  const branchTabs = branches.filter(b => b.active !== false)

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="בונוס KPI מנהלי סניף" subtitle={`חודש ${HEBREW_MONTHS[month - 1]} ${year}`} onBack={onBack} />

      <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>

        {/* Month picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => changeMonth(-1)} style={btnStyle()}>‹ חודש קודם</button>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{HEBREW_MONTHS[month - 1]} {year}</div>
          <button onClick={() => changeMonth(1)} style={btnStyle()} disabled={year === now.getFullYear() && month === now.getMonth() + 1}>חודש הבא ›</button>
        </div>

        {/* Branch tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {branchTabs.map(b => (
            <button key={b.id} onClick={() => setBranchId(b.id)}
              style={{
                border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: branchId === b.id ? '#0f172a' : '#f1f5f9',
                color: branchId === b.id ? 'white' : '#475569',
              }}>
              {b.name}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>טוען...</div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>

            {/* Approval banner */}
            {monthly?.status === 'approved' && (
              <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#166534' }}>
                ✓ הבונוס לחודש זה אושר ב-{new Date(monthly.approved_at || '').toLocaleString('he-IL')} על-ידי {monthly.approved_by || '—'}. שינויים נוספים ידרסו את האישור.
              </div>
            )}

            {/* Manager + base + threshold panel */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 16, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="שם מנהל">
                <input type="text" value={managerName} onChange={e => { setManagerName(e.target.value); setDirty(true) }}
                  style={inputStyle()} />
              </Field>
              <Field label="בונוס בסיס (פוטנציאל)">
                <input type="number" value={baseAmount} onChange={e => { setBaseAmount(Number(e.target.value) || 0); setDirty(true) }}
                  style={inputStyle()} />
              </Field>
              <Field label="סף מינימלי לעמידה ביעד (%)">
                <input type="number" value={thresholdPct} onChange={e => { setThresholdPct(Number(e.target.value) || 0); setDirty(true) }}
                  style={inputStyle()} />
              </Field>
            </div>

            {/* KPI table */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '32px 1.6fr 90px 1fr 1fr 90px 90px 32px', padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                <span>#</span>
                <span>KPI</span>
                <span style={{ textAlign: 'center' }}>משקל</span>
                <span style={{ textAlign: 'center' }}>יעד</span>
                <span style={{ textAlign: 'center' }}>ביצוע</span>
                <span style={{ textAlign: 'center' }}>% עמידה</span>
                <span style={{ textAlign: 'center' }}>מענק</span>
                <span />
              </div>
              {rows.length === 0 && (
                <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>אין פרמטרים. לחץ "+ הוסף KPI" להתחיל.</div>
              )}
              {rows.map((r, i) => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '32px 1.6fr 90px 1fr 1fr 90px 90px 32px', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
                  <span style={{ color: '#94a3b8', fontWeight: 700 }}>{i + 1}</span>
                  <input type="text" value={r.name} onChange={e => updateParam(r.id, { name: e.target.value })}
                    style={{ ...inputStyle(), padding: '4px 8px' }} />
                  <input type="number" step="0.5" value={r.weight} onChange={e => updateParam(r.id, { weight: Number(e.target.value) || 0 })}
                    style={{ ...inputStyle(), padding: '4px 8px', textAlign: 'center', width: 80 }} />
                  <span style={{ textAlign: 'center', color: '#475569' }}>
                    {r.source === 'manual' ? '—'
                      : r.target_value != null ? (r.kind === 'higher_better' && r.target_field === 'revenue_target' ? fmtMoney(r.target_value) : `${fmt(r.target_value, 2)}${r.target_field?.includes('pct') ? '%' : r.target_field === 'basket_target' ? '₪' : ''}`)
                      : <span style={{ color: '#ef4444', fontSize: 11 }}>חסר יעד</span>}
                  </span>
                  <span style={{ textAlign: 'center' }}>
                    {r.source === 'manual' ? (
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <button onClick={() => setManual(r.id, 'YES')}
                          style={{ background: manualValues[r.id] === 'YES' ? '#10b981' : '#f1f5f9', color: manualValues[r.id] === 'YES' ? 'white' : '#64748b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>YES</button>
                        <button onClick={() => setManual(r.id, 'NO')}
                          style={{ background: manualValues[r.id] === 'NO' || !manualValues[r.id] ? '#ef4444' : '#f1f5f9', color: manualValues[r.id] === 'NO' || !manualValues[r.id] ? 'white' : '#64748b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>NO</button>
                      </div>
                    ) : (
                      typeof r.actual_value === 'number'
                        ? (r.target_field === 'revenue_target' ? fmtMoney(r.actual_value) : `${fmt(r.actual_value, 2)}${r.target_field?.includes('pct') ? '%' : r.target_field === 'basket_target' ? '₪' : ''}`)
                        : '—'
                    )}
                  </span>
                  <span style={{ textAlign: 'center', fontWeight: 700, color: r.achieved ? '#16a34a' : '#ef4444' }}>
                    {r.kind === 'binary' ? (r.actual_value === 'YES' ? 'YES' : 'NO') : `${fmt(r.achieved_pct, 0)}%`}
                  </span>
                  <span style={{ textAlign: 'center', fontWeight: 700, color: r.achieved ? '#16a34a' : '#94a3b8' }}>
                    {r.achieved ? fmtMoney(r.bonus) : '—'}
                  </span>
                  <button onClick={() => removeParam(r.id)} title="הסר" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    <Trash2 size={14} color="#ef4444" />
                  </button>
                </div>
              ))}
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => setShowAddKpi(true)} style={{ background: 'transparent', border: '1px dashed #cbd5e1', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', color: '#475569', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Plus size={14} /> הוסף KPI
                </button>
                <div style={{ display: 'flex', gap: 18, fontSize: 13, alignItems: 'center' }}>
                  <span style={{ color: weightsValid ? '#16a34a' : '#ef4444', fontWeight: 700 }}>
                    סך משקלים: {fmt(totalWeight, 1)}% {weightsValid ? '✓' : '(חייב להיות 100%)'}
                  </span>
                  <span style={{ fontWeight: 800, color: '#0f172a', fontSize: 16 }}>סה"כ בונוס: {fmtMoney(totalBonus)}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={saveModel} disabled={saving || !weightsValid || !dirty}
                style={{ background: weightsValid && dirty ? '#0f172a' : '#e2e8f0', color: weightsValid && dirty ? 'white' : '#94a3b8', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: weightsValid && dirty ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Save size={15} /> שמור מודל
              </button>
              <button onClick={approve} disabled={saving || !weightsValid}
                style={{ background: weightsValid ? '#f59e0b' : '#e2e8f0', color: weightsValid ? 'white' : '#94a3b8', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: weightsValid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Award size={15} /> אשר ושמור בונוס לחודש
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {showAddKpi && (
        <AddKpiModal
          onAdd={p => { addParam(p); setShowAddKpi(false) }}
          onClose={() => setShowAddKpi(false)}
        />
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

function btnStyle(): React.CSSProperties {
  return { background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#475569' }
}

function inputStyle(): React.CSSProperties {
  return { border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit' }
}

function AddKpiModal({ onAdd, onClose }: { onAdd: (p: KpiParam) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState(5)
  const [source, setSource] = useState<KpiSource>('manual')
  const [kind, setKind] = useState<KpiKind>('binary')
  const [targetField, setTargetField] = useState<string>('revenue_target')

  function submit() {
    if (!name.trim()) return
    onAdd({
      id: `custom_${Date.now()}`,
      name: name.trim(),
      weight,
      source,
      kind: source === 'manual' ? 'binary' : kind,
      target_field: source === 'auto' ? targetField : undefined,
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, direction: 'rtl' }}>
      <div style={{ background: 'white', borderRadius: 14, padding: 22, width: 420, boxShadow: '0 10px 30px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>הוסף KPI</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} color="#64748b" /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="שם המדד"><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="לדוגמה: רמת שביעות לקוחות" style={inputStyle()} autoFocus /></Field>
          <Field label="משקל (%)"><input type="number" step="0.5" value={weight} onChange={e => setWeight(Number(e.target.value) || 0)} style={inputStyle()} /></Field>
          <Field label="סוג נתונים">
            <select value={source} onChange={e => setSource(e.target.value as KpiSource)} style={inputStyle()}>
              <option value="manual">ידני (YES/NO)</option>
              <option value="auto">אוטומטי מהמערכת</option>
            </select>
          </Field>
          {source === 'auto' && (
            <>
              <Field label="מקור היעד">
                <select value={targetField} onChange={e => setTargetField(e.target.value)} style={inputStyle()}>
                  {Object.entries(TARGET_FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="כיוון">
                <select value={kind} onChange={e => setKind(e.target.value as KpiKind)} style={inputStyle()}>
                  <option value="higher_better">גבוה יותר = טוב יותר</option>
                  <option value="lower_better">נמוך יותר = טוב יותר</option>
                </select>
              </Field>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnStyle()}>ביטול</button>
          <button onClick={submit} disabled={!name.trim()}
            style={{ background: name.trim() ? '#0f172a' : '#e2e8f0', color: name.trim() ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} /> הוסף
          </button>
        </div>
      </div>
    </div>
  )
}
