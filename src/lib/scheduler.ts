// Pure, testable weekly-schedule draft generator.
//
// Extracted from WeeklySchedule.tsx's inline two-pass algorithm and hardened:
//   • enforces BOTH min and max shifts per week (under-min employees are
//     preferred; at-max employees are excluded),
//   • applies the trainee→mentor rule in BOTH passes (+ a final reconciliation
//     that drops orphaned trainees),
//   • returns STRUCTURED unfilled slots (shift/role/date) instead of a count.
//
// Availability model: an employee who submitted anything for the week is
// treated as "available" on cells they left blank (the submission UX defaults
// to available and asks staff to mark only what they CAN'T do). Employees who
// submitted nothing are left out of the draft and surfaced as a warning — the
// manager fills them in manually.

export type Availability = 'available' | 'prefer_not' | 'unavailable'

export interface SchedEmployee {
  id: number
  name: string
  priority: number
  min_shifts_per_week: number
  max_shifts_per_week: number
  training_status: string // 'regular' | 'trainee' | 'mentor'
}

export interface SchedSlot {
  shift_id: number
  role_id: number
  date: string
  shift_hours: number
}

export interface SchedConstraint {
  employee_id: number
  date: string
  shift_id: number | null
  availability: Availability
}

export interface SchedRoleAssignment {
  employee_id: number
  role_id: number
}

export interface DraftAssignment {
  shift_id: number
  role_id: number
  employee_id: number
  date: string
}

export interface SchedulerInput {
  employees: SchedEmployee[]
  roleAssignments: SchedRoleAssignment[]
  slots: SchedSlot[]
  constraints: SchedConstraint[]
}

export interface SchedulerResult {
  assignments: DraftAssignment[]
  unfilled: { shift_id: number; role_id: number; date: string }[]
  compromises: DraftAssignment[]
  warnings: string[]
}

const MAX_UNCAPPED = 999 // treat missing/0 max_shifts_per_week as effectively no cap

export function generateDraft(input: SchedulerInput): SchedulerResult {
  const { employees, roleAssignments, slots, constraints } = input

  // ── Availability lookup ──
  const explicit = new Map<string, Availability>() // emp|date|shift
  const dateWide = new Map<string, Availability>() // emp|date   (legacy shift_id NULL rows)
  const submitted = new Set<number>()
  for (const c of constraints) {
    submitted.add(c.employee_id)
    if (c.shift_id === null) dateWide.set(`${c.employee_id}|${c.date}`, c.availability)
    else explicit.set(`${c.employee_id}|${c.date}|${c.shift_id}`, c.availability)
  }

  function avail(empId: number, date: string, shiftId: number): Availability | null {
    const k = `${empId}|${date}|${shiftId}`
    if (explicit.has(k)) return explicit.get(k)!
    const dk = `${empId}|${date}`
    if (dateWide.has(dk)) return dateWide.get(dk)!
    if (submitted.has(empId)) return 'available' // engaged this week → blank = available
    return null
  }

  const canWorkRole = new Set(roleAssignments.map(ra => `${ra.employee_id}|${ra.role_id}`))
  const empById = new Map(employees.map(e => [e.id, e]))
  const maxFor = (e: SchedEmployee) =>
    e.max_shifts_per_week && e.max_shifts_per_week > 0 ? e.max_shifts_per_week : MAX_UNCAPPED

  // ── Running state ──
  const assignments: DraftAssignment[] = []
  const compromises: DraftAssignment[] = []
  const shiftCount: Record<number, number> = {}
  const hours: Record<number, number> = {}
  const dayAssigned = new Set<string>() // emp|date
  const preferNotUsed: Record<number, number> = {}
  employees.forEach(e => { shiftCount[e.id] = 0; hours[e.id] = 0 })

  const mentorInShift = (shiftId: number, date: string) =>
    assignments.some(a =>
      a.shift_id === shiftId && a.date === date &&
      empById.get(a.employee_id)?.training_status === 'mentor')

  function pick(slot: SchedSlot, allowPreferNot: boolean): number | null {
    const eligible = employees.filter(emp => {
      if (!canWorkRole.has(`${emp.id}|${slot.role_id}`)) return false
      const a = avail(emp.id, slot.date, slot.shift_id)
      if (allowPreferNot ? a !== 'prefer_not' : a !== 'available') return false
      if (shiftCount[emp.id] >= maxFor(emp)) return false
      if (dayAssigned.has(`${emp.id}|${slot.date}`)) return false
      if (assignments.some(x => x.employee_id === emp.id && x.shift_id === slot.shift_id && x.date === slot.date)) return false
      return true
    })

    // Trainee needs a mentor already present in this shift
    const filtered = eligible.filter(emp =>
      emp.training_status !== 'trainee' || mentorInShift(slot.shift_id, slot.date))

    filtered.sort((a, b) => {
      if (allowPreferNot) {
        const ac = preferNotUsed[a.id] || 0
        const bc = preferNotUsed[b.id] || 0
        if (ac !== bc) return ac - bc // spread compromises
      }
      // Prefer employees still below their weekly minimum
      const aBelow = shiftCount[a.id] < a.min_shifts_per_week ? 0 : 1
      const bBelow = shiftCount[b.id] < b.min_shifts_per_week ? 0 : 1
      if (aBelow !== bBelow) return aBelow - bBelow
      const ap = a.priority || 2
      const bp = b.priority || 2
      if (ap !== bp) return ap - bp
      if (hours[a.id] !== hours[b.id]) return hours[a.id] - hours[b.id]
      return shiftCount[a.id] - shiftCount[b.id]
    })

    return filtered.length > 0 ? filtered[0].id : null
  }

  function place(slot: SchedSlot, empId: number, isCompromise: boolean) {
    assignments.push({ shift_id: slot.shift_id, role_id: slot.role_id, employee_id: empId, date: slot.date })
    shiftCount[empId] = (shiftCount[empId] || 0) + 1
    hours[empId] = (hours[empId] || 0) + slot.shift_hours
    dayAssigned.add(`${empId}|${slot.date}`)
    if (isCompromise) {
      preferNotUsed[empId] = (preferNotUsed[empId] || 0) + 1
      compromises.push({ shift_id: slot.shift_id, role_id: slot.role_id, employee_id: empId, date: slot.date })
    }
  }

  // ── PASS 1 — 'available' only ──
  const openSlots: SchedSlot[] = []
  for (const slot of slots) {
    const empId = pick(slot, false)
    if (empId !== null) place(slot, empId, false)
    else openSlots.push(slot)
  }

  // ── PASS 2 — fill remaining from 'prefer_not' (compromise) ──
  const stillOpen: SchedSlot[] = []
  for (const slot of openSlots) {
    const empId = pick(slot, true)
    if (empId !== null) place(slot, empId, true)
    else stillOpen.push(slot)
  }

  // ── Reconciliation — drop trainees left without a mentor in their shift ──
  const warnings: string[] = []
  const orphanTrainees: DraftAssignment[] = []
  for (const a of assignments) {
    const emp = empById.get(a.employee_id)
    if (emp?.training_status !== 'trainee') continue
    const hasMentor = assignments.some(x =>
      x.shift_id === a.shift_id && x.date === a.date &&
      empById.get(x.employee_id)?.training_status === 'mentor')
    if (!hasMentor) orphanTrainees.push(a)
  }
  for (const o of orphanTrainees) {
    const idx = assignments.findIndex(a =>
      a.shift_id === o.shift_id && a.role_id === o.role_id && a.date === o.date && a.employee_id === o.employee_id)
    if (idx >= 0) assignments.splice(idx, 1)
    stillOpen.push({ shift_id: o.shift_id, role_id: o.role_id, date: o.date, shift_hours: 0 })
  }
  if (orphanTrainees.length > 0) {
    warnings.push(`${orphanTrainees.length} שיבוצי חניך בוטלו — אין מנטור באותה משמרת.`)
  }

  // Trainees who submitted availability but got no shift at all (blocked by the
  // mentor rule) — surface them so the manager can place them manually.
  const placedIds = new Set(assignments.map(a => a.employee_id))
  const unplacedTrainees = employees.filter(e =>
    e.training_status === 'trainee' && submitted.has(e.id) && !placedIds.has(e.id))
  if (unplacedTrainees.length > 0) {
    warnings.push(`לא שובץ חניך (נדרש מנטור זמין באותה משמרת): ${unplacedTrainees.map(e => e.name).join(', ')}.`)
  }

  // ── Warnings: employees below their weekly minimum ──
  const belowMin = employees.filter(e => e.min_shifts_per_week > 0 && shiftCount[e.id] < e.min_shifts_per_week)
  if (belowMin.length > 0) {
    warnings.push(`${belowMin.length} עובדים מתחת למינימום המשמרות השבועי: ${belowMin.map(e => e.name).join(', ')}.`)
  }

  // ── Warnings: employees who didn't submit availability at all ──
  const noSubmission = employees.filter(e => !submitted.has(e.id))
  if (noSubmission.length > 0) {
    warnings.push(`${noSubmission.length} עובדים לא הגישו זמינות (לא שובצו אוטומטית): ${noSubmission.map(e => e.name).join(', ')}.`)
  }

  const unfilled = stillOpen.map(s => ({ shift_id: s.shift_id, role_id: s.role_id, date: s.date }))
  return { assignments, unfilled, compromises, warnings }
}
