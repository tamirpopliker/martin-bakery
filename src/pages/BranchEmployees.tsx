import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ArrowRight, Plus, Pencil, Users, Save, ToggleLeft, ToggleRight, Send, Mail, Upload } from 'lucide-react'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface Employee {
  id: number
  branch_id: number
  name: string
  email: string | null
  phone: string | null
  hourly_rate: number | null
  retention_bonus: number | null
  active: boolean
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }

const S = {
  label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', display: 'block', marginBottom: '6px' },
  input: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
}

export default function BranchEmployees({ branchId, branchName, branchColor, onBack }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    id: undefined as number | undefined,
    name: '', email: '', phone: '', hourly_rate: '', retention_bonus: '', active: true,
  })
  // Invite state
  const [inviteModal, setInviteModal] = useState<{ empId: number; name: string; email: string } | null>(null)
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  // Bulk invite
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false)
  const [bulkList, setBulkList] = useState<{ id: number; name: string; email: string; checked: boolean }[]>([])
  // Import to app_users
  const [importOpen, setImportOpen] = useState(false)
  const [importList, setImportList] = useState<{ id: number; name: string; email: string; checked: boolean }[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importSaving, setImportSaving] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  // App connection status: email → 'connected' | 'pending' | 'none'
  const [appStatus, setAppStatus] = useState<Map<string, string>>(new Map())
  // Email input for connect dialog
  const [connectDialog, setConnectDialog] = useState<{ empId: number; name: string; email: string } | null>(null)
  const [connectEmail, setConnectEmail] = useState('')

  async function fetchEmployees() {
    const { data, error } = await supabase.from('branch_employees').select('*')
      .eq('branch_id', branchId).order('name')
    console.log('[BranchEmployees] fetch:', { branchId, data, error })
    if (data) setEmployees(data)

    // Load app_users for this branch to determine connection status
    const { data: appUsers } = await supabase.from('app_users').select('email, auth_uid')
      .eq('branch_id', branchId)
    const statusMap = new Map<string, string>()
    appUsers?.forEach((au: any) => {
      const email = au.email?.toLowerCase()
      if (email) statusMap.set(email, au.auth_uid ? 'connected' : 'pending')
    })
    setAppStatus(statusMap)

    setLoading(false)
  }

  function getEmpStatus(emp: Employee): 'connected' | 'pending' | 'none' {
    if (!emp.email) return 'none'
    return (appStatus.get(emp.email.toLowerCase()) as any) || 'none'
  }

  async function connectToApp(empId: number, name: string, email: string) {
    if (!email.trim()) return
    // Save email to branch_employees if not set
    await supabase.from('branch_employees').update({ email: email.trim().toLowerCase() }).eq('id', empId)
    // Send invitation
    await sendInvite(email.trim().toLowerCase(), name)
    // Update local status
    setAppStatus(prev => { const m = new Map(prev); m.set(email.trim().toLowerCase(), 'pending'); return m })
    setConnectDialog(null)
  }

  useEffect(() => { fetchEmployees() }, [branchId])

  async function handleSave() {
    if (!form.name.trim() || !form.hourly_rate) return
    setSaving(true)
    const payload: Record<string, any> = {
      branch_id: branchId,
      name: form.name.trim(),
      email: form.email || null,
      phone: form.phone || null,
      hourly_rate: parseFloat(form.hourly_rate) || null,
      active: form.active,
    }
    // Only include retention_bonus if the column exists (avoid 400 if PostgREST cache is stale)
    const bonusVal = parseFloat(form.retention_bonus) || 0
    if (bonusVal > 0) payload.retention_bonus = bonusVal
    if (form.id) {
      await supabase.from('branch_employees').update(payload).eq('id', form.id)
    } else {
      await supabase.from('branch_employees').insert(payload)
    }
    setSaving(false)
    setSheetOpen(false)
    fetchEmployees()
  }

  async function toggleActive(emp: Employee) {
    await supabase.from('branch_employees').update({ active: !emp.active }).eq('id', emp.id)
    fetchEmployees()
  }

  async function sendInvite(email: string, name: string) {
    setInviteSending(true)
    try {
      const { error } = await supabase.functions.invoke('send-invitation', {
        body: { email, name, senderName: 'צוות קונדיטוריית מרטין', branchId },
      })
      if (error) throw error
      setInviteSuccess(`ההזמנה נשלחה ל-${name}`)
      setTimeout(() => { setInviteSuccess(null); setInviteModal(null) }, 2000)
    } catch (err) {
      console.error('Invite error:', err)
      alert('שגיאה בשליחת ההזמנה')
    } finally {
      setInviteSending(false)
    }
  }

  async function sendBulkInvites() {
    const selected = bulkList.filter(e => e.checked && e.email.trim())
    setInviteSending(true)
    let sent = 0
    for (const emp of selected) {
      try {
        await supabase.functions.invoke('send-invitation', {
          body: { email: emp.email.trim(), name: emp.name, senderName: 'צוות קונדיטוריית מרטין', branchId, employeeId: emp.id },
        })
        sent++
      } catch {}
    }
    setInviteSending(false)
    setInviteSuccess(`נשלחו ${sent} הזמנות`)
    setTimeout(() => { setInviteSuccess(null); setBulkInviteOpen(false) }, 2000)
  }

  function openBulkInvite() {
    setBulkList(employees.filter(e => e.active).map(e => ({ id: e.id, name: e.name, email: e.email || '', checked: false })))
    setBulkInviteOpen(true)
  }

  async function openImport() {
    setImportOpen(true)
    setImportMsg(null)
    setImportLoading(true)
    // Load active employees that don't have app_users yet
    const { data: existingUsers } = await supabase.from('app_users').select('employee_id').not('employee_id', 'is', null)
    const usedIds = new Set((existingUsers || []).map((u: any) => u.employee_id))
    const available = employees.filter(e => e.active && !usedIds.has(e.id))
    setImportList(available.map(e => ({ id: e.id, name: e.name, email: e.email || '', checked: false })))
    setImportLoading(false)
  }

  async function handleImport() {
    const selected = importList.filter(e => e.checked)
    if (selected.length === 0) return
    const withEmail = selected.filter(e => e.email.trim())
    const withoutEmail = selected.filter(e => !e.email.trim())
    if (withEmail.length === 0) {
      setImportMsg('⚠️ לא הוזנו כתובות אימייל — לא נוצרו חשבונות')
      return
    }
    setImportSaving(true)
    const rows = withEmail.map(e => ({
      role: 'employee' as const,
      branch_id: branchId,
      employee_id: e.id,
      email: e.email.trim().toLowerCase(),
      name: e.name,
      can_settings: false,
      excluded_departments: [],
      managed_department: null,
    }))
    await supabase.from('app_users').insert(rows)
    setImportSaving(false)
    const msg = withoutEmail.length > 0
      ? `נוצרו ${withEmail.length} חשבונות (${withoutEmail.length} דולגו — ללא אימייל)`
      : `נוצרו ${withEmail.length} חשבונות עובדים`
    setImportMsg(msg)
    setTimeout(() => { setImportMsg(null); setImportOpen(false) }, 2500)
  }

  function openNew() {
    setForm({ id: undefined, name: '', email: '', phone: '', hourly_rate: '', retention_bonus: '', active: true })
    setSheetOpen(true)
  }

  function openEdit(emp: Employee) {
    setForm({
      id: emp.id, name: emp.name, email: emp.email || '', phone: emp.phone || '',
      hourly_rate: emp.hourly_rate ? String(emp.hourly_rate) : '',
      retention_bonus: emp.retention_bonus ? String(emp.retention_bonus) : '', active: emp.active,
    })
    setSheetOpen(true)
  }

  const activeCount = employees.filter(e => e.active).length

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} /> חזרה
        </Button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Users size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>עובדי הסניף — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>{activeCount} עובדים פעילים · תעריפי שעה</p>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={openImport}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Upload size={16} /> ייבא לאפליקציה
          </button>
          <button onClick={openBulkInvite}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Mail size={16} /> הזמן את כולם 📧
          </button>
          <button onClick={openNew}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: branchColor, color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Plus size={16} /> הוסף עובד
          </button>
          {onNavigate && (
            <button onClick={() => onNavigate?.('employee-archive')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              📦 ארכיון
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: '900px', margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>טוען...</div>
        ) : (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 60px 60px', padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                <span>שם</span><span>אפליקציה</span><span>סטטוס</span><span>עריכה</span><span>הזמנה</span>
              </div>
              {employees.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
                  <Users size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                  <div>אין עובדים. לחץ "הוסף עובד" כדי להתחיל.</div>
                </div>
              ) : employees.map(emp => (
                <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 60px 60px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px', opacity: emp.active ? 1 : 0.5 }}>
                  <span style={{ fontWeight: '600', color: '#0f172a' }}>{emp.name}</span>
                  {/* App connection status */}
                  {(() => {
                    const status = getEmpStatus(emp)
                    if (status === 'connected') return <span style={{ fontSize: 11, color: '#10b981' }}>🟢 מחובר</span>
                    if (status === 'pending') return <span style={{ fontSize: 11, color: '#f59e0b' }}>🟡 ממתין</span>
                    return (
                      <button onClick={() => { setConnectDialog({ empId: emp.id, name: emp.name, email: emp.email || '' }); setConnectEmail(emp.email || '') }}
                        style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: '#6366f1', cursor: 'pointer', fontWeight: 600 }}>
                        📱 חבר
                      </button>
                    )
                  })()}
                  <button onClick={() => toggleActive(emp)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '600', color: emp.active ? '#34d399' : '#94a3b8' }}>
                    {emp.active ? <ToggleRight size={18} color="#34d399" /> : <ToggleLeft size={18} color="#94a3b8" />}
                    {emp.active ? 'פעיל' : 'מושבת'}
                  </button>
                  <button onClick={() => openEdit(emp)}
                    style={{ background: '#f1f5f9', color: branchColor, border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => setInviteModal({ empId: emp.id, name: emp.name, email: emp.email || '' })}
                    style={{ background: '#eef2ff', color: '#6366f1', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    <Send size={13} />
                  </button>
                </div>
              ))}
            </Card>
          </motion.div>
        )}
      </div>

      {/* Add/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{form.id ? 'עריכת עובד' : 'עובד חדש'}</SheetTitle>
            </SheetHeader>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={S.label}>שם עובד *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="שם מלא" style={S.input} />
              </div>
              <div>
                <label style={S.label}>תעריף שעתי *</label>
                <input type="number" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: e.target.value })}
                  placeholder="35" style={{ ...S.input, textAlign: 'left' as const }} />
              </div>
              <div>
                <label style={S.label}>בונוס התמדה (₪ לשעה)</label>
                <input type="number" value={form.retention_bonus} onChange={e => setForm({ ...form, retention_bonus: e.target.value })}
                  placeholder="אין בונוס" style={{ ...S.input, textAlign: 'left' as const }} />
                <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>יוכפל בסה"כ שעות העבודה, ללא עלות מעסיק</span>
              </div>
              <div>
                <label style={S.label}>אימייל</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="email@example.com" style={{ ...S.input, textAlign: 'left' as const, direction: 'ltr' }} />
              </div>
              <div>
                <label style={S.label}>טלפון</label>
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="050-0000000" style={{ ...S.input, textAlign: 'left' as const, direction: 'ltr' }} />
              </div>
              <button onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.hourly_rate}
                style={{
                  background: saving || !form.name.trim() || !form.hourly_rate ? '#e2e8f0' : branchColor,
                  color: saving || !form.name.trim() || !form.hourly_rate ? '#94a3b8' : 'white',
                  border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}>
                <Save size={16} /> {saving ? 'שומר...' : form.id ? 'עדכן' : 'הוסף עובד'}
              </button>
            </div>
          </SheetContent>
        </SheetPortal>
      </Sheet>

      {/* Single Invite Modal */}
      {/* Connect to app dialog */}
      {connectDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setConnectDialog(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: 380, direction: 'rtl' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>חיבור לאפליקציה</h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>הזן מייל Google עבור {connectDialog.name}</p>
            <input
              type="email"
              placeholder="example@gmail.com"
              value={connectEmail}
              onChange={e => setConnectEmail(e.target.value)}
              style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 16, direction: 'ltr' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConnectDialog(null)}
                style={{ padding: '8px 16px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
              <button onClick={() => connectToApp(connectDialog.empId, connectDialog.name, connectEmail)}
                disabled={!connectEmail.trim() || inviteSending}
                style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: !connectEmail.trim() ? 0.5 : 1 }}>
                {inviteSending ? 'שולח...' : 'שלח הזמנה 📱'}
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { setInviteModal(null); setInviteSuccess(null) }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '400px', direction: 'rtl' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>הזמן את {inviteModal.name} לאפליקציה ✉️</h3>
            <label style={S.label}>אימייל Google</label>
            <input value={inviteModal.email} onChange={e => setInviteModal({ ...inviteModal, email: e.target.value })}
              placeholder="email@gmail.com" style={{ ...S.input, direction: 'ltr', marginBottom: '16px' }} />
            {inviteSuccess && <div style={{ padding: '10px', background: '#f0fdf4', borderRadius: '8px', color: '#16a34a', fontWeight: '600', fontSize: '13px', marginBottom: '12px', textAlign: 'center' }}>{inviteSuccess}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => sendInvite(inviteModal.email.trim(), inviteModal.name)}
                disabled={inviteSending || !inviteModal.email.trim()}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: !inviteModal.email.trim() || inviteSending ? '#e2e8f0' : '#6366f1', color: !inviteModal.email.trim() || inviteSending ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                <Send size={14} /> {inviteSending ? 'שולח...' : 'שלח הזמנה'}
              </button>
              <button onClick={() => { setInviteModal(null); setInviteSuccess(null) }}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import to App Modal */}
      {importOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setImportOpen(false)}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '520px', maxHeight: '80vh', overflow: 'auto', direction: 'rtl' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>ייבא עובדים לאפליקציה — {branchName}</h3>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#64748b' }}>בחר עובדים שעדיין אין להם חשבון במערכת. הזן אימייל Google לכל עובד.</p>
            {importLoading ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>טוען...</div>
            ) : importList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '14px' }}>כל העובדים כבר מחוברים למערכת ✓</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: '8px', padding: '8px 0', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b', alignItems: 'center' }}>
                  <input type="checkbox"
                    checked={importList.every(e => e.checked)}
                    ref={el => { if (el) el.indeterminate = importList.some(e => e.checked) && !importList.every(e => e.checked) }}
                    onChange={e => setImportList(prev => prev.map(emp => ({ ...emp, checked: e.target.checked })))}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  <span>שם</span><span>אימייל Google</span>
                </div>
                {importList.map((emp, idx) => (
                  <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: '8px', padding: '10px 0', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
                    <input type="checkbox" checked={emp.checked}
                      onChange={() => { const u = [...importList]; u[idx] = { ...u[idx], checked: !u[idx].checked }; setImportList(u) }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{emp.name}</span>
                    <input value={emp.email} placeholder="email@gmail.com"
                      onChange={e => { const u = [...importList]; u[idx] = { ...u[idx], email: e.target.value }; setImportList(u) }}
                      style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 10px', fontSize: '13px', direction: 'ltr', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </>
            )}
            {importMsg && <div style={{ marginTop: '12px', padding: '10px', background: '#f0fdf4', borderRadius: '8px', color: '#16a34a', fontWeight: '600', fontSize: '13px', textAlign: 'center' }}>{importMsg}</div>}
            {importList.length > 0 && (
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={handleImport}
                  disabled={importSaving || importList.filter(e => e.checked).length === 0}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: importSaving || importList.filter(e => e.checked).length === 0 ? '#e2e8f0' : '#f59e0b', color: importSaving || importList.filter(e => e.checked).length === 0 ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                  {importSaving ? 'יוצר חשבונות...' : `צור חשבונות (${importList.filter(e => e.checked).length})`}
                </button>
                <button onClick={() => setImportOpen(false)}
                  style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '12px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                  סגור
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk Invite Modal */}
      {bulkInviteOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { setBulkInviteOpen(false); setInviteSuccess(null) }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '520px', maxHeight: '80vh', overflow: 'auto', direction: 'rtl' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>הזמן עובדים לאפליקציה — {branchName}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: '8px', padding: '8px 0', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b', alignItems: 'center' }}>
              <input type="checkbox"
                checked={bulkList.length > 0 && bulkList.every(e => e.checked)}
                ref={el => { if (el) el.indeterminate = bulkList.some(e => e.checked) && !bulkList.every(e => e.checked) }}
                onChange={e => setBulkList(prev => prev.map(emp => ({ ...emp, checked: e.target.checked })))}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
              <span>שם</span><span>אימייל</span>
            </div>
            {bulkList.map((emp, idx) => (
              <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: '8px', padding: '10px 0', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
                <input type="checkbox" checked={emp.checked}
                  onChange={() => { const u = [...bulkList]; u[idx] = { ...u[idx], checked: !u[idx].checked }; setBulkList(u) }}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{emp.name}</span>
                <input value={emp.email} placeholder="email@gmail.com"
                  onChange={e => { const u = [...bulkList]; u[idx] = { ...u[idx], email: e.target.value }; setBulkList(u) }}
                  style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 10px', fontSize: '13px', direction: 'ltr', boxSizing: 'border-box' }} />
              </div>
            ))}
            {inviteSuccess && <div style={{ marginTop: '12px', padding: '10px', background: '#f0fdf4', borderRadius: '8px', color: '#16a34a', fontWeight: '600', fontSize: '13px', textAlign: 'center' }}>{inviteSuccess}</div>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button onClick={sendBulkInvites}
                disabled={inviteSending || bulkList.filter(e => e.checked && e.email.trim()).length === 0}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: inviteSending || bulkList.filter(e => e.checked && e.email.trim()).length === 0 ? '#e2e8f0' : '#6366f1', color: inviteSending || bulkList.filter(e => e.checked && e.email.trim()).length === 0 ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                <Send size={16} /> {inviteSending ? 'שולח...' : `שלח הזמנות (${bulkList.filter(e => e.checked && e.email.trim()).length})`}
              </button>
              <button onClick={() => setBulkInviteOpen(false)}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '12px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
