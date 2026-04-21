import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus, Pin, Check, Trash2, Pencil, Paperclip, X, Download, Clock, ToggleLeft, ToggleRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { branchId: number; branchName: string; branchColor: string; onBack: () => void }

interface Message {
  id: number; branch_id: number; title: string; body: string | null
  type: string; created_by: string | null; created_at: string
  is_pinned: boolean; recipient_type: string; recipient_id: number | null; recipient_role: string | null
  read_count?: number; target_count?: number
  attachments?: { id: number; file_name: string; file_url: string; file_size: number }[]
}

interface Employee { id: number; name: string }

const TYPE_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  urgent: { label: 'דחוף', emoji: '🔴', color: '#991b1b', bg: '#fef2f2' },
  task:   { label: 'משימה', emoji: '🔵', color: '#4338ca', bg: '#eef2ff' },
  info:   { label: 'עדכון', emoji: '🟢', color: '#0f766e', bg: '#f0fdfa' },
  praise: { label: 'הכרה', emoji: '🟡', color: '#92400e', bg: '#fffbeb' },
}

const ROLE_OPTIONS = ['מוכרים', 'אופים', 'בריסטה', 'ניקיון', 'מחסן']

const S = {
  card: { background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 10, transition: 'box-shadow 0.15s' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  input: { border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 14px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  label: { fontSize: 12, fontWeight: 500, color: '#64748b', display: 'block', marginBottom: 5 } as React.CSSProperties,
}

export default function BranchCommunication({ branchId, branchName, branchColor, onBack }: Props) {
  const { appUser } = useAppUser()
  const isManager = appUser?.role === 'admin' || appUser?.role === 'branch'
  const employeeId = appUser?.employee_id || 0

  const [messages, setMessages] = useState<Message[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ title: '', body: '', type: 'info', is_pinned: false, recipient_type: 'all', recipient_id: 0, recipient_role: '' })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [myReads, setMyReads] = useState<Set<number>>(new Set())
  const [totalEmps, setTotalEmps] = useState(0)
  const [commTab, setCommTab] = useState<'feed' | 'scheduled'>('feed')

  // Scheduled messages state
  const [schedMsgs, setSchedMsgs] = useState<any[]>([])
  const [schedLoading, setSchedLoading] = useState(false)
  const [showAddSched, setShowAddSched] = useState(false)
  const [editSchedId, setEditSchedId] = useState<number | null>(null)
  const [schedForm, setSchedForm] = useState({ title: '', body: '', type: 'info', recipient_type: 'all', recipient_id: 0, recipient_role: '', schedule_type: 'weekly', days_of_week: [] as number[], send_time: '07:00', is_active: true, specific_date: '', day_of_month: 28, days_before_holiday: 1 })
  const [schedLogView, setSchedLogView] = useState<number | null>(null)
  const [schedLogs, setSchedLogs] = useState<any[]>([])

  const TEMPLATES = [
    { name: 'תזכורת ספירת מלאי', title: 'תזכורת — ספירת מלאי', body: 'נא לבצע ספירת מלאי לפני סוף המשמרת', type: 'task', schedule_type: 'weekly', days_of_week: [4], send_time: '15:00' },
    { name: 'הכנות לשישי', title: 'הכנות ליום שישי', body: 'נא לוודא הכנות לשישי: מלאי, ניקיון, סידור', type: 'task', schedule_type: 'weekly', days_of_week: [4], send_time: '16:00' },
    { name: 'פתיחת שבוע', title: 'בוקר טוב — פתיחת שבוע', body: 'שבוע חדש, בהצלחה לכולם!', type: 'info', schedule_type: 'weekly', days_of_week: [0], send_time: '07:00' },
    { name: 'סגירת חודש', title: 'תזכורת — סגירת חודש', body: 'נא לוודא שכל הנתונים מעודכנים לפני סגירת חודש', type: 'task', schedule_type: 'monthly', days_of_week: [], send_time: '09:00' },
    { name: 'ברכת חג', title: 'חג שמח!', body: 'מאחלים חג שמח לכל הצוות', type: 'praise', schedule_type: 'once', days_of_week: [], send_time: '08:00' },
  ]

  const DAY_NAMES = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']
  const SCHED_LABELS: Record<string, string> = { once: 'חד פעמי', weekly: 'שבועי', biweekly: 'דו-שבועי', monthly: 'חודשי', before_holiday: 'לפני חג', birthday: 'יום הולדת' }

  function scheduleSummary(): string {
    const t = schedForm.send_time || '07:00'
    if (schedForm.schedule_type === 'once') {
      return schedForm.specific_date ? `תישלח ב-${schedForm.specific_date.split('-').reverse().join('/')} בשעה ${t}` : `תישלח פעם אחת בשעה ${t}`
    }
    if (schedForm.schedule_type === 'weekly' || schedForm.schedule_type === 'biweekly') {
      const days = schedForm.days_of_week.sort().map(d => DAY_NAMES[d]).join(', ')
      const prefix = schedForm.schedule_type === 'biweekly' ? 'כל שבועיים ב' : 'כל '
      return days ? `תישלח ${prefix}${days} בשעה ${t}` : 'בחר ימים'
    }
    if (schedForm.schedule_type === 'monthly') return `תישלח ב-${schedForm.day_of_month} לכל חודש בשעה ${t}`
    if (schedForm.schedule_type === 'before_holiday') return `תישלח ${schedForm.days_before_holiday} ימים לפני כל חג בשעה ${t}`
    if (schedForm.schedule_type === 'birthday') return `תישלח ביום הולדת כל עובד בשעה ${t}`
    return ''
  }

  // Load employees for dropdown
  useEffect(() => {
    async function loadEmps() {
      const { data } = await supabase.from('branch_employees').select('id, name')
        .eq('branch_id', branchId).eq('active', true).eq('is_manager', false).order('name')
      setEmployees(data || [])
    }
    loadEmps()
  }, [branchId])

  const loadMessages = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('branch_messages').select('*')
      .eq('branch_id', branchId)
      .or('scheduled_at.is.null,scheduled_at.lte.' + new Date().toISOString())
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })

    let msgs = data || []

    // Employee: filter to only messages targeted at them
    if (!isManager && employeeId) {
      // TODO: filter by role when employee role data is available
      msgs = msgs.filter(m =>
        m.recipient_type === 'all' || !m.recipient_type ||
        (m.recipient_type === 'specific' && m.recipient_id === employeeId)
      )
    }

    // Read counts
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
      for (const m of msgs) {
        m.read_count = readCounts.get(m.id) || 0
        // Target count depends on recipient type
        if (m.recipient_type === 'specific') m.target_count = 1
        else m.target_count = undefined // will use totalEmps
      }
    }

    // Load attachments
    if (msgIds.length > 0) {
      const { data: atts } = await supabase.from('message_attachments').select('*').in('message_id', msgIds)
      for (const m of msgs) m.attachments = (atts || []).filter(a => a.message_id === m.id)
    }

    const { count } = await supabase.from('branch_employees').select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId).eq('active', true).eq('is_manager', false)
    setTotalEmps(count || 0)

    setMessages(msgs)
    setLoading(false)
  }, [branchId, employeeId, isManager])

  useEffect(() => { loadMessages() }, [loadMessages])

  useEffect(() => {
    const ch = supabase.channel(`branch-msgs-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branch_messages', filter: `branch_id=eq.${branchId}` }, () => loadMessages())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [branchId, loadMessages])

  async function saveMessage() {
    if (!form.title) return
    const payload: any = {
      branch_id: branchId, title: form.title, body: form.body || null,
      type: form.type, is_pinned: form.is_pinned, created_by: appUser?.name || null,
      recipient_type: form.recipient_type,
      recipient_id: form.recipient_type === 'specific' ? form.recipient_id || null : null,
      recipient_role: form.recipient_type === 'role' ? form.recipient_role || null : null,
    }
    if (editId) {
      const { error } = await supabase.from('branch_messages').update(payload).eq('id', editId)
      if (error) {
        console.error('[BranchCommunication updateMsg] error:', error)
        alert(`עדכון ההודעה נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
        return
      }
      setEditId(null)
    } else {
      const { data: inserted, error: insErr } = await supabase.from('branch_messages').insert(payload).select().single()
      if (insErr || !inserted) {
        console.error('[BranchCommunication insertMsg] error:', insErr)
        alert(`שמירת ההודעה נכשלה: ${insErr?.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
        return
      }
      // Upload files
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          const path = `${branchId}/${inserted.id}/${Date.now()}_${file.name}`
          const { error: upErr } = await supabase.storage.from('message-attachments').upload(path, file)
          if (!upErr) {
            const { data: urlData } = supabase.storage.from('message-attachments').getPublicUrl(path)
            const { error: attachErr } = await supabase.from('message_attachments').insert({
              message_id: inserted.id, file_name: file.name,
              file_url: urlData.publicUrl, file_size: file.size,
            })
            if (attachErr) console.warn('[BranchCommunication attachment] DB row insert failed:', attachErr)
          } else {
            console.warn('[BranchCommunication attachment] storage upload failed:', upErr)
          }
        }
      }
    }
    resetForm(); loadMessages()
  }

  function resetForm() {
    setForm({ title: '', body: '', type: 'info', is_pinned: false, recipient_type: 'all', recipient_id: 0, recipient_role: '' })
    setSelectedFiles([]); setShowAdd(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function deleteMsg(id: number) {
    if (!confirm('למחוק הודעה זו?')) return
    const { error } = await supabase.from('branch_messages').delete().eq('id', id)
    if (error) {
      console.error('[BranchCommunication deleteMsg] error:', error)
      alert(`מחיקת ההודעה נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    loadMessages()
  }
  async function togglePin(msg: Message) {
    const { error } = await supabase.from('branch_messages').update({ is_pinned: !msg.is_pinned }).eq('id', msg.id)
    if (error) {
      console.error('[BranchCommunication togglePin] error:', error)
      alert(`עדכון סימון ההצמדה נכשל: ${error.message || 'שגיאת מסד נתונים'}.`)
      return
    }
    loadMessages()
  }

  async function markRead(msgId: number) {
    if (!employeeId || myReads.has(msgId)) return
    const { error } = await supabase.from('message_reads').insert({ message_id: msgId, employee_id: employeeId })
    if (error) {
      // Non-critical: reading the message is not blocked by the log failing.
      console.warn('[BranchCommunication markRead] error:', error)
      return
    }
    setMyReads(prev => new Set([...prev, msgId])); loadMessages()
  }

  // ═══ SCHEDULED MESSAGES ═══
  const loadScheduled = useCallback(async () => {
    setSchedLoading(true)
    const { data } = await supabase.from('scheduled_messages').select('*').eq('branch_id', branchId).order('created_at', { ascending: false })
    setSchedMsgs(data || [])
    setSchedLoading(false)
  }, [branchId])

  useEffect(() => { if (commTab === 'scheduled' && isManager) loadScheduled() }, [commTab, isManager, loadScheduled])

  function calcNextSend(schedType: string, daysOfWeek: number[], sendTime: string): string {
    const now = new Date()
    const [h, m] = sendTime.split(':').map(Number)
    if (schedType === 'weekly' || schedType === 'biweekly') {
      for (let i = 0; i < 14; i++) {
        const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0)
        if (daysOfWeek.includes(d.getDay()) && d > now) return d.toISOString()
      }
    }
    if (schedType === 'monthly') {
      const d = new Date(now.getFullYear(), now.getMonth(), 28, h, m); if (d <= now) d.setMonth(d.getMonth() + 1)
      return d.toISOString()
    }
    // once / fallback
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0)
    return d.toISOString()
  }

  async function saveScheduled() {
    if (!schedForm.title) return
    const nextSend = calcNextSend(schedForm.schedule_type, schedForm.days_of_week, schedForm.send_time)
    const payload = {
      branch_id: branchId, title: schedForm.title, body: schedForm.body || null, type: schedForm.type,
      recipient_type: schedForm.recipient_type,
      recipient_id: schedForm.recipient_type === 'specific' ? schedForm.recipient_id || null : null,
      recipient_role: schedForm.recipient_type === 'role' ? schedForm.recipient_role || null : null,
      schedule_type: schedForm.schedule_type, days_of_week: schedForm.days_of_week, send_time: schedForm.send_time,
      is_active: schedForm.is_active, next_send_at: nextSend, created_by: appUser?.name || null,
    }
    const { error } = editSchedId
      ? await supabase.from('scheduled_messages').update(payload).eq('id', editSchedId)
      : await supabase.from('scheduled_messages').insert(payload)
    if (error) {
      console.error('[BranchCommunication saveScheduled] error:', error)
      alert(`שמירת ההודעה הקבועה נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    if (editSchedId) setEditSchedId(null)
    setShowAddSched(false); setSchedForm({ title: '', body: '', type: 'info', recipient_type: 'all', recipient_id: 0, recipient_role: '', schedule_type: 'weekly', days_of_week: [], send_time: '07:00', is_active: true, specific_date: '', day_of_month: 28, days_before_holiday: 1 }); loadScheduled()
  }

  async function toggleSchedActive(id: number, current: boolean) {
    const { error } = await supabase.from('scheduled_messages').update({ is_active: !current }).eq('id', id)
    if (error) {
      console.error('[BranchCommunication toggleSchedActive] error:', error)
      alert(`שינוי מצב הפעלת ההודעה הקבועה נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    loadScheduled()
  }

  async function deleteSched(id: number) {
    if (!confirm('למחוק הודעה קבועה זו?')) return
    const { error } = await supabase.from('scheduled_messages').delete().eq('id', id)
    if (error) {
      console.error('[BranchCommunication deleteSched] error:', error)
      alert(`מחיקת ההודעה הקבועה נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    loadScheduled()
  }

  async function viewSchedLog(id: number) {
    setSchedLogView(id)
    const { data } = await supabase.from('scheduled_message_log').select('*').eq('scheduled_message_id', id).order('sent_at', { ascending: false }).limit(20)
    setSchedLogs(data || [])
  }

  function loadTemplate(idx: number) {
    const t = TEMPLATES[idx]
    setSchedForm(prev => ({ ...prev, title: t.title, body: t.body, type: t.type, schedule_type: t.schedule_type, days_of_week: t.days_of_week, send_time: t.send_time }))
  }

  function describeSchedule(s: any): string {
    const t = s.send_time || '07:00'
    if (s.schedule_type === 'once') return `חד פעמי ב-${t}`
    if (s.schedule_type === 'monthly') return `ב-${s.day_of_month || 28} לכל חודש ב-${t}`
    if (s.schedule_type === 'before_holiday') return `${s.days_before_holiday || 1} ימים לפני חג ב-${t}`
    if (s.schedule_type === 'birthday') return `ביום הולדת עובד ב-${t}`
    const days = (s.days_of_week || []).map((d: number) => DAY_NAMES[d]).join(', ')
    return `כל ${days || 'יום'} ב-${t}${s.schedule_type === 'biweekly' ? ' (דו-שבועי)' : ''}`
  }

  function getRecipientLabel(msg: Message): string | null {
    if (!msg.recipient_type || msg.recipient_type === 'all') return null
    if (msg.recipient_type === 'specific') {
      const emp = employees.find(e => e.id === msg.recipient_id)
      return `אל: ${emp?.name || 'עובד'}`
    }
    if (msg.recipient_type === 'role') return `אל: ${msg.recipient_role}`
    return null
  }

  function getTargetCount(msg: Message): number {
    if (msg.target_count !== undefined) return msg.target_count
    return totalEmps
  }

  const unreadCount = messages.filter(m => !myReads.has(m.id)).length
  const totalUnread = messages.reduce((s, m) => s + Math.max(0, getTargetCount(m) - (m.read_count || 0)), 0)

  const fmtTime = (d: string) => {
    const dt = new Date(d); const now = new Date()
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

        {/* Tabs — manager only */}
        {isManager && (
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
            <button style={{ padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', borderBottom: commTab === 'feed' ? '2px solid #6366f1' : '2px solid transparent', background: 'none', color: commTab === 'feed' ? '#6366f1' : '#94a3b8' }}
              onClick={() => setCommTab('feed')}>הודעות</button>
            <button style={{ padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', borderBottom: commTab === 'scheduled' ? '2px solid #6366f1' : '2px solid transparent', background: 'none', color: commTab === 'scheduled' ? '#6366f1' : '#94a3b8' }}
              onClick={() => setCommTab('scheduled')}><Clock size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> הודעות קבועות</button>
          </div>
        )}

        {/* ═══ FEED TAB ═══ */}
        {(commTab === 'feed' || !isManager) && (<>

        {/* Manager stats */}
        {isManager && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 18px', flex: 1, minWidth: 120, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8', marginBottom: 2 }}>הודעות פעילות</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#6366f1' }}>{messages.length}</div>
            </div>
            <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 18px', flex: 1, minWidth: 120, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8', marginBottom: 2 }}>לא נקראו</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: totalUnread > 0 ? '#ef4444' : '#10b981' }}>{totalUnread}</div>
            </div>
            <button onClick={() => { setShowAdd(true); setEditId(null); resetForm(); setShowAdd(true) }}
              style={{ ...S.btn, background: '#6366f1', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={16} /> הודעה חדשה
            </button>
          </div>
        )}

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

              {/* Recipient selector */}
              <div>
                <label style={S.label}>שלח אל</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[
                    { key: 'all', label: 'כל העובדים' },
                    { key: 'specific', label: 'עובד ספציפי' },
                    { key: 'role', label: 'לפי תפקיד' },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => setForm(p => ({ ...p, recipient_type: opt.key, recipient_id: 0, recipient_role: '' }))}
                      style={{ ...S.btn, padding: '6px 14px', fontSize: 12, background: form.recipient_type === opt.key ? '#0f172a' : 'white', color: form.recipient_type === opt.key ? 'white' : '#64748b', border: `1px solid ${form.recipient_type === opt.key ? '#0f172a' : '#e2e8f0'}` }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {form.recipient_type === 'specific' && (
                  <select value={form.recipient_id} onChange={e => setForm(p => ({ ...p, recipient_id: Number(e.target.value) }))}
                    style={S.input}>
                    <option value={0}>בחר עובד...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                )}
                {form.recipient_type === 'role' && (
                  <select value={form.recipient_role} onChange={e => setForm(p => ({ ...p, recipient_role: e.target.value }))}
                    style={S.input}>
                    <option value="">בחר תפקיד...</option>
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
              </div>

              <div><label style={S.label}>כותרת</label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} style={S.input} /></div>
              <div><label style={S.label}>תוכן</label><textarea value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} rows={4} style={{ ...S.input, resize: 'vertical' }} /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>סוג</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                      <button key={key} onClick={() => setForm(p => ({ ...p, type: key }))}
                        style={{ ...S.btn, padding: '6px 14px', fontSize: 12, borderRadius: 20, background: form.type === key ? '#eef2ff' : 'white', color: form.type === key ? '#4338ca' : '#94a3b8', border: `1px solid ${form.type === key ? '#a5b4fc' : '#e2e8f0'}` }}>
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
                  <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xlsx" multiple style={{ display: 'none' }}
                    onChange={e => { if (e.target.files) setSelectedFiles(prev => [...prev, ...Array.from(e.target.files!)]) }} />
                  <button onClick={() => fileInputRef.current?.click()}
                    style={{ ...S.btn, padding: '6px 14px', fontSize: 12, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>
                    <Paperclip size={13} style={{ marginLeft: 4 }} /> צרף קובץ
                  </button>
                </div>
              </div>
              {selectedFiles.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {selectedFiles.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f1f5f9', borderRadius: 8, padding: '4px 10px', fontSize: 12 }}>
                      <span style={{ color: '#374151' }}>{f.name}</span>
                      <span style={{ color: '#94a3b8' }}>({(f.size / 1024).toFixed(0)}KB)</span>
                      <button onClick={() => setSelectedFiles(prev => prev.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={12} color="#94a3b8" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={saveMessage} disabled={!form.title || (form.recipient_type === 'specific' && !form.recipient_id) || (form.recipient_type === 'role' && !form.recipient_role)}
                style={{ ...S.btn, background: form.title ? '#0f172a' : '#e2e8f0', color: form.title ? 'white' : '#94a3b8' }}>
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
            const target = getTargetCount(msg)
            const readPct = target > 0 ? ((msg.read_count || 0) / target * 100) : 0
            const recipientLabel = getRecipientLabel(msg)

            return (
              <div key={msg.id} style={{
                ...S.card, borderRight: `3px solid ${cfg.color}`,
                background: !isRead && !isManager ? '#fafbff' : 'white', position: 'relative',
              }}>
                {!isRead && !isManager && (
                  <div style={{ position: 'absolute', top: 12, left: 12, width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />
                )}
                {msg.is_pinned && (
                  <div style={{ position: 'absolute', top: 8, left: isManager ? 50 : 28, fontSize: 11, color: '#b45309', fontWeight: 600 }}>📌 מוצמד</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div>
                    <span style={{ background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, marginLeft: 8 }}>
                      {cfg.emoji} {cfg.label}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{msg.title}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtTime(msg.created_at)}</span>
                </div>

                {recipientLabel && (
                  <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 600, marginBottom: 6 }}>{recipientLabel}</div>
                )}

                {msg.body && (
                  <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{msg.body}</div>
                )}

                {msg.attachments && msg.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {msg.attachments.map(att => (
                      <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
                        <Download size={12} /> {att.file_name} <span style={{ color: '#94a3b8' }}>({(att.file_size / 1024).toFixed(0)}KB)</span>
                      </a>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  {isManager && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>קראו {msg.read_count || 0}/{target}</span>
                      <div style={{ width: 80, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(readPct, 100)}%`, background: readPct >= 100 ? '#6366f1' : '#a5b4fc' }} />
                      </div>
                    </div>
                  )}

                  {!isManager && !isRead && (
                    <button onClick={() => markRead(msg.id)}
                      style={{ ...S.btn, padding: '6px 14px', fontSize: 12, borderRadius: 20, background: '#eef2ff', color: '#6366f1', border: '1px solid #c7d2fe' }}>
                      <Check size={13} style={{ marginLeft: 4 }} /> קראתי
                    </button>
                  )}
                  {!isManager && isRead && (
                    <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ נקרא</span>
                  )}

                  {isManager && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => togglePin(msg)} style={{ ...S.btn, padding: '4px 8px', fontSize: 11, background: msg.is_pinned ? '#fef3c7' : '#f1f5f9', color: msg.is_pinned ? '#b45309' : '#94a3b8' }}>
                        <Pin size={12} />
                      </button>
                      <button onClick={() => { setEditId(msg.id); setForm({ title: msg.title, body: msg.body || '', type: msg.type, is_pinned: msg.is_pinned, recipient_type: msg.recipient_type || 'all', recipient_id: msg.recipient_id || 0, recipient_role: msg.recipient_role || '' }); setShowAdd(true) }}
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
        </>)}

        {/* ═══ SCHEDULED TAB ═══ */}
        {commTab === 'scheduled' && isManager && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>הודעות קבועות</h3>
              <button onClick={() => { setShowAddSched(true); setEditSchedId(null); setSchedForm({ title: '', body: '', type: 'info', recipient_type: 'all', recipient_id: 0, recipient_role: '', schedule_type: 'weekly', days_of_week: [], send_time: '07:00', is_active: true, specific_date: '', day_of_month: 28, days_before_holiday: 1 }) }}
                style={{ ...S.btn, background: '#6366f1', color: 'white', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} /> הודעה קבועה
              </button>
            </div>

            {/* Add/edit scheduled form */}
            {showAddSched && (
              <div style={{ ...S.card, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>{editSchedId ? 'עריכה' : 'הודעה קבועה חדשה'}</h3>

                {/* Template selector */}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>טען תבנית</label>
                  <select onChange={e => { if (e.target.value) loadTemplate(Number(e.target.value)); e.target.value = '' }} style={S.input}>
                    <option value="">בחר תבנית...</option>
                    {TEMPLATES.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div><label style={S.label}>כותרת</label><input value={schedForm.title} onChange={e => setSchedForm(p => ({ ...p, title: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>תוכן</label><textarea value={schedForm.body} onChange={e => setSchedForm(p => ({ ...p, body: e.target.value }))} rows={3} style={{ ...S.input, resize: 'vertical' }} /></div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <label style={S.label}>סוג</label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                          <button key={key} onClick={() => setSchedForm(p => ({ ...p, type: key }))}
                            style={{ ...S.btn, padding: '4px 10px', fontSize: 11, borderRadius: 20, background: schedForm.type === key ? '#eef2ff' : 'white', color: schedForm.type === key ? '#4338ca' : '#94a3b8', border: `1px solid ${schedForm.type === key ? '#a5b4fc' : '#e2e8f0'}` }}>
                            {cfg.emoji} {cfg.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={S.label}>תדירות</label>
                      <select value={schedForm.schedule_type} onChange={e => setSchedForm(p => ({ ...p, schedule_type: e.target.value }))} style={S.input}>
                        <option value="once">חד פעמי</option>
                        <option value="weekly">שבועי</option>
                        <option value="biweekly">דו-שבועי</option>
                        <option value="monthly">חודשי</option>
                        <option value="before_holiday">לפני חג</option>
                        <option value="birthday">יום הולדת עובד</option>
                      </select>
                    </div>
                    <div>
                      <label style={S.label}>שעה</label>
                      <input type="time" value={schedForm.send_time} onChange={e => setSchedForm(p => ({ ...p, send_time: e.target.value }))} style={{ ...S.input, width: 100 }} />
                    </div>
                  </div>

                  {/* Dynamic schedule fields */}
                  {schedForm.schedule_type === 'once' && (
                    <div><label style={S.label}>תאריך</label>
                      <input type="date" value={schedForm.specific_date} onChange={e => setSchedForm(p => ({ ...p, specific_date: e.target.value }))} style={{ ...S.input, width: 180 }} />
                    </div>
                  )}

                  {(schedForm.schedule_type === 'weekly' || schedForm.schedule_type === 'biweekly') && (
                    <div>
                      <label style={S.label}>ימים בשבוע</label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {DAY_NAMES.map((d, i) => (
                          <button key={i} onClick={() => setSchedForm(p => ({ ...p, days_of_week: p.days_of_week.includes(i) ? p.days_of_week.filter(x => x !== i) : [...p.days_of_week, i] }))}
                            style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: schedForm.days_of_week.includes(i) ? '#6366f1' : '#f1f5f9', color: schedForm.days_of_week.includes(i) ? 'white' : '#64748b' }}>
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {schedForm.schedule_type === 'monthly' && (
                    <div><label style={S.label}>תאריך בחודש</label>
                      <select value={schedForm.day_of_month} onChange={e => setSchedForm(p => ({ ...p, day_of_month: Number(e.target.value) }))} style={{ ...S.input, width: 100 }}>
                        {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                      </select>
                    </div>
                  )}

                  {schedForm.schedule_type === 'before_holiday' && (
                    <div><label style={S.label}>כמה ימים לפני החג</label>
                      <select value={schedForm.days_before_holiday} onChange={e => setSchedForm(p => ({ ...p, days_before_holiday: Number(e.target.value) }))} style={{ ...S.input, width: 100 }}>
                        <option value={1}>יום אחד</option><option value={2}>יומיים</option><option value={3}>שלושה ימים</option>
                      </select>
                    </div>
                  )}

                  {/* Schedule summary */}
                  {scheduleSummary() && (
                    <div style={{ background: '#eff6ff', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#1d4ed8', fontWeight: 500 }}>
                      📅 {scheduleSummary()}
                    </div>
                  )}

                  <div>
                    <label style={S.label}>נמענים</label>
                    <select value={schedForm.recipient_type} onChange={e => setSchedForm(p => ({ ...p, recipient_type: e.target.value }))} style={{ ...S.input, width: 'auto' }}>
                      <option value="all">כל העובדים</option>
                      <option value="specific">עובד ספציפי</option>
                      <option value="role">לפי תפקיד</option>
                    </select>
                    {schedForm.recipient_type === 'specific' && (
                      <select value={schedForm.recipient_id} onChange={e => setSchedForm(p => ({ ...p, recipient_id: Number(e.target.value) }))} style={{ ...S.input, marginTop: 6 }}>
                        <option value={0}>בחר...</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    )}
                    {schedForm.recipient_type === 'role' && (
                      <select value={schedForm.recipient_role} onChange={e => setSchedForm(p => ({ ...p, recipient_role: e.target.value }))} style={{ ...S.input, marginTop: 6 }}>
                        <option value="">בחר...</option>{ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={saveScheduled} disabled={!schedForm.title} style={{ ...S.btn, background: schedForm.title ? '#0f172a' : '#e2e8f0', color: schedForm.title ? 'white' : '#94a3b8' }}>שמור</button>
                  <button onClick={() => { setShowAddSched(false); setEditSchedId(null) }} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
                </div>
              </div>
            )}

            {/* Log viewer */}
            {schedLogView && (
              <div style={{ ...S.card, background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>היסטוריית שליחות</h4>
                  <button onClick={() => setSchedLogView(null)} style={{ ...S.btn, padding: '4px 12px', fontSize: 12, background: '#f1f5f9', color: '#64748b' }}>סגור</button>
                </div>
                {schedLogs.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>אין שליחות עדיין</div> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={{ fontSize: 12, fontWeight: 600, color: '#64748b', padding: '8px', textAlign: 'right', borderBottom: '1px solid #e2e8f0' }}>תאריך</th>
                      <th style={{ fontSize: 12, fontWeight: 600, color: '#64748b', padding: '8px', textAlign: 'right', borderBottom: '1px solid #e2e8f0' }}>נמענים</th>
                      <th style={{ fontSize: 12, fontWeight: 600, color: '#64748b', padding: '8px', textAlign: 'right', borderBottom: '1px solid #e2e8f0' }}>קראו</th>
                      <th style={{ fontSize: 12, fontWeight: 600, color: '#64748b', padding: '8px', textAlign: 'right', borderBottom: '1px solid #e2e8f0' }}>%</th>
                    </tr></thead>
                    <tbody>{schedLogs.map((l: any) => (
                      <tr key={l.id}>
                        <td style={{ padding: '8px', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>{new Date(l.sent_at).toLocaleString('he-IL')}</td>
                        <td style={{ padding: '8px', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>{l.recipients_count}</td>
                        <td style={{ padding: '8px', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>{l.reads_count}</td>
                        <td style={{ padding: '8px', fontSize: 13, borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{l.recipients_count > 0 ? `${Math.round(l.reads_count / l.recipients_count * 100)}%` : '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            )}

            {/* Scheduled messages list */}
            {schedLoading ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>טוען...</div>
            : schedMsgs.length === 0 ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>אין הודעות קבועות</div>
            : schedMsgs.map(s => {
              const cfg = TYPE_CONFIG[s.type] || TYPE_CONFIG.info
              return (
                <div key={s.id} style={{ ...S.card, opacity: s.is_active ? 1 : 0.6, borderRight: `4px solid ${s.is_active ? cfg.color : '#cbd5e1'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <span style={{ background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, marginLeft: 6 }}>{cfg.emoji} {cfg.label}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{s.title}</span>
                      <span style={{ background: s.is_active ? '#f0fdf4' : '#f1f5f9', color: s.is_active ? '#16a34a' : '#94a3b8', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, marginRight: 8 }}>{s.is_active ? 'פעיל' : 'מושבת'}</span>
                    </div>
                    <button onClick={() => toggleSchedActive(s.id, s.is_active)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {s.is_active ? <ToggleRight size={24} color="#16a34a" /> : <ToggleLeft size={24} color="#94a3b8" />}
                    </button>
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>📅 {describeSchedule(s)}</div>
                  {s.next_send_at && <div style={{ fontSize: 12, color: '#94a3b8' }}>שליחה הבאה: {new Date(s.next_send_at).toLocaleDateString('he-IL')} {s.send_time}</div>}
                  <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                    <button onClick={() => viewSchedLog(s.id)} style={{ ...S.btn, padding: '4px 10px', fontSize: 11, background: '#f1f5f9', color: '#374151' }}>היסטוריה</button>
                    <button onClick={() => { setEditSchedId(s.id); setSchedForm({ title: s.title, body: s.body || '', type: s.type, recipient_type: s.recipient_type || 'all', recipient_id: s.recipient_id || 0, recipient_role: s.recipient_role || '', schedule_type: s.schedule_type, days_of_week: s.days_of_week || [], send_time: s.send_time || '07:00', is_active: s.is_active, specific_date: '', day_of_month: 28, days_before_holiday: 1 }); setShowAddSched(true) }}
                      style={{ ...S.btn, padding: '4px 8px', fontSize: 11, background: '#f1f5f9', color: '#6366f1' }}><Pencil size={12} /></button>
                    <button onClick={() => deleteSched(s.id)} style={{ ...S.btn, padding: '4px 8px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </motion.div>
  )
}
