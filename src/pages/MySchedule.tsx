import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Calendar, Star } from 'lucide-react'
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
  const [publishedWeeks, setPublishedWeeks] = useState<string[]>([])
  const [selectedWeek, setSelectedWeek] = useState<'current' | 'next'>('current')
  const [loading, setLoading] = useState(true)
  const [branchName, setBranchName] = useState('')

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

      // Load shifts and roles
      const [shiftsRes, rolesRes] = await Promise.all([
        supabase.from('branch_shifts').select('id, name, start_time, end_time').eq('branch_id', appUser.branch_id),
        supabase.from('shift_roles').select('id, name, color').eq('branch_id', appUser.branch_id),
      ])

      setShifts(shiftsRes.data || [])
      setRoles(rolesRes.data || [])
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
        {/* Header */}
        <motion.div variants={fadeIn(0)} initial="hidden" animate="visible" className="mb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-indigo-600 text-sm font-medium mb-3 hover:text-indigo-800 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            חזרה
          </button>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-800 flex items-center justify-center gap-2">
              <Calendar className="w-6 h-6 text-indigo-500" />
              הסידור שלי
            </h1>
            {branchName && (
              <p className="text-sm text-slate-500 mt-1">{branchName}</p>
            )}
          </div>
        </motion.div>

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
