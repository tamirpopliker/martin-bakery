import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Pencil, Trash2, Save, X, UserCog, Store, ToggleLeft, ToggleRight, Bell, AlertTriangle, History } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useBranches } from '../lib/BranchContext'

interface AppUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'factory' | 'branch'
  branch_id: number | null
  excluded_departments: string[]
  can_settings: boolean
  auth_uid: string | null
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'אדמין',
  factory: 'מפעל',
  branch: 'סניף',
}

const DEPT_LABELS: Record<string, string> = {
  creams: 'קרמים',
  dough: 'בצקים',
  packaging: 'אריזה',
  cleaning: 'ניקיון',
}

const ALL_DEPTS = ['creams', 'dough', 'packaging', 'cleaning']

const ROLE_COLORS: Record<string, string> = {
  admin: '#c084fc',
  factory: '#818cf8',
  branch: '#34d399',
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── Alert types & constants ──────────────────────────────────────────────
interface AlertRule {
  id: number; name: string; entity_type: 'branch' | 'factory'; entity_id: string
  metric: string; condition: string; threshold: number; threshold_type: string; active: boolean; created_at: string
}
interface AlertLogEntry {
  id: number; rule_id: number; triggered_at: string; actual_value: number
  threshold_value: number; email_sent: boolean; recipient_emails: string[]; rule_name?: string
}
const ALERT_METRICS = [
  { value: 'revenue', label: 'הכנסות' }, { value: 'waste', label: 'פחת' },
  { value: 'labor_cost', label: 'עלות לייבור' }, { value: 'production', label: 'ייצור' },
]
const ALERT_CONDITIONS = [{ value: 'below', label: 'מתחת ל-' }, { value: 'above', label: 'מעל ל-' }]
const ALERT_THRESHOLD_TYPES = [{ value: 'absolute', label: 'ערך מוחלט (₪)' }, { value: 'percent', label: 'אחוז (%)' }]
const ALERT_DEPTS = [
  { value: 'creams', label: 'קרמים' }, { value: 'dough', label: 'בצקים' },
  { value: 'packaging', label: 'אריזה' }, { value: 'cleaning', label: 'ניקיון' },
]
const S_ALERT = {
  label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', display: 'block', marginBottom: '6px' },
  input: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  select: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit', background: 'white' },
}

export default function UserManagement({ onBack }: { onBack: () => void }) {
  const { branches, getBranchName, refreshBranches } = useBranches()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<AppUser>>({})
  const [addMode, setAddMode] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'branch' as string, branch_id: 1, excluded_departments: [] as string[], can_settings: false })
  const [saving, setSaving] = useState(false)
  // ─── Branch management state ──────────────────────────────────────────────
  const [tab, setTab] = useState<'users' | 'branches' | 'alerts'>('users')
  const [branchSheetOpen, setBranchSheetOpen] = useState(false)
  const [editBranch, setEditBranch] = useState<{ id?: number; name: string; short_name: string; address: string }>({ name: '', short_name: '', address: '' })
  const [branchSaving, setBranchSaving] = useState(false)
  // ─── Alerts state ─────────────────────────────────────────────────────────
  const [alertRules, setAlertRules] = useState<AlertRule[]>([])
  const [alertLog, setAlertLog] = useState<AlertLogEntry[]>([])
  const [alertSubTab, setAlertSubTab] = useState<'rules' | 'log'>('rules')
  const [alertSheetOpen, setAlertSheetOpen] = useState(false)
  const [alertSaving, setAlertSaving] = useState(false)
  const [alertLogDays, setAlertLogDays] = useState(7)
  const [alertForm, setAlertForm] = useState({
    id: undefined as number | undefined, name: '', entity_type: 'branch' as 'branch' | 'factory',
    entity_id: '', metric: 'revenue', condition: 'below', threshold: '', threshold_type: 'absolute',
  })

  async function loadUsers() {
    const { data } = await supabase.from('app_users').select('*').order('created_at')
    setUsers((data || []).map(u => ({ ...u, excluded_departments: u.excluded_departments || [] })))
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  async function handleSave(id: string) {
    setSaving(true)
    const update: any = { ...editData }
    if (update.role !== 'branch') update.branch_id = null
    if (update.role !== 'factory') update.excluded_departments = []
    if (update.role === 'admin') { update.can_settings = true; update.branch_id = null; update.excluded_departments = [] }
    await supabase.from('app_users').update(update).eq('id', id)
    setEditingId(null)
    setSaving(false)
    loadUsers()
  }

  async function handleAdd() {
    setSaving(true)
    const insert: any = { ...newUser, email: newUser.email.toLowerCase() }
    if (insert.role !== 'branch') insert.branch_id = null
    if (insert.role !== 'factory') insert.excluded_departments = []
    if (insert.role === 'admin') { insert.can_settings = true; insert.branch_id = null; insert.excluded_departments = [] }
    await supabase.from('app_users').insert(insert)
    setAddMode(false)
    setNewUser({ email: '', name: '', role: 'branch', branch_id: 1, excluded_departments: [], can_settings: false })
    setSaving(false)
    loadUsers()
  }

  async function handleDelete(id: string) {
    if (!confirm('האם למחוק את המשתמש?')) return
    await supabase.from('app_users').delete().eq('id', id)
    loadUsers()
  }

  function startEdit(user: AppUser) {
    setEditingId(user.id)
    setEditData({
      name: user.name,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id,
      excluded_departments: [...user.excluded_departments],
      can_settings: user.can_settings,
    })
  }

  function toggleExcludedDept(dept: string, target: 'edit' | 'new') {
    if (target === 'edit') {
      const arr = editData.excluded_departments || []
      setEditData({
        ...editData,
        excluded_departments: arr.includes(dept) ? arr.filter(d => d !== dept) : [...arr, dept],
      })
    } else {
      const arr = newUser.excluded_departments
      setNewUser({
        ...newUser,
        excluded_departments: arr.includes(dept) ? arr.filter(d => d !== dept) : [...arr, dept],
      })
    }
  }

  // ─── Alert functions ─────────────────────────────────────────────────────
  async function loadAlertRules() {
    const { data } = await supabase.from('alert_rules').select('*').order('created_at', { ascending: false })
    setAlertRules(data || [])
  }
  async function loadAlertLog() {
    const since = new Date(); since.setDate(since.getDate() - alertLogDays)
    const { data } = await supabase.from('alert_log')
      .select('*, alert_rules(name)')
      .gte('triggered_at', since.toISOString())
      .order('triggered_at', { ascending: false }).limit(100)
    setAlertLog((data || []).map((e: any) => ({ ...e, rule_name: e.alert_rules?.name || `כלל #${e.rule_id}` })))
  }
  useEffect(() => { if (tab === 'alerts') { loadAlertRules(); if (alertSubTab === 'log') loadAlertLog() } }, [tab, alertSubTab, alertLogDays])

  async function handleAlertSave() {
    if (!alertForm.name.trim() || !alertForm.entity_id || !alertForm.threshold) return
    setAlertSaving(true)
    const payload = {
      name: alertForm.name.trim(), entity_type: alertForm.entity_type, entity_id: alertForm.entity_id,
      metric: alertForm.metric, condition: alertForm.condition, threshold: Number(alertForm.threshold),
      threshold_type: alertForm.threshold_type, active: true,
    }
    if (alertForm.id) {
      await supabase.from('alert_rules').update(payload).eq('id', alertForm.id)
    } else {
      await supabase.from('alert_rules').insert(payload)
    }
    setAlertSaving(false); setAlertSheetOpen(false); loadAlertRules()
  }
  async function toggleAlertActive(rule: AlertRule) {
    await supabase.from('alert_rules').update({ active: !rule.active }).eq('id', rule.id); loadAlertRules()
  }
  function openNewAlert() {
    setAlertForm({ id: undefined, name: '', entity_type: 'branch', entity_id: branches[0]?.id?.toString() || '1', metric: 'revenue', condition: 'below', threshold: '', threshold_type: 'absolute' })
    setAlertSheetOpen(true)
  }
  function openEditAlert(rule: AlertRule) {
    setAlertForm({ id: rule.id, name: rule.name, entity_type: rule.entity_type, entity_id: rule.entity_id, metric: rule.metric, condition: rule.condition, threshold: String(rule.threshold), threshold_type: rule.threshold_type })
    setAlertSheetOpen(true)
  }
  function getAlertEntityLabel(rule: AlertRule): string {
    if (rule.entity_type === 'branch') { const br = branches.find(b => b.id === Number(rule.entity_id)); return br?.name || `סניף ${rule.entity_id}` }
    return ALERT_DEPTS.find(d => d.value === rule.entity_id)?.label || rule.entity_id
  }
  const alertEntityOptions = alertForm.entity_type === 'branch'
    ? branches.map(b => ({ value: String(b.id), label: b.name })) : ALERT_DEPTS

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '40px', height: '40px', background: '#c084fc', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserCog size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: 0 }}>ניהול מערכת</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>משתמשים · סניפים · התרעות</p>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'users' && !addMode && (
          <button onClick={() => setAddMode(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#c084fc', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Plus size={16} /> הוסף משתמש
          </button>
        )}
        {tab === 'branches' && (
          <button onClick={() => { setEditBranch({ name: '', short_name: '', address: '' }); setBranchSheetOpen(true) }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#818cf8', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Plus size={16} /> הוסף סניף
          </button>
        )}
        {tab === 'alerts' && alertSubTab === 'rules' && (
          <button onClick={openNewAlert}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Plus size={16} /> הוסף התרעה
          </button>
        )}
      </div>

      <div style={{ padding: '28px 36px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[
          { key: 'users' as const, label: 'משתמשים', icon: UserCog, count: users.length },
          { key: 'branches' as const, label: 'סניפים', icon: Store, count: branches.length },
          { key: 'alerts' as const, label: 'התרעות', icon: Bell, count: alertRules.length },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 20px', borderRadius: '12px', fontSize: '14px', fontWeight: '700',
              border: tab === t.key ? '2px solid #818cf8' : '2px solid #e2e8f0',
              background: tab === t.key ? '#eef2ff' : 'white', color: tab === t.key ? '#4f46e5' : '#64748b',
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
            <t.icon size={16} />
            {t.label}
            <span style={{ background: tab === t.key ? '#818cf8' : '#e2e8f0', color: tab === t.key ? 'white' : '#64748b', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '10px' }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ═══ USERS TAB ═══ */}
      {tab === 'users' && <>

      {/* Add user form */}
      {addMode && (
        <Card className="shadow-sm" style={{ marginBottom: '20px', border: '2px solid #c084fc' }}>
          <CardContent className="p-6">
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>משתמש חדש</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>שם</label>
                <input value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', direction: 'rtl', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>אימייל</label>
                <input value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', direction: 'ltr', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>תפקיד</label>
                <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', boxSizing: 'border-box' }}
                >
                  <option value="admin">אדמין</option>
                  <option value="factory">מפעל</option>
                  <option value="branch">סניף</option>
                </select>
              </div>
              {newUser.role === 'branch' && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>סניף</label>
                  <select value={newUser.branch_id} onChange={e => setNewUser({ ...newUser, branch_id: Number(e.target.value) })}
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', boxSizing: 'border-box' }}
                  >
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              {newUser.role === 'factory' && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>מחלקות חסומות</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {ALL_DEPTS.map(d => (
                      <button key={d} onClick={() => toggleExcludedDept(d, 'new')}
                        style={{
                          padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                          border: '1px solid',
                          background: newUser.excluded_departments.includes(d) ? '#fff1f2' : '#f0fdf4',
                          borderColor: newUser.excluded_departments.includes(d) ? '#fca5a5' : '#86efac',
                          color: newUser.excluded_departments.includes(d) ? '#fb7185' : '#34d399',
                        }}
                      >
                        {DEPT_LABELS[d]} {newUser.excluded_departments.includes(d) ? '✗' : '✓'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {newUser.role !== 'admin' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                  <input type="checkbox" checked={newUser.can_settings} onChange={e => setNewUser({ ...newUser, can_settings: e.target.checked })} />
                  <label style={{ fontSize: '13px', color: '#374151' }}>גישה להגדרות</label>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleAdd} disabled={saving || !newUser.name || !newUser.email}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#c084fc', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', opacity: saving || !newUser.name || !newUser.email ? 0.5 : 1 }}
              >
                <Save size={14} /> {saving ? 'שומר...' : 'שמור'}
              </button>
              <button onClick={() => setAddMode(false)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
              >
                <X size={14} /> ביטול
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8', fontSize: '16px' }}>טוען...</div>
      ) : (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <div className="table-scroll"><Card className="shadow-sm" style={{ overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '180px 200px 90px 160px 180px 80px 100px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
            <span>שם</span>
            <span>אימייל</span>
            <span>תפקיד</span>
            <span>ישות</span>
            <span>מחלקות חסומות</span>
            <span>הגדרות</span>
            <span>פעולות</span>
          </div>

          {users.map(user => (
            <div key={user.id} style={{ display: 'grid', gridTemplateColumns: '180px 200px 90px 160px 180px 80px 100px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' }}>
              {editingId === user.id ? (
                <>
                  {/* Editing mode */}
                  <input value={editData.name || ''} onChange={e => setEditData({ ...editData, name: e.target.value })}
                    style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', direction: 'rtl', width: '90%' }}
                  />
                  <input value={editData.email || ''} onChange={e => setEditData({ ...editData, email: e.target.value })}
                    style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', direction: 'ltr', width: '90%' }}
                  />
                  <select value={editData.role || 'branch'} onChange={e => setEditData({ ...editData, role: e.target.value as any })}
                    style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }}
                  >
                    <option value="admin">אדמין</option>
                    <option value="factory">מפעל</option>
                    <option value="branch">סניף</option>
                  </select>
                  <div>
                    {editData.role === 'branch' && (
                      <select value={editData.branch_id ?? 1} onChange={e => setEditData({ ...editData, branch_id: Number(e.target.value) })}
                        style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }}
                      >
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    )}
                    {editData.role === 'factory' && <span style={{ fontSize: '11px', color: '#94a3b8' }}>כל המפעל</span>}
                    {editData.role === 'admin' && <span style={{ fontSize: '11px', color: '#94a3b8' }}>הכל</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {editData.role === 'factory' ? ALL_DEPTS.map(d => (
                      <button key={d} onClick={() => toggleExcludedDept(d, 'edit')}
                        style={{
                          padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '600', cursor: 'pointer',
                          border: '1px solid',
                          background: (editData.excluded_departments || []).includes(d) ? '#fff1f2' : '#f0fdf4',
                          borderColor: (editData.excluded_departments || []).includes(d) ? '#fca5a5' : '#86efac',
                          color: (editData.excluded_departments || []).includes(d) ? '#fb7185' : '#34d399',
                        }}
                      >
                        {DEPT_LABELS[d]}
                      </button>
                    )) : <span style={{ fontSize: '11px', color: '#94a3b8' }}>—</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {editData.role !== 'admin' ? (
                      <input type="checkbox" checked={editData.can_settings || false} onChange={e => setEditData({ ...editData, can_settings: e.target.checked })} />
                    ) : (
                      <span style={{ fontSize: '11px', color: '#34d399' }}>✓</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => handleSave(user.id)} disabled={saving}
                      style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      <Save size={13} />
                    </button>
                    <button onClick={() => setEditingId(null)}
                      style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Display mode */}
                  <span style={{ fontWeight: '600', color: '#0f172a' }}>{user.name}</span>
                  <span style={{ color: '#64748b', direction: 'ltr', textAlign: 'left' }}>{user.email}</span>
                  <span>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700',
                      background: ROLE_COLORS[user.role] + '15', color: ROLE_COLORS[user.role],
                    }}>
                      {ROLE_LABELS[user.role]}
                    </span>
                  </span>
                  <span style={{ color: '#374151' }}>
                    {user.role === 'admin' ? 'הכל' :
                     user.role === 'branch' && user.branch_id ? getBranchName(user.branch_id) :
                     'כל המפעל'}
                  </span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {user.role === 'factory' && user.excluded_departments.length > 0
                      ? user.excluded_departments.map(d => DEPT_LABELS[d]).join(', ')
                      : '—'}
                  </span>
                  <span style={{ textAlign: 'center', fontSize: '14px', color: user.can_settings ? '#34d399' : '#fb7185' }}>
                    {user.can_settings ? '✓' : '✗'}
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => startEdit(user)}
                      style={{ background: '#f1f5f9', color: '#818cf8', border: 'none', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDelete(user.id)}
                      style={{ background: '#fff1f2', color: '#fb7185', border: 'none', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </Card></div>
        </motion.div>
      )}

      </>}

      {/* ═══ BRANCHES TAB ═══ */}
      {tab === 'branches' && (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr 100px 80px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
              <span>ID</span><span>שם</span><span>שם קצר</span><span>כתובת</span><span>סטטוס</span><span>פעולות</span>
            </div>
            {branches.map(branch => (
              <div key={branch.id} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr 100px 80px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' }}>
                <span style={{ fontWeight: '700', color: '#818cf8' }}>#{branch.id}</span>
                <span style={{ fontWeight: '600', color: '#0f172a' }}>{branch.name}</span>
                <span style={{ color: '#64748b' }}>{branch.short_name || '—'}</span>
                <span style={{ color: '#64748b' }}>{branch.address || '—'}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '600', color: '#34d399' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }} /> פעיל
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => { setEditBranch({ id: branch.id, name: branch.name, short_name: branch.short_name || '', address: branch.address || '' }); setBranchSheetOpen(true) }}
                    style={{ background: '#f1f5f9', color: '#818cf8', border: 'none', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={async () => {
                    if (!confirm(`האם להשבית את סניף "${branch.name}"?`)) return
                    await supabase.from('branches').update({ active: false }).eq('id', branch.id)
                    refreshBranches()
                  }}
                    style={{ background: '#fff1f2', color: '#fb7185', border: 'none', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    title="השבת סניף">
                    <ToggleLeft size={13} />
                  </button>
                </div>
              </div>
            ))}
            {branches.length === 0 && (
              <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>אין סניפים פעילים</div>
            )}
          </Card>
        </motion.div>
      )}

      {/* ═══ ALERTS TAB ═══ */}
      {tab === 'alerts' && (
        <>
          {/* Sub-tab switcher */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            {([
              { key: 'rules' as const, label: 'כללי התרעה', icon: AlertTriangle, count: alertRules.length },
              { key: 'log' as const, label: 'לוג התרעות', icon: History, count: alertLog.length },
            ]).map(t => (
              <button key={t.key} onClick={() => setAlertSubTab(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
                  border: alertSubTab === t.key ? '2px solid #f59e0b' : '2px solid #e2e8f0',
                  background: alertSubTab === t.key ? '#fffbeb' : 'white', color: alertSubTab === t.key ? '#b45309' : '#64748b',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                <t.icon size={14} />
                {t.label}
                <span style={{ background: alertSubTab === t.key ? '#f59e0b' : '#e2e8f0', color: alertSubTab === t.key ? 'white' : '#64748b', fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '8px' }}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {/* Alert Rules */}
          {alertSubTab === 'rules' && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px 120px 100px 80px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                  <span>שם ההתרעה</span><span>ישות</span><span>מדד</span><span>תנאי</span><span>סף</span><span>סטטוס</span><span>פעולות</span>
                </div>
                {alertRules.length === 0 ? (
                  <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>
                    <Bell size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                    <div>אין כללי התרעה. לחץ "הוסף התרעה" כדי להתחיל.</div>
                  </div>
                ) : alertRules.map(rule => (
                  <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px 120px 100px 80px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px', opacity: rule.active ? 1 : 0.5 }}>
                    <span style={{ fontWeight: '600', color: '#0f172a' }}>{rule.name}</span>
                    <span style={{ color: '#64748b' }}>
                      <span style={{ fontSize: '10px', background: rule.entity_type === 'branch' ? '#dbeafe' : '#f3e8ff', color: rule.entity_type === 'branch' ? '#2563eb' : '#7c3aed', padding: '2px 6px', borderRadius: '4px', fontWeight: '600', marginLeft: '4px' }}>
                        {rule.entity_type === 'branch' ? 'סניף' : 'מפעל'}
                      </span>
                      {' '}{getAlertEntityLabel(rule)}
                    </span>
                    <span style={{ color: '#64748b' }}>{ALERT_METRICS.find(m => m.value === rule.metric)?.label}</span>
                    <span style={{ color: rule.condition === 'above' ? '#ef4444' : '#f59e0b', fontWeight: '600', fontSize: '12px' }}>
                      {ALERT_CONDITIONS.find(c => c.value === rule.condition)?.label}
                    </span>
                    <span style={{ fontWeight: '700', color: '#374151' }}>
                      {rule.threshold_type === 'percent' ? `${rule.threshold}%` : `₪${Number(rule.threshold).toLocaleString()}`}
                    </span>
                    <span>
                      <button onClick={() => toggleAlertActive(rule)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '600', color: rule.active ? '#34d399' : '#94a3b8' }}>
                        {rule.active ? <ToggleRight size={18} color="#34d399" /> : <ToggleLeft size={18} color="#94a3b8" />}
                        {rule.active ? 'פעיל' : 'מושבת'}
                      </button>
                    </span>
                    <button onClick={() => openEditAlert(rule)}
                      style={{ background: '#f1f5f9', color: '#818cf8', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                      ערוך
                    </button>
                  </div>
                ))}
              </Card>
            </motion.div>
          )}

          {/* Alert Log */}
          {alertSubTab === 'log' && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>תקופה:</span>
                {[7, 14, 30].map(d => (
                  <button key={d} onClick={() => setAlertLogDays(d)}
                    style={{
                      padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                      border: alertLogDays === d ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                      background: alertLogDays === d ? '#fffbeb' : 'white', color: alertLogDays === d ? '#b45309' : '#64748b',
                    }}>
                    {d} ימים
                  </button>
                ))}
              </div>
              <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px 120px 80px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                  <span>זמן</span><span>התרעה</span><span>ערך בפועל</span><span>סף</span><span>אימייל</span>
                </div>
                {alertLog.length === 0 ? (
                  <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>אין התרעות בתקופה הנבחרת</div>
                ) : alertLog.map(entry => (
                  <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px 120px 80px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' }}>
                    <span style={{ color: '#64748b', fontSize: '12px' }}>{new Date(entry.triggered_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</span>
                    <span style={{ fontWeight: '600', color: '#0f172a' }}>{entry.rule_name}</span>
                    <span style={{ fontWeight: '700', color: '#ef4444' }}>₪{Number(entry.actual_value).toLocaleString()}</span>
                    <span style={{ color: '#64748b' }}>₪{Number(entry.threshold_value).toLocaleString()}</span>
                    <span style={{ fontSize: '14px', color: entry.email_sent ? '#34d399' : '#fb7185' }}>{entry.email_sent ? '✓' : '✗'}</span>
                  </div>
                ))}
              </Card>
            </motion.div>
          )}

          {/* Alert Sheet (Add/Edit) */}
          <Sheet open={alertSheetOpen} onOpenChange={setAlertSheetOpen}>
            <SheetPortal>
              <SheetBackdrop />
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>{alertForm.id ? 'עריכת התרעה' : 'התרעה חדשה'}</SheetTitle>
                </SheetHeader>
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={S_ALERT.label}>שם ההתרעה</label>
                    <input value={alertForm.name} onChange={e => setAlertForm({ ...alertForm, name: e.target.value })}
                      placeholder='למשל: "הכנסות נמוכות — אברהם אבינו"' style={S_ALERT.input} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={S_ALERT.label}>סוג ישות</label>
                      <select value={alertForm.entity_type} onChange={e => {
                        const et = e.target.value as 'branch' | 'factory'
                        setAlertForm({ ...alertForm, entity_type: et, entity_id: et === 'branch' ? (branches[0]?.id?.toString() || '1') : 'creams' })
                      }} style={S_ALERT.select}>
                        <option value="branch">סניף</option>
                        <option value="factory">מפעל (מחלקה)</option>
                      </select>
                    </div>
                    <div>
                      <label style={S_ALERT.label}>{alertForm.entity_type === 'branch' ? 'סניף' : 'מחלקה'}</label>
                      <select value={alertForm.entity_id} onChange={e => setAlertForm({ ...alertForm, entity_id: e.target.value })} style={S_ALERT.select}>
                        {alertEntityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={S_ALERT.label}>מדד</label>
                    <select value={alertForm.metric} onChange={e => setAlertForm({ ...alertForm, metric: e.target.value })} style={S_ALERT.select}>
                      {ALERT_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={S_ALERT.label}>תנאי</label>
                      <select value={alertForm.condition} onChange={e => setAlertForm({ ...alertForm, condition: e.target.value })} style={S_ALERT.select}>
                        {ALERT_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={S_ALERT.label}>סוג סף</label>
                      <select value={alertForm.threshold_type} onChange={e => setAlertForm({ ...alertForm, threshold_type: e.target.value })} style={S_ALERT.select}>
                        {ALERT_THRESHOLD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={S_ALERT.label}>ערך סף</label>
                    <input type="number" value={alertForm.threshold} onChange={e => setAlertForm({ ...alertForm, threshold: e.target.value })}
                      placeholder={alertForm.threshold_type === 'percent' ? '25' : '5000'}
                      style={{ ...S_ALERT.input, textAlign: 'left' as const }} />
                  </div>
                  <button onClick={handleAlertSave}
                    disabled={alertSaving || !alertForm.name.trim() || !alertForm.threshold}
                    style={{
                      background: alertSaving || !alertForm.name.trim() || !alertForm.threshold ? '#e2e8f0' : '#f59e0b',
                      color: alertSaving || !alertForm.name.trim() || !alertForm.threshold ? '#94a3b8' : 'white',
                      border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    }}>
                    <Save size={16} /> {alertSaving ? 'שומר...' : alertForm.id ? 'עדכן התרעה' : 'הוסף התרעה'}
                  </button>
                </div>
              </SheetContent>
            </SheetPortal>
          </Sheet>
        </>
      )}

      {/* Branch Sheet (Add/Edit) */}
      <Sheet open={branchSheetOpen} onOpenChange={setBranchSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{editBranch.id ? 'עריכת סניף' : 'סניף חדש'}</SheetTitle>
            </SheetHeader>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '6px' }}>שם הסניף</label>
                <input value={editBranch.name} onChange={e => setEditBranch({ ...editBranch, name: e.target.value })}
                  placeholder="שם הסניף..."
                  style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '6px' }}>שם קצר</label>
                <input value={editBranch.short_name} onChange={e => setEditBranch({ ...editBranch, short_name: e.target.value })}
                  placeholder="שם קצר לתצוגה..."
                  style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '6px' }}>כתובת</label>
                <input value={editBranch.address} onChange={e => setEditBranch({ ...editBranch, address: e.target.value })}
                  placeholder="כתובת הסניף..."
                  style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <button
                onClick={async () => {
                  if (!editBranch.name.trim()) return
                  setBranchSaving(true)
                  if (editBranch.id) {
                    await supabase.from('branches').update({
                      name: editBranch.name.trim(),
                      short_name: editBranch.short_name.trim() || editBranch.name.trim(),
                      address: editBranch.address.trim(),
                    }).eq('id', editBranch.id)
                  } else {
                    await supabase.from('branches').insert({
                      name: editBranch.name.trim(),
                      short_name: editBranch.short_name.trim() || editBranch.name.trim(),
                      address: editBranch.address.trim(),
                      active: true,
                    })
                  }
                  setBranchSaving(false)
                  setBranchSheetOpen(false)
                  refreshBranches()
                }}
                disabled={branchSaving || !editBranch.name.trim()}
                style={{
                  background: branchSaving || !editBranch.name.trim() ? '#e2e8f0' : '#818cf8',
                  color: branchSaving || !editBranch.name.trim() ? '#94a3b8' : 'white',
                  border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}>
                <Save size={16} /> {branchSaving ? 'שומר...' : editBranch.id ? 'עדכן סניף' : 'הוסף סניף'}
              </button>
            </div>
          </SheetContent>
        </SheetPortal>
      </Sheet>

      </div>
    </div>
  )
}
