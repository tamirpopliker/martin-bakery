import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight, Plus, Pencil, Trash2, Users, Upload, CheckCircle, AlertTriangle, FileText, X } from 'lucide-react'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface ParsedRow {
  name: string
  hours_100: number
  cost_100: number
  hours_125: number
  cost_125: number
  hours_150: number
  cost_150: number
  total_hours: number
  gross_salary: number
  employer_cost: number
  selected: boolean
}

interface Entry {
  id: number
  date: string
  employee_name: string
  hours: number
  gross_salary: number
  employer_cost: number
  notes: string | null
}

const EMPLOYER_FACTOR = 1.3
const LABOR_TARGET_PCT = 28

// ─── פרסור PDF מ-CashOnTab ────────────────────────────────────────────────────
// מבנה: שורה ראשונה = שם + ימים + שעות כולל, שורה שנייה = "שעות X X X ..."
// הטקסט מגיע הפוך (RTL) — צריך לבנות parser שמזהה עובדים לפי pattern
function parseCashOnTabText(text: string): { rows: ParsedRow[]; date: string } {
  const rows: ParsedRow[] = []
  let reportDate = new Date().toISOString().split('T')[0]

  // נחלץ תאריך מהכותרת — "02/03/26"
  const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{2})/)
  if (dateMatch) {
    const [, d, m, y] = dateMatch
    reportDate = `20${y}-${m}-${d}`
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // מחפש שורות עובד: מכיל מספר שם וארסה
  // Pattern: שם בעברית + מספרים (שעות/כסף)
  // הטקסט הפוך: כל שורה עובד מופיעה עם "שעות" ו"כספי" בשורות נפרדות

  // נמצא שורות שמכילות "שעות" ואחריהן מספרים
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // שורת שעות: "שעות X X X X X X total"
    if (line.includes('שעות') && !line.includes('ממוצע') && !line.includes('סה"כ')) {
      const nums = line.replace('שעות', '').trim().split(/\s+/).map(n => parseFloat(n.replace(',', '')) || 0)
      // nums: [h100, h125, h150, h200, h_shabbat, total]
      if (nums.length >= 6) {
        const [h100, h125, h150, , , total_hours] = nums

        // שורת כספי אחריה
        const nextLine = lines[i + 1] || ''
        const costs = nextLine.replace('כספי', '').trim().split(/\s+/).map(n => parseFloat(n.replace(',', '')) || 0)
        // costs: [c100, c125, c150, c200, c_shabbat, gross]
        const [c100, c125, c150, , , gross_salary] = costs

        // שם עובד — בשורה לפני שורת השעות
        // מחפש שורה קודמת עם שם עברי
        let name = ''
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          const prev = lines[j]
          // שם עברי: מכיל אותיות עברית לפחות 2 מילים
          if (/[\u05D0-\u05EA]{2,}/.test(prev) && !prev.includes('שעות') && !prev.includes('כספי') && !prev.includes('דו"ח')) {
            // חלץ רק את השם — מסנן מספרים וטקסט לא רלוונטי
            const hebrewWords = prev.match(/[\u05D0-\u05EA]+/g)
            if (hebrewWords && hebrewWords.length >= 1) {
              name = hebrewWords.join(' ')
              break
            }
          }
        }

        if (name && total_hours > 0 && gross_salary > 0) {
          rows.push({
            name,
            hours_100: h100, cost_100: c100,
            hours_125: h125, cost_125: c125,
            hours_150: h150, cost_150: c150,
            total_hours,
            gross_salary,
            employer_cost: parseFloat((gross_salary * EMPLOYER_FACTOR).toFixed(2)),
            selected: true
          })
        }
      }
    }
    i++
  }

  return { rows, date: reportDate }
}

export default function BranchLaborUpload({ branchId, branchName, branchColor, onBack }: Props) {
  const [entries, setEntries]           = useState<Entry[]>([])
  const [monthFilter, setMonthFilter]   = useState(new Date().toISOString().slice(0, 7))
  const [editId, setEditId]             = useState<number | null>(null)
  const [editData, setEditData]         = useState<Partial<Entry>>({})
  const [loading, setLoading]           = useState(false)
  const [monthRevenue, setMonthRevenue] = useState(0)
  const [tab, setTab]                   = useState<'upload' | 'manual' | 'history'>('upload')

  // העלאת PDF
  const [parsedRows, setParsedRows]   = useState<ParsedRow[]>([])
  const [uploadDate, setUploadDate]   = useState(new Date().toISOString().split('T')[0])
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'parsing' | 'done' | 'error'>('idle')
  const [uploadMsg, setUploadMsg]     = useState('')

  // הזנה ידנית
  const [manDate, setManDate]         = useState(new Date().toISOString().split('T')[0])
  const [manName, setManName]         = useState('')
  const [manHours, setManHours]       = useState('')
  const [manGross, setManGross]       = useState('')
  const [manNotes, setManNotes]       = useState('')

  async function fetchEntries() {
    const { data } = await supabase.from('branch_labor').select('*')
      .eq('branch_id', branchId)
      .gte('date', monthFilter + '-01').lte('date', monthFilter + '-31')
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  async function fetchRevenue() {
    const { data } = await supabase.from('branch_revenue').select('amount')
      .eq('branch_id', branchId)
      .gte('date', monthFilter + '-01').lte('date', monthFilter + '-31')
    if (data) setMonthRevenue(data.reduce((s: number, r: any) => s + Number(r.amount), 0))
  }

  useEffect(() => { fetchEntries(); fetchRevenue() }, [monthFilter, branchId])

  // ─── פרסור קובץ ─────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    if (!file) return
    setUploadStatus('parsing')
    setUploadMsg('מפענח קובץ...')
    setParsedRows([])

    try {
      // שולחים ל-API של Anthropic לפרסור טקסט — משתמשים ב-FileReader
      const buffer = await file.arrayBuffer()
      const bytes  = new Uint8Array(buffer)
      const base64 = btoa(String.fromCharCode(...bytes))

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 }
              },
              {
                type: 'text',
                text: `זהו דוח שעות CashOnTab בעברית. חלץ את רשימת העובדים.
                
עבור כל עובד תחזיר JSON בדיוק כך (מערך):
[
  {
    "name": "שם עובד",
    "hours_100": מספר,
    "cost_100": מספר,
    "hours_125": מספר,
    "cost_125": מספר,
    "hours_150": מספר,
    "cost_150": מספר,
    "total_hours": מספר,
    "gross_salary": מספר
  }
]

החזר JSON בלבד ללא שום טקסט נוסף.`
              }
            ]
          }]
        })
      })

      const data = await response.json()
      const text = data.content?.map((c: any) => c.text || '').join('') || ''

      // נקה backticks
      const clean = text.replace(/```json|```/g, '').trim()
      const parsed: any[] = JSON.parse(clean)

      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('לא זוהו עובדים')

      const rows: ParsedRow[] = parsed.map(r => ({
        name:         r.name || '',
        hours_100:    Number(r.hours_100) || 0,
        cost_100:     Number(r.cost_100)  || 0,
        hours_125:    Number(r.hours_125) || 0,
        cost_125:     Number(r.cost_125)  || 0,
        hours_150:    Number(r.hours_150) || 0,
        cost_150:     Number(r.cost_150)  || 0,
        total_hours:  Number(r.total_hours)  || 0,
        gross_salary: Number(r.gross_salary) || 0,
        employer_cost: parseFloat((Number(r.gross_salary) * EMPLOYER_FACTOR).toFixed(2)),
        selected: true
      }))

      setParsedRows(rows)
      setUploadStatus('done')
      setUploadMsg(`זוהו ${rows.length} עובדים בהצלחה`)

    } catch (err: any) {
      setUploadStatus('error')
      setUploadMsg('שגיאה בפרסור: ' + (err.message || 'נסה שוב'))
    }
  }

  // ─── שמירת שורות ────────────────────────────────────────────────────────
  async function saveSelected() {
    const toSave = parsedRows.filter(r => r.selected && r.gross_salary > 0)
    if (!toSave.length) return
    setLoading(true)
    for (const r of toSave) {
      await supabase.from('branch_labor').insert({
        branch_id: branchId,
        date: uploadDate,
        employee_name: r.name,
        hours: r.total_hours,
        gross_salary: r.gross_salary,
        employer_cost: r.employer_cost,
        notes: `100%: ${r.hours_100}ש׳ | 125%: ${r.hours_125}ש׳ | 150%: ${r.hours_150}ש׳`
      })
    }
    setParsedRows([])
    setUploadStatus('idle')
    setUploadMsg('')
    await fetchEntries()
    setTab('history')
    setLoading(false)
  }

  // ─── הזנה ידנית ─────────────────────────────────────────────────────────
  async function addManual() {
    if (!manName || !manGross) return
    setLoading(true)
    const gross = parseFloat(manGross)
    await supabase.from('branch_labor').insert({
      branch_id: branchId, date: manDate,
      employee_name: manName,
      hours: parseFloat(manHours) || 0,
      gross_salary: gross,
      employer_cost: parseFloat((gross * EMPLOYER_FACTOR).toFixed(2)),
      notes: manNotes || null
    })
    setManName(''); setManHours(''); setManGross(''); setManNotes('')
    await fetchEntries()
    setLoading(false)
  }

  async function deleteEntry(id: number) {
    if (!confirm('למחוק?')) return
    await supabase.from('branch_labor').delete().eq('id', id)
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    const upd = { ...editData, employer_cost: parseFloat((Number(editData.gross_salary || 0) * EMPLOYER_FACTOR).toFixed(2)) }
    await supabase.from('branch_labor').update(upd).eq('id', id)
    setEditId(null); await fetchEntries()
  }

  // חישובים
  const totalGross    = entries.reduce((s, e) => s + Number(e.gross_salary), 0)
  const totalEmployer = entries.reduce((s, e) => s + Number(e.employer_cost), 0)
  const totalHours    = entries.reduce((s, e) => s + Number(e.hours), 0)
  const laborPct      = monthRevenue > 0 ? (totalEmployer / monthRevenue) * 100 : 0
  const kpiOk         = laborPct <= LABOR_TARGET_PCT

  const parsedTotal = parsedRows.filter(r => r.selected).reduce((s, r) => s + r.gross_salary, 0)
  const parsedEmployerTotal = parsedRows.filter(r => r.selected).reduce((s, r) => s + r.employer_cost, 0)

  const S = {
    page:  { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' as const },
    card:  { background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div style={S.page}>

      {/* כותרת */}
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' as const }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
          <ArrowRight size={20} color="#64748b" />
        </button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Users size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>לייבור — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>העלאת CashOnTab · הזנה ידנית · עלות מעסיק ×1.3</p>
        </div>

        <div style={{ marginRight: 'auto', display: 'flex', gap: '10px' }}>
          <div style={{ background: kpiOk ? '#f0fdf4' : '#fef2f2', border: `1px solid ${kpiOk ? '#bbf7d0' : '#fecaca'}`, borderRadius: '10px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {kpiOk ? <CheckCircle size={16} color="#10b981" /> : <AlertTriangle size={16} color="#ef4444" />}
            <div>
              <div style={{ fontSize: '15px', fontWeight: '800', color: kpiOk ? '#10b981' : '#ef4444' }}>{laborPct.toFixed(1)}%</div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>לייבור/הכנסות · יעד {LABOR_TARGET_PCT}%</div>
            </div>
          </div>
          <div style={{ background: branchColor + '15', border: `1px solid ${branchColor}33`, borderRadius: '10px', padding: '8px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '800', color: branchColor }}>₪{Math.round(totalEmployer).toLocaleString()}</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>עלות מעסיק</div>
          </div>
        </div>
      </div>

      {/* טאבים */}
      <div style={{ display: 'flex', padding: '0 32px', background: 'white', borderBottom: '1px solid #e2e8f0' }}>
        {([
          ['upload',  '📄 העלאת דוח CashOnTab'],
          ['manual',  '✏️ הזנה ידנית'],
          ['history', '📋 היסטוריה'],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '13px 20px', background: 'none', border: 'none', borderBottom: tab === key ? `3px solid ${branchColor}` : '3px solid transparent', cursor: 'pointer', fontSize: '14px', fontWeight: tab === key ? '700' : '500', color: tab === key ? branchColor : '#64748b' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: '24px 32px', maxWidth: '1000px', margin: '0 auto' }}>

        {/* ══ העלאת PDF ══════════════════════════════════════════════════ */}
        {tab === 'upload' && (
          <>
            <div style={{ ...S.card, marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>העלאת דוח שעות CashOnTab</h2>
              <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#94a3b8' }}>PDF מאוטוסופט — מזהה עובדים, שעות ועלות אוטומטית</p>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>תאריך לשמירה</label>
                  <input type="date" value={uploadDate} onChange={e => setUploadDate(e.target.value)} style={{ ...S.input, width: '180px' }} />
                </div>
              </div>

              {/* אזור גרירה / העלאה */}
              <label htmlFor="pdf-upload" style={{ display: 'block', border: '2px dashed #cbd5e1', borderRadius: '16px', padding: '40px', textAlign: 'center', cursor: 'pointer', background: uploadStatus === 'parsing' ? '#f8fafc' : 'white', transition: 'all 0.2s' }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}>
                <input id="pdf-upload" type="file" accept=".pdf" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                <FileText size={40} color={branchColor} style={{ marginBottom: '12px' }} />
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#374151', marginBottom: '6px' }}>
                  {uploadStatus === 'parsing' ? '⏳ מעבד...' : 'גרור PDF לכאן או לחץ להעלאה'}
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>קובץ דוח נוכחות מרוכז מ-CashOnTab</div>
              </label>

              {/* סטטוס */}
              {uploadMsg && (
                <div style={{ marginTop: '14px', padding: '12px 16px', borderRadius: '10px', background: uploadStatus === 'error' ? '#fef2f2' : uploadStatus === 'done' ? '#f0fdf4' : '#f8fafc', border: `1px solid ${uploadStatus === 'error' ? '#fecaca' : uploadStatus === 'done' ? '#bbf7d0' : '#e2e8f0'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {uploadStatus === 'done' ? <CheckCircle size={18} color="#10b981" /> : uploadStatus === 'error' ? <AlertTriangle size={18} color="#ef4444" /> : null}
                  <span style={{ fontSize: '14px', fontWeight: '600', color: uploadStatus === 'error' ? '#ef4444' : '#374151' }}>{uploadMsg}</span>
                </div>
              )}
            </div>

            {/* תצוגת שורות מפורסרות */}
            {parsedRows.length > 0 && (
              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#374151' }}>
                    תוצאות פרסור — {parsedRows.filter(r => r.selected).length}/{parsedRows.length} נבחרו
                  </h3>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>
                      סה"כ: <strong style={{ color: branchColor }}>₪{parsedTotal.toLocaleString()}</strong>
                      {' → עלות מעסיק: '}
                      <strong style={{ color: '#ef4444' }}>₪{Math.round(parsedEmployerTotal).toLocaleString()}</strong>
                    </span>
                  </div>
                </div>

                {/* כותרת טבלה */}
                <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 70px 70px 70px 110px 120px 36px', padding: '9px 16px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                  <span />
                  <span>שם עובד</span>
                  <span style={{ textAlign: 'center' }}>100%</span>
                  <span style={{ textAlign: 'center' }}>125%</span>
                  <span style={{ textAlign: 'center' }}>150%</span>
                  <span style={{ textAlign: 'left' }}>שכר ברוטו</span>
                  <span style={{ textAlign: 'left' }}>עלות מעסיק</span>
                  <span />
                </div>

                {parsedRows.map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 70px 70px 70px 110px 120px 36px', alignItems: 'center', padding: '12px 16px', borderBottom: i < parsedRows.length - 1 ? '1px solid #f1f5f9' : 'none', background: row.selected ? (i % 2 === 0 ? 'white' : '#fafafa') : '#f8fafc', opacity: row.selected ? 1 : 0.4 }}>
                    <input type="checkbox" checked={row.selected}
                      onChange={e => setParsedRows(prev => prev.map((r, j) => j === i ? { ...r, selected: e.target.checked } : r))}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                    <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{row.name}</span>
                    <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{row.hours_100 > 0 ? row.hours_100 : '—'}</span>
                    <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{row.hours_125 > 0 ? row.hours_125 : '—'}</span>
                    <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{row.hours_150 > 0 ? row.hours_150 : '—'}</span>
                    <span style={{ fontWeight: '700', color: branchColor, fontSize: '14px' }}>₪{row.gross_salary.toLocaleString()}</span>
                    <span style={{ fontWeight: '700', color: '#ef4444', fontSize: '14px' }}>₪{Math.round(row.employer_cost).toLocaleString()}</span>
                    <button onClick={() => setParsedRows(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                      <X size={14} color="#94a3b8" />
                    </button>
                  </div>
                ))}

                {/* שורת סה"כ + שמירה */}
                <div style={{ padding: '14px 16px', background: branchColor + '15', borderTop: `2px solid ${branchColor}33`, borderRadius: '0 0 20px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '13px', color: '#374151', fontWeight: '600' }}>
                    {parsedRows.filter(r => r.selected).length} עובדים · {uploadDate}
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', fontWeight: '800', color: '#ef4444' }}>עלות מעסיק: ₪{Math.round(parsedEmployerTotal).toLocaleString()}</span>
                    <button onClick={saveSelected} disabled={loading || parsedRows.filter(r => r.selected).length === 0}
                      style={{ background: loading ? '#e2e8f0' : branchColor, color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                      ✓ שמור לסניף
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ הזנה ידנית ═════════════════════════════════════════════════ */}
        {tab === 'manual' && (
          <div style={S.card}>
            <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת לייבור ידני</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>תאריך</label>
                <input type="date" value={manDate} onChange={e => setManDate(e.target.value)} style={S.input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
                <label style={S.label}>שם עובד</label>
                <input type="text" placeholder="שם מלא..." value={manName} onChange={e => setManName(e.target.value)} style={S.input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>שעות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                <input type="number" placeholder="0" value={manHours} onChange={e => setManHours(e.target.value)} style={{ ...S.input, textAlign: 'right' as const }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>שכר ברוטו (₪)</label>
                <input type="number" placeholder="0" value={manGross} onChange={e => setManGross(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addManual()}
                  style={{ ...S.input, textAlign: 'right' as const }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                <input type="text" placeholder="הערה..." value={manNotes} onChange={e => setManNotes(e.target.value)} style={S.input} />
              </div>
            </div>

            {manGross && (
              <div style={{ background: branchColor + '15', border: `1px solid ${branchColor}33`, borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>עלות מעסיק (×1.3):</span>
                <span style={{ fontSize: '18px', fontWeight: '800', color: branchColor }}>₪{Math.round(parseFloat(manGross) * EMPLOYER_FACTOR).toLocaleString()}</span>
              </div>
            )}

            <button onClick={addManual} disabled={loading || !manName || !manGross}
              style={{ background: loading || !manName || !manGross ? '#e2e8f0' : branchColor, color: loading || !manName || !manGross ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} />הוסף
            </button>
          </div>
        )}

        {/* ══ היסטוריה ════════════════════════════════════════════════════ */}
        {tab === 'history' && (
          <>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', alignItems: 'center' }}>
              <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '14px', background: 'white', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#64748b', marginRight: 'auto' }}>
                <span>ברוטו: <strong style={{ color: branchColor }}>₪{Math.round(totalGross).toLocaleString()}</strong></span>
                <span>עלות מעסיק: <strong style={{ color: '#ef4444' }}>₪{Math.round(totalEmployer).toLocaleString()}</strong></span>
                <span>שעות: <strong>{totalHours.toFixed(1)}</strong></span>
              </div>
            </div>

            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 110px 120px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                <span>תאריך</span><span>עובד</span>
                <span style={{ textAlign: 'center' }}>שעות</span>
                <span style={{ textAlign: 'left' }}>ברוטו</span>
                <span style={{ textAlign: 'left' }}>עלות מעסיק</span>
                <span /><span />
              </div>

              {entries.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין רשומות לחודש זה</div>
              ) : entries.map((entry, i) => (
                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 110px 120px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editId === entry.id ? (
                    <>
                      <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                      <input type="text" value={editData.employee_name || ''} onChange={e => setEditData({ ...editData, employee_name: e.target.value })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                      <input type="number" value={editData.hours || ''} onChange={e => setEditData({ ...editData, hours: parseFloat(e.target.value) })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 6px', fontSize: '12px', textAlign: 'center' as const }} />
                      <input type="number" value={editData.gross_salary || ''} onChange={e => setEditData({ ...editData, gross_salary: parseFloat(e.target.value) })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                      <span style={{ fontSize: '13px', color: '#ef4444', fontWeight: '700' }}>₪{Math.round(Number(editData.gross_salary || 0) * EMPLOYER_FACTOR).toLocaleString()}</span>
                      <button onClick={() => saveEdit(entry.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                      <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                      <div>
                        <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{entry.employee_name}</span>
                        {entry.notes && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{entry.notes}</div>}
                      </div>
                      <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{Number(entry.hours) > 0 ? Number(entry.hours).toFixed(1) : '—'}</span>
                      <span style={{ fontWeight: '700', color: branchColor, fontSize: '14px' }}>₪{Number(entry.gross_salary).toLocaleString()}</span>
                      <span style={{ fontWeight: '700', color: '#ef4444', fontSize: '14px' }}>₪{Math.round(Number(entry.employer_cost)).toLocaleString()}</span>
                      <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                      <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#ef4444" /></button>
                    </>
                  )}
                </div>
              ))}

              {entries.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 110px 120px 36px 36px', padding: '13px 20px', background: branchColor + '15', borderTop: `2px solid ${branchColor}33`, borderRadius: '0 0 20px 20px', fontWeight: '700' }}>
                  <span style={{ color: '#374151', fontSize: '13px' }}>סה"כ</span>
                  <span style={{ color: '#64748b', fontSize: '13px' }}>{entries.length} רשומות</span>
                  <span style={{ textAlign: 'center', color: '#64748b', fontSize: '13px' }}>{totalHours.toFixed(1)}</span>
                  <span style={{ color: branchColor }}>₪{Math.round(totalGross).toLocaleString()}</span>
                  <span style={{ color: '#ef4444' }}>₪{Math.round(totalEmployer).toLocaleString()}</span>
                  <span /><span />
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}