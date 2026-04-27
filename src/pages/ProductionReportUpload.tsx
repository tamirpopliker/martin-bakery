import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ChevronLeft, History, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import PageHeader from '../components/PageHeader'
import * as XLSX from 'xlsx'

const fadeIn = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } }
}

interface Props {
  onBack: () => void
}

interface ReportRow {
  product_name: string
  department: string
  quantity: number
  unit_price: number
  total_cost: number
}

interface HistoryGroup {
  report_date: string
  department: string
  product_count: number
  total_cost: number
}

interface DetailRow {
  id: number
  product_name: string
  department: string
  quantity: number
  unit_price: number
  total_cost: number
}

const DEPT_OPTIONS = ['בצקים', 'קרמים', 'אריזה', 'ניקיון', 'שונות']

const S = {
  container: { padding: '24px 32px', maxWidth: 960, margin: '0 auto' } as React.CSSProperties,
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '10px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' },
  tab: (active: boolean) => ({
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    border: 'none', borderBottom: active ? '2px solid #0f172a' : '2px solid transparent',
    background: 'none', color: active ? '#0f172a' : '#94a3b8',
  } as React.CSSProperties),
}

const fmtMoney = (n: number) => '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })

function getCurrentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function ProductionReportUpload({ onBack }: Props) {
  const { appUser } = useAppUser()
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload')

  // ─── Upload state ───
  const [step, setStep] = useState<'upload' | 'preview' | 'saving' | 'done'>('upload')
  const [reportDate, setReportDate] = useState('')
  const [rows, setRows] = useState<ReportRow[]>([])
  const [error, setError] = useState('')
  const [savedCount, setSavedCount] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  // ─── History state ───
  const [historyGroups, setHistoryGroups] = useState<HistoryGroup[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [filterDept, setFilterDept] = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState(getCurrentMonth())
  const [detailDate, setDetailDate] = useState<string | null>(null)
  const [detailDept, setDetailDept] = useState<string | null>(null)
  const [detailRows, setDetailRows] = useState<DetailRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // ─── Edit/Delete state ───
  const [editDate, setEditDate] = useState<string | null>(null)
  const [editDept, setEditDept] = useState<string | null>(null)
  const [editRows, setEditRows] = useState<DetailRow[]>([])
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ date: string; dept: string } | null>(null)

  // ─── History fetch ───
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    const [y, m] = filterMonth.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const toDate = new Date(y, m, 0)
    const to = `${y}-${String(m).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`

    let query = supabase.from('production_reports')
      .select('report_date, department, quantity, total_cost')
      .gte('report_date', from).lte('report_date', to)
      .order('report_date', { ascending: false })

    if (filterDept !== 'all') {
      query = query.eq('department', filterDept)
    }

    const { data } = await query
    if (data) {
      const grouped = new Map<string, HistoryGroup>()
      for (const row of data) {
        const key = `${row.report_date}_${row.department}`
        const existing = grouped.get(key)
        if (existing) {
          existing.product_count++
          existing.total_cost += Number(row.total_cost)
        } else {
          grouped.set(key, {
            report_date: row.report_date,
            department: row.department,
            product_count: 1,
            total_cost: Number(row.total_cost),
          })
        }
      }
      setHistoryGroups([...grouped.values()])
    }
    setHistoryLoading(false)
  }, [filterMonth, filterDept])

  useEffect(() => {
    if (activeTab === 'history') loadHistory()
  }, [activeTab, loadHistory])

  async function openDetail(date: string, dept: string) {
    setDetailDate(date)
    setDetailDept(dept)
    setDetailLoading(true)
    const { data } = await supabase.from('production_reports')
      .select('id, product_name, department, quantity, unit_price, total_cost')
      .eq('report_date', date).eq('department', dept)
      .order('id')
    setDetailRows(data || [])
    setDetailLoading(false)
  }

  function closeDetail() {
    setDetailDate(null)
    setDetailDept(null)
    setDetailRows([])
  }

  // ─── Delete handler ───
  async function handleDelete(date: string, dept: string) {
    const { error } = await supabase.from('production_reports').delete()
      .eq('report_date', date).eq('department', dept)
    if (error) {
      console.error('[ProductionReportUpload handleDelete] error:', error)
      alert(`מחיקת דוח הייצור נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    setDeleteConfirm(null)
    loadHistory()
  }

  // ─── Edit handlers ───
  async function openEdit(date: string, dept: string) {
    setEditDate(date)
    setEditDept(dept)
    setEditLoading(true)
    const { data } = await supabase.from('production_reports')
      .select('id, product_name, department, quantity, unit_price, total_cost')
      .eq('report_date', date).eq('department', dept)
      .order('id')
    setEditRows(data || [])
    setEditLoading(false)
  }

  function updateEditRow(idx: number, field: string, value: string | number) {
    setEditRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const updated = { ...r, [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        updated.total_cost = (Number(updated.quantity) || 0) * (Number(updated.unit_price) || 0)
      }
      return updated
    }))
  }

  async function saveEdit() {
    setEditSaving(true)
    for (const row of editRows) {
      const { error } = await supabase.from('production_reports').update({
        department: row.department,
        quantity: row.quantity,
        unit_price: row.unit_price,
        total_cost: row.total_cost,
      }).eq('id', row.id)
      if (error) {
        console.error('[ProductionReportUpload saveEdit row] error:', error)
        alert(`עדכון שורה בדוח נכשל: ${error.message || 'שגיאת מסד נתונים'}. חלק מהשינויים אולי לא נשמרו — בדוק.`)
        setEditSaving(false)
        return
      }
    }
    setEditSaving(false)
    setEditDate(null)
    setEditDept(null)
    setEditRows([])
    loadHistory()
  }

  function closeEdit() {
    setEditDate(null)
    setEditDept(null)
    setEditRows([])
  }

  // ─── Upload logic ───
  function parseExcel(file: File) {
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]

        const dateCell = ws['I6']
        let dateStr = ''
        if (dateCell) {
          if (typeof dateCell.v === 'number') {
            const d = XLSX.SSF.parse_date_code(dateCell.v)
            dateStr = `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`
          } else {
            dateStr = String(dateCell.v || '')
          }
        }
        if (!dateStr) { setError('לא נמצא תאריך בתא I6'); return }
        setReportDate(dateStr)

        const parsed: ReportRow[] = []
        let rowIdx = 7
        while (true) {
          const productCell = ws[`C${rowIdx}`]
          if (!productCell || !productCell.v || String(productCell.v).trim() === '') break

          const product_name = String(productCell.v).trim()
          const deptCell = ws[`E${rowIdx}`]
          const qtyCell = ws[`G${rowIdx}`]
          const priceCell = ws[`H${rowIdx}`]

          const department = deptCell ? String(deptCell.v || '').trim() : 'אחר'
          const quantity = qtyCell ? Number(qtyCell.v) || 0 : 0
          const unit_price = priceCell ? Number(priceCell.v) || 0 : 0

          let mappedDept = 'אחר'
          const deptLower = department.toLowerCase()
          if (deptLower.includes('בצק') || deptLower.includes('dough')) mappedDept = 'בצקים'
          else if (deptLower.includes('קרם') || deptLower.includes('cream')) mappedDept = 'קרמים'
          else if (department && DEPT_OPTIONS.includes(department)) mappedDept = department

          parsed.push({ product_name, department: mappedDept, quantity, unit_price, total_cost: quantity * unit_price })
          rowIdx++
        }

        if (parsed.length === 0) { setError('לא נמצאו שורות נתונים בקובץ'); return }
        setRows(parsed)
        setStep('preview')
      } catch (err) {
        setError('שגיאה בקריאת הקובץ: ' + (err instanceof Error ? err.message : String(err)))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function updateRow(idx: number, field: keyof ReportRow, value: string | number) {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const updated = { ...r, [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        updated.total_cost = (Number(updated.quantity) || 0) * (Number(updated.unit_price) || 0)
      }
      return updated
    }))
  }

  function parseDateForDB(dateStr: string): string {
    const parts = dateStr.split('/')
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    return dateStr
  }

  async function handleSave() {
    setStep('saving')
    const dbDate = parseDateForDB(reportDate)
    const payload = rows.map(r => ({
      report_date: dbDate,
      product_name: r.product_name,
      department: r.department,
      quantity: r.quantity,
      unit_price: r.unit_price,
      total_cost: r.total_cost,
      uploaded_by: appUser?.name || null,
    }))

    const { error: insertErr } = await supabase.from('production_reports').insert(payload)
    if (insertErr) { setError('שגיאה בשמירה: ' + insertErr.message); setStep('preview'); return }
    setSavedCount(payload.length)
    setStep('done')
  }

  function reset() {
    setStep('upload')
    setRows([])
    setReportDate('')
    setError('')
    setSavedCount(0)
    if (fileRef.current) fileRef.current.value = ''
  }

  const grandTotal = rows.reduce((s, r) => s + r.total_cost, 0)

  function formatDateHe(dateStr: string): string {
    const [y, m, d] = dateStr.split('-')
    return `${d}/${m}/${y}`
  }

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="דוח ייצור מרוכז" subtitle="העלאת דוחות וצפייה בהיסטוריה" onBack={onBack} />

      <div style={S.container}>
        {/* ─── Tabs ─── */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
          <button style={S.tab(activeTab === 'upload')} onClick={() => { setActiveTab('upload'); closeDetail() }}>
            <Upload size={14} style={{ marginLeft: 6, verticalAlign: -2 }} />
            העלאת דוח
          </button>
          <button style={S.tab(activeTab === 'history')} onClick={() => { setActiveTab('history'); closeDetail() }}>
            <History size={14} style={{ marginLeft: 6, verticalAlign: -2 }} />
            היסטוריה
          </button>
        </div>

        {/* ═══════════════ UPLOAD TAB ═══════════════ */}
        {activeTab === 'upload' && (
          <>
            {step === 'upload' && (
              <div style={S.card}>
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <FileSpreadsheet size={48} color="#94a3b8" style={{ marginBottom: 16 }} />
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>העלאת דוח ייצור מרוכז</h3>
                  <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
                    בחר קובץ Excel (.xlsx) עם מבנה הדוח הסטנדרטי — תאריך בתא I6, נתוני מוצרים מהשורה 7
                  </p>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) parseExcel(file) }} />
                  <button onClick={() => fileRef.current?.click()}
                    style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Upload size={16} /> בחר קובץ
                  </button>
                </div>
                {error && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={16} color="#ef4444" />
                    <span style={{ fontSize: 13, color: '#dc2626' }}>{error}</span>
                  </div>
                )}
              </div>
            )}

            {step === 'preview' && (
              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>תצוגה מקדימה</h3>
                    <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                      תאריך דוח: <strong style={{ color: '#0f172a' }}>{reportDate}</strong> · {rows.length} מוצרים
                    </p>
                  </div>
                  <button onClick={reset} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
                </div>
                {error && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={16} color="#ef4444" /><span style={{ fontSize: 13, color: '#dc2626' }}>{error}</span>
                  </div>
                )}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={{ ...S.th, width: 40 }}>#</th>
                      <th style={S.th}>שם מוצר</th>
                      <th style={{ ...S.th, width: 120 }}>מחלקה</th>
                      <th style={{ ...S.th, width: 90 }}>כמות</th>
                      <th style={{ ...S.th, width: 100 }}>מחיר ליחידה</th>
                      <th style={{ ...S.th, width: 110 }}>סה"כ עלות</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                          <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                          <td style={S.td}>{row.product_name}</td>
                          <td style={S.td}>
                            <select value={row.department} onChange={(e) => updateRow(i, 'department', e.target.value)}
                              style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', background: 'white' }}>
                              {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </td>
                          <td style={S.td}>
                            <input type="number" value={row.quantity} onChange={(e) => updateRow(i, 'quantity', Number(e.target.value) || 0)}
                              style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', textAlign: 'left' }} />
                          </td>
                          <td style={S.td}>
                            <input type="number" step="0.01" value={row.unit_price} onChange={(e) => updateRow(i, 'unit_price', Number(e.target.value) || 0)}
                              style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', textAlign: 'left' }} />
                          </td>
                          <td style={{ ...S.td, fontWeight: 600 }}>
                            {fmtMoney(row.total_cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr>
                      <td colSpan={5} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ כולל</td>
                      <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', color: '#0f172a', fontSize: 15 }}>{fmtMoney(grandTotal)}</td>
                    </tr></tfoot>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-start' }}>
                  <button onClick={handleSave} style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle size={16} /> אשר ושמור
                  </button>
                  <button onClick={reset} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
                </div>
              </div>
            )}

            {step === 'saving' && (
              <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
                <div style={{ fontSize: 14, color: '#64748b' }}>שומר {rows.length} שורות...</div>
              </div>
            )}

            {step === 'done' && (
              <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
                <CheckCircle size={48} color="#10b981" style={{ marginBottom: 16 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>הדוח נשמר בהצלחה</h3>
                <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px' }}>{savedCount} מוצרים נשמרו לתאריך {reportDate}</p>
                <button onClick={reset} style={{ ...S.btn, background: '#0f172a', color: 'white' }}>העלאת דוח נוסף</button>
              </div>
            )}
          </>
        )}

        {/* ═══════════════ HISTORY TAB ═══════════════ */}
        {activeTab === 'history' && !detailDate && (
          <div style={S.card}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>חודש</label>
                <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>מחלקה</label>
                <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, background: 'white' }}>
                  <option value="all">כל המחלקות</option>
                  {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>

            {historyLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
            ) : historyGroups.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>אין דוחות לתקופה זו</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={S.th}>תאריך</th>
                  <th style={S.th}>מחלקה</th>
                  <th style={S.th}>מוצרים</th>
                  <th style={S.th}>סה"כ עלות</th>
                  <th style={{ ...S.th, width: 150 }}></th>
                </tr></thead>
                <tbody>
                  {historyGroups.map((g, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                      <td style={S.td}>{formatDateHe(g.report_date)}</td>
                      <td style={S.td}>
                        <span style={{ background: g.department === 'בצקים' ? '#ede9fe' : g.department === 'קרמים' ? '#fef3c7' : '#f1f5f9',
                          color: g.department === 'בצקים' ? '#6d28d9' : g.department === 'קרמים' ? '#b45309' : '#64748b',
                          padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                          {g.department}
                        </span>
                      </td>
                      <td style={S.td}>{g.product_count}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmtMoney(g.total_cost)}</td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => openDetail(g.report_date, g.department)}
                            style={{ ...S.btn, padding: '4px 10px', fontSize: 12, background: '#f1f5f9', color: '#374151' }}>
                            פתח
                          </button>
                          <button onClick={() => openEdit(g.report_date, g.department)}
                            style={{ ...S.btn, padding: '4px 8px', fontSize: 12, background: '#f1f5f9', color: '#6366f1' }}
                            title="עריכה">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setDeleteConfirm({ date: g.report_date, dept: g.department })}
                            style={{ ...S.btn, padding: '4px 8px', fontSize: 12, background: '#fef2f2', color: '#ef4444' }}
                            title="מחיקה">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td colSpan={3} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ</td>
                  <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', fontSize: 15 }}>
                    {fmtMoney(historyGroups.reduce((s, g) => s + g.total_cost, 0))}
                  </td>
                  <td style={{ ...S.td, borderTop: '2px solid #e2e8f0' }}></td>
                </tr></tfoot>
              </table>
            )}
          </div>
        )}

        {/* ─── Detail View ─── */}
        {activeTab === 'history' && detailDate && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  פרטי דוח — {formatDateHe(detailDate)}
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  מחלקה: {detailDept} · {detailRows.length} מוצרים
                </p>
              </div>
              <button onClick={closeDetail}
                style={{ ...S.btn, background: '#f1f5f9', color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ChevronLeft size={14} /> חזרה לרשימה
              </button>
            </div>

            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...S.th, width: 40 }}>#</th>
                  <th style={S.th}>שם מוצר</th>
                  <th style={{ ...S.th, width: 90 }}>כמות</th>
                  <th style={{ ...S.th, width: 100 }}>מחיר ליחידה</th>
                  <th style={{ ...S.th, width: 110 }}>סה"כ עלות</th>
                </tr></thead>
                <tbody>
                  {detailRows.map((row, i) => (
                    <tr key={row.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                      <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                      <td style={S.td}>{row.product_name}</td>
                      <td style={S.td}>{row.quantity}</td>
                      <td style={S.td}>{fmtMoney(row.unit_price)}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmtMoney(row.total_cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td colSpan={4} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ</td>
                  <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', fontSize: 15 }}>
                    {fmtMoney(detailRows.reduce((s, r) => s + Number(r.total_cost), 0))}
                  </td>
                </tr></tfoot>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════ DELETE CONFIRM DIALOG ═══════════════ */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 380, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>מחיקת דוח</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.6 }}>
              האם למחוק את דוח המחלקה <strong>{deleteConfirm.dept}</strong> מתאריך <strong>{formatDateHe(deleteConfirm.date)}</strong>?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
              <button onClick={() => handleDelete(deleteConfirm.date, deleteConfirm.dept)}
                style={{ ...S.btn, background: '#ef4444', color: 'white', padding: '8px 20px' }}>מחק</button>
              <button onClick={() => setDeleteConfirm(null)}
                style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 20px' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ EDIT MODAL ═══════════════ */}
      {editDate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={closeEdit}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 800, width: '100%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  עריכת דוח — {formatDateHe(editDate)}
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  מחלקה: {editDept} · {editRows.length} מוצרים
                </p>
              </div>
            </div>

            {editLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...S.th, width: 40 }}>#</th>
                    <th style={S.th}>שם מוצר</th>
                    <th style={{ ...S.th, width: 120 }}>מחלקה</th>
                    <th style={{ ...S.th, width: 90 }}>כמות</th>
                    <th style={{ ...S.th, width: 100 }}>מחיר</th>
                    <th style={{ ...S.th, width: 100 }}>סה"כ</th>
                  </tr></thead>
                  <tbody>
                    {editRows.map((row, i) => (
                      <tr key={row.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                        <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                        <td style={S.td}>{row.product_name}</td>
                        <td style={S.td}>
                          <select value={row.department} onChange={(e) => updateEditRow(i, 'department', e.target.value)}
                            style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', background: 'white' }}>
                            {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </td>
                        <td style={S.td}>
                          <input type="number" value={row.quantity} onChange={(e) => updateEditRow(i, 'quantity', Number(e.target.value) || 0)}
                            style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', textAlign: 'left' }} />
                        </td>
                        <td style={S.td}>
                          <input type="number" step="0.01" value={row.unit_price} onChange={(e) => updateEditRow(i, 'unit_price', Number(e.target.value) || 0)}
                            style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', textAlign: 'left' }} />
                        </td>
                        <td style={{ ...S.td, fontWeight: 600 }}>
                          {fmtMoney(row.total_cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={5} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ</td>
                    <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', fontSize: 15 }}>
                      {fmtMoney(editRows.reduce((s, r) => s + Number(r.total_cost), 0))}
                    </td>
                  </tr></tfoot>
                </table>

                <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-start' }}>
                  <button onClick={saveEdit} disabled={editSaving}
                    style={{ ...S.btn, background: editSaving ? '#94a3b8' : '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle size={16} /> {editSaving ? 'שומר...' : 'שמור שינויים'}
                  </button>
                  <button onClick={closeEdit}
                    style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}
