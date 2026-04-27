import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/PageHeader'
import {
  DollarSign, CreditCard, Wallet, CheckCircle2, AlertCircle,
  Camera, X, ArrowRight, ArrowLeft, FileSpreadsheet, History, Calculator, Pencil, Home as HomeIcon,
  Zap, Archive, Trash2
} from 'lucide-react'
import * as XLSX from 'xlsx'

// ─── Constants ──────────────────────────────────────────────────────────────
const BRANCH_REGISTERS: Record<number, number[]> = {
  1: [1, 2, 3, 6],
  2: [4, 5, 7],
  3: [9, 10, 11, 13],
}

const BILL_DENOMS = [200, 100, 50, 20]
const COIN_DENOMS = [10, 5, 2, 1, 0.5, 0.1]

// VAT — המשתמש מזין ב-wizard ברוטו (כולל מע"מ). DB שומר רק נטו ב-cash_sales/credit_sales.
// כל שאר השדות (actual_cash, deposit_amount, variance, opening, next_opening_balance) נשארים ברוטו פיזי.
const VAT_RATE = 0.18
const VAT_DIVIDER = 1 + VAT_RATE  // 1.18

const BILL_IMAGES: Record<string, string> = {
  '200': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/INS-200-NIS-%282015%29-front.jpg/320px-INS-200-NIS-%282015%29-front.jpg',
  '100': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/INS-100-NIS-%282017%29-front.jpg/320px-INS-100-NIS-%282017%29-front.jpg',
  '50':  'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/INS-50-NIS-%282014%29-front.jpg/320px-INS-50-NIS-%282014%29-front.jpg',
  '20':  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/INS-20-NIS-%282017%29-front.jpg/320px-INS-20-NIS-%282017%29-front.jpg',
}
const COIN_IMAGES: Record<string, string> = {
  '10':  'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/10_NIS_obverse.jpg/120px-10_NIS_obverse.jpg',
  '5':   'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/5_NIS_obverse.jpg/120px-5_NIS_obverse.jpg',
  '2':   'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/2_NIS_obverse.jpg/120px-2_NIS_obverse.jpg',
  '1':   'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/1_NIS_obverse.jpg/120px-1_NIS_obverse.jpg',
  '0.5': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Half_NIS_obverse.jpg/120px-Half_NIS_obverse.jpg',
  '0.1': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/10_agorot_obverse.jpg/120px-10_agorot_obverse.jpg',
}

const DENOM_LABELS: Record<string, string> = {
  '0.5': '½ ₪',
  '0.1': '10 אג׳',
}

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface Closing {
  id: number
  branch_id: number
  date: string
  register_number: number
  opening_balance: number
  cash_sales: number
  credit_sales: number
  transaction_count: number | null
  actual_cash: number
  deposit_amount: number
  variance: number
  variance_action: string | null
  next_opening_balance: number
  notes: string | null
  created_at: string
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } } }

function todayISO() { return new Date().toISOString().split('T')[0] }
function fmt(n: number) { return '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) }
function fmtDec(n: number) { return '₪' + n.toFixed(2) }

// ─── Image with graceful fallback ──────────────────────────────────────────
function DenomImage({ denom, kind }: { denom: number; kind: 'bill' | 'coin' }) {
  const key = String(denom)
  const src = kind === 'bill' ? BILL_IMAGES[key] : COIN_IMAGES[key]
  const [failed, setFailed] = useState(false)
  const displayLabel = DENOM_LABELS[key] || ('₪' + denom)

  const billStyle = { width: 84, height: 44, objectFit: 'contain' as const, borderRadius: 4, flexShrink: 0, background: 'white', border: '1px solid #e2e8f0' }
  const coinStyle = { width: 52, height: 52, objectFit: 'cover' as const, borderRadius: 999, flexShrink: 0, background: 'white', border: '1px solid #e2e8f0' }

  if (!src || failed) {
    if (kind === 'bill') {
      return (
        <div style={{ ...billStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 900 }}>
          {displayLabel}
        </div>
      )
    }
    return (
      <div style={{ ...coinStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fde68a', color: '#92400e', fontSize: 13, fontWeight: 900 }}>
        {displayLabel}
      </div>
    )
  }

  return (
    <img src={src} alt={displayLabel}
      style={kind === 'bill' ? billStyle : coinStyle}
      onError={() => setFailed(true)} />
  )
}

// ─── Denomination Counter (mobile-friendly, with real bill/coin images) ─────
function DenomCounter({ denoms, counts, setCounts, label, kind }: {
  denoms: number[]; counts: Record<string, number>; setCounts: (c: Record<string, number>) => void; label: string; kind: 'bill' | 'coin'
}) {
  return (
    <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {denoms.map(d => {
          const key = String(d)
          const count = counts[key] || 0
          const subtotal = count * d
          const displayLabel = DENOM_LABELS[key] || ('₪' + d)
          const inc = (delta: number) => setCounts({ ...counts, [key]: Math.max(0, (counts[key] || 0) + delta) })
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#f8fafc', borderRadius: 12, minHeight: 68 }}>
              <DenomImage denom={d} kind={kind} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{displayLabel}</div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
                  {subtotal > 0 ? fmtDec(subtotal) : '—'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" onClick={() => inc(-1)} disabled={count === 0}
                  style={{ width: 40, height: 40, borderRadius: 10, background: count === 0 ? '#f1f5f9' : 'white', border: '1.5px solid ' + (count === 0 ? '#e2e8f0' : '#cbd5e1'), color: count === 0 ? '#cbd5e1' : '#0f172a', fontSize: 22, fontWeight: 800, cursor: count === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>−</button>
                <input type="number" min={0} inputMode="numeric" value={count || ''}
                  onChange={e => setCounts({ ...counts, [key]: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ width: 58, height: 40, border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 17, fontWeight: 800, textAlign: 'center', color: '#0f172a', outline: 'none' }} />
                <button type="button" onClick={() => inc(1)}
                  style={{ width: 40, height: 40, borderRadius: 10, background: '#6366f1', border: 'none', color: 'white', fontSize: 22, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>+</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function totalFromCounts(denoms: number[], counts: Record<string, number>): number {
  return denoms.reduce((sum, d) => sum + d * (counts[String(d)] || 0), 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// Wizard — create or edit a closing
// ═══════════════════════════════════════════════════════════════════════════
function ClosingWizard({ branchId, registerNumber, existing, onClose, onSaved }: {
  branchId: number; registerNumber: number; existing?: Closing | null; onClose: () => void; onSaved: () => void
}) {
  const isEdit = !!existing
  const [step, setStep] = useState(1)
  const [date, setDate] = useState(existing?.date || todayISO())
  const [openingBalance, setOpeningBalance] = useState(existing ? String(existing.opening_balance) : '')
  const [prevBalanceLoaded, setPrevBalanceLoaded] = useState(isEdit)

  // NOTE: cash_sales/credit_sales ב-DB נשמרים נטו (ללא מע"מ).
  // ה-wizard מציג ברוטו לקופאי — מכפילים ב-VAT_DIVIDER בעת טעינה.
  // סגירות שנשמרו לפני העדכון של 2026-04-26 והיו עדיין ברוטו ב-DB
  // צריכות להיות מתוקנות ידנית (חלוקה ב-1.18) לפני עריכה דרך ה-wizard.
  const [cashSales, setCashSales] = useState(
    existing ? String(Math.round(Number(existing.cash_sales) * VAT_DIVIDER * 100) / 100) : ''
  )
  const [creditSales, setCreditSales] = useState(
    existing ? String(Math.round(Number(existing.credit_sales) * VAT_DIVIDER * 100) / 100) : ''
  )
  const [txCount, setTxCount] = useState(existing?.transaction_count ? String(existing.transaction_count) : '')
  const [zPhotoParsing, setZPhotoParsing] = useState(false)
  const [zPhotoError, setZPhotoError] = useState('')
  const zFileRef = useRef<HTMLInputElement>(null)

  const [billCounts, setBillCounts] = useState<Record<string, number>>({})
  const [coinCounts, setCoinCounts] = useState<Record<string, number>>({})
  const [actualCashManual, setActualCashManual] = useState(existing ? String(existing.actual_cash) : '')
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  const [manualEntryAmount, setManualEntryAmount] = useState('')

  const [varianceAction, setVarianceAction] = useState<'surplus_fund' | 'documented' | 'kept'>(
    (existing?.variance_action as any) || 'documented'
  )
  const [nextOpeningOverride, setNextOpeningOverride] = useState(
    existing ? String(existing.next_opening_balance) : ''
  )
  const [notes, setNotes] = useState(existing?.notes || '')
  const [saving, setSaving] = useState(false)
  const [largeVarianceAcknowledged, setLargeVarianceAcknowledged] = useState(false)

  // Load previous closing's next_opening_balance as default (only in create mode)
  useEffect(() => {
    if (isEdit) return
    ;(async () => {
      const { data } = await supabase.from('register_closings')
        .select('next_opening_balance, date')
        .eq('branch_id', branchId)
        .eq('register_number', registerNumber)
        .lt('date', date)
        .order('date', { ascending: false })
        .limit(1)
      if (data && data.length > 0) {
        const rounded = Math.round(Number(data[0].next_opening_balance) * 100) / 100
        setOpeningBalance(String(rounded))
      } else {
        setOpeningBalance('0')
      }
      setPrevBalanceLoaded(true)
    })()
  }, [branchId, registerNumber, isEdit])

  const countedFromDenom = totalFromCounts(BILL_DENOMS, billCounts) + totalFromCounts(COIN_DENOMS, coinCounts)
  const hasDenomEntries = countedFromDenom > 0 || Object.values(billCounts).some(v => v > 0) || Object.values(coinCounts).some(v => v > 0)
  const countedCash = hasDenomEntries ? countedFromDenom : (parseFloat(actualCashManual) || 0)

  const opening = parseFloat(openingBalance) || 0
  const cash = parseFloat(cashSales) || 0
  const credit = parseFloat(creditSales) || 0
  const expectedCash = opening + cash
  const depositToBag = cash
  const defaultNextOpening = Math.round((countedCash - cash) * 100) / 100
  const variance = countedCash - expectedCash
  const isLargeVariance = Math.abs(variance) > 50

  // Reset large-variance acknowledgment when the count changes
  useEffect(() => { setLargeVarianceAcknowledged(false) }, [countedCash])

  async function handleZPhoto(file: File) {
    setZPhotoError(''); setZPhotoParsing(true)
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const mediaType = file.type || 'image/jpeg'
      const { data, error } = await supabase.functions.invoke('extract-invoice', {
        body: { image_base64: base64, image_media_type: mediaType, extract_type: 'z_report' }
      })
      if (error) throw new Error(error.message)
      if (data?.success && data.data) {
        if (data.data.cash_sales != null) setCashSales(String(data.data.cash_sales))
        if (data.data.credit_sales != null) setCreditSales(String(data.data.credit_sales))
      } else {
        setZPhotoError('לא הצלחתי לחלץ נתונים — הזן ידנית')
      }
    } catch (e: any) {
      setZPhotoError('שגיאה: ' + (e?.message || 'לא ידוע'))
    }
    setZPhotoParsing(false)
  }

  async function getCurrentFundBalance(): Promise<number> {
    const { data } = await supabase.from('change_fund')
      .select('balance_after')
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(1)
    return data && data.length > 0 ? Number(data[0].balance_after) : 0
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const chosenNext = nextOpeningOverride !== '' ? parseFloat(nextOpeningOverride) : defaultNextOpening
      // הקופאי הזין ברוטו (כולל מע"מ). DB שומר נטו.
      // המרה רק כאן, בנקודת הקצה — כל שאר ה-state ב-wizard נשאר ברוטו.
      const cashGross = cash       // ערך הברוטו מה-state (parseFloat(cashSales))
      const creditGross = credit
      const cashNet = Math.round((cashGross / VAT_DIVIDER) * 100) / 100
      const creditNet = Math.round((creditGross / VAT_DIVIDER) * 100) / 100
      const deposit = cashGross    // הברוטו = מה שמופקד פיזית (מזומן בקופה)

      const row = {
        branch_id: branchId,
        date,
        register_number: registerNumber,
        opening_balance: opening,         // ברוטו פיזי
        cash_sales: cashNet,              // ← נטו (לדוחות P&L)
        credit_sales: creditNet,          // ← נטו (לדוחות P&L)
        transaction_count: txCount ? parseInt(txCount) : 0,
        actual_cash: countedCash,         // ברוטו פיזי (ספירה)
        deposit_amount: deposit,          // ברוטו פיזי (לשקית הפקדה)
        variance: Math.round(variance * 100) / 100,    // ברוטו (countedCash - opening - cashGross)
        variance_action: variance !== 0 ? varianceAction : null,
        next_opening_balance: Math.round(chosenNext * 100) / 100,  // ברוטו פיזי
        notes: notes || null,
      }

      let closingId: number
      if (isEdit && existing) {
        const { error } = await supabase.from('register_closings').update(row).eq('id', existing.id)
        if (error) throw error
        closingId = existing.id
        // Remove previous auto change_fund entries linked to this closing, they will be re-inserted with fresh state
        const { error: delErr } = await supabase.from('change_fund').delete().eq('related_closing_id', closingId)
        if (delErr) throw delErr
      } else {
        const { data: inserted, error } = await supabase.from('register_closings').insert(row).select().single()
        if (error) throw error
        closingId = inserted.id
      }

      const fundUpdates: Array<{ type: string; amount: number; description: string }> = []

      if (variance !== 0 && varianceAction === 'surplus_fund') {
        fundUpdates.push({
          type: 'auto_from_closing',
          amount: variance,
          description: `פער מסגירת קופה ${registerNumber} (${date})`,
        })
      }

      const openingDelta = chosenNext - defaultNextOpening
      if (Math.abs(openingDelta) > 0.009) {
        if (openingDelta > 0) {
          fundUpdates.push({
            type: 'withdraw_to_register',
            amount: -openingDelta,
            description: `הגדלת יתרת פתיחה מחר לקופה ${registerNumber}`,
          })
        } else {
          fundUpdates.push({
            type: 'push_from_register',
            amount: -openingDelta,
            description: `הקטנת יתרת פתיחה מחר מקופה ${registerNumber}`,
          })
        }
      }

      let balance = await getCurrentFundBalance()
      for (const u of fundUpdates) {
        balance += u.amount
        const { error: fundErr } = await supabase.from('change_fund').insert({
          branch_id: branchId,
          date,
          type: u.type,
          amount: u.amount,
          description: u.description,
          balance_after: balance,
          related_closing_id: closingId,
          related_register_number: registerNumber,
        })
        if (fundErr) throw fundErr
      }

      onSaved()
    } catch (e: any) {
      const msg = e?.message || 'שגיאה לא צפויה'
      alert(`שמירת סגירת הקופה נכשלה: ${msg}. נסה שוב בעוד מספר שניות.`)
      console.error('[RegisterClosings saveClosing] error:', e)
    }
    setSaving(false)
  }

  const S = {
    label: { fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 8, display: 'block' as const },
    input: { border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', fontSize: 17, fontWeight: 600, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' as const, color: '#0f172a', minHeight: 56 },
  }

  const steps = ['פתיחה', 'מכירות', 'ספירת מזומן', 'סיום']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        style={{ background: '#f8fafc', width: '100%', maxWidth: 720, minHeight: 'min(90vh, 720px)', maxHeight: '96vh', overflow: 'auto', borderRadius: '20px 20px 0 0', direction: 'rtl', display: 'flex', flexDirection: 'column' }}>

        {/* Header + progress */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'white', padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>שלב {step} מתוך 4</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
                {isEdit ? 'עריכת סגירה' : 'סגירת קופה'} {registerNumber}
              </div>
            </div>
            <button onClick={onClose}
              style={{ width: 44, height: 44, background: '#f8fafc', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={22} color="#64748b" />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {steps.map((s, i) => (
              <div key={s} style={{ flex: 1, height: 5, borderRadius: 3, background: i + 1 <= step ? '#6366f1' : '#e2e8f0' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            {steps.map((s, i) => (
              <div key={s} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 700, color: i + 1 === step ? '#6366f1' : '#94a3b8' }}>{s}</div>
            ))}
          </div>
        </div>

        <div style={{ padding: 16 }}>

          {/* Step 1 — Opening */}
          {step === 1 && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
                  <div>
                    <label style={S.label}>תאריך</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
                  </div>
                  <div>
                    <label style={S.label}>קופה</label>
                    <div style={{ ...S.input, background: '#f8fafc', color: '#0f172a', fontWeight: 800, fontSize: 18 }}>{registerNumber}</div>
                  </div>
                </div>
                <div style={{ marginTop: 16 }}>
                  <label style={S.label}>יתרת פתיחה (₪)</label>
                  <input type="number" inputMode="decimal" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} style={S.input} placeholder="0" />
                  {!isEdit && prevBalanceLoaded && (
                    <div style={{ fontSize: 13, color: '#6366f1', marginTop: 8, fontWeight: 600 }}>
                      מולא אוטומטית מסגירה קודמת — ניתן לשנות
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2 — Sales */}
          {step === 2 && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
                  <div>
                    <label style={S.label}>
                      <DollarSign size={14} style={{ display: 'inline', marginLeft: 4 }} />
                      מכירות מזומן * (₪)
                    </label>
                    <input type="number" inputMode="decimal" value={cashSales} onChange={e => setCashSales(e.target.value)} style={S.input} placeholder="0" />
                  </div>
                  <div>
                    <label style={S.label}>
                      <CreditCard size={14} style={{ display: 'inline', marginLeft: 4 }} />
                      מכירות אשראי (₪)
                    </label>
                    <input type="number" inputMode="decimal" value={creditSales} onChange={e => setCreditSales(e.target.value)} style={S.input} placeholder="0" />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={S.label}>מספר עסקאות *</label>
                    <input type="number" inputMode="numeric" value={txCount} onChange={e => setTxCount(e.target.value)} style={S.input} placeholder="0" />
                  </div>
                </div>

                {(parseFloat(cashSales) > 0 || parseFloat(creditSales) > 0) && (
                  <div style={{
                    marginTop: 12, padding: 12, background: '#f0f9ff',
                    border: '1px solid #bae6fd', borderRadius: 8, fontSize: 13
                  }}>
                    <div style={{ fontWeight: 700, color: '#0369a1', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      💡 הסכומים שהזנת כוללים מע"מ — יישמרו במערכת ללא מע"מ
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>מזומן (נטו):</div>
                        <div style={{ fontWeight: 800, color: '#0369a1' }}>₪{((parseFloat(cashSales) || 0) / VAT_DIVIDER).toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>אשראי (נטו):</div>
                        <div style={{ fontWeight: 800, color: '#0369a1' }}>₪{((parseFloat(creditSales) || 0) / VAT_DIVIDER).toFixed(2)}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 6, color: '#64748b', fontSize: 11 }}>
                      סה"כ נטו: ₪{(((parseFloat(cashSales) || 0) + (parseFloat(creditSales) || 0)) / VAT_DIVIDER).toFixed(2)}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 18, padding: 16, background: '#eef2ff', border: '1.5px dashed #c7d2fe', borderRadius: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#4338ca', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Camera size={16} /> העלאת צילום דוח Z (אופציונלי)
                  </div>
                  <div style={{ fontSize: 13, color: '#6366f1', marginBottom: 12 }}>
                    צלם את דוח ה-Z והמערכת תמלא עבורך את המכירות
                  </div>
                  <input ref={zFileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={e => e.target.files && e.target.files[0] && handleZPhoto(e.target.files[0])} />
                  <button onClick={() => zFileRef.current?.click()} disabled={zPhotoParsing}
                    style={{ background: zPhotoParsing ? '#c7d2fe' : '#6366f1', color: 'white', border: 'none', borderRadius: 12, padding: '14px 22px', fontSize: 15, fontWeight: 800, cursor: zPhotoParsing ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 52 }}>
                    <Camera size={18} />
                    {zPhotoParsing ? 'מחלץ נתונים…' : 'בחר תמונה'}
                  </button>
                  {zPhotoError && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8, fontWeight: 600 }}>{zPhotoError}</div>}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3 — Cash count */}
          {step === 3 && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ position: 'sticky', top: 86, zIndex: 1, background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', borderRadius: 16, padding: '20px 18px', marginBottom: 14, color: 'white', boxShadow: '0 6px 20px rgba(99,102,241,0.25)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10, alignItems: 'end' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, opacity: 0.9, fontWeight: 700, marginBottom: 4 }}>נספר</div>
                    <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, letterSpacing: -0.5 }}>
                      ₪{countedCash.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', background: '#1d4ed8', borderRadius: 12, padding: '10px 6px' }}>
                    <div style={{ fontSize: 11, opacity: 0.9, fontWeight: 700, marginBottom: 4 }}>יעד</div>
                    <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1 }}>
                      ₪{cash.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              <DenomCounter denoms={BILL_DENOMS} counts={billCounts} setCounts={setBillCounts} label="שטרות" kind="bill" />
              <DenomCounter denoms={COIN_DENOMS} counts={coinCounts} setCounts={setCoinCounts} label="מטבעות" kind="coin" />

              {isEdit && !hasDenomEntries && (
                <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 14, marginBottom: 14 }}>
                  <label style={S.label}>או: הזן סכום נספר ישירות (₪)</label>
                  <input type="number" inputMode="decimal" value={actualCashManual} onChange={e => setActualCashManual(e.target.value)} style={S.input} placeholder="0" />
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                    בעריכה — אם לא ספרת מחדש שטרות/מטבעות, אפשר להשאיר את הסכום המקורי
                  </div>
                </div>
              )}

              <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <Kpi label="נספר" value={countedCash} color="#0f172a" />
                  <Kpi label="צפוי" value={expectedCash} color="#6366f1" sub="פתיחה + מזומן" />
                  <Kpi label="לשים בשקית" value={depositToBag} color="#059669" emphasis sub="מזומן בדיוק" />
                  <Kpi label="פתיחה מחר" value={defaultNextOpening} color="#7c3aed" sub="נספר − מזומן" />
                  <VarianceDisplay value={variance} />
                </div>
              </div>

              {isLargeVariance && !largeVarianceAcknowledged && (
                <div style={{
                  background: '#fef3c7', border: '2px solid #f59e0b', borderRadius: 12,
                  padding: 16, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={24} color="#b45309" />
                    <div style={{ fontSize: 16, fontWeight: 900, color: '#92400e' }}>
                      ⚠️ פער גדול בספירה
                    </div>
                  </div>
                  <div style={{ fontSize: 14, color: '#78350f', lineHeight: 1.5 }}>
                    זיהינו {variance > 0 ? 'עודף' : 'חוסר'} של ₪{Math.abs(variance).toFixed(2)} — מומלץ לספור שנית לפני שממשיכים.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setBillCounts({}); setCoinCounts({}); setActualCashManual('') }}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#fff', border: '1.5px solid #f59e0b', color: '#92400e', fontWeight: 700, cursor: 'pointer' }}>
                      ספור שנית
                    </button>
                    <button onClick={() => setLargeVarianceAcknowledged(true)}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#f59e0b', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                      הבנתי, ממשיך
                    </button>
                  </div>
                </div>
              )}

              <button type="button" onClick={() => { setManualEntryAmount(countedCash > 0 ? String(countedCash) : ''); setManualEntryOpen(true) }}
                style={{ marginTop: 14, width: '100%', background: 'white', color: '#475569', border: '1.5px dashed #cbd5e1', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52 }}>
                <Pencil size={15} /> הזן סכום ידנית
              </button>
            </motion.div>
          )}

          {/* Step 4 — Summary */}
          {step === 4 && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 18 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>סיכום סגירה</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 18 }}>
                  <Kpi label="יתרת פתיחה" value={opening} color="#64748b" />
                  <Kpi label="מזומן" value={cash} color="#10b981" />
                  <Kpi label="אשראי" value={credit} color="#3b82f6" />
                  <Kpi label="נספר" value={countedCash} color="#0f172a" />
                  <Kpi label="לשים בשקית" value={depositToBag} color="#059669" emphasis />
                  <VarianceDisplay value={variance} />
                </div>

                {Math.abs(variance) >= 0.01 && (
                  <div style={{ background: '#fef3c7', border: '1.5px solid #fcd34d', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#92400e', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={16} /> טיפול בפער {variance > 0 ? 'עודף' : 'חוסר'} של {fmt(Math.abs(variance))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        { k: 'surplus_fund', l: variance > 0 ? 'הכנס לקופת עודף' : 'קח מקופת עודף' },
                        { k: 'documented', l: 'תעד כחוסר/עודף' },
                        { k: 'kept', l: 'השאר בקופה' },
                      ].map(o => (
                        <button key={o.k} onClick={() => setVarianceAction(o.k as any)}
                          style={{ background: varianceAction === o.k ? '#6366f1' : 'white', color: varianceAction === o.k ? 'white' : '#475569', border: '1.5px solid ' + (varianceAction === o.k ? '#6366f1' : '#e2e8f0'), borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', minHeight: 44 }}>
                          {o.l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <label style={S.label}>יתרת פתיחה מחר (₪)</label>
                  <input type="number" inputMode="decimal" value={nextOpeningOverride} onChange={e => setNextOpeningOverride(e.target.value)} style={S.input} placeholder={String(defaultNextOpening.toFixed(2))} />
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                    ברירת מחדל: {fmtDec(defaultNextOpening)} (נספר − מכירות מזומן).
                    שינוי יגרור משיכה/דחיפה מקופת עודף.
                  </div>
                </div>

                <div>
                  <label style={S.label}>הערות (אופציונלי)</label>
                  <input type="text" value={notes} onChange={e => setNotes(e.target.value)} style={S.input} placeholder="..." />
                </div>
              </div>
            </motion.div>
          )}

        </div>

        {/* Nav */}
        <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid #f1f5f9', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <button disabled={step === 1} onClick={() => setStep(step - 1)}
            style={{ background: step === 1 ? '#f1f5f9' : 'white', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '14px 22px', fontSize: 15, fontWeight: 800, color: step === 1 ? '#cbd5e1' : '#475569', cursor: step === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, minHeight: 56 }}>
            <ArrowRight size={17} /> הקודם
          </button>
          {step < 4 ? (() => {
            const nextDisabled =
              (step === 2 && (!cashSales || !txCount || parseInt(txCount) <= 0)) ||
              (step === 3 && isLargeVariance && !largeVarianceAcknowledged)
            return (
              <button onClick={() => setStep(step + 1)}
                disabled={nextDisabled}
                style={{ background: nextDisabled ? '#c7d2fe' : '#6366f1', color: 'white', border: 'none', borderRadius: 12, padding: '14px 26px', fontSize: 15, fontWeight: 800, cursor: nextDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, minHeight: 56 }}>
                הבא <ArrowLeft size={17} />
              </button>
            )
          })() : (
            <button onClick={save} disabled={saving}
              style={{ background: saving ? '#c7d2fe' : '#059669', color: 'white', border: 'none', borderRadius: 12, padding: '14px 26px', fontSize: 15, fontWeight: 800, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, minHeight: 56 }}>
              <CheckCircle2 size={18} /> {saving ? 'שומר…' : isEdit ? 'עדכן סגירה' : 'אישור סגירה'}
            </button>
          )}
        </div>
      </motion.div>

      {/* Manual entry dialog */}
      {manualEntryOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setManualEntryOpen(false)}>
          <motion.div onClick={e => e.stopPropagation()}
            initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            style={{ background: 'white', width: '100%', maxWidth: 460, borderRadius: 16, direction: 'rtl', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pencil size={18} color="#6366f1" /> הזנת סכום ידנית
              </div>
              <button onClick={() => setManualEntryOpen(false)}
                style={{ width: 40, height: 40, background: '#f8fafc', border: 'none', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} color="#64748b" />
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 12, padding: 12, marginBottom: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertCircle size={18} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, color: '#92400e', fontWeight: 700, lineHeight: 1.5 }}>
                  שים לב — הזנת סכום ידנית עוקפת את ספירת השטרות. האם אתה בטוח?
                </div>
              </div>
              <label style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 8, display: 'block' }}>
                סכום נספר (₪)
              </label>
              <input type="number" inputMode="decimal" value={manualEntryAmount}
                onChange={e => setManualEntryAmount(e.target.value)} autoFocus
                style={{ border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', fontSize: 20, fontWeight: 800, outline: 'none', width: '100%', boxSizing: 'border-box', textAlign: 'right', color: '#0f172a', minHeight: 56 }}
                placeholder="0" />
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setManualEntryOpen(false)}
                style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 800, color: '#475569', cursor: 'pointer' }}>
                ביטול
              </button>
              <button onClick={() => {
                const v = parseFloat(manualEntryAmount)
                if (isNaN(v) || v < 0) return
                setBillCounts({})
                setCoinCounts({})
                setActualCashManual(String(v))
                setManualEntryOpen(false)
              }}
                disabled={manualEntryAmount === '' || isNaN(parseFloat(manualEntryAmount)) || parseFloat(manualEntryAmount) < 0}
                style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 10, padding: '12px 22px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                אישור
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, color, sub, emphasis, showSign }: { label: string; value: number; color: string; sub?: string; emphasis?: boolean; showSign?: boolean }) {
  const text = showSign
    ? (value > 0 ? '+' : value < 0 ? '−' : '') + '₪' + Math.abs(value).toFixed(2)
    : fmtDec(value)
  return (
    <div style={{ padding: 12, background: emphasis ? '#ecfdf5' : '#f8fafc', borderRadius: 12, border: emphasis ? '1.5px solid #a7f3d0' : '1px solid #f1f5f9' }}>
      <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{text}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

function VarianceDisplay({ value }: { value: number }) {
  const rounded = Math.round(value * 100) / 100
  const isMatch = Math.abs(rounded) < 0.01
  const label = isMatch ? 'תואם' : rounded > 0 ? `עודף ₪${Math.abs(rounded).toFixed(2)}` : `חוסר ₪${Math.abs(rounded).toFixed(2)}`
  const bg = isMatch ? '#ecfdf5' : rounded > 0 ? '#ecfdf5' : '#fef2f2'
  const color = isMatch ? '#059669' : rounded > 0 ? '#059669' : '#dc2626'
  const border = isMatch ? '1.5px solid #a7f3d0' : rounded > 0 ? '1.5px solid #a7f3d0' : '1.5px solid #fecaca'
  return (
    <div style={{ padding: 12, background: bg, borderRadius: 12, border, textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>סטייה</div>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{label}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Overall count (after all registers closed)
// ═══════════════════════════════════════════════════════════════════════════
function OverallCount({ totalExpectedCash, onClose }: { totalExpectedCash: number; onClose: () => void }) {
  const [billCounts, setBillCounts] = useState<Record<string, number>>({})
  const [coinCounts, setCoinCounts] = useState<Record<string, number>>({})
  const counted = totalFromCounts(BILL_DENOMS, billCounts) + totalFromCounts(COIN_DENOMS, coinCounts)
  const diff = counted - totalExpectedCash

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        style={{ background: '#f8fafc', width: '100%', maxWidth: 720, maxHeight: '96vh', overflow: 'auto', borderRadius: '20px 20px 0 0', direction: 'rtl' }}>
        <div style={{ position: 'sticky', top: 0, background: 'white', padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>ספירה כוללת</div>
            <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>סכום צפוי: {fmtDec(totalExpectedCash)}</div>
          </div>
          <button onClick={onClose}
            style={{ width: 44, height: 44, background: '#f8fafc', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={22} color="#64748b" />
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <DenomCounter denoms={BILL_DENOMS} counts={billCounts} setCounts={setBillCounts} label="שטרות" kind="bill" />
          <DenomCounter denoms={COIN_DENOMS} counts={coinCounts} setCounts={setCoinCounts} label="מטבעות" kind="coin" />

          <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Kpi label="נספר" value={counted} color="#0f172a" />
              <Kpi label="אמור להיות" value={totalExpectedCash} color="#6366f1" />
              <VarianceDisplay value={diff} />
            </div>
            {Math.abs(diff) < 0.01 && totalExpectedCash > 0 && (
              <div style={{ marginTop: 12, padding: 12, background: '#ecfdf5', border: '1.5px solid #a7f3d0', borderRadius: 12, color: '#065f46', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={17} /> שקית ההפקדה תואמת למכירות המזומן
              </div>
            )}
          </div>
        </div>
        <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid #f1f5f9', padding: '14px 16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ background: '#059669', color: 'white', border: 'none', borderRadius: 12, padding: '14px 26px', fontSize: 15, fontWeight: 800, cursor: 'pointer', minHeight: 56 }}>
            סגור
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Activate register dialog (for inactive registers)
// ═══════════════════════════════════════════════════════════════════════════
function ActivateDialog({ branchId, registerNumber, fundBalance, onClose, onSaved }: {
  branchId: number; registerNumber: number; fundBalance: number; onClose: () => void; onSaved: () => void
}) {
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const amt = parseFloat(amount) || 0

  async function activate() {
    if (saving || amt <= 0) return
    setSaving(true)
    try {
      const today = todayISO()
      const { data: inserted, error } = await supabase.from('register_closings').insert({
        branch_id: branchId,
        date: today,
        register_number: registerNumber,
        opening_balance: 0,
        cash_sales: 0,
        credit_sales: 0,
        transaction_count: 0,
        actual_cash: amt,
        deposit_amount: 0,
        variance: amt,
        variance_action: null,
        next_opening_balance: amt,
        notes: 'הפעלת קופה — משיכה מקופת עודף',
      }).select().single()
      if (error) throw error

      const newBalance = fundBalance - amt
      const { error: fundErr } = await supabase.from('change_fund').insert({
        branch_id: branchId,
        date: today,
        type: 'withdraw_to_register',
        amount: -amt,
        description: `הפעלת קופה ${registerNumber}`,
        balance_after: newBalance,
        related_closing_id: inserted.id,
        related_register_number: registerNumber,
      })
      if (fundErr) throw fundErr
      onSaved()
    } catch (e: any) {
      const msg = e?.message || 'שגיאה לא צפויה'
      alert(`הפעלת הקופה נכשלה: ${msg}. נסה שוב.`)
      console.error('[RegisterClosings activate] error:', e)
    }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        style={{ background: 'white', width: '100%', maxWidth: 520, borderRadius: '20px 20px 0 0', direction: 'rtl', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={20} color="#6366f1" /> הפעלת קופה {registerNumber}
          </div>
          <button onClick={onClose}
            style={{ width: 44, height: 44, background: '#f8fafc', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={22} color="#64748b" />
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#4338ca', fontWeight: 700 }}>
              יתרת קופת עודף: <strong>{fmtDec(fundBalance)}</strong>
            </div>
          </div>
          <label style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 8, display: 'block' }}>
            כמה להוציא מקופת העודף לפתיחת הקופה? (₪)
          </label>
          <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            style={{ border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', fontSize: 18, fontWeight: 700, outline: 'none', width: '100%', boxSizing: 'border-box', textAlign: 'right', color: '#0f172a', minHeight: 56 }}
            placeholder="0" autoFocus />
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
            הסכום יירשם כמשיכה מקופת העודף וייקבע כיתרת פתיחה לקופה זו.
          </div>
        </div>
        <div style={{ padding: '14px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose}
            style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '14px 22px', fontSize: 15, fontWeight: 800, color: '#475569', cursor: 'pointer', minHeight: 56 }}>
            ביטול
          </button>
          <button onClick={activate} disabled={saving || amt <= 0 || amt > fundBalance}
            style={{ background: saving || amt <= 0 ? '#c7d2fe' : amt > fundBalance ? '#fecaca' : '#6366f1', color: 'white', border: 'none', borderRadius: 12, padding: '14px 22px', fontSize: 15, fontWeight: 800, cursor: saving || amt <= 0 ? 'not-allowed' : 'pointer', minHeight: 56, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={16} /> {saving ? 'מפעיל…' : 'הפעל קופה'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Empty register dialog
// ═══════════════════════════════════════════════════════════════════════════
function EmptyDialog({ branchId, registerNumber, openingAmount, fundBalance, onClose, onSaved }: {
  branchId: number; registerNumber: number; openingAmount: number; fundBalance: number; onClose: () => void; onSaved: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function doEmpty() {
    if (saving) return
    setSaving(true)
    try {
      const today = todayISO()
      const { data: inserted, error } = await supabase.from('register_closings').insert({
        branch_id: branchId,
        date: today,
        register_number: registerNumber,
        opening_balance: openingAmount,
        cash_sales: 0,
        credit_sales: 0,
        transaction_count: 0,
        actual_cash: 0,
        deposit_amount: 0,
        variance: -openingAmount,
        variance_action: 'surplus_fund',
        next_opening_balance: 0,
        notes: 'רוקן קופה — העברה לקופת עודף',
      }).select().single()
      if (error) throw error

      if (openingAmount > 0) {
        const newBalance = fundBalance + openingAmount
        const { error: fundErr } = await supabase.from('change_fund').insert({
          branch_id: branchId,
          date: today,
          type: 'push_from_register',
          amount: openingAmount,
          description: `ריקון קופה ${registerNumber}`,
          balance_after: newBalance,
          related_closing_id: inserted.id,
          related_register_number: registerNumber,
        })
        if (fundErr) throw fundErr
      }
      onSaved()
    } catch (e: any) {
      const msg = e?.message || 'שגיאה לא צפויה'
      alert(`ריקון הקופה נכשל: ${msg}. נסה שוב.`)
      console.error('[RegisterClosings doEmpty] error:', e)
    }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        style={{ background: 'white', width: '100%', maxWidth: 520, borderRadius: '20px 20px 0 0', direction: 'rtl', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Archive size={20} color="#7c3aed" /> ריקון קופה {registerNumber}
          </div>
          <button onClick={onClose}
            style={{ width: 44, height: 44, background: '#f8fafc', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={22} color="#64748b" />
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#6d28d9', fontWeight: 700, marginBottom: 4 }}>יתרת פתיחה נוכחית</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#4c1d95' }}>{fmtDec(openingAmount)}</div>
            <div style={{ fontSize: 11, color: '#6d28d9', marginTop: 4 }}>
              {openingAmount > 0 ? 'מהסגירה האחרונה' : 'אין יתרה — הקופה כבר ריקה'}
            </div>
          </div>
          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>
            פעולה זו תסמן את הקופה כלא פעילה ותעביר את הסכום לקופת העודף.<br />
            ניתן יהיה להפעיל אותה מחדש בעתיד.
          </div>
        </div>
        <div style={{ padding: '14px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose}
            style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '14px 22px', fontSize: 15, fontWeight: 800, color: '#475569', cursor: 'pointer', minHeight: 56 }}>
            ביטול
          </button>
          <button onClick={doEmpty} disabled={saving}
            style={{ background: saving ? '#c7d2fe' : '#7c3aed', color: 'white', border: 'none', borderRadius: 12, padding: '14px 22px', fontSize: 15, fontWeight: 800, cursor: saving ? 'wait' : 'pointer', minHeight: 56, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Archive size={16} /> {saving ? 'שומר…' : `העבר ${fmt(openingAmount)} לקופת עודף`}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Delete confirmation dialog
// ═══════════════════════════════════════════════════════════════════════════
function DeleteDialog({ closing, onClose, onDeleted }: {
  closing: Closing; onClose: () => void; onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function doDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      // Delete related change_fund rows first (either via FK relation or by related_closing_id)
      const { error: fundErr } = await supabase.from('change_fund').delete().eq('related_closing_id', closing.id)
      if (fundErr) throw fundErr
      const { error } = await supabase.from('register_closings').delete().eq('id', closing.id)
      if (error) throw error
      onDeleted()
    } catch (e: any) {
      alert('שגיאת מחיקה: ' + (e?.message || 'לא ידוע'))
    }
    setDeleting(false)
  }

  const dateLabel = new Date(closing.date + 'T12:00:00').toLocaleDateString('he-IL')

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ background: 'white', width: '100%', maxWidth: 440, borderRadius: 16, direction: 'rtl', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={20} color="#dc2626" /> מחיקת סגירה
          </div>
          <button onClick={onClose}
            style={{ width: 40, height: 40, background: '#f8fafc', border: 'none', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} color="#64748b" />
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 15, color: '#334155', lineHeight: 1.6, marginBottom: 10 }}>
            האם למחוק את סגירת <strong>קופה {closing.register_number}</strong> מתאריך <strong>{dateLabel}</strong>?
          </div>
          <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 700, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px' }}>
            פעולה זו אינה ניתנת לביטול. כל תנועות קופת העודף הקשורות יימחקו גם הן.
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose}
            style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 800, color: '#475569', cursor: 'pointer' }}>
            ביטול
          </button>
          <button onClick={doDelete} disabled={deleting}
            style={{ background: deleting ? '#fca5a5' : '#dc2626', color: 'white', border: 'none', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 800, cursor: deleting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trash2 size={15} /> {deleting ? 'מוחק…' : 'מחק'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════
export default function RegisterClosings({ branchId, branchName, onBack }: Props) {
  const registers = BRANCH_REGISTERS[branchId] || []
  const today = todayISO()

  const [tab, setTab] = useState<'today' | 'history'>('today')
  const [todayClosings, setTodayClosings] = useState<Closing[]>([])
  const [lastClosings, setLastClosings] = useState<Record<number, Closing>>({})
  const [fundBalance, setFundBalance] = useState(0)
  const [wizardReg, setWizardReg] = useState<number | null>(null)
  const [editClosing, setEditClosing] = useState<Closing | null>(null)
  const [activatingReg, setActivatingReg] = useState<number | null>(null)
  const [emptyingReg, setEmptyingReg] = useState<number | null>(null)
  const [deletingClosing, setDeletingClosing] = useState<Closing | null>(null)
  const [overallOpen, setOverallOpen] = useState(false)
  const [depositCalcOpen, setDepositCalcOpen] = useState(false)
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().split('T')[0]
  })
  const [historyTo, setHistoryTo] = useState(today)
  const [historyReg, setHistoryReg] = useState<number | 'all'>('all')
  const [history, setHistory] = useState<Closing[]>([])

  async function loadAll() {
    const d = new Date(); d.setDate(d.getDate() - 60)
    const sixtyDaysAgo = d.toISOString().split('T')[0]
    const [todayRes, fundRes, recentRes] = await Promise.all([
      supabase.from('register_closings').select('*').eq('branch_id', branchId).eq('date', today),
      supabase.from('change_fund').select('balance_after').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(1),
      supabase.from('register_closings').select('*').eq('branch_id', branchId)
        .gte('date', sixtyDaysAgo)
        .order('date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    setTodayClosings((todayRes.data || []) as Closing[])
    setFundBalance(fundRes.data && fundRes.data.length > 0 ? Number(fundRes.data[0].balance_after) : 0)
    const byReg: Record<number, Closing> = {}
    for (const c of (recentRes.data || []) as Closing[]) {
      if (!byReg[c.register_number]) byReg[c.register_number] = c
    }
    setLastClosings(byReg)
  }

  async function loadHistory() {
    let q = supabase.from('register_closings').select('*')
      .eq('branch_id', branchId)
      .gte('date', historyFrom).lte('date', historyTo)
      .order('date', { ascending: false }).order('register_number')
    if (historyReg !== 'all') q = q.eq('register_number', historyReg)
    const { data } = await q
    setHistory((data || []) as Closing[])
  }

  useEffect(() => { loadAll() }, [branchId])
  useEffect(() => { if (tab === 'history') loadHistory() }, [branchId, historyFrom, historyTo, historyReg, tab])

  const closedRegs = new Set(todayClosings.map(c => c.register_number))
  const openRegs = registers.filter(r => !closedRegs.has(r))
  const allClosed = registers.length > 0 && openRegs.length === 0

  const totalCash = todayClosings.reduce((s, c) => s + Number(c.cash_sales), 0)
  const totalCredit = todayClosings.reduce((s, c) => s + Number(c.credit_sales), 0)
  const totalVariance = todayClosings.reduce((s, c) => s + Number(c.variance), 0)

  type StatusKind = 'active-today' | 'yesterday' | 'two-days' | 'stale' | 'never' | 'inactive'
  function getRegisterStatus(regNum: number): { kind: StatusKind; label: string; color: string; bg: string; border: string; daysSince: number } {
    const closedToday = closedRegs.has(regNum)
    const last = lastClosings[regNum]

    // Inactive = last closing emptied register (next_opening=0 + surplus_fund)
    if (last && Number(last.next_opening_balance) === 0 && last.variance_action === 'surplus_fund') {
      return { kind: 'inactive', label: 'לא פעילה', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1', daysSince: -1 }
    }

    if (closedToday) {
      return { kind: 'active-today', label: 'סגורה היום ✓', color: '#065f46', bg: '#d1fae5', border: '#a7f3d0', daysSince: 0 }
    }

    if (!last) {
      return { kind: 'never', label: 'לא פעילה לאחרונה', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1', daysSince: -1 }
    }

    const todayTime = new Date(today + 'T00:00:00').getTime()
    const lastTime = new Date(last.date + 'T00:00:00').getTime()
    const daysSince = Math.round((todayTime - lastTime) / (24 * 60 * 60 * 1000))

    if (daysSince === 1) return { kind: 'yesterday', label: 'אתמול', color: '#854d0e', bg: '#fef9c3', border: '#fde68a', daysSince }
    if (daysSince === 2) return { kind: 'two-days', label: 'לפני יומיים', color: '#854d0e', bg: '#fef9c3', border: '#fde68a', daysSince }
    if (daysSince >= 3 && daysSince <= 7) return { kind: 'stale', label: `לפני ${daysSince} ימים`, color: '#9a3412', bg: '#ffedd5', border: '#fed7aa', daysSince }
    return { kind: 'never', label: 'לא פעילה לאחרונה', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1', daysSince }
  }

  // Registers that need attention today = not closed today, not inactive, last closed within 7 days
  const registersNeedingAttention = registers.filter(r => {
    const s = getRegisterStatus(r)
    return s.kind !== 'active-today' && s.kind !== 'inactive' && s.daysSince >= 1 && s.daysSince <= 7
  })

  function exportExcel() {
    const rows = history.map(c => ({
      'תאריך': c.date,
      'קופה': c.register_number,
      'יתרת פתיחה': Number(c.opening_balance),
      'מכירות מזומן': Number(c.cash_sales),
      'מכירות אשראי': Number(c.credit_sales),
      'עסקאות': c.transaction_count || 0,
      'מזומן בקופה': Number(c.actual_cash),
      'הפקדה': Number(c.deposit_amount),
      'פער': Number(c.variance),
      'פעולה': c.variance_action || '',
      'פתיחה מחר': Number(c.next_opening_balance),
      'הערות': c.notes || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'סגירות קופה')
    XLSX.writeFile(wb, `register_closings_${branchName}_${historyFrom}_${historyTo}.xlsx`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="סגירת קופות" subtitle={branchName} onBack={onBack} />

      {/* Top-level tabs */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '0 20px', display: 'flex', gap: 4, maxWidth: 1000, margin: '0 auto', overflowX: 'auto' }}>
        {[
          { k: 'today', l: 'היום', Icon: HomeIcon },
          { k: 'history', l: 'היסטוריה', Icon: History },
        ].map(t => {
          const Icon = t.Icon
          const active = tab === t.k
          return (
            <button key={t.k} onClick={() => setTab(t.k as any)}
              style={{ padding: '14px 20px', background: 'none', border: 'none', borderBottom: '3px solid ' + (active ? '#6366f1' : 'transparent'), cursor: 'pointer', fontSize: 15, fontWeight: 800, color: active ? '#6366f1' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={17} /> {t.l}
            </button>
          )
        })}
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>

        {tab === 'today' && (
          <>
            {/* KPI cards */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 18 }}>
                <KpiCard Icon={DollarSign} color="#10b981" label='סה"כ מכירות מזומן' value={fmtDec(totalCash)} />
                <KpiCard Icon={CreditCard} color="#3b82f6" label='סה"כ מכירות אשראי' value={fmtDec(totalCredit)} />
                <KpiCard
                  Icon={AlertCircle}
                  color={Math.abs(totalVariance) < 0.01 ? '#10b981' : totalVariance > 0 ? '#10b981' : '#dc2626'}
                  label="סטיית יום"
                  value={
                    Math.abs(totalVariance) < 0.01
                      ? 'תואם'
                      : totalVariance > 0
                        ? `עודף ₪${Math.abs(totalVariance).toFixed(2)}`
                        : `חוסר ₪${Math.abs(totalVariance).toFixed(2)}`
                  }
                />
                <KpiCard Icon={Wallet} color="#7c3aed" label="יתרת קופת עודף" value={fmtDec(fundBalance)} />
              </div>
            </motion.div>

            {/* Deposit calculator — utility only, no DB save */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <button onClick={() => setDepositCalcOpen(true)}
                style={{
                  padding: '14px 24px', borderRadius: 12,
                  background: '#7c3aed', color: '#fff', fontWeight: 800, fontSize: 16,
                  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 8, width: '100%', maxWidth: 400
                }}>
                <Wallet size={20} /> חישוב הפקדה
              </button>
            </div>

            {/* Registers grid */}
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 18, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a' }}>קופות הסניף</div>
                  {registersNeedingAttention.length > 0 && (
                    <span style={{ background: '#fee2e2', color: '#991b1b', fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 999 }}>
                      {registersNeedingAttention.length} דורשות סגירה
                    </span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
                  {registers.map(r => {
                    const status = getRegisterStatus(r)
                    const closing = todayClosings.find(c => c.register_number === r)
                    const last = lastClosings[r]
                    const isInactive = status.kind === 'inactive'
                    const isClosedToday = status.kind === 'active-today'
                    const borderColor = status.border
                    const bg = status.kind === 'active-today' ? '#f0fdf4' : status.kind === 'inactive' ? '#f8fafc' : 'white'
                    return (
                      <div key={r} style={{ background: bg, border: '1.5px solid ' + borderColor, borderRadius: 14, padding: 14, position: 'relative' }}>
                        <span style={{ position: 'absolute', top: -9, left: -6, background: status.bg, color: status.color, fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, border: '1px solid ' + status.border }}>
                          {status.label}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a' }}>קופה {r}</div>
                          {isClosedToday ? <CheckCircle2 size={20} color="#059669" /> : isInactive ? <Archive size={20} color="#64748b" /> : <AlertCircle size={20} color={status.color} />}
                        </div>

                        {isClosedToday && closing && (
                          <>
                            <div style={{ fontSize: 13, color: '#065f46', fontWeight: 600, marginBottom: 8 }}>
                              מזומן: {fmtDec(Number(closing.cash_sales))}<br />
                              פער: {fmtDec(Number(closing.variance))}<br />
                              פתיחה מחר: {fmtDec(Number(closing.next_opening_balance))}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => setEditClosing(closing)}
                                style={{ flex: 1, background: 'white', color: '#065f46', border: '1.5px solid #a7f3d0', borderRadius: 10, padding: '8px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                <Pencil size={13} /> ערוך
                              </button>
                              <button onClick={() => setDeletingClosing(closing)}
                                title="מחק סגירה"
                                style={{ background: 'white', color: '#dc2626', border: '1.5px solid #fecaca', borderRadius: 10, padding: '8px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </>
                        )}

                        {isInactive && (
                          <button onClick={() => setActivatingReg(r)}
                            style={{ width: '100%', background: '#6366f1', color: 'white', border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 800, cursor: 'pointer', marginTop: 6, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <Zap size={16} /> הפעל קופה
                          </button>
                        )}

                        {!isClosedToday && !isInactive && (
                          <>
                            <button onClick={() => setWizardReg(r)}
                              style={{ width: '100%', background: '#6366f1', color: 'white', border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 800, cursor: 'pointer', marginTop: 6, minHeight: 48 }}>
                              סגור קופה
                            </button>
                            <button onClick={() => setEmptyingReg(r)}
                              title={last ? `יתרת פתיחה נוכחית: ${fmtDec(Number(last.next_opening_balance))}` : ''}
                              style={{ width: '100%', background: 'white', color: '#64748b', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '7px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              <Archive size={12} /> רוקן קופה
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>

                {allClosed && (
                  <button onClick={() => setOverallOpen(true)}
                    style={{ marginTop: 16, width: '100%', background: '#059669', color: 'white', border: 'none', borderRadius: 14, padding: '16px', fontSize: 16, fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 60 }}>
                    <Calculator size={20} />
                    ספירה כוללת לאימות שקית הפקדה
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}

        {tab === 'history' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', borderRadius: 14, border: '1px solid #f1f5f9', padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <History size={18} /> היסטוריה
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="date" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)}
                    style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 14 }} />
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>עד</span>
                  <input type="date" value={historyTo} onChange={e => setHistoryTo(e.target.value)}
                    style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 14 }} />
                  <select value={historyReg} onChange={e => setHistoryReg(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                    style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 14 }}>
                    <option value="all">כל הקופות</option>
                    {registers.map(r => <option key={r} value={r}>קופה {r}</option>)}
                  </select>
                  <button onClick={exportExcel}
                    style={{ background: '#059669', color: 'white', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileSpreadsheet size={15} /> ייצוא
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['תאריך', 'קופה', 'פתיחה', 'מזומן', 'אשראי', 'עסקאות', 'נספר', 'פער', 'פעולה', 'פתיחה מחר', ''].map(h => (
                        <th key={h} style={{ padding: '10px 10px', textAlign: 'right', fontSize: 11, fontWeight: 800, color: '#94a3b8', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr><td colSpan={11} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>אין רשומות</td></tr>
                    ) : history.map(c => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                        <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>{new Date(c.date + 'T12:00:00').toLocaleDateString('he-IL')}</td>
                        <td style={{ padding: '10px 10px', fontWeight: 800 }}>{c.register_number}</td>
                        <td style={{ padding: '10px 10px' }}>{fmtDec(Number(c.opening_balance))}</td>
                        <td style={{ padding: '10px 10px', color: '#10b981', fontWeight: 700 }}>{fmtDec(Number(c.cash_sales))}</td>
                        <td style={{ padding: '10px 10px', color: '#3b82f6', fontWeight: 700 }}>{fmtDec(Number(c.credit_sales))}</td>
                        <td style={{ padding: '10px 10px', color: '#64748b' }}>{c.transaction_count || '—'}</td>
                        <td style={{ padding: '10px 10px' }}>{fmtDec(Number(c.actual_cash))}</td>
                        <td style={{ padding: '10px 10px', color: Math.abs(Number(c.variance)) < 0.01 ? '#059669' : Number(c.variance) > 0 ? '#f59e0b' : '#dc2626', fontWeight: 800 }}>
                          {Number(c.variance) > 0 ? '+' : ''}{fmtDec(Number(c.variance))}
                        </td>
                        <td style={{ padding: '10px 10px', fontSize: 11, color: '#64748b' }}>
                          {c.variance_action === 'surplus_fund' ? 'קופת עודף' : c.variance_action === 'documented' ? 'מתועד' : c.variance_action === 'kept' ? 'הושאר' : '—'}
                        </td>
                        <td style={{ padding: '10px 10px' }}>{fmtDec(Number(c.next_opening_balance))}</td>
                        <td style={{ padding: '10px 6px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setEditClosing(c)}
                              title="עריכה"
                              style={{ width: 36, height: 36, border: '1.5px solid #e2e8f0', background: 'white', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Pencil size={14} color="#6366f1" />
                            </button>
                            <button onClick={() => setDeletingClosing(c)}
                              title="מחיקה"
                              style={{ width: 36, height: 36, border: '1.5px solid #fecaca', background: 'white', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Trash2 size={14} color="#dc2626" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

      </div>

      {wizardReg !== null && (
        <ClosingWizard branchId={branchId} registerNumber={wizardReg}
          onClose={() => setWizardReg(null)}
          onSaved={() => { setWizardReg(null); loadAll(); if (tab === 'history') loadHistory() }} />
      )}
      {editClosing && (
        <ClosingWizard branchId={branchId} registerNumber={editClosing.register_number} existing={editClosing}
          onClose={() => setEditClosing(null)}
          onSaved={() => { setEditClosing(null); loadAll(); if (tab === 'history') loadHistory() }} />
      )}
      {overallOpen && (
        <OverallCount totalExpectedCash={totalCash} onClose={() => setOverallOpen(false)} />
      )}
      {depositCalcOpen && (
        <DepositCalculator totalCash={totalCash} onClose={() => setDepositCalcOpen(false)} />
      )}
      {activatingReg !== null && (
        <ActivateDialog branchId={branchId} registerNumber={activatingReg} fundBalance={fundBalance}
          onClose={() => setActivatingReg(null)}
          onSaved={() => { setActivatingReg(null); loadAll(); if (tab === 'history') loadHistory() }} />
      )}
      {emptyingReg !== null && (
        <EmptyDialog branchId={branchId} registerNumber={emptyingReg}
          openingAmount={lastClosings[emptyingReg] ? Number(lastClosings[emptyingReg].next_opening_balance) : 0}
          fundBalance={fundBalance}
          onClose={() => setEmptyingReg(null)}
          onSaved={() => { setEmptyingReg(null); loadAll(); if (tab === 'history') loadHistory() }} />
      )}
      {deletingClosing && (
        <DeleteDialog closing={deletingClosing}
          onClose={() => setDeletingClosing(null)}
          onDeleted={() => { setDeletingClosing(null); loadAll(); if (tab === 'history') loadHistory() }} />
      )}
    </div>
  )
}

function KpiCard({ Icon, color, label, value }: { Icon: any; color: string; label: string; value: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, background: color + '15', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={19} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 19, fontWeight: 900, color: '#0f172a' }}>{value}</div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Deposit calculator — utility only (no DB save)
// ═══════════════════════════════════════════════════════════════════════════
function DepositCalculator({ totalCash, onClose }: { totalCash: number; onClose: () => void }) {
  const [billCounts, setBillCounts] = useState<Record<string, number>>({})
  const [coinCounts, setCoinCounts] = useState<Record<string, number>>({})
  const BILL_DENOMS_DEPOSIT = [200, 100, 50, 20, 10]
  const COIN_DENOMS_DEPOSIT = [5, 2, 1, 0.5, 0.1]
  const depositedAmount =
    totalFromCounts(BILL_DENOMS_DEPOSIT, billCounts) +
    totalFromCounts(COIN_DENOMS_DEPOSIT, coinCounts)
  const remaining = totalCash - depositedAmount
  const isExact = Math.abs(remaining) < 0.01
  const isShort = remaining > 0.01
  const isOver  = remaining < -0.01
  const progress = totalCash > 0 ? Math.min(100, (depositedAmount / totalCash) * 100) : 0
  const todayStr = new Date().toLocaleDateString('he-IL')

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        style={{ background: '#f8fafc', width: '100%', maxWidth: 720, maxHeight: '96vh', overflowY: 'auto', borderRadius: '20px 20px 0 0', direction: 'rtl', display: 'flex', flexDirection: 'column', position: 'relative' }}>

        {/* Sticky purple header — totals, status, progress */}
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
          color: '#fff',
          padding: 16,
          boxShadow: '0 4px 12px rgba(124,58,237,0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calculator size={18} /> חישוב הפקדה
              </div>
              <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 600, marginTop: 2 }}>{todayStr}</div>
            </div>
            <button onClick={onClose}
              style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={20} color="#fff" />
            </button>
          </div>

          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700, marginBottom: 2 }}>סה"כ מזומן להפקדה</div>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5 }}>₪{totalCash.toFixed(2)}</div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 8 }}>
            <div style={{ textAlign: 'center', marginBottom: 10, minHeight: 24 }}>
              {isExact && (
                <div style={{ fontSize: 18, fontWeight: 900, color: '#d1fae5' }}>
                  ✓ תואם
                </div>
              )}
              {isShort && (
                <div style={{ fontSize: 16, fontWeight: 800 }}>
                  נשאר להפקיד: <span style={{ fontSize: 20 }}>₪{remaining.toFixed(2)}</span>
                </div>
              )}
              {isOver && (
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fecaca' }}>
                  ⚠️ עודף בספירה: ₪{Math.abs(remaining).toFixed(2)} — בדוק
                </div>
              )}
            </div>
            <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.2)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: '#fff', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        </div>

        {/* Body — denomination counters */}
        <div style={{ padding: 16, flex: 1 }}>
          <DenomCounter denoms={BILL_DENOMS_DEPOSIT} counts={billCounts} setCounts={setBillCounts} label="שטרות" kind="bill" />
          <DenomCounter denoms={COIN_DENOMS_DEPOSIT} counts={coinCounts} setCounts={setCoinCounts} label="מטבעות" kind="coin" />
        </div>

        {/* Sticky bottom close */}
        <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid #f1f5f9', padding: '14px 16px', display: 'flex', justifyContent: 'flex-end', zIndex: 10 }}>
          <button onClick={onClose}
            style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 12, padding: '14px 26px', fontSize: 15, fontWeight: 800, cursor: 'pointer', minHeight: 56 }}>
            סגור
          </button>
        </div>
      </motion.div>
    </div>
  )
}
