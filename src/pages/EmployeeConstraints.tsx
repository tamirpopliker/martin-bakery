import { useState, useEffect } from 'react'
import { motion, AnimatePresence, type PanInfo } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { Button } from '@/components/ui/button'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import PageHeader from '../components/PageHeader'

const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, delay } },
})

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

const AVAIL_CONFIG: Record<Availability, { label: string; icon: string; color: string; border: string }> = {
  available:    { label: 'פנוי',         icon: '✓', color: '#10b981', border: '#a7f3d0' },
  prefer_not:   { label: 'מעדיף שלא',   icon: '~', color: '#f59e0b', border: '#fde68a' },
  unavailable:  { label: 'לא יכול',     icon: '✕', color: '#ef4444', border: '#fecaca' },
}

const UNSET_BORDER = '#e2e8f0'

const CYCLE_ORDER: Availability[] = ['available', 'prefer_not', 'unavailable']

const DAY_NAMES_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

function getWeekDays(weekOffset: number): string[] {
  const today = new Date()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay() + weekOffset * 7)
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    // Use local date format to avoid timezone issues
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
  const [loading, setLoading] = useState(true)
  const [resolvedEmpId, setResolvedEmpId] = useState<number | null>(null)
  const [noEmployee, setNoEmployee] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  const [constraintMap, setConstraintMap] = useState<Map<string, Availability>>(new Map())
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())
  const [currentDayIndex, setCurrentDayIndex] = useState(0)
  const [direction, setDirection] = useState(0)

  // Role assignments tab state
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [assignments, setAssignments] = useState<EmployeeRoleAssignment[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [isManager, setIsManager] = useState(false)

  const weekDays = getWeekDays(weekOffset)
  const weekLabel = `שבוע — ${formatShortDate(weekDays[0])} עד ${formatShortDate(weekDays[6])}`

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
    setCurrentDayIndex(0)
  }, [resolvedEmpId, weekOffset])

  async function loadShiftsAndConstraints() {
    setLoading(true)
    const dateList = weekDays

    const [shiftsRes, constraintsRes] = await Promise.all([
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
    ])

    const loadedShifts: BranchShift[] = (shiftsRes.data || []) as BranchShift[]
    setShifts(loadedShifts)

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

  // ─── Set availability (optimistic) ─────────────────────
  async function setAvailability(dateStr: string, shiftId: number, availability: Availability) {
    if (!resolvedEmpId || shiftId === 0) return
    const key = `${dateStr}|${shiftId}`

    // Optimistic update
    setConstraintMap(prev => {
      const next = new Map(prev)
      next.set(key, availability)
      return next
    })

    // Persist
    await supabase
      .from('schedule_constraints')
      .delete()
      .eq('employee_id', resolvedEmpId)
      .eq('date', dateStr)
      .eq('shift_id', shiftId)

    await supabase
      .from('schedule_constraints')
      .insert({
        branch_id: appUser?.branch_id,
        employee_id: resolvedEmpId,
        date: dateStr,
        shift_id: shiftId,
        availability,
        updated_at: new Date().toISOString(),
      })

    // Brief checkmark
    setSavedKeys(prev => new Set(prev).add(key))
    setTimeout(() => {
      setSavedKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, 1500)
  }

  // ─── Toggle role assignment ────────────────────────────
  async function toggleRole(roleId: number) {
    if (!resolvedEmpId) return
    const existing = assignments.find(a => a.employee_id === resolvedEmpId && a.role_id === roleId)
    if (existing) {
      setAssignments(prev => prev.filter(a => a.id !== existing.id))
      await supabase.from('employee_role_assignments').delete().eq('id', existing.id)
    } else {
      const { data } = await supabase.from('employee_role_assignments')
        .insert({ employee_id: resolvedEmpId, role_id: roleId })
        .select()
      if (data && data[0]) {
        setAssignments(prev => [...prev, data[0] as EmployeeRoleAssignment])
      }
    }
  }

  // ─── Swipe gesture handler ──────────────────────────────
  const handleDragEnd = (_: any, info: PanInfo) => {
    const threshold = 50
    if (info.offset.x < -threshold && currentDayIndex < 5) {
      setDirection(1)
      setCurrentDayIndex(prev => prev + 1)
      if (navigator.vibrate) navigator.vibrate(10)
    } else if (info.offset.x > threshold && currentDayIndex > 0) {
      setDirection(-1)
      setCurrentDayIndex(prev => prev - 1)
      if (navigator.vibrate) navigator.vibrate(10)
    }
  }

  const swipeVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0 }),
  }

  // ─── Compute which shifts apply to ANY day in the week ─
  function getWeekShifts(): BranchShift[] {
    const daysInWeek = weekDays.map(d => new Date(d + 'T12:00:00').getDay())
    return shifts.filter(s =>
      s.days_of_week && s.days_of_week.some(dow => daysInWeek.includes(dow))
    )
  }

  // Helper to get cell style for availability
  function getCellStyle(current: Availability | null): React.CSSProperties {
    if (!current) {
      return {
        border: `1px solid ${UNSET_BORDER}`,
        background: 'white',
      }
    }
    const ac = AVAIL_CONFIG[current]
    return {
      border: `1px solid ${ac.border}`,
      background: 'white',
    }
  }

  // ─── Render ────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }} dir="rtl">
      <div className="max-w-lg mx-auto px-4 py-6">
        <PageHeader title="הזמינות שלי" subtitle={branchName} onBack={onBack} />

        {/* Tab toggle — only show if manager/admin */}
        {isManager && (
        <motion.div variants={fadeIn(0.05)} initial="hidden" animate="visible" className="flex items-center justify-center gap-2 mb-5">
          <div className="bg-slate-100 rounded-xl p-1 flex gap-1">
            <button
              onClick={() => setActiveTab('availability')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                activeTab === 'availability'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              הזמינות שלי
            </button>
            <button
              onClick={() => setActiveTab('roles')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                activeTab === 'roles'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              התפקידים שלי
            </button>
          </div>
        </motion.div>
        )}

        {noEmployee ? (
          <div className="text-center py-12">
            <p className="text-slate-500 font-semibold">לא נמצאת כעובד במערכת</p>
            <p className="text-sm text-slate-400 mt-2">פנה למנהל הסניף שלך לקישור החשבון.</p>
          </div>
        ) : activeTab === 'availability' ? (
          /* ===== TAB 1: AVAILABILITY CALENDAR ===== */
          <>
            {/* Legend */}
            <motion.div variants={fadeIn(0.05)} initial="hidden" animate="visible"
              className="flex justify-center gap-5 mb-5 text-xs">
              {Object.entries(AVAIL_CONFIG).map(([, cfg]) => (
                <span key={cfg.label} className="flex items-center gap-1.5" style={{ color: cfg.color }}>
                  <span style={{ fontWeight: '700', fontSize: 11 }}>{cfg.icon}</span>
                  <span style={{ color: '#64748b' }}>{cfg.label}</span>
                </span>
              ))}
            </motion.div>

            {/* Week nav */}
            <motion.div variants={fadeIn(0.1)} initial="hidden" animate="visible"
              className="flex items-center justify-center gap-4 mb-5">
              <Button variant="outline" size="sm"
                onClick={() => setWeekOffset(w => w + 1)}
                className="rounded-lg">
                <ChevronRight size={16} />
              </Button>
              <span className="text-sm font-bold text-slate-700 min-w-[180px] text-center">{weekLabel}</span>
              <Button variant="outline" size="sm"
                onClick={() => setWeekOffset(w => w - 1)}
                disabled={weekOffset <= 0}
                className="rounded-lg">
                <ChevronLeft size={16} />
              </Button>
              {weekOffset !== 0 && (
                <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)} className="text-xs text-indigo-500">
                  השבוע
                </Button>
              )}
            </motion.div>

            {loading ? (
              <div className="text-center py-12 text-slate-400">טוען...</div>
            ) : shifts.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">
                לא הוגדרו משמרות לסניף זה
              </div>
            ) : (
              <>
              {/* ═══ MOBILE: Day-by-day card view with swipe ═══ */}
              <motion.div variants={fadeIn(0.15)} initial="hidden" animate="visible" className="md:hidden">
                {(() => {
                  const DAY_NAMES_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']
                  const mDate = weekDays[currentDayIndex]
                  const mDow = new Date(mDate + 'T12:00:00').getDay()
                  const mShifts = shifts.filter(s => s.days_of_week && s.days_of_week.includes(mDow))

                  return (
                    <>
                      {/* Day header */}
                      <div style={{ textAlign: 'center', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                          <button
                            onClick={() => { if (currentDayIndex > 0) { setDirection(-1); setCurrentDayIndex(prev => prev - 1); if (navigator.vibrate) navigator.vibrate(10) } }}
                            disabled={currentDayIndex === 0}
                            style={{ width: 44, height: 44, borderRadius: '50%', background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: currentDayIndex > 0 ? 'pointer' : 'default', opacity: currentDayIndex === 0 ? 0.3 : 1, fontSize: 18 }}
                          >{'\u2192'}</button>
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{'יום ' + DAY_NAMES_FULL[currentDayIndex]}</div>
                            <div style={{ fontSize: 14, color: '#94a3b8' }}>{formatShortDate(weekDays[currentDayIndex])}</div>
                          </div>
                          <button
                            onClick={() => { if (currentDayIndex < 5) { setDirection(1); setCurrentDayIndex(prev => prev + 1); if (navigator.vibrate) navigator.vibrate(10) } }}
                            disabled={currentDayIndex === 5}
                            style={{ width: 44, height: 44, borderRadius: '50%', background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: currentDayIndex < 5 ? 'pointer' : 'default', opacity: currentDayIndex === 5 ? 0.3 : 1, fontSize: 18 }}
                          >{'\u2190'}</button>
                        </div>
                        {/* Dots */}
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                          {[0,1,2,3,4,5].map(i => (
                            <div key={i} style={{
                              width: i === currentDayIndex ? 10 : 8,
                              height: i === currentDayIndex ? 10 : 8,
                              borderRadius: '50%',
                              background: i === currentDayIndex ? '#6366f1' : '#e2e8f0',
                              transition: 'all 0.2s',
                            }} />
                          ))}
                        </div>
                      </div>

                      {/* Day content with swipe */}
                      <div style={{ overflow: 'hidden' }}>
                        <AnimatePresence mode="wait" custom={direction}>
                          <motion.div
                            key={currentDayIndex}
                            custom={direction}
                            variants={swipeVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.2, ease: 'easeInOut' }}
                            drag="x"
                            dragConstraints={{ left: 0, right: 0 }}
                            dragElastic={0.2}
                            onDragEnd={handleDragEnd}
                            style={{ touchAction: 'pan-y' }}
                          >
                            {mShifts.length === 0 ? (
                              <div style={{
                                background: 'white',
                                border: '1px solid #f1f5f9',
                                borderRadius: 12,
                                padding: 32,
                                textAlign: 'center',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                              }}>
                                <div className="text-slate-400 text-sm">אין משמרות ביום זה</div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-3">
                                {mShifts.map(shift => {
                                  const key = `${mDate}|${shift.id}`
                                  const current = constraintMap.get(key) || 'available'
                                  const isSaved = savedKeys.has(key)
                                  const ac = AVAIL_CONFIG[current]
                                  const nextAvail = CYCLE_ORDER[(CYCLE_ORDER.indexOf(current) + 1) % 3]

                                  return (
                                    <div key={shift.id} style={{
                                      background: 'white',
                                      border: '1px solid #f1f5f9',
                                      borderRadius: 12,
                                      overflow: 'hidden',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                    }}>
                                      <div style={{
                                        padding: '10px 16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        borderBottom: '1px solid #f1f5f9',
                                      }}>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{shift.name}</span>
                                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{formatTime(shift.start_time)} — {formatTime(shift.end_time)}</span>
                                      </div>
                                      <motion.button
                                        whileTap={{ scale: 0.96 }}
                                        onClick={() => setAvailability(mDate, shift.id, nextAvail)}
                                        className="w-full transition-colors duration-200 relative"
                                        style={{
                                          height: '100px',
                                          border: 'none',
                                          background: 'white',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          gap: '4px',
                                        }}>
                                        <span style={{ fontSize: '28px', fontWeight: '800', color: ac.color, lineHeight: 1 }}>{ac.icon}</span>
                                        <span style={{ fontSize: '13px', fontWeight: '600', color: ac.color }}>{ac.label}</span>
                                        {isSaved && (
                                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                                            style={{ position: 'absolute', top: '8px', left: '8px' }}
                                            className="text-emerald-500">
                                            <Check size={16} />
                                          </motion.span>
                                        )}
                                      </motion.button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </>
                  )
                })()}
              </motion.div>

              {/* ═══ DESKTOP: Weekly grid table ═══ */}
              <motion.div variants={fadeIn(0.15)} initial="hidden" animate="visible"
                className="hidden md:block" style={{
                  background: 'white',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid #f1f5f9',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: '600px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <th className="px-3 py-2 text-xs font-bold text-slate-500 text-right sticky right-0 bg-white z-10" style={{ minWidth: '90px' }}>
                          משמרת
                        </th>
                        {weekDays.map((date, i) => {
                          const isSat = i === 6
                          return (
                            <th key={date} className="px-1 py-2 text-center text-xs font-bold"
                              style={{ color: isSat ? '#cbd5e1' : '#64748b' }}>
                              <div>{DAY_NAMES_SHORT[i]}</div>
                              <div className="text-[10px] font-normal" style={{ color: '#94a3b8' }}>{formatShortDate(date)}</div>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {getWeekShifts().map(shift => (
                        <tr key={shift.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                          <td className="px-3 py-2 text-xs font-semibold text-slate-700 sticky right-0 bg-white z-10">
                            <div>{shift.name}</div>
                            <div className="text-[10px] text-slate-400 font-normal">
                              {formatTime(shift.start_time)}-{formatTime(shift.end_time)}
                            </div>
                          </td>
                          {weekDays.map((date, dayIdx) => {
                            const isSat = dayIdx === 6
                            const dow = new Date(date + 'T12:00:00').getDay()
                            const applies = shift.days_of_week && shift.days_of_week.includes(dow)

                            if (isSat) {
                              return (
                                <td key={date} className="p-1">
                                  <div style={{ height: '64px', borderRadius: '8px', background: '#fafafa', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span className="text-[10px] text-slate-300">שבת</span>
                                  </div>
                                </td>
                              )
                            }

                            if (!applies) {
                              return (
                                <td key={date} className="p-1">
                                  <div style={{ height: '64px', borderRadius: '8px', background: '#fafafa', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span className="text-slate-200">—</span>
                                  </div>
                                </td>
                              )
                            }

                            const key = `${date}|${shift.id}`
                            const current = constraintMap.get(key) || 'available'
                            const isSaved = savedKeys.has(key)
                            const ac = AVAIL_CONFIG[current]
                            const nextAvail = CYCLE_ORDER[(CYCLE_ORDER.indexOf(current) + 1) % 3]

                            return (
                              <td key={date} className="p-1">
                                <motion.button
                                  whileTap={{ scale: 0.93 }}
                                  onClick={() => setAvailability(date, shift.id, nextAvail)}
                                  className="w-full transition-colors duration-200 relative"
                                  style={{
                                    height: '64px',
                                    borderRadius: '8px',
                                    border: `1px solid ${ac.border}`,
                                    background: 'white',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '2px',
                                  }}>
                                  <span style={{ fontSize: '16px', fontWeight: '700', color: ac.color, lineHeight: 1 }}>{ac.icon}</span>
                                  <span style={{ fontSize: '9px', fontWeight: '600', color: ac.color }}>{ac.label}</span>
                                  {isSaved && (
                                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                                      style={{ position: 'absolute', top: '3px', left: '3px' }}
                                      className="text-emerald-500">
                                      <Check size={10} />
                                    </motion.span>
                                  )}
                                </motion.button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
              </>
            )}
          </>
        ) : (
          /* ===== TAB 2: ROLE ASSIGNMENTS ===== */
          <motion.div variants={fadeIn(0.1)} initial="hidden" animate="visible">
            {rolesLoading ? (
              <div className="text-center py-12 text-slate-400">טוען...</div>
            ) : roles.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">
                המנהל טרם הגדיר תפקידים לסניף
              </div>
            ) : (
              <div style={{
                background: 'white',
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid #f1f5f9',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                {roles.map((role, idx) => {
                  const isAssigned = assignments.some(a => a.role_id === role.id)
                  const canEdit = isManager
                  return (
                    <div key={role.id}
                      className="flex items-center gap-3 px-4 py-3"
                      style={{ borderBottom: idx < roles.length - 1 ? '1px solid #f1f5f9' : undefined }}>
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: role.color }} />
                      <span className="flex-1 text-sm font-semibold text-slate-700">{role.name}</span>
                      {canEdit ? (
                        <button
                          onClick={() => toggleRole(role.id)}
                          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none"
                          style={{
                            background: isAssigned ? '#6366f1' : '#e2e8f0',
                          }}
                        >
                          <span
                            className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200"
                            style={{
                              transform: isAssigned ? 'translateX(-6px)' : 'translateX(-26px)',
                            }}
                          />
                        </button>
                      ) : (
                        isAssigned ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#eef2ff', color: '#6366f1' }}>פעיל</span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}
