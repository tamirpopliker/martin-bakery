import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { Button } from '@/components/ui/button'
import { ArrowRight, Check } from 'lucide-react'

const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, delay } },
})

type Availability = 'unavailable' | 'prefer_not' | 'available'

interface BranchShift {
  id: number
  name: string
  start_time: string
  end_time: string
  days_of_week: number[]
}

interface DayShiftConstraint {
  date: string
  shiftId: number
  shiftName: string
  shiftTime: string
  availability: Availability
  saving?: boolean
  saved?: boolean
}

const AVAIL_CONFIG: Record<Availability, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  available:    { label: 'יכול',         emoji: '🟢', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  prefer_not:   { label: 'מעדיף שלא',   emoji: '🟡', color: '#ca8a04', bg: '#fefce8', border: '#fde68a' },
  unavailable:  { label: 'לא יכול',     emoji: '🔴', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

function getNext28Days(): string[] {
  const days: string[] = []
  const today = new Date()
  for (let i = 0; i < 28; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }
  return days
}

function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay()
}

function isSaturday(dateStr: string): boolean {
  return getDayOfWeek(dateStr) === 6
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })
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

  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [constraints, setConstraints] = useState<DayShiftConstraint[]>([])
  const [loading, setLoading] = useState(true)
  const [resolvedEmpId, setResolvedEmpId] = useState<number | null>(null)
  const [noEmployee, setNoEmployee] = useState(false)

  useEffect(() => {
    resolveEmployee()
  }, [appUser])

  async function resolveEmployee() {
    // Try app_users.employee_id first
    if (appUser?.employee_id) {
      setResolvedEmpId(appUser.employee_id)
      return
    }
    // Fallback: look up by email in branch_employees
    if (appUser?.email) {
      const { data } = await supabase
        .from('branch_employees')
        .select('id')
        .eq('email', appUser.email)
        .maybeSingle()
      if (data) {
        setResolvedEmpId(data.id)
        return
      }
    }
    setNoEmployee(true)
    setLoading(false)
  }

  useEffect(() => {
    if (resolvedEmpId) loadShiftsAndConstraints()
  }, [resolvedEmpId])

  async function loadShiftsAndConstraints() {
    setLoading(true)
    const dateList = getNext28Days()

    // Load shifts and constraints in parallel
    const [shiftsRes, constraintsRes] = await Promise.all([
      supabase
        .from('branch_shifts')
        .select('id, name, start_time, end_time, days_of_week')
        .eq('branch_id', appUser?.branch_id)
        .eq('is_active', true),
      supabase
        .from('schedule_constraints')
        .select('date, availability, notes, shift_id')
        .eq('employee_id', resolvedEmpId!)
        .in('date', dateList),
    ])

    const loadedShifts: BranchShift[] = (shiftsRes.data || []) as BranchShift[]
    setShifts(loadedShifts)

    // Build a map: "date|shiftId" -> availability
    const map = new Map<string, Availability>()
    if (constraintsRes.data) {
      for (const row of constraintsRes.data) {
        const key = `${row.date}|${row.shift_id ?? 0}`
        map.set(key, row.availability as Availability)
      }
    }

    // Build DayShiftConstraint list
    const result: DayShiftConstraint[] = []
    for (const date of dateList) {
      if (isSaturday(date)) {
        // Add a placeholder for Saturday display
        result.push({
          date,
          shiftId: 0,
          shiftName: '',
          shiftTime: '',
          availability: 'available',
        })
        continue
      }

      const dow = getDayOfWeek(date)
      const applicableShifts = loadedShifts.filter(s =>
        s.days_of_week && s.days_of_week.includes(dow)
      )

      if (applicableShifts.length === 0) {
        // No shifts for this day - add a placeholder
        result.push({
          date,
          shiftId: 0,
          shiftName: 'אין משמרות',
          shiftTime: '',
          availability: 'available',
        })
      } else {
        for (const shift of applicableShifts) {
          const key = `${date}|${shift.id}`
          result.push({
            date,
            shiftId: shift.id,
            shiftName: shift.name,
            shiftTime: `${formatTime(shift.start_time)}-${formatTime(shift.end_time)}`,
            availability: map.get(key) || 'available',
          })
        }
      }
    }

    setConstraints(result)
    setLoading(false)
  }

  async function setAvailability(dateStr: string, shiftId: number, availability: Availability) {
    if (!resolvedEmpId || shiftId === 0) return

    const key = `${dateStr}|${shiftId}`

    // Update local state immediately
    setConstraints(prev => prev.map(c =>
      `${c.date}|${c.shiftId}` === key
        ? { ...c, availability, saving: true, saved: false }
        : c
    ))

    // Delete existing constraint for this emp+date+shift, then insert new
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

    // Show saved indicator
    setConstraints(prev => prev.map(c =>
      `${c.date}|${c.shiftId}` === key
        ? { ...c, saving: false, saved: true }
        : c
    ))
    setTimeout(() => {
      setConstraints(prev => prev.map(c =>
        `${c.date}|${c.shiftId}` === key
          ? { ...c, saved: false }
          : c
      ))
    }, 1500)
  }

  // Group constraints by date, then group dates into weeks
  const dateGroups = new Map<string, DayShiftConstraint[]>()
  for (const c of constraints) {
    const list = dateGroups.get(c.date) || []
    list.push(c)
    dateGroups.set(c.date, list)
  }

  const weeks: { date: string; items: DayShiftConstraint[] }[][] = []
  let currentWeek: { date: string; items: DayShiftConstraint[] }[] = []
  for (const [date, items] of dateGroups) {
    const dow = getDayOfWeek(date)
    if (dow === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek)
      currentWeek = []
    }
    currentWeek.push({ date, items })
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white" dir="rtl">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <motion.div variants={fadeIn(0)} initial="hidden" animate="visible" className="flex items-center gap-3 mb-6">
          <Button variant="outline" size="sm" onClick={onBack} className="rounded-xl gap-1 px-3">
            <ArrowRight size={16} /> חזרה
          </Button>
          <div className="flex-1 text-center">
            <h1 className="text-xl font-bold text-slate-800">הזמינות שלי 🙋</h1>
            {branchName && <p className="text-xs text-slate-400 mt-0.5">{branchName}</p>}
          </div>
        </motion.div>

        {/* Legend */}
        <motion.div variants={fadeIn(0.05)} initial="hidden" animate="visible"
          className="flex justify-center gap-4 mb-5 text-xs">
          {Object.entries(AVAIL_CONFIG).map(([, cfg]) => (
            <span key={cfg.label} className="flex items-center gap-1">
              <span>{cfg.emoji}</span> {cfg.label}
            </span>
          ))}
        </motion.div>

        {noEmployee ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">😕</div>
            <p className="text-slate-500 font-semibold">לא נמצאת כעובד במערכת</p>
            <p className="text-sm text-slate-400 mt-2">פנה למנהל הסניף שלך לקישור החשבון.</p>
          </div>
        ) : loading ? (
          <div className="text-center py-12 text-slate-400">טוען...</div>
        ) : (
          weeks.map((week, wi) => (
            <motion.div key={wi} variants={fadeIn(0.1 + wi * 0.05)} initial="hidden" animate="visible"
              className="mb-4 bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid #e2e8f0' }}>
              <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-500">
                שבוע {wi + 1}
              </div>
              {week.map(({ date, items }) => {
                const sat = isSaturday(date)
                return (
                  <div key={date} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    {/* Day header */}
                    <div className="px-4 pt-3 pb-1" style={{ opacity: sat ? 0.4 : 1 }}>
                      <span className="text-sm font-semibold text-slate-700">{formatDate(date)}</span>
                    </div>
                    {sat ? (
                      <div className="px-4 pb-3" style={{ opacity: 0.4 }}>
                        <span className="text-xs text-slate-400">שבת</span>
                      </div>
                    ) : (
                      <div className="px-4 pb-3 flex flex-col gap-1.5">
                        {items.map(item => {
                          if (item.shiftId === 0) {
                            return (
                              <div key="no-shift" className="text-xs text-slate-400 py-1">
                                {item.shiftName}
                              </div>
                            )
                          }
                          return (
                            <div key={item.shiftId} className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium text-slate-600">{item.shiftName}</span>
                                <span className="text-xs text-slate-400 mr-1">{item.shiftTime}</span>
                              </div>
                              <div className="flex gap-1.5 items-center">
                                {(['available', 'prefer_not', 'unavailable'] as Availability[]).map(av => {
                                  const ac = AVAIL_CONFIG[av]
                                  const active = item.availability === av
                                  return (
                                    <button key={av} onClick={() => setAvailability(date, item.shiftId, av)}
                                      className="transition-all duration-150"
                                      style={{
                                        padding: '4px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: '600',
                                        border: `1.5px solid ${active ? ac.border : '#e2e8f0'}`,
                                        background: active ? ac.bg : 'white',
                                        color: active ? ac.color : '#94a3b8',
                                        cursor: 'pointer',
                                      }}>
                                      {ac.emoji}
                                    </button>
                                  )
                                })}
                                {item.saved && (
                                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                                    className="flex items-center text-emerald-500">
                                    <Check size={14} />
                                  </motion.span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}
