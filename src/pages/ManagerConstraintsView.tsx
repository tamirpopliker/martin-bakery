import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import PageHeader from '../components/PageHeader'

const fadeIn = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }

type Availability = 'unavailable' | 'prefer_not' | 'available'
type ViewFilter = 'all' | 'problems'

interface Employee { id: number; name: string; training_status: string }
interface Constraint { employee_id: number; date: string; availability: Availability; shift_id: number | null }
interface BranchShift { id: number; name: string; start_time: string; end_time: string; days_of_week: number[] }
interface StaffingRequirement { shift_id: number; role_id: number; required_count: number }

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

function getWeekDays(weekOffset: number): string[] {
  const today = new Date()
  // Find Sunday of current week
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay() + weekOffset * 7)
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }
  return days
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return `${d.getDate()}/${d.getMonth() + 1}`
}

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

export default function ManagerConstraintsView({ branchId, branchName, branchColor, onBack }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [constraints, setConstraints] = useState<Constraint[]>([])
  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [staffingReqs, setStaffingReqs] = useState<StaffingRequirement[]>([])
  const [weekOffset, setWeekOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')

  const weekDays = getWeekDays(weekOffset)
  const weekLabel = `${formatShortDate(weekDays[0])} — ${formatShortDate(weekDays[6])}`

  useEffect(() => { loadData() }, [branchId, weekOffset])

  async function loadData() {
    setLoading(true)
    const [empsRes, consRes, shiftsRes, staffingRes] = await Promise.all([
      supabase.from('branch_employees').select('id, name, training_status, is_manager').eq('branch_id', branchId).eq('active', true).eq('is_manager', false).order('name'),
      supabase.from('schedule_constraints').select('employee_id, date, availability, shift_id')
        .eq('branch_id', branchId)
        .gte('date', weekDays[0])
        .lte('date', weekDays[6]),
      supabase.from('branch_shifts').select('id, name, start_time, end_time, days_of_week')
        .eq('branch_id', branchId)
        .eq('is_active', true),
      supabase.from('shift_staffing_requirements').select('shift_id, role_id, required_count'),
    ])
    if (empsRes.data) setEmployees(empsRes.data)
    if (consRes.data) setConstraints(consRes.data as Constraint[])
    if (shiftsRes.data) setShifts(shiftsRes.data as BranchShift[])
    if (staffingRes.data) setStaffingReqs(staffingRes.data as StaffingRequirement[])
    setLoading(false)
  }

  function getAvail(empId: number, date: string, shiftId?: number): Availability | null {
    const c = constraints.find(c =>
      c.employee_id === empId &&
      c.date === date &&
      (shiftId === undefined || c.shift_id === shiftId || c.shift_id === null)
    )
    return c ? c.availability : null
  }

  // Get shifts that apply to a specific day of week (0=Sunday ... 6=Saturday)
  function getShiftsForDay(dayIndex: number): BranchShift[] {
    return shifts.filter(s => s.days_of_week && s.days_of_week.includes(dayIndex))
  }

  // Get total required count for a shift (sum across all roles)
  function getRequiredCount(shiftId: number): number {
    return staffingReqs
      .filter(r => r.shift_id === shiftId)
      .reduce((sum, r) => sum + r.required_count, 0)
  }

  function getShiftSummary(shiftId: number, date: string) {
    const required = getRequiredCount(shiftId)
    const availableEmps: string[] = []
    const preferNotEmps: string[] = []
    const unavailableEmps: string[] = []

    employees.forEach(emp => {
      const avail = getAvail(emp.id, date, shiftId)
      const name = emp.name
      if (avail === 'available' || avail === null) availableEmps.push(name)
      else if (avail === 'prefer_not') preferNotEmps.push(name)
      else if (avail === 'unavailable') unavailableEmps.push(name)
    })

    return { required, available: availableEmps.length, availableEmps, preferNotEmps, unavailableEmps }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6" dir="rtl">
      <PageHeader title="זמינות הצוות" subtitle={branchName} onBack={onBack} />

      {/* Week nav */}
      <motion.div variants={fadeIn} initial="hidden" animate="visible"
        className="flex items-center justify-center gap-4 mb-4">
        <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w - 1)} className="rounded-lg">
          <ChevronRight size={16} />
        </Button>
        <span className="text-sm font-bold text-slate-700 min-w-[140px] text-center">{weekLabel}</span>
        <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w + 1)} className="rounded-lg">
          <ChevronLeft size={16} />
        </Button>
        {weekOffset !== 0 && (
          <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)} className="text-xs text-indigo-500">
            השבוע
          </Button>
        )}
      </motion.div>

      {/* Filter toggle */}
      <motion.div variants={fadeIn} initial="hidden" animate="visible" className="flex items-center justify-center gap-2 mb-5">
        <div className="bg-slate-100 rounded-xl p-1 flex gap-1">
          <button
            onClick={() => setViewFilter('all')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
              viewFilter === 'all'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            הצג הכל
          </button>
          <button
            onClick={() => setViewFilter('problems')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
              viewFilter === 'problems'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            הצג בעייתיים בלבד
          </button>
        </div>
      </motion.div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          {shifts.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              לא הוגדרו משמרות לסניף זה
            </div>
          ) : (
            <>
              {/* Shift cards per day */}
              {weekDays.slice(0, 6).map((date, dayIdx) => {
                const dayOfWeek = new Date(date + 'T12:00:00').getDay()
                const dayName = DAY_NAMES[dayOfWeek]
                const shiftsForDay = getShiftsForDay(dayOfWeek)
                if (shiftsForDay.length === 0) return null

                // Check if all shifts for this day are fully covered (for filter)
                const hasProblems = shiftsForDay.some(shift => {
                  const summary = getShiftSummary(shift.id, date)
                  const coverage = summary.required > 0 ? summary.available / summary.required : 1
                  return coverage < 1
                })

                // If filtering problems only and no problems this day, skip entire day
                if (viewFilter === 'problems' && !hasProblems) return null

                return (
                  <div key={date} style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 10 }}>
                      {dayName} {date.split('-').reverse().slice(0, 2).join('/')}
                    </h3>
                    {shiftsForDay.map(shift => {
                      const summary = getShiftSummary(shift.id, date)
                      const coverage = summary.required > 0 ? summary.available / summary.required : 1

                      // If filter is 'problems' and coverage >= 1, skip
                      if (viewFilter === 'problems' && coverage >= 1) return null

                      return (
                        <div key={shift.id} style={{
                          background: 'white',
                          border: coverage < 1 ? '1px solid #fecaca' : '1px solid #f1f5f9',
                          borderRadius: 12,
                          padding: 16,
                          marginBottom: 10,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        }}>
                          {/* Header: shift name bold + hours gray (same line) */}
                          <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{shift.name}</span>
                            <span style={{ fontSize: 12, color: '#94a3b8' }}>{shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)}</span>
                            <span style={{ marginRight: 'auto', fontSize: 13, color: '#64748b' }}>
                              {summary.available}/{summary.required} זמינים
                            </span>
                          </div>

                          {/* Employee list by availability - dots + names */}
                          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {summary.availableEmps.length > 0 && (
                              <div className="flex flex-wrap gap-2 items-center">
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', flexShrink: 0 }} />
                                <span style={{ color: '#475569' }}>{summary.availableEmps.length}</span>
                                <span style={{ color: '#94a3b8', fontSize: 12 }}>{summary.availableEmps.join(', ')}</span>
                              </div>
                            )}
                            {summary.preferNotEmps.length > 0 && (
                              <div className="flex flex-wrap gap-2 items-center">
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0 }} />
                                <span style={{ color: '#475569' }}>{summary.preferNotEmps.length}</span>
                                <span style={{ color: '#94a3b8', fontSize: 12 }}>{summary.preferNotEmps.join(', ')}</span>
                              </div>
                            )}
                            {summary.unavailableEmps.length > 0 && (
                              <div className="flex flex-wrap gap-2 items-center">
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0 }} />
                                <span style={{ color: '#475569' }}>{summary.unavailableEmps.length}</span>
                                <span style={{ color: '#94a3b8', fontSize: 12 }}>{summary.unavailableEmps.join(', ')}</span>
                              </div>
                            )}
                          </div>

                          {/* Warning if understaffed - border-red-200 only, no red background */}
                          {coverage < 1 && (
                            <div style={{
                              marginTop: 10,
                              fontSize: 12,
                              color: '#ef4444',
                              fontWeight: 600,
                              padding: '6px 10px',
                              border: '1px solid #fecaca',
                              borderRadius: 8,
                              background: 'white',
                            }}>
                              חסרים {summary.required - summary.available} עובדים
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              {/* Weekly summary card */}
              {(() => {
                let totalShifts = 0, fullShifts = 0, problemShifts = 0
                const problems: string[] = []
                for (let d = 0; d < 6; d++) {
                  const date = weekDays[d]
                  const dayOfWeek = new Date(date + 'T12:00:00').getDay()
                  const dayShifts = getShiftsForDay(dayOfWeek)
                  for (const shift of dayShifts) {
                    totalShifts++
                    const s = getShiftSummary(shift.id, date)
                    if (s.available >= s.required) fullShifts++
                    else { problemShifts++; problems.push(`${DAY_NAMES[dayOfWeek]} - ${shift.name}`) }
                  }
                }
                return (
                  <div style={{
                    background: 'white',
                    border: '1px solid #f1f5f9',
                    borderRadius: 12,
                    padding: 18,
                    marginTop: 20,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>סיכום שבועי</h3>
                    <div style={{ fontSize: 14, color: '#475569' }}>
                      {totalShifts} משמרות · {fullShifts} מלאות{problemShifts > 0 ? ` · ${problemShifts} חסרות` : ''}
                    </div>
                    {problems.length > 0 && (
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>
                        {problems.map(p => <div key={p}>• {p}</div>)}
                      </div>
                    )}
                  </div>
                )
              })()}

              {(() => {
                const trainees = employees.filter(e => e.training_status === 'trainee')
                const mentors = employees.filter(e => e.training_status === 'mentor')
                if (trainees.length === 0 && mentors.length === 0) return null

                return (
                  <div style={{
                    background: 'white',
                    border: '1px solid #f1f5f9',
                    borderRadius: 12,
                    padding: 18,
                    marginTop: 12,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>חונכות והכשרה</h3>
                    <div style={{ fontSize: 13, color: '#475569', display: 'flex', gap: 16 }}>
                      <span>מתלמדים: {trainees.length}</span>
                      <span>חונכים: {mentors.length}</span>
                    </div>
                    {trainees.length > mentors.length && (
                      <div style={{
                        marginTop: 10,
                        fontSize: 12,
                        color: '#ef4444',
                        fontWeight: 600,
                        padding: '6px 10px',
                        border: '1px solid #fecaca',
                        borderRadius: 8,
                        background: 'white',
                      }}>
                        חסרים חונכים — {trainees.length} מתלמדים מול {mentors.length} חונכים
                      </div>
                    )}
                    {trainees.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
                        <strong style={{ color: '#64748b' }}>מתלמדים:</strong> {trainees.map(t => t.name).join(', ')}
                      </div>
                    )}
                    {mentors.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#94a3b8' }}>
                        <strong style={{ color: '#64748b' }}>חונכים:</strong> {mentors.map(m => m.name).join(', ')}
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
          )}

          {employees.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              אין עובדים פעילים בסניף זה
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
