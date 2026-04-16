import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/PageHeader'
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, ArrowRightLeft,
  RefreshCw, FileSpreadsheet, X
} from 'lucide-react'
import * as XLSX from 'xlsx'

const BRANCH_REGISTERS: Record<number, number[]> = {
  1: [1, 2, 3, 6],
  2: [4, 5, 7],
  3: [9, 10, 11, 13],
}

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface Movement {
  id: number
  branch_id: number
  date: string
  type: string
  amount: number
  description: string | null
  balance_after: number
  related_closing_id: number | null
  related_register_number: number | null
  created_at: string
}

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  income: { label: 'הכנסה', color: '#059669', bg: '#ecfdf5' },
  expense: { label: 'הוצאה', color: '#dc2626', bg: '#fee2e2' },
  reset: { label: 'איפוס', color: '#64748b', bg: '#f1f5f9' },
  auto_from_closing: { label: 'מסגירת קופה', color: '#0ea5e9', bg: '#e0f2fe' },
  withdraw_to_register: { label: 'משיכה לקופה', color: '#f59e0b', bg: '#fef3c7' },
  push_from_register: { label: 'דחיפה מקופה', color: '#7c3aed', bg: '#ede9fe' },
}

const AUTO_TYPES = new Set(['auto_from_closing'])

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } } }

function fmt(n: number) { return '₪' + Math.round(n).toLocaleString() }
function todayISO() { return new Date().toISOString().split('T')[0] }

type ActionKey = 'income' | 'expense' | 'withdraw' | 'push' | 'reset'

export default function ChangeFund({ branchId, branchName, onBack }: Props) {
  const registers = BRANCH_REGISTERS[branchId] || []

  const [movements, setMovements] = useState<Movement[]>([])
  const [baseFund, setBaseFund] = useState(0)
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<ActionKey | null>(null)
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterType, setFilterType] = useState<string>('all')

  // Form state
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [registerChoice, setRegisterChoice] = useState<number | null>(null)
  const [baseInput, setBaseInput] = useState('')

  const balance = movements.length > 0 ? Number(movements[0].balance_after) : baseFund

  async function loadMovements() {
    let q = supabase.from('change_fund').select('*')
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
    if (filterFrom) q = q.gte('date', filterFrom)
    if (filterTo) q = q.lte('date', filterTo)
    if (filterType !== 'all') q = q.eq('type', filterType)
    const { data } = await q
    setMovements((data || []) as Movement[])
  }

  async function loadBaseFund() {
    const key = `change_fund_base_${branchId}`
    const { data } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle()
    setBaseFund(data ? Number(data.value) : 0)
    setBaseInput(data ? String(data.value) : '')
  }

  useEffect(() => { loadMovements(); loadBaseFund() }, [branchId])
  useEffect(() => { loadMovements() }, [filterFrom, filterTo, filterType])

  function resetForm() {
    setAmount(''); setDescription(''); setRegisterChoice(null); setBaseInput(String(baseFund))
  }

  async function saveBaseFund() {
    const key = `change_fund_base_${branchId}`
    const val = parseFloat(baseInput) || 0
    const { data: existing } = await supabase.from('system_settings').select('id').eq('key', key).maybeSingle()
    if (existing) {
      await supabase.from('system_settings').update({ value: String(val) }).eq('key', key)
    } else {
      await supabase.from('system_settings').insert({ key, value: String(val) })
    }
    setBaseFund(val)
  }

  async function getLatestClosing(regNum: number) {
    const { data } = await supabase.from('register_closings').select('*')
      .eq('branch_id', branchId).eq('register_number', regNum)
      .order('date', { ascending: false }).order('created_at', { ascending: false })
      .limit(1)
    return data && data.length > 0 ? data[0] : null
  }

  async function applyRegisterOpeningChange(regNum: number, delta: number, noteLabel: string): Promise<number | null> {
    const today = todayISO()
    const latest = await getLatestClosing(regNum)
    if (latest) {
      const newOpening = Math.max(0, Number(latest.next_opening_balance) + delta)
      // If the latest closing is from today, update it directly (avoid dup today rows)
      if (latest.date === today) {
        await supabase.from('register_closings').update({
          next_opening_balance: newOpening,
          actual_cash: Math.max(0, Number(latest.actual_cash) + delta),
          notes: (latest.notes ? latest.notes + ' · ' : '') + noteLabel,
        }).eq('id', latest.id)
        return latest.id
      }
      // Insert a "stub" closing for today that just reflects the opening change
      const openingBefore = Number(latest.next_opening_balance)
      const newCash = Math.max(0, openingBefore + delta)
      const { data: inserted, error } = await supabase.from('register_closings').insert({
        branch_id: branchId, date: today, register_number: regNum,
        opening_balance: openingBefore,
        cash_sales: 0, credit_sales: 0, transaction_count: 0,
        actual_cash: newCash,
        deposit_amount: 0,
        variance: delta,
        variance_action: null,
        next_opening_balance: newCash,
        notes: noteLabel,
      }).select().single()
      if (error) throw error
      return inserted.id
    }
    // No prior closing — only valid for withdraw (seed opening)
    if (delta > 0) {
      const { data: inserted, error } = await supabase.from('register_closings').insert({
        branch_id: branchId, date: today, register_number: regNum,
        opening_balance: 0, cash_sales: 0, credit_sales: 0, transaction_count: 0,
        actual_cash: delta, deposit_amount: 0,
        variance: delta, variance_action: null,
        next_opening_balance: delta,
        notes: noteLabel,
      }).select().single()
      if (error) throw error
      return inserted.id
    }
    throw new Error('לא ניתן לבצע דחיפה מקופה שאין לה יתרת פתיחה')
  }

  async function submitAction() {
    if (!action || loading) return
    const amt = parseFloat(amount)
    if (!amt && action !== 'reset') return

    setLoading(true)
    try {
      let type = ''
      let signedAmount = 0
      let desc = description || ''
      let relatedReg: number | null = null
      let relatedClosingId: number | null = null

      if (action === 'income') { type = 'income'; signedAmount = amt }
      else if (action === 'expense') { type = 'expense'; signedAmount = -amt }
      else if (action === 'withdraw') {
        if (!registerChoice) { setLoading(false); return }
        type = 'withdraw_to_register'; signedAmount = -amt
        relatedReg = registerChoice
        desc = desc || `משיכה לקופה ${registerChoice}`
        relatedClosingId = await applyRegisterOpeningChange(registerChoice, amt, desc)
      }
      else if (action === 'push') {
        if (!registerChoice) { setLoading(false); return }
        type = 'push_from_register'; signedAmount = amt
        relatedReg = registerChoice
        desc = desc || `דחיפה מקופה ${registerChoice}`
        relatedClosingId = await applyRegisterOpeningChange(registerChoice, -amt, desc)
      }
      else if (action === 'reset') {
        type = 'reset'
        const newBalance = parseFloat(baseInput) || 0
        signedAmount = newBalance - balance
        desc = desc || 'איפוס יתרה'
        await saveBaseFund()
      }

      const newBalance = balance + signedAmount
      const { error } = await supabase.from('change_fund').insert({
        branch_id: branchId,
        date: todayISO(),
        type,
        amount: signedAmount,
        description: desc || null,
        balance_after: newBalance,
        related_register_number: relatedReg,
        related_closing_id: relatedClosingId,
      })
      if (error) throw error

      resetForm()
      setAction(null)
      await loadMovements()
    } catch (e: any) {
      alert('שגיאת שמירה: ' + (e?.message || 'לא ידוע'))
    }
    setLoading(false)
  }

  function exportExcel() {
    const rows = movements.map(m => ({
      'תאריך': m.date,
      'סוג': TYPE_LABELS[m.type]?.label || m.type,
      'סכום': Number(m.amount),
      'תיאור': m.description || '',
      'יתרה אחרי': Number(m.balance_after),
      'קופה': m.related_register_number || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'קופת עודף')
    XLSX.writeFile(wb, `change_fund_${branchName}.xlsx`)
  }

  const S = {
    label: { fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 6, display: 'block' as const },
    input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, textAlign: 'right' as const },
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="קופת עודף" subtitle={branchName} onBack={onBack} />

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>

        {/* Balance hero */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', borderRadius: 16, padding: '28px 24px', marginBottom: 18, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.2)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Wallet size={26} />
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 600 }}>יתרה נוכחית</div>
                <div style={{ fontSize: 36, fontWeight: 900 }}>{fmt(balance)}</div>
              </div>
            </div>
            <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.15)', padding: '10px 18px', borderRadius: 12 }}>
              <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 600 }}>קרן בסיס</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{fmt(baseFund)}</div>
            </div>
          </div>
        </motion.div>

        {/* Action buttons */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
            {([
              { k: 'income', l: 'הכנסת כסף', I: ArrowDownCircle, c: '#059669' },
              { k: 'expense', l: 'הוצאת כסף', I: ArrowUpCircle, c: '#dc2626' },
              { k: 'withdraw', l: 'משיכה לקופה', I: ArrowRightLeft, c: '#f59e0b' },
              { k: 'push', l: 'דחיפה מקופה', I: ArrowRightLeft, c: '#7c3aed' },
              { k: 'reset', l: 'איפוס יתרה', I: RefreshCw, c: '#64748b' },
            ] as { k: ActionKey; l: string; I: any; c: string }[]).map(b => {
              const Icon = b.I
              return (
                <button key={b.k} onClick={() => { resetForm(); setAction(b.k) }}
                  style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'right', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = b.c; e.currentTarget.style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.transform = 'translateY(0)' }}>
                  <div style={{ width: 38, height: 38, background: b.c + '15', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={18} color={b.c} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{b.l}</div>
                </button>
              )
            })}
          </div>
        </motion.div>

        {/* Movements table */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>תנועות</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 }} />
                <span style={{ color: '#94a3b8', fontSize: 13 }}>עד</span>
                <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 }} />
                <select value={filterType} onChange={e => setFilterType(e.target.value)}
                  style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
                  <option value="all">כל הסוגים</option>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
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
                    {['תאריך', 'סוג', 'סכום', 'תיאור', 'יתרה אחרי', 'קופה'].map(h => (
                      <th key={h} style={{ padding: '9px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>אין תנועות</td></tr>
                  ) : movements.map(m => {
                    const info = TYPE_LABELS[m.type] || { label: m.type, color: '#64748b', bg: '#f1f5f9' }
                    const amt = Number(m.amount)
                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                        <td style={{ padding: '8px 10px' }}>{new Date(m.date + 'T12:00:00').toLocaleDateString('he-IL')}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ background: info.bg, color: info.color, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999 }}>
                            {info.label}
                          </span>
                          {AUTO_TYPES.has(m.type) && (
                            <span style={{ marginRight: 6, background: '#ede9fe', color: '#6d28d9', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999 }}>
                              אוטו׳
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: amt >= 0 ? '#059669' : '#dc2626' }}>
                          {amt > 0 ? '+' : ''}{fmt(amt)}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#475569' }}>{m.description || '—'}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>{fmt(Number(m.balance_after))}</td>
                        <td style={{ padding: '8px 10px' }}>{m.related_register_number || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Action modal */}
      {action && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setAction(null)}>
          <motion.div onClick={e => e.stopPropagation()}
            initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            style={{ background: 'white', width: '100%', maxWidth: 480, borderRadius: 16, direction: 'rtl', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                {action === 'income' && 'הכנסת כסף לעודף'}
                {action === 'expense' && 'הוצאת כסף מעודף'}
                {action === 'withdraw' && 'משיכה לקופה'}
                {action === 'push' && 'דחיפה מקופה לעודף'}
                {action === 'reset' && 'איפוס יתרת בסיס'}
              </div>
              <button onClick={() => setAction(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} color="#94a3b8" /></button>
            </div>

            <div style={{ padding: 20 }}>
              {action === 'reset' ? (
                <div>
                  <label style={S.label}>יתרת בסיס חדשה (₪)</label>
                  <input type="number" value={baseInput} onChange={e => setBaseInput(e.target.value)} style={S.input} placeholder="0" />
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                    פעולה זו תחליף את היתרה הנוכחית ({fmt(balance)}) ותשמור ערך חדש ל"קרן בסיס".
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label style={S.label}>תיאור</label>
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)} style={S.input} placeholder="סיבה..." />
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label style={S.label}>סכום (₪)</label>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={S.input} placeholder="0" />
                  </div>

                  {(action === 'withdraw' || action === 'push') && (
                    <div style={{ marginTop: 12 }}>
                      <label style={S.label}>בחר קופה</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {registers.map(r => (
                          <button key={r} onClick={() => setRegisterChoice(r)}
                            style={{ background: registerChoice === r ? '#6366f1' : 'white', color: registerChoice === r ? 'white' : '#475569', border: '1px solid ' + (registerChoice === r ? '#6366f1' : '#e2e8f0'), borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                            קופה {r}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                        {action === 'withdraw' ? 'משיכה תגדיל את יתרת הפתיחה של הקופה הנבחרת.' : 'דחיפה תקטין את יתרת הפתיחה של הקופה ותחזיר לעודף.'}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <label style={S.label}>תיאור</label>
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)} style={S.input} placeholder="הערה..." />
                  </div>
                </>
              )}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setAction(null)}
                style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 18px', fontSize: 14, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                ביטול
              </button>
              <button onClick={submitAction} disabled={loading || (action !== 'reset' && !amount) || ((action === 'withdraw' || action === 'push') && !registerChoice)}
                style={{ background: loading ? '#c7d2fe' : '#6366f1', color: 'white', border: 'none', borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>
                {loading ? 'שומר…' : 'אישור'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
