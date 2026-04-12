import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Pin, Check, Bell, Trash2, Pencil, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { branchId: number; branchName: string; branchColor: string; onBack: () => void }

interface Message {
  id: number; branch_id: number; title: string; body: string | null
  type: string; created_by: string | null; created_at: string
  is_pinned: boolean; read_count?: number; total_employees?: number
}

const TYPE_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  urgent: { label: 'דחוף', emoji: '🔴', color: '#dc2626', bg: '#fef2f2' },
  task:   { label: 'משימה', emoji: '🔵', color: '#2563eb', bg: '#eff6ff' },
  info:   { label: 'עדכון', emoji: '🟢', color: '#16a34a', bg: '#f0fdf4' },
  praise: { label: 'הכרה', emoji: '🟡', color: '#ca8a04', bg: '#fefce8' },
}

const S = {
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 12 } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  label: { fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 } as React.CSSProperties,
}

export default function BranchCommunication({ branchId, branchName, branchColor, onBack }: Props) {
  const { appUser } = useAppUser()
  const isManager = appUser?.role === 'admin' || appUser?.role === 'branch'
  const employeeId = appUser?.employee_id || 0

  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ title: '', body: '', type: 'info', is_pinned: false })
  const [myReads, setMyReads] = useState<Set<number>>(new Set())
  const [totalEmps, setTotalEmps] = useState(0)

  const loadMessages = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('branch_messages').select('*')
      .eq('branch_id', branchId)
      .or('scheduled_at.is.null,scheduled_at.lte.' + new Date().toISOString())
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })

    // Get read counts
    const msgs = data || []
    const msgIds = msgs.map(m => m.id)
    if (msgIds.length > 0) {
      const { data: reads } = await supabase.from('message_reads').select('message_id, employee_id').in('message_id', msgIds)
      const readCounts = new Map<number, number>()
      const myReadSet = new Set<number>()
      for (const r of (reads || [])) {
        readCounts.set(r.message_id, (readCounts.get(r.message_id) || 0) + 1)
        if (r.employee_id === employeeId) myReadSet.add(r.message_id)
      }
      setMyReads(myReadSet)
      for (const m of msgs) m.read_count = readCounts.get(m.id) || 0
    }

    // Get total employees count
    const { count } = await supabase.from('branch_employees').select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId).eq('active', true).eq('is_manager', false)
    setTotalEmps(count || 0)

    setMessages(msgs)
    setLoading(false)
  }, [branchId, employeeId])

  useEffect(() => { loadMessages() }, [loadMessages])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel(`branch-msgs-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branch_messages', filter: `branch_id=eq.${branchId}` }, () => loadMessages())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [branchId, loadMessages])

  async function saveMessage() {
    if (!form.title) return
    const payload = { branch_id: branchId, title: form.title, body: form.body || null, type: form.type, is_pinned: form.is_pinned, created_by: appUser?.name || null }
    if (editId) { await supabase.from('branch_messages').update(payload).eq('id', editId); setEditId(null) }
    else {
      await supabase.from('branch_messages').insert(payload)
      // Send email notification to branch employees
      try {
        const { data: emps } = await supabase.from('branch_employees').select('email, name').eq('branch_id', branchId).eq('active', true).not('email', 'is', null)
        if (emps && emps.length > 0) {
          const emails = emps.filter(e => e.email).map(e => e.email)
          if (emails.length > 0) {
            await supabase.functions.invoke('send-invitation', {
              body: { email: emails[0], name: 'צוות', senderName: appUser?.name, branchId }
            }).catch(() => {}) // Best effort
          }
        }
      } catch {} // Don't block on email failure
    }
    setForm({ title: '', body: '', type: 'info', is_pinned: false }); setShowAdd(false); loadMessages()
  }

  async function deleteMsg(id: number) { if (!confirm('למחוק הודעה זו?')) return; await supabase.from('branch_messages').delete().eq('id', id); loadMessages() }

  async function togglePin(msg: Message) {
    await supabase.from('branch_messages').update({ is_pinned: !msg.is_pinned }).eq('id', msg.id); loadMessages()
  }

  async function markRead(msgId: number) {
    if (!employeeId || myReads.has(msgId)) return
    await supabase.from('message_reads').insert({ message_id: msgId, employee_id: employeeId })
    setMyReads(prev => new Set([...prev, msgId])); loadMessages()
  }

  const unreadCount = messages.filter(m => !myReads.has(m.id)).length
  const totalUnreadEmployees = messages.reduce((s, m) => s + Math.max(0, totalEmps - (m.read_count || 0)), 0)

  const fmtTime = (d: string) => {
    const dt = new Date(d)
    const now = new Date()
    const diffH = Math.floor((now.getTime() - dt.getTime()) / 3600000)
    if (diffH < 1) return 'הרגע'
    if (diffH < 24) return `לפני ${diffH} שעות`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `לפני ${diffD} ימים`
    return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`
  }

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="מרכז תקשורת" subtitle={branchName} onBack={onBack} />
      <div style={{ padding: '24px 32px', maxWidth: 800, margin: '0 auto' }}>

        {/* Manager stats */}
        {isManager && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ background: '#eff6ff', borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600 }}>הודעות פעילות</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1d4ed8' }}>{messages.length}</div>
            </div>
            <div style={{ background: totalUnreadEmployees > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: totalUnreadEmployees > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>לא נקראו</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: totalUnreadEmployees > 0 ? '#dc2626' : '#16a34a' }}>{totalUnreadEmployees}</div>
            </div>
            <button onClick={() => { setShowAdd(true); setEditId(null); setForm({ title: '', body: '', type: 'info', is_pinned: false }) }}
              style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={16} /> הודעה חדשה
            </button>
          </div>
        )}

        {/* Employee unread banner */}
        {!isManager && unreadCount > 0 && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '10px 16px', marginBottom: 16, fontSize: 14, color: '#1d4ed8', fontWeight: 600 }}>
            📬 יש לך {unreadCount} הודעות שלא נקראו
          </div>
        )}

        {/* Add/edit form */}
        {showAdd && isManager && (
          <div style={{ ...S.card, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>{editId ? 'עריכת הודעה' : 'הודעה חדשה'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div><label style={S.label}>כותרת</label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} style={S.input} /></div>
              <div><label style={S.label}>תוכן</label><textarea value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} rows={4} style={{ ...S.input, resize: 'vertical' }} /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>סוג</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                      <button key={key} onClick={() => setForm(p => ({ ...p, type: key }))}
                        style={{ ...S.btn, padding: '6px 14px', fontSize: 12, background: form.type === key ? cfg.bg : 'white', color: form.type === key ? cfg.color : '#94a3b8', border: `1px solid ${form.type === key ? cfg.color : '#e2e8f0'}` }}>
                        {cfg.emoji} {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button onClick={() => setForm(p => ({ ...p, is_pinned: !p.is_pinned }))}
                    style={{ ...S.btn, padding: '6px 14px', fontSize: 12, background: form.is_pinned ? '#fef3c7' : 'white', color: form.is_pinned ? '#b45309' : '#94a3b8', border: `1px solid ${form.is_pinned ? '#f59e0b' : '#e2e8f0'}` }}>
                    <Pin size={13} style={{ marginLeft: 4 }} /> {form.is_pinned ? 'מוצמד' : 'הצמד'}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={saveMessage} disabled={!form.title} style={{ ...S.btn, background: form.title ? '#0f172a' : '#e2e8f0', color: form.title ? 'white' : '#94a3b8' }}>
                {editId ? 'עדכן' : 'שלח'} הודעה
              </button>
              <button onClick={() => { setShowAdd(false); setEditId(null) }} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        )}

        {/* Messages feed */}
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
            const readPct = totalEmps > 0 ? ((msg.read_count || 0) / totalEmps * 100) : 0

            return (
              <div key={msg.id} style={{
                ...S.card,
                borderRight: `4px solid ${cfg.color}`,
                background: !isRead && !isManager ? '#fafbff' : 'white',
                position: 'relative',
              }}>
                {/* Unread dot */}
                {!isRead && !isManager && (
                  <div style={{ position: 'absolute', top: 12, left: 12, width: 10, height: 10, borderRadius: '50%', background: '#3b82f6' }} />
                )}

                {/* Pin badge */}
                {msg.is_pinned && (
                  <div style={{ position: 'absolute', top: 8, left: isManager ? 50 : 28, fontSize: 11, color: '#b45309', fontWeight: 600 }}>📌 מוצמד</div>
                )}

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <span style={{ background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, marginLeft: 8 }}>
                      {cfg.emoji} {cfg.label}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{msg.title}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtTime(msg.created_at)}</span>
                </div>

                {/* Body */}
                {msg.body && (
                  <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{msg.body}</div>
                )}

                {/* Footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  {/* Manager: read progress */}
                  {isManager && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>קראו {msg.read_count || 0}/{totalEmps}</span>
                      <div style={{ width: 80, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${readPct}%`, background: readPct >= 100 ? '#16a34a' : '#3b82f6' }} />
                      </div>
                    </div>
                  )}

                  {/* Employee: mark read */}
                  {!isManager && !isRead && (
                    <button onClick={() => markRead(msg.id)}
                      style={{ ...S.btn, padding: '6px 14px', fontSize: 12, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                      <Check size={13} style={{ marginLeft: 4 }} /> קראתי
                    </button>
                  )}
                  {!isManager && isRead && (
                    <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ נקרא</span>
                  )}

                  {/* Manager actions */}
                  {isManager && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => togglePin(msg)} style={{ ...S.btn, padding: '4px 8px', fontSize: 11, background: msg.is_pinned ? '#fef3c7' : '#f1f5f9', color: msg.is_pinned ? '#b45309' : '#94a3b8' }} title={msg.is_pinned ? 'בטל הצמדה' : 'הצמד'}>
                        <Pin size={12} />
                      </button>
                      <button onClick={() => { setEditId(msg.id); setForm({ title: msg.title, body: msg.body || '', type: msg.type, is_pinned: msg.is_pinned }); setShowAdd(true) }}
                        style={{ ...S.btn, padding: '4px 8px', fontSize: 11, background: '#f1f5f9', color: '#6366f1' }}><Pencil size={12} /></button>
                      <button onClick={() => deleteMsg(msg.id)}
                        style={{ ...S.btn, padding: '4px 8px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>

                {msg.created_by && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>נשלח ע"י {msg.created_by}</div>}
              </div>
            )
          })
        )}
      </div>
    </motion.div>
  )
}
