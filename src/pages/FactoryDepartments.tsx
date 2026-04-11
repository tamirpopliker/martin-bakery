import { useState } from 'react'
import { motion } from 'framer-motion'
import { FlaskConical, Croissant, Package, Truck } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import DepartmentHome from './DepartmentHome'
import { useAppUser } from '../lib/UserContext'

const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }
const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } } }

type Department = 'creams' | 'dough' | 'packaging' | 'cleaning'

interface Props { onBack: () => void }

const DEPTS: { key: Department; label: string; subtitle: string; Icon: any; color: string }[] = [
  { key: 'creams',    label: 'קרמים',      subtitle: 'ייצור · פחת · תיקונים · לייבור · דשבורד', Icon: FlaskConical, color: '#818cf8' },
  { key: 'dough',     label: 'בצקים',      subtitle: 'ייצור · פחת · תיקונים · לייבור · דשבורד', Icon: Croissant,    color: '#8b5cf6' },
  { key: 'packaging', label: 'אריזה',      subtitle: 'כמויות · פחת · תיקונים · לייבור',         Icon: Package,      color: '#0ea5e9' },
  { key: 'cleaning',  label: 'ניקיון/נהג', subtitle: 'תיקונים · לייבור',                        Icon: Truck,        color: '#64748b' },
]

export default function FactoryDepartments({ onBack }: Props) {
  const { appUser } = useAppUser()
  const [selected, setSelected] = useState<Department | null>(null)
  const [hovCard, setHovCard] = useState<Department | null>(null)

  // Department managers see only their department; admin/regular factory see all
  const isDeptManager = appUser?.role === 'factory' && !!appUser?.managed_department
  const visibleDepts = isDeptManager
    ? DEPTS.filter(d => d.key === appUser.managed_department)
    : DEPTS

  // If dept manager has only one department, skip the hub and go directly
  if (isDeptManager && visibleDepts.length === 1 && !selected) {
    return <DepartmentHome department={visibleDepts[0].key} onBack={onBack} />
  }

  if (selected) {
    return <DepartmentHome department={selected} onBack={() => setSelected(null)} />
  }

  const subtitle = visibleDepts.map(d => d.label).join(' · ')

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="מחלקות" subtitle={subtitle} onBack={onBack} />

      <div style={{ padding: '36px', maxWidth: 960, margin: '0 auto' }}>
        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}
          variants={staggerContainer} initial="hidden" animate="visible">
          {visibleDepts.map(dept => {
            const Icon = dept.Icon
            const isHov = hovCard === dept.key
            return (
              <motion.div key={dept.key} variants={fadeUp}>
                <button
                  onClick={() => setSelected(dept.key)}
                  onMouseEnter={() => setHovCard(dept.key)}
                  onMouseLeave={() => setHovCard(null)}
                  style={{
                    width: '100%', background: 'white',
                    border: `1px solid ${isHov ? '#c7d2fe' : '#e2e8f0'}`,
                    borderRadius: 12, padding: 20,
                    display: 'flex', alignItems: 'center', gap: 14,
                    boxShadow: isHov ? '0 4px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)',
                    cursor: 'pointer', transition: 'all 0.15s', textAlign: 'right',
                  }}>
                  <div style={{ width: 42, height: 42, background: '#f1f5f9', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={20} color={dept.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b' }}>{dept.label}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{dept.subtitle}</div>
                  </div>
                </button>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}
