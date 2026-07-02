import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppUser } from '../../lib/UserContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ArrowRight, Search, Download, Building2, Factory,
  FileText, History, User, TrendingUp, ListChecks, UserPlus, CalendarDays,
  Pencil, Check, X, Trash2,
} from 'lucide-react'
import { tableSourceFor } from './utils'
import { ProfileTab } from './ProfileTab'
import { DocumentsTab } from './DocumentsTab'
import { MonthlyEventsTab } from './MonthlyEventsTab'
import { AuditTab } from './AuditTab'
import { SalaryTab } from './SalaryTab'
import { OnboardingTab } from './OnboardingTab'
import { NewEmployeeWizard } from './NewEmployeeWizard'
import type { UnifiedEmployee, Kind, TabKey } from './types'

interface Props {
  onBack: () => void
  // When set, the dashboard auto-opens the EmployeeDetail view for that
  // {kind, id} on first load — used by FactoryEmployees "edit" button to
  // jump straight to the full profile.
  initialEmployeeKey?: { kind: Kind; id: number } | null
}

export default function HRDashboard({ onBack, initialEmployeeKey }: Props) {
  const { appUser } = useAppUser()
  // Branch managers (role='branch' + real email — restricted cashiers are
  // blocked by canAccessPage upstream) are scoped to their own branch.
  // For them: hide the kind selector and force kind='branch' + their branch_id.
  const branchScope = appUser?.role === 'branch' ? (appUser.branch_id ?? null) : null
  const isBranchScoped = branchScope != null

  const [employees, setEmployees] = useState<UnifiedEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | Kind>(isBranchScoped ? 'branch' : 'all')
  const [activeFilter, setActiveFilter] = useState<'active' | 'all' | 'inactive'>('all')
  const [selected, setSelected] = useState<UnifiedEmployee | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  // Tracks whether the current detail view was auto-opened via
  // initialEmployeeKey (vs. opened by the user clicking a row). When true,
  // closing the detail returns the user to the origin page instead of the
  // HR list — and we don't auto-reopen it after a refresh.
  const [autoOpened, setAutoOpened] = useState(false)

  useEffect(() => { load() }, [])

  // After the employee list loads, resolve initialEmployeeKey into the
  // matching UnifiedEmployee and open the detail view exactly once.
  useEffect(() => {
    if (!initialEmployeeKey || employees.length === 0 || selected || autoOpened) return
    const match = employees.find(e => e.kind === initialEmployeeKey.kind && e.id === initialEmployeeKey.id)
    if (match) { setSelected(match); setAutoOpened(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, initialEmployeeKey?.kind, initialEmployeeKey?.id])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('hr_employees_unified').select('*').order('name')
    if (error) console.error('[HRDashboard] load error', error)
    let rows = (data as UnifiedEmployee[]) || []
    // Branch managers only see their own branch (and never factory). Frontend
    // scope; write-side RLS on branch_employees independently enforces this.
    if (isBranchScoped) {
      rows = rows.filter(e => e.kind === 'branch' && e.branch_id === branchScope)
    }
    setEmployees(rows)
    setLoading(false)
  }

  const filtered = employees.filter(e => {
    if (kindFilter !== 'all' && e.kind !== kindFilter) return false
    if (activeFilter === 'active' && !e.active) return false
    if (activeFilter === 'inactive' && e.active) return false
    if (search) {
      const q = search.toLowerCase()
      const hits = [e.name, e.email, e.phone, e.position, e.location_name, e.department, e.id_number]
        .filter(Boolean).map(s => String(s).toLowerCase())
      if (!hits.some(s => s.includes(q))) return false
    }
    return true
  })

  function exportCsv() {
    const headers = ['שם', 'מיקום', 'מחלקה', 'תפקיד', 'תעריף שעתי', 'שכר חודשי',
                     'ת.תחילה', 'ת.סיום', 'פעיל', 'ת.ז', 'ת.לידה', 'אימייל', 'טלפון']
    const rows = filtered.map(e => [
      e.name, e.location_name || '', e.department || '', e.position || '',
      e.hourly_rate ?? '', e.monthly_salary ?? '', e.start_date || '', e.end_date || '',
      e.active ? 'פעיל' : 'לא פעיל', e.id_number || '', e.birth_date || '', e.email || '', e.phone || ''
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hr_employees_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // After a cross-kind transfer, refresh the list and open the newly-created
  // employee in the same EmployeeDetail view. Treat it like an organic
  // selection (not autoOpened) so "back" returns to the HR list as expected.
  async function handleTransferred(key: { kind: Kind; id: number }) {
    setLoading(true)
    const { data } = await supabase.from('hr_employees_unified').select('*').order('name')
    const rows = (data as UnifiedEmployee[]) || []
    setEmployees(rows)
    setLoading(false)
    const match = rows.find(e => e.kind === key.kind && e.id === key.id)
    if (match) {
      setSelected(match)
      setAutoOpened(false)
    } else {
      setSelected(null)
    }
  }

  if (selected) {
    return <EmployeeDetail
      employee={selected}
      onBack={autoOpened
        ? onBack                              // came from another page → return there
        : () => { setSelected(null); load() }} // organic click → back to HR list
      onTransferred={handleTransferred}
      onNameChanged={load}
    />
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      <div className="bg-white border-b sticky top-0 z-10 px-6 py-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowRight className="size-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 m-0">מחלקת HR</h1>
          <p className="text-sm text-slate-500 m-0">{filtered.length} עובדים</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <UserPlus className="size-4 ml-2" />
          עובד חדש
        </Button>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="size-4 ml-2" />
          ייצוא CSV
        </Button>
      </div>

      <div className="max-w-[1100px] mx-auto px-6 py-6">
        <Card className="mb-4">
          <CardContent className="p-4 flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש לפי שם / אימייל / ת.ז / תפקיד..."
                className="w-full border rounded-lg pr-10 pl-3 py-2 text-sm bg-white"
              />
            </div>
            {/* Branch-scoped managers always see only their own branch — no kind toggle. */}
            {!isBranchScoped && (
              <select
                value={kindFilter}
                onChange={e => setKindFilter(e.target.value as 'all' | Kind)}
                className="border rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="all">הכל</option>
                <option value="branch">סניפים בלבד</option>
                <option value="factory">מפעל בלבד</option>
                <option value="hq">מטה בלבד</option>
              </select>
            )}
            <select
              value={activeFilter}
              onChange={e => setActiveFilter(e.target.value as 'active' | 'all' | 'inactive')}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="active">פעילים</option>
              <option value="all">הכל</option>
              <option value="inactive">לא פעילים</option>
            </select>
          </CardContent>
        </Card>

        {loading ? (
          <div className="text-center py-16 text-slate-500">טוען...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">אין עובדים להצגה</div>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-right px-4 py-3 font-semibold">שם</th>
                    <th className="text-right px-4 py-3 font-semibold">מיקום</th>
                    <th className="text-right px-4 py-3 font-semibold">תפקיד</th>
                    <th className="text-right px-4 py-3 font-semibold">תחילה</th>
                    <th className="text-right px-4 py-3 font-semibold">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(emp => (
                    <tr
                      key={`${emp.kind}-${emp.id}`}
                      onClick={() => setSelected(emp)}
                      className="border-t cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {emp.kind === 'branch'
                            ? <Building2 className="size-4 text-indigo-500" />
                            : emp.kind === 'factory'
                              ? <Factory className="size-4 text-purple-500" />
                              : <Building2 className="size-4 text-emerald-500" />}
                          <span className="font-medium">{emp.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {emp.location_name}{emp.department ? ` · ${emp.department}` : ''}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{emp.position || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{emp.start_date || '—'}</td>
                      <td className="px-4 py-3">
                        {emp.active ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">פעיל</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">לא פעיל</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {wizardOpen && (
        <NewEmployeeWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => { setWizardOpen(false); load() }}
          initialKind={isBranchScoped ? 'branch' : undefined}
          initialBranchId={branchScope ?? undefined}
          lockKind={isBranchScoped}
          lockBranch={isBranchScoped}
        />
      )}
    </div>
  )
}

function EmployeeDetail({
  employee, onBack, onTransferred, onNameChanged,
}: {
  employee: UnifiedEmployee
  onBack: () => void
  onTransferred?: (key: { kind: Kind; id: number }) => void
  onNameChanged?: () => void
}) {
  const { appUser } = useAppUser()
  const isAdmin = appUser?.role === 'admin'
  const [tab, setTab] = useState<TabKey>('profile')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(employee.name)
  const [savingName, setSavingName] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function saveName() {
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === employee.name) { setEditingName(false); return }
    setSavingName(true)
    setErrorMsg('')
    const source = tableSourceFor(employee.kind)
    const { error } = await supabase.from(source).update({ name: trimmed }).eq('id', employee.id)
    setSavingName(false)
    if (error) {
      setErrorMsg('עדכון השם נכשל: ' + error.message)
      return
    }
    setEditingName(false)
    // Locally reflect immediately; parent reloads on next fetch.
    ;(employee as any).name = trimmed
    onNameChanged?.()
  }

  async function performDelete() {
    if (deleteConfirmName.trim() !== employee.name) {
      setErrorMsg('שם העובד לאישור לא תואם')
      return
    }
    if (deleteReason.trim().length < 3) {
      setErrorMsg('יש להזין סיבת מחיקה')
      return
    }
    setDeleting(true)
    setErrorMsg('')
    const source = tableSourceFor(employee.kind)
    // Best-effort audit: prefix notes with the reason so hr_audit_log captures it.
    await supabase.from(source).update({
      notes: `[מחיקה: ${new Date().toISOString().slice(0, 10)} · ${appUser?.name || 'admin'}] ${deleteReason.trim()}`,
    }).eq('id', employee.id)
    const { error } = await supabase.from(source).delete().eq('id', employee.id)
    setDeleting(false)
    if (error) {
      setErrorMsg('מחיקה נכשלה — ייתכן שיש רשומות מקושרות (מסמכים, אירועים, שכר). ' + error.message)
      return
    }
    onBack()
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      <div className="bg-white border-b sticky top-0 z-10 px-6 py-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowRight className="size-5" />
        </Button>
        <div className="flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                autoFocus
                className="border rounded-lg px-3 py-1.5 text-lg font-bold min-w-[240px]"
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameDraft(employee.name) } }}
              />
              <Button size="icon" variant="ghost" onClick={saveName} disabled={savingName} title="שמור">
                <Check className="size-5 text-emerald-600" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => { setEditingName(false); setNameDraft(employee.name) }} title="ביטול">
                <X className="size-5 text-slate-500" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold m-0">{employee.name}</h1>
              {isAdmin && (
                <>
                  <Button size="icon" variant="ghost" onClick={() => { setNameDraft(employee.name); setEditingName(true) }} title="ערוך שם">
                    <Pencil className="size-4 text-slate-400" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { setDeleteReason(''); setDeleteConfirmName(''); setErrorMsg(''); setDeleteOpen(true) }} title="מחק עובד">
                    <Trash2 className="size-4 text-rose-500" />
                  </Button>
                </>
              )}
            </div>
          )}
          <p className="text-sm text-slate-500 m-0">
            {employee.location_name}
            {employee.department ? ` · ${employee.department}` : ''}
            {employee.position ? ` · ${employee.position}` : ''}
          </p>
        </div>
      </div>

      {errorMsg && !deleteOpen && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2 text-sm text-rose-700">
          {errorMsg}
        </div>
      )}

      {deleteOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => !deleting && setDeleteOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 14, padding: 22, maxWidth: 460, width: '100%',
            direction: 'rtl', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 800, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Trash2 className="size-5" /> מחיקת עובד
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
              עומדים למחוק את <strong>{employee.name}</strong>. פעולה זו <strong>לא ניתנת לביטול</strong>.
              מסמכים, אירועים ורשומות מקושרות עלולים לחסום את המחיקה.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>סיבת המחיקה *</label>
                <input
                  type="text"
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                  placeholder="לדוגמה: כפילות ברישום, בקשת העובד..."
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>הקלד את שם העובד לאישור *</label>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={e => setDeleteConfirmName(e.target.value)}
                  placeholder={employee.name}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit' }}
                />
              </div>
              {errorMsg && (
                <div style={{ background: '#fef2f2', color: '#991b1b', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid #fecaca' }}>
                  {errorMsg}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', marginTop: 4 }}>
                <button
                  onClick={performDelete}
                  disabled={deleting}
                  style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: deleting ? 'wait' : 'pointer', opacity: deleting ? 0.7 : 1, fontFamily: 'inherit' }}
                >{deleting ? 'מוחק...' : 'מחק לצמיתות'}</button>
                <button
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleting}
                  style={{ background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border-b px-6">
        <div className="max-w-[800px] mx-auto flex gap-1 overflow-x-auto">
          <TabButton active={tab === 'profile'}    onClick={() => setTab('profile')}    icon={<User className="size-4" />}        label="פרופיל" />
          <TabButton active={tab === 'documents'}  onClick={() => setTab('documents')}  icon={<FileText className="size-4" />}    label="מסמכים" />
          <TabButton active={tab === 'events'}     onClick={() => setTab('events')}     icon={<CalendarDays className="size-4" />} label="אירועים" />
          <TabButton active={tab === 'salary'}     onClick={() => setTab('salary')}     icon={<TrendingUp className="size-4" />}  label="שכר" />
          <TabButton active={tab === 'onboarding'} onClick={() => setTab('onboarding')} icon={<ListChecks className="size-4" />}  label="קליטה" />
          <TabButton active={tab === 'audit'}      onClick={() => setTab('audit')}      icon={<History className="size-4" />}     label="יומן" />
        </div>
      </div>

      <div className="max-w-[800px] mx-auto px-6 py-6">
        {tab === 'profile'    && <ProfileTab       employee={employee} onTransferred={onTransferred} />}
        {tab === 'documents'  && <DocumentsTab     employee={employee} />}
        {tab === 'events'     && <MonthlyEventsTab employee={employee} />}
        {tab === 'salary'     && <SalaryTab        employee={employee} />}
        {tab === 'onboarding' && <OnboardingTab    employee={employee} />}
        {tab === 'audit'      && <AuditTab         employee={employee} />}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-indigo-500 text-indigo-700'
          : 'border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
