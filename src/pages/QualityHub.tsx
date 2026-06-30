import { useState } from 'react'
import { motion } from 'framer-motion'
import { MessageSquareWarning, ShieldCheck, Thermometer, ClipboardCheck } from 'lucide-react'
import PageHeader from '../components/PageHeader'

interface Props {
  onBack: () => void
  onNavigate: (page: string) => void
  scope?: 'branch' | 'factory'
  branchName?: string
}

type Scope = 'branch' | 'factory'

interface QualityForm {
  page: string
  label: string
  subtitle: string
  Icon: any
  color: string
  ready: boolean
  scopes?: Scope[]
}

const QUALITY_FORMS: QualityForm[] = [
  { page: 'customer_complaints',  label: 'תלונות לקוח',           subtitle: 'טופס 0701 · מעקב פתוח/סגור',     Icon: MessageSquareWarning, color: '#dc2626', ready: true, scopes: ['branch', 'factory'] },
  { page: 'factory_freezer_log',  label: 'בקרת מקפיאים ומקררים', subtitle: 'מעקב טמפרטורות יומי · 7 יחידות', Icon: Thermometer,          color: '#0ea5e9', ready: true, scopes: ['factory'] },
  { page: 'factory_closing',      label: 'סגירת מפעל יומי',        subtitle: 'צ׳ק-ליסט סגירה · 60 פריטים + טמפרטורות', Icon: ClipboardCheck, color: '#0f766e', ready: true, scopes: ['factory'] },
]

const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }
const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } } }

export default function QualityHub({ onBack, onNavigate, scope, branchName }: Props) {
  const [hovCard, setHovCard] = useState<string | null>(null)

  const subtitle = scope === 'branch' && branchName
    ? `סניף ${branchName} · טפסי תקן, משרד הבריאות, תחזוקה`
    : 'טפסי תקן, משרד הבריאות, תחזוקה'

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="איכות ובקרה" subtitle={subtitle} onBack={onBack} />

      <div style={{ padding: '36px', maxWidth: '960px', margin: '0 auto' }}>
        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {QUALITY_FORMS.filter(f => !f.scopes || !scope || f.scopes.includes(scope)).map(form => {
            const Icon = form.Icon
            const isHov = hovCard === form.page
            return (
              <motion.div key={form.page} variants={fadeUp}>
                <button
                  onClick={() => form.ready && onNavigate(form.page)}
                  onMouseEnter={() => setHovCard(form.page)}
                  onMouseLeave={() => setHovCard(null)}
                  disabled={!form.ready}
                  style={{
                    width: '100%',
                    background: 'white',
                    border: `1px solid ${isHov && form.ready ? '#fecaca' : '#f1f5f9'}`,
                    borderRadius: 12, padding: '20px',
                    display: 'flex', alignItems: 'center', gap: 14,
                    cursor: form.ready ? 'pointer' : 'not-allowed', transition: 'all 0.18s',
                    boxShadow: isHov && form.ready ? '0 4px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)',
                    textAlign: 'right', opacity: form.ready ? 1 : 0.6,
                    position: 'relative' as const,
                  }}
                >
                  {!form.ready && (
                    <span style={{ position: 'absolute', top: 10, left: 10, background: '#f1f5f9', color: '#94a3b8', fontSize: 11, padding: '3px 8px', borderRadius: 8, fontWeight: 600 }}>
                      בקרוב
                    </span>
                  )}
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                    background: `${form.color}15`, color: form.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={24} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>{form.label}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{form.subtitle}</div>
                  </div>
                </button>
              </motion.div>
            )
          })}
        </motion.div>

        <div style={{
          marginTop: 32, padding: '20px 24px',
          background: 'white', borderRadius: 12, border: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: '#10b98115', color: '#10b981',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ShieldCheck size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>טפסים נוספים יתווספו בקרוב</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>HACCP · ביקורות משרד הבריאות · אחזקה מונעת · ביקורת ציוד</div>
          </div>
        </div>
      </div>
    </div>
  )
}
