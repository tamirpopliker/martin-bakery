import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAppUser } from '../lib/UserContext'
import { supabase } from '../lib/supabase'
import MySchedule from './MySchedule'
import EmployeeConstraints from './EmployeeConstraints'

const fadeIn = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

interface Props {
  onNavigate: (page: string) => void
}

export default function EmployeeHome({ onNavigate }: Props) {
  const { appUser, logout } = useAppUser()
  const [branchName, setBranchName] = useState('')
  const [page, setPage] = useState<string | null>(null)
  const [nextWeekCount, setNextWeekCount] = useState(0)

  useEffect(() => {
    if (appUser?.branch_id) {
      supabase.from('branches').select('name').eq('id', appUser.branch_id).single()
        .then(({ data }) => { if (data) setBranchName(data.name) })
    }
  }, [appUser?.branch_id])

  useEffect(() => {
    async function fetchNextWeekAvailability() {
      let empId = appUser?.employee_id
      if (!empId && appUser?.email) {
        const { data } = await supabase
          .from('branch_employees')
          .select('id')
          .eq('email', appUser.email)
          .maybeSingle()
        if (data) empId = data.id
      }
      if (!empId) return

      const today = new Date()
      const nextWeekStart = new Date(today)
      nextWeekStart.setDate(today.getDate() + 1)
      const nextWeekEnd = new Date(today)
      nextWeekEnd.setDate(today.getDate() + 7)

      const startStr = nextWeekStart.toISOString().slice(0, 10)
      const endStr = nextWeekEnd.toISOString().slice(0, 10)

      const { data: constraints } = await supabase
        .from('schedule_constraints')
        .select('id')
        .eq('employee_id', empId)
        .gte('date', startStr)
        .lte('date', endStr)

      setNextWeekCount(constraints?.length ?? 0)
    }

    fetchNextWeekAvailability()
  }, [appUser])

  if (page === 'my-schedule') {
    return <MySchedule onBack={() => setPage(null)} />
  }
  if (page === 'employee-constraints') {
    return <EmployeeConstraints onBack={() => setPage(null)} />
  }

  const handleNavigate = (p: string) => {
    if (p === 'my-schedule' || p === 'employee-constraints') {
      setPage(p)
    } else {
      onNavigate(p)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>

        {/* Header */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            שלום {appUser?.name || 'עובד'} 👋
          </h1>
          <p style={{ fontSize: 14, color: '#94a3b8', margin: '4px 0 0' }}>
            סניף {branchName} · {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </motion.div>

        {/* Weekly status card */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.1 }}
          style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>📅</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#3730a3' }}>הסידור שלך השבוע</span>
          </div>
          {nextWeekCount > 0 ? (
            <p style={{ fontSize: 13, color: '#4338ca', margin: 0 }}>
              {nextWeekCount} משמרות מתוכננות לשבוע הקרוב
            </p>
          ) : (
            <p style={{ fontSize: 13, color: '#6366f1', margin: 0 }}>
              הסידור לשבוע זה טרם פורסם
            </p>
          )}
        </motion.div>

        {/* Main action cards */}
        <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
          <motion.button variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.2 }}
            onClick={() => handleNavigate('my-schedule')}
            style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '24px 16px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>הסידור שלי</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>משמרות · תפקידים</div>
          </motion.button>

          <motion.button variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.25 }}
            onClick={() => handleNavigate('employee-constraints')}
            style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '24px 16px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🙋</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>הזמינות שלי</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>אילוצים · שבועי</div>
          </motion.button>
        </div>

        {/* Profile card (coming soon) */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.3 }}
          style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 24, opacity: 0.6 }}
          className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 20 }}>👤</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>הפרופיל שלי</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>פרטים אישיים</div>
            </div>
          </div>
          <span style={{ fontSize: 10, background: '#f1f5f9', padding: '2px 8px', borderRadius: 6, color: '#94a3b8' }}>בקרוב</span>
        </motion.div>

        {/* Logout */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.35 }}
          style={{ textAlign: 'center' }}>
          <button onClick={logout}
            style={{ color: '#94a3b8', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }}>
            התנתק
          </button>
        </motion.div>
      </div>
    </div>
  )
}
