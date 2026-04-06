import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { ArrowRight, Calendar, History } from 'lucide-react'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
  onNavigate?: (page: string, data?: any) => void
}

interface Publication {
  id: number
  branch_id: number
  week_start: string
  published_at: string
  assignmentCount?: number
}

function formatHebrewDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('he-IL')
}

function formatHebrewTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function getWeekEndDate(weekStart: string): string {
  const d = new Date(weekStart)
  d.setDate(d.getDate() + 5)
  return d.toISOString().split('T')[0]
}

function formatShortDate(iso: string): string {
  const parts = iso.split('-')
  return `${parseInt(parts[2])}/${parseInt(parts[1])}`
}

export default function ScheduleHistory({ branchId, branchName, branchColor, onBack, onNavigate }: Props) {
  const [publications, setPublications] = useState<Publication[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [branchId])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase.from('schedule_publications')
      .select('*')
      .eq('branch_id', branchId)
      .order('week_start', { ascending: false })
      .limit(20)

    if (data) {
      const enriched = await Promise.all(data.map(async (pub) => {
        const weekEnd = getWeekEndDate(pub.week_start)
        const { count } = await supabase.from('shift_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('branch_id', branchId)
          .gte('date', pub.week_start)
          .lte('date', weekEnd)
        return { ...pub, assignmentCount: count || 0 }
      }))
      setPublications(enriched)
    }
    setLoading(false)
  }

  return (
    <motion.div dir="rtl" initial="hidden" animate="visible" variants={fadeIn}
      style={{ padding: '16px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight style={{ width: '18px', height: '18px' }} />
        </Button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={22} style={{ color: '#6366f1' }} />
            {'\u05D4\u05D9\u05E1\u05D8\u05D5\u05E8\u05D9\u05D9\u05EA \u05E1\u05D9\u05D3\u05D5\u05E8\u05D9\u05DD'}
          </h1>
          <span style={{ fontSize: '13px', color: '#64748b' }}>{branchName}</span>
        </div>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: branchColor }} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8' }}>{'\u05D8\u05D5\u05E2\u05DF...'}</div>
      ) : publications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{'\u{1F4CB}'}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#64748b' }}>{'\u05D8\u05E8\u05DD \u05E4\u05D5\u05E8\u05E1\u05DE\u05D5 \u05E1\u05D9\u05D3\u05D5\u05E8\u05D9\u05DD'}</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{'\u05E1\u05D9\u05D3\u05D5\u05E8\u05D9\u05DD \u05E9\u05E4\u05D5\u05E8\u05E1\u05DE\u05D5 \u05D9\u05D5\u05E4\u05D9\u05E2\u05D5 \u05DB\u05D0\u05DF'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {publications.map(pub => {
            const weekEnd = getWeekEndDate(pub.week_start)
            return (
              <motion.div key={pub.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: 16,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Calendar size={22} style={{ color: '#6366f1' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
                    {'\u05E9\u05D1\u05D5\u05E2'} {formatShortDate(pub.week_start)} {'\u2013'} {formatShortDate(weekEnd)}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    {'\u05E4\u05D5\u05E8\u05E1\u05DD'} {formatHebrewDate(pub.published_at)} {'\u05D1\u05E9\u05E2\u05D4'} {formatHebrewTime(pub.published_at)}
                    {pub.assignmentCount != null && (
                      <span> {'\u00B7'} {pub.assignmentCount} {'\u05E9\u05D9\u05D1\u05D5\u05E6\u05D9\u05DD'}</span>
                    )}
                  </div>
                </div>
                {onNavigate && (
                  <button
                    onClick={() => onNavigate('weekly-schedule', { initialWeekStart: pub.week_start })}
                    style={{
                      padding: '6px 14px',
                      background: '#6366f1',
                      color: 'white',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}>
                    {'\u05E6\u05E4\u05D4 \u05D1\u05E1\u05D9\u05D3\u05D5\u05E8'}
                  </button>
                )}
              </motion.div>
            )
          })}
        </div>
      )}
    </motion.div>
  )
}
