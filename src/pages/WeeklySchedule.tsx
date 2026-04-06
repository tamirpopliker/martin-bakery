import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowRight, ChevronLeft, ChevronRight, X, Users } from 'lucide-react'

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

    const [shiftsRes, rolesRes, staffingRes, empsRes, roleAssignRes, constraintsRes, assignmentsRes, specialDaysRes] = await Promise.all([
      supabase.from('branch_shifts').select('id, name, start_time, end_time, days_of_week')
        .eq('branch_id', branchId).eq('is_active', true).order('start_time'),
      supabase.from('shift_roles').select('id, name, color')
        .eq('branch_id', branchId).eq('is_active', true).order('name'),
      supabase.from('shift_staffing_requirements').select('shift_id, role_id, required_count'),
      supabase.from('branch_employees').select('id, name, priority, min_shifts_per_week')
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

            if (scored.length > 0 && scored[0].score > 0) {
              const chosen = scored[0].emp
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
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={printSchedule} style={{ padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'white' }}>
            {'\u{1F5A8}\uFE0F'} {'\u05D4\u05D3\u05E4\u05E1'}
          </button>
          <button onClick={copyForWhatsapp} style={{ padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'white' }}>
            {'\u{1F4F1}'} {'\u05D4\u05E2\u05EA\u05E7 \u05DC\u05D5\u05D5\u05D8\u05E1\u05D0\u05E4'}
          </button>
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
        <Button onClick={() => setShowAutoDialog(true)}
          style={{ background: '#6366f1', color: 'white' }}
          className="gap-2">
          <span>{'\u2728'}</span> {'\u05E9\u05D1\u05E5 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA'}
        </Button>
        <Button variant="outline" onClick={() => setShowClearDialog(true)}
          style={{ borderColor: '#ef4444', color: '#ef4444' }}
          className="gap-2">
          {'\u05E0\u05E7\u05D4 \u05E9\u05D9\u05D1\u05D5\u05E5'}
        </Button>
      </div>

      {/* Publish status banner */}
      {!loading && (isPublished ? (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 12, padding: '10px 16px', marginBottom: 10 }}
          className="flex items-center justify-between">
          <span style={{ color: '#065f46', fontSize: 13, fontWeight: 600 }}>
            {'\u2705 \u05D4\u05E1\u05D9\u05D3\u05D5\u05E8 \u05E4\u05D5\u05E8\u05E1\u05DD'}{publishedAt ? ` \u2014 ${new Date(publishedAt).toLocaleDateString('he-IL')} ${new Date(publishedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
          <button onClick={unpublishSchedule} style={{ color: '#ef4444', fontSize: 12, fontWeight: 600, background: 'none', border: '1px solid #ef4444', borderRadius: 8, padding: '4px 12px', cursor: 'pointer' }}>
            {'\u05D1\u05D8\u05DC \u05E4\u05E8\u05E1\u05D5\u05DD'}
          </button>
        </div>
      ) : (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '10px 16px', marginBottom: 10 }}
          className="flex items-center justify-between">
          <span style={{ color: '#92400e', fontSize: 13, fontWeight: 600 }}>{'\u26A0\uFE0F \u05D4\u05E1\u05D9\u05D3\u05D5\u05E8 \u05D8\u05E8\u05DD \u05E4\u05D5\u05E8\u05E1\u05DD \u2014 \u05D4\u05E2\u05D5\u05D1\u05D3\u05D9\u05DD \u05D0\u05D9\u05E0\u05DD \u05E8\u05D5\u05D0\u05D9\u05DD \u05D0\u05D5\u05EA\u05D5'}</span>
          <button onClick={() => setShowPublishDialog(true)} style={{ color: 'white', background: '#6366f1', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, padding: '6px 16px', cursor: 'pointer' }}>
            {'\u05E4\u05E8\u05E1\u05DD \u05E1\u05D9\u05D3\u05D5\u05E8 \u2713'}
          </button>
        </div>
      ))}

      {loading ? (
        <div className="text-center py-12 text-slate-400">{'\u05D8\u05D5\u05E2\u05DF...'}</div>
      ) : (
        <>
          {/* Main grid */}
          {(() => {
            const today = formatDate(new Date())

            function renderDayColumn(dayIdx: number) {
              const date = weekDates[dayIdx]
              const isToday = date === today
              const sd = specialDays.find(s => s.date === date)

              if (sd?.shift_pattern === 'closed') {
                return (
                  <div key={date}>
                    <div style={{
                      position: 'sticky', top: 0, zIndex: 10,
                      background: isToday ? '#eef2ff' : '#f8fafc',
                      border: isToday ? '2px solid #6366f1' : '1px solid #e2e8f0',
                      borderRadius: 10, padding: '8px 10px', textAlign: 'center',
                      marginBottom: 8
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? '#4338ca' : '#334155' }}>{DAY_NAMES[dayIdx]}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{formatShortDate(addDays(weekStart, dayIdx))}</div>
                      <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '6px', background: '#ede9fe', color: '#7c3aed' }}>{'\u{1F54E}'} {sd.name}</span>
                    </div>
                    <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, textAlign: 'center' }}>
                      <div style={{ fontSize: 24, marginBottom: 4 }}>🔒</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>סגור</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{sd.name}</div>
                    </div>
                  </div>
                )
              }

              const dayShifts = getEffectiveShiftsForDay(dayIdx, date)
              return (
                <div key={date}>
                  <div style={{
                    position: 'sticky', top: 0, zIndex: 10,
                    background: isToday ? '#eef2ff' : '#f8fafc',
                    border: isToday ? '2px solid #6366f1' : '1px solid #e2e8f0',
                    borderRadius: 10, padding: '8px 10px', textAlign: 'center',
                    marginBottom: 8
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? '#4338ca' : '#334155' }}>{DAY_NAMES[dayIdx]}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{formatShortDate(addDays(weekStart, dayIdx))}</div>
                    {(() => {
                      if (!sd) return null
                      const badge = sd.type === 'holiday' ? { bg: '#ede9fe', color: '#7c3aed', icon: '\u{1F54E}' }
                        : sd.type === 'high_demand' ? { bg: '#fef2f2', color: '#dc2626', icon: '\u{1F4C8}' }
                        : { bg: '#eff6ff', color: '#2563eb', icon: '\u{1F4C9}' }
                      return <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '6px', background: badge.bg, color: badge.color }}>{badge.icon} {sd.name}</span>
                    })()}
                  </div>
                  <div className="flex flex-col gap-3">
                    {sd?.shift_pattern === 'friday' && (
                      <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600, marginBottom: 4, textAlign: 'center' }}>
                        🕍 ערב חג — משמרת אחת
                      </div>
                    )}
                    {dayShifts.length === 0 && (
                      <div className="text-center text-xs text-slate-300 py-4">{'\u05D0\u05D9\u05DF \u05DE\u05E9\u05DE\u05E8\u05D5\u05EA'}</div>
                    )}
                    {dayShifts.map(shift => {
                      const shiftRoles = getRolesForShift(shift.id, date)
                      const cardSummary = getShiftCardSummary(shift.id, date)

                      return (
                        <div key={shift.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: 'white' }}>
                          {/* Shift header */}
                          <div style={{
                            background: '#eef2ff', borderRadius: '10px 10px 0 0',
                            padding: '8px 12px', borderBottom: '1px solid #c7d2fe'
                          }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{shift.name}</div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              {shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}
                            </div>
                          </div>

                          {/* Role slots */}
                          <div>
                            {shiftRoles.map(sr => {
                              const roleColor = roleColors.get(sr.roleId) || '#6366f1'
                              const slots = []
                              for (let i = 0; i < sr.count; i++) {
                                const assignment = getAssignment(shift.id, sr.roleId, date, i)
                                slots.push(
                                  <div key={`${sr.roleId}-${i}`}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: roleColor, display: 'inline-block' }} />
                                      <span style={{ fontSize: 12, color: '#64748b' }}>{sr.roleName}</span>
                                    </div>
                                    {assignment ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: roleColor, color: 'white' }}>
                                          {getEmployeeName(assignment.employee_id)}
                                        </span>
                                        <button onClick={() => removeAssignment(assignment.id)}
                                          style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>×</button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={(e) => openPopover(shift.id, sr.roleId, date, i, e)}
                                        style={{ color: '#6366f1', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>+</button>
                                    )}
                                  </div>
                                )
                              }
                              return slots
                            })}
                          </div>

                          {/* Card footer progress */}
                          {cardSummary.total > 0 && (
                            <div style={{ padding: '6px 10px', background: cardSummary.filled === cardSummary.total ? '#f0fdf4' : '#fef2f2', borderRadius: '0 0 10px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: cardSummary.filled === cardSummary.total ? '#15803d' : '#dc2626' }}>
                                {cardSummary.filled === cardSummary.total ? '\u2705' : '\u26A0\uFE0F'} {cardSummary.filled}/{cardSummary.total} {'\u05D0\u05D5\u05D9\u05E9\u05D5'}
                              </span>
                              <div style={{ width: 60, height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ width: `${cardSummary.total > 0 ? (cardSummary.filled / cardSummary.total) * 100 : 0}%`, height: '100%', background: cardSummary.filled === cardSummary.total ? '#22c55e' : '#ef4444', borderRadius: 2 }} />
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }

            return (
              <>
                {/* Mobile day-by-day navigation */}
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

                {/* Desktop grid */}
                <div className="hidden md:grid md:grid-cols-6 gap-2" style={{ marginBottom: 32 }}>
                  {[0, 1, 2, 3, 4, 5].map(i => renderDayColumn(i))}
                </div>
              </>
            )
          })()}

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

      {/* Auto-schedule dialog */}
      {showAutoDialog && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowAutoDialog(false)}>
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">{'\u05E9\u05D9\u05D1\u05D5\u05E5 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9'}</h3>
            <p className="text-sm text-slate-600 mb-4">{'\u05D4\u05D0\u05DD \u05DC\u05E9\u05D1\u05E5 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA \u05D0\u05EA \u05D4\u05E9\u05D1\u05D5\u05E2? \u05E4\u05E2\u05D5\u05DC\u05D4 \u05D6\u05D5 \u05EA\u05D7\u05DC\u05D9\u05E3 \u05E9\u05D9\u05D1\u05D5\u05E6\u05D9\u05DD \u05E7\u05D9\u05D9\u05DE\u05D9\u05DD.'}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAutoDialog(false)}>{'\u05D1\u05D9\u05D8\u05D5\u05DC'}</Button>
              <Button onClick={runAutoSchedule} style={{ background: '#6366f1', color: 'white' }}>{'\u05E9\u05D1\u05E5'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Clear dialog */}
      {showClearDialog && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowClearDialog(false)}>
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">{'\u05E0\u05D9\u05E7\u05D5\u05D9 \u05E9\u05D9\u05D1\u05D5\u05E6\u05D9\u05DD'}</h3>
            <p className="text-sm text-slate-600 mb-4">{'\u05D4\u05D0\u05DD \u05DC\u05DE\u05D7\u05D5\u05E7 \u05D0\u05EA \u05DB\u05DC \u05D4\u05E9\u05D9\u05D1\u05D5\u05E6\u05D9\u05DD \u05DC\u05E9\u05D1\u05D5\u05E2 \u05D6\u05D4?'}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowClearDialog(false)}>{'\u05D1\u05D9\u05D8\u05D5\u05DC'}</Button>
              <Button onClick={clearWeekAssignments} style={{ background: '#ef4444', color: 'white' }}>{'\u05E0\u05E7\u05D4'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Publish dialog */}
      {showPublishDialog && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowPublishDialog(false)}>
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{'\u05E4\u05E8\u05E1\u05D5\u05DD \u05E1\u05D9\u05D3\u05D5\u05E8'}</h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>{'\u05DC\u05D0\u05D7\u05E8 \u05D4\u05E4\u05E8\u05E1\u05D5\u05DD \u05D4\u05E2\u05D5\u05D1\u05D3\u05D9\u05DD \u05D9\u05D5\u05DB\u05DC\u05D5 \u05DC\u05E8\u05D0\u05D5\u05EA \u05D0\u05EA \u05D4\u05E1\u05D9\u05D3\u05D5\u05E8 \u05E9\u05DC\u05D4\u05DD.'}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowPublishDialog(false)} style={{ padding: '6px 16px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>{'\u05D1\u05D9\u05D8\u05D5\u05DC'}</button>
              <button onClick={publishSchedule} style={{ padding: '6px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{'\u05E4\u05E8\u05E1\u05DD'}</button>
            </div>
          </div>
        </div>
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
                  <span className="text-sm">{AVAIL_EMOJI[avail || 'available']}</span>
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
