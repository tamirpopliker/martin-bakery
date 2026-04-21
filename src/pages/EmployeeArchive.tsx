import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/PageHeader'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface ArchivedEmployee {
  id: number
  name: string
  email: string | null
  hourly_rate: number | null
  active: boolean
}

const fadeIn = { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

export default function EmployeeArchive({ branchId, branchName, onBack }: Props) {
  const [employees, setEmployees] = useState<ArchivedEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  async function loadArchived() {
    setLoading(true)
    const { data } = await supabase.from('branch_employees')
      .select('id, name, email, hourly_rate, active')
      .eq('branch_id', branchId)
      .eq('active', false)
      .order('name')
    setEmployees(data || [])
    setLoading(false)
  }

  useEffect(() => { loadArchived() }, [branchId])

  async function reactivate(empId: number, empName: string) {
    if (!confirm(`להחזיר את ${empName} לרשימה הפעילה?`)) return
    const { error } = await supabase.from('branch_employees').update({ active: true }).eq('id', empId)
    if (error) {
      console.error('[EmployeeArchive reactivate] error:', error)
      alert(`החזרת העובד נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    loadArchived()
  }

  const filtered = employees.filter(e => !search || e.name.includes(search))

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="ארכיון עובדים" subtitle={branchName} onBack={onBack} />

      <div style={{ padding: '24px 32px', maxWidth: '700px', margin: '0 auto' }}>
        {/* Search */}
        <input
          type="text"
          placeholder="חיפוש לפי שם..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 14, marginBottom: 16, boxSizing: 'border-box', fontFamily: 'inherit' }}
        />

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>טוען...</div>
        ) : filtered.length === 0 ? (
          <motion.div variants={fadeIn} initial="hidden" animate="visible"
            style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
            <div>אין עובדים לא פעילים</div>
          </motion.div>
        ) : (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 12, fontWeight: 700, color: '#64748b' }}>
                <span>שם</span>
                <span style={{ textAlign: 'center' }}>פעולה</span>
              </div>
              {filtered.map(emp => (
                <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px', padding: '14px 20px', borderBottom: '1px solid #f8fafc', alignItems: 'center', fontSize: 13 }}>
                  <div>
                    <span style={{ fontWeight: 600, color: '#374151' }}>{emp.name}</span>
                    {emp.email && <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 8 }}>{emp.email}</span>}
                  </div>
                  <button
                    onClick={() => reactivate(emp.id, emp.name)}
                    style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    החזר לפעיל ↩️
                  </button>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12, textAlign: 'center' }}>
              {filtered.length} עובדים לא פעילים
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
