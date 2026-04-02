import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Pencil, Trash2, Save, X, UserCog } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

const BRANCH_LABELS: Record<number, string> = {
  1: 'אברהם אבינו',
  2: 'הפועלים',
  3: 'יעקב כהן',
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

export default function UserManagement({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<AppUser>>({})
  const [addMode, setAddMode] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'branch' as string, branch_id: 1, excluded_departments: [] as string[], can_settings: false })
  const [saving, setSaving] = useState(false)

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
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: 0 }}>ניהול משתמשים</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>הרשאות גישה · {users.length} משתמשים</p>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!addMode && (
          <button
            onClick={() => setAddMode(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: '#c084fc', color: 'white', border: 'none', borderRadius: '10px',
              padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
            }}
          >
            <Plus size={16} /> הוסף משתמש
          </button>
        )}
      </div>

      <div style={{ padding: '28px 36px', maxWidth: '1100px', margin: '0 auto' }}>

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
                    <option value={1}>אברהם אבינו</option>
                    <option value={2}>הפועלים</option>
                    <option value={3}>יעקב כהן</option>
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
                        <option value={1}>אברהם אבינו</option>
                        <option value={2}>הפועלים</option>
                        <option value={3}>יעקב כהן</option>
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
                     user.role === 'branch' && user.branch_id ? BRANCH_LABELS[user.branch_id] :
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

      </div>
    </div>
  )
}
