import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAppUser } from '../lib/UserContext'

const fadeIn = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }

type Availability = 'unavailable' | 'prefer_not' | 'available'
type ViewFilter = 'all' | 'problems'

interface Employee { id: number; name: string; training_status: string }
interface Constraint { employee_id: number; date: string; availability: Availability; shift_id: number | null; submitted_by_name?: string | null }
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
  const { appUser } = useAppUser()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [constraints, setConstraints] = useState<Constraint[]>([])
  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [staffingReqs, setStaffingReqs] = useState<StaffingRequirement[]>([])
  const [weekOffset, setWeekOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [manualDialog, setManualDialog] = useState<{ empId: number; empName: string } | null>(null)
  const [manualAvails, setManualAvails] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)

  const weekDays = getWeekDays(weekOffset)
  const weekLabel = `${formatShortDate(weekDays[0])} — ${formatShortDate(weekDays[6])}`

  useEffect(() => { loadData() }, [branchId, weekOffset])

  async function loadData() {
    setLoading(true)
    const [empsRes, consRes, shiftsRes, staffingRes] = await Promise.all([
      supabase.from('branch_employees').select('id, name, training_status, is_manager').eq('branch_id', branchId).eq('active', true).eq('is_manager', false).order('name'),
      supabase.from('schedule_constraints').select('employee_id, date, availability, shift_id, submitted_by_name')
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
    // Prefer exact shift match; fall back to day-wide constraint (shift_id = null)
    const exact = constraints.find(c =>
      c.employee_id === empId && c.date === date && shiftId !== undefined && c.shift_id === shiftId
    )
    if (exact) return exact.availability
    const dayWide = constraints.find(c =>
      c.employee_id === empId && c.date === date && c.shift_id === null
    )
    if (dayWide) return dayWide.availability
    // No record at all → לא הוגדר
    return null
  }

  function shortShiftLabel(name: string): string {
    if (!name) return ''
    if (name.includes('בוקר')) return 'בוקר'
    if (name.includes('צהריים')) return 'צהריים'
    if (name.includes('ערב')) return 'ערב'
    if (name.includes('שישי')) return 'שישי'
    return name.slice(0, 8)
  }

  type DayStatus = { kind: 'unsubmitted' | 'all_available' | 'all_unavailable' | 'mixed'; label: string; detail?: string; bg: string; border: string; text: string }

  function getDayStatus(empId: number, date: string): DayStatus | null {
    const dow = new Date(date + 'T12:00:00').getDay()
    const dayShifts = getShiftsForDay(dow)
    if (dayShifts.length === 0) return null

    const empDayConstraints = constraints.filter(c => c.employee_id === empId && c.date === date)
    if (empDayConstraints.length === 0) {
      return { kind: 'unsubmitted', label: 'לא הגיש', bg: '#f1f5f9', border: '#e2e8f0', text: '#64748b' }
    }

    const perShift = dayShifts.map(s => ({ shift: s, avail: getAvail(empId, date, s.id) }))
    // Treat 'available' and 'prefer_not' both as "can work"; 'unavailable' is a hard no.
    const canWork = perShift.filter(x => x.avail === 'available' || x.avail === 'prefer_not')

    if (canWork.length === dayShifts.length) {
      return { kind: 'all_available', label: 'כל המשמרות', bg: '#dcfce7', border: '#86efac', text: '#166534' }
    }
    if (canWork.length === 0) {
      return { kind: 'all_unavailable', label: 'לא יכול', bg: '#fee2e2', border: '#fecaca', text: '#991b1b' }
    }

    // Partially available — list only the available shifts (e.g. "בוקר ✓ · ערב ✓")
    const parts = canWork.map(x => `${shortShiftLabel(x.shift.name)} ✓`)
    return {
      kind: 'mixed',
      label: parts.join(' · '),
      bg: '#ecfdf5',
      border: '#a7f3d0',
      text: '#065f46',
    }
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
    const undefinedEmps: string[] = []

    employees.forEach(emp => {
      const avail = getAvail(emp.id, date, shiftId)
      const name = emp.name
      if (avail === 'available') availableEmps.push(name)
      else if (avail === 'prefer_not') preferNotEmps.push(name)
      else if (avail === 'unavailable') unavailableEmps.push(name)
      else undefinedEmps.push(name) // null = לא הגדיר
    })

    return { required, available: availableEmps.length, availableEmps, preferNotEmps, unavailableEmps, undefinedEmps }
  }

  function openManualDialog(empId: number, empName: string) {
    const map = new Map<string, string>()
    weekDays.slice(0, 6).forEach(date => {
      const dow = new Date(date + 'T12:00:00').getDay()
      getShiftsForDay(dow).forEach(shift => {
        const avail = getAvail(empId, date, shift.id)
        // Store actual state ('unset' sentinel if no record) so toggle can distinguish.
        map.set(`${date}_${shift.id}`, avail || 'unset')
      })
    })
    setManualAvails(map)
    setManualDialog({ empId, empName })
  }

  async function saveManualAvailability() {
    if (!manualDialog) return
    setSaving(true)

    for (const [key, availability] of manualAvails) {
      const [date, shiftIdStr] = key.split('_')
      const shiftId = Number(shiftIdStr)
      // Always remove the previous record for this slot
      await supabase.from('schedule_constraints')
        .delete()
        .eq('employee_id', manualDialog.empId)
        .eq('date', date)
        .eq('shift_id', shiftId)
      // 'unset' = no submission — don't insert a row
      if (availability === 'unset') continue
      await supabase.from('schedule_constraints').insert({
        employee_id: manualDialog.empId,
        branch_id: branchId,
        date,
        shift_id: shiftId,
        availability,
        submitted_by_name: appUser?.name || 'מנהל',
        updated_at: new Date().toISOString(),
      })
    }

    setSaving(false)
    setManualDialog(null)
    alert(`✅ הזמינות של ${manualDialog.empName} נשמרה בהצלחה`)
    loadData()
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

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 12, fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
        <span style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', fontWeight: 700, borderRadius: 6, padding: '2px 8px' }}>כל המשמרות</span>
        <span style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', fontWeight: 700, borderRadius: 6, padding: '2px 8px' }}>משמרת ספציפית ✓</span>
        <span style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b', fontWeight: 700, borderRadius: 6, padding: '2px 8px' }}>לא יכול</span>
        <span style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b', fontWeight: 700, borderRadius: 6, padding: '2px 8px' }}>לא הגיש</span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">טוען...</div>
      ) : (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          {shifts.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">לא הוגדרו משמרות לסניף זה</div>
          ) : (
            <>
              {/* Weekly grid table */}
              <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 780, tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: 12, color: '#64748b', position: 'sticky', right: 0, background: 'white', zIndex: 2, minWidth: 100 }}>עובד</th>
                      {weekDays.slice(0, 6).map((date, i) => {
                        const dow = new Date(date + 'T12:00:00').getDay()
                        const shortName = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'][dow] || DAY_NAMES[dow]
                        return (
                          <th key={date} style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, fontSize: 12, color: '#475569' }}>
                            {shortName} {formatShortDate(date)}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const filteredEmps = viewFilter === 'problems'
                        ? employees.filter(emp => weekDays.slice(0, 6).some(date => {
                            const dow = new Date(date + 'T12:00:00').getDay()
                            return getShiftsForDay(dow).some(s => getAvail(emp.id, date, s.id) === 'unavailable')
                          }))
                        : employees

                      return filteredEmps.map(emp => (
                        <tr key={emp.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 500, color: '#1e293b', position: 'sticky', right: 0, background: 'white', zIndex: 1, whiteSpace: 'nowrap' }}>
                            {emp.name}
                            {(appUser?.role === 'admin' || appUser?.role === 'branch' || appUser?.role === 'scheduler') && (
                              <button
                                onClick={() => openManualDialog(emp.id, emp.name)}
                                title="הגש זמינות"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6366f1', marginRight: 4 }}>
                                ✏️
                              </button>
                            )}
                          </td>
                          {weekDays.slice(0, 6).map(date => {
                            const status = getDayStatus(emp.id, date)
                            if (!status) {
                              return <td key={date} style={{ padding: '8px 4px', textAlign: 'center', color: '#cbd5e1', fontSize: 11 }}>—</td>
                            }
                            const canEdit = appUser?.role === 'admin' || appUser?.role === 'branch' || appUser?.role === 'scheduler'
                            return (
                              <td key={date} style={{ padding: '6px 4px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={canEdit ? () => openManualDialog(emp.id, emp.name) : undefined}
                                  disabled={!canEdit}
                                  title={canEdit ? 'ערוך זמינות' : status.label}
                                  style={{
                                    background: status.bg,
                                    border: `1px solid ${status.border}`,
                                    color: status.text,
                                    borderRadius: 8,
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    lineHeight: 1.2,
                                    cursor: canEdit ? 'pointer' : 'default',
                                    width: '100%',
                                    minHeight: 36,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    textAlign: 'center',
                                    whiteSpace: 'normal',
                                    transition: 'all 0.15s',
                                  }}>
                                  {status.label}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))
                    })()}
                  </tbody>
                  {/* Summary row */}
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#94a3b8', position: 'sticky', right: 0, background: '#fafafa' }}>סיכום</td>
                      {weekDays.slice(0, 6).map(date => {
                        const dow = new Date(date + 'T12:00:00').getDay()
                        const dayShifts = getShiftsForDay(dow)
                        let g = 0, y = 0, r = 0, u = 0
                        employees.forEach(emp => {
                          dayShifts.forEach(s => {
                            const a = getAvail(emp.id, date, s.id)
                            if (a === 'available') g++
                            else if (a === 'prefer_not') y++
                            else if (a === 'unavailable') r++
                            else u++
                          })
                        })
                        return (
                          <td key={date} style={{ padding: '6px 4px', textAlign: 'center', fontSize: 10, color: '#94a3b8', background: '#fafafa' }}>
                            {g > 0 && <span style={{ color: '#10b981' }}>🟢{g} </span>}
                            {y > 0 && <span style={{ color: '#f59e0b' }}>🟡{y} </span>}
                            {r > 0 && <span style={{ color: '#ef4444' }}>🔴{r} </span>}
                            {u > 0 && <span style={{ color: '#9ca3af' }}>⬜{u}</span>}
                          </td>
                        )
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>

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

      {manualDialog && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center" onClick={() => setManualDialog(null)}>
          <div style={{ background: '#f8fafc', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', direction: 'rtl' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'white', padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>הגשת זמינות — {manualDialog.empName}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginTop: 2 }}>{weekLabel}</div>
            </div>

            <div style={{ padding: 16 }}>
              {weekDays.slice(0, 6).map((date) => {
                const dow = new Date(date + 'T12:00:00').getDay()
                const dayShifts = getShiftsForDay(dow)
                if (dayShifts.length === 0) return null
                const dayName = DAY_NAMES[dow]
                return (
                  <div key={date} style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 14, marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 10, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span>{dayName}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>{formatShortDate(date)}</span>
                    </div>

                    {dayShifts.map(shift => {
                      const key = `${date}_${shift.id}`
                      const val = manualAvails.get(key) || 'unset'
                      const startTime = (shift.start_time || '').slice(0, 5)
                      const endTime = (shift.end_time || '').slice(0, 5)
                      const hoursLabel = startTime && endTime ? `${startTime}–${endTime}` : ''

                      const options = [
                        { k: 'available',   l: '✓ זמין',     bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46', bgActive: '#10b981', textActive: 'white' },
                        { k: 'unavailable', l: '✕ לא זמין',  bg: '#fef2f2', border: '#fecaca', text: '#991b1b', bgActive: '#ef4444', textActive: 'white' },
                        { k: 'unset',       l: '○ לא הוגדר', bg: '#f8fafc', border: '#e2e8f0', text: '#64748b', bgActive: '#94a3b8', textActive: 'white' },
                      ] as const

                      const setVal = (newVal: string) => {
                        const next = new Map(manualAvails)
                        next.set(key, newVal)
                        setManualAvails(next)
                      }

                      return (
                        <div key={shift.id} style={{ padding: '10px 0', borderTop: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{shift.name}</div>
                              {hoursLabel && <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 2 }}>{hoursLabel}</div>}
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                            {options.map(opt => {
                              const active = val === opt.k
                              return (
                                <button key={opt.k} type="button" onClick={() => setVal(opt.k)}
                                  style={{
                                    padding: '10px 8px', borderRadius: 10,
                                    border: `1.5px solid ${active ? opt.bgActive : opt.border}`,
                                    background: active ? opt.bgActive : opt.bg,
                                    color: active ? opt.textActive : opt.text,
                                    fontSize: 13, fontWeight: 800, cursor: 'pointer',
                                    minHeight: 44,
                                    transition: 'all 0.15s',
                                  }}>
                                  {opt.l}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid #f1f5f9', padding: '12px 16px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setManualDialog(null)}
                style={{ padding: '12px 20px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                ביטול
              </button>
              <button onClick={saveManualAvailability} disabled={saving}
                style={{ padding: '12px 22px', background: saving ? '#c7d2fe' : '#6366f1', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'שומר…' : 'שמור זמינות'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
