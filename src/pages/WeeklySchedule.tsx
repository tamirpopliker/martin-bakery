import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowRight, ChevronLeft, ChevronRight, X, Check, AlertTriangle, Users } from 'lucide-react'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']

type Availability = 'available' | 'prefer_not' | 'unavailable'

const AVAIL_COLORS: Record<Availability, string> = {
  available: '#10b981',
  prefer_not: '#f59e0b',
  unavailable: '#ef4444',
}
const UNKNOWN_COLOR = '#94a3b8'

const AVAIL_EMOJI: Record<Availability | 'unknown', string> = {
  available: '\u{1F7E2}',
  prefer_not: '\u{1F7E1}',
  unavailable: '\u{1F534}',
  unknown: '\u26AA',
}

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface BranchShift {
  id: number
  name: string
  start_time: string
  end_time: string
  days_of_week: number[]
}

interface ShiftRole {
  id: number
  name: string
  color: string
}

interface StaffingRequirement {
  shift_id: number
  role_id: number
  required_count: number
}

interface BranchEmployee {
  id: number
  name: string
}

interface EmployeeRoleAssignment {
  employee_id: number
  role_id: number
}

interface Constraint {
  employee_id: number
  date: string
  availability: Availability
  shift_id: number | null
}

interface ShiftAssignment {
  id: number
  shift_id: number
  employee_id: number
  role_id: number
  date: string
}

interface PopoverState {
  shiftId: number
  roleId: number
  date: string
  slotIndex: number
  x: number
  y: number
}

function getSundayOfNextWeek(): Date {
  const today = new Date()
  const day = today.getDay()
  const diff = 7 - day
  const sunday = new Date(today)
  sunday.setDate(today.getDate() + diff)
  sunday.setHours(0, 0, 0, 0)
  return sunday
}

function getSundayOfCurrentWeek(): Date {
  const today = new Date()
  const day = today.getDay()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - day)
  sunday.setHours(0, 0, 0, 0)
  return sunday
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function formatShortDate(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export default function WeeklySchedule({ branchId, branchName, branchColor, onBack }: Props) {
  const [weekStart, setWeekStart] = useState<Date>(getSundayOfNextWeek)
  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [staffingReqs, setStaffingReqs] = useState<StaffingRequirement[]>([])
  const [employees, setEmployees] = useState<BranchEmployee[]>([])
  const [roleAssignments, setRoleAssignments] = useState<EmployeeRoleAssignment[]>([])
  const [constraints, setConstraints] = useState<Constraint[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const currentWeekSunday = getSundayOfCurrentWeek()
  const canGoBack = weekStart.getTime() > currentWeekSunday.getTime()

  const weekEnd = addDays(weekStart, 5) // Friday
  const weekLabel = `${formatShortDate(weekStart)} \u2013 ${formatShortDate(weekEnd)}`

  const weekDates: string[] = []
  for (let i = 0; i < 6; i++) {
    weekDates.push(formatDate(addDays(weekStart, i)))
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    const dateFrom = weekDates[0]
    const dateTo = weekDates[5]

    const [shiftsRes, rolesRes, staffingRes, empsRes, roleAssignRes, constraintsRes, assignmentsRes] = await Promise.all([
      supabase.from('branch_shifts').select('id, name, start_time, end_time, days_of_week')
        .eq('branch_id', branchId).eq('is_active', true).order('start_time'),
      supabase.from('shift_roles').select('id, name, color')
        .eq('branch_id', branchId).eq('is_active', true).order('name'),
      supabase.from('shift_staffing_requirements').select('shift_id, role_id, required_count'),
      supabase.from('branch_employees').select('id, name')
        .eq('branch_id', branchId).eq('active', true).order('name'),
      supabase.from('employee_role_assignments').select('employee_id, role_id'),
      supabase.from('schedule_constraints').select('employee_id, date, availability, shift_id')
        .eq('branch_id', branchId).gte('date', dateFrom).lte('date', dateTo),
      supabase.from('shift_assignments').select('id, shift_id, employee_id, role_id, date')
        .eq('branch_id', branchId).gte('date', dateFrom).lte('date', dateTo),
    ])

    if (shiftsRes.data) setShifts(shiftsRes.data as BranchShift[])
    if (rolesRes.data) setRoles(rolesRes.data as ShiftRole[])
    if (staffingRes.data) setStaffingReqs(staffingRes.data as StaffingRequirement[])
    if (empsRes.data) setEmployees(empsRes.data as BranchEmployee[])
    if (roleAssignRes.data) setRoleAssignments(roleAssignRes.data as EmployeeRoleAssignment[])
    if (constraintsRes.data) setConstraints(constraintsRes.data as Constraint[])
    if (assignmentsRes.data) setAssignments(assignmentsRes.data as ShiftAssignment[])

    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, weekStart.getTime()])

  useEffect(() => { loadData() }, [loadData])

  // Close popover on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null)
      }
    }
    if (popover) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [popover])

  function getShiftsForDay(dayIndex: number): BranchShift[] {
    return shifts.filter(s => s.days_of_week && s.days_of_week.includes(dayIndex))
  }

  function getRolesForShift(shiftId: number): { roleId: number; roleName: string; roleColor: string; count: number }[] {
    const reqs = staffingReqs.filter(r => r.shift_id === shiftId)
    const result: { roleId: number; roleName: string; roleColor: string; count: number }[] = []
    for (const req of reqs) {
      const role = roles.find(r => r.id === req.role_id)
      if (role && req.required_count > 0) {
        result.push({ roleId: role.id, roleName: role.name, roleColor: role.color, count: req.required_count })
      }
    }
    return result
  }

  function getAssignment(shiftId: number, roleId: number, date: string, slotIndex: number): ShiftAssignment | null {
    const matching = assignments.filter(a => a.shift_id === shiftId && a.role_id === roleId && a.date === date)
    return matching[slotIndex] || null
  }

  function getEmployeeName(empId: number): string {
    return employees.find(e => e.id === empId)?.name || '?'
  }

  function getEmployeeAvailability(empId: number, date: string, shiftId?: number): Availability | null {
    const c = constraints.find(c =>
      c.employee_id === empId &&
      c.date === date &&
      (shiftId === undefined || c.shift_id === shiftId || c.shift_id === null)
    )
    return c ? c.availability : null
  }

  function getAvailColor(empId: number, date: string, shiftId?: number): string {
    const av = getEmployeeAvailability(empId, date, shiftId)
    if (!av) return UNKNOWN_COLOR
    return AVAIL_COLORS[av]
  }

  function isEmployeeAssignedOnDate(empId: number, date: string): boolean {
    return assignments.some(a => a.employee_id === empId && a.date === date)
  }

  async function addAssignment(shiftId: number, roleId: number, date: string, employeeId: number) {
    // Optimistic update
    const tempId = -Date.now()
    const newAssignment: ShiftAssignment = { id: tempId, shift_id: shiftId, employee_id: employeeId, role_id: roleId, date }
    setAssignments(prev => [...prev, newAssignment])
    setPopover(null)

    const { data, error } = await supabase.from('shift_assignments')
      .insert({ branch_id: branchId, shift_id: shiftId, employee_id: employeeId, role_id: roleId, date })
      .select()

    if (data && data[0]) {
      setAssignments(prev => prev.map(a => a.id === tempId ? { ...data[0], shift_id: data[0].shift_id, employee_id: data[0].employee_id, role_id: data[0].role_id, date: data[0].date } as ShiftAssignment : a))
    } else if (error) {
      // Revert on error
      setAssignments(prev => prev.filter(a => a.id !== tempId))
    }
  }

  async function removeAssignment(assignmentId: number) {
    const removed = assignments.find(a => a.id === assignmentId)
    // Optimistic
    setAssignments(prev => prev.filter(a => a.id !== assignmentId))

    const { error } = await supabase.from('shift_assignments').delete().eq('id', assignmentId)
    if (error && removed) {
      setAssignments(prev => [...prev, removed])
    }
  }

  function openPopover(shiftId: number, roleId: number, date: string, slotIndex: number, e: React.MouseEvent) {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setPopover({ shiftId, roleId, date, slotIndex, x: rect.left, y: rect.bottom + 4 })
  }

  function getPopoverEmployees(): { emp: BranchEmployee; avail: Availability | null; alreadyAssigned: boolean }[] {
    if (!popover) return []
    // Filter by role capability
    const eligible = roleAssignments
      .filter(ra => ra.role_id === popover.roleId)
      .map(ra => ra.employee_id)
    const filtered = employees.filter(e => eligible.includes(e.id))

    return filtered.map(emp => {
      const avail = getEmployeeAvailability(emp.id, popover.date, popover.shiftId)
      const alreadyAssigned = isEmployeeAssignedOnDate(emp.id, popover.date)
      return { emp, avail, alreadyAssigned }
    }).sort((a, b) => {
      const order: Record<string, number> = { available: 0, prefer_not: 1, unavailable: 2 }
      const aOrder = a.avail ? (order[a.avail] ?? 3) : 3
      const bOrder = b.avail ? (order[b.avail] ?? 3) : 3
      if (aOrder !== bOrder) return aOrder - bOrder
      if (a.alreadyAssigned !== b.alreadyAssigned) return a.alreadyAssigned ? 1 : -1
      return 0
    })
  }

  // Shift card summary
  function getShiftCardSummary(shiftId: number, date: string): { filled: number; total: number } {
    const shiftRoles = getRolesForShift(shiftId)
    let total = 0
    let filled = 0
    for (const sr of shiftRoles) {
      for (let i = 0; i < sr.count; i++) {
        total++
        if (getAssignment(shiftId, sr.roleId, date, i)) filled++
      }
    }
    return { filled, total }
  }

  // Weekly summary
  function getWeeklySummary() {
    let totalShifts = 0
    let fullShifts = 0
    let incompleteShifts = 0
    const assignedEmployeeIds = new Set<number>()

    for (let dayIdx = 0; dayIdx < 6; dayIdx++) {
      const date = weekDates[dayIdx]
      const dayShifts = getShiftsForDay(dayIdx)
      for (const shift of dayShifts) {
        totalShifts++
        const summary = getShiftCardSummary(shift.id, date)
        if (summary.total > 0 && summary.filled >= summary.total) fullShifts++
        else if (summary.total > 0) incompleteShifts++
      }
    }

    for (const a of assignments) {
      assignedEmployeeIds.add(a.employee_id)
    }
    const unassigned = employees.filter(e => !assignedEmployeeIds.has(e.id))

    return { totalShifts, fullShifts, incompleteShifts, unassigned }
  }

  const summary = !loading ? getWeeklySummary() : null

  return (
    <motion.div dir="rtl" initial="hidden" animate="visible" variants={fadeIn}
      style={{ padding: '16px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight style={{ width: '18px', height: '18px' }} />
        </Button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0 }}>
            {`\u05E1\u05D9\u05D3\u05D5\u05E8 \u05E2\u05D1\u05D5\u05D3\u05D4 \u2014 ${weekLabel}`}
          </h1>
          <span style={{ fontSize: '13px', color: '#64748b' }}>{branchName}</span>
        </div>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: branchColor }} />
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-center gap-4 mb-5">
        <Button variant="outline" size="sm" disabled={!canGoBack}
          onClick={() => setWeekStart(prev => addDays(prev, -7))} className="rounded-lg">
          <ChevronRight size={16} />
        </Button>
        <span className="text-sm font-bold text-slate-700 min-w-[160px] text-center">{weekLabel}</span>
        <Button variant="outline" size="sm"
          onClick={() => setWeekStart(prev => addDays(prev, 7))} className="rounded-lg">
          <ChevronLeft size={16} />
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">{'\u05D8\u05D5\u05E2\u05DF...'}</div>
      ) : (
        <>
          {/* Main grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
            {weekDates.map((date, dayIdx) => {
              const dayShifts = getShiftsForDay(dayIdx)
              return (
                <div key={date}>
                  <div className="text-center mb-2">
                    <div className="text-sm font-bold text-slate-700">{DAY_NAMES[dayIdx]}</div>
                    <div className="text-xs text-slate-400">{formatShortDate(addDays(weekStart, dayIdx))}</div>
                  </div>
                  <div className="flex flex-col gap-3">
                    {dayShifts.length === 0 && (
                      <div className="text-center text-xs text-slate-300 py-4">{'\u05D0\u05D9\u05DF \u05DE\u05E9\u05DE\u05E8\u05D5\u05EA'}</div>
                    )}
                    {dayShifts.map(shift => {
                      const shiftRoles = getRolesForShift(shift.id)
                      const cardSummary = getShiftCardSummary(shift.id, date)
                      const isFull = cardSummary.total > 0 && cardSummary.filled >= cardSummary.total

                      return (
                        <Card key={shift.id} style={{ border: '1px solid #e2e8f0' }}>
                          <CardContent style={{ padding: '10px' }}>
                            {/* Shift header */}
                            <div style={{ marginBottom: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                              <div className="text-sm font-bold text-slate-800">{shift.name}</div>
                              <div className="text-[11px] text-slate-400">
                                {shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}
                              </div>
                            </div>

                            {/* Role slots */}
                            <div className="flex flex-col gap-1.5">
                              {shiftRoles.map(sr => {
                                const slots = []
                                for (let i = 0; i < sr.count; i++) {
                                  const assignment = getAssignment(shift.id, sr.roleId, date, i)
                                  slots.push(
                                    <div key={`${sr.roleId}-${i}`}
                                      className="flex items-center justify-between py-1.5 px-2 rounded-lg"
                                      style={{ background: '#f8fafc' }}>
                                      <span className="text-xs text-slate-500">{sr.roleName}</span>
                                      {assignment ? (
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                                            style={{ background: getAvailColor(assignment.employee_id, date, shift.id), color: 'white' }}>
                                            {getEmployeeName(assignment.employee_id)}
                                          </span>
                                          <button onClick={() => removeAssignment(assignment.id)}
                                            className="text-red-400 hover:text-red-600">
                                            <X size={14} />
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={(e) => openPopover(shift.id, sr.roleId, date, i, e)}
                                          className="text-indigo-500 hover:text-indigo-700 text-lg font-bold">
                                          +
                                        </button>
                                      )}
                                    </div>
                                  )
                                }
                                return slots
                              })}
                            </div>

                            {/* Card summary footer */}
                            {cardSummary.total > 0 && (
                              <div className="flex items-center justify-center gap-1.5 mt-2 pt-2"
                                style={{ borderTop: '1px solid #f1f5f9' }}>
                                {isFull ? (
                                  <Check size={14} style={{ color: '#10b981' }} />
                                ) : (
                                  <AlertTriangle size={14} style={{ color: '#ef4444' }} />
                                )}
                                <span className="text-[11px] font-bold"
                                  style={{ color: isFull ? '#10b981' : '#ef4444' }}>
                                  {`${cardSummary.filled}/${cardSummary.total} \u05EA\u05E4\u05E7\u05D9\u05D3\u05D9\u05DD \u05D0\u05D5\u05D9\u05E9\u05D5`}
                                </span>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Weekly summary panel */}
          {summary && (
            <Card style={{ border: '1px solid #e2e8f0' }}>
              <CardContent style={{ padding: '16px' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Users size={18} style={{ color: '#64748b' }} />
                  <span className="text-base font-bold text-slate-800">{'\u05E1\u05D9\u05DB\u05D5\u05DD \u05E9\u05D1\u05D5\u05E2\u05D9'}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  <div className="text-center p-3 rounded-xl" style={{ background: '#f8fafc' }}>
                    <div className="text-2xl font-bold text-slate-700">{summary.totalShifts}</div>
                    <div className="text-xs text-slate-500">{'\u05E1\u05D4\u05F4\u05DB \u05DE\u05E9\u05DE\u05E8\u05D5\u05EA'}</div>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ background: '#f0fdf4' }}>
                    <div className="text-2xl font-bold" style={{ color: '#10b981' }}>{summary.fullShifts}</div>
                    <div className="text-xs" style={{ color: '#16a34a' }}>{'\u05DE\u05D0\u05D5\u05D9\u05E9\u05D5\u05EA \u05DE\u05DC\u05D0\u05D5\u05EA'}</div>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ background: '#fef2f2' }}>
                    <div className="text-2xl font-bold" style={{ color: '#ef4444' }}>{summary.incompleteShifts}</div>
                    <div className="text-xs" style={{ color: '#dc2626' }}>{'\u05D7\u05E1\u05E8\u05D5\u05EA'}</div>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ background: '#f8fafc' }}>
                    <div className="text-2xl font-bold text-slate-700">{summary.unassigned.length}</div>
                    <div className="text-xs text-slate-500">{'\u05E2\u05D5\u05D1\u05D3\u05D9\u05DD \u05DC\u05DC\u05D0 \u05E9\u05D9\u05D1\u05D5\u05E5'}</div>
                  </div>
                </div>

                {summary.unassigned.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-slate-500 mb-2">{'\u05E2\u05D5\u05D1\u05D3\u05D9\u05DD \u05DC\u05DC\u05D0 \u05E9\u05D9\u05D1\u05D5\u05E5 \u05D4\u05E9\u05D1\u05D5\u05E2:'}</div>
                    <div className="flex flex-wrap gap-2">
                      {summary.unassigned.map(emp => (
                        <span key={emp.id} className="text-xs px-3 py-1 rounded-full"
                          style={{ background: '#f1f5f9', color: '#64748b' }}>
                          {emp.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Employee selection popover */}
      {popover && (
        <div ref={popoverRef}
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"
          style={{
            left: `${Math.min(popover.x, window.innerWidth - 260)}px`,
            top: `${Math.min(popover.y, window.innerHeight - 300)}px`,
            width: '240px',
            maxHeight: '280px',
          }}>
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between"
            style={{ background: '#f8fafc' }}>
            <span className="text-xs font-bold text-slate-600">{'\u05D1\u05D7\u05E8 \u05E2\u05D5\u05D1\u05D3'}</span>
            <button onClick={() => setPopover(null)} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '240px' }}>
            {getPopoverEmployees().length === 0 && (
              <div className="text-center py-4 text-xs text-slate-400">{'\u05D0\u05D9\u05DF \u05E2\u05D5\u05D1\u05D3\u05D9\u05DD \u05DE\u05EA\u05D0\u05D9\u05DE\u05D9\u05DD \u05DC\u05EA\u05E4\u05E7\u05D9\u05D3'}</div>
            )}
            {getPopoverEmployees().map(({ emp, avail, alreadyAssigned }) => (
              <button key={emp.id}
                onClick={() => addAssignment(popover.shiftId, popover.roleId, popover.date, emp.id)}
                className="w-full text-right px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2 transition-colors"
                style={{ borderBottom: '1px solid #f8fafc' }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{AVAIL_EMOJI[avail || 'unknown']}</span>
                  <span className="text-xs font-medium text-slate-700">{emp.name}</span>
                </div>
                {alreadyAssigned && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold whitespace-nowrap">
                    {'\u05DE\u05E9\u05D5\u05D1\u05E5'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
