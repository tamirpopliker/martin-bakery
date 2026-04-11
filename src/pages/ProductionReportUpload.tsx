import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileSpreadsheet, CheckCircle, X, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
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

const DEPT_OPTIONS = ['בצקים', 'קרמים', 'אחר']

const S = {
  container: { padding: '24px 32px', maxWidth: 960, margin: '0 auto' } as React.CSSProperties,
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 6, display: 'block' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '10px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' },
}

export default function ProductionReportUpload({ onBack }: Props) {
  const [step, setStep] = useState<'upload' | 'preview' | 'saving' | 'done'>('upload')
  const [reportDate, setReportDate] = useState('')
  const [rows, setRows] = useState<ReportRow[]>([])
  const [error, setError] = useState('')
  const [savedCount, setSavedCount] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  function parseExcel(file: File) {
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]

        // Extract date from I6
        const dateCell = ws['I6']
        let dateStr = ''
        if (dateCell) {
          if (typeof dateCell.v === 'number') {
            // Excel serial date
            const d = XLSX.SSF.parse_date_code(dateCell.v)
            dateStr = `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`
          } else {
            dateStr = String(dateCell.v || '')
          }
        }

        if (!dateStr) {
          setError('לא נמצא תאריך בתא I6')
          return
        }
        setReportDate(dateStr)

        // Extract rows from row 7+
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

          // Map department to standard names
          let mappedDept = 'אחר'
          const deptLower = department.toLowerCase()
          if (deptLower.includes('בצק') || deptLower.includes('dough')) mappedDept = 'בצקים'
          else if (deptLower.includes('קרם') || deptLower.includes('cream')) mappedDept = 'קרמים'
          else if (department && DEPT_OPTIONS.includes(department)) mappedDept = department

          parsed.push({
            product_name,
            department: mappedDept,
            quantity,
            unit_price,
            total_cost: quantity * unit_price,
          })
          rowIdx++
        }

        if (parsed.length === 0) {
          setError('לא נמצאו שורות נתונים בקובץ')
          return
        }

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
    // DD/MM/YYYY → YYYY-MM-DD
    const parts = dateStr.split('/')
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    }
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
    }))

    const { error: insertErr } = await supabase.from('production_reports').insert(payload)

    if (insertErr) {
      setError('שגיאה בשמירה: ' + insertErr.message)
      setStep('preview')
      return
    }

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

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="דוח ייצור מרוכז" subtitle="העלאת דוח ייצור מ-Excel" onBack={onBack} />

      <div style={S.container}>

        {/* ─── Upload Step ─── */}
        {step === 'upload' && (
          <div style={S.card}>
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <FileSpreadsheet size={48} color="#94a3b8" style={{ marginBottom: 16 }} />
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
                העלאת דוח ייצור מרוכז
              </h3>
              <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
                בחר קובץ Excel (.xlsx) עם מבנה הדוח הסטנדרטי — תאריך בתא I6, נתוני מוצרים מהשורה 7
              </p>

              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) parseExcel(file)
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <Upload size={16} />
                בחר קובץ
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

        {/* ─── Preview Step ─── */}
        {step === 'preview' && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  תצוגה מקדימה
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  תאריך דוח: <strong style={{ color: '#0f172a' }}>{reportDate}</strong>
                  {' · '}{rows.length} מוצרים
                </p>
              </div>
              <button onClick={reset} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>
                ביטול
              </button>
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} color="#ef4444" />
                <span style={{ fontSize: 13, color: '#dc2626' }}>{error}</span>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: 40 }}>#</th>
                    <th style={S.th}>שם מוצר</th>
                    <th style={{ ...S.th, width: 120 }}>מחלקה</th>
                    <th style={{ ...S.th, width: 90 }}>כמות</th>
                    <th style={{ ...S.th, width: 100 }}>מחיר ליחידה</th>
                    <th style={{ ...S.th, width: 110 }}>סה"כ עלות</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                      <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                      <td style={S.td}>{row.product_name}</td>
                      <td style={S.td}>
                        <select
                          value={row.department}
                          onChange={(e) => updateRow(i, 'department', e.target.value)}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', background: 'white' }}
                        >
                          {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </td>
                      <td style={S.td}>
                        <input
                          type="number"
                          value={row.quantity}
                          onChange={(e) => updateRow(i, 'quantity', Number(e.target.value) || 0)}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', textAlign: 'left' }}
                        />
                      </td>
                      <td style={S.td}>
                        <input
                          type="number"
                          step="0.01"
                          value={row.unit_price}
                          onChange={(e) => updateRow(i, 'unit_price', Number(e.target.value) || 0)}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', textAlign: 'left' }}
                        />
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>
                        ₪{row.total_cost.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>
                      סה"כ כולל
                    </td>
                    <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', color: '#0f172a', fontSize: 15 }}>
                      ₪{grandTotal.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-start' }}>
              <button
                onClick={handleSave}
                style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <CheckCircle size={16} />
                אשר ושמור
              </button>
              <button
                onClick={reset}
                style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        {/* ─── Saving Step ─── */}
        {step === 'saving' && (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 14, color: '#64748b' }}>שומר {rows.length} שורות...</div>
          </div>
        )}

        {/* ─── Done Step ─── */}
        {step === 'done' && (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
            <CheckCircle size={48} color="#10b981" style={{ marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
              הדוח נשמר בהצלחה
            </h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px' }}>
              {savedCount} מוצרים נשמרו לתאריך {reportDate}
            </p>
            <button onClick={reset} style={{ ...S.btn, background: '#0f172a', color: 'white' }}>
              העלאת דוח נוסף
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}
