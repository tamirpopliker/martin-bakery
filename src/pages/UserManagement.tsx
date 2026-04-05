import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Pencil, Trash2, Save, X, UserCog, Store, ToggleLeft, ToggleRight, Upload } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useBranches } from '../lib/BranchContext'

interface AppUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'factory' | 'branch' | 'employee'
  branch_id: number | null
  excluded_departments: string[]
  can_settings: boolean
  auth_uid: string | null
  managed_department: string | null
  employee_id: number | null
}

interface BranchEmployee {
  id: number
  name: string
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'מנהל מערכת',
  factory: 'מפעל',
  branch: 'מנהל סניף',
  employee: 'עובד',
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
  employee: '#f59e0b',
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function UserManagement({ onBack, initialTab }: { onBack: () => void; initialTab?: 'users' | 'branches' | 'settings' }) {
  const { branches, getBranchName, refreshBranches } = useBranches()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<AppUser>>({})
  const [addMode, setAddMode] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'branch' as string, branch_id: 1, excluded_departments: [] as string[], can_settings: false, managed_department: null as string | null, employee_id: null as number | null })
  const [saving, setSaving] = useState(false)
  // ─── Employee selection state (for add form) ──────────────────────────────
  const [branchEmployees, setBranchEmployees] = useState<BranchEmployee[]>([])
  const [usedEmployeeIds, setUsedEmployeeIds] = useState<number[]>([])
  // ─── Import employees modal state ─────────────────────────────────────────
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importBranchId, setImportBranchId] = useState<number | null>(null)
  const [importEmployees, setImportEmployees] = useState<(BranchEmployee & { checked: boolean; email: string })[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importSaving, setImportSaving] = useState(false)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)
  // ─── Branch management state ──────────────────────────────────────────────
  const [tab, setTab] = useState<'users' | 'branches' | 'settings'>(initialTab || 'users')
  const [branchSheetOpen, setBranchSheetOpen] = useState(false)
  const [editBranch, setEditBranch] = useState<{ id?: number; name: string; short_name: string; address: string }>({ name: '', short_name: '', address: '' })
  // System settings
  const [overheadPct, setOverheadPct] = useState(5)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [branchSaving, setBranchSaving] = useState(false)

  async function loadUsers() {
    const { data } = await supabase.from('app_users').select('*').order('created_at')
    setUsers((data || []).map(u => ({ ...u, excluded_departments: u.excluded_departments || [] })))
    setLoading(false)
  }

  async function loadSettings() {
    const { data } = await supabase.from('system_settings').select('value').eq('key', 'overhead_pct').maybeSingle()
    if (data) setOverheadPct(Number(data.value) || 5)
  }

  async function loadBranchEmployees(branchId: number) {
    const { data: emps } = await supabase.from('branch_employees').select('id, name').eq('branch_id', branchId).eq('active', true)
    const { data: usedData } = await supabase.from('app_users').select('employee_id').not('employee_id', 'is', null)
    const usedIds = (usedData || []).map(u => u.employee_id as number)
    setBranchEmployees(emps || [])
    setUsedEmployeeIds(usedIds)
  }

  async function loadImportEmployees(branchId: number) {
    setImportLoading(true)
    const { data: emps } = await supabase.from('branch_employees').select('id, name').eq('branch_id', branchId).eq('active', true)
    const { data: usedData } = await supabase.from('app_users').select('employee_id').not('employee_id', 'is', null)
    const usedIds = new Set((usedData || []).map(u => u.employee_id as number))
    const available = (emps || []).filter(e => !usedIds.has(e.id))
    setImportEmployees(available.map(e => ({ ...e, checked: false, email: '' })))
    setImportLoading(false)
  }

  async function saveSettings() {
    setSettingsSaving(true)
    await supabase.from('system_settings').upsert({ key: 'overhead_pct', value: String(overheadPct), updated_at: new Date().toISOString() })
    setSettingsSaving(false)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2000)
  }

  useEffect(() => { loadUsers(); loadSettings() }, [])

  async function handleSave(id: string) {
    setSaving(true)
    const update: any = { ...editData }
    if (update.role !== 'branch' && update.role !== 'employee') update.branch_id = null
    if (update.role !== 'factory') { update.excluded_departments = []; update.managed_department = null }
    if (update.role !== 'employee') { update.employee_id = null }
    if (update.role === 'admin') { update.can_settings = true; update.branch_id = null; update.excluded_departments = []; update.managed_department = null }
    await supabase.from('app_users').update(update).eq('id', id)
    setEditingId(null)
    setSaving(false)
    loadUsers()
  }

  async function handleAdd() {
    setSaving(true)
    const insert: any = { ...newUser, email: newUser.email.toLowerCase() }
    if (insert.role !== 'branch' && insert.role !== 'employee') insert.branch_id = null
    if (insert.role !== 'factory') { insert.excluded_departments = []; insert.managed_department = null }
    if (insert.role !== 'employee') { insert.employee_id = null }
    if (insert.role === 'admin') { insert.can_settings = true; insert.branch_id = null; insert.excluded_departments = []; insert.managed_department = null }
    await supabase.from('app_users').insert(insert)
    setAddMode(false)
    setNewUser({ email: '', name: '', role: 'branch', branch_id: 1, excluded_departments: [], can_settings: false, managed_department: null, employee_id: null })
    setSaving(false)
    loadUsers()
  }

  async function handleImportEmployees() {
    const selected = importEmployees.filter(e => e.checked)
    if (selected.length === 0) return
    setImportSaving(true)
    const rows = selected.map(e => ({
      role: 'employee' as const,
      branch_id: importBranchId,
      employee_id: e.id,
      email: e.email.toLowerCase(),
      name: e.name,
      can_settings: false,
      excluded_departments: [],
      managed_department: null,
    }))
    await supabase.from('app_users').insert(rows)
    setImportSaving(false)
    setImportSuccess(`נוצרו ${selected.length} חשבונות עובדים`)
    setTimeout(() => {
      setImportSuccess(null)
      setImportModalOpen(false)
      setImportBranchId(null)
      setImportEmployees([])
      loadUsers()
    }, 2000)
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
      managed_department: user.managed_department,
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
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>משתמשים · סניפים · הרשאות</p>
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
      </div>

      <div style={{ padding: '28px 36px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[
          { key: 'users' as const, label: 'משתמשים', icon: UserCog, count: users.length },
          { key: 'branches' as const, label: 'סניפים', icon: Store, count: branches.length },
          { key: 'settings' as const, label: 'הגדרות מערכת', icon: Save, count: undefined },
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
            {t.count !== undefined && (
              <span style={{ background: tab === t.key ? '#818cf8' : '#e2e8f0', color: tab === t.key ? 'white' : '#64748b', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '10px' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ USERS TAB ═══ */}
      {tab === 'users' && <>

      {/* Import employees button */}
      {!addMode && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
          <button onClick={() => { setImportModalOpen(true); setImportSuccess(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Upload size={16} /> ייבא עובדים מסניף
          </button>
        </div>
      )}

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
                <select value={newUser.role} onChange={e => {
                    const role = e.target.value
                    setNewUser({ ...newUser, role, employee_id: null })
                    if ((role === 'employee' || role === 'branch') && newUser.branch_id) {
                      loadBranchEmployees(newUser.branch_id)
                    }
                  }}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', boxSizing: 'border-box' }}
                >
                  <option value="admin">מנהל מערכת</option>
                  <option value="factory">מפעל</option>
                  <option value="branch">מנהל סניף</option>
                  <option value="employee">עובד</option>
                </select>
              </div>
              {(newUser.role === 'branch' || newUser.role === 'employee') && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>סניף</label>
                  <select value={newUser.branch_id} onChange={e => {
                      const branchId = Number(e.target.value)
                      setNewUser({ ...newUser, branch_id: branchId, employee_id: null })
                      if (newUser.role === 'employee') loadBranchEmployees(branchId)
                    }}
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', boxSizing: 'border-box' }}
                  >
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              {newUser.role === 'employee' && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>עובד</label>
                  <select value={newUser.employee_id ?? ''} onChange={e => {
                      const empId = e.target.value ? Number(e.target.value) : null
                      const emp = branchEmployees.find(be => be.id === empId)
                      setNewUser({ ...newUser, employee_id: empId, name: emp ? emp.name : newUser.name })
                    }}
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', boxSizing: 'border-box' }}
                  >
                    <option value="">בחר עובד...</option>
                    {branchEmployees.filter(be => !usedEmployeeIds.includes(be.id)).map(be => (
                      <option key={be.id} value={be.id}>{be.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {newUser.role === 'factory' && (
                <>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>מנהל מחלקה</label>
                    <select value={newUser.managed_department || ''} onChange={e => setNewUser({ ...newUser, managed_department: e.target.value || null })}
                      style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', boxSizing: 'border-box' }}>
                      <option value="">אין — גישה לכל המחלקות</option>
                      {ALL_DEPTS.map(d => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
                    </select>
                    {newUser.managed_department && (
                      <p style={{ fontSize: '11px', color: '#f59e0b', margin: '4px 0 0' }}>⚠️ מנהל מחלקה לא יכול לגשת להגדרות המפעל</p>
                    )}
                  </div>
                  {!newUser.managed_department && (
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
                </>
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
            <span>מחלקה</span>
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
                    <option value="admin">מנהל מערכת</option>
                    <option value="factory">מפעל</option>
                    <option value="branch">מנהל סניף</option>
                    <option value="employee">עובד</option>
                  </select>
                  <div>
                    {(editData.role === 'branch' || editData.role === 'employee') && (
                      <select value={editData.branch_id ?? 1} onChange={e => setEditData({ ...editData, branch_id: Number(e.target.value) })}
                        style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }}
                      >
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    )}
                    {editData.role === 'factory' && <span style={{ fontSize: '11px', color: '#94a3b8' }}>כל המפעל</span>}
                    {editData.role === 'admin' && <span style={{ fontSize: '11px', color: '#94a3b8' }}>הכל</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {editData.role === 'factory' ? (
                      <>
                        <select value={editData.managed_department || ''} onChange={e => setEditData({ ...editData, managed_department: e.target.value || null })}
                          style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '2px 6px', fontSize: '10px' }}>
                          <option value="">כל המחלקות</option>
                          {ALL_DEPTS.map(d => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
                        </select>
                      </>
                    ) : <span style={{ fontSize: '11px', color: '#94a3b8' }}>—</span>}
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
                     (user.role === 'branch' || user.role === 'employee') && user.branch_id ? getBranchName(user.branch_id) :
                     user.managed_department ? `מנהל ${DEPT_LABELS[user.managed_department]}` :
                     'כל המפעל'}
                  </span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {user.role === 'factory' && user.managed_department
                      ? <span style={{ color: '#f59e0b', fontWeight: '600' }}>מנהל מחלקה</span>
                      : user.role === 'factory' && user.excluded_departments.length > 0
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

      {/* ═══ Import Employees Modal ═══ */}
      {importModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { setImportModalOpen(false); setImportBranchId(null); setImportEmployees([]) }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '560px', maxHeight: '80vh', overflow: 'auto', direction: 'rtl' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px', fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>ייבא עובדים מסניף</h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '6px' }}>בחר סניף</label>
              <select value={importBranchId ?? ''} onChange={e => {
                  const bId = e.target.value ? Number(e.target.value) : null
                  setImportBranchId(bId)
                  if (bId) loadImportEmployees(bId)
                  else setImportEmployees([])
                }}
                style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' }}>
                <option value="">בחר סניף...</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            {importLoading && <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>טוען עובדים...</div>}

            {!importLoading && importBranchId && importEmployees.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '14px' }}>אין עובדים זמינים לייבוא (כולם כבר משויכים)</div>
            )}

            {!importLoading && importEmployees.length > 0 && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: '8px', padding: '8px 0', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                  <span></span><span>שם</span><span>אימייל</span>
                </div>
                {importEmployees.map((emp, idx) => (
                  <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: '8px', padding: '10px 0', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
                    <input type="checkbox" checked={emp.checked}
                      onChange={() => {
                        const updated = [...importEmployees]
                        updated[idx] = { ...updated[idx], checked: !updated[idx].checked }
                        setImportEmployees(updated)
                      }} />
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{emp.name}</span>
                    <input value={emp.email} placeholder="email@example.com"
                      onChange={e => {
                        const updated = [...importEmployees]
                        updated[idx] = { ...updated[idx], email: e.target.value }
                        setImportEmployees(updated)
                      }}
                      style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 10px', fontSize: '13px', direction: 'ltr', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </>
            )}

            {importSuccess && (
              <div style={{ marginTop: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '10px', color: '#16a34a', fontWeight: '600', fontSize: '14px', textAlign: 'center' }}>
                {importSuccess}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button
                onClick={handleImportEmployees}
                disabled={importSaving || importEmployees.filter(e => e.checked && e.email).length === 0}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  background: importSaving || importEmployees.filter(e => e.checked && e.email).length === 0 ? '#e2e8f0' : '#f59e0b',
                  color: importSaving || importEmployees.filter(e => e.checked && e.email).length === 0 ? '#94a3b8' : 'white',
                  border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
                }}>
                <Save size={16} /> {importSaving ? 'יוצר...' : 'צור חשבונות לנבחרים'}
              </button>
              <button onClick={() => { setImportModalOpen(false); setImportBranchId(null); setImportEmployees([]) }}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ System Settings Tab ═══ */}
      {tab === 'settings' && (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="shadow-sm">
            <CardContent className="p-6">
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '20px' }}>הגדרות מערכת</h3>

              <div style={{ maxWidth: '400px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '8px' }}>
                  אחוז העמסת מטה על סניפים %
                </label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={overheadPct}
                    onChange={e => setOverheadPct(Number(e.target.value))}
                    min={0} max={100} step={0.5}
                    style={{ width: '100px', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '16px', fontWeight: '600', textAlign: 'center' }}
                  />
                  <span style={{ fontSize: '14px', color: '#94a3b8' }}>%</span>
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
                  אחוז זה מוחל על הכנסות כל סניף לחישוב עלות הנהלה מרכזית
                </p>
              </div>

              <div style={{ marginTop: '24px' }}>
                <button
                  onClick={saveSettings}
                  disabled={settingsSaving}
                  style={{
                    background: settingsSaved ? '#639922' : '#818cf8',
                    color: 'white', border: 'none', borderRadius: '10px',
                    padding: '12px 28px', fontSize: '15px', fontWeight: '700',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                  <Save size={16} />
                  {settingsSaving ? 'שומר...' : settingsSaved ? '✓ נשמר!' : 'שמור הגדרות'}
                </button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      </div>
    </div>
  )
}
