// ═══════════════════════════════════════════════════════════════════════════
// RegisterReconciliation — verify register_closings entries against CashOnTab
// ═══════════════════════════════════════════════════════════════════════════
// Admin sees a branch picker; branch managers are locked to their own branch.
// Reads register_closings for the selected period + branch, accepts a
// CashOnTab .xlsx export, and renders a per-(date,register) diff table.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileSpreadsheet, Download, Info, ChevronDown, ChevronUp } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAppUser, isRestrictedBranchUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import PageHeader from '../components/PageHeader'
import { parseCashOnTabExcel, type PosClosingRow } from '../lib/parseCashOnTabExcel'
import {
  reconcile, STATUS_LABEL, STATUS_STYLE,
  type AppClosing, type DiffRow, type ReconStatus,
} from '../lib/reconcileRegisterClosings'

interface Props { onBack: () => void }

const WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const fmtN = (n: number | null) => n === null ? '—' : '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })
const fmtDelta = (n: number | null) => {
  if (n === null) return '—'
  if (Math.abs(n) <= 1) return '—'
  return (n > 0 ? '+' : '') + '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })
}
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
const deltaColor = (n: number | null) => n === null || Math.abs(n) <= 1 ? '#94a3b8' : n > 0 ? '#0284c7' : '#dc2626'

export default function RegisterReconciliation({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const { period, setPeriod, from, to } = usePeriod()

  const isBranchUser = appUser?.role === 'branch' && !!appUser.branch_id
  const [branchId, setBranchId] = useState<number | null>(
    isBranchUser ? appUser!.branch_id! : null
  )
  useEffect(() => {
    if (branchId === null && !isBranchUser && branches.length > 0) {
      setBranchId(branches[0].id)
    }
  }, [branches, branchId, isBranchUser])

  const [posRows, setPosRows] = useState<PosClosingRow[]>([])
  const [posFileName, setPosFileName] = useState('')
  const [appRows, setAppRows] = useState<AppClosing[]>([])
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [filterOnlyDiffs, setFilterOnlyDiffs] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
      const rows = await parseCashOnTabExcel(file)
      if (rows.length === 0) {
        setError('לא נמצאו שורות בקובץ. ודאי שזה דוח סגירות מ-CashOnTab בפורמט Excel (טור D=קופה, H=תאריך, K=סה״כ, L=מזומן, N=אשראי).')
        setPosRows([])
        setPosFileName('')
      } else {
        setPosRows(rows)
        setPosFileName(file.name)
      }
    } catch (err: any) {
      console.error('Parse CashOnTab Excel failed:', err)
      setError('שגיאה בקריאת הקובץ: ' + (err?.message || String(err)))
    } finally {
      setParsing(false)
    }
  }

  // Filter app rows by the selected branch (already done in query) and POS by
  // the period dates — the file might include days outside the picker.
  const posInPeriod = useMemo(
    () => posRows.filter(r => r.date >= from && r.date < to),
    [posRows, from, to]
  )

  const diff = useMemo<DiffRow[]>(() => {
    if (!branchId) return []
    return reconcile(posInPeriod, appRows)
  }, [posInPeriod, appRows, branchId])

  const visible = useMemo(() => {
    if (!filterOnlyDiffs) return diff
    return diff.filter(r => r.status !== 'match')
  }, [diff, filterOnlyDiffs])

  const counters = useMemo(() => {
    const c: Record<ReconStatus, number> = {
      match: 0, cash_diff: 0, credit_diff: 0, both_diff: 0,
      missing_app: 0, missing_pos: 0,
    }
    for (const r of diff) c[r.status]++
    return c
  }, [diff])

  function exportDiffsToExcel() {
    const rows = diff.filter(r => r.status !== 'match')
    if (rows.length === 0) {
      setError('אין פערים לייצוא')
      return
    }
    const branchName = branches.find(b => b.id === branchId)?.name || ''
    const data = rows.map(r => ({
      'תאריך': fmtDate(r.date),
      'יום': WEEKDAY_SHORT[new Date(r.date + 'T12:00:00').getDay()],
      'קופה': r.register_number,
      'סטטוס': STATUS_LABEL[r.status],
      'POS — מזומן': r.posCash,
      'אפליקציה — מזומן': r.appCash,
      'Δ מזומן': r.cashDelta,
      'POS — אשראי': r.posCredit,
      'אפליקציה — אשראי': r.appCredit,
      'Δ אשראי': r.creditDelta,
      'POS — סה״כ': r.posTotal,
      'אפליקציה — סה״כ': r.appTotal,
      'Δ סה״כ': r.totalDelta,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'פערים')
    XLSX.writeFile(wb, `פערי-קופה_${branchName}_${from}.xlsx`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="בקרת סגירות קופה" subtitle="השוואת קובץ CashOnTab (Excel) מול האפליקציה" onBack={onBack} />

      <div style={{ padding: '20px', maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
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

        {/* How-to: where to get the right file from CashOnTab */}
        <div style={{ background: '#eff6ff', borderRadius: 12, border: '1px solid #bfdbfe' }}>
          <button onClick={() => setHowToOpen(v => !v)} style={{
            width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
            justifyContent: 'space-between', fontFamily: 'inherit', textAlign: 'right',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#1e40af' }}>
              <Info size={16} />
              איך להוריד את הקובץ הנכון מ-CashOnTab?
            </span>
            {howToOpen ? <ChevronUp size={16} color="#1e40af" /> : <ChevronDown size={16} color="#1e40af" />}
          </button>
          {howToOpen && (
            <div style={{ padding: '4px 18px 16px', fontSize: 13, color: '#1e3a8a', lineHeight: 1.8 }}>
              <ol style={{ margin: 0, paddingInlineStart: 22 }}>
                <li>נכנסים ל-CashOnTab → עמוד <strong>סיכום תקבולים לפי דוח Z</strong></li>
                <li>בוחרים <strong>דו"ח מפורט לפי תקבול</strong></li>
                <li>בוחרים את <strong>התאריך</strong> הרצוי</li>
                <li>בוחרים את <strong>כל הקופות של הסניף</strong></li>
                <li>מייצאים ל<strong>גיליון אקסל</strong> ומעלים כאן</li>
              </ol>
            </div>
          )}
        </div>

        {/* Upload */}
        <div style={{
          background: 'white', borderRadius: 12, border: '1px dashed #cbd5e1',
          padding: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: '#ecfdf5', color: '#047857',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileSpreadsheet size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              {posFileName || 'העלי קובץ Excel של סגירות CashOnTab'}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {posRows.length > 0
                ? `${posRows.length} שורות מהקובץ · בתקופה ${from} – ${to}: ${posInPeriod.length}`
                : 'עמודות צפויות: D=קוד קופה · H=תאריך · K=סה״כ · L=מזומן · N=אשראי. הסכומים בקובץ ברוטו, מומרים לנטו אוטומטית.'}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={parsing} style={{
            background: '#047857', color: 'white', border: 'none', borderRadius: 10,
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
            <CounterChip label="פערים"       value={counters.cash_diff + counters.credit_diff + counters.both_diff} style={STATUS_STYLE.cash_diff} />
            <CounterChip label="חסר באפליקציה" value={counters.missing_app} style={STATUS_STYLE.missing_app} />
            <CounterChip label="חסר בקובץ"  value={counters.missing_pos} style={STATUS_STYLE.missing_pos} />
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
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1100 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    {[
                      'תאריך','יום','קופה','סטטוס',
                      'POS — מזומן','App — מזומן','Δ מזומן',
                      'POS — אשראי','App — אשראי','Δ אשראי',
                      'POS — סה״כ','App — סה״כ','Δ סה״כ',
                    ].map((h, i) => (
                      <th key={i} style={{ padding: '10px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const wd = WEEKDAY_SHORT[new Date(row.date + 'T12:00:00').getDay()]
                    const st = STATUS_STYLE[row.status]
                    return (
                      <motion.tr
                        key={`${row.date}-${row.register_number}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        style={{ borderBottom: '1px solid #f8fafc' }}
                      >
                        <td style={{ padding: '8px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{fmtDate(row.date)}</td>
                        <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{wd}</td>
                        <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 700 }}>#{row.register_number}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{
                            background: st.bg, color: st.color, fontSize: 11, fontWeight: 700,
                            padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                          }}>{STATUS_LABEL[row.status]}</span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 600 }}>{fmtN(row.posCash)}</td>
                        <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 600 }}>{fmtN(row.appCash)}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: deltaColor(row.cashDelta) }}>{fmtDelta(row.cashDelta)}</td>
                        <td style={{ padding: '8px 10px', color: '#3b82f6', fontWeight: 600 }}>{fmtN(row.posCredit)}</td>
                        <td style={{ padding: '8px 10px', color: '#3b82f6', fontWeight: 600 }}>{fmtN(row.appCredit)}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: deltaColor(row.creditDelta) }}>{fmtDelta(row.creditDelta)}</td>
                        <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 700 }}>{fmtN(row.posTotal)}</td>
                        <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 700 }}>{fmtN(row.appTotal)}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: deltaColor(row.totalDelta) }}>{fmtDelta(row.totalDelta)}</td>
                      </motion.tr>
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
