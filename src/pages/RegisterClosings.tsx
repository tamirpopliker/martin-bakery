import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/PageHeader'
import {
  DollarSign, CreditCard, Wallet, CheckCircle2, AlertCircle,
  Camera, X, ArrowRight, ArrowLeft, FileSpreadsheet, History, Calculator, Pencil, Home as HomeIcon,
  Zap, Archive
} from 'lucide-react'
import * as XLSX from 'xlsx'

// ─── Constants ──────────────────────────────────────────────────────────────
const BRANCH_REGISTERS: Record<number, number[]> = {
  1: [1, 2, 3, 6],
  2: [4, 5, 7],
  3: [9, 10],
}

const BILL_DENOMS = [200, 100, 50, 20, 10]
const COIN_DENOMS = [10, 5, 2, 1, 0.5, 0.1]

const BILL_IMAGES: Record<string, string> = {
  '200': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/INS-200-NIS-%282015%29-front.jpg/320px-INS-200-NIS-%282015%29-front.jpg',
  '100': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/INS-100-NIS-%282017%29-front.jpg/320px-INS-100-NIS-%282017%29-front.jpg',
  '50':  'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/INS-50-NIS-%282014%29-front.jpg/320px-INS-50-NIS-%282014%29-front.jpg',
  '20':  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/INS-20-NIS-%282017%29-front.jpg/320px-INS-20-NIS-%282017%29-front.jpg',
  '10':  'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/INS-10-NIS-%281998%29-front.jpg/320px-INS-10-NIS-%281998%29-front.jpg',
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
function fmt(n: number) { return '₪' + Math.round(n).toLocaleString() }
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

  const [cashSales, setCashSales] = useState(existing ? String(existing.cash_sales) : '')
  const [creditSales, setCreditSales] = useState(existing ? String(existing.credit_sales) : '')
  const [txCount, setTxCount] = useState(existing?.transaction_count ? String(existing.transaction_count) : '')
  const [zPhotoParsing, setZPhotoParsing] = useState(false)
  const [zPhotoError, setZPhotoError] = useState('')
  const zFileRef = useRef<HTMLInputElement>(null)

  const [billCounts, setBillCounts] = useState<Record<string, number>>({})
  const [coinCounts, setCoinCounts] = useState<Record<string, number>>({})
  const [actualCashManual, setActualCashManual] = useState(existing ? String(existing.actual_cash) : '')

  const [varianceAction, setVarianceAction] = useState<'surplus_fund' | 'documented' | 'kept'>(
    (existing?.variance_action as any) || 'documented'
  )
  const [nextOpeningOverride, setNextOpeningOverride] = useState(
    existing ? String(existing.next_opening_balance) : ''
  )
  const [notes, setNotes] = useState(existing?.notes || '')
  const [saving, setSaving] = useState(false)

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
      if (data && data.length > 0) setOpeningBalance(String(data[0].next_opening_balance))
      else setOpeningBalance('0')
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
  const defaultNextOpening = countedCash - cash
  const variance = countedCash - expectedCash

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
      const deposit = cash

      const row = {
        branch_id: branchId,
        date,
        register_number: registerNumber,
        opening_balance: opening,
        cash_sales: cash,
        credit_sales: credit,
        transaction_count: txCount ? parseInt(txCount) : 0,
        actual_cash: countedCash,
        deposit_amount: deposit,
        variance,
        variance_action: variance !== 0 ? varianceAction : null,
        next_opening_balance: chosenNext,
        notes: notes || null,
      }

      let closingId: number
      if (isEdit && existing) {
        const { error } = await supabase.from('register_closings').update(row).eq('id', existing.id)
        if (error) throw error
        closingId = existing.id
        // Remove previous auto change_fund entries linked to this closing, they will be re-inserted with fresh state
        await supabase.from('change_fund').delete().eq('related_closing_id', closingId)
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
        await supabase.from('change_fund').insert({
          branch_id: branchId,
          date,
          type: u.type,
          amount: u.amount,
          description: u.description,
          balance_after: balance,
          related_closing_id: closingId,
          related_register_number: registerNumber,
        })
      }

      onSaved()
    } catch (e: any) {
      alert('שגיאת שמירה: ' + (e?.message || 'לא ידוע'))
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
        style={{ background: '#f8fafc', width: '100%', maxWidth: 720, maxHeight: '96vh', overflow: 'auto', borderRadius: '20px 20px 0 0', direction: 'rtl' }}>

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
                    <label style={S.label}>מספר עסקאות (אופציונלי)</label>
                    <input type="number" inputMode="numeric" value={txCount} onChange={e => setTxCount(e.target.value)} style={S.input} placeholder="0" />
                  </div>
                </div>

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
                  <Kpi label="פער" value={variance} color={Math.abs(variance) < 0.01 ? '#059669' : variance > 0 ? '#f59e0b' : '#dc2626'} sub="נספר − צפוי" showSign />
                </div>
              </div>
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
                  <Kpi label="פער" value={variance} color={Math.abs(variance) < 0.01 ? '#059669' : variance > 0 ? '#f59e0b' : '#dc2626'} showSign />
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
          {step < 4 ? (
            <button onClick={() => setStep(step + 1)}
              disabled={step === 2 && !cashSales}
              style={{ background: step === 2 && !cashSales ? '#c7d2fe' : '#6366f1', color: 'white', border: 'none', borderRadius: 12, padding: '14px 26px', fontSize: 15, fontWeight: 800, cursor: step === 2 && !cashSales ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, minHeight: 56 }}>
              הבא <ArrowLeft size={17} />
            </button>
          ) : (
            <button onClick={save} disabled={saving}
              style={{ background: saving ? '#c7d2fe' : '#059669', color: 'white', border: 'none', borderRadius: 12, padding: '14px 26px', fontSize: 15, fontWeight: 800, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, minHeight: 56 }}>
              <CheckCircle2 size={18} /> {saving ? 'שומר…' : isEdit ? 'עדכן סגירה' : 'אישור סגירה'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function Kpi({ label, value, color, sub, emphasis, showSign }: { label: string; value: number; color: string; sub?: string; emphasis?: boolean; showSign?: boolean }) {
  const text = showSign
    ? (value > 0 ? '+' : value < 0 ? '−' : '') + '₪' + Math.abs(value).toFixed(2).replace(/\.00$/, '')
    : fmt(value)
  return (
    <div style={{ padding: 12, background: emphasis ? '#ecfdf5' : '#f8fafc', borderRadius: 12, border: emphasis ? '1.5px solid #a7f3d0' : '1px solid #f1f5f9' }}>
      <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{text}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, fontWeight: 600 }}>{sub}</div>}
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
            <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>סכום צפוי: {fmt(totalExpectedCash)}</div>
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
              <Kpi label="פער" value={diff} color={Math.abs(diff) < 0.01 ? '#059669' : '#dc2626'} showSign />
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
      await supabase.from('change_fund').insert({
        branch_id: branchId,
        date: today,
        type: 'withdraw_to_register',
        amount: -amt,
        description: `הפעלת קופה ${registerNumber}`,
        balance_after: newBalance,
        related_closing_id: inserted.id,
        related_register_number: registerNumber,
      })
      onSaved()
    } catch (e: any) {
      alert('שגיאה: ' + (e?.message || 'לא ידוע'))
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
              יתרת קופת עודף: <strong>{fmt(fundBalance)}</strong>
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
        await supabase.from('change_fund').insert({
          branch_id: branchId,
          date: today,
          type: 'push_from_register',
          amount: openingAmount,
          description: `ריקון קופה ${registerNumber}`,
          balance_after: newBalance,
          related_closing_id: inserted.id,
          related_register_number: registerNumber,
        })
      }
      onSaved()
    } catch (e: any) {
      alert('שגיאה: ' + (e?.message || 'לא ידוע'))
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
            <div style={{ fontSize: 28, fontWeight: 900, color: '#4c1d95' }}>{fmt(openingAmount)}</div>
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
  const [overallOpen, setOverallOpen] = useState(false)
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
                <KpiCard Icon={DollarSign} color="#10b981" label='סה"כ מכירות מזומן' value={fmt(totalCash)} />
                <KpiCard Icon={CreditCard} color="#3b82f6" label='סה"כ מכירות אשראי' value={fmt(totalCredit)} />
                <KpiCard Icon={AlertCircle} color={Math.abs(totalVariance) < 0.01 ? '#10b981' : '#f59e0b'} label="סך פערים" value={(totalVariance >= 0 ? '+' : '') + fmt(totalVariance)} />
                <KpiCard Icon={Wallet} color="#7c3aed" label="יתרת קופת עודף" value={fmt(fundBalance)} />
              </div>
            </motion.div>

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
                              מזומן: {fmt(Number(closing.cash_sales))}<br />
                              פער: {fmt(Number(closing.variance))}
                            </div>
                            <button onClick={() => setEditClosing(closing)}
                              style={{ width: '100%', background: 'white', color: '#065f46', border: '1.5px solid #a7f3d0', borderRadius: 10, padding: '8px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              <Pencil size={13} /> ערוך
                            </button>
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
                              title={last ? `יתרת פתיחה נוכחית: ${fmt(Number(last.next_opening_balance))}` : ''}
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
                        <td style={{ padding: '10px 10px' }}>{fmt(Number(c.opening_balance))}</td>
                        <td style={{ padding: '10px 10px', color: '#10b981', fontWeight: 700 }}>{fmt(Number(c.cash_sales))}</td>
                        <td style={{ padding: '10px 10px', color: '#3b82f6', fontWeight: 700 }}>{fmt(Number(c.credit_sales))}</td>
                        <td style={{ padding: '10px 10px', color: '#64748b' }}>{c.transaction_count || '—'}</td>
                        <td style={{ padding: '10px 10px' }}>{fmt(Number(c.actual_cash))}</td>
                        <td style={{ padding: '10px 10px', color: Math.abs(Number(c.variance)) < 0.01 ? '#059669' : Number(c.variance) > 0 ? '#f59e0b' : '#dc2626', fontWeight: 800 }}>
                          {Number(c.variance) > 0 ? '+' : ''}{fmt(Number(c.variance))}
                        </td>
                        <td style={{ padding: '10px 10px', fontSize: 11, color: '#64748b' }}>
                          {c.variance_action === 'surplus_fund' ? 'קופת עודף' : c.variance_action === 'documented' ? 'מתועד' : c.variance_action === 'kept' ? 'הושאר' : '—'}
                        </td>
                        <td style={{ padding: '10px 10px' }}>{fmt(Number(c.next_opening_balance))}</td>
                        <td style={{ padding: '10px 6px' }}>
                          <button onClick={() => setEditClosing(c)}
                            title="עריכה"
                            style={{ width: 36, height: 36, border: '1.5px solid #e2e8f0', background: 'white', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Pencil size={14} color="#6366f1" />
                          </button>
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
