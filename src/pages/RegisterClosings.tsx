import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/PageHeader'
import {
  DollarSign, CreditCard, Wallet, CheckCircle2, AlertCircle,
  Camera, X, ArrowRight, ArrowLeft, FileSpreadsheet, History, Calculator
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

// Counter component for bills/coins
function DenomCounter({ denoms, counts, setCounts, label }: {
  denoms: number[]; counts: Record<string, number>; setCounts: (c: Record<string, number>) => void; label: string
}) {
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {denoms.map(d => {
          const key = String(d)
          const count = counts[key] || 0
          const subtotal = count * d
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6366f1', minWidth: 36 }}>₪{d}</span>
              <input type="number" min={0} value={count || ''}
                onChange={e => setCounts({ ...counts, [key]: Math.max(0, parseInt(e.target.value) || 0) })}
                style={{ flex: 1, border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '6px 8px', fontSize: 13, outline: 'none', textAlign: 'center', width: 60 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', minWidth: 60, textAlign: 'left' }}>
                {subtotal > 0 ? fmtDec(subtotal) : '—'}
              </span>
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
// Wizard for closing a single register
// ═══════════════════════════════════════════════════════════════════════════
function ClosingWizard({ branchId, registerNumber, onClose, onSaved }: {
  branchId: number; registerNumber: number; onClose: () => void; onSaved: () => void
}) {
  const [step, setStep] = useState(1)
  const [date, setDate] = useState(todayISO())
  const [openingBalance, setOpeningBalance] = useState('')
  const [prevBalanceLoaded, setPrevBalanceLoaded] = useState(false)

  const [cashSales, setCashSales] = useState('')
  const [creditSales, setCreditSales] = useState('')
  const [zPhotoParsing, setZPhotoParsing] = useState(false)
  const [zPhotoError, setZPhotoError] = useState('')
  const zFileRef = useRef<HTMLInputElement>(null)

  const [billCounts, setBillCounts] = useState<Record<string, number>>({})
  const [coinCounts, setCoinCounts] = useState<Record<string, number>>({})

  const [varianceAction, setVarianceAction] = useState<'surplus_fund' | 'documented' | 'kept'>('documented')
  const [nextOpeningOverride, setNextOpeningOverride] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Load previous closing's next_opening_balance as default
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('register_closings')
        .select('next_opening_balance, date')
        .eq('branch_id', branchId)
        .eq('register_number', registerNumber)
        .lt('date', date)
        .order('date', { ascending: false })
        .limit(1)
      if (data && data.length > 0) {
        setOpeningBalance(String(data[0].next_opening_balance))
      } else {
        setOpeningBalance('0')
      }
      setPrevBalanceLoaded(true)
    })()
  }, [branchId, registerNumber])

  const countedCash = totalFromCounts(BILL_DENOMS, billCounts) + totalFromCounts(COIN_DENOMS, coinCounts)
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
        body: {
          image_base64: base64,
          image_media_type: mediaType,
          extract_type: 'z_report',
        }
      })
      if (error) throw new Error(error.message)
      if (data?.success && data.data) {
        if (data.data.cash_sales !== null && data.data.cash_sales !== undefined)
          setCashSales(String(data.data.cash_sales))
        if (data.data.credit_sales !== null && data.data.credit_sales !== undefined)
          setCreditSales(String(data.data.credit_sales))
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
        actual_cash: countedCash,
        deposit_amount: deposit,
        variance,
        variance_action: variance !== 0 ? varianceAction : null,
        next_opening_balance: chosenNext,
        notes: notes || null,
      }
      const { data: inserted, error } = await supabase.from('register_closings').insert(row).select().single()
      if (error) throw error

      // Change fund updates
      const fundUpdates: Array<{ type: string; amount: number; description: string }> = []

      // 1) Surplus/shortage moving to fund
      if (variance !== 0 && varianceAction === 'surplus_fund') {
        fundUpdates.push({
          type: 'auto_from_closing',
          amount: variance, // positive = added, negative = taken
          description: `פער מסגירת קופה ${registerNumber} (${date})`,
        })
      }

      // 2) User changed next opening balance — adjust via withdraw/push
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
            amount: -openingDelta, // openingDelta negative → positive amount into fund
            description: `הקטנת יתרת פתיחה מחר מקופה ${registerNumber}`,
          })
        }
      }

      // Apply fund updates sequentially
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
          related_closing_id: inserted.id,
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
    label: { fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 6, display: 'block' as const },
    input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' as const },
  }

  const steps = ['פתיחה', 'מכירות', 'ספירת מזומן', 'סיום']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ background: '#f8fafc', width: '100%', maxWidth: 720, maxHeight: '92vh', overflow: 'auto', borderRadius: 16, direction: 'rtl' }}>

        {/* Header + progress */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'white', padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>שלב {step} מתוך 4</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>סגירת קופה {registerNumber}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} color="#94a3b8" /></button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {steps.map((s, i) => (
              <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i + 1 <= step ? '#6366f1' : '#e2e8f0' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
            {steps.map((s, i) => (
              <div key={s} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 600, color: i + 1 === step ? '#6366f1' : '#94a3b8' }}>{s}</div>
            ))}
          </div>
        </div>

        <div style={{ padding: 20 }}>

          {/* Step 1 — Opening */}
          {step === 1 && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={S.label}>תאריך</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
                  </div>
                  <div>
                    <label style={S.label}>קופה</label>
                    <div style={{ ...S.input, background: '#f8fafc', color: '#0f172a', fontWeight: 700 }}>{registerNumber}</div>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <label style={S.label}>
                    יתרת פתיחה <span style={{ fontWeight: 400, color: '#94a3b8' }}>(₪)</span>
                  </label>
                  <input type="number" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} style={S.input} placeholder="0" />
                  {prevBalanceLoaded && (
                    <div style={{ fontSize: 12, color: '#6366f1', marginTop: 6 }}>
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
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={S.label}>
                      <DollarSign size={13} style={{ display: 'inline', marginLeft: 4 }} />
                      מכירות מזומן * (₪)
                    </label>
                    <input type="number" value={cashSales} onChange={e => setCashSales(e.target.value)} style={S.input} placeholder="0" />
                  </div>
                  <div>
                    <label style={S.label}>
                      <CreditCard size={13} style={{ display: 'inline', marginLeft: 4 }} />
                      מכירות אשראי (₪)
                    </label>
                    <input type="number" value={creditSales} onChange={e => setCreditSales(e.target.value)} style={S.input} placeholder="0" />
                  </div>
                </div>

                <div style={{ marginTop: 16, padding: 14, background: '#eef2ff', border: '1px dashed #c7d2fe', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#4338ca', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Camera size={15} /> העלאת צילום דוח Z (אופציונלי)
                  </div>
                  <div style={{ fontSize: 12, color: '#6366f1', marginBottom: 10 }}>
                    צלם את דוח ה-Z והמערכת תמלא עבורך את המכירות
                  </div>
                  <input ref={zFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => e.target.files && e.target.files[0] && handleZPhoto(e.target.files[0])} />
                  <button onClick={() => zFileRef.current?.click()} disabled={zPhotoParsing}
                    style={{ background: zPhotoParsing ? '#c7d2fe' : '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: zPhotoParsing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Camera size={14} />
                    {zPhotoParsing ? 'מחלץ נתונים…' : 'בחר תמונה'}
                  </button>
                  {zPhotoError && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{zPhotoError}</div>}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3 — Cash count */}
          {step === 3 && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <DenomCounter denoms={BILL_DENOMS} counts={billCounts} setCounts={setBillCounts} label="שטרות" />
              <DenomCounter denoms={COIN_DENOMS} counts={coinCounts} setCounts={setCoinCounts} label="מטבעות" />

              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                  <Kpi label="נספר" value={countedCash} color="#0f172a" />
                  <Kpi label="צפוי" value={expectedCash} color="#6366f1" sub="פתיחה + מזומן" />
                  <Kpi label="לשים בשקית" value={depositToBag} color="#059669" emphasis sub="מכירות מזומן בדיוק" />
                  <Kpi label="פתיחה מחר" value={defaultNextOpening} color="#7c3aed" sub="נספר − מזומן" />
                  <Kpi label="פער" value={variance} color={Math.abs(variance) < 0.01 ? '#059669' : variance > 0 ? '#f59e0b' : '#dc2626'} sub="נספר − צפוי" showSign />
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 4 — Summary */}
          {step === 4 && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>סיכום סגירה</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
                  <Kpi label="יתרת פתיחה" value={opening} color="#64748b" />
                  <Kpi label="מזומן" value={cash} color="#10b981" />
                  <Kpi label="אשראי" value={credit} color="#3b82f6" />
                  <Kpi label="נספר" value={countedCash} color="#0f172a" />
                  <Kpi label="לשים בשקית" value={depositToBag} color="#059669" emphasis />
                  <Kpi label="פער" value={variance} color={Math.abs(variance) < 0.01 ? '#059669' : variance > 0 ? '#f59e0b' : '#dc2626'} showSign />
                </div>

                {Math.abs(variance) >= 0.01 && (
                  <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={14} /> טיפול בפער {variance > 0 ? 'עודף' : 'חוסר'} של {fmt(Math.abs(variance))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        { k: 'surplus_fund', l: variance > 0 ? 'הכנס לקופת עודף' : 'קח מקופת עודף' },
                        { k: 'documented', l: 'תעד כחוסר/עודף' },
                        { k: 'kept', l: 'השאר בקופה' },
                      ].map(o => (
                        <button key={o.k} onClick={() => setVarianceAction(o.k as any)}
                          style={{ background: varianceAction === o.k ? '#6366f1' : 'white', color: varianceAction === o.k ? 'white' : '#475569', border: '1px solid ' + (varianceAction === o.k ? '#6366f1' : '#e2e8f0'), borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          {o.l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>יתרת פתיחה מחר (₪)</label>
                  <input type="number" value={nextOpeningOverride} onChange={e => setNextOpeningOverride(e.target.value)} style={S.input} placeholder={String(defaultNextOpening.toFixed(2))} />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
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
        <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid #f1f5f9', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <button disabled={step === 1} onClick={() => setStep(step - 1)}
            style={{ background: step === 1 ? '#f1f5f9' : 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 700, color: step === 1 ? '#cbd5e1' : '#475569', cursor: step === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ArrowRight size={15} /> הקודם
          </button>
          {step < 4 ? (
            <button onClick={() => setStep(step + 1)}
              disabled={step === 2 && !cashSales}
              style={{ background: step === 2 && !cashSales ? '#c7d2fe' : '#6366f1', color: 'white', border: 'none', borderRadius: 10, padding: '9px 22px', fontSize: 14, fontWeight: 700, cursor: step === 2 && !cashSales ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              הבא <ArrowLeft size={15} />
            </button>
          ) : (
            <button onClick={save} disabled={saving}
              style={{ background: saving ? '#c7d2fe' : '#059669', color: 'white', border: 'none', borderRadius: 10, padding: '9px 22px', fontSize: 14, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={16} /> {saving ? 'שומר…' : 'אישור סגירה'}
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
    <div style={{ padding: 10, background: emphasis ? '#ecfdf5' : '#f8fafc', borderRadius: 10, border: emphasis ? '1px solid #a7f3d0' : '1px solid #f1f5f9' }}>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{text}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ background: '#f8fafc', width: '100%', maxWidth: 640, maxHeight: '92vh', overflow: 'auto', borderRadius: 16, direction: 'rtl' }}>
        <div style={{ position: 'sticky', top: 0, background: 'white', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>ספירה כוללת — אימות שקית הפקדה</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>סכום צפוי: {fmt(totalExpectedCash)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} color="#94a3b8" /></button>
        </div>
        <div style={{ padding: 20 }}>
          <DenomCounter denoms={BILL_DENOMS} counts={billCounts} setCounts={setBillCounts} label="שטרות" />
          <DenomCounter denoms={COIN_DENOMS} counts={coinCounts} setCounts={setCoinCounts} label="מטבעות" />

          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Kpi label="נספר" value={counted} color="#0f172a" />
              <Kpi label="אמור להיות" value={totalExpectedCash} color="#6366f1" />
              <Kpi label="פער" value={diff} color={Math.abs(diff) < 0.01 ? '#059669' : '#dc2626'} showSign />
            </div>
            {Math.abs(diff) < 0.01 && totalExpectedCash > 0 && (
              <div style={{ marginTop: 12, padding: 10, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, color: '#065f46', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={15} /> שקית ההפקדה תואמת למכירות המזומן
              </div>
            )}
          </div>
        </div>
        <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid #f1f5f9', padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ background: '#059669', color: 'white', border: 'none', borderRadius: 10, padding: '9px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>סגור</button>
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

  const [todayClosings, setTodayClosings] = useState<Closing[]>([])
  const [fundBalance, setFundBalance] = useState(0)
  const [wizardReg, setWizardReg] = useState<number | null>(null)
  const [overallOpen, setOverallOpen] = useState(false)
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().split('T')[0]
  })
  const [historyTo, setHistoryTo] = useState(today)
  const [historyReg, setHistoryReg] = useState<number | 'all'>('all')
  const [history, setHistory] = useState<Closing[]>([])

  async function loadAll() {
    const [todayRes, fundRes] = await Promise.all([
      supabase.from('register_closings').select('*').eq('branch_id', branchId).eq('date', today),
      supabase.from('change_fund').select('balance_after').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(1),
    ])
    setTodayClosings((todayRes.data || []) as Closing[])
    setFundBalance(fundRes.data && fundRes.data.length > 0 ? Number(fundRes.data[0].balance_after) : 0)
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
  useEffect(() => { loadHistory() }, [branchId, historyFrom, historyTo, historyReg])

  const closedRegs = new Set(todayClosings.map(c => c.register_number))
  const openRegs = registers.filter(r => !closedRegs.has(r))
  const allClosed = registers.length > 0 && openRegs.length === 0

  const totalCash = todayClosings.reduce((s, c) => s + Number(c.cash_sales), 0)
  const totalCredit = todayClosings.reduce((s, c) => s + Number(c.credit_sales), 0)
  const totalVariance = todayClosings.reduce((s, c) => s + Number(c.variance), 0)

  function exportExcel() {
    const rows = history.map(c => ({
      'תאריך': c.date,
      'קופה': c.register_number,
      'יתרת פתיחה': Number(c.opening_balance),
      'מכירות מזומן': Number(c.cash_sales),
      'מכירות אשראי': Number(c.credit_sales),
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

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>

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
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 18, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>קופות הסניף</div>
              {openRegs.length > 0 && (
                <span style={{ background: '#fee2e2', color: '#991b1b', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999 }}>
                  {openRegs.length} פתוחות
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {registers.map(r => {
                const closed = closedRegs.has(r)
                const closing = todayClosings.find(c => c.register_number === r)
                return (
                  <div key={r} style={{ background: closed ? '#f0fdf4' : 'white', border: '1px solid ' + (closed ? '#a7f3d0' : '#fecaca'), borderRadius: 12, padding: 14, position: 'relative' }}>
                    {!closed && (
                      <span style={{ position: 'absolute', top: -6, left: -6, background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, boxShadow: '0 2px 6px rgba(239,68,68,0.4)' }}>
                        טרם נסגרה
                      </span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>קופה {r}</div>
                      {closed ? <CheckCircle2 size={18} color="#059669" /> : <AlertCircle size={18} color="#dc2626" />}
                    </div>
                    {closed && closing ? (
                      <div style={{ fontSize: 12, color: '#065f46' }}>
                        מזומן: {fmt(Number(closing.cash_sales))} · פער: {fmt(Number(closing.variance))}
                      </div>
                    ) : (
                      <button onClick={() => setWizardReg(r)}
                        style={{ width: '100%', background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginTop: 6 }}>
                        סגור קופה
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {allClosed && (
              <button onClick={() => setOverallOpen(true)}
                style={{ marginTop: 14, width: '100%', background: '#059669', color: 'white', border: 'none', borderRadius: 10, padding: '12px', fontSize: 15, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Calculator size={18} />
                ספירה כוללת לאימות שקית הפקדה
              </button>
            )}
          </div>
        </motion.div>

        {/* History */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                <History size={16} /> היסטוריה
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 }} />
                <span style={{ color: '#94a3b8', fontSize: 13 }}>עד</span>
                <input type="date" value={historyTo} onChange={e => setHistoryTo(e.target.value)} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 }} />
                <select value={historyReg} onChange={e => setHistoryReg(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                  style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
                  <option value="all">כל הקופות</option>
                  {registers.map(r => <option key={r} value={r}>קופה {r}</option>)}
                </select>
                <button onClick={exportExcel}
                  style={{ background: '#059669', color: 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileSpreadsheet size={14} /> ייצוא
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['תאריך', 'קופה', 'פתיחה', 'מזומן', 'אשראי', 'מזומן בקופה', 'הפקדה', 'פער', 'פתיחה מחר', 'הערות'].map(h => (
                      <th key={h} style={{ padding: '9px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>אין רשומות</td></tr>
                  ) : history.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                      <td style={{ padding: '8px 10px' }}>{new Date(c.date + 'T12:00:00').toLocaleDateString('he-IL')}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>{c.register_number}</td>
                      <td style={{ padding: '8px 10px' }}>{fmt(Number(c.opening_balance))}</td>
                      <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 600 }}>{fmt(Number(c.cash_sales))}</td>
                      <td style={{ padding: '8px 10px', color: '#3b82f6', fontWeight: 600 }}>{fmt(Number(c.credit_sales))}</td>
                      <td style={{ padding: '8px 10px' }}>{fmt(Number(c.actual_cash))}</td>
                      <td style={{ padding: '8px 10px' }}>{fmt(Number(c.deposit_amount))}</td>
                      <td style={{ padding: '8px 10px', color: Math.abs(Number(c.variance)) < 0.01 ? '#059669' : Number(c.variance) > 0 ? '#f59e0b' : '#dc2626', fontWeight: 700 }}>
                        {Number(c.variance) > 0 ? '+' : ''}{fmt(Number(c.variance))}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{fmt(Number(c.next_opening_balance))}</td>
                      <td style={{ padding: '8px 10px', color: '#64748b' }}>{c.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

      </div>

      {wizardReg !== null && (
        <ClosingWizard branchId={branchId} registerNumber={wizardReg}
          onClose={() => setWizardReg(null)}
          onSaved={() => { setWizardReg(null); loadAll(); loadHistory() }} />
      )}
      {overallOpen && (
        <OverallCount totalExpectedCash={totalCash} onClose={() => setOverallOpen(false)} />
      )}
    </div>
  )
}

function KpiCard({ Icon, color, label, value }: { Icon: any; color: string; label: string; value: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 38, height: 38, background: color + '15', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={18} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{value}</div>
      </div>
    </div>
  )
}
