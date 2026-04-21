import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { safeDbOperation } from '../lib/dbHelpers'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Plus, Pencil, Trash2, CheckCircle, XCircle, TrendingUp } from 'lucide-react'
import { RevenueIcon } from '@/components/icons'
import { Card, CardContent } from '@/components/ui/card'
import PageHeader from '../components/PageHeader'

// ─── טיפוסים ───────────────────────────────────────────────────────────────
type Department = 'creams' | 'dough' | 'packaging'

interface Props {
  department: Department
  onBack: () => void
}

interface Entry {
  id: number
  date: string
  amount: number        // ₪ לקרמים/בצקים | כמות לאריזה
}

// ─── קונפיגורציה לפי מחלקה ─────────────────────────────────────────────────
const DEPT_CONFIG = {
  creams:    { label: 'קרמים',  color: '#818cf8', bg: '#dbeafe', unit: '₪',   fieldLabel: 'סכום ייצור (₪)',   isQty: false },
  dough:     { label: 'בצקים',  color: '#c084fc', bg: '#ede9fe', unit: '₪',   fieldLabel: 'סכום ייצור (₪)',   isQty: false },
  packaging: { label: 'אריזה',  color: '#0ea5e9', bg: '#e0f2fe', unit: 'יח׳', fieldLabel: 'כמות אריזות (יח׳)', isQty: true  },
}

// ─── עזרים ─────────────────────────────────────────────────────────────────
function formatVal(val: number, isQty: boolean) {
  return isQty
    ? val.toLocaleString() + ' יח׳'
    : '₪' + val.toLocaleString()
}

function hebrewDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('he-IL', {
    weekday: 'short', day: 'numeric', month: 'numeric'
  })
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── גרף קו פשוט (SVG) ─────────────────────────────────────────────────────
function LineChart({ entries, color, isQty, previousData }: { entries: Entry[]; color: string; isQty: boolean; previousData?: Entry[] }) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 2) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: '13px' }}>
      נדרשות לפחות 2 הזנות להצגת גרף
    </div>
  )

  const W = 700, H = 160, PAD = { top: 16, bottom: 32, left: 16, right: 16 }
  const vals = sorted.map(e => e.amount)

  // Include previous month values in min/max so both lines share the same Y scale
  const prevSorted = previousData ? [...previousData].sort((a, b) => a.date.localeCompare(b.date)) : []
  const prevVals = prevSorted.map(e => e.amount)
  const allVals = [...vals, ...prevVals]

  const minV = Math.min(...allVals), maxV = Math.max(...allVals)
  const range = maxV - minV || 1

  const toX = (i: number) => PAD.left + (i / (sorted.length - 1)) * (W - PAD.left - PAD.right)
  const toY = (v: number) => PAD.top + (1 - (v - minV) / range) * (H - PAD.top - PAD.bottom)

  const points = sorted.map((e, i) => `${toX(i)},${toY(e.amount)}`).join(' ')
  const area = `M ${toX(0)},${toY(sorted[0].amount)} ` +
    sorted.slice(1).map((e, i) => `L ${toX(i + 1)},${toY(e.amount)}`).join(' ') +
    ` L ${toX(sorted.length - 1)},${H - PAD.bottom} L ${toX(0)},${H - PAD.bottom} Z`

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length

  // Determine days in the current month for x-axis alignment of previous month data
  const daysInMonth = sorted.length > 0
    ? new Date(
        parseInt(sorted[0].date.split('-')[0]),
        parseInt(sorted[0].date.split('-')[1]),
        0
      ).getDate()
    : 31

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '160px' }}>
      {/* קו ממוצע */}
      <line
        x1={PAD.left} y1={toY(avg)}
        x2={W - PAD.right} y2={toY(avg)}
        stroke={color} strokeWidth="1" strokeDasharray="4 4" opacity={0.4}
      />
      {/* שטח */}
      <path d={area} fill={color} opacity={0.08} />
      {/* קו */}
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {/* Previous month overlay */}
      {prevSorted.length >= 2 && (() => {
        const prevPoints = prevSorted.map((e) => {
          const dayNum = parseInt(e.date.split('-')[2])
          const x = PAD.left + ((dayNum - 1) / Math.max(daysInMonth - 1, 1)) * (W - PAD.left - PAD.right)
          const y = PAD.top + (1 - (Number(e.amount) - minV) / range) * (H - PAD.top - PAD.bottom)
          return `${x},${y}`
        }).join(' ')
        return <polyline points={prevPoints} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" />
      })()}
      {/* נקודות */}
      {sorted.map((e, i) => (
        <g key={e.id}>
          <circle cx={toX(i)} cy={toY(e.amount)} r="4" fill={color} stroke="white" strokeWidth="2" />
          {/* תווית */}
          {sorted.length <= 15 && (
            <text
              x={toX(i)} y={toY(e.amount) - 10}
              textAnchor="middle" fontSize="10" fill={color} fontWeight="600"
            >
              {isQty ? e.amount.toLocaleString() : '₪' + (e.amount / 1000).toFixed(0) + 'K'}
            </text>
          )}
        </g>
      ))}
      {/* תוויות ציר X */}
      {sorted.map((e, i) => {
        if (sorted.length > 10 && i % 3 !== 0) return null
        return (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {new Date(e.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}
          </text>
        )
      })}
    </svg>
  )
}

// ─── קומפוננטה ראשית ────────────────────────────────────────────────────────
export default function DailyProduction({ department, onBack }: Props) {
  const cfg = DEPT_CONFIG[department]

  const [entries, setEntries]           = useState<Entry[]>([])
  const [prevEntries, setPrevEntries]   = useState<Entry[]>([])
  const [date, setDate]                 = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount]             = useState('')
  const [loading, setLoading]           = useState(false)
  const [saveError, setSaveError]       = useState('')
  const [todayEntered, setTodayEntered] = useState(false)
  const [editId, setEditId]             = useState<number | null>(null)
  const [editAmount, setEditAmount]     = useState('')
  const { period, setPeriod, from, to, comparisonPeriod } = usePeriod()
  const [showChart, setShowChart]       = useState(true)

  // ─── שליפה ──────────────────────────────────────────────────────────────
  async function fetchEntries() {
    const { data } = await supabase
      .from('daily_production')
      .select('*')
      .eq('department', department)
      .gte('date', from)
      .lt('date', to)
      .order('date', { ascending: false })
    if (data) {
      setEntries(data)
      const today = new Date().toISOString().split('T')[0]
      setTodayEntered(data.some(e => e.date === today))
    }

    // Comparison period (previous month or equivalent)
    const { data: prevData } = await supabase
      .from('daily_production')
      .select('*')
      .eq('department', department)
      .gte('date', comparisonPeriod.from)
      .lt('date', comparisonPeriod.to)
      .order('date')
    if (prevData) setPrevEntries(prevData)
    else setPrevEntries([])
  }

  useEffect(() => { fetchEntries() }, [from, to, department])

  // ─── הוספה ──────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!amount || !date) return
    setLoading(true)
    setSaveError('')
    const res = await safeDbOperation(
      () => supabase.from('daily_production').insert({
        department, date, amount: parseFloat(amount)
      }),
      'הוספת רשומת ייצור',
    )
    if (!res.ok) { setSaveError(res.error); setLoading(false); return }
    setAmount('')
    await fetchEntries()
    setLoading(false)
  }

  // ─── מחיקה ──────────────────────────────────────────────────────────────
  async function handleDelete(id: number) {
    if (!confirm('למחוק רשומה זו?')) return
    const res = await safeDbOperation(
      () => supabase.from('daily_production').delete().eq('id', id),
      'מחיקת רשומת ייצור',
    )
    if (!res.ok) { setSaveError(res.error); return }
    await fetchEntries()
  }

  // ─── עריכה ──────────────────────────────────────────────────────────────
  async function handleEdit(id: number) {
    const res = await safeDbOperation(
      () => supabase.from('daily_production').update({ amount: parseFloat(editAmount) }).eq('id', id),
      'עדכון רשומת ייצור',
    )
    if (!res.ok) { setSaveError(res.error); return }
    setEditId(null)
    await fetchEntries()
  }

  // ─── חישובים ────────────────────────────────────────────────────────────
  const total   = entries.reduce((s, e) => s + Number(e.amount), 0)
  const avg     = entries.length ? total / entries.length : 0
  const maxVal  = entries.length ? Math.max(...entries.map(e => e.amount)) : 0

  // ─── סגנונות ────────────────────────────────────────────────────────────
  const S = {
    label:   { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input:   { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
    btnPrimary: (disabled: boolean) => ({
      background: disabled ? '#e2e8f0' : cfg.color,
      color: disabled ? '#94a3b8' : 'white',
      border: 'none', borderRadius: '10px', padding: '10px 24px',
      fontSize: '15px', fontWeight: '700' as const,
      cursor: disabled ? 'not-allowed' as const : 'pointer' as const,
      display: 'flex', alignItems: 'center', gap: '8px'
    }),
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* ─── כותרת ─────────────────────────────────────────────── */}
      <PageHeader
        title={cfg.isQty ? 'כמויות אריזה' : 'ייצור יומי'}
        subtitle={cfg.label}
        onBack={onBack}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px',
            background: todayEntered ? '#f0fdf4' : '#fff1f2',
            border: `1px solid ${todayEntered ? '#bbf7d0' : '#fecdd3'}`,
            borderRadius: '10px', padding: '8px 16px' }}>
            {todayEntered
              ? <><CheckCircle size={18} color="#34d399" /><span style={{ color: '#34d399', fontWeight: '700', fontSize: '14px' }}>הוזן היום ✓</span></>
              : <><XCircle    size={18} color="#fb7185" /><span style={{ color: '#fb7185', fontWeight: '700', fontSize: '14px' }}>לא הוזן היום</span></>
            }
          </div>
        }
      />

      {saveError && (
        <div style={{ maxWidth: 960, margin: '12px auto 0', padding: '0 32px' }}>
          <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 14px', borderRadius: 10, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>{saveError}</span>
            <button onClick={() => setSaveError('')} style={{ background: 'transparent', border: 'none', color: '#991b1b', fontWeight: 700, cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
        </div>
      )}

      <div className="page-container" style={{ padding: '28px 32px', maxWidth: '960px', margin: '0 auto' }}>

        {/* ─── כרטיסי סיכום ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
          {[
            { label: `סה"כ החודש`, val: formatVal(total, cfg.isQty), color: cfg.color, bg: cfg.bg },
            { label: 'ממוצע יומי',   val: formatVal(Math.round(avg), cfg.isQty), color: '#34d399', bg: '#f0fdf4' },
            { label: 'שיא יומי',     val: formatVal(maxVal, cfg.isQty),           color: '#fbbf24', bg: '#fffbeb' },
          ].map(stat => (
            <Card key={stat.label} className="shadow-sm" style={{ background: stat.bg, border: `1px solid ${stat.color}22` }}>
              <CardContent className="p-6">
                <div style={{ fontSize: '22px', fontWeight: '800', color: stat.color }}>{stat.val}</div>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>{stat.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ─── טופס הזנה ─────────────────────────────────────────── */}
        <Card className="shadow-sm" style={{ marginBottom: '20px' }}>
          <CardContent className="p-6">
            <h2 style={{ margin: '0 0 18px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הזנת {cfg.isQty ? 'כמות' : 'ייצור'} יומי</h2>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' as const, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                <label style={S.label}>תאריך</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  style={{ ...S.input, width: '160px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, flex: 1, minWidth: '180px' }}>
                <label style={S.label}>{cfg.fieldLabel}</label>
                <input
                  type="number" placeholder="הכנס ערך..." value={amount}
                  onChange={e => setAmount(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  style={{ ...S.input, textAlign: 'right' }}
                />
              </div>
              <button onClick={handleAdd} disabled={loading || !amount} style={S.btnPrimary(loading || !amount)}>
                <Plus size={18} />הוסף
              </button>
            </div>
          </CardContent>
        </Card>

        {/* ─── גרף + פילטר ───────────────────────────────────────── */}
        <Card className="shadow-sm" style={{ marginBottom: '20px' }}>
          <CardContent className="p-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <TrendingUp size={18} color={cfg.color} />
                <span style={{ fontSize: '15px', fontWeight: '700', color: '#374151' }}>גרף ייצור</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <PeriodPicker period={period} onChange={setPeriod} />
                <button
                  onClick={() => setShowChart(v => !v)}
                  style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}
                >
                  {showChart ? 'הסתר גרף' : 'הצג גרף'}
                </button>
              </div>
            </div>
            {showChart && (
              <>
                <div style={{ background: '#fafafa', borderRadius: '12px', padding: '12px', minHeight: '180px', display: 'flex', alignItems: 'center' }}>
                  <LineChart entries={entries} color={cfg.color} isQty={cfg.isQty} previousData={prevEntries} />
                </div>
                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginTop: '8px', fontSize: '12px', color: '#64748b' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '20px', height: '3px', background: cfg.color, borderRadius: '2px', display: 'inline-block' }} />
                    חודש נוכחי
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '20px', height: '3px', background: '#94a3b8', borderRadius: '2px', display: 'inline-block', borderTop: '1.5px dashed #94a3b8' }} />
                    חודש קודם
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ─── טבלת היסטוריה ─────────────────────────────────────── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className="table-scroll"><Card className="shadow-sm">
            <CardContent className="p-0">
              {/* כותרת טבלה */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 60px 60px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '0' }}>
                <span>תאריך</span>
                <span style={{ textAlign: 'left' }}>{cfg.isQty ? 'כמות' : 'סכום'}</span>
                <span></span><span></span>
              </div>

              {entries.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>אין רשומות לחודש זה</div>
              ) : entries.map((entry, i) => (
                <div key={entry.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 60px 60px',
                  alignItems: 'center', padding: '13px 20px',
                  borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none',
                  background: i % 2 === 0 ? 'white' : '#fafafa'
                }}>
                  {editId === entry.id ? (
                    <>
                      <span style={{ fontSize: '13px', color: '#374151', fontWeight: '600' }}>
                        {hebrewDate(entry.date)}
                      </span>
                      <input
                        type="number" value={editAmount}
                        onChange={e => setEditAmount(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleEdit(entry.id)}
                        autoFocus
                        style={{ border: '1.5px solid ' + cfg.color, borderRadius: '8px', padding: '6px 10px', fontSize: '14px', width: '120px' }}
                      />
                      <button onClick={() => handleEdit(entry.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>✓</button>
                      <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '14px', color: '#374151', fontWeight: '600' }}>
                        {hebrewDate(entry.date)}
                      </span>
                      <span style={{ fontSize: '16px', fontWeight: '800', color: cfg.color }}>
                        {formatVal(Number(entry.amount), cfg.isQty)}
                      </span>
                      <button
                        onClick={() => { setEditId(entry.id); setEditAmount(String(entry.amount)) }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px' }}
                        title="עריכה"
                      >
                        <Pencil size={15} color="#94a3b8" />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px' }}
                        title="מחיקה"
                      >
                        <Trash2 size={15} color="#fb7185" />
                      </button>
                    </>
                  )}
                </div>
              ))}

              {/* שורת סה"כ */}
              {entries.length > 0 && (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 60px 60px',
                  padding: '14px 20px', background: cfg.bg,
                  borderTop: `2px solid ${cfg.color}33`, borderRadius: '0 0 10px 10px'
                }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>
                    סה"כ — {entries.length} ימים
                  </span>
                  <span style={{ fontSize: '17px', fontWeight: '800', color: cfg.color }}>
                    {formatVal(total, cfg.isQty)}
                  </span>
                  <span /><span />
                </div>
              )}
            </CardContent>
          </Card></div>
        </motion.div>

      </div>
    </div>
  )
}
