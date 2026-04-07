import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Calendar, Star } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

interface BranchShift {
  id: number
  name: string
  start_time: string
  end_time: string
}

interface ShiftRole {
  id: number
  name: string
  color: string
}

interface ShiftAssignment {
  id: number
  date: string
  shift_id: number
  role_id: number
}

interface AllAssignment {
  shift_id: number
  date: string
  employee_id: number
  role_id: number
  emp_name: string
  role_name: string
  role_color: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, delay } },
})

function getSundayOfCurrentWeek(): Date {
  const today = new Date()
  const day = today.getDay()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - day)
  sunday.setHours(0, 0, 0, 0)
  return sunday
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

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function formatShortDate(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function formatTime(t: string): string {
  return t.slice(0, 5)
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MySchedule({ onBack }: Props) {
  const { appUser } = useAppUser()

  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [roles, setRoles] = useState<ShiftRole[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [allAssignments, setAllAssignments] = useState<AllAssignment[]>([])
  const [publishedWeeks, setPublishedWeeks] = useState<string[]>([])
  const [selectedWeek, setSelectedWeek] = useState<'current' | 'next'>('current')
  const [loading, setLoading] = useState(true)
  const [branchName, setBranchName] = useState('')
  const [myEmployeeId, setMyEmployeeId] = useState<number | null>(null)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())

  const currentWeekStart = getSundayOfCurrentWeek()
  const nextWeekStart = getSundayOfNextWeek()

  const isCurrentWeekPublished = publishedWeeks.includes(formatDate(currentWeekStart))
  const isNextWeekPublished = publishedWeeks.includes(formatDate(nextWeekStart))

  // Default to current week if published, else next week
  useEffect(() => {
    if (!loading) {
      if (isCurrentWeekPublished) {
        setSelectedWeek('current')
      } else if (isNextWeekPublished) {
        setSelectedWeek('next')
      } else {
        setSelectedWeek('current')
      }
    }
  }, [loading, isCurrentWeekPublished, isNextWeekPublished])

  const activeWeekStart = selectedWeek === 'current' ? currentWeekStart : nextWeekStart
  const activeWeekEnd = addDays(activeWeekStart, 6) // Saturday
  const isActiveWeekPublished = selectedWeek === 'current' ? isCurrentWeekPublished : isNextWeekPublished

  useEffect(() => {
    loadData()
  }, [appUser])

  async function loadData() {
    if (!appUser?.branch_id) return
    setLoading(true)

    try {
      // Resolve employee_id
      let employeeId = appUser.employee_id
      if (!employeeId && appUser.email) {
        const { data } = await supabase
          .from('branch_employees')
          .select('id')
          .eq('email', appUser.email)
          .maybeSingle()
        if (data) employeeId = data.id
      }
      if (!employeeId) {
        setLoading(false)
        return
      }
      setMyEmployeeId(employeeId)

      // Load branch name
      const { data: branchData } = await supabase
        .from('branches')
        .select('name')
        .eq('id', appUser.branch_id)
        .maybeSingle()
      if (branchData) setBranchName(branchData.name)

      // Load published weeks
      const { data: publications } = await supabase
        .from('schedule_publications')
        .select('week_start')
        .eq('branch_id', appUser.branch_id)

      const pubWeeks = (publications || []).map((p: { week_start: string }) => p.week_start)
      setPublishedWeeks(pubWeeks)

      // Load assignments for current week + next week range
      const rangeStart = formatDate(getSundayOfCurrentWeek())
      const rangeEnd = formatDate(addDays(getSundayOfNextWeek(), 6))

      const { data: assignmentData } = await supabase
        .from('shift_assignments')
        .select('id, date, shift_id, role_id')
        .eq('employee_id', employeeId)
        .gte('date', rangeStart)
        .lte('date', rangeEnd)

      setAssignments(assignmentData || [])

      // Load ALL assignments for coworker display
      const { data: allAssData } = await supabase
        .from('shift_assignments')
        .select('shift_id, date, employee_id, role_id')
        .eq('branch_id', appUser.branch_id)
        .gte('date', rangeStart)
        .lte('date', rangeEnd)

      // Load shifts and roles
      const [shiftsRes, rolesRes] = await Promise.all([
        supabase.from('branch_shifts').select('id, name, start_time, end_time').eq('branch_id', appUser.branch_id),
        supabase.from('shift_roles').select('id, name, color').eq('branch_id', appUser.branch_id),
      ])

      setShifts(shiftsRes.data || [])
      setRoles(rolesRes.data || [])

      // Load employee names for coworkers
      const { data: empsData } = await supabase
        .from('branch_employees')
        .select('id, name')
        .eq('branch_id', appUser.branch_id)
        .eq('active', true)

      const empMap = new Map<number, string>()
      empsData?.forEach((e: any) => empMap.set(e.id, e.name))
      const roleMap = new Map<number, { name: string; color: string }>()
      rolesRes.data?.forEach((r: any) => roleMap.set(r.id, { name: r.name, color: r.color || '#6366f1' }))

      const enriched: AllAssignment[] = (allAssData || []).map((a: any) => ({
        shift_id: a.shift_id,
        date: a.date,
        employee_id: a.employee_id,
        role_id: a.role_id,
        emp_name: empMap.get(a.employee_id) || '?',
        role_name: roleMap.get(a.role_id)?.name || '',
        role_color: roleMap.get(a.role_id)?.color || '#6366f1',
      }))
      setAllAssignments(enriched)
    } finally {
      setLoading(false)
    }
  }

  // Build day cards for the active week (Sun-Sat = 7 days)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(activeWeekStart, i)
    const dateStr = formatDate(date)
    const dayIndex = i // 0=Sun, 6=Sat
    const dayAssignment = assignments.find(a => a.date === dateStr)
    const shift = dayAssignment ? shifts.find(s => s.id === dayAssignment.shift_id) : null
    const role = dayAssignment ? roles.find(r => r.id === dayAssignment.role_id) : null

    return { date, dateStr, dayIndex, dayAssignment, shift, role }
  })

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <div className="text-2xl animate-spin mb-3">&#9696;</div>
          <p className="text-slate-500">טוען את הסידור...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white" dir="rtl">
      <div className="max-w-lg mx-auto px-4 py-6">
        <PageHeader title="הסידור שלי" subtitle={branchName} onBack={onBack} />

        {/* Week toggle */}
        <motion.div variants={fadeIn(0.05)} initial="hidden" animate="visible" className="mb-5">
          <div className="flex rounded-xl overflow-hidden border border-indigo-200 bg-white">
            <button
              onClick={() => setSelectedWeek('current')}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                selectedWeek === 'current'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-indigo-50'
              }`}
            >
              השבוע
              <span className="block text-xs font-normal opacity-80">
                {formatShortDate(currentWeekStart)} - {formatShortDate(addDays(currentWeekStart, 5))}
              </span>
            </button>
            <button
              onClick={() => setSelectedWeek('next')}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                selectedWeek === 'next'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-indigo-50'
              }`}
            >
              שבוע הבא
              <span className="block text-xs font-normal opacity-80">
                {formatShortDate(nextWeekStart)} - {formatShortDate(addDays(nextWeekStart, 5))}
              </span>
            </button>
          </div>
        </motion.div>

        {/* Not published message */}
        {!isActiveWeekPublished && (
          <motion.div variants={fadeIn(0.1)} initial="hidden" animate="visible" className="mb-5">
            <div className="bg-white/60 border border-amber-200 rounded-xl p-6 text-center">
              <p className="text-slate-500 text-base leading-relaxed">
                הסידור לשבוע זה טרם פורסם על ידי המנהל
              </p>
            </div>
          </motion.div>
        )}

        {/* Day cards */}
        {isActiveWeekPublished && (
          <div className="space-y-3">
            {days.map(({ date, dateStr, dayIndex, dayAssignment, shift, role }) => {
              const isSaturday = dayIndex === 6

              if (isSaturday) {
                return (
                  <motion.div
                    key={dateStr}
                    variants={fadeIn(0.08 + dayIndex * 0.04)}
                    initial="hidden"
                    animate="visible"
                  >
                    <div className="bg-slate-100 rounded-xl p-4 text-center">
                      <p className="text-slate-400 font-medium">
                        {DAY_NAMES[dayIndex]} {formatShortDate(date)}
                      </p>
                      <p className="text-slate-400 text-sm mt-0.5">שבת</p>
                    </div>
                  </motion.div>
                )
              }

              if (!dayAssignment || !shift) {
                return (
                  <motion.div
                    key={dateStr}
                    variants={fadeIn(0.08 + dayIndex * 0.04)}
                    initial="hidden"
                    animate="visible"
                  >
                    <div className="bg-white/70 border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-slate-700">
                            {DAY_NAMES[dayIndex]} {formatShortDate(date)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 text-amber-500">
                          <Star className="w-4 h-4" />
                          <span className="text-sm">יום חופש</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              }

              const coworkers = allAssignments.filter(
                a => a.shift_id === dayAssignment.shift_id && a.date === dateStr && a.employee_id !== myEmployeeId
              )
              const isExpanded = expandedDays.has(dateStr)
              const toggleExpand = () => {
                setExpandedDays(prev => {
                  const next = new Set(prev)
                  if (next.has(dateStr)) next.delete(dateStr)
                  else next.add(dateStr)
                  return next
                })
              }

              return (
                <motion.div
                  key={dateStr}
                  variants={fadeIn(0.08 + dayIndex * 0.04)}
                  initial="hidden"
                  animate="visible"
                >
                  <div className="bg-white border border-indigo-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-800">
                          {DAY_NAMES[dayIndex]} {formatShortDate(date)}
                        </p>
                        <p className="text-sm text-slate-600 mt-0.5">
                          {shift.name} {formatTime(shift.start_time)}-{formatTime(shift.end_time)}
                        </p>
                      </div>
                      {role && (
                        <span
                          className="text-xs font-semibold px-3 py-1 rounded-full text-white"
                          style={{ backgroundColor: role.color || '#6366f1' }}
                        >
                          {role.name}
                        </span>
                      )}
                    </div>

                    {/* Coworkers section */}
                    <button
                      onClick={toggleExpand}
                      className="mt-3 w-full text-right flex items-center gap-1.5 text-xs font-medium transition-colors"
                      style={{ color: '#6366f1' }}
                    >
                      <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>◀</span>
                      👥 עמיתים במשמרת ({coworkers.length})
                    </button>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        transition={{ duration: 0.2 }}
                        className="mt-2 pt-2"
                        style={{ borderTop: '1px solid #e2e8f0' }}
                      >
                        {coworkers.length === 0 ? (
                          <p className="text-xs text-slate-400">אתה היחיד במשמרת זו</p>
                        ) : (
                          <div className="space-y-1.5">
                            {coworkers.map(cw => (
                              <div key={`${cw.employee_id}-${cw.role_id}`} className="flex items-center gap-2">
                                <span
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                                  style={{ backgroundColor: cw.role_color }}
                                >
                                  {cw.role_name}
                                </span>
                                <span className="text-xs text-slate-700">{cw.emp_name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
