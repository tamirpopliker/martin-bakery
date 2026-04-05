import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { ArrowRight, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'

const fadeIn = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }

type Availability = 'unavailable' | 'prefer_not' | 'available'
type ViewMode = 'day' | 'shift'

interface Employee { id: number; name: string }
interface Constraint { employee_id: number; date: string; availability: Availability; shift_id: number | null }
interface BranchShift { id: number; name: string; start_time: string; end_time: string; days_of_week: number[] }
interface StaffingRequirement { shift_id: number; role_id: number; required_count: number }

const AVAIL_EMOJI: Record<Availability, string> = {
  available: '🟢',
  prefer_not: '🟡',
  unavailable: '🔴',
}

const DAY_NAMES_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

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
  const [viewMode, setViewMode] = useState<ViewMode>('shift')

  const weekDays = getWeekDays(weekOffset)
  const weekLabel = `${formatShortDate(weekDays[0])} — ${formatShortDate(weekDays[6])}`

  useEffect(() => { loadData() }, [branchId, weekOffset])

  async function loadData() {
    setLoading(true)
    const [empsRes, consRes, shiftsRes, staffingRes] = await Promise.all([
      supabase.from('branch_employees').select('id, name').eq('branch_id', branchId).eq('active', true).order('name'),
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

  // Summary per day (used by day view)
  function getDaySummary(date: string) {
    const isSat = new Date(date + 'T12:00:00').getDay() === 6
    if (isSat) return null
    let available = 0, unavailable = 0, preferNot = 0, noData = 0
    for (const emp of employees) {
      const av = getAvail(emp.id, date)
      if (av === 'available') available++
      else if (av === 'unavailable') unavailable++
      else if (av === 'prefer_not') preferNot++
      else noData++
    }
    return { available, unavailable, preferNot, noData }
  }

  // Get shifts that apply to a specific day of week (0=Sunday ... 6=Saturday)
  function getShiftsForDay(date: string): BranchShift[] {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay()
    return shifts.filter(s => s.days_of_week && s.days_of_week.includes(dayOfWeek))
  }

  // Get total required count for a shift (sum across all roles)
  function getRequiredCount(shiftId: number): number {
    return staffingReqs
      .filter(r => r.shift_id === shiftId)
      .reduce((sum, r) => sum + r.required_count, 0)
  }

  // Get shift summary: available count and required count
  function getShiftSummary(date: string, shiftId: number) {
    let available = 0
    for (const emp of employees) {
      const av = getAvail(emp.id, date, shiftId)
      if (av === 'available') available++
    }
    const required = getRequiredCount(shiftId)
    return { available, required }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6" dir="rtl">
      {/* Header */}
      <motion.div variants={fadeIn} initial="hidden" animate="visible" className="flex items-center gap-3 mb-5">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2 px-4 text-[15px] font-bold text-slate-500">
          <ArrowRight size={18} /> חזרה
        </Button>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold text-slate-800">זמינות הצוות — {branchName}</h1>
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: branchColor }}>
          <span className="text-white text-lg">📋</span>
        </div>
      </motion.div>

      {/* View mode toggle */}
      <motion.div variants={fadeIn} initial="hidden" animate="visible" className="flex items-center justify-center gap-2 mb-4">
        <div className="bg-slate-100 rounded-xl p-1 flex gap-1">
          <button
            onClick={() => setViewMode('day')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
              viewMode === 'day'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            הצג לפי יום
          </button>
          <button
            onClick={() => setViewMode('shift')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
              viewMode === 'shift'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            הצג לפי משמרת
          </button>
        </div>
      </motion.div>

      {/* Week nav */}
      <motion.div variants={fadeIn} initial="hidden" animate="visible"
        className="flex items-center justify-center gap-4 mb-5">
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

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : viewMode === 'day' ? (
        /* ===== DAY VIEW (existing grid) ===== */
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid #e2e8f0' }}>
            {/* Header row */}
            <div className="grid" style={{ gridTemplateColumns: `140px repeat(7, 1fr)`, background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <div className="px-3 py-2 text-xs font-bold text-slate-500">עובד</div>
              {weekDays.map((date, i) => {
                const isSat = new Date(date + 'T12:00:00').getDay() === 6
                return (
                  <div key={date} className="px-1 py-2 text-center text-xs font-bold"
                    style={{ color: isSat ? '#cbd5e1' : '#64748b' }}>
                    <div>{DAY_NAMES_SHORT[i]}</div>
                    <div className="text-[10px] font-normal">{formatShortDate(date)}</div>
                  </div>
                )
              })}
            </div>

            {/* Employee rows */}
            {employees.map(emp => (
              <div key={emp.id} className="grid" style={{ gridTemplateColumns: `140px repeat(7, 1fr)`, borderBottom: '1px solid #f1f5f9' }}>
                <div className="px-3 py-2 text-sm font-semibold text-slate-700 truncate">{emp.name}</div>
                {weekDays.map(date => {
                  const isSat = new Date(date + 'T12:00:00').getDay() === 6
                  const av = getAvail(emp.id, date)
                  return (
                    <div key={date} className="flex items-center justify-center py-2"
                      style={{ opacity: isSat ? 0.3 : 1 }}>
                      {isSat ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : av ? (
                        <span className="text-base">{AVAIL_EMOJI[av]}</span>
                      ) : (
                        <span className="w-4 h-4 rounded-full bg-slate-100 border border-slate-200" />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Summary row */}
            <div className="grid" style={{ gridTemplateColumns: `140px repeat(7, 1fr)`, background: '#fafafa', borderTop: '2px solid #e2e8f0' }}>
              <div className="px-3 py-2 text-xs font-bold text-slate-500">סיכום</div>
              {weekDays.map(date => {
                const summary = getDaySummary(date)
                if (!summary) return <div key={date} className="px-1 py-2 text-center text-xs text-slate-300">—</div>
                return (
                  <div key={date} className="px-1 py-2 text-center">
                    <div className="text-[10px] leading-tight">
                      <span style={{ color: '#16a34a' }}>{summary.available}🟢</span>
                      {summary.unavailable > 0 && <> <span style={{ color: '#dc2626' }}>{summary.unavailable}🔴</span></>}
                      {summary.preferNot > 0 && <> <span style={{ color: '#ca8a04' }}>{summary.preferNot}🟡</span></>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {employees.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              אין עובדים פעילים בסניף זה
            </div>
          )}
        </motion.div>
      ) : (
        /* ===== SHIFT VIEW ===== */
        <motion.div variants={fadeIn} initial="hidden" animate="visible" className="space-y-6">
          {shifts.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              לא הוגדרו משמרות לסניף זה
            </div>
          ) : weekDays.map((date, dayIdx) => {
            const isSat = new Date(date + 'T12:00:00').getDay() === 6
            if (isSat) return null
            const dayShifts = getShiftsForDay(date)
            if (dayShifts.length === 0) return null

            return (
              <div key={date}>
                {/* Day header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold text-slate-700">
                    {DAY_NAMES_SHORT[dayIdx]} — {formatShortDate(date)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {dayShifts.map(shift => {
                    const summary = getShiftSummary(date, shift.id)
                    const isShort = summary.required > 0 && summary.available < summary.required

                    return (
                      <div
                        key={shift.id}
                        className="bg-white rounded-xl p-4"
                        style={{ border: '0.5px solid #e2e8f0' }}
                      >
                        {/* Shift header */}
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="text-sm font-bold text-slate-800">{shift.name}</div>
                            <div className="text-[11px] text-slate-400">
                              {shift.start_time?.slice(0, 5)} — {shift.end_time?.slice(0, 5)}
                            </div>
                          </div>
                          {isShort && (
                            <div className="flex items-center gap-1 bg-red-50 text-red-600 text-[11px] font-bold px-2 py-1 rounded-lg">
                              <AlertTriangle size={12} />
                              חסר כ״א
                            </div>
                          )}
                        </div>

                        {/* Employee list */}
                        <div className="space-y-1.5 mb-3">
                          {employees.map(emp => {
                            const av = getAvail(emp.id, date, shift.id)
                            const emoji = av ? AVAIL_EMOJI[av] : '⚪'
                            return (
                              <div key={emp.id} className="flex items-center gap-2">
                                <span className="text-sm">{emoji}</span>
                                <span className="text-xs text-slate-600 truncate">{emp.name}</span>
                              </div>
                            )
                          })}
                        </div>

                        {/* Summary */}
                        <div
                          className="text-[11px] font-bold pt-2 text-center"
                          style={{
                            borderTop: '1px solid #f1f5f9',
                            color: isShort ? '#dc2626' : '#64748b',
                          }}
                        >
                          {summary.available} זמינים / דרישה: {summary.required}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

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
