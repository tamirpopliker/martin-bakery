import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { safeDbOperation } from '../lib/dbHelpers'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import PageHeader from '../components/PageHeader'

type Availability = 'unavailable' | 'prefer_not' | 'available'
type TabKey = 'availability' | 'roles'

interface BranchShift {
  id: number
  name: string
  start_time: string
  end_time: string
  days_of_week: number[]
}

interface ShiftRole {
  id: number
  branch_id: number
  name: string
  color: string
  is_active: boolean
}

interface EmployeeRoleAssignment {
  id: number
  employee_id: number
  role_id: number
}

interface StaffingRequirement {
  shift_id: number
  role_id: number
  required_count: number
}

// Order shown in the segmented control (right-to-left in RTL): available first.
const STATES: { key: Availability; label: string; icon: string; color: string; tint: string }[] = [
  { key: 'available',   label: 'פנוי',       icon: '✓', color: '#10b981', tint: '#ecfdf5' },
  { key: 'prefer_not',  label: 'מעדיף שלא',  icon: '~', color: '#f59e0b', tint: '#fffbeb' },
  { key: 'unavailable', label: 'לא יכול',    icon: '✕', color: '#ef4444', tint: '#fef2f2' },
]

const DAY_NAMES_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']

function getWeekDays(weekOffset: number): string[] {
  const today = new Date()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay() + weekOffset * 7)
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    days.push(`${yyyy}-${mm}-${dd}`)
  }
  return days
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function formatTime(time: string): string {
  return time.slice(0, 5)
}

interface Props {
  onBack: () => void
}

export default function EmployeeConstraints({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const branchName = branches.find(b => b.id === appUser?.branch_id)?.name || ''

  const [activeTab, setActiveTab] = useState<TabKey>('availability')
  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [staffingReqs, setStaffingReqs] = useState<StaffingRequirement[]>([])
  const [myRoleIds, setMyRoleIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [resolvedEmpId, setResolvedEmpId] = useState<number | null>(null)
  const [noEmployee, setNoEmployee] = useState(false)
  // Default to the upcoming week — that's what the manager schedules.
  const [weekOffset, setWeekOffset] = useState(1)
  const [constraintMap, setConstraintMap] = useState<Map<string, Availability>>(new Map())
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())
  const [saveError, setSaveError] = useState('')

  // Role assignments tab state
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [assignments, setAssignments] = useState<EmployeeRoleAssignment[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [isManager, setIsManager] = useState(false)

  const weekDays = getWeekDays(weekOffset)

  // ─── Force non-managers to availability tab ────────────
  useEffect(() => {
    if (!isManager && activeTab === 'roles') setActiveTab('availability')
  }, [isManager, activeTab])

  // ─── Employee resolution ───────────────────────────────
  useEffect(() => {
    resolveEmployee()
  }, [appUser])

  async function resolveEmployee() {
    if (appUser?.role === 'admin') setIsManager(true)
    if (appUser?.employee_id) {
      const { data: empData } = await supabase
        .from('branch_employees')
        .select('id, is_manager')
        .eq('id', appUser.employee_id)
        .maybeSingle()
      if (empData) {
        setResolvedEmpId(empData.id)
        if (empData.is_manager) setIsManager(true)
        return
      }
    }
    if (appUser?.email) {
      const { data } = await supabase
        .from('branch_employees')
        .select('id, is_manager')
        .eq('email', appUser.email)
        .maybeSingle()
      if (data) {
        setResolvedEmpId(data.id)
        if (data.is_manager) setIsManager(true)
        return
      }
    }
    setNoEmployee(true)
    setLoading(false)
  }

  // ─── Load shifts & constraints when employee resolved or week changes ───
  useEffect(() => {
    if (resolvedEmpId) loadShiftsAndConstraints()
  }, [resolvedEmpId, weekOffset])

  async function loadShiftsAndConstraints() {
    setLoading(true)
    const dateList = weekDays

    const [shiftsRes, constraintsRes, staffingRes, myRolesRes] = await Promise.all([
      supabase
        .from('branch_shifts')
        .select('id, name, start_time, end_time, days_of_week')
        .eq('branch_id', appUser?.branch_id)
        .eq('is_active', true),
      supabase
        .from('schedule_constraints')
        .select('date, availability, shift_id')
        .eq('employee_id', resolvedEmpId!)
        .in('date', dateList),
      supabase
        .from('shift_staffing_requirements')
        .select('shift_id, role_id, required_count'),
      supabase
        .from('employee_role_assignments')
        .select('role_id')
        .eq('employee_id', resolvedEmpId!),
    ])

    setShifts((shiftsRes.data || []) as BranchShift[])
    setStaffingReqs((staffingRes.data || []) as StaffingRequirement[])
    setMyRoleIds(((myRolesRes.data || []) as { role_id: number }[]).map(r => r.role_id))

    const map = new Map<string, Availability>()
    if (constraintsRes.data) {
      for (const row of constraintsRes.data) {
        const key = `${row.date}|${row.shift_id ?? 0}`
        map.set(key, row.availability as Availability)
      }
    }
    setConstraintMap(map)
    setLoading(false)
  }

  // Filter shifts to those that match the employee's assigned roles.
  // If no role assignments exist yet, or no requirements are defined for any of
  // the branch's shifts, fall back to showing all shifts (don't break setup).
  function isShiftForMe(shiftId: number): boolean {
    if (myRoleIds.length === 0) return true
    const reqRoleIdsForShift = staffingReqs
      .filter(r => r.shift_id === shiftId && r.required_count > 0)
      .map(r => r.role_id)
    if (reqRoleIdsForShift.length === 0) return true
    return reqRoleIdsForShift.some(rid => myRoleIds.includes(rid))
  }

  // Shifts that apply to a given day-of-week, filtered to this employee's roles.
  function shiftsForDow(dow: number): BranchShift[] {
    return shifts.filter(s => s.days_of_week?.includes(dow) && isShiftForMe(s.id))
  }

  // ─── Load roles & assignments ──────────────────────────
  useEffect(() => {
    if (resolvedEmpId && activeTab === 'roles') loadRoles()
  }, [resolvedEmpId, activeTab])

  async function loadRoles() {
    if (!appUser?.branch_id || !resolvedEmpId) return
    setRolesLoading(true)
    const [rolesRes, assignRes] = await Promise.all([
      supabase.from('shift_roles').select('*')
        .eq('branch_id', appUser.branch_id)
        .eq('is_active', true)
        .order('name'),
      supabase.from('employee_role_assignments').select('*')
        .eq('employee_id', resolvedEmpId),
    ])
    if (rolesRes.data) setRoles(rolesRes.data as ShiftRole[])
    if (assignRes.data) setAssignments(assignRes.data as EmployeeRoleAssignment[])
    setRolesLoading(false)
  }

  // ─── Set availability (optimistic + atomic UPSERT) ─────
  async function setAvailability(dateStr: string, shiftId: number, availability: Availability) {
    if (!resolvedEmpId || shiftId === 0) return
    const key = `${dateStr}|${shiftId}`
    const prevValue = constraintMap.get(key) ?? null
    if (prevValue === availability) return // no change
    setSaveError('')

    setConstraintMap(prev => new Map(prev).set(key, availability))
    if (navigator.vibrate) navigator.vibrate(8)

    // Atomic UPSERT on the (employee_id, date, shift_id) unique index (migration 063).
    const res = await safeDbOperation(
      () => supabase.from('schedule_constraints').upsert({
        branch_id: appUser?.branch_id,
        employee_id: resolvedEmpId,
        date: dateStr,
        shift_id: shiftId,
        availability,
        submitted_by_name: null,   // NULL = self-submission by the employee
        updated_at: new Date().toISOString(),
      }, { onConflict: 'employee_id,date,shift_id' }),
      'שמירת הזמינות'
    )

    if (!res.ok) {
      setConstraintMap(prev => {
        const next = new Map(prev)
        if (prevValue === null) next.delete(key)
        else next.set(key, prevValue)
        return next
      })
      setSaveError(res.error)
      return
    }

    setSavedKeys(prev => new Set(prev).add(key))
    setTimeout(() => {
      setSavedKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, 1400)
  }

  // ─── Toggle role assignment (manager only) ─────────────
  async function toggleRole(roleId: number) {
    if (!resolvedEmpId) return
    const existing = assignments.find(a => a.employee_id === resolvedEmpId && a.role_id === roleId)
    if (existing) {
      const prevAssignments = assignments
      setAssignments(prev => prev.filter(a => a.id !== existing.id))
      const { error } = await supabase.from('employee_role_assignments').delete().eq('id', existing.id)
      if (error) {
        setAssignments(prevAssignments)
        alert(`עדכון התפקיד נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      }
    } else {
      const { data, error } = await supabase.from('employee_role_assignments')
        .insert({ employee_id: resolvedEmpId, role_id: roleId })
        .select()
      if (error) {
        alert(`עדכון התפקיד נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
        return
      }
      if (data && data[0]) setAssignments(prev => [...prev, data[0] as EmployeeRoleAssignment])
    }
  }

  // Count of shifts this week the employee marked as NOT fully available.
  const markedCount = (() => {
    let n = 0
    for (let i = 0; i < 6; i++) {
      const date = weekDays[i]
      const dow = new Date(date + 'T12:00:00').getDay()
      for (const s of shiftsForDow(dow)) {
        const v = constraintMap.get(`${date}|${s.id}`)
        if (v && v !== 'available') n++
      }
    }
    return n
  })()

  const hasAnyShift = (() => {
    for (let i = 0; i < 6; i++) {
      const dow = new Date(weekDays[i] + 'T12:00:00').getDay()
      if (shiftsForDow(dow).length > 0) return true
    }
    return false
  })()

  // ─── Render ────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', paddingBottom: activeTab === 'availability' && hasAnyShift ? 88 : 24 }} dir="rtl">
      <div className="max-w-md mx-auto px-4 py-5">
        <PageHeader title="הזמינות שלי" subtitle={branchName} onBack={onBack} />

        {/* Tab toggle — only for managers/admin */}
        {isManager && (
          <div className="flex items-center justify-center mb-4">
            <div className="bg-slate-100 rounded-xl p-1 flex gap-1">
              {(['availability', 'roles'] as TabKey[]).map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                    activeTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                  }`}>
                  {t === 'availability' ? 'הזמינות שלי' : 'התפקידים שלי'}
                </button>
              ))}
            </div>
          </div>
        )}

        {noEmployee ? (
          <div className="text-center py-16">
            <p className="text-slate-500 font-semibold">לא נמצאת כעובד במערכת</p>
            <p className="text-sm text-slate-400 mt-2">פנה למנהל הסניף שלך לקישור החשבון.</p>
          </div>
        ) : activeTab === 'availability' ? (
          /* ═══════════ AVAILABILITY ═══════════ */
          <>
            {/* Week navigation */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <button onClick={() => setWeekOffset(w => w + 1)}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-sm font-semibold active:scale-95 transition">
                <ChevronRight size={16} /> הבא
              </button>
              <div className="text-center">
                <div className="text-sm font-extrabold text-slate-800">
                  {formatShortDate(weekDays[0])} – {formatShortDate(weekDays[5])}
                </div>
                {weekOffset === 1 && <div className="text-[11px] text-indigo-500 font-semibold">השבוע הבא</div>}
              </div>
              <button onClick={() => setWeekOffset(w => Math.max(0, w - 1))} disabled={weekOffset <= 0}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-sm font-semibold disabled:opacity-40 active:scale-95 transition">
                קודם <ChevronLeft size={16} />
              </button>
            </div>

            {/* Hint */}
            <div className="rounded-xl px-4 py-3 mb-3" style={{ background: '#eef2ff', border: '1px solid #e0e7ff' }}>
              <p className="text-[13px] text-indigo-900 leading-relaxed">
                כברירת מחדל אתה מסומן <b>פנוי</b> לכל המשמרות. סמן רק היכן שאינך יכול —
                <span className="text-indigo-600"> נשמר אוטומטית</span>.
              </p>
            </div>

            {saveError && (
              <div className="mb-3 px-4 py-2.5 rounded-xl text-sm text-center"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                {saveError}
              </div>
            )}

            {loading ? (
              <div className="text-center py-16 text-slate-400">טוען...</div>
            ) : !hasAnyShift ? (
              <div className="text-center py-16 text-slate-400 text-sm">לא הוגדרו משמרות לסניף זה</div>
            ) : (
              <div className="flex flex-col gap-4">
                {[0, 1, 2, 3, 4, 5].map(dayIdx => {
                  const date = weekDays[dayIdx]
                  const dow = new Date(date + 'T12:00:00').getDay()
                  const dayShifts = shiftsForDow(dow)
                  if (dayShifts.length === 0) return null
                  return (
                    <motion.div key={date}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: dayIdx * 0.03 }}>
                      {/* Day header */}
                      <div className="flex items-baseline gap-2 mb-2 px-1">
                        <span className="text-[15px] font-extrabold text-slate-800">יום {DAY_NAMES_FULL[dayIdx]}</span>
                        <span className="text-xs text-slate-400 font-medium">{formatShortDate(date)}</span>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        {dayShifts.map(shift => {
                          const key = `${date}|${shift.id}`
                          const current: Availability = constraintMap.get(key) || 'available'
                          const isSaved = savedKeys.has(key)
                          return (
                            <div key={shift.id} className="bg-white rounded-2xl p-3"
                              style={{ border: '1px solid #f1f5f9', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                              <div className="flex items-center justify-between mb-2.5 px-0.5">
                                <span className="text-[14px] font-bold text-slate-800">{shift.name}</span>
                                <span className="flex items-center gap-2">
                                  {isSaved && (
                                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-emerald-500 flex items-center gap-0.5 text-[11px] font-semibold">
                                      <Check size={13} /> נשמר
                                    </motion.span>
                                  )}
                                  <span className="text-[12px] text-slate-400 font-medium">
                                    {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
                                  </span>
                                </span>
                              </div>
                              {/* Segmented 3-state control */}
                              <div className="flex gap-1.5">
                                {STATES.map(st => {
                                  const active = current === st.key
                                  return (
                                    <button key={st.key}
                                      onClick={() => setAvailability(date, shift.id, st.key)}
                                      className="flex-1 rounded-xl font-bold transition-all active:scale-[0.97]"
                                      style={{
                                        minHeight: 46,
                                        fontSize: 13,
                                        border: `1.5px solid ${active ? st.color : '#e2e8f0'}`,
                                        background: active ? st.color : 'white',
                                        color: active ? 'white' : '#94a3b8',
                                        boxShadow: active ? `0 2px 8px ${st.color}44` : 'none',
                                      }}>
                                      <span style={{ marginLeft: 4 }}>{st.icon}</span>{st.label}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          /* ═══════════ ROLES (manager only) ═══════════ */
          <div>
            {rolesLoading ? (
              <div className="text-center py-12 text-slate-400">טוען...</div>
            ) : roles.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">המנהל טרם הגדיר תפקידים לסניף</div>
            ) : (
              <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid #f1f5f9' }}>
                {roles.map((role, idx) => {
                  const isAssigned = assignments.some(a => a.role_id === role.id)
                  return (
                    <div key={role.id} className="flex items-center gap-3 px-4 py-3"
                      style={{ borderBottom: idx < roles.length - 1 ? '1px solid #f1f5f9' : undefined }}>
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: role.color }} />
                      <span className="flex-1 text-sm font-semibold text-slate-700">{role.name}</span>
                      <button onClick={() => toggleRole(role.id)}
                        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                        style={{ background: isAssigned ? '#6366f1' : '#e2e8f0' }}>
                        <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                          style={{ transform: isAssigned ? 'translateX(-6px)' : 'translateX(-26px)' }} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky bottom summary + done */}
      {activeTab === 'availability' && hasAnyShift && !noEmployee && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200" style={{ boxShadow: '0 -2px 10px rgba(0,0,0,0.04)' }}>
          <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-[13px] text-slate-500">
              {markedCount === 0
                ? 'פנוי לכל המשמרות'
                : `${markedCount} משמרות סימנת כלא-פנוי`}
            </span>
            <button onClick={onBack}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold active:scale-95 transition">
              סיימתי
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
