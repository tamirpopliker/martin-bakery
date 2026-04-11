import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Upload, FileText, Plus, Pencil, Trash2, Search, X, CheckCircle, AlertTriangle, History, Check } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { onBack: () => void }

interface ExtSale {
  id: number
  customer_name: string
  invoice_number: string | null
  invoice_date: string
  total_before_vat: number
  uploaded_by: string | null
  created_at: string
}

interface ParsedInvoice {
  customer_name: string
  invoice_number: string
  invoice_date: string // DD/MM/YYYY
  total_before_vat: number
  fileName: string
  status: 'parsed' | 'duplicate' | 'saved' | 'error'
  duplicateId?: number
  error?: string
}

const S = {
  container: { padding: '24px 32px', maxWidth: 1060, margin: '0 auto' } as React.CSSProperties,
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '10px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' },
  input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  label: { fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 } as React.CSSProperties,
  tab: (active: boolean) => ({
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    border: 'none', borderBottom: active ? '2px solid #0f172a' : '2px solid transparent',
    background: 'none', color: active ? '#0f172a' : '#94a3b8',
  } as React.CSSProperties),
}

const fmtMoney = (n: number) => '₪' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmtDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }
const parseDateToDB = (d: string) => { const p = d.split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : d }
const getCurrentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function FactoryB2B({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { period, setPeriod, from, to } = usePeriod()
  const [tab, setTab] = useState<'manual' | 'pdf' | 'history'>('manual')

  // ─── Manual add state ───
  const [manualCustomer, setManualCustomer] = useState('')
  const [manualInvoice, setManualInvoice] = useState('')
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0])
  const [manualAmount, setManualAmount] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  // ─── PDF state ───
  const [pdfParsing, setPdfParsing] = useState(false)
  const [parsedInvoices, setParsedInvoices] = useState<ParsedInvoice[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // ─── History state ───
  const [sales, setSales] = useState<ExtSale[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [histSearch, setHistSearch] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<ExtSale>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<ExtSale | null>(null)

  // ─── Load history ───
  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    const { data } = await supabase.from('external_sales').select('*')
      .gte('invoice_date', from).lt('invoice_date', to)
      .order('invoice_date', { ascending: false })
    setSales(data || [])
    setHistLoading(false)
  }, [from, to])

  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])

  // ─── Manual add ───
  async function addManual() {
    if (!manualCustomer || !manualAmount || !manualDate) return
    setManualSaving(true)
    await supabase.from('external_sales').insert({
      customer_name: manualCustomer,
      invoice_number: manualInvoice || null,
      invoice_date: manualDate,
      total_before_vat: parseFloat(manualAmount),
      uploaded_by: appUser?.name || null,
    })
    setManualCustomer(''); setManualInvoice(''); setManualAmount('')
    setManualSaving(false)
    alert('נשמר בהצלחה')
  }

  // ─── PDF upload + extraction ───
  async function handlePDFs(files: FileList) {
    setPdfParsing(true)
    const results: ParsedInvoice[] = []

    for (const file of Array.from(files)) {
      try {
        const base64 = await fileToBase64(file)
        const { data, error } = await supabase.functions.invoke('extract-invoice', {
          body: { pdf_base64: base64 },
        })

        if (error || !data?.success) {
          const errMsg = data?.error || error?.message || 'שגיאה לא ידועה'
          const details = data?.details ? ` (${data.details.slice(0, 100)})` : ''
          results.push({
            customer_name: '', invoice_number: '', invoice_date: '', total_before_vat: 0,
            fileName: file.name, status: 'error', error: errMsg + details,
          })
          continue
        }

        const inv = data.data
        // Check duplicate
        let status: ParsedInvoice['status'] = 'parsed'
        let duplicateId: number | undefined
        if (inv.invoice_number) {
          const { data: existing } = await supabase.from('external_sales')
            .select('id').eq('invoice_number', inv.invoice_number).maybeSingle()
          if (existing) { status = 'duplicate'; duplicateId = existing.id }
        }

        results.push({
          customer_name: inv.customer_name || '',
          invoice_number: inv.invoice_number || '',
          invoice_date: inv.invoice_date || '',
          total_before_vat: Number(inv.total_before_vat) || 0,
          fileName: file.name,
          status,
          duplicateId,
        })
      } catch (err) {
        results.push({
          customer_name: '', invoice_number: '', invoice_date: '', total_before_vat: 0,
          fileName: file.name, status: 'error', error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    setParsedInvoices(results)
    setPdfParsing(false)
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1]) // strip data:...;base64, prefix
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function updateParsed(idx: number, field: string, value: string | number) {
    setParsedInvoices(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }

  async function saveParsedInvoice(idx: number, overwrite: boolean = false) {
    const inv = parsedInvoices[idx]
    if (!inv.customer_name || !inv.invoice_date) return

    const dbDate = parseDateToDB(inv.invoice_date)
    const payload = {
      customer_name: inv.customer_name,
      invoice_number: inv.invoice_number || null,
      invoice_date: dbDate,
      total_before_vat: inv.total_before_vat,
      uploaded_by: appUser?.name || null,
    }

    if (overwrite && inv.duplicateId) {
      await supabase.from('external_sales').update(payload).eq('id', inv.duplicateId)
    } else {
      await supabase.from('external_sales').insert(payload)
    }

    setParsedInvoices(prev => prev.map((p, i) => i === idx ? { ...p, status: 'saved' } : p))
  }

  function skipParsed(idx: number) {
    setParsedInvoices(prev => prev.map((p, i) => i === idx ? { ...p, status: 'saved' } : p))
  }

  // ─── History CRUD ───
  async function saveEdit(id: number) {
    await supabase.from('external_sales').update(editData).eq('id', id)
    setEditId(null); loadHistory()
  }

  async function handleDelete(sale: ExtSale) {
    await supabase.from('external_sales').delete().eq('id', sale.id)
    setDeleteConfirm(null); loadHistory()
  }

  const filteredSales = histSearch
    ? sales.filter(s => s.customer_name.includes(histSearch) || s.invoice_number?.includes(histSearch))
    : sales
  const totalSales = filteredSales.reduce((s, e) => s + Number(e.total_before_vat), 0)

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="מכירות חיצוניות (B2B)" subtitle="חשבוניות מס · לקוחות עסקיים" onBack={onBack} />
      <div style={S.container}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
          <button style={S.tab(tab === 'manual')} onClick={() => setTab('manual')}>
            <Plus size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> הוספה ידנית
          </button>
          <button style={S.tab(tab === 'pdf')} onClick={() => setTab('pdf')}>
            <Upload size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> העלאת PDF
          </button>
          <button style={S.tab(tab === 'history')} onClick={() => setTab('history')}>
            <History size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> היסטוריה
          </button>
        </div>

        {/* ═══ MANUAL TAB ═══ */}
        {tab === 'manual' && (
          <Card className="shadow-sm">
            <CardContent className="p-6">
              <h2 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: '#374151' }}>הוספת מכירה</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
                <div><label style={S.label}>שם לקוח</label>
                  <input type="text" value={manualCustomer} onChange={e => setManualCustomer(e.target.value)} placeholder="שם הלקוח..." style={S.input} /></div>
                <div><label style={S.label}>מספר חשבונית</label>
                  <input type="text" value={manualInvoice} onChange={e => setManualInvoice(e.target.value)} placeholder="אופציונלי" style={S.input} /></div>
                <div><label style={S.label}>תאריך</label>
                  <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} style={S.input} /></div>
                <div><label style={S.label}>סה"כ לפני מע"מ (₪)</label>
                  <input type="number" value={manualAmount} onChange={e => setManualAmount(e.target.value)} placeholder="0"
                    onKeyDown={e => e.key === 'Enter' && addManual()} style={S.input} /></div>
              </div>
              <button onClick={addManual} disabled={manualSaving || !manualCustomer || !manualAmount}
                style={{ ...S.btn, background: !manualCustomer || !manualAmount ? '#e2e8f0' : '#0f172a', color: !manualCustomer || !manualAmount ? '#94a3b8' : 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={16} /> הוסף
              </button>
            </CardContent>
          </Card>
        )}

        {/* ═══ PDF TAB ═══ */}
        {tab === 'pdf' && (
          <div style={S.card}>
            {parsedInvoices.length === 0 && !pdfParsing && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <FileText size={48} color="#94a3b8" style={{ marginBottom: 16 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>העלאת חשבוניות PDF</h3>
                <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
                  העלה חשבוניות מס — המערכת תחלץ אוטומטית שם לקוח, מספר חשבונית, תאריך וסכום
                </p>
                <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.length) handlePDFs(e.target.files) }} />
                <button onClick={() => fileRef.current?.click()}
                  style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Upload size={16} /> בחר קבצים
                </button>
              </div>
            )}

            {pdfParsing && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: '#64748b' }}>
                <div style={{ fontSize: 14 }}>מעבד חשבוניות... ⏳</div>
              </div>
            )}

            {parsedInvoices.length > 0 && !pdfParsing && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                    תצוגה מקדימה — {parsedInvoices.length} חשבוניות
                  </h3>
                  <button onClick={() => { setParsedInvoices([]); if (fileRef.current) fileRef.current.value = '' }}
                    style={{ ...S.btn, background: '#f1f5f9', color: '#64748b' }}>נקה</button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={S.th}>קובץ</th>
                    <th style={S.th}>שם לקוח</th>
                    <th style={S.th}>מס' חשבונית</th>
                    <th style={S.th}>תאריך</th>
                    <th style={{ ...S.th, width: 110 }}>סה"כ לפני מע"מ</th>
                    <th style={{ ...S.th, width: 120 }}></th>
                  </tr></thead>
                  <tbody>
                    {parsedInvoices.map((inv, i) => (
                      <tr key={i} style={{ background: inv.status === 'error' ? '#fef2f2' : inv.status === 'duplicate' ? '#fefce8' : inv.status === 'saved' ? '#f0fdf4' : i % 2 === 0 ? 'white' : '#fafbfc' }}>
                        <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.fileName}</td>
                        <td style={S.td}>
                          {inv.status === 'saved' ? inv.customer_name : (
                            <input type="text" value={inv.customer_name} onChange={e => updateParsed(i, 'customer_name', e.target.value)}
                              style={{ ...S.input, padding: '4px 8px', fontSize: 12 }} />
                          )}
                        </td>
                        <td style={S.td}>
                          {inv.status === 'saved' ? inv.invoice_number : (
                            <input type="text" value={inv.invoice_number} onChange={e => updateParsed(i, 'invoice_number', e.target.value)}
                              style={{ ...S.input, padding: '4px 8px', fontSize: 12 }} />
                          )}
                        </td>
                        <td style={S.td}>
                          {inv.status === 'saved' ? inv.invoice_date : (
                            <input type="text" value={inv.invoice_date} onChange={e => updateParsed(i, 'invoice_date', e.target.value)}
                              placeholder="DD/MM/YYYY" style={{ ...S.input, padding: '4px 8px', fontSize: 12, width: 100 }} />
                          )}
                        </td>
                        <td style={{ ...S.td, fontWeight: 600 }}>
                          {inv.status === 'saved' ? fmtMoney(inv.total_before_vat) : (
                            <input type="number" step="0.01" value={inv.total_before_vat} onChange={e => updateParsed(i, 'total_before_vat', Number(e.target.value) || 0)}
                              style={{ ...S.input, padding: '4px 8px', fontSize: 12, width: 90 }} />
                          )}
                        </td>
                        <td style={S.td}>
                          {inv.status === 'error' && (
                            <span style={{ fontSize: 11, color: '#dc2626' }}>❌ {inv.error}</span>
                          )}
                          {inv.status === 'saved' && (
                            <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>✅ נשמר</span>
                          )}
                          {inv.status === 'parsed' && (
                            <button onClick={() => saveParsedInvoice(i)}
                              style={{ ...S.btn, padding: '4px 12px', fontSize: 11, background: '#0f172a', color: 'white' }}>
                              שמור
                            </button>
                          )}
                          {inv.status === 'duplicate' && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => saveParsedInvoice(i, true)}
                                style={{ ...S.btn, padding: '3px 8px', fontSize: 10, background: '#f59e0b', color: 'white' }}>עדכן</button>
                              <button onClick={() => skipParsed(i)}
                                style={{ ...S.btn, padding: '3px 8px', fontSize: 10, background: '#f1f5f9', color: '#64748b' }}>דלג</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedInvoices.some(i => i.status === 'duplicate') && (
                  <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginTop: 12, fontSize: 13, color: '#a16207' }}>
                    ⚠ חשבוניות מסומנות בצהוב כבר קיימות במערכת
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {tab === 'history' && (
          <div style={S.card}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <PeriodPicker period={period} onChange={setPeriod} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={S.label}>חיפוש</label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', right: 10, top: 10 }} />
                  <input type="text" placeholder="לקוח או מספר חשבונית..." value={histSearch} onChange={e => setHistSearch(e.target.value)}
                    style={{ ...S.input, paddingRight: 32 }} />
                </div>
              </div>
            </div>

            {histLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>טוען...</div>
            ) : filteredSales.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>אין מכירות בתקופה זו</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={S.th}>תאריך</th>
                    <th style={S.th}>חשבונית</th>
                    <th style={S.th}>לקוח</th>
                    <th style={{ ...S.th, width: 110 }}>סה"כ</th>
                    <th style={{ ...S.th, width: 80 }}></th>
                  </tr></thead>
                  <tbody>
                    {filteredSales.map((s, i) => {
                      const isEditing = editId === s.id
                      return (
                        <tr key={s.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                          <td style={S.td}>
                            {isEditing
                              ? <input type="date" value={editData.invoice_date || s.invoice_date} onChange={e => setEditData(p => ({ ...p, invoice_date: e.target.value }))} style={{ ...S.input, width: 130, padding: '4px 8px' }} />
                              : fmtDate(s.invoice_date)
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing
                              ? <input type="text" value={editData.invoice_number ?? s.invoice_number ?? ''} onChange={e => setEditData(p => ({ ...p, invoice_number: e.target.value }))} style={{ ...S.input, width: 100, padding: '4px 8px' }} />
                              : (s.invoice_number || '—')
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing
                              ? <input type="text" value={editData.customer_name ?? s.customer_name} onChange={e => setEditData(p => ({ ...p, customer_name: e.target.value }))} style={{ ...S.input, padding: '4px 8px' }} />
                              : <span style={{ fontWeight: 500 }}>{s.customer_name}</span>
                            }
                          </td>
                          <td style={{ ...S.td, fontWeight: 600 }}>
                            {isEditing
                              ? <input type="number" step="0.01" value={editData.total_before_vat ?? s.total_before_vat} onChange={e => setEditData(p => ({ ...p, total_before_vat: Number(e.target.value) }))} style={{ ...S.input, width: 90, padding: '4px 8px' }} />
                              : fmtMoney(s.total_before_vat)
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: 3 }}>
                                <button onClick={() => saveEdit(s.id)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#0f172a', color: 'white' }}><Check size={12} /></button>
                                <button onClick={() => setEditId(null)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#f1f5f9', color: '#64748b' }}><X size={12} /></button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 3 }}>
                                <button onClick={() => { setEditId(s.id); setEditData({}) }} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#f1f5f9', color: '#6366f1' }}><Pencil size={12} /></button>
                                <button onClick={() => setDeleteConfirm(s)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 8px', borderTop: '2px solid #e2e8f0', marginTop: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{filteredSales.length} רשומות</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>סה"כ: {fmtMoney(totalSales)}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Delete confirm */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 380, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>מחיקת חשבונית</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>
              למחוק חשבונית {deleteConfirm.invoice_number || ''} של {deleteConfirm.customer_name}?
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ ...S.btn, background: '#ef4444', color: 'white' }}>מחק</button>
              <button onClick={() => setDeleteConfirm(null)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
