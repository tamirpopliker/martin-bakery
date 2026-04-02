import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useBranches } from '../lib/BranchContext'
import { ArrowRight, Plus, Save, Bell, BellOff, History, AlertTriangle, ToggleLeft, ToggleRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// ─── Types ──────────────────────────────────────────────────────────────────
interface AlertRule {
  id: number
  name: string
  entity_type: 'branch' | 'factory'
  entity_id: string
  metric: string
  condition: string
  threshold: number
  threshold_type: string
  active: boolean
  created_at: string
}

interface AlertLogEntry {
  id: number
  rule_id: number
  triggered_at: string
  actual_value: number
  threshold_value: number
  email_sent: boolean
  recipient_emails: string[]
  rule_name?: string
}

// ─── Constants ──────────────────────────────────────────────────────────────
const METRICS = [
  { value: 'revenue', label: 'הכנסות' },
  { value: 'waste', label: 'פחת' },
  { value: 'labor_cost', label: 'עלות לייבור' },
  { value: 'production', label: 'ייצור' },
]

const CONDITIONS = [
  { value: 'below', label: 'מתחת ל-' },
  { value: 'above', label: 'מעל ל-' },
]

const THRESHOLD_TYPES = [
  { value: 'absolute', label: 'ערך מוחלט (₪)' },
  { value: 'percent', label: 'אחוז (%)' },
]

const DEPTS = [
  { value: 'creams', label: 'קרמים' },
  { value: 'dough', label: 'בצקים' },
  { value: 'packaging', label: 'אריזה' },
  { value: 'cleaning', label: 'ניקיון' },
]

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

const S = {
  label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', display: 'block', marginBottom: '6px' },
  input: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  select: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit', background: 'white' },
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function AlertsManagement({ onBack }: { onBack: () => void }) {
  const { branches } = useBranches()
  const [tab, setTab] = useState<'rules' | 'log'>('rules')
  const [rules, setRules] = useState<AlertRule[]>([])
  const [logEntries, setLogEntries] = useState<AlertLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    id: undefined as number | undefined,
    name: '',
    entity_type: 'branch' as 'branch' | 'factory',
    entity_id: '',
    metric: 'revenue',
    condition: 'below',
    threshold: '',
    threshold_type: 'absolute',
  })

  // Log filter
  const [logDays, setLogDays] = useState(7)

  // ─── Load data ──────────────────────────────────────────────────────────
  async function loadRules() {
    const { data } = await supabase.from('alert_rules').select('*').order('created_at', { ascending: false })
    setRules(data || [])
    setLoading(false)
  }

  async function loadLog() {
    const since = new Date()
    since.setDate(since.getDate() - logDays)
    const { data } = await supabase.from('alert_log')
      .select('*, alert_rules(name)')
      .gte('triggered_at', since.toISOString())
      .order('triggered_at', { ascending: false })
      .limit(100)
    setLogEntries((data || []).map((e: any) => ({
      ...e,
      rule_name: e.alert_rules?.name || `כלל #${e.rule_id}`,
    })))
  }

  useEffect(() => { loadRules() }, [])
  useEffect(() => { if (tab === 'log') loadLog() }, [tab, logDays])

  // ─── Handlers ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.name.trim() || !form.entity_id || !form.threshold) return
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      entity_type: form.entity_type,
      entity_id: form.entity_id,
      metric: form.metric,
      condition: form.condition,
      threshold: Number(form.threshold),
      threshold_type: form.threshold_type,
      active: true,
    }
    if (form.id) {
      await supabase.from('alert_rules').update(payload).eq('id', form.id)
    } else {
      await supabase.from('alert_rules').insert(payload)
    }
    setSaving(false)
    setSheetOpen(false)
    loadRules()
  }

  async function toggleActive(rule: AlertRule) {
    await supabase.from('alert_rules').update({ active: !rule.active }).eq('id', rule.id)
    loadRules()
  }

  function openNew() {
    setForm({
      id: undefined, name: '', entity_type: 'branch',
      entity_id: branches[0]?.id?.toString() || '1',
      metric: 'revenue', condition: 'below', threshold: '', threshold_type: 'absolute',
    })
    setSheetOpen(true)
  }

  function openEdit(rule: AlertRule) {
    setForm({
      id: rule.id, name: rule.name, entity_type: rule.entity_type,
      entity_id: rule.entity_id, metric: rule.metric, condition: rule.condition,
      threshold: String(rule.threshold), threshold_type: rule.threshold_type,
    })
    setSheetOpen(true)
  }

  // ─── Entity options based on type ─────────────────────────────────────
  const entityOptions = form.entity_type === 'branch'
    ? branches.map(b => ({ value: String(b.id), label: b.name }))
    : DEPTS

  function getEntityLabel(rule: AlertRule): string {
    if (rule.entity_type === 'branch') {
      const br = branches.find(b => b.id === Number(rule.entity_id))
      return br?.name || `סניף ${rule.entity_id}`
    }
    return DEPTS.find(d => d.value === rule.entity_id)?.label || rule.entity_id
  }

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} /> חזרה
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '40px', height: '40px', background: '#f59e0b', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bell size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: 0 }}>ניהול התראות</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>כללי התרעה · לוג · {rules.length} כללים</p>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'rules' && (
          <button onClick={openNew}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Plus size={16} /> הוסף התרעה
          </button>
        )}
      </div>

      <div style={{ padding: '28px 36px', maxWidth: '1100px', margin: '0 auto' }}>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {([
            { key: 'rules' as const, label: 'כללי התרעה', icon: AlertTriangle, count: rules.length },
            { key: 'log' as const, label: 'לוג התראות', icon: History, count: logEntries.length },
          ]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px', borderRadius: '12px', fontSize: '14px', fontWeight: '700',
                border: tab === t.key ? '2px solid #f59e0b' : '2px solid #e2e8f0',
                background: tab === t.key ? '#fffbeb' : 'white', color: tab === t.key ? '#b45309' : '#64748b',
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
              <t.icon size={16} />
              {t.label}
              <span style={{ background: tab === t.key ? '#f59e0b' : '#e2e8f0', color: tab === t.key ? 'white' : '#64748b', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '10px' }}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* ═══ RULES TAB ═══ */}
        {tab === 'rules' && (
          loading ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8', fontSize: '16px' }}>טוען...</div>
          ) : (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px 120px 100px 80px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                  <span>שם ההתרעה</span><span>ישות</span><span>מדד</span><span>תנאי</span><span>סף</span><span>סטטוס</span><span>פעולות</span>
                </div>
                {rules.length === 0 ? (
                  <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>
                    <Bell size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                    <div>אין כללי התרעה. לחץ "הוסף התרעה" כדי להתחיל.</div>
                  </div>
                ) : rules.map(rule => (
                  <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px 120px 100px 80px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px', opacity: rule.active ? 1 : 0.5 }}>
                    <span style={{ fontWeight: '600', color: '#0f172a' }}>{rule.name}</span>
                    <span style={{ color: '#64748b' }}>
                      <span style={{ fontSize: '10px', background: rule.entity_type === 'branch' ? '#dbeafe' : '#f3e8ff', color: rule.entity_type === 'branch' ? '#2563eb' : '#7c3aed', padding: '2px 6px', borderRadius: '4px', fontWeight: '600', marginLeft: '4px' }}>
                        {rule.entity_type === 'branch' ? 'סניף' : 'מפעל'}
                      </span>
                      {' '}{getEntityLabel(rule)}
                    </span>
                    <span style={{ color: '#64748b' }}>{METRICS.find(m => m.value === rule.metric)?.label}</span>
                    <span style={{ color: rule.condition === 'above' ? '#ef4444' : '#f59e0b', fontWeight: '600', fontSize: '12px' }}>
                      {CONDITIONS.find(c => c.value === rule.condition)?.label}
                    </span>
                    <span style={{ fontWeight: '700', color: '#374151' }}>
                      {rule.threshold_type === 'percent' ? `${rule.threshold}%` : `₪${Number(rule.threshold).toLocaleString()}`}
                    </span>
                    <span>
                      <button onClick={() => toggleActive(rule)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '600', color: rule.active ? '#34d399' : '#94a3b8' }}>
                        {rule.active ? <ToggleRight size={18} color="#34d399" /> : <ToggleLeft size={18} color="#94a3b8" />}
                        {rule.active ? 'פעיל' : 'מושבת'}
                      </button>
                    </span>
                    <button onClick={() => openEdit(rule)}
                      style={{ background: '#f1f5f9', color: '#818cf8', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                      ערוך
                    </button>
                  </div>
                ))}
              </Card>
            </motion.div>
          )
        )}

        {/* ═══ LOG TAB ═══ */}
        {tab === 'log' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>תקופה:</span>
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => setLogDays(d)}
                  style={{
                    padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                    border: logDays === d ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                    background: logDays === d ? '#fffbeb' : 'white', color: logDays === d ? '#b45309' : '#64748b',
                  }}>
                  {d} ימים
                </button>
              ))}
            </div>

            <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px 120px 80px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                <span>זמן</span><span>התרעה</span><span>ערך בפועל</span><span>סף</span><span>אימייל</span>
              </div>
              {logEntries.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>
                  אין התראות בתקופה הנבחרת
                </div>
              ) : logEntries.map(entry => (
                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px 120px 80px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' }}>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>
                    {new Date(entry.triggered_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
                  </span>
                  <span style={{ fontWeight: '600', color: '#0f172a' }}>{entry.rule_name}</span>
                  <span style={{ fontWeight: '700', color: '#ef4444' }}>₪{Number(entry.actual_value).toLocaleString()}</span>
                  <span style={{ color: '#64748b' }}>₪{Number(entry.threshold_value).toLocaleString()}</span>
                  <span style={{ fontSize: '14px', color: entry.email_sent ? '#34d399' : '#fb7185' }}>
                    {entry.email_sent ? '✓' : '✗'}
                  </span>
                </div>
              ))}
            </Card>
          </motion.div>
        )}

        {/* ═══ ADD/EDIT SHEET ═══ */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetPortal>
            <SheetBackdrop />
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{form.id ? 'עריכת התרעה' : 'התרעה חדשה'}</SheetTitle>
              </SheetHeader>
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={S.label}>שם ההתרעה</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder='למשל: "הכנסות נמוכות — אברהם אבינו"'
                    style={S.input} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={S.label}>סוג ישות</label>
                    <select value={form.entity_type} onChange={e => {
                      const et = e.target.value as 'branch' | 'factory'
                      setForm({
                        ...form,
                        entity_type: et,
                        entity_id: et === 'branch' ? (branches[0]?.id?.toString() || '1') : 'creams',
                      })
                    }} style={S.select}>
                      <option value="branch">סניף</option>
                      <option value="factory">מפעל (מחלקה)</option>
                    </select>
                  </div>
                  <div>
                    <label style={S.label}>{form.entity_type === 'branch' ? 'סניף' : 'מחלקה'}</label>
                    <select value={form.entity_id} onChange={e => setForm({ ...form, entity_id: e.target.value })} style={S.select}>
                      {entityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={S.label}>מדד</label>
                  <select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })} style={S.select}>
                    {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={S.label}>תנאי</label>
                    <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })} style={S.select}>
                      {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={S.label}>סוג סף</label>
                    <select value={form.threshold_type} onChange={e => setForm({ ...form, threshold_type: e.target.value })} style={S.select}>
                      {THRESHOLD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={S.label}>ערך סף</label>
                  <input type="number" value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })}
                    placeholder={form.threshold_type === 'percent' ? '25' : '5000'}
                    style={{ ...S.input, textAlign: 'left' as const }} />
                </div>

                <button onClick={handleSave}
                  disabled={saving || !form.name.trim() || !form.threshold}
                  style={{
                    background: saving || !form.name.trim() || !form.threshold ? '#e2e8f0' : '#f59e0b',
                    color: saving || !form.name.trim() || !form.threshold ? '#94a3b8' : 'white',
                    border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  }}>
                  <Save size={16} /> {saving ? 'שומר...' : form.id ? 'עדכן התרעה' : 'הוסף התרעה'}
                </button>
              </div>
            </SheetContent>
          </SheetPortal>
        </Sheet>

      </div>
    </div>
  )
}
