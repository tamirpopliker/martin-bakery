import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { CreditCard, Plus, Pencil, Trash2, ChevronDown, ChevronUp, DollarSign, AlertTriangle } from 'lucide-react'
import PageHeader from '../components/PageHeader'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface Customer {
  id: number
  name: string
  phone: string | null
  credit_limit: number
  notes: string | null
  active: boolean
}

interface CreditTx {
  id: number
  date: string
  amount: number
  customer: string | null
  notes: string | null
}

interface Payment {
  id: number
  date: string
  amount: number
  notes: string | null
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function BranchCreditCustomers({ branchId, branchName, branchColor, onBack }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading]     = useState(false)
  const [tab, setTab]             = useState<'list' | 'add'>('list')

  // add/edit
  const [editId, setEditId]       = useState<number | null>(null)
  const [formName, setFormName]   = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formLimit, setFormLimit] = useState('')
  const [formNotes, setFormNotes] = useState('')

  // expanded customer
  const [expanded, setExpanded]   = useState<number | null>(null)
  const [txs, setTxs]            = useState<CreditTx[]>([])
  const [payments, setPayments]   = useState<Payment[]>([])
  const [balances, setBalances]   = useState<Record<number, number>>({})

  // payment form
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate]     = useState(new Date().toISOString().split('T')[0])
  const [payNotes, setPayNotes]   = useState('')

  async function fetchCustomers() {
    setLoading(true)
    const { data } = await supabase.from('branch_credit_customers').select('*')
      .eq('branch_id', branchId).order('name')
    if (data) {
      setCustomers(data)
      // calculate balances
      const bals: Record<number, number> = {}
      for (const c of data) {
        // credit transactions (revenue with source='credit' and matching customer name)
        const { data: txData } = await supabase.from('branch_revenue').select('amount')
          .eq('branch_id', branchId).eq('source', 'credit').eq('customer', c.name)
        const totalCredit = txData ? txData.reduce((s, r) => s + Number(r.amount), 0) : 0

        // payments
        const { data: payData } = await supabase.from('branch_credit_payments').select('amount')
          .eq('branch_id', branchId).eq('customer_name', c.name)
        const totalPaid = payData ? payData.reduce((s, r) => s + Number(r.amount), 0) : 0

        bals[c.id] = totalCredit - totalPaid
      }
      setBalances(bals)
    }
    setLoading(false)
  }

  useEffect(() => { fetchCustomers() }, [branchId])

  async function fetchDetails(customer: Customer) {
    const { data: txData } = await supabase.from('branch_revenue').select('id, date, amount, customer, notes')
      .eq('branch_id', branchId).eq('source', 'credit').eq('customer', customer.name)
      .order('date', { ascending: false }).limit(50)
    setTxs(txData || [])

    const { data: payData } = await supabase.from('branch_credit_payments').select('*')
      .eq('branch_id', branchId).eq('customer_name', customer.name)
      .order('date', { ascending: false }).limit(50)
    setPayments(payData || [])
  }

  function toggleExpand(customer: Customer) {
    if (expanded === customer.id) {
      setExpanded(null)
    } else {
      setExpanded(customer.id)
      fetchDetails(customer)
    }
  }

  async function saveCustomer() {
    if (!formName.trim()) return
    const payload = {
      branch_id: branchId,
      name: formName.trim(),
      phone: formPhone || null,
      credit_limit: parseFloat(formLimit) || 0,
      notes: formNotes || null,
      active: true,
    }
    const { error } = editId
      ? await supabase.from('branch_credit_customers').update(payload).eq('id', editId)
      : await supabase.from('branch_credit_customers').insert(payload)
    if (error) {
      console.error('[BranchCreditCustomers save] error:', error)
      alert(`שמירת פרטי לקוח ההקפה נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    resetForm()
    setTab('list')
    await fetchCustomers()
  }

  async function deleteCustomer(id: number) {
    if (!confirm('למחוק לקוח?')) return
    const { error } = await supabase.from('branch_credit_customers').delete().eq('id', id)
    if (error) {
      console.error('[BranchCreditCustomers deleteCustomer] error:', error)
      alert(`מחיקת לקוח ההקפה נכשלה: ${error.message || 'שגיאת מסד נתונים'}. ייתכן שיש לו תשלומים פעילים.`)
      return
    }
    await fetchCustomers()
  }

  function startEdit(c: Customer) {
    setEditId(c.id)
    setFormName(c.name)
    setFormPhone(c.phone || '')
    setFormLimit(String(c.credit_limit || ''))
    setFormNotes(c.notes || '')
    setTab('add')
  }

  function resetForm() {
    setEditId(null); setFormName(''); setFormPhone(''); setFormLimit(''); setFormNotes('')
  }

  async function addPayment(customerName: string) {
    if (!payAmount || parseFloat(payAmount) <= 0) return
    const { error } = await supabase.from('branch_credit_payments').insert({
      branch_id: branchId,
      customer_name: customerName,
      date: payDate,
      amount: parseFloat(payAmount),
      notes: payNotes || null,
    })
    if (error) {
      console.error('[BranchCreditCustomers addPayment] error:', error)
      alert(`רישום תשלום ההקפה נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    setPayAmount(''); setPayNotes('')
    const customer = customers.find(c => c.name === customerName)
    if (customer) await fetchDetails(customer)
    await fetchCustomers()
  }

  const totalDebt = Object.values(balances).reduce((s, v) => s + Math.max(v, 0), 0)

  const S = {
    label: { fontSize: 13, fontWeight: 600 as const, color: '#64748b', marginBottom: 6, display: 'block' as const },
    input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, background: 'white' },
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>

      <PageHeader title="לקוחות הקפה" subtitle={branchName} onBack={onBack} action={
        totalDebt > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} color="#ef4444" />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>₪{Math.round(totalDebt).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>חוב פתוח</span>
          </div>
        ) : undefined
      } />

      {/* Tabs */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '0 20px', display: 'flex', gap: 0 }}>
        <button onClick={() => { setTab('list'); resetForm() }}
          style={{ background: 'none', border: 'none', borderBottom: tab === 'list' ? '2px solid #6366f1' : '2px solid transparent', padding: '12px 16px', fontSize: 13, fontWeight: tab === 'list' ? 700 : 500, color: tab === 'list' ? '#6366f1' : '#64748b', cursor: 'pointer' }}>
          רשימת לקוחות
        </button>
        <button onClick={() => { setTab('add'); if (!editId) resetForm() }}
          style={{ background: 'none', border: 'none', borderBottom: tab === 'add' ? '2px solid #6366f1' : '2px solid transparent', padding: '12px 16px', fontSize: 13, fontWeight: tab === 'add' ? 700 : 500, color: tab === 'add' ? '#6366f1' : '#64748b', cursor: 'pointer' }}>
          {editId ? 'עריכת לקוח' : 'הוספת לקוח'}
        </button>
      </div>

      <div style={{ padding: '20px', maxWidth: 900, margin: '0 auto' }}>

        {/* Customer List */}
        {tab === 'list' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', overflow: 'hidden' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 14 }}>טוען...</div>
              ) : customers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>
                  <CreditCard size={36} color="#e2e8f0" style={{ marginBottom: 12 }} />
                  <div style={{ fontSize: 14, fontWeight: 600 }}>אין לקוחות הקפה</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>הוסף לקוח חדש בטאב "הוספת לקוח"</div>
                </div>
              ) : (
                <>
                  {/* Table header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px 36px 36px 30px', padding: '10px 16px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>
                    <span>לקוח</span>
                    <span style={{ textAlign: 'center' }}>מסגרת</span>
                    <span style={{ textAlign: 'left' }}>יתרה</span>
                    <span /><span /><span />
                  </div>
                  {customers.map((c, i) => {
                    const balance = balances[c.id] || 0
                    const isExp = expanded === c.id
                    return (
                      <div key={c.id}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px 36px 36px 30px', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #f8fafc', cursor: 'pointer' }}
                          onClick={() => toggleExpand(c)}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{c.name}</div>
                            {c.phone && <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.phone}</div>}
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            {c.credit_limit > 0 && (
                              <div style={{ fontSize: 12, color: '#94a3b8' }}>₪{c.credit_limit.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                            )}
                          </div>
                          <div style={{ textAlign: 'left' as const }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: balance > 0 ? '#ef4444' : balance < 0 ? '#34d399' : '#94a3b8' }}>
                              ₪{Math.round(Math.abs(balance)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>
                            <div style={{ fontSize: 10, color: '#94a3b8' }}>{balance > 0 ? 'חוב' : balance < 0 ? 'יתרה לזכות' : 'מאוזן'}</div>
                          </div>
                          <button onClick={e => { e.stopPropagation(); startEdit(c) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <Pencil size={14} color="#94a3b8" />
                          </button>
                          <button onClick={e => { e.stopPropagation(); deleteCustomer(c.id) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <Trash2 size={14} color="#ef4444" />
                          </button>
                          {isExp ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
                        </div>

                        {/* Expanded: history + payment */}
                        {isExp && (
                          <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>

                            {/* Payment form */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
                              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>תאריך</label>
                                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                                  style={{ ...S.input, width: 140, padding: '7px 10px', fontSize: 13 }} />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>סכום תשלום (₪)</label>
                                <input type="number" placeholder="0" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                                  style={{ ...S.input, width: 120, padding: '7px 10px', fontSize: 13, textAlign: 'right' as const }} />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column' as const, flex: 1 }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>הערה</label>
                                <input type="text" placeholder="אופציונלי" value={payNotes} onChange={e => setPayNotes(e.target.value)}
                                  style={{ ...S.input, padding: '7px 10px', fontSize: 13 }} />
                              </div>
                              <button onClick={() => addPayment(c.name)} disabled={!payAmount || parseFloat(payAmount) <= 0}
                                style={{ background: payAmount && parseFloat(payAmount) > 0 ? '#6366f1' : '#e2e8f0', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' as const }}>
                                <DollarSign size={14} />רשום תשלום
                              </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              {/* Credit txs */}
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>עסקאות הקפה</div>
                                {txs.length === 0 ? (
                                  <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>אין עסקאות</div>
                                ) : (
                                  <div style={{ maxHeight: 180, overflowY: 'auto' as const, borderRadius: 8, background: 'white', border: '1px solid #f1f5f9' }}>
                                    {txs.map(tx => (
                                      <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid #f8fafc', fontSize: 12 }}>
                                        <span style={{ color: '#64748b' }}>{new Date(tx.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                                        <span style={{ fontWeight: 600, color: '#ef4444' }}>₪{Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Payments */}
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginBottom: 6 }}>תשלומים</div>
                                {payments.length === 0 ? (
                                  <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>אין תשלומים</div>
                                ) : (
                                  <div style={{ maxHeight: 180, overflowY: 'auto' as const, borderRadius: 8, background: 'white', border: '1px solid #f1f5f9' }}>
                                    {payments.map(p => (
                                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid #f8fafc', fontSize: 12 }}>
                                        <span style={{ color: '#64748b' }}>
                                          {new Date(p.date + 'T12:00:00').toLocaleDateString('he-IL')}
                                          {p.notes && <span style={{ color: '#94a3b8', marginRight: 6 }}>({p.notes})</span>}
                                        </span>
                                        <span style={{ fontWeight: 600, color: '#34d399' }}>₪{Number(p.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </motion.div>
        )}

        {/* Add/Edit form */}
        {tab === 'add' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 24 }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                {editId ? 'עריכת לקוח' : 'הוספת לקוח הקפה חדש'}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={S.label}>שם לקוח</label>
                  <input type="text" placeholder="שם מלא..." value={formName} onChange={e => setFormName(e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>טלפון</label>
                  <input type="text" placeholder="050-..." value={formPhone} onChange={e => setFormPhone(e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>מסגרת אשראי (₪)</label>
                  <input type="number" placeholder="0" value={formLimit} onChange={e => setFormLimit(e.target.value)} style={{ ...S.input, textAlign: 'right' as const }} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={S.label}>הערות</label>
                  <input type="text" placeholder="אופציונלי..." value={formNotes} onChange={e => setFormNotes(e.target.value)} style={S.input} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={saveCustomer} disabled={!formName.trim()}
                  style={{ background: formName.trim() ? '#6366f1' : '#e2e8f0', color: formName.trim() ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Plus size={16} />{editId ? 'עדכן' : 'הוסף לקוח'}
                </button>
                {editId && (
                  <button onClick={() => { resetForm(); setTab('list') }}
                    style={{ background: 'none', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    ביטול
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}

      </div>
    </div>
  )
}
