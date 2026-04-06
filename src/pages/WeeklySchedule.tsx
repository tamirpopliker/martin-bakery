import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'

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
  initialWeekStart?: string
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
  priority: number
  min_shifts_per_week: number
  training_status: string
}

interface SpecialDay {
  id: number
  date: string
  name: string
  type: string
  staffing_multiplier: number
  shift_pattern: string
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

export default function WeeklySchedule({ branchId, branchName, branchColor, onBack, initialWeekStart }: Props) {
  const [weekStart, setWeekStart] = useState<Date>(() => {
    if (initialWeekStart) {
      const d = new Date(initialWeekStart + 'T00:00:00')
      if (!isNaN(d.getTime())) return d
    }
    return getSundayOfNextWeek()
  })
  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [staffingReqs, setStaffingReqs] = useState<StaffingRequirement[]>([])
  const [employees, setEmployees] = useState<BranchEmployee[]>([])
  const [roleAssignments, setRoleAssignments] = useState<EmployeeRoleAssignment[]>([])
  const [constraints, setConstraints] = useState<Constraint[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([])
  const [loading, setLoading] = useState(true)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [showAutoDialog, setShowAutoDialog] = useState(false)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [roleColors, setRoleColors] = useState<Map<number, string>>(new Map())
  const [isPublished, setIsPublished] = useState(false)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [mobileDayIdx, setMobileDayIdx] = useState(0)
  const [hoveredAssignment, setHoveredAssignment] = useState<number | null>(null)
  const [popoverSearch, setPopoverSearch] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  const currentWeekSunday = getSundayOfCurrentWeek()
  const canGoBack = weekStart.getTime() > currentWeekSunday.getTime()

  const weekEnd = addDays(weekStart, 5) // Friday

  const weekDates: string[] = []
  for (let i = 0; i < 6; i++) {
    weekDates.push(formatDate(addDays(weekStart, i)))
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    const dateFrom = weekDates[0]
    const dateTo = weekDates[5]

    const [shiftsRes, rolesRes, staffingRes, empsRes, roleAssignRes, constraintsRes, assignmentsRes, specialDaysRes] = await Promise.all([
      supabase.from('branch_shifts').select('id, name, start_time, end_time, days_of_week')
        .eq('branch_id', branchId).eq('is_active', true).order('start_time'),
      supabase.from('shift_roles').select('id, name, color')
        .eq('branch_id', branchId).eq('is_active', true).order('name'),
      supabase.from('shift_staffing_requirements').select('shift_id, role_id, required_count'),
      supabase.from('branch_employees').select('id, name, priority, min_shifts_per_week, training_status')
        .eq('branch_id', branchId).eq('active', true).order('name'),
      supabase.from('employee_role_assignments').select('employee_id, role_id'),
      supabase.from('schedule_constraints').select('employee_id, date, availability, shift_id')
        .eq('branch_id', branchId).gte('date', dateFrom).lte('date', dateTo),
      supabase.from('shift_assignments').select('id, shift_id, employee_id, role_id, date')
        .eq('branch_id', branchId).gte('date', dateFrom).lte('date', dateTo),
      supabase.from('special_days').select('*')
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .gte('date', dateFrom).lte('date', dateTo),
    ])

    if (shiftsRes.data) setShifts(shiftsRes.data as BranchShift[])
    if (rolesRes.data) {
      setRoles(rolesRes.data as ShiftRole[])
      const colorMap = new Map<number, string>()
      rolesRes.data.forEach((r: any) => colorMap.set(r.id, r.color || '#6366f1'))
      setRoleColors(colorMap)
    }
    if (staffingRes.data) setStaffingReqs(staffingRes.data as StaffingRequirement[])
    if (empsRes.data) setEmployees(empsRes.data as BranchEmployee[])
    if (roleAssignRes.data) setRoleAssignments(roleAssignRes.data as EmployeeRoleAssignment[])
    if (constraintsRes.data) setConstraints(constraintsRes.data as Constraint[])
    if (assignmentsRes.data) setAssignments(assignmentsRes.data as ShiftAssignment[])
    if (specialDaysRes.data) setSpecialDays(specialDaysRes.data as SpecialDay[])

    const { data: pub } = await supabase.from('schedule_publications')
      .select('*').eq('branch_id', branchId).eq('week_start', weekDates[0]).maybeSingle()
    setIsPublished(!!pub)
    setPublishedAt(pub?.published_at || null)

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

  function getEffectiveShiftsForDay(dayIndex: number, date: string): BranchShift[] {
    const sd = specialDays.find(s => s.date === date)

    if (sd?.shift_pattern === 'closed') {
      return [] // No shifts on closed days
    }

    if (sd?.shift_pattern === 'friday') {
      // Use Friday shifts (days_of_week includes 5) regardless of actual day
      return shifts.filter(s => (s.days_of_week as number[]).includes(5))
    }

    // Regular: filter by actual day of week
    return shifts.filter(s => (s.days_of_week as number[]).includes(dayIndex))
  }

  function getAdjustedRequired(shiftId: number, date: string): { roleId: number; count: number }[] {
    const sd = specialDays.find(s => s.date === date)
    const multiplier = sd?.staffing_multiplier || 1.0
    const base = staffingReqs.filter(sr => sr.shift_id === shiftId)
    return base.map(sr => ({
      roleId: sr.role_id,
      count: Math.ceil(sr.required_count * multiplier)
    }))
  }

  function getRolesForShift(shiftId: number, date?: string): { roleId: number; roleName: string; roleColor: string; count: number }[] {
    const adjustedReqs = date ? getAdjustedRequired(shiftId, date) : null
    const result: { roleId: number; roleName: string; roleColor: string; count: number }[] = []
    if (adjustedReqs) {
      for (const req of adjustedReqs) {
        const role = roles.find(r => r.id === req.roleId)
        if (role && req.count > 0) {
          result.push({ roleId: role.id, roleName: role.name, roleColor: role.color, count: req.count })
        }
      }
    } else {
      const reqs = staffingReqs.filter(r => r.shift_id === shiftId)
      for (const req of reqs) {
        const role = roles.find(r => r.id === req.role_id)
        if (role && req.required_count > 0) {
          result.push({ roleId: role.id, roleName: role.name, roleColor: role.color, count: req.required_count })
        }
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
    if (!av) return AVAIL_COLORS.available // Default: available (green) if not set
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
    setPopoverSearch('')
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
      const aOrder = a.avail ? (order[a.avail] ?? 0) : 0  // null = available (first)
      const bOrder = b.avail ? (order[b.avail] ?? 0) : 0
      if (aOrder !== bOrder) return aOrder - bOrder
      if (a.alreadyAssigned !== b.alreadyAssigned) return a.alreadyAssigned ? 1 : -1
      return 0
    })
  }

  // Shift card summary
  function getShiftCardSummary(shiftId: number, date: string): { filled: number; total: number } {
    const shiftRoles = getRolesForShift(shiftId, date)
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
      const dayShifts = getEffectiveShiftsForDay(dayIdx, date)
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

  async function runAutoSchedule() {
    setShowAutoDialog(false)

    // Delete existing assignments for this week
    await supabase.from('shift_assignments').delete()
      .eq('branch_id', branchId)
      .gte('date', weekDates[0])
      .lte('date', weekDates[5])

    const newAssignments: { branch_id: number; shift_id: number; employee_id: number; role_id: number; date: string }[] = []
    const empShiftCount: Record<number, number> = {}
    employees.forEach(e => { empShiftCount[e.id] = 0 })
    const empDayAssigned: Record<string, boolean> = {}

    for (let dayIdx = 0; dayIdx < 6; dayIdx++) {
      const date = weekDates[dayIdx]
      const dayShifts = getEffectiveShiftsForDay(dayIdx, date)

      for (const shift of dayShifts) {
        const adjustedReqs = getAdjustedRequired(shift.id, date)

        for (const req of adjustedReqs) {
          for (let slot = 0; slot < req.count; slot++) {
            const eligible = employees.filter(emp => {
              if (!roleAssignments.some(ra => ra.employee_id === emp.id && ra.role_id === req.roleId)) return false
              const avail = getEmployeeAvailability(emp.id, date, shift.id)
              if (avail === 'unavailable') return false
              const alreadyInShift = newAssignments.some(a =>
                a.employee_id === emp.id && a.shift_id === shift.id && a.date === date)
              if (alreadyInShift) return false
              return true
            })

            const scored = eligible.map(emp => {
              let score = 0
              const avail = getEmployeeAvailability(emp.id, date, shift.id)
              if (avail === 'available' || avail === null) score += 50
              else if (avail === 'prefer_not') score += 20
              const p = emp.priority || 2
              if (p === 1) score += 40
              else if (p === 2) score += 20
              const minReq = emp.min_shifts_per_week || 0
              if (minReq > 0 && empShiftCount[emp.id] < minReq) score += 30
              score += Math.max(0, 10 - empShiftCount[emp.id] * 2)
              if (empDayAssigned[`${emp.id}_${date}`]) score -= 20
              return { emp, score }
            })

            scored.sort((a, b) => b.score - a.score)

            // Rule: trainee needs a mentor in the same shift
            const filteredScored = scored.filter(({ emp }) => {
              if (emp.training_status !== 'trainee') return true
              // Check if a mentor is already assigned to this shift
              return newAssignments.some(a =>
                a.shift_id === shift.id && a.date === date &&
                employees.find(e => e.id === a.employee_id)?.training_status === 'mentor'
              )
            })

            if (filteredScored.length > 0 && filteredScored[0].score > 0) {
              const chosen = filteredScored[0].emp
              newAssignments.push({
                branch_id: branchId,
                shift_id: shift.id,
                employee_id: chosen.id,
                role_id: req.roleId,
                date,
              })
              empShiftCount[chosen.id] = (empShiftCount[chosen.id] || 0) + 1
              empDayAssigned[`${chosen.id}_${date}`] = true
            }
          }
        }
      }
    }

    if (newAssignments.length > 0) {
      await supabase.from('shift_assignments').insert(newAssignments)
    }

    await loadData()

    let unfilled = 0
    for (let dayIdx = 0; dayIdx < 6; dayIdx++) {
      const date = weekDates[dayIdx]
      for (const shift of getEffectiveShiftsForDay(dayIdx, date)) {
        const reqs = getAdjustedRequired(shift.id, date)
        const totalReq = reqs.reduce((s, r) => s + r.count, 0)
        const filled = newAssignments.filter(a => a.shift_id === shift.id && a.date === date).length
        unfilled += Math.max(0, totalReq - filled)
      }
    }

    alert(`\u2705 \u05E9\u05D5\u05D1\u05E6\u05D5 ${newAssignments.length} \u05E2\u05D5\u05D1\u05D3\u05D9\u05DD${unfilled > 0 ? ` | \u26A0\uFE0F \u05E0\u05D5\u05EA\u05E8\u05D5 ${unfilled} \u05EA\u05E4\u05E7\u05D9\u05D3\u05D9\u05DD \u05DC\u05DC\u05D0 \u05DB\u05D9\u05E1\u05D5\u05D9` : ''}`)
  }

  async function clearWeekAssignments() {
    setShowClearDialog(false)
    await supabase.from('shift_assignments').delete()
      .eq('branch_id', branchId)
      .gte('date', weekDates[0])
      .lte('date', weekDates[5])
    setAssignments([])
  }

  async function publishSchedule() {
    setShowPublishDialog(false)
    const { data: session } = await supabase.auth.getSession()
    await supabase.from('schedule_publications').upsert({
      branch_id: branchId,
      week_start: weekDates[0],
      published_by: session?.session?.user?.id
    }, { onConflict: 'branch_id,week_start' })
    setIsPublished(true)
    setPublishedAt(new Date().toISOString())
    try {
      await supabase.functions.invoke('send-schedule', {
        body: { branch_id: branchId, week_start: weekDates[0], week_end: weekDates[5] }
      })
    } catch (e) {
      console.warn('Email send failed:', e)
    }
    alert('\u2705 \u05D4\u05E1\u05D9\u05D3\u05D5\u05E8 \u05E4\u05D5\u05E8\u05E1\u05DD \u05D5\u05DE\u05D9\u05D9\u05DC\u05D9\u05DD \u05E0\u05E9\u05DC\u05D7\u05D5 \u05DC\u05E2\u05D5\u05D1\u05D3\u05D9\u05DD')
  }

  async function unpublishSchedule() {
    if (!confirm('\u05D4\u05D0\u05DD \u05DC\u05D1\u05D8\u05DC \u05D0\u05EA \u05E4\u05E8\u05E1\u05D5\u05DD \u05D4\u05E1\u05D9\u05D3\u05D5\u05E8?')) return
    await supabase.from('schedule_publications').delete()
      .eq('branch_id', branchId).eq('week_start', weekDates[0])
    setIsPublished(false)
    setPublishedAt(null)
  }

  function printSchedule() {
    const DAY_NAMES = ['\u05E8\u05D0\u05E9\u05D5\u05DF', '\u05E9\u05E0\u05D9', '\u05E9\u05DC\u05D9\u05E9\u05D9', '\u05E8\u05D1\u05D9\u05E2\u05D9', '\u05D7\u05DE\u05D9\u05E9\u05D9', '\u05E9\u05D9\u05E9\u05D9']
    let html = `<html dir="rtl"><head><meta charset="utf-8"><style>
      body { font-family: Arial, sans-serif; direction: rtl; padding: 20px; }
      h1 { text-align: center; color: #1e293b; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: right; font-size: 13px; }
      th { background: #f1f5f9; font-weight: bold; }
      .role { font-size: 11px; color: #64748b; }
      @media print { body { padding: 0; } }
    </style></head><body>`
    html += `<h1>\u05E1\u05D9\u05D3\u05D5\u05E8 \u05E2\u05D1\u05D5\u05D3\u05D4 \u2014 ${branchName}</h1>`
    html += `<p style="text-align:center;color:#64748b">\u05E9\u05D1\u05D5\u05E2 ${weekDates[0]} \u05E2\u05D3 ${weekDates[5]}</p>`
    html += '<table><tr><th>\u05D9\u05D5\u05DD</th><th>\u05DE\u05E9\u05DE\u05E8\u05EA</th><th>\u05E2\u05D5\u05D1\u05D3\u05D9\u05DD</th></tr>'

    for (let d = 0; d < 6; d++) {
      const date = weekDates[d]
      const dayShifts = getEffectiveShiftsForDay(d, date)
      for (const shift of dayShifts) {
        const shiftAssigns = assignments.filter(a => a.shift_id === shift.id && a.date === date)
        const empNames = shiftAssigns.map(a => {
          const emp = employees.find(e => e.id === a.employee_id)
          const role = roles.find(r => r.id === a.role_id)
          return `${emp?.name || '?'} <span class="role">(${role?.name || ''})</span>`
        }).join('<br>')
        html += `<tr><td>${DAY_NAMES[d]} ${date.split('-').reverse().slice(0,2).join('/')}</td>`
        html += `<td>${shift.name} ${(shift.start_time||'').slice(0,5)}-${(shift.end_time||'').slice(0,5)}</td>`
        html += `<td>${empNames || '<span style="color:#94a3b8">\u05DC\u05D0 \u05D0\u05D5\u05D9\u05E9</span>'}</td></tr>`
      }
    }
    html += '</table></body></html>'
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
  }

  function copyForWhatsapp() {
    const DAY_NAMES = ['\u05E8\u05D0\u05E9\u05D5\u05DF', '\u05E9\u05E0\u05D9', '\u05E9\u05DC\u05D9\u05E9\u05D9', '\u05E8\u05D1\u05D9\u05E2\u05D9', '\u05D7\u05DE\u05D9\u05E9\u05D9', '\u05E9\u05D9\u05E9\u05D9']
    const SHIFT_EMOJI: Record<string, string> = {}
    shifts.forEach(s => {
      if ((s.start_time||'').startsWith('07')) SHIFT_EMOJI[s.id] = '\u{1F305}'
      else if ((s.start_time||'').startsWith('14')) SHIFT_EMOJI[s.id] = '\u{1F306}'
      else SHIFT_EMOJI[s.id] = '\u{1F4C5}'
    })

    let text = `\u{1F4C5} \u05E1\u05D9\u05D3\u05D5\u05E8 \u05E9\u05D1\u05D5\u05E2 ${weekDates[0].split('-').reverse().slice(0,2).join('/')}\u2013${weekDates[5].split('-').reverse().slice(0,2).join('/')}\n`
    text += `\u05E1\u05E0\u05D9\u05E3 ${branchName}\n\n`

    for (let d = 0; d < 6; d++) {
      const date = weekDates[d]
      const dayShifts = getEffectiveShiftsForDay(d, date)
      if (dayShifts.length === 0) continue
      text += `*\u05D9\u05D5\u05DD ${DAY_NAMES[d]} ${date.split('-').reverse().slice(0,2).join('/')}:*\n`
      for (const shift of dayShifts) {
        text += `${SHIFT_EMOJI[shift.id] || '\u{1F4C5}'} ${shift.name} (${(shift.start_time||'').slice(0,5)}-${(shift.end_time||'').slice(0,5)}):\n`
        const shiftAssigns = assignments.filter(a => a.shift_id === shift.id && a.date === date)
        if (shiftAssigns.length === 0) {
          text += `  _\u05DC\u05D0 \u05D0\u05D5\u05D9\u05E9_\n`
        } else {
          for (const a of shiftAssigns) {
            const emp = employees.find(e => e.id === a.employee_id)
            const role = roles.find(r => r.id === a.role_id)
            text += `  \u2022 ${emp?.name || '?'} \u2014 ${role?.name || ''}\n`
          }
        }
      }
      text += '\n'
    }

    navigator.clipboard.writeText(text).then(() => {
      alert('\u2705 \u05D4\u05E1\u05D9\u05D3\u05D5\u05E8 \u05D4\u05D5\u05E2\u05EA\u05E7 \u2014 \u05D4\u05D3\u05D1\u05E7 \u05D1\u05D5\u05D5\u05D8\u05E1\u05D0\u05E4')
    })
  }

  const prevWeek = () => { if (canGoBack) setWeekStart(prev => addDays(prev, -7)) }
  const nextWeek = () => setWeekStart(prev => addDays(prev, 7))

  const summary = !loading ? getWeeklySummary() : null

  // --- RENDER ---

  return (
    <motion.div dir="rtl" initial="hidden" animate="visible" variants={fadeIn}
      style={{ maxWidth: 1400, margin: '0 auto' }}>

      {/* ─── Sticky Header ─── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'white', borderBottom: '1px solid #f1f5f9', padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#94a3b8', padding: 4 }}>→</button>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>סידור עבודה שבועי</h1>
            </div>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{branchName}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={prevWeek} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: canGoBack ? '#94a3b8' : '#e2e8f0', padding: 4 }}>›</button>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#334155', minWidth: 140, textAlign: 'center' }}>
              {formatShortDate(weekStart)} – {formatShortDate(weekEnd)}
            </span>
            <button onClick={nextWeek} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#94a3b8', padding: 4 }}>‹</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setShowAutoDialog(true)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              שבץ אוטומטית ✦
            </button>
            <button onClick={printSchedule} style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>
              🖨️
            </button>
            <button onClick={copyForWhatsapp} style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>
              📱
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 20px' }}>

        {/* ─── Publish Banner ─── */}
        {!loading && (
          !isPublished ? (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '10px 16px', margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#92400e' }}>○ טיוטה — העובדים אינם רואים את הסידור</span>
              <button onClick={() => setShowPublishDialog(true)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                פרסם סידור →
              </button>
            </div>
          ) : (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '10px 16px', margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#166534' }}>✓ פורסם {publishedAt ? new Date(publishedAt).toLocaleDateString('he-IL') : ''}</span>
              <button onClick={unpublishSchedule} style={{ background: 'none', color: '#94a3b8', border: 'none', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                בטל פרסום
              </button>
            </div>
          )
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
        ) : (
          <>
            {/* ─── Mobile Day Tabs ─── */}
            <div className="md:hidden" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                {DAY_NAMES.map((name, i) => (
                  <button key={i} onClick={() => setMobileDayIdx(i)}
                    style={{ width: mobileDayIdx === i ? 24 : 8, height: 8, borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: mobileDayIdx === i ? '#6366f1' : '#cbd5e1', transition: 'width 0.2s' }} />
                ))}
              </div>
              {renderDayColumn(mobileDayIdx)}
            </div>

            {/* ─── Desktop: Day Column Headers ─── */}
            <div className="hidden md:grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 4, padding: '0 4px' }}>
              {weekDates.slice(0, 6).map((date, i) => {
                const isToday = date === formatDate(new Date())
                const sd = specialDays.find(s => s.date === date)
                return (
                  <div key={date} style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isToday ? '#6366f1' : '#64748b' }}>
                      {DAY_NAMES[i]}
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      {date.split('-').reverse().slice(0, 2).join('/')}
                    </div>
                    {sd && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{'\u25CF'} {sd.name}</div>}
                  </div>
                )
              })}
            </div>

            {/* ─── Desktop: Grid of Shift Cards ─── */}
            <div className="hidden md:grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, alignItems: 'start' }}>
              {[0, 1, 2, 3, 4, 5].map(dayIdx => {
                const date = weekDates[dayIdx]
                const sd = specialDays.find(s => s.date === date)

                if (sd?.shift_pattern === 'closed') {
                  return (
                    <div key={date} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 20, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>סגור</div>
                        <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>{sd.name}</div>
                      </div>
                    </div>
                  )
                }

                const dayShifts = getEffectiveShiftsForDay(dayIdx, date)

                return (
                  <div key={date} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sd?.shift_pattern === 'friday' && (
                      <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>ערב חג — משמרת אחת</div>
                    )}
                    {dayShifts.length === 0 && (
                      <div style={{ textAlign: 'center', fontSize: 12, color: '#cbd5e1', padding: '16px 0' }}>אין משמרות</div>
                    )}
                    {dayShifts.map(shift => renderShiftCard(shift, date))}
                  </div>
                )
              })}
            </div>

            {/* ─── Weekly Summary ─── */}
            {summary && (
              <div style={{ textAlign: 'center', padding: '24px 0 16px', fontSize: 13, color: '#94a3b8' }}>
                {summary.totalShifts} משמרות · {summary.fullShifts} מלאות
                {summary.incompleteShifts > 0 && (
                  <> · <span style={{ color: '#ef4444' }}>{summary.incompleteShifts} חסרות</span></>
                )}
                {' · '}
                <button onClick={() => setShowClearDialog(true)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  נקה שיבוץ
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Auto-schedule Dialog ─── */}
      {showAutoDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAutoDialog(false)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 360, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>שיבוץ אוטומטי</h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>האם לשבץ אוטומטית את השבוע? פעולה זו תחליף שיבוצים קיימים.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
              <button onClick={runAutoSchedule} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>שבץ</button>
              <button onClick={() => setShowAutoDialog(false)} style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Clear Dialog ─── */}
      {showClearDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowClearDialog(false)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 360, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>ניקוי שיבוצים</h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>האם למחוק את כל השיבוצים לשבוע זה?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
              <button onClick={clearWeekAssignments} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>נקה</button>
              <button onClick={() => setShowClearDialog(false)} style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Publish Dialog ─── */}
      {showPublishDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowPublishDialog(false)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 360, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>פרסום סידור</h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>לאחר הפרסום העובדים יוכלו לראות את הסידור שלהם.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
              <button onClick={publishSchedule} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>פרסם</button>
              <button onClick={() => setShowPublishDialog(false)} style={{ background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Employee Selection Popover ─── */}
      {popover && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setPopover(null)}>
          <div ref={popoverRef} style={{
            position: 'absolute',
            top: Math.min(popover.y, window.innerHeight - 300),
            left: Math.min(popover.x, window.innerWidth - 260),
            background: 'white', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            border: '1px solid #f1f5f9', width: 240, maxHeight: 300, overflow: 'auto',
            padding: 8,
          }} onClick={e => e.stopPropagation()}>
            <input
              type="text" placeholder="חפש עובד..." autoFocus
              value={popoverSearch}
              onChange={e => setPopoverSearch(e.target.value)}
              style={{ width: '100%', border: '1px solid #f1f5f9', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 6, outline: 'none', boxSizing: 'border-box' }}
            />
            {(() => {
              const popoverShiftAssigns = assignments.filter(a => a.shift_id === popover.shiftId && a.date === popover.date)
              const hasMentorInShift = popoverShiftAssigns.some(a => {
                const e = employees.find(emp => emp.id === a.employee_id)
                return e?.training_status === 'mentor'
              })
              const allEmps = getPopoverEmployees()
              const filtered = popoverSearch
                ? allEmps.filter(({ emp }) => emp.name.includes(popoverSearch))
                : allEmps

              if (filtered.length === 0) {
                return <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 12, color: '#94a3b8' }}>אין עובדים מתאימים לתפקיד</div>
              }

              return filtered.map(({ emp, avail, alreadyAssigned }) => (
                <button key={emp.id}
                  onClick={() => addAssignment(popover.shiftId, popover.roleId, popover.date, emp.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'right', fontSize: 13 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: avail === 'available' || avail === null ? '#10b981' : avail === 'prefer_not' ? '#f59e0b' : avail === 'unavailable' ? '#ef4444' : '#cbd5e1'
                  }} />
                  <span style={{ color: '#1e293b', flex: 1 }}>
                    {emp.training_status === 'mentor' && '⭐ '}
                    {emp.training_status === 'trainee' && '📚 '}
                    {emp.name}
                  </span>
                  {alreadyAssigned && (
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>משובץ</span>
                  )}
                  {emp.training_status === 'trainee' && !hasMentorInShift && (
                    <span style={{ fontSize: 10, color: '#f59e0b' }}>יש לוודא חונך</span>
                  )}
                </button>
              ))
            })()}
          </div>
        </div>
      )}
    </motion.div>
  )

  // ─── Render helpers (inside component scope) ───

  function renderDayColumn(dayIdx: number) {
    const date = weekDates[dayIdx]
    const isToday = date === formatDate(new Date())
    const sd = specialDays.find(s => s.date === date)

    if (sd?.shift_pattern === 'closed') {
      return (
        <div key={date}>
          <div style={{ textAlign: 'center', padding: '8px 0', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: isToday ? '#6366f1' : '#64748b' }}>{DAY_NAMES[dayIdx]}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{formatShortDate(addDays(weekStart, dayIdx))}</div>
            {sd && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{'\u25CF'} {sd.name}</div>}
          </div>
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 20, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>סגור</div>
            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>{sd.name}</div>
          </div>
        </div>
      )
    }

    const dayShifts = getEffectiveShiftsForDay(dayIdx, date)

    return (
      <div key={date}>
        <div style={{ textAlign: 'center', padding: '8px 0', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: isToday ? '#6366f1' : '#64748b' }}>{DAY_NAMES[dayIdx]}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>{formatShortDate(addDays(weekStart, dayIdx))}</div>
          {sd && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{'\u25CF'} {sd.name}</div>}
        </div>
        {sd?.shift_pattern === 'friday' && (
          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginBottom: 4 }}>ערב חג — משמרת אחת</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dayShifts.length === 0 && (
            <div style={{ textAlign: 'center', fontSize: 12, color: '#cbd5e1', padding: '16px 0' }}>אין משמרות</div>
          )}
          {dayShifts.map(shift => renderShiftCard(shift, date))}
        </div>
      </div>
    )
  }

  function renderShiftCard(shift: BranchShift, date: string) {
    const shiftRoles = getRolesForShift(shift.id, date)
    const cardSummary = getShiftCardSummary(shift.id, date)
    const hasShortage = cardSummary.total > 0 && cardSummary.filled < cardSummary.total

    // Trainee without mentor check
    const shiftAssigns = assignments.filter(a => a.shift_id === shift.id && a.date === date)
    const hasTrainee = shiftAssigns.some(a => {
      const emp = employees.find(e => e.id === a.employee_id)
      return emp?.training_status === 'trainee'
    })
    const hasMentor = shiftAssigns.some(a => {
      const emp = employees.find(e => e.id === a.employee_id)
      return emp?.training_status === 'mentor'
    })
    const hasTraineeNoMentor = hasTrainee && !hasMentor

    const traineeCount = shiftAssigns.filter(a => {
      const emp = employees.find(e => e.id === a.employee_id)
      return emp?.training_status === 'trainee'
    }).length

    return (
      <div key={shift.id} style={{
        background: 'white',
        borderRadius: 12,
        border: hasShortage ? '1px solid #fecaca' : '1px solid #f1f5f9',
        padding: 14,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.2s',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{shift.name}</span>
          <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 6 }}>{shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)}</span>
        </div>

        {/* Role slots */}
        {shiftRoles.map(sr => {
          const slots = []
          for (let i = 0; i < sr.count; i++) {
            const assignment = getAssignment(shift.id, sr.roleId, date, i)
            slots.push(
              <div key={`${sr.roleId}-${i}`} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>{sr.roleName}</div>
                {assignment ? (
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}
                    onMouseEnter={() => setHoveredAssignment(assignment.id)}
                    onMouseLeave={() => setHoveredAssignment(null)}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>
                      {(() => {
                        const emp = employees.find(e => e.id === assignment.employee_id)
                        return (
                          <>
                            {emp?.name || '?'}
                            {emp?.training_status === 'mentor' && <span style={{ fontSize: 10, marginRight: 4 }}>⭐</span>}
                            {emp?.training_status === 'trainee' && <span style={{ fontSize: 10, marginRight: 4 }}>📚</span>}
                          </>
                        )
                      })()}
                    </span>
                    {hoveredAssignment === assignment.id && (
                      <button onClick={() => removeAssignment(assignment.id)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
                    )}
                  </div>
                ) : (
                  <button onClick={(e) => openPopover(shift.id, sr.roleId, date, i, e)}
                    style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
                    + הוסף
                  </button>
                )}
              </div>
            )
          }
          return slots
        })}

        {/* Trainee warning */}
        {hasTraineeNoMentor && (
          <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>יש לוודא חונך</div>
        )}

        {/* Summary bottom line */}
        {cardSummary.total > 0 && (
          <div style={{ borderTop: '1px solid #f8fafc', paddingTop: 6, marginTop: 6, fontSize: 11, color: cardSummary.filled >= cardSummary.total ? '#10b981' : '#ef4444' }}>
            {cardSummary.filled}/{cardSummary.total} {cardSummary.filled >= cardSummary.total ? '✓' : ''}
            {traineeCount > 0 ? ` + ${traineeCount} מתלמדים` : ''}
          </div>
        )}
      </div>
    )
  }
}
