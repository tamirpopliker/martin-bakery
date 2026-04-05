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

interface DayConstraint {
  date: string // YYYY-MM-DD
  availability: Availability
  notes: string
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

function isSaturday(dateStr: string): boolean {
  return new Date(dateStr + 'T12:00:00').getDay() === 6
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })
}

interface Props {
  onBack: () => void
}

export default function EmployeeConstraints({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const branchName = branches.find(b => b.id === appUser?.branch_id)?.name || ''

  const [days, setDays] = useState<DayConstraint[]>([])
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
    if (resolvedEmpId) loadConstraints()
  }, [resolvedEmpId])

  async function loadConstraints() {
    setLoading(true)
    const dateList = getNext28Days()
    const { data } = await supabase
      .from('schedule_constraints')
      .select('date, availability, notes')
      .eq('employee_id', resolvedEmpId!)
      .in('date', dateList)

    const map = new Map<string, { availability: Availability; notes: string }>()
    if (data) {
      for (const row of data) {
        map.set(row.date, { availability: row.availability as Availability, notes: row.notes || '' })
      }
    }

    setDays(dateList.map(date => ({
      date,
      availability: map.get(date)?.availability || 'available',
      notes: map.get(date)?.notes || '',
    })))
    setLoading(false)
  }

  async function setAvailability(dateStr: string, availability: Availability) {
    if (!resolvedEmpId) return

    setDays(prev => prev.map(d =>
      d.date === dateStr ? { ...d, availability, saving: true, saved: false } : d
    ))

    await supabase.from('schedule_constraints').upsert({
      branch_id: appUser?.branch_id,
      employee_id: resolvedEmpId,
      date: dateStr,
      availability,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,date' })

    setDays(prev => prev.map(d =>
      d.date === dateStr ? { ...d, saving: false, saved: true } : d
    ))
    setTimeout(() => {
      setDays(prev => prev.map(d =>
        d.date === dateStr ? { ...d, saved: false } : d
      ))
    }, 1500)
  }

  // Group days into weeks (Sunday-Saturday)
  const weeks: DayConstraint[][] = []
  let currentWeek: DayConstraint[] = []
  for (const day of days) {
    const dow = new Date(day.date + 'T12:00:00').getDay()
    if (dow === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek)
      currentWeek = []
    }
    currentWeek.push(day)
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
              {week.map(day => {
                const sat = isSaturday(day.date)
                const cfg = AVAIL_CONFIG[day.availability]
                return (
                  <div key={day.date} className="flex items-center gap-3 px-4 py-3"
                    style={{ borderBottom: '1px solid #f1f5f9', opacity: sat ? 0.4 : 1 }}>
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-slate-700">{formatDate(day.date)}</span>
                    </div>
                    {sat ? (
                      <span className="text-xs text-slate-400">שבת</span>
                    ) : (
                      <div className="flex gap-1.5">
                        {(['available', 'prefer_not', 'unavailable'] as Availability[]).map(av => {
                          const ac = AVAIL_CONFIG[av]
                          const active = day.availability === av
                          return (
                            <button key={av} onClick={() => setAvailability(day.date, av)}
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
                        {day.saved && (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                            className="flex items-center text-emerald-500">
                            <Check size={14} />
                          </motion.span>
                        )}
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
