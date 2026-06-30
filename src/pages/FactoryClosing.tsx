// ═══════════════════════════════════════════════════════════════════════════
// FactoryClosing — daily factory closing checklist (טופס סגירת מפעל יומי)
// ═══════════════════════════════════════════════════════════════════════════
// ~60 binary items grouped by room, plus 7 temperature fields that read/write
// directly to freezer_readings (no duplication with FreezerLog — same table,
// same unique constraint on (unit_id, reading_date)).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Save, History } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'

interface Props { onBack: () => void }

interface ChecklistItem {
  id: string
  label: string
  unitKey?: string  // freezer_units.key — when present this row also has a temp input
}
interface ChecklistSection {
  id: string
  title: string
  items: ChecklistItem[]
}

// ─── Checklist content (from "דף סגירת מפעל יומי" PDF) ───────────────────
const CHECKLIST_SECTIONS: ChecklistSection[] = [
  { id: 'baking', title: 'איזור אפייה', items: [
    { id: 'ovens_off',        label: 'תנורים כבויים' },
    { id: 'proofers_off',     label: 'תאי התפחה כבויים' },
    { id: 'baking_tables',    label: 'שולחן אפיה נקיים' },
    { id: 'boxes_closed',     label: 'קופסאות סגורות' },
    { id: 'hood_closed',      label: 'מנדף סגור' },
  ]},
  { id: 'dough_room', title: 'חדר בצקים ומעבר לאפייה', items: [
    { id: 'fridges_closed',   label: 'מקרר בתהליך בצקים סגור', unitKey: 'fridge_dough_wip' },
    { id: 'freezer_closed',   label: 'מקפיא בתהליך בצקים סגור', unitKey: 'freezer_dough_wip' },
    { id: 'tables_clean',     label: 'שולחנות ופסי ייצור נקיים' },
    { id: 'raw_evacuated',    label: 'פינוי חומרי גלם למחסן או למקרר' },
    { id: 'showcase_empty',   label: 'שוק פריז סגור וריק' },
    { id: 'dough_in_fridge',  label: 'בצקים ושאר חומרי גלם במקרר' },
    { id: 'floor_clean',      label: 'רצפה נקייה' },
    { id: 'proofer_clean',    label: 'אקווריום התפחה נקי וריק / ניקיון מכדררת' },
    { id: 'rollers_clean',    label: 'מרדדות נקיות / קמח למקרר' },
  ]},
  { id: 'creams_room', title: 'חדר קרמים', items: [
    { id: 'fridge_closed',    label: 'מקרר בתהליך קרמים סגור', unitKey: 'fridge_creams_wip' },
    { id: 'freezer_closed',   label: 'מקפיא בתהליך קרמים סגור', unitKey: 'freezer_creams_wip' },
    { id: 'tables_clean',     label: 'שולחנות נקיים' },
    { id: 'raw_evacuated',    label: 'פינוי חומרי גלם למחסן או למקרר' },
    { id: 'showcase_empty',   label: 'שוק פריז סגור וריק' },
    { id: 'tortes_in_fridge', label: 'טורטים ושאר חומרי גלם במקרר' },
    { id: 'floor_clean',      label: 'רצפה נקייה' },
    { id: 'mixers_clean',     label: 'מיקסרים נקיים' },
    { id: 'icing_clean',      label: 'מכונת זילוף נקייה' },
    { id: 'sink_clean',       label: 'כיור נקי + סכינים שטופים חלבי / פרווה' },
  ]},
  { id: 'raw_fridge', title: 'מקרר חומרי גלם', items: [
    { id: 'fridge_closed',    label: 'מקרר חומרי גלם סגור', unitKey: 'fridge_raw' },
    { id: 'floor_clean',      label: 'רצפה נקייה' },
    { id: 'raw_by_date',      label: 'חומרי גלם מסודרים לפי תאריך' },
  ]},
  { id: 'raw_storage', title: 'מחסן חומרי גלם', items: [
    { id: 'raw_on_shelves',   label: 'חומרי גלם על המדפים' },
    { id: 'floor_clean',      label: 'רצפה נקייה' },
  ]},
  { id: 'packaging', title: 'מתחם אריזה והוצאת סחורה', items: [
    { id: 'freezer_creams_closed', label: 'מקפיא תוצ״ג קרמים סגור', unitKey: 'freezer_creams_fg' },
    { id: 'freezer_dough_closed',  label: 'מקפיא תוצ״ג בצקים סגור',  unitKey: 'freezer_dough_fg' },
    { id: 'surfaces_clean',   label: 'משטחי אריזה נקיים' },
    { id: 'cartons_back',     label: 'חומרי אריזה וקרטונים חזרה למקום' },
    { id: 'floor_clean',      label: 'ריצפת אריזה והוצאת סחורה פנויה ונקייה' },
    { id: 'scale_loaded',     label: 'הטענת משקל' },
  ]},
  { id: 'wash_room', title: 'חדר שטיפה חלבי / פרווה', items: [
    { id: 'dishwasher_clean', label: 'מדיח נקי וסגור' },
    { id: 'floor_dry',        label: 'ריצפה נקייה ויבשה' },
    { id: 'tools_soaking',    label: 'במידה ויש כלים — להניח בפיילה בסבון' },
    { id: 'tools_dry',        label: 'כלים / מגשים יבשים להחזיר למקומם' },
  ]},
  { id: 'small_knead', title: 'חדר לישה קטן', items: [
    { id: 'raw_sealed',       label: 'חומרי גלם סגורים / חומרי גלם בקופסאות' },
    { id: 'cartons_storage',  label: 'קרטונים + אריזות במדפים או במחסן קרטון' },
    { id: 'mixer_clean',      label: 'מלוש נקי' },
    { id: 'surface_clean',    label: 'משטח עבודה נקי' },
    { id: 'floor_clean',      label: 'רצפה נקייה' },
  ]},
  { id: 'kneading_room', title: 'חדר מלושים', items: [
    { id: 'raw_shelf',        label: 'מדף חומרי גלם מסודר ונקי' },
    { id: 'mixers_clean',     label: 'מלושים נקיים' },
    { id: 'floor_clean',      label: 'ריצפה נקייה' },
    { id: 'scales_ice_clean', label: 'משקלים ומכונת קרח נקיים' },
  ]},
  { id: 'restrooms_daily', title: 'שירותים — יומי', items: [
    { id: 'toilets_clean',    label: 'ניקיון אסלות עם אקונומיקה' },
    { id: 'floor_clean',      label: 'רצפה נקייה' },
    { id: 'bins_paper',       label: 'ריקון פחים / בדיקת נייר טאולט' },
    { id: 'sink_mirror',      label: 'ניקוי כיור + מראה' },
  ]},
  { id: 'gas_stairs', title: 'חדר גז וחדר מדרגות', items: [
    { id: 'gas_off',          label: 'גז סגור ונקי' },
    { id: 'floor_clean',      label: 'רצפה נקייה' },
    { id: 'raw_evacuated',    label: 'פינו חומרי גלם' },
    { id: 'walls_clean',      label: 'קירות נקיים' },
  ]},
  { id: 'kitchenette', title: 'מטבחון / חדר אוכל / שירותים / גג', items: [
    { id: 'sink_counter',     label: 'כיור ומשטח שיש וארונות נקי' },
    { id: 'table_clean',      label: 'שולחן אוכל נקי ללא שאריות' },
    { id: 'bin_clean',        label: 'פח זבל נקי' },
    { id: 'floor_clean',      label: 'ריצפה נקייה' },
    { id: 'restroom_clean',   label: 'שירותים נקיים' },
    { id: 'roof_door_locked', label: 'דלת יציאה לגג נעולה / קומפרסור כבוי' },
  ]},
  { id: 'pallets_room', title: 'חדר משטחים', items: [
    { id: 'organized',        label: 'חדר משטחים מסודר' },
  ]},
  { id: 'outside', title: 'משטח חוץ', items: [
    { id: 'carts_in_place',   label: 'עגלות פלסטיקים ולולים למקום' },
    { id: 'no_garbage',       label: 'משטח חוץ נקי ללא אשפה' },
    { id: 'smoking_clean',    label: 'פינת עישון נקייה' },
  ]},
  { id: 'final_lockup', title: 'סגירה כללית', items: [
    { id: 'employee_door',    label: 'סגירת תריס כניסת עובדים' },
    { id: 'main_door_code',   label: 'הפעל קודן + נעילת דלת כניסה' },
    { id: 'ac_lights_off',    label: 'סגירת מפסק מיזוג מרכזי + תאורה' },
    { id: 'main_gate',        label: 'סגירת דלת כניסה חיצונית + שער חשמלי' },
  ]},
]

interface FreezerUnit {
  id: number
  key: string
  label_he: string
  unit_type: 'fridge' | 'freezer'
  max_c: number
}
interface FreezerReading {
  unit_id: number
  reading_date: string
  temperature_c: number
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const itemKey = (sectionId: string, itemId: string) => `${sectionId}__${itemId}`

export default function FactoryClosing({ onBack }: Props) {
  const { appUser } = useAppUser()
  const [closingDate, setClosingDate] = useState(todayISO())
  const [units, setUnits] = useState<FreezerUnit[]>([])
  const [items, setItems] = useState<Record<string, boolean>>({})
  const [temps, setTemps] = useState<Record<string, string>>({})   // keyed by unit.key
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<Array<{ closing_date: string; signed_by_name: string; checked: number; total: number }>>([])

  const allItemKeys = useMemo(
    () => CHECKLIST_SECTIONS.flatMap(s => s.items.map(it => itemKey(s.id, it.id))),
    []
  )
  const checkedCount = useMemo(() => allItemKeys.filter(k => items[k]).length, [items, allItemKeys])
  const totalCount = allItemKeys.length

  // Load freezer units once
  useEffect(() => {
    supabase.from('freezer_units')
      .select('id, key, label_he, unit_type, max_c')
      .eq('active', true)
      .order('display_order')
      .then(({ data }) => setUnits((data || []) as FreezerUnit[]))
  }, [])

  // Load existing closing + freezer readings for the selected date
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('factory_closing_checklists')
        .select('checklist_data, notes, signed_by_name')
        .eq('closing_date', closingDate)
        .maybeSingle(),
      supabase.from('freezer_readings')
        .select('unit_id, temperature_c')
        .eq('reading_date', closingDate),
    ]).then(([closingRes, readingsRes]) => {
      if (cancelled) return
      const closing: any = closingRes.data
      const itemsMap: Record<string, boolean> = {}
      if (closing?.checklist_data?.items) {
        for (const [k, v] of Object.entries(closing.checklist_data.items)) {
          itemsMap[k] = Boolean(v)
        }
      }
      setItems(itemsMap)
      setNotes(closing?.notes || '')

      const tempsMap: Record<string, string> = {}
      for (const r of (readingsRes.data || []) as FreezerReading[]) {
        const u = units.find(u => u.id === r.unit_id)
        if (u) tempsMap[u.key] = String(r.temperature_c)
      }
      setTemps(tempsMap)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [closingDate, units])

  // Load history list (last 30 closings)
  useEffect(() => {
    supabase.from('factory_closing_checklists')
      .select('closing_date, signed_by_name, checklist_data')
      .order('closing_date', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        const rows = (data || []).map((r: any) => {
          const m: Record<string, boolean> = r.checklist_data?.items || {}
          const checked = Object.values(m).filter(Boolean).length
          return { closing_date: r.closing_date, signed_by_name: r.signed_by_name, checked, total: totalCount }
        })
        setHistory(rows)
      })
  }, [savedFlash, totalCount])

  function toggleItem(k: string) {
    setItems(prev => ({ ...prev, [k]: !prev[k] }))
  }
  function setTemp(unitKey: string, value: string) {
    setTemps(prev => ({ ...prev, [unitKey]: value }))
  }
  function flipTempSign(unitKey: string) {
    setTemps(prev => {
      const v = (prev[unitKey] || '').trim()
      const next = !v ? '-' : v === '-' ? '' : v.startsWith('-') ? v.slice(1) : '-' + v
      return { ...prev, [unitKey]: next }
    })
  }

  async function save() {
    if (!appUser) { setError('משתמש לא מזוהה'); return }
    setSaving(true)
    setError('')

    // 1. Upsert the checklist row
    const checklistPayload = {
      closing_date: closingDate,
      signed_by_user_id: appUser.id,
      signed_by_name: appUser.name,
      checklist_data: { items },
      notes: notes.trim() || null,
    }
    const { error: cErr } = await supabase
      .from('factory_closing_checklists')
      .upsert(checklistPayload, { onConflict: 'closing_date' })
    if (cErr) {
      console.error(cErr)
      setError('שמירת הצ׳ק-ליסט נכשלה: ' + cErr.message)
      setSaving(false)
      return
    }

    // 2. Upsert temperature readings for units that have a value
    const tempRows: any[] = []
    for (const unit of units) {
      const v = (temps[unit.key] || '').trim()
      if (v === '' || v === '-') continue
      const n = parseFloat(v.replace(',', '.'))
      if (Number.isNaN(n)) {
        setError(`ערך טמפרטורה לא תקין: ${unit.label_he}`)
        setSaving(false)
        return
      }
      tempRows.push({
        unit_id: unit.id,
        reading_date: closingDate,
        temperature_c: n,
        measured_by_user_id: appUser.id,
        measured_by_name: appUser.name,
      })
    }
    if (tempRows.length > 0) {
      const { error: tErr } = await supabase
        .from('freezer_readings')
        .upsert(tempRows, { onConflict: 'unit_id,reading_date' })
      if (tErr) {
        console.error(tErr)
        setError('שמירת הטמפרטורות נכשלה: ' + tErr.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2500)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl', paddingBottom: 100 }}>
      <PageHeader title="סגירת מפעל יומי" subtitle="צ׳ק-ליסט סגירה + טמפרטורות מקררים ומקפיאים" onBack={onBack} />

      <div style={{ padding: '16px', maxWidth: 900, margin: '0 auto' }}>
        {/* Top bar: date + counter */}
        <div style={{
          background: 'white', borderRadius: 12, border: '1px solid #f1f5f9',
          padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>תאריך סגירה:</label>
          <input
            type="date"
            value={closingDate}
            onChange={e => setClosingDate(e.target.value)}
            max={todayISO()}
            style={{
              padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
              fontSize: 14, fontFamily: 'inherit',
            }}
          />
          <span style={{
            marginRight: 'auto', background: checkedCount === totalCount ? '#dcfce7' : '#f1f5f9',
            color: checkedCount === totalCount ? '#166534' : '#475569',
            fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999,
          }}>
            {checkedCount} / {totalCount} סומנו
          </span>
          {appUser && (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>חתם: {appUser.name}</span>
          )}
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#991b1b', fontSize: 13, padding: '10px 14px', borderRadius: 8, border: '1px solid #fecaca', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ background: 'white', borderRadius: 12, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {CHECKLIST_SECTIONS.map((section, sIdx) => {
              const sectionCheckedCount = section.items.filter(it => items[itemKey(section.id, it.id)]).length
              return (
                <motion.div
                  key={section.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: sIdx * 0.02 }}
                  style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 14 }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #f1f5f9',
                  }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{section.title}</div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{sectionCheckedCount}/{section.items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {section.items.map(item => {
                      const k = itemKey(section.id, item.id)
                      const checked = !!items[k]
                      const unit = item.unitKey ? units.find(u => u.key === item.unitKey) : null
                      return (
                        <div key={item.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 6px', borderRadius: 8,
                          background: checked ? '#f0fdf4' : 'transparent',
                          transition: 'background 0.15s',
                        }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer', minHeight: 32 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleItem(k)}
                              style={{
                                width: 22, height: 22, accentColor: '#10b981', cursor: 'pointer',
                                flexShrink: 0,
                              }}
                            />
                            <span style={{
                              fontSize: 14, color: checked ? '#166534' : '#0f172a',
                              fontWeight: checked ? 600 : 500, textDecoration: checked ? 'none' : 'none',
                            }}>{item.label}</span>
                          </label>
                          {unit && (
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <input
                                type="number"
                                step="0.1"
                                inputMode="decimal"
                                value={temps[unit.key] || ''}
                                onChange={e => setTemp(unit.key, e.target.value)}
                                placeholder={unit.unit_type === 'fridge' ? '4' : '-18'}
                                style={{
                                  width: 110, padding: '8px 40px 8px 10px', borderRadius: 8,
                                  border: '1px solid #e2e8f0', fontSize: 15, fontWeight: 700,
                                  textAlign: 'center', fontFamily: 'inherit', color: '#0f172a',
                                  MozAppearance: 'textfield' as any,
                                  background: 'white',
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => flipTempSign(unit.key)}
                                aria-label="הפוך סימן"
                                style={{
                                  position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
                                  width: 30, height: 26, borderRadius: 6,
                                  border: '1px solid #e2e8f0', background: '#f8fafc',
                                  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 14,
                                  color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  padding: 0,
                                }}
                              >{(temps[unit.key] || '').trim().startsWith('-') ? '+' : '−'}</button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </motion.div>
              )
            })}

            {/* Notes */}
            <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 8 }}>הערות סגירה</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="אופציונלי — חריגים, תקלות, מה דורש מעקב..."
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                  borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* History */}
            {history.length > 0 && (
              <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <History size={16} color="#64748b" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>סגירות אחרונות</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {history.map(h => (
                    <button
                      key={h.closing_date}
                      onClick={() => setClosingDate(h.closing_date)}
                      style={{
                        background: h.closing_date === closingDate ? '#eef2ff' : 'transparent',
                        border: '1px solid ' + (h.closing_date === closingDate ? '#c7d2fe' : 'transparent'),
                        padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                      }}
                    >
                      <span style={{ fontSize: 13, color: '#475569' }}>
                        {new Date(h.closing_date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{h.signed_by_name}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: h.checked === h.total ? '#166534' : '#92400e',
                      }}>
                        {h.checked}/{h.total}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky save */}
      <div style={{
        position: 'fixed', bottom: 0, right: 0, left: 0,
        background: 'white', borderTop: '1px solid #e2e8f0',
        padding: '12px 16px', boxShadow: '0 -4px 12px rgba(0,0,0,0.05)', zIndex: 50,
        display: 'flex', justifyContent: 'center',
      }}>
        <div style={{ maxWidth: 900, width: '100%', display: 'flex', gap: 10, alignItems: 'center' }}>
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
            disabled={saving || loading}
            style={{
              flex: 1, background: '#0f766e', color: 'white', border: 'none', borderRadius: 12,
              padding: '14px 20px', fontSize: 15, fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Save size={16} /> {saving ? 'שומר...' : 'שמור סגירה'}
          </button>
        </div>
      </div>
    </div>
  )
}
