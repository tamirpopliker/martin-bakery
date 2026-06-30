// ═══════════════════════════════════════════════════════════════════════════
// RegisterReconciliation — verify register_closings entries against CashOnTab PDF
// ═══════════════════════════════════════════════════════════════════════════
// Admin sees a branch picker; branch managers are locked to their own branch.
// Reads register_closings for the selected period + branch, accepts a CashOnTab
// "השוואת מכירות — יומי" PDF, and renders a per-day diff table.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, ChevronDown, ChevronUp, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAppUser, isRestrictedBranchUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import PageHeader from '../components/PageHeader'
import { parseCashOnTabPDF, type CashOnTabRow } from '../lib/parseCashOnTab'
import {
  reconcile, STATUS_LABEL, STATUS_STYLE,
  type AppClosing, type DiffRow, type ReconStatus,
} from '../lib/reconcileRegisterClosings'

interface Props { onBack: () => void }

const WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const fmtN = (n: number | null) => n === null ? '—' : '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })

export default function RegisterReconciliation({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const { period, setPeriod, from, to } = usePeriod()

  // Branch lock for branch users; admin can switch.
  const isBranchUser = appUser?.role === 'branch' && !!appUser.branch_id
  const [branchId, setBranchId] = useState<number | null>(
    isBranchUser ? appUser!.branch_id! : null
  )
  useEffect(() => {
    // When the branch list arrives (admin), default to the first branch.
    if (branchId === null && !isBranchUser && branches.length > 0) {
      setBranchId(branches[0].id)
    }
  }, [branches, branchId, isBranchUser])

  const [posRows, setPosRows] = useState<CashOnTabRow[]>([])
  const [posFileName, setPosFileName] = useState('')
  const [appRows, setAppRows] = useState<AppClosing[]>([])
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [filterOnlyDiffs, setFilterOnlyDiffs] = useState(false)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Load app rows whenever branch/period changes.
  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    setLoading(true)
    supabase.from('register_closings')
      .select('date, register_number, cash_sales, credit_sales, transaction_count')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .order('date', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Load register_closings failed:', error)
          setError('שגיאה בטעינת סגירות הקופה: ' + error.message)
          setAppRows([])
        } else {
          setAppRows((data || []).map((r: any) => ({
            date: r.date,
            register_number: Number(r.register_number),
            cash_sales: Number(r.cash_sales || 0),
            credit_sales: Number(r.credit_sales || 0),
            transaction_count: Number(r.transaction_count || 0),
          })))
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [branchId, from, to])

  async function handleFile(file: File) {
    setError('')
    setParsing(true)
    try {
      const rows = await parseCashOnTabPDF(file)
      if (rows.length === 0) {
        setError('לא נמצאו שורות בקובץ. ודאי שזה דוח "השוואת מכירות — יומי" של CashOnTab.')
        setPosRows([])
        setPosFileName('')
      } else {
        setPosRows(rows)
        setPosFileName(file.name)
      }
    } catch (err: any) {
      console.error('Parse CashOnTab failed:', err)
      setError('שגיאה בקריאת הקובץ: ' + (err?.message || String(err)))
    } finally {
      setParsing(false)
    }
  }

  const diff = useMemo<DiffRow[]>(() => {
    if (!branchId) return []
    return reconcile(posRows, appRows, from, to)
  }, [posRows, appRows, branchId, from, to])

  const visible = useMemo(() => {
    if (!filterOnlyDiffs) return diff
    return diff.filter(r => r.status !== 'match' && r.status !== 'shabbat')
  }, [diff, filterOnlyDiffs])

  const counters = useMemo(() => {
    const c: Record<ReconStatus, number> = {
      match: 0, amount_diff: 0, count_diff: 0, both_diff: 0,
      missing_app: 0, missing_pos: 0, shabbat: 0,
    }
    for (const r of diff) c[r.status]++
    return c
  }, [diff])

  function exportDiffsToExcel() {
    const rows = diff.filter(r => r.status !== 'match' && r.status !== 'shabbat')
    if (rows.length === 0) {
      setError('אין פערים לייצוא')
      return
    }
    const branchName = branches.find(b => b.id === branchId)?.name || ''
    const data = rows.map(r => ({
      'תאריך': fmtDate(r.date),
      'יום': WEEKDAY_SHORT[new Date(r.date + 'T12:00:00').getDay()],
      'סטטוס': STATUS_LABEL[r.status],
      'POS — נטו': r.posAmount,
      'אפליקציה — נטו': r.appAmount,
      'הפרש סכום': r.amountDelta,
      'POS — עסקאות': r.posTransactions,
      'אפליקציה — עסקאות': r.appTransactions,
      'הפרש עסקאות': r.txDelta,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'פערים')
    XLSX.writeFile(wb, `פערי-קופה_${branchName}_${from}.xlsx`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="בקרת סגירות קופה" subtitle="השוואת קובץ CashOnTab מול האפליקציה" onBack={onBack} />

      <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Filters bar */}
        <div style={{
          background: 'white', borderRadius: 12, border: '1px solid #f1f5f9',
          padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          {!isBranchUser && branches.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {branches.map(br => {
                const active = branchId === br.id
                return (
                  <button key={br.id} onClick={() => setBranchId(br.id)} style={{
                    background: active ? '#0f172a' : '#f8fafc',
                    color: active ? 'white' : '#475569',
                    border: '1px solid ' + (active ? '#0f172a' : '#e2e8f0'),
                    borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>{br.name}</button>
                )
              })}
            </div>
          )}
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ marginRight: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setFilterOnlyDiffs(v => !v)} style={{
              background: filterOnlyDiffs ? '#0f172a' : '#f8fafc',
              color: filterOnlyDiffs ? 'white' : '#475569',
              border: '1px solid ' + (filterOnlyDiffs ? '#0f172a' : '#e2e8f0'),
              borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>{filterOnlyDiffs ? 'מציג רק פערים' : 'מציג הכל'}</button>
            <button onClick={exportDiffsToExcel} disabled={!posRows.length} style={{
              background: 'white', color: '#0f172a', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600,
              cursor: posRows.length ? 'pointer' : 'not-allowed',
              opacity: posRows.length ? 1 : 0.5, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Download size={14} /> ייצא פערים
            </button>
          </div>
        </div>

        {/* Upload */}
        <div style={{
          background: 'white', borderRadius: 12, border: '1px dashed #cbd5e1',
          padding: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: '#eef2ff', color: '#4338ca',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              {posFileName || 'העלה דוח "השוואת מכירות — יומי" מ-CashOnTab (PDF)'}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {posRows.length > 0
                ? `${posRows.length} ימים מהקובץ · בתקופה ${from} – ${to}`
                : 'הקובץ נשלף ישירות מ-CashOnTab. כל הסניפים מאוחדים ליום אחד.'}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={parsing} style={{
            background: '#4338ca', color: 'white', border: 'none', borderRadius: 10,
            padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            opacity: parsing ? 0.6 : 1, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Upload size={16} /> {parsing ? 'מנתח...' : posFileName ? 'החלף קובץ' : 'בחר קובץ'}
          </button>
        </div>

        {/* Counters */}
        {posRows.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <CounterChip label="תואם"        value={counters.match}       style={STATUS_STYLE.match} />
            <CounterChip label="פערים"       value={counters.amount_diff + counters.count_diff + counters.both_diff} style={STATUS_STYLE.amount_diff} />
            <CounterChip label="חסר באפליקציה" value={counters.missing_app} style={STATUS_STYLE.missing_app} />
            <CounterChip label="חסר בקובץ"  value={counters.missing_pos} style={STATUS_STYLE.missing_pos} />
            <CounterChip label="שבת"         value={counters.shabbat}     style={STATUS_STYLE.shabbat} />
          </div>
        )}

        {error && (
          <div style={{ background: '#fef2f2', color: '#991b1b', fontSize: 13, padding: '10px 14px', borderRadius: 8, border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}

        {/* Table */}
        {!branchId ? (
          <div style={{ background: 'white', borderRadius: 12, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            בחרי סניף כדי להתחיל
          </div>
        ) : loading ? (
          <div style={{ background: 'white', borderRadius: 12, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            טוען...
          </div>
        ) : posRows.length === 0 ? (
          <div style={{ background: 'white', borderRadius: 12, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            העלי קובץ CashOnTab כדי להתחיל את ההשוואה
          </div>
        ) : visible.length === 0 ? (
          <div style={{ background: 'white', borderRadius: 12, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            {filterOnlyDiffs ? 'אין פערים בתקופה — הכל תואם 🎉' : 'אין נתונים בתקופה הנבחרת'}
          </div>
        ) : (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    {['תאריך','יום','סטטוס','POS — נטו','אפליקציה — נטו','Δ','POS — עסקאות','אפליקציה — עסקאות','Δ','פירוט'].map((h, i) => (
                      <th key={i} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const wd = WEEKDAY_SHORT[new Date(row.date + 'T12:00:00').getDay()]
                    const st = STATUS_STYLE[row.status]
                    const expanded = expandedDate === row.date
                    return (
                      <>
                        <motion.tr
                          key={row.date}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          style={{ borderBottom: '1px solid #f8fafc', cursor: row.appRegisters.length > 0 ? 'pointer' : 'default' }}
                          onClick={() => row.appRegisters.length > 0 && setExpandedDate(expanded ? null : row.date)}
                        >
                          <td style={{ padding: '10px 12px', color: '#475569', whiteSpace: 'nowrap' }}>{fmtDate(row.date)}</td>
                          <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{wd}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{
                              background: st.bg, color: st.color, fontSize: 11, fontWeight: 700,
                              padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                            }}>{STATUS_LABEL[row.status]}</span>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#0f172a', fontWeight: 600 }}>{fmtN(row.posAmount)}</td>
                          <td style={{ padding: '10px 12px', color: '#0f172a', fontWeight: 600 }}>{fmtN(row.appAmount)}</td>
                          <td style={{
                            padding: '10px 12px', fontWeight: 700,
                            color: row.amountDelta === null ? '#94a3b8'
                              : Math.abs(row.amountDelta) <= 1 ? '#94a3b8'
                              : row.amountDelta > 0 ? '#0284c7' : '#dc2626',
                          }}>
                            {row.amountDelta === null ? '—'
                              : Math.abs(row.amountDelta) <= 1 ? '—'
                              : (row.amountDelta > 0 ? '+' : '') + fmtN(row.amountDelta).replace('₪', '₪')}
                          </td>
                          <td style={{ padding: '10px 12px', color: '#0f172a' }}>{row.posTransactions ?? '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#0f172a' }}>{row.appTransactions ?? '—'}</td>
                          <td style={{
                            padding: '10px 12px', fontWeight: 700,
                            color: row.txDelta === null ? '#94a3b8'
                              : row.txDelta === 0 ? '#94a3b8'
                              : row.txDelta > 0 ? '#0284c7' : '#dc2626',
                          }}>
                            {row.txDelta === null ? '—'
                              : row.txDelta === 0 ? '—'
                              : (row.txDelta > 0 ? '+' : '') + row.txDelta}
                          </td>
                          <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                            {row.appRegisters.length > 0 ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                {row.appRegisters.length} קופות
                                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </span>
                            ) : '—'}
                          </td>
                        </motion.tr>
                        {expanded && row.appRegisters.length > 0 && (
                          <tr style={{ background: '#fafbfc', borderBottom: '1px solid #f8fafc' }}>
                            <td colSpan={10} style={{ padding: '10px 28px' }}>
                              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 700 }}>פירוט לפי קופה (נתוני האפליקציה, נטו):</div>
                              <table style={{ width: '100%', fontSize: 12 }}>
                                <thead>
                                  <tr style={{ color: '#94a3b8' }}>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>קופה</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>מזומן</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>אשראי</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>סה״כ</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>עסקאות</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.appRegisters.map(reg => (
                                    <tr key={reg.register_number} style={{ color: '#475569' }}>
                                      <td style={{ padding: '4px 8px', fontWeight: 700, color: '#0f172a' }}>#{reg.register_number}</td>
                                      <td style={{ padding: '4px 8px' }}>{fmtN(reg.cash_sales)}</td>
                                      <td style={{ padding: '4px 8px' }}>{fmtN(reg.credit_sales)}</td>
                                      <td style={{ padding: '4px 8px', fontWeight: 600 }}>{fmtN(reg.cash_sales + reg.credit_sales)}</td>
                                      <td style={{ padding: '4px 8px' }}>{reg.transaction_count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isRestrictedBranchUser(appUser || ({ role: '', email: '' } as any)) && (
          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: 8 }}>הדף לא זמין למשתמשי קופה.</div>
        )}
      </div>
    </div>
  )
}

function CounterChip({ label, value, style }: { label: string; value: number; style: { bg: string; color: string } }) {
  return (
    <span style={{
      background: style.bg, color: style.color, fontSize: 12, fontWeight: 700,
      padding: '5px 12px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <span>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 800 }}>{value}</span>
    </span>
  )
}
