import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useBranches } from '../lib/BranchContext'
import {
  ArrowRight, Plus, Save, Bell, Mail, History, AlertTriangle,
  ToggleLeft, ToggleRight, Send, FileText, Users, Power, PowerOff, Check
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// ─── Types ──────────────────────────────────────────────────────────────────
interface ReportLogEntry {
  id: number
  sent_at: string
  report_type: string
  recipient_email: string
  recipient_role: string
  status: string
  error_message: string | null
  report_date: string
}

interface AlertRule {
  id: number; name: string; entity_type: 'branch' | 'factory'; entity_id: string
  metric: string; condition: string; threshold: number; threshold_type: string
  active: boolean; created_at: string
}

interface AlertLogEntry {
  id: number; rule_id: number; triggered_at: string; actual_value: number
  threshold_value: number; email_sent: boolean; recipient_emails: string[]
  rule_name?: string
}

interface UserSub {
  id: string; name: string; email: string; role: string
  report_daily: boolean; report_weekly: boolean; report_monthly: boolean
  reports_enabled: boolean; alerts_enabled: boolean
}

// ─── Constants ──────────────────────────────────────────────────────────────
const REPORT_TYPE_LABELS: Record<string, string> = {
  daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי',
}
const ROLE_LABELS: Record<string, string> = {
  admin: 'אדמין', factory: 'מפעל', branch: 'סניף',
}
const ALERT_METRICS = [
  { value: 'revenue', label: 'הכנסות' }, { value: 'waste', label: 'פחת' },
  { value: 'labor_cost', label: 'עלות לייבור' }, { value: 'production', label: 'ייצור' },
]
const ALERT_CONDITIONS = [{ value: 'below', label: 'מתחת ל-' }, { value: 'above', label: 'מעל ל-' }]
const ALERT_THRESHOLD_TYPES = [{ value: 'absolute', label: 'ערך מוחלט (₪)' }, { value: 'percent', label: 'אחוז (%)' }]
const ALERT_DEPTS = [
  { value: 'creams', label: 'קרמים' }, { value: 'dough', label: 'בצקים' },
  { value: 'packaging', label: 'אריזה' }, { value: 'cleaning', label: 'ניקיון' },
]
const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }
const S = {
  label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', display: 'block', marginBottom: '6px' },
  input: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  select: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit', background: 'white' },
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function ReportsAlerts({ onBack }: { onBack: () => void }) {
  const { branches } = useBranches()
  const [tab, setTab] = useState<'reports' | 'alerts'>('reports')

  // ── Reports state ──
  const [reportLog, setReportLog] = useState<ReportLogEntry[]>([])
  const [reportLoading, setReportLoading] = useState(true)
  const [reportDays, setReportDays] = useState(14)
  const [reportTypeFilter, setReportTypeFilter] = useState<string>('all')
  const [reportSubTab, setReportSubTab] = useState<'log' | 'subscriptions'>('log')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

  // ── Subscription state ──
  const [users, setUsers] = useState<UserSub[]>([])
  const [reportsGlobalEnabled, setReportsGlobalEnabled] = useState(true)
  const [alertsGlobalEnabled, setAlertsGlobalEnabled] = useState(true)

  // ── Alerts state ──
  const [alertRules, setAlertRules] = useState<AlertRule[]>([])
  const [alertLog, setAlertLog] = useState<AlertLogEntry[]>([])
  const [alertSubTab, setAlertSubTab] = useState<'rules' | 'log' | 'subscriptions'>('rules')
  const [alertSheetOpen, setAlertSheetOpen] = useState(false)
  const [alertSaving, setAlertSaving] = useState(false)
  const [alertLogDays, setAlertLogDays] = useState(7)
  const [alertForm, setAlertForm] = useState({
    id: undefined as number | undefined, name: '', entity_type: 'branch' as 'branch' | 'factory',
    entity_id: '', metric: 'revenue', condition: 'below', threshold: '', threshold_type: 'absolute',
  })

  // ── Report functions ──
  async function loadReportLog() {
    setReportLoading(true)
    const since = new Date()
    since.setDate(since.getDate() - reportDays)
    let query = supabase.from('report_log')
      .select('*')
      .gte('sent_at', since.toISOString())
      .order('sent_at', { ascending: false })
      .limit(200)
    if (reportTypeFilter !== 'all') {
      query = query.eq('report_type', reportTypeFilter)
    }
    const { data } = await query
    setReportLog(data || [])
    setReportLoading(false)
  }

  async function triggerReports() {
    setSending(true)
    setSendResult(null)
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL || 'https://nlklndgmtmwoacipjyek.supabase.co'}/functions/v1/send-reports`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        setSendResult('הדוחות נשלחו בהצלחה')
        setTimeout(() => loadReportLog(), 3000)
      } else {
        const err = await res.text()
        setSendResult(`שגיאה: ${err}`)
      }
    } catch (err) {
      setSendResult(`שגיאה: ${String(err)}`)
    }
    setSending(false)
    setTimeout(() => setSendResult(null), 6000)
  }

  useEffect(() => { if (tab === 'reports' && reportSubTab === 'log') loadReportLog() }, [tab, reportSubTab, reportDays, reportTypeFilter])

  // ── Subscription functions ──
  async function loadUsers() {
    const { data } = await supabase.from('app_users')
      .select('id, name, email, role, report_daily, report_weekly, report_monthly, reports_enabled, alerts_enabled')
      .order('name')
    setUsers((data || []).map(u => ({
      ...u,
      report_daily: u.report_daily ?? true,
      report_weekly: u.report_weekly ?? true,
      report_monthly: u.report_monthly ?? true,
      reports_enabled: u.reports_enabled ?? true,
      alerts_enabled: u.alerts_enabled ?? true,
    })))
  }

  async function loadGlobalSettings() {
    const { data } = await supabase.from('system_settings').select('key, value')
    if (data) {
      const rg = data.find(d => d.key === 'reports_global_enabled')
      const ag = data.find(d => d.key === 'alerts_global_enabled')
      if (rg) setReportsGlobalEnabled(rg.value === 'true')
      if (ag) setAlertsGlobalEnabled(ag.value === 'true')
    }
  }

  async function toggleUserField(userId: string, field: string, value: boolean) {
    const { error } = await supabase.from('app_users').update({ [field]: value }).eq('id', userId)
    if (error) {
      console.error('[ReportsAlerts toggleUserField] error:', error)
      alert(`עדכון הגדרת המשתמש נכשל: ${error.message || 'שגיאת מסד נתונים'}.`)
      return
    }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, [field]: value } : u))
  }

  async function toggleGlobalSetting(key: string, value: boolean) {
    const { error } = await supabase.from('system_settings').upsert({ key, value: String(value), updated_at: new Date().toISOString() })
    if (error) {
      console.error('[ReportsAlerts toggleGlobalSetting] error:', error)
      alert(`עדכון הגדרת המערכת נכשל: ${error.message || 'שגיאת מסד נתונים'}.`)
      return
    }
    if (key === 'reports_global_enabled') setReportsGlobalEnabled(value)
    if (key === 'alerts_global_enabled') setAlertsGlobalEnabled(value)
  }

  useEffect(() => {
    if ((tab === 'reports' && reportSubTab === 'subscriptions') || tab === 'alerts') {
      loadUsers()
      loadGlobalSettings()
    }
  }, [tab, reportSubTab])

  // ── Alert functions ──
  async function loadAlertRules() {
    const { data } = await supabase.from('alert_rules').select('*').order('created_at', { ascending: false })
    setAlertRules(data || [])
  }
  async function loadAlertLog() {
    const since = new Date(); since.setDate(since.getDate() - alertLogDays)
    const { data } = await supabase.from('alert_log')
      .select('*, alert_rules(name)')
      .gte('triggered_at', since.toISOString())
      .order('triggered_at', { ascending: false }).limit(100)
    setAlertLog((data || []).map((e: any) => ({ ...e, rule_name: e.alert_rules?.name || `כלל #${e.rule_id}` })))
  }
  useEffect(() => { if (tab === 'alerts') { loadAlertRules(); if (alertSubTab === 'log') loadAlertLog() } }, [tab, alertSubTab, alertLogDays])

  async function handleAlertSave() {
    if (!alertForm.name.trim() || !alertForm.entity_id || !alertForm.threshold) return
    setAlertSaving(true)
    const payload = {
      name: alertForm.name.trim(), entity_type: alertForm.entity_type, entity_id: alertForm.entity_id,
      metric: alertForm.metric, condition: alertForm.condition, threshold: Number(alertForm.threshold),
      threshold_type: alertForm.threshold_type, active: true,
    }
    const { error } = alertForm.id
      ? await supabase.from('alert_rules').update(payload).eq('id', alertForm.id)
      : await supabase.from('alert_rules').insert(payload)
    if (error) {
      console.error('[ReportsAlerts handleAlertSave] error:', error)
      alert(`שמירת כלל ההתרעה נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      setAlertSaving(false)
      return
    }
    setAlertSaving(false); setAlertSheetOpen(false); loadAlertRules()
  }
  async function toggleAlertActive(rule: AlertRule) {
    const { error } = await supabase.from('alert_rules').update({ active: !rule.active }).eq('id', rule.id)
    if (error) {
      console.error('[ReportsAlerts toggleAlertActive] error:', error)
      alert(`שינוי מצב הפעלת ההתרעה נכשל: ${error.message || 'שגיאת מסד נתונים'}.`)
      return
    }
    loadAlertRules()
  }
  function openNewAlert() {
    setAlertForm({ id: undefined, name: '', entity_type: 'branch', entity_id: branches[0]?.id?.toString() || '1', metric: 'revenue', condition: 'below', threshold: '', threshold_type: 'absolute' })
    setAlertSheetOpen(true)
  }
  function openEditAlert(rule: AlertRule) {
    setAlertForm({ id: rule.id, name: rule.name, entity_type: rule.entity_type, entity_id: rule.entity_id, metric: rule.metric, condition: rule.condition, threshold: String(rule.threshold), threshold_type: rule.threshold_type })
    setAlertSheetOpen(true)
  }
  function getAlertEntityLabel(rule: AlertRule): string {
    if (rule.entity_type === 'branch') { const br = branches.find(b => b.id === Number(rule.entity_id)); return br?.name || `סניף ${rule.entity_id}` }
    return ALERT_DEPTS.find(d => d.value === rule.entity_id)?.label || rule.entity_id
  }
  const alertEntityOptions = alertForm.entity_type === 'branch'
    ? branches.map(b => ({ value: String(b.id), label: b.name })) : ALERT_DEPTS

  // ── Render ──
  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} /> חזרה
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '40px', height: '40px', background: '#f59e0b', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Mail size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: 0 }}>דוחות והתראות</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>לוג דוחות · כללי התרעה · שליחה ידנית</p>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'reports' && (
          <button onClick={triggerReports} disabled={sending}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: sending ? '#94a3b8' : '#818cf8', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Send size={16} /> {sending ? 'שולח...' : 'שלח דוח עכשיו'}
          </button>
        )}
        {tab === 'alerts' && alertSubTab === 'rules' && (
          <button onClick={openNewAlert}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Plus size={16} /> הוסף התרעה
          </button>
        )}
      </div>

      <div style={{ padding: '28px 36px', maxWidth: '1100px', margin: '0 auto' }}>

        {/* Send result message */}
        {sendResult && (
          <div style={{
            padding: '12px 20px', borderRadius: '10px', marginBottom: '16px', fontSize: '14px', fontWeight: '600',
            background: sendResult.startsWith('שגיאה') ? '#fef2f2' : '#f0fdf4',
            color: sendResult.startsWith('שגיאה') ? '#dc2626' : '#16a34a',
            border: `1px solid ${sendResult.startsWith('שגיאה') ? '#fecaca' : '#bbf7d0'}`,
          }}>
            {sendResult}
          </div>
        )}

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {[
            { key: 'reports' as const, label: 'דוחות', icon: FileText, count: reportLog.length },
            { key: 'alerts' as const, label: 'התראות', icon: Bell, count: alertRules.length },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px', borderRadius: '12px', fontSize: '14px', fontWeight: '700',
                border: tab === t.key ? '2px solid #818cf8' : '2px solid #e2e8f0',
                background: tab === t.key ? '#eef2ff' : 'white', color: tab === t.key ? '#4f46e5' : '#64748b',
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
              <t.icon size={16} />
              {t.label}
              <span style={{ background: tab === t.key ? '#818cf8' : '#e2e8f0', color: tab === t.key ? 'white' : '#64748b', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '10px' }}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* ═══ REPORTS TAB ═══ */}
        {tab === 'reports' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            {/* Reports sub-tabs */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
              {([
                { key: 'log' as const, label: 'לוג דוחות', icon: FileText },
                { key: 'subscriptions' as const, label: 'ניהול מנויים', icon: Users },
              ]).map(t => (
                <button key={t.key} onClick={() => setReportSubTab(t.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
                    border: reportSubTab === t.key ? '2px solid #818cf8' : '2px solid #e2e8f0',
                    background: reportSubTab === t.key ? '#eef2ff' : 'white', color: reportSubTab === t.key ? '#4f46e5' : '#64748b',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              {/* Global reports toggle */}
              <button onClick={() => toggleGlobalSetting('reports_global_enabled', !reportsGlobalEnabled)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
                  border: 'none',
                  background: reportsGlobalEnabled ? '#f0fdf4' : '#fef2f2',
                  color: reportsGlobalEnabled ? '#16a34a' : '#dc2626',
                }}>
                {reportsGlobalEnabled ? <Power size={14} /> : <PowerOff size={14} />}
                {reportsGlobalEnabled ? 'דוחות פעילים' : 'דוחות מושבתים'}
              </button>
            </div>

            {/* Report log sub-tab */}
            {reportSubTab === 'log' && <>
            {/* Filters */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>תקופה:</span>
                {[7, 14, 30, 60].map(d => (
                  <button key={d} onClick={() => setReportDays(d)}
                    style={{
                      padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                      border: reportDays === d ? '2px solid #818cf8' : '1px solid #e2e8f0',
                      background: reportDays === d ? '#eef2ff' : 'white', color: reportDays === d ? '#4f46e5' : '#64748b',
                    }}>
                    {d} ימים
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>סוג:</span>
                {[
                  { value: 'all', label: 'הכל' },
                  { value: 'daily', label: 'יומי' },
                  { value: 'weekly', label: 'שבועי' },
                  { value: 'monthly', label: 'חודשי' },
                ].map(f => (
                  <button key={f.value} onClick={() => setReportTypeFilter(f.value)}
                    style={{
                      padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                      border: reportTypeFilter === f.value ? '2px solid #818cf8' : '1px solid #e2e8f0',
                      background: reportTypeFilter === f.value ? '#eef2ff' : 'white', color: reportTypeFilter === f.value ? '#4f46e5' : '#64748b',
                    }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '170px 90px 200px 80px 90px 1fr', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                <span>תאריך שליחה</span><span>סוג דוח</span><span>נמען</span><span>תפקיד</span><span>סטטוס</span><span>תאריך דוח</span>
              </div>
              {reportLoading ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>טוען...</div>
              ) : reportLog.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>
                  <Mail size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                  <div>טרם נשלחו דוחות בתקופה הנבחרת</div>
                </div>
              ) : reportLog.map(entry => (
                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '170px 90px 200px 80px 90px 1fr', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' }}>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>
                    {new Date(entry.sent_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
                  </span>
                  <span>
                    <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                      {REPORT_TYPE_LABELS[entry.report_type] || entry.report_type}
                    </span>
                  </span>
                  <span style={{ color: '#374151', direction: 'ltr', textAlign: 'left' as const, fontSize: '12px' }}>{entry.recipient_email}</span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>{ROLE_LABELS[entry.recipient_role] || entry.recipient_role}</span>
                  <span>
                    <span style={{
                      background: entry.status === 'sent' ? '#f0fdf4' : '#fef2f2',
                      color: entry.status === 'sent' ? '#16a34a' : '#dc2626',
                      padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700',
                    }}>
                      {entry.status === 'sent' ? '✓ נשלח' : '✗ נכשל'}
                    </span>
                  </span>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>{entry.report_date}</span>
                </div>
              ))}
            </Card>
            </>}

            {/* Subscriptions sub-tab */}
            {reportSubTab === 'subscriptions' && (
              <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 80px 80px 80px 80px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                  <span>משתמש</span><span>תפקיד</span><span>יומי</span><span>שבועי</span><span>חודשי</span><span>פעיל</span>
                </div>
                {users.length === 0 ? (
                  <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>טוען...</div>
                ) : users.map(u => (
                  <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 80px 80px 80px 80px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px', opacity: u.reports_enabled ? 1 : 0.45 }}>
                    <div>
                      <div style={{ fontWeight: '600', color: '#0f172a' }}>{u.name}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', direction: 'ltr', textAlign: 'left' }}>{u.email}</div>
                    </div>
                    <span style={{ fontSize: '11px' }}>
                      <span style={{ background: u.role === 'admin' ? '#c084fc15' : u.role === 'factory' ? '#818cf815' : '#34d39915', color: u.role === 'admin' ? '#c084fc' : u.role === 'factory' ? '#818cf8' : '#34d399', padding: '2px 8px', borderRadius: '6px', fontWeight: '700' }}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </span>
                    {['report_daily', 'report_weekly', 'report_monthly'].map(field => (
                      <div key={field} style={{ textAlign: 'center' }}>
                        <button onClick={() => toggleUserField(u.id, field, !(u as any)[field])}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>
                          {(u as any)[field]
                            ? <Check size={16} color="#16a34a" />
                            : <span style={{ color: '#e2e8f0' }}>—</span>
                          }
                        </button>
                      </div>
                    ))}
                    <div style={{ textAlign: 'center' }}>
                      <button onClick={() => toggleUserField(u.id, 'reports_enabled', !u.reports_enabled)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        {u.reports_enabled
                          ? <ToggleRight size={20} color="#16a34a" />
                          : <ToggleLeft size={20} color="#dc2626" />
                        }
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </motion.div>
        )}

        {/* ═══ ALERTS TAB ═══ */}
        {tab === 'alerts' && (
          <>
            {/* Sub-tab switcher */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
              {([
                { key: 'rules' as const, label: 'כללי התרעה', icon: AlertTriangle },
                { key: 'log' as const, label: 'לוג התראות', icon: History },
                { key: 'subscriptions' as const, label: 'נמענים', icon: Users },
              ]).map(t => (
                <button key={t.key} onClick={() => setAlertSubTab(t.key as any)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
                    border: alertSubTab === t.key ? '2px solid #f59e0b' : '2px solid #e2e8f0',
                    background: alertSubTab === t.key ? '#fffbeb' : 'white', color: alertSubTab === t.key ? '#b45309' : '#64748b',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button onClick={() => toggleGlobalSetting('alerts_global_enabled', !alertsGlobalEnabled)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
                  border: 'none',
                  background: alertsGlobalEnabled ? '#f0fdf4' : '#fef2f2',
                  color: alertsGlobalEnabled ? '#16a34a' : '#dc2626',
                }}>
                {alertsGlobalEnabled ? <Power size={14} /> : <PowerOff size={14} />}
                {alertsGlobalEnabled ? 'התראות פעילות' : 'התראות מושבתות'}
              </button>
            </div>

            {/* Alert Rules */}
            {alertSubTab === 'rules' && (
              <motion.div variants={fadeIn} initial="hidden" animate="visible">
                <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px 120px 100px 80px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                    <span>שם ההתרעה</span><span>ישות</span><span>מדד</span><span>תנאי</span><span>סף</span><span>סטטוס</span><span>פעולות</span>
                  </div>
                  {alertRules.length === 0 ? (
                    <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>
                      <Bell size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                      <div>אין כללי התרעה. לחץ "הוסף התרעה" כדי להתחיל.</div>
                    </div>
                  ) : alertRules.map(rule => (
                    <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px 120px 100px 80px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px', opacity: rule.active ? 1 : 0.5 }}>
                      <span style={{ fontWeight: '600', color: '#0f172a' }}>{rule.name}</span>
                      <span style={{ color: '#64748b' }}>
                        <span style={{ fontSize: '10px', background: rule.entity_type === 'branch' ? '#dbeafe' : '#f3e8ff', color: rule.entity_type === 'branch' ? '#2563eb' : '#7c3aed', padding: '2px 6px', borderRadius: '4px', fontWeight: '600', marginLeft: '4px' }}>
                          {rule.entity_type === 'branch' ? 'סניף' : 'מפעל'}
                        </span>
                        {' '}{getAlertEntityLabel(rule)}
                      </span>
                      <span style={{ color: '#64748b' }}>{ALERT_METRICS.find(m => m.value === rule.metric)?.label}</span>
                      <span style={{ color: rule.condition === 'above' ? '#ef4444' : '#f59e0b', fontWeight: '600', fontSize: '12px' }}>
                        {ALERT_CONDITIONS.find(c => c.value === rule.condition)?.label}
                      </span>
                      <span style={{ fontWeight: '700', color: '#374151' }}>
                        {rule.threshold_type === 'percent' ? `${rule.threshold}%` : `₪${Number(rule.threshold).toLocaleString()}`}
                      </span>
                      <span>
                        <button onClick={() => toggleAlertActive(rule)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '600', color: rule.active ? '#34d399' : '#94a3b8' }}>
                          {rule.active ? <ToggleRight size={18} color="#34d399" /> : <ToggleLeft size={18} color="#94a3b8" />}
                          {rule.active ? 'פעיל' : 'מושבת'}
                        </button>
                      </span>
                      <button onClick={() => openEditAlert(rule)}
                        style={{ background: '#f1f5f9', color: '#818cf8', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                        ערוך
                      </button>
                    </div>
                  ))}
                </Card>
              </motion.div>
            )}

            {/* Alert Log */}
            {alertSubTab === 'log' && (
              <motion.div variants={fadeIn} initial="hidden" animate="visible">
                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>תקופה:</span>
                  {[7, 14, 30].map(d => (
                    <button key={d} onClick={() => setAlertLogDays(d)}
                      style={{
                        padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                        border: alertLogDays === d ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                        background: alertLogDays === d ? '#fffbeb' : 'white', color: alertLogDays === d ? '#b45309' : '#64748b',
                      }}>
                      {d} ימים
                    </button>
                  ))}
                </div>
                <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px 120px 80px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                    <span>זמן</span><span>התרעה</span><span>ערך בפועל</span><span>סף</span><span>אימייל</span>
                  </div>
                  {alertLog.length === 0 ? (
                    <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>אין התראות בתקופה הנבחרת</div>
                  ) : alertLog.map(entry => (
                    <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px 120px 80px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' }}>
                      <span style={{ color: '#64748b', fontSize: '12px' }}>{new Date(entry.triggered_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</span>
                      <span style={{ fontWeight: '600', color: '#0f172a' }}>{entry.rule_name}</span>
                      <span style={{ fontWeight: '700', color: '#ef4444' }}>₪{Number(entry.actual_value).toLocaleString()}</span>
                      <span style={{ color: '#64748b' }}>₪{Number(entry.threshold_value).toLocaleString()}</span>
                      <span style={{ fontSize: '14px', color: entry.email_sent ? '#34d399' : '#fb7185' }}>{entry.email_sent ? '✓' : '✗'}</span>
                    </div>
                  ))}
                </Card>
              </motion.div>
            )}

            {/* Alert subscriptions */}
            {alertSubTab === 'subscriptions' && (
              <motion.div variants={fadeIn} initial="hidden" animate="visible">
                <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 100px', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                    <span>משתמש</span><span>תפקיד</span><span>מקבל התראות</span>
                  </div>
                  {users.length === 0 ? (
                    <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>טוען...</div>
                  ) : users.map(u => (
                    <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 100px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px', opacity: u.alerts_enabled ? 1 : 0.45 }}>
                      <div>
                        <div style={{ fontWeight: '600', color: '#0f172a' }}>{u.name}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', direction: 'ltr', textAlign: 'left' }}>{u.email}</div>
                      </div>
                      <span style={{ fontSize: '11px' }}>
                        <span style={{ background: u.role === 'admin' ? '#c084fc15' : u.role === 'factory' ? '#818cf815' : '#34d39915', color: u.role === 'admin' ? '#c084fc' : u.role === 'factory' ? '#818cf8' : '#34d399', padding: '2px 8px', borderRadius: '6px', fontWeight: '700' }}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </span>
                      <div style={{ textAlign: 'center' }}>
                        <button onClick={() => toggleUserField(u.id, 'alerts_enabled', !u.alerts_enabled)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                          {u.alerts_enabled
                            ? <ToggleRight size={20} color="#16a34a" />
                            : <ToggleLeft size={20} color="#dc2626" />
                          }
                        </button>
                      </div>
                    </div>
                  ))}
                </Card>
              </motion.div>
            )}

            {/* Alert Sheet (Add/Edit) */}
            <Sheet open={alertSheetOpen} onOpenChange={setAlertSheetOpen}>
              <SheetPortal>
                <SheetBackdrop />
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>{alertForm.id ? 'עריכת התרעה' : 'התרעה חדשה'}</SheetTitle>
                  </SheetHeader>
                  <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <label style={S.label}>שם ההתרעה</label>
                      <input value={alertForm.name} onChange={e => setAlertForm({ ...alertForm, name: e.target.value })}
                        placeholder='למשל: "הכנסות נמוכות — אברהם אבינו"' style={S.input} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div>
                        <label style={S.label}>סוג ישות</label>
                        <select value={alertForm.entity_type} onChange={e => {
                          const et = e.target.value as 'branch' | 'factory'
                          setAlertForm({ ...alertForm, entity_type: et, entity_id: et === 'branch' ? (branches[0]?.id?.toString() || '1') : 'creams' })
                        }} style={S.select}>
                          <option value="branch">סניף</option>
                          <option value="factory">מפעל (מחלקה)</option>
                        </select>
                      </div>
                      <div>
                        <label style={S.label}>{alertForm.entity_type === 'branch' ? 'סניף' : 'מחלקה'}</label>
                        <select value={alertForm.entity_id} onChange={e => setAlertForm({ ...alertForm, entity_id: e.target.value })} style={S.select}>
                          {alertEntityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={S.label}>מדד</label>
                      <select value={alertForm.metric} onChange={e => setAlertForm({ ...alertForm, metric: e.target.value })} style={S.select}>
                        {ALERT_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div>
                        <label style={S.label}>תנאי</label>
                        <select value={alertForm.condition} onChange={e => setAlertForm({ ...alertForm, condition: e.target.value })} style={S.select}>
                          {ALERT_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={S.label}>סוג סף</label>
                        <select value={alertForm.threshold_type} onChange={e => setAlertForm({ ...alertForm, threshold_type: e.target.value })} style={S.select}>
                          {ALERT_THRESHOLD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={S.label}>ערך סף</label>
                      <input type="number" value={alertForm.threshold} onChange={e => setAlertForm({ ...alertForm, threshold: e.target.value })}
                        placeholder={alertForm.threshold_type === 'percent' ? '25' : '5000'}
                        style={{ ...S.input, textAlign: 'left' as const }} />
                    </div>
                    <button onClick={handleAlertSave}
                      disabled={alertSaving || !alertForm.name.trim() || !alertForm.threshold}
                      style={{
                        background: alertSaving || !alertForm.name.trim() || !alertForm.threshold ? '#e2e8f0' : '#f59e0b',
                        color: alertSaving || !alertForm.name.trim() || !alertForm.threshold ? '#94a3b8' : 'white',
                        border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      }}>
                      <Save size={16} /> {alertSaving ? 'שומר...' : alertForm.id ? 'עדכן התרעה' : 'הוסף התרעה'}
                    </button>
                  </div>
                </SheetContent>
              </SheetPortal>
            </Sheet>
          </>
        )}
      </div>
    </div>
  )
}
