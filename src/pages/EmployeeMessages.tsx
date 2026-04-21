import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Check, Download, Pin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }

interface Props { onBack: () => void }

interface Message {
  id: number; title: string; body: string | null; type: string
  created_by: string | null; created_at: string; is_pinned: boolean
  recipient_type: string; recipient_id: number | null; recipient_role: string | null
  attachments?: { id: number; file_name: string; file_url: string; file_size: number }[]
}

const TYPE_CONFIG: Record<string, { emoji: string; color: string; bg: string; label: string }> = {
  urgent: { emoji: '🔴', color: '#dc2626', bg: '#fef2f2', label: 'דחוף' },
  task:   { emoji: '🔵', color: '#2563eb', bg: '#eff6ff', label: 'משימה' },
  info:   { emoji: '🟢', color: '#16a34a', bg: '#f0fdf4', label: 'עדכון' },
  praise: { emoji: '🟡', color: '#ca8a04', bg: '#fefce8', label: 'הכרה' },
}

export default function EmployeeMessages({ onBack }: Props) {
  const { appUser } = useAppUser()
  const employeeId = appUser?.employee_id || 0
  const branchId = appUser?.branch_id || 0

  const [messages, setMessages] = useState<Message[]>([])
  const [myReads, setMyReads] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)

  const loadMessages = useCallback(async () => {
    if (!branchId) return
    setLoading(true)

    const { data } = await supabase.from('branch_messages').select('*')
      .eq('branch_id', branchId)
      .or('scheduled_at.is.null,scheduled_at.lte.' + new Date().toISOString())
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })

    let msgs = (data || []).filter(m =>
      !m.recipient_type || m.recipient_type === 'all' ||
      (m.recipient_type === 'specific' && m.recipient_id === employeeId)
      // TODO: filter by role when employee role field is available
    )

    // Load attachments
    const msgIds = msgs.map(m => m.id)
    if (msgIds.length > 0) {
      const { data: atts } = await supabase.from('message_attachments').select('*').in('message_id', msgIds)
      for (const m of msgs) m.attachments = (atts || []).filter((a: any) => a.message_id === m.id)

      // Load my reads
      if (employeeId) {
        const { data: reads } = await supabase.from('message_reads').select('message_id').eq('employee_id', employeeId).in('message_id', msgIds)
        setMyReads(new Set((reads || []).map(r => r.message_id)))
      }
    }

    setMessages(msgs)
    setLoading(false)
  }, [branchId, employeeId])

  useEffect(() => { loadMessages() }, [loadMessages])

  // Realtime
  useEffect(() => {
    if (!branchId) return
    const ch = supabase.channel(`emp-msgs-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branch_messages', filter: `branch_id=eq.${branchId}` }, () => loadMessages())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [branchId, loadMessages])

  async function markRead(msgId: number) {
    if (!employeeId || myReads.has(msgId)) return
    const { error } = await supabase.from('message_reads').insert({ message_id: msgId, employee_id: employeeId })
    if (error) {
      console.warn('[EmployeeMessages markRead] non-fatal error:', error)
      return
    }
    setMyReads(prev => new Set([...prev, msgId]))
  }

  const fmtTime = (d: string) => {
    const dt = new Date(d); const now = new Date()
    const diffH = Math.floor((now.getTime() - dt.getTime()) / 3600000)
    if (diffH < 1) return 'הרגע'
    if (diffH < 24) return `לפני ${diffH} שעות`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `לפני ${diffD} ימים`
    return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`
  }

  const unreadCount = messages.filter(m => !myReads.has(m.id)).length

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="הודעות" subtitle={unreadCount > 0 ? `${unreadCount} לא נקראו` : 'הכל נקרא'} onBack={onBack} />
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px' }}>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8' }}>טוען...</div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 15 }}>אין הודעות</div>
          </div>
        ) : (
          messages.map(msg => {
            const cfg = TYPE_CONFIG[msg.type] || TYPE_CONFIG.info
            const isRead = myReads.has(msg.id)

            return (
              <div key={msg.id} style={{
                background: isRead ? 'white' : '#fafbff',
                borderRadius: 14, border: '1px solid #e2e8f0',
                borderRight: `4px solid ${cfg.color}`,
                padding: 18, marginBottom: 10,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                position: 'relative',
              }}>
                {/* Unread dot */}
                {!isRead && (
                  <div style={{ position: 'absolute', top: 14, left: 14, width: 10, height: 10, borderRadius: '50%', background: '#3b82f6' }} />
                )}

                {/* Pinned */}
                {msg.is_pinned && (
                  <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600, marginBottom: 4 }}>📌 מוצמד</div>
                )}

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <span style={{ background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, marginLeft: 8 }}>
                      {cfg.emoji} {cfg.label}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{msg.title}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtTime(msg.created_at)}</span>
                </div>

                {/* Body */}
                {msg.body && (
                  <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{msg.body}</div>
                )}

                {/* Attachments */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {msg.attachments.map(att => (
                      <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
                        <Download size={12} /> {att.file_name}
                      </a>
                    ))}
                  </div>
                )}

                {/* Footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {!isRead ? (
                    <button onClick={() => markRead(msg.id)}
                      style={{ border: '1px solid #bbf7d0', borderRadius: 10, padding: '6px 14px', fontSize: 12, fontWeight: 600, background: '#f0fdf4', color: '#16a34a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check size={13} /> קראתי
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ נקרא</span>
                  )}
                  {msg.created_by && <span style={{ fontSize: 11, color: '#94a3b8' }}>מאת {msg.created_by}</span>}
                </div>
              </div>
            )
          })
        )}
      </div>
    </motion.div>
  )
}
