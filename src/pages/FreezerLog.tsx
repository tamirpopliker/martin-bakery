import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, AlertTriangle, Thermometer, Snowflake, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'

interface Props { onBack: () => void }
type Tab = 'daily' | 'history'

interface Unit {
  id: number
  key: string
  label_he: string
  unit_type: 'fridge' | 'freezer'
  max_c: number
  display_order: number
}

interface Reading {
  id: number
  unit_id: number
  reading_date: string
  temperature_c: number
  notes: string | null
  measured_by_user_id: string | null
  measured_by_name: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthISO = () => todayISO().slice(0, 7)

function isOverSpec(t: number, max: number) {
  return t > max
}

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
}

export default function FreezerLog({ onBack }: Props) {
  const { appUser } = useAppUser()
  const [tab, setTab] = useState<Tab>('daily')
  const [units, setUnits] = useState<Unit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('freezer_units')
      .select('*')
      .eq('active', true)
      .order('display_order', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load freezer units', error)
        setUnits((data || []) as Unit[])
        setUnitsLoading(false)
      })
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl', paddingBottom: 100 }}>
      <PageHeader title="בקרת מקפיאים ומקררים" subtitle="טופס יומי · איכות ובקרה" onBack={onBack} />

      {/* Tabs */}
      <div style={{
        background: 'white', borderBottom: '1px solid #f1f5f9',
        padding: '10px 16px', display: 'flex', gap: 8, justifyContent: 'center',
      }}>
        {(['daily', 'history'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? '#0f172a' : 'transparent',
            color: tab === t ? 'white' : '#475569',
            border: '1px solid ' + (tab === t ? '#0f172a' : '#e2e8f0'),
            borderRadius: 999, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            {t === 'daily' ? 'מילוי יומי' : 'היסטוריה'}
          </button>
        ))}
      </div>

      <div style={{ padding: '16px', maxWidth: '720px', margin: '0 auto' }}>
        {unitsLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
        ) : units.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>אין יחידות מוגדרות</div>
        ) : tab === 'daily' ? (
          <DailyTab units={units} userId={appUser?.id || null} userName={appUser?.name || ''} />
        ) : (
          <HistoryTab units={units} userId={appUser?.id || null} userName={appUser?.name || ''} />
        )}
      </div>
    </div>
  )
}

// ─── Daily Tab ─────────────────────────────────────────────────────────────

interface DraftValue { temp: string; notes: string }

function DailyTab({ units, userId, userName }: { units: Unit[]; userId: string | null; userName: string }) {
  const [date, setDate] = useState(todayISO())
  const [readings, setReadings] = useState<Map<number, Reading>>(new Map())
  const [drafts, setDrafts] = useState<Map<number, DraftValue>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    supabase
      .from('freezer_readings')
      .select('*')
      .eq('reading_date', date)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error(error)
          setError('שגיאה בטעינת המדידות: ' + error.message)
          setReadings(new Map())
          setDrafts(new Map())
        } else {
          const m = new Map<number, Reading>()
          const d = new Map<number, DraftValue>()
          for (const r of (data || []) as Reading[]) {
            m.set(r.unit_id, r)
            d.set(r.unit_id, { temp: String(r.temperature_c), notes: r.notes || '' })
          }
          setReadings(m)
          setDrafts(d)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [date])

  function updateDraft(unitId: number, patch: Partial<DraftValue>) {
    setDrafts(prev => {
      const next = new Map(prev)
      const cur = next.get(unitId) || { temp: '', notes: '' }
      next.set(unitId, { ...cur, ...patch })
      return next
    })
  }

  const hasAnyDraft = useMemo(() => {
    for (const d of drafts.values()) {
      if (d.temp.trim() !== '') return true
    }
    return false
  }, [drafts])

  async function save() {
    if (!userId || !userName) { setError('משתמש לא מזוהה'); return }
    setSaving(true)
    setError('')

    const rows: any[] = []
    for (const unit of units) {
      const d = drafts.get(unit.id)
      if (!d || d.temp.trim() === '') continue
      const n = parseFloat(d.temp.replace(',', '.'))
      if (Number.isNaN(n)) {
        setError(`ערך טמפרטורה לא תקין ליחידה: ${unit.label_he}`)
        setSaving(false)
        return
      }
      rows.push({
        unit_id: unit.id,
        reading_date: date,
        temperature_c: n,
        notes: d.notes.trim() || null,
        measured_by_user_id: userId,
        measured_by_name: userName,
      })
    }

    if (rows.length === 0) {
      setError('לא מולא אף ערך')
      setSaving(false)
      return
    }

    const { data, error } = await supabase
      .from('freezer_readings')
      .upsert(rows, { onConflict: 'unit_id,reading_date' })
      .select('*')

    if (error) {
      console.error(error)
      setError('שמירה נכשלה: ' + error.message)
      setSaving(false)
      return
    }

    const m = new Map(readings)
    for (const r of (data || []) as Reading[]) m.set(r.unit_id, r)
    setReadings(m)
    setSaving(false)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
  }

  return (
    <>
      {/* Date picker */}
      <div style={{
        background: 'white', border: '1px solid #f1f5f9', borderRadius: 12,
        padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>תאריך:</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          max={todayISO()}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: '1px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit',
          }}
        />
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#991b1b', fontSize: 13, padding: '10px 14px', borderRadius: 8, border: '1px solid #fecaca', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>טוען מדידות...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {units.map((unit, idx) => {
            const reading = readings.get(unit.id)
            const draft = drafts.get(unit.id) || { temp: '', notes: '' }
            const tempNum = draft.temp.trim() === '' ? null : parseFloat(draft.temp.replace(',', '.'))
            const filled = tempNum !== null && !Number.isNaN(tempNum)
            const over = filled && isOverSpec(tempNum!, unit.max_c)

            const borderColor = !filled ? '#e2e8f0' : over ? '#fca5a5' : '#86efac'
            const bgAccent    = !filled ? '#f8fafc' : over ? '#fef2f2' : '#f0fdf4'
            const statusBg    = !filled ? '#f1f5f9' : over ? '#fee2e2' : '#dcfce7'
            const statusColor = !filled ? '#94a3b8' : over ? '#991b1b' : '#166534'
            const statusLabel = !filled ? 'לא נמדד' : over ? 'חריגה' : 'תקין'
            const StatusIcon  = !filled ? null : over ? AlertTriangle : CheckCircle2

            return (
              <motion.div
                key={unit.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                style={{
                  background: 'white', border: `2px solid ${borderColor}`, borderRadius: 14,
                  padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
                }}
              >
                {/* Header row — name + inline status badge, subtitle below */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: unit.unit_type === 'fridge' ? '#dbeafe' : '#cffafe',
                    color: unit.unit_type === 'fridge' ? '#1e40af' : '#0e7490',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {unit.unit_type === 'fridge' ? <Thermometer size={18} /> : <Snowflake size={18} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', rowGap: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{unit.label_he}</span>
                      <span style={{
                        background: statusBg, color: statusColor, fontSize: 11, fontWeight: 700,
                        padding: '2px 7px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}>
                        {StatusIcon && <StatusIcon size={11} />}
                        {statusLabel}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                      תקין עד {unit.max_c}°C
                    </div>
                  </div>
                </div>

                {/* Temperature input — °C as inline suffix via absolute positioning */}
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    value={draft.temp}
                    onChange={e => updateDraft(unit.id, { temp: e.target.value })}
                    placeholder={unit.unit_type === 'fridge' ? '4' : '-18'}
                    className="freezer-temp-input"
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '12px 48px 12px 16px', borderRadius: 10,
                      border: '1px solid #e2e8f0', fontSize: 22, fontWeight: 700,
                      textAlign: 'center', fontFamily: 'inherit', color: '#0f172a',
                      background: bgAccent,
                      MozAppearance: 'textfield' as any,
                    }}
                  />
                  <span style={{
                    position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 14, fontWeight: 700, color: '#94a3b8', pointerEvents: 'none',
                  }}>°C</span>
                </div>

                <input
                  type="text"
                  value={draft.notes}
                  onChange={e => updateDraft(unit.id, { notes: e.target.value })}
                  placeholder="הערה (אופציונלי)"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '9px 12px', borderRadius: 8,
                    border: '1px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit',
                    background: 'white',
                  }}
                />

                {reading && (
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    נמדד ע״י {reading.measured_by_name}
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Sticky save button */}
      <div style={{
        position: 'fixed', bottom: 0, right: 0, left: 0,
        background: 'white', borderTop: '1px solid #e2e8f0',
        padding: '12px 16px', boxShadow: '0 -4px 12px rgba(0,0,0,0.05)', zIndex: 50,
        display: 'flex', justifyContent: 'center',
      }}>
        <div style={{ maxWidth: 720, width: '100%', display: 'flex', gap: 10, alignItems: 'center' }}>
          {savedFlash && (
            <span style={{
              background: '#dcfce7', color: '#166534', fontSize: 13, fontWeight: 600,
              padding: '8px 14px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <CheckCircle2 size={14} /> נשמר
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !hasAnyDraft}
            style={{
              flex: 1, background: hasAnyDraft ? '#0ea5e9' : '#cbd5e1',
              color: 'white', border: 'none', borderRadius: 12,
              padding: '14px 20px', fontSize: 15, fontWeight: 700,
              cursor: hasAnyDraft && !saving ? 'pointer' : 'not-allowed',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'שומר...' : 'שמור מדידות'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── History Tab ───────────────────────────────────────────────────────────

function HistoryTab({ units, userId, userName }: { units: Unit[]; userId: string | null; userName: string }) {
  const [month, setMonth] = useState(monthISO())
  const [rows, setRows] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ unit: Unit; date: string; reading: Reading | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const from = month + '-01'
    const [y, m] = month.split('-').map(Number)
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    supabase
      .from('freezer_readings')
      .select('*')
      .gte('reading_date', from)
      .lt('reading_date', nextMonth)
      .order('reading_date', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error(error)
        setRows((data || []) as Reading[])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [month])

  // Group by date for mobile-friendly list view
  const groups = useMemo(() => {
    const byDate = new Map<string, Reading[]>()
    for (const r of rows) {
      if (!byDate.has(r.reading_date)) byDate.set(r.reading_date, [])
      byDate.get(r.reading_date)!.push(r)
    }
    return Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows])

  const overCount = useMemo(() => {
    let n = 0
    const unitsById = new Map(units.map(u => [u.id, u]))
    for (const r of rows) {
      const u = unitsById.get(r.unit_id)
      if (u && isOverSpec(r.temperature_c, u.max_c)) n++
    }
    return n
  }, [rows, units])

  async function reload() {
    const from = month + '-01'
    const [y, m] = month.split('-').map(Number)
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    const { data, error } = await supabase
      .from('freezer_readings')
      .select('*')
      .gte('reading_date', from)
      .lt('reading_date', nextMonth)
      .order('reading_date', { ascending: false })
    if (!error) setRows((data || []) as Reading[])
  }

  const unitsById = useMemo(() => new Map(units.map(u => [u.id, u])), [units])

  return (
    <>
      <div style={{
        background: 'white', border: '1px solid #f1f5f9', borderRadius: 12,
        padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>חודש:</label>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          max={monthISO()}
          style={{
            padding: '8px 12px', borderRadius: 8,
            border: '1px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit',
          }}
        />
        <div style={{ marginRight: 'auto', display: 'flex', gap: 8 }}>
          <span style={{
            background: '#f1f5f9', color: '#0f172a', padding: '6px 12px', borderRadius: 999,
            fontSize: 13, fontWeight: 600,
          }}>סה״כ: {rows.length}</span>
          <span style={{
            background: overCount > 0 ? '#fee2e2' : '#dcfce7',
            color: overCount > 0 ? '#991b1b' : '#166534',
            padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700,
          }}>חריגות: {overCount}</span>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
      ) : groups.length === 0 ? (
        <div style={{ background: 'white', borderRadius: 12, padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
          אין מדידות בחודש זה
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map(([d, items]) => {
            const itemsByUnit = new Map(items.map(r => [r.unit_id, r]))
            const dayOver = items.some(r => {
              const u = unitsById.get(r.unit_id)
              return u && isOverSpec(r.temperature_c, u.max_c)
            })
            return (
              <div key={d} style={{
                background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 14,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #f1f5f9',
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                    {new Date(d + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </div>
                  {dayOver && (
                    <span style={{
                      background: '#fee2e2', color: '#991b1b', fontSize: 11, fontWeight: 700,
                      padding: '3px 8px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <AlertTriangle size={11} /> חריגה
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                  {units.map(u => {
                    const r = itemsByUnit.get(u.id)
                    if (!r) {
                      return (
                        <button key={u.id} onClick={() => setEditing({ unit: u, date: d, reading: null })} style={{
                          background: '#f8fafc', border: '1px dashed #e2e8f0', borderRadius: 8,
                          padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          fontFamily: 'inherit', cursor: 'pointer', textAlign: 'right',
                        }}>
                          <span style={{ fontSize: 12, color: '#64748b' }}>{u.label_he}</span>
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>—</span>
                        </button>
                      )
                    }
                    const over = isOverSpec(r.temperature_c, u.max_c)
                    return (
                      <button key={u.id} onClick={() => setEditing({ unit: u, date: d, reading: r })} style={{
                        background: over ? '#fef2f2' : '#f0fdf4',
                        border: '1px solid ' + (over ? '#fecaca' : '#bbf7d0'),
                        borderRadius: 8, padding: '8px 10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        fontFamily: 'inherit', cursor: 'pointer', textAlign: 'right',
                      }}>
                        <span style={{ fontSize: 12, color: '#475569' }}>{u.label_he}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: over ? '#991b1b' : '#166534' }}>
                          {r.temperature_c}°
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <EditReadingModal
          unit={editing.unit}
          date={editing.date}
          reading={editing.reading}
          userId={userId}
          userName={userName}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload() }}
        />
      )}
    </>
  )
}

function EditReadingModal({
  unit, date, reading, userId, userName, onClose, onSaved,
}: {
  unit: Unit; date: string; reading: Reading | null;
  userId: string | null; userName: string;
  onClose: () => void; onSaved: () => void
}) {
  const [temp, setTemp] = useState(reading ? String(reading.temperature_c) : '')
  const [notes, setNotes] = useState(reading?.notes || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!userId || !userName) { setErr('משתמש לא מזוהה'); return }
    const n = parseFloat(temp.replace(',', '.'))
    if (Number.isNaN(n)) { setErr('ערך טמפרטורה לא תקין'); return }
    setSaving(true)
    setErr('')
    const { error } = await supabase
      .from('freezer_readings')
      .upsert({
        unit_id: unit.id,
        reading_date: date,
        temperature_c: n,
        notes: notes.trim() || null,
        measured_by_user_id: userId,
        measured_by_name: userName,
      }, { onConflict: 'unit_id,reading_date' })
    if (error) {
      console.error(error)
      setErr('שמירה נכשלה: ' + error.message)
      setSaving(false)
      return
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'white', borderRadius: 16, width: '100%', maxWidth: 420,
        direction: 'rtl', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{unit.label_he}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {fmtDate(date)} · תקין עד {unit.max_c}°C
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#94a3b8',
          }}><X size={20} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#475569', minWidth: 80 }}>טמפרטורה:</label>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={temp}
              onChange={e => setTemp(e.target.value)}
              autoFocus
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 10,
                border: '1px solid #e2e8f0', fontSize: 20, fontWeight: 700,
                textAlign: 'center', fontFamily: 'inherit',
              }}
            />
            <span style={{ fontSize: 16, fontWeight: 700, color: '#475569' }}>°C</span>
          </div>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="הערה (אופציונלי)"
            style={{
              padding: '8px 12px', borderRadius: 8,
              border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit',
            }}
          />
          {err && (
            <div style={{ background: '#fef2f2', color: '#991b1b', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid #fecaca' }}>
              {err}
            </div>
          )}
        </div>

        <div style={{
          padding: '12px 20px', borderTop: '1px solid #f1f5f9',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} disabled={saving} style={{
            background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>ביטול</button>
          <button onClick={save} disabled={saving} style={{
            background: '#0ea5e9', color: 'white', border: 'none', borderRadius: 8,
            padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            opacity: saving ? 0.6 : 1,
          }}>{saving ? 'שומר...' : 'שמור'}</button>
        </div>
      </div>
    </div>
  )
}
